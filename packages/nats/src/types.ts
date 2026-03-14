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
  /** Number of replicas */
  replicas?: number;
}

/**
 * JetStream adapter options
 */
export interface JetStreamAdapterOptions extends NatsConnectionOptions {
  /** Stream definitions — all are created/ensured during connect() */
  streams: StreamDefinition[];

  /** Default stream config merged into every stream definition */
  streamDefaults?: Omit<StreamDefinition, 'name' | 'subjects'>;

  /** Default consumer configuration */
  consumerConfig?: {
    /** Acknowledgment wait time in nanoseconds */
    ackWait?: number;
    /** Maximum number of deliveries before moving to DLQ */
    maxDeliver?: number;
    /** Maximum pending acknowledgments */
    maxAckPending?: number;
  };
}

/**
 * NATS adapter options (pub/sub only)
 */
export interface NatsAdapterOptions extends NatsConnectionOptions {
  // No additional options for basic NATS
}
