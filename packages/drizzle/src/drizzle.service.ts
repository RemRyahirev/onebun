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

  constructor() {
    super();
    // Only start auto-initialization if there's configuration to use
    // Check synchronously to avoid unnecessary async work
    if (this.shouldAutoInitialize()) {
      this.initPromise = this.autoInitialize();
    }
  }

  /**
   * Check synchronously if auto-initialization should be attempted
   * This avoids starting async work when there's no configuration
   * Note: Only checks env vars here to avoid slow require() in constructor.
   * Module options are checked in autoInitialize() which is async.
   */
  private shouldAutoInitialize(): boolean {
    // Check if DB_URL env var is set
    // Module options will be checked in autoInitialize() if this returns false
    const dbUrl = process.env.DB_URL;
    if (dbUrl && dbUrl.trim() !== '') {
      return true;
    }

    // Also check if DrizzleModule has options set (static check without require)
    // This is done by checking if the module was already loaded
    try {
      // Only check if module is already in cache (don't trigger new require)
      const modulePath = require.resolve('./drizzle.module');
      const cachedModule = require.cache[modulePath];
      if (cachedModule?.exports?.DrizzleModule?.getOptions?.()?.connection) {
        return true;
      }
    } catch {
      // Module not resolved or not in cache
    }

    return false;
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
        this.logger.debug('Auto-initializing database service from module options', {
          type: moduleOptions.connection.type,
        });

        await this.initialize(moduleOptions.connection);

        // Auto-migrate if enabled
        if (moduleOptions.autoMigrate) {
          const migrationsFolder = moduleOptions.migrationsFolder ?? './drizzle';
          await this.runMigrations({ migrationsFolder });
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
        this.logger.debug('Skipping auto-initialization: no database configuration found in process.env');
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

      this.logger.debug(`Auto-initializing database service with type: ${connectionOptions.type}`, {
        envPrefix,
      });

      await this.initialize(connectionOptions);

      // Auto-migrate if enabled
      if (envConfig.autoMigrate) {
        const migrationsFolder = envConfig.migrationsFolder ?? './drizzle';
        await this.runMigrations({ migrationsFolder });
      }

      this.initialized = true;
    } catch (error) {
      // Don't throw error - just log it and allow manual initialization
      this.logger.debug('Failed to auto-initialize database from environment', { error });
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
   */
  async initialize(options: DatabaseConnectionOptions): Promise<void> {
    await this.waitForInit();

    if (this.initialized && this.connectionOptions) {
      this.logger.warn('Database already initialized, closing existing connection');
      await this.close();
    }

    this.connectionOptions = options;
    this.dbType = options.type as TDbType;

    if (options.type === DatabaseType.SQLITE) {
      const sqliteOptions = options.options;
      this.sqliteClient = new Database(sqliteOptions.url, sqliteOptions.options);
      this.db = drizzleSQLite(this.sqliteClient);
      this.logger.info('SQLite database initialized', { url: sqliteOptions.url });
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

      this.logger.info('PostgreSQL database initialized with Bun.SQL', {
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
   * @throws Error if database is not initialized
   */
  async runMigrations(options?: MigrationOptions): Promise<void> {
    await this.waitForInit();

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
      this.logger.info('SQLite migrations applied', { migrationsFolder });
    } else if (this.connectionOptions.type === DatabaseType.POSTGRESQL) {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      await migratePostgres(this.db as BunSQLDatabase<Record<string, PgTable>>, {
        migrationsFolder,
      });
      this.logger.info('PostgreSQL migrations applied', { migrationsFolder });
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
    this.logger.info('Database connection closed');
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
}
