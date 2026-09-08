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
  MessageHandler,
} from '../types';

import { RedisClient } from '../../redis/redis-client';
import { SharedRedisProvider } from '../../redis/shared-redis';
import {
  acknowledgesAutomatically,
  nackedError,
  tracksDelivery,
  wasNacked,
  type NackAwareMessage,
} from '../ack-mode';
import {
  createQueuePatternMatcher,
  isQueuePattern,
  type QueuePatternMatch,
} from '../pattern-matcher';
import { toRedisQueueGlob } from '../redis-glob';
import { resolveMaxAttempts, retryDelayMs } from '../retry';
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

/**
 * What a queued message looks like on the list.
 *
 * `attempt` is the one field the wire format carries beyond the message itself: a retry is a
 * re-push, so the counter has to travel with the message or it restarts at 1 in whichever
 * process claims it next. Absent on a first publish, which reads as attempt 1.
 */
interface RedisQueueEnvelope {
  id: string;
  pattern: string;
  data: unknown;
  timestamp: number;
  metadata?: MessageMetadata;
  attempt?: number;
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
class RedisMessage<T> implements Message<T>, NackAwareMessage {
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

  /**
   * True once `nack()` has been called, so the consume loop can report the message as
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
 * @see docs:api/queue.md
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
  private wakeSubscribed = false;

  // Key prefixes
  private keys = {
    delayed: 'queue:delayed',
    priority: 'queue:priority',
    queue: (pattern: string) => `queue:q:${pattern}`,
    wake: 'queue:wake',
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
      wake: `${prefix}queue:wake`,
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

    // The wake subscription belongs to the connection, so a reconnect has to establish it again.
    // Leaving the flag set would leave the adapter believing it is listening when it is not, and
    // delivery would silently fall back to the poll interval.
    this.wakeSubscribed = false;

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
      await this.client!.zadd(this.keys.delayed, score, serialized);
    } else if (options?.priority && options.priority > 0) {
      // Priority message - use sorted set with negative priority (higher = more important)
      await this.client!.zadd(this.keys.priority, -options.priority, serialized);
    } else {
      // Normal message - push to list and publish to channel
      await this.client!.rpush(this.keys.queue(pattern), serialized);
      await this.client!.publish(this.keys.wake, pattern);
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

    // Fails here, at the call that named the pattern, rather than producing a glob that quietly
    // matches the wrong keys.
    toRedisQueueGlob(pattern);

    this.subscriptions.push(entry);
    await this.ensureWakeSubscription();

    // The poll loop covers what pub/sub cannot: messages published before this subscription
    // existed, and any notification missed while disconnected.
    this.startQueuePolling(entry);

    const subscription = new RedisSubscription(entry, async () => {
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }

      // The wake channel is shared by every subscription on this adapter, so it is released only
      // when the last one goes. Unsubscribing per entry would silence the others.
      if (this.subscriptions.length === 0 && this.wakeSubscribed) {
        this.wakeSubscribed = false;
        await this.client!.unsubscribe(this.keys.wake);
      }
    });

    return subscription;
  }

  /**
   * Subscribe the one wake channel, once per adapter.
   *
   * There is a single channel rather than one per topic because a pattern subscription does not
   * know the topics it will match: `orders.{id}` cannot subscribe to a per-topic channel for
   * `orders.123` before anyone publishes it. The frame carries the TOPIC, every subscription
   * tests it with its own
   * in-process matcher, and a match claims the message from that topic's list with an atomic LPOP.
   *
   * Bun's client has no usable `psubscribe` — it offers no listener form and drops pattern
   * messages — so a channel-glob design is not available.
   */
  private async ensureWakeSubscription(): Promise<void> {
    if (this.wakeSubscribed) {
      return;
    }

    this.wakeSubscribed = true;

    await this.client!.subscribe(this.keys.wake, (topic: string) => {
      for (const entry of [...this.subscriptions]) {
        if (!entry.matcher(topic).matched) {
          continue;
        }

        void this.drainTopic(entry, topic).catch((error: unknown) => {
          this.emit('onError', error instanceof Error ? error : new Error(String(error)));
        });
      }
    });
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
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
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
    messageData: RedisQueueEnvelope,
  ): Promise<void> {
    // Check if pattern matches
    const match = entry.matcher(messageData.pattern);
    if (!match.matched) {
      return;
    }

    const tracked = tracksDelivery(entry.options);
    const maxAttempts = resolveMaxAttempts(entry.options?.retry);
    // The counter rides in the envelope, not in this process: a retry goes back onto the list,
    // and the replica that claims it next may not be the one that failed. An in-memory counter
    // would restart at 1 on every hop and turn `attempts: 3` into an unbounded loop.
    const attempt = messageData.attempt ?? 1;

    const message = new RedisMessage(
      messageData.id,
      messageData.pattern,
      messageData.data,
      messageData.timestamp,
      messageData.metadata ?? {},
      {
        // Inert under 'none', where nothing tracks delivery and there is no attempt to number.
        redelivered: tracked ? attempt > 1 : false,
        attempt: tracked ? attempt : undefined,
        maxAttempts: tracked ? maxAttempts : undefined,
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
          // Under 'none' the broker tracks nothing, so neither requeue nor dead-letter
          // routing can be honoured without inventing delivery state that does not exist.
          if (!tracked) {
            return;
          }

          if (requeue) {
            // Back to the head of the list, carrying an incremented counter so the next
            // consumer knows which attempt it is running. Uncapped by design: `nack(true)` is
            // the handler's instruction, and `Message.attempt` is how a handler stops itself.
            await this.requeue(messageData, attempt + 1);
          } else if (entry.options?.deadLetter) {
            // Move to dead letter queue
            await this.client!.rpush(
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
        // Exhausted. Dead-letter routing on exhaustion is not wired here — `deadLetter.queue`
        // and `.maxRetries` are still ignored by this adapter, which the docs say plainly.
        return;
      }

      await this.scheduleRetry(messageData, attempt + 1, retryDelayMs(entry.options?.retry, attempt));
    }
  }

  /**
   * Hand a failed message back for another attempt.
   *
   * The wait goes into Redis, not into a `sleep` here. A retry that waits in a closure is a
   * message held by one process and written nowhere: kill that process and it is gone, exactly
   * when the point of retrying was to not lose it. The delayed sorted set already exists for
   * `publish({ delay })` and promotes to the same list, so the wait survives a restart and any
   * replica can serve the redelivery.
   *
   * A zero delay skips the set: a score of `now` would still wait out a poll tick, which would
   * quietly make `delay: 0` mean `pollInterval`.
   */
  private async scheduleRetry(
    messageData: RedisQueueEnvelope,
    attempt: number,
    delayMs: number,
  ): Promise<void> {
    const serialized = JSON.stringify({ ...messageData, attempt });

    if (delayMs > 0) {
      await this.client!.zadd(this.keys.delayed, Date.now() + delayMs, serialized);

      return;
    }

    await this.requeue(messageData, attempt);
    // Wake a consumer for it rather than leaving it to the next poll tick.
    await this.client!.publish(this.keys.wake, messageData.pattern);
  }

  /** Put a message back at the head of its topic list, stamped with the attempt it will be. */
  private async requeue(messageData: RedisQueueEnvelope, attempt: number): Promise<void> {
    await this.client!.lpush(
      this.keys.queue(messageData.pattern),
      JSON.stringify({ ...messageData, attempt }),
    );
  }

  /**
   * Take messages off ONE topic's list and run the handler for each.
   *
   * `LPOP` is the claim: it is atomic, so a message goes to exactly one consumer even when several
   * replicas drain the same list. That is what makes the list the single source of truth and the
   * wake channel a signal rather than a second delivery path.
   *
   * The topic is concrete, never the subscription's pattern — `queue:q:orders.{id}` is a key
   * nobody writes to, which is what made pattern subscriptions silently dead.
   *
   * Bounded per call so one busy topic cannot starve the others sharing this event loop.
   */
  private async drainTopic(
    entry: RedisSubscriptionEntry,
    topic: string,
    maxMessages = 50,
  ): Promise<void> {
    if (!this.running || entry.paused || !this.client) {
      return;
    }

    for (let drained = 0; drained < maxMessages; drained++) {
      let result: string | null;

      try {
        result = await this.client.lpop(this.keys.queue(topic));
      } catch (error) {
        // Reported, not discarded. This was a bare `catch {}`, so a poll that could not reach
        // Redis looked exactly like an empty queue: messages sat in the list, no consumer ran,
        // and nothing was logged.
        this.emit('onError', error instanceof Error ? error : new Error(String(error)));

        return;
      }

      if (!result) {
        return;
      }

      try {
        await this.processMessage(entry, JSON.parse(result));
      } catch (error) {
        // The message is already claimed at this point, so a handler failure must not stop the
        // drain — the next message is a different message.
        this.emit('onError', error instanceof Error ? error : new Error(String(error)));
      }

      if (entry.paused || !this.running) {
        return;
      }
    }
  }

  /**
   * Every queue key this subscription could own, resolved from the server.
   *
   * `SCAN`, never `KEYS`: this runs once per poll interval per pattern subscription (100 ms by
   * default), and `KEYS` walks the whole keyspace with the server blocked for the duration.
   *
   * The glob is a superset — Redis globs are character-based, so `orders.*` also matches
   * `orders.a.b` — and the in-process matcher is what decides. Widening here and narrowing there
   * is the only safe order; a narrower glob would drop messages the pattern does say it wants.
   */
  private async scanTopics(entry: RedisSubscriptionEntry): Promise<string[]> {
    if (!this.client) {
      return [];
    }

    const keyPrefix = this.keys.queue('');
    const match = `${keyPrefix}${toRedisQueueGlob(entry.pattern)}`;
    const topics: string[] = [];
    let cursor = '0';

    do {
      const reply = await this.client.raw<[string, string[]]>(
        'SCAN', cursor, 'MATCH', match, 'COUNT', '100',
      );

      if (!Array.isArray(reply) || reply.length < 2) {
        return topics;
      }

      cursor = String(reply[0]);
      const keys = Array.isArray(reply[1]) ? reply[1] : [];

      for (const key of keys) {
        const topic = String(key).slice(keyPrefix.length);
        if (topic.length > 0 && entry.matcher(topic).matched) {
          topics.push(topic);
        }
      }
    } while (cursor !== '0');

    return topics;
  }

  private startQueuePolling(entry: RedisSubscriptionEntry): void {
    // Poll the queue for messages published before this subscription existed, and as the
    // fallback path when a pub/sub notification is missed.
    const poll = async () => {
      // An exact pattern owns exactly one key, so ask for it directly. A pattern subscription has
      // to discover the topics that exist — SCAN, because this runs every pollInterval.
      if (isQueuePattern(entry.pattern)) {
        try {
          for (const topic of await this.scanTopics(entry)) {
            await this.drainTopic(entry, topic);
          }
        } catch (error) {
          this.emit('onError', error instanceof Error ? error : new Error(String(error)));
        }
      } else {
        await this.drainTopic(entry, entry.pattern);
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
        const messages = await this.client.zrangebyscore(this.keys.delayed, '0', String(now), 100);

        if (messages && messages.length > 0) {
          for (const msg of messages) {
            // Remove from delayed set
            await this.client.zrem(this.keys.delayed, msg);

            // Parse and publish
            const messageData = JSON.parse(msg);
            await this.client.rpush(this.keys.queue(messageData.pattern), msg);
            await this.client.publish(this.keys.wake, String(messageData.pattern));
          }
        }

        // Also process priority queue
        const priorityMessages = await this.client.zpopmin(this.keys.priority, 10);

        for (const { member } of priorityMessages) {
          const messageData = JSON.parse(member);
          await this.client.rpush(this.keys.queue(messageData.pattern), member);
          await this.client.publish(this.keys.wake, String(messageData.pattern));
        }
      } catch (error) {
        // Reported rather than discarded: a delayed or priority message that cannot be promoted
        // to its queue never fires, and the bare catch this replaces made that indistinguishable
        // from "nothing was due".
        this.emit('onError', error instanceof Error ? error : new Error(String(error)));
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
