/**
 * DI Injection tests for DrizzleService
 * Tests that client services can properly inject and use DrizzleService
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
} from 'bun:test';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';

import {
  makeMockLoggerLayer,
  createMockConfig,
  BaseService,
  Service,
} from '@onebun/core';
import { LoggerService } from '@onebun/logger';

import { DrizzleModule } from '../src/drizzle.module';
import { DrizzleService } from '../src/drizzle.service';
import { DatabaseType } from '../src/types';

// Test schema
const testUsers = sqliteTable('test_di_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

// Test user service that depends on DrizzleService
@Service()
class UserService extends BaseService {
  constructor(private drizzleService: DrizzleService<DatabaseType.SQLITE>) {
    super();
  }

  async createUser(name: string, email: string) {
    const db = this.drizzleService.getDatabase();

    return db.insert(testUsers).values({ name, email }).returning().get();
  }

  async findAllUsers() {
    const db = this.drizzleService.getDatabase();

    return db.select().from(testUsers).all();
  }

  async findUserById(id: number) {
    const db = this.drizzleService.getDatabase();
    const { eq } = await import('drizzle-orm');

    return db.select().from(testUsers).where(eq(testUsers.id, id)).get();
  }
}

// Another test service for singleton test
@Service()
class AnotherUserService extends BaseService {
  constructor(private drizzleService: DrizzleService<DatabaseType.SQLITE>) {
    super();
  }

  getDrizzleServiceInstance(): DrizzleService<DatabaseType.SQLITE> {
    return this.drizzleService;
  }
}

describe('DrizzleService DI injection', () => {
  let drizzleService: DrizzleService<DatabaseType.SQLITE>;

  beforeEach(async () => {
    DrizzleModule.clearOptions();
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;
    delete process.env.DB_AUTO_MIGRATE;

    // Configure DrizzleModule
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: { url: ':memory:' },
      },
      autoMigrate: false, // We'll create tables manually
    });

    // Create and initialize DrizzleService
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );

    drizzleService = new DrizzleService<DatabaseType.SQLITE>();
    drizzleService.initializeService(logger, createMockConfig());
    await drizzleService.onAsyncInit();

    // Create test table manually
    const sqliteClient = drizzleService.getSQLiteClient();
    sqliteClient!.exec(`
      CREATE TABLE IF NOT EXISTS test_di_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);
  });

  afterEach(async () => {
    if (drizzleService) {
      await drizzleService.close();
    }
    DrizzleModule.clearOptions();
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;
    delete process.env.DB_AUTO_MIGRATE;
  });

  test('client service receives DrizzleService via constructor injection', async () => {
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );

    // Simulate DI by passing drizzleService to constructor
    const userService = new UserService(drizzleService);
    userService.initializeService(logger, createMockConfig());

    // Verify service can use injected DrizzleService
    expect(userService).toBeInstanceOf(UserService);

    const db = drizzleService.getDatabase();
    expect(db).toBeDefined();
  });

  test('service can perform CRUD operations through injected DrizzleService', async () => {
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );

    const userService = new UserService(drizzleService);
    userService.initializeService(logger, createMockConfig());

    // Create
    const newUser = await userService.createUser('John Doe', 'john@example.com');
    expect(newUser).toBeDefined();
    expect(newUser.id).toBeDefined();
    expect(newUser.name).toBe('John Doe');
    expect(newUser.email).toBe('john@example.com');

    // Read
    const foundUser = await userService.findUserById(newUser.id);
    expect(foundUser).toBeDefined();
    expect(foundUser?.name).toBe('John Doe');

    // Create another user
    await userService.createUser('Jane Doe', 'jane@example.com');

    // Read all
    const allUsers = await userService.findAllUsers();
    expect(allUsers.length).toBe(2);
    expect(allUsers.map(u => u.name)).toContain('John Doe');
    expect(allUsers.map(u => u.name)).toContain('Jane Doe');
  });

  test('multiple services can inject same DrizzleService instance (singleton)', async () => {
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );

    // Create two service instances with the same DrizzleService
    const userService1 = new UserService(drizzleService);
    const userService2 = new AnotherUserService(drizzleService);
    userService1.initializeService(logger, createMockConfig());
    userService2.initializeService(logger, createMockConfig());

    // Both should reference the same DrizzleService instance
    const drizzleFromService2 = userService2.getDrizzleServiceInstance();
    expect(drizzleFromService2).toBe(drizzleService);

    // Data created by one service should be visible to the other
    await userService1.createUser('Shared User', 'shared@example.com');
    const allUsers = await userService1.findAllUsers();
    expect(allUsers.length).toBe(1);

    // Verify the database is actually shared (same in-memory DB)
    const db = drizzleFromService2.getDatabase();
    const usersFromDb2 = db.select().from(testUsers).all();
    expect(usersFromDb2.length).toBe(1);
    expect(usersFromDb2[0].name).toBe('Shared User');
  });

  test('DrizzleService is available after DrizzleModule.forRoot() initialization', async () => {
    // Clear and reinitialize
    DrizzleModule.clearOptions();

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

    const newDrizzleService = new DrizzleService<DatabaseType.SQLITE>();
    newDrizzleService.initializeService(logger, createMockConfig());
    await newDrizzleService.onAsyncInit();

    // Module options should be used
    const connectionOptions = newDrizzleService.getConnectionOptions();
    expect(connectionOptions).toBeDefined();
    expect(connectionOptions?.type).toBe(DatabaseType.SQLITE);

    // Database should be accessible
    const db = newDrizzleService.getDatabase();
    expect(db).toBeDefined();

    await newDrizzleService.close();
  });

  test('injected DrizzleService database is ready immediately after onAsyncInit', async () => {
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );

    const userService = new UserService(drizzleService);
    userService.initializeService(logger, createMockConfig());

    // Should be able to use DB immediately (no additional wait needed)
    const db = drizzleService.getDatabase();
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
    expect(typeof db.update).toBe('function');
    expect(typeof db.delete).toBe('function');
  });
});
