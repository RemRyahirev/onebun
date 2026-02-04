/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle ORM uses complex conditional types that require `any` for table type parameters

import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

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
}

/**
 * PostgreSQL connection options
 */
export interface PostgreSQLConnectionOptions {
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
  pool?: {
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
  };
}

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
   * Whether to register module as global
   * When true, DrizzleService is available in all modules without explicit import.
   * When false, each import creates a new instance (useful for multi-database scenarios).
   * Default: true
   */
  isGlobal?: boolean;
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
   * Whether to apply migrations
   */
  apply?: boolean;
  
  /**
   * Custom migration name
   */
  name?: string;
}
