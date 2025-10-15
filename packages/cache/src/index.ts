/**
 * \@onebun/cache
 *
 * Caching module for OneBun framework with support for in-memory and Redis-based storage
 */

// Types and interfaces
export type {
  CacheEntry,
  CacheModuleOptions,
  CacheOptions,
  CacheService as ICacheService,
  CacheSetOptions,
  CacheStats,
  RedisCacheOptions,
} from './types';

export { CacheType } from './types';

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

// Redis cache implementation
export {
  createRedisCache,
  RedisCache,
} from './redis-cache';

// Redis type definitions (until official types are available)
export type {
  RedisClient,
  RedisClientOptions,
} from './bun-redis-types';
export { hasRedisClient } from './bun-redis-types';

// NestJS-like module and service for use with @Module decorator (recommended for new applications)
export { CacheModule } from './cache.module';
export { CacheService } from './cache.service';

// Effect.js integration (suffix only for module and service to avoid name conflicts)
export type {
  CacheService as CacheServiceEffect,
} from './cache-effect.service';

export {
  cacheServiceTag,
  makeCacheService,
  makeCacheServiceFromOptions,
} from './cache-effect.service';

// Effect.js-based cache module
export {
  CacheModuleEffect,
  createCacheModule,
  createCacheModuleAsync,
  CacheType as CacheTypeEffect,
} from './cache-effect.module';
