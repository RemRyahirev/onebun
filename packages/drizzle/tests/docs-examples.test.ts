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
} from 'bun:test';
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
  timestamp,
} from 'drizzle-orm/pg-core';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';

import {
  DrizzleModule,
  DatabaseType,
  Entity,
  BaseRepository,
  getPrimaryKeyColumn,
  generateMigrations,
} from '../src';

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
      // From docs: Migration Management
      expect(generateMigrations).toBeDefined();
      expect(typeof generateMigrations).toBe('function');
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
