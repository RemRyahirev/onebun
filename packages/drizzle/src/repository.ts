/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle ORM uses complex conditional types that require `any` for table type parameters
// This is a known limitation when working with Drizzle's type system

import { eq, type SQL } from 'drizzle-orm';

import type { IRepository, DatabaseInstance } from './types';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';


import { UniversalTransactionClient } from './builders';
import { DrizzleService } from './drizzle.service';
import {
  getPrimaryKeyColumn,
  type SelectType,
  type InsertType,
} from './schema-utils';

/**
 * Query builder interface for type-safe database operations
 * Uses any for table types due to Drizzle's union type constraints
 */
export interface QueryBuilder {
  select(): {
    from(table: SQLiteTable<any> | PgTable<any>): Promise<unknown[]>;
  };
  insert(table: SQLiteTable<any> | PgTable<any>): {
    values(data: any | any[]): {
      returning(): Promise<unknown[]>;
    };
  };
  update(table: SQLiteTable<any> | PgTable<any>): {
    set(data: any): {
      where(condition: SQL<unknown>): {
        returning(): Promise<unknown[]>;
      };
    };
  };
  delete(table: SQLiteTable<any> | PgTable<any>): {
    where(condition: SQL<unknown>): {
      returning(): Promise<unknown[]>;
    };
  };
}

/**
 * Base repository class for Drizzle ORM
 * Provides complete CRUD operations using Drizzle table schemas
 * Users can extend this class and add business logic methods
 *
 * The repository works with a single table schema that matches the database type
 * configured in DrizzleService. Users should use pgTable() for PostgreSQL or
 * sqliteTable() for SQLite, matching their database configuration.
 *
 * @example
 * ```typescript
 * // For PostgreSQL
 * import { pgTable, serial, text } from 'drizzle-orm/pg-core';
 * import { BaseRepository } from '@onebun/drizzle';
 *
 * const users = pgTable('users', {
 *   id: serial('id').primaryKey(),
 *   name: text('name').notNull(),
 * });
 *
 * export class UserRepository extends BaseRepository<typeof users> {
 *   constructor(drizzleService: DrizzleService) {
 *     super(drizzleService, users);
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // For SQLite
 * import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
 * import { BaseRepository } from '@onebun/drizzle';
 *
 * const users = sqliteTable('users', {
 *   id: integer('id').primaryKey({ autoIncrement: true }),
 *   name: text('name').notNull(),
 * });
 *
 * export class UserRepository extends BaseRepository<typeof users> {
 *   constructor(drizzleService: DrizzleService) {
 *     super(drizzleService, users);
 *   }
 * }
 * ```
 */
export class BaseRepository<
  TTable extends PgTable<any> | SQLiteTable<any>,
> implements IRepository<SelectType<TTable>> {
  /**
   * Database instance
   */
  protected readonly db: DatabaseInstance;

  /**
   * Table schema instance
   */
  protected readonly table: TTable;

  /**
   * DrizzleService instance
   */
  protected readonly drizzleService: DrizzleService;

  constructor(
    drizzleService: DrizzleService,
    table: TTable,
  ) {
    this.table = table;
    this.drizzleService = drizzleService;
    this.db = this.drizzleService.getDatabase();
  }

  /**
   * Get primary key column name from table schema
   */
  protected getPrimaryKeyColumn(): string {
    const pkColumn = getPrimaryKeyColumn(this.table);
    if (!pkColumn) {
      throw new Error('Primary key not found for table');
    }

    return pkColumn;
  }

  /**
   * Helper method to get properly typed select query builder
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  protected selectQuery() {
    // Type assertion needed because TypeScript cannot infer methods from conditional types
    // Runtime type is correct - this is a TypeScript limitation
    return (this.db as any).select().from(this.table);
  }

  /**
   * Find all records
   */
  async findAll(): Promise<SelectType<TTable>[]> {
    const results = await this.selectQuery();

    // Drizzle returns properly typed results at runtime
    return results as SelectType<TTable>[];
  }

  /**
   * Find one record by ID
   */
  async findById(id: unknown): Promise<SelectType<TTable> | null> {
    const primaryKeyColumn = this.getPrimaryKeyColumn();
    // Type assertion needed because TypeScript cannot infer methods from conditional types
    const results = await (this.db as any)
      .select()
      .from(this.table)
      .where(eq((this.table as any)[primaryKeyColumn], id));

    // Drizzle returns properly typed results at runtime
    return (results[0] as SelectType<TTable>) || null;
  }

  /**
   * Create a new record
   */
  async create(data: Partial<InsertType<TTable>>): Promise<SelectType<TTable>> {
    // Type assertion needed because TypeScript cannot infer methods from conditional types
    const results = await (this.db as any).insert(this.table).values(data as any).returning();
    if (!results || results.length === 0) {
      throw new Error('Failed to create record');
    }

    // Drizzle returns properly typed results at runtime
    return results[0] as SelectType<TTable>;
  }

  /**
   * Update a record by ID
   */
  async update(id: unknown, data: Partial<InsertType<TTable>>): Promise<SelectType<TTable> | null> {
    const primaryKeyColumn = this.getPrimaryKeyColumn();
    // Type assertion needed because TypeScript cannot infer methods from conditional types
    const results = await (this.db as any)
      .update(this.table)
      .set(data as any)
      .where(eq((this.table as any)[primaryKeyColumn], id))
      .returning();

    if (!results || results.length === 0) {
      return null;
    }

    // Drizzle returns properly typed results at runtime
    return results[0] as SelectType<TTable>;
  }

  /**
   * Delete a record by ID
   */
  async delete(id: unknown): Promise<boolean> {
    const primaryKeyColumn = this.getPrimaryKeyColumn();
    // Type assertion needed because TypeScript cannot infer methods from conditional types
    const results = await (this.db as any)
      .delete(this.table)
      .where(eq((this.table as any)[primaryKeyColumn], id))
      .returning();

    return Array.isArray(results) && results.length > 0;
  }

  /**
   * Count records
   */
  async count(): Promise<number> {
    const all = await this.findAll();

    return all.length;
  }

  /**
   * Get query builder for advanced queries
   */
  getQueryBuilder(): QueryBuilder {
    // Type assertion needed because TypeScript cannot infer methods from conditional types
    const db = this.db as any;

    return {
      select: () => ({
        async from(t: SQLiteTable<any> | PgTable<any>) {
          return await db.select().from(t);
        },
      }),
      insert: (t: SQLiteTable<any> | PgTable<any>) => ({
        values: (data: any | any[]) => ({
          async returning() {
            return await db.insert(t).values(data).returning();
          },
        }),
      }),
      update: (t: SQLiteTable<any> | PgTable<any>) => ({
        set: (data: any) => ({
          where: (condition: SQL<unknown>) => ({
            async returning() {
              return await db.update(t).set(data).where(condition).returning();
            },
          }),
        }),
      }),
      delete: (t: SQLiteTable<any> | PgTable<any>) => ({
        where: (condition: SQL<unknown>) => ({
          async returning() {
            return await db.delete(t).where(condition).returning();
          },
        }),
      }),
    };
  }

  /**
   * Execute a transaction
   * 
   * @example
   * ```typescript
   * await userRepository.transaction(async (tx) => {
   *   const users = await tx.select().from(usersTable);
   *   await tx.insert(usersTable).values({ name: 'John' });
   * });
   * ```
   */
  async transaction<R>(
    callback: (tx: UniversalTransactionClient) => Promise<R>,
  ): Promise<R> {
    return await this.drizzleService.transaction(callback);
  }
}
