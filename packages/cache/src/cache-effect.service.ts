import {
  Context,
  Effect,
  Layer,
} from 'effect';

import type { RedisCache } from './redis-cache';
import type { CacheService as ICacheService } from './types';
import type { CacheOptions } from './types';

import { createInMemoryCache, InMemoryCache } from './memory-cache';

/**
 * Cache service interface for dependency injection
 * Extends the core CacheService interface with Effect-based methods
 */
export interface CacheService extends ICacheService {
  /**
   * Get a value from cache (Effect interface)
   */
  getEffect<T = unknown>(key: string): Effect.Effect<T | undefined>;

  /**
   * Set a value in cache (Effect interface)
   */
  setEffect<T = unknown>(
    key: string,
    value: T,
    options?: import('./types').CacheSetOptions
  ): Effect.Effect<void>;

  /**
   * Delete a value from cache (Effect interface)
   */
  deleteEffect(key: string): Effect.Effect<boolean>;

  /**
   * Check if key exists in cache (Effect interface)
   */
  hasEffect(key: string): Effect.Effect<boolean>;

  /**
   * Clear all values from cache (Effect interface)
   */
  clearEffect(): Effect.Effect<void>;

  /**
   * Get multiple values from cache (Effect interface)
   */
  mgetEffect<T = unknown>(keys: string[]): Effect.Effect<(T | undefined)[]>;

  /**
   * Set multiple values in cache (Effect interface)
   */
  msetEffect<T = unknown>(
    entries: Array<{ key: string; value: T; options?: import('./types').CacheSetOptions }>
  ): Effect.Effect<void>;

  /**
   * Get cache statistics (Effect interface)
   */
  getStatsEffect(): Effect.Effect<import('./types').CacheStats>;

  /**
   * Close cache connection and cleanup resources (Effect interface)
   */
  closeEffect(): Effect.Effect<void>;
}

/**
 * Cache service implementation that wraps InMemoryCache or RedisCache
 */
class CacheServiceImpl implements ICacheService {
  constructor(private readonly cache: InMemoryCache | RedisCache) {}

  // Promise-based methods (delegate to underlying cache)
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return await this.cache.get<T>(key);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: import('./types').CacheSetOptions,
  ): Promise<void> {
    return await this.cache.set(key, value, options);
  }

  async delete(key: string): Promise<boolean> {
    return await this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return await this.cache.has(key);
  }

  async clear(): Promise<void> {
    return await this.cache.clear();
  }

  async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
    return await this.cache.mget<T>(keys);
  }

  async mset<T = unknown>(
    entries: Array<{ key: string; value: T; options?: import('./types').CacheSetOptions }>,
  ): Promise<void> {
    return await this.cache.mset(entries);
  }

  async getStats(): Promise<import('./types').CacheStats> {
    return await this.cache.getStats();
  }

  async close(): Promise<void> {
    return await this.cache.close();
  }

  // Effect-based methods
  getEffect<T = unknown>(key: string): Effect.Effect<T | undefined> {
    return Effect.promise(() => this.get<T>(key));
  }

  setEffect<T = unknown>(
    key: string,
    value: T,
    options?: import('./types').CacheSetOptions,
  ): Effect.Effect<void> {
    return Effect.promise(() => this.set(key, value, options));
  }

  deleteEffect(key: string): Effect.Effect<boolean> {
    return Effect.promise(() => this.delete(key));
  }

  hasEffect(key: string): Effect.Effect<boolean> {
    return Effect.promise(() => this.has(key));
  }

  clearEffect(): Effect.Effect<void> {
    return Effect.promise(() => this.clear());
  }

  mgetEffect<T = unknown>(keys: string[]): Effect.Effect<(T | undefined)[]> {
    return Effect.promise(() => this.mget<T>(keys));
  }

  msetEffect<T = unknown>(
    entries: Array<{ key: string; value: T; options?: import('./types').CacheSetOptions }>,
  ): Effect.Effect<void> {
    return Effect.promise(() => this.mset(entries));
  }

  getStatsEffect(): Effect.Effect<import('./types').CacheStats> {
    return Effect.promise(() => this.getStats());
  }

  closeEffect(): Effect.Effect<void> {
    return Effect.promise(() => this.close());
  }
}

/**
 * Cache service tag for dependency injection
 */
export const cacheServiceTag = Context.GenericTag<CacheService>(
  '@onebun/cache/CacheService',
);

/**
 * Create CacheService Layer from cache instance
 * @param cache - Cache instance implementing CacheService interface (InMemoryCache or RedisCache)
 * @returns Layer providing CacheService
 */
export const makeCacheService = (
  cache: InMemoryCache | RedisCache,
): Layer.Layer<CacheService> => {
  return Layer.succeed(cacheServiceTag, new CacheServiceImpl(cache));
};

/**
 * Create CacheService Layer from cache options
 * @param options - Cache configuration options
 * @returns Layer providing CacheService
 */
export const makeCacheServiceFromOptions = (
  options: CacheOptions = {},
): Layer.Layer<CacheService> => {
  const cache = createInMemoryCache(options);

  return makeCacheService(cache);
};
