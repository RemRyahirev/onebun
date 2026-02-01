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
 * JetStream adapter options
 */
export interface JetStreamAdapterOptions extends NatsConnectionOptions {
  /** Stream name to use */
  stream: string;

  /** Whether to create the stream if it doesn't exist */
  createStream?: boolean;

  /** Stream configuration (if creating) */
  streamConfig?: {
    /** Subjects to store in the stream */
    subjects?: string[];
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
  };

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
