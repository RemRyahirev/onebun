/**
 * Redis cache implementation using @onebun/core RedisClient
 * 
 * Supports two modes:
 * 1. Standalone - creates its own Redis connection
 * 2. Shared - uses SharedRedisProvider from @onebun/core
 * 
 * @see https://bun.com/docs/api/redis
 */

import type {
  CacheService,
  CacheSetOptions,
  CacheStats,
  RedisCacheOptions,
} from './types';

import type { RedisClientOptions } from '@onebun/core';
import {
  RedisClient,
  SharedRedisProvider,
  createRedisClient,
} from '@onebun/core';

import { DEFAULT_REDIS_CACHE_OPTIONS } from './types';

/**
 * How long a re-acquire may take before the cache reports itself unusable.
 *
 * The driver's auto-reconnect never gives up on its own, so without a deadline a dead cache
 * becomes a hung request rather than an error.
 */
const REACQUIRE_TIMEOUT_MS = 5000;

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * `promise` keeps running after the deadline — `Promise.race` cannot cancel it — but it stays
 * handled, so a late rejection is not reported as unhandled. Whoever abandons it is responsible
 * for closing what it was building.
 *
 * @internal
 */
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Redis-based cache implementation using @onebun/core RedisClient
 * Implements CacheService interface with Redis as the backing store
 *
 * @see docs:api/cache.md
 */
export class RedisCache implements CacheService {
  private client: RedisClient | null = null;
  private readonly options: Required<RedisCacheOptions>;
  private hits = 0;
  private misses = 0;
  private ownsClient = false;
  private useShared = false;

  /**
   * Create a new Redis cache instance
   * @param optionsOrClient - Redis cache configuration options or existing RedisClient
   */
  constructor(optionsOrClient: RedisCacheOptions | RedisClient = {}) {
    if (optionsOrClient instanceof RedisClient) {
      // Use provided client
      this.client = optionsOrClient;
      this.ownsClient = false;
      this.options = {
        ...DEFAULT_REDIS_CACHE_OPTIONS,
        keyPrefix: '',  // Client already has prefix configured
      } as Required<RedisCacheOptions>;
    } else {
      // Configure from options
      this.options = {
        ...DEFAULT_REDIS_CACHE_OPTIONS,
        ...optionsOrClient,
      } as Required<RedisCacheOptions>;
      this.useShared = optionsOrClient.useSharedClient ?? false;
    }
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    // Skip if already have a client
    if (this.client?.isConnected()) {
      return;
    }

    try {
      if (this.useShared) {
        // Use shared client from core
        this.client = await SharedRedisProvider.getClient();
        this.ownsClient = false;
      } else if (!this.client) {
        // Create new client
        const clientOptions = this.buildClientOptions();
        this.client = createRedisClient(clientOptions);
        this.ownsClient = true;
        await this.client.connect();
      } else if (!this.client.isConnected()) {
        // Reconnect existing client (passed via constructor)
        await this.client.connect();
      }
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error}`);
    }
  }

  /**
   * Build client options from cache options
   */
  private buildClientOptions(): RedisClientOptions {
    const {
      host, port, password, database, url, keyPrefix, connectTimeout, 
    } = this.options;

    // Use URL if provided, otherwise build from components
    let redisUrl = url;
    if (!redisUrl) {
      redisUrl = 'redis://';
      if (password) {
        redisUrl += `:${password}@`;
      }
      redisUrl += `${host}:${port}`;
      if (database) {
        redisUrl += `/${database}`;
      }
    }

    return {
      url: redisUrl,
      keyPrefix,
      connectTimeout,
      reconnect: true,
    };
  }

  /**
   * Return a usable client, re-acquiring the shared one if the held reference went dead.
   *
   * A shared client can be disconnected out from under this cache — by another application
   * shutting down, or by the server going away — and the reference stored at connect() time
   * is not updated. Re-acquiring here is what lets a cache survive that; failing loudly when
   * it cannot is what stops a dead connection from looking like a cold cache.
   */
  private async ensureClient(): Promise<RedisClient> {
    if (this.client?.isConnected()) {
      return this.client;
    }

    if (this.useShared) {
      try {
        // Bounded on purpose. With `autoReconnect` (the default) the driver never rejects a
        // connection to an unreachable server — it retries forever — so an unbounded await
        // here would turn a dead cache into a hung request instead of an error. A short
        // wait rides out a blip; past it the caller is told, loudly.
        this.client = await withDeadline(
          SharedRedisProvider.reacquire(),
          REACQUIRE_TIMEOUT_MS,
        );
      } catch (error) {
        throw new Error(`Redis cache is not usable: shared client could not be re-acquired: ${error}`);
      }

      if (this.client?.isConnected()) {
        return this.client;
      }
    } else if (this.client) {
      try {
        await withDeadline(this.client.connect(), REACQUIRE_TIMEOUT_MS);
      } catch (error) {
        throw new Error(`Redis cache is not usable: reconnect failed: ${error}`);
      }

      if (this.client.isConnected()) {
        return this.client;
      }
    }

    throw new Error('Redis cache is not usable: no connected client. Call connect() first.');
  }

  /**
   * Get a value from cache by key
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const client = await this.ensureClient();

    let value: string | null | undefined;
    try {
      value = await client.get(this.getFullKey(key));
    } catch (error) {
      // An operational failure is NOT a cache miss. Returning `undefined` here — which is
      // what this did — makes a dead connection indistinguishable from an absent key, so a
      // rate limiter or a replay check reads "not seen before" and decides wrongly.
      throw new Error(`Redis cache get failed for key ${key}: ${error}`);
    }

    if (value === null || value === undefined) {
      this.misses++;

      return undefined;
    }

    this.hits++;

    try {
      return JSON.parse(value) as T;
    } catch {
      // A value that is not JSON is a corrupt entry, not a transport failure: treat it as a
      // miss so one bad key cannot take the caller down.
      this.hits--;
      this.misses++;

      return undefined;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T = unknown>(
    key: string,
    value: T,
    options: CacheSetOptions = {},
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const fullKey = this.getFullKey(key);
      const serialized = JSON.stringify(value);
      const ttl = options.ttl ?? this.options.defaultTtl;

      // Set value with TTL
      await this.client.set(fullKey, serialized, ttl);
    } catch (error) {
      throw new Error(`Redis cache set error for key ${key}: ${error}`);
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    const client = await this.ensureClient();

    try {
      const fullKey = this.getFullKey(key);
      const existed = await client.exists(fullKey);
      await client.del(fullKey);

      return existed;
    } catch (error) {
      // `false` used to mean both "there was nothing to delete" and "the delete failed".
      throw new Error(`Redis cache delete failed for key ${key}: ${error}`);
    }
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    const client = await this.ensureClient();

    try {
      return await client.exists(this.getFullKey(key));
    } catch (error) {
      // `false` used to mean both "absent" and "could not tell" — the difference matters to
      // anything using the cache as a lock or a replay guard.
      throw new Error(`Redis cache has() failed for key ${key}: ${error}`);
    }
  }

  /**
   * Clear all values from cache
   * WARNING: This will clear all keys with the configured prefix
   */
  async clear(): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const pattern = `${this.options.keyPrefix}*`;
      const keys = await this.client.keys(pattern);

      if (keys && Array.isArray(keys) && keys.length > 0) {
        for (const key of keys) {
          await this.client.del(key);
        }
      }

      this.resetStats();
    } catch (error) {
      throw new Error(`Redis cache clear error: ${error}`);
    }
  }

  /**
   * Get multiple values from cache
   */
  async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const fullKeys = keys.map((key) => this.getFullKey(key));
      const values = await this.client.mget(fullKeys);

      return values.map((value) => {
        if (value === null || value === undefined) {
          this.misses++;

          return undefined;
        }

        this.hits++;
        try {
          return JSON.parse(value) as T;
        } catch {
          this.misses++;

          return undefined;
        }
      });
    } catch {
      // Return array of undefined with same length
      this.misses += keys.length;

      return new Array(keys.length).fill(undefined);
    }
  }

  /**
   * Set multiple values in cache
   */
  async mset<T = unknown>(
    entries: Array<{ key: string; value: T; options?: CacheSetOptions }>,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const msetEntries = entries.map(({ key, value, options }) => ({
        key: this.getFullKey(key),
        value: JSON.stringify(value),
        ttlMs: options?.ttl ?? this.options.defaultTtl,
      }));

      await this.client.mset(msetEntries);
    } catch (error) {
      throw new Error(`Redis cache mset error: ${error}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const pattern = `${this.options.keyPrefix}*`;
      const keys = await this.client.keys(pattern);
      const totalRequests = this.hits + this.misses;
      const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

      return {
        hits: this.hits,
        misses: this.misses,
        entries: Array.isArray(keys) ? keys.length : 0,
        hitRate,
      };
    } catch {
      return {
        hits: this.hits,
        misses: this.misses,
        entries: 0,
        hitRate: 0,
      };
    }
  }

  /**
   * Close cache connection and cleanup resources
   * Note: Only disconnects if this instance owns the client
   */
  async close(): Promise<void> {
    if (!this.client) {
      return;
    }

    // Only disconnect if we own the client (not shared)
    if (this.ownsClient) {
      try {
        await this.client.disconnect();
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.client = null;
  }

  /**
   * Get full key with prefix
   * Note: When using shared client, prefix is already applied
   */
  private getFullKey(key: string): string {
    // If client is shared or passed in, don't add prefix (client has its own)
    if (!this.ownsClient || this.useShared) {
      return key;
    }

    return `${this.options.keyPrefix}${key}`;
  }

  /**
   * Reset cache statistics
   */
  private resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get Redis client instance (for advanced usage)
   */
  getClient(): RedisClient | null {
    return this.client;
  }

  /**
   * Check if using shared client
   */
  isUsingSharedClient(): boolean {
    return this.useShared || !this.ownsClient;
  }
}

/**
 * Create a new Redis cache instance
 * @param optionsOrClient - Redis cache configuration options or existing RedisClient
 * @returns RedisCache instance
 *
 * @see docs:api/cache.md
 */
export function createRedisCache(optionsOrClient: RedisCacheOptions | RedisClient = {}): RedisCache {
  return new RedisCache(optionsOrClient);
}
