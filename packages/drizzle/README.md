# @onebun/drizzle

Drizzle ORM module for OneBun framework with support for SQLite and PostgreSQL.

## Features

- **Schema-First Approach**: Drizzle table schemas (`pgTable`/`sqliteTable`) are the single source of truth
- **Type Safety**: Automatic type inference from schemas using `$inferSelect` and `$inferInsert`
- **Migrations**: Automatic migration generation and application using drizzle-kit
- **Repository Pattern**: BaseRepository class for common CRUD operations
- **Future-Ready**: Compatible with `drizzle-arktype` for validation

## Installation

```bash
bun add @onebun/drizzle drizzle-orm drizzle-kit
```

## Quick Start

### 1. Define Your Schema

Create a schema file using Drizzle's `pgTable` (for PostgreSQL) or `sqliteTable` (for SQLite).
Choose the function that matches your database type configured in step 2.

**For PostgreSQL:**
```typescript
// src/schema/users.ts
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
});

// Extract types from schema
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
```

**For SQLite:**
```typescript
// src/schema/users.ts
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Extract types from schema
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
```

### 2. Configure the Module

Choose your database type (PostgreSQL or SQLite) and configure the module accordingly.
This choice determines which table function (`pgTable` or `sqliteTable`) you'll use in your schemas.

**For PostgreSQL:**
```typescript
// src/app.module.ts
import { Module } from '@onebun/core';
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: {
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          password: 'password',
          database: 'mydb',
        },
      },
      autoMigrate: true,
      migrationsFolder: './drizzle',
    }),
  ],
})
export class AppModule {}
```

**For SQLite:**
```typescript
// src/app.module.ts
import { Module } from '@onebun/core';
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: {
          url: './mydb.sqlite', // or ':memory:' for in-memory database
        },
      },
      autoMigrate: true,
      migrationsFolder: './drizzle',
    }),
  ],
})
export class AppModule {}
```

### 4. Create a Repository

The repository works seamlessly with your schema, regardless of whether you're using PostgreSQL or SQLite. No database-specific checks needed!

```typescript
// src/repositories/user.repository.ts
import { eq } from 'drizzle-orm';
import { BaseRepository, Entity } from '@onebun/drizzle';
import type { DrizzleService } from '@onebun/drizzle';
import { users } from '../schema/users';

@Entity(users)
export class UserRepository extends BaseRepository<typeof users> {
  // Add custom business logic methods here
  // No need to check database type - just work with the schema!
  async findByEmail(email: string) {
    const db = this.getDb();
    const table = this.getTable();
    
    // Type assertion needed because db has union type, but Drizzle provides unified API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await (db as any)
      .select()
      .from(table)
      .where(eq(table.email, email));
    
    return results[0] || null;
  }
}
```

### 5. Generate Migrations

```typescript
import { generateMigrations } from '@onebun/drizzle';

await generateMigrations({
  schemaPath: './src/schema',
  migrationsFolder: './drizzle',
  dialect: 'postgresql',
});
```

## Schema-First Approach

This module uses a **schema-first approach** where Drizzle table schemas are the single source of truth:

- **Table Definition**: Defined using `pgTable()` for PostgreSQL or `sqliteTable()` for SQLite
- **TypeScript Types**: Extracted using `$inferSelect` and `$inferInsert`
- **Migrations**: Generated automatically by drizzle-kit from schemas
- **Validation**: Ready for integration with `drizzle-arktype` (future)

### Key Principles

1. **Choose Database Type Once**: When initializing the module, choose either PostgreSQL or SQLite
2. **Use Matching Table Function**: Use `pgTable()` if using PostgreSQL, `sqliteTable()` if using SQLite
3. **No Database-Specific Code**: Repositories and services work with schemas directly - no `isSQLite()` or `isPostgreSQL()` checks needed
4. **Single Source of Truth**: The schema defines everything - table structure, types, and migrations

### Benefits

1. **No Code Duplication**: Define your table once, get types and migrations automatically
2. **Type Safety**: Full TypeScript support with inferred types
3. **Migration Safety**: Drizzle-kit tracks applied migrations automatically
4. **Clean API**: No database-specific checks in your business logic
5. **Future-Proof**: Easy to add validation with arktype later

## Migration Management

### Automatic Migrations

Set `autoMigrate: true` in module options to automatically apply migrations on startup:

```typescript
DrizzleModule.forRoot({
  connection: { /* ... */ },
  autoMigrate: true,
  migrationsFolder: './drizzle',
})
```

Drizzle-kit automatically tracks applied migrations in the `__drizzle_migrations` table, preventing double application.

### Manual Migration Generation

```typescript
import { generateMigrations } from '@onebun/drizzle';

// Generate migration files
await generateMigrations({
  schemaPath: './src/schema',
  migrationsFolder: './drizzle',
  dialect: 'postgresql',
});
```

## Integration with ArkType (Future)

This module is designed to be compatible with `drizzle-arktype` for runtime validation:

```typescript
import { createSelectSchema, createInsertSchema } from 'drizzle-arktype';
import { users } from './schema/users';

// Generate validation schemas from Drizzle schemas
const userSelectSchema = createSelectSchema(users);
const userInsertSchema = createInsertSchema(users);

// Use for API request/response validation
const validatedData = userInsertSchema.parse(requestBody);
```

## API Reference

### BaseRepository

Base class for repositories providing CRUD operations:

```typescript
class BaseRepository<TTable extends PgTable<any> | SQLiteTable<any>> {
  findAll(): Promise<SelectType<TTable>[]>;
  findById(id: unknown): Promise<SelectType<TTable> | null>;
  create(data: Partial<InsertType<TTable>>): Promise<SelectType<TTable>>;
  update(id: unknown, data: Partial<InsertType<TTable>>): Promise<SelectType<TTable> | null>;
  delete(id: unknown): Promise<boolean>;
  count(): Promise<number>;
  transaction<R>(callback: (tx) => Promise<R>): Promise<R>;
}
```

### Schema Utilities

Helper functions for working with schemas:

```typescript
import { SelectType, InsertType, getTableName, getPrimaryKeyColumn } from '@onebun/drizzle';

// Extract types
type User = SelectType<typeof users>;
type InsertUser = InsertType<typeof users>;

// Get metadata
const tableName = getTableName(users); // 'users'
const pkColumn = getPrimaryKeyColumn(users); // 'id'
```

## Examples

See `tests/integration/` for complete examples including:
- Schema definition
- Repository implementation
- Service layer
- Controller endpoints
- Integration tests

## Environment Variables

```bash
DB_TYPE=postgresql          # 'sqlite' or 'postgresql'
DB_URL=postgresql://...    # Connection URL
DB_SCHEMA_PATH=./src/schema
DB_MIGRATIONS_FOLDER=./drizzle
DB_AUTO_MIGRATE=true
DB_LOG_QUERIES=false
```
