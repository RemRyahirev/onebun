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

import { inEntrySpan } from '../trace-scope';

import {
  parseCronExpression,
  getNextRun,
  type CronSchedule,
} from './cron-parser';

// ============================================================================
// Types
// ============================================================================

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
  lastRun?: Date;
  nextRun?: Date;

  // Data provider function
  getDataFn?: () => unknown | Promise<unknown>;
}

// ============================================================================
// Scheduler Implementation
// ============================================================================

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
   * Set error handler for scheduled job failures
   */
  setErrorHandler(handler: (jobName: string, error: unknown) => void): void {
    this.onJobError = handler;
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
    const nextRun = getNextRun(schedule) ?? undefined;

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

    this.jobs.set(name, job);
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
      declarative: options?.declarative,
    };

    this.jobs.set(name, job);

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

    this.jobs.set(name, job);

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
        this.startIntervalJob(job);
      } else if (job.type === 'timeout' && job.timeoutMs) {
        this.startTimeoutJob(job);
      } else if (job.type === 'cron' && job.cronSchedule) {
        job.nextRun = getNextRun(job.cronSchedule) ?? undefined;
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
        job.cronExpression = options.expression;
        job.cronSchedule = schedule;
        job.nextRun = getNextRun(schedule) ?? undefined;
        break;
      }
      case 'interval': {
        if (job.timer) {
          clearInterval(job.timer);
          job.timer = undefined;
        }
        job.intervalMs = options.intervalMs;
        if (this.running && !job.paused) {
          this.startIntervalJob(job);
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
        if (job.isRunning && job.overlapStrategy === 'skip') {
          // Skip this run, but update next run time
          job.nextRun = getNextRun(job.cronSchedule, now) ?? undefined;
          continue;
        }

        // Execute the job
        this.executeJob(job);

        // Update next run time
        job.nextRun = getNextRun(job.cronSchedule, now) ?? undefined;
      }
    }
  }

  /**
   * Start an interval job
   */
  private startIntervalJob(job: ScheduledJob): void {
    if (job.timer || !job.intervalMs) {
      return;
    }

    job.timer = setInterval(() => {
      this.executeJob(job);
    }, job.intervalMs);

    // Also execute immediately
    this.executeJob(job);
  }

  /**
   * Start a timeout job
   */
  private startTimeoutJob(job: ScheduledJob): void {
    if (job.timer || !job.timeoutMs) {
      return;
    }

    job.timer = setTimeout(() => {
      this.executeJob(job);
      // Remove the job after execution (it's one-time)
      this.jobs.delete(job.name);
    }, job.timeoutMs);
  }

  /**
   * Execute a scheduled job
   */
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

      // Publish the message
      await this.adapter.publish(job.pattern, data, {
        metadata: job.metadata,
      });
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
