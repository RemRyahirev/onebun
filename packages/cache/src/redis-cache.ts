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
 * Redis-based cache implementation using @onebun/core RedisClient
 * Implements CacheService interface with Redis as the backing store
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
    if (!this.client) {
      throw new Error('Redis client not connected. Call connect() first.');
    }

    try {
      const fullKey = this.getFullKey(key);
      const existed = await this.client.exists(fullKey);
      await this.client.del(fullKey);

      return existed;
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

      return await this.client.exists(fullKey);
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
 */
export function createRedisCache(optionsOrClient: RedisCacheOptions | RedisClient = {}): RedisCache {
  return new RedisCache(optionsOrClient);
}
