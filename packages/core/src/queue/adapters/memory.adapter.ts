/**
 * In-Memory Queue Adapter
 *
 * A simple in-process message bus. Useful for development, testing,
 * and single-instance deployments where external dependencies are not needed.
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
  MessageHandler,
} from '../types';

import {
  acknowledgesAutomatically,
  nackedError,
  tracksDelivery,
  wasNacked,
  type NackAwareMessage,
} from '../ack-mode';
import { createQueuePatternMatcher, type QueuePatternMatch } from '../pattern-matcher';
import { resolveMaxAttempts, retryDelayMs } from '../retry';
import { QueueScheduler } from '../scheduler';

// ============================================================================
// Types
// ============================================================================

interface SubscriptionEntry {
  pattern: string;
  handler: MessageHandler;
  options?: SubscribeOptions;
  matcher: (topic: string) => QueuePatternMatch;
  paused: boolean;
}

interface DelayedMessage {
  pattern: string;
  data: unknown;
  options?: PublishOptions;
  executeAt: number;
}

// ============================================================================
// In-Memory Message Implementation
// ============================================================================

/**
 * In-memory message implementation
 */
class InMemoryMessage<T> implements Message<T>, NackAwareMessage {
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
  private onAck?: () => void;
  private onNack?: (requeue: boolean) => void;

  constructor(
    id: string,
    pattern: string,
    data: T,
    metadata: MessageMetadata,
    options?: {
      redelivered?: boolean;
      attempt?: number;
      maxAttempts?: number;
      onAck?: () => void;
      onNack?: (requeue: boolean) => void;
    },
  ) {
    this.id = id;
    this.pattern = pattern;
    this.data = data;
    this.timestamp = Date.now();
    this.metadata = metadata;
    this.redelivered = options?.redelivered ?? false;
    this.attempt = options?.attempt;
    this.maxAttempts = options?.maxAttempts;
    this.onAck = options?.onAck;
    this.onNack = options?.onNack;
  }

  /**
   * True once `nack()` has been called, so the dispatch loop can report the message as
   * failed rather than processed. Not on the public `Message` interface — see
   * `NackAwareMessage`.
   */
  get wasNacked(): boolean {
    return this.nacked;
  }

  async ack(): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.acked = true;
    this.onAck?.();
  }

  async nack(requeue = false): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.nacked = true;
    this.onNack?.(requeue);
  }
}

// ============================================================================
// In-Memory Subscription Implementation
// ============================================================================

class InMemorySubscription implements Subscription {
  private active = true;

  constructor(
    private readonly entry: SubscriptionEntry,
    private readonly onUnsubscribe: () => void,
  ) {}

  async unsubscribe(): Promise<void> {
    this.active = false;
    this.onUnsubscribe();
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
// In-Memory Queue Adapter
// ============================================================================

/**
 * In-Memory Queue Adapter
 *
 * Implements a simple in-process message bus.
 *
 * Supported features:
 * - Pattern subscriptions with wildcards
 * - Delayed messages
 * - Priority (via sorting)
 * - Scheduled jobs
 *
 * Not supported (requires external storage):
 * - Consumer groups (all handlers receive all messages)
 * - Dead letter queues
 * - Retry with persistence
 *
 * @example
 * ```typescript
 * const adapter = new InMemoryQueueAdapter();
 * await adapter.connect();
 *
 * await adapter.subscribe('orders.*', async (message) => {
 *   console.log('Received:', message.data);
 * });
 *
 * await adapter.publish('orders.created', { orderId: 123 });
 * ```
 * @see docs:api/queue.md
 */
export class InMemoryQueueAdapter implements QueueAdapter {
  readonly name = 'memory';
  readonly type: QueueAdapterType = 'memory';

  private subscriptions: SubscriptionEntry[] = [];
  private delayedMessages: DelayedMessage[] = [];
  private messageIdCounter = 0;
  private connected = false;
  private scheduler: QueueScheduler | null = null;
  private delayedInterval?: ReturnType<typeof setInterval>;

  // Event handlers
  private eventHandlers: Map<keyof QueueEvents, Set<(...args: unknown[]) => void>> = new Map();

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.connected = true;
    this.scheduler = new QueueScheduler(this);

    // Start delayed message processor
    this.delayedInterval = setInterval(() => this.processDelayedMessages(), 100);

    // Emit ready event
    this.emit('onReady');
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

    // Clear delayed interval
    if (this.delayedInterval) {
      clearInterval(this.delayedInterval);
      this.delayedInterval = undefined;
    }

    // Clear all subscriptions
    this.subscriptions = [];
    this.delayedMessages = [];

    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Publishing
  // ============================================================================

  async publish<T>(pattern: string, data: T, options?: PublishOptions): Promise<string> {
    this.ensureConnected();

    const messageId = options?.messageId ?? this.generateMessageId();

    // Handle delayed messages
    if (options?.delay && options.delay > 0) {
      this.delayedMessages.push({
        pattern,
        data,
        options: { ...options, messageId },
        executeAt: Date.now() + options.delay,
      });
      // Sort by priority (higher first) and then by time
      this.delayedMessages.sort((a, b) => {
        const priorityA = a.options?.priority ?? 0;
        const priorityB = b.options?.priority ?? 0;
        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority first
        }

        return a.executeAt - b.executeAt;
      });

      return messageId;
    }

    // Dispatch immediately
    await this.dispatch(pattern, data, messageId, options?.metadata);

    return messageId;
  }

  async publishBatch<T>(
    messages: Array<{ pattern: string; data: T; options?: PublishOptions }>,
  ): Promise<string[]> {
    const ids: string[] = [];

    // Sort by priority if any
    const sorted = [...messages].sort((a, b) => {
      const priorityA = a.options?.priority ?? 0;
      const priorityB = b.options?.priority ?? 0;

      return priorityB - priorityA;
    });

    for (const msg of sorted) {
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

    const entry: SubscriptionEntry = {
      pattern,
      handler: handler as MessageHandler,
      options,
      matcher: createQueuePatternMatcher(pattern),
      paused: false,
    };

    this.subscriptions.push(entry);

    const subscription = new InMemorySubscription(entry, () => {
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
    });

    return subscription;
  }

  // ============================================================================
  // Features
  // ============================================================================

  supports(feature: QueueFeature): boolean {
    switch (feature) {
      case 'delayed-messages':
      case 'priority':
      case 'pattern-subscriptions':
      // In-process and non-persistent — a restart loses the attempt counter along with the
      // message. That is a property of this adapter, not a reason to report `false`: it does
      // honour `retry.attempts`, and claiming otherwise is the `supports()`-lies pattern.
      case 'retry':
        return true;
      case 'consumer-groups':
      case 'dead-letter-queue':
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
      throw new Error('InMemoryQueueAdapter not connected. Call connect() first.');
    }
  }

  private generateMessageId(): string {
    return `msg-${++this.messageIdCounter}-${Date.now()}`;
  }

  private async dispatch<T>(
    pattern: string,
    data: T,
    messageId: string,
    metadata?: Partial<MessageMetadata>,
  ): Promise<void> {
    const fullMetadata: MessageMetadata = {
      headers: {},
      ...metadata,
    };

    // Find all matching subscriptions
    for (const entry of this.subscriptions) {
      if (entry.paused) {
        continue;
      }

      const match = entry.matcher(pattern);
      if (!match.matched) {
        continue;
      }

      await this.deliver(entry, pattern, data, messageId, fullMetadata, 1);
    }
  }

  /**
   * Deliver one message to ONE subscription, retrying that subscription alone.
   *
   * The retry used to go back through `dispatch()`, which walks every matching subscription — so
   * one failing handler re-invoked its healthy neighbours. Retrying is a property of the delivery
   * that failed, not of the topic, and this is where that distinction lives.
   */
  private async deliver<T>(
    entry: SubscriptionEntry,
    pattern: string,
    data: T,
    messageId: string,
    metadata: MessageMetadata,
    attempt: number,
  ): Promise<void> {
    const maxAttempts = resolveMaxAttempts(entry.options?.retry);

    const message = new InMemoryMessage<T>(messageId, pattern, data, metadata, {
      // Delivery bookkeeping is meaningless under 'none' — nothing tracks delivery, so there is
      // no attempt to number. Reporting `attempt: 1` there would suggest a counter that is not
      // running; the documented contract is that these three fields go inert with the mode.
      redelivered: tracksDelivery(entry.options) ? attempt > 1 : false,
      attempt: tracksDelivery(entry.options) ? attempt : undefined,
      maxAttempts: tracksDelivery(entry.options) ? maxAttempts : undefined,
      onNack: (requeue) => {
        // Under 'none' a requeue would resurrect a message in the one mode that
        // promises a single delivery, so it is suppressed rather than honoured.
        if (requeue && tracksDelivery(entry.options)) {
          // Uncapped, and deliberately so: `nack(true)` is the handler's own instruction, not
          // the framework's policy. `Message.attempt` is what lets a handler stop itself.
          setImmediate(() => {
            void this.deliver(entry, pattern, data, messageId, metadata, attempt + 1);
          });
        }
      },
    });

    // Emit received event
    this.emit('onMessageReceived', message);

    try {
      await entry.handler(message);

      // Auto-ack only in 'auto': 'manual' is the handler's job and 'none' acknowledges nothing.
      if (acknowledgesAutomatically(entry.options)) {
        await message.ack();
      }

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

      // Same rule on the failure side. Under 'none' the message is simply gone.
      if (!acknowledgesAutomatically(entry.options)) {
        return;
      }

      await message.nack(false);

      if (attempt >= maxAttempts) {
        // Exhausted. This adapter reports `supports('dead-letter-queue') === false`, and that
        // stays true: the message is dropped, having been reported through `onMessageFailed`
        // on every attempt.
        return;
      }

      await this.sleep(retryDelayMs(entry.options?.retry, attempt));
      await this.deliver(entry, pattern, data, messageId, metadata, attempt + 1);
    }
  }

  /** Awaitable pause that resolves immediately for a zero delay, so `retry` without a `delay` costs no tick. */
  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private processDelayedMessages(): void {
    const now = Date.now();

    while (this.delayedMessages.length > 0 && this.delayedMessages[0].executeAt <= now) {
      const delayed = this.delayedMessages.shift()!;
      const messageId = delayed.options?.messageId ?? this.generateMessageId();

      // Dispatch without delay
      this.dispatch(delayed.pattern, delayed.data, messageId, delayed.options?.metadata);
    }
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
          console.error(`[InMemoryQueueAdapter] a "${event}" listener threw`, error);
        }
      }
    }
  }
}

/**
 * Create an in-memory queue adapter
 */
export function createInMemoryQueueAdapter(): InMemoryQueueAdapter {
  return new InMemoryQueueAdapter();
}
