/* eslint-disable
   @typescript-eslint/no-empty-function,
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   jest/unbound-method */
import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';

import type { IConfig, OneBunAppConfig } from './config.interface';

import type { SyncLogger } from '@onebun/logger';

import {
  ConfigServiceImpl,
  ConfigServiceTag,
  ConfigService,
} from './config.service';

describe('ConfigService', () => {
  let mockLogger: SyncLogger;
   
  let mockConfig: IConfig<OneBunAppConfig>;

  beforeEach(() => {
    mockLogger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      fatal: mock(() => {}),
      trace: mock(() => {}),
      child: mock(() => mockLogger),
    };

    mockConfig = {
      initialize: mock(async () => {}),
      get: mock((path: string): any => `value-for-${path}`),
      values: { test: 'value' } as unknown as OneBunAppConfig,
      getSafeConfig: mock(() => ({ test: '***' })) as unknown as () => OneBunAppConfig,
      isInitialized: true,
    };
  });

  describe('ConfigServiceImpl', () => {
    test('should create instance with logger and config', () => {
      const service = new ConfigServiceImpl(mockLogger, mockConfig);
      
      expect(service).toBeInstanceOf(ConfigServiceImpl);
      expect(service.instance).toBe(mockConfig);
    });

    test('should create instance without logger (uninitialized)', () => {
      const service = new ConfigServiceImpl();
      expect(service).toBeInstanceOf(ConfigServiceImpl);
      // Service exists but is not initialized
      expect((service as any).isInitialized).toBe(false);
    });

    test('should create instance with logger only', () => {
      const service = new ConfigServiceImpl(mockLogger);
      
      expect(service).toBeInstanceOf(ConfigServiceImpl);
      expect(service.instance).toBeNull();
    });

    test('should create instance with config but without logger (uninitialized)', () => {
      const service = new ConfigServiceImpl(undefined, mockConfig);
      expect(service).toBeInstanceOf(ConfigServiceImpl);
      expect(service.instance).toBe(mockConfig);
      // Config is available but logger is not initialized
    });

    describe('initialize', () => {
      test('should initialize config when config instance exists', async () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        await service.initialize();
        
        expect(mockConfig.initialize).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith('Configuration initialized successfully');
      });

      test('should not throw when config instance is undefined', async () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        await expect(service.initialize()).resolves.toBeUndefined();
        expect(mockLogger.info).not.toHaveBeenCalled();
      });

      test('should initialize config when logger is provided', async () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        await expect(service.initialize()).resolves.toBeUndefined();
        expect(mockConfig.initialize).toHaveBeenCalled();
      });
    });

    describe('get', () => {
      test('should get configuration value by path', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        const result = service.get('test.path');
        
        expect(result).toBe('value-for-test.path');
        expect(mockConfig.get).toHaveBeenCalledWith('test.path');
      });

      test('should throw error when config not initialized', () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        expect(() => service.get('test.path')).toThrow(
          'Configuration not initialized. Provide envSchema in ApplicationOptions.',
        );
      });

      test('should return typed value', () => {
        const typedConfig = {
          initialize: mock(async () => {}),
          get: mock((path: string) => path === 'test.number' ? 42 : undefined),
          values: { test: 'value' } as unknown as OneBunAppConfig,
          getSafeConfig: mock(() => ({ test: '***' })) as unknown as () => OneBunAppConfig,
          isInitialized: true,
        } as unknown as IConfig<OneBunAppConfig>;
        const service = new ConfigServiceImpl(mockLogger, typedConfig);
        
        const result = service.get<number>('test.number');
        
        expect(result).toBe(42);
        expect(typeof result).toBe('number');
      });
    });

    describe('values getter', () => {
      test('should return all configuration values', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        const result = service.values;
        
        // Use unknown cast because tests use mock data that doesn't match OneBunAppConfig augmentation
        expect(result as unknown).toEqual({ test: 'value' });
      });

      test('should throw error when config not initialized', () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        expect(() => service.values).toThrow(
          'Configuration not initialized. Provide envSchema in ApplicationOptions.',
        );
      });
    });

    describe('getSafeConfig', () => {
      test('should return safe configuration', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        const result = service.getSafeConfig();
        
        // Use unknown cast because tests use mock data that doesn't match OneBunAppConfig augmentation
        expect(result as unknown).toEqual({ test: '***' });
        expect(mockConfig.getSafeConfig).toHaveBeenCalled();
      });

      test('should throw error when config not initialized', () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        expect(() => service.getSafeConfig()).toThrow(
          'Configuration not initialized. Provide envSchema in ApplicationOptions.',
        );
      });
    });

    describe('isInitialized getter', () => {
      test('should return true when config is initialized', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        expect(service.isInitialized).toBe(true);
      });

      test('should return false when config not initialized', () => {
        const uninitConfig = {
          initialize: mock(async () => {}),
          get: mock((path: string): any => `value-for-${path}`),
          values: { test: 'value' } as unknown as OneBunAppConfig,
          getSafeConfig: mock(() => ({ test: '***' })) as unknown as () => OneBunAppConfig,
          isInitialized: false,
        } as unknown as IConfig<OneBunAppConfig>;
        const service = new ConfigServiceImpl(mockLogger, uninitConfig);
        
        expect(service.isInitialized).toBe(false);
      });

      test('should return false when config instance is undefined', () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        expect(service.isInitialized).toBe(false);
      });
    });

    describe('instance getter', () => {
      test('should return config instance', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        expect(service.instance).toBe(mockConfig);
      });

      test('should return null when no config provided', () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        expect(service.instance).toBeNull();
      });
    });

    describe('inheritance from BaseService', () => {
      test('should call parent constructor', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        // Should have logger from BaseService
        expect(service).toHaveProperty('logger');
      });

      test('should handle undefined config in constructor', () => {
        const service = new ConfigServiceImpl(mockLogger, undefined);
        
        expect(service.instance).toBeNull();
        expect(service.isInitialized).toBe(false);
      });
    });

    describe('error handling', () => {
      test('should handle initialization error gracefully', async () => {
        const errorConfig = {
          initialize: mock(() => Promise.reject(new Error('Init failed'))),
          get: mock(() => undefined),
          values: {} as unknown as OneBunAppConfig,
          getSafeConfig: mock(() => ({})) as unknown as () => OneBunAppConfig,
          isInitialized: false,
        } as unknown as IConfig<OneBunAppConfig>;
        
        const service = new ConfigServiceImpl(mockLogger, errorConfig);
        
        await expect(service.initialize()).rejects.toThrow('Init failed');
      });

      test('should handle config method errors', () => {
        const errorConfig = {
          initialize: mock(async () => {}),
          get: mock(() => {
            throw new Error('Get failed'); 
          }),
          values: null as unknown as unknown as OneBunAppConfig,
          getSafeConfig: mock(() => {
            throw new Error('Safe config failed'); 
          }) as unknown as () => OneBunAppConfig,
          isInitialized: true,
        } as unknown as IConfig<OneBunAppConfig>;
        
        const service = new ConfigServiceImpl(mockLogger, errorConfig);
        
        expect(() => service.get('test')).toThrow('Get failed');
        expect(() => service.getSafeConfig()).toThrow('Safe config failed');
      });
    });

    describe('edge cases', () => {
      test('should handle config with null values', () => {
        const nullConfig = {
          initialize: mock(async () => {}),
          get: mock(() => null),
          values: null as unknown as unknown as OneBunAppConfig,
          getSafeConfig: mock(() => null as unknown as unknown as OneBunAppConfig),
          isInitialized: true,
        } as unknown as IConfig<OneBunAppConfig>;
        
        const service = new ConfigServiceImpl(mockLogger, nullConfig);
        
        expect(service.get('test')).toBeNull();
        expect(service.values).toBeNull();
        expect(service.getSafeConfig()).toBeNull();
      });

      test('should handle config with undefined values', () => {
        const undefinedConfig = {
          initialize: mock(async () => {}),
          get: mock(() => undefined),
          values: undefined as unknown as unknown as OneBunAppConfig,
          getSafeConfig: mock(() => undefined as unknown as unknown as OneBunAppConfig),
          isInitialized: false,
        } as unknown as IConfig<OneBunAppConfig>;
        
        const service = new ConfigServiceImpl(mockLogger, undefinedConfig);
        
        expect(service.get('test')).toBeUndefined();
        expect(service.values).toBeUndefined();
        expect(service.getSafeConfig()).toBeUndefined();
        expect(service.isInitialized).toBe(false);
      });
    });
  });

  describe('exports', () => {
    test('should export ConfigServiceTag', () => {
      expect(ConfigServiceTag).toBeDefined();
    });

    test('should export ConfigService alias', () => {
      expect(ConfigService).toBe(ConfigServiceTag);
    });

    test('should export ConfigServiceImpl class', () => {
      expect(ConfigServiceImpl).toBeDefined();
      expect(new ConfigServiceImpl(mockLogger)).toBeInstanceOf(ConfigServiceImpl);
    });
  });

  describe('integration scenarios', () => {
    test('should work with complex configuration object', () => {
      const complexConfig = {
        initialize: mock(async () => {}),
        get: mock((path: string): any => {
          const config = {
            'database.host': 'localhost',
            'database.port': 5432,
            'api.key': 'secret',
            'api.timeout': 30000,
          };

          return config[path as keyof typeof config];
        }),
        values: {
          database: { host: 'localhost', port: 5432 },
          api: { key: 'secret', timeout: 30000 },
        },
        getSafeConfig: mock(() => ({
          database: { host: 'localhost', port: 5432 },
          api: { key: '***', timeout: 30000 },
        })),
        isInitialized: true,
      } as unknown as IConfig<OneBunAppConfig>;

      const service = new ConfigServiceImpl(mockLogger, complexConfig);

      expect((service as any).get('database.host')).toBe('localhost');
      expect((service as any).get('database.port')).toBe(5432);
      // Use unknown cast because tests use mock data that doesn't match OneBunAppConfig augmentation
      expect(service.values as unknown).toEqual({
        database: { host: 'localhost', port: 5432 },
        api: { key: 'secret', timeout: 30000 },
      });
      
      const safeConfig = service.getSafeConfig();
      // Use unknown cast because tests use mock data that doesn't match OneBunAppConfig augmentation
      expect(safeConfig as unknown).toEqual({
        database: { host: 'localhost', port: 5432 },
        api: { key: '***', timeout: 30000 },
      });
    });

    test('should handle service lifecycle', async () => {
      const service = new ConfigServiceImpl(mockLogger, mockConfig);

      // Initially should be accessible
      expect(service.isInitialized).toBe(true);

      // Should be able to initialize
      await service.initialize();
      expect(mockConfig.initialize).toHaveBeenCalled();

      // Should be able to access config after initialization
      expect((service as any).get('test')).toBe('value-for-test');
    });
  });
});
