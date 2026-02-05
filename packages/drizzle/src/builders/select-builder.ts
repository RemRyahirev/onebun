/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle ORM uses complex conditional types that require `any` for proper type inference

import type { DatabaseInstance } from '../types';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteSelectBase } from 'drizzle-orm/sqlite-core';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * SQLite select query result type with proper typing for table columns
 */
type SQLiteSelectQueryResult<TTable extends SQLiteTable<any>> = SQLiteSelectBase<
  TTable['_']['name'],
  'sync',
  void,
  TTable['_']['columns'],
  'single',
  Record<TTable['_']['name'], 'not-null'>,
  false,
  never,
  TTable['$inferSelect'][],
  Record<keyof TTable['_']['columns'], SQLiteColumn>
>;

/**
 * Universal Select Builder that works with any table type
 * 
 * This builder allows using DrizzleService without generic type parameter.
 * The result type is determined by the actual database operation at runtime,
 * but the select result array element type is inferred from the table schema.
 * 
 * @example
 * ```typescript
 * // DrizzleService without generic
 * const db = new DrizzleService();
 * 
 * // Type of result elements is inferred from table schema
 * const users = await db.select().from(usersTable);
 * // users has type: UserRow[]
 * ```
 */
export class UniversalSelectBuilder<TFields extends Record<string, unknown> | undefined = undefined> {
  constructor(
    private db: DatabaseInstance,
    private fields?: TFields,
  ) {}

  /**
   * Select from a SQLite table
   * Returns a chainable query builder that resolves to table row type
   */
  from<TTable extends SQLiteTable<any>>(
    table: TTable,
  ): SQLiteSelectQueryResult<TTable>;

  /**
   * Select from a PostgreSQL table
   * Returns a chainable query builder that resolves to table row type
   */
  from<TTable extends PgTable<any>>(
    table: TTable,
  ): Promise<TTable['$inferSelect'][]> & {
    where: (condition: any) => Promise<TTable['$inferSelect'][]> & { get: () => Promise<TTable['$inferSelect'] | undefined> };
  };

  /**
   * Implementation - runtime call to appropriate database
   */
  from(table: SQLiteTable<any> | PgTable<any>): any {
    const selectBuilder = this.fields
      ? (this.db as any).select(this.fields)
      : (this.db as any).select();
    
    return selectBuilder.from(table);
  }
}

/**
 * Universal SelectDistinct Builder
 * Same as UniversalSelectBuilder but for DISTINCT queries
 */
export class UniversalSelectDistinctBuilder<TFields extends Record<string, unknown> | undefined = undefined> {
  constructor(
    private db: DatabaseInstance,
    private fields?: TFields,
  ) {}

  /**
   * Select distinct from a SQLite table
   */
  from<TTable extends SQLiteTable<any>>(
    table: TTable,
  ): SQLiteSelectQueryResult<TTable>;

  /**
   * Select distinct from a PostgreSQL table
   */
  from<TTable extends PgTable<any>>(
    table: TTable,
  ): Promise<TTable['$inferSelect'][]>;

  from(table: SQLiteTable<any> | PgTable<any>): any {
    const selectBuilder = this.fields
      ? (this.db as any).selectDistinct(this.fields)
      : (this.db as any).selectDistinct();
    
    return selectBuilder.from(table);
  }
}
