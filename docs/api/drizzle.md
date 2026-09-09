---
description: "DrizzleModule for SQLite and PostgreSQL. DrizzleService, BaseRepository, @Entity decorator. Migrations, type-safe queries."
---

# Database (Drizzle) API

Package: `@onebun/drizzle`

## Overview

OneBun provides database integration via Drizzle ORM with support for:
- SQLite (via bun:sqlite)
- PostgreSQL
- Type-safe queries
- Migrations
- Repository pattern

## DrizzleModule

### SQLite Setup

```typescript
import { Module } from '@onebun/core';
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import * as schema from './schema';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: {
          url: './data/app.db',
        },
      },
      migrationsFolder: './drizzle',
    }),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
```

#### SQLite pragmas and read-only files

`SQLiteConnectionOptions` gives every connection a pragma set, applied immediately after the
file opens. The default is `['journal_mode = WAL', 'synchronous = NORMAL']`, and `pragmas`
replaces it wholesale:

```typescript
DrizzleModule.forRoot({
  connection: {
    type: DatabaseType.SQLITE,
    options: {
      url: './data/app.db',
      pragmas: ['journal_mode = WAL', 'synchronous = NORMAL', 'foreign_keys = ON'],
    },
  },
})
```

A **read-only** connection gets a different default — `['synchronous = NORMAL']`:

```typescript
DrizzleModule.forRoot({
  connection: {
    type: DatabaseType.SQLITE,
    options: {
      url: './data/reference.db',
      options: { readonly: true },   // no pragmas needed: the default set adapts
    },
  },
})
```

`journal_mode` is a property of the file rather than of the connection — setting it rewrites the
database header — so a read-only handle answers `attempt to write a readonly database` and the
application used to die at boot. A read-only SQLite file is an ordinary deployment: a shipped
dataset, a mounted read-only volume. It now boots with no pragma list at all.

An explicit `pragmas` array is always applied **exactly as given**, read-only or not. Ask for a
write pragma on a read-only connection and the boot still fails, naming the pragma and saying it
is yours to remove — the framework filters its own defaults, not your list.

::: tip Why not just ignore the failure
Because whether it fails depends on the file. Measured under bun:sqlite,
`PRAGMA journal_mode = WAL` on a read-only handle fails only when the file is **not already in
WAL mode**; on a file that is, the identical statement succeeds as a no-op. Swallowing the error
would leave a deployment whose boot depends on how the database it was handed happened to be
written.
:::

### PostgreSQL Setup

```typescript
DrizzleModule.forRoot({
  connection: {
    type: DatabaseType.POSTGRESQL,
    options: {
      // A URL…
      connectionString: config.get('database.url'),

      // …or the five discrete fields. Not both — see PostgreSQL Connection below.
      // host: 'localhost',
      // port: 5432,
      // database: 'myapp',
      // user: 'postgres',
      // password: 'password',
    },
  },
  // autoMigrate defaults to true — omit unless you need to disable it
  migrationsFolder: './drizzle',
})
```

#### PostgreSQL Connection

`options` takes **either** a `connectionString` **or** the five discrete fields — never a
mix, and never a subset. The two shapes are mutually exclusive at the type level, so a
half-filled object is a compile error rather than a connection built from `undefined` that
surfaces later as an unreachable server:

<!-- typecheck: skip -->
```typescript
// A URL
options: { connectionString: 'postgresql://user:password@host:5432/database' }

// Or every discrete field
options: { host: 'localhost', port: 5432, user: 'postgres', password: 'secret', database: 'app' }
```

Prefer the URL when the value comes from configuration. A `connectionString` is passed to
the driver untouched, so query parameters it carries — `?sslmode=require`,
`?application_name=…` — reach the server. Assembling the URL from discrete fields cannot
express them.

Options arriving from an untyped source (a JSON config, a cast) are validated at
`initialize()` and rejected with an error naming the problem: which discrete fields
accompanied a `connectionString`, or which of the five are missing. Neither case is resolved
by picking a winner.

`pool` is accepted alongside either shape, and every option in it reaches the driver:

```typescript
DrizzleModule.forRoot({
  connection: {
    type: DatabaseType.POSTGRESQL,
    options: {
      connectionString: 'postgresql://user:password@host:5432/app',
      pool: {
        max: 20,            // connections the pool may open (driver default: 10)
        idleTimeout: 30000, // ms an idle connection is kept (default: kept forever)
        timeout: 2000,      // ms a connect may take (driver default: 30000)
      },
    },
  },
})
```

The block is typed as `PostgreSQLPoolOptions`. Both timeouts are **milliseconds**, like every
other duration in this framework. The driver takes seconds, so they are divided on the way
through — it accepts fractional values, so a 250 ms timeout stays 250 ms rather than rounding to
nothing.

`timeout` has one meaning in both places it is used: it bounds the driver's own connect *and*
the [startup reachability probe](#startup-contract). It is one number, so the two cannot drift
apart.

A zero or negative value is **not** forwarded. To the driver a zero timeout means *no* timeout,
so passing it on would turn a misconfiguration into an unbounded connect; the driver's default
applies instead.

::: warning `pool.min` is gone
Bun's `SQL` opens connections on demand and has no minimum-pool concept, so the option was
accepted and discarded on every release that had it. Delete it from your configuration —
TypeScript now rejects it, and nothing about your pool changes, because nothing about it ever
depended on the value.
:::

### Global Module (Default Behavior)

By default, `DrizzleModule` is a **global module**. This means that once you import it in your root module, `DrizzleService` is automatically available in all submodules without explicit imports.

```typescript
// app.module.ts - Import once in root module
import { Module } from '@onebun/core';
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';
import { UserModule } from './user/user.module';
import { PostModule } from './post/post.module';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: { host: 'localhost', port: 5432, user: 'app', password: 'secret', database: 'myapp' },
      },
    }),
    UserModule,
    PostModule,
  ],
})
export class AppModule {}

// user/user.module.ts - DrizzleService available without importing DrizzleModule
import { Module } from '@onebun/core';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService], // UserService can inject DrizzleService
})
export class UserModule {}

// user/user.service.ts - DrizzleService is automatically available
import { Service, BaseService } from '@onebun/core';
import { DrizzleService } from '@onebun/drizzle';
import { users } from './schema';

@Service()
export class UserService extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findAll() {
    return this.db.select().from(users);
  }
}
```

### Non-Global Mode

`isGlobal: false` stops `DrizzleService` from being ambiently available: a module reaches it only by importing `DrizzleModule` explicitly. There is still exactly ONE `DrizzleService` per application — the two modes differ in VISIBILITY, not in how many instances exist.

```typescript
@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: { host: 'db', port: 5432, user: 'app', password: 'secret', database: 'app' },
      },
      isGlobal: false,
    }),
  ],
  providers: [ReportService],
})
export class ReportModule {}
```

### Multiple databases

Name each configuration with `as`, and let each feature module select the one it needs. The token is a `symbol` or a `string`:

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

// The feature selects its registration at its own boundary...
@Module({
  imports: [DrizzleModule.forFeature(ANALYTICS_DB)],
  providers: [ReportService],
})
export class ReportsModule {}

// ...and its providers write the ordinary constructor. No @Inject and no token at the
// injection site — the module's import already decided which registration it resolves to.
@Service()
export class ReportService extends BaseService {
  constructor(private db: DrizzleService) { super(); }
}
```

Registering one token twice throws rather than silently replacing the first, and selecting a token that no `forRoot()` configured fails at startup naming the missing call.

**A module that needs BOTH** — a reconciliation job, a migration — names each one with `@Inject(TOKEN)`. Un-annotated parameters in the same constructor keep resolving by type:

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
    private clock: ClockService,
  ) { super(); }
}
```

Asking for the bare class in such a module fails at startup naming both candidates, and asking for a token the module never selected fails naming what it did select. Both alternatives — picking one silently — are the wrong-database failure this mechanism exists to prevent.

**A named registration is never global.** That is what makes two of them safe: ambient visibility has one slot per service, so a named registration reaches a module only by being imported. Combining `as` with `isGlobal: true` throws. An unnamed `forRoot()` keeps the global behaviour it always had.

**Reaching a registration from outside the tree:** `app.getService(DrizzleService, ANALYTICS_DB)`. Without the token there is no correct answer once two registrations exist, so the call throws instead of choosing — an `Error` whose `name` is `OneBunAmbiguousServiceError`, naming both candidates. `app.getLayer()` without arguments throws the same error rather than silently carrying whichever was merged last: Effect keys a `Context` by the tag's key, which is the class NAME, so two registrations need two slots where a `Context` has one. Say which one takes it — `app.getLayer([[DrizzleService, ANALYTICS_DB]])` — and the layer builds. Both checks fire only when the tree holds two or more instances under one key; a single registration, named or not, still answers.

::: warning Upgrading from 0.4.4 or earlier
Two `forRoot()` calls used to give you two `DrizzleService` instances **both connected to whichever was evaluated last**, silently — and earlier releases documented exactly that arrangement as the way to run a main and an analytics database. If you followed it, audit both databases: every write is in one of them, and which one depended on module evaluation order rather than on the order you declared them.
:::

### forFeature() Method

When `DrizzleModule` is not global (`isGlobal: false`), a submodule must import it to reach `DrizzleService`: a non-global service does not travel down the module tree, and `exports` travels up to the importing module rather than down to children. `forFeature()` is that import:

<!-- typecheck: skip -->
```typescript
// Root module with non-global DrizzleModule
@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: { ... },
      isGlobal: false,
    }),
    UserModule,
  ],
})
export class AppModule {}

// Feature module must explicitly import DrizzleService
@Module({
  imports: [DrizzleModule.forFeature()], // Required when isGlobal: false
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
```

::: tip forFeature() shares the root instance
Every module importing it receives the SAME `DrizzleService` — one connection pool for the application, not one per feature module. Earlier releases constructed a new instance per importer, so two feature modules opened two pools and shared no state.

If you want ONE shared instance without making `DrizzleModule` itself global, a `@Global()` module that imports it and re-exports the service does that — the re-exported instance then reaches modules that import neither:

```typescript
@Global()
@Module({
  imports: [DrizzleModule.forRoot({ connection: { /* ... */ }, isGlobal: false })],
  exports: [DrizzleService],
})
export class DatabaseModule {}
```
:::

<llm-only>
**Technical details for AI agents:**
- `DrizzleModule` is decorated with `@Global()` by default, making `DrizzleService` available in all modules
- `isGlobal: true` (default) - one DrizzleService per application, one DB connection
- `isGlobal: false` - requires an explicit import; the instance count is unchanged (one per application). NOT the multi-database mechanism — that is `forRoot({ as: TOKEN })` plus `forFeature(TOKEN)`, which gives each registration its own configuration and its own instance
- `as: symbol | string` on `forRoot()` names a registration. Registering one token twice throws; selecting an unconfigured token fails at startup; `as` with `isGlobal: true` throws. A named registration is never `@Global()`
- A module that selects TWO registrations of one service must name each with `@Inject(TOKEN)`; the bare class throws naming both candidates, and `@Inject` with an unselected token throws naming what the module did select. The token lives in a SIDE map, so `getConstructorParamTypes` still returns the full `design:paramtypes` array and partial injection is unaffected; `@Controller` copies the map onto its wrapper subclass
- `app.getService(Class, TOKEN)` walks the module tree for the registration that token names. Untokened `app.getLayer()` refuses: a `Context` has one slot per `tag.key`, which is the class NAME, so with two registrations it throws an `Error` whose `name` is `OneBunAmbiguousServiceError` — no last-writer fallback. `app.getLayer([[DrizzleService, ANALYTICS_DB]])` names the instance that takes the slot and builds. Untokened `app.getService(Class)` throws the same error in the same case. Both fire only when the tree holds 2+ instances under one key; a single registration still answers. `OneBunAmbiguousServiceError` is a `name` on a plain `Error`, not an exported class — match on `err.name`, not `instanceof`
- `forFeature()` simply returns the DrizzleModule class, so it is an ordinary import. A module class is constructed ONCE per application, so every importer shares one DrizzleService
- Global services are stored in the application's scope and automatically injected into all its modules
- `isGlobal: false` removes the module from the process-wide global registry via `removeFromGlobalModules()`; a later unnamed `forRoot()` that does not opt out puts it back. That symmetry replaced a permanent latch with LAST-WRITER-WINS — it is not isolation. The registry has one entry per module CLASS for the whole process, and `forRoot()` normally runs at import time (it is the argument to `@Module({ imports: [...] })`), so the last unnamed `forRoot()` evaluated anywhere in the process decides globality for EVERY application in it. Measured, two applications, `forRoot` evaluation order varied: `{isGlobal:false}` then default → both see global and the application that asked to opt out gets ambient injection anyway; default then `{isGlobal:false}` → both see non-global and BOTH fail at `app.start()` with `Could not resolve dependency`, including the one that declared nothing. Boot order is irrelevant. Two configurations that must not interfere need `forRoot({ as: TOKEN })`, which never touches the registry
</llm-only>

## Schema Definition

All schema builders are re-exported from `@onebun/drizzle`:
- PostgreSQL: `import { ... } from '@onebun/drizzle/pg'`
- SQLite: `import { ... } from '@onebun/drizzle/sqlite'`
- Common operators: `import { eq, and, ... } from '@onebun/drizzle'`

### SQLite Schema

```typescript
// schema/users.ts
import { sqliteTable, text, integer } from '@onebun/drizzle/sqlite';
import { sql } from '@onebun/drizzle';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
```

### PostgreSQL Schema

```typescript
// schema/users.ts
import { pgTable, text, integer, timestamp } from '@onebun/drizzle/pg';

export const users = pgTable('users', {
  // Use generatedAlwaysAsIdentity() for auto-increment integer primary key
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
```

**Alternative with UUID:**
```typescript
import { pgTable, uuid } from '@onebun/drizzle/pg';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ... rest of schema
});
```

### JSON and JSONB columns

Declared as usual, and stored as what they are:

```typescript
import { pgTable, serial, jsonb, json } from '@onebun/drizzle/pg';

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  payload: jsonb('payload').$type<{ kind: string; tags: string[] }>(),
  raw: json('raw'),
});
```

Objects, arrays and scalars all round-trip as **values**, not as JSON strings, so the SQL side works:

```sql
SELECT * FROM events WHERE payload @> '{"kind":"signup"}';
SELECT jsonb_array_length(payload -> 'tags') FROM events;
```

`jsonb[]` columns (`jsonb('tags').array()`) round-trip too, and always did.

::: danger Versions up to 0.5.0 stored double-encoded values
Every value written to a `json`/`jsonb` column through `DrizzleService` was stored as a jsonb
**string**: `jsonb_typeof` returned `'string'`, `@>` matched nothing, `jsonb_array_length` failed
with `cannot get array length of a scalar`.

It was invisible from the application that wrote it, because the read path decoded twice — so a
round trip through the ORM looked correct while every SQL operator, every other service and every
report saw a string. Existing rows are **not** migrated automatically; see
[Repairing double-encoded JSON](#repairing-double-encoded-json), and run it **before** deploying
this version, because the read path no longer compensates.
:::

#### Prepared statements and placeholders

`sql.placeholder()` on a json/jsonb column round-trips through `.prepare()`, on both `.values()`
and `.set()`:

```typescript
const insert = db.insert(events)
  .values({ payload: sql.placeholder('payload') })
  .prepare('insert_event');

await insert.execute({ payload: { kind: 'signup', tags: ['beta'] } });
await insert.execute({ payload: null });   // SQL NULL, not the JSON text `null`
```

One prepared statement can be executed any number of times with different payloads; the cast is
added to its text once.

#### Raw SQL bypasses this

The fix lives in the column encoders, so anything that does not go through a column does not get
it — ``db.execute(sql`...`)`` and the raw `$client`:

```typescript
// WRONG — stores a jsonb string
await db.execute(sql`INSERT INTO events (payload) VALUES (${payload})`);

// RIGHT — the double cast is what forces the value to be bound verbatim
await db.execute(sql`INSERT INTO events (payload) VALUES (${JSON.stringify(payload)}::text::jsonb)`);
```

A plain `::jsonb` is **not** enough — measured against `postgres:16-alpine`, `$1::jsonb` on a
pre-stringified value still stores `jsonb_typeof='string'`. Only `::text::jsonb` works.

### Repairing double-encoded JSON

Rows written by an earlier version hold a jsonb string. Repair them **before** deploying, with the
guard:

```sql
UPDATE t SET c = (c #>> '{}')::jsonb
WHERE jsonb_typeof(c) = 'string' AND (c #>> '{}') ~ '^\s*[\[{]';
```

The guard is not optional. Without `~ '^\s*[\[{]'` the same statement tries to parse every string
scalar and fails on the first one that is not JSON — `invalid input syntax for type json` — taking
the whole repair with it. It is a heuristic for the same reason: a legitimately stored jsonb string
whose content happens to look like JSON is indistinguishable from a double-encoded row, and this
one deliberately errs toward leaving values alone.

Run it before the upgrade, not after: from this version on `mapFromDriverValue` is identity, so an
unrepaired row reads back as the **string** it is on disk, while `createSelectSchema` still types a
`$type<T>()` column as `T`.

<llm-only>

**Technical details for AI agents — json/jsonb encoding:**
- The fix is `applyBunSqlJsonEncodingFix()` in `packages/drizzle/src/pg-json-encoding.ts`, applied from the `POSTGRESQL` branch of `DrizzleService.initialize()` before `drizzlePostgres(connectionUrl)`. Idempotent
- It patches TWO drizzle-orm internals, neither covered by that package's semver contract, pinned to **0.44.7**: (1) `PgJsonb`/`PgJson`/`PgArray.prototype.mapToDriverValue`, (2) `BunSQLPreparedQuery.prototype.execute`/`.all`
- Non-placeholder writes: the encoder returns `` sql`${JSON.stringify(value)}::text::jsonb` ``, which `buildQueryFromSourceParams` inlines because it unwraps an `SQL` result. `mapFromDriverValue` is identity — Bun has already decoded the column, and re-parsing would corrupt a legitimately stored jsonb string scalar
- Inside `PgArray` the encoder returns a plain string instead, tracked by an `arrayDepth` counter: `makePgArray` string-concatenates the base encoder's result, so an `SQL` chunk there renders `{[object Object]}`
- Placeholder writes cannot take an `SQL` chunk: `fillPlaceholders` pushes the encoder's result straight into the params array and has NO `is(x, SQL)` unwrap — that exists only in `buildQueryFromSourceParams`. So a process-global `placeholderMode` flag makes the encoder return a plain string, and the `$N` token is rewritten to `$N::text::jsonb` in the prepared statement's text, once per instance
- `fillPlaceholders` also has no null guard, unlike the value path, so the encoder returns `null` for `null` to keep SQL NULL on both paths
- The `placeholderMode` window is safe only because it contains no `await`: `execute` awaits nothing before `tracer.startActiveSpan`, that helper invokes its callback synchronously, and `fillPlaceholders` is its first statement. The wrapper therefore captures the delegated promise INSIDE the `try` and lets the caller await it AFTER the `finally` — `return await original.call(...)` inside the try would hold the flag across the whole round trip and silently re-corrupt a concurrent non-placeholder write
- `packages/drizzle/tests/drizzle-orm-shape.test.ts` pins every one of those structural assumptions and fails naming the fix file; `package.json` declares `^0.44.7`, a caret, so a minor bump can land without a code change

</llm-only>

### Relations

```typescript
// schema/posts.ts
import { pgTable, text, integer, timestamp } from '@onebun/drizzle/pg';
import { relations } from '@onebun/drizzle';
import { users } from './users';

export const posts = pgTable('posts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  content: text('content'),
  authorId: integer('author_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));
```

### Index Schema

```typescript
// schema/index.ts
export * from './users';
export * from './posts';
```

## DrizzleService

### Connection Lifecycle

`DrizzleService` implements `OnModuleDestroy` and closes its connection when the application stops, so `app.stop()` releases the database client rather than leaving it open for the lifetime of the process.

```typescript
const app = new OneBunApplication(AppModule);
await app.start();
// ... the service holds an open client
await app.stop();
// the client is closed and the service reports no connection
```

Before 0.4.5 nothing in the lifecycle called `close()`, so a service built by one test suite kept its connection open into the next — the mechanism behind a suite failing with `database "..." does not exist` after an earlier suite dropped its throwaway database.

### Startup Contract

**A configured database is a required one.** When an application configures a database — `DrizzleModule.forRoot({ connection })`, or `DB_URL` in the environment — the service checks at startup that it can actually be used, and `app.start()` **rejects** when it cannot. The HTTP server never binds, so an orchestrator sees a container that refuses to come up instead of one that passes readiness and then fails every request that touches the database.

Three failures reach `app.start()`:

| What failed | SQLite | PostgreSQL |
|---|---|---|
| The database cannot be opened | the file cannot be created or written — the error names the missing directory, or the permission | the connection options do not describe a server |
| The database does not answer | — (opening the file is the check) | a bounded `SELECT 1` — the connection is otherwise lazy and nothing would touch the server until the first request |
| A migration failed | a migration file that exists failed to apply | same |

```typescript
const app = new OneBunApplication(AppModule);

await app.start();
// rejects with DrizzleStartupError when the configured database is unreachable:
//   PostgreSQL at postgresql://app:***@db:5432/orders did not answer SELECT 1 within the
//   5000ms connect timeout (waited 5001ms): Connection closed. A configured database is a
//   required one, so the application does not start without it. Set
//   `allowDegradedStart: true` in DrizzleModule.forRoot(...) (or DB_ALLOW_DEGRADED_START=true
//   on the environment path) to start anyway and accept a database that is absent,
//   unreachable or unmigrated.
```

The error is a `DrizzleStartupError` carrying `stage` (`'open' | 'connect' | 'migrate'`), `target`, `waitedMs` and `timeoutMs`. **The password is never printed** — not in the error, not in the log line that names the connection.

**The connect probe is bounded.** A host that accepts the connection and never answers — a dropped route, a stalled proxy — would otherwise hold `start()` open forever. The bound is `pool.timeout` (milliseconds) when the connection options carry one, and 5000 ms otherwise; the error states which applied. That is the same number the driver gets as its own connect timeout — see [`pool`](#postgresql-connection).

**What does not fail.** An application that configures no database at all is untouched: no connection is opened and nothing is checked. A missing migrations folder is *no migrations*, not a failure — `migrationsFolder` defaults to `./drizzle`, and an application that has never generated a migration starts normally.

#### allowDegradedStart

One option opts out, and it means "I accept a degraded or absent database at boot" — not "skip the check". The check still runs and still reports; the failure is logged at `warn` and the application starts anyway.

```typescript
DrizzleModule.forRoot({
  connection: { /* ... */ },
  // The database may be absent at boot: the application starts, and every request that
  // touches the database fails until it is available.
  allowDegradedStart: true,
})
```

On the environment path the same switch is `DB_ALLOW_DEGRADED_START=true` (with the configured `envPrefix`). Module options are code, so an application configured through `forRoot()` takes the option and ignores the variable.

<llm-only>
**Technical details for AI agents:**
- The failure is raised from `DrizzleService.onModuleInit()` — which `OneBunModule.callServicesOnModuleInit()` awaits — so it propagates out of `app.start()` before `Bun.serve()` is called. It is not a fire-and-forget promise: that was the defect (`autoInitialize()` swallowed everything, the module-options path at `warn` and the `DB_URL` path at `debug`)
- The rejection reaching `await app.start()` is Effect's `FiberFailure` wrapper carrying the `DrizzleStartupError`'s message, so match on the message there; `instanceof DrizzleStartupError` holds on what `onModuleInit()` itself throws
- The reachability check runs INDEPENDENTLY of `autoMigrate`. `autoMigrate: false` is the documented recommendation for production, and before this contract that path never touched the server at all
- PostgreSQL: `drizzle(url)` from `drizzle-orm/bun-sql` is lazy — no socket is opened until the first query — so the probe is what makes an unreachable server visible at boot
- SQLite: `SQLITE_CANTOPEN` covers both "the directory does not exist" and "the directory is there and unwritable"; the service asks the file system directly and says which one. A write pragma against a read-only database fails after a successful open and is reported as the pragma it was
- The bound comes from `connection.options.pool.timeout` (ms) or `DEFAULT_STARTUP_PROBE_TIMEOUT_MS` (5000). On timeout the in-flight query is left settled with a no-op catch, so it cannot surface as an unhandled rejection
- The same `pool.timeout` also becomes the driver's `connectionTimeout` via `poolDriverOptions()`, so the probe cannot outlive the connect it is probing. The probe default (5000 ms) and the driver default (30000 ms) differ only when neither is configured
- On the fatal path the service closes whatever it opened before rethrowing, so a refused boot leaves no socket or file handle behind
- `allowDegradedStart` is read from module options on the `forRoot()` path and from `<PREFIX>_ALLOW_DEGRADED_START` on the environment path. The variable is read straight from `process.env` rather than through the env schema, so it still works when parsing the rest of the configuration is what failed
</llm-only>

### Injection

```typescript
import { Service, BaseService } from '@onebun/core';
import { DrizzleService } from '@onebun/drizzle';

@Service()
export class UserService extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }
}
```

### Type Inference

DrizzleService automatically infers database types from table schemas. No generic parameter is required:

```typescript
import { sqliteTable, integer, text } from '@onebun/drizzle/sqlite';
import { pgTable, text as pgText, integer as pgInteger } from '@onebun/drizzle/pg';

// SQLite table
const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

// PostgreSQL table
const orders = pgTable('orders', {
  id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
  total: pgInteger('total').notNull(),
});

@Service()
export class MyService extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async getUsers() {
    // TypeScript infers SQLite types from `users` table
    return this.db.select().from(users);
  }

  async getOrders() {
    // TypeScript infers PostgreSQL types from `orders` table
    return this.db.select().from(orders);
  }
}
```

<llm-only>
**Technical details for AI agents:**
- `DrizzleService` no longer has a generic type parameter
- Types are inferred at the `from()` call site based on table type
- `UniversalSelectBuilder` uses function overloads to return correct result types
- For `insert()`, `update()`, `delete()` - types are inferred from the table argument
- This approach eliminates the need for generic syntax like `DrizzleService&lt;DatabaseType.SQLITE&gt;`
- The `UniversalTransactionClient` provides the same API inside transactions
</llm-only>

### Query Methods

DrizzleService provides direct access to Drizzle ORM query builders:

#### select()

Create a SELECT query.

```typescript
// Select all columns
const allUsers = await this.db.select().from(users);

// Select specific columns
const names = await this.db.select({ name: users.name, email: users.email }).from(users);

// Select with conditions
import { eq } from '@onebun/drizzle';

const user = await this.db.select()
  .from(users)
  .where(eq(users.id, id))
  .limit(1);
```

#### insert()

Create an INSERT query.

```typescript
// Insert single row
await this.db.insert(users).values({ name: 'John', email: 'john@example.com' });

// Insert with returning
const [newUser] = await this.db.insert(users)
  .values({ name: 'John', email: 'john@example.com' })
  .returning();

// Insert multiple rows
await this.db.insert(users).values([
  { name: 'John', email: 'john@example.com' },
  { name: 'Jane', email: 'jane@example.com' },
]);
```

#### update()

Create an UPDATE query.

```typescript
import { eq } from '@onebun/drizzle';

// Update rows
await this.db.update(users)
  .set({ name: 'Jane' })
  .where(eq(users.id, id));

// Update with returning
const [updated] = await this.db.update(users)
  .set({ name: 'Jane' })
  .where(eq(users.id, id))
  .returning();
```

#### delete()

Create a DELETE query.

```typescript
import { eq } from '@onebun/drizzle';

// Delete rows
await this.db.delete(users).where(eq(users.id, id));

// Delete with returning
const [deleted] = await this.db.delete(users)
  .where(eq(users.id, id))
  .returning();
```

#### transaction()

Execute queries in a transaction. The transaction callback receives a `UniversalTransactionClient` with the same API as `DrizzleService`.

<!-- typecheck: skip -->
```typescript
async transaction<T>(
  fn: (tx: UniversalTransactionClient) => Promise<T>
): Promise<T>
```

```typescript
const result = await this.db.transaction(async (tx) => {
  // All queries in this block are in a transaction
  // tx has the same methods as DrizzleService: select(), insert(), update(), delete()
  const user = await tx.insert(users)
    .values({ name: 'John', email: 'john@example.com' })
    .returning();

  await tx.insert(profiles)
    .values({ userId: user[0].id, bio: 'Hello' });

  return user[0];
});
```

The callback may `await` freely. If it throws, the whole transaction is rolled back and the
original error reaches the caller — on both dialects:

```typescript
try {
  await this.db.transaction(async (tx) => {
    await tx.insert(users).values({ name: 'John', email: 'john@example.com' });
    await someSlowCheck();                 // an await in the middle changes nothing
    throw new Error('changed my mind');
  });
} catch (error) {
  // error.message === 'changed my mind', and no user row was written
}
```

**Anything called from inside the callback is in the transaction, on both dialects.** A query
issued through the service, a repository method, a call into another service — all of them run
on the open transaction and are rolled back with it. Nothing has to be rewritten to take `tx`:

```typescript
await this.db.transaction(async () => {
  await this.orders.create(order);        // repository — in the transaction
  await this.orderItems.createMany(items); // another repository — same transaction

  throw new Error('nope');                 // rolls back BOTH
});
```

::: warning This used to be dialect-dependent
On PostgreSQL a repository call inside the callback used to take another pooled connection, so
its writes survived the ROLLBACK — silently, with no error and no warning, showing up only as
inconsistent data afterwards. On SQLite the same code was already correct. If you added a `tx`
argument to work around it, that still works and still means the same thing.
:::

##### SQLite

SQLite has a single connection, so a transaction owns the database for its whole duration:

- **Rollback works across awaits.** The transaction is issued as `BEGIN` / `COMMIT` |
  `ROLLBACK`, not through drizzle's synchronous bun-sqlite transaction, which would have
  committed at the callback's first `await`.
- **Other queries are queued, not enrolled.** A query issued elsewhere in the application
  while the transaction is open waits for it, then runs after the `COMMIT` or `ROLLBACK`. It
  is never rolled back together with the transaction that was in flight.
- **Two transactions are serialized.** The second one waits for the first; both commit.
- **A query issued through the service from inside the callback runs ON the transaction.**
  A repository method — or any code holding `DrizzleService` rather than the `tx` argument —
  does not have to be rewritten to take part: it is issued on the open transaction, and is
  rolled back with it. Only a NESTED `transaction()` is refused, because it would wait for a
  connection its own caller is holding:

```typescript
await this.db.transaction(async (tx) => {
  await tx.insert(users).values({ name: 'John', email: 'john@example.com' });

  // Runs on the same transaction, and is undone with it.
  await this.userRepository.create({ name: 'Jane', email: 'jane@example.com' });

  // Throws DrizzleTransactionError (code 'SQLITE_TRANSACTION_NESTED')
  await this.db.transaction(async () => { /* ... */ });
});
```

Work that OUTLIVES the transaction it was started in is not routed onto it — once the
transaction has ended, such a statement queues like any other bystander.

The error carries `name === 'DrizzleTransactionError'` and one of the codes
`SQLITE_TRANSACTION_NESTED` or `SQLITE_TRANSACTION_SYNC_QUERY` — the latter for a
synchronous `.get()`, `.all()`, `.run()` or `.values()` issued by a CONCURRENT caller while
a transaction holds the connection, which cannot be queued because it returns rows rather
than a promise.

##### PostgreSQL

The transaction runs on its own pooled connection through drizzle's own `transaction()`.
Nothing is queued and nothing is refused — concurrent queries use other connections, and the
re-entrancy errors above cannot occur.

- **A query issued through the service or a repository from inside the callback runs ON the
  transaction**, exactly as on SQLite, and is rolled back with it.
- **A nested `transaction()` is a SAVEPOINT.** It runs on the connection the outer one already
  holds, so it sees the outer's uncommitted rows, an inner rollback keeps the outer work, and
  an outer rollback undoes everything. Before this it took a second connection and began an
  independent transaction — one that could block on the locks its own caller held.
- **`Promise.all` inside the callback is safe, and is not parallel.** One connection runs one
  statement at a time; the driver queues them rather than failing.
- **Work that OUTLIVES the transaction goes back to the pool.** A statement issued after the
  callback has returned is not put on the finished transaction — it would land on whatever
  connection the pool has since handed that transaction's slot to, and be rolled back by
  somebody else's failure.
- **Concurrent transactions are independent.** Routing is keyed by async context, so two
  overlapping callbacks each see only their own uncommitted rows, one rollback never touches
  the other's writes, and a query issued outside any transaction goes to the pool even while
  one is open. Two `DrizzleService` instances never see each other's transactions either,
  including against the same database.

<llm-only>
**Technical details for AI agents:**
- The SQLite path is `DrizzleService.runSQLiteTransaction()`: `sqliteGate.acquire()` →
  `BEGIN` → callback → `COMMIT`, or `ROLLBACK` when the callback rejects, with the gate
  released in a `finally` so both outcomes free the connection.
- `getDatabase()` on SQLite returns a gated view of the database: builders it produces
  intercept `then` and wait for the gate at execution time, since drizzle's builders are
  lazy and the statement runs inside `then()`. Measured cost 0.17-0.27us per query.
- Re-entrancy is detected with `AsyncLocalStorage`; the store is inherited by everything
  created inside the callback, so "concurrent" means an async context that began outside it.
- `getSQLiteDatabase()`, `getSQLiteClient()` and `.prepare()` are ungated escape hatches:
  statements issued through them during a transaction join it and are rolled back with it.
- On PostgreSQL `getDatabase()` returns `createTransactionAwareDatabase(db, ambient)` — the
  drizzle instance as prototype with the query entry points redefined to ask an
  `AsyncLocalStorage` at CALL time which client the statement belongs on. Call time is what
  makes a repository work: it captured the object in its constructor, long before any
  transaction existed
- The store holds a mutable cell, not a bare handle, and the cell is closed in a `finally`
  when the transaction ends. Without that, work the callback left running would be issued on
  a finished handle — measured: with `max: 1` the row it wrote was deleted by the ROLLBACK of
  an unrelated transaction that had since taken the connection
- `DrizzleService.transaction()` dispatches on the ambient transaction when there is one, so a
  nested call is drizzle's own `tx.transaction()` — a SAVEPOINT — rather than a second pooled
  connection. `tx.getRawTransaction().transaction(...)` remains available and is the same thing
- The store is keyed by the owning `AmbientTransaction` instance, so two `DrizzleService`s (two
  databases) never see each other's transactions
</llm-only>

## BaseRepository

For common CRUD operations:

```typescript
import { BaseRepository, DrizzleService, eq } from '@onebun/drizzle';
import { users, type User, type InsertUser } from './schema';

export class UserRepository extends BaseRepository<typeof users> {
  constructor(db: DrizzleService) {
    super(db, users);
  }

  // Inherited methods — ONE type argument, the table; the row and insert types are derived
  // from it, so `User` and `InsertUser` are not passed in:
  // findAll(): Promise<User[]>                    // the whole table — no pagination
  // findById(id: unknown): Promise<User | null>
  // create(data: Partial<InsertUser>): Promise<User>
  // update(id: unknown, data: Partial<InsertUser>): Promise<User | null>
  // delete(id: unknown): Promise<boolean>
  // count(): Promise<number>                      // findAll().length, so O(rows) in memory
  // transaction<R>(cb: (tx: UniversalTransactionClient) => Promise<R>): Promise<R>

  // Custom methods go through the inherited `drizzleService`, NOT `this.db`: `this.db` is the
  // raw dialect union, whose `.from()` has no callable signature.
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.drizzleService.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return result[0] ?? null;
  }
}
```

`findAll()` takes no arguments and returns the entire table; `count()` loads it to measure it.
For a page, or a count that does not read every row, query through `DrizzleService` instead —
[Basic Queries](#basic-queries) shows both the `.limit()` / `.offset()` form and a `count(*)`
projection.

**A repository is not a provider.** `BaseRepository` resolves the database in its constructor,
and every provider is constructed before `DrizzleService` has opened one — so a repository
carrying `@Service()` fails to construct with `Database not initialized. Call initialize()
first.` If anything injects it, `app.start()` then rejects with a `CircularDependencyError`
naming the CONSUMER, not the repository; if nothing does, the application boots with the
repository silently absent from DI. Construct it after the database is up instead — lazily on
first use, or in `onApplicationInit()` — from a service that holds `DrizzleService`.

```typescript
@Service()
export class UserService extends BaseService {
  private repository: UserRepository | null = null;

  constructor(private db: DrizzleService) { super(); }

  private repo(): UserRepository {
    this.repository ??= new UserRepository(this.db);

    return this.repository;
  }

  async byEmail(email: string): Promise<User | null> {
    return await this.repo().findByEmail(email);
  }
}
```

## Query Examples

### Dialect Resolution

`select()`, `selectDistinct()`, `insert()`, `update()` and `delete()` accept a table of
either dialect and resolve to that dialect's own query builder. On PostgreSQL that means the
whole chain is typed and reachable:

```typescript
await this.db.select().from(runs).where(eq(runs.id, id)).limit(1);
await this.db.select({ id: outbox.id }).from(outbox).limit(10).for('update', { skipLocked: true });
await this.db.update(runs).set({ status: 'running' }).where(eq(runs.id, id)).returning({ id: runs.id });
```

`.limit()`, `.offset()`, `.orderBy()`, `.for()`, `.$dynamic()` and a projected `.returning(fields)`
are all available on the PostgreSQL path, and SQLite tables continue to resolve to the SQLite
builders.

For anything the universal surface does not model — a PostgreSQL-only feature, or a raw
`sql` construction against the typed schema — `getPostgreSQLDatabase()` and
`getSQLiteDatabase()` return the underlying dialect-specific drizzle instance. Both throw if
the configured database is of the other type.

```typescript
const pg = this.db.getPostgreSQLDatabase();
await pg.execute(sql`REFRESH MATERIALIZED VIEW ${sql.identifier('run_stats')}`);
```

<llm-only>

**Technical details for AI agents — dialect resolution:**
- `SQLiteTable<any>` and `PgTable<any>` do NOT discriminate: a `pgTable` satisfies `SQLiteTable<any>` and a `sqliteTable` satisfies `PgTable<any>`. Overload ordering therefore cannot separate them where the constraint carries `<any>` — whichever is declared first captures every table
- The BARE constraints behave differently and asymmetrically: bare `PgTable` is dialect-branded and rejects a SQLite table, while bare `SQLiteTable` accepts a PostgreSQL one. That asymmetry is what makes declaration order work for `insert`/`update`/`delete`, whose overloads use the bare forms — PostgreSQL is declared FIRST there on purpose
- `select().from()` cannot be fixed that way, because its constraints are the `<any>` forms. It uses ONE generic signature with a conditional return type instead, keyed on `DialectOf<TTable>` — which reads the `dialect` brand ('pg' | 'sqlite') off the table's own column map
- `PgSelectQueryResult` is instantiated to match what `BunSQLDatabase.select().from()` returns, so the PostgreSQL chain is drizzle's real `PgSelectBase` rather than the previous hand-written `Promise & { where }`, which ended the chain after one call
- The regression guard is `packages/drizzle/tests/dialect-resolution.test-d.ts`, gated by `bun run typecheck`. It is named `.test-d.ts` so `bun test` does not collect it: the defect is invisible at runtime, since the queries ran correctly while the API was untypeable
- `getPostgreSQLDatabase()` / `getSQLiteDatabase()` are supported escape hatches, not internal.

</llm-only>

### Basic Queries

```typescript
// Select specific columns
const names = await this.db.select({ name: users.name, email: users.email }).from(users);

// Count
import { sql } from '@onebun/drizzle';
const countResult = await this.db.select({ count: sql`count(*)` }).from(users);

// Order and limit
import { desc } from '@onebun/drizzle';
const recentUsers = await this.db.select()
  .from(users)
  .orderBy(desc(users.createdAt))
  .limit(10);

// Pagination
const page = 1;
const pageSize = 10;
const offset = (page - 1) * pageSize;

const pagedUsers = await this.db.select()
  .from(users)
  .limit(pageSize)
  .offset(offset);
```

### Filtering

```typescript
import { eq, ne, gt, gte, lt, lte, like, ilike, and, or, not, isNull, isNotNull, inArray, notInArray } from '@onebun/drizzle';

// Equal
const user = await this.db.select().from(users).where(eq(users.id, '123'));

// Multiple conditions (AND)
const admins = await this.db.select().from(users).where(
  and(
    eq(users.role, 'admin'),
    eq(users.active, true)
  )
);

// OR conditions
const filtered = await this.db.select().from(users).where(
  or(
    eq(users.role, 'admin'),
    eq(users.role, 'moderator')
  )
);

// LIKE
const searchResults = await this.db.select().from(users).where(
  like(users.name, '%john%')
);

// IN array
const specific = await this.db.select().from(users).where(
  inArray(users.id, ['1', '2', '3'])
);

// NULL checks
const noAge = await this.db.select().from(users).where(
  isNull(users.age)
);
```

### Joins

```typescript
// Inner join
const postsWithAuthors = await this.db.select()
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id));

// Left join
const usersWithPosts = await this.db.select()
  .from(users)
  .leftJoin(posts, eq(users.id, posts.authorId));
```

### Aggregations

```typescript
import { sql, count, sum, avg, min, max } from '@onebun/drizzle';

// Count
const total = await this.db.select({ count: count() }).from(users);

// Group by
const postsByUser = await this.db.select({
  authorId: posts.authorId,
  postCount: count(),
})
  .from(posts)
  .groupBy(posts.authorId);

// Sum
const totalSales = await this.db.select({
  total: sum(orders.amount),
}).from(orders);
```

## Migrations

OneBun uses Drizzle ORM migrations. Typical workflow:

1. **Generate migrations** - Create SQL files from schema changes (CLI)
2. **Apply migrations** - Run migrations on app startup (automatic or manual)

### Generate Migrations (CLI)

Create a `drizzle.config.ts` in your project root:

```typescript
// drizzle.config.ts
import { defineConfig } from '@onebun/drizzle';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql', // or 'sqlite'
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Then run from terminal using `onebun-drizzle` CLI wrapper (ensures correct version):

```bash
# Generate migration after schema changes
bunx onebun-drizzle generate

# Push schema directly to DB (development only, no migration files)
bunx onebun-drizzle push

# Open Drizzle Studio to browse database
bunx onebun-drizzle studio
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "db:generate": "onebun-drizzle generate",
    "db:push": "onebun-drizzle push",
    "db:studio": "onebun-drizzle studio"
  }
}
```

> **Note**: Use `onebun-drizzle` instead of `drizzle-kit` directly. This ensures the correct version of drizzle-kit is used (the one installed with `@onebun/drizzle`).

### Programmatic Generation (Optional)

For build scripts or CI pipelines, use programmatic API:

```typescript
import { generateMigrations, pushSchema } from '@onebun/drizzle';

// Generate migration files
await generateMigrations({
  schemaPath: './src/schema',
  migrationsFolder: './drizzle',
  dialect: 'postgresql',
});

// Push schema directly (development only)
await pushSchema({
  schemaPath: './src/schema',
  dialect: 'postgresql',
  connectionString: process.env.DATABASE_URL,
});
```

### Apply Migrations at Runtime

Use `DrizzleService.runMigrations()` to apply migrations when the application starts:

```typescript
// Manual migration
const drizzleService = new DrizzleService();
await drizzleService.initialize({ /* connection options */ });
await drizzleService.runMigrations({ migrationsFolder: './drizzle' });
```

A manual `runMigrations()` requires the folder to exist: against one with no
`meta/_journal.json` it throws drizzle-orm's `Error: Can't find meta/_journal.json file` — a
plain `Error`, not a `DrizzleStartupError`, so it carries none of the folder/target context the
[Startup Contract](#startup-contract) promises. Guard the call, or let `autoMigrate` run it. The
same applies to the two calls under [One Journal Per Migration Set](#one-journal-per-migration-set).

Or enable automatic migrations in module configuration:

```typescript
DrizzleModule.forRoot({
  connection: { /* ... */ },
  // autoMigrate defaults to true — migrations run on startup automatically
  migrationsFolder: './drizzle',  // Migration files location
})
```

**A migration that fails fails the boot.** `app.start()` rejects with a `DrizzleStartupError` naming the folder and the SQL error, and the HTTP server never binds — a half-applied schema is not a state to serve traffic in. **On the startup path**, a migrations folder that does not exist is *no migrations* and is not a failure: `./drizzle` is the default, an application that has never generated one boots normally, and the skipped step is logged — `No migrations to run: "drizzle/meta/_journal.json" does not exist`, at `debug` for the default folder and at `warn` for one you configured explicitly. That exemption is the startup path's alone — the manual `runMigrations()` above throws.

The database is checked for reachability whether or not migrations run, so `autoMigrate: false` — the recommendation for production, where migrations are a deploy step — still refuses to start against a database that is not there. See [Startup Contract](#startup-contract), including the `allowDegradedStart` opt-out.

### One Journal Per Migration Set

A package that ships migrations of its own needs its own journal table:

```typescript
// The application's own set — default journal
await drizzleService.runMigrations({ migrationsFolder: './drizzle' });

// A package's set — its own journal, independent of the application's
await drizzleService.runMigrations({
  migrationsFolder: './node_modules/@acme/durable/migrations',
  migrationsTable: '__drizzle_migrations_durable',
});
```

**Why this is not optional.** Drizzle decides whether to apply a migration by comparing the
timestamp baked into its folder against the **newest row** in the journal — never by hash.
So when two folders share one journal, whichever set was generated earlier is skipped
entirely: no error, no log, and the application starts and then fails at the first query
against a table that was never created.

To make that impossible to hit by accident, a second migration folder that would share a
journal with the first is refused at the point of the call, naming both folders and the
option that separates them. Several journals in one process is the supported shape; several
**folders** sharing one journal is not.

`migrationsSchema` names the schema holding the journal (PostgreSQL only — SQLite has no
schemas and the option is ignored there). Both default to drizzle's own
`drizzle.__drizzle_migrations`.

Migrations whose entries end up neither applied nor already recorded are reported with a
`warn` naming each file, so a skipped set is visible even where it is legitimate.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_TYPE` | `sqlite` or `postgresql` | `sqlite` |
| `DB_URL` | Connection URL — a file path for SQLite, a full `postgresql://…` for PostgreSQL | — (none: unset means no database) |
| `DB_AUTO_MIGRATE` | Auto-run migrations on startup | `true` |
| `DB_MIGRATIONS_FOLDER` | Path to migrations folder | `'./drizzle'` |
| `DB_MIGRATIONS_TABLE` | Journal table recording applied migrations | `'__drizzle_migrations'` |
| `DB_MIGRATIONS_SCHEMA` | Schema holding the journal (PostgreSQL only) | `'drizzle'` |
| `DB_SCHEMA_PATH` | Path to schema files | - |
| `DB_ALLOW_DEGRADED_START` | Start even when the configured database cannot be reached ([Startup Contract](#startup-contract)) | `false` |

`migrationsTable` and `migrationsSchema` are also accepted by `DrizzleModule.forRoot()` and
are forwarded on every path that runs migrations, including automatic ones.

`DB_TYPE` and `DB_URL` are the environment equivalent of `connection` in
`DrizzleModule.forRoot()`: set them and the service initializes itself with no module
configuration at all. On PostgreSQL the URL reaches the driver untouched, so its query
parameters are preserved.

`DB_URL` has no default. Unset, empty or whitespace-only is *not configured* rather than
`:memory:`: no connection is opened, `app.start()` succeeds, and every `getDatabase()` throws
`Database not initialized. Call initialize() first.` — see [Startup Contract](#startup-contract).
The only surviving `:memory:` fallback is the drizzle-kit config that `pushSchema()` generates.

### Migration Tracking

Drizzle automatically tracks applied migrations in the journal table. This ensures:
- Migrations are only applied once (idempotency)
- Running `runMigrations()` multiple times is safe
- No duplicate table creation errors

### Migration Logging

When migrations are applied, the service logs each migration filename:

```
info: Applied migration: 0001_initial_schema
info: Applied migration: 0002_add_users_table
info: SQLite migrations applied { migrationsFolder: './drizzle', newMigrations: 2, appliedFiles: ['0001_initial_schema', '0002_add_users_table'] }
```

If no new migrations need to be applied:

```
info: SQLite migrations applied { migrationsFolder: './drizzle', newMigrations: 0, appliedFiles: [] }
```

<llm-only>
**Technical details for AI agents:**
- `generateMigrations()` creates a temporary `drizzle.config.temp.ts` file and runs `bunx drizzle-kit generate`
- `pushSchema()` runs `bunx drizzle-kit push:sqlite` or `push:pg` depending on dialect
- `runMigrations()` uses drizzle-orm's `migrate()` function from `drizzle-orm/bun-sqlite/migrator` or `drizzle-orm/bun-sql/migrator`
- Migration files are stored in the format: `{migrationsFolder}/NNNN_migration_name.sql` with `meta/_journal.json` for tracking
- The journal table schema: `id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER`
- Migration hash is SHA-256 of the SQL file content, used to match applied migrations with journal entries
- `readMigrationJournal()` reads `meta/_journal.json` and computes hashes for each migration file
- `getAppliedMigrationHashes(table, schema)` queries the configured journal before and after running migrations to determine which were newly applied. It is ASYNC: Bun's SQL template returns a lazy thenable, and the earlier synchronous version read `.length` off a promise, so the PostgreSQL path always reported zero applied migrations regardless of what ran
- On PostgreSQL the existence probe is schema-qualified against `information_schema.tables`; an unqualified name never matched, because drizzle puts the journal in its own schema
- `migrationsTable`/`migrationsSchema` are validated against `/^[A-Za-z_][A-Za-z0-9_$]*$/` before use — an identifier cannot be a bound parameter, so it reaches the query as text
- `assertJournalNotShared()` keys a per-service map on `schema.table` and throws when a second, different `migrationsFolder` claims a journal another folder already owns. Re-running the SAME folder is idempotent and does not throw
- Drizzle's own selection rule is `!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis` against the single newest journal row — the hash is written but never used for filtering, which is why journal sharing loses migrations rather than merely reordering them
</llm-only>

## Complete Example

```typescript
// schema/index.ts
import { pgTable, text, timestamp, integer } from '@onebun/drizzle/pg';
import { relations } from '@onebun/drizzle';

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const posts = pgTable('posts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  content: text('content'),
  authorId: integer('author_id').notNull().references(() => users.id),
  views: integer('views').default(0),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type InsertPost = typeof posts.$inferInsert;

// user.repository.ts
import { Service, BaseService } from '@onebun/core';
import { DrizzleService, eq } from '@onebun/drizzle';
import { users, type User, type InsertUser } from './schema';

@Service()
export class UserRepository extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findAll(): Promise<User[]> {
    return this.db.select().from(users);
  }

  async findById(id: number): Promise<User | null> {
    const result = await this.db.select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] || null;
  }

  async create(data: InsertUser): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async update(id: number, data: Partial<InsertUser>): Promise<User | null> {
    const result = await this.db.update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    return result[0] || null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.delete(users)
      .where(eq(users.id, id))
      .returning();
    return result.length > 0;
  }
}

// user.service.ts
@Service()
export class UserService extends BaseService {
  constructor(
    private userRepository: UserRepository,
    private cacheService: CacheService,
  ) {
    super();
  }

  async findById(id: number): Promise<User | null> {
    const cacheKey = `user:${id}`;
    const cached = await this.cacheService.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.userRepository.findById(id);
    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300_000 }); // 5 minutes
    }

    return user;
  }

  async create(data: InsertUser): Promise<User> {
    // Check for duplicate email
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) {
      throw new Error('Email already exists');
    }

    return this.userRepository.create(data);
  }
}

// user.module.ts
import { Module } from '@onebun/core';
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';
import { CacheModule, CacheType } from '@onebun/cache';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: {
          connectionString: config.get('database.url'),
        },
      },
      migrationsFolder: './drizzle',
    }),
    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { defaultTtl: 300000 } }),
  ],
  controllers: [UserController],
  providers: [UserService, UserRepository],
})
export class UserModule {}
```

## Testing

### Testing with DrizzleService

For testing services that depend on DrizzleService, use in-memory SQLite database:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Effect } from 'effect';
import { makeMockLoggerLayer, createMockConfig } from '@onebun/core/testing';
import { LoggerService } from '@onebun/logger';
import { DrizzleService, DrizzleModule, DatabaseType } from '@onebun/drizzle';

describe('MyService', () => {
  let drizzleService: DrizzleService;

  beforeEach(async () => {
    // Clear any previous configuration
    DrizzleModule.clearOptions();

    // Configure with in-memory database
    // Note: autoMigrate defaults to true; with no migrations folder it is a no-op
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: { url: ':memory:' },
      },
      autoMigrate: false, // optional — this test creates its tables itself
    });

    // Create and initialize service
    const loggerLayer = makeMockLoggerLayer();
    const logger = Effect.runSync(
      Effect.provide(
        Effect.map(LoggerService, (l) => l),
        loggerLayer,
      ),
    );

    // No generic parameter needed - types are inferred from table schemas
    drizzleService = new DrizzleService();
    drizzleService.initializeService(logger, createMockConfig());
    // onModuleInit() is called automatically by the framework
    // In tests, call it manually to simulate framework behavior
    await drizzleService.onModuleInit();

    // Create test tables manually (this test ships no migrations)
    const sqliteClient = drizzleService.getSQLiteClient();
    sqliteClient!.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);
  });

  afterEach(async () => {
    await drizzleService.close();
    DrizzleModule.clearOptions();
  });

  test('should perform database operations', async () => {
    const db = drizzleService.getDatabase();
    expect(db).toBeDefined();
  });
});
```

### Testing with Auto-migrations

Migrations run automatically by default. To test with migrations:

```typescript
import { join } from 'path';

beforeEach(async () => {
  DrizzleModule.forRoot({
    connection: {
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    },
    // autoMigrate defaults to true, so migrations run automatically
    migrationsFolder: join(__dirname, 'test-migrations'),
  });

  // ... create and initialize service
  await drizzleService.onModuleInit();

  // Tables from migrations should now exist
  const sqliteClient = drizzleService.getSQLiteClient();
  const tables = sqliteClient!.query(`
    SELECT name FROM sqlite_master WHERE type='table' AND name='users'
  `).all();
  expect(tables.length).toBe(1);
});
```

### Testing Environment Variables

The service auto-initializes from environment variables. For testing:

```typescript
beforeEach(async () => {
  // Clear previous state
  DrizzleModule.clearOptions();
  delete process.env.DB_URL;
  delete process.env.DB_TYPE;
  delete process.env.DB_AUTO_MIGRATE;

  // Set test environment
  process.env.DB_URL = ':memory:';
  process.env.DB_TYPE = 'sqlite';
  process.env.DB_AUTO_MIGRATE = 'false'; // optional: skips the migration step (a missing folder is already a no-op)

  // Create service - will auto-initialize from env vars
  // No generic parameter needed
  drizzleService = new DrizzleService();
  drizzleService.initializeService(logger, createMockConfig());
  await drizzleService.onModuleInit();
});

afterEach(() => {
  // Cleanup
  delete process.env.DB_URL;
  delete process.env.DB_TYPE;
  delete process.env.DB_AUTO_MIGRATE;
});
```

### Key Testing Notes

1. **Call `onModuleInit()` in tests** - this triggers async initialization that the framework does automatically
2. **Use `DrizzleModule.clearOptions()`** in beforeEach/afterEach to ensure test isolation
3. **Clean up environment variables** when testing env-based initialization
4. **Use `:memory:`** SQLite URL for in-memory databases that are faster and don't leave files
5. **autoMigrate defaults to `true`** - a missing migrations folder is *no migrations*, not a failure, so leaving it on is safe; `false` skips only the migration step, not the reachability check (see [Startup Contract](#startup-contract))
6. **Database is ready after `onModuleInit()`** - no need to call `waitForInit()` in client code
7. **No generic parameter needed** - `DrizzleService` infers types from table schemas automatically
