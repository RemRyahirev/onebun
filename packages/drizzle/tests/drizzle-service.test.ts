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

import { makeMockLoggerLayer } from '@onebun/core';
import { LoggerService } from '@onebun/logger';

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

  afterAll(() => {
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

    afterAll(async () => {
      try {
        await Bun.file('./test.db').unlink();
      } catch (_) {

      }
    });
  });

  beforeEach(() => {
    // Clear DB env vars to prevent auto-initialization
    // Delete from process.env to ensure EnvLoader doesn't find them
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;

    // Create service with mock logger
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );
    // BaseService expects logger as second-to-last argument
    service = new DrizzleService(logger, undefined);
  });

  afterEach(async () => {
    // Clear module options to prevent interference between tests
    try {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleModule } = require('../src/drizzle.module');
      DrizzleModule.clearOptions();
    } catch {
      // Ignore if module not available
    }

    try {
      await service.close();
    } catch {
      // Ignore errors during cleanup
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
      const newService = new DrizzleService(logger, undefined);
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
      const newService = new DrizzleService(logger, undefined);
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
        const newService = new DrizzleService(logger, undefined);
        // Wait for auto-init to complete
        await newService.waitForInit();
        // Verify database is not initialized
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
        const newService = new DrizzleService(logger, undefined);
        // Wait for auto-init to complete
        await newService.waitForInit();
        // Verify database is not initialized
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

  describe('Wait for initialization', () => {
    test('should wait for auto-initialization', async () => {
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
        const newService = new DrizzleService(logger, undefined);
        // waitForInit should complete without error even if no DB_URL is set
        await newService.waitForInit();
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
});
