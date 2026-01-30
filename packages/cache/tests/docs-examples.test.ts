/**
 * Documentation Examples Tests for @onebun/cache
 *
 * This file tests code examples from:
 * - packages/cache/README.md
 * - docs/api/cache.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import {
  createInMemoryCache,
  CacheType,
  createCacheModule,
  cacheServiceTag,
  CacheModule,
} from '../src';

describe('Cache README Examples', () => {
  describe('Basic In-Memory Cache (README)', () => {
    it('should create in-memory cache with options', async () => {
      // From README: Basic In-Memory Cache section
      const cache = createInMemoryCache({
        defaultTtl: 60000, // 1 minute
        maxSize: 1000, // maximum 1000 entries
        cleanupInterval: 30000, // cleanup every 30 seconds
      });

      expect(cache).toBeDefined();
      expect(typeof cache.set).toBe('function');
      expect(typeof cache.get).toBe('function');
      expect(typeof cache.delete).toBe('function');
      expect(typeof cache.clear).toBe('function');
    });

    it('should set and get value', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      // From README: Set value
      await cache.set('user:123', { name: 'John', email: 'john@example.com' });

      // From README: Get value
      const user = await cache.get<{ name: string; email: string }>('user:123');

      expect(user).toEqual({ name: 'John', email: 'john@example.com' });
    });

    it('should delete value', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('user:123', { name: 'John' });

      // From README: Delete value
      await cache.delete('user:123');

      const user = await cache.get('user:123');
      expect(user).toBeUndefined();
    });

    it('should clear all values', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      // From README: Clear all
      await cache.clear();

      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL Examples (README)', () => {
    /**
     * @source packages/cache/README.md#ttl-management
     */
    it('should set with default TTL', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      // From README: Set with default TTL
      await cache.set('key1', 'value1');

      const result = await cache.get<string>('key1');
      expect(result).toBe('value1');
    });

    /**
     * @source packages/cache/README.md#ttl-management
     */
    it('should set with custom TTL', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      // From README: Set with custom TTL (5 seconds)
      await cache.set('key2', 'value2', { ttl: 5000 });

      const result = await cache.get<string>('key2');
      expect(result).toBe('value2');
    });

    /**
     * @source packages/cache/README.md#ttl-management
     */
    it('should set without expiration', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      // From README: Set without expiration
      await cache.set('key3', 'value3', { ttl: 0 });

      const result = await cache.get<string>('key3');
      expect(result).toBe('value3');
    });
  });

  describe('Batch Operations (README)', () => {
    /**
     * @source packages/cache/README.md#batch-operations
     */
    it('should get multiple values', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      // From README: Get multiple values
      const values = await cache.mget<string>(['key1', 'key2', 'key3']);

      expect(values).toEqual(['value1', 'value2', 'value3']);
    });

    /**
     * @source packages/cache/README.md#batch-operations
     */
    it('should set multiple values', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      // From README: Set multiple values
      await cache.mset([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2', options: { ttl: 10000 } },
      ]);

      const result1 = await cache.get<string>('key1');
      const result2 = await cache.get<string>('key2');
      expect(result1).toBe('value1');
      expect(result2).toBe('value2');
    });
  });

  describe('Statistics (README)', () => {
    it('should get cache statistics', async () => {
      const cache = createInMemoryCache({
        defaultTtl: 60000,
        maxSize: 1000,
      });

      await cache.set('user:123', { name: 'John' });
      await cache.get('user:123'); // hit
      await cache.get('user:456'); // miss

      // From README: Get cache statistics
      const stats = await cache.getStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('hitRate');
      expect(typeof stats.hits).toBe('number');
      expect(typeof stats.misses).toBe('number');
    });
  });

  describe('Effect.js Integration (README)', () => {
    it('should create cache layer with Effect.js', async () => {
      // From README: Create cache layer
      const cacheLayer = createCacheModule({ type: CacheType.MEMORY });

      expect(cacheLayer).toBeDefined();
    });

    it('should use cache in Effect program', async () => {
      // From README: Effect.js Integration example
      const cacheLayer = createCacheModule({ type: CacheType.MEMORY });

      // From README: Use in Effect program
      const program = pipe(
        cacheServiceTag,
        Effect.andThen((cache) =>
          pipe(
            cache.setEffect('user:123', { name: 'John' }),
            Effect.andThen(() => cache.getEffect('user:123')),
          ),
        ),
      );

      // Run program
      const user = await Effect.runPromise(Effect.provide(program, cacheLayer));

      expect(user).toEqual({ name: 'John' });
    });
  });
});

describe('Cache API Documentation Examples', () => {
  describe('CacheService Interface (docs/api/cache.md)', () => {
    let cache: ReturnType<typeof createInMemoryCache>;

    beforeEach(() => {
      cache = createInMemoryCache({
        defaultTtl: 300000,
        maxSize: 1000,
      });
    });

    afterEach(async () => {
      await cache.close();
    });

    it('should implement get<T>() method', async () => {
      // From docs: get<T>() example
      await cache.set('user:123', { name: 'John', email: 'john@example.com' });

      const user = await cache.get<{ name: string; email: string }>('user:123');

      expect(user).toBeDefined();
      if (user) {
        expect(user.name).toBe('John');
        expect(user.email).toBe('john@example.com');
      }
    });

    it('should return undefined for cache miss', async () => {
      // From docs: Cache miss scenario
      const user = await cache.get<{ name: string }>('user:123');

      expect(user).toBeUndefined();
    });

    it('should implement set() with default TTL', async () => {
      // From docs: set() with default TTL
      await cache.set('user:123', { name: 'John' });

      const user = await cache.get('user:123');
      expect(user).toEqual({ name: 'John' });
    });

    it('should implement set() with custom TTL', async () => {
      // From docs: set() with custom TTL (in seconds in docs, milliseconds in actual API)
      await cache.set('user:123', { name: 'John' }, { ttl: 600 });

      const user = await cache.get('user:123');
      expect(user).toEqual({ name: 'John' });
    });

    it('should implement set() without expiration', async () => {
      // From docs: set() no expiration
      await cache.set('user:123', { name: 'John' }, { ttl: 0 });

      const user = await cache.get('user:123');
      expect(user).toEqual({ name: 'John' });
    });

    it('should implement delete() method', async () => {
      // From docs: delete() example
      await cache.set('user:123', { name: 'John' });

      const deleted = await cache.delete('user:123');

      expect(deleted).toBe(true);
      expect(await cache.get('user:123')).toBeUndefined();
    });

    it('should implement has() method', async () => {
      // From docs: has() example
      await cache.set('user:123', { name: 'John' });

      if (await cache.has('user:123')) {
        // Key exists
        expect(true).toBe(true);
      } else {
        expect(false).toBe(true); // Should not reach here
      }
    });

    it('should implement clear() method', async () => {
      // From docs: clear() example
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      await cache.clear();

      expect(await cache.has('key1')).toBe(false);
      expect(await cache.has('key2')).toBe(false);
    });
  });

  describe('Cache-Aside Pattern (docs/api/cache.md)', () => {
    it('should implement cache-aside pattern', async () => {
      // From docs: Cache-Aside Pattern
      const cache = createInMemoryCache({
        defaultTtl: 300000,
        maxSize: 1000,
      });

      // Simulate repository
      const repository = {
        findById: async (id: string) => ({ id, name: 'John from DB' }),
      };

      const findById = async (id: string) => {
        const cacheKey = `user:${id}`;

        // Try cache first
        const cached = await cache.get<{ id: string; name: string }>(cacheKey);
        if (cached) {
          return cached;
        }

        // Cache miss - fetch from database
        const user = await repository.findById(id);

        // Store in cache
        if (user) {
          await cache.set(cacheKey, user, { ttl: 300 });
        }

        return user;
      };

      // First call - cache miss
      const user1 = await findById('123');
      expect(user1.name).toBe('John from DB');

      // Second call - cache hit
      const user2 = await findById('123');
      expect(user2.name).toBe('John from DB');

      await cache.close();
    });
  });

  describe('Cache Invalidation (docs/api/cache.md)', () => {
    it('should invalidate cache on update', async () => {
      // From docs: Cache Invalidation pattern
      const cache = createInMemoryCache({
        defaultTtl: 300000,
        maxSize: 1000,
      });

      // Setup
      await cache.set('user:123', { name: 'John' });
      await cache.set('users:list', [{ id: '123', name: 'John' }]);

      // Simulate update
      const update = async (id: string) => {
        // Update logic here...

        // Invalidate cache
        await cache.delete(`user:${id}`);

        // Also invalidate related caches
        await cache.delete('users:list');
      };

      await update('123');

      expect(await cache.get('user:123')).toBeUndefined();
      expect(await cache.get('users:list')).toBeUndefined();

      await cache.close();
    });
  });
});

describe('CacheModule.forRoot Examples', () => {
  it('should create CacheModule with MEMORY type', () => {
    // From README: With module options
    const module = CacheModule.forRoot({
      type: CacheType.MEMORY,
      cacheOptions: {
        defaultTtl: 60000,
        maxSize: 1000,
      },
    });

    expect(module).toBeDefined();
  });

  it('should create CacheModule with custom env prefix', () => {
    // From README: With custom environment prefix
    const module = CacheModule.forRoot({
      envPrefix: 'MY_CACHE', // Will use MY_CACHE_TYPE, MY_CACHE_REDIS_HOST, etc.
    });

    expect(module).toBeDefined();
  });
});
