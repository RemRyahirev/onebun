/**
 * Queue Scheduler
 *
 * Handles cron, interval, and timeout scheduling.
 * Creates messages to be published via the queue adapter.
 */

import type {
  QueueAdapter,
  ScheduledJobInfo,
  OverlapStrategy,
  MessageMetadata,
} from './types';

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

  constructor(private readonly adapter: QueueAdapter) {}

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

    // Start all interval and timeout jobs
    for (const job of this.jobs.values()) {
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
    },
  ): void {
    const job: ScheduledJob = {
      name,
      type: 'interval',
      pattern,
      intervalMs,
      getDataFn,
      metadata: options?.metadata,
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
    },
  ): void {
    const job: ScheduledJob = {
      name,
      type: 'timeout',
      pattern,
      timeoutMs,
      getDataFn,
      metadata: options?.metadata,
    };

    this.jobs.set(name, job);

    // Start immediately if scheduler is running
    if (this.running) {
      this.startTimeoutJob(job);
    }
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
        pattern: job.pattern,
        schedule: {
          cron: job.cronExpression,
          every: job.intervalMs,
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
      pattern: job.pattern,
      schedule: {
        cron: job.cronExpression,
        every: job.intervalMs,
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
    } catch {
      // Error executing job - silently continue (error handling should be done via events)
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
