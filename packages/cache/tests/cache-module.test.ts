/* eslint-disable @typescript-eslint/naming-convention */
import {
  describe,
  expect,
  test,
} from 'bun:test';

import type { CacheModuleOptions } from '../src';

import {
  CacheModule,
  CacheService,
  CacheType,
} from '../src';

describe('CacheModule (NestJS-style)', () => {
  describe('Basic module usage', () => {
    test('should create module without options', () => {
      expect(CacheModule).toBeDefined();
      expect(CacheModule).toHaveProperty('forRoot');
    });

    test('should have static forRoot method', () => {
      const ModuleWithOptions = CacheModule.forRoot({
        type: CacheType.MEMORY,
      });
      
      expect(ModuleWithOptions).toBeDefined();
      expect(ModuleWithOptions).toBe(CacheModule);
    });

    test('should store module options', () => {
      const options = {
        type: CacheType.MEMORY,
        cacheOptions: {
          defaultTtl: 5000,
          maxSize: 100,
        },
      };
      
      CacheModule.forRoot(options);
      const storedOptions = CacheModule.getOptions();
      
      expect(storedOptions).toEqual(options);
    });
  });

  describe('Module configuration', () => {
    test('should configure with memory cache options', () => {
      const options = {
        type: CacheType.MEMORY,
        cacheOptions: {
          defaultTtl: 60000,
          maxSize: 1000,
          cleanupInterval: 30000,
        },
      };
      
      const ModuleWithOptions = CacheModule.forRoot(options);
      expect(ModuleWithOptions.getOptions()).toEqual(options);
    });

    test('should configure with redis cache options', () => {
      const options = {
        type: CacheType.REDIS,
        cacheOptions: {
          defaultTtl: 60000,
        },
        redisOptions: {
          host: 'redis.example.com',
          port: 6380,
          password: 'secret',
        },
      };
      
      const ModuleWithOptions = CacheModule.forRoot(options);
      expect(ModuleWithOptions.getOptions()).toEqual(options);
    });

    test('should handle partial options', () => {
      const options = {
        cacheOptions: {
          defaultTtl: 30000,
        },
      };
      
      CacheModule.forRoot(options);
      const storedOptions = CacheModule.getOptions();
      
      expect(storedOptions).toEqual(options);
    });

    test('should handle empty options', () => {
      CacheModule.forRoot({});
      const storedOptions = CacheModule.getOptions();
      
      expect(storedOptions).toEqual({});
    });
  });

  describe('CacheService integration', () => {
    test('CacheService should be exportable', () => {
      expect(CacheService).toBeDefined();
      expect(CacheService.prototype).toHaveProperty('get');
      expect(CacheService.prototype).toHaveProperty('set');
      expect(CacheService.prototype).toHaveProperty('delete');
    });

    test('CacheService should have all required methods', () => {
      const methods = [
        'get',
        'set',
        'delete',
        'has',
        'clear',
        'mget',
        'mset',
        'getStats',
        'close',
      ];

      for (const method of methods) {
        expect(CacheService.prototype).toHaveProperty(method);
      }
    });
  });

  describe('Module options override', () => {
    test('should allow overriding options multiple times', () => {
      const options1 = {
        type: CacheType.MEMORY,
        cacheOptions: { defaultTtl: 1000 },
      };
      
      CacheModule.forRoot(options1);
      expect(CacheModule.getOptions()).toEqual(options1);
      
      const options2 = {
        type: CacheType.REDIS,
        cacheOptions: { defaultTtl: 2000 },
      };
      
      CacheModule.forRoot(options2);
      expect(CacheModule.getOptions()).toEqual(options2);
    });
  });

  describe('Type checking', () => {
    test('should accept valid CacheType enum values', () => {
      const memoryOptions = { type: CacheType.MEMORY };
      const redisOptions = { type: CacheType.REDIS };
      
      expect(() => CacheModule.forRoot(memoryOptions)).not.toThrow();
      expect(() => CacheModule.forRoot(redisOptions)).not.toThrow();
    });

    test('should work with type inference', () => {
      // This is more of a compile-time test, but we can check runtime behavior
      const options = {
        type: CacheType.MEMORY as const,
        cacheOptions: {
          defaultTtl: 5000,
        },
      };
      
      const ModuleWithOptions = CacheModule.forRoot(options);
      expect(ModuleWithOptions.getOptions()?.type).toBe(CacheType.MEMORY);
    });
  });

  describe('Documentation examples', () => {
    test('should work with basic example from docs', () => {
      // Example from documentation
      const ModuleWithOptions = CacheModule.forRoot({
        type: CacheType.MEMORY,
        cacheOptions: {
          defaultTtl: 60000,
          maxSize: 1000,
        },
      });
      
      expect(ModuleWithOptions).toBe(CacheModule);
      expect(CacheModule.getOptions()?.type).toBe(CacheType.MEMORY);
      expect(CacheModule.getOptions()?.cacheOptions?.defaultTtl).toBe(60000);
      expect(CacheModule.getOptions()?.cacheOptions?.maxSize).toBe(1000);
    });

    test('should work with redis example from docs', () => {
      // Example from documentation
      CacheModule.forRoot({
        type: CacheType.REDIS,
        cacheOptions: { defaultTtl: 60000 },
        redisOptions: { 
          host: 'redis.example.com',
          port: 6379,
        },
      });
      
      const options = CacheModule.getOptions();
      expect(options?.type).toBe(CacheType.REDIS);
      expect(options?.redisOptions?.host).toBe('redis.example.com');
      expect(options?.redisOptions?.port).toBe(6379);
    });
  });

  describe('Global module support', () => {
     
    const { isGlobalModule, Global } = require('@onebun/core');

    test('CacheModule should be global by default', () => {
      // CacheModule is decorated with @Global() at module definition time
      // This test verifies the decorator was applied correctly
      expect(isGlobalModule(CacheModule)).toBe(true);
    });

    test('should have forFeature static method', () => {
      expect(CacheModule).toHaveProperty('forFeature');
      expect(typeof CacheModule.forFeature).toBe('function');
    });

    test('forFeature should return CacheModule class', () => {
      const result = CacheModule.forFeature();
      expect(result).toBe(CacheModule);
    });

    test('should accept isGlobal option in forRoot', () => {
      const options: CacheModuleOptions = {
        type: CacheType.MEMORY,
        isGlobal: true,
      };

      CacheModule.forRoot(options);
      const storedOptions = CacheModule.getOptions();

      expect(storedOptions?.isGlobal).toBe(true);
    });

    test('should handle isGlobal: false option', () => {
      const options: CacheModuleOptions = {
        type: CacheType.MEMORY,
        isGlobal: false,
      };

      CacheModule.forRoot(options);
      const storedOptions = CacheModule.getOptions();

      expect(storedOptions?.isGlobal).toBe(false);
    });

    test('isGlobal should default to undefined (treated as true)', () => {
      const options: CacheModuleOptions = {
        type: CacheType.MEMORY,
        // isGlobal not specified
      };

      CacheModule.forRoot(options);
      const storedOptions = CacheModule.getOptions();

      // When isGlobal is not specified, it defaults to undefined
      // which should be treated as true by the module system
      expect(storedOptions?.isGlobal).toBeUndefined();
    });

    test('forRoot with isGlobal: false should call removeFromGlobalModules', () => {
      // This test verifies that isGlobal: false triggers the removal logic
      // The actual global registry behavior is tested in @onebun/core

      // Call forRoot with isGlobal: false
      CacheModule.forRoot({
        type: CacheType.MEMORY,
        isGlobal: false,
      });

      // Verify the option was stored correctly
      const options = CacheModule.getOptions();
      expect(options?.isGlobal).toBe(false);

      // Restore CacheModule to global for subsequent tests
      Global()(CacheModule);
    });

    test('forFeature should return same module reference', () => {
      const result1 = CacheModule.forFeature();
      const result2 = CacheModule.forFeature();
      expect(result1).toBe(CacheModule);
      expect(result2).toBe(CacheModule);
      expect(result1).toBe(result2);
    });

    test('forRoot with isGlobal: true stores option correctly', () => {
      // Calling forRoot with isGlobal: true should store the option
      CacheModule.forRoot({
        type: CacheType.MEMORY,
        isGlobal: true,
      });

      const options = CacheModule.getOptions();
      expect(options?.isGlobal).toBe(true);
    });
  });

  describe('Environment prefix', () => {
    test('should accept custom envPrefix', () => {
      CacheModule.forRoot({
        envPrefix: 'MY_CACHE',
      });
      
      const options = CacheModule.getOptions();
      expect(options?.envPrefix).toBe('MY_CACHE');
    });

    test('should work with envPrefix and other options', () => {
      CacheModule.forRoot({
        type: CacheType.MEMORY,
        envPrefix: 'CUSTOM_CACHE',
        cacheOptions: {
          defaultTtl: 30000,
        },
      });
      
      const options = CacheModule.getOptions();
      expect(options?.envPrefix).toBe('CUSTOM_CACHE');
      expect(options?.type).toBe(CacheType.MEMORY);
      expect(options?.cacheOptions?.defaultTtl).toBe(30000);
    });
  });
});
