/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { useFakeTimers } from '@onebun/core';

import { createInMemoryCache, InMemoryCache } from '../src/memory-cache';

describe('InMemoryCache', () => {
  let cache: InMemoryCache;
  let advanceTime: (ms: number) => void;
  let restore: () => void;

  beforeEach(() => {
    const fakeTimers = useFakeTimers();
    advanceTime = fakeTimers.advanceTime;
    restore = fakeTimers.restore;
    cache = createInMemoryCache();
  });

  afterEach(async () => {
    await cache.close();
    restore();
  });

  describe('Basic operations', () => {
    it('should set and get a value', async () => {
      await cache.set('key1', 'value1' as any);
      const result = await cache.get('key1');
      expect(result).toBe('value1');
    });

    it('should return undefined for non-existent key', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing value', async () => {
      await cache.set('key1', 'value1' as any);
      await cache.set('key1', 'value2' as any);
      const result = await cache.get('key1');
      expect(result).toBe('value2');
    });

    it('should delete a value', async () => {
      await cache.set('key1', 'value1' as any);
      const deleted = await cache.delete('key1');
      expect(deleted).toBe(true);
      const result = await cache.get('key1');
      expect(result).toBeUndefined();
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should check if key exists', async () => {
      await cache.set('key1', 'value1' as any);
      expect(await cache.has('key1')).toBe(true);
      expect(await cache.has('nonexistent')).toBe(false);
    });

    it('should clear all values', async () => {
      await cache.set('key1', 'value1' as any);
      await cache.set('key2', 'value2' as any);
      await cache.clear();

      expect(await cache.get('key1')).toBeUndefined();
      expect(await cache.get('key2')).toBeUndefined();
    });
  });

  describe('TTL functionality', () => {
    it('should expire values after TTL', async () => {
      await cache.set('key1', 'value1' as any, { ttl: 100 });
      expect(await cache.get('key1')).toBe('value1' as any);

      // Advance time past expiration
      advanceTime(150);
      expect(await cache.get('key1')).toBeUndefined();
    });

    it('should not expire values before TTL', async () => {
      await cache.set('key1', 'value1' as any, { ttl: 200 });
      advanceTime(50);
      expect(await cache.get('key1')).toBe('value1' as any);
    });

    it('should use default TTL from options', async () => {
      const cacheWithDefaultTtl = createInMemoryCache({ defaultTtl: 100 });
      await cacheWithDefaultTtl.set('key1', 'value1' as any); // No explicit TTL

      expect(await cacheWithDefaultTtl.get('key1')).toBe('value1' as any);

      // Advance time past expiration
      advanceTime(150);
      expect(await cacheWithDefaultTtl.get('key1')).toBeUndefined();

      await cacheWithDefaultTtl.close();
    });

    it('should override default TTL with explicit TTL', async () => {
      const cacheWithDefaultTtl = createInMemoryCache({ defaultTtl: 200 });
      await cacheWithDefaultTtl.set('key1', 'value1', { ttl: 50 }); // Override default

      // Advance time past explicit TTL but before default TTL
      advanceTime(75);
      expect(await cacheWithDefaultTtl.get('key1')).toBeUndefined();

      await cacheWithDefaultTtl.close();
    });
  });

  describe('Size limits', () => {
    it('should respect maxSize limit', async () => {
      const smallCache = createInMemoryCache({ maxSize: 2 });

      await smallCache.set('key1', 'value1');
      await smallCache.set('key2', 'value2');
      await smallCache.set('key3', 'value3'); // Should trigger eviction

      const stats = await smallCache.getStats();
      expect(stats.entries).toBeLessThanOrEqual(2);

      await smallCache.close();
    });

    it('should handle unlimited size', async () => {
      const unlimitedCache = createInMemoryCache({ maxSize: undefined });

      // Add many entries
      for (let i = 0; i < 1000; i++) {
        await unlimitedCache.set(`key${i}`, `value${i}`);
      }

      const stats = await unlimitedCache.getStats();
      expect(stats.entries).toBe(1000);

      await unlimitedCache.close();
    });
  });

  describe('Batch operations', () => {
    it('should get multiple values', async () => {
      await cache.set('key1', 'value1' as any);
      await cache.set('key2', 'value2' as any);
      await cache.set('key3', 'value3' as any);

      const results = await cache.mget(['key1', 'key2', 'key3', 'nonexistent']);
      expect(results).toEqual(['value1', 'value2', 'value3', undefined]);
    });

    it('should set multiple values', async () => {
      await cache.mset([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2', options: { ttl: 100 } },
        { key: 'key3', value: 'value3' },
      ]);

      expect(await cache.get('key1')).toBe('value1' as any);
      expect(await cache.get('key2')).toBe('value2' as any);
      expect(await cache.get('key3')).toBe('value3' as any);

      // Check TTL on key2
      advanceTime(150);
      expect(await cache.get('key2')).toBeUndefined();
      expect(await cache.get('key1')).toBe('value1' as any); // Should still be available
    });
  });

  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      // Initial stats should be zero
      let stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);

      // Set a value
      await cache.set('key1', 'value1' as any);

      // Get existing value (hit)
      await cache.get('key1');
      stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(1);

      // Get non-existent value (miss)
      await cache.get('nonexistent');
      stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);

      // Another hit
      await cache.get('key1');
      stats = await cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(2 / 3);
    });

    it('should track entries count', async () => {
      let stats = await cache.getStats();
      expect(stats.entries).toBe(0);

      await cache.set('key1', 'value1' as any);
      stats = await cache.getStats();
      expect(stats.entries).toBe(1);

      await cache.set('key2', 'value2' as any);
      stats = await cache.getStats();
      expect(stats.entries).toBe(2);

      await cache.delete('key1');
      stats = await cache.getStats();
      expect(stats.entries).toBe(1);

      await cache.clear();
      stats = await cache.getStats();
      expect(stats.entries).toBe(0);
    });

    it('should reset stats on clear', async () => {
      await cache.set('key1', 'value1' as any);
      await cache.get('key1');
      await cache.get('nonexistent');

      let stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.entries).toBe(1);

      await cache.clear();
      stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.entries).toBe(0);
    });
  });

  describe('Type safety', () => {
    it('should handle different value types', async () => {
      // String
      await cache.set('string', 'hello');
      expect(await cache.get<string>('string')).toBe('hello');

      // Number
      await cache.set('number', 42);
      expect(await cache.get<number>('number')).toBe(42);

      // Object
      const obj = { name: 'test', value: 123 };
      await cache.set('object', obj);
      expect(await cache.get<typeof obj>('object')).toEqual(obj);

      // Array
      const arr = [1, 2, 3, 'test'];
      await cache.set('array', arr);
      expect(await cache.get<typeof arr>('array')).toEqual(arr);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup expired entries automatically', async () => {
      const cacheWithCleanup = createInMemoryCache({
        defaultTtl: 100,
        cleanupInterval: 50, // Cleanup every 50ms
      });

      await cacheWithCleanup.set('key1', 'value1');
      await cacheWithCleanup.set('key2', 'value2');

      // Verify entries exist
      let stats = await cacheWithCleanup.getStats();
      expect(stats.entries).toBe(2);

      // Advance time past expiration and let cleanup interval trigger
      advanceTime(150); // This should trigger cleanup at 50ms and 100ms

      // Check that automatic cleanup worked
      stats = await cacheWithCleanup.getStats();
      expect(stats.entries).toBe(0);

      await cacheWithCleanup.close();
    });

    it('should close properly', async () => {
      const cacheWithCleanup = createInMemoryCache({ cleanupInterval: 100 });

      await cacheWithCleanup.set('key1', 'value1');
      await cacheWithCleanup.close();

      // Should be able to create new cache without issues
      const newCache = createInMemoryCache();
      await newCache.set('key2', 'value2' as any);
      expect(await newCache.get('key2')).toBe('value2' as any);
      await newCache.close();
    });
  });
});
