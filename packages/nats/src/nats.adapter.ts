/**
 * NATS Queue Adapter
 *
 * Queue adapter using NATS pub/sub for message delivery.
 * This adapter provides basic pub/sub functionality without persistence.
 * For persistent messaging, use JetStreamQueueAdapter.
 */

import type { NatsAdapterOptions } from './types';

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
  QueueScheduler,
} from '@onebun/core';
import {
  createQueuePatternMatcher,
  createQueueScheduler,
  type QueuePatternMatch,
} from '@onebun/core';

import {
  NatsClient,
  type NatsMessage,
  type NatsSubscriptionHandle,
} from './nats-client';

// ============================================================================
// NATS Message Implementation
// ============================================================================

class NatsQueueMessage<T> implements Message<T> {
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

  constructor(
    id: string,
    pattern: string,
    data: T,
    timestamp: number,
    metadata: MessageMetadata,
  ) {
    this.id = id;
    this.pattern = pattern;
    this.data = data;
    this.timestamp = timestamp;
    this.metadata = metadata;
    this.redelivered = false;
  }

  async ack(): Promise<void> {
    // NATS pub/sub doesn't require explicit ack
    this.acked = true;
  }

  async nack(_requeue = false): Promise<void> {
    // NATS pub/sub doesn't support nack/requeue
    this.nacked = true;
  }
}

// ============================================================================
// NATS Subscription Implementation
// ============================================================================

interface NatsSubscriptionEntry {
  pattern: string;
  handler: MessageHandler;
  options?: SubscribeOptions;
  matcher: (topic: string) => QueuePatternMatch;
  paused: boolean;
  handle?: NatsSubscriptionHandle;
}

class NatsSubscription implements Subscription {
  private active = true;

  constructor(
    private readonly entry: NatsSubscriptionEntry,
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
// NATS Queue Adapter
// ============================================================================

/**
 * NATS Queue Adapter
 *
 * Uses NATS pub/sub for message delivery. This is suitable for
 * scenarios where messages don't need to be persisted and can be
 * lost if no subscribers are available.
 *
 * For persistent messaging, use JetStreamQueueAdapter.
 *
 * Features:
 * - Pattern subscriptions (using NATS wildcards)
 * - Consumer groups (using NATS queue groups)
 * - Scheduled jobs (via in-process scheduler)
 *
 * Not supported:
 * - Delayed messages
 * - Priority
 * - Dead letter queues
 * - Retry (message is lost if handler fails)
 *
 * @example
 * ```typescript
 * const adapter = new NatsQueueAdapter({
 *   servers: 'nats://localhost:4222',
 * });
 * await adapter.connect();
 *
 * await adapter.subscribe('orders.*', async (message) => {
 *   console.log('Received:', message.data);
 * });
 *
 * await adapter.publish('orders.created', { orderId: 123 });
 * ```
 */
export class NatsQueueAdapter implements QueueAdapter {
  readonly name = 'nats';
  readonly type: QueueAdapterType = 'nats';

  private client: NatsClient;
  private connected = false;
  private scheduler: QueueScheduler | null = null;
  private subscriptions: NatsSubscriptionEntry[] = [];
  private messageIdCounter = 0;

  // Event handlers
  private eventHandlers: Map<keyof QueueEvents, Set<(...args: unknown[]) => void>> = new Map();

  constructor(private readonly options: NatsAdapterOptions) {
    this.client = new NatsClient(options);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      await this.client.connect();
      this.connected = true;
      this.scheduler = createQueueScheduler(this);

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

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
    }

    // Unsubscribe all
    for (const entry of this.subscriptions) {
      if (entry.handle) {
        entry.handle.unsubscribe();
      }
    }
    this.subscriptions = [];

    await this.client.disconnect();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.client.isConnected();
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

    // Convert headers to string map
    const headers: Record<string, string> = {};
    if (options?.metadata?.headers) {
      Object.assign(headers, options.metadata.headers);
    }

    await this.client.publish(pattern, JSON.stringify(messageData), headers);

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

    // Convert OneBun pattern to NATS pattern
    // OneBun uses '.' as separator and '*' for single-level, '#' for multi-level
    // NATS uses '.' as separator and '*' for single-level, '>' for multi-level
    const natsPattern = pattern.replace(/#/g, '>');

    const entry: NatsSubscriptionEntry = {
      pattern,
      handler: handler as MessageHandler,
      options,
      matcher: createQueuePatternMatcher(pattern),
      paused: false,
    };

    // Subscribe to NATS
    const handle = await this.client.subscribe(
      natsPattern,
      async (msg) => {
        if (entry.paused) {
          return;
        }
        await this.processMessage(entry, msg);
      },
      { queue: options?.group },
    );

    entry.handle = handle;
    this.subscriptions.push(entry);

    const subscription = new NatsSubscription(entry, async () => {
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
      if (entry.handle) {
        entry.handle.unsubscribe();
      }
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

  supports(feature: QueueFeature): boolean {
    switch (feature) {
      case 'pattern-subscriptions':
      case 'consumer-groups':
      case 'scheduled-jobs':
        return true;
      case 'delayed-messages':
      case 'priority':
      case 'dead-letter-queue':
      case 'retry':
        return false;
      default:
        return false;
    }
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
    if (!this.connected) {
      throw new Error('NatsQueueAdapter not connected. Call connect() first.');
    }
  }

  private generateMessageId(): string {
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    return `nats-${++this.messageIdCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  private async processMessage(entry: NatsSubscriptionEntry, natsMsg: NatsMessage): Promise<void> {
    try {
      const messageData = JSON.parse(natsMsg.data);

      // Check if pattern matches
      const match = entry.matcher(messageData.pattern || natsMsg.subject);
      if (!match.matched) {
        return;
      }

      const message = new NatsQueueMessage(
        messageData.id || this.generateMessageId(),
        messageData.pattern || natsMsg.subject,
        messageData.data,
        messageData.timestamp || Date.now(),
        messageData.metadata || {},
      );

      // Emit received event
      this.emit('onMessageReceived', message);

      try {
        await entry.handler(message);

        // Emit processed event
        this.emit('onMessageProcessed', message);
      } catch (error) {
        // Emit failed event
        this.emit('onMessageFailed', message, error as Error);
      }
    } catch {
      // Silently ignore message parsing errors
    }
  }
}

/**
 * Create a NATS queue adapter
 */
export function createNatsQueueAdapter(options: NatsAdapterOptions): NatsQueueAdapter {
  return new NatsQueueAdapter(options);
}
