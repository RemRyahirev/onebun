/**
 * Unified Queue System Types
 *
 * Common types and interfaces for all queue adapters (memory, redis, nats, jetstream).
 */

// ============================================================================
// Ack Modes
// ============================================================================

/**
 * Message acknowledgment mode
 * - 'auto': Message is automatically acknowledged after successful handler execution
 * - 'manual': Handler must call message.ack() or message.nack() explicitly
 */
export type AckMode = 'auto' | 'manual';

// ============================================================================
// Message Types
// ============================================================================

/**
 * Message metadata for inter-service communication, guards, and authorization
 */
export interface MessageMetadata {
  /** Custom headers */
  headers?: Record<string, string>;

  /** Authorization token (e.g., "Bearer xxx") */
  authorization?: string;

  /** ID of the calling service */
  serviceId?: string;

  /** Trace ID for distributed tracing (integration with @onebun/trace) */
  traceId?: string;

  /** Span ID for distributed tracing */
  spanId?: string;

  /** Parent span ID for distributed tracing */
  parentSpanId?: string;

  /** Additional data (for guards and custom logic) */
  [key: string]: unknown;
}

/**
 * Queue message interface
 */
export interface Message<T = unknown> {
  /** Unique message ID */
  id: string;

  /** Message pattern/topic */
  pattern: string;

  /** Message payload */
  data: T;

  /** Message timestamp (ms since epoch) */
  timestamp: number;

  /** Whether this message was redelivered */
  redelivered?: boolean;

  /** Message metadata for inter-service communication */
  metadata: MessageMetadata;

  /** Current attempt number (for retries) */
  attempt?: number;

  /** Maximum attempts allowed */
  maxAttempts?: number;

  /**
   * Acknowledge the message (for manual ack mode)
   */
  ack(): Promise<void>;

  /**
   * Negative acknowledge the message (for manual ack mode)
   * @param requeue - Whether to requeue the message for reprocessing
   */
  nack(requeue?: boolean): Promise<void>;
}

// ============================================================================
// Publish Options
// ============================================================================

/**
 * Options for publishing messages
 */
export interface PublishOptions {
  /** Delay before the message is delivered (ms) */
  delay?: number;

  /** Message priority (higher = more important) */
  priority?: number;

  /** Custom message ID */
  messageId?: string;

  /** Metadata for inter-service communication */
  metadata?: Partial<MessageMetadata>;

  /** Repeat options for scheduled jobs */
  repeat?: {
    /** Cron expression */
    pattern?: string;
    /** Interval in milliseconds */
    every?: number;
    /** Maximum number of repetitions */
    limit?: number;
    /** End date for repetitions */
    endDate?: Date;
  };
}

// ============================================================================
// Subscribe Options
// ============================================================================

/**
 * Retry configuration
 */
export interface RetryOptions {
  /** Maximum number of attempts */
  attempts?: number;
  /** Backoff strategy */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** Base delay in milliseconds */
  delay?: number;
}

/**
 * Dead Letter Queue configuration
 */
export interface DeadLetterOptions {
  /** Queue name for dead letters */
  queue: string;
  /** Maximum retries before sending to DLQ */
  maxRetries?: number;
}

/**
 * Options for subscribing to messages
 */
export interface SubscribeOptions {
  /** Acknowledgment mode ('auto' by default) */
  ackMode?: AckMode;

  /** Number of messages to process in parallel */
  prefetch?: number;

  /** Consumer group (for load balancing between instances) */
  group?: string;

  /** Retry settings (optional extension) */
  retry?: RetryOptions;

  /** Dead Letter Queue settings (optional extension) */
  deadLetter?: DeadLetterOptions;
}

// ============================================================================
// Lifecycle Events
// ============================================================================

/**
 * Queue lifecycle events
 */
export interface QueueEvents {
  /** Called when the queue adapter is ready */
  onReady?: () => void;

  /** Called when an error occurs */
  onError?: (error: Error) => void;

  /** Called when a message is received */
  onMessageReceived?: (message: Message) => void;

  /** Called when a message is processed successfully */
  onMessageProcessed?: (message: Message) => void;

  /** Called when message processing fails */
  onMessageFailed?: (message: Message, error: Error) => void;
}

// ============================================================================
// Subscription
// ============================================================================

/**
 * Subscription handle returned by subscribe()
 */
export interface Subscription {
  /** Unsubscribe from the pattern */
  unsubscribe(): Promise<void>;

  /** Pause receiving messages */
  pause(): void;

  /** Resume receiving messages */
  resume(): void;

  /** The pattern this subscription is for */
  readonly pattern: string;

  /** Whether the subscription is active */
  readonly isActive: boolean;
}

// ============================================================================
// Scheduled Jobs
// ============================================================================

/**
 * Overlap strategy for scheduled jobs
 * - 'skip': Skip execution if previous job is still running
 * - 'queue': Queue as a regular message even if previous is running
 */
export type OverlapStrategy = 'skip' | 'queue';

/**
 * Options for scheduled jobs
 */
export interface ScheduledJobOptions {
  /** Pattern to publish to */
  pattern: string;

  /** Data to include in the message */
  data?: unknown;

  /** Schedule configuration */
  schedule: {
    /** Cron expression */
    cron?: string;
    /** Interval in milliseconds */
    every?: number;
  };

  /** Metadata to include in messages */
  metadata?: Partial<MessageMetadata>;

  /** What to do if previous job is still running */
  overlapStrategy?: OverlapStrategy;
}

/**
 * Information about a scheduled job
 */
export interface ScheduledJobInfo {
  /** Job name */
  name: string;

  /** Pattern to publish to */
  pattern: string;

  /** Schedule configuration */
  schedule: {
    cron?: string;
    every?: number;
  };

  /** Next scheduled run time */
  nextRun?: Date;

  /** Last run time */
  lastRun?: Date;

  /** Whether the job is currently running */
  isRunning?: boolean;
}

// ============================================================================
// Queue Features
// ============================================================================

/**
 * Features that queue adapters may support
 */
export type QueueFeature =
  | 'delayed-messages'
  | 'priority'
  | 'dead-letter-queue'
  | 'retry'
  | 'scheduled-jobs'
  | 'consumer-groups'
  | 'pattern-subscriptions';

// ============================================================================
// Queue Adapter Interface
// ============================================================================

/**
 * Queue adapter type
 */
export type QueueAdapterType = 'memory' | 'redis' | 'nats' | 'jetstream';

/**
 * Message handler function
 */
export type MessageHandler<T = unknown> = (message: Message<T>) => Promise<void>;

/**
 * Unified Queue Adapter interface
 *
 * All queue backends (memory, redis, nats, jetstream) implement this interface.
 * Configuration differs, but the API remains the same.
 */
export interface QueueAdapter {
  /** Adapter name */
  readonly name: string;

  /** Adapter type */
  readonly type: QueueAdapterType;

  // Lifecycle
  /** Connect to the queue backend */
  connect(): Promise<void>;

  /** Disconnect from the queue backend */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  // Publishing
  /**
   * Publish a message to a pattern
   * @returns Message ID
   */
  publish<T>(pattern: string, data: T, options?: PublishOptions): Promise<string>;

  /**
   * Publish multiple messages in a batch
   * @returns Array of message IDs
   */
  publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>
  ): Promise<string[]>;

  // Subscribing
  /**
   * Subscribe to messages matching a pattern
   * Supports wildcards: 'orders.*', 'events.user.#'
   */
  subscribe<T>(
    pattern: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions
  ): Promise<Subscription>;

  // Scheduled Jobs
  /** Add a scheduled job */
  addScheduledJob(name: string, options: ScheduledJobOptions): Promise<void>;

  /** Remove a scheduled job */
  removeScheduledJob(name: string): Promise<boolean>;

  /** Get all scheduled jobs */
  getScheduledJobs(): Promise<ScheduledJobInfo[]>;

  // Feature Support
  /** Check if a feature is supported by this adapter */
  supports(feature: QueueFeature): boolean;

  // Events
  /** Register an event handler */
  on<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void;

  /** Unregister an event handler */
  off<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void;
}

// ============================================================================
// Queue Configuration
// ============================================================================

/**
 * Built-in adapter types
 */
export type BuiltInAdapterType = 'memory' | 'redis';

/**
 * Queue adapter constructor
 */
export interface QueueAdapterConstructor {
  new (options?: unknown): QueueAdapter;
}

/**
 * Queue configuration options
 */
export interface QueueConfig {
  /** Adapter type or custom adapter class */
  adapter: BuiltInAdapterType | QueueAdapterConstructor;

  /** Adapter-specific options */
  options?: Record<string, unknown>;
}

// ============================================================================
// Decorator Metadata Types
// ============================================================================

/**
 * Subscribe decorator options
 */
export interface SubscribeDecoratorOptions extends SubscribeOptions {
  /** Pattern is required and comes from decorator argument */
}

/**
 * Cron decorator options
 */
export interface CronDecoratorOptions {
  /** Pattern to publish to when cron triggers */
  pattern: string;

  /** Metadata to include in messages */
  metadata?: Partial<MessageMetadata>;

  /** Job name (defaults to method name) */
  name?: string;

  /** Overlap strategy */
  overlapStrategy?: OverlapStrategy;
}

/**
 * Interval decorator options
 */
export interface IntervalDecoratorOptions {
  /** Pattern to publish to when interval triggers */
  pattern: string;

  /** Metadata to include in messages */
  metadata?: Partial<MessageMetadata>;

  /** Job name (defaults to method name) */
  name?: string;
}

/**
 * Timeout decorator options
 */
export interface TimeoutDecoratorOptions {
  /** Pattern to publish to when timeout fires */
  pattern: string;

  /** Metadata to include in messages */
  metadata?: Partial<MessageMetadata>;

  /** Job name (defaults to method name) */
  name?: string;
}

// ============================================================================
// Guard Types
// ============================================================================

/**
 * Message execution context for guards
 */
export interface MessageExecutionContext {
  /** Get the message */
  getMessage<T>(): Message<T>;

  /** Get message metadata */
  getMetadata(): MessageMetadata;

  /** Get the pattern */
  getPattern(): string;

  /** Get the handler function */
  getHandler(): (...args: unknown[]) => unknown;

  /** Get the class containing the handler */
  getClass(): new (...args: unknown[]) => unknown;
}

/** Handler function type alias */
export type HandlerFunction = (...args: unknown[]) => unknown;

/**
 * Message guard interface
 */
export interface MessageGuard {
  /**
   * Determine if the message should be processed
   * @returns true to allow processing, false to reject
   */
  canActivate(context: MessageExecutionContext): boolean | Promise<boolean>;
}

/**
 * Guard constructor type
 */
export type MessageGuardConstructor = new (...args: unknown[]) => MessageGuard;
