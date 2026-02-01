/**
 * Queue Service
 *
 * Main service for queue operations. Provides DI integration and
 * high-level API for queue operations.
 */

import {
  Context,
  Layer,
  Effect,
} from 'effect';

import type {
  QueueAdapter,
  QueueConfig,
  Message,
  PublishOptions,
  SubscribeOptions,
  Subscription,
  ScheduledJobOptions,
  ScheduledJobInfo,
  QueueFeature,
  QueueEvents,
  MessageHandler,
  BuiltInAdapterType,
} from './types';

import { getMetadata } from '../decorators/metadata';

import {
  getSubscribeMetadata,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
  getMessageGuards,
  QUEUE_METADATA,
} from './decorators';
import { executeMessageGuards, MessageExecutionContextImpl } from './guards';
import { QueueScheduler } from './scheduler';

// ============================================================================
// Queue Service Class
// ============================================================================

/**
 * Queue Service
 *
 * Provides a unified API for queue operations, handles adapter lifecycle,
 * and integrates with the scheduler for cron/interval/timeout jobs.
 */
export class QueueService {
  private adapter: QueueAdapter | null = null;
  private scheduler: QueueScheduler | null = null;
  private subscriptions: Subscription[] = [];
  private started = false;
  private config: QueueConfig;

  constructor(config: QueueConfig) {
    this.config = config;
  }

  /**
   * Initialize the queue service with an adapter
   */
  async initialize(adapter: QueueAdapter): Promise<void> {
    this.adapter = adapter;
    this.scheduler = new QueueScheduler(adapter);
    await adapter.connect();
  }

  /**
   * Start the queue service (connect and start scheduler)
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    if (!this.adapter) {
      throw new Error('Queue adapter not initialized. Call initialize() first.');
    }

    if (!this.adapter.isConnected()) {
      await this.adapter.connect();
    }

    if (this.scheduler) {
      this.scheduler.start();
    }

    this.started = true;
  }

  /**
   * Stop the queue service (disconnect and stop scheduler)
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
    }

    // Unsubscribe all subscriptions
    for (const subscription of this.subscriptions) {
      await subscription.unsubscribe();
    }
    this.subscriptions = [];

    // Disconnect adapter
    if (this.adapter) {
      await this.adapter.disconnect();
    }

    this.started = false;
  }

  /**
   * Get the underlying adapter
   */
  getAdapter(): QueueAdapter {
    if (!this.adapter) {
      throw new Error('Queue adapter not initialized');
    }

    return this.adapter;
  }

  /**
   * Get the scheduler
   */
  getScheduler(): QueueScheduler {
    if (!this.scheduler) {
      throw new Error('Queue scheduler not initialized');
    }

    return this.scheduler;
  }

  // ============================================================================
  // Publishing
  // ============================================================================

  /**
   * Publish a message to a pattern
   */
  async publish<T>(pattern: string, data: T, options?: PublishOptions): Promise<string> {
    return await this.getAdapter().publish(pattern, data, options);
  }

  /**
   * Publish multiple messages
   */
  async publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>,
  ): Promise<string[]> {
    return await this.getAdapter().publishBatch(messages);
  }

  // ============================================================================
  // Subscribing
  // ============================================================================

  /**
   * Subscribe to a pattern
   */
  async subscribe<T>(
    pattern: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    const subscription = await this.getAdapter().subscribe(pattern, handler, options);
    this.subscriptions.push(subscription);

    return subscription;
  }

  // ============================================================================
  // Scheduled Jobs
  // ============================================================================

  /**
   * Add a scheduled job
   */
  async addScheduledJob(name: string, options: ScheduledJobOptions): Promise<void> {
    return await this.getAdapter().addScheduledJob(name, options);
  }

  /**
   * Remove a scheduled job
   */
  async removeScheduledJob(name: string): Promise<boolean> {
    return await this.getAdapter().removeScheduledJob(name);
  }

  /**
   * Get all scheduled jobs
   */
  async getScheduledJobs(): Promise<ScheduledJobInfo[]> {
    return await this.getAdapter().getScheduledJobs();
  }

  // ============================================================================
  // Features
  // ============================================================================

  /**
   * Check if a feature is supported
   */
  supports(feature: QueueFeature): boolean {
    return this.getAdapter().supports(feature);
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Register an event handler
   */
  on<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    this.getAdapter().on(event, handler);
  }

  /**
   * Unregister an event handler
   */
  off<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    this.getAdapter().off(event, handler);
  }

  // ============================================================================
  // Service Registration
  // ============================================================================

  /**
   * Register a service class with queue decorators
   */
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types */
  async registerService(
    serviceInstance: any,
    serviceClass: new (...args: any[]) => any,
  ): Promise<void> {
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types */
    // Register subscribe handlers
    const subscriptions = getSubscribeMetadata(serviceClass);
    for (const sub of subscriptions) {
      const method = serviceInstance[sub.propertyKey].bind(serviceInstance) as (
        ...args: unknown[]
      ) => unknown;
      const guards = getMessageGuards(serviceClass, sub.propertyKey);

      // Wrap handler with guards
      const wrappedHandler = async (message: Message) => {
        if (guards.length > 0) {
          const context = new MessageExecutionContextImpl(
            message,
            sub.pattern,
            method,
            serviceClass,
          );

          const passed = await executeMessageGuards(guards, context);
          if (!passed) {
            return; // Guard rejected the message
          }
        }

        await method(message);
      };

      await this.subscribe(sub.pattern, wrappedHandler, sub.options);
    }

    // Register cron jobs
    const cronJobs = getCronMetadata(serviceClass);
    for (const cron of cronJobs) {
      const method = serviceInstance[cron.propertyKey].bind(serviceInstance);
      this.getScheduler().addCronJob(
        cron.options.name ?? String(cron.propertyKey),
        cron.expression,
        cron.options.pattern,
        method,
        {
          metadata: cron.options.metadata,
          overlapStrategy: cron.options.overlapStrategy,
        },
      );
    }

    // Register interval jobs
    const intervalJobs = getIntervalMetadata(serviceClass);
    for (const interval of intervalJobs) {
      const method = serviceInstance[interval.propertyKey].bind(serviceInstance);
      this.getScheduler().addIntervalJob(
        interval.options.name ?? String(interval.propertyKey),
        interval.milliseconds,
        interval.options.pattern,
        method,
        { metadata: interval.options.metadata },
      );
    }

    // Register timeout jobs
    const timeoutJobs = getTimeoutMetadata(serviceClass);
    for (const timeout of timeoutJobs) {
      const method = serviceInstance[timeout.propertyKey].bind(serviceInstance);
      this.getScheduler().addTimeoutJob(
        timeout.options.name ?? String(timeout.propertyKey),
        timeout.milliseconds,
        timeout.options.pattern,
        method,
        { metadata: timeout.options.metadata },
      );
    }

    // Register lifecycle handlers
    const onReadyHandlers = getMetadata(QUEUE_METADATA.ON_READY, serviceClass) || [];
    for (const handler of onReadyHandlers) {
      const method = serviceInstance[handler.propertyKey].bind(serviceInstance);
      this.on('onReady', method);
    }

    const onErrorHandlers = getMetadata(QUEUE_METADATA.ON_ERROR, serviceClass) || [];
    for (const handler of onErrorHandlers) {
      const method = serviceInstance[handler.propertyKey].bind(serviceInstance);
      this.on('onError', method);
    }

    const onMessageFailedHandlers = getMetadata(QUEUE_METADATA.ON_MESSAGE_FAILED, serviceClass) || [];
    for (const handler of onMessageFailedHandlers) {
      const method = serviceInstance[handler.propertyKey].bind(serviceInstance);
      this.on('onMessageFailed', method);
    }

    const onMessageReceivedHandlers = getMetadata(QUEUE_METADATA.ON_MESSAGE_RECEIVED, serviceClass) || [];
    for (const handler of onMessageReceivedHandlers) {
      const method = serviceInstance[handler.propertyKey].bind(serviceInstance);
      this.on('onMessageReceived', method);
    }

    const onMessageProcessedHandlers = getMetadata(QUEUE_METADATA.ON_MESSAGE_PROCESSED, serviceClass) || [];
    for (const handler of onMessageProcessedHandlers) {
      const method = serviceInstance[handler.propertyKey].bind(serviceInstance);
      this.on('onMessageProcessed', method);
    }
  }
}

// ============================================================================
// Effect.js Integration
// ============================================================================

/**
 * Effect.js Tag for queue service
 */
export class QueueServiceTag extends Context.Tag('QueueService')<QueueServiceTag, QueueService>() {}

/**
 * Create Effect.js Layer for queue service
 *
 * @example
 * ```typescript
 * const queueLayer = makeQueueLayer({
 *   adapter: 'memory',
 * });
 *
 * const program = pipe(
 *   QueueServiceTag,
 *   Effect.flatMap(queue => queue.publish('test', { data: 'hello' })),
 *   Effect.provide(queueLayer),
 * );
 * ```
 */
export function makeQueueLayer(config: QueueConfig): Layer.Layer<QueueServiceTag> {
  return Layer.scoped(
    QueueServiceTag,
    Effect.gen(function* () {
      const service = new QueueService(config);

      // Add finalizer for cleanup
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await service.stop();
        }),
      );

      return service;
    }),
  );
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a queue service with the specified configuration
 */
export function createQueueService(config: QueueConfig): QueueService {
  return new QueueService(config);
}

/**
 * Resolve adapter type to adapter class
 */
export function resolveAdapterType(
  adapterType: BuiltInAdapterType | (new (options?: unknown) => QueueAdapter),
): new (options?: unknown) => QueueAdapter {
  if (typeof adapterType === 'function') {
    return adapterType;
  }

  // Built-in adapters will be resolved by the application
  // This is a placeholder that will be replaced with actual adapter classes
  throw new Error(`Unknown adapter type: ${adapterType}. Use adapter class directly.`);
}
