import { join } from 'path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Effect } from 'effect';

import { makeMockLoggerLayer, createMockConfig } from '@onebun/core';
import { LoggerService } from '@onebun/logger';

import { DrizzleService } from '../src/drizzle.service';
import { generateMigrations, pushSchema } from '../src/migrations';
import { DatabaseType } from '../src/types';

describe('Migration utilities', () => {
  describe('generateMigrations', () => {
    test('should be defined', () => {
      expect(generateMigrations).toBeDefined();
      expect(typeof generateMigrations).toBe('function');
    });

    test('should accept options', async () => {
      await expect(
        generateMigrations({
          schemaPath: './test-schema',
          migrationsFolder: './test-migrations',
          dialect: 'sqlite',
        }),
      ).rejects.toThrow(); // Will fail because schema doesn't exist, but function is callable
    });

    test('should use default options', async () => {
      await expect(generateMigrations()).rejects.toThrow(); // Will fail but function is callable
    });
  });

  describe('pushSchema', () => {
    test('should be defined', () => {
      expect(pushSchema).toBeDefined();
      expect(typeof pushSchema).toBe('function');
    });

    test('should accept options', async () => {
      await expect(
        pushSchema({
          schemaPath: './test-schema',
          dialect: 'sqlite',
          connectionString: ':memory:',
        }),
      ).rejects.toThrow(); // Will fail because schema doesn't exist, but function is callable
    });

    test('should use default options', async () => {
      await expect(pushSchema()).rejects.toThrow(); // Will fail but function is callable
    });
  });
});

describe('runMigrations integration tests', () => {
  let service: DrizzleService;
  let originalDbUrl: string | undefined;
  let originalDbType: string | undefined;

  const testMigrationsFolder = join(__dirname, 'test-migrations');

  beforeAll(() => {
    originalDbUrl = process.env.DB_URL;
    originalDbType = process.env.DB_TYPE;
  });

  afterAll(() => {
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
  });

  beforeEach(() => {
    // Clear module options to prevent auto-initialization
    try {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleModule } = require('../src/drizzle.module');
      DrizzleModule.clearOptions();
    } catch {
      // Ignore if module not available
    }

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
    service = new DrizzleService();
    service.initializeService(logger, createMockConfig());
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.close();
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  test('should apply migrations successfully', async () => {
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    // Should not throw when applying valid migrations
    await service.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Verify table was created
    const sqliteClient = service.getSQLiteClient();
    expect(sqliteClient).not.toBeNull();

    const tables = sqliteClient!.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='test_users'
    `).all();

    expect(tables.length).toBe(1);
    expect((tables[0] as { name: string }).name).toBe('test_users');
  });

  test('should be idempotent - running migrations twice should not throw', async () => {
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    // Apply migrations first time
    await service.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Apply migrations second time - should not throw (idempotent)
    await service.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Verify table still exists
    const sqliteClient = service.getSQLiteClient();
    const tables = sqliteClient!.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='test_users'
    `).all();

    expect(tables.length).toBe(1);
  });

  test('should create __drizzle_migrations table for tracking', async () => {
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    await service.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Verify __drizzle_migrations table was created
    const sqliteClient = service.getSQLiteClient();
    const migrationTables = sqliteClient!.query(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='__drizzle_migrations'
    `).all();

    expect(migrationTables.length).toBe(1);
  });

  test('should track applied migrations in __drizzle_migrations', async () => {
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    await service.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Verify migration was recorded
    const sqliteClient = service.getSQLiteClient();
    const migrations = sqliteClient!.query(`
      SELECT * FROM __drizzle_migrations
    `).all() as Array<{ id: number; hash: string; created_at: number }>;

    expect(migrations.length).toBeGreaterThan(0);
    // Check that migration has required fields
    expect(migrations[0]).toHaveProperty('hash');
    expect(migrations[0]).toHaveProperty('created_at');
  });

  test('should throw error when migrations folder does not exist', async () => {
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    await expect(
      service.runMigrations({ migrationsFolder: './non-existent-folder' }),
    ).rejects.toThrow();
  });

  test('should use default migrations folder when not specified', async () => {
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    // Should throw because default ./drizzle folder doesn't exist
    await expect(service.runMigrations()).rejects.toThrow();
  });

  test('should throw error when database not initialized', async () => {
    // Create fresh service without initialization
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );
    const uninitializedService = new DrizzleService();
    uninitializedService.initializeService(logger, createMockConfig());
    // Call onModuleInit but there's no config, so service won't be initialized
    await uninitializedService.onModuleInit();

    await expect(
      uninitializedService.runMigrations({ migrationsFolder: testMigrationsFolder }),
    ).rejects.toThrow('Database not initialized');
  });

  test('should log applied migration filenames', async () => {
    // Create a capturing logger to verify log output
    interface LogEntry {
      level: string;
      message: string;
      meta?: { appliedFiles?: string[]; newMigrations?: number };
    }
    const logEntries: LogEntry[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capturingLogger: any = {
      debug(msg: string, meta?: object) {
        logEntries.push({ level: 'debug', message: msg, meta });

        return Effect.succeed(undefined);
      },
      info(msg: string, meta?: object) {
        logEntries.push({ level: 'info', message: msg, meta });

        return Effect.succeed(undefined);
      },
      warn(msg: string, meta?: object) {
        logEntries.push({ level: 'warn', message: msg, meta });

        return Effect.succeed(undefined);
      },
      error(msg: string, meta?: object) {
        logEntries.push({ level: 'error', message: msg, meta });

        return Effect.succeed(undefined);
      },
      trace: () => Effect.succeed(undefined),
      child: () => capturingLogger,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      setGlobalContext() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      clearGlobalContext() {},
    };

    const testService = new DrizzleService();
    testService.initializeService(capturingLogger, createMockConfig());

    await testService.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    // Run migrations
    await testService.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Verify that migration filename was logged
    const migrationLog = logEntries.find(
      (entry) => entry.level === 'info' && entry.message.includes('Applied migration:'),
    );
    expect(migrationLog).toBeDefined();
    expect(migrationLog!.message).toContain('0000_test_migration');

    // Verify summary log includes applied files
    const summaryLog = logEntries.find(
      (entry) => entry.level === 'info' && entry.message.includes('SQLite migrations applied'),
    );
    expect(summaryLog).toBeDefined();
    expect(summaryLog!.meta).toHaveProperty('appliedFiles');
    expect(summaryLog!.meta!.appliedFiles).toContain('0000_test_migration');

    await testService.close();
  });

  test('should not log migration names when no new migrations applied', async () => {
    // Create a capturing logger
    interface LogEntry {
      level: string;
      message: string;
      meta?: { appliedFiles?: string[]; newMigrations?: number };
    }
    const logEntries: LogEntry[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capturingLogger: any = {
      debug(msg: string, meta?: object) {
        logEntries.push({ level: 'debug', message: msg, meta });

        return Effect.succeed(undefined);
      },
      info(msg: string, meta?: object) {
        logEntries.push({ level: 'info', message: msg, meta });

        return Effect.succeed(undefined);
      },
      warn(msg: string, meta?: object) {
        logEntries.push({ level: 'warn', message: msg, meta });

        return Effect.succeed(undefined);
      },
      error(msg: string, meta?: object) {
        logEntries.push({ level: 'error', message: msg, meta });

        return Effect.succeed(undefined);
      },
      trace: () => Effect.succeed(undefined),
      child: () => capturingLogger,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      setGlobalContext() {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      clearGlobalContext() {},
    };

    const testService = new DrizzleService();
    testService.initializeService(capturingLogger, createMockConfig());

    await testService.initialize({
      type: DatabaseType.SQLITE,
      options: {
        url: ':memory:',
      },
    });

    // Run migrations first time
    await testService.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Clear log entries
    logEntries.length = 0;

    // Run migrations second time - no new migrations should be applied
    await testService.runMigrations({ migrationsFolder: testMigrationsFolder });

    // Verify that no "Applied migration:" log was emitted
    const migrationLogs = logEntries.filter(
      (entry) => entry.level === 'info' && entry.message.includes('Applied migration:'),
    );
    expect(migrationLogs.length).toBe(0);

    // Verify summary shows 0 new migrations
    const summaryLog = logEntries.find(
      (entry) => entry.level === 'info' && entry.message.includes('SQLite migrations applied'),
    );
    expect(summaryLog).toBeDefined();
    expect(summaryLog!.meta!.newMigrations).toBe(0);
    expect(summaryLog!.meta!.appliedFiles).toEqual([]);

    await testService.close();
  });
});
