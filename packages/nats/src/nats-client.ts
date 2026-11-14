/**
 * NATS Client Wrapper
 *
 * Wrapper around @nats-io/transport-node for easier usage.
 */

import type { NatsConnectionOptions } from './types';
import type {
  Msg,
  MsgHdrs,
  NodeConnectionOptions,
  Subscription,
} from '@nats-io/transport-node';

import { QueuePublishError } from '@onebun/core';

import { natsPublishError } from './publish-failure';

const DEFAULT_TIMEOUT = 5_000; // 5 seconds

/**
 * The options OneBun hands to the driver under the same name and with the same value.
 *
 * `tls` is translated rather than copied, and `driverOptions` is merged rather than passed, so
 * both are excluded. Everything else in `NatsConnectionOptions` must appear in
 * `toDriverOptions`'s literal — that is what the `satisfies` there enforces.
 */
type PassthroughKey = Exclude<keyof NatsConnectionOptions, 'tls' | 'driverOptions'>;

/**
 * Translates OneBun's connection options into the driver's.
 *
 * Pure and exported so the mapping can be asserted directly: the one thing that matters here is
 * that no declared option is silently dropped on the way out, and a test that goes through
 * `connect()` cannot see the object at all — the driver is resolved through a module-level
 * dynamic import, and `mock.module` is banned in this repo.
 *
 * The `satisfies Record<PassthroughKey, unknown>` is the guard, not decoration. An inline
 * allow-list would drop whatever nobody remembered to add to it, leaving an option such as
 * `inboxPrefix` undeliverable while it sits in the type. With the guard, a new field on
 * `NatsConnectionOptions` fails to compile until it is forwarded or deliberately excluded above.
 *
 * Package-internal: deliberately not re-exported from `src/index.ts`.
 *
 * @param options - The connection options as the application declared them.
 * @returns What `connect()` passes to `@nats-io/transport-node`.
 *
 * @see docs:api/queue.md
 */
export function toDriverOptions(options: NatsConnectionOptions): NodeConnectionOptions {
  const passthrough = {
    servers: options.servers,
    name: options.name,
    token: options.token,
    user: options.user,
    pass: options.pass,
    maxReconnectAttempts: options.maxReconnectAttempts,
    reconnectTimeWait: options.reconnectTimeWait,
    timeout: options.timeout,
    inboxPrefix: options.inboxPrefix,
  } satisfies Record<PassthroughKey, unknown>;

  // An option the application did not set must be ABSENT, never present-and-undefined. nats.js
  // merges with `extend(defaultOptions(), opts)`, which copies every own key unconditionally, so
  // `maxReconnectAttempts: undefined` overwrites the driver's 10 and `reconnectTimeWait:
  // undefined` overwrites its 2000 — and its reconnect-delay handler then computes
  // `undefined + jitter` and schedules every retry at NaN milliseconds. Same rule, and the same
  // reason, as `buildStreamConfig` in the JetStream adapter.
  const declared = Object.fromEntries(
    Object.entries(passthrough).filter(([, value]) => value !== undefined),
  ) as NodeConnectionOptions;

  return {
    ...declared,
    // `tls: true` means "negotiate TLS with the driver's defaults", which the driver spells as an
    // empty options object. Absent leaves the driver's own default alone. A caller who needs real
    // TLS settings reaches them through `driverOptions`.
    ...(options.tls ? { tls: {} } : {}),
    // Verbatim, undefined values included: this is the caller writing directly to the driver, and
    // "merged last and winning" has to mean winning, or the hatch cannot un-set anything.
    ...options.driverOptions,
  };
}

/**
 * Copies a received message's headers into the `Map` that `NatsMessage.headers` exposes.
 *
 * Reads them through `keys()` and `values()`, both declared on the driver's `MsgHdrs` interface.
 * That interface has no `entries()` — a `Map` method, and the driver's headers are not a `Map`.
 * The connection is typed `any`, so the typed parameter here is what turns such a call into a
 * compile error. Untyped, it compiles and throws on the first message that carries headers,
 * inside the consume loop — which the throw ends, losing every later message on the subscription.
 *
 * Names come back exactly as the publisher wrote them. The driver compares names exactly unless
 * asked otherwise, and stores them as given, so `X-Probe` arrives as `X-Probe`, not lower-cased
 * and not canonicalised. `values()` builds a new array per name, so what a callback receives is
 * its own and changing it cannot reach back into the driver's message.
 *
 * Package-internal: deliberately not re-exported from `src/index.ts`.
 *
 * @param headers - The headers of a message the driver delivered.
 * @returns One entry per header name, holding every value for that name in arrival order.
 *
 * @see docs:api/queue.md
 */
export function toHeaderMap(headers: MsgHdrs): Map<string, string[]> {
  return new Map(headers.keys().map((name) => [name, headers.values(name)]));
}

// Import NATS types dynamically to handle potential import issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let natsModule: any = null;

async function getNatsModule() {
  if (!natsModule) {
    natsModule = await import('@nats-io/transport-node');
  }

  return natsModule;
}

/** How the drain inside `NatsClient.disconnect()` ended, or that the connection closed first. */
type DrainOutcome =
  | { kind: 'drained' }
  | { kind: 'failed'; error: unknown }
  | { kind: 'closed'; reason: unknown };

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
  /**
   * Message headers: one entry per name, every value for it in arrival order, names in the case
   * the publisher wrote them. Absent when the message carried none.
   */
  headers?: Map<string, string[]>;
}

/**
 * NATS Client
 *
 * Simplified wrapper around the NATS.js client.
 *
 * @see docs:api/queue.md
 */
export class NatsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private nc: any = null;
  /** The `disconnect()` in flight, so concurrent calls share one drain and one close. */
  private disconnecting: Promise<void> | null = null;
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

    this.nc = await nats.connect(toDriverOptions(this.options));
  }

  /**
   * Disconnect from NATS.
   *
   * Drains first, so every subscription finishes what it has received and buffered publishes are
   * flushed, then closes. However the drain ends, the call settles with the connection released —
   * `getConnection()` returning `null`, `isConnected()` answering `false` — and, unless the close
   * itself fails, closed:
   *
   * - The drain completes, or the connection closes without an error while it runs: the call
   *   resolves.
   * - The drain rejects — during an outage the driver rejects it on a later reconnect attempt and
   *   leaves the connection open and reconnecting: the connection is closed, then the drain error
   *   is rethrown. It means buffered publishes may not have reached the server, which is the
   *   caller's to report.
   * - The driver closes the connection itself while the drain is pending — it gives up after
   *   `maxReconnectAttempts` — and never settles the drain: the wait ends with the close, and the
   *   error the driver closed the connection with is rethrown.
   * - The connection was already closed when the call started: it is released, and the error the
   *   driver closed it with is rethrown, or the driver's closed-connection error when it was
   *   closed without one.
   * - Only the close fails: its error is rethrown.
   *
   * A call made while another is in flight does not drain or close anything itself: it settles
   * with the outcome of the call in flight, so on a healthy connection it resolves once that
   * call's drain completes. The driver refuses a second drain, and closing on that refusal would
   * pull the socket out from under the first call's flush, which the driver then never settles.
   */
  async disconnect(): Promise<void> {
    if (!this.nc) {
      return;
    }

    this.disconnecting ??= this.closeConnection(this.nc);
    const pending = this.disconnecting;

    try {
      await pending;
    } finally {
      if (this.disconnecting === pending) {
        this.disconnecting = null;
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async closeConnection(nc: any): Promise<void> {
    try {
      if (nc.isClosed()) {
        // `closed()` resolves with the error the driver closed the connection on, and with
        // nothing for a close without an error — where a drain would have rejected with this error.
        const reason = await nc.closed();
        if (reason) {
          throw reason;
        }

        const nats = await getNatsModule();

        throw new nats.errors.ClosedConnectionError();
      }

      // Raced against `closed()` because the drain alone cannot be awaited: when the driver gives
      // up reconnecting and closes the connection while the drain's flush is pending, nothing
      // settles that flush, and the drain with it, ever again.
      const outcome: DrainOutcome = await Promise.race([
        nc.drain().then(
          (): DrainOutcome => ({ kind: 'drained' }),
          (error: unknown): DrainOutcome => ({ kind: 'failed', error }),
        ),
        nc.closed().then((reason: unknown): DrainOutcome => ({ kind: 'closed', reason })),
      ]);

      if (outcome.kind === 'failed') {
        try {
          await nc.close();
        } catch {
          // The drain's error is the one reported: a close failure on top of it would hide it.
        }

        throw outcome.error;
      }

      // A no-op once the connection is closed, which a completed drain leaves it.
      await nc.close();

      // No reason means a close without an error — the drain's own final close among them.
      if (outcome.kind === 'closed' && outcome.reason) {
        throw outcome.reason;
      }
    } finally {
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
   * Publish a message on core NATS.
   *
   * Fire-and-forget: core NATS has no acknowledgement, so a resolved call means the client accepted
   * the message, not that anyone received it. A message published while the client is reconnecting
   * resolves and can be lost without an error — the driver discards what it buffered at each
   * connection attempt. A server that denies the publish reports it asynchronously, not here.
   *
   * @throws {QueuePublishError} `'unavailable'` when there is no connection or it is closed or
   *   draining, `'rejected'` when the client refuses to send — a subject or header it cannot carry,
   *   a payload above the server's `max_payload`. `pattern` is the subject; the driver's error is the
   *   `cause`.
   *
   * @see docs:api/queue.md
   */
  async publish(subject: string, data: string, headers?: Record<string, string>): Promise<void> {
    if (!this.nc) {
      throw new QueuePublishError(
        `Not connected to NATS, so nothing was published to "${subject}". Call connect() first.`,
        { reason: 'unavailable', pattern: subject },
      );
    }

    const nats = await getNatsModule();
    const encoder = new TextEncoder();

    // Headers are built inside the `try`: the driver refuses a header name it cannot carry and a
    // value with CR or LF, and that refusal is a publish the client would not send, like a subject.
    try {
      let natsHeaders;
      if (headers) {
        natsHeaders = nats.headers();
        for (const [key, value] of Object.entries(headers)) {
          natsHeaders.set(key, value);
        }
      }

      this.nc.publish(subject, encoder.encode(data), { headers: natsHeaders });
    } catch (cause) {
      throw natsPublishError(subject, `NATS subject "${subject}"`, cause);
    }
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
    // Typed although the connection is not, so what the loop reads off each message is checked
    // against the driver's declarations rather than trusted.
    const sub: Subscription = this.nc.subscribe(subject, { queue: options?.queue });

    // Start consuming messages
    (async () => {
      for await (const msg of sub) {
        const natsMsg: NatsMessage = {
          subject: msg.subject,
          data: decoder.decode(msg.data),
          reply: msg.reply,
          headers: msg.headers ? toHeaderMap(msg.headers) : undefined,
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

    const response: Msg = await this.nc.request(subject, encoder.encode(data), {
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    });

    return {
      subject: response.subject,
      data: decoder.decode(response.data),
      reply: response.reply,
      headers: response.headers ? toHeaderMap(response.headers) : undefined,
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
 *
 * @see docs:api/queue.md
 */
export function createNatsClient(options: NatsConnectionOptions): NatsClient {
  return new NatsClient(options);
}
