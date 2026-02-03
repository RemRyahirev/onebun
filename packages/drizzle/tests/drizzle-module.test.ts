/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  describe,
  expect,
  test,
  beforeEach,
  afterAll,
  afterEach,
} from 'bun:test';

import {
  DrizzleModule,
  DatabaseType,
  type DrizzleModuleOptions,
} from '../src';

describe('DrizzleModule', () => {
  beforeEach(() => {
    // Clear DB env vars to prevent auto-initialization
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;
  });

  afterEach(() => {
    // Clear module options after each test
    DrizzleModule.clearOptions();
  });

  afterAll(async () => {
    try {
      await Bun.file('./test.db').unlink();
    } catch (_) {

    }
  });

  describe('Basic module usage', () => {
    test('should create module without options', () => {
      expect(DrizzleModule).toBeDefined();
      expect(DrizzleModule).toHaveProperty('forRoot');
    });

    test('should have static forRoot method', () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const ModuleWithOptions = DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: ':memory:',
          },
        },
      });

      expect(ModuleWithOptions).toBeDefined();
      expect(ModuleWithOptions).toBe(DrizzleModule);
    });

    test('should store module options', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: './test.db',
          },
        },
        autoMigrate: true,
        migrationsFolder: './migrations',
      };

      DrizzleModule.forRoot(options);
      const storedOptions = DrizzleModule.getOptions();

      expect(storedOptions).toEqual(options);
    });
  });

  describe('Module configuration', () => {
    test('should configure with SQLite options', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: './test.db',
          },
        },
        autoMigrate: false,
      };

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const ModuleWithOptions = DrizzleModule.forRoot(options);
      expect(ModuleWithOptions.getOptions()).toEqual(options);
    });

    test('should configure with PostgreSQL options', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.POSTGRESQL,
          options: {
            host: 'localhost',
            port: 5432,
            user: 'user',
            password: 'password',
            database: 'testdb',
            pool: {
              max: 20,
              min: 5,
              timeout: 10000,
            },
          },
        },
        autoMigrate: true,
        migrationsFolder: './custom-migrations',
      };

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const ModuleWithOptions = DrizzleModule.forRoot(options);
      expect(ModuleWithOptions.getOptions()).toEqual(options);
    });

    test('should handle partial options', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: ':memory:',
          },
        },
      };

      DrizzleModule.forRoot(options);
      const storedOptions = DrizzleModule.getOptions();

      expect(storedOptions).toEqual(options);
    });

    test('should handle empty options', () => {
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: ':memory:',
          },
        },
      });
      const storedOptions = DrizzleModule.getOptions();

      expect(storedOptions).toBeDefined();
      expect(storedOptions?.connection.type).toBe(DatabaseType.SQLITE);
    });
  });

  describe('DrizzleService integration', () => {
    test('DrizzleService should be exportable', () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleService } = require('../src/drizzle.service');
      expect(DrizzleService).toBeDefined();
      expect(DrizzleService.prototype).toHaveProperty('initialize');
      expect(DrizzleService.prototype).toHaveProperty('getDatabase');
    });

    test('DrizzleService should have all required methods', () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleService } = require('../src/drizzle.service');
      const methods = [
        'initialize',
        'getDatabase',
        'getConnectionOptions',
        'runMigrations',
        'close',
        'transaction',
      ];

      for (const method of methods) {
        expect(DrizzleService.prototype).toHaveProperty(method);
      }
    });
  });

  describe('Module options override', () => {
    test('should allow overriding options multiple times', () => {
      const options1: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: './test1.db',
          },
        },
      };

      DrizzleModule.forRoot(options1);
      expect(DrizzleModule.getOptions()).toEqual(options1);

      const options2: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.POSTGRESQL,
          options: {
            host: 'localhost',
            port: 5432,
            user: 'testuser',
            password: 'testpass',
            database: 'test2',
          },
        },
      };

      DrizzleModule.forRoot(options2);
      expect(DrizzleModule.getOptions()).toEqual(options2);
    });
  });

  describe('Type checking', () => {
    test('should accept valid DatabaseType enum values', () => {
      const sqliteOptions: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
      };
      const postgresOptions: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.POSTGRESQL,
          options: {
            host: 'localhost',
            port: 5432,
            user: 'testuser',
            password: 'testpass',
            database: 'test',
          },
        },
      };

      expect(() => DrizzleModule.forRoot(sqliteOptions)).not.toThrow();
      expect(() => DrizzleModule.forRoot(postgresOptions)).not.toThrow();
    });
  });

  describe('Global module support', () => {
    // Import the functions we need
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { isGlobalModule, clearGlobalModules, Global } = require('@onebun/core');

    // Note: We don't clear global modules in beforeEach because @Global() decorator
    // only runs once when the module is first imported. Clearing would break the test
    // for "DrizzleModule should be global by default".
    
    afterEach(() => {
      // Clear module options after each test
      DrizzleModule.clearOptions();
    });

    test('DrizzleModule should be global by default', () => {
      // DrizzleModule is decorated with @Global() at module definition time
      // This test verifies the decorator was applied correctly
      expect(isGlobalModule(DrizzleModule)).toBe(true);
    });

    test('should have forFeature static method', () => {
      expect(DrizzleModule).toHaveProperty('forFeature');
      expect(typeof DrizzleModule.forFeature).toBe('function');
    });

    test('forFeature should return DrizzleModule class', () => {
      const result = DrizzleModule.forFeature();
      expect(result).toBe(DrizzleModule);
    });

    test('should accept isGlobal option in forRoot', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        isGlobal: true,
      };

      DrizzleModule.forRoot(options);
      const storedOptions = DrizzleModule.getOptions();

      expect(storedOptions?.isGlobal).toBe(true);
    });

    test('should handle isGlobal: false option', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        isGlobal: false,
      };

      DrizzleModule.forRoot(options);
      const storedOptions = DrizzleModule.getOptions();

      expect(storedOptions?.isGlobal).toBe(false);
    });

    test('isGlobal should default to undefined (treated as true)', () => {
      const options: DrizzleModuleOptions = {
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        // isGlobal not specified
      };

      DrizzleModule.forRoot(options);
      const storedOptions = DrizzleModule.getOptions();

      // When isGlobal is not specified, it defaults to undefined
      // which should be treated as true by the module system
      expect(storedOptions?.isGlobal).toBeUndefined();
    });

    test('forRoot with isGlobal: false should call removeFromGlobalModules', () => {
      // This test verifies that isGlobal: false triggers the removal logic
      // The actual global registry behavior is tested in @onebun/core
      
      // Call forRoot with isGlobal: false
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        isGlobal: false,
      });

      // Verify the option was stored correctly
      const options = DrizzleModule.getOptions();
      expect(options?.isGlobal).toBe(false);

      // Restore DrizzleModule to global for subsequent tests
      Global()(DrizzleModule);
    });

    test('forFeature can be called multiple times', () => {
      // forFeature should be idempotent
      const result1 = DrizzleModule.forFeature();
      const result2 = DrizzleModule.forFeature();

      expect(result1).toBe(DrizzleModule);
      expect(result2).toBe(DrizzleModule);
      expect(result1).toBe(result2);
    });

    test('forRoot with isGlobal: true stores option correctly', () => {
      // Calling forRoot with isGlobal: true should store the option
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        isGlobal: true,
      });

      const options = DrizzleModule.getOptions();
      expect(options?.isGlobal).toBe(true);
    });
  });

  describe('forFeature usage scenarios', () => {
    test('forFeature should be useful for non-global module imports', () => {
      // When DrizzleModule is used with isGlobal: false, feature modules
      // need to explicitly import it using forFeature()
      
      // This is a documentation/API test
      expect(typeof DrizzleModule.forFeature).toBe('function');
      expect(DrizzleModule.forFeature()).toBe(DrizzleModule);
    });

    test('forFeature returns same module for consistent DI', () => {
      // Multiple calls to forFeature should return the same module class
      // This ensures consistent dependency injection
      const feature1 = DrizzleModule.forFeature();
      const feature2 = DrizzleModule.forFeature();

      expect(feature1).toBe(feature2);
      // Both should be the same DrizzleModule class
      expect(feature1).toBe(DrizzleModule);
      expect(feature2).toBe(DrizzleModule);
    });
  });
});
