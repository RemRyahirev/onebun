import type { CacheModuleOptions } from './types';

import { Module } from '@onebun/core';


import { CacheService } from './cache.service';

// Symbol to store module options
const CACHE_MODULE_OPTIONS = Symbol('CACHE_MODULE_OPTIONS');

/**
 * Cache module that can be imported in other modules
 * Provides CacheService that can be injected into controllers and services
 * 
 * Configuration is loaded from environment variables by default,
 * but can be overridden with module options.
 * 
 * Environment variables:
 * - CACHE_TYPE: 'memory' or 'redis' (default: 'memory')
 * - CACHE_DEFAULT_TTL: Default TTL in milliseconds (default: 0 - no expiration)
 * - CACHE_MAX_SIZE: Maximum cache size for in-memory cache (default: unlimited)
 * - CACHE_CLEANUP_INTERVAL: Cleanup interval in milliseconds (default: 60000)
 * - CACHE_REDIS_HOST: Redis host (default: 'localhost')
 * - CACHE_REDIS_PORT: Redis port (default: 6379)
 * - CACHE_REDIS_PASSWORD: Redis password (default: '')
 * - CACHE_REDIS_DATABASE: Redis database number (default: 0)
 * - CACHE_REDIS_CONNECT_TIMEOUT: Redis connection timeout (default: 5000)
 * - CACHE_REDIS_KEY_PREFIX: Redis key prefix (default: 'onebun:cache:')
 * 
 * @example Basic usage with environment variables
 * ```typescript
 * import { Module } from '@onebun/core';
 * import { CacheModule } from '@onebun/cache';
 * 
 * @Module({
 *   imports: [CacheModule],
 *   controllers: [MyController],
 * })
 * export class AppModule {}
 * ```
 * 
 * @example With module options (overrides environment variables)
 * ```typescript
 * import { Module } from '@onebun/core';
 * import { CacheModule, CacheType } from '@onebun/cache';
 * 
 * @Module({
 *   imports: [
 *     CacheModule.forRoot({
 *       type: CacheType.REDIS,
 *       cacheOptions: { defaultTtl: 60000 },
 *       redisOptions: { host: 'redis.example.com', port: 6379 },
 *       envPrefix: 'MY_CACHE', // Custom env prefix (default: 'CACHE')
 *     }),
 *   ],
 *   controllers: [MyController],
 * })
 * export class AppModule {}
 * ```
 * 
 * Then inject CacheService in your controller:
 * ```typescript
 * import { Controller, Get } from '@onebun/core';
 * import { CacheService } from '@onebun/cache';
 * 
 * @Controller('/api')
 * export class MyController {
 *   constructor(private cacheService: CacheService) {}
 *   
 *   @Get('/cached')
 *   async getCached() {
 *     const value = await this.cacheService.get('key');
 *     return { value };
 *   }
 * }
 * ```
 */
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {
  /**
   * Configure cache module with custom options
   * Options will override environment variables
   * 
   * @param options - Cache module configuration options
   * @returns Module class with configuration
   * 
   * @example
   * ```typescript
   * CacheModule.forRoot({
   *   type: CacheType.MEMORY,
   *   cacheOptions: {
   *     defaultTtl: 60000,
   *     maxSize: 1000,
   *   },
   * })
   * ```
   */
  static forRoot(options: CacheModuleOptions): typeof CacheModule {
    // Store options in a static property that CacheService can access
    (CacheModule as any)[CACHE_MODULE_OPTIONS] = options;

    return CacheModule;
  }

  /**
   * Get module options (used internally by CacheService)
   * @internal
   */
  static getOptions(): CacheModuleOptions | undefined {
    return (CacheModule as any)[CACHE_MODULE_OPTIONS];
  }
}
