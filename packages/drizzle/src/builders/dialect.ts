/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle ORM uses complex conditional types that require `any` for proper type inference

import type { PgSelectBase, PgTable } from 'drizzle-orm/pg-core';
import type {
  SQLiteColumn,
  SQLiteSelectBase,
  SQLiteTable,
} from 'drizzle-orm/sqlite-core';

/**
 * Any table the universal builders accept.
 */
export type AnyDialectTable = SQLiteTable<any> | PgTable<any>;

/**
 * The dialect a table belongs to, read off its columns.
 *
 * `SQLiteTable<any>` and `PgTable<any>` do NOT discriminate: measured against the installed
 * drizzle-orm, a `pgTable` satisfies `SQLiteTable<any>` and a `sqliteTable` satisfies
 * `PgTable<any>`, in both directions. So overload resolution cannot separate them — whichever
 * overload is declared first captures every table, and reordering merely moves the defect to
 * the other dialect.
 *
 * A column does carry the distinction: `PgColumn` is branded `'pg'` and `SQLiteColumn`
 * `'sqlite'`. Reading it through the table's column map is what makes the split reliable.
 */
export type DialectOf<TTable> = TTable extends { _: { columns: infer TColumns } }
  ? TColumns[keyof TColumns] extends { _: { dialect: infer TDialect } }
    ? TDialect
    : never
  : never;

/** True when the table belongs to the PostgreSQL dialect. */
export type IsPg<TTable> = DialectOf<TTable> extends 'pg' ? true : false;

/**
 * What drizzle's own PostgreSQL builder returns from `select().from(table)`.
 *
 * Instantiated to match `BunSQLDatabase.select().from()` exactly, so the whole PostgreSQL
 * chain — `.where()`, `.limit()`, `.offset()`, `.orderBy()`, `.for()`, `.$dynamic()` — is
 * reachable. The previous hand-written `Promise & { where }` shape ended the chain after one
 * call.
 */
export type PgSelectQueryResult<TTable extends PgTable<any>> = PgSelectBase<
  TTable['_']['name'],
  TTable['_']['columns'],
  'single',
  Record<TTable['_']['name'], 'not-null'>,
  false,
  never,
  TTable['$inferSelect'][],
  TTable['_']['columns']
>;

/**
 * What drizzle's own SQLite builder returns from `select().from(table)`.
 */
export type SQLiteSelectQueryResult<TTable extends SQLiteTable<any>> = SQLiteSelectBase<
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
 * The select-builder type for whichever dialect the table belongs to.
 *
 * A conditional return type rather than an overload pair, because overloads cannot
 * discriminate here — see {@link DialectOf}.
 */
export type SelectQueryResult<TTable extends AnyDialectTable> = IsPg<TTable> extends true
  ? TTable extends PgTable<any> ? PgSelectQueryResult<TTable> : never
  : TTable extends SQLiteTable<any> ? SQLiteSelectQueryResult<TTable> : never;
