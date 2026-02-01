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

import type { SyncLogger } from '@onebun/logger';

import {
  ConfigServiceImpl,
  ConfigServiceTag,
  ConfigService,
} from './config.service';

describe('ConfigService', () => {
  let mockLogger: SyncLogger;
   
  let mockConfig: any;

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
      values: { test: 'value' },
      getSafeConfig: mock(() => ({ test: '***' })),
      isInitialized: true,
    };
  });

  describe('ConfigServiceImpl', () => {
    test('should create instance with logger and config', () => {
      const service = new ConfigServiceImpl(mockLogger, mockConfig);
      
      expect(service).toBeInstanceOf(ConfigServiceImpl);
      expect(service.instance).toBe(mockConfig);
    });

    test('should require logger for service creation', () => {
      expect(() => {
        new ConfigServiceImpl();
      }).toThrow('Logger is required for service ConfigServiceImpl');
    });

    test('should create instance with logger only', () => {
      const service = new ConfigServiceImpl(mockLogger);
      
      expect(service).toBeInstanceOf(ConfigServiceImpl);
      expect(service.instance).toBeUndefined();
    });

    test('should require logger even with config', () => {
      expect(() => {
        new ConfigServiceImpl(undefined, mockConfig);
      }).toThrow('Logger is required for service ConfigServiceImpl');
    });

    describe('initialize', () => {
      test('should initialize config when config instance exists', async () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        await service.initialize();
        
        expect(mockConfig.initialize).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith('Configuration initialized successfully');
      });

      test('should not throw when config instance is null', async () => {
        const service = new ConfigServiceImpl(mockLogger, null);
        
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
        const service = new ConfigServiceImpl(mockLogger, null);
        
        expect(() => service.get('test.path')).toThrow(
          'Configuration not initialized. Provide envSchema in ApplicationOptions.',
        );
      });

      test('should return typed value', () => {
        mockConfig.get.mockReturnValue(42);
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        const result = service.get<number>('test.number');
        
        expect(result).toBe(42);
        expect(typeof result).toBe('number');
      });
    });

    describe('values getter', () => {
      test('should return all configuration values', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        const result = service.values;
        
        expect(result).toEqual({ test: 'value' });
      });

      test('should throw error when config not initialized', () => {
        const service = new ConfigServiceImpl(mockLogger, null);
        
        expect(() => service.values).toThrow(
          'Configuration not initialized. Provide envSchema in ApplicationOptions.',
        );
      });
    });

    describe('getSafeConfig', () => {
      test('should return safe configuration', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        const result = service.getSafeConfig();
        
        expect(result).toEqual({ test: '***' });
        expect(mockConfig.getSafeConfig).toHaveBeenCalled();
      });

      test('should throw error when config not initialized', () => {
        const service = new ConfigServiceImpl(mockLogger, null);
        
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
        mockConfig.isInitialized = false;
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        expect(service.isInitialized).toBe(false);
      });

      test('should return false when config instance is null', () => {
        const service = new ConfigServiceImpl(mockLogger, null);
        
        expect(service.isInitialized).toBe(false);
      });
    });

    describe('instance getter', () => {
      test('should return config instance', () => {
        const service = new ConfigServiceImpl(mockLogger, mockConfig);
        
        expect(service.instance).toBe(mockConfig);
      });

      test('should return null when no config provided', () => {
        const service = new ConfigServiceImpl(mockLogger, null);
        
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
        
        expect(service.instance).toBeUndefined();
        expect(service.isInitialized).toBe(false);
      });
    });

    describe('error handling', () => {
      test('should handle initialization error gracefully', async () => {
        const errorConfig = {
          initialize: mock(() => Promise.reject(new Error('Init failed'))),
          isInitialized: false,
        };
        
        const service = new ConfigServiceImpl(mockLogger, errorConfig);
        
        await expect(service.initialize()).rejects.toThrow('Init failed');
      });

      test('should handle config method errors', () => {
        const errorConfig = {
          get: mock(() => {
            throw new Error('Get failed'); 
          }),
          values: null,
          getSafeConfig: mock(() => {
            throw new Error('Safe config failed'); 
          }),
          isInitialized: true,
        };
        
        const service = new ConfigServiceImpl(mockLogger, errorConfig);
        
        expect(() => service.get('test')).toThrow('Get failed');
        expect(() => service.getSafeConfig()).toThrow('Safe config failed');
      });
    });

    describe('edge cases', () => {
      test('should handle config with null values', () => {
        const nullConfig = {
          get: mock(() => null),
          values: null,
          getSafeConfig: mock(() => null),
          isInitialized: true,
        };
        
        const service = new ConfigServiceImpl(mockLogger, nullConfig);
        
        expect(service.get('test')).toBeNull();
        expect(service.values).toBeNull();
        expect(service.getSafeConfig()).toBeNull();
      });

      test('should handle config with undefined values', () => {
        const undefinedConfig = {
          get: mock(() => undefined),
          values: undefined,
          getSafeConfig: mock(() => undefined),
          isInitialized: false,
        };
        
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
      };

      const service = new ConfigServiceImpl(mockLogger, complexConfig);

      expect((service as any).get('database.host')).toBe('localhost');
      expect((service as any).get('database.port')).toBe(5432);
      expect(service.values).toEqual({
        database: { host: 'localhost', port: 5432 },
        api: { key: 'secret', timeout: 30000 },
      });
      
      const safeConfig = service.getSafeConfig();
      expect(safeConfig).toEqual({
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
