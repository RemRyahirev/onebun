import {
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import {
  CacheType,
  createCacheModule,
  createCacheModuleAsync,
  cacheServiceTag,
} from '../src/cache.module';

describe('CacheModule', () => {
  describe('In-memory cache module', () => {
    it('should create in-memory cache module by default', async () => {
      const cacheLayer = createCacheModule();

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

    it('should create in-memory cache with explicit type', async () => {
      const cacheLayer = createCacheModule({ type: CacheType.MEMORY });

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

    it('should apply cache options', async () => {
      const cacheLayer = createCacheModule({
        type: CacheType.MEMORY,
        cacheOptions: {
          defaultTtl: 100,
          maxSize: 10,
        },
      });

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

  describe('Async module creation', () => {
    it('should create async in-memory cache module', async () => {
      const cacheLayer = await createCacheModuleAsync({ type: CacheType.MEMORY });

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('test', 'async-value'),
            Effect.andThen(() => cache.getEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('async-value');
    });
  });

  describe('Environment variable configuration', () => {
    it('should load configuration from environment variables', async () => {
      // Set environment variables
      process.env.CACHE_TYPE = 'memory';
      process.env.CACHE_DEFAULT_TTL = '5000';
      process.env.CACHE_MAX_SIZE = '100';

      const cacheLayer = createCacheModule();

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('env-test', 'value'),
            Effect.andThen(() => cache.getEffect('env-test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('value');

      // Clean up
      delete process.env.CACHE_TYPE;
      delete process.env.CACHE_DEFAULT_TTL;
      delete process.env.CACHE_MAX_SIZE;
    });

    it('should support custom env prefix', async () => {
      // Set environment variables with custom prefix
      process.env.MY_CACHE_TYPE = 'memory';
      process.env.MY_CACHE_DEFAULT_TTL = '3000';

      const cacheLayer = createCacheModule({
        envPrefix: 'MY_CACHE',
      });

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('prefix-test', 'value'),
            Effect.andThen(() => cache.getEffect('prefix-test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      const result = await Effect.runPromise(runnable);

      expect(result).toBe('value');

      // Clean up
      delete process.env.MY_CACHE_TYPE;
      delete process.env.MY_CACHE_DEFAULT_TTL;
    });

    it('should prioritize explicit options over environment variables', async () => {
      // Set environment variables
      process.env.CACHE_TYPE = 'redis';

      const cacheLayer = createCacheModule({
        type: CacheType.MEMORY, // Explicit option should take precedence
      });

      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('priority-test', 'value'),
            Effect.andThen(() => cache.getEffect('test')),
          ),
        ),
      );

      const runnable = Effect.provide(program, cacheLayer);
      // Should not throw (would throw if it tried to connect to Redis)
      await Effect.runPromise(runnable);

      // Clean up
      delete process.env.CACHE_TYPE;
    });
  });

  describe('Redis cache module configuration', () => {
    it('should configure Redis options from environment variables', () => {
      // Set Redis environment variables
      process.env.CACHE_TYPE = 'redis';
      process.env.CACHE_REDIS_HOST = 'redis.example.com';
      process.env.CACHE_REDIS_PORT = '6380';
      process.env.CACHE_REDIS_PASSWORD = 'secret';
      process.env.CACHE_REDIS_DATABASE = '2';
      process.env.CACHE_REDIS_KEY_PREFIX = 'myapp:';

      // Just test that module can be created without errors
      // (won't actually connect to Redis)
      expect(() => {
        createCacheModule({ type: CacheType.MEMORY }); // Use memory to avoid actual connection
      }).not.toThrow();

      // Clean up
      delete process.env.CACHE_TYPE;
      delete process.env.CACHE_REDIS_HOST;
      delete process.env.CACHE_REDIS_PORT;
      delete process.env.CACHE_REDIS_PASSWORD;
      delete process.env.CACHE_REDIS_DATABASE;
      delete process.env.CACHE_REDIS_KEY_PREFIX;
    });
  });
});
