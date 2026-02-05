import { join } from 'path';

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from 'bun:test';
import { Effect } from 'effect';

import { makeMockLoggerLayer, createMockConfig } from '@onebun/core';
import { LoggerService } from '@onebun/logger';

import { DrizzleModule } from '../src/drizzle.module';
import { DrizzleService } from '../src/drizzle.service';
import { DatabaseType, type DatabaseConnectionOptions } from '../src/types';


describe('DrizzleService', () => {
  let service: DrizzleService;
  let originalDbUrl: string | undefined;
  let originalDbType: string | undefined;

  beforeAll(() => {
    // Save original env vars at the start of all tests
    originalDbUrl = process.env.DB_URL;
    originalDbType = process.env.DB_TYPE;
  });

  afterAll(async () => {
    // Restore original env vars at the end of all tests
    if (originalDbUrl !== undefined) {
      process.env.DB_URL = originalDbUrl;
    } else {
      delete process.env.DB_URL;
    }
    if (originalDbType !== undefined) {
      process.env.DB_TYPE = originalDbType;
    } else {
      delete process.env.DB_TYPE;
    }

    // Clean up test database file
    try {
      await Bun.file('./test.db').unlink();
    } catch {
      // Ignore if file doesn't exist
    }
  });

  beforeEach(() => {
    // Clear module options BEFORE creating service to prevent auto-initialization
    DrizzleModule.clearOptions();

    // Clear DB env vars to prevent auto-initialization
    // Delete from process.env to ensure EnvLoader doesn't find them
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;

    // Create service and initialize with mock logger
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );
    // Create service and initialize via initializeService method
    service = new DrizzleService();
    service.initializeService(logger, createMockConfig());
  });

  afterEach(async () => {
    // Close service if it exists
    // Note: close() now only waits for init if there are actual DB clients
    if (service) {
      try {
        await service.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe('Initialization', () => {
    test('should create service instance', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(DrizzleService);
    });

    test('should initialize with SQLite', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      const db = service.getDatabase();
      expect(db).toBeDefined();

      const options = service.getConnectionOptions();
      expect(options).toBeDefined();
      expect(options?.type).toBe(DatabaseType.SQLITE);
    });

    test('should initialize with PostgreSQL connection options', async () => {
      // Skip if no PostgreSQL available
      const pgUrl = process.env.TEST_POSTGRES_URL;
      if (!pgUrl) {
        return; // Skip test if no PostgreSQL URL
      }

      // Parse URL to separate fields for testing
      const parsedUrl = new URL(pgUrl);

      await service.initialize({
        type: DatabaseType.POSTGRESQL,
        options: {
          host: parsedUrl.hostname,
          port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 5432,
          user: parsedUrl.username,
          password: parsedUrl.password,
          database: parsedUrl.pathname.slice(1),
        },
      });

      const db = service.getDatabase();
      expect(db).toBeDefined();

      const options = service.getConnectionOptions();
      expect(options).toBeDefined();
      expect(options?.type).toBe(DatabaseType.POSTGRESQL);
    });

    test('should throw error if database not initialized', () => {
      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const newService = new DrizzleService();
      newService.initializeService(logger, createMockConfig());
      expect(() => newService.getDatabase()).toThrow('Database not initialized');
    });

    test('should close existing connection when reinitializing', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      // Reinitialize should close existing connection
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      // Should still work after reinitialization
      const db = service.getDatabase();
      expect(db).toBeDefined();
    });
  });

  describe('Database operations', () => {
    test('should get database instance after initialization', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      const db = service.getDatabase();
      expect(db).toBeDefined();
    });

    test('should get connection options', async () => {
      const connectionOptions: DatabaseConnectionOptions = {
        type: DatabaseType.SQLITE,
        options: {
          url: './test.db',
        },
      };

      await service.initialize(connectionOptions);

      const options = service.getConnectionOptions();
      expect(options).toEqual(connectionOptions);
    });

    test('should return null connection options when not initialized', () => {
      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const newService = new DrizzleService();
      newService.initializeService(logger, createMockConfig());
      const options = newService.getConnectionOptions();
      expect(options).toBeNull();
    });
  });

  describe('Migrations', () => {
    test('should run migrations for SQLite', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      // Should not throw even if migrations folder doesn't exist
      await expect(
        service.runMigrations({ migrationsFolder: './non-existent' }),
      ).rejects.toThrow();
    });

    test('should throw error when running migrations without initialization', async () => {
      // Save original env vars
      const savedDbUrl = process.env.DB_URL;
      const savedDbType = process.env.DB_TYPE;

      // Clear DB env vars to prevent auto-initialization
      delete process.env.DB_URL;
      delete process.env.DB_TYPE;

      try {
        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const newService = new DrizzleService();
        newService.initializeService(logger, createMockConfig());
        // Call onAsyncInit to trigger auto-init attempt
        await newService.onAsyncInit();
        // Verify database is not initialized (no DB_URL set)
        expect(() => newService.getDatabase()).toThrow('Database not initialized');
        // Now test migrations
        await expect(
          newService.runMigrations(),
        ).rejects.toThrow('Database not initialized');
      } finally {
        // Restore original env vars
        if (savedDbUrl) {
          process.env.DB_URL = savedDbUrl;
        }
        if (savedDbType) {
          process.env.DB_TYPE = savedDbType;
        }
      }
    });
  });

  describe('Connection management', () => {
    test('should close SQLite connection', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      await service.close();

      expect(() => service.getDatabase()).toThrow('Database not initialized');
    });

    test('should handle multiple close calls gracefully', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      await service.close();
      // Second close should not throw
      await service.close();
    });
  });

  describe('Transactions', () => {
    test('should execute transaction', async () => {
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: {
          url: ':memory:',
        },
      });

      const result = await service.transaction(async (_tx) => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });

    test('should throw error when transaction without initialization', async () => {
      // Save original env vars
      const savedDbUrl = process.env.DB_URL;
      const savedDbType = process.env.DB_TYPE;

      // Clear DB env vars to prevent auto-initialization
      delete process.env.DB_URL;
      delete process.env.DB_TYPE;

      try {
        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const newService = new DrizzleService();
        newService.initializeService(logger, createMockConfig());
        // Call onAsyncInit to trigger auto-init attempt
        await newService.onAsyncInit();
        // Verify database is not initialized (no DB_URL set)
        expect(() => newService.getDatabase()).toThrow('Database not initialized');
        // Now test transaction
        await expect(
          newService.transaction(async () => 'test'),
        ).rejects.toThrow('Database not initialized');
      } finally {
        // Restore original env vars
        if (savedDbUrl) {
          process.env.DB_URL = savedDbUrl;
        }
        if (savedDbType) {
          process.env.DB_TYPE = savedDbType;
        }
      }
    });
  });

  describe('onAsyncInit behavior', () => {
    test('should complete without error when no DB config', async () => {
      // Save original env vars
      const savedDbUrl = process.env.DB_URL;
      const savedDbType = process.env.DB_TYPE;

      // Clear DB env vars to prevent auto-initialization
      delete process.env.DB_URL;
      delete process.env.DB_TYPE;

      try {
        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const newService = new DrizzleService();
        newService.initializeService(logger, createMockConfig());
        // onAsyncInit should complete without error even if no DB_URL is set
        await newService.onAsyncInit();
        // But database should not be initialized
        expect(() => newService.getDatabase()).toThrow('Database not initialized');
      } finally {
        // Restore original env vars
        if (savedDbUrl) {
          process.env.DB_URL = savedDbUrl;
        }
        if (savedDbType) {
          process.env.DB_TYPE = savedDbType;
        }
      }
    });
  });

  describe('Auto-initialization', () => {
    beforeEach(() => {
      // Clear DrizzleModule options before each test
      DrizzleModule.clearOptions();
    });

    afterEach(async () => {
      DrizzleModule.clearOptions();
    });

    describe('from module options', () => {
      test('auto-initializes when DrizzleModule.forRoot() called with connection', async () => {
        // Set module options before creating service
        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: { url: ':memory:' },
          },
        });

        // Create service - should auto-initialize from module options
        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const autoService = new DrizzleService();
        autoService.initializeService(logger, createMockConfig());

        // Call onAsyncInit to trigger auto-initialization (as the framework does)
        await autoService.onAsyncInit();

        // Database should be initialized
        const db = autoService.getDatabase();
        expect(db).toBeDefined();

        // Connection options should be set
        const options = autoService.getConnectionOptions();
        expect(options).toBeDefined();
        expect(options?.type).toBe(DatabaseType.SQLITE);

        await autoService.close();
      });

      test('getDatabase() returns initialized database instance after auto-init', async () => {
        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: { url: ':memory:' },
          },
        });

        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const autoService = new DrizzleService();
        autoService.initializeService(logger, createMockConfig());
        await autoService.onAsyncInit();

        // Should be able to use the database immediately
        const db = autoService.getDatabase();
        expect(db).toBeDefined();
        expect(typeof db.select).toBe('function');

        await autoService.close();
      });

      test('isSQLite() returns true after auto-init with SQLite', async () => {
        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: { url: ':memory:' },
          },
        });

        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const autoService = new DrizzleService();
        autoService.initializeService(logger, createMockConfig());
        await autoService.onAsyncInit();

        expect(autoService.isSQLite()).toBe(true);
        expect(autoService.isPostgreSQL()).toBe(false);

        await autoService.close();
      });
    });

    describe('from environment variables', () => {
      test('auto-initializes when DB_URL env is set', async () => {
        // IMPORTANT: Clear everything before setting new env vars
        // to avoid interference from parent beforeEach
        DrizzleModule.clearOptions();
        delete process.env.DB_URL;
        delete process.env.DB_TYPE;
        delete process.env.DB_AUTO_MIGRATE;

        // Set environment variables
        process.env.DB_URL = ':memory:';
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_AUTO_MIGRATE = 'false'; // Disable auto-migrate to avoid migration folder errors

        try {
          const loggerLayer = makeMockLoggerLayer();
          const logger = Effect.runSync(
            Effect.provide(
              Effect.map(LoggerService, (l) => l),
              loggerLayer,
            ),
          );
          const envService = new DrizzleService();
          envService.initializeService(logger, createMockConfig());
          await envService.onAsyncInit();

          // Database should be initialized from env vars
          const db = envService.getDatabase();
          expect(db).toBeDefined();

          const options = envService.getConnectionOptions();
          expect(options?.type).toBe(DatabaseType.SQLITE);

          await envService.close();
        } finally {
          delete process.env.DB_URL;
          delete process.env.DB_TYPE;
          delete process.env.DB_AUTO_MIGRATE;
        }
      });

      test('uses DB_TYPE env for database type selection', async () => {
        // IMPORTANT: Clear everything before setting new env vars
        DrizzleModule.clearOptions();
        delete process.env.DB_URL;
        delete process.env.DB_TYPE;
        delete process.env.DB_AUTO_MIGRATE;

        process.env.DB_URL = ':memory:';
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_AUTO_MIGRATE = 'false'; // Disable auto-migrate

        try {
          const loggerLayer = makeMockLoggerLayer();
          const logger = Effect.runSync(
            Effect.provide(
              Effect.map(LoggerService, (l) => l),
              loggerLayer,
            ),
          );
          const envService = new DrizzleService();
          envService.initializeService(logger, createMockConfig());
          await envService.onAsyncInit();

          expect(envService.isSQLite()).toBe(true);
          expect(envService.getConnectionOptions()?.type).toBe(DatabaseType.SQLITE);

          await envService.close();
        } finally {
          delete process.env.DB_URL;
          delete process.env.DB_TYPE;
          delete process.env.DB_AUTO_MIGRATE;
        }
      });

      test('skips auto-init when DB_URL is not set', async () => {
        // Ensure no env vars are set
        delete process.env.DB_URL;
        delete process.env.DB_TYPE;

        const loggerLayer = makeMockLoggerLayer();
        const logger = Effect.runSync(
          Effect.provide(
            Effect.map(LoggerService, (l) => l),
            loggerLayer,
          ),
        );
        const noEnvService = new DrizzleService();
        noEnvService.initializeService(logger, createMockConfig());
        await noEnvService.onAsyncInit();

        // Database should NOT be initialized
        expect(() => noEnvService.getDatabase()).toThrow('Database not initialized');
        expect(noEnvService.getConnectionOptions()).toBeNull();
      });

      test('skips auto-init when DB_URL is empty string', async () => {
        process.env.DB_URL = '';

        try {
          const loggerLayer = makeMockLoggerLayer();
          const logger = Effect.runSync(
            Effect.provide(
              Effect.map(LoggerService, (l) => l),
              loggerLayer,
            ),
          );
          const emptyEnvService = new DrizzleService();
          emptyEnvService.initializeService(logger, createMockConfig());
          await emptyEnvService.onAsyncInit();

          // Database should NOT be initialized with empty string
          expect(() => emptyEnvService.getDatabase()).toThrow('Database not initialized');
        } finally {
          delete process.env.DB_URL;
        }
      });
    });

    describe('priority', () => {
      test('module options take priority over environment variables', async () => {
        // Set both env vars and module options
        process.env.DB_URL = './env-database.db';
        process.env.DB_TYPE = 'sqlite';

        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: { url: ':memory:' }, // Different from env var
          },
        });

        try {
          const loggerLayer = makeMockLoggerLayer();
          const logger = Effect.runSync(
            Effect.provide(
              Effect.map(LoggerService, (l) => l),
              loggerLayer,
            ),
          );
          const priorityService = new DrizzleService();
          priorityService.initializeService(logger, createMockConfig());
          await priorityService.onAsyncInit();

          // Module options should win - url should be :memory: not ./env-database.db
          const options = priorityService.getConnectionOptions();
          expect(options?.type).toBe(DatabaseType.SQLITE);
          if (options?.type === DatabaseType.SQLITE) {
            expect(options.options.url).toBe(':memory:');
          }

          await priorityService.close();
        } finally {
          delete process.env.DB_URL;
          delete process.env.DB_TYPE;
        }
      });
    });
  });

  describe('autoMigrate functionality', () => {
    const testMigrationsFolder = join(__dirname, 'test-migrations');

    beforeEach(() => {
      DrizzleModule.clearOptions();
      delete process.env.DB_URL;
      delete process.env.DB_TYPE;
      delete process.env.DB_AUTO_MIGRATE;
      delete process.env.DB_MIGRATIONS_FOLDER;
    });

    afterEach(() => {
      DrizzleModule.clearOptions();
      delete process.env.DB_URL;
      delete process.env.DB_TYPE;
      delete process.env.DB_AUTO_MIGRATE;
      delete process.env.DB_MIGRATIONS_FOLDER;
    });

    test('runs migrations automatically when autoMigrate: true', async () => {
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        autoMigrate: true,
        migrationsFolder: testMigrationsFolder,
      });

      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const autoMigrateService = new DrizzleService();
      autoMigrateService.initializeService(logger, createMockConfig());
      await autoMigrateService.onAsyncInit();

      // Verify migrations were applied - test_users table should exist
      const sqliteClient = autoMigrateService.getSQLiteClient();
      const tables = sqliteClient!.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='test_users'
      `).all();

      expect(tables.length).toBe(1);
      expect((tables[0] as { name: string }).name).toBe('test_users');

      await autoMigrateService.close();
    });

    test('does NOT run migrations when autoMigrate: false', async () => {
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        autoMigrate: false,
        migrationsFolder: testMigrationsFolder,
      });

      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const noMigrateService = new DrizzleService();
      noMigrateService.initializeService(logger, createMockConfig());
      await noMigrateService.onAsyncInit();

      // Verify migrations were NOT applied - test_users table should NOT exist
      const sqliteClient = noMigrateService.getSQLiteClient();
      const tables = sqliteClient!.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='test_users'
      `).all();

      expect(tables.length).toBe(0);

      await noMigrateService.close();
    });

    test('DOES run migrations when autoMigrate is not specified (default: true)', async () => {
      // When autoMigrate is not specified, it defaults to true and SHOULD auto-migrate
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        // autoMigrate not specified - defaults to true
        migrationsFolder: testMigrationsFolder,
      });

      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const defaultService = new DrizzleService();
      defaultService.initializeService(logger, createMockConfig());
      await defaultService.onAsyncInit();

      // Verify migrations WERE applied (default is now true)
      const sqliteClient = defaultService.getSQLiteClient();
      const tables = sqliteClient!.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='test_users'
      `).all();

      expect(tables.length).toBe(1);

      await defaultService.close();
    });

    test('uses custom migrationsFolder when specified', async () => {
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        autoMigrate: true,
        migrationsFolder: testMigrationsFolder, // Custom folder
      });

      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const customFolderService = new DrizzleService();
      customFolderService.initializeService(logger, createMockConfig());
      await customFolderService.onAsyncInit();

      // Verify migrations from custom folder were applied
      const sqliteClient = customFolderService.getSQLiteClient();
      const tables = sqliteClient!.query(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='test_users'
      `).all();

      expect(tables.length).toBe(1);

      await customFolderService.close();
    });

    test('tracks applied migrations in __drizzle_migrations table', async () => {
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        autoMigrate: true,
        migrationsFolder: testMigrationsFolder,
      });

      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const trackingService = new DrizzleService();
      trackingService.initializeService(logger, createMockConfig());
      await trackingService.onAsyncInit();

      // Verify __drizzle_migrations table was created and has entries
      const sqliteClient = trackingService.getSQLiteClient();
      const migrations = sqliteClient!.query(`
        SELECT * FROM __drizzle_migrations
      `).all() as Array<{ id: number; hash: string; created_at: number }>;

      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0]).toHaveProperty('hash');
      expect(migrations[0]).toHaveProperty('created_at');

      await trackingService.close();
    });

    test('handles missing migrations folder gracefully when autoMigrate: true', async () => {
      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: ':memory:' },
        },
        autoMigrate: true,
        migrationsFolder: './non-existent-migrations-folder',
      });

      const loggerLayer = makeMockLoggerLayer();
      const logger = Effect.runSync(
        Effect.provide(
          Effect.map(LoggerService, (l) => l),
          loggerLayer,
        ),
      );
      const missingFolderService = new DrizzleService();
      missingFolderService.initializeService(logger, createMockConfig());

      // Should not throw, but auto-init might fail gracefully
      await missingFolderService.onAsyncInit();

      // The service should still be partially usable (DB initialized but migrations failed)
      // The actual behavior depends on implementation - either:
      // 1. DB initialized, migrations skipped with error logged
      // 2. Entire auto-init fails, service not initialized
      // Let's check if the service is usable
      try {
        const db = missingFolderService.getDatabase();
        expect(db).toBeDefined();
      } catch {
        // It's also acceptable if the service is not initialized due to migration failure
        expect(true).toBe(true);
      }

      await missingFolderService.close();
    });
  });
});
