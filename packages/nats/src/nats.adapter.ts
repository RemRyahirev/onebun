/**
 * NATS Queue Adapter
 *
 * Queue adapter using NATS pub/sub for message delivery.
 * This adapter provides basic pub/sub functionality without persistence.
 * For persistent messaging, use JetStreamQueueAdapter.
 */

import type { NatsAdapterOptions } from './types';

import type {
  AckMode,
  QueueAdapter,
  QueueAdapterType,
  QueueFeature,
  QueueEvents,
  Message,
  MessageMetadata,
  PublishOptions,
  SubscribeOptions,
  Subscription,
  MessageHandler,
  QueueScheduler,
} from '@onebun/core';
import {
  createQueuePatternMatcher,
  createQueueScheduler,
  inRootTraceScope,
  nackedError,
  resolveAckMode,
  wasNacked,
  type NackAwareMessage,
  type QueuePatternMatch,
} from '@onebun/core';

import {
  NatsClient,
  type NatsMessage,
  type NatsSubscriptionHandle,
} from './nats-client';
import { toNatsSubject } from './subject';

// ============================================================================
// NATS Message Implementation
// ============================================================================

class NatsQueueMessage<T> implements Message<T>, NackAwareMessage {
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

  /**
   * True once `nack()` has been called, so the consume loop can report the message as
   * failed rather than processed. Not on the public `Message` interface — see
   * `NackAwareMessage` in `@onebun/core`.
   */
  get wasNacked(): boolean {
    return this.nacked;
  }

  /**
   * A no-op on the wire: core NATS has no acknowledgement protocol, so there is nothing to
   * send. The call is still recorded, because it is what tells the consume loop the handler
   * considered this message handled.
   *
   * @see docs:api/queue.md
   */
  async ack(): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }

    this.acked = true;
  }

  /**
   * A no-op on the wire, and `requeue` cannot be honoured: core NATS never redelivers, so a
   * nacked message is simply dropped. The call is recorded so the subscription reports
   * `onMessageFailed` instead of `onMessageProcessed` — the drop is the failure.
   *
   * @see docs:api/queue.md
   */
  async nack(_requeue = false): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }

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
  /**
   * Resolved once, so the adapter names the mode in one place instead of re-reading the
   * raw option. Core NATS has no acknowledgement protocol at all, so nothing on the wire
   * varies with it — `'none'` is simply the only mode that describes what this adapter
   * really does, and `'auto'`/`'manual'` are accepted with no transport effect.
   */
  ackMode: AckMode;
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
 *
 * @see docs:api/queue.md
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

    // OneBun spells the multi-level wildcard '#' and NATS spells it '>', and NATS has
    // no form for a named parameter at all — `{id}` widens to '*' and `entry.matcher`
    // narrows it back.
    const natsPattern = toNatsSubject(pattern);

    const entry: NatsSubscriptionEntry = {
      pattern,
      handler: handler as MessageHandler,
      options,
      matcher: createQueuePatternMatcher(pattern),
      paused: false,
      ackMode: resolveAckMode(options),
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
  // Features
  // ============================================================================

  supports(feature: QueueFeature): boolean {
    switch (feature) {
      case 'pattern-subscriptions':
      case 'consumer-groups':
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

  /**
   * Invoke every listener for an event, isolating each from the others.
   *
   * The swallow is deliberate: a listener is application code, and one that throws must not abort
   * the listeners after it nor propagate into the delivery path that emitted the event. Reporting
   * it as `onError` would let a throwing `onError` handler recurse forever, so it goes to
   * `console.error` — the one path here that does not route through the framework, because the
   * framework's reporting channel is what just failed.
   */
  private emit<E extends keyof QueueEvents>(event: E, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (error) {
          // eslint-disable-next-line no-console -- the framework's own reporting channel is what failed
          console.error(`[NatsQueueAdapter] a "${event}" listener threw`, error);
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
        // A delivered message begins its own trace. Context follows the async graph, so a
        // message published from inside a request would otherwise make its handler — and every
        // later retry of it — a child of that finished request.
        await inRootTraceScope(async () => await entry.handler(message));

        // A handler that catches its own exception and nacks returns normally, so control
        // flow alone cannot tell the drop apart from a success.
        if (wasNacked(message)) {
          this.emit('onMessageFailed', message, nackedError(message));
        } else {
          this.emit('onMessageProcessed', message);
        }
      } catch (error) {
        // A throw is the failure, whether or not the handler also nacked — one event either way.
        this.emit('onMessageFailed', message, error as Error);
      }
    } catch (error) {
      // A payload this adapter cannot parse is a poison message, and dropping it without a word
      // is how an undeliverable message becomes indistinguishable from one that was never sent.
      // Core NATS cannot `term()` it — there is no acknowledgement protocol — so reporting is the
      // only disposition available, and it is the one `JetStreamQueueAdapter` already takes.
      this.emit(
        'onError',
        new Error(
          `NatsQueueAdapter could not parse a message on subject "${natsMsg.subject}"`,
          { cause: error },
        ),
      );
    }
  }
}

/**
 * Create a NATS queue adapter
 *
 * @see docs:api/queue.md
 */
export function createNatsQueueAdapter(options: NatsAdapterOptions): NatsQueueAdapter {
  return new NatsQueueAdapter(options);
}
