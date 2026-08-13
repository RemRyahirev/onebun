import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  Effect,
  Layer,
  pipe,
} from 'effect';

import type { CacheService } from '../src/cache-effect.service';


import {
  Module,
  OneBunApplication,
  resetRegistrations,
} from '@onebun/core';
import { createRedisContainer, createTestService } from '@onebun/core/testing';
import type { SyncLogger } from '@onebun/logger';

import {
  cacheServiceTag,
  makeCacheService,
  makeCacheServiceFromOptions,
} from '../src/cache-effect.service';
import { CacheModule } from '../src/cache.module';
import { CacheService as CacheServiceProvider } from '../src/cache.service';
import { createInMemoryCache } from '../src/memory-cache';
import { CacheType } from '../src/types';

describe('cacheServiceTag', () => {
  describe('Effect integration', () => {
    it('should work with pipe and dependency injection', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.getEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('value');
    });

    it('should handle errors gracefully', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.getEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('value');
    });

    it('should create service from options', async () => {
      const cacheLayer = makeCacheServiceFromOptions({ defaultTtl: 1000 });

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.getEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('value');
    });
  });

  describe('Layer composition', () => {
    it('should compose with other layers', async () => {
      // Create a simple combined layer test
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('composed', 'data'),
            Effect.andThen(() => cache.getEffect('composed')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('data');
    });
  });

  describe('Promise-based methods', () => {
    it('should handle delete operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            Effect.promise(() => cache.set('test', 'value')),
            Effect.andThen(() => Effect.promise(() => cache.delete('test'))),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe(true);
    });

    it('should handle has operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            Effect.promise(() => cache.set('test', 'value')),
            Effect.andThen(() => Effect.promise(() => cache.has('test'))),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe(true);
    });

    it('should handle clear operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            Effect.promise(() => cache.set('test', 'value')),
            Effect.andThen(() => Effect.promise(() => cache.clear())),
            Effect.andThen(() => Effect.promise(() => cache.has('test'))),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe(false);
    });

    it('should handle mget operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            Effect.promise(() => cache.set('key1', 'value1')),
            Effect.andThen(() => Effect.promise(() => cache.set('key2', 'value2'))),
            Effect.andThen(() => Effect.promise(() => cache.mget(['key1', 'key2', 'key3']))),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toEqual(['value1', 'value2', undefined]);
    });

    it('should handle mset operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            Effect.promise(() => cache.mset([
              { key: 'key1', value: 'value1' },
              { key: 'key2', value: 'value2' },
            ])),
            Effect.andThen(() => Effect.promise(() => cache.mget(['key1', 'key2']))),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toEqual(['value1', 'value2']);
    });

    it('should handle getStats operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            Effect.promise(() => cache.set('test', 'value')),
            Effect.andThen(() => Effect.promise(() => cache.get('test'))),
            Effect.andThen(() => Effect.promise(() => cache.getStats())),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toHaveProperty('hits');
      expect(result).toHaveProperty('misses');
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('hitRate');
    });

    it('should handle close operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          Effect.promise(() => cache.close()),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      await Effect.runPromise(runnable); // Should not throw
    });
  });

  describe('Effect-based methods', () => {
    it('should handle deleteEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.deleteEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe(true);
    });

    it('should handle hasEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.hasEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe(true);
    });

    it('should handle clearEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.clearEffect()),
            Effect.andThen(() => cache.hasEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe(false);
    });

    it('should handle mgetEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('key1', 'value1'),
            Effect.andThen(() => cache.setEffect('key2', 'value2')),
            Effect.andThen(() => cache.mgetEffect(['key1', 'key2', 'key3'])),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toEqual(['value1', 'value2', undefined]);
    });

    it('should handle msetEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.msetEffect([
              { key: 'key1', value: 'value1' },
              { key: 'key2', value: 'value2' },
            ]),
            Effect.andThen(() => cache.mgetEffect(['key1', 'key2'])),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toEqual(['value1', 'value2']);
    });

    it('should handle getStatsEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'value'),
            Effect.andThen(() => cache.getEffect('test')),
            Effect.andThen(() => cache.getStatsEffect()),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toHaveProperty('hits');
      expect(result).toHaveProperty('misses');
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('hitRate');
    });

    it('should handle closeEffect operation', async () => {
      const cacheLayer = makeCacheService(createInMemoryCache());

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) => cache.closeEffect()),
      );

      const runnable = Effect.provide(program, cacheLayer);
      await Effect.runPromise(runnable); // Should not throw
    });
  });

  describe('Error handling', () => {
    it('should handle cache errors gracefully in Effect context', async () => {
      // Create a cache that might throw errors (simulate by using a mock)
      const mockCache = {
        async get() {
          throw new Error('Cache error'); 
        },
        set: async () => await Promise.resolve(),
        delete: async () => true,
        has: async () => true,
        clear: async () => await Promise.resolve(),
        mget: async () => [],
        mset: async () => await Promise.resolve(),
        getStats: async () => ({
          hits: 0, misses: 0, entries: 0, hitRate: 0, 
        }),
        close: async () => await Promise.resolve(),
        // Effect methods
        getEffect: () => Effect.fail(new Error('Cache error')),
        setEffect: () => Effect.succeed(undefined),
        deleteEffect: () => Effect.succeed(true),
        hasEffect: () => Effect.succeed(true),
        clearEffect: () => Effect.succeed(undefined),
        mgetEffect: () => Effect.succeed([]),
        msetEffect: () => Effect.succeed(undefined),
        getStatsEffect: () => Effect.succeed({
          hits: 0, misses: 0, entries: 0, hitRate: 0, 
        }),
        closeEffect: () => Effect.succeed(undefined),
      };

      const cacheLayer = Layer.succeed(cacheServiceTag, mockCache as unknown as CacheService);

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.getEffect('test'),
            Effect.catchAll(() => Effect.succeed('error handled')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('error handled');
    });
  });
});

/**
 * A configured backend is a REQUIRED backend.
 *
 * The defect: `CACHE_TYPE=redis` with Redis down booted the process on a private in-memory
 * cache and reported success. Two replicas then held different data, invalidation reached
 * neither, and nothing on the service could tell anyone which cache was actually serving.
 */
describe('CacheService backend requirements', () => {
  const ENV_KEYS = [
    'CACHE_TYPE',
    'CACHE_REDIS_HOST',
    'CACHE_REDIS_PORT',
    'CACHE_REDIS_PASSWORD',
    'CACHE_REDIS_CONNECT_TIMEOUT',
    'CACHE_ALLOW_DEGRADED_START',
  ];
  const CONNECT_TIMEOUT_MS = 250;
  const BOUND_MS = 5000;
  const CONTAINER_TIMEOUT_MS = 120000;
  const savedEnv: Record<string, string | undefined> = {};

  /** A port that is guaranteed to have nothing listening: bound, read, released. */
  const closedPort = (): number => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('') });
    const { port } = server;
    server.stop(true);

    if (port === undefined) {
      throw new Error('Bun.serve did not report a port');
    }

    return port;
  };

  const warnLines = (logger: SyncLogger): string[] =>
    (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String(call[0]));

  const failureOf = async (service: CacheServiceProvider): Promise<string> => {
    try {
      await service.waitForInit();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    return '';
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    CacheModule.clearOptions();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    CacheModule.clearOptions();
    resetRegistrations();
  });

  it('rejects app.start() when the configured Redis backend is unreachable', async () => {
    const port = closedPort();
    process.env.CACHE_TYPE = 'redis';
    process.env.CACHE_REDIS_HOST = '127.0.0.1';
    process.env.CACHE_REDIS_PORT = String(port);
    process.env.CACHE_REDIS_CONNECT_TIMEOUT = String(CONNECT_TIMEOUT_MS);

    @Module({ imports: [CacheModule] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    let failure = '';
    try {
      await app.start();
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        await app.stop();
      } catch {
        // A start that never completed has nothing to stop.
      }
    }

    // Named: the backend, the target, the budget it was given, and the one way out.
    expect(failure).toContain('redis');
    expect(failure).toContain(`127.0.0.1:${port}`);
    expect(failure).toContain(`${CONNECT_TIMEOUT_MS}ms`);
    expect(failure).toContain('allowDegradedStart');
  });

  it('bounds the connect attempt on a host that never answers', async () => {
    // Black-holed address: packets are dropped rather than refused, so the driver's own
    // reconnect loop would wait forever. Unbounded, this hung `waitForInit()` past 20s.
    process.env.CACHE_TYPE = 'redis';
    process.env.CACHE_REDIS_HOST = '10.255.255.1';
    process.env.CACHE_REDIS_CONNECT_TIMEOUT = String(CONNECT_TIMEOUT_MS);

    const { instance: service } = createTestService(CacheServiceProvider);
    const startedAt = Date.now();
    const failure = await failureOf(service);

    expect(failure).toContain('did not become usable');
    expect(Date.now() - startedAt).toBeLessThan(BOUND_MS);
  });

  it('never puts the configured password in the startup error', async () => {
    const password = 'wi276-super-secret';
    const port = closedPort();
    process.env.CACHE_TYPE = 'redis';
    process.env.CACHE_REDIS_HOST = '127.0.0.1';
    process.env.CACHE_REDIS_PORT = String(port);
    process.env.CACHE_REDIS_PASSWORD = password;
    process.env.CACHE_REDIS_CONNECT_TIMEOUT = String(CONNECT_TIMEOUT_MS);

    const { instance: service } = createTestService(CacheServiceProvider);
    const failure = await failureOf(service);

    expect(failure).toContain(`redis://127.0.0.1:${port}/0`);
    expect(failure).not.toContain(password);
  });

  it('accepts a process-local cache only with allowDegradedStart, and says what that costs', async () => {
    const port = closedPort();
    process.env.CACHE_TYPE = 'redis';
    process.env.CACHE_REDIS_HOST = '127.0.0.1';
    process.env.CACHE_REDIS_PORT = String(port);
    process.env.CACHE_REDIS_CONNECT_TIMEOUT = String(CONNECT_TIMEOUT_MS);
    process.env.CACHE_ALLOW_DEGRADED_START = 'true';

    const { instance: service, logger } = createTestService(CacheServiceProvider);
    await service.waitForInit();

    expect(service.getBackendStatus()).toEqual({
      configured: CacheType.REDIS,
      active: CacheType.MEMORY,
      degraded: true,
    });

    const line = warnLines(logger).find((warning) => warning.includes('redis'));
    expect(line).toContain('PROCESS-LOCAL');
    expect(line).toContain('not shared with other replicas');
    expect(line).toContain('never');

    await service.close();
  });

  it('leaves an application that configured nothing exactly as it was', async () => {
    const { instance: service, logger } = createTestService(CacheServiceProvider);
    await service.waitForInit();

    expect(service.getBackendStatus()).toEqual({
      configured: CacheType.MEMORY,
      active: CacheType.MEMORY,
      degraded: false,
    });
    expect(warnLines(logger)).toHaveLength(0);

    await service.set('untouched', 'value');
    expect(await service.get<string>('untouched')).toBe('value');

    await service.close();
  });

  it('reports redis as the live backend when Redis is actually up', async () => {
    const redis = await createRedisContainer();

    try {
      process.env.CACHE_TYPE = 'redis';
      process.env.CACHE_REDIS_HOST = redis.host;
      process.env.CACHE_REDIS_PORT = String(redis.port);

      const { instance: service } = createTestService(CacheServiceProvider);
      await service.waitForInit();

      expect(service.getBackendStatus()).toEqual({
        configured: CacheType.REDIS,
        active: CacheType.REDIS,
        degraded: false,
      });

      await service.set('wi276', 'served-by-redis');
      expect(await service.get<string>('wi276')).toBe('served-by-redis');

      await service.close();
    } finally {
      await redis.stop();
    }
  }, CONTAINER_TIMEOUT_MS);
});
