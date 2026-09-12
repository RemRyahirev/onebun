/**
 * Queue Scheduler
 *
 * Handles cron, interval, and timeout scheduling.
 * Creates messages to be published via the queue adapter.
 */

import {
  SpanKind,
  type Attributes,
  type Tracer,
} from '@opentelemetry/api';

import type {
  AddJobOptions,
  UpdateJobOptions,
  QueueAdapter,
  ScheduledJobInfo,
  OverlapStrategy,
  MessageMetadata,
} from './types';

import { awaitBounded } from '../await-bounded';
import { inEntrySpan } from '../trace-scope';

import {
  parseCronExpression,
  getNextRun,
  type CronSchedule,
} from './cron-parser';
import { withTraceMetadata } from './trace-metadata';


// ============================================================================
// Types
// ============================================================================

/**
 * How long shutdown waits for scheduled runs already under way.
 *
 * Matches the consumer side's `HANDLER_DRAIN_TIMEOUT_MS`, which is what the queue already
 * promises for a message being handled; a producer that gave up sooner would make the two halves
 * of the same shutdown disagree about how long "in flight" is allowed to last.
 */
const JOB_DRAIN_TIMEOUT_MS = 30_000;

/** One scheduled run that has started and not yet finished. */
interface InFlightRun {
  name: string;
  promise: Promise<void>;
}

/**
 * Job configuration
 */
interface ScheduledJob {
  name: string;
  type: 'cron' | 'interval' | 'timeout';
  pattern: string;
  metadata?: Partial<MessageMetadata>;
  overlapStrategy?: OverlapStrategy;

  // Cron-specific
  cronExpression?: string;
  cronSchedule?: CronSchedule;

  // Interval-specific
  intervalMs?: number;

  // Timeout-specific
  timeoutMs?: number;

  // Pause state
  paused?: boolean;

  // Whether created via decorator
  declarative?: boolean;

  // Runtime state
  timer?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
  isRunning?: boolean;

  /** Interval jobs only: run once when the job starts, before the first period elapses. */
  runOnStart?: boolean;
  lastRun?: Date;
  nextRun?: Date;

  // Data provider function
  getDataFn?: () => unknown | Promise<unknown>;
}

// ============================================================================
// Scheduler Implementation
// ============================================================================

/**
 * The expression parsed, and then matched nothing.
 *
 * `getNextRun` searches four years ahead, so a null answer means the schedule is unreachable
 * rather than merely distant — `0 0 30 2 *` is February 30th. Collapsing that to `undefined` is
 * what let a typo register as a job that was listed, unpaused, and permanently inert: the tick
 * only runs a job that has a `nextRun`, so it was skipped on every pass forever.
 */
function unreachableCronError(name: string, expression: string): Error {
  return new Error(
    `Cron job "${name}" has a schedule that can never run: "${expression}". `
    + 'No matching date exists within the next four years, so the job would be registered and '
    + 'never fire. Check the day-of-month and month fields together — February 30th is the usual '
    + 'cause.',
  );
}

/**
 * Two jobs claiming one name.
 *
 * Names live in one flat map and default to the bare method name, so two controllers with a
 * `cleanup()` method collided. Replacing the entry silently lost one schedule — and for interval
 * and timeout jobs it also stranded the displaced job's timer, which stayed live while no longer
 * being reachable from the map, so neither `stop()` nor `removeJob()` could clear it and the
 * process kept publishing after shutdown.
 */
function duplicateJobNameError(name: string, existing: ScheduledJob, incoming: ScheduledJob): Error {
  return new Error(
    `Scheduled job name "${name}" is already taken: an existing ${existing.type} job publishes to `
    + `"${existing.pattern}", and the new ${incoming.type} job publishes to "${incoming.pattern}". `
    + 'Job names are one namespace for the whole application and default to the method name — give '
    + 'one of them an explicit name in its @Cron / @Interval / @Timeout options.',
  );
}

/**
 * Scheduler for managing cron, interval, and timeout jobs
 */
export class QueueScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private running = false;
  private cronCheckInterval?: ReturnType<typeof setInterval>;
  private readonly cronCheckIntervalMs = 1000; // Check cron jobs every second
  private onJobError?: (jobName: string, error: unknown) => void;

  /**
   * Runs that have started and not yet finished.
   *
   * Every tick was fire-and-forget: `executeJob`'s promise was stored nowhere, so shutdown had
   * nothing to wait for. A job mid-execution when the application stopped finished into a void,
   * and its `publish()` was rejected by an adapter that had already disconnected — measured, a
   * 400 ms job with `stop()` called 120 ms in returned in 3 ms and the message never arrived.
   *
   * An entry is removed when its run settles, so whatever remains after {@link drain} is exactly
   * the set that outlived the bound.
   */
  private readonly inFlight = new Set<InFlightRun>();

  /**
   * The tracer of the application these jobs belong to, or `undefined` when it is not tracing.
   *
   * Held here rather than resolved from the ambient context: a tick arrives from a timer, and the
   * context a timer fires in is whatever armed it. Read at execution time, never captured, so a
   * scheduler built before the trace service still traces.
   */
  private ownerTracer: Tracer | undefined = undefined;

  /** `tracing.traceScheduledJobs`; turns off the per-tick span, never the ownership. */
  private traceScheduledJobs = true;

  constructor(private readonly adapter: QueueAdapter) {}

  /**
   * Name the application whose tracer every tick runs under.
   */
  setOwnerTracer(tracer: Tracer | undefined, traceScheduledJobs = true): void {
    this.ownerTracer = tracer;
    this.traceScheduledJobs = traceScheduledJobs;
  }


  /**
   * Store a job under its name, refusing to displace one that is already there.
   *
   * The refusal is the fix for both halves of the collision: the schedule that would have been
   * lost is kept, and no timer is ever stranded on an object the map no longer holds.
   */
  private registerJob(job: ScheduledJob): void {
    const existing = this.jobs.get(job.name);

    if (existing) {
      throw duplicateJobNameError(job.name, existing, job);
    }

    this.jobs.set(job.name, job);
  }

  /**
   * Set error handler for scheduled job failures
   */
  setErrorHandler(handler: (jobName: string, error: unknown) => void): void {
    this.onJobError = handler;
  }

  /**
   * Move a live cron job to its next run, and say so when there is none.
   *
   * Used by the paths that recompute an ALREADY REGISTERED job — the tick and `resumeJob` — where
   * there is no caller to throw at. Registration throws instead; see {@link unreachableCronError}.
   * The report fires once per job: without a `nextRun` the tick skips it, so it never comes back
   * here to report again.
   */
  private advanceNextRun(job: ScheduledJob, schedule: CronSchedule, from?: Date): void {
    const next = getNextRun(schedule, from);

    if (next === null) {
      job.nextRun = undefined;
      this.onJobError?.(job.name, unreachableCronError(job.name, job.cronExpression ?? '(unknown)'));

      return;
    }

    job.nextRun = next;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Start cron check interval
    this.cronCheckInterval = setInterval(() => {
      this.checkCronJobs();
    }, this.cronCheckIntervalMs);

    // Start all interval and timeout jobs (skip paused)
    for (const job of this.jobs.values()) {
      if (job.paused) {
        continue;
      }

      if (job.type === 'interval' && job.intervalMs) {
        this.startIntervalJob(job);
      } else if (job.type === 'timeout' && job.timeoutMs) {
        this.startTimeoutJob(job);
      }
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Clear cron check interval
    if (this.cronCheckInterval) {
      clearInterval(this.cronCheckInterval);
      this.cronCheckInterval = undefined;
    }

    // Clear all job timers
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        clearInterval(job.timer);
        job.timer = undefined;
      }
    }
  }

  /**
   * Add a cron job
   */
  addCronJob(
    name: string,
    expression: string,
    pattern: string,
    getDataFn?: () => unknown | Promise<unknown>,
    options?: {
      metadata?: Partial<MessageMetadata>;
      overlapStrategy?: OverlapStrategy;
      declarative?: boolean;
    },
  ): void {
    const schedule = parseCronExpression(expression);
    const nextRun = getNextRun(schedule);

    if (nextRun === null) {
      throw unreachableCronError(name, expression);
    }

    const job: ScheduledJob = {
      name,
      type: 'cron',
      pattern,
      cronExpression: expression,
      cronSchedule: schedule,
      nextRun,
      getDataFn,
      metadata: options?.metadata,
      overlapStrategy: options?.overlapStrategy ?? 'skip',
      declarative: options?.declarative,
    };

    this.registerJob(job);
  }

  /**
   * Add an interval job
   */
  addIntervalJob(
    name: string,
    intervalMs: number,
    pattern: string,
    getDataFn?: () => unknown | Promise<unknown>,
    options?: {
      metadata?: Partial<MessageMetadata>;
      overlapStrategy?: OverlapStrategy;
      runOnStart?: boolean;
      declarative?: boolean;
    },
  ): void {
    const job: ScheduledJob = {
      name,
      type: 'interval',
      pattern,
      intervalMs,
      getDataFn,
      metadata: options?.metadata,
      // Same default as cron, which is also what the documentation already claimed for both.
      overlapStrategy: options?.overlapStrategy ?? 'skip',
      runOnStart: options?.runOnStart,
      declarative: options?.declarative,
    };

    this.registerJob(job);

    // Start immediately if scheduler is running
    if (this.running) {
      this.startIntervalJob(job);
    }
  }

  /**
   * Add a timeout job (one-time delayed job)
   */
  addTimeoutJob(
    name: string,
    timeoutMs: number,
    pattern: string,
    getDataFn?: () => unknown | Promise<unknown>,
    options?: {
      metadata?: Partial<MessageMetadata>;
      declarative?: boolean;
    },
  ): void {
    const job: ScheduledJob = {
      name,
      type: 'timeout',
      pattern,
      timeoutMs,
      getDataFn,
      metadata: options?.metadata,
      declarative: options?.declarative,
    };

    this.registerJob(job);

    // Start immediately if scheduler is running
    if (this.running) {
      this.startTimeoutJob(job);
    }
  }

  /**
   * Add a job using the unified API
   */
  addJob(options: AddJobOptions): void {
    switch (options.type) {
      case 'cron':
        this.addCronJob(options.name, options.expression, options.pattern, options.getDataFn, {
          metadata: options.metadata,
          overlapStrategy: options.overlapStrategy,
        });
        break;
      case 'interval':
        this.addIntervalJob(options.name, options.intervalMs, options.pattern, options.getDataFn, {
          metadata: options.metadata,
          overlapStrategy: options.overlapStrategy,
          runOnStart: options.runOnStart,
        });
        break;
      case 'timeout':
        this.addTimeoutJob(options.name, options.timeoutMs, options.pattern, options.getDataFn, {
          metadata: options.metadata,
        });
        break;
    }
  }

  /**
   * Pause a scheduled job
   */
  pauseJob(name: string): boolean {
    const job = this.jobs.get(name);
    if (!job) {
      return false;
    }

    job.paused = true;

    if (job.timer) {
      clearTimeout(job.timer);
      clearInterval(job.timer);
      job.timer = undefined;
    }

    return true;
  }

  /**
   * Resume a paused job
   */
  resumeJob(name: string): boolean {
    const job = this.jobs.get(name);
    if (!job || !job.paused) {
      return false;
    }

    job.paused = false;

    if (this.running) {
      if (job.type === 'interval' && job.intervalMs) {
        // No leading run: the job already started once. Resuming and reconfiguring continue a
        // schedule, they do not begin one.
        this.startIntervalJob(job, false);
      } else if (job.type === 'timeout' && job.timeoutMs) {
        this.startTimeoutJob(job);
      } else if (job.type === 'cron' && job.cronSchedule) {
        this.advanceNextRun(job, job.cronSchedule);
      }
    }

    return true;
  }

  /**
   * Update a scheduled job's timing configuration
   */
  updateJob(options: UpdateJobOptions): boolean {
    const job = this.jobs.get(options.name);
    if (!job || job.type !== options.type) {
      return false;
    }

    switch (options.type) {
      case 'cron': {
        const schedule = parseCronExpression(options.expression);
        const nextRun = getNextRun(schedule);

        // Checked before anything is written: a rejected update leaves the job on the schedule it
        // already had, rather than stripping its next run on the way out.
        if (nextRun === null) {
          throw unreachableCronError(options.name, options.expression);
        }

        job.cronExpression = options.expression;
        job.cronSchedule = schedule;
        job.nextRun = nextRun;
        break;
      }
      case 'interval': {
        if (job.timer) {
          clearInterval(job.timer);
          job.timer = undefined;
        }
        job.intervalMs = options.intervalMs;
        if (this.running && !job.paused) {
          // No leading run: the job already started once. Resuming and reconfiguring continue a
          // schedule, they do not begin one.
          this.startIntervalJob(job, false);
        }
        break;
      }
      case 'timeout': {
        if (job.timer) {
          clearTimeout(job.timer);
          job.timer = undefined;
        }
        job.timeoutMs = options.timeoutMs;
        if (this.running && !job.paused) {
          this.startTimeoutJob(job);
        }
        break;
      }
    }

    return true;
  }

  /**
   * Remove a job
   */
  removeJob(name: string): boolean {
    const job = this.jobs.get(name);
    if (!job) {
      return false;
    }

    // Clear timer
    if (job.timer) {
      clearTimeout(job.timer);
      clearInterval(job.timer);
    }

    this.jobs.delete(name);

    return true;
  }

  /**
   * Get all scheduled jobs
   */
  getJobs(): ScheduledJobInfo[] {
    const result: ScheduledJobInfo[] = [];

    for (const job of this.jobs.values()) {
      result.push({
        name: job.name,
        type: job.type,
        paused: job.paused ?? false,
        declarative: job.declarative ?? false,
        pattern: job.pattern,
        schedule: {
          cron: job.cronExpression,
          every: job.intervalMs,
          timeout: job.timeoutMs,
        },
        nextRun: job.nextRun,
        lastRun: job.lastRun,
        isRunning: job.isRunning,
      });
    }

    return result;
  }

  /**
   * Get a specific job
   */
  getJob(name: string): ScheduledJobInfo | undefined {
    const job = this.jobs.get(name);
    if (!job) {
      return undefined;
    }

    return {
      name: job.name,
      type: job.type,
      paused: job.paused ?? false,
      declarative: job.declarative ?? false,
      pattern: job.pattern,
      schedule: {
        cron: job.cronExpression,
        every: job.intervalMs,
        timeout: job.timeoutMs,
      },
      nextRun: job.nextRun,
      lastRun: job.lastRun,
      isRunning: job.isRunning,
    };
  }

  /**
   * Check if a job exists
   */
  hasJob(name: string): boolean {
    return this.jobs.has(name);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Check and execute cron jobs
   */
  private checkCronJobs(): void {
    const now = new Date();

    for (const job of this.jobs.values()) {
      if (job.type !== 'cron' || !job.cronSchedule) {
        continue;
      }

      if (job.paused) {
        continue;
      }

      // Check if it's time to run
      if (job.nextRun && now >= job.nextRun) {
        // Handle overlap strategy
        if (this.hasRunInFlight(job.name) && job.overlapStrategy === 'skip') {
          // Skip this run, but update next run time
          this.advanceNextRun(job, job.cronSchedule, now);
          continue;
        }

        // Execute the job
        this.launch(job);

        // Update next run time
        this.advanceNextRun(job, job.cronSchedule, now);
      }
    }
  }

  /**
   * Start an interval job
   */
  private startIntervalJob(job: ScheduledJob, leading = true): void {
    if (job.timer || !job.intervalMs) {
      return;
    }

    job.timer = setInterval(() => {
      // The same rule cron has always had, and the one the docs already claimed for both. A
      // `setInterval` does not care whether the last tick finished, so a body slower than its
      // period ran concurrently with itself: measured at a 50 ms period with a 120 ms body,
      // 8 invocations and 3 at once inside 400 ms, publishing a duplicate every tick.
      if (job.overlapStrategy === 'skip' && this.hasRunInFlight(job.name)) {
        return;
      }

      this.launch(job);
    }, job.intervalMs);

    // The leading run belongs to STARTING the job, not to arming its timer. `resumeJob` and
    // `updateJob` re-arm a job that already started, and firing it again there gave a
    // pause/resume cycle a run the schedule never asked for — measured start=1, resume=2,
    // update=3 for the same job.
    if (leading && job.runOnStart !== false) {
      this.launch(job);
    }
  }

  /**
   * Start a timeout job
   */
  private startTimeoutJob(job: ScheduledJob): void {
    if (job.timer || !job.timeoutMs) {
      return;
    }

    job.timer = setTimeout(() => {
      this.launch(job);
      // Remove the job after execution (it's one-time)
      this.jobs.delete(job.name);
    }, job.timeoutMs);
  }

  /**
   * Execute a scheduled job
   */
  /**
   * Is a run of this job still going?
   *
   * Answered from the per-execution registry, the same one `drain` waits on, rather than from
   * `job.isRunning`. The two agree on every path reachable today — a mutation swapping this for
   * `job.isRunning` leaves the suite green, and that is stated here rather than dressed up as a
   * defect. The registry is preferred because it is a count rather than a flag: it stays correct
   * if a second run is ever allowed to start while the first is going, which is exactly what
   * `overlapStrategy: 'queue'` asks for, and it keeps "is this job busy" answered in one place
   * instead of two that must be kept in step.
   */
  private hasRunInFlight(name: string): boolean {
    for (const run of this.inFlight) {
      if (run.name === name) {
        return true;
      }
    }

    return false;
  }

  /**
   * Start a tick and remember it until it finishes.
   *
   * The four timers that reach a job all come through here. `catch` because these promises are
   * not awaited by their caller: a rejection with nobody attached is an unhandled rejection, and
   * `runJob` already reports failures through the error handler.
   */
  private launch(job: ScheduledJob): void {
    const run: InFlightRun = {
      name: job.name,
      promise: Promise.resolve(),
    };

    run.promise = this.executeJob(job)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight.delete(run);
      });

    this.inFlight.add(run);
  }

  /**
   * Wait for the runs already under way, for at most `timeoutMs`.
   *
   * Separate from {@link stop}, which stays synchronous: stopping is "accept no more work" and
   * happens instantly, draining is "let what started finish" and cannot. Splitting them also
   * keeps the documented `stop(): void` signature, and lets a caller stop the timers long before
   * it is ready to wait.
   *
   * A run still going when the bound expires is reported through the error handler BEFORE this
   * resolves — the application's shutdown tears the logger down immediately afterwards, so a
   * report made any later is written to nothing.
   */
  async drain(timeoutMs: number = JOB_DRAIN_TIMEOUT_MS): Promise<void> {
    if (this.inFlight.size === 0) {
      return;
    }

    const runs = [...this.inFlight].map(run => run.promise);

    await awaitBounded(Promise.allSettled(runs), timeoutMs);

    for (const run of this.inFlight) {
      this.onJobError?.(
        run.name,
        new Error(
          `Scheduled job "${run.name}" was still running after ${timeoutMs}ms of shutdown drain `
          + 'and has been abandoned. Anything it publishes from here will be rejected by a '
          + 'disconnected adapter.',
        ),
      );
    }
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    // A tick belongs to the schedule, not to whatever was in flight when the timer was armed.
    // Context follows the async graph into `setInterval`, so without this a cron job started
    // during a request would file every future tick under that one finished request.
    //
    // The span covers the WHOLE tick, publish included: `runJob` calls the data provider and then
    // publishes its result, and a trace that stopped at the provider would leave the publish —
    // the part that reaches another service — outside the trace it caused.
    const attributes: Attributes = {};
    attributes['onebun.job.name'] = job.name;
    attributes['onebun.job.type'] = job.type;

    return await inEntrySpan(
      `${job.type} ${job.name}`,
      async () => await this.runJob(job),
      this.ownerTracer,
      { kind: SpanKind.INTERNAL, attributes, openSpan: this.traceScheduledJobs },
    );
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    try {
      job.isRunning = true;
      job.lastRun = new Date();

      // Get data from the data provider function
      let data: unknown;
      if (job.getDataFn) {
        data = await job.getDataFn();
      } else {
        data = { timestamp: Date.now() };
      }

      // Publish the message. Stamped here rather than in `QueueService.publish`, which this
      // path does not go through — the scheduler holds the adapter directly. Inside
      // `executeJob`'s entry span, so the message carries the tick that produced it.
      await this.adapter.publish(
        job.pattern,
        data,
        withTraceMetadata({ metadata: job.metadata }),
      );
    } catch (error) {
      // Report error via handler if set, otherwise silently continue
      if (this.onJobError) {
        this.onJobError(job.name, error);
      }
    } finally {
      job.isRunning = false;
    }
  }
}

/**
 * Create a queue scheduler
 */
export function createQueueScheduler(adapter: QueueAdapter): QueueScheduler {
  return new QueueScheduler(adapter);
}
