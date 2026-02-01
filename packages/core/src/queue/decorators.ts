/**
 * Queue Decorators
 *
 * Unified decorators for queue message handling and scheduling.
 * These decorators work with any queue adapter (memory, redis, nats, jetstream).
 */

import type {
  SubscribeOptions,
  CronDecoratorOptions,
  IntervalDecoratorOptions,
  TimeoutDecoratorOptions,
  MessageGuard,
  MessageGuardConstructor,
} from './types';

import { defineMetadata, getMetadata } from '../decorators/metadata';

// ============================================================================
// Metadata Keys
// ============================================================================

export const QUEUE_METADATA = {
  SUBSCRIBE: 'queue:subscribe',
  SUBSCRIBE_OPTIONS: 'queue:subscribe:options',
  CRON: 'queue:cron',
  INTERVAL: 'queue:interval',
  TIMEOUT: 'queue:timeout',
  GUARDS: 'queue:guards',
  ON_READY: 'queue:on_ready',
  ON_ERROR: 'queue:on_error',
  ON_MESSAGE_FAILED: 'queue:on_message_failed',
  ON_MESSAGE_RECEIVED: 'queue:on_message_received',
  ON_MESSAGE_PROCESSED: 'queue:on_message_processed',
} as const;

// ============================================================================
// Subscribe Decorator
// ============================================================================

/**
 * Subscribe handler metadata
 */
export interface SubscribeMetadata {
  pattern: string;
  options?: SubscribeOptions;
  propertyKey: string | symbol;
}

/**
 * Decorator for subscribing to queue messages
 *
 * @param pattern - Message pattern to subscribe to (supports wildcards)
 * @param options - Subscription options
 *
 * @example
 * ```typescript
 * // Simple subscription with auto-ack
 * \@Subscribe('orders.created')
 * async handleOrderCreated(message: Message<OrderData>) {
 *   await this.processOrder(message.data);
 * }
 *
 * // Subscription with manual ack
 * \@Subscribe('orders.*', { ackMode: 'manual', group: 'order-processors' })
 * async handleOrder(message: Message<OrderData>) {
 *   try {
 *     await this.processOrder(message.data);
 *     await message.ack();
 *   } catch (error) {
 *     await message.nack(true); // requeue
 *   }
 * }
 *
 * // Multi-level wildcard
 * \@Subscribe('events.#')
 * async handleAllEvents(message: Message<EventData>) {
 *   console.log('Event:', message.pattern, message.data);
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Subscribe(pattern: string, options?: SubscribeOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    // Get existing subscriptions or create new array
    const subscriptions: SubscribeMetadata[] =
      getMetadata(QUEUE_METADATA.SUBSCRIBE, target.constructor) || [];

    // Add this subscription
    subscriptions.push({
      pattern,
      options,
      propertyKey,
    });

    // Store metadata
    defineMetadata(QUEUE_METADATA.SUBSCRIBE, subscriptions, target.constructor);

    return descriptor;
  };
}

// ============================================================================
// Scheduling Decorators
// ============================================================================

/**
 * Cron job metadata
 */
export interface CronMetadata {
  expression: string;
  options: CronDecoratorOptions;
  propertyKey: string | symbol;
}

/**
 * Decorator for cron-based scheduled jobs
 *
 * The decorated method should return the data to be published.
 *
 * @param expression - Cron expression (5 or 6 fields)
 * @param options - Cron options including the pattern to publish to
 *
 * @example
 * ```typescript
 * import { CronExpression } from '\@onebun/core';
 *
 * // Daily report at 9 AM
 * \@Cron('0 0 9 * * *', { pattern: 'reports.daily' })
 * getDailyReportData(): ReportData {
 *   return { type: 'daily', date: new Date() };
 * }
 *
 * // Using CronExpression enum
 * \@Cron(CronExpression.EVERY_HOUR, { pattern: 'health.check' })
 * getHealthData(): HealthData {
 *   return { status: 'ok', timestamp: Date.now() };
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Cron(expression: string, options: CronDecoratorOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const cronJobs: CronMetadata[] = getMetadata(QUEUE_METADATA.CRON, target.constructor) || [];

    cronJobs.push({
      expression,
      options: {
        ...options,
        name: options.name ?? String(propertyKey),
      },
      propertyKey,
    });

    defineMetadata(QUEUE_METADATA.CRON, cronJobs, target.constructor);

    return descriptor;
  };
}

/**
 * Interval job metadata
 */
export interface IntervalMetadata {
  milliseconds: number;
  options: IntervalDecoratorOptions;
  propertyKey: string | symbol;
}

/**
 * Decorator for interval-based scheduled jobs
 *
 * The decorated method should return the data to be published.
 *
 * @param milliseconds - Interval in milliseconds
 * @param options - Interval options including the pattern to publish to
 *
 * @example
 * ```typescript
 * // Every minute
 * \@Interval(60000, { pattern: 'health.check' })
 * getHealthData(): HealthData {
 *   return { timestamp: Date.now() };
 * }
 *
 * // Every 5 seconds
 * \@Interval(5000, { pattern: 'metrics.collect' })
 * getMetrics(): MetricsData {
 *   return { cpu: process.cpuUsage(), memory: process.memoryUsage() };
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Interval(milliseconds: number, options: IntervalDecoratorOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const intervals: IntervalMetadata[] =
      getMetadata(QUEUE_METADATA.INTERVAL, target.constructor) || [];

    intervals.push({
      milliseconds,
      options: {
        ...options,
        name: options.name ?? String(propertyKey),
      },
      propertyKey,
    });

    defineMetadata(QUEUE_METADATA.INTERVAL, intervals, target.constructor);

    return descriptor;
  };
}

/**
 * Timeout job metadata
 */
export interface TimeoutMetadata {
  milliseconds: number;
  options: TimeoutDecoratorOptions;
  propertyKey: string | symbol;
}

/**
 * Decorator for one-time delayed jobs
 *
 * The decorated method should return the data to be published.
 *
 * @param milliseconds - Delay in milliseconds after application start
 * @param options - Timeout options including the pattern to publish to
 *
 * @example
 * ```typescript
 * // Publish init complete after 5 seconds
 * \@Timeout(5000, { pattern: 'init.complete' })
 * getInitData(): InitData {
 *   return { startedAt: this.startTime };
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function Timeout(milliseconds: number, options: TimeoutDecoratorOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const timeouts: TimeoutMetadata[] =
      getMetadata(QUEUE_METADATA.TIMEOUT, target.constructor) || [];

    timeouts.push({
      milliseconds,
      options: {
        ...options,
        name: options.name ?? String(propertyKey),
      },
      propertyKey,
    });

    defineMetadata(QUEUE_METADATA.TIMEOUT, timeouts, target.constructor);

    return descriptor;
  };
}

// ============================================================================
// Guard Decorator
// ============================================================================

/**
 * Decorator for applying guards to message handlers
 *
 * @param guards - Guards to apply (can be guard instances or constructors)
 *
 * @example
 * ```typescript
 * @UseMessageGuards(MessageAuthGuard)
 * @Subscribe('orders.*')
 * async handleOrder(message: Message<OrderData>) {
 *   // Only messages with authorization token will be processed
 * }
 *
 * @UseMessageGuards(MessageAuthGuard, new MessageServiceGuard(['payment-service']))
 * @Subscribe('payments.*')
 * async handlePayment(message: Message<PaymentData>) {
 *   // Requires both auth and service check
 * }
 * ```
 */
export function UseMessageGuards(
  ...guards: Array<MessageGuard | MessageGuardConstructor>
): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    defineMetadata(QUEUE_METADATA.GUARDS, guards, target.constructor, propertyKey);

    return descriptor;
  };
}

// ============================================================================
// Lifecycle Decorators
// ============================================================================

/**
 * Lifecycle handler metadata
 */
export interface LifecycleMetadata {
  propertyKey: string | symbol;
}

/**
 * Decorator for handling queue ready events
 *
 * @example
 * ```typescript
 * \@OnQueueReady()
 * handleReady() {
 *   console.log('Queue connected and ready');
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function OnQueueReady(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const handlers: LifecycleMetadata[] =
      getMetadata(QUEUE_METADATA.ON_READY, target.constructor) || [];

    handlers.push({ propertyKey });

    defineMetadata(QUEUE_METADATA.ON_READY, handlers, target.constructor);

    return descriptor;
  };
}

/**
 * Decorator for handling queue error events
 *
 * @example
 * ```typescript
 * \@OnQueueError()
 * handleError(error: Error) {
 *   console.error('Queue error:', error);
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function OnQueueError(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const handlers: LifecycleMetadata[] =
      getMetadata(QUEUE_METADATA.ON_ERROR, target.constructor) || [];

    handlers.push({ propertyKey });

    defineMetadata(QUEUE_METADATA.ON_ERROR, handlers, target.constructor);

    return descriptor;
  };
}

/**
 * Decorator for handling message failure events
 *
 * @example
 * ```typescript
 * \@OnMessageFailed()
 * handleFailed(message: Message, error: Error) {
 *   console.error(`Message ${message.id} failed:`, error);
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function OnMessageFailed(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const handlers: LifecycleMetadata[] =
      getMetadata(QUEUE_METADATA.ON_MESSAGE_FAILED, target.constructor) || [];

    handlers.push({ propertyKey });

    defineMetadata(QUEUE_METADATA.ON_MESSAGE_FAILED, handlers, target.constructor);

    return descriptor;
  };
}

/**
 * Decorator for handling message received events
 *
 * @example
 * ```typescript
 * \@OnMessageReceived()
 * handleReceived(message: Message) {
 *   console.log(`Message received: ${message.id}`);
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function OnMessageReceived(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const handlers: LifecycleMetadata[] =
      getMetadata(QUEUE_METADATA.ON_MESSAGE_RECEIVED, target.constructor) || [];

    handlers.push({ propertyKey });

    defineMetadata(QUEUE_METADATA.ON_MESSAGE_RECEIVED, handlers, target.constructor);

    return descriptor;
  };
}

/**
 * Decorator for handling message processed events
 *
 * @example
 * ```typescript
 * \@OnMessageProcessed()
 * handleProcessed(message: Message) {
 *   console.log(`Message processed: ${message.id}`);
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function OnMessageProcessed(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const handlers: LifecycleMetadata[] =
      getMetadata(QUEUE_METADATA.ON_MESSAGE_PROCESSED, target.constructor) || [];

    handlers.push({ propertyKey });

    defineMetadata(QUEUE_METADATA.ON_MESSAGE_PROCESSED, handlers, target.constructor);

    return descriptor;
  };
}

// ============================================================================
// Metadata Helpers
// ============================================================================

/**
 * Get all subscribe metadata for a class
 */
export function getSubscribeMetadata(target: object): SubscribeMetadata[] {
  return getMetadata(QUEUE_METADATA.SUBSCRIBE, target) || [];
}

/**
 * Get all cron metadata for a class
 */
export function getCronMetadata(target: object): CronMetadata[] {
  return getMetadata(QUEUE_METADATA.CRON, target) || [];
}

/**
 * Get all interval metadata for a class
 */
export function getIntervalMetadata(target: object): IntervalMetadata[] {
  return getMetadata(QUEUE_METADATA.INTERVAL, target) || [];
}

/**
 * Get all timeout metadata for a class
 */
export function getTimeoutMetadata(target: object): TimeoutMetadata[] {
  return getMetadata(QUEUE_METADATA.TIMEOUT, target) || [];
}

/**
 * Get guards for a method
 */
export function getMessageGuards(
  target: object,
  propertyKey: string | symbol,
): Array<MessageGuard | MessageGuardConstructor> {
  return getMetadata(QUEUE_METADATA.GUARDS, target, propertyKey) || [];
}

/**
 * Get lifecycle handlers for a class
 */
export function getLifecycleHandlers(
  target: object,
  event: keyof typeof QUEUE_METADATA,
): LifecycleMetadata[] {
  return getMetadata(QUEUE_METADATA[event], target) || [];
}

/**
 * Check if a class has any queue decorators
 */
export function hasQueueDecorators(target: object): boolean {
  return (
    getSubscribeMetadata(target).length > 0 ||
    getCronMetadata(target).length > 0 ||
    getIntervalMetadata(target).length > 0 ||
    getTimeoutMetadata(target).length > 0
  );
}
