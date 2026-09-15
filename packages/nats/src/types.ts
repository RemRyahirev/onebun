/**
 * NATS and JetStream Types
 */

import type { NodeConnectionOptions } from '@nats-io/transport-node';

/**
 * NATS connection options
 */
export interface NatsConnectionOptions {
  /** NATS server(s) URL */
  servers: string | string[];

  /** Connection name (for debugging) */
  name?: string;

  /** Authentication token */
  token?: string;

  /** Username for authentication */
  user?: string;

  /** Password for authentication */
  pass?: string;

  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;

  /** Reconnect time wait in milliseconds */
  reconnectTimeWait?: number;

  /** Timeout for connection in milliseconds */
  timeout?: number;

  /** Enable TLS */
  tls?: boolean;

  /**
   * Subject prefix for the inboxes this client generates, instead of the driver's `_INBOX`.
   *
   * Every request/reply exchange lands here — the JetStream manager's API calls, a publish's
   * PubAck, every pull fetch — so on a broker that grants a tenant SUBSCRIBE on its own inbox
   * space only (`_INBOX_<tenant>_<app>.>` and nothing wider) the default prefix produces a
   * connection that opens and can then do nothing at all. Set it to the prefix the grant names.
   *
   * @see docs:api/queue.md
   */
  inboxPrefix?: string;

  /**
   * Driver options merged into what `@nats-io/transport-node` receives, last and winning.
   *
   * Everything above is named by OneBun and translated where the two disagree. This is the
   * escape hatch for everything else the driver accepts: without it, the option list above is
   * a ceiling, and a nats.js option OneBun has not named yet cannot be reached until
   * `@onebun/nats` ships a release that names it.
   *
   * @see docs:api/queue.md
   */
  driverOptions?: Partial<NodeConnectionOptions>;
}

/**
 * Stream definition for JetStream multi-stream configuration
 *
 * @see docs:api/queue.md
 */
export interface StreamDefinition {
  /** Stream name */
  name: string;
  /** Subjects stored in this stream */
  subjects: string[];
  /** Retention policy */
  retention?: 'limits' | 'interest' | 'workqueue';
  /** Maximum messages */
  maxMsgs?: number;
  /** Maximum bytes */
  maxBytes?: number;
  /** Maximum age in nanoseconds */
  maxAge?: number;
  /** Storage type */
  storage?: 'file' | 'memory';
  /**
   * How far back the server looks for a repeated `Nats-Msg-Id` when deduplicating, in
   * NANOSECONDS — the same unit as `maxAge`. Omit it and the server applies its own
   * default of two minutes, which is usually too short for an outbox that has to survive
   * a crash and a restart. Only sent when declared, so a window an operator configured out
   * of band is never reset.
   *
   * @see docs:api/queue.md
   */
  duplicateWindow?: number;
  /** Number of replicas */
  replicas?: number;
  /**
   * Whether this application reconciles the stream on the broker. Falls back to
   * `streamDefaults.manage`, then to `JetStreamAdapterOptions.manageStreams`, then to `true` —
   * the first two collapse into this field before it is read, because the adapter merges
   * `{ ...streamDefaults, ...definition }`.
   *
   * `false` declares the stream for subscription-to-stream resolution and nothing else: no
   * `STREAM.INFO` probe, no create, no update, and none of the guards that ride on them. That is
   * the shape a stream someone else owns has — a platform operator, an infrastructure repository,
   * another team — where a tenant-scoped user is granted no write on its configuration and the
   * reconcile pass fails the boot rather than converging.
   *
   * It governs the stream's own configuration and nothing else: `subscribe()` still creates and
   * reconciles its CONSUMER on that stream, which is a separate grant
   * (`$JS.API.CONSUMER.*.<stream>.>`) and the one a consuming tenant is normally given.
   *
   * The cost is that a stream that is missing or bound to different subjects is no longer caught
   * at `app.start()`; it surfaces at the first `publish()` or `subscribe()` instead.
   *
   * @see docs:api/queue.md
   */
  manage?: boolean;
}

/**
 * JetStream adapter options
 *
 * @see docs:api/queue.md
 */
export interface JetStreamAdapterOptions extends NatsConnectionOptions {
  /**
   * Stream definitions. Each managed one is reconciled during `connect()`; every one of them,
   * managed or not, is a candidate when a subscription resolves its stream.
   *
   * Omitted or empty is legal and means publish-only: `publish()` addresses a subject and lets
   * the server route it, so it needs no declaration at all. `subscribe()` does — the API it
   * calls takes a stream name — and refuses with a message saying so.
   */
  streams?: StreamDefinition[];

  /**
   * Whether this application reconciles the streams it declares. Default `true`.
   *
   * The adapter-wide setting; `StreamDefinition.manage` overrides it per stream, which is what
   * a unit that owns some of its streams and merely reads from the rest needs.
   */
  manageStreams?: boolean;

  /**
   * Default stream config merged into every stream definition.
   *
   * Per-stream values win, `manage` included — so `streamDefaults: { manage: false }` and
   * `manageStreams: false` say the same thing, and a stream may still opt back in.
   */
  streamDefaults?: Omit<StreamDefinition, 'name' | 'subjects'>;

  /**
   * Default consumer configuration, applied to every subscription unless the
   * subscription overrides it.
   */
  consumerConfig?: {
    /**
     * Acknowledgment wait time in NANOSECONDS, applied to every consumer this adapter
     * creates. `SubscribeOptions.ackTimeout` — which is in milliseconds — overrides it
     * per subscription.
     */
    ackWait?: number;
    /** Maximum deliveries before the message is dead-lettered. `retry.attempts`, then `deadLetter.maxRetries`, override it. */
    maxDeliver?: number;
    /** Maximum pending acknowledgments. `prefetch` on the subscription overrides it. */
    maxAckPending?: number;
  };
}

/**
 * NATS adapter options (pub/sub only)
 */
export interface NatsAdapterOptions extends NatsConnectionOptions {
  // No additional options for basic NATS
}
