/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle ORM uses complex conditional types that require `any` for table type parameters

import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import type { RegistrationToken } from '@onebun/core';

/**
 * Supported database types
 */
export enum DatabaseType {
  SQLITE = 'sqlite',
  POSTGRESQL = 'postgresql',
}

/**
 * SQLite connection options
 */
export interface SQLiteConnectionOptions {
  /**
   * Path to SQLite database file or ':memory:' for in-memory database
   */
  url: string;

  /**
   * Additional options for Bun SQLite connection
   */
  options?: {
    /**
     * Create database if it doesn't exist
     */
    create?: boolean;

    /**
     * Read-only mode
     */
    readonly?: boolean;
  };

  /**
   * SQLite PRAGMA statements to execute immediately after opening the connection.
   * Common pragmas: 'journal_mode = WAL', 'synchronous = NORMAL', 'foreign_keys = ON'.
   * @default ['journal_mode = WAL', 'synchronous = NORMAL']
   */
  pragmas?: string[];
}

/**
 * PostgreSQL connection options
 */
/**
 * Connection pool options, shared by both PostgreSQL connection shapes.
 */
export interface PostgreSQLPoolOptions {
  /**
   * Maximum number of connections in the pool
   */
  max?: number;

  /**
   * Minimum number of connections in the pool
   */
  min?: number;

  /**
   * Connection timeout in milliseconds
   */
  timeout?: number;
}

/**
 * PostgreSQL connection given as a single URL.
 *
 * The discrete fields are `never` here rather than absent, so supplying both forms is a
 * compile error instead of a silent precedence question.
 */
export interface PostgreSQLUrlConnection {
  /**
   * Full connection URL, e.g. `postgresql://user:password@host:5432/database`.
   */
  connectionString: string;

  host?: never;
  port?: never;
  user?: never;
  password?: never;
  database?: never;

  /**
   * Connection pool options
   */
  pool?: PostgreSQLPoolOptions;
}

/**
 * PostgreSQL connection given as discrete fields.
 *
 * All five are required together: a partially filled object cannot describe a reachable
 * server, and accepting one would only defer the failure to connect time.
 */
export interface PostgreSQLDiscreteConnection {
  connectionString?: never;

  /**
   * PostgreSQL server host
   */
  host: string;

  /**
   * PostgreSQL server port
   */
  port: number;

  /**
   * PostgreSQL user name
   */
  user: string;

  /**
   * PostgreSQL user password
   */
  password: string;

  /**
   * PostgreSQL database name
   */
  database: string;

  /**
   * Connection pool options
   */
  pool?: PostgreSQLPoolOptions;
}

/**
 * PostgreSQL connection options — a URL, or the five discrete fields, never a mix.
 *
 * Discriminated on purpose. The documentation described `connectionString` for a long time
 * while the type had no such field and `initialize()` ignored it, so a reader who followed
 * the docs got a connection built from undefined discrete fields and no error naming the
 * cause. Making the two shapes mutually exclusive means a half-filled object fails at the
 * call site rather than at connect time.
 */
export type PostgreSQLConnectionOptions =
  | PostgreSQLUrlConnection
  | PostgreSQLDiscreteConnection;

/**
 * Database connection options (union type)
 */
export type DatabaseConnectionOptions =
  | { type: DatabaseType.SQLITE; options: SQLiteConnectionOptions }
  | { type: DatabaseType.POSTGRESQL; options: PostgreSQLConnectionOptions };

/**
 * Drizzle module options
 */
export interface DrizzleModuleOptions {
  /**
   * Database connection configuration
   */
  connection: DatabaseConnectionOptions;
  
  /**
   * Path to schema files (for migrations)
   * Default: './src/schema' or './schema'
   */
  schemaPath?: string | string[];
  
  /**
   * Path to migrations folder
   * Default: './drizzle'
   */
  migrationsFolder?: string;

  /**
   * Journal table recording which migrations have run. Defaults to drizzle's
   * `__drizzle_migrations`. See `MigrationOptions.migrationsTable` — a package that ships
   * its own migrations needs its own journal, or one of the two sets is silently skipped.
   */
  migrationsTable?: string;

  /**
   * Schema holding the journal table. PostgreSQL only. Defaults to drizzle's `drizzle`.
   */
  migrationsSchema?: string;
  
  /**
   * Environment variable prefix
   * Default: 'DB'
   */
  envPrefix?: string;
  
  /**
   * Whether to run migrations automatically on startup
   * Default: true
   */
  autoMigrate?: boolean;
  
  /**
   * Whether to log SQL queries
   * Default: false
   */
  logQueries?: boolean;

  /**
   * Accept a database that is absent, unreachable or unmigrated at boot.
   *
   * A configured database is a required one: when `connection` is given, the service checks
   * at startup that the database can actually be reached — the file opens on SQLite, a
   * bounded `SELECT 1` answers on PostgreSQL — and an application whose check fails does not
   * start. `app.start()` rejects, the HTTP server never binds, and the orchestrator sees a
   * container that refuses to come up instead of one that passes readiness and 500s every
   * request.
   *
   * Set this to `true` to keep the older behaviour: the failure is logged at `warn` and the
   * application starts anyway. It says "I accept a degraded or absent database at boot" —
   * a read-mostly service with a cache in front of it, or a deployment that brings the
   * database up after the application. It does not disable the check; the check still runs
   * and still reports.
   *
   * On the environment-variable path the same switch is `DB_ALLOW_DEGRADED_START=true`
   * (with the configured `envPrefix`).
   *
   * Default: false
   *
   * @see docs:api/drizzle.md
   */
  allowDegradedStart?: boolean;

  /**
   * Whether to register module as global
   * When true, DrizzleService is available in all modules without explicit import.
   * When false, a module reaches it only by importing DrizzleModule explicitly.
   * Default: true
   */
  isGlobal?: boolean;

  /**
   * Names this registration, so a feature module can select it with
   * `DrizzleModule.forFeature(token)`.
   *
   * This is how one application runs more than one database. Without it, `forRoot()`
   * configures the single default registration and a second call replaces the first.
   * A named registration is never global — it reaches a module only by being imported.
   *
   * @see docs:api/drizzle.md
   */
  as?: RegistrationToken;
}

/**
 * Database instance type (union)
 */
export type DatabaseInstance =
  | BunSQLiteDatabase<Record<string, SQLiteTable>>
  | BunSQLDatabase<Record<string, PgTable>>;

/**
 * Database type literal types
 */
export type DatabaseTypeLiteral = DatabaseType.SQLITE | DatabaseType.POSTGRESQL;

/**
 * Get database instance type based on database type literal
 */
export type DatabaseInstanceForType<T extends DatabaseTypeLiteral> =
  T extends DatabaseType.SQLITE
    ? BunSQLiteDatabase<Record<string, SQLiteTable>>
    : T extends DatabaseType.POSTGRESQL
      ? BunSQLDatabase<Record<string, PgTable>>
      : never;

/**
 * Infer database type from table schema
 */
export type InferDbTypeFromTable<TTable> =
  TTable extends SQLiteTable<any>
    ? DatabaseType.SQLITE
    : TTable extends PgTable<any>
      ? DatabaseType.POSTGRESQL
      : never;

/**
 * Base repository interface
 */
export interface IRepository<T> {
  /**
   * Find all records
   */
  findAll(): Promise<T[]>;
  
  /**
   * Find one record by ID
   */
  findById(id: unknown): Promise<T | null>;
  
  /**
   * Create a new record
   */
  create(data: Partial<T>): Promise<T>;
  
  /**
   * Update a record by ID
   */
  update(id: unknown, data: Partial<T>): Promise<T | null>;
  
  /**
   * Delete a record by ID
   */
  delete(id: unknown): Promise<boolean>;
  
  /**
   * Count records
   */
  count(): Promise<number>;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /**
   * Migration folder path
   */
  migrationsFolder?: string;

  /**
   * Journal table recording which migrations have run. Defaults to drizzle's
   * `__drizzle_migrations`.
   *
   * Set it when a package ships migrations of its own. Drizzle decides what to apply by
   * comparing a migration's folder timestamp against the NEWEST row in the journal — not
   * by hash — so two folders sharing one journal silently skip whichever set was
   * generated earlier, with no error and nothing logged. A private journal per migration
   * set removes that coupling entirely.
   */
  migrationsTable?: string;

  /**
   * Schema holding the journal table. PostgreSQL only; ignored on SQLite, which has no
   * schemas. Defaults to drizzle's `drizzle`.
   */
  migrationsSchema?: string;

  /**
   * Whether to apply migrations
   */
  apply?: boolean;
  
  /**
   * Custom migration name
   */
  name?: string;
}
