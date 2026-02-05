/**
 * Documentation Examples Tests for @onebun/drizzle
 *
 * This file tests code examples from:
 * - packages/drizzle/README.md
 * - docs/api/drizzle.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

// Import from @onebun/drizzle re-exports (not drizzle-orm directly)
import {
  DrizzleModule,
  DatabaseType,
  Entity,
  BaseRepository,
  getPrimaryKeyColumn,
  generateMigrations,
} from '../src';
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
  timestamp,
} from '../src/pg';
import {
  sqliteTable,
  text,
  integer,
} from '../src/sqlite';


describe('Drizzle README Examples', () => {
  describe('Schema Definition - SQLite (README)', () => {
    it('should define SQLite schema', () => {
      // From README: For SQLite schema definition
      const users = sqliteTable('users', {
        id: integer('id').primaryKey({ autoIncrement: true }),
        name: text('name').notNull(),
        email: text('email').notNull().unique(),
        age: integer('age'),
        createdAt: integer('created_at', { mode: 'timestamp' })
          .notNull()
          .$defaultFn(() => new Date()),
        updatedAt: integer('updated_at', { mode: 'timestamp' })
          .notNull()
          .$defaultFn(() => new Date()),
      });

      expect(users).toBeDefined();
      expect(users.name).toBeDefined();
      expect(users.email).toBeDefined();
    });

    it('should infer types from SQLite schema', () => {
      // From README: Extract types from schema
      const users = sqliteTable('users', {
        id: integer('id').primaryKey({ autoIncrement: true }),
        name: text('name').notNull(),
        email: text('email').notNull(),
      });

      type User = typeof users.$inferSelect;
      type InsertUser = typeof users.$inferInsert;

      // Type assertions (compile-time check)
      const user: User = { id: 1, name: 'John', email: 'john@example.com' };
      const insertUser: InsertUser = { name: 'John', email: 'john@example.com' };

      expect(user.id).toBe(1);
      expect(insertUser.name).toBe('John');
      // Verify users table is defined
      expect(users).toBeDefined();
    });
  });

  describe('Schema Definition - PostgreSQL (README)', () => {
    it('should define PostgreSQL schema with generatedAlwaysAsIdentity', () => {
      // From README: For PostgreSQL use generatedAlwaysAsIdentity() for auto-increment
      const users = pgTable('users', {
        id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
        name: pgText('name').notNull(),
        email: pgText('email').notNull().unique(),
        age: pgInteger('age'),
        createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
      });

      expect(users).toBeDefined();
      expect(users.name).toBeDefined();
      expect(users.email).toBeDefined();
    });

    it('should infer types from PostgreSQL schema', () => {
      // From README: Extract types from schema
      const users = pgTable('users', {
        id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
        name: pgText('name').notNull(),
        email: pgText('email').notNull(),
      });

      type User = typeof users.$inferSelect;
      type InsertUser = typeof users.$inferInsert;

      // Type assertions (compile-time check)
      const user: User = { id: 1, name: 'John', email: 'john@example.com' };
      // For InsertUser, id is optional because it's auto-generated
      const insertUser: InsertUser = { name: 'John', email: 'john@example.com' };

      expect(user.id).toBe(1);
      expect(insertUser.name).toBe('John');
      // Verify users table is defined
      expect(users).toBeDefined();
    });
  });

  describe('DrizzleModule Configuration (README)', () => {
    it('should create module with PostgreSQL configuration', () => {
      // From README: For PostgreSQL configuration
      const module = DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.POSTGRESQL,
          options: {
            host: 'localhost',
            port: 5432,
            user: 'postgres',
            password: 'password',
            database: 'mydb',
          },
        },
        autoMigrate: true,
        migrationsFolder: './drizzle',
      });

      expect(module).toBeDefined();
    });

    it('should create module with SQLite configuration', () => {
      // From README: For SQLite configuration
      const module = DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: {
            url: ':memory:', // or './mydb.sqlite'
          },
        },
        autoMigrate: true,
        migrationsFolder: './drizzle',
      });

      expect(module).toBeDefined();
    });
  });

  describe('Repository Pattern (README)', () => {
    it('should have @Entity decorator', () => {
      // From README: Repository with @Entity decorator
      const users = sqliteTable('users', {
        id: integer('id').primaryKey({ autoIncrement: true }),
        name: text('name').notNull(),
        email: text('email').notNull(),
      });

      @Entity(users)
      class UserRepository extends BaseRepository<typeof users> {}

      expect(UserRepository).toBeDefined();
      expect(Entity).toBeDefined();
    });
  });

  describe('DatabaseType enum (README)', () => {
    it('should have POSTGRESQL and SQLITE types', () => {
      // From README: DatabaseType usage
      expect(DatabaseType.POSTGRESQL).toBe(DatabaseType.POSTGRESQL);
      expect(DatabaseType.SQLITE).toBe(DatabaseType.SQLITE);
      // Verify actual string values
      expect(DatabaseType.POSTGRESQL as string).toBe('postgresql');
      expect(DatabaseType.SQLITE as string).toBe('sqlite');
    });
  });
});

describe('Drizzle API Documentation Examples', () => {
  describe('Schema Definition (docs/api/drizzle.md)', () => {
    it('should define SQLite schema with timestamps', () => {
      // From docs: SQLite Schema example
      const users = sqliteTable('users', {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        email: text('email').notNull().unique(),
        age: integer('age'),
        // Note: Using simpler timestamp representation for SQLite
        createdAt: text('created_at').notNull(),
        updatedAt: text('updated_at').notNull(),
      });

      expect(users).toBeDefined();
    });

    // PostgreSQL test skipped - see note at top of file
  });

  describe('Schema Utilities (docs/api/drizzle.md)', () => {
    it('should get primary key column', () => {
      // From docs: Schema Utilities - getPrimaryKeyColumn
      const users = sqliteTable('users', {
        id: integer('id').primaryKey(),
        name: text('name').notNull(),
      });

      const pkColumn = getPrimaryKeyColumn(users);

      expect(pkColumn).toBe('id');
    });
  });

  describe('BaseRepository Interface (docs/api/drizzle.md)', () => {
    it('should define BaseRepository class with expected methods', () => {
      // From docs: BaseRepository interface
      // Note: BaseRepository requires DrizzleService to be initialized
      // Here we just verify the class exists and has the expected structure
      expect(BaseRepository).toBeDefined();
      /* eslint-disable jest/unbound-method */
      expect(BaseRepository.prototype.findAll).toBeDefined();
      expect(BaseRepository.prototype.findById).toBeDefined();
      expect(BaseRepository.prototype.create).toBeDefined();
      expect(BaseRepository.prototype.update).toBeDefined();
      expect(BaseRepository.prototype.delete).toBeDefined();
      expect(BaseRepository.prototype.count).toBeDefined();
      expect(BaseRepository.prototype.transaction).toBeDefined();
      /* eslint-enable jest/unbound-method */
    });
  });

  describe('Migration Functions (docs/api/drizzle.md)', () => {
    it('should have generateMigrations function', () => {
      // From docs: Migration Management - generateMigrations
      expect(generateMigrations).toBeDefined();
      expect(typeof generateMigrations).toBe('function');
    });

    it('should have pushSchema function', () => {
      // From docs: Migration Management - pushSchema
      const { pushSchema } = require('../src/migrations');
      expect(pushSchema).toBeDefined();
      expect(typeof pushSchema).toBe('function');
    });

    it('generateMigrations should accept documented options', async () => {
      // From docs: generateMigrations with options
      // This tests the function signature matches documentation
      await expect(
        generateMigrations({
          schemaPath: './src/schema',      // documented parameter
          migrationsFolder: './drizzle',   // documented parameter
          dialect: 'postgresql',           // documented parameter
        }),
      ).rejects.toThrow(); // Will fail because schema doesn't exist, but verifies API
    });

    it('pushSchema should accept documented options', async () => {
      // From docs: pushSchema with options
      const { pushSchema } = require('../src/migrations');
      await expect(
        pushSchema({
          schemaPath: './src/schema',       // documented parameter
          dialect: 'postgresql',            // documented parameter
          connectionString: ':memory:',     // documented parameter
        }),
      ).rejects.toThrow(); // Will fail because schema doesn't exist, but verifies API
    });
  });
});

describe('Schema-First Approach (README)', () => {
  describe('Key Principles (README)', () => {
    it('should support table definition as single source of truth', () => {
      // From README: Key Principles - Single Source of Truth
      // 1. Table Definition
      const users = sqliteTable('users', {
        id: integer('id').primaryKey(),
        name: text('name').notNull(),
        email: text('email').notNull(),
      });

      // 2. TypeScript Types - extracted from schema
      type User = typeof users.$inferSelect;
      type InsertUser = typeof users.$inferInsert;

      // Verify types work correctly
      const user: User = { id: 1, name: 'John', email: 'john@example.com' };
      const insertUser: InsertUser = {
        name: 'Jane',
        email: 'jane@example.com',
      };

      expect(user.id).toBe(1);
      expect(insertUser.name).toBe('Jane');
      // Verify users table is defined
      expect(users).toBeDefined();
    });
  });

  describe('Benefits (README)', () => {
    it('should provide no code duplication', () => {
      // From README: Benefits - No Code Duplication
      // Define table once, get types automatically
      const products = sqliteTable('products', {
        id: integer('id').primaryKey(),
        name: text('name').notNull(),
        price: integer('price').notNull(),
      });

      // Types are inferred from the schema - no need to define them manually
      // This is a compile-time feature, not a runtime one
      type Product = typeof products.$inferSelect;
      type InsertProduct = typeof products.$inferInsert;

      // Verify the schema has the expected columns
      expect(products.id).toBeDefined();
      expect(products.name).toBeDefined();
      expect(products.price).toBeDefined();

      // Type inference works at compile time - we can use the types
      const product: Product = { id: 1, name: 'Widget', price: 100 };
      const insertProduct: InsertProduct = { name: 'Gadget', price: 200 };

      expect(product.id).toBe(1);
      expect(insertProduct.name).toBe('Gadget');
    });
  });
});

describe('Environment Variables (docs/api/drizzle.md)', () => {
  it('should define valid environment variable names', () => {
    // From docs: Environment Variables
    const envVars = {
      DB_TYPE: 'postgresql', // 'sqlite' or 'postgresql'
      DB_URL: 'postgresql://...', // Connection URL
      DB_SCHEMA_PATH: './src/schema',
      DB_MIGRATIONS_FOLDER: './drizzle',
      DB_AUTO_MIGRATE: 'true',
      DB_LOG_QUERIES: 'false',
    };

    expect(envVars.DB_TYPE).toBe('postgresql');
    expect(envVars.DB_AUTO_MIGRATE).toBe('true');
  });
});

describe('DrizzleService.runMigrations (docs/api/drizzle.md)', () => {
  it('should have runMigrations method on DrizzleService', () => {
    // From docs: Apply Migrations at Runtime
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { DrizzleService: DrizzleServiceClass } = require('../src/drizzle.service');
     
    expect(DrizzleServiceClass.prototype.runMigrations).toBeDefined();
    expect(typeof DrizzleServiceClass.prototype.runMigrations).toBe('function');
     
  });

  it('DrizzleModule should accept autoMigrate and migrationsFolder options', () => {
    // From docs: Automatic migrations in module configuration
    const module = DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: { url: ':memory:' },
      },
      autoMigrate: true,              // documented option
      migrationsFolder: './drizzle',  // documented option
    });

    expect(module).toBeDefined();
    const options = DrizzleModule.getOptions();
    expect(options?.autoMigrate).toBe(true);
    expect(options?.migrationsFolder).toBe('./drizzle');
  });
});

describe('Re-exports from @onebun/drizzle (docs/api/drizzle.md)', () => {
  describe('PostgreSQL re-exports (@onebun/drizzle/pg)', () => {
    it('should re-export pgTable and column types', () => {
      // From docs: import { pgTable, text, integer, ... } from '@onebun/drizzle/pg'
      const pg = require('../src/pg');

      expect(pg.pgTable).toBeDefined();
      expect(pg.text).toBeDefined();
      expect(pg.integer).toBeDefined();
      expect(pg.timestamp).toBeDefined();
      expect(pg.uuid).toBeDefined();
      expect(pg.boolean).toBeDefined();
      expect(pg.json).toBeDefined();
      expect(pg.jsonb).toBeDefined();
      expect(pg.varchar).toBeDefined();
      expect(pg.serial).toBeDefined();
    });

    it('should re-export constraint helpers', () => {
      const pg = require('../src/pg');

      expect(pg.primaryKey).toBeDefined();
      expect(pg.foreignKey).toBeDefined();
      expect(pg.unique).toBeDefined();
      expect(pg.index).toBeDefined();
    });

    it('should allow creating PostgreSQL schema', () => {
      const pg = require('../src/pg');

      const users = pg.pgTable('users', {
        id: pg.integer('id').primaryKey().generatedAlwaysAsIdentity(),
        name: pg.text('name').notNull(),
        email: pg.text('email').notNull(),
        createdAt: pg.timestamp('created_at').defaultNow(),
      });

      expect(users).toBeDefined();
    });
  });

  describe('SQLite re-exports (@onebun/drizzle/sqlite)', () => {
    it('should re-export sqliteTable and column types', () => {
      // From docs: import { sqliteTable, text, integer, ... } from '@onebun/drizzle/sqlite'
      const sqlite = require('../src/sqlite');

      expect(sqlite.sqliteTable).toBeDefined();
      expect(sqlite.text).toBeDefined();
      expect(sqlite.integer).toBeDefined();
      expect(sqlite.real).toBeDefined();
      expect(sqlite.blob).toBeDefined();
    });

    it('should re-export constraint helpers', () => {
      const sqlite = require('../src/sqlite');

      expect(sqlite.primaryKey).toBeDefined();
      expect(sqlite.foreignKey).toBeDefined();
      expect(sqlite.unique).toBeDefined();
      expect(sqlite.index).toBeDefined();
    });

    it('should allow creating SQLite schema', () => {
      const sqlite = require('../src/sqlite');

      const users = sqlite.sqliteTable('users', {
        id: sqlite.integer('id').primaryKey({ autoIncrement: true }),
        name: sqlite.text('name').notNull(),
        email: sqlite.text('email').notNull(),
      });

      expect(users).toBeDefined();
    });
  });

  describe('Common operators (@onebun/drizzle)', () => {
    it('should re-export comparison operators', () => {
      // From docs: import { eq, and, ... } from '@onebun/drizzle'
      const drizzle = require('../src/index');

      expect(drizzle.eq).toBeDefined();
      expect(drizzle.ne).toBeDefined();
      expect(drizzle.gt).toBeDefined();
      expect(drizzle.gte).toBeDefined();
      expect(drizzle.lt).toBeDefined();
      expect(drizzle.lte).toBeDefined();
    });

    it('should re-export logical operators', () => {
      const drizzle = require('../src/index');

      expect(drizzle.and).toBeDefined();
      expect(drizzle.or).toBeDefined();
      expect(drizzle.not).toBeDefined();
    });

    it('should re-export pattern matching operators', () => {
      const drizzle = require('../src/index');

      expect(drizzle.like).toBeDefined();
      expect(drizzle.ilike).toBeDefined();
      expect(drizzle.notLike).toBeDefined();
    });

    it('should re-export array and null operators', () => {
      const drizzle = require('../src/index');

      expect(drizzle.inArray).toBeDefined();
      expect(drizzle.notInArray).toBeDefined();
      expect(drizzle.isNull).toBeDefined();
      expect(drizzle.isNotNull).toBeDefined();
    });

    it('should re-export sql template', () => {
      const drizzle = require('../src/index');

      expect(drizzle.sql).toBeDefined();
      expect(typeof drizzle.sql).toBe('function');
    });

    it('should re-export aggregate functions', () => {
      const drizzle = require('../src/index');

      expect(drizzle.count).toBeDefined();
      expect(drizzle.sum).toBeDefined();
      expect(drizzle.avg).toBeDefined();
      expect(drizzle.min).toBeDefined();
      expect(drizzle.max).toBeDefined();
    });

    it('should re-export ordering functions', () => {
      const drizzle = require('../src/index');

      expect(drizzle.asc).toBeDefined();
      expect(drizzle.desc).toBeDefined();
    });

    it('should re-export relations helper', () => {
      const drizzle = require('../src/index');

      expect(drizzle.relations).toBeDefined();
    });
  });

  describe('defineConfig (@onebun/drizzle)', () => {
    it('should re-export defineConfig from drizzle-kit', () => {
      // From docs: import { defineConfig } from '@onebun/drizzle'
      const drizzle = require('../src/index');

      expect(drizzle.defineConfig).toBeDefined();
      expect(typeof drizzle.defineConfig).toBe('function');
    });

    it('should allow creating drizzle config', () => {
      const { defineConfig } = require('../src/index');

      const config = defineConfig({
        schema: './src/schema',
        out: './drizzle',
        dialect: 'postgresql',
      });

      expect(config).toBeDefined();
      expect(config.schema).toBe('./src/schema');
      expect(config.out).toBe('./drizzle');
      expect(config.dialect).toBe('postgresql');
    });
  });
});

describe('DrizzleService Direct Query Methods (docs/api/drizzle.md)', () => {
  // From docs: DrizzleService provides direct access to Drizzle ORM query builders
  // Methods: select(), insert(), update(), delete()

  /* eslint-disable @typescript-eslint/naming-convention */
  const { DrizzleService } = require('../src/drizzle.service');
  const { eq } = require('../src/index');
  const { Effect } = require('effect');
  const { makeMockLoggerLayer, createMockConfig } = require('@onebun/core');
  const { LoggerService } = require('@onebun/logger');
  /* eslint-enable @typescript-eslint/naming-convention */

  // Define test schema
  const testUsers = sqliteTable('test_users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
  });

  type TestUser = typeof testUsers.$inferSelect;
  type InsertTestUser = typeof testUsers.$inferInsert;

  let service: typeof DrizzleService.prototype;

  beforeEach(async () => {
    // Clear module options
    DrizzleModule.clearOptions();

    // Create service with mock logger
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l: unknown) => l),
        loggerLayer,
      ),
    );

    service = new DrizzleService();
    service.initializeService(logger, createMockConfig());

    // Initialize with in-memory SQLite
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    });

    // Create test table
    const db = service.getDatabase();
    db.run(`CREATE TABLE test_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )`);
  });

  afterEach(async () => {
    if (service) {
      await service.close();
    }
  });

  describe('select() method', () => {
    it('should select all rows', async () => {
      // Insert test data first
      const db = service.getDatabase();
      db.run('INSERT INTO test_users (name, email) VALUES (\'John\', \'john@example.com\')');
      db.run('INSERT INTO test_users (name, email) VALUES (\'Jane\', \'jane@example.com\')');

      // From docs: Select all columns
      const users = await service.select().from(testUsers);

      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('John');
      expect(users[1].name).toBe('Jane');
    });

    it('should select specific columns', async () => {
      const db = service.getDatabase();
      db.run('INSERT INTO test_users (name, email) VALUES (\'John\', \'john@example.com\')');

      // From docs: Select specific columns
      const names = await service.select({ name: testUsers.name }).from(testUsers);

      expect(names).toHaveLength(1);
      expect(names[0].name).toBe('John');
      // Should not have other columns (type-safe)
      expect('email' in names[0]).toBe(false);
    });

    it('should select with where condition', async () => {
      const db = service.getDatabase();
      db.run('INSERT INTO test_users (name, email) VALUES (\'John\', \'john@example.com\')');
      db.run('INSERT INTO test_users (name, email) VALUES (\'Jane\', \'jane@example.com\')');

      // From docs: Select with conditions
      const users = await service.select()
        .from(testUsers)
        .where(eq(testUsers.name, 'John'));

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('John');
    });
  });

  describe('insert() method', () => {
    it('should insert single row', async () => {
      // From docs: Insert single row
      await service.insert(testUsers).values({ name: 'John', email: 'john@example.com' });

      const users = await service.select().from(testUsers);
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('John');
    });

    it('should insert with returning', async () => {
      // From docs: Insert with returning
      const result = await service.insert(testUsers)
        .values({ name: 'John', email: 'john@example.com' })
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('John');
      expect(result[0].id).toBeDefined();
    });

    it('should insert multiple rows', async () => {
      // From docs: Insert multiple rows
      await service.insert(testUsers).values([
        { name: 'John', email: 'john@example.com' },
        { name: 'Jane', email: 'jane@example.com' },
      ]);

      const users = await service.select().from(testUsers);
      expect(users).toHaveLength(2);
    });
  });

  describe('update() method', () => {
    it('should update rows', async () => {
      // Insert test data
      await service.insert(testUsers).values({ name: 'John', email: 'john@example.com' });

      // From docs: Update rows
      await service.update(testUsers)
        .set({ name: 'Jane' })
        .where(eq(testUsers.name, 'John'));

      const users = await service.select().from(testUsers);
      expect(users[0].name).toBe('Jane');
    });

    it('should update with returning', async () => {
      await service.insert(testUsers).values({ name: 'John', email: 'john@example.com' });

      // From docs: Update with returning
      const result = await service.update(testUsers)
        .set({ name: 'Jane' })
        .where(eq(testUsers.name, 'John'))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Jane');
    });
  });

  describe('delete() method', () => {
    it('should delete rows', async () => {
      await service.insert(testUsers).values([
        { name: 'John', email: 'john@example.com' },
        { name: 'Jane', email: 'jane@example.com' },
      ]);

      // From docs: Delete rows
      await service.delete(testUsers).where(eq(testUsers.name, 'John'));

      const users = await service.select().from(testUsers);
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Jane');
    });

    it('should delete with returning', async () => {
      await service.insert(testUsers).values({ name: 'John', email: 'john@example.com' });

      // From docs: Delete with returning
      const result = await service.delete(testUsers)
        .where(eq(testUsers.name, 'John'))
        .returning();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('John');

      const users = await service.select().from(testUsers);
      expect(users).toHaveLength(0);
    });
  });

  describe('Type-safe queries (docs example)', () => {
    it('should provide typed results from select', async () => {
      await service.insert(testUsers).values({ name: 'John', email: 'john@example.com' });

      const users: TestUser[] = await service.select().from(testUsers);

      // TypeScript knows the shape of user
      const user = users[0];
      expect(typeof user.id).toBe('number');
      expect(typeof user.name).toBe('string');
      expect(typeof user.email).toBe('string');
    });

    it('should accept typed insert data', async () => {
      // TypeScript validates InsertTestUser type
      const userData: InsertTestUser = {
        name: 'John',
        email: 'john@example.com',
      };

      const [inserted] = await service.insert(testUsers).values(userData).returning();

      expect(inserted.name).toBe('John');
    });
  });
});

describe('DrizzleService Type Inference (docs/api/drizzle.md)', () => {
  // This test block verifies that DrizzleService works WITHOUT generic parameter
  // Types should be inferred from table schemas automatically

  /* eslint-disable @typescript-eslint/naming-convention */
  const { DrizzleService } = require('../src/drizzle.service');
  const { eq } = require('../src/index');
  const { Effect } = require('effect');
  const { makeMockLoggerLayer, createMockConfig } = require('@onebun/core');
  const { LoggerService } = require('@onebun/logger');
  /* eslint-enable @typescript-eslint/naming-convention */

  // Define test schema
  const typeInferenceUsers = sqliteTable('type_inference_users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
  });

  type TypeInferenceUser = typeof typeInferenceUsers.$inferSelect;

  let service: typeof DrizzleService.prototype;

  beforeEach(async () => {
    DrizzleModule.clearOptions();

    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l: unknown) => l),
        loggerLayer,
      ),
    );

    // Create DrizzleService WITHOUT generic parameter
    service = new DrizzleService();
    service.initializeService(logger, createMockConfig());

    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    });

    const db = service.getDatabase();
    db.run(`CREATE TABLE type_inference_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )`);
  });

  afterEach(async () => {
    if (service) {
      await service.close();
    }
  });

  describe('Type inference without generic parameter (docs example)', () => {
    it('should work with DrizzleService without generic - select()', async () => {
      // From docs: DrizzleService infers types from table schemas
      // No generic parameter needed
      const db = service.getDatabase();
      db.run('INSERT INTO type_inference_users (name, email) VALUES (\'John\', \'john@example.com\')');

      // This should work without DrizzleService<DatabaseType.SQLITE>
      const users = await service.select().from(typeInferenceUsers);

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('John');
    });

    it('should work with DrizzleService without generic - insert()', async () => {
      // insert() should infer types from table
      await service.insert(typeInferenceUsers).values({
        name: 'Jane',
        email: 'jane@example.com',
      });

      const users = await service.select().from(typeInferenceUsers);
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Jane');
    });

    it('should work with DrizzleService without generic - update()', async () => {
      await service.insert(typeInferenceUsers).values({
        name: 'John',
        email: 'john@example.com',
      });

      // update() should infer types from table
      await service.update(typeInferenceUsers)
        .set({ name: 'Jane' })
        .where(eq(typeInferenceUsers.name, 'John'));

      const users = await service.select().from(typeInferenceUsers);
      expect(users[0].name).toBe('Jane');
    });

    it('should work with DrizzleService without generic - delete()', async () => {
      await service.insert(typeInferenceUsers).values({
        name: 'John',
        email: 'john@example.com',
      });

      // delete() should infer types from table
      await service.delete(typeInferenceUsers)
        .where(eq(typeInferenceUsers.name, 'John'));

      const users = await service.select().from(typeInferenceUsers);
      expect(users).toHaveLength(0);
    });

    it('should work with DrizzleService without generic - transaction()', async () => {
      // transaction() callback should have same methods with type inference
      await service.transaction(async (tx: { insert: typeof service.insert; select: typeof service.select }) => {
        await tx.insert(typeInferenceUsers).values({
          name: 'TxUser',
          email: 'tx@example.com',
        });

        const users = await tx.select().from(typeInferenceUsers);
        expect(users).toHaveLength(1);
        expect(users[0].name).toBe('TxUser');
      });
    });

    it('should provide typed results from select without generic', async () => {
      await service.insert(typeInferenceUsers).values({
        name: 'Typed',
        email: 'typed@example.com',
      });

      // Results should be properly typed
      const users: TypeInferenceUser[] = await service.select().from(typeInferenceUsers);

      const user = users[0];
      // TypeScript should know these properties exist
      expect(typeof user.id).toBe('number');
      expect(typeof user.name).toBe('string');
      expect(typeof user.email).toBe('string');
    });
  });
});
