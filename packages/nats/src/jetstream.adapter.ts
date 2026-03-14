/**
 * JetStream Queue Adapter
 *
 * Queue adapter using NATS JetStream for persistent messaging.
 * Provides reliable message delivery with persistence and acknowledgments.
 */

import type { JetStreamAdapterOptions, StreamDefinition } from './types';

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

import { NatsClient } from './nats-client';

const DEFAULT_ACK_WAIT_NANOSECONDS = 30_000_000_000; // 30 seconds in nanoseconds
const DEFAULT_MAX_DELIVER = 3;

// Import JetStream types dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let jetstreamModule: any = null;

async function getJetStreamModule() {
  if (!jetstreamModule) {
    jetstreamModule = await import('@nats-io/jetstream');
  }

  return jetstreamModule;
}

// ============================================================================
// Resolved Stream Type
// ============================================================================

interface ResolvedStream extends StreamDefinition {
  natsSubjects: string[];
}

// ============================================================================
// JetStream Message Implementation
// ============================================================================

class JetStreamMessage<T> implements Message<T> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jsMsg: any;

  constructor(
    id: string,
    pattern: string,
    data: T,
    timestamp: number,
    metadata: MessageMetadata,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jsMsg: any,
  ) {
    this.id = id;
    this.pattern = pattern;
    this.data = data;
    this.timestamp = timestamp;
    this.metadata = metadata;
    this.jsMsg = jsMsg;
    this.redelivered = jsMsg?.info?.redelivered ?? false;
  }

  async ack(): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.acked = true;
    if (this.jsMsg?.ack) {
      this.jsMsg.ack();
    }
  }

  async nack(requeue = false): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.nacked = true;
    if (this.jsMsg?.nak) {
      // JetStream will requeue automatically based on consumer config
      this.jsMsg.nak(requeue ? undefined : { delay: -1 });
    }
  }
}

// ============================================================================
// JetStream Subscription Implementation
// ============================================================================

interface JetStreamSubscriptionEntry {
  pattern: string;
  handler: MessageHandler;
  options?: SubscribeOptions;
  matcher: (topic: string) => QueuePatternMatch;
  paused: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  consumer?: any;
  running: boolean;
}

class JetStreamSubscription implements Subscription {
  private active = true;

  constructor(
    private readonly entry: JetStreamSubscriptionEntry,
    private readonly onUnsubscribe: () => Promise<void>,
  ) {}

  async unsubscribe(): Promise<void> {
    this.active = false;
    this.entry.running = false;
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
// JetStream Queue Adapter
// ============================================================================

/**
 * JetStream Queue Adapter
 *
 * Uses NATS JetStream for persistent, reliable message delivery.
 *
 * Features:
 * - Pattern subscriptions
 * - Consumer groups (durable consumers)
 * - Scheduled jobs (via in-process scheduler)
 * - Dead letter queue support
 * - Retry with acknowledgment
 * - Message persistence
 *
 * Not supported:
 * - Priority (JetStream doesn't support priority)
 * - Delayed messages (can be simulated with headers)
 *
 * @example
 * ```typescript
 * const adapter = new JetStreamQueueAdapter({
 *   servers: 'nats://localhost:4222',
 *   streams: [
 *     { name: 'EVENTS', subjects: ['events.>'], retention: 'limits', maxMsgs: 1000000 },
 *     { name: 'COMMANDS', subjects: ['commands.>'] },
 *   ],
 * });
 * await adapter.connect();
 *
 * await adapter.subscribe('events.*', async (message) => {
 *   // Automatically routed to EVENTS stream
 *   await message.ack();
 * }, { ackMode: 'manual', group: 'event-processor' });
 *
 * await adapter.publish('events.created', { id: 123 });
 * ```
 */
export class JetStreamQueueAdapter implements QueueAdapter {
  readonly name = 'jetstream';
  readonly type: QueueAdapterType = 'jetstream';

  private client: NatsClient;
  private readonly resolvedStreams: ResolvedStream[];
  private connected = false;
  private scheduler: QueueScheduler | null = null;
  private subscriptions: JetStreamSubscriptionEntry[] = [];
  private messageIdCounter = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private js: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private jsm: any = null;

  // Event handlers
  private eventHandlers: Map<keyof QueueEvents, Set<(...args: unknown[]) => void>> = new Map();

  constructor(private readonly options: JetStreamAdapterOptions) {
    this.client = new NatsClient(options);

    const defaults = options.streamDefaults ?? {};
    this.resolvedStreams = options.streams.map((s) => ({
      ...defaults,
      ...s,
      natsSubjects: s.subjects.map((subj) => subj.replace(/#/g, '>')),
    }));
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

      const jsModule = await getJetStreamModule();
      const nc = this.client.getConnection();

      // Get JetStream context
      this.js = jsModule.jetstream(nc);
      this.jsm = await jsModule.jetstreamManager(nc);

      // Create/ensure all streams
      await this.ensureAllStreams();

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

    // Stop all consumers
    for (const entry of this.subscriptions) {
      entry.running = false;
    }
    this.subscriptions = [];

    await this.client.disconnect();
    this.connected = false;
    this.js = null;
    this.jsm = null;
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

    const encoder = new TextEncoder();

    // Convert OneBun subject to NATS subject (replace # with >)
    const natsSubject = pattern.replace(/#/g, '>');

    await this.js.publish(natsSubject, encoder.encode(JSON.stringify(messageData)));

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

    const jsModule = await getJetStreamModule();

    // Create consumer name from group or generate one
    const consumerName = options?.group ?? `consumer-${Date.now()}`;

    // Convert pattern to filter subject (replace # with >)
    const filterSubject = pattern.replace(/#/g, '>');

    // Determine ack policy
    const ackPolicy = options?.ackMode === 'manual'
      ? jsModule.AckPolicy.Explicit
      : jsModule.AckPolicy.None;

    // Resolve which stream this subject belongs to
    const streamName = this.resolveStreamForSubject(pattern);

    // Create or get consumer
    try {
      await this.jsm.consumers.add(streamName, {
        durable_name: options?.group ? consumerName : undefined,
        name: consumerName,
        ack_policy: ackPolicy,
        filter_subject: filterSubject,
        max_ack_pending: options?.prefetch ?? 100,
        ack_wait: this.options.consumerConfig?.ackWait ?? DEFAULT_ACK_WAIT_NANOSECONDS,
        max_deliver: options?.retry?.attempts ?? this.options.consumerConfig?.maxDeliver ?? DEFAULT_MAX_DELIVER,
      });
    } catch {
      // Consumer might already exist, try to get it
    }

    const consumer = await this.js.consumers.get(streamName, consumerName);

    const entry: JetStreamSubscriptionEntry = {
      pattern,
      handler: handler as MessageHandler,
      options,
      matcher: createQueuePatternMatcher(pattern),
      paused: false,
      consumer,
      running: true,
    };

    this.subscriptions.push(entry);

    // Start consuming messages
    this.consumeMessages(entry);

    const subscription = new JetStreamSubscription(entry, async () => {
      entry.running = false;
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
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
      case 'dead-letter-queue':
      case 'retry':
        return true;
      case 'delayed-messages':
      case 'priority':
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
      throw new Error('JetStreamQueueAdapter not connected. Call connect() first.');
    }
  }

  private generateMessageId(): string {
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    return `js-${++this.messageIdCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  /**
   * Resolve which stream a subject belongs to by matching against configured subject patterns.
   * Falls back to the first stream if no match is found.
   */
  resolveStreamForSubject(subject: string): string {
    const natsSubject = subject.replace(/#/g, '>');

    for (const stream of this.resolvedStreams) {
      for (const pattern of stream.natsSubjects) {
        if (this.natsSubjectMatches(pattern, natsSubject)) {
          return stream.name;
        }
      }
    }

    // Fallback to first stream
    return this.resolvedStreams[0].name;
  }

  /**
   * Check if a NATS subject matches a pattern.
   * Supports `.` as separator, `*` as single-level wildcard, `>` as multi-level wildcard.
   */
  private natsSubjectMatches(pattern: string, subject: string): boolean {
    const patternTokens = pattern.split('.');
    const subjectTokens = subject.split('.');

    for (let i = 0; i < patternTokens.length; i++) {
      const pt = patternTokens[i];

      // Multi-level wildcard matches the rest
      if (pt === '>') {
        return i <= subjectTokens.length;
      }

      // No more subject tokens but pattern continues
      if (i >= subjectTokens.length) {
        return false;
      }

      // Single-level wildcard matches any single token
      if (pt === '*') {
        continue;
      }

      // Exact match required
      if (pt !== subjectTokens[i]) {
        return false;
      }
    }

    // Both must be fully consumed
    return patternTokens.length === subjectTokens.length;
  }

  private async ensureAllStreams(): Promise<void> {
    for (const stream of this.resolvedStreams) {
      await this.ensureStream(stream);
    }
  }

  private async ensureStream(stream: ResolvedStream): Promise<void> {
    const streamConfig = {
      name: stream.name,
      subjects: stream.natsSubjects,
      retention: stream.retention ?? 'limits',
      max_msgs: stream.maxMsgs,
      max_bytes: stream.maxBytes,
      max_age: stream.maxAge,
      storage: stream.storage ?? 'file',
      num_replicas: stream.replicas ?? 1,
    };

    try {
      // Try to get existing stream info, then update
      await this.jsm.streams.info(stream.name);
      await this.jsm.streams.update(stream.name, streamConfig);
    } catch {
      // Stream doesn't exist, create it
      await this.jsm.streams.add(streamConfig);
    }
  }

  private async consumeMessages(entry: JetStreamSubscriptionEntry): Promise<void> {
    const decoder = new TextDecoder();

    try {
      const messages = await entry.consumer.consume({
        max_messages: entry.options?.prefetch ?? 10,
      });

      for await (const msg of messages) {
        if (!entry.running || entry.paused) {
          break;
        }

        try {
          const messageData = JSON.parse(decoder.decode(msg.data));

          // Check if pattern matches
          const match = entry.matcher(messageData.pattern || msg.subject);
          if (!match.matched) {
            // Ack and skip non-matching messages
            if (entry.options?.ackMode !== 'manual') {
              msg.ack();
            }
            continue;
          }

          const message = new JetStreamMessage(
            messageData.id || this.generateMessageId(),
            messageData.pattern || msg.subject,
            messageData.data,
            messageData.timestamp || Date.now(),
            messageData.metadata || {},
            msg,
          );

          // Emit received event
          this.emit('onMessageReceived', message);

          try {
            await entry.handler(message);

            // Auto-ack if not manual mode
            if (entry.options?.ackMode !== 'manual') {
              msg.ack();
            }

            // Emit processed event
            this.emit('onMessageProcessed', message);
          } catch (error) {
            // Emit failed event
            this.emit('onMessageFailed', message, error as Error);

            // Auto-nack if not manual mode
            if (entry.options?.ackMode !== 'manual') {
              msg.nak();
            }
          }
        } catch {
          // Message parsing error - ack to prevent redelivery
          msg.ack();
        }
      }
    } catch {
      // Consumer error - will be handled by NATS reconnection
    }

    // Restart consumption if still running
    if (entry.running) {
      setTimeout(() => this.consumeMessages(entry), 100);
    }
  }
}

/**
 * Create a JetStream queue adapter
 */
export function createJetStreamQueueAdapter(options: JetStreamAdapterOptions): JetStreamQueueAdapter {
  return new JetStreamQueueAdapter(options);
}
