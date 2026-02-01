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
   * Configure the shared Redis connection
   * Must be called before getClient()
   */
  static configure(options: SharedRedisOptions): void {
    // Note: If already connected, configuration will apply to new connections only
    SharedRedisProvider.options = options;
  }

  /**
   * Get the shared Redis client (creates connection if needed)
   */
  static async getClient(): Promise<RedisClient> {
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
   * Disconnect the shared client
   */
  static async disconnect(): Promise<void> {
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
    await SharedRedisProvider.disconnect();
    SharedRedisProvider.options = null;
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
