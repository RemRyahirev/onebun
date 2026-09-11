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
   * Number of consumers currently holding the shared client.
   *
   * The connection is LAZY — `configure()` opens nothing — so ownership cannot be decided at
   * configuration time. Without a count, the FIRST application to stop disconnected the
   * client for every sibling still serving traffic, and those siblings were never told:
   * measured, a cache read through a surviving consumer returned `undefined` rather than
   * failing, so a dead connection looked like a permanently cold cache.
   */
  private static leases = 0;

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
   * Get the shared Redis client (creates connection if needed)
   */
  static async getClient(): Promise<RedisClient> {
    SharedRedisProvider.leases++;

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
   * Get a live client WITHOUT taking another lease.
   *
   * For a consumer that already holds one and found its reference dead — the client is
   * reconnected if necessary, but the lease count is untouched, so re-fetching on every
   * failed operation cannot inflate it.
   */
  static async reacquire(): Promise<RedisClient> {
    if (SharedRedisProvider.instance?.isConnected()) {
      return SharedRedisProvider.instance;
    }

    const held = SharedRedisProvider.leases;
    try {
      return await SharedRedisProvider.getClient();
    } finally {
      SharedRedisProvider.leases = held;
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
   * Release one consumer's hold on the shared client, disconnecting it when the last one
   * lets go.
   *
   * This is what an application should call on shutdown. `disconnect()` tears the client
   * down regardless of who else is using it.
   */
  static async release(): Promise<void> {
    if (SharedRedisProvider.leases > 0) {
      SharedRedisProvider.leases--;
    }

    if (SharedRedisProvider.leases === 0) {
      await SharedRedisProvider.disconnect();
    }
  }

  /**
   * Number of consumers currently holding the shared client.
   * @internal
   */
  static leaseCount(): number {
    return SharedRedisProvider.leases;
  }

  /**
   * Disconnect the shared client REGARDLESS of how many consumers still hold it.
   *
   * Prefer {@link release}: this is the force-close, and any consumer that already fetched
   * the client keeps a reference to a dead object.
   */
  static async disconnect(): Promise<void> {
    SharedRedisProvider.leases = 0;
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
    // disconnect() already zeroes the lease count; reset() additionally forgets the
    // configuration, so a suite starts from a clean provider.
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

      // Get client
      const client = yield* Effect.promise(() => SharedRedisProvider.getClient());

      // Return client with cleanup
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          // Note: We don't disconnect shared client on scope close
          // because other consumers might still be using it
        }),
      );

      return client;
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

  return yield* Effect.promise(() => SharedRedisProvider.getClient());
});
