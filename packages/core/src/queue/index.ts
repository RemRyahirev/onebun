/**
 * Queue Module
 *
 * Unified queue system for OneBun.
 * Supports multiple backends: memory, redis, nats, jetstream.
 */

// Types
export type {
  AckMode,
  MessageMetadata,
  Message,
  PublishOptions,
  RetryOptions,
  DeadLetterOptions,
  SubscribeOptions,
  QueueEvents,
  Subscription,
  OverlapStrategy,
  ScheduledJobOptions,
  ScheduledJobInfo,
  QueueFeature,
  QueueAdapterType,
  MessageHandler,
  QueueAdapter,
  BuiltInAdapterType,
  QueueAdapterConstructor,
  QueueConfig,
  SubscribeDecoratorOptions,
  CronDecoratorOptions,
  IntervalDecoratorOptions,
  TimeoutDecoratorOptions,
  MessageExecutionContext,
  MessageGuard,
  MessageGuardConstructor,
} from './types';

// Cron Parser
export {
  parseCronExpression,
  getNextRun,
  getNextRuns,
  getMillisecondsUntilNextRun,
  isValidCronExpression,
  type CronSchedule,
} from './cron-parser';

// Cron Expression
export { CronExpression, type CronExpressionValue } from './cron-expression';

// Pattern Matcher
export {
  parseQueuePattern,
  matchQueuePattern,
  isQueuePatternMatch,
  createQueuePatternMatcher,
  isQueuePattern,
  getQueuePatternParams,
  buildFromQueuePattern,
  findMatchingTopics,
  type QueuePatternMatch,
} from './pattern-matcher';

// Guards
export {
  MessageExecutionContextImpl,
  MessageAuthGuard,
  MessageServiceGuard,
  MessageHeaderGuard,
  MessageTraceGuard,
  MessageAllGuards,
  MessageAnyGuard,
  executeMessageGuards,
  createMessageGuard,
} from './guards';

// Decorators
export {
  Subscribe,
  Cron,
  Interval,
  Timeout,
  UseMessageGuards,
  OnQueueReady,
  OnQueueError,
  OnMessageFailed,
  OnMessageReceived,
  OnMessageProcessed,
  // Metadata helpers
  getSubscribeMetadata,
  getCronMetadata,
  getIntervalMetadata,
  getTimeoutMetadata,
  getMessageGuards,
  getLifecycleHandlers,
  hasQueueDecorators,
  QUEUE_METADATA,
  type SubscribeMetadata,
  type CronMetadata,
  type IntervalMetadata,
  type TimeoutMetadata,
  type LifecycleMetadata,
} from './decorators';

// Scheduler
export { QueueScheduler, createQueueScheduler } from './scheduler';

// Queue Service
export {
  QueueService,
  QueueServiceTag,
  makeQueueLayer,
  createQueueService,
  resolveAdapterType,
} from './queue.service';

// Adapters (re-export from adapters folder)
export * from './adapters';
