/**
 * JetStream Queue Adapter
 *
 * Queue adapter using NATS JetStream for persistent messaging.
 * Provides reliable message delivery with persistence and acknowledgments.
 */

import type { JetStreamAdapterOptions, StreamDefinition } from './types';
import type {
  AckPolicy,
  Consumer,
  ConsumerConfig,
  ConsumerMessages,
  ConsumerNotification,
  ConsumerInfo,
  DeliverPolicy,
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  RetentionPolicy,
  StorageType,
  StreamConfig,
  StreamInfo,
} from '@nats-io/jetstream';

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
  QueueScheduler,
} from '@onebun/core';
import {
  acknowledgesAutomatically,
  createQueuePatternMatcher,
  createQueueScheduler,
  inRootTraceScope,
  nackedError,
  resolveAckMode,
  tracksDelivery,
  wasNacked,
  type NackAwareMessage,
  type QueuePatternMatch,
} from '@onebun/core';

import {
  CONFIG_CYCLE_WINDOW_MS,
  decideStamp,
  hashReconcileConfig,
  isNotFoundError,
  stampMetadata,
  type StampMetadata,
} from './config-stamp';
import { NatsClient } from './nats-client';
import { toNatsSubject } from './subject';

const DEFAULT_ACK_WAIT_NANOSECONDS = 30_000_000_000; // 30 seconds in nanoseconds
/**
 * `SubscribeOptions.ackTimeout` is milliseconds — every duration in `@onebun/core` is —
 * while the consumer's `ack_wait` is nanoseconds. Nanoseconds appear only on the
 * NATS-native adapter types, so the conversion belongs here.
 */
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const DEFAULT_MAX_DELIVER = 3;
const DEFAULT_MAX_ACK_PENDING = 100;
const DEFAULT_CONSUME_BATCH = 10;
const CONSUME_RESTART_DELAY_MS = 100;
const IDENTITY_DIGEST_LENGTH = 12;
const RELEASE_TIMEOUT_MS = 5_000;
/**
 * How long shutdown waits for a handler that is already running.
 *
 * Fixed rather than configurable, and deliberately equal to the default `ack_wait`: past
 * that point the server has already redelivered the message, so waiting longer cannot
 * prevent the duplicate it exists to prevent.
 */
const HANDLER_DRAIN_TIMEOUT_MS = 30_000;

/** A value that may appear in a hashed stream subset. */
type HashableStreamValue = string | number | readonly string[] | undefined;

/** The loosely-typed stream config the untyped client accepts. */
interface AnyStreamConfig {
  subjects: string[];
  name?: string;
  retention?: RetentionPolicy;
  storage?: StorageType;
  num_replicas?: number;
  max_msgs?: number;
  max_bytes?: number;
  max_age?: number;
  duplicate_window?: number;
}

/** Everything `subscribe()` negotiates with the server, resolved once per subscription. */
interface ResolvedConsumerConfig {
  ackPolicy: AckPolicy;
  deliverPolicy: DeliverPolicy;
  maxAckPending: number;
  ackWait: number;
  maxDeliver: number;
  consumeBatch: number;
  /**
   * False under `ackMode: 'none'`. The redelivery knobs are then neither sent nor hashed:
   * the server accepts them but ignores them, and recording them would stamp a redelivery
   * policy that cannot happen.
   */
  tracksDelivery: boolean;
}

/**
 * Single source of truth for the consumer wire values.
 *
 * Precedence:
 * - `max_ack_pending`: `prefetch` > `consumerConfig.maxAckPending` > 100
 * - `max_deliver`: `retry.attempts` > `deadLetter.maxRetries` > `consumerConfig.maxDeliver` > 3.
 *   `retry.attempts` stays ahead of `deadLetter.maxRetries` so every configuration that
 *   worked before the dead-letter queue existed keeps the exact `max_deliver` it had.
 * - `ack_wait`: `ackTimeout` > `consumerConfig.ackWait` > 30s expressed in nanoseconds.
 *   `ackTimeout` is per-subscription and in milliseconds; `consumerConfig.ackWait` is
 *   adapter-wide and already in nanoseconds.
 * - `ack_policy`: explicit for `'auto'` and `'manual'` — those decide WHO acknowledges.
 *   `'none'` is the one mode that decides WHETHER the server tracks acknowledgements at
 *   all; it maps to the client's none policy, and `ack_wait`, `max_deliver` and `max_ack_pending`
 *   are then omitted rather than sent, because they govern a redelivery that cannot occur.
 *
 * `ackPolicy` and `deliverPolicy` arrive as parameters so this stays synchronous and needs
 * no access to the dynamically imported client module.
 */
function resolveConsumerConfig(
  ackPolicy: AckPolicy,
  deliverPolicy: DeliverPolicy,
  options: SubscribeOptions | undefined,
  consumerConfig: JetStreamAdapterOptions['consumerConfig'],
): ResolvedConsumerConfig {
  const maxAckPending = options?.prefetch ?? consumerConfig?.maxAckPending ?? DEFAULT_MAX_ACK_PENDING;

  return {
    tracksDelivery: tracksDelivery(options),
    ackPolicy,
    deliverPolicy,
    maxAckPending,
    ackWait: options?.ackTimeout !== undefined
      ? options.ackTimeout * NANOSECONDS_PER_MILLISECOND
      : consumerConfig?.ackWait ?? DEFAULT_ACK_WAIT_NANOSECONDS,
    maxDeliver: options?.retry?.attempts
      ?? options?.deadLetter?.maxRetries
      ?? consumerConfig?.maxDeliver
      ?? DEFAULT_MAX_DELIVER,
    consumeBatch: Math.min(maxAckPending, options?.prefetch ?? DEFAULT_CONSUME_BATCH),
  };
}

/**
 * The redelivery knobs, or nothing at all under `ackMode: 'none'`.
 *
 * Spread into the wire payload so the keys are ABSENT rather than present-and-undefined —
 * the client merges an update with a shallow `Object.assign`, where an explicit `undefined`
 * would overwrite whatever the server holds.
 */
function redeliveryConfig(resolved: ResolvedConsumerConfig): Partial<ConsumerConfig> {
  if (!resolved.tracksDelivery) {
    return {};
  }

  return {
    ack_wait: resolved.ackWait,
    max_ack_pending: resolved.maxAckPending,
    max_deliver: resolved.maxDeliver,
  };
}

/**
 * Reduces a name to the charset the client's `validName` accepts before it reaches
 * `consumers.add`. Subject wildcards and separators are not in `[-\w]`, so a filter
 * subject cannot be used as a consumer name unmodified.
 */
function sanitizeConsumerName(value: string): string {
  return value.replace(/[^-\w]/g, '_');
}

/**
 * Builds the durable name for a (group, filterSubject) pair.
 *
 * Sanitisation alone cannot identify a consumer, because it is lossy: `orders.*` and
 * `orders.>` both reduce to `orders__`, as do `orders.new` and `orders_new`, and the `--`
 * joiner is itself a legal character in a group name. Two subscriptions colliding that way
 * would land on one consumer and the second would repoint it, which is the silent takeover
 * this naming scheme exists to prevent. The readable part therefore carries a digest of the
 * RAW pair, which distinguishes every pair the sanitised form aliases.
 */
function durableConsumerName(group: string, filterSubject: string): string {
  const digest = hashReconcileConfig({ group, subject: filterSubject }).slice(0, IDENTITY_DIGEST_LENGTH);

  return `${sanitizeConsumerName(group)}--${sanitizeConsumerName(filterSubject)}--${digest}`;
}

/** The wire envelope OneBun publishes. Anything else on the subject is foreign. */
interface OneBunEnvelope {
  id?: string;
  pattern?: string;
  data?: unknown;
  timestamp?: number;
  metadata?: MessageMetadata;
}

/**
 * A JetStream subject can carry messages this framework did not publish. Without this
 * check they reached the handler as `data: undefined`, which reads like an application
 * bug rather than a foreign payload.
 */
function isOneBunEnvelope(value: unknown): value is OneBunEnvelope {
  return typeof value === 'object' && value !== null && 'data' in value;
}

function poisonMessageError(subject: string, cause: unknown): Error {
  return new Error(
    `Failed to parse a JetStream message on subject "${subject}": ${describeCause(cause)}. `
    + 'It was terminated rather than acknowledged or redelivered — a payload that does not parse '
    + 'will not parse on a retry either. Publish to this subject with OneBun, or subscribe with a '
    + 'dedicated stream if another producer shares it.',
    { cause },
  );
}

/**
 * Rejects a `deadLetter.queue` that could never work, at `subscribe()` rather than on the
 * first failed message — a DLQ that only reveals itself broken once something has already
 * gone wrong is worse than no DLQ.
 */
function validateDeadLetterQueue(queue: string, pattern: string): void {
  if (queue.split('.').some(token => token === '*' || token === '>' || token.includes('#'))) {
    throw new Error(
      `Invalid deadLetter.queue "${queue}": it must be a literal subject, but it contains a wildcard. `
      + 'A message is published to exactly one subject, so "*", ">" and "#" have no meaning here — '
      + 'name the concrete subject the dead letters should land on, and make sure a declared stream binds it.',
    );
  }

  if (queue === pattern) {
    throw new Error(
      `Invalid deadLetter.queue "${queue}": it is the subscription's own pattern, so every dead letter `
      + 'would be redelivered to the handler that just rejected it and immediately fail again. '
      + 'Point deadLetter.queue at a different subject, bound by a stream of its own.',
    );
  }
}

function deadLetterRepublishError(queue: string, pattern: string, cause: unknown): Error {
  return new Error(
    `Failed to republish a message from "${pattern}" to the dead-letter queue "${queue}". `
    + 'The original was NOT terminated — the server will redeliver it or exhaust max_deliver normally, '
    + 'because losing the payload is the one outcome a dead-letter queue exists to prevent. '
    + 'The most common cause is that no stream binds the dead-letter subject.',
    { cause },
  );
}

function foreignEnvelopeError(subject: string): Error {
  return new Error(
    `A JetStream message on subject "${subject}" parsed as JSON but is not a OneBun envelope: it `
    + 'carries no "data" field. It was terminated rather than delivered to the handler with an '
    + 'undefined payload. Another producer is publishing to a subject this application subscribes to.',
  );
}

/** Notifications worth surfacing. The rest are routine flow-control chatter. */
const REPORTABLE_NOTIFICATIONS = new Set([
  'consumer_deleted',
  'consumer_not_found',
  'heartbeats_missed',
  'stream_not_found',
  'exceeded_limits',
]);

function isReportableNotification(notification: ConsumerNotification): boolean {
  return REPORTABLE_NOTIFICATIONS.has(notification.type);
}

function consumerNotificationError(
  consumerName: string,
  streamName: string,
  notification: ConsumerNotification,
): Error {
  const repaired = notification.type === 'consumer_deleted' || notification.type === 'consumer_not_found'
    ? ' OneBun is re-creating it; delivery resumes once the new consumer is in place.'
    : ' OneBun does not repair this automatically — it needs an operator.';

  return new Error(
    `JetStream reported "${notification.type}" for consumer "${consumerName}" on stream "${streamName}".${repaired}`,
  );
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ackPolicyMigrationMessage(
  consumerName: string,
  streamName: string,
  observed: string,
  expected: string,
): string {
  const why = expected === 'explicit'
    ? 'under anything else acknowledgements, ack_wait, max_deliver, max_ack_pending, retries and the dead-letter queue are inert'
    : 'this subscription declares ackMode: \'none\', which needs ack_policy=none — the existing consumer would keep tracking acknowledgements nobody sends and redeliver every message once ack_wait expired';

  return `JetStream consumer "${consumerName}" on stream "${streamName}" has ack_policy=${observed || 'unset'}, but this subscription needs ack_policy=${expected} — ${why}. ack_policy cannot be changed on an existing consumer. Either align the subscription's ackMode with the consumer, or delete it and let OneBun recreate it: nats consumer rm ${streamName} ${consumerName}`;
}

function cycleMessage(
  consumerName: string,
  streamName: string,
  currentHash: string,
  desiredHash: string,
  fields: string[],
): string {
  const diverging = fields.length > 0 ? fields.join(', ') : 'unknown';

  return `JetStream consumer "${consumerName}" on stream "${streamName}" is in a reconcile cycle: OneBun wants config hash ${desiredHash}, which was already applied within the last ${CONFIG_CYCLE_WINDOW_MS}ms and has since been replaced by ${currentHash}. Diverging fields: ${diverging}. Two processes are writing different consumer configurations — align consumerConfig, prefetch and retry.attempts across them, or delete the consumer: nats consumer rm ${streamName} ${consumerName}`;
}

/**
 * What the consumer write was actually trying to do, for the two messages below.
 *
 * The server's rejection names a consumer and a stream and nothing else, which leaves the reader
 * to work out which subscription that was. This states the OneBun pattern, the subject it
 * translated to, the stream it resolved to and every declaration — the shape
 * `publishFailureMessage` already established.
 *
 * Note what this can NOT catch: nats-server accepts a `filter_subject` unrelated to the stream's
 * subjects, so a mis-bound subscription never reaches here at all. This message covers the
 * rejections the server does issue — overlapping `filter_subjects` entries, create-only field
 * changes, permissions — not stream binding, which is decided locally before the call.
 */
function consumerAttemptContext(
  pattern: string,
  filterSubject: string,
  streamName: string,
  streams: ResolvedStream[],
): string {
  return `OneBun pattern "${pattern}" translated to filter_subject "${filterSubject}" and resolved to stream "${streamName}". This application declares ${describeDeclarations(streams)}.`;
}

function addFailureMessage(
  consumerName: string,
  streamName: string,
  pattern: string,
  filterSubject: string,
  streams: ResolvedStream[],
  cause: unknown,
): string {
  return `Failed to create JetStream consumer "${consumerName}" on stream "${streamName}": ${describeCause(cause)}. ${consumerAttemptContext(pattern, filterSubject, streamName, streams)} The underlying rejection is attached as the cause of this error.`;
}

function updateFailureMessage(
  consumerName: string,
  streamName: string,
  pattern: string,
  filterSubject: string,
  streams: ResolvedStream[],
  cause: unknown,
): string {
  return `Failed to update JetStream consumer "${consumerName}" on stream "${streamName}": ${describeCause(cause)}. ${consumerAttemptContext(pattern, filterSubject, streamName, streams)} Delete it and let OneBun recreate it: nats consumer rm ${streamName} ${consumerName}. The underlying rejection is attached as the cause of this error.`;
}

/**
 * The server answers a publish to an unbound subject with `jetstream is not enabled`, which
 * names neither the subject nor the streams and sends operators looking for a disabled
 * JetStream. This states what was actually attempted and what this application declares.
 * The original rejection is preserved as `cause` rather than interpolated, so the misleading
 * text never reappears inside the replacement message.
 */
/** `"NAME" (subject, subject)` for each stream, in declaration order. */
function describeDeclarations(streams: ResolvedStream[]): string {
  return streams.map(stream => `"${stream.name}" (${stream.natsSubjects.join(', ')})`).join(', ');
}

/**
 * No declared stream binds the pattern.
 *
 * Says what a fallback would cost rather than only that it was refused: nats-server accepts a
 * consumer whose filter matches nothing the stream holds, so a guessed binding is not caught
 * downstream — it produces a live, empty subscription and no diagnostic anywhere.
 */
function unboundStreamMessage(pattern: string, natsSubject: string, streams: ResolvedStream[]): string {
  return `No declared stream binds "${pattern}" (as NATS subject "${natsSubject}"). This application declares ${describeDeclarations(streams)}. Refusing to guess: nats-server accepts a consumer whose filter matches nothing the stream holds, so a guessed binding would produce a subscription that is alive, healthy and permanently empty — and on deleteDurableConsumer it would remove a same-named consumer from an unrelated stream. Declare a stream that binds this subject, using the identical definition its owner uses.`;
}

/**
 * More than one declared stream qualifies, on the same pass.
 *
 * `relation` is how the candidates relate to the subject — "binds all of" on the coverage pass,
 * "holds part of" on the overlap pass — so the message says which kind of tie this is.
 */
function ambiguousStreamMessage(
  pattern: string,
  natsSubject: string,
  candidates: ResolvedStream[],
  relation: string,
): string {
  return `"${pattern}" (as NATS subject "${natsSubject}") is claimed by more than one declared stream: ${describeDeclarations(candidates)} — each ${relation} it. Refusing to guess which: the durable consumer name is derived from the group and the pattern and does not include the stream, so resolving differently on a later boot would create the same durable on another stream and orphan the first along with its delivery position. Streams also differ in retention, limits and storage, so the choice is not neutral. Narrow the declarations until exactly one binds this subject.`;
}

function publishFailureMessage(pattern: string, natsSubject: string, streams: ResolvedStream[]): string {
  const declared = streams.length > 0
    ? describeDeclarations(streams)
    : 'no streams at all';

  return `Failed to publish OneBun pattern "${pattern}" to JetStream subject "${natsSubject}". The most common cause is that no stream on the broker binds that subject. This application declares ${declared}. A subject must be bound by a stream before anything can be published to it, so check that the producer and the consumer declare identical stream definitions and that the stream exists on this server. The underlying rejection is attached as the cause of this error.`;
}

function streamNarrowingMessage(streamName: string, dropped: string[], configured: string[]): string {
  return `Stream "${streamName}" already stores subjects that this application's declaration would no longer cover: ${dropped.join(', ')}. Applying it would stop those subjects being stored and silently drop their messages. This application declares ${configured.join(', ')}. Every service sharing a stream must declare identical subjects, or at least a superset of what the stream already binds.`;
}

function streamCreateOnlyMessage(streamName: string, fields: string[]): string {
  return `Stream "${streamName}" diverges from this application's declaration on ${fields.join(', ')}, which cannot be changed on an existing stream. Align the declaration with the server, or delete the stream and let OneBun recreate it — deleting discards every message it holds: nats stream rm ${streamName}`;
}

function streamCycleMessage(
  streamName: string,
  currentHash: string,
  desiredHash: string,
  fields: string[],
): string {
  const diverging = fields.length > 0 ? fields.join(', ') : 'unknown';

  return `Stream "${streamName}" is in a reconcile cycle: OneBun wants config hash ${desiredHash}, which was already applied within the last ${CONFIG_CYCLE_WINDOW_MS}ms and has since been replaced by ${currentHash}. Diverging fields: ${diverging}. Two processes are writing different stream configurations — align the stream definitions across them.`;
}

function streamWriteFailureMessage(streamName: string, action: string, cause: unknown): string {
  const detail = describeCause(cause);
  const versionHint = /requires server/i.test(detail)
    ? ' The configuration stamp is stored in stream metadata, which requires nats-server 2.10 or newer.'
    : '';

  return `Failed to ${action} JetStream stream "${streamName}": ${detail}.${versionHint}`;
}

function ephemeralCollisionMessage(consumerName: string, streamName: string): string {
  return `JetStream consumer name "${consumerName}" is already taken on stream "${streamName}", so this ephemeral subscription would hijack an existing consumer. Retry the subscription, or pass a "group" to @Subscribe so it gets a stable durable name instead of a generated one.`;
}

/**
 * The dynamically imported client module. `typeof import` is a pure type position and is fully
 * erased under `verbatimModuleSyntax`, so it costs no static import: the package stays
 * loadable without the peer dependency present, and `mock.module` still intercepts the only
 * live edge.
 */
type JetStreamModule = typeof import('@nats-io/jetstream');

// Import JetStream types dynamically
let jetstreamModule: JetStreamModule | null = null;

async function getJetStreamModule(): Promise<JetStreamModule> {
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

class JetStreamMessage<T> implements Message<T>, NackAwareMessage {
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
  private jsMsg: JsMsg;
  /**
   * Supplied only when the subscription configured `deadLetter`. It republishes and then
   * terminates, so `nack(false)` must not `term()` on its own when this is present.
   */
  private readonly deadLetter?: (error?: Error) => Promise<void>;
  /**
   * False under `ackMode: 'none'`, where `ack()` and `nack()` are documented no-ops.
   * The server tracks nothing under `ack_policy: none`, so an ack, a nak or a term is a
   * round trip it discards — and a `term()` in particular would contradict the mode's
   * promise that a handler cannot influence delivery at all.
   */
  private readonly tracksDelivery: boolean;

  constructor(
    id: string,
    pattern: string,
    data: T,
    timestamp: number,
    metadata: MessageMetadata,
    jsMsg: JsMsg,
    maxAttempts?: number,
    deadLetter?: (error?: Error) => Promise<void>,
    serverTracksDelivery = true,
  ) {
    this.id = id;
    this.pattern = pattern;
    this.data = data;
    this.timestamp = timestamp;
    this.metadata = metadata;
    this.jsMsg = jsMsg;
    this.redelivered = jsMsg?.info?.redelivered ?? false;
    // Read from the wire in the same place `redelivered` is: the server counts deliveries,
    // and that count is 1-based, so the documented `attempt >= maxAttempts` comparison
    // works as written. The cap is threaded in because only the subscription knows it.
    this.attempt = jsMsg?.info?.deliveryCount;
    this.maxAttempts = maxAttempts;
    this.deadLetter = deadLetter;
    this.tracksDelivery = serverTracksDelivery;
  }

  /**
   * True once `nack()` has been called, so the consume loop can report the message as
   * failed rather than processed — and so its own auto-ack does not settle a message the
   * handler just asked the server to redeliver. Not on the public `Message` interface —
   * see `NackAwareMessage` in `@onebun/core`.
   */
  get wasNacked(): boolean {
    return this.nacked;
  }

  async ack(): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.acked = true;
    // Recorded but not sent under 'none': the disposition still decides which lifecycle
    // event the loop emits, it just never reaches a server that is tracking nothing.
    if (this.tracksDelivery && this.jsMsg?.ack) {
      this.jsMsg.ack();
    }
  }

  async nack(requeue = false): Promise<void> {
    if (this.acked || this.nacked) {
      return;
    }
    this.nacked = true;

    if (!this.tracksDelivery) {
      return;
    }

    if (requeue) {
      // `nak()` with no delay asks the server to redeliver immediately, up to max_deliver.
      this.jsMsg.nak();

      return;
    }

    // `requeue: false` means do not deliver this message again. With a dead-letter queue
    // configured that means "park it there first" — the same disposition the Redis adapter
    // gives `onNack(false)` — and the router terminates the original once the copy is safely
    // published. Without one it is a bare `term()`.
    if (this.deadLetter) {
      await this.deadLetter();

      return;
    }

    // The previous code passed an options object to `nak`, whose signature takes a delay in
    // milliseconds, so the object became NaN and reached the wire as a null delay: a plain nak
    // that redelivered the message up to max_deliver times, the opposite of what was asked.
    this.jsMsg.term();
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
  consumer: Consumer;
  running: boolean;
  /** Resolved once in subscribe(); the consume-loop restart must not recompute it. */
  consumeBatch: number;
  streamName: string;
  consumerName: string;
  /** A `group` makes the consumer durable, and a durable is never deleted implicitly. */
  durable: boolean;
  /** The live pull handle, so a release can close it instead of leaking the loop. */
  messages: ConsumerMessages | null;
  /** The pending restart, so a release inside the restart window can cancel it. */
  restartTimer: ReturnType<typeof setTimeout> | null;
  /**
   * The `max_deliver` this subscription's consumer was actually created with, resolved
   * once. Never recomputed at consume time: with reconciliation the server-side consumer
   * is authoritative, and re-deriving the precedence chain in the loop could disagree
   * with the consumer that really exists.
   */
  maxDeliver: number;
  /** Kept so a re-created consumer is rebuilt from the same inputs, not re-derived. */
  filterSubject: string;
  resolved: ResolvedConsumerConfig;
  /**
   * The handler currently executing, so shutdown can wait for it. At most one is ever
   * pending: the loop awaits each handler before pulling the next message.
   */
  inFlight: Promise<void> | null;
}

/**
 * Awaits `promise`, giving up after `timeoutMs`. Never rejects, and never leaves the
 * timer pending — a dangling 30s timer would keep the process alive past the shutdown
 * this is called from.
 */
async function awaitBounded(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);

  if (timer !== undefined) {
    clearTimeout(timer);
  }
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
 * - Dead letter queue support — `deadLetter.queue` must be a literal subject bound by a
 *   declared stream, and `deadLetter.maxRetries` feeds `max_deliver` behind `retry.attempts`
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
 *
 * @see docs:api/queue.md
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
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;

  // Event handlers
  private eventHandlers: Map<keyof QueueEvents, Set<(...args: unknown[]) => void>> = new Map();

  constructor(private readonly options: JetStreamAdapterOptions) {
    if (!options.streams.length) {
      throw new Error('JetStreamQueueAdapter requires at least one stream definition');
    }

    this.client = new NatsClient(options);

    const defaults = options.streamDefaults ?? {};
    this.resolvedStreams = options.streams.map((s) => ({
      ...defaults,
      ...s,
      natsSubjects: s.subjects.map((subj) => toNatsSubject(subj)),
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

    const entries = this.subscriptions;
    this.subscriptions = [];

    // Stop pulling first, then drain: `running = false` makes each loop hand the next
    // message back instead of starting a handler the drain would have to wait for. The
    // drain is its own step rather than part of the release below because the two are
    // bounded differently — 30s for the application's handler, 5s for the network
    // teardown that follows it.
    for (const entry of entries) {
      entry.running = false;
    }
    await this.drainHandlers(entries);

    // Release every subscription while the connection is still usable — the server-side
    // delete needs it, and `client.disconnect()` below would strand any ephemeral consumer.
    const releases = entries.map(entry => this.releaseSubscription(entry));
    await awaitBounded(Promise.allSettled(releases), RELEASE_TIMEOUT_MS);

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

    // `||`, not `??`: an empty string is not an id. It must fall back to a generated one
    // AND leave deduplication off, so both halves agree on what "absent" means.
    const messageId = options?.messageId || this.generateMessageId();
    const timestamp = Date.now();

    const messageData = {
      id: messageId,
      pattern,
      data,
      timestamp,
      metadata: options?.metadata ?? {},
    };

    const encoder = new TextEncoder();

    // Named parameters and `#` have no wire form; this is the only translation.
    const natsSubject = toNatsSubject(pattern);

    // No pre-flight check against the locally declared streams: a subject may legitimately
    // be bound by a stream this application never declares. Only the broker knows, so the
    // publish is attempted and its rejection is re-reported with the context the server omits.
    // Only a CALLER-supplied id enables deduplication. A generated one is unique per call,
    // so sending it would grow the server's dedup index without ever matching anything. The
    // truthy check also rejects '', matching the client's own `if (opts.msgID)` guard.
    const publishOptions = options?.messageId ? { msgID: options.messageId } : undefined;

    try {
      await this.js!.publish(natsSubject, encoder.encode(JSON.stringify(messageData)), publishOptions);
    } catch (cause) {
      throw new Error(publishFailureMessage(pattern, natsSubject, this.resolvedStreams), { cause });
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

    const jsModule = await getJetStreamModule();

    // The filter widens to a NATS subject; `entry.matcher`, built from the original
    // pattern, narrows it back and extracts the named parameters.
    const filterSubject = toNatsSubject(pattern);

    if (options?.deadLetter !== undefined) {
      validateDeadLetterQueue(options.deadLetter.queue, pattern);
    }

    // A durable is identified per (group, pattern), not per group: two subscriptions
    // sharing a group but filtering different subjects are two different consumers, and
    // naming them both after the group made the second silently steal the first's.
    const consumerName = options?.group === undefined
      ? `consumer-${crypto.randomUUID()}`
      : durableConsumerName(options.group, filterSubject);

    // Acknowledgements are always tracked server-side; `ackMode` only decides whether
    // the adapter acks on the handler's behalf or the handler acks for itself.
    // deliver_policy is set explicitly: the server default is not part of any contract, and
    // a durable created before this release would otherwise replay the whole stream once.
    // The ONLY site in the package that selects the none policy: `'none'` is the one mode that turns
    // server-side acknowledgement tracking off entirely.
    const resolved = resolveConsumerConfig(
      resolveAckMode(options) === 'none' ? jsModule.AckPolicy.None : jsModule.AckPolicy.Explicit,
      jsModule.DeliverPolicy.New,
      options,
      this.options.consumerConfig,
    );

    // Resolve which stream this subject belongs to
    const streamName = this.resolveStreamForSubject(pattern);

    await this.ensureConsumer(
      jsModule,
      streamName,
      consumerName,
      Boolean(options?.group),
      filterSubject,
      resolved,
      pattern,
    );

    const consumer = await this.js!.consumers.get(streamName, consumerName);

    const entry: JetStreamSubscriptionEntry = {
      pattern,
      handler: handler as MessageHandler,
      options,
      matcher: createQueuePatternMatcher(pattern),
      paused: false,
      consumer,
      consumeBatch: resolved.consumeBatch,
      running: true,
      streamName,
      consumerName,
      durable: Boolean(options?.group),
      messages: null,
      restartTimer: null,
      maxDeliver: resolved.maxDeliver,
      filterSubject,
      resolved,
      inFlight: null,
    };

    this.subscriptions.push(entry);

    // Start consuming messages
    this.consumeMessages(entry);

    const subscription = new JetStreamSubscription(entry, async () => {
      const index = this.subscriptions.indexOf(entry);
      if (index !== -1) {
        this.subscriptions.splice(index, 1);
      }
      await this.releaseSubscription(entry);
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
          console.error(`[JetStreamQueueAdapter] a "${event}" listener threw`, error);
        }
      }
    }
  }

  /**
   * Reconciles one JetStream consumer: probe, classify, then create or stamp.
   *
   * A `consumers.info` rejection is treated as absence ONLY when it carries the numeric
   * ConsumerNotFound API code. Anything else — auth denied, JetStream disabled, a
   * transport timeout — is rethrown as itself, because creating a consumer on the
   * strength of an unclassified error is how a permissions problem turns into a
   * "consumer not found" three lines later.
   *
   * @see docs:api/queue.md
   */
  private async ensureConsumer(
    jsModule: JetStreamModule,
    streamName: string,
    consumerName: string,
    isDurable: boolean,
    filterSubject: string,
    resolved: ResolvedConsumerConfig,
    pattern: string,
  ): Promise<void> {
    const desiredHash = hashReconcileConfig({
      ack_wait: resolved.tracksDelivery ? resolved.ackWait : undefined,
      filter_subject: filterSubject,
      max_ack_pending: resolved.tracksDelivery ? resolved.maxAckPending : undefined,
      max_deliver: resolved.tracksDelivery ? resolved.maxDeliver : undefined,
    });

    let existing: ConsumerInfo;
    try {
      existing = await this.jsm!.consumers.info(streamName, consumerName);
    } catch (error) {
      if (!isNotFoundError(error, jsModule.JetStreamApiCodes.ConsumerNotFound)) {
        this.emit('onError', error as Error);
        throw error;
      }

      await this.addConsumer(
        streamName,
        consumerName,
        isDurable,
        filterSubject,
        resolved,
        desiredHash,
        pattern,
      );

      return;
    }

    // Snapshot before any update: the client's update() mutates the ConsumerInfo it
    // re-reads, so anything held afterwards is post-merge state.
    const config = existing.config ?? {};
    const metadata = config.metadata as StampMetadata | undefined;

    // Identity first: telling an operator to delete a randomly named consumer that
    // belongs to someone else is worse than useless.
    if (!isDurable) {
      throw this.failConsumer(ephemeralCollisionMessage(consumerName, streamName));
    }

    // Before decideStamp: a legacy consumer could carry a matching hash, in which case
    // a stamp-first order would return noop and leave acknowledgements disabled.
    //
    // Compared against what THIS subscription wants, not against Explicit outright. A
    // durable created under `ackMode: 'none'` is legitimately `ack_policy: none`, and
    // asserting Explicit here rejected the consumer the previous boot had just created —
    // permanently, because ack_policy is create-only and the recreated one is `none` again.
    if (config.ack_policy !== resolved.ackPolicy) {
      throw this.failConsumer(
        ackPolicyMigrationMessage(
          consumerName,
          streamName,
          String(config.ack_policy ?? ''),
          String(resolved.ackPolicy),
        ),
      );
    }

    const decision = decideStamp(metadata, desiredHash);

    if (decision.action === 'noop') {
      return;
    }

    if (decision.action === 'cycle') {
      throw this.failConsumer(cycleMessage(
        consumerName,
        streamName,
        decision.currentHash,
        decision.desiredHash,
        this.divergingFields(config, filterSubject, resolved),
      ));
    }

    try {
      await this.jsm!.consumers.update(streamName, consumerName, {
        filter_subject: filterSubject,
        metadata: stampMetadata(metadata, desiredHash, decision.prevHash),
        ...redeliveryConfig(resolved),
      });
    } catch (cause) {
      throw this.failConsumer(
        updateFailureMessage(
          consumerName,
          streamName,
          pattern,
          filterSubject,
          this.resolvedStreams,
          cause,
        ),
        cause,
      );
    }
  }

  /** Creates the consumer, stamping the hash that the next boot compares against. */
  private async addConsumer(
    streamName: string,
    consumerName: string,
    isDurable: boolean,
    filterSubject: string,
    resolved: ResolvedConsumerConfig,
    desiredHash: string,
    pattern: string,
  ): Promise<void> {
    try {
      await this.jsm!.consumers.add(streamName, {
        durable_name: isDurable ? consumerName : undefined,
        name: consumerName,
        ack_policy: resolved.ackPolicy,
        deliver_policy: resolved.deliverPolicy,
        filter_subject: filterSubject,
        metadata: stampMetadata(undefined, desiredHash),
        ...redeliveryConfig(resolved),
      });
    } catch (cause) {
      throw this.failConsumer(
        addFailureMessage(
          consumerName,
          streamName,
          pattern,
          filterSubject,
          this.resolvedStreams,
          cause,
        ),
        cause,
      );
    }
  }

  /**
   * Builds a consumer error, emitting it before it is thrown.
   *
   * `subscribe()` is awaited during boot before any `@OnQueueError` handler is
   * registered, so a throw alone would reach nobody who registered a listener.
   */
  private failConsumer(message: string, cause?: unknown): Error {
    const error = cause === undefined ? new Error(message) : new Error(message, { cause });
    this.emit('onError', error);

    return error;
  }

  /** Names the fields that differ, so a cycle error says what the two writers disagree on. */
  /**
   * The fields that disagree, each reported with BOTH values.
   *
   * The two config hashes in the message identify the writers but say nothing an operator
   * can act on; the value pair is what turns "align consumerConfig" into a concrete edit.
   */
  private divergingFields(
    config: ConsumerConfig,
    filterSubject: string,
    resolved: ResolvedConsumerConfig,
  ): string[] {
    const fields: string[] = [];
    const diff = (field: string, ours: unknown, theirs: unknown): void => {
      if (ours !== theirs) {
        fields.push(`${field} (this process ${String(ours)}, on server ${String(theirs)})`);
      }
    };

    diff('filter_subject', filterSubject, config.filter_subject);

    // Under 'none' these are never sent, so the server's values are not ours to compare.
    if (!resolved.tracksDelivery) {
      return fields;
    }

    diff('ack_wait', resolved.ackWait, config.ack_wait);
    diff('max_ack_pending', resolved.maxAckPending, config.max_ack_pending);
    diff('max_deliver', resolved.maxDeliver, config.max_deliver);

    return fields;
  }

  /**
   * Removes a durable consumer this application created for `(pattern, group)`.
   *
   * `unsubscribe()` and `disconnect()` deliberately never touch a durable — they run on
   * every graceful shutdown, and deleting there would discard the consumer's position on
   * each deploy. This is the explicit way to decommission one, for the case that actually
   * needs it: a `group` that was templated per run or per deploy and has left a trail of
   * consumers behind on the server.
   *
   * Stream resolution goes through the same `resolveStreamForSubject` that `subscribe()` uses,
   * and must: a delete has to name exactly the stream the subscription bound to, or it cannot
   * decommission what `subscribe()` created.
   *
   * It used to have a private strict twin, `requireStreamForSubject`, byte-identical except for
   * the no-match branch — the twin threw, the public one fell back to the first declaration. Two
   * copies of one predicate, and neither handled ambiguity: both returned whichever candidate
   * came first. Now that the public resolver refuses instead of guessing, the twin had no reason
   * to exist, and one implementation cannot drift from itself.
   *
   * @param pattern - The subscription pattern the consumer was created for.
   * @param group - The `group` the subscription declared.
   * @returns `true` when a consumer was removed, `false` when there was none to remove.
   * @throws If the adapter is not connected, if no declared stream binds the pattern, or on
   *   any server rejection other than consumer-not-found — a permissions denial must not be
   *   reported as "already gone".
   *
   * @see docs:api/queue.md
   */
  async deleteDurableConsumer(pattern: string, group: string): Promise<boolean> {
    this.ensureConnected();

    const jsModule = await getJetStreamModule();
    const streamName = this.resolveStreamForSubject(pattern);
    const consumerName = durableConsumerName(group, toNatsSubject(pattern));

    try {
      return await this.jsm!.consumers.delete(streamName, consumerName);
    } catch (error) {
      if (isNotFoundError(error, jsModule.JetStreamApiCodes.ConsumerNotFound)) {
        return false;
      }

      throw error;
    }
  }

  /**
   * The declared stream a subscription to `subject` must bind to.
   *
   * Resolved locally, against the streams this application declares. There is no broker lookup
   * and none would help: `$JS.API.STREAM.NAMES` answers "which streams on this broker bind this
   * subject", while `consumers.add` needs "which stream *this application declared* for it", and
   * on a shared broker those differ.
   *
   * There is no fallback, and no fallback is safe. Measured against nats-server 2.10: a
   * `filter_subject` completely unrelated to what the stream holds is ACCEPTED, stored verbatim,
   * and its consumer sits at zero pending forever — a subscription that is alive, healthy and
   * permanently empty, with nothing logged on either side. The broker validates nothing here, so
   * this rule is the only thing standing between a typo and a dead handler.
   *
   * Coverage is consulted first, so a stream binding the whole pattern wins outright over one
   * holding a slice of it. A tie in either pass is an error rather than a pick: `durableConsumerName`
   * omits the stream, so resolving the same pattern differently on a later boot would create the
   * same durable on another stream and orphan the first along with its delivery position — and
   * streams differ in retention, limits and storage, so the choice is not neutral either.
   *
   * @param subject - A OneBun pattern; translated here, so `orders.{id}` resolves as `orders.*`.
   * @returns The name of the one declared stream that binds it.
   * @throws If no declared stream binds the subject, or if more than one does.
   *
   * @see docs:api/queue.md
   */
  resolveStreamForSubject(subject: string): string {
    const natsSubject = toNatsSubject(subject);

    const covering = this.matchingStreams(natsSubject, this.natsSubjectCovers);

    if (covering.length === 1) {
      return covering[0].name;
    }

    if (covering.length > 1) {
      throw new Error(ambiguousStreamMessage(subject, natsSubject, covering, 'binds all of'));
    }

    const overlapping = this.matchingStreams(natsSubject, this.natsSubjectsOverlap);

    if (overlapping.length === 1) {
      return overlapping[0].name;
    }

    if (overlapping.length > 1) {
      throw new Error(ambiguousStreamMessage(subject, natsSubject, overlapping, 'holds part of'));
    }

    throw new Error(unboundStreamMessage(subject, natsSubject, this.resolvedStreams));
  }

  /**
   * The declared streams satisfying `predicate` for `natsSubject`, each counted once.
   *
   * `some` rather than a second loop, so a stream declaring `['orders.>', 'orders.created']` is
   * ONE candidate: counting its matching subjects instead would make a single well-formed stream
   * look like an ambiguity and refuse to resolve.
   *
   * Two declarations that share a `name` stay two candidates, and therefore resolve to an
   * ambiguity refusal. That is the right outcome — one name with two definitions is a
   * configuration error, and reconciliation would apply whichever came last.
   */
  private matchingStreams(
    natsSubject: string,
    predicate: (declared: string, subject: string) => boolean,
  ): ResolvedStream[] {
    return this.resolvedStreams.filter(
      stream => stream.natsSubjects.some(declared => predicate(declared, natsSubject)),
    );
  }

  /**
   * Does `declared` bind every concrete subject `subject` can name?
   *
   * COVERAGE — asymmetric, and strictly stronger than {@link natsSubjectsOverlap}. This is what
   * `droppedSubjects` needs: "is a subject the server already holds still bound by what I
   * declare". Answering overlap there would wave a narrowing declaration through, and the
   * messages would stop being stored without a word.
   *
   * Both sides may carry wildcards, which is the correction. The previous `natsSubjectMatches`
   * honoured `*` and `>` on the FIRST argument only, so `('orders.*', 'orders.>')` answered true —
   * false, because `orders.a.b` matches `orders.>` and not `orders.*`. Where the second argument
   * is wildcard-free this is bit-for-bit the old behaviour.
   *
   * Branch order is load-bearing: `s` exhausted before `d[i] === '*'`, `s[j] === '>'` before
   * `d[i] === '*'`, and `d[i] === '*'` before `s[j] === '*'`.
   *
   * @see docs:api/queue.md
   */
  private natsSubjectCovers(declared: string, subject: string): boolean {
    const d = declared.split('.');
    const s = subject.split('.');
    let i = 0;
    let j = 0;

    for (;;) {
      const dDone = i >= d.length;
      const sDone = j >= s.length;

      if (dDone && sDone) {
        return true;
      }

      // `s` reaches deeper than `d` binds.
      if (dDone) {
        return false;
      }

      // `>` absorbs one or more tokens, never zero.
      if (d[i] === '>') {
        return !sDone;
      }

      // `d` still requires tokens that `s` cannot produce.
      if (sDone) {
        return false;
      }

      // `s` permits any depth from here; a single `d` token cannot cover that.
      if (s[j] === '>') {
        return false;
      }

      // `*` covers any single token, `*` included.
      if (d[i] === '*') {
        i++;
        j++;
        continue;
      }

      // `s` permits any token here; `d[i]` is one literal.
      if (s[j] === '*') {
        return false;
      }

      if (d[i] !== s[j]) {
        return false;
      }

      i++;
      j++;
    }
  }

  /**
   * Is there any concrete subject that both `a` and `b` name?
   *
   * Symmetric, and strictly weaker than {@link natsSubjectCovers} — coverage implies overlap,
   * which is what makes consulting coverage first well-founded.
   *
   * Kept as a SEPARATE predicate rather than relaxing the coverage one. That is not tidiness: one
   * `natsSubjectMatches` already served both `droppedSubjects` (which needs coverage) and stream
   * resolution (which wants overlap), and the mismatch is the defect being closed here. A future
   * refactor that "notices the duplication" and merges them re-opens it in the reconciler, where
   * it is silent. The names carry the entire distinction.
   *
   * @see docs:api/queue.md
   */
  private natsSubjectsOverlap(a: string, b: string): boolean {
    const left = a.split('.');
    const right = b.split('.');
    const common = Math.min(left.length, right.length);

    for (let i = 0; i < common; i++) {
      const ta = left[i];
      const tb = right[i];

      // Reaching `i < common` guarantees both sides still hold a token here, so the `>` has at
      // least one token to absorb and everything beyond it is free on both sides.
      if (ta === '>' || tb === '>') {
        return true;
      }

      if (ta === '*' || tb === '*' || ta === tb) {
        continue;
      }

      return false;
    }

    // No `>` anywhere in the common prefix, so neither side can reach the other's surplus.
    return left.length === right.length;
  }

  private async ensureAllStreams(): Promise<void> {
    for (const stream of this.resolvedStreams) {
      await this.ensureStream(stream);
    }
  }

  /**
   * Builds the wire config for a stream, emitting ONLY the keys the application declared.
   *
   * An undeclared key must be absent, never present-and-undefined: the client merges an
   * update with a shallow `Object.assign`, so `max_msgs: undefined` overwrites whatever the
   * server had. That is how a stream pre-provisioned with limits used to be wiped on every
   * connect. The `retention`/`storage`/`num_replicas` fallbacks are create-only — `update`
   * cannot change the first two, and applying a default on update would rewrite a value the
   * application never asked about.
   */
  private buildStreamConfig(stream: ResolvedStream, forCreate: boolean): AnyStreamConfig {
    const config: AnyStreamConfig = {
      subjects: stream.natsSubjects,
    };

    if (stream.maxMsgs !== undefined) {
      config.max_msgs = stream.maxMsgs;
    }
    if (stream.maxBytes !== undefined) {
      config.max_bytes = stream.maxBytes;
    }
    if (stream.maxAge !== undefined) {
      config.max_age = stream.maxAge;
    }
    if (stream.duplicateWindow !== undefined) {
      config.duplicate_window = stream.duplicateWindow;
    }
    if (stream.replicas !== undefined) {
      config.num_replicas = stream.replicas;
    }

    if (forCreate) {
      config.name = stream.name;
      config.retention = stream.retention ?? 'limits';
      config.storage = stream.storage ?? 'file';
      config.num_replicas = stream.replicas ?? 1;
    }

    return config;
  }

  /**
   * The subset of the desired config that participates in the reconciliation hash.
   *
   * `name` and `metadata` are excluded so a stamp write does not itself change the hash.
   * `retention` and `storage` are excluded because `update` cannot carry them — divergence
   * there is the delete-and-recreate guard instead.
   */
  private hashableStreamSubset(config: AnyStreamConfig): Record<string, HashableStreamValue> {
    return {
      subjects: config.subjects,
      max_msgs: config.max_msgs,
      max_bytes: config.max_bytes,
      max_age: config.max_age,
      duplicate_window: config.duplicate_window,
      num_replicas: config.num_replicas,
    };
  }

  /**
   * Reconciles one JetStream stream: probe, guard, then create, no-op, update or fail.
   *
   * Branch order is load-bearing. Subject coverage is checked against the server's own
   * subject list before anything else, so a stale stamp left by an out-of-band
   * `nats stream edit` cannot wave a narrowing declaration through. The create-only
   * divergence guard runs next, for the same reason the consumer path checks its ack policy
   * before its hash: a matching hash must never mask a field that cannot be updated.
   *
   * @see docs:api/queue.md
   */
  private async ensureStream(stream: ResolvedStream): Promise<void> {
    const jsModule = await getJetStreamModule();
    const desired = this.buildStreamConfig(stream, false);
    const desiredHash = hashReconcileConfig(this.hashableStreamSubset(desired));

    let existing: StreamInfo;
    try {
      existing = await this.jsm!.streams.info(stream.name);
    } catch (error) {
      if (!isNotFoundError(error, jsModule.JetStreamApiCodes.StreamNotFound)) {
        this.emit('onError', error as Error);
        throw error;
      }

      await this.addStream(stream, desiredHash);

      return;
    }

    const config = existing.config ?? {};
    const metadata = config.metadata as StampMetadata | undefined;

    const dropped = this.droppedSubjects(config.subjects ?? [], stream.natsSubjects);
    if (dropped.length > 0) {
      throw this.failStream(streamNarrowingMessage(stream.name, dropped, stream.natsSubjects));
    }

    const diverging = this.divergingCreateOnlyFields(config, stream);
    if (diverging.length > 0) {
      throw this.failStream(streamCreateOnlyMessage(stream.name, diverging));
    }

    const decision = decideStamp(metadata, desiredHash);

    if (decision.action === 'noop') {
      return;
    }

    if (decision.action === 'cycle') {
      throw this.failStream(streamCycleMessage(
        stream.name,
        decision.currentHash,
        decision.desiredHash,
        this.divergingStreamFields(config, desired),
      ));
    }

    try {
      await this.jsm!.streams.update(stream.name, {
        ...desired,
        metadata: stampMetadata(metadata, desiredHash, decision.prevHash),
      });
    } catch (cause) {
      throw this.failStream(streamWriteFailureMessage(stream.name, 'update', cause), cause);
    }
  }

  /** Creates the stream, stamping the hash the next connect compares against. */
  private async addStream(stream: ResolvedStream, desiredHash: string): Promise<void> {
    try {
      await this.jsm!.streams.add({
        ...this.buildStreamConfig(stream, true),
        // Restates what buildStreamConfig already set on the create path: `add` types
        // `name` as required, and a spread cannot prove that to the compiler.
        name: stream.name,
        metadata: stampMetadata(undefined, desiredHash),
      });
    } catch (cause) {
      throw this.failStream(streamWriteFailureMessage(stream.name, 'create', cause), cause);
    }
  }

  /** Builds a stream error, emitting it before it is thrown. */
  private failStream(message: string, cause?: unknown): Error {
    const error = cause === undefined ? new Error(message) : new Error(message, { cause });
    this.emit('onError', error);

    return error;
  }

  /**
   * Existing subjects that no configured subject would still cover.
   *
   * Asks the question per declared subject, which is not the same as asking whether the declared
   * SET still covers `existing`. A declaration of `['orders.*', 'orders.*.>']` covers a
   * server-held `orders.>` only jointly, and is reported here as a narrowing it is not. Deciding
   * union coverage is set cover over subject patterns rather than a pairwise predicate; it is
   * tracked separately. Erring this way keeps the guard sound — it can refuse a safe declaration,
   * never wave a narrowing one through.
   */
  private droppedSubjects(existingSubjects: string[], configured: string[]): string[] {
    return existingSubjects.filter(
      existing => !configured.some(pattern => this.natsSubjectCovers(pattern, existing)),
    );
  }

  /** Declared create-only fields whose value differs from the server's. */
  private divergingCreateOnlyFields(
    config: StreamConfig,
    stream: ResolvedStream,
  ): string[] {
    const fields: string[] = [];

    if (stream.storage !== undefined && config.storage !== stream.storage) {
      fields.push('storage');
    }
    if (stream.retention !== undefined && config.retention !== stream.retention) {
      fields.push('retention');
    }

    return fields;
  }

  /** Names the mutable fields that differ, so a cycle error says what the writers disagree on. */
  private divergingStreamFields(
    config: StreamConfig,
    desired: AnyStreamConfig,
  ): string[] {
    const fields: string[] = [];

    for (const key of ['subjects', 'max_msgs', 'max_bytes', 'max_age', 'num_replicas'] as const) {
      const want = desired[key];
      if (want === undefined) {
        continue;
      }
      if (JSON.stringify(config[key]) !== JSON.stringify(want)) {
        fields.push(key);
      }
    }

    return fields;
  }

  /**
   * Stops one subscription and gives back what it holds.
   *
   * Deleting the consumer is gated on `durable` and that gate is the whole point: a durable
   * exists to survive restarts, and `QueueService.stop()` unsubscribes on every graceful
   * shutdown — deleting one here would discard its ack floor on each deploy and redeliver
   * everything it had already acknowledged. Only the framework-generated ephemeral, which
   * nothing else can reach, is removed.
   *
   * @see docs:api/queue.md
   */
  private async releaseSubscription(entry: JetStreamSubscriptionEntry): Promise<void> {
    entry.running = false;

    if (entry.restartTimer !== null) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }

    // Before the pull handle closes and before the connection goes: a handler that is
    // still running has to be able to acknowledge, and `running = false` above means the
    // loop hands the NEXT message back rather than starting another one to wait for.
    await this.drainHandlers([entry]);

    if (entry.messages !== null) {
      // Closing wakes the `for await`, which is what actually ends the loop; setting
      // `running = false` alone leaves it parked until the next message arrives.
      await entry.messages.close().catch(() => undefined);
      entry.messages = null;
    }

    if (entry.durable || !this.client.isConnected()) {
      return;
    }

    await entry.consumer.delete().catch(() => undefined);
  }

  /**
   * Parks a message in the dead-letter queue, then terminates the original.
   *
   * The order is load-bearing. The copy is published FIRST and the original is terminated
   * only once that succeeded: if the republish fails the original is left exactly as it was,
   * so the server still redelivers it or exhausts `max_deliver` normally. Terminating first
   * would turn a failed republish into a lost message, which is the single outcome a
   * dead-letter queue exists to prevent.
   *
   * The republish goes through the adapter's own `publish()` rather than a second raw
   * `js.publish`, so subject translation and the publish diagnostics apply to dead letters
   * without a second convention to keep in step.
   *
   * Stream resolution does NOT apply: `publish()` never calls `resolveStreamForSubject`. It hands
   * the subject to the server and lets it route, which is why a dead-letter subject no stream
   * binds is not caught at startup — it surfaces as a republish failure the first time a message
   * is actually dead-lettered. `validateDeadLetterQueue` catches only a wildcard queue and a queue
   * equal to the subscription's own pattern.
   *
   * @see docs:api/queue.md
   */
  private async routeToDeadLetter(
    entry: JetStreamSubscriptionEntry,
    msg: JsMsg,
    message: Pick<Message, 'id' | 'pattern' | 'data' | 'metadata'>,
    error?: Error,
  ): Promise<void> {
    const queue = entry.options?.deadLetter?.queue;

    if (queue === undefined) {
      return;
    }

    try {
      await this.publish(queue, message.data, {
        messageId: message.id,
        /* eslint-disable @typescript-eslint/naming-convention -- namespaced provenance keys;
           the `dlq.` prefix keeps them from colliding with the caller's own metadata. */
        metadata: {
          ...message.metadata,
          'dlq.originalPattern': message.pattern,
          'dlq.deliveryCount': msg.info?.deliveryCount ?? 0,
          'dlq.error': error?.message ?? 'negative acknowledgement',
        },
        /* eslint-enable @typescript-eslint/naming-convention */
      });
    } catch (cause) {
      this.emit('onError', deadLetterRepublishError(queue, message.pattern, cause));

      return;
    }

    msg.term();
  }

  /**
   * Waits for the handlers these subscriptions are currently executing.
   *
   * Bounded by a fixed 30s: a handler that never returns must not hold shutdown open
   * forever. Once the budget is spent the entries are cleared, so a later release does
   * not start the wait again — the handler keeps running, the shutdown simply stops
   * blocking on it.
   *
   * @see docs:api/queue.md
   */
  private async drainHandlers(entries: readonly JetStreamSubscriptionEntry[]): Promise<void> {
    const pending = entries
      .map(entry => entry.inFlight)
      .filter((promise): promise is Promise<void> => promise !== null);

    if (pending.length === 0) {
      return;
    }

    await awaitBounded(Promise.allSettled(pending), HANDLER_DRAIN_TIMEOUT_MS);

    for (const entry of entries) {
      entry.inFlight = null;
    }
  }

  /**
   * Surfaces consumer notifications, and repairs the one that is repairable.
   *
   * A deleted consumer is the only notification the adapter can act on: it re-creates the
   * consumer from the inputs the subscription was built with and closes the pull handle so
   * the bounded restart re-opens the loop against the new one. `heartbeats_missed` and
   * `stream_not_found` are reported but deliberately not repaired — a missing stream is an
   * operator problem, and re-creating a consumer against one cannot help.
   *
   * @see docs:api/queue.md
   */
  private async watchConsumerStatus(
    entry: JetStreamSubscriptionEntry,
    messages: ConsumerMessages,
  ): Promise<void> {
    try {
      for await (const notification of messages.status()) {
        if (!entry.running) {
          return;
        }

        if (!isReportableNotification(notification)) {
          continue;
        }

        this.emit('onError', consumerNotificationError(entry.consumerName, entry.streamName, notification));

        if (notification.type === 'consumer_deleted' || notification.type === 'consumer_not_found') {
          await this.recreateConsumer(entry);
        }
      }
    } catch (error) {
      this.emit('onError', error as Error);
    }
  }

  /**
   * Rebuilds a vanished consumer from the subscription's own inputs.
   *
   * Routed through `ensureConsumer()` rather than a second `consumers.add`, so the ack
   * policy, delivery policy, naming and consumerConfig precedence are decided in exactly one
   * place. A re-creation that re-derived them could differ from the original — losing
   * `deliver_policy` alone would replay the entire retained stream.
   */
  private async recreateConsumer(entry: JetStreamSubscriptionEntry): Promise<void> {
    try {
      const jsModule = await getJetStreamModule();

      await this.ensureConsumer(
        jsModule,
        entry.streamName,
        entry.consumerName,
        entry.durable,
        entry.filterSubject,
        entry.resolved,
        entry.pattern,
      );

      entry.consumer = await this.js!.consumers.get(entry.streamName, entry.consumerName);

      // Closing wakes the parked `for await`; the bounded restart then re-opens the loop
      // against the consumer that now exists.
      const stale = entry.messages;
      entry.messages = null;
      await stale?.close().catch(() => undefined);
    } catch (error) {
      this.emit('onError', error as Error);
    }
  }

  private async consumeMessages(entry: JetStreamSubscriptionEntry): Promise<void> {
    const decoder = new TextDecoder();

    if (!entry.running) {
      return;
    }

    // Checked BEFORE consume(): pulling a batch while paused would hold messages the
    // handler is not going to look at, and every one of them would age out of ack_wait.
    if (entry.paused) {
      this.scheduleConsumeRestart(entry);

      return;
    }

    try {
      const messages = await entry.consumer.consume({
        max_messages: entry.consumeBatch,
      });
      entry.messages = messages;

      // Watched alongside the loop, not instead of it. When the consumer is deleted the
      // client neither yields, ends nor throws — it retries CONSUMER.INFO forever — so the
      // `for await` below parks and the subscription stalls with isConnected() still true.
      // The notification channel is the only place that fact surfaces.
      void this.watchConsumerStatus(entry, messages);

      for await (const msg of messages) {
        if (!entry.running || entry.paused) {
          // Hand it back rather than abandoning it: an un-acked message would sit in the
          // ack window until ack_wait expired, delaying the redelivery pause() implies.
          msg.nak();
          break;
        }

        // Parsing is its own branch. Folding it together with the handler call meant an
        // ack failure was misread as a parse failure and the message destroyed for it.
        let messageData: OneBunEnvelope;
        try {
          messageData = JSON.parse(decoder.decode(msg.data)) as OneBunEnvelope;
        } catch (error) {
          this.emit('onError', poisonMessageError(msg.subject, error));
          // Terminated, not acked and not retried: a payload that failed to parse will
          // fail identically on every redelivery, so max_deliver would only spend the
          // ack window on a message that can never succeed.
          msg.term();
          continue;
        }

        if (!isOneBunEnvelope(messageData)) {
          this.emit('onError', foreignEnvelopeError(msg.subject));
          msg.term();
          continue;
        }

        // Check if pattern matches
        const match = entry.matcher(messageData.pattern || msg.subject);
        if (!match.matched) {
          // Always ack, including under ackMode 'manual': a message this subscription
          // does not match is not the handler's to acknowledge, and under explicit acks
          // an unacked stray holds a max_ack_pending slot and redelivers until
          // max_deliver. Enough of them wedge the consumer permanently.
          msg.ack();
          continue;
        }

        const id = messageData.id || this.generateMessageId();
        const messagePattern = messageData.pattern || msg.subject;
        const metadata = messageData.metadata || {};

        // Built only when the subscription configured a dead-letter queue AND the broker
        // tracks delivery, so `nack(false)` keeps its bare `term()` behaviour everywhere
        // else. Under `ackMode: 'none'` the mode promises no dead-letter routing at all —
        // the automatic path is already gated by `acknowledgesAutomatically`, but a handler
        // calling `nack(false)` itself reaches this closure directly, so gating the closure
        // is what makes the promise true. Redis gates the same way in `onNack`.
        const toDeadLetter = entry.options?.deadLetter === undefined || !tracksDelivery(entry.options)
          ? undefined
          : (failure?: Error): Promise<void> => this.routeToDeadLetter(
            entry,
            msg,
            {
              id, pattern: messagePattern, data: messageData.data, metadata, 
            },
            failure,
          );

        const message = new JetStreamMessage(
          id,
          messagePattern,
          messageData.data,
          messageData.timestamp || Date.now(),
          metadata,
          msg,
          entry.maxDeliver,
          toDeadLetter,
          entry.resolved.tracksDelivery,
        );

        // Emit received event
        this.emit('onMessageReceived', message);

        try {
          // Retained, not just awaited: a shutdown that lands here must wait for this
          // handler to finish and acknowledge. `nc.drain()` flushes subscriptions but
          // never the application's loop body, and an ack published after close() is
          // buffered and then silently dropped.
          // A delivered message begins its own trace. Context follows the async graph, so a
          // message published from inside a request would otherwise make its handler — and
          // every later redelivery of it — a child of that finished request.
          entry.inFlight = inRootTraceScope(() => entry.handler(message));
          await entry.inFlight;
        } catch (error) {
          // Emit failed event
          this.emit('onMessageFailed', message, error as Error);

          // Auto-nack only in 'auto'. Under 'none' the server tracks nothing, so there is
          // no nak to send and no terminal delivery to route anywhere.
          if (acknowledgesAutomatically(entry.options)) {
            // On the delivery the server would otherwise make the last, park the payload in
            // the dead-letter queue instead of letting max_deliver exhaust it silently. Below
            // that threshold this is an ordinary retry.
            if (toDeadLetter !== undefined && (msg.info?.deliveryCount ?? 1) >= entry.resolved.maxDeliver) {
              await toDeadLetter(error as Error);
            } else {
              msg.nak();
            }
          }

          continue;
        } finally {
          entry.inFlight = null;
        }

        // Outside the handler's try: a failure here is an acknowledgement failure, not a
        // handler failure, and it belongs on onError rather than onMessageFailed.
        // `msg` is the raw JsMsg, so this bypasses the wrapper's first-call-wins guard: a
        // handler that already sent `nak()` or `term()` would have its disposition settled
        // out from under it, cancelling the redelivery it just asked for.
        if (acknowledgesAutomatically(entry.options) && !wasNacked(message)) {
          msg.ack();
        }

        // A handler that catches its own exception and nacks returns normally, so control
        // flow alone cannot tell the drop apart from a success.
        if (wasNacked(message)) {
          this.emit('onMessageFailed', message, nackedError(message));
        } else {
          this.emit('onMessageProcessed', message);
        }
      }
    } catch (error) {
      // A consumer error used to be indistinguishable from a healthy idle loop.
      this.emit('onError', error as Error);
    }

    entry.messages = null;
    this.scheduleConsumeRestart(entry);
  }

  /** Re-enters the consume loop after the restart delay, unless the subscription is gone. */
  private scheduleConsumeRestart(entry: JetStreamSubscriptionEntry): void {
    if (!entry.running) {
      return;
    }

    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      void this.consumeMessages(entry);
    }, CONSUME_RESTART_DELAY_MS);
  }
}

/**
 * Create a JetStream queue adapter
 *
 * @see docs:api/queue.md
 */
export function createJetStreamQueueAdapter(options: JetStreamAdapterOptions): JetStreamQueueAdapter {
  return new JetStreamQueueAdapter(options);
}
