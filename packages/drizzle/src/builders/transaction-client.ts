/* eslint-disable 
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/explicit-module-boundary-types */
// Drizzle ORM uses complex conditional types that require `any` for proper type inference
// Method overloads define return types, so explicit return type on implementation is not needed

import type { DatabaseInstance } from '../types';
import type { BunSQLQueryResultHKT } from 'drizzle-orm/bun-sql/session';
import type {
  PgDeleteBase,
  PgInsertBuilder,
  PgTable,
  PgUpdateBuilder,
} from 'drizzle-orm/pg-core';
import type {
  SQLiteDeleteBase,
  SQLiteInsertBuilder,
  SQLiteTable,
  SQLiteUpdateBuilder,
} from 'drizzle-orm/sqlite-core';

import { UniversalSelectBuilder, UniversalSelectDistinctBuilder } from './select-builder';

/**
 * Universal Transaction Client
 * 
 * Wraps the transaction object to provide methods with overloads
 * that infer the correct type from table schemas.
 * 
 * @example
 * ```typescript
 * await db.transaction(async (tx) => {
 *   // tx has the same API as DrizzleService
 *   const users = await tx.select().from(usersTable);
 *   await tx.insert(usersTable).values({ name: 'John' });
 * });
 * ```
 */
export class UniversalTransactionClient {
  constructor(private tx: DatabaseInstance) {}

  /**
   * Create a SELECT query
   */
  select(): UniversalSelectBuilder;
  select<TFields extends Record<string, unknown>>(fields: TFields): UniversalSelectBuilder<TFields>;
  select<TFields extends Record<string, unknown>>(fields?: TFields) {
    return new UniversalSelectBuilder(this.tx, fields);
  }

  /**
   * Create a SELECT DISTINCT query
   */
  selectDistinct(): UniversalSelectDistinctBuilder;
  selectDistinct<TFields extends Record<string, unknown>>(fields: TFields): UniversalSelectDistinctBuilder<TFields>;
  selectDistinct<TFields extends Record<string, unknown>>(fields?: TFields) {
    return new UniversalSelectDistinctBuilder(this.tx, fields);
  }

  /**
   * Create an INSERT query for SQLite table
   */
  insert<TTable extends SQLiteTable>(table: TTable): SQLiteInsertBuilder<TTable, 'sync', void>;

  /**
   * Create an INSERT query for PostgreSQL table
   */
  insert<TTable extends PgTable>(table: TTable): PgInsertBuilder<TTable, BunSQLQueryResultHKT>;

  insert(table: SQLiteTable | PgTable) {
    return (this.tx as any).insert(table);
  }

  /**
   * Create an UPDATE query for SQLite table
   */
  update<TTable extends SQLiteTable>(table: TTable): SQLiteUpdateBuilder<TTable, 'sync', void>;

  /**
   * Create an UPDATE query for PostgreSQL table
   */
  update<TTable extends PgTable>(table: TTable): PgUpdateBuilder<TTable, BunSQLQueryResultHKT>;

  update(table: SQLiteTable | PgTable) {
    return (this.tx as any).update(table);
  }

  /**
   * Create a DELETE query for SQLite table
   */
  delete<TTable extends SQLiteTable>(table: TTable): SQLiteDeleteBase<TTable, 'sync', void>;

  /**
   * Create a DELETE query for PostgreSQL table
   */
  delete<TTable extends PgTable>(table: TTable): PgDeleteBase<TTable, BunSQLQueryResultHKT>;

  delete(table: SQLiteTable | PgTable) {
    return (this.tx as any).delete(table);
  }

  /**
   * Get the raw transaction object for advanced usage
   * Note: Returns union type - use type guards for specific database type
   */
  getRawTransaction(): DatabaseInstance {
    return this.tx;
  }
}
