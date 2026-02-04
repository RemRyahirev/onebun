import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import {
  makeMockLoggerLayer,
  createMockConfig,
  useFakeTimers,
} from '@onebun/core';
// eslint-disable-next-line import/no-extraneous-dependencies
import { LoggerService } from '@onebun/logger';

import { CacheModule } from '../src/cache.module';
import { CacheService } from '../src/cache.service';
import { CacheType } from '../src/types';

describe('CacheService', () => {
  let service: CacheService;
  let advanceTime: (ms: number) => void;
  let restore: () => void;

  // Save and restore env vars
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save env vars
    savedEnv.CACHE_TYPE = process.env.CACHE_TYPE;
    savedEnv.CACHE_DEFAULT_TTL = process.env.CACHE_DEFAULT_TTL;
    savedEnv.CACHE_MAX_SIZE = process.env.CACHE_MAX_SIZE;

    // Clear env vars to prevent auto-config
    delete process.env.CACHE_TYPE;
    delete process.env.CACHE_DEFAULT_TTL;
    delete process.env.CACHE_MAX_SIZE;

    // Clear module options
    CacheModule.clearOptions();

    // Setup fake timers
    const fakeTimers = useFakeTimers();
    advanceTime = fakeTimers.advanceTime;
    restore = fakeTimers.restore;

    // Create service with mock logger
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l.child({ className: 'CacheService' })),
        loggerLayer,
      ),
    );

    service = new CacheService();
    // Initialize service with logger (mimics what the DI framework does)
    service.initializeService(logger, createMockConfig());
  });

  afterEach(async () => {
    // Close service
    try {
      await service.close();
    } catch {
      // Ignore errors during cleanup
    }

    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Clear module options
    CacheModule.clearOptions();

    // Restore timers
    restore();
  });

  describe('initialization', () => {
    test('should create service instance', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(CacheService);
    });

    test('should initialize with default in-memory cache', async () => {
      await service.waitForInit();
      
      // Should be able to use cache operations
      await service.set('test', 'value');
      const result = await service.get('test');
      expect(result).toBe('value');
    });

    test('should report initialization status', async () => {
      // Wait for auto-initialization to complete
      await service.waitForInit();
      
      // Service should be usable
      await service.set('key', 'value');
      expect(await service.has('key')).toBe(true);
    });
  });

  describe('get/set operations', () => {
    test('should set and get values', async () => {
      await service.waitForInit();

      await service.set('key1', 'value1');
      const result = await service.get<string>('key1');
      expect(result).toBe('value1');
    });

    test('should return undefined for non-existent keys', async () => {
      await service.waitForInit();

      const result = await service.get('nonexistent');
      expect(result).toBeUndefined();
    });

    test('should set values with TTL', async () => {
      await service.waitForInit();

      await service.set('ttl-key', 'ttl-value', { ttl: 100 });
      expect(await service.get<string>('ttl-key')).toBe('ttl-value');

      // Advance time past TTL
      advanceTime(150);
      expect(await service.get('ttl-key')).toBeUndefined();
    });

    test('should overwrite existing values', async () => {
      await service.waitForInit();

      await service.set('key', 'original');
      await service.set('key', 'updated');
      expect(await service.get<string>('key')).toBe('updated');
    });
  });

  describe('delete operation', () => {
    test('should delete existing key', async () => {
      await service.waitForInit();

      await service.set('to-delete', 'value');
      const deleted = await service.delete('to-delete');
      expect(deleted).toBe(true);
      expect(await service.has('to-delete')).toBe(false);
    });

    test('should return false when deleting non-existent key', async () => {
      await service.waitForInit();

      const deleted = await service.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('has operation', () => {
    test('should return true for existing key', async () => {
      await service.waitForInit();

      await service.set('exists', 'value');
      expect(await service.has('exists')).toBe(true);
    });

    test('should return false for non-existent key', async () => {
      await service.waitForInit();

      expect(await service.has('nonexistent')).toBe(false);
    });
  });

  describe('clear operation', () => {
    test('should clear all values', async () => {
      await service.waitForInit();

      await service.set('key1', 'value1');
      await service.set('key2', 'value2');
      await service.clear();

      expect(await service.has('key1')).toBe(false);
      expect(await service.has('key2')).toBe(false);
    });
  });

  describe('mget/mset operations', () => {
    test('should get multiple values', async () => {
      await service.waitForInit();

      await service.set('k1', 'v1');
      await service.set('k2', 'v2');

      const results = await service.mget<string>(['k1', 'k2', 'k3']);
      expect(results).toEqual(['v1', 'v2', undefined]);
    });

    test('should set multiple values', async () => {
      await service.waitForInit();

      await service.mset([
        { key: 'mk1', value: 'mv1' },
        { key: 'mk2', value: 'mv2' },
      ]);

      expect(await service.get<string>('mk1')).toBe('mv1');
      expect(await service.get<string>('mk2')).toBe('mv2');
    });
  });

  describe('getStats operation', () => {
    test('should return cache statistics', async () => {
      await service.waitForInit();

      await service.set('stat-key', 'stat-value');
      await service.get('stat-key'); // hit
      await service.get('nonexistent'); // miss

      const stats = await service.getStats();
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('hitRate');
    });
  });

  describe('close operation', () => {
    test('should close cache cleanly', async () => {
      await service.waitForInit();

      await service.set('key', 'value');
      await service.close();

      // Service should be closed (subsequent operations may fail)
    });

    test('should handle multiple close calls', async () => {
      await service.waitForInit();

      await service.close();
      // Second close should not throw
      await service.close();
    });
  });

  describe('with CacheModule options', () => {
    test('should use options from CacheModule.forRoot()', async () => {
      // Configure CacheModule with custom options
      CacheModule.forRoot({
        type: CacheType.MEMORY,
        cacheOptions: {
          defaultTtl: 5000,
          maxSize: 100,
        },
      });

      // Create new service to pick up module options
      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l.child({ className: 'CacheService' })),
          loggerLayer,
        ),
      );

      const newService = new CacheService();
      newService.initializeService(logger, createMockConfig());

      await newService.waitForInit();

      // Should be functional
      await newService.set('module-key', 'module-value');
      expect(await newService.get<string>('module-key')).toBe('module-value');

      await newService.close();
    });
  });

  describe('complex data types', () => {
    test('should handle objects', async () => {
      await service.waitForInit();

      const obj = { name: 'test', count: 42, nested: { a: 1 } };
      await service.set('obj', obj);
      expect(await service.get<typeof obj>('obj')).toEqual(obj);
    });

    test('should handle arrays', async () => {
      await service.waitForInit();

      const arr = [1, 2, 3, 'four', { five: 5 }];
      await service.set('arr', arr);
      expect(await service.get<typeof arr>('arr')).toEqual(arr);
    });

    test('should handle null values', async () => {
      await service.waitForInit();

      await service.set('null-key', null);
      expect(await service.get<null>('null-key')).toBeNull();
    });
  });
});
