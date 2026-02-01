/**
 * Redis Queue Adapter
 *
 * Queue adapter using Redis for distributed message queuing.
 * Uses SharedRedisProvider by default (like cache and websocket).
 *
 * Features:
 * - Pub/Sub for real-time message delivery
 * - Lists for persistent queues
 * - Sorted sets for delayed messages and priority queues
 * - Consumer groups for load balancing
 */

import type {
  QueueAdapter,
  QueueAdapterType,
  QueueFeature,
  QueueEvents,
  Message,
  MessageMetadata,
  PublishOptions,
  SubscribeOptions,
  Subscription,
  ScheduledJobOptions,
  ScheduledJobInfo,
  MessageHandler,
} from '../types';

import { RedisClient } from '../../redis/redis-client';
import { SharedRedisProvider } from '../../redis/shared-redis';
import { createQueuePatternMatcher, type QueuePatternMatch } from '../pattern-matcher';
import { QueueScheduler } from '../scheduler';

// ============================================================================
// Types
// ============================================================================

/**
 * Redis queue adapter options
 */
export interface RedisQueueOptions {
  /** Use shared Redis client (default: true) */
  useSharedClient?: boolean;

  /** Redis URL (only used if useSharedClient is false) */
  url?: string;

  /** Key prefix for all queue operations */
  keyPrefix?: string;

  /** Poll interval for delayed messages (ms, default: 100) */
  pollInterval?: number;
}

interface RedisSubscriptionEntry {
  pattern: string;
  handler: MessageHandler;
  options?: SubscribeOptions;
  matcher: (topic: string) => QueuePatternMatch;
  paused: boolean;
  consumerGroup?: string;
}

// ============================================================================
// Redis Message Implementation
// ============================================================================

/**
 * Redis message implementation
 */
class RedisMessage<T> implements Message<T> {
  id: string;
  pattern: string;
  data: T;
  timestamp: number;
  redelivered: boolean;
  metadata: MessageMetadata;
  attempt?: number;
  maxAttempts?: number;

  private acked = false;
  private nacked = false;
  private onAck?: () => Promise<void>;
  private onNack?: (requeue: boolean) => Promise<void>;

  constructor(
    id: string,
    pattern: string,
    data: T,
    timestamp: number,
    metadata: MessageMetadata,
    options?: {
      redelivered?: boolean;
      attempt?: number;
      maxAttempts?: number;
      onAck?: () => Promise<void>;
      onNack?: (requeue: boolean) => Promise<void>;
    },
  ) {
    this.id = id;
    this.pattern = pattern;
    this.data = data;
    this.timestamp = timestamp;
    this.metadata = metadata;
    this.redelivered = options?.redelivered ?? false;
    this.attempt = options?.attempt;
    this.maxAttempts = options?.maxAttempts;
    this.onAck = options?.onAck;
    this.onNack = options?.onNack;
  }

  async ack(): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.acked = true;
    await this.onAck?.();
  }

  async nack(requeue = false): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.nacked = true;
    await this.onNack?.(requeue);
  }
}

// ============================================================================
// Redis Subscription Implementation
// ============================================================================

class RedisSubscription implements Subscription {
  private active = true;

  constructor(
    private readonly entry: RedisSubscriptionEntry,
    private readonly onUnsubscribe: () => Promise<void>,
  ) {}

  async unsubscribe(): Promise<void> {
    this.active = false;
    await this.onUnsubscribe();
  }

  pause(): void {
    this.entry.paused = true;
  }

  resume(): void {
    this.entry.paused = false;
  }

  get pattern(): string {
    return this.entry.pattern;
  }

  get isActive(): boolean {
    return this.active && !this.entry.paused;
  }
}

// ============================================================================
// Redis Queue Adapter
// ============================================================================

/**
 * Redis Queue Adapter
 *
 * Uses SharedRedisProvider by default for connection sharing
 * with cache and websocket modules.
 *
 * @example
 * ```typescript
 * // Using shared client (default)
 * const adapter = new RedisQueueAdapter();
 * await adapter.connect();
 *
 * // Using custom connection
 * const adapter = new RedisQueueAdapter({
 *   useSharedClient: false,
 *   url: 'redis://localhost:6379',
 *   keyPrefix: 'myapp:queue:',
 * });
 * await adapter.connect();
 * ```
 */
export class RedisQueueAdapter implements QueueAdapter {
  readonly name = 'redis';
  readonly type: QueueAdapterType = 'redis';

  private client: RedisClient | null = null;
  private ownsClient = false;
  private connected = false;
  private scheduler: QueueScheduler | null = null;
  private subscriptions: RedisSubscriptionEntry[] = [];
  private messageIdCounter = 0;
  private running = false;
  private delayedInterval?: ReturnType<typeof setInterval>;

  // Key prefixes
  private keys = {
    delayed: 'queue:delayed',
    priority: 'queue:priority',
    queue: (pattern: string) => `queue:q:${pattern}`,
    channel: (pattern: string) => `queue:ch:${pattern}`,
    processing: (group: string) => `queue:processing:${group}`,
    deadLetter: (pattern: string) => `queue:dlq:${pattern}`,
  };

  // Event handlers
  private eventHandlers: Map<keyof QueueEvents, Set<(...args: unknown[]) => void>> = new Map();

  private readonly options: Required<RedisQueueOptions>;

  constructor(options: RedisQueueOptions = {}) {
    this.options = {
      useSharedClient: options.useSharedClient ?? true,
      url: options.url ?? '',
      keyPrefix: options.keyPrefix ?? 'onebun:',
      pollInterval: options.pollInterval ?? 100,
    };

    // Update key prefixes
    const prefix = this.options.keyPrefix;
    this.keys = {
      delayed: `${prefix}queue:delayed`,
      priority: `${prefix}queue:priority`,
      queue: (pattern: string) => `${prefix}queue:q:${pattern}`,
      channel: (pattern: string) => `${prefix}queue:ch:${pattern}`,
      processing: (group: string) => `${prefix}queue:processing:${group}`,
      deadLetter: (pattern: string) => `${prefix}queue:dlq:${pattern}`,
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      if (this.options.useSharedClient) {
        // Use shared client (default)
        this.client = await SharedRedisProvider.getClient();
        this.ownsClient = false;
      } else {
        // Create own client
        if (!this.options.url) {
          throw new Error('Redis URL is required when not using shared client');
        }
        this.client = SharedRedisProvider.createClient({
          url: this.options.url,
          keyPrefix: '', // We handle prefix ourselves
        });
        await this.client.connect();
        this.ownsClient = true;
      }

      this.connected = true;
      this.running = true;
      this.scheduler = new QueueScheduler(this);

      // Start delayed message processor
      this.startDelayedProcessor();

      // Emit ready event
      this.emit('onReady');
    } catch (error) {
      this.emit('onError', error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.running = false;

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }

    // Stop delayed processor
    if (this.delayedInterval) {
      clearInterval(this.delayedInterval);
      this.delayedInterval = undefined;
    }

    // Clear subscriptions
    this.subscriptions = [];

    // Disconnect client only if we own it
    if (this.ownsClient && this.client) {
      await this.client.disconnect();
    }

    this.client = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && (this.client?.isConnected() ?? false);
  }

  // ============================================================================
  // Publishing
  // ============================================================================

  async publish<T>(pattern: string, data: T, options?: PublishOptions): Promise<string> {
    this.ensureConnected();

    const messageId = options?.messageId ?? this.generateMessageId();
    const timestamp = Date.now();

    const messageData = {
      id: messageId,
      pattern,
      data,
      timestamp,
      metadata: options?.metadata ?? {},
    };

    const serialized = JSON.stringify(messageData);

    if (options?.delay && options.delay > 0) {
      // Delayed message - use sorted set
      const score = timestamp + options.delay;
      await this.client!.raw('ZADD', this.keys.delayed, String(score), serialized);
    } else if (options?.priority && options.priority > 0) {
      // Priority message - use sorted set with negative priority (higher = more important)
      await this.client!.raw('ZADD', this.keys.priority, String(-options.priority), serialized);
    } else {
      // Normal message - push to list and publish to channel
      await this.client!.raw('RPUSH', this.keys.queue(pattern), serialized);
      await this.client!.publish(this.keys.channel(pattern), serialized);
    }

    return messageId;
  }

  async publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>,
  ): Promise<string[]> {
    const ids: string[] = [];

    for (const msg of messages) {
      const id = await this.publish(msg.pattern, msg.data, msg.options);
      ids.push(id);
    }

    return ids;
  }

  // ============================================================================
  // Subscribing
  // ============================================================================

  async subscribe<T>(
    pattern: string,
    handler: MessageHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    this.ensureConnected();

    const entry: RedisSubscriptionEntry = {
      pattern,
      handler: handler as MessageHandler,
      options,
      matcher: createQueuePatternMatcher(pattern),
      paused: false,
      consumerGroup: options?.group,
    };

    this.subscriptions.push(entry);

    // Subscribe to Redis pub/sub channel
    await this.client!.subscribe(this.keys.channel(pattern), (message) => {
      if (entry.paused) {
        return;
      }

      try {
        const parsed = JSON.parse(message);
        this.processMessage(entry, parsed);
      } catch {
        // Silently ignore message parsing errors
      }
    });

    // Also start polling the queue for messages that were published before subscription
    this.startQueuePolling(entry);

    const subscription = new RedisSubscription(entry, async () => {
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
      await this.client!.unsubscribe(this.keys.channel(pattern));
    });

    return subscription;
  }

  // ============================================================================
  // Scheduled Jobs
  // ============================================================================

  async addScheduledJob(name: string, options: ScheduledJobOptions): Promise<void> {
    this.ensureConnected();

    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }

    if (options.schedule.cron) {
      this.scheduler.addCronJob(name, options.schedule.cron, options.pattern, () => options.data, {
        metadata: options.metadata,
        overlapStrategy: options.overlapStrategy,
      });
    } else if (options.schedule.every) {
      this.scheduler.addIntervalJob(name, options.schedule.every, options.pattern, () => options.data, {
        metadata: options.metadata,
      });
    }
  }

  async removeScheduledJob(name: string): Promise<boolean> {
    if (!this.scheduler) {
      return false;
    }

    return this.scheduler.removeJob(name);
  }

  async getScheduledJobs(): Promise<ScheduledJobInfo[]> {
    if (!this.scheduler) {
      return [];
    }

    return this.scheduler.getJobs();
  }

  // ============================================================================
  // Features
  // ============================================================================

  supports(_feature: QueueFeature): boolean {
    // Redis supports all features
    return true;
  }

  // ============================================================================
  // Events
  // ============================================================================

  on<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as (...args: unknown[]) => void);
  }

  off<E extends keyof QueueEvents>(event: E, handler: NonNullable<QueueEvents[E]>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as (...args: unknown[]) => void);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error('RedisQueueAdapter not connected. Call connect() first.');
    }
  }

  private generateMessageId(): string {
    // eslint-disable-next-line no-magic-numbers
    return `msg-${++this.messageIdCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private emit<E extends keyof QueueEvents>(event: E, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch {
          // Silently ignore event handler errors
        }
      }
    }
  }

  private async processMessage(
    entry: RedisSubscriptionEntry,
    messageData: {
      id: string;
      pattern: string;
      data: unknown;
      timestamp: number;
      metadata?: MessageMetadata;
    },
  ): Promise<void> {
    // Check if pattern matches
    const match = entry.matcher(messageData.pattern);
    if (!match.matched) {
      return;
    }

    const message = new RedisMessage(
      messageData.id,
      messageData.pattern,
      messageData.data,
      messageData.timestamp,
      messageData.metadata ?? {},
      {
        onAck: async () => {
          // Remove from processing set if using consumer groups
          if (entry.consumerGroup) {
            await this.client!.srem(
              this.keys.processing(entry.consumerGroup),
              JSON.stringify(messageData),
            );
          }
        },
        onNack: async (requeue) => {
          if (requeue) {
            // Re-queue the message
            await this.client!.raw(
              'LPUSH',
              this.keys.queue(messageData.pattern),
              JSON.stringify(messageData),
            );
          } else if (entry.options?.deadLetter) {
            // Move to dead letter queue
            await this.client!.raw(
              'RPUSH',
              this.keys.deadLetter(messageData.pattern),
              JSON.stringify(messageData),
            );
          }
        },
      },
    );

    // Emit received event
    this.emit('onMessageReceived', message);

    try {
      await entry.handler(message);

      // Auto-ack if not manual mode
      if (entry.options?.ackMode !== 'manual') {
        await message.ack();
      }

      // Emit processed event
      this.emit('onMessageProcessed', message);
    } catch (error) {
      // Emit failed event
      this.emit('onMessageFailed', message, error as Error);

      // Auto-nack if not manual mode
      if (entry.options?.ackMode !== 'manual') {
        await message.nack(false);
      }
    }
  }

  private startQueuePolling(entry: RedisSubscriptionEntry): void {
    // Poll the queue for existing messages
    const poll = async () => {
      if (!this.running || entry.paused) {
        return;
      }

      try {
        // Get message from queue (LPOP for FIFO)
        const result = await this.client!.raw<string | null>(
          'LPOP',
          this.keys.queue(entry.pattern),
        );

        if (result) {
          const messageData = JSON.parse(result);
          await this.processMessage(entry, messageData);
        }
      } catch {
        // Silently ignore polling errors
      }

      // Continue polling
      if (this.running && this.subscriptions.includes(entry)) {
        setTimeout(poll, this.options.pollInterval);
      }
    };

    poll();
  }

  private startDelayedProcessor(): void {
    this.delayedInterval = setInterval(async () => {
      if (!this.running || !this.client) {
        return;
      }

      try {
        const now = Date.now();

        // Get delayed messages that are ready
        const messages = await this.client.raw<string[]>(
          'ZRANGEBYSCORE',
          this.keys.delayed,
          '0',
          String(now),
          'LIMIT',
          '0',
          '100',
        );

        if (messages && messages.length > 0) {
          for (const msg of messages) {
            // Remove from delayed set
            await this.client.raw('ZREM', this.keys.delayed, msg);

            // Parse and publish
            const messageData = JSON.parse(msg);
            await this.client.raw('RPUSH', this.keys.queue(messageData.pattern), msg);
            await this.client.publish(this.keys.channel(messageData.pattern), msg);
          }
        }

        // Also process priority queue
        const priorityMessages = await this.client.raw<string[]>(
          'ZPOPMIN',
          this.keys.priority,
          '10',
        );

        if (priorityMessages && priorityMessages.length > 0) {
          // ZPOPMIN returns [member, score, member, score, ...]
          for (let i = 0; i < priorityMessages.length; i += 2) {
            const msg = priorityMessages[i];
            const messageData = JSON.parse(msg);
            await this.client.raw('RPUSH', this.keys.queue(messageData.pattern), msg);
            await this.client.publish(this.keys.channel(messageData.pattern), msg);
          }
        }
      } catch {
        // Silently ignore delayed message processing errors
      }
    }, this.options.pollInterval);
  }
}

/**
 * Create a Redis queue adapter
 */
export function createRedisQueueAdapter(options?: RedisQueueOptions): RedisQueueAdapter {
  return new RedisQueueAdapter(options);
}
