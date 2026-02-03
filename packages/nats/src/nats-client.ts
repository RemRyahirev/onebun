/**
 * NATS Client Wrapper
 *
 * Wrapper around @nats-io/transport-node for easier usage.
 */

import type { NatsConnectionOptions } from './types';

const DEFAULT_TIMEOUT = 5_000; // 5 seconds

// Import NATS types dynamically to handle potential import issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let natsModule: any = null;

async function getNatsModule() {
  if (!natsModule) {
    natsModule = await import('@nats-io/transport-node');
  }

  return natsModule;
}

/**
 * NATS subscription wrapper
 */
export interface NatsSubscriptionHandle {
  /** Unsubscribe from the subject */
  unsubscribe(): void;
  /** Drain the subscription */
  drain(): Promise<void>;
}

/**
 * NATS message wrapper
 */
export interface NatsMessage {
  /** Subject the message was received on */
  subject: string;
  /** Message data as string */
  data: string;
  /** Reply subject if request-reply pattern */
  reply?: string;
  /** Message headers */
  headers?: Map<string, string[]>;
}

/**
 * NATS Client
 *
 * Simplified wrapper around the NATS.js client.
 */
export class NatsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nc: any = null;
  private readonly options: NatsConnectionOptions;

  constructor(options: NatsConnectionOptions) {
    this.options = options;
  }

  /**
   * Connect to NATS
   */
  async connect(): Promise<void> {
    if (this.nc) {
      return;
    }

    const nats = await getNatsModule();

    this.nc = await nats.connect({
      servers: this.options.servers,
      name: this.options.name,
      token: this.options.token,
      user: this.options.user,
      pass: this.options.pass,
      maxReconnectAttempts: this.options.maxReconnectAttempts,
      reconnectTimeWait: this.options.reconnectTimeWait,
      timeout: this.options.timeout,
      tls: this.options.tls ? {} : undefined,
    });
  }

  /**
   * Disconnect from NATS
   */
  async disconnect(): Promise<void> {
    if (this.nc) {
      await this.nc.drain();
      await this.nc.close();
      this.nc = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.nc !== null && !this.nc.isClosed();
  }

  /**
   * Publish a message
   */
  async publish(subject: string, data: string, headers?: Record<string, string>): Promise<void> {
    if (!this.nc) {
      throw new Error('Not connected to NATS');
    }

    const nats = await getNatsModule();
    const encoder = new TextEncoder();

    let natsHeaders;
    if (headers) {
      natsHeaders = nats.headers();
      for (const [key, value] of Object.entries(headers)) {
        natsHeaders.set(key, value);
      }
    }

    this.nc.publish(subject, encoder.encode(data), { headers: natsHeaders });
  }

  /**
   * Subscribe to a subject
   */
  async subscribe(
    subject: string,
    callback: (msg: NatsMessage) => void | Promise<void>,
    options?: { queue?: string },
  ): Promise<NatsSubscriptionHandle> {
    if (!this.nc) {
      throw new Error('Not connected to NATS');
    }

    const decoder = new TextDecoder();
    const sub = this.nc.subscribe(subject, { queue: options?.queue });

    // Start consuming messages
    (async () => {
      for await (const msg of sub) {
        const natsMsg: NatsMessage = {
          subject: msg.subject,
          data: decoder.decode(msg.data),
          reply: msg.reply,
          headers: msg.headers ? new Map(msg.headers.entries()) : undefined,
        };
        await callback(natsMsg);
      }
    })();

    return {
      unsubscribe: () => sub.unsubscribe(),
      drain: () => sub.drain(),
    };
  }

  /**
   * Request-reply pattern
   */
  async request(
    subject: string,
    data: string,
    options?: { timeout?: number },
  ): Promise<NatsMessage> {
    if (!this.nc) {
      throw new Error('Not connected to NATS');
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

     
    const response = await this.nc.request(subject, encoder.encode(data), {
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    });

    return {
      subject: response.subject,
      data: decoder.decode(response.data),
      reply: response.reply,
      headers: response.headers ? new Map(response.headers.entries()) : undefined,
    };
  }

  /**
   * Get the underlying NATS connection
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getConnection(): any {
    return this.nc;
  }
}

/**
 * Create a NATS client
 */
export function createNatsClient(options: NatsConnectionOptions): NatsClient {
  return new NatsClient(options);
}
