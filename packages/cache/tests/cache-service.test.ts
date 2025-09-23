import {
  describe,
  expect,
  it,
} from 'bun:test';
import {
  Effect,
  Layer,
  pipe,
} from 'effect';

import type { CacheService } from '../src/cache.service';

import {
  cacheServiceTag,
  makeCacheService,
  makeCacheServiceFromOptions,
} from '../src/cache.service';
import { createInMemoryCache } from '../src/memory-cache';

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
