/**
 * QueueServiceProxy — placeholder for DI when the real QueueService is created after setup().
 * When the queue is enabled, the application sets the real QueueService via setDelegate().
 * When the queue is not enabled, any method call throws a clear error.
 */

import type { QueueService } from './queue.service';
import type { QueueScheduler } from './scheduler';
import type { QueueAdapter } from './types';
import type {
  MessageHandler,
  PublishOptions,
  QueueEvents,
  ScheduledJobInfo,
  ScheduledJobOptions,
  SubscribeOptions,
  Subscription,
  QueueFeature,
} from './types';

const QUEUE_NOT_ENABLED_MESSAGE =
  'Queue is not enabled. Enable it via `queue.enabled: true` in application options or register at least one controller with queue decorators (@Subscribe, @Cron, @Interval, @Timeout).';

function throwIfNoDelegate(delegate: QueueService | null): asserts delegate is QueueService {
  if (delegate === null) {
    throw new Error(QUEUE_NOT_ENABLED_MESSAGE);
  }
}

/**
 * Proxy for QueueService used in DI before the real service is created.
 * After initializeQueue(), the application calls setDelegate(realQueueService) when the queue is enabled.
 */
export class QueueServiceProxy {
  private delegate: QueueService | null = null;

  setDelegate(service: QueueService | null): void {
    this.delegate = service;
  }

  getAdapter(): QueueAdapter {
    throwIfNoDelegate(this.delegate);

    return this.delegate.getAdapter();
  }

  getScheduler(): QueueScheduler {
    throwIfNoDelegate(this.delegate);

    return this.delegate.getScheduler();
  }

  async publish<T>(pattern: string, data: T, options?: PublishOptions): Promise<string> {
    throwIfNoDelegate(this.delegate);

    return await this.delegate.publish(pattern, data, options);
  }

  async publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>,
  ): Promise<string[]> {
    throwIfNoDelegate(this.delegate);

    return await this.delegate.publishBatch(messages);
  }

  async subscribe<T>(
    pattern: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    throwIfNoDelegate(this.delegate);

    return await this.delegate.subscribe(pattern, handler, options);
  }

  async addScheduledJob(name: string, options: ScheduledJobOptions): Promise<void> {
    throwIfNoDelegate(this.delegate);

    return await this.delegate.addScheduledJob(name, options);
  }

  async removeScheduledJob(name: string): Promise<boolean> {
    throwIfNoDelegate(this.delegate);

    return await this.delegate.removeScheduledJob(name);
  }

  async getScheduledJobs(): Promise<ScheduledJobInfo[]> {
    throwIfNoDelegate(this.delegate);

    return await this.delegate.getScheduledJobs();
  }

  supports(feature: QueueFeature): boolean {
    throwIfNoDelegate(this.delegate);

    return this.delegate.supports(feature);
  }

  on<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    throwIfNoDelegate(this.delegate);

    return this.delegate.on(event, handler);
  }

  off<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    throwIfNoDelegate(this.delegate);

    return this.delegate.off(event, handler);
  }
}

export const QUEUE_NOT_ENABLED_ERROR_MESSAGE = QUEUE_NOT_ENABLED_MESSAGE;
