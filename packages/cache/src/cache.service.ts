import { Effect } from 'effect';

import type {
  CacheBackendStatus,
  CacheModuleOptions,
  CacheOptions,
  CacheService as ICacheService,
  CacheSetOptions,
  CacheStats,
  RedisCacheOptions,
} from './types';

import {
  BaseService,
  type OnModuleDestroy,
  type OnModuleInit,
  Service,
} from '@onebun/core';
import {
  Env,
  EnvLoader,
  EnvParser,
} from '@onebun/envs';

import { createInMemoryCache, InMemoryCache } from './memory-cache';
import {
  createRedisCache,
  RedisCache,
  withDeadline,
} from './redis-cache';
import {
  CacheType,
  DEFAULT_CACHE_OPTIONS,
  DEFAULT_REDIS_CACHE_OPTIONS,
  DEFAULT_REDIS_CONNECT_TIMEOUT,
} from './types';

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
  allowDegradedStart: boolean;
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
    allowDegradedStart: Env.boolean({
      env: `${prefix}_ALLOW_DEGRADED_START`,
      default: false,
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

  const allowDegradedStart = await Effect.runPromise(
    EnvParser.parse(
      `${prefix}_ALLOW_DEGRADED_START`,
      rawEnv[`${prefix}_ALLOW_DEGRADED_START`],
      schema.allowDegradedStart,
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
    allowDegradedStart,
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
 * A configured backend that never became usable. Its own class so the configuration-error
 * fallback in `autoInitialize()` cannot swallow the one failure that must reach `app.start()`.
 */
class CacheBackendUnavailableError extends Error {
  override readonly name = 'CacheBackendUnavailableError';
}

/**
 * Remove anything secret from text that is about to be logged or thrown.
 *
 * The framework's own startup error is a leak channel: the Redis driver rejects with a message
 * built from the connection URL, and that URL carries the password. Two passes, because a
 * configured password can also appear outside a URL.
 */
function redactSecrets(text: string, password: string): string {
  const withoutUserinfo = text.replace(/(rediss?:\/\/)[^@\s/]*@/gi, '$1***@');

  return password.length > 0 ? withoutUserinfo.replaceAll(password, '***') : withoutUserinfo;
}

/**
 * Cache service implementation that can be used with the Module decorator
 * This service extends BaseService and can be injected into controllers
 *
 * @see docs:api/cache.md
 */
@Service()
export class CacheService extends BaseService implements ICacheService, OnModuleInit, OnModuleDestroy {
  private cache: InMemoryCache | RedisCache;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private configuredBackend: CacheType = CacheType.MEMORY;
  private activeBackend: CacheType = CacheType.MEMORY;

  constructor() {
    super();

    // Create in-memory cache by default
    // Will be initialized properly in the initialize() method
    this.cache = createInMemoryCache();

    // Auto-initialize from environment variables
    this.initPromise = this.autoInitialize();

    // Nothing awaits this promise until `onModuleInit()`, which is where a failure has to
    // surface so that `app.start()` rejects. Without a handler attached right here the
    // rejection would be reported as unhandled — and can take the process down — before the
    // framework reaches the hook. Attaching one marks THIS promise handled while leaving it
    // rejected for every later `await`.
    void this.initPromise.catch(() => undefined);
  }

  /**
   * Fail the application start when a configured backend never came up.
   *
   * The connection attempt itself runs from the constructor, so it overlaps with the rest of
   * the bootstrap; this hook is where its outcome is collected. `app.start()` awaits the hook,
   * so a `type: REDIS` cache that could not connect stops the process from taking traffic
   * instead of silently serving a private in-memory cache — unless `allowDegradedStart` says
   * that is acceptable.
   *
   * @see docs:api/cache.md
   */
  async onModuleInit(): Promise<void> {
    await this.waitForInit();
  }

  /**
   * Which backend was configured and which one is actually serving.
   *
   * Synchronous and cheap, so a readiness endpoint can call it on every probe: treat
   * `degraded: true` as NOT ready, since the process is then on a cache no other replica shares
   * and no invalidation reaches. Meaningful once initialization has settled, which the framework
   * awaits in `onModuleInit()` — anything running after `app.start()` reads the final answer.
   *
   * @see docs:api/cache.md
   */
  getBackendStatus(): CacheBackendStatus {
    return {
      configured: this.configuredBackend,
      active: this.activeBackend,
      degraded: this.activeBackend !== this.configuredBackend,
    };
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
      const allowDegradedStart = moduleOptions?.allowDegradedStart ?? envConfig.allowDegradedStart;

      this.configuredBackend = type;

      this.logger.debug(`Auto-initializing cache service with type: ${type}`, {
        fromModuleOptions: !!moduleOptions,
        envPrefix,
      });

      const cacheOptions: CacheOptions = {
        defaultTtl: moduleOptions?.cacheOptions?.defaultTtl ?? envConfig.defaultTtl,
        maxSize: moduleOptions?.cacheOptions?.maxSize ?? envConfig.maxSize,
        cleanupInterval: moduleOptions?.cacheOptions?.cleanupInterval ?? envConfig.cleanupInterval,
      };

      if (type === 'redis') {
        const redisOptions: RedisCacheOptions = {
          ...cacheOptions,
          host: moduleOptions?.redisOptions?.host ?? envConfig.redis.host,
          port: moduleOptions?.redisOptions?.port ?? envConfig.redis.port,
          password: moduleOptions?.redisOptions?.password ?? envConfig.redis.password,
          database: moduleOptions?.redisOptions?.database ?? envConfig.redis.database,
          connectTimeout: moduleOptions?.redisOptions?.connectTimeout ?? envConfig.redis.connectTimeout,
          keyPrefix: moduleOptions?.redisOptions?.keyPrefix ?? envConfig.redis.keyPrefix,
        };

        await this.connectRedis(redisOptions, cacheOptions, envPrefix, allowDegradedStart);
      } else {
        this.cache = createInMemoryCache(cacheOptions);
        this.activeBackend = CacheType.MEMORY;
        this.logger.info('In-memory cache initialized', {
          source: moduleOptions ? 'module options + env' : 'env only',
        });
      }

      this.initialized = true;
    } catch (error) {
      if (error instanceof CacheBackendUnavailableError) {
        // A backend the application asked for and never got is a startup failure, not
        // something to paper over. Rethrow so `onModuleInit()` rejects `app.start()`.
        throw error;
      }

      this.logger.error('Failed to auto-initialize cache from environment', error);
      // Fall back to in-memory cache
      this.cache = createInMemoryCache();
      this.activeBackend = CacheType.MEMORY;
      this.initialized = true;
    }
  }

  /**
   * Connect the configured Redis backend, or decide what happens when it never comes up.
   *
   * The connect is BOUNDED. `connectTimeout` reaches the driver, but with `reconnect: true` the
   * driver retries a host that swallows packets forever and never rejects — measured: a
   * black-holed host left `waitForInit()` unsettled past 20s with `connectTimeout` at 1s. The
   * deadline here is what turns that into an answer.
   */
  private async connectRedis(
    redisOptions: RedisCacheOptions,
    cacheOptions: CacheOptions,
    envPrefix: string,
    allowDegradedStart: boolean,
  ): Promise<void> {
    const password = redisOptions.password ?? '';
    // A password NEVER appears here: the target is rebuilt from the fields, not from the URL
    // the driver connects with.
    const target = `redis://${redisOptions.host}:${redisOptions.port}/${redisOptions.database ?? 0}`;
    // `0` disables the driver's own timeout; a deadline of `0` would instead fail instantly,
    // so fall back to the documented default rather than inventing a new failure mode.
    const timeout = redisOptions.connectTimeout && redisOptions.connectTimeout > 0
      ? redisOptions.connectTimeout
      : DEFAULT_REDIS_CONNECT_TIMEOUT;

    const redisCache = createRedisCache(redisOptions);
    const startedAt = Date.now();

    try {
      await withDeadline(redisCache.connect(), timeout);
      this.cache = redisCache;
      this.activeBackend = CacheType.REDIS;
      this.logger.info('Redis cache initialized and connected', { target });

      return;
    } catch (error) {
      // The abandoned client keeps retrying for the life of the process unless it is closed.
      await redisCache.close().catch(() => undefined);

      const waited = Date.now() - startedAt;
      const reason = redactSecrets(String(error), password);
      const what = `Cache backend "redis" at ${target} did not become usable within ${timeout}ms `
        + `(gave up after ${waited}ms). Cause: ${reason}.`;

      if (!allowDegradedStart) {
        throw new CacheBackendUnavailableError(
          `${what} The application configured redis explicitly, so startup fails instead of `
          + 'silently serving a process-local in-memory cache. Set allowDegradedStart: true '
          + `(or ${envPrefix}_ALLOW_DEGRADED_START=true) to accept a degraded cache at boot.`,
        );
      }

      this.logger.warn(
        `${what} Serving a PROCESS-LOCAL in-memory cache instead: it is not shared with other `
        + 'replicas, cross-replica invalidation silently does nothing, and this process never '
        + 'retries redis. Allowed by allowDegradedStart — remove it to fail startup instead.',
        {
          configured: CacheType.REDIS,
          active: CacheType.MEMORY,
          target,
          connectTimeoutMs: timeout,
          waitedMs: waited,
        },
      );

      this.cache = createInMemoryCache(cacheOptions);
      this.activeBackend = CacheType.MEMORY;
    }
  }

  /**
   * Get module options from CacheModule if available
   */
  private getModuleOptions(): CacheModuleOptions | undefined {
    // THIS service's own registration first. The class-static slot below is shared by every
    // registration in the process, so reading it first would make two forRoot() calls
    // collapse onto the last one — two CacheService instances, one cache, silently.
    const own = this.registrationOptions<CacheModuleOptions>();
    if (own) {
      return own;
    }

    try {
      // Dynamically import CacheModule to avoid circular dependency
      // eslint-disable-next-line @typescript-eslint/naming-convention
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
  /**
   * Close the cache when the application stops.
   *
   * A shared Redis client is deliberately NOT disconnected here: `close()` disconnects only
   * a client this service owns, and the application already disconnects the shared one
   * during `stop()`, gated on `closeSharedRedis`. Doing it here would tear down a client
   * other parts of the process are still using.
   *
   * @see docs:api/cache.md
   */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    try {
      await this.waitForInit();
    } catch {
      // A failed initialization is reported by `onModuleInit()`, and shutdown still has to run:
      // rethrowing here would replace the real startup error with a second copy of itself.
      // Nothing was installed in that case, so there is nothing left to close.
      return;
    }

    if (this.initialized) {
      await this.cache.close();
      this.initialized = false;
      this.logger.info('Cache service closed');
    }
  }
}
