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
    // Through ensureClient(), like get/delete/has: a shared client can be disconnected out from
    // under this cache, and a write is exactly when "reconnect or say so" matters most.
    const client = await this.ensureClient();

    try {
      const fullKey = this.getFullKey(key);
      const serialized = JSON.stringify(value);
      const ttl = options.ttl ?? this.options.defaultTtl;

      // Set value with TTL
      await client.set(fullKey, serialized, ttl);
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
    const client = await this.ensureClient();

    // Refuse before touching Redis, not after: the damage this guards against is done by the
    // first DEL, and an unscoped clear() has no undo.
    this.requireNamespace(client, 'clear');

    try {
      // `*`, not `${prefix}*` — the client prefixes the pattern itself. Spelling the prefix here
      // too is what produced `prefix + prefix + *`, and what made this match nothing at all in
      // shared mode, where the prefix that applies belongs to the shared client.
      const keys = await client.keys('*');

      if (keys && Array.isArray(keys) && keys.length > 0) {
        for (const key of keys) {
          await client.del(key);
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
    const client = await this.ensureClient();

    try {
      const fullKeys = keys.map((key) => this.getFullKey(key));
      const values = await client.mget(fullKeys);

      return values.map((value) => {
        if (value === null || value === undefined) {
          this.misses++;

          return undefined;
        }

        try {
          const parsed = JSON.parse(value) as T;
          this.hits++;

          return parsed;
        } catch {
          // Counted once, as a miss. It used to be counted as a hit AND a miss, so an unparsable
          // entry inflated the hit rate it was evidence against.
          this.misses++;

          return undefined;
        }
      });
    } catch (error) {
      // This used to report every key missing and add them to the miss counter, so a connection
      // blip read as a total cache miss for data that exists — the exact failure single-key get()
      // was fixed to stop — and skewed hitRate permanently afterwards.
      throw new Error(`Redis cache mget failed for ${keys.length} key(s): ${error}`);
    }
  }

  /**
   * Set multiple values in cache
   */
  async mset<T = unknown>(
    entries: Array<{ key: string; value: T; options?: CacheSetOptions }>,
  ): Promise<void> {
    const client = await this.ensureClient();

    try {
      const msetEntries = entries.map(({ key, value, options }) => ({
        key: this.getFullKey(key),
        value: JSON.stringify(value),
        ttlMs: options?.ttl ?? this.options.defaultTtl,
      }));

      await client.mset(msetEntries);
    } catch (error) {
      throw new Error(`Redis cache mset error: ${error}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const client = await this.ensureClient();

    // Same scope rule as clear(): if this cache cannot name its own keyspace, `entries` would be
    // a count of the whole database, which reads as a plausible number and is not this cache's.
    this.requireNamespace(client, 'getStats');

    try {
      // `*` — the client prefixes it, exactly as in clear(). The two must not be able to disagree
      // about what belongs to this cache.
      const keys = await client.keys('*');
      const totalRequests = this.hits + this.misses;
      const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

      return {
        hits: this.hits,
        misses: this.misses,
        entries: Array.isArray(keys) ? keys.length : 0,
        hitRate,
      };
    } catch (error) {
      // Previously this returned zeros, so a dashboard read "cache empty" when the truth was
      // "cache unreachable" — two states that call for opposite responses.
      throw new Error(`Redis cache getStats error: ${error}`);
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
   * The key as the client should be given it — which is unchanged, in every mode.
   *
   * `RedisClient` IS the namespace: it applies `keyPrefix` on every read and write, and strips it
   * back off the results of `keys()`. This used to add the cache's own prefix on top in standalone
   * mode, which stored keys under `prefix + prefix + key` while `clear()` built its pattern from
   * one prefix and the client doubled that too — so the two agreed only by both being wrong. Any
   * other reader (a runbook, `SCAN`, an ACL rule, another service) saw the doubled name.
   */
  private getFullKey(key: string): string {
    return key;
  }

  /**
   * The namespace this cache's entries actually live under, or `null` when there is none.
   *
   * `null` is not "no prefix configured" — it is "this cache cannot tell its own keys from anyone
   * else's", which is the state in which a bulk operation must refuse rather than proceed.
   */
  private resolveNamespace(client: RedisClient): string | null {
    const prefix = client.keyPrefix;

    return prefix.length > 0 ? prefix : null;
  }

  /**
   * Refuse a keyspace-wide operation the cache cannot scope, naming what to configure.
   *
   * Without this, `clear()` on an unprefixed client issues `KEYS *` followed by `DEL` per hit:
   * sessions, queues, rate-limit counters and every other tenant of that database, gone, with a
   * resolved promise and no log line.
   */
  private requireNamespace(client: RedisClient, operation: string): string {
    const namespace = this.resolveNamespace(client);

    if (namespace === null) {
      const mode = this.useShared
        ? 'shared client'
        : (this.ownsClient ? 'standalone client' : 'injected client');

      throw new Error(
        `Redis cache ${operation}() refused: the ${mode} has no key prefix, so this cache cannot `
        + 'tell its own keys from every other key in the database. Configure a non-empty keyPrefix '
        + '(cache options for a standalone client, SharedRedisProvider.configure() for a shared one, '
        + 'or the RedisClient you pass in) before using an operation that spans the keyspace.',
      );
    }

    return namespace;
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
