import { Effect, Layer } from 'effect';

import type { CacheService } from './cache.service';
import type { CacheOptions, RedisCacheOptions } from './types';

import { Env } from '@onebun/envs';

import { cacheServiceTag, makeCacheService } from './cache.service';
import { createInMemoryCache } from './memory-cache';
import { createRedisCache } from './redis-cache';
import { DEFAULT_CACHE_OPTIONS, DEFAULT_REDIS_CACHE_OPTIONS } from './types';


/**
 * Cache type enum
 */
export enum CacheType {
  MEMORY = 'memory',
  REDIS = 'redis',
}

/**
 * Cache module configuration
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
  redisOptions?: RedisCacheOptions;

  /**
   * Environment variable prefix for cache configuration
   * @defaultValue 'CACHE'
   */
  envPrefix?: string;
}

/**
 * Default environment variable prefix
 */
const DEFAULT_ENV_PREFIX = 'CACHE';

/**
 * Cache environment schema
 */
interface CacheEnvSchema {
  type: string;
  defaultTtl: number;
  maxSize: number;
  cleanupInterval: number;
  redis: {
    host: string;
    port: number;
    password: string;
    database: number;
    connectTimeout: number;
    keyPrefix: string;
  };
}

/**
 * Create cache environment schema with given prefix
 */
function createCacheEnvSchema(prefix: string = DEFAULT_ENV_PREFIX) {
  return {
    type: Env.string({
      env: `${prefix}_TYPE`,
      default: CacheType.MEMORY,
      validate: Env.oneOf([CacheType.MEMORY, CacheType.REDIS] as const),
    }),
    defaultTtl: Env.number({
      env: `${prefix}_DEFAULT_TTL`,
      default: DEFAULT_CACHE_OPTIONS.defaultTtl,
      min: 0,
    }),
    maxSize: Env.number({
      env: `${prefix}_MAX_SIZE`,
      default: DEFAULT_CACHE_OPTIONS.maxSize,
      min: 0,
    }),
    cleanupInterval: Env.number({
      env: `${prefix}_CLEANUP_INTERVAL`,
      default: DEFAULT_CACHE_OPTIONS.cleanupInterval,
      min: 0,
    }),
    redis: {
      host: Env.string({
        env: `${prefix}_REDIS_HOST`,
        default: DEFAULT_REDIS_CACHE_OPTIONS.host,
      }),
      port: Env.number({
        env: `${prefix}_REDIS_PORT`,
        default: DEFAULT_REDIS_CACHE_OPTIONS.port,
        validate: Env.port(),
      }),
      password: Env.string({
        env: `${prefix}_REDIS_PASSWORD`,
        default: '',
        sensitive: true,
      }),
      database: Env.number({
        env: `${prefix}_REDIS_DATABASE`,
        default: DEFAULT_REDIS_CACHE_OPTIONS.database,
        min: 0,
      }),
      connectTimeout: Env.number({
        env: `${prefix}_REDIS_CONNECT_TIMEOUT`,
        default: DEFAULT_REDIS_CACHE_OPTIONS.connectTimeout,
        min: 0,
      }),
      keyPrefix: Env.string({
        env: `${prefix}_REDIS_KEY_PREFIX`,
        default: DEFAULT_REDIS_CACHE_OPTIONS.keyPrefix,
      }),
    },
  };
}

/**
 * Load cache configuration from environment variables using onebun/envs module
 */
async function loadFromEnv(prefix: string = DEFAULT_ENV_PREFIX): Promise<CacheEnvSchema> {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { EnvLoader, EnvParser } = await import('@onebun/envs');
  
  const schema = createCacheEnvSchema(prefix);
  const rawEnv = await Effect.runPromise(EnvLoader.load());
  
  // Parse each field using EnvParser
  const type = await Effect.runPromise(
    EnvParser.parse(`${prefix}_TYPE`, rawEnv[`${prefix}_TYPE`], schema.type),
  );
  
  const defaultTtl = await Effect.runPromise(
    EnvParser.parse(`${prefix}_DEFAULT_TTL`, rawEnv[`${prefix}_DEFAULT_TTL`], schema.defaultTtl),
  );
  
  const maxSize = await Effect.runPromise(
    EnvParser.parse(`${prefix}_MAX_SIZE`, rawEnv[`${prefix}_MAX_SIZE`], schema.maxSize),
  );
  
  const cleanupInterval = await Effect.runPromise(
    EnvParser.parse(
      `${prefix}_CLEANUP_INTERVAL`,
      rawEnv[`${prefix}_CLEANUP_INTERVAL`],
      schema.cleanupInterval,
    ),
  );
  
  const redisHost = await Effect.runPromise(
    EnvParser.parse(`${prefix}_REDIS_HOST`, rawEnv[`${prefix}_REDIS_HOST`], schema.redis.host),
  );
  
  const redisPort = await Effect.runPromise(
    EnvParser.parse(`${prefix}_REDIS_PORT`, rawEnv[`${prefix}_REDIS_PORT`], schema.redis.port),
  );
  
  const redisPassword = await Effect.runPromise(
    EnvParser.parse(
      `${prefix}_REDIS_PASSWORD`,
      rawEnv[`${prefix}_REDIS_PASSWORD`],
      schema.redis.password,
    ),
  );
  
  const redisDatabase = await Effect.runPromise(
    EnvParser.parse(
      `${prefix}_REDIS_DATABASE`,
      rawEnv[`${prefix}_REDIS_DATABASE`],
      schema.redis.database,
    ),
  );
  
  const redisConnectTimeout = await Effect.runPromise(
    EnvParser.parse(
      `${prefix}_REDIS_CONNECT_TIMEOUT`,
      rawEnv[`${prefix}_REDIS_CONNECT_TIMEOUT`],
      schema.redis.connectTimeout,
    ),
  );
  
  const redisKeyPrefix = await Effect.runPromise(
    EnvParser.parse(
      `${prefix}_REDIS_KEY_PREFIX`,
      rawEnv[`${prefix}_REDIS_KEY_PREFIX`],
      schema.redis.keyPrefix,
    ),
  );
  
  return {
    type,
    defaultTtl,
    maxSize,
    cleanupInterval,
    redis: {
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      database: redisDatabase,
      connectTimeout: redisConnectTimeout,
      keyPrefix: redisKeyPrefix,
    },
  };
}

/**
 * Merge configuration from different sources
 * Priority: explicit options \> environment variables \> defaults
 */
async function mergeConfig(
  options: CacheModuleOptions = {},
): Promise<{
  type: CacheType;
  cacheOptions: CacheOptions;
  redisOptions: RedisCacheOptions;
}> {
  const envPrefix = options.envPrefix || DEFAULT_ENV_PREFIX;
  const envConfig = await loadFromEnv(envPrefix);

  // Determine cache type
  const type = options.type ?? (envConfig.type as CacheType) ?? CacheType.MEMORY;

  // Merge common cache options
  const cacheOptions: CacheOptions = {
    defaultTtl: options.cacheOptions?.defaultTtl ?? envConfig.defaultTtl,
    maxSize: options.cacheOptions?.maxSize ?? envConfig.maxSize,
    cleanupInterval: options.cacheOptions?.cleanupInterval ?? envConfig.cleanupInterval,
  };

  // Merge Redis-specific options
  const redisOptions: RedisCacheOptions = {
    host: options.redisOptions?.host ?? envConfig.redis.host,
    port: options.redisOptions?.port ?? envConfig.redis.port,
    password: options.redisOptions?.password ?? envConfig.redis.password,
    database: options.redisOptions?.database ?? envConfig.redis.database,
    connectTimeout: options.redisOptions?.connectTimeout ?? envConfig.redis.connectTimeout,
    keyPrefix: options.redisOptions?.keyPrefix ?? envConfig.redis.keyPrefix,
  };

  return { type, cacheOptions, redisOptions };
}

/**
 * Create cache module layer (synchronous version - uses defaults without env loading)
 * For environment variable support, use createCacheModuleAsync
 * @param options - Cache module configuration options
 * @returns Layer providing CacheService
 */
export function createCacheModule(
  options: CacheModuleOptions = {},
): Layer.Layer<CacheService, never, never> {
  // Use async module creation wrapped in Effect
  return Layer.unwrapEffect(
    Effect.promise(() => createCacheModuleAsync(options)),
  );
}

/**
 * Create cache module layer with async initialization
 * Useful when you need to ensure Redis connection is established
 * @param options - Cache module configuration options
 * @returns Promise that resolves to Layer providing CacheService
 */
export async function createCacheModuleAsync(
  options: CacheModuleOptions = {},
): Promise<Layer.Layer<CacheService, never, never>> {
  const config = await mergeConfig(options);

  if (config.type === CacheType.REDIS) {
    // Create Redis cache with merged options
    const cache = createRedisCache({
      ...config.cacheOptions,
      ...config.redisOptions,
    });

    // Connect to Redis
    await cache.connect();

    // Return the layer
    return makeCacheService(cache);
  }

  // Create in-memory cache
  const cache = createInMemoryCache(config.cacheOptions);

  return makeCacheService(cache);
}

/**
 * Export cache service tag for dependency injection
 */
export { cacheServiceTag };
