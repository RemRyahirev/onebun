import {
  integer,
  pgTable,
  text,
  timestamp,
} from '../src/pg';
import {
  sqliteTable as sqliteTableCore,
  integer as sqliteInteger,
  text as sqliteText,
} from '../src/sqlite';

/**
 * Test schema for SQLite
 */
export const usersSQLite = sqliteTableCore('users', {
  id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
  name: sqliteText('name').notNull(),
  email: sqliteText('email').notNull().unique(),
  age: sqliteInteger('age'),
  createdAt: sqliteInteger('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/**
 * Test schema for PostgreSQL
 */
export const usersPostgres = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
});

export type UserSQLite = typeof usersSQLite.$inferSelect;
export type UserPostgres = typeof usersPostgres.$inferSelect;
export type NewUserSQLite = typeof usersSQLite.$inferInsert;
export type NewUserPostgres = typeof usersPostgres.$inferInsert;
