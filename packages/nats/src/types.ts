/**
 * NATS and JetStream Types
 */

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
}

/**
 * JetStream adapter options
 *
 * @see docs:api/queue.md
 */
export interface JetStreamAdapterOptions extends NatsConnectionOptions {
  /** Stream definitions — all are created/ensured during connect() */
  streams: StreamDefinition[];

  /** Default stream config merged into every stream definition */
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
