import type {
  CacheEntry,
  CacheOptions,
  CacheService,
  CacheSetOptions,
  CacheStats,
} from './types';

import { DEFAULT_CACHE_OPTIONS } from './types';

/**
 * In-memory cache implementation
 * Implements CacheService interface with automatic cleanup and statistics
 */
export class InMemoryCache implements CacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly options: CacheOptions;
  private cleanupTimer?: NodeJS.Timer;

  // Statistics
  private hits = 0;
  private misses = 0;

  /**
   * Create a new in-memory cache instance
   * @param options - Cache configuration options
   */
  constructor(options: CacheOptions = {}) {
    this.options = {
      ...DEFAULT_CACHE_OPTIONS,
      ...options,
    };

    // Start cleanup timer if cleanup interval is set
    if (this.options.cleanupInterval && this.options.cleanupInterval > 0) {
      this.startCleanupTimer();
    }
  }

  /**
   * Get a value from cache by key
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;

      return undefined;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;

      return undefined;
    }

    this.hits++;

    return entry.value as T;
  }

  /**
   * Set a value in cache
   */
  async set<T = unknown>(
    key: string,
    value: T,
    options: CacheSetOptions = {},
  ): Promise<void> {
    const ttl = options.ttl ?? this.options.defaultTtl;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      ttl,
    };

    if (ttl && ttl > 0) {
      entry.expiresAt = now + ttl;
    }

    // Check size limit before adding
    if (this.options.maxSize && this.cache.size >= this.options.maxSize) {
      // Simple LRU-like eviction: remove oldest entries
      this.evictOldest();
    }

    this.cache.set(key, entry);
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);

      return false;
    }

    return true;
  }

  /**
   * Clear all values from cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.resetStats();
  }

  /**
   * Get multiple values from cache
   */
  async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
    const results: (T | undefined)[] = [];

    for (const key of keys) {
      const value = await this.get<T>(key);
      results.push(value);
    }

    return results;
  }

  /**
   * Set multiple values in cache
   */
  async mset<T = unknown>(
    entries: Array<{ key: string; value: T; options?: CacheSetOptions }>,
  ): Promise<void> {
    for (const { key, value, options } of entries) {
      await this.set(key, value, options);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      hitRate,
    };
  }

  /**
   * Close cache and cleanup resources
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    await this.clear();
  }

  /**
   * Check if a cache entry has expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt ? Date.now() > entry.expiresAt : false;
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Remove expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Evict oldest entries when cache is full
   * Simple implementation - removes the first N entries
   */
  private evictOldest(): void {
    // Remove 10% of entries when cache is full
    const EVICTION_RATIO = 0.1;
    const entriesToRemove = Math.max(1, Math.floor(this.cache.size * EVICTION_RATIO));
    const keys = Array.from(this.cache.keys()).slice(0, entriesToRemove);

    for (const key of keys) {
      this.cache.delete(key);
    }
  }

  /**
   * Reset cache statistics
   */
  private resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Create a new in-memory cache instance
 * @param options - Cache configuration options
 * @returns InMemoryCache instance
 */
export function createInMemoryCache(options: CacheOptions = {}): InMemoryCache {
  return new InMemoryCache(options);
}
