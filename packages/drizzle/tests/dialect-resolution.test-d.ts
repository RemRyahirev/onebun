/**
 * TYPE-LEVEL test. The gate is `bun run typecheck`, not `bun test`.
 *
 * The defect this pins is invisible at runtime: every `pgTable` resolved to the SQLite
 * builder, so `.limit()`, `.for()` and a projected `.returning()` were untypeable while the
 * queries themselves still ran. Nothing a runtime assertion can observe.
 *
 * The file is named `.test-d.ts` so `bun test` does not pick it up — it asserts by compiling,
 * and every line below is a compile error if the resolution regresses.
 */

import { eq } from 'drizzle-orm';

import type { DialectOf } from '../src/builders/dialect';

import { UniversalSelectBuilder, UniversalSelectDistinctBuilder } from '../src/builders';
import { DrizzleService } from '../src/drizzle.service';
import {
  pgTable,
  integer as pgInteger,
  text as pgText,
} from '../src/pg';
import {
  sqliteTable,
  integer,
  text,
} from '../src/sqlite';

const pgUsers = pgTable('pg_users', {
  id: pgInteger('id').primaryKey(),
  name: pgText('name'),
});

const liteUsers = sqliteTable('lite_users', {
  id: integer('id').primaryKey(),
  name: text('name'),
});

declare const builder: UniversalSelectBuilder;
declare const distinctBuilder: UniversalSelectDistinctBuilder;

// ============================================================================
// The discriminator itself
//
// Neither `SQLiteTable<any>` nor `PgTable<any>` rejects the other dialect's table, so
// overload ordering cannot separate them — the column brand can.
// ============================================================================

const pgDialect: 'pg' = null as never as DialectOf<typeof pgUsers>;
const liteDialect: 'sqlite' = null as never as DialectOf<typeof liteUsers>;

// ============================================================================
// PostgreSQL resolves to the PostgreSQL builder
// ============================================================================

const PAGE_SIZE = 10;
const OFFSET = 5;

const pgChain = builder.from(pgUsers);

// The whole chain has to be reachable; the previous shape ended after `.where()`.
const pgWhereLimit = pgChain.where(eq(pgUsers.id, 1)).limit(PAGE_SIZE);
const pgOrderLimitOffset = builder.from(pgUsers).orderBy(pgUsers.id).limit(PAGE_SIZE).offset(OFFSET);
const pgRowLock = builder.from(pgUsers).for('update', { skipLocked: true });
const pgDynamic = builder.from(pgUsers).$dynamic();
const pgDistinct = distinctBuilder.from(pgUsers).limit(1);

// The row type still comes from the table, not from `any`.
const pgRows: Array<{ id: number; name: string | null }> = null as never as Awaited<typeof pgChain>;

// ============================================================================
// SQLite still resolves to the SQLite builder
// ============================================================================

const liteChain = builder.from(liteUsers);
const liteWhereLimit = liteChain.where(eq(liteUsers.id, 1)).limit(PAGE_SIZE);
const liteRows: Array<{ id: number; name: string | null }> = null as never as Awaited<typeof liteChain>;

// ============================================================================
// Negative assertions — the dialects must not bleed into each other
// ============================================================================

// `.for()` is PostgreSQL-only row locking. If SQLite ever resolves to the PG builder, this
// stops being an error and the guard is dead — @ts-expect-error fails when there is no error.
// @ts-expect-error SQLite has no row locking
builder.from(liteUsers).for('update');

// A PostgreSQL chain must not expose SQLite's synchronous `.all()`.
// @ts-expect-error PostgreSQL results are awaited, never `.all()`-ed
builder.from(pgUsers).all();

// ============================================================================
// insert / update / delete resolve per dialect too
//
// These DO have overloads, and the bare `PgTable` constraint discriminates where
// `PgTable<any>` does not — so declaration order is what fixes them. The reported symptom
// was `update(pgTable).set(...).returning({ id })` failing with
// "PgColumn is not assignable to SQLiteColumn".
// ============================================================================

declare const service: DrizzleService;

const pgUpdateReturning = service
  .update(pgUsers)
  .set({ name: 'x' })
  .where(eq(pgUsers.id, 1))
  .returning({ id: pgUsers.id });

const pgInsertReturning = service
  .insert(pgUsers)
  .values({ id: 1, name: 'x' })
  .onConflictDoNothing()
  .returning({ id: pgUsers.id });

const pgDeleteReturning = service.delete(pgUsers).where(eq(pgUsers.id, 1)).returning();

// SQLite still gets the SQLite builders.
const liteUpdateReturning = service
  .update(liteUsers)
  .set({ name: 'x' })
  .where(eq(liteUsers.id, 1))
  .returning({ id: liteUsers.id });

// `onConflictDoNothing` exists on both, but SQLite has no `.returning()` projection issue —
// what must NOT happen is a SQLite table reaching the PostgreSQL builder.
// @ts-expect-error SQLite insert has no PostgreSQL-only overload marker
service.insert(liteUsers).values({ id: 1, name: 'x' }).onConflictDoUpdate();

export {
  pgUpdateReturning,
  pgInsertReturning,
  pgDeleteReturning,
  liteUpdateReturning,
  pgDialect,
  liteDialect,
  pgWhereLimit,
  pgOrderLimitOffset,
  pgRowLock,
  pgDynamic,
  pgDistinct,
  pgRows,
  liteWhereLimit,
  liteRows,
};
