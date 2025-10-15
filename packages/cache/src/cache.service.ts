import { BaseService, Service } from '@onebun/core';
import { Env, EnvLoader, EnvParser } from '@onebun/envs';
import { Effect } from 'effect';

import { createInMemoryCache, InMemoryCache } from './memory-cache';
import { createRedisCache, RedisCache } from './redis-cache';
import type {
  CacheModuleOptions,
  CacheOptions,
  CacheService as ICacheService,
  CacheSetOptions,
  CacheStats,
  RedisCacheOptions,
} from './types';
import { CacheType, DEFAULT_CACHE_OPTIONS, DEFAULT_REDIS_CACHE_OPTIONS } from './types';

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
 * Load cache configuration from environment variables
 */
async function loadFromEnv(prefix: string = DEFAULT_ENV_PREFIX): Promise<CacheEnvSchema> {
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
 * Cache service implementation that can be used with the Module decorator
 * This service extends BaseService and can be injected into controllers
 */
@Service()
export class CacheService extends BaseService implements ICacheService {
  private cache: InMemoryCache | RedisCache;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(...args: unknown[]) {
    super(...args);
    
    // Create in-memory cache by default
    // Will be initialized properly in the initialize() method
    this.cache = createInMemoryCache();
    
    // Auto-initialize from environment variables
    this.initPromise = this.autoInitialize();
  }

  /**
   * Auto-initialize cache from environment variables and/or module options
   * Module options take priority over environment variables
   * This method is called automatically in the constructor
   */
  private async autoInitialize(): Promise<void> {
    try {
      // Try to get options from CacheModule.forRoot()
      const moduleOptions = this.getModuleOptions();
      
      // Use envPrefix from module options or default
      const envPrefix = moduleOptions?.envPrefix ?? DEFAULT_ENV_PREFIX;
      
      // Load environment configuration with custom prefix
      const envConfig = await loadFromEnv(envPrefix);
      
      // Merge configuration: module options > env config > defaults
      const type = (moduleOptions?.type ?? envConfig.type) as CacheType;
      
      this.logger.debug(`Auto-initializing cache service with type: ${type}`, {
        fromModuleOptions: !!moduleOptions,
        envPrefix,
      });
      
      if (type === 'redis') {
        const cacheOptions: CacheOptions = {
          defaultTtl: moduleOptions?.cacheOptions?.defaultTtl ?? envConfig.defaultTtl,
          maxSize: moduleOptions?.cacheOptions?.maxSize ?? envConfig.maxSize,
          cleanupInterval: moduleOptions?.cacheOptions?.cleanupInterval ?? envConfig.cleanupInterval,
        };
        
        const redisOptions: RedisCacheOptions = {
          ...cacheOptions,
          host: moduleOptions?.redisOptions?.host ?? envConfig.redis.host,
          port: moduleOptions?.redisOptions?.port ?? envConfig.redis.port,
          password: moduleOptions?.redisOptions?.password ?? envConfig.redis.password,
          database: moduleOptions?.redisOptions?.database ?? envConfig.redis.database,
          connectTimeout: moduleOptions?.redisOptions?.connectTimeout ?? envConfig.redis.connectTimeout,
          keyPrefix: moduleOptions?.redisOptions?.keyPrefix ?? envConfig.redis.keyPrefix,
        };
        
        this.cache = createRedisCache(redisOptions);
        await this.cache.connect();
        this.logger.info('Redis cache initialized and connected', {
          source: moduleOptions ? 'module options + env' : 'env only',
        });
      } else {
        const cacheOptions: CacheOptions = {
          defaultTtl: moduleOptions?.cacheOptions?.defaultTtl ?? envConfig.defaultTtl,
          maxSize: moduleOptions?.cacheOptions?.maxSize ?? envConfig.maxSize,
          cleanupInterval: moduleOptions?.cacheOptions?.cleanupInterval ?? envConfig.cleanupInterval,
        };
        
        this.cache = createInMemoryCache(cacheOptions);
        this.logger.info('In-memory cache initialized', {
          source: moduleOptions ? 'module options + env' : 'env only',
        });
      }
      
      this.initialized = true;
    } catch (error) {
      this.logger.error('Failed to auto-initialize cache from environment', error);
      // Fall back to in-memory cache
      this.cache = createInMemoryCache();
      this.initialized = true;
    }
  }
  
  /**
   * Get module options from CacheModule if available
   * @private
   */
  private getModuleOptions(): CacheModuleOptions | undefined {
    try {
      // Dynamically import CacheModule to avoid circular dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { CacheModule } = require('./cache.module');
      return CacheModule.getOptions();
    } catch {
      return undefined;
    }
  }
  
  /**
   * Wait for initialization to complete
   * This method should be called before using the service
   */
  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Get a value from cache by key
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.waitForInit();

    return await this.cache.get<T>(key);
  }

  /**
   * Set a value in cache
   */
  async set<T = unknown>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    await this.waitForInit();

    return await this.cache.set(key, value, options);
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<boolean> {
    await this.waitForInit();

    return await this.cache.delete(key);
  }

  /**
   * Check if a key exists in cache
   */
  async has(key: string): Promise<boolean> {
    await this.waitForInit();

    return await this.cache.has(key);
  }

  /**
   * Clear all values from cache
   */
  async clear(): Promise<void> {
    await this.waitForInit();

    return await this.cache.clear();
  }

  /**
   * Get multiple values from cache
   */
  async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
    await this.waitForInit();

    return await this.cache.mget<T>(keys);
  }

  /**
   * Set multiple values in cache
   */
  async mset<T = unknown>(
    entries: Array<{ key: string; value: T; options?: CacheSetOptions }>,
  ): Promise<void> {
    await this.waitForInit();

    return await this.cache.mset(entries);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    await this.waitForInit();

    return await this.cache.getStats();
  }

  /**
   * Close cache connection and cleanup resources
   */
  async close(): Promise<void> {
    await this.waitForInit();
    if (this.initialized) {
      await this.cache.close();
      this.initialized = false;
      this.logger.info('Cache service closed');
    }
  }
}
