import {
  describe,
  expect,
  test,
} from 'bun:test';

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
