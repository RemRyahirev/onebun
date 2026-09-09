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
  MessageGuard,
  MessageGuardConstructor,
  PublishOptions,
  SubscribeOptions,
  Subscription,
  AddJobOptions,
  UpdateJobOptions,
  ScheduledJobInfo,
  QueueFeature,
  QueueEvents,
  MessageHandler,
  BuiltInAdapterType,
} from './types';
import type { Guard } from '../http-guards/http-guards';
import type { EntrySpanSwitches } from '../trace-scope';
import type { ResolvedInterceptor } from '../types';
import type { Attributes, Tracer } from '@opentelemetry/api';

import { getControllerGuards, getControllerInterceptors } from '../decorators/decorators';
import { getMetadata } from '../decorators/metadata';
import { getGuardBinding } from '../http-guards/guard-binding';
import { composeInterceptors } from '../interceptors/interceptors';
import { inEntrySpan, runWithAppTracer } from '../trace-scope';


import {
  getSubscribeMetadata,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
  getMessageGuards,
  getMessageInterceptors,
  QUEUE_METADATA,
} from './decorators';
import { executeMessageGuards, MessageExecutionContextImpl } from './guards';
import { QueueScheduler } from './scheduler';
import { publisherTraceContext, withTraceMetadata } from './trace-metadata';

// ============================================================================
// Queue Service Class
// ============================================================================

/**
 * Queue Service
 *
 * Provides a unified API for queue operations, handles adapter lifecycle,
 * and integrates with the scheduler for cron/interval/timeout jobs.
 *
 * @see docs:api/queue.md
 */
export class QueueService {
  private adapter: QueueAdapter | null = null;

  /**
   * The owning application's tracer, established around every handler this service invokes.
   *
   * The queue adapters cannot supply it: they are constructed from plain option objects and
   * hold no reference to an application, and the in-memory one has no constructor at all. This
   * service is per-application by construction, and every delivery — a `@Subscribe` handler, a
   * `@Cron`/`@Interval`/`@Timeout` data provider — goes through a closure it builds here, so
   * one place covers all four adapters without changing any adapter signature.
   */
  private ownerTracer: Tracer | undefined = undefined;

  /** `tracing.traceQueueMessages`; turns off the per-delivery span, never the ownership. */
  private traceQueueMessages = true;

  /** `tracing.traceScheduledJobs`, kept so a scheduler created later still learns it. */
  private traceScheduledJobs = true;
  private scheduler: QueueScheduler | null = null;
  private subscriptions: Subscription[] = [];
  private started = false;
  private config: QueueConfig;
  private onReadyHandlers: Array<() => void> = [];
  private adapterOnReadyRegistered = false;

  /**
   * Name the application whose tracer every handler of this service runs under.
   *
   * Set by `OneBunApplication` right after construction, before any handler is registered.
   *
   * @see docs:api/trace.md
   */
  setOwnerTracer(tracer: Tracer | undefined, spans?: EntrySpanSwitches): void {
    this.ownerTracer = tracer;
    this.traceQueueMessages = spans?.queueMessages ?? true;
    this.traceScheduledJobs = spans?.scheduledJobs ?? true;
    this.scheduler?.setOwnerTracer(tracer, this.traceScheduledJobs);
  }

  constructor(config: QueueConfig) {
    this.config = config;
  }

  /**
   * Initialize the queue service with an adapter
   */
  async initialize(adapter: QueueAdapter): Promise<void> {
    this.adapter = adapter;
    this.scheduler = new QueueScheduler(adapter);
    // Ordering-proof: the owner may have been named before this scheduler existed, or after.
    this.scheduler.setOwnerTracer(this.ownerTracer, this.traceScheduledJobs);

    // Guarded exactly as in start(): the application already connects the adapter in
    // initializeQueue(), so an unconditional connect here opens the backend twice per boot.
    if (!adapter.isConnected()) {
      await adapter.connect();
    }
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

    // Register adapter-level onReady listener once for reconnection scenarios
    if (!this.adapterOnReadyRegistered) {
      this.adapter.on('onReady', () => {
        if (this.started) {
          for (const handler of this.onReadyHandlers) {
            handler();
          }
        }
      });
      this.adapterOnReadyRegistered = true;
    }

    if (this.scheduler) {
      this.scheduler.start();
    }

    this.started = true;

    // Call @OnQueueReady handlers — queue is fully ready at this point
    for (const handler of this.onReadyHandlers) {
      handler();
    }
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
    return await this.getAdapter().publish(pattern, data, withTraceMetadata(options));
  }

  /**
   * Publish multiple messages
   */
  async publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>,
  ): Promise<string[]> {
    // Stamped per message, not once for the batch: `publishBatch` takes independent options per
    // entry, and a caller who set an explicit trace id on one of them must keep it.
    return await this.getAdapter().publishBatch(
      messages.map(message => ({ ...message, options: withTraceMetadata(message.options) })),
    );
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
    // Every delivery gets a span, and this is the one place that can give it to every delivery:
    // all four adapters reach a handler through here, and so does an imperative `subscribe()`
    // call that never went through `registerService`. Without a span the handler's log lines
    // carry no trace id at all — `requestContextStore` is entered only for HTTP.
    //
    // `this.ownerTracer` is read per message rather than captured, so naming the owner after a
    // subscription is registered still traces it.
    // Built once per subscription, not once per message: the values are fixed by the pattern.
    const attributes: Attributes = {};
    attributes['messaging.destination.name'] = pattern;
    attributes['messaging.operation'] = 'process';

    const spanName = `queue ${pattern}`;
    const traced: MessageHandler<T> = async (message) => await inEntrySpan(
      spanName,
      async () => await handler(message),
      this.ownerTracer,
      {
        attributes,
        openSpan: this.traceQueueMessages,
        // The delivery hangs off the publish that caused it. Without this every message was an
        // independently sampled root that announced itself as a consumption entry point and
        // pointed at nothing — a trace per message, none of them joined to the work that sent it.
        parent: publisherTraceContext(message.metadata),
      },
    );

    const subscription = await this.getAdapter().subscribe(pattern, traced, options);
    this.subscriptions.push(subscription);

    return subscription;
  }

  // ============================================================================
  // Scheduled Jobs
  // ============================================================================

  /**
   * Add a scheduled job dynamically
   */
  addJob(options: AddJobOptions): void {
    this.getScheduler().addJob(options);
  }

  /**
   * Remove a scheduled job by name
   */
  removeJob(name: string): boolean {
    return this.getScheduler().removeJob(name);
  }

  /**
   * Get information about a specific scheduled job
   */
  getJob(name: string): ScheduledJobInfo | undefined {
    return this.getScheduler().getJob(name);
  }

  /**
   * Get all scheduled jobs
   */
  getJobs(): ScheduledJobInfo[] {
    return this.getScheduler().getJobs();
  }

  /**
   * Check if a scheduled job exists
   */
  hasJob(name: string): boolean {
    return this.getScheduler().hasJob(name);
  }

  /**
   * Pause a scheduled job
   */
  pauseJob(name: string): boolean {
    return this.getScheduler().pauseJob(name);
  }

  /**
   * Resume a paused scheduled job
   */
  resumeJob(name: string): boolean {
    return this.getScheduler().resumeJob(name);
  }

  /**
   * Update a scheduled job's timing configuration
   */
  updateJob(options: UpdateJobOptions): boolean {
    return this.getScheduler().updateJob(options);
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
    resolveInterceptorsFn?: (classes: (Function | import('../types').Interceptor)[]) => ResolvedInterceptor[],
  ): Promise<void> {
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types */
    // Collect class-level interceptors
    const classInterceptors = getControllerInterceptors(serviceClass);

    // Class-level `@UseGuards`, the guard twin of classInterceptors above.
    const classGuards = getControllerGuards(serviceClass);

    // The owner module's DI-aware guard resolver, attached to the instance it built. Absent
    // for a consumer constructed by hand — a unit test calling registerService directly — and
    // then guards fall back to zero-argument construction, which is all they ever got before.
    const guardBinding = getGuardBinding(serviceInstance);
    const logger = guardBinding?.logger;

    // Register subscribe handlers
    const subscriptions = getSubscribeMetadata(serviceClass);
    for (const sub of subscriptions) {
      const method = serviceInstance[sub.propertyKey].bind(serviceInstance) as (
        ...args: unknown[]
      ) => unknown;
      // Resolution happens HERE, at registration, so a guard whose constructor dependency
      // cannot be resolved fails the application at STARTUP with DependencyResolutionError
      // naming it — rather than throwing once per delivered message and dropping each one.
      const declaredGuards = [
        ...classGuards,
        ...getMessageGuards(serviceClass, sub.propertyKey),
      ] as Array<MessageGuard | MessageGuardConstructor>;
      const guards = declaredGuards.length > 0 && guardBinding
        ? (guardBinding.resolve(declaredGuards as unknown as (Function | Guard)[]) as
            unknown as Array<MessageGuard | MessageGuardConstructor>)
        : declaredGuards;

      // Merge interceptors: class-level + method-level, resolve via DI
      const methodInterceptors = getMessageInterceptors(serviceClass, sub.propertyKey);
      const mergedInterceptorClasses = [...classInterceptors, ...methodInterceptors];
      const resolvedInterceptors = mergedInterceptorClasses.length > 0 && resolveInterceptorsFn
        ? resolveInterceptorsFn(mergedInterceptorClasses)
        : [];

      // Wrap handler with guards and interceptors
      const wrappedHandler = async (message: Message) => await runWithAppTracer(this.ownerTracer, async () => {
        if (guards.length > 0) {
          const context = new MessageExecutionContextImpl(
            message,
            sub.pattern,
            method,
            serviceClass,
          );

          const passed = await executeMessageGuards(guards, context, (name, error) => {
            // The framework's own diagnostic. Before this, a guard that threw took the message
            // with it and logged nothing at any level; the only way to see it was to have
            // registered an `onMessageFailed` listener of your own.
            logger?.error(
              `Message guard ${name} threw on "${sub.pattern}" for message ${message.id}, ` +
              `denying: ${error}`,
            );
          });

          if (!passed) {
            // Denied messages are nacked WITHOUT requeue, never quietly swallowed. A guard
            // decision is deterministic, so requeueing would deny the same message forever;
            // `requeue: false` instead terminates it server-side on JetStream and routes it to
            // the dead-letter queue on adapters that have one. Either way the adapter reports
            // `onMessageFailed` rather than `onMessageProcessed`, so a denial is visible to
            // metrics instead of looking like a success.
            logger?.warn(
              `Message guard denied ${serviceClass.name}.${String(sub.propertyKey)} on ` +
              `"${sub.pattern}" for message ${message.id}`,
            );
            await message.nack(false);

            return;
          }
        }

        if (resolvedInterceptors.length > 0) {
          const ctx = new MessageExecutionContextImpl(message, sub.pattern, method, serviceClass);
          await composeInterceptors(resolvedInterceptors, ctx, async () => await method(message))();

          return;
        }

        await method(message);
      });

      await this.subscribe(sub.pattern, wrappedHandler, sub.options);
    }

    // Register cron jobs
    const cronJobs = getCronMetadata(serviceClass);
    for (const cron of cronJobs) {
      // The scheduler invokes this as an opaque data provider from a timer, so the owner
      // is established here rather than in `QueueScheduler`, which holds only the adapter.
      const bound = serviceInstance[cron.propertyKey].bind(serviceInstance);
      const method = async (...args: unknown[]): Promise<unknown> =>
        await runWithAppTracer(this.ownerTracer, async () => await bound(...args));
      this.getScheduler().addCronJob(
        cron.options.name ?? String(cron.propertyKey),
        cron.expression,
        cron.options.pattern,
        method,
        {
          metadata: cron.options.metadata,
          overlapStrategy: cron.options.overlapStrategy,
          declarative: true,
        },
      );
    }

    // Register interval jobs
    const intervalJobs = getIntervalMetadata(serviceClass);
    for (const interval of intervalJobs) {
      // The scheduler invokes this as an opaque data provider from a timer, so the owner
      // is established here rather than in `QueueScheduler`, which holds only the adapter.
      const bound = serviceInstance[interval.propertyKey].bind(serviceInstance);
      const method = async (...args: unknown[]): Promise<unknown> =>
        await runWithAppTracer(this.ownerTracer, async () => await bound(...args));
      this.getScheduler().addIntervalJob(
        interval.options.name ?? String(interval.propertyKey),
        interval.milliseconds,
        interval.options.pattern,
        method,
        { metadata: interval.options.metadata, declarative: true },
      );
    }

    // Register timeout jobs
    const timeoutJobs = getTimeoutMetadata(serviceClass);
    for (const timeout of timeoutJobs) {
      // The scheduler invokes this as an opaque data provider from a timer, so the owner
      // is established here rather than in `QueueScheduler`, which holds only the adapter.
      const bound = serviceInstance[timeout.propertyKey].bind(serviceInstance);
      const method = async (...args: unknown[]): Promise<unknown> =>
        await runWithAppTracer(this.ownerTracer, async () => await bound(...args));
      this.getScheduler().addTimeoutJob(
        timeout.options.name ?? String(timeout.propertyKey),
        timeout.milliseconds,
        timeout.options.pattern,
        method,
        { metadata: timeout.options.metadata, declarative: true },
      );
    }

    // Register lifecycle handlers
    const onReadyHandlers = getMetadata(QUEUE_METADATA.ON_READY, serviceClass) || [];
    for (const handler of onReadyHandlers) {
      const method = serviceInstance[handler.propertyKey].bind(serviceInstance);
      this.onReadyHandlers.push(method);
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
