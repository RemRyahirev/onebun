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

## Schema Definition

### SQLite Schema

```typescript
// schema/users.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

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
import { pgTable, text, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // ... rest of schema
});
```

### Relations

```typescript
// schema/posts.ts
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
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

#### query()

Execute a query function with the database instance.

```typescript
async query<T>(
  fn: (db: DatabaseInstance) => Promise<T> | T
): Promise<T>
```

```typescript
// Select all
const users = await this.db.query(
  db => db.select().from(users)
);

// Select with conditions
import { eq, and, or, like } from 'drizzle-orm';

const user = await this.db.query(
  db => db.select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
);

// Insert
const newUser = await this.db.query(
  db => db.insert(users)
    .values({ name: 'John', email: 'john@example.com' })
    .returning()
);

// Update
const updated = await this.db.query(
  db => db.update(users)
    .set({ name: 'Jane' })
    .where(eq(users.id, id))
    .returning()
);

// Delete
const deleted = await this.db.query(
  db => db.delete(users)
    .where(eq(users.id, id))
    .returning()
);
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
    const result = await this.db.query(
      db => db.select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
    );
    return result[0] || null;
  }

  async findWithPosts(id: string): Promise<UserWithPosts | null> {
    const result = await this.db.query(
      db => db.query.users.findFirst({
        where: eq(users.id, id),
        with: {
          posts: true,
        },
      })
    );
    return result || null;
  }
}
```

## Query Examples

### Basic Queries

```typescript
// Select specific columns
const names = await this.db.query(
  db => db.select({ name: users.name, email: users.email }).from(users)
);

// Count
const count = await this.db.query(
  db => db.select({ count: sql`count(*)` }).from(users)
);

// Order and limit
const recentUsers = await this.db.query(
  db => db.select()
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(10)
);

// Pagination
const page = 1;
const limit = 10;
const offset = (page - 1) * limit;

const users = await this.db.query(
  db => db.select()
    .from(users)
    .limit(limit)
    .offset(offset)
);
```

### Filtering

```typescript
import { eq, ne, gt, gte, lt, lte, like, ilike, and, or, not, isNull, isNotNull, inArray, notInArray } from 'drizzle-orm';

// Equal
const user = await this.db.query(
  db => db.select().from(users).where(eq(users.id, '123'))
);

// Multiple conditions (AND)
const admins = await this.db.query(
  db => db.select().from(users).where(
    and(
      eq(users.role, 'admin'),
      eq(users.active, true)
    )
  )
);

// OR conditions
const filtered = await this.db.query(
  db => db.select().from(users).where(
    or(
      eq(users.role, 'admin'),
      eq(users.role, 'moderator')
    )
  )
);

// LIKE
const search = await this.db.query(
  db => db.select().from(users).where(
    like(users.name, '%john%')
  )
);

// IN array
const specific = await this.db.query(
  db => db.select().from(users).where(
    inArray(users.id, ['1', '2', '3'])
  )
);

// NULL checks
const noAge = await this.db.query(
  db => db.select().from(users).where(
    isNull(users.age)
  )
);
```

### Joins

```typescript
// Inner join
const postsWithAuthors = await this.db.query(
  db => db.select()
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
);

// Left join
const usersWithPosts = await this.db.query(
  db => db.select()
    .from(users)
    .leftJoin(posts, eq(users.id, posts.authorId))
);

// With relations (if defined)
const userWithPosts = await this.db.query(
  db => db.query.users.findFirst({
    where: eq(users.id, id),
    with: {
      posts: {
        orderBy: desc(posts.createdAt),
        limit: 5,
      },
    },
  })
);
```

### Aggregations

```typescript
import { sql, count, sum, avg, min, max } from 'drizzle-orm';

// Count
const total = await this.db.query(
  db => db.select({ count: count() }).from(users)
);

// Group by
const postsByUser = await this.db.query(
  db => db.select({
    authorId: posts.authorId,
    postCount: count(),
  })
    .from(posts)
    .groupBy(posts.authorId)
);

// Sum
const totalSales = await this.db.query(
  db => db.select({
    total: sum(orders.amount),
  }).from(orders)
);
```

## Migrations

### Generate Migrations

```typescript
import { generateMigrations } from '@onebun/drizzle';

// Generate migration files
await generateMigrations({
  schema: './src/schema/index.ts',
  out: './drizzle/migrations',
});
```

### Push Schema

```typescript
import { pushSchema } from '@onebun/drizzle';

// Push schema directly (development only)
await pushSchema({
  schema: './src/schema/index.ts',
  connectionString: process.env.DATABASE_URL,
});
```

## Complete Example

```typescript
// schema/index.ts
import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
import { DrizzleService, BaseRepository } from '@onebun/drizzle';
import { users, type User, type InsertUser } from './schema';
import { eq } from 'drizzle-orm';

@Service()
export class UserRepository extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findAll(): Promise<User[]> {
    return this.db.query(db => db.select().from(users));
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.db.query(
      db => db.select().from(users).where(eq(users.id, id)).limit(1)
    );
    return result[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.query(
      db => db.select().from(users).where(eq(users.email, email)).limit(1)
    );
    return result[0] || null;
  }

  async create(data: InsertUser): Promise<User> {
    const result = await this.db.query(
      db => db.insert(users).values(data).returning()
    );
    return result[0];
  }

  async update(id: string, data: Partial<InsertUser>): Promise<User | null> {
    const result = await this.db.query(
      db => db.update(users).set(data).where(eq(users.id, id)).returning()
    );
    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.query(
      db => db.delete(users).where(eq(users.id, id)).returning()
    );
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
