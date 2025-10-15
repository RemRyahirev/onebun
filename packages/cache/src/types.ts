/**
 * Default cleanup interval for expired cache entries (1 minute)
 */
export const DEFAULT_CLEANUP_INTERVAL = 60000;

/**
 * Default maximum cache size (unlimited)
 */
export const DEFAULT_MAX_SIZE = undefined;

/**
 * Cache entry metadata
 */
export interface CacheEntry<T = unknown> {
  /**
   * Cached value
   */
  value: T;

  /**
   * Timestamp when entry was created
   */
  createdAt: number;

  /**
   * Timestamp when entry expires (undefined if no expiration)
   */
  expiresAt?: number;

  /**
   * Time to live in milliseconds
   */
  ttl?: number;
}

/**
 * Options for setting cache entries
 */
export interface CacheSetOptions {
  /**
   * Time to live in milliseconds
   * If not provided, uses cache's default TTL
   */
  ttl?: number;
}

/**
 * Configuration options for cache instances
 */
export interface CacheOptions {
  /**
   * Default TTL for cache entries in milliseconds
   * If not provided, entries never expire
   */
  defaultTtl?: number;

  /**
   * Maximum number of entries in cache
   * Only applicable for in-memory cache
   */
  maxSize?: number;

  /**
   * Cleanup interval for expired entries in milliseconds
   * Only applicable for in-memory cache
   */
  cleanupInterval?: number;
}

/**
 * Statistics about cache performance
 */
export interface CacheStats {
  /**
   * Total number of cache hits
   */
  hits: number;

  /**
   * Total number of cache misses
   */
  misses: number;

  /**
   * Total number of entries in cache
   */
  entries: number;

  /**
   * Cache hit rate (hits / (hits + misses))
   */
  hitRate: number;
}

/**
 * Universal cache service interface
 * This interface is implemented by both in-memory and Redis cache services
 */
export interface CacheService {
  /**
   * Get a value from cache by key
   * @param key - Cache key
   * @returns Promise that resolves to the cached value or undefined if not found
   */
  get<T = unknown>(key: string): Promise<T | undefined>;

  /**
   * Set a value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param options - Cache options (TTL, etc.)
   */
  set<T = unknown>(key: string, value: T, options?: CacheSetOptions): Promise<void>;

  /**
   * Delete a value from cache
   * @param key - Cache key
   * @returns Promise that resolves to true if key was deleted, false if key didn't exist
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists in cache
   * @param key - Cache key
   * @returns Promise that resolves to true if key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Clear all values from cache
   */
  clear(): Promise<void>;

  /**
   * Get multiple values from cache
   * @param keys - Array of cache keys
   * @returns Promise that resolves to array of values (undefined for missing keys)
   */
  mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;

  /**
   * Set multiple values in cache
   * @param entries - Array of key-value pairs with optional options
   */
  mset<T = unknown>(
    entries: Array<{ key: string; value: T; options?: CacheSetOptions }>
  ): Promise<void>;

  /**
   * Get cache statistics
   * @returns Promise that resolves to cache statistics
   */
  getStats(): Promise<CacheStats>;

  /**
   * Close cache connection and cleanup resources
   */
  close(): Promise<void>;
}

/**
 * Options for Redis cache configuration
 */
export interface RedisCacheOptions extends CacheOptions {
  /**
   * Redis host
   * @defaultValue 'localhost'
   */
  host?: string;

  /**
   * Redis port
   * @defaultValue 6379
   */
  port?: number;

  /**
   * Redis password
   */
  password?: string;

  /**
   * Redis database number
   * @defaultValue 0
   */
  database?: number;

  /**
   * Connection timeout in milliseconds
   * @defaultValue 5000
   */
  connectTimeout?: number;

  /**
   * Key prefix for all cache keys
   * @defaultValue 'onebun:cache:'
   */
  keyPrefix?: string;
}

/**
 * Default Redis port
 */
export const DEFAULT_REDIS_PORT = 6379;

/**
 * Default Redis connection timeout
 */
export const DEFAULT_REDIS_CONNECT_TIMEOUT = 5000;

/**
 * Default cache options
 */
export const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  defaultTtl: 0, // No default TTL
  maxSize: DEFAULT_MAX_SIZE,
  cleanupInterval: DEFAULT_CLEANUP_INTERVAL,
};

/**
 * Default Redis cache options
 */
export const DEFAULT_REDIS_CACHE_OPTIONS = {
  ...DEFAULT_CACHE_OPTIONS,
  host: 'localhost' as const,
  port: DEFAULT_REDIS_PORT,
  database: 0,
  connectTimeout: DEFAULT_REDIS_CONNECT_TIMEOUT,
  keyPrefix: 'onebun:cache:' as const,
};

/**
 * Cache type enum
 */
export enum CacheType {
  MEMORY = 'memory',
  REDIS = 'redis',
}

/**
 * Cache module configuration
 * Used by both NestJS-style CacheModule.forRoot() and Effect.js createCacheModule()
 */
export interface CacheModuleOptions {
  /**
   * Type of cache to use
   * @defaultValue CacheType.MEMORY
   */
  type?: CacheType;

  /**
   * Cache options (for both in-memory and Redis)
   */
  cacheOptions?: CacheOptions;

  /**
   * Redis-specific options (only used when type is REDIS)
   */
  redisOptions?: Omit<RedisCacheOptions, keyof CacheOptions>;

  /**
   * Environment variable prefix for cache configuration
   * Used when loading config from environment variables
   * For example, with prefix 'MY_CACHE':
   * - MY_CACHE_TYPE
   * - MY_CACHE_REDIS_HOST
   * - MY_CACHE_DEFAULT_TTL
   * @defaultValue 'CACHE'
   */
  envPrefix?: string;
}
