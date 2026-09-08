# OneBun Drizzle Integration — Full Reference

## Setup

### Installation

```bash
bun add @onebun/drizzle
```

### Module Registration

```typescript
// src/app.module.ts
import { Module } from '@onebun/core';
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,       // the only other member is DatabaseType.POSTGRESQL
        options: { url: process.env.DB_PATH || './data/app.db' },
      },
      autoMigrate: true,
      migrationsFolder: './src/db/migrations',
    }),
    // ... domain modules
  ],
})
export class AppModule {}
```

`DrizzleModule.forRoot()` makes `DrizzleService` globally available — no need to import in domain modules.

`DatabaseType` has exactly two members: `SQLITE = 'sqlite'` and `POSTGRESQL = 'postgresql'`. There is no
`DatabaseType.POSTGRES` — writing it is a compile error, and casting it away boots into
`Unsupported database type: undefined`.

### Startup contract — a configured database is a REQUIRED one

`DrizzleService.onModuleInit()` opens the database, probes PostgreSQL with a bounded `SELECT 1`, and runs
migrations. Any failure rejects `app.start()` **before** `Bun.serve()` binds — there is no warn-and-continue
default. The snippet above dies at boot when `DB_PATH` is unset and `./data` does not exist, rather than
starting and returning 500 from every request that touches the database. That is deliberate: an orchestrator
must see a container that refuses to come up, not one that passes readiness and then fails.

| Aspect | Behaviour |
|---|---|
| Error | `DrizzleStartupError`, carrying `stage` (`'open' \| 'connect' \| 'migrate'`), `target` (password redacted), `waitedMs`, `timeoutMs` |
| Connect probe bound | `connection.options.pool.timeout` (ms) when set, otherwise 5000 ms |
| SQLite | no `connect` stage — opening the file *is* the check |
| Missing migrations folder | "no migrations", not a failure (`migrationsFolder` defaults to `./drizzle`) |

Opt out with `allowDegradedStart: true`. The same switch on the environment path is
`DB_ALLOW_DEGRADED_START=true` (with the configured `envPrefix`) — and it applies **only** there: an
application whose `connection` came from `forRoot()` takes the option and ignores the variable, because
module options are code. It does not skip the check either way: the check still runs, the failure is
logged at `warn`, and boot continues. Use it only when a degraded or absent database at boot is genuinely acceptable
(read-mostly service behind a cache, database brought up after the application).

```typescript
import { DatabaseType, DrizzleModule } from '@onebun/drizzle';

DrizzleModule.forRoot({
  connection: {
    type: DatabaseType.SQLITE,
    options: { url: './data/app.db' },
  },
  // "I accept an absent database at boot" — every request touching it fails until it is there.
  allowDegradedStart: true,
});
```

Two things that surprise readers:

- **`instanceof DrizzleStartupError` does not hold on what `await app.start()` rejects with.** Effect wraps
  it in a `FiberFailure` that carries only the message; match on the message there. The `instanceof` check
  works only on what `onModuleInit()` itself throws.
- **A package that ships its own migrations needs its own `migrationsTable`** in `forRoot()` /
  `runMigrations()`. Both default to drizzle's `__drizzle_migrations`, and the framework refuses the
  collision rather than living with it: the second `runMigrations()` on one `DrizzleService` throws
  `Migration folder "X" would share the journal "drizzle.__drizzle_migrations" with "Y"` — under
  `autoMigrate` that kills the boot. A set that is skipped anyway is logged at `warn` with the filenames.
  The guard is per service instance, so two services against one database — or drizzle-kit run outside
  the service — still skip in silence: drizzle compares folder timestamps against the newest journal
  row, never hashes.

### Multiple databases

Name each configuration with `as`, and let each feature module select the one it needs:

```typescript
export const MAIN_DB = Symbol('MAIN_DB');
export const ANALYTICS_DB = Symbol('ANALYTICS_DB');

@Module({
  imports: [
    DrizzleModule.forRoot({ connection: mainConnection,      as: MAIN_DB }),
    DrizzleModule.forRoot({ connection: analyticsConnection, as: ANALYTICS_DB }),
    ReportsModule,
  ],
})
export class AppModule {}

@Module({
  imports: [DrizzleModule.forFeature(ANALYTICS_DB)],  // the module decides, once
  providers: [ReportService],
})
export class ReportsModule {}

@Service()
export class ReportService extends BaseService {
  constructor(private db: DrizzleService) { super(); }  // no @Inject, no token here
}
```

A module that needs BOTH names each one — this is the only place a token appears at an injection site:

```typescript
@Module({
  imports: [DrizzleModule.forFeature(MAIN_DB), DrizzleModule.forFeature(ANALYTICS_DB)],
  providers: [Reconciler],
})
export class ReconcileModule {}

@Service()
export class Reconciler extends BaseService {
  constructor(
    @Inject(MAIN_DB) private main: DrizzleService,
    @Inject(ANALYTICS_DB) private analytics: DrizzleService,
    private clock: ClockService,          // un-annotated parameters still resolve by type
  ) { super(); }
}
```

Rules: one token per `forRoot()` (registering it twice throws); selecting a token nothing configured fails at
startup; the bare class in a module holding two registrations throws naming both; `@Inject` with a token the
module never selected throws naming what it did select. A named registration is never `@Global()` — `as` with
`isGlobal: true` throws — and it reaches a module only by being imported. An unnamed `forRoot()` keeps the
global behaviour, and `isGlobal: false` is about VISIBILITY, not about multiple databases.

From outside the tree, `app.getService(Class, TOKEN)` is the **only** call that works once two registrations
exist. The untokened `app.getService(Class)` and `app.getLayer()` both THROW an `Error` whose `name` is
`OneBunAmbiguousServiceError`, naming every holder. Untokened `getLayer()` throws rather than quietly
returning a Context because an Effect `Context` has exactly one slot per service class — the layer it built
would carry whichever instance merged last, i.e. whatever the import order happened to be.

**Say which one takes the slot:** `app.getLayer([[DrizzleService, ANALYTICS_DB]])`. The layer still holds one
instance per class, because that is what a `Context` is, but which one is stated rather than inferred from
import order. Every ambiguous class must be named; one left out still throws, and the message lists only what
is still unresolved. To reach an instance without building a layer, `getService(Class, TOKEN)` or
`@Inject(TOKEN)`.

`CacheModule` works the same way: `forRoot({ ..., as: TOKEN })` and `forFeature(TOKEN)`.

### Drizzle Config

Create `drizzle.config.ts` at service root:

```typescript
import { defineConfig } from '@onebun/drizzle';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.DB_PATH || './data/app.db' },
});
```

## Schema Definition

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer, real, index, uniqueIndex } from '@onebun/drizzle/sqlite';
import { sql } from '@onebun/drizzle';

// Basic table
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),                                    // ULID as text
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// Table with indexes
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  amountCents: integer('amount_cents').notNull(),                 // money in cents!
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  index('idx_transactions_user').on(table.userId),
  index('idx_transactions_created').on(table.createdAt),
]);

// Singleton/state table
export const appState = sqliteTable('app_state', {
  id: integer('id').primaryKey(),                                 // always 1
  balanceCents: integer('balance_cents').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// Type exports
export type DbUser = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DbTransaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
```

### Conventions

| Convention | Pattern |
|---|---|
| IDs | ULID as `text('id').primaryKey()` |
| Timestamps | `integer('col', { mode: 'timestamp_ms' })` — milliseconds |
| Money | `integer('amount_cents')` — always cents, never float |
| Enums | `text('col', { enum: ['a', 'b'] })` |
| JSON | `text('col', { mode: 'json' }).$type<MyType>()` |
| Booleans | `integer('col', { mode: 'boolean' })` (SQLite has no bool) |

## Repository Pattern

```typescript
import { Service, BaseService } from '@onebun/core';
import { DrizzleService, eq, desc, gte, and, sql, count } from '@onebun/drizzle';
import { users, type DbUser, type NewUser } from '../db/schema';

@Service()
export class UserRepository extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findAll(limit = 10, offset = 0): Promise<DbUser[]> {
    return this.db.select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async findById(id: string): Promise<DbUser | undefined> {
    const results = await this.db.select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return results[0];
  }

  async findByEmail(email: string): Promise<DbUser | undefined> {
    const results = await this.db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return results[0];
  }

  async create(data: NewUser): Promise<DbUser> {
    const results = await this.db.insert(users)
      .values(data)
      .returning();
    return results[0];
  }

  async update(id: string, data: Partial<NewUser>): Promise<DbUser | undefined> {
    const results = await this.db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return results[0];
  }

  async delete(id: string): Promise<boolean> {
    const results = await this.db.delete(users)
      .where(eq(users.id, id))
      .returning();
    return results.length > 0;
  }

  async count(): Promise<number> {
    const results = await this.db.select({ value: count() }).from(users);
    return results[0].value;
  }
}
```

## Transactions

Always use transactions for multi-table writes to ensure atomicity, and **issue every statement that belongs
to the transaction through the `tx` argument**. `tx` is the one form that means the same thing on both
dialects; a query issued through `DrizzleService` — or through a repository — from inside the callback does
NOT (see the dialect split below).

<!-- typecheck: skip -->
```typescript
async transferFunds(fromId: string, toId: string, amountCents: number) {
  return this.db.transaction(async (tx) => {
    // Debit sender
    const sender = await tx.update(accounts)
      .set({ balance: sql`${accounts.balance} - ${amountCents}` })
      .where(eq(accounts.id, fromId))
      .returning();

    if (sender[0].balance < 0) {
      throw new Error('Insufficient funds');  // rolls back transaction
    }

    // Credit receiver
    await tx.update(accounts)
      .set({ balance: sql`${accounts.balance} + ${amountCents}` })
      .where(eq(accounts.id, toId));

    // Log the transfer
    await tx.insert(transferLog).values({
      id: generateUlid(),
      fromId,
      toId,
      amountCents,
      createdAt: new Date(),
    });

    return sender[0];
  });
}
```

The callback may `await` freely, and a throw rolls the whole thing back with the original error reaching the
caller — on both dialects. What differs is everything *not* issued through `tx`:

**SQLite** — one connection, so the transaction owns the database for its whole duration:

- A query issued through the service or a repository from **inside** the callback runs ON the open
  transaction and is rolled back with it. A repository method does not have to be rewritten to take part.
- A **nested** `db.transaction()` throws `DrizzleTransactionError` with `code === 'SQLITE_TRANSACTION_NESTED'`
  — it would wait for the connection its own caller is holding.
- A synchronous `.get()`, `.all()`, `.run()` or `.values()` issued from **elsewhere** while the transaction
  holds the connection throws `DrizzleTransactionError` with `code === 'SQLITE_TRANSACTION_SYNC_QUERY'`: it
  returns rows rather than a promise, so it cannot be queued — await the query instead. The same call from
  inside the callback is fine: it runs on the open transaction and sees its uncommitted rows.
- Concurrent **async** queries from elsewhere in the application are queued and run after the COMMIT or
  ROLLBACK — never enrolled in the transaction, never rolled back with it. Two transactions are serialized.

**PostgreSQL** — a pooled connection through drizzle's own `transaction()`; nothing is queued, nothing is
refused, and the SQLite re-entrancy errors cannot occur. There is no nesting through this API either: `tx`
has no `transaction()` method (writing it is a compile error), and calling `db.transaction()` again from
inside the callback takes another pooled connection and starts an **independent** transaction that can block
on the outer one's locks. Drizzle's savepoints exist only under the escape hatch
`tx.getRawTransaction().transaction(...)`. And the counter-rule:

- A query issued through the service or a repository from inside the callback takes **another** pooled
  connection. It does NOT join the transaction and it **survives the rollback** — the exact opposite of the
  SQLite rule above.

This is the trap in the Repository Pattern section above: `await this.userRepo.create(...)` inside
`db.transaction()` is atomic on SQLite and silently non-atomic on PostgreSQL. Thread `tx` into the
repository method (or inline the write as `tx.insert(...)`) and the code means the same thing everywhere.

`DrizzleTransactionError` is exported from `@onebun/drizzle`; `name` is stable, so it can be matched without
importing the class.

## Upsert Pattern

```typescript
await this.db.insert(dailyStats)
  .values({ date: today, totalCents: amount, count: 1 })
  .onConflictDoUpdate({
    target: dailyStats.date,
    set: {
      totalCents: sql`${dailyStats.totalCents} + ${amount}`,
      count: sql`${dailyStats.count} + 1`,
    },
  });
```

## Raw SQL Expressions

<!-- typecheck: skip -->
```typescript
import { sql } from '@onebun/drizzle';

// In select
const result = await this.db.select({
  total: sql<number>`SUM(${transactions.amountCents})`,
}).from(transactions);

// In where — compare a timestamp column against a Date, NEVER against SQL datetime()
.where(gte(transactions.createdAt, new Date(Date.now() - 7 * 86_400_000)))

// In update
.set({ balance: sql`${accounts.balance} + ${amount}` })
```

**Never filter a `{ mode: 'timestamp_ms' }` column against a raw SQL `datetime(...)` expression.** The column has
INTEGER affinity; `datetime()` returns TEXT (`'2026-08-07 16:19:41'`). SQLite compares across storage classes
by type order, and every integer sorts before every string — so the predicate is always false and the query
returns **zero rows with no error**. A silent empty result is worse than a crash: nothing tells you the
filter did not run. Pass a `Date` (drizzle serializes it to ms) or, if you must stay in SQL,
`unixepoch('now', '-7 days') * 1000`.

## Migration Commands

```bash
bunx onebun-drizzle generate    # generate migration from schema changes
bunx onebun-drizzle push        # push schema directly (dev only)
bunx onebun-drizzle studio      # visual DB browser
```

## Available Query Helpers

Import from `@onebun/drizzle`:

```typescript
import {
  DrizzleService,
  eq,           // equality: eq(col, value)
  ne,           // not equal
  gt, gte,      // greater than (or equal)
  lt, lte,      // less than (or equal)
  and, or,      // combine conditions
  desc, asc,    // ordering
  sql,          // raw SQL
  count,        // count aggregation
  sum,          // sum aggregation
  like,         // LIKE pattern
  inArray,      // IN (...)
  isNull,       // IS NULL
  isNotNull,    // IS NOT NULL
} from '@onebun/drizzle';
```