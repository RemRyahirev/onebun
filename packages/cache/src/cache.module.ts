import type { CacheModuleOptions } from './types';

import {
  Global,
  Module,
  registerModule,
  removeFromGlobalModules,
  selectRegistration,
  type RegistrationToken,
} from '@onebun/core';


import { CacheService } from './cache.service';

// Symbol to store module options
const CACHE_MODULE_OPTIONS = Symbol('CACHE_MODULE_OPTIONS');

/**
 * Cache module that can be imported in other modules
 * Provides CacheService that can be injected into controllers and services
 * 
 * By default, CacheModule is global - CacheService is available in all modules
 * without explicit import. Use `isGlobal: false` to disable this behavior.
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
 * @example Basic usage with environment variables (global by default)
 * ```typescript
 * import { Module } from '@onebun/core';
 * import { CacheModule } from '@onebun/cache';
 * 
 * @Module({
 *   imports: [CacheModule],
 *   controllers: [MyController],
 * })
 * export class AppModule {}
 * 
 * // CacheService is automatically available in all submodules
 * @Module({
 *   controllers: [UserController],
 *   providers: [UserService], // UserService can inject CacheService
 * })
 * export class UserModule {}
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
 * @example Non-global mode (for multi-cache scenarios)
 * ```typescript
 * // Each import creates a new CacheService instance
 * CacheModule.forRoot({
 *   type: CacheType.REDIS,
 *   isGlobal: false,
 * })
 * 
 * // Submodules must explicitly import CacheModule.forFeature()
 * @Module({
 *   imports: [CacheModule.forFeature()],
 *   providers: [UserService],
 * })
 * export class UserModule {}
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
 *
 * @see docs:api/cache.md
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {
  /**
   * Configure cache module with custom options
   * Options will override environment variables
   * 
   * By default, isGlobal is true - CacheService is available in all modules.
   * Set isGlobal: false for multi-cache scenarios where each import
   * should create a new CacheService instance.
   * 
   * @param options - Cache module configuration options
   * @returns Module class with configuration
   * 
   * @example Global mode (default)
   * ```typescript
   * CacheModule.forRoot({
   *   type: CacheType.MEMORY,
   *   cacheOptions: {
   *     defaultTtl: 60000,
   *     maxSize: 1000,
   *   },
   * })
   * ```
   * 
   * @example Non-global mode
   * ```typescript
   * CacheModule.forRoot({
   *   type: CacheType.REDIS,
   *   isGlobal: false, // Each import creates new instance
   * })
   * ```
   */
  static forRoot(options: CacheModuleOptions): typeof CacheModule {
    // Store options in a static property that CacheService can access.
    // Kept for the no-application path — a CacheService built by hand has no module and
    // therefore no registration to read from.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (CacheModule as any)[CACHE_MODULE_OPTIONS] = options;

    if (options.as !== undefined && options.isGlobal === true) {
      throw new Error(
        'CacheModule.forRoot({ as, isGlobal: true }) is not a valid combination. A named ' +
        'registration is never global: ambient visibility has one slot per service class, ' +
        'so two global registrations would collapse back into one instance. Reach a named ' +
        'registration by importing CacheModule.forFeature(<token>).',
      );
    }

    // A NAMED registration gets its own module identity and its own options; an unnamed one
    // keeps the base module exactly as before.
    // The fifth argument is this call's ambient visibility. Only this module knows its own
    // options shape, and globality is what a second unnamed forRoot() can silently overrule.
    const registration = registerModule(
      CacheModule, options, options.as, [CacheService],
      options.as === undefined ? options.isGlobal !== false : undefined,
    );

    // If isGlobal is explicitly set to false, remove from global modules registry.
    // Symmetric on purpose: the registry is process-wide, so without the else branch one
    // opt-out de-globalized CacheModule for every later forRoot() in the process.
    if (options.isGlobal === false) {
      removeFromGlobalModules(CacheModule);
    } else if (options.as === undefined) {
      Global()(CacheModule);
    }

    return registration as typeof CacheModule;
  }

  /**
   * Import CacheModule into a feature module
   * 
   * Use this method when CacheModule is not global (isGlobal: false)
   * and you need to explicitly import CacheService in a submodule.
   * 
   * When CacheModule is global (default), you don't need to use forFeature() -
   * CacheService is automatically available in all modules.
   * 
   * @returns Module class that exports CacheService
   * 
   * @example
   * ```typescript
   * // In root module: non-global CacheModule
   * @Module({
   *   imports: [
   *     CacheModule.forRoot({
   *       type: CacheType.MEMORY,
   *       isGlobal: false,
   *     }),
   *   ],
   * })
   * export class AppModule {}
   * 
   * // In feature module: explicitly import CacheService
   * @Module({
   *   imports: [CacheModule.forFeature()],
   *   providers: [UserService],
   * })
   * export class UserModule {}
   * ```
   */
  static forFeature(token?: RegistrationToken): typeof CacheModule {
    // With no token this resolves to the single registration, which is the base module itself
    // when forRoot() was called without `as` — so an application with one cache writes
    // exactly what it wrote before. With a token it selects that registration.
    return selectRegistration(CacheModule, token, [CacheService]) as typeof CacheModule;
  }

  /**
   * Get module options (used internally by CacheService)
   * @internal
   */
  static getOptions(): CacheModuleOptions | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (CacheModule as any)[CACHE_MODULE_OPTIONS];
  }

  /**
   * Clear module options (used for testing)
   * @internal
   */
  static clearOptions(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (CacheModule as any)[CACHE_MODULE_OPTIONS];
  }
}
