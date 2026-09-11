/**
 * Shared Redis Provider
 *
 * Singleton provider for sharing Redis connection across multiple consumers
 * (cache, websocket, etc.)
 */

import {
  Context,
  Effect,
  Layer,
} from 'effect';

import { RedisClient, type RedisClientOptions } from './redis-client';

/**
 * Options for shared Redis connection
 */
export interface SharedRedisOptions {
  /** Redis connection URL */
  url: string;
  /** Key prefix for all operations */
  keyPrefix?: string;
  /** Enable automatic reconnection */
  reconnect?: boolean;
  /** Enable TLS */
  tls?: boolean;
}

/**
 * A hold on the shared Redis client.
 *
 * Whoever takes one gives it back; the connection closes when the last one is released.
 */
export interface SharedRedisLease {
  /** The shared client. */
  readonly client: RedisClient;
  /** Give this hold back. Calling it twice is a no-op. */
  release(): Promise<void>;
}

/**
 * A Redis target as it can safely be printed: the credentials are the one part of a URL that
 * must never reach a log line or an error message.
 */
function describeTarget(options: SharedRedisOptions): string {
  let url = options.url;
  try {
    const parsed = new URL(options.url);
    if (parsed.password) {
      parsed.password = '***';
    }
    url = parsed.toString();
  } catch {
    // Not a parsable URL — print it as given rather than guess at its shape.
  }

  const prefix = options.keyPrefix ? `, keyPrefix: "${options.keyPrefix}"` : '';

  return `${url}${prefix}`;
}

/**
 * Where the caller of `configure()` wrote it.
 *
 * Frames inside this file are ours. Stacks are best-effort; when the shape is not what we
 * expect, say so rather than print a frame that means something else.
 */
function captureCallSite(): string {
  const stack = new Error().stack;
  if (stack === undefined) {
    return 'unknown location';
  }

  const caller = stack.split('\n').slice(1).find((frame) => !frame.includes('shared-redis.ts'));

  return caller?.match(/\(?([^()\s]+:\d+:\d+)\)?\s*$/)?.[1] ?? 'unknown location';
}

/**
 * Singleton provider for shared Redis connection
 *
 * @example
 * ```typescript
 * // Configure at app startup
 * SharedRedisProvider.configure({
 *   url: 'redis://localhost:6379',
 *   keyPrefix: 'myapp:',
 * });
 *
 * // Get shared client
 * const client = await SharedRedisProvider.getClient();
 *
 * // Use in cache
 * const cache = new RedisCache({ useSharedClient: true });
 *
 * // Use in WebSocket storage
 * const wsStorage = new RedisWsStorage(await SharedRedisProvider.getClient());
 * ```
 */
export class SharedRedisProvider {
  private static instance: RedisClient | null = null;
  private static options: SharedRedisOptions | null = null;
  private static connecting: Promise<RedisClient> | null = null;

  /**
   * Everything currently holding the shared client, labelled with where it was taken.
   *
   * The connection is LAZY — `configure()` opens nothing — so ownership cannot be decided at
   * configuration time. It is decided by WHO ASKED: whoever acquires gives back, and the
   * connection closes when the last holder lets go.
   *
   * It used to be a bare count, and the count was not an ownership record: acquisition was per
   * CONSUMER (a cache, a queue adapter) while release was one per APPLICATION. Measured, that
   * broke in both directions. An application that never touched Redis still released on stop
   * and took a sibling's connection down with it — a live queue then threw
   * `Redis client not connected` on the next publish. And an application with two consumers
   * gave back one of two, so the socket outlived every application in the process.
   *
   * A holder identity is a `symbol`, so `disconnect()` clearing this map VOIDS every
   * outstanding hold rather than leaving a stale release able to steal a later holder's
   * connection.
   */
  private static holders = new Map<symbol, string>();

  /**
   * The holds taken through {@link getClient}, in the order they were taken.
   *
   * These are the only ones the static {@link release} can give back. A hold taken with
   * {@link acquire} belongs to its handle, so a stray `release()` cannot take a framework
   * consumer's connection away from it — which is the same confusion, one layer up, as the
   * application-level release this replaced.
   */
  private static anonymousHolds: symbol[] = [];

  /** Where the configuration in force was written, for the message when a second one disagrees. */
  private static configuredAt: string | null = null;

  /**
   * Configure the shared Redis connection
   * Must be called before getClient()
   *
   * There is ONE shared connection per process, so there is one configuration. A second call
   * that asks for a different target is refused rather than accepted: it cannot be honoured,
   * and accepting it was silent — measured, two applications pointing at different Redis
   * databases both ended up on whichever connection existed first, and one application's
   * `clear()` then wiped the other's keys. Re-stating the same target is fine; `reset()` gives
   * the configuration up.
   */
  static configure(options: SharedRedisOptions): void {
    const current = SharedRedisProvider.options;

    if (current && !SharedRedisProvider.sameTarget(current, options)) {
      const error = new Error(
        'SharedRedisProvider is already configured for a different target, and there is only '
        + 'one shared connection per process.\n'
        + `  in force  ${describeTarget(current)}  configured at ${SharedRedisProvider.configuredAt ?? 'unknown location'}\n`
        + `  requested ${describeTarget(options)}  at ${captureCallSite()}\n`
        + 'Accepting this would have handed both consumers the same connection, with the first '
        + "target and the first key prefix — so one consumer's keys and its clear() would reach "
        + 'the other\'s data. For a second target use a dedicated client '
        + '(SharedRedisProvider.createClient({ url }), or the consumer\'s own connection options); '
        + 'in tests, call SharedRedisProvider.reset() between configurations.',
      );
      error.name = 'OneBunSharedRedisConflictError';
      throw error;
    }

    SharedRedisProvider.options = options;
    SharedRedisProvider.configuredAt = captureCallSite();
  }

  /**
   * Whether two configurations describe the same connection.
   *
   * Every field shapes the connection or the keys written through it, so any difference makes
   * one configuration unable to stand in for the other. `reconnect` defaults to true in
   * `RedisClient`, so absent and `true` are the same request.
   */
  private static sameTarget(left: SharedRedisOptions, right: SharedRedisOptions): boolean {
    return left.url === right.url
      && left.keyPrefix === right.keyPrefix
      && (left.reconnect ?? true) === (right.reconnect ?? true)
      && (left.tls ?? false) === (right.tls ?? false);
  }

  /**
   * Take a hold on the shared client, and get a handle that gives it back.
   *
   * This is the shape to prefer: the hold is a thing you have rather than a static call you
   * must remember. Releasing twice is a no-op, and a hold voided by `disconnect()` releases
   * nothing rather than decrementing somebody else's.
   *
   * @param label - What is holding it, for the shutdown diagnostic. Defaults to the call site.
   */
  static async acquire(label?: string): Promise<SharedRedisLease> {
    const client = await SharedRedisProvider.connectShared();
    const key = Symbol(label ?? 'shared-redis-hold');
    SharedRedisProvider.holders.set(key, label ?? captureCallSite());

    return {
      client,
      async release(): Promise<void> {
        await SharedRedisProvider.releaseHold(key);
      },
    };
  }

  /**
   * Get the shared Redis client (creates connection if needed)
   *
   * Takes a hold that YOU give back with {@link release} — the application does not do it for
   * you. Prefer {@link acquire}, whose handle cannot be forgotten as easily.
   */
  static async getClient(label?: string): Promise<RedisClient> {
    // The hold is registered only after a successful dial. It used to be the first statement,
    // so an unconfigured provider or a refused connection left a hold behind that nothing
    // could ever give back.
    const client = await SharedRedisProvider.connectShared();
    const key = Symbol('anonymous');
    SharedRedisProvider.holders.set(key, label ?? captureCallSite());
    SharedRedisProvider.anonymousHolds.push(key);

    return client;
  }

  /**
   * Connect (or reuse) the shared client without taking a hold.
   */
  private static async connectShared(): Promise<RedisClient> {
    // Return existing instance
    if (SharedRedisProvider.instance?.isConnected()) {
      return SharedRedisProvider.instance;
    }

    // Wait for existing connection attempt
    if (SharedRedisProvider.connecting) {
      return await SharedRedisProvider.connecting;
    }

    // Check configuration
    if (!SharedRedisProvider.options) {
      throw new Error(
        'SharedRedisProvider not configured. Call SharedRedisProvider.configure() first.',
      );
    }

    // Create new connection
    SharedRedisProvider.connecting = SharedRedisProvider.createConnection();

    try {
      SharedRedisProvider.instance = await SharedRedisProvider.connecting;

      return SharedRedisProvider.instance;
    } finally {
      SharedRedisProvider.connecting = null;
    }
  }

  /**
   * Get a live client WITHOUT taking another hold.
   *
   * For a consumer that already holds one and found its reference dead: the client is
   * reconnected if necessary, and the holder set is untouched, so re-fetching on every failed
   * operation cannot inflate it.
   */
  static async reacquire(): Promise<RedisClient> {
    return await SharedRedisProvider.connectShared();
  }

  /** Give back one specific hold, disconnecting when it was the last. */
  private static async releaseHold(key: symbol): Promise<void> {
    // A hold voided by disconnect() is already gone from the map, so this deletes nothing and
    // cannot take a connection away from a holder that acquired afterwards.
    if (!SharedRedisProvider.holders.delete(key)) {
      return;
    }

    const anonymous = SharedRedisProvider.anonymousHolds.indexOf(key);
    if (anonymous !== -1) {
      SharedRedisProvider.anonymousHolds.splice(anonymous, 1);
    }

    if (SharedRedisProvider.holders.size === 0) {
      await SharedRedisProvider.disconnect();
    }
  }

  /**
   * Create a new Redis connection
   */
  private static async createConnection(): Promise<RedisClient> {
    const options = SharedRedisProvider.options!;
    const client = new RedisClient({
      url: options.url,
      keyPrefix: options.keyPrefix,
      reconnect: options.reconnect,
      tls: options.tls,
    });

    await client.connect();

    return client;
  }

  /**
   * Give back one hold taken with {@link getClient}, disconnecting when it was the last.
   *
   * This is what a CONSUMER calls when it closes — not what an application calls on shutdown.
   * An application used to call it once per `stop()` whether or not anything in it had ever
   * acquired, which is how a service that never touched Redis took a sibling's connection down.
   *
   * With nothing outstanding this does nothing. It used to fall through to `disconnect()`,
   * so a stray release force-closed a client another consumer had just acquired.
   */
  static async release(): Promise<void> {
    const oldest = SharedRedisProvider.anonymousHolds[0];
    if (oldest === undefined) {
      return;
    }

    await SharedRedisProvider.releaseHold(oldest);
  }

  /**
   * Number of holds outstanding on the shared client.
   * @internal
   */
  static leaseCount(): number {
    return SharedRedisProvider.holders.size;
  }

  /**
   * What is holding the shared client right now, as labels.
   *
   * The shutdown path prints this instead of releasing: a process that will not exit because
   * something still holds the connection is otherwise a hang with nothing to grep for.
   * @internal
   */
  static leaseHolders(): string[] {
    return [...SharedRedisProvider.holders.values()];
  }

  /**
   * Disconnect the shared client REGARDLESS of how many consumers still hold it.
   *
   * Prefer {@link release}: this is the force-close, and any consumer that already fetched
   * the client keeps a reference to a dead object.
   */
  static async disconnect(): Promise<void> {
    // Every outstanding hold is VOIDED, not counted down: each holder's key leaves the map, so
    // a later release from one of them deletes nothing instead of taking the connection away
    // from whoever acquired after this.
    SharedRedisProvider.holders.clear();
    SharedRedisProvider.anonymousHolds = [];
    if (SharedRedisProvider.instance) {
      await SharedRedisProvider.instance.disconnect();
      SharedRedisProvider.instance = null;
    }
  }

  /**
   * Check if shared client is connected
   */
  static isConnected(): boolean {
    return SharedRedisProvider.instance?.isConnected() ?? false;
  }

  /**
   * The current configuration, or `null`.
   *
   * Exists so a test that must repoint the process-global provider can put back exactly what
   * it found. Without it, "restore" means "configure to something of my own", which leaves
   * every suite whose `beforeAll` already ran pointing at an address that is about to
   * disappear — measured as an indefinite hang in an unrelated suite.
   * @internal
   */
  static getOptions(): SharedRedisOptions | null {
    return SharedRedisProvider.options;
  }

  /**
   * Check if shared Redis is configured
   */
  static isConfigured(): boolean {
    return SharedRedisProvider.options !== null;
  }

  /**
   * Create a standalone Redis client (not shared)
   * Useful for isolated scenarios
   */
  static createClient(options?: Partial<SharedRedisOptions>): RedisClient {
    const baseOptions: Partial<SharedRedisOptions> = SharedRedisProvider.options || {};
    const finalOptions: RedisClientOptions = {
      url: options?.url || baseOptions.url || '',
      keyPrefix: options?.keyPrefix ?? baseOptions.keyPrefix,
      reconnect: options?.reconnect ?? baseOptions.reconnect ?? true,
      tls: options?.tls ?? baseOptions.tls,
    };

    if (!finalOptions.url) {
      throw new Error('Redis URL is required');
    }

    return new RedisClient(finalOptions);
  }

  /**
   * Reset provider state (mainly for testing)
   */
  static async reset(): Promise<void> {
    // disconnect() already voids every hold; reset() additionally forgets the configuration,
    // so a suite starts from a clean provider.
    await SharedRedisProvider.disconnect();
    SharedRedisProvider.options = null;
    SharedRedisProvider.configuredAt = null;
  }
}

// ============================================================================
// Effect.js Integration
// ============================================================================

/**
 * Effect.js Tag for shared Redis service
 */
export class SharedRedisService extends Context.Tag('SharedRedisService')<
  SharedRedisService,
  RedisClient
>() {}

/**
 * Create Effect.js Layer for shared Redis
 *
 * @example
 * ```typescript
 * const redisLayer = makeSharedRedisLayer({
 *   url: 'redis://localhost:6379',
 *   keyPrefix: 'myapp:',
 * });
 *
 * const program = pipe(
 *   SharedRedisService,
 *   Effect.flatMap(redis => redis.get('key')),
 *   Effect.provide(redisLayer),
 * );
 * ```
 */
export function makeSharedRedisLayer(
  options: SharedRedisOptions,
): Layer.Layer<SharedRedisService> {
  return Layer.scoped(
    SharedRedisService,
    Effect.gen(function* () {
      // Configure shared provider
      SharedRedisProvider.configure(options);

      // This layer is a consumer like any other: it takes a hold and gives it back when its
      // scope closes. The finalizer used to be an empty body with a comment explaining that
      // other consumers might still be using the client — true, and exactly why the hold has
      // to be released rather than the client disconnected. Nothing ever gave this one back.
      const lease = yield* Effect.promise(() => SharedRedisProvider.acquire('makeSharedRedisLayer'));

      yield* Effect.addFinalizer(() => Effect.promise(() => lease.release()));

      return lease.client;
    }),
  );
}

/**
 * Get shared Redis client as Effect
 */
export const getSharedRedis = Effect.gen(function* () {
  if (!SharedRedisProvider.isConfigured()) {
    return yield* Effect.fail(new Error('SharedRedisProvider not configured'));
  }

  // An accessor, not an acquisition: it takes no hold, because there is nowhere in an
  // `Effect.gen` value to give one back and it used to take one that nothing ever released.
  // Something else in the process owns the connection; this just reaches it.
  return yield* Effect.promise(() => SharedRedisProvider.reacquire());
});
