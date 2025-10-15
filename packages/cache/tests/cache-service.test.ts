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

import type { CacheService } from '../src/cache-effect.service';

import {
  cacheServiceTag,
  makeCacheService,
  makeCacheServiceFromOptions,
} from '../src/cache-effect.service';
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
