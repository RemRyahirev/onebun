import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

import { createRedisCache, RedisCache } from '../src/redis-cache';

describe('RedisCache', () => {
  let redisContainer: StartedTestContainer;
  let cache: RedisCache;
  let redisHost: string;
  let redisPort: number;

  beforeAll(async () => {
    // Start Redis container (with logging disabled)
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/.*Ready to accept connections.*/))
      .withStartupTimeout(30000)
      .withLogConsumer(() => {
        // Suppress container logs
      })
      .start();

    redisHost = redisContainer.getHost();
    redisPort = redisContainer.getMappedPort(6379);

    // Create cache instance
    cache = createRedisCache({
      host: redisHost,
      port: redisPort,
      keyPrefix: 'test:cache:',
    });
    await cache.connect();
    await cache.clear();
  });

  afterAll(async () => {
    await cache.clear();
    await cache.close();
    
    // Stop Redis container
    if (redisContainer) {
      await redisContainer.stop();
    }
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
      // Set with 50ms TTL
      await cache.set('ttl-test', 'value', { ttl: 50 });
      const valueBefore = await cache.get('ttl-test');
      expect(valueBefore).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 75));

      const valueAfter = await cache.get('ttl-test');
      expect(valueAfter).toBeUndefined();
    });

    it('should use default TTL when not specified', async () => {
      const cacheWithTtl = createRedisCache({
        host: redisHost,
        port: redisPort,
        keyPrefix: 'test:cache:ttl:',
        defaultTtl: 50,
      });
      await cacheWithTtl.connect();

      await cacheWithTtl.set('default-ttl-test', 'value');
      const valueBefore = await cacheWithTtl.get('default-ttl-test');
      expect(valueBefore).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 75));

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
        { key: 'mset-ttl-1', value: 'value1', options: { ttl: 50 } },
        { key: 'mset-ttl-2', value: 'value2' },
      ]);

      const value1 = await cache.get('mset-ttl-1');
      const value2 = await cache.get('mset-ttl-2');
      expect(value1).toBe('value1');
      expect(value2).toBe('value2');

      // Wait for first to expire
      await new Promise((resolve) => setTimeout(resolve, 75));

      const value1After = await cache.get('mset-ttl-1');
      const value2After = await cache.get('mset-ttl-2');
      expect(value1After).toBeUndefined();
      expect(value2After).toBe('value2');
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      const testCache = createRedisCache({
        host: redisHost,
        port: redisPort,
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
        host: redisHost,
        port: redisPort,
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
        host: redisHost,
        port: redisPort,
        keyPrefix: 'custom:prefix:',
      });
      await prefixCache.connect();

      await prefixCache.set('test-key', 'test-value');

      // Should be able to get with same cache instance
      const value = await prefixCache.get('test-key');
      expect(value).toBe('test-value');

      // Check that the key exists in Redis with prefix
      const client = prefixCache.getClient();
      if (!client) {
        throw new Error('Client is null');
      }
      const exists = await client.exists('custom:prefix:test-key');
      expect(exists).toBeTruthy();

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
});
