/**
 * User schema for integration tests (SQLite)
 * Single source of truth for table definition, types, and migrations
 * 
 * Note: In a real application, you would choose either SQLite or PostgreSQL
 * and use the corresponding table function (sqliteTable or pgTable).
 */
import {
  sqliteTable,
  integer,
  text,
} from 'drizzle-orm/sqlite-core';

/**
 * SQLite schema for users table
 * This is used for integration tests with SQLite database
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Type inference from schema - Select type
 */
export type User = typeof users.$inferSelect;

/**
 * Type inference from schema - Insert type
 */
export type InsertUser = typeof users.$inferInsert;
