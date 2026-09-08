import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { createRedisClient } from '@onebun/core';
import { createRedisContainer, type TestContainer } from '@onebun/core/testing';

import { createRedisCache, RedisCache } from '../src/redis-cache';

describe('RedisCache', () => {
  let redis: TestContainer;
  let cache: RedisCache;

  beforeAll(async () => {
    redis = await createRedisContainer();

    // Create cache instance
    cache = createRedisCache({
      host: redis.host,
      port: redis.port,
      keyPrefix: 'test:cache:',
    });
    await cache.connect();
    await cache.clear();
  });

  afterAll(async () => {
    await cache.clear();
    await cache.close();
    await redis.stop();
  });

  describe('Basic operations', () => {
    it('should set and get a value', async () => {
      await cache.set('test-key', 'test-value');
      const value = await cache.get('test-key');
      expect(value).toBe('test-value');
    });

    it('should return undefined for non-existent key', async () => {
      const value = await cache.get('non-existent-key');
      expect(value).toBeUndefined();
    });

    it('should handle different data types', async () => {
      const testData = {
        string: 'hello',
        number: 42,
        boolean: true,
        object: { nested: 'value' },
        array: [1, 2, 3],
      };

      await cache.set('test-data', testData);
      const retrieved = await cache.get('test-data');
      expect(retrieved).toEqual(testData);
    });

    it('should delete a value', async () => {
      await cache.set('delete-test', 'value');
      const deleted = await cache.delete('delete-test');
      expect(deleted).toBe(true);
      const value = await cache.get('delete-test');
      expect(value).toBeUndefined();
    });

    it('should check if key exists', async () => {
      await cache.set('exists-test', 'value');
      const exists = await cache.has('exists-test');
      expect(exists).toBe(true);

      const notExists = await cache.has('not-exists-test');
      expect(notExists).toBe(false);
    });

    it('should clear all cache entries', async () => {
      await cache.set('clear-test-1', 'value1');
      await cache.set('clear-test-2', 'value2');
      await cache.clear();

      const value1 = await cache.has('clear-test-1');
      const value2 = await cache.has('clear-test-2');
      expect(value1).toBe(false);
      expect(value2).toBe(false);
    });
  });

  describe('TTL support', () => {
    it('should expire entries after TTL', async () => {
      // Set with 10ms TTL (Redis minimum is 1ms)
      await cache.set('ttl-test', 'value', { ttl: 10 });
      const valueBefore = await cache.get('ttl-test');
      expect(valueBefore).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 20));

      const valueAfter = await cache.get('ttl-test');
      expect(valueAfter).toBeUndefined();
    });

    it('should use default TTL when not specified', async () => {
      const cacheWithTtl = createRedisCache({
        host: redis.host,
        port: redis.port,
        keyPrefix: 'test:cache:ttl:',
        defaultTtl: 10,
      });
      await cacheWithTtl.connect();

      await cacheWithTtl.set('default-ttl-test', 'value');
      const valueBefore = await cacheWithTtl.get('default-ttl-test');
      expect(valueBefore).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 20));

      const valueAfter = await cacheWithTtl.get('default-ttl-test');
      expect(valueAfter).toBeUndefined();

      await cacheWithTtl.close();
    });
  });

  describe('Batch operations', () => {
    it('should get multiple values', async () => {
      await cache.set('mget-1', 'value1');
      await cache.set('mget-2', 'value2');
      await cache.set('mget-3', 'value3');

      const values = await cache.mget(['mget-1', 'mget-2', 'mget-3', 'mget-missing']);
      expect(values).toEqual(['value1', 'value2', 'value3', undefined]);
    });

    it('should set multiple values', async () => {
      await cache.mset([
        { key: 'mset-1', value: 'value1' },
        { key: 'mset-2', value: 'value2' },
        { key: 'mset-3', value: 'value3' },
      ]);

      const value1 = await cache.get('mset-1');
      const value2 = await cache.get('mset-2');
      const value3 = await cache.get('mset-3');

      expect(value1).toBe('value1');
      expect(value2).toBe('value2');
      expect(value3).toBe('value3');
    });

    it('should set multiple values with different TTLs', async () => {
      await cache.mset([
        { key: 'mset-ttl-1', value: 'value1', options: { ttl: 10 } },
        { key: 'mset-ttl-2', value: 'value2' },
      ]);

      const value1 = await cache.get('mset-ttl-1');
      const value2 = await cache.get('mset-ttl-2');
      expect(value1).toBe('value1');
      expect(value2).toBe('value2');

      // Wait for first to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      const value1After = await cache.get('mset-ttl-1');
      const value2After = await cache.get('mset-ttl-2');
      expect(value1After).toBeUndefined();
      expect(value2After).toBe('value2');
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      const testCache = createRedisCache({
        host: redis.host,
        port: redis.port,
        keyPrefix: 'test:stats:',
      });
      await testCache.connect();
      await testCache.clear();

      await testCache.set('stats-key', 'value');
      await testCache.get('stats-key'); // Hit
      await testCache.get('stats-key'); // Hit
      await testCache.get('missing-key'); // Miss

      const stats = await testCache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.666, 2);

      await testCache.close();
    });

    it('should count entries', async () => {
      const testCache = createRedisCache({
        host: redis.host,
        port: redis.port,
        keyPrefix: 'test:count:',
      });
      await testCache.connect();
      await testCache.clear();

      await testCache.set('count-1', 'value1');
      await testCache.set('count-2', 'value2');
      await testCache.set('count-3', 'value3');

      const stats = await testCache.getStats();
      expect(stats.entries).toBe(3);

      await testCache.close();
    });
  });

  describe('Key prefix', () => {
    it('should use key prefix', async () => {
      const prefixCache = createRedisCache({
        host: redis.host,
        port: redis.port,
        keyPrefix: 'custom:prefix:',
      });
      await prefixCache.connect();

      await prefixCache.set('test-key', 'test-value');

      // Should be able to get with same cache instance
      const value = await prefixCache.get('test-key');
      expect(value).toBe('test-value');

      // The prefix is applied ONCE. This used to assert `client.exists('custom:prefix:test-key')`,
      // but the client prefixes what it is given, so that asked for
      // `custom:prefix:custom:prefix:test-key` — and passed, because the cache stored the doubled
      // key too. Checked here through a client with no prefix of its own, which sees the literal
      // name Redis holds.
      const raw = createRedisClient({ url: `redis://${redis.host}:${redis.port}` });
      await raw.connect();

      try {
        expect(await raw.exists('custom:prefix:test-key')).toBe(true);
        expect(await raw.exists('custom:prefix:custom:prefix:test-key')).toBe(false);
      } finally {
        await raw.disconnect();
      }

      await prefixCache.clear();
      await prefixCache.close();
    });
  });

  describe('Error handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      // Manually insert invalid JSON into Redis
      const client = cache.getClient();
      if (!client) {
        throw new Error('Client is null');
      }
      await client.set('test:cache:invalid-json', 'not-valid-json{');

      const value = await cache.get('invalid-json');
      expect(value).toBeUndefined();
    });
  });

  /**
   * A dead connection must not look like a cold cache.
   *
   * `get()` used to swallow every Redis error and return `undefined`, so a client that had
   * been disconnected — by another application releasing the shared one, or by the server
   * going away — was indistinguishable from an absent key. Anything treating "not in cache"
   * as "not present" (rate limiting, replay guards, locks) then decides wrongly.
   *
   * Deliberately exercised through an OWNED client rather than the shared provider:
   * SharedRedisProvider is process-global and bun runs every test file in one process, so a
   * test that repoints it breaks suites whose beforeAll already ran. The lease arithmetic is
   * covered in packages/core/src/redis/shared-redis.test.ts, which owns the provider for its
   * whole file.
   */
  describe('failure reporting', () => {
    const TEST_TIMEOUT_MS = 30000;

    it('THROWS rather than reporting a miss when the client is unusable', async () => {
      const own = createRedisCache({
        host: redis.host,
        port: redis.port,
        keyPrefix: 'unusable:',
      });
      await own.connect();
      await own.set('k', 'v');
      expect(await own.get<string>('k')).toBe('v');

      // Close the client underneath the cache, as another consumer's shutdown would.
      await own.close();

      // Pre-fix this resolved to `undefined` and the caller read it as a cache miss. The
      // re-acquire is bounded, because the driver's auto-reconnect never rejects on its own —
      // measured: a connect to a refused port stays pending indefinitely.
      await expect(own.get('k')).rejects.toThrow(/not usable/);
    }, TEST_TIMEOUT_MS);

    it('still reports a genuine absent key as undefined', async () => {
      // The distinction the throw exists to preserve: a missing key is still a miss.
      expect(await cache.get('definitely-not-set')).toBeUndefined();
    });
  });

  describe('clear() blast radius', () => {
    it('leaves foreign keys alone and refuses when it cannot name its own keyspace', async () => {
      const raw = createRedisClient({ url: `redis://${redis.host}:${redis.port}` });
      await raw.connect();

      try {
        // Two keys this cache did not write, of the kind that share a database with it.
        await raw.set('onebun:queue:job:1', 'queued');
        await raw.set('ratelimit:1.2.3.4', '7');

        const unscoped = createRedisCache({
          host: redis.host,
          port: redis.port,
          keyPrefix: '',
        });
        await unscoped.connect();

        try {
          await unscoped.set('page:home', 'cached');

          // Pre-fix this issued `KEYS *` and deleted every hit: the queued job and the rate-limit
          // counter went with it, and the promise resolved as if nothing unusual had happened.
          await expect(unscoped.clear()).rejects.toThrow(/no key prefix/);
          await expect(unscoped.getStats()).rejects.toThrow(/no key prefix/);

          expect(await raw.exists('onebun:queue:job:1')).toBe(true);
          expect(await raw.exists('ratelimit:1.2.3.4')).toBe(true);
        } finally {
          await unscoped.close();
        }

        // A scoped cache clears its own keys and only its own.
        const scoped = createRedisCache({
          host: redis.host,
          port: redis.port,
          keyPrefix: 'scoped:cache:',
        });
        await scoped.connect();

        try {
          await scoped.set('user:2', { id: 2 });
          expect(await raw.exists('scoped:cache:user:2')).toBe(true);

          await scoped.clear();

          expect(await scoped.has('user:2')).toBe(false);
          expect(await raw.exists('scoped:cache:user:2')).toBe(false);
          expect(await raw.exists('onebun:queue:job:1')).toBe(true);
          expect(await raw.exists('ratelimit:1.2.3.4')).toBe(true);
        } finally {
          await scoped.close();
        }
      } finally {
        await raw.del('onebun:queue:job:1');
        await raw.del('ratelimit:1.2.3.4');
        await raw.disconnect();
      }
    }, 30_000);
  });
});
