/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle ORM uses complex conditional types that require `any` for proper type inference

import type { DatabaseInstance } from '../types';
import type { AnyDialectTable, SelectQueryResult } from './dialect';

/**
 * Universal Select Builder that works with any table type
 *
 * This builder allows using DrizzleService without generic type parameter.
 * The result type is determined by the table's own dialect, so the full query builder for
 * that dialect is reachable — `.limit()`, `.offset()`, `.orderBy()`, `.for()` and
 * `.$dynamic()` on PostgreSQL included.
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
   * Select from a table of either dialect.
   *
   * ONE generic signature, not an overload per dialect. `SQLiteTable<any>` and `PgTable<any>`
   * accept each other's tables, so overload resolution always picked whichever was declared
   * first — every `pgTable` resolved to the SQLite builder, losing `.limit()`, `.for()` and
   * projected `.returning()`. The dialect is read off the table's columns instead.
   */
  from<TTable extends AnyDialectTable>(table: TTable): SelectQueryResult<TTable> {
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
   * Select distinct from a table of either dialect. See `UniversalSelectBuilder.from` for
   * why this is one signature rather than an overload per dialect.
   */
  from<TTable extends AnyDialectTable>(table: TTable): SelectQueryResult<TTable> {
    const selectBuilder = this.fields
      ? (this.db as any).selectDistinct(this.fields)
      : (this.db as any).selectDistinct();

    return selectBuilder.from(table);
  }
}
