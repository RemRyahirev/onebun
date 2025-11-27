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
});
