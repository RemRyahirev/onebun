/**
 * \@onebun/cache
 *
 * Caching module for OneBun framework with support for in-memory and Redis-based storage
 */

// Types and interfaces
export type {
  CacheEntry,
  CacheOptions,
  CacheService,
  CacheSetOptions,
  CacheStats,
  RedisCacheOptions,
} from './types';

// Constants
export {
  DEFAULT_CACHE_OPTIONS,
  DEFAULT_CLEANUP_INTERVAL,
  DEFAULT_MAX_SIZE,
  DEFAULT_REDIS_CACHE_OPTIONS,
} from './types';

// In-memory cache implementation
export {
  createInMemoryCache,
  InMemoryCache,
} from './memory-cache';

// Effect integration
export type {
  CacheService as CacheServiceInterface,
} from './cache.service';

export {
  cacheServiceTag as CacheServiceTag,
  makeCacheService,
  makeCacheServiceFromOptions,
} from './cache.service';

// Redis cache implementation (planned)
// export { createRedisCache, RedisCache } from './redis-cache';
