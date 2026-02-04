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
      autoMigrate: true,
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
      connectionString: process.env.DATABASE_URL,
      // Or individual options:
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'password',
      ssl: process.env.NODE_ENV === 'production',
    },
  },
  autoMigrate: true,
  migrationsFolder: './drizzle',
})
```

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

### Non-Global Mode (Multiple Databases)

For scenarios where you need multiple database connections (e.g., main database + analytics database), you can disable global behavior:

```typescript
// Main database - global (available everywhere)
@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: { host: 'main-db', port: 5432, user: 'app', password: 'secret', database: 'main' },
      },
      isGlobal: true, // Default, can be omitted
    }),
  ],
})
export class AppModule {}

// Analytics module with separate database - non-global
@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: { host: 'analytics-db', port: 5432, user: 'analytics', password: 'secret', database: 'analytics' },
      },
      isGlobal: false, // Each import creates new instance
    }),
  ],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

### forFeature() Method

When `DrizzleModule` is not global (`isGlobal: false`), submodules must explicitly import it using `forFeature()`:

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

<llms-only>
**Technical details for AI agents:**
- `DrizzleModule` is decorated with `@Global()` by default, making `DrizzleService` available in all modules
- `isGlobal: true` (default) - singleton DrizzleService, one DB connection for entire app
- `isGlobal: false` - each import creates new DrizzleService instance (useful for multi-DB scenarios)
- `forFeature()` simply returns the DrizzleModule class for explicit imports in feature modules
- Global services are stored in a registry and automatically injected into all modules
- When `isGlobal: false` is set, the module is removed from the global registry via `removeFromGlobalModules()`
</llms-only>

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

Execute queries in a transaction.

```typescript
async transaction<T>(
  fn: (tx: DatabaseInstance) => Promise<T>
): Promise<T>
```

```typescript
const result = await this.db.transaction(async (tx) => {
  // All queries in this block are in a transaction
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
  autoMigrate: true,              // Run migrations on startup
  migrationsFolder: './drizzle',  // Migration files location
})
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_AUTO_MIGRATE` | Auto-run migrations on startup | `true` |
| `DB_MIGRATIONS_FOLDER` | Path to migrations folder | `'./drizzle'` |
| `DB_SCHEMA_PATH` | Path to schema files | - |

### Migration Tracking

Drizzle automatically tracks applied migrations in the `__drizzle_migrations` table. This ensures:
- Migrations are only applied once (idempotency)
- Running `runMigrations()` multiple times is safe
- No duplicate table creation errors

<llms-only>
**Technical details for AI agents:**
- `generateMigrations()` creates a temporary `drizzle.config.temp.ts` file and runs `bunx drizzle-kit generate`
- `pushSchema()` runs `bunx drizzle-kit push:sqlite` or `push:pg` depending on dialect
- `runMigrations()` uses drizzle-orm's `migrate()` function from `drizzle-orm/bun-sqlite/migrator` or `drizzle-orm/bun-sql/migrator`
- Migration files are stored in the format: `{migrationsFolder}/NNNN_migration_name.sql` with `meta/_journal.json` for tracking
- The `__drizzle_migrations` table schema: `id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER`
</llms-only>

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

  async findById(id: string): Promise<User | null> {
    const cacheKey = `user:${id}`;
    const cached = await this.cacheService.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.userRepository.findById(id);
    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300 });
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
          connectionString: process.env.DATABASE_URL,
        },
      },
      autoMigrate: true,
      migrationsFolder: './drizzle',
    }),
    CacheModule.forRoot({ type: CacheType.MEMORY, cacheOptions: { defaultTtl: 300000 } }),
  ],
  controllers: [UserController],
  providers: [UserService, UserRepository],
})
export class UserModule {}
```
