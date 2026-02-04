import { SQL } from 'bun';
import { Database } from 'bun:sqlite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/bun-sql';
import { migrate as migratePostgres } from 'drizzle-orm/bun-sql/migrator';
import { drizzle as drizzleSQLite } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Effect } from 'effect';

import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { BaseService, Service } from '@onebun/core';
import {
  Env,
  EnvLoader,
  EnvParser,
} from '@onebun/envs';

import {
  type DatabaseConnectionOptions,
  type DatabaseInstance,
  type DatabaseInstanceForType,
  DatabaseType,
  type DatabaseTypeLiteral,
  type DrizzleModuleOptions,
  type MigrationOptions,
  type PostgreSQLConnectionOptions,
} from './types';

/**
 * Default environment variable prefix
 */
const DEFAULT_ENV_PREFIX = 'DB';
const DEFAULT_PG_PORT = 5432;

/**
 * Parse PostgreSQL connection URL into separate fields
 * Supports format: postgresql://user:password\@host:port/database
 */
function parsePostgreSQLUrl(url: string): PostgreSQLConnectionOptions {
  try {
    const parsedUrl = new URL(url);

    return {
      host: parsedUrl.hostname,
      port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : DEFAULT_PG_PORT,
      user: parsedUrl.username,
      password: parsedUrl.password,
      database: parsedUrl.pathname.slice(1), // Remove leading '/'
    };
  } catch (error) {
    throw new Error(`Invalid PostgreSQL connection URL: ${url}. Error: ${error}`);
  }
}

/**
 * Build PostgreSQL connection URL from separate fields
 */
function buildPostgreSQLUrl(options: PostgreSQLConnectionOptions): string {
  const {
    host, port, user, password, database,
  } = options;

  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

/**
 * Database environment schema
 */
interface DatabaseEnvSchema {
  type: string;
  url: string;
  schemaPath?: string;
  migrationsFolder?: string;
  autoMigrate?: boolean;
  logQueries?: boolean;
}

/**
 * Create database environment schema with given prefix
 */
function createDatabaseEnvSchema(prefix: string = DEFAULT_ENV_PREFIX) {
  return {
    type: Env.string({
      env: `${prefix}_TYPE`,
      default: DatabaseType.SQLITE,
      validate: Env.oneOf([DatabaseType.SQLITE, DatabaseType.POSTGRESQL] as const),
    }),
    url: Env.string({
      env: `${prefix}_URL`,
      default: ':memory:',
    }),
    schemaPath: Env.string({
      env: `${prefix}_SCHEMA_PATH`,
    }),
    migrationsFolder: Env.string({
      env: `${prefix}_MIGRATIONS_FOLDER`,
    }),
    autoMigrate: Env.boolean({
      env: `${prefix}_AUTO_MIGRATE`,
      default: true,
    }),
    logQueries: Env.boolean({
      env: `${prefix}_LOG_QUERIES`,
      default: false,
    }),
  };
}

/**
 * Load database configuration from environment variables
 */
async function loadFromEnv(prefix: string = DEFAULT_ENV_PREFIX): Promise<DatabaseEnvSchema> {
  const schema = createDatabaseEnvSchema(prefix);
  const rawEnv = await Effect.runPromise(EnvLoader.load());

  const type = await Effect.runPromise(
    EnvParser.parse(`${prefix}_TYPE`, rawEnv[`${prefix}_TYPE`], schema.type),
  );

  const url = await Effect.runPromise(
    EnvParser.parse(`${prefix}_URL`, rawEnv[`${prefix}_URL`], schema.url),
  );

  const schemaPath = rawEnv[`${prefix}_SCHEMA_PATH`]
    ? await Effect.runPromise(
      EnvParser.parse(`${prefix}_SCHEMA_PATH`, rawEnv[`${prefix}_SCHEMA_PATH`], schema.schemaPath!),
    )
    : undefined;

  const migrationsFolder = rawEnv[`${prefix}_MIGRATIONS_FOLDER`]
    ? await Effect.runPromise(
      EnvParser.parse(
        `${prefix}_MIGRATIONS_FOLDER`,
        rawEnv[`${prefix}_MIGRATIONS_FOLDER`],
        schema.migrationsFolder!,
      ),
    )
    : undefined;

  const autoMigrate = await Effect.runPromise(
    EnvParser.parse(`${prefix}_AUTO_MIGRATE`, rawEnv[`${prefix}_AUTO_MIGRATE`], schema.autoMigrate),
  );

  const logQueries = await Effect.runPromise(
    EnvParser.parse(`${prefix}_LOG_QUERIES`, rawEnv[`${prefix}_LOG_QUERIES`], schema.logQueries),
  );

  return {
    type,
    url,
    schemaPath,
    migrationsFolder,
    autoMigrate,
    logQueries,
  };
}

/**
 * Buffered log entry for pre-logger initialization logging
 */
interface BufferedLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: object;
  timestamp: number;
}

/**
 * Drizzle service for database operations
 * Generic type parameter TDbType specifies the database type (SQLITE or POSTGRESQL)
 *
 * @example
 * ```typescript
 * // For SQLite
 * const drizzleService = new DrizzleService<DatabaseType.SQLITE>(...);
 * const db = drizzleService.getDatabase(); // Type: BunSQLiteDatabase
 *
 * // For PostgreSQL
 * const drizzleService = new DrizzleService<DatabaseType.POSTGRESQL>(...);
 * const db = drizzleService.getDatabase(); // Type: BunSQLDatabase
 * ```
 */
@Service()
export class DrizzleService<TDbType extends DatabaseTypeLiteral = DatabaseTypeLiteral> extends BaseService {
  private db: DatabaseInstance | null = null;
  private dbType: TDbType | null = null;
  private connectionOptions: DatabaseConnectionOptions | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sqliteClient: Database | null = null;
  private postgresClient: SQL | null = null;
  private logBuffer: BufferedLogEntry[] = [];
  private exitHandlerRegistered = false;

  constructor() {
    super();
    // Register exit handler to flush buffered logs on crash
    this.registerExitHandler();
  }

  /**
   * Register process exit handler to flush buffered logs to console.error on crash
   */
  private registerExitHandler(): void {
    if (this.exitHandlerRegistered) {
      return;
    }
    this.exitHandlerRegistered = true;

    const flushToConsole = () => {
      if (this.logBuffer.length > 0) {
        // eslint-disable-next-line no-console
        console.error('[DrizzleService] Buffered logs (app crashed before logger init):');
        for (const entry of this.logBuffer) {
          const timestamp = new Date(entry.timestamp).toISOString();
          // eslint-disable-next-line no-console
          console.error(`  [${timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`, entry.meta ?? '');
        }
      }
    };

    // Register handlers for various exit scenarios
    process.on('exit', flushToConsole);
    process.on('uncaughtException', (err) => {
      flushToConsole();
      // eslint-disable-next-line no-console
      console.error('[DrizzleService] Uncaught exception:', err);
    });
    process.on('unhandledRejection', (reason) => {
      flushToConsole();
      // eslint-disable-next-line no-console
      console.error('[DrizzleService] Unhandled rejection:', reason);
    });
  }

  /**
   * Safe logging that buffers logs before logger is available
   * When logger becomes available, buffered logs are flushed
   * If app crashes before logger init, logs are output via console.error
   */
  private safeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: object): void {
    if (this.logger) {
      this.logger[level](message, meta);
    } else {
      // Buffer the log for later
      this.logBuffer.push({
        level,
        message,
        meta,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Flush buffered logs to the logger (called when logger becomes available)
   */
  private flushLogBuffer(): void {
    if (!this.logger || this.logBuffer.length === 0) {
      return;
    }

    this.logger.debug(`Flushing ${this.logBuffer.length} buffered log entries`);
    for (const entry of this.logBuffer) {
      this.logger[entry.level](entry.message, entry.meta);
    }
    this.logBuffer = [];
  }

  /**
   * Async initialization hook - called by the framework after initializeService()
   * This ensures the database is fully ready before client code runs
   */
  override async onAsyncInit(): Promise<void> {
    // Flush any buffered logs now that logger is available
    this.flushLogBuffer();

    // Run auto-initialization
    await this.autoInitialize();
  }

  /**
   * Auto-initialize database from environment variables and/or module options
   * Only initializes if explicit configuration is provided (module options or DB_URL env var)
   */
  private async autoInitialize(): Promise<void> {
    try {
      const moduleOptions = this.getModuleOptions();

      // If module options are provided, use them
      if (moduleOptions?.connection) {
        this.safeLog('debug', 'Auto-initializing database service from module options', {
          type: moduleOptions.connection.type,
        });

        // Pass skipWait=true to avoid deadlock (we're already inside initPromise)
        await this.initialize(moduleOptions.connection, true);

        // Auto-migrate is enabled by default (unless explicitly set to false)
        const shouldAutoMigrate = moduleOptions.autoMigrate !== false;
        if (shouldAutoMigrate) {
          const migrationsFolder = moduleOptions.migrationsFolder ?? './drizzle';
          this.safeLog('debug', 'Running auto-migrations', { migrationsFolder });
          try {
            // Pass skipWait=true to avoid deadlock (we're already inside initPromise)
            await this.runMigrations({ migrationsFolder }, true);
            this.safeLog('debug', 'Auto-migrations completed successfully');
          } catch (migrationError) {
            this.safeLog('warn', 'Auto-migration failed, database initialized without migrations', {
              error: migrationError instanceof Error ? migrationError.message : String(migrationError),
            });
            // Don't rethrow - allow DB to be used even if migrations fail
          }
        } else {
          this.safeLog('debug', 'Auto-migrations disabled via module options');
        }

        this.initialized = true;

        return;
      }

      // Otherwise, check environment variables
      const envPrefix = moduleOptions?.envPrefix ?? DEFAULT_ENV_PREFIX;
      // Only auto-initialize if DB_URL is explicitly set in process.env and not empty
      // Check process.env directly to ensure we only auto-initialize when explicitly configured
      const dbUrlFromProcess = process.env[`${envPrefix}_URL`];
      if (!dbUrlFromProcess || dbUrlFromProcess.trim() === '') {
        this.safeLog('debug', 'Skipping auto-initialization: no database configuration found in process.env');
        this.initialized = false;

        return;
      }

      const envConfig = await loadFromEnv(envPrefix);
      const dbType = envConfig.type === DatabaseType.SQLITE ? DatabaseType.SQLITE : DatabaseType.POSTGRESQL;

      const connectionOptions: DatabaseConnectionOptions =
        dbType === DatabaseType.SQLITE
          ? {
            type: DatabaseType.SQLITE,
            options: { url: envConfig.url },
          }
          : {
            type: DatabaseType.POSTGRESQL,
            options: parsePostgreSQLUrl(envConfig.url),
          };

      this.safeLog('debug', `Auto-initializing database service with type: ${connectionOptions.type}`, {
        envPrefix,
      });

      // Pass skipWait=true to avoid deadlock (we're already inside initPromise)
      await this.initialize(connectionOptions, true);

      // Auto-migrate is enabled by default (env schema default is true)
      if (envConfig.autoMigrate) {
        const migrationsFolder = envConfig.migrationsFolder ?? './drizzle';
        // Pass skipWait=true to avoid deadlock (we're already inside initPromise)
        await this.runMigrations({ migrationsFolder }, true);
      }

      this.initialized = true;
    } catch (error) {
      // Don't throw error - just log it and allow manual initialization
      this.safeLog('debug', 'Failed to auto-initialize database from environment', { error });
      this.initialized = false;
    }
  }

  /**
   * Get module options from DrizzleModule if available
   */
  private getModuleOptions(): DrizzleModuleOptions | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { DrizzleModule: DrizzleModuleClass } = require('./drizzle.module');

      return DrizzleModuleClass.getOptions();
    } catch {
      return undefined;
    }
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Initialize database connection
   * @param options - Database connection options
   * @param skipWait - Internal flag to skip waitForInit (used by autoInitialize to avoid deadlock)
   */
  async initialize(options: DatabaseConnectionOptions, skipWait = false): Promise<void> {
    // Skip waitForInit when called from autoInitialize to avoid deadlock
    // (autoInitialize is the function that creates initPromise)
    if (!skipWait) {
      await this.waitForInit();
    }

    if (this.initialized && this.connectionOptions) {
      this.safeLog('warn', 'Database already initialized, closing existing connection');
      await this.close();
    }

    this.connectionOptions = options;
    this.dbType = options.type as TDbType;

    if (options.type === DatabaseType.SQLITE) {
      const sqliteOptions = options.options;
      this.sqliteClient = new Database(sqliteOptions.url, sqliteOptions.options);
      this.db = drizzleSQLite(this.sqliteClient);
      this.safeLog('info', 'SQLite database initialized', { url: sqliteOptions.url });
    } else if (options.type === DatabaseType.POSTGRESQL) {
      const pgOptions = options.options;

      // Build connection URL from separate fields
      const connectionUrl = buildPostgreSQLUrl(pgOptions);

      // Use Bun.SQL - recommended way according to Drizzle docs
      // Pass connection string directly to drizzle()
      this.db = drizzlePostgres(connectionUrl);

      // Store client reference for closing if needed
      // Drizzle returns database with $client property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.postgresClient = (this.db as any).$client as SQL | null;

      this.safeLog('info', 'PostgreSQL database initialized with Bun.SQL', {
        host: pgOptions.host,
        port: pgOptions.port,
        database: pgOptions.database,
        user: pgOptions.user,
      });
    } else {
      const _exhaustive: never = options;
      throw new Error(`Unsupported database type: ${(_exhaustive as DatabaseConnectionOptions).type}`);
    }

    this.initialized = true;
  }

  /**
   * Get database instance with proper typing based on generic type parameter
   * Returns correctly typed database instance based on TDbType
   */
  getDatabase(): DatabaseInstanceForType<TDbType> {
    if (!this.db || !this.dbType) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    // Type assertion is safe because dbType matches TDbType
    return this.db as DatabaseInstanceForType<TDbType>;
  }

  /**
   * Get SQLite database instance (internal use only - not exported in public API)
   * Throws if database is not SQLite
   * @internal
   */
  getSQLiteDatabase(): BunSQLiteDatabase<Record<string, SQLiteTable>> {
    if (!this.isSQLite()) {
      throw new Error('Database is not SQLite');
    }

    return this.db as BunSQLiteDatabase<Record<string, SQLiteTable>>;
  }

  /**
   * Get PostgreSQL database instance (internal use only - not exported in public API)
   * Throws if database is not PostgreSQL
   * @internal
   */
  getPostgreSQLDatabase(): BunSQLDatabase<Record<string, PgTable>> {
    if (!this.isPostgreSQL()) {
      throw new Error('Database is not PostgreSQL');
    }

    return this.db as BunSQLDatabase<Record<string, PgTable>>;
  }

  /**
   * Type guard to check if database is SQLite
   */
  isSQLite(): boolean {
    return this.dbType === DatabaseType.SQLITE && this.db !== null;
  }

  /**
   * Type guard to check if database is PostgreSQL
   */
  isPostgreSQL(): boolean {
    return this.dbType === DatabaseType.POSTGRESQL && this.db !== null;
  }

  /**
   * Get SQLite client (for direct SQL operations)
   */
  getSQLiteClient(): Database | null {
    return this.sqliteClient;
  }

  /**
   * Get PostgreSQL client (for direct SQL operations)
   */
  getPostgreSQLClient(): SQL | null {
    return this.postgresClient;
  }

  /**
   * Get connection options
   */
  getConnectionOptions(): DatabaseConnectionOptions | null {
    return this.connectionOptions;
  }

  /**
   * Run migrations
   *
   * Drizzle-kit automatically tracks applied migrations in the `__drizzle_migrations` table
   * and prevents double application of migrations. This method uses drizzle's built-in
   * migration system which ensures idempotency.
   *
   * @param options - Migration options
   * @param skipWait - Internal flag to skip waitForInit (used by autoInitialize to avoid deadlock)
   * @throws Error if database is not initialized
   */
  async runMigrations(options?: MigrationOptions, skipWait = false): Promise<void> {
    // Skip waitForInit when called from autoInitialize to avoid deadlock
    if (!skipWait) {
      await this.waitForInit();
    }

    if (!this.db || !this.connectionOptions) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    const migrationsFolder = options?.migrationsFolder ?? './drizzle';

    if (this.connectionOptions.type === DatabaseType.SQLITE) {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      await migrate(this.db as BunSQLiteDatabase<Record<string, SQLiteTable>>, {
        migrationsFolder,
      });
      this.safeLog('info', 'SQLite migrations applied', { migrationsFolder });
    } else if (this.connectionOptions.type === DatabaseType.POSTGRESQL) {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      await migratePostgres(this.db as BunSQLDatabase<Record<string, PgTable>>, {
        migrationsFolder,
      });
      this.safeLog('info', 'PostgreSQL migrations applied', { migrationsFolder });
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    // Only wait for init if there are actual database clients to close
    // This prevents hanging when close() is called on an uninitialized service
    // Note: we check clients directly, not `initialized` flag, because autoInitialize()
    // may still be running and `initialized` could be false while initPromise is pending
    if (this.postgresClient || this.sqliteClient) {
      await this.waitForInit();
    }

    if (this.postgresClient) {
      // Bun.SQL uses close() instead of end()
      this.postgresClient.close();
      this.postgresClient = null;
    }

    if (this.sqliteClient) {
      this.sqliteClient.close();
      this.sqliteClient = null;
    }

    this.db = null;
    this.dbType = null;
    this.connectionOptions = null;
    this.initialized = false;
    this.safeLog('info', 'Database connection closed');
  }

  /**
   * Execute a transaction with proper typing based on TDbType
   */
  async transaction<R>(
    callback: (tx: DatabaseInstanceForType<TDbType>) => Promise<R>,
  ): Promise<R> {
    await this.waitForInit();

    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    // Type assertion needed because TypeScript cannot infer methods from conditional types
    // Runtime type is correct - this is a TypeScript limitation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (this.db as any).transaction(callback);
  }

  // ============================================
  // Direct database operation methods (proxies)
  // ============================================

  /**
   * Create a SELECT query
   * 
   * @example
   * ```typescript
   * // Select all columns
   * const users = await this.db.select().from(usersTable);
   * 
   * // Select specific columns
   * const names = await this.db.select({ name: usersTable.name }).from(usersTable);
   * ```
   */
  select(): ReturnType<DatabaseInstanceForType<TDbType>['select']>;
  select<TSelection extends Record<string, unknown>>(
    fields: TSelection,
  ): ReturnType<DatabaseInstanceForType<TDbType>['select']>;
  select<TSelection extends Record<string, unknown>>(
    fields?: TSelection,
  ): ReturnType<DatabaseInstanceForType<TDbType>['select']> {
    const db = this.getDatabase();
    if (fields) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (db as any).select(fields);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).select();
  }

  /**
   * Create a SELECT DISTINCT query
   * 
   * @example
   * ```typescript
   * // Select distinct values
   * const uniqueNames = await this.db.selectDistinct({ name: usersTable.name }).from(usersTable);
   * ```
   */
  selectDistinct(): ReturnType<DatabaseInstanceForType<TDbType>['selectDistinct']>;
  selectDistinct<TSelection extends Record<string, unknown>>(
    fields: TSelection,
  ): ReturnType<DatabaseInstanceForType<TDbType>['selectDistinct']>;
  selectDistinct<TSelection extends Record<string, unknown>>(
    fields?: TSelection,
  ): ReturnType<DatabaseInstanceForType<TDbType>['selectDistinct']> {
    const db = this.getDatabase();
    if (fields) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (db as any).selectDistinct(fields);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).selectDistinct();
  }

  /**
   * Create an INSERT query
   * 
   * @example
   * ```typescript
   * // Insert a single row
   * await this.db.insert(usersTable).values({ name: 'John', email: 'john@example.com' });
   * 
   * // Insert with returning
   * const [newUser] = await this.db.insert(usersTable)
   *   .values({ name: 'John', email: 'john@example.com' })
   *   .returning();
   * ```
   */
  insert<TTable extends Parameters<DatabaseInstanceForType<TDbType>['insert']>[0]>(
    table: TTable,
  ): ReturnType<DatabaseInstanceForType<TDbType>['insert']> {
    const db = this.getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).insert(table);
  }

  /**
   * Create an UPDATE query
   * 
   * @example
   * ```typescript
   * // Update rows
   * await this.db.update(usersTable)
   *   .set({ name: 'Jane' })
   *   .where(eq(usersTable.id, 1));
   * 
   * // Update with returning
   * const [updated] = await this.db.update(usersTable)
   *   .set({ name: 'Jane' })
   *   .where(eq(usersTable.id, 1))
   *   .returning();
   * ```
   */
  update<TTable extends Parameters<DatabaseInstanceForType<TDbType>['update']>[0]>(
    table: TTable,
  ): ReturnType<DatabaseInstanceForType<TDbType>['update']> {
    const db = this.getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).update(table);
  }

  /**
   * Create a DELETE query
   * 
   * @example
   * ```typescript
   * // Delete rows
   * await this.db.delete(usersTable).where(eq(usersTable.id, 1));
   * 
   * // Delete with returning
   * const [deleted] = await this.db.delete(usersTable)
   *   .where(eq(usersTable.id, 1))
   *   .returning();
   * ```
   */
  delete<TTable extends Parameters<DatabaseInstanceForType<TDbType>['delete']>[0]>(
    table: TTable,
  ): ReturnType<DatabaseInstanceForType<TDbType>['delete']> {
    const db = this.getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).delete(table);
  }
}
