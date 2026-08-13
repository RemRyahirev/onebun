/**
 * Documentation Examples Tests for @onebun/drizzle
 *
 * @source docs:api/drizzle.md
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

// Import from @onebun/drizzle re-exports (not drizzle-orm directly)
import type { PostgreSQLConnectionOptions } from '../src/types';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Global,
  getConstructorParamTypes,
  getInjectToken,
  Inject,
  isGlobalModule,
  Module,
  OneBunApplication,
  resetRegistrations,
  Service as ServiceDecorator,
} from '@onebun/core';

import {
  DrizzleModule,
  DrizzleService as DrizzleServiceCtor,
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

const migrationsFixture = join(__dirname, 'test-migrations');


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
  /**
   * @source docs:api/drizzle.md#schema-definition
   */
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

  /**
   * @source docs:api/drizzle.md#baserepository
   */
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

  /**
   * @source docs:api/drizzle.md#migrations
   */
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

    /**
     * @source docs:api/drizzle.md#postgresql-connection
     */
    it('accepts either connection shape and refuses a mix', async () => {
      // From docs: "either a connectionString or the five discrete fields — never a mix"
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleService: Service } = require('../src/drizzle.service');

      const urlForm: PostgreSQLConnectionOptions = {
        connectionString: 'postgresql://user:password@host:5432/database',
      };
      const discreteForm: PostgreSQLConnectionOptions = {
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'secret',
        database: 'app',
      };

      expect(urlForm.connectionString).toBeDefined();
      expect(discreteForm.host).toBeDefined();

      // A mix is a compile error; from an untyped source it is a runtime one.
      await expect(new Service().initialize({
        type: DatabaseType.POSTGRESQL,
        options: { connectionString: 'postgresql://u:p@h:5432/d', host: 'other' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)).rejects.toThrow(/both connectionString and discrete field/);
    });

    /**
     * @source docs:api/drizzle.md#one-journal-per-migration-set
     */
    it('gives each migration set its own journal, as the docs show', async () => {
      // From docs: "One Journal Per Migration Set" — the application's set on the default
      // journal, a package's set on its own. Both folders here are the same fixture; what
      // the example is about is the journal, not the contents.
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleService: Service } = require('../src/drizzle.service');
      const service = new Service();
      await service.initialize({
        type: DatabaseType.SQLITE,
        options: { url: ':memory:' },
      });

      try {
        await service.runMigrations({ migrationsFolder: migrationsFixture });
        await service.runMigrations({
          migrationsFolder: migrationsFixture,
          migrationsTable: '__drizzle_migrations_durable',
        });

        const client = service.getSQLiteClient()!;
        const tables = client.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__drizzle_migrations%'",
        ).all() as Array<{ name: string }>;

        expect(tables.map(t => t.name).sort()).toEqual([
          '__drizzle_migrations',
          '__drizzle_migrations_durable',
        ]);
      } finally {
        await service.close();
      }
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
  const { createTestService } = require('@onebun/core/testing');
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
    const { instance } = createTestService(DrizzleService);
    service = instance;

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

describe('DrizzleService returning() Type Inference', () => {
  // This test block verifies that returning() returns properly typed results
  // These tests catch the bug where returning() returned { [x: string]: any }
  // instead of the proper table type

  /* eslint-disable @typescript-eslint/naming-convention */
  const { DrizzleService } = require('../src/drizzle.service');
  const { eq } = require('../src/index');
  const { createTestService } = require('@onebun/core/testing');
  /* eslint-enable @typescript-eslint/naming-convention */

  // Define test schema with multiple columns to ensure proper type inference
  const returningTestUsers = sqliteTable('returning_test_users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    age: integer('age'),
  });

  // These types are used for compile-time type checking
  // If returning() types are wrong, TypeScript will fail to compile these assignments
  type ReturningTestUser = typeof returningTestUsers.$inferSelect;
  type InsertReturningTestUser = typeof returningTestUsers.$inferInsert;

  let service: typeof DrizzleService.prototype;

  beforeEach(async () => {
    DrizzleModule.clearOptions();

    const { instance } = createTestService(DrizzleService);
    service = instance;

    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    });

    const db = service.getDatabase();
    db.run(`CREATE TABLE returning_test_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER
    )`);
  });

  afterEach(async () => {
    if (service) {
      await service.close();
    }
  });

  describe('select().from() type inference', () => {
    it('should return properly typed result from select().from()', async () => {
      // Insert test data
      const db = service.getDatabase();
      db.run("INSERT INTO returning_test_users (name, email, age) VALUES ('John', 'john@example.com', 30)");

      const result = await service.select().from(returningTestUsers);

      // COMPILE-TIME TYPE CHECK:
      // This assignment would fail if result[0] is not properly typed
      const selectedUser: ReturningTestUser = result[0];

      // Runtime assertions
      expect(selectedUser.id).toBeDefined();
      expect(selectedUser.name).toBe('John');
      expect(selectedUser.email).toBe('john@example.com');
      expect(selectedUser.age).toBe(30);
    });

    it('should allow accessing typed properties from select() without type assertion', async () => {
      const db = service.getDatabase();
      db.run("INSERT INTO returning_test_users (name, email) VALUES ('Jane', 'jane@example.com')");

      const [user] = await service.select().from(returningTestUsers);

      // COMPILE-TIME TYPE CHECK:
      // These property accesses would fail if user is not properly typed
      const id: number = user.id;
      const name: string = user.name;
      const email: string = user.email;
      const age: number | null = user.age;

      expect(typeof id).toBe('number');
      expect(typeof name).toBe('string');
      expect(typeof email).toBe('string');
      expect(age).toBeNull();
    });

    it('should return properly typed result from select() with specific columns', async () => {
      const db = service.getDatabase();
      db.run("INSERT INTO returning_test_users (name, email, age) VALUES ('Bob', 'bob@example.com', 25)");

      const result = await service.select({
        userName: returningTestUsers.name,
        userEmail: returningTestUsers.email,
      }).from(returningTestUsers);

      // COMPILE-TIME TYPE CHECK:
      // The result should have the custom field names with correct types
      const selectedFields: { userName: string; userEmail: string } = result[0];

      expect(selectedFields.userName).toBe('Bob');
      expect(selectedFields.userEmail).toBe('bob@example.com');
      // Should NOT have other properties (type-safe)
      expect('id' in result[0]).toBe(false);
      expect('age' in result[0]).toBe(false);
    });

    it('should return properly typed result from selectDistinct()', async () => {
      const db = service.getDatabase();
      db.run("INSERT INTO returning_test_users (name, email) VALUES ('Alice', 'alice@example.com')");
      db.run("INSERT INTO returning_test_users (name, email) VALUES ('Alice', 'alice2@example.com')");

      const result = await service.selectDistinct({ name: returningTestUsers.name })
        .from(returningTestUsers);

      // COMPILE-TIME TYPE CHECK:
      const distinctName: { name: string } = result[0];

      expect(distinctName.name).toBe('Alice');
    });
  });

  describe('insert().returning() type inference', () => {
    it('should return properly typed result from insert().returning()', async () => {
      const insertData: InsertReturningTestUser = {
        name: 'John',
        email: 'john@example.com',
        age: 30,
      };

      const result = await service.insert(returningTestUsers)
        .values(insertData)
        .returning();

      // COMPILE-TIME TYPE CHECK:
      // This assignment would fail if result[0] is { [x: string]: any }
      // because it wouldn't be assignable to ReturningTestUser
      const insertedUser: ReturningTestUser = result[0];

      // Runtime assertions
      expect(insertedUser.id).toBeDefined();
      expect(insertedUser.name).toBe('John');
      expect(insertedUser.email).toBe('john@example.com');
      expect(insertedUser.age).toBe(30);
    });

    it('should allow accessing typed properties without type assertion', async () => {
      const [user] = await service.insert(returningTestUsers)
        .values({ name: 'Jane', email: 'jane@example.com' })
        .returning();

      // COMPILE-TIME TYPE CHECK:
      // These property accesses would fail if user is { [x: string]: any }
      // because TypeScript wouldn't know these properties exist
      const id: number = user.id;
      const name: string = user.name;
      const email: string = user.email;
      const age: number | null = user.age;

      expect(typeof id).toBe('number');
      expect(typeof name).toBe('string');
      expect(typeof email).toBe('string');
      expect(age).toBeNull();
    });
  });

  describe('update().returning() type inference', () => {
    it('should return properly typed result from update().returning()', async () => {
      // Insert test data
      await service.insert(returningTestUsers)
        .values({ name: 'Original', email: 'original@example.com', age: 25 });

      const result = await service.update(returningTestUsers)
        .set({ name: 'Updated' })
        .where(eq(returningTestUsers.email, 'original@example.com'))
        .returning();

      // COMPILE-TIME TYPE CHECK:
      // This assignment would fail if result[0] is { [x: string]: any }
      const updatedUser: ReturningTestUser = result[0];

      expect(updatedUser.id).toBeDefined();
      expect(updatedUser.name).toBe('Updated');
      expect(updatedUser.email).toBe('original@example.com');
      expect(updatedUser.age).toBe(25);
    });

    it('should allow accessing typed properties from update().returning()', async () => {
      await service.insert(returningTestUsers)
        .values({ name: 'Test', email: 'test@example.com', age: 20 });

      const [user] = await service.update(returningTestUsers)
        .set({ age: 21 })
        .where(eq(returningTestUsers.name, 'Test'))
        .returning();

      // COMPILE-TIME TYPE CHECK:
      // Direct property access with explicit types
      const id: number = user.id;
      const name: string = user.name;
      const email: string = user.email;
      const age: number | null = user.age;

      expect(id).toBeGreaterThan(0);
      expect(name).toBe('Test');
      expect(email).toBe('test@example.com');
      expect(age).toBe(21);
    });
  });

  describe('delete().returning() type inference', () => {
    it('should return properly typed result from delete().returning()', async () => {
      await service.insert(returningTestUsers)
        .values({ name: 'ToDelete', email: 'delete@example.com', age: 40 });

      const result = await service.delete(returningTestUsers)
        .where(eq(returningTestUsers.name, 'ToDelete'))
        .returning();

      // COMPILE-TIME TYPE CHECK:
      // This assignment would fail if result[0] is { [x: string]: any }
      const deletedUser: ReturningTestUser = result[0];

      expect(deletedUser.id).toBeDefined();
      expect(deletedUser.name).toBe('ToDelete');
      expect(deletedUser.email).toBe('delete@example.com');
      expect(deletedUser.age).toBe(40);
    });

    it('should allow accessing typed properties from delete().returning()', async () => {
      await service.insert(returningTestUsers)
        .values({ name: 'Remove', email: 'remove@example.com' });

      const [user] = await service.delete(returningTestUsers)
        .where(eq(returningTestUsers.email, 'remove@example.com'))
        .returning();

      // COMPILE-TIME TYPE CHECK:
      const id: number = user.id;
      const name: string = user.name;
      const email: string = user.email;
      const age: number | null = user.age;

      expect(typeof id).toBe('number');
      expect(name).toBe('Remove');
      expect(email).toBe('remove@example.com');
      expect(age).toBeNull();
    });
  });

  describe('transaction returning() type inference', () => {
    it('should return properly typed results from transaction operations', async () => {
      await service.transaction(async (tx: {
        insert: typeof service.insert;
        update: typeof service.update;
        delete: typeof service.delete;
      }) => {
        // Insert with returning in transaction
        const [inserted] = await tx.insert(returningTestUsers)
          .values({ name: 'TxUser', email: 'tx@example.com', age: 35 })
          .returning();

        // COMPILE-TIME TYPE CHECK:
        const insertedUser: ReturningTestUser = inserted;
        expect(insertedUser.name).toBe('TxUser');

        // Update with returning in transaction
        const [updated] = await tx.update(returningTestUsers)
          .set({ age: 36 })
          .where(eq(returningTestUsers.id, inserted.id))
          .returning();

        // COMPILE-TIME TYPE CHECK:
        const updatedUser: ReturningTestUser = updated;
        expect(updatedUser.age).toBe(36);

        // Delete with returning in transaction
        const [deleted] = await tx.delete(returningTestUsers)
          .where(eq(returningTestUsers.id, inserted.id))
          .returning();

        // COMPILE-TIME TYPE CHECK:
        const deletedUser: ReturningTestUser = deleted;
        expect(deletedUser.name).toBe('TxUser');
      });
    });
  });
});

describe('DrizzleService Type Inference (docs/api/drizzle.md)', () => {
  // This test block verifies that DrizzleService works WITHOUT generic parameter
  // Types should be inferred from table schemas automatically

  /* eslint-disable @typescript-eslint/naming-convention */
  const { DrizzleService } = require('../src/drizzle.service');
  const { eq } = require('../src/index');
  const { createTestService } = require('@onebun/core/testing');
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

    // Create DrizzleService WITHOUT generic parameter
    const { instance } = createTestService(DrizzleService);
    service = instance;

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

/**
 * The documentation used to present two `forRoot()` calls as a way to reach two databases.
 * It never worked: `forRoot()` stores its options on the module CLASS, so every instance
 * reads the same last-written configuration and every analytics write landed in the main
 * database. The page now says so; this pins the behaviour it describes, so that changing it
 * has to be a deliberate edit here.
 */
describe('Non-Global Mode (docs/api/drizzle.md)', () => {
  /**
   * @source docs:api/drizzle.md#non-global-mode
   */
  it('gives separate instances that nevertheless share ONE configuration', () => {
    const first = DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      autoMigrate: false,
      isGlobal: false,
    });

    const second = DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: '/tmp/onebun-docs-second.db' } },
      autoMigrate: false,
      isGlobal: false,
    });

    try {
      // Both calls return the same module class, which is why the options collapse.
      expect(first).toBe(second);

      // From docs: "every instance reads the same — last-written — configuration".
      const options = DrizzleModule.getOptions();
      expect(options?.connection.options).toEqual({ url: '/tmp/onebun-docs-second.db' });
    } finally {
      DrizzleModule.clearOptions();
    }
  });

  /**
   * @source docs:api/drizzle.md#forfeature-method
   */
  /**
   * @source docs:api/drizzle.md#forfeature-method
   */
  it('restores globality when a later unnamed forRoot() does not opt out', () => {
    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      autoMigrate: false,
      isGlobal: false,
    });
    expect(isGlobalModule(DrizzleModule)).toBe(false);

    try {
      // From docs: the mutation is symmetric. Without this, one isGlobal:false anywhere in
      // the process silently de-globalized every later forRoot() too. Symmetric is NOT
      // isolation — the docs now say last-writer-wins, and the assertion below is exactly
      // that: the LAST forRoot() decides, for every application in the process.
      DrizzleModule.forRoot({
        connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
        autoMigrate: false,
      });
      expect(isGlobalModule(DrizzleModule)).toBe(true);
    } finally {
      DrizzleModule.clearOptions();
    }
  });

  it('forFeature() returns the module class, so it does not hand back a shared instance', () => {
    // From docs: forFeature() "is an ordinary import and does NOT share the root's instance".
    expect(DrizzleModule.forFeature()).toBe(DrizzleModule);
  });
});

/**
 * An UNNAMED forRoot() still has one options slot per process — that has not changed, and
 * the page still says so. What changed is that it is no longer the only shape available:
 * `forRoot({ as: TOKEN })` gives each configuration its own slot. Pinned so the unnamed
 * path cannot silently acquire per-application behaviour it does not have.
 */
describe('one configuration per process, unnamed (docs/api/drizzle.md)', () => {
  /**
   * @source docs:api/drizzle.md#non-global-mode
   */
  it('a second forRoot anywhere in the process replaces the first for everyone', () => {
    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: '/tmp/onebun-app-a.db' } },
      autoMigrate: false,
    });
    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: '/tmp/onebun-app-b.db' } },
      autoMigrate: false,
    });

    try {
      // There is one options slot per module CLASS, which every application in the process
      // shares — so "one database per application" is not reachable through forRoot().
      expect(DrizzleModule.getOptions()?.connection.options).toEqual({ url: '/tmp/onebun-app-b.db' });
    } finally {
      DrizzleModule.clearOptions();
    }
  });
});

/**
 * Two claims the corrected page makes about what DOES work. Both were added after an
 * independent audit found the first draft denied them — accuracy, not pessimism, was the
 * point of the correction.
 */
describe('what the corrected page says still works (docs/api/drizzle.md)', () => {
  /**
   * @source docs:api/drizzle.md#non-global-mode
   */
  it('a manually built DrizzleService reaches a different database than the module-configured one', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'onebun-docs-manual-'));
    const moduleDb = join(scratch, 'module.db');
    const manualDb = join(scratch, 'manual.db');

    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: moduleDb } },
      autoMigrate: false,
    });

    try {
      // From docs: "new DrizzleService() followed by initialize(connection) takes its
      // options directly and is unaffected by the shared slot".
      const manual = new DrizzleServiceCtor();
      await manual.initialize({ type: DatabaseType.SQLITE, options: { url: manualDb } });

      // Asserted on the resolved connection TARGET, not on instance identity: two instances
      // pointing at one database is exactly the defect this page documents, and an identity
      // assertion passes for it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resolved = (manual as any).connectionOptions as { options?: { url?: string } } | null;
      expect(resolved?.options?.url).toBe(manualDb);

      // The module's own options are untouched, and the manual instance did not read them.
      expect(DrizzleModule.getOptions()?.connection.options).toEqual({ url: moduleDb });

      await manual.close?.();
    } finally {
      DrizzleModule.clearOptions();
    }
  });

  /**
   * @source docs:api/drizzle.md#forfeature-method
   */
  it('a @Global() module re-exporting the service shares ONE instance with modules that import neither', () => {
    // From docs: the re-exported instance "then reaches modules that import neither".
    // Pinned at the metadata level: a module class listing a SERVICE in exports is valid,
    // which is what makes the documented bridge legal (listing a MODULE there throws).
    @Global()
    @Module({ imports: [DrizzleModule.forFeature()], exports: [DrizzleServiceCtor] })
    class DatabaseBridge {}

    expect(isGlobalModule(DatabaseBridge)).toBe(true);
  });
});

describe('Connection Lifecycle (docs/api/drizzle.md)', () => {
  /**
   * @source docs:api/drizzle.md#connection-lifecycle
   */
  it('closes the connection when the application stops', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'onebun-docs-lifecycle-'));

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({
      imports: [
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.SQLITE, options: { url: join(scratch, 'lifecycle.db') } },
          autoMigrate: false,
        }),
      ],
      controllers: [HealthController],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const service = app.getService(DrizzleServiceCtor);
      expect(service.getSQLiteClient()).not.toBeNull();

      await app.stop();

      // From docs: "the client is closed and the service reports no connection".
      expect(service.getSQLiteClient()).toBeNull();
      expect(service.getConnectionOptions()).toBeNull();
    } finally {
      DrizzleModule.clearOptions();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

/**
 * @source docs:api/drizzle.md#multiple-databases
 */
describe('Multiple databases (docs/api/drizzle.md)', () => {
  afterEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  it('names each configuration with `as` and selects it with forFeature', () => {
    const MAIN_DB = Symbol('MAIN_DB');
    const ANALYTICS_DB = Symbol('ANALYTICS_DB');

    // From docs: two registrations, each with its own configuration.
    const main = DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: '/tmp/onebun-docs-main.db' } },
      autoMigrate: false,
      as: MAIN_DB,
    });
    const analytics = DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: '/tmp/onebun-docs-analytics.db' } },
      autoMigrate: false,
      as: ANALYTICS_DB,
    });

    // Distinct module identities, and forFeature selects them by token. The end-to-end
    // assertion that they reach DIFFERENT databases lives in registration.test.ts.
    expect(main).not.toBe(analytics);
    expect(DrizzleModule.forFeature(ANALYTICS_DB)).toBe(analytics);
    expect(DrizzleModule.forFeature(MAIN_DB)).toBe(main);
  });

  it('names the registration with @Inject in a module that holds BOTH', () => {
    const mainDb = Symbol('MAIN_DB');
    const analyticsDb = Symbol('ANALYTICS_DB');

    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      autoMigrate: false,
      as: mainDb,
    });
    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      autoMigrate: false,
      as: analyticsDb,
    });

    // From docs: the module that needs both imports both and names each one. Pinned here at
    // the metadata level — that the two parameters reach two DIFFERENT databases through a
    // real boot, and that an un-annotated parameter still resolves, is registration.test.ts.
    @ServiceDecorator()
    class Reconciler extends BaseService {
      constructor(
        @Inject(mainDb) public main: DrizzleServiceCtor,
        @Inject(analyticsDb) public analytics: DrizzleServiceCtor,
      ) {
        super();
      }
    }

    expect(getInjectToken(Reconciler, 0)).toBe(mainDb);
    expect(getInjectToken(Reconciler, 1)).toBe(analyticsDb);
    // The token map is a SIDE map: design:paramtypes is untouched, so partial injection and
    // every other paramtypes reader keep working.
    expect(getConstructorParamTypes(Reconciler)).toEqual([DrizzleServiceCtor, DrizzleServiceCtor]);
  });

  it('refuses to register one token twice', () => {
    const TOKEN = 'docs-token';
    DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      autoMigrate: false,
      as: TOKEN,
    });

    // From docs: "Registering one token twice throws rather than silently replacing the first".
    expect(() => DrizzleModule.forRoot({
      connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      autoMigrate: false,
      as: TOKEN,
    })).toThrow(/already registered/);
  });
});

/**
 * @source docs:api/drizzle.md#transaction
 */
describe('transaction() semantics (docs/api/drizzle.md)', () => {
  /* eslint-disable @typescript-eslint/naming-convention */
  const { DrizzleService } = require('../src/drizzle.service');
  const { DrizzleTransactionError } = require('../src/builders/transaction-gate');
  const { createTestService } = require('@onebun/core/testing');
  /* eslint-enable @typescript-eslint/naming-convention */

  const docUsers = sqliteTable('doc_tx_users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
  });

  let service: typeof DrizzleService.prototype;

  beforeEach(async () => {
    DrizzleModule.clearOptions();

    const { instance } = createTestService(DrizzleService);
    service = instance;

    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    });

    service.getSQLiteClient()!.run(`
      CREATE TABLE doc_tx_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `);
  });

  afterEach(async () => {
    await service.close();
  });

  /**
   * @source docs:api/drizzle.md#transaction
   */
  it('rolls the transaction back when the callback throws after an await', async () => {
    // From docs: "The callback may await freely. If it throws, the whole transaction is
    // rolled back and the original error reaches the caller."
    const someSlowCheck = async (): Promise<void> => await new Promise(resolve => setTimeout(resolve, 5));

    let seen: Error | null = null;
    try {
      await service.transaction(async (tx: typeof service) => {
        await tx.insert(docUsers).values({ name: 'John', email: 'john@example.com' });
        await someSlowCheck();

        throw new Error('changed my mind');
      });
    } catch (error) {
      seen = error as Error;
    }

    expect(seen?.message).toBe('changed my mind');
    expect(await service.select().from(docUsers)).toEqual([]);
  });

  /**
   * @source docs:api/drizzle.md#sqlite
   */
  it('runs a service query from inside the callback on the transaction, and refuses a nested one', async () => {
    // From docs: a query through the service is issued ON the transaction and undone with it;
    // only a nested transaction() throws, with code 'SQLITE_TRANSACTION_NESTED'.
    await service.transaction(async (tx: typeof service) => {
      await tx.insert(docUsers).values({ name: 'John', email: 'john@example.com' });
      await service.insert(docUsers).values({ name: 'Jane', email: 'jane@example.com' });
    });

    expect(await service.select().from(docUsers)).toHaveLength(2);

    let nested: unknown;
    try {
      await service.transaction(async () => {
        await service.transaction(async () => undefined);
      });
    } catch (error) {
      nested = error;
    }

    expect(nested).toBeInstanceOf(DrizzleTransactionError);
    expect((nested as { code: string }).code).toBe('SQLITE_TRANSACTION_NESTED');
  }, 5000);

  /**
   * @source docs:api/drizzle.md#sqlite
   */
  it('queues a query issued elsewhere in the application until the transaction ends', async () => {
    // From docs: "A query issued elsewhere in the application while the transaction is open
    // waits for it, then runs after the COMMIT or ROLLBACK."
    let released!: () => void;
    const transactionOpen = new Promise<void>((resolve) => {
      released = resolve;
    });

    const elsewhere = (async () => {
      await transactionOpen;
      await service.insert(docUsers).values({ name: 'Bystander', email: 'by@example.com' });

      return 'written';
    })();

    await expect(service.transaction(async (tx: typeof service) => {
      await tx.insert(docUsers).values({ name: 'Doomed', email: 'doomed@example.com' });
      released();
      await new Promise(resolve => setTimeout(resolve, 20));

      throw new Error('undo');
    })).rejects.toThrow('undo');

    expect(await elsewhere).toBe('written');

    const rows = await service.select().from(docUsers);
    expect(rows.map((row: { name: string }) => row.name)).toEqual(['Bystander']);
  }, 5000);
});

describe('Startup Contract (docs)', () => {
  const { createTestService } = require('@onebun/core/testing');
  const deadUrl = 'postgresql://app:hunter2@127.0.0.1:5999/orders';

  afterEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  /**
   * @source docs:api/drizzle.md#startup-contract
   */
  it('rejects app.start() when the configured database does not answer, without printing the password', async () => {
    // From docs: "await app.start(); // rejects with DrizzleStartupError when the configured
    // database is unreachable" — and the quoted message redacts the password.
    @Module({
      imports: [
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.POSTGRESQL, options: { connectionString: deadUrl } },
        }),
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    const failure = await app.start().then(() => null, (error: unknown) => error as Error);
    await app.stop().catch(() => undefined);

    // The rejection reaching the caller is Effect's FiberFailure wrapper; it carries the
    // DrizzleStartupError's own message. The error object itself is what onModuleInit()
    // throws — see startup-contract.test.ts.
    expect(String(failure)).toContain('DrizzleStartupError');
    expect(failure!.message).toContain('did not answer SELECT 1');
    expect(failure!.message).toContain('5000ms connect timeout');
    expect(failure!.message).toContain(':***@');
    expect(failure!.message).not.toContain('hunter2');
  });

  /**
   * @source docs:api/drizzle.md#allowdegradedstart
   */
  it('starts anyway with allowDegradedStart: true, and warns instead', async () => {
    // From docs: the check still runs and still reports; the failure is logged at `warn`
    // and the application starts anyway.
    DrizzleModule.forRoot({
      connection: { type: DatabaseType.POSTGRESQL, options: { connectionString: deadUrl } },
      allowDegradedStart: true,
    });

    const { instance, logger } = createTestService(DrizzleServiceCtor);
    await instance.onModuleInit();

    const warnings = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call: unknown[]) => String(call[0])).join('\n');
    expect(warnings).toContain('allowDegradedStart is set');
    expect(warnings).not.toContain('hunter2');

    await instance.close();
  });
});
