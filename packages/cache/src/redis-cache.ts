/**
 * Redis cache implementation using Bun's native RedisClient
 * 
 * Requires Bun v1.2.9 or later
 * @see https://bun.com/docs/api/redis
 */

import type { RedisClient } from './bun-redis-types';
import type {
  CacheService,
  CacheSetOptions,
  CacheStats,
  RedisCacheOptions,
} from './types';

import { DEFAULT_REDIS_CACHE_OPTIONS } from './types';

/**
 * Redis-based cache implementation using Bun's native RedisClient
 * Implements CacheService interface with Redis as the backing store
 */
export class RedisCache implements CacheService {
  private client: RedisClient | null = null;
  private readonly options: Required<RedisCacheOptions>;
  private hits = 0;
  private misses = 0;

  /**
   * Create a new Redis cache instance
   * @param options - Redis cache configuration options
   */
  constructor(options: RedisCacheOptions = {}) {
    this.options = {
      ...DEFAULT_REDIS_CACHE_OPTIONS,
      ...options,
    } as Required<RedisCacheOptions>;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      // Build Redis URL
      const {
        host, port, password, database, 
      } = this.options;
      let url = 'redis://';

      if (password) {
        url += `:${password}@`;
      }

      url += `${host}:${port}`;

      if (database) {
        url += `/${database}`;
      }

      // Create Bun's native RedisClient
      // Type assertion needed until official types are available in bun-types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/naming-convention
      const BunGlobal = (globalThis as any).Bun;
      
      // Try alternative access methods if BunGlobal doesn't have RedisClient
      // Bun is available at runtime but may not be in TypeScript types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BunDirect = typeof Bun !== 'undefined' ? (Bun as any) : null;
      const BunRedisClient = BunGlobal?.RedisClient 
        || BunDirect?.RedisClient 
        || BunGlobal?.Redis;
      
      if (!BunRedisClient) {
        throw new Error('RedisClient is not available. Make sure you are using Bun runtime.');
      }
      
      this.client = new BunRedisClient(url, {
        connectionTimeout: this.options.connectTimeout,
        enableAutoPipelining: true,
        autoReconnect: true,
      }) as RedisClient;

      // Connect to Redis
      await this.client.connect();
    } catch (error) {
      throw new Error(`Failed to connect to Redis: ${error}`);
    }
  }

  /**
   * Get a value from cache by key
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const fullKey = this.getFullKey(key);
      const value = await this.client.get(fullKey);

      if (value === null || value === undefined) {
        this.misses++;

        return undefined;
      }

      this.hits++;

      return JSON.parse(value) as T;
    } catch {
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

      // Set value with TTL atomically using PX (milliseconds)
      if (ttl && ttl > 0) {
        // Use send command to set value with TTL atomically
        await this.client.send('SET', [fullKey, serialized, 'PX', String(ttl)]);
      } else {
        await this.client.set(fullKey, serialized);
      }
    } catch (error) {
      throw new Error(`Redis cache set error for key ${key}: ${error}`);
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const fullKey = this.getFullKey(key);
      const result = await this.client.del(fullKey);

      return result > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const fullKey = this.getFullKey(key);
      // Bun's exists returns boolean instead of number
      const result = await this.client.exists(fullKey);

      return Boolean(result);
    } catch {
      return false;
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
      // Use SCAN instead of KEYS for better performance in production
      // For now, using send() method for KEYS command
      const keys = await this.client.send('KEYS', [pattern]);

      if (keys && Array.isArray(keys) && keys.length > 0) {
        await this.client.del(...keys);
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
      const values = await this.client.send('MGET', fullKeys);

      if (!Array.isArray(values)) {
        this.misses += keys.length;

        return new Array(keys.length).fill(undefined);
      }

      return values.map((value) => {
        if (value === null || value === undefined) {
          this.misses++;

          return undefined;
        }

        this.hits++;
        try {
          return JSON.parse(value as string) as T;
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
      // Bun's RedisClient has auto-pipelining enabled by default
      // We can execute commands sequentially and they will be pipelined automatically
      for (const { key, value, options } of entries) {
        await this.set(key, value, options);
      }
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
      const keys = await this.client.send('KEYS', [pattern]);
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
   */
  async close(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      this.client.close();
      this.client = null;
    } catch {
      // Force disconnect if graceful close fails
      this.client = null;
    }
  }

  /**
   * Get full key with prefix
   */
  private getFullKey(key: string): string {
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
}

/**
 * Create a new Redis cache instance
 * @param options - Redis cache configuration options
 * @returns RedisCache instance
 */
export function createRedisCache(options: RedisCacheOptions = {}): RedisCache {
  return new RedisCache(options);
}