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

`pool` is accepted alongside either shape.

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

::: danger Multiple databases are not supported yet
Separate instances do **not** mean separate configuration. `forRoot()` stores its options on the `DrizzleModule` class, which the whole process shares, so every instance reads the same — last-written — configuration. Two `forRoot()` calls with two different databases give you two `DrizzleService` instances **both connected to whichever was evaluated last**, silently: nothing errors, and which one wins depends on module evaluation order.

Earlier releases documented exactly that arrangement as the way to run a main and an analytics database. It never worked: both services end up on ONE of the two databases, and which one depends on the order the modules were evaluated in — not on the order you declared them, so it is not reliably the one you would guess. **If you followed it, audit both databases**: the writes are all in one of them.

The boundary is the PROCESS, not the application. A second `OneBunApplication` does not help: each builds its own `DrizzleService`, but both read the same class-static options, so two applications declaring two different databases both connect to the last one — measured, including in multi-service mode.

**If you need a second database today**, build the service yourself rather than through `forRoot()`: `new DrizzleService()` followed by `initialize(connection)` takes its options directly and is unaffected by the shared slot (see [Apply Migrations at Runtime](#apply-migrations-at-runtime) for the same construction). Such an instance is yours to hold — it is not injectable by type, since `DrizzleService` resolves to the module-configured one. A first-class mechanism for configuring a module more than once is being built; treat the manual route as the interim answer, not the destination.
:::

### forFeature() Method

When `DrizzleModule` is not global (`isGlobal: false`), a submodule must import it to reach `DrizzleService`: a non-global service does not travel down the module tree, and `exports` travels up to the importing module rather than down to children. `forFeature()` is that import:

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
- `isGlobal: false` - requires an explicit import; the instance count is unchanged (one per application). NOT a multi-database mechanism: `forRoot()` stores options on the module CLASS, so every instance reads the same last-written configuration
- `forFeature()` simply returns the DrizzleModule class, so it is an ordinary import. A module class is constructed ONCE per application, so every importer shares one DrizzleService
- Global services are stored in the application's scope and automatically injected into all its modules
- When `isGlobal: false` is set, the module is removed from the global registry via `removeFromGlobalModules()`, which is process-wide and permanent: one such call de-globalizes the module for every application in the process, and `forRoot({ isGlobal: true })` does not restore it
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

## BaseRepository

For common CRUD operations:

```typescript
import { BaseRepository } from '@onebun/drizzle';
import { users, type User, type InsertUser } from './schema';

@Service()
export class UserRepository extends BaseRepository<typeof users, User, InsertUser> {
  constructor(db: DrizzleService) {
    super(db, users);
  }

  // Inherited methods:
  // findAll(options?: { limit?: number; offset?: number }): Promise<User[]>
  // findById(id: string): Promise<User | null>
  // create(data: InsertUser): Promise<User>
  // update(id: string, data: Partial<InsertUser>): Promise<User | null>
  // delete(id: string): Promise<boolean>

  // Custom methods
  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] || null;
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

Or enable automatic migrations in module configuration:

```typescript
DrizzleModule.forRoot({
  connection: { /* ... */ },
  // autoMigrate defaults to true — migrations run on startup automatically
  migrationsFolder: './drizzle',  // Migration files location
})
```

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
| `DB_URL` | Connection URL — a file path for SQLite, a full `postgresql://…` for PostgreSQL | `:memory:` |
| `DB_AUTO_MIGRATE` | Auto-run migrations on startup | `true` |
| `DB_MIGRATIONS_FOLDER` | Path to migrations folder | `'./drizzle'` |
| `DB_MIGRATIONS_TABLE` | Journal table recording applied migrations | `'__drizzle_migrations'` |
| `DB_MIGRATIONS_SCHEMA` | Schema holding the journal (PostgreSQL only) | `'drizzle'` |
| `DB_SCHEMA_PATH` | Path to schema files | - |

`migrationsTable` and `migrationsSchema` are also accepted by `DrizzleModule.forRoot()` and
are forwarded on every path that runs migrations, including automatic ones.

`DB_TYPE` and `DB_URL` are the environment equivalent of `connection` in
`DrizzleModule.forRoot()`: set them and the service initializes itself with no module
configuration at all. On PostgreSQL the URL reaches the driver untouched, so its query
parameters are preserved.

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
    // Note: autoMigrate defaults to true, set to false if you don't have migrations
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: { url: ':memory:' },
      },
      autoMigrate: false, // Disable if no migrations folder exists
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
    // onAsyncInit() is called automatically by the framework
    // In tests, call it manually to simulate framework behavior
    await drizzleService.onAsyncInit();

    // Create test tables manually (when autoMigrate is false)
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
  await drizzleService.onAsyncInit();

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
  process.env.DB_AUTO_MIGRATE = 'false'; // Disable to avoid missing migrations folder error

  // Create service - will auto-initialize from env vars
  // No generic parameter needed
  drizzleService = new DrizzleService();
  drizzleService.initializeService(logger, createMockConfig());
  await drizzleService.onAsyncInit();
});

afterEach(() => {
  // Cleanup
  delete process.env.DB_URL;
  delete process.env.DB_TYPE;
  delete process.env.DB_AUTO_MIGRATE;
});
```

### Key Testing Notes

1. **Call `onAsyncInit()` in tests** - this triggers async initialization that the framework does automatically
2. **Use `DrizzleModule.clearOptions()`** in beforeEach/afterEach to ensure test isolation
3. **Clean up environment variables** when testing env-based initialization
4. **Use `:memory:`** SQLite URL for in-memory databases that are faster and don't leave files
5. **autoMigrate defaults to `true`** - set to `false` explicitly if you don't have migrations
6. **Database is ready after `onAsyncInit()`** - no need to call `waitForInit()` in client code
7. **No generic parameter needed** - `DrizzleService` infers types from table schemas automatically
