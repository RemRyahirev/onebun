import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { SQL } from 'bun';
import { Database } from 'bun:sqlite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/bun-sql';
import { migrate as migratePostgres } from 'drizzle-orm/bun-sql/migrator';
import { drizzle as drizzleSQLite } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Effect } from 'effect';

import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type { BunSQLQueryResultHKT } from 'drizzle-orm/bun-sql/session';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type {
  PgDeleteBase,
  PgInsertBuilder,
  PgTable,
  PgUpdateBuilder,
} from 'drizzle-orm/pg-core';
import type {
  SQLiteDeleteBase,
  SQLiteInsertBuilder,
  SQLiteTable,
  SQLiteUpdateBuilder,
} from 'drizzle-orm/sqlite-core';

import {
  BaseService,
  Service,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@onebun/core';
import {
  Env,
  EnvLoader,
  EnvParser,
} from '@onebun/envs';

import {
  UniversalSelectBuilder,
  UniversalSelectDistinctBuilder,
  UniversalTransactionClient,
} from './builders';
import { createGatedDatabase, SQLiteTransactionGate } from './builders/transaction-gate';
import {
  type DatabaseConnectionOptions,
  type DatabaseInstance,
  DatabaseType,
  type DatabaseTypeLiteral,
  type DrizzleModuleOptions,
  type MigrationOptions,
  type PostgreSQLConnectionOptions,
  type SQLiteConnectionOptions,
} from './types';

/**
 * Thrown by `transaction()` on SQLite when the single connection cannot serve the request:
 * a nested transaction, or a query issued outside the transaction client from inside the
 * callback. Re-exported here because that is where it is raised.
 *
 * @see docs:api/drizzle.md
 */
export {
  DrizzleTransactionError,
  type DrizzleTransactionErrorCode,
} from './builders/transaction-gate';

/**
 * Default environment variable prefix
 */
const DEFAULT_ENV_PREFIX = 'DB';

/**
 * Resolve PostgreSQL connection options to a URL.
 *
 * Accepts either shape and validates the one it was given. The type makes a mix a compile
 * error, but options also arrive from untyped places — a JSON config, a cast, an older
 * build — so the runtime states the same rule rather than picking a winner silently.
 */
function resolvePostgreSQLUrl(options: PostgreSQLConnectionOptions): string {
  const {
    connectionString, host, port, user, password, database,
  } = options as {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };

  const discrete = {
    host, port, user, password, database, 
  };
  const supplied = Object.entries(discrete).filter(([, value]) => value !== undefined);

  if (connectionString !== undefined) {
    if (supplied.length > 0) {
      throw new Error(
        'PostgreSQL connection options carry both connectionString and discrete field(s) '
        + `(${supplied.map(([key]) => key).join(', ')}). Supply one shape or the other — a mix `
        + 'has no correct interpretation, so neither is used.',
      );
    }

    return connectionString;
  }

  const missing = Object.entries(discrete)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `PostgreSQL connection options are incomplete: ${missing.join(', ')} missing. Supply all `
      + 'of host, port, user, password and database, or a single connectionString instead. A '
      + 'partially filled object cannot describe a reachable server.',
    );
  }

  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

/**
 * How long the startup reachability probe waits for the database to answer, when the
 * connection options carry no `pool.timeout` of their own.
 *
 * The bound is the point: a black-holed host — a TCP port that accepts and then never
 * answers, which is what a dropped route or a stalled proxy looks like — used to hold
 * `app.start()` open forever with nothing logged.
 */
const DEFAULT_STARTUP_PROBE_TIMEOUT_MS = 5000;

/** The one option that turns a fatal startup into a degraded one. Quoted in every message. */
const DEGRADED_START_OPTION = 'allowDegradedStart';

/** Environment suffix of {@link DEGRADED_START_OPTION}, appended to the configured prefix. */
const DEGRADED_START_ENV_SUFFIX = 'ALLOW_DEGRADED_START';

/** Drizzle's own default, and the one this service uses when nothing else is configured. */
const DEFAULT_MIGRATIONS_FOLDER = './drizzle';

/**
 * Strip the password out of a connection URL.
 *
 * The startup error names its target so an operator can tell WHICH database refused, and a
 * PostgreSQL URL carries the password in that target. A framework's own startup error is a
 * leak channel like any other, so the password never reaches the message, the log or the
 * exception — not even when the connection failed and it is "only" a diagnostic.
 */
function redactConnectionUrl(url: string): string {
  return url
    .replace(/^([^:]+:\/\/[^:@/]*):[^@/]*@/, '$1:***@')
    .replace(/([?&](?:password|pwd)=)[^&]*/gi, '$1***');
}

/**
 * Say WHY a SQLite database would not open.
 *
 * bun:sqlite reports both "the directory is not there" and "the directory is there and I
 * may not write in it" as the same `SQLITE_CANTOPEN: unable to open database file`, and the
 * two need different fixes — one is a missing `mkdir` in the deployment, the other is a
 * volume mounted with the wrong owner. The file system is asked directly, because the
 * driver cannot tell them apart.
 */
function describeSQLiteOpenFailure(url: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (url === ':memory:' || url.startsWith('file::memory:') || url.startsWith(':memory:')) {
    return raw;
  }

  const file = path.resolve(url);
  const directory = path.dirname(file);

  if (!fs.existsSync(directory)) {
    return `the directory "${directory}" does not exist (${raw})`;
  }

  if (fs.existsSync(file)) {
    try {
      fs.accessSync(file, fs.constants.W_OK);
    } catch {
      return `the file "${file}" exists but this process may not write to it (${raw})`;
    }

    return raw;
  }

  try {
    fs.accessSync(directory, fs.constants.W_OK);
  } catch {
    return `the directory "${directory}" exists but this process may not write to it, so `
      + `"${path.basename(file)}" cannot be created (${raw})`;
  }

  return raw;
}

/**
 * Name the database an error is about: the SQLite file, or the PostgreSQL URL redacted.
 */
function describeTarget(connection: DatabaseConnectionOptions): string {
  if (connection.type === DatabaseType.SQLITE) {
    return `SQLite database "${connection.options.url}"`;
  }

  try {
    return `PostgreSQL at ${redactConnectionUrl(resolvePostgreSQLUrl(connection.options))}`;
  } catch {
    // The options do not describe a server at all, and the resolver's own message says
    // exactly what is missing — that message IS the failure being reported here.
    return 'PostgreSQL';
  }
}

/**
 * The bound for the reachability probe: the timeout the options already carry, or the
 * default. `pool.timeout` is documented as the connection timeout in milliseconds.
 */
function startupProbeTimeoutOf(connection: DatabaseConnectionOptions): number {
  if (connection.type === DatabaseType.POSTGRESQL) {
    const configured = connection.options.pool?.timeout;

    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
  }

  return DEFAULT_STARTUP_PROBE_TIMEOUT_MS;
}

/**
 * Read the degraded-start switch straight from `process.env`.
 *
 * Deliberately not part of the env schema: the switch has to be readable even when parsing
 * the rest of the configuration is what failed, and a malformed `DB_TYPE` must still be able
 * to fall back to a degraded start when the operator asked for one. Accepts the same
 * spellings as `Env.boolean`; anything else is not an opt-out.
 */
function envAllowsDegradedStart(prefix: string): boolean {
  const raw = process.env[`${prefix}_${DEGRADED_START_ENV_SUFFIX}`];

  return raw !== undefined && ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * The single sentence every startup failure ends with: what to change to boot anyway.
 *
 * One option, one meaning, both configuration paths — an operator reading the error should
 * not have to find out which of the two spellings their deployment uses.
 */
function degradedStartHint(envPrefix: string): string {
  return 'A configured database is a required one, so the application does not start without it. '
    + `Set \`${DEGRADED_START_OPTION}: true\` in DrizzleModule.forRoot(...) `
    + `(or ${envPrefix}_${DEGRADED_START_ENV_SUFFIX}=true on the environment path) to start anyway `
    + 'and accept a database that is absent, unreachable or unmigrated.';
}

/** The same text, as the warning of a start that was allowed to degrade. */
function degradedContinuation(failure: Error): string {
  return `${failure.message} Starting anyway: ${DEGRADED_START_OPTION} is set. Requests that touch `
    + 'the database will fail until it is available.';
}

/**
 * Which step of the startup sequence failed.
 *
 * - `open` — the SQLite file could not be opened, or the connection options were rejected.
 * - `connect` — the server did not answer the reachability probe inside its timeout.
 * - `migrate` — a migration that exists failed to apply. (A migration folder that does not
 *   exist is "no migrations", not a failure.)
 *
 * @see docs:api/drizzle.md
 */
export type DrizzleStartupStage = 'open' | 'connect' | 'migrate';

/**
 * Raised from `onModuleInit` when a database the application configured explicitly cannot be
 * used, which makes `app.start()` reject before the HTTP server binds.
 *
 * Configured means required. Degrading to a process that starts, passes readiness and then
 * fails every request that touches the database is the behaviour this replaces; the opt-out
 * is `allowDegradedStart: true` (`DB_ALLOW_DEGRADED_START=true` on the environment path).
 *
 * @see docs:api/drizzle.md
 */
export class DrizzleStartupError extends Error {
  override readonly name = 'DrizzleStartupError';

  constructor(
    /** Which step failed. */
    readonly stage: DrizzleStartupStage,
    /** The database it failed against, with any password redacted. */
    readonly target: string,
    /** How long the attempt took before it was given up. */
    readonly waitedMs: number,
    /** The bound that applied, or `null` where the step cannot be timed out. */
    readonly timeoutMs: number | null,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Database environment schema
 */
interface DatabaseEnvSchema {
  type: string;
  url: string;
  schemaPath?: string;
  migrationsFolder?: string;
  migrationsTable?: string;
  migrationsSchema?: string;
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
    migrationsTable: Env.string({
      env: `${prefix}_MIGRATIONS_TABLE`,
    }),
    migrationsSchema: Env.string({
      env: `${prefix}_MIGRATIONS_SCHEMA`,
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

  const migrationsTable = rawEnv[`${prefix}_MIGRATIONS_TABLE`]
    ? await Effect.runPromise(
      EnvParser.parse(
        `${prefix}_MIGRATIONS_TABLE`,
        rawEnv[`${prefix}_MIGRATIONS_TABLE`],
        schema.migrationsTable!,
      ),
    )
    : undefined;

  const migrationsSchema = rawEnv[`${prefix}_MIGRATIONS_SCHEMA`]
    ? await Effect.runPromise(
      EnvParser.parse(
        `${prefix}_MIGRATIONS_SCHEMA`,
        rawEnv[`${prefix}_MIGRATIONS_SCHEMA`],
        schema.migrationsSchema!,
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
    migrationsTable,
    migrationsSchema,
    autoMigrate,
    logQueries,
  };
}

const DEFAULT_MIGRATIONS_TABLE = '__drizzle_migrations';
const DEFAULT_MIGRATIONS_SCHEMA = 'drizzle';

/** A journal identifier is interpolated into SQL, so it may only be an identifier. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * A table or schema name cannot be a bound parameter, so it reaches the query as text.
 * Rejecting anything that is not a plain identifier is what makes that interpolation safe.
 */
function assertSafeIdentifier(value: string, option: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Invalid ${option} "${value}": a journal table or schema name must be a plain SQL `
      + 'identifier — letters, digits, underscores and $, not starting with a digit.',
    );
  }
}

/**
 * One database the application configured, flattened from whichever path configured it.
 *
 * Both paths produce this and then take the same code, because "configured means required"
 * has to hold identically for `DrizzleModule.forRoot({ connection })` and for `DB_URL`.
 */
interface ConfiguredDatabaseStart {
  connection: DatabaseConnectionOptions;
  autoMigrate: boolean;
  migrationsFolder?: string;
  migrationsTable?: string;
  migrationsSchema?: string;
  allowDegradedStart: boolean;
  /** Environment prefix, so the error names the variable THIS application would set. */
  envPrefix: string;
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
 * 
 * The service automatically infers database types from table schemas.
 * No generic parameter is required - just use select(), insert(), update(), delete()
 * with your table schemas and TypeScript will infer the correct types.
 *
 * @example
 * ```typescript
 * // Define tables with proper types
 * const users = sqliteTable('users', { ... });  // SQLite table
 * const orders = pgTable('orders', { ... });    // PostgreSQL table
 * 
 * // Use DrizzleService without generic parameter
 * @Service()
 * class UserService extends BaseService {
 *   constructor(private db: DrizzleService) {
 *     super();
 *   }
 *   
 *   async findAll() {
 *     // TypeScript infers SQLite types from `users` table
 *     return this.db.select().from(users);
 *   }
 * }
 * ```
 *
 * @see docs:api/drizzle.md
 */
@Service()
export class DrizzleService extends BaseService implements OnModuleInit, OnModuleDestroy {
  private db: DatabaseInstance | null = null;
  /**
   * What `getDatabase()` hands out on SQLite: the same database with every query gated on
   * the transaction that may be holding the single connection. `null` on PostgreSQL, where
   * a transaction takes a pooled connection and nothing has to wait.
   */
  private gatedDb: DatabaseInstance | null = null;
  private dbType: DatabaseTypeLiteral | null = null;
  private connectionOptions: DatabaseConnectionOptions | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sqliteClient: Database | null = null;
  private postgresClient: SQL | null = null;
  /** Serializes SQLite transactions and queues ordinary queries behind them. */
  private readonly sqliteGate = new SQLiteTransactionGate();
  /**
   * Which folder claimed each journal, keyed by `schema.table`.
   *
   * Two migration folders sharing one journal is the defect this option exists to fix, so
   * the option ships with the guard that makes the mistake impossible to hit silently.
   */
  private readonly journalOwners = new Map<string, string>();
  private logBuffer: BufferedLogEntry[] = [];
  private exitHandlerRegistered = false;

  constructor() {
    super();
    // Register exit handler to flush buffered logs on crash
    this.registerExitHandler();
  }

  /**
   * Patch bun:sqlite for optimal performance with drizzle-orm:
   * 1. Statement caching — drizzle calls .prepare() without caching; we add a cache.
   * 2. Optimized .get() on drizzle's PreparedQuery — the default implementation uses
   *    stmt.values(...)[0] which materializes all rows as arrays then takes the first.
   *    We patch to use stmt.get() (native single-row fetch) + Object.values() conversion.
   *    Measured on 5000 rows: 402us vs 1373us for `select().from(t).get()`.
   *
   *    That conversion is only sound when the result has no duplicate column names.
   *    `mapResultRow` is POSITIONAL, while an object has one key per NAME — so a join
   *    between two tables that both select `id` produced an array one element short, and
   *    every value after the collision shifted one field left. Silently: HTTP 200 with a
   *    user id in the amount field. bun:sqlite reports both shapes, and they disagree
   *    exactly when it happens (`columnNames` is deduplicated, `columnTypes` is not), so
   *    the collision is detected once per statement and those queries take drizzle's own
   *    array-shaped read instead.
   */
  private patchSQLiteStatementCaching(): void {
    const client = this.sqliteClient;
    if (!client) {
      return;
    }

    // How many columns the SQL actually returns, as opposed to how many keys an object row
    // has. `columnTypes` keeps one entry per column; an object collapses repeats. Read ONLY
    // after the statement has been executed — reading it on a statement whose parameters are
    // still unbound steps it with nulls and can throw `datatype mismatch`. Cached per
    // statement, and the statements are cached by Patch 1.
    const sqlColumnCount = new WeakMap<object, number>();
    const columnCountOf = (stmt: object): number => {
      const cached = sqlColumnCount.get(stmt);
      if (cached !== undefined) {
        return cached;
      }

      let count = -1;
      try {
        const { columnTypes } = stmt as { columnTypes?: string[] };
        count = columnTypes?.length ?? -1;
      } catch {
        // A driver that will not say is treated as unsafe: the positional path is correct,
        // and correctness is not the thing to guess about.
        count = -1;
      }
      sqlColumnCount.set(stmt, count);

      return count;
    };

    // Patch 1: Statement cache for .prepare()
    const cache = new Map<string, ReturnType<typeof client.prepare>>();
    const originalPrepare = client.prepare.bind(client);

    client.prepare = ((sql: string) => {
      let stmt = cache.get(sql);
      if (!stmt) {
        stmt = originalPrepare(sql);
        cache.set(sql, stmt);
      }

      return stmt;
    }) as typeof client.prepare;

    // Patch 2: Monkey-patch drizzle's session to use optimized .get()
    // We intercept the session's prepareQuery to override .get() on each PreparedQuery.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    const session = db?.session;
    if (!session) {
      return;
    }

    const originalPrepareQuery = session.prepareQuery.bind(session);
    session.prepareQuery = function (...args: unknown[]) {
      const pq = originalPrepareQuery(...args);

      pq.get = function (placeholderValues: unknown) {
        // Access private fields via 'this' context
        const {
          stmt, fields, joinsNotNullableMap, customResultMapper, query: q, logger, 
        } = pq;
        const { fillPlaceholders } = require('drizzle-orm/sql');

        const params = fillPlaceholders(q.params, placeholderValues ?? {});
        logger.logQuery(q.sql, params);

        // Use native .get() — returns one row as object (or null)
        const obj = stmt.get(...params);
        if (!obj) {
          return undefined;
        }

        // An object has one key per NAME, `mapResultRow` is POSITIONAL, and a join between
        // two tables that both select `id` yields fewer keys than columns. Re-read that one
        // positionally: the array-shaped read is what drizzle itself does, and it costs the
        // extra read only on the queries that would otherwise be silently wrong.
        const columns = columnCountOf(stmt);
        const expected = (fields as unknown[] | undefined)?.length ?? columns;
        if (expected < 0 || Object.keys(obj).length !== expected) {
          const row = stmt.values(...params)[0];
          if (!row) {
            return undefined;
          }

          if (!fields && !customResultMapper) {
            return row;
          }

          if (customResultMapper) {
            return customResultMapper([row]);
          }

          const { mapResultRow: mapPositionalRow } = require('drizzle-orm/utils');

          return mapPositionalRow(fields, row, joinsNotNullableMap);
        }

        if (!fields && !customResultMapper) {
          // No JOIN mapping needed — return object values as array (drizzle expects this)
          return Object.values(obj);
        }

        if (customResultMapper) {
          return customResultMapper([Object.values(obj)]);
        }

        const { mapResultRow } = require('drizzle-orm/utils');

        return mapResultRow(fields, Object.values(obj), joinsNotNullableMap);
      };

      return pq;
    };
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
   * Module initialization hook - called by the framework after initializeService()
   * This ensures the database is fully ready before client code runs
   *
   * A configured database that cannot be used fails HERE, which is what makes `app.start()`
   * reject before the HTTP server binds. See {@link DrizzleStartupError}.
   *
   * @see docs:api/drizzle.md
   */
  async onModuleInit(): Promise<void> {
    // Flush any buffered logs now that logger is available
    this.flushLogBuffer();

    // Run auto-initialization
    await this.autoInitialize();
  }

  /**
   * Auto-initialize database from environment variables and/or module options
   * Only initializes if explicit configuration is provided (module options or DB_URL env var)
   *
   * An application that configures NOTHING keeps the old behaviour exactly: no connection is
   * opened and nothing fails. Everything below is about a configuration the user wrote.
   */
  private async autoInitialize(): Promise<void> {
    const moduleOptions = this.getModuleOptions();
    const envPrefix = moduleOptions?.envPrefix ?? DEFAULT_ENV_PREFIX;

    // If module options are provided, use them
    if (moduleOptions?.connection) {
      this.safeLog('debug', 'Auto-initializing database service from module options', {
        type: moduleOptions.connection.type,
      });

      await this.startConfiguredDatabase({
        connection: moduleOptions.connection,
        autoMigrate: moduleOptions.autoMigrate !== false,
        migrationsFolder: moduleOptions.migrationsFolder,
        migrationsTable: moduleOptions.migrationsTable,
        migrationsSchema: moduleOptions.migrationsSchema,
        // Module options are code, so the opt-out is the option — not an environment
        // variable that would silently override what the code asked for.
        allowDegradedStart: moduleOptions.allowDegradedStart === true,
        envPrefix,
      });

      return;
    }

    // Otherwise, check environment variables
    // Only auto-initialize if DB_URL is explicitly set in process.env and not empty
    // Check process.env directly to ensure we only auto-initialize when explicitly configured
    const dbUrlFromProcess = process.env[`${envPrefix}_URL`];
    if (!dbUrlFromProcess || dbUrlFromProcess.trim() === '') {
      this.safeLog('debug', 'Skipping auto-initialization: no database configuration found in process.env');
      this.initialized = false;

      return;
    }

    const allowDegradedStart = moduleOptions?.allowDegradedStart === true || envAllowsDegradedStart(envPrefix);

    let envConfig: DatabaseEnvSchema;
    try {
      envConfig = await loadFromEnv(envPrefix);
    } catch (error) {
      // A malformed value is still a configuration the user wrote and the framework cannot
      // honour, so it fails the boot rather than starting without a database.
      this.initialized = false;
      const failure = new DrizzleStartupError(
        'open',
        `the ${envPrefix}_* environment`,
        0,
        null,
        `${envPrefix}_URL is set, but the database configuration in the environment could not be read: `
        + `${error instanceof Error ? error.message : String(error)}. `
        + degradedStartHint(envPrefix),
        { cause: error },
      );

      if (!allowDegradedStart) {
        throw failure;
      }

      this.safeLog('warn', degradedContinuation(failure), { stage: failure.stage });

      return;
    }

    const dbType = envConfig.type === DatabaseType.SQLITE ? DatabaseType.SQLITE : DatabaseType.POSTGRESQL;

    const connectionOptions: DatabaseConnectionOptions =
      dbType === DatabaseType.SQLITE
        ? {
          type: DatabaseType.SQLITE,
          options: { url: envConfig.url },
        }
        : {
          type: DatabaseType.POSTGRESQL,
          // Passed through, not parsed into fields and reassembled: that round trip
          // dropped everything after the path, so a DB_URL carrying `?sslmode=require`
          // silently connected without SSL.
          options: { connectionString: envConfig.url },
        };

    this.safeLog('debug', `Auto-initializing database service with type: ${connectionOptions.type}`, {
      envPrefix,
    });

    await this.startConfiguredDatabase({
      connection: connectionOptions,
      autoMigrate: envConfig.autoMigrate === true,
      migrationsFolder: envConfig.migrationsFolder,
      migrationsTable: envConfig.migrationsTable,
      migrationsSchema: envConfig.migrationsSchema,
      allowDegradedStart,
      envPrefix,
    });
  }

  /**
   * Open, verify and migrate a database the application configured explicitly.
   *
   * One routine for both configuration paths, because the guarantee has to be the same on
   * both: the module-options path used to warn and carry on, and the environment path — the
   * documented default — logged a single `debug` line and carried on. Either way the server
   * bound, readiness passed, and every request that touched the database returned 500.
   */
  private async startConfiguredDatabase(plan: ConfiguredDatabaseStart): Promise<void> {
    const target = describeTarget(plan.connection);
    const timeoutMs = startupProbeTimeoutOf(plan.connection);
    const startedAt = Date.now();

    try {
      // Pass skipWait=true to avoid deadlock (we're already inside initPromise)
      await this.initialize(plan.connection, true);
      await this.verifyReachable(plan, target, timeoutMs, startedAt);

      if (plan.autoMigrate) {
        await this.runStartupMigrations(plan, target, startedAt);
      } else {
        this.safeLog('debug', 'Auto-migrations disabled; the reachability check still ran');
      }

      this.initialized = this.db !== null;
    } catch (error) {
      const failure = error instanceof DrizzleStartupError
        ? error
        : this.openFailure(plan, target, Date.now() - startedAt, error);

      if (!plan.allowDegradedStart) {
        // Nothing may keep a socket or a file handle for a database this process has just
        // refused to start with: the container has to exit, not linger holding a connection.
        await this.close().catch(() => undefined);
        this.initialized = false;

        throw failure;
      }

      this.safeLog('warn', degradedContinuation(failure), {
        stage: failure.stage,
        target: failure.target,
        waitedMs: failure.waitedMs,
      });
      this.initialized = this.db !== null;
    }
  }

  /**
   * Wrap a failure that is not one of the staged ones — the file would not open, or the
   * connection options do not describe a server.
   *
   * `openSQLite()` and `resolvePostgreSQLUrl()` already say which database and why, so the
   * target is prefixed only when the cause does not carry it. Repeating it reads as two
   * different failures.
   */
  private openFailure(
    plan: ConfiguredDatabaseStart,
    target: string,
    waitedMs: number,
    cause: unknown,
  ): DrizzleStartupError {
    const causeText = cause instanceof Error ? cause.message : String(cause);
    const head = causeText.includes(target) ? causeText : `${target} could not be opened: ${causeText}`;

    return new DrizzleStartupError(
      'open',
      target,
      waitedMs,
      null,
      `${head} (waited ${waitedMs}ms). ${degradedStartHint(plan.envPrefix)}`,
      { cause },
    );
  }

  /**
   * Prove the configured database can actually be reached, inside a bound.
   *
   * PostgreSQL connects lazily — `drizzlePostgres(url)` touches no socket — so before this
   * check nothing in the boot sequence ever spoke to the server, and the first evidence that
   * it was unreachable was a 500 on a live request. The `SELECT 1` is raced against the
   * timeout because a host that accepts the connection and never answers (a dropped route, a
   * stalled proxy) otherwise holds `app.start()` open forever.
   */
  private async verifyReachable(
    plan: ConfiguredDatabaseStart,
    target: string,
    timeoutMs: number,
    startedAt: number,
  ): Promise<void> {
    if (plan.connection.type === DatabaseType.SQLITE) {
      // Opening the file IS the reachability check on SQLite, and `initialize()` has just
      // done it: the database is created, the pragmas are applied, and both fail loudly when
      // the file cannot be opened or written.
      return;
    }

    const client = this.postgresClient;
    if (!client) {
      throw new DrizzleStartupError(
        'connect',
        target,
        Date.now() - startedAt,
        timeoutMs,
        `${target} produced no client to probe with. ${degradedStartHint(plan.envPrefix)}`,
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    // The probe outlives the timeout — the query is still in flight when the race is lost —
    // and an unhandled rejection from it would be reported as a crash by the process-level
    // handler this service installs. Settling it here is what keeps the failure a single
    // named error instead of a crash report.
    const probe = client`SELECT 1`.then(() => 'answered' as const);
    probe.catch(() => undefined);

    try {
      const outcome = await Promise.race([
        probe,
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), timeoutMs);
        }),
      ]);

      if (outcome === 'timeout') {
        throw new DrizzleStartupError(
          'connect',
          target,
          Date.now() - startedAt,
          timeoutMs,
          `${target} accepted no answer to SELECT 1 within the ${timeoutMs}ms connect timeout `
          + `(waited ${Date.now() - startedAt}ms). ${degradedStartHint(plan.envPrefix)}`,
        );
      }

      this.safeLog('debug', 'Database reachability confirmed', { target, timeoutMs });
    } catch (error) {
      if (error instanceof DrizzleStartupError) {
        throw error;
      }

      throw new DrizzleStartupError(
        'connect',
        target,
        Date.now() - startedAt,
        timeoutMs,
        `${target} did not answer SELECT 1 within the ${timeoutMs}ms connect timeout `
        + `(waited ${Date.now() - startedAt}ms): ${error instanceof Error ? error.message : String(error)}. `
        + degradedStartHint(plan.envPrefix),
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Apply the migrations that exist, and fail the boot when one of them fails.
   *
   * The two cases are NOT the same failure. `migrationsFolder` defaults to `./drizzle`, so
   * an application that never generated a migration reaches this with no folder at all —
   * "no migrations" is the normal state of such an application, and it starts. A migration
   * that exists and then fails leaves the schema half-built, which is exactly the state no
   * process should serve traffic in.
   */
  private async runStartupMigrations(
    plan: ConfiguredDatabaseStart,
    target: string,
    startedAt: number,
  ): Promise<void> {
    const migrationsFolder = plan.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');

    if (!fs.existsSync(journalPath)) {
      // An explicitly configured folder that is not there is worth a word — it is usually a
      // path that did not survive the build — but it is still "no migrations", not a failure.
      this.safeLog(
        plan.migrationsFolder === undefined ? 'debug' : 'warn',
        `No migrations to run: "${journalPath}" does not exist`,
        { migrationsFolder },
      );

      return;
    }

    this.safeLog('debug', 'Running auto-migrations', { migrationsFolder });

    try {
      // Pass skipWait=true to avoid deadlock (we're already inside initPromise)
      await this.runMigrations({
        migrationsFolder,
        migrationsTable: plan.migrationsTable,
        migrationsSchema: plan.migrationsSchema,
      }, true);
      this.safeLog('debug', 'Auto-migrations completed successfully');
    } catch (error) {
      throw new DrizzleStartupError(
        'migrate',
        target,
        Date.now() - startedAt,
        null,
        `Migrations in "${migrationsFolder}" failed against ${target} after ${Date.now() - startedAt}ms: `
        + `${error instanceof Error ? error.message : String(error)}. `
        + 'The schema is not the one the application expects. '
        + degradedStartHint(plan.envPrefix),
        { cause: error },
      );
    }
  }

  /**
   * Get module options from DrizzleModule if available
   */
  private getModuleOptions(): DrizzleModuleOptions | undefined {
    // THIS service's own registration first. The class-static slot below is shared by every
    // registration in the process, so reading it first is what made two forRoot() calls
    // collapse onto the last one — two DrizzleService instances, one database, silently.
    const own = this.registrationOptions<DrizzleModuleOptions>();
    if (own) {
      return own;
    }

    try {
      // Fallback for the no-application path: createTestService() builds the service with no
      // module, so there is no registration to read from.
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
   * Open the SQLite file and apply its pragmas, saying which of the two went wrong.
   *
   * Opening the file is the whole reachability check on SQLite, so it has to fail with
   * something an operator can act on. bun:sqlite reports a missing directory and an
   * unwritable one identically (`SQLITE_CANTOPEN`), and a write pragma against a read-only
   * database fails AFTER a perfectly successful open — three different fixes behind two
   * driver messages.
   */
  private openSQLite(options: SQLiteConnectionOptions): Database {
    let client: Database;

    try {
      client = new Database(options.url, options.options);
    } catch (error) {
      throw new Error(
        `SQLite database "${options.url}" could not be opened: ${describeSQLiteOpenFailure(options.url, error)}`,
        { cause: error },
      );
    }

    // Apply SQLite pragmas before creating drizzle instance
    const pragmas = options.pragmas ?? ['journal_mode = WAL', 'synchronous = NORMAL'];
    for (const pragma of pragmas) {
      try {
        client.run(`PRAGMA ${pragma}`);
      } catch (error) {
        client.close();

        throw new Error(
          `SQLite database "${options.url}" opened, but PRAGMA ${pragma} failed: `
          + `${error instanceof Error ? error.message : String(error)}. `
          + 'The default pragmas write to the database; a read-only one needs `pragmas: []` '
          + 'or a list that does not write.',
          { cause: error },
        );
      }
    }

    return client;
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
    this.dbType = options.type;

    if (options.type === DatabaseType.SQLITE) {
      const sqliteOptions = options.options;
      this.sqliteClient = this.openSQLite(sqliteOptions);

      this.db = drizzleSQLite(this.sqliteClient);
      this.gatedDb = createGatedDatabase(this.db, this.sqliteGate);
      this.patchSQLiteStatementCaching();
      this.safeLog('info', 'SQLite database initialized', { url: sqliteOptions.url });
    } else if (options.type === DatabaseType.POSTGRESQL) {
      const pgOptions = options.options;

      // Either shape: a connectionString is used as given, discrete fields are assembled.
      const connectionUrl = resolvePostgreSQLUrl(pgOptions);

      // Use Bun.SQL - recommended way according to Drizzle docs
      // Pass connection string directly to drizzle()
      this.db = drizzlePostgres(connectionUrl);

      // Store client reference for closing if needed
      // Drizzle returns database with $client property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.postgresClient = (this.db as any).$client as SQL | null;

      this.safeLog('info', 'PostgreSQL database initialized with Bun.SQL', {
        // The discrete fields are all undefined on the connectionString shape, so the
        // redacted URL is the only line that names the target on both. It is redacted
        // because a log is a leak channel exactly like an error message is.
        target: redactConnectionUrl(connectionUrl),
      });
    } else {
      const _exhaustive: never = options;
      throw new Error(`Unsupported database type: ${(_exhaustive as DatabaseConnectionOptions).type}`);
    }

    this.initialized = true;
  }

  /**
   * Get raw database instance
   * 
   * Returns a union type - use isSQLite()/isPostgreSQL() type guards
   * or getSQLiteDatabase()/getPostgreSQLDatabase() for specific types.
   * 
   * For most use cases, prefer using select(), insert(), update(), delete()
   * methods which automatically infer types from table schemas.
   *
   * On SQLite the instance returned here is gated on `transaction()`: a query built from it
   * while a transaction holds the single connection runs after that transaction commits or
   * rolls back, instead of joining it. `getSQLiteDatabase()` and `getSQLiteClient()` are the
   * ungated escape hatches.
   *
   * @see docs:api/drizzle.md
   */
  getDatabase(): DatabaseInstance {
    if (!this.db || !this.dbType) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    return this.gatedDb ?? this.db;
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
   * Get the dialect-specific PostgreSQL database instance. Throws if the database is not
   * PostgreSQL.
   *
   * A supported escape hatch, not internal. `select()`, `insert()`, `update()` and
   * `delete()` resolve to the PostgreSQL builders and cover the ordinary query surface,
   * including `.limit()`, `.for()` and a projected `.returning()`. Reach for this only when
   * you need something the universal surface does not model at all — a PostgreSQL-only
   * feature, or a raw `sql` construction against the typed schema.
   *
   * @see docs:api/drizzle.md
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
   * Refuse a second migration folder that would share a journal with the first.
   *
   * Drizzle decides what to apply by comparing a folder's timestamp against the NEWEST row
   * in the journal, never by hash. So when two folders share one journal, whichever set was
   * generated earlier is skipped entirely — no error, no log, and the application starts
   * and then fails at the first query against a table that was never created.
   *
   * Several journals in one process is the SUPPORTED shape, and the point of
   * `migrationsTable`: a package that ships its own migrations owns its own journal. What
   * is refused is several folders sharing ONE journal, which cannot work by construction.
   */
  private assertJournalNotShared(
    migrationsFolder: string,
    migrationsTable: string,
    migrationsSchema: string,
  ): void {
    const journalKey = `${migrationsSchema}.${migrationsTable}`;
    const owner = this.journalOwners.get(journalKey);

    if (owner === undefined) {
      this.journalOwners.set(journalKey, migrationsFolder);

      return;
    }

    if (owner !== migrationsFolder) {
      throw new Error(
        `Migration folder "${migrationsFolder}" would share the journal "${journalKey}" with `
        + `"${owner}". Drizzle applies a migration only when its folder timestamp is newer than `
        + 'the newest row in the journal, so whichever set was generated earlier would be skipped '
        + 'silently and its tables would never be created. Give this set its own journal: '
        + `runMigrations({ migrationsFolder: "${migrationsFolder}", migrationsTable: "..." }).`,
      );
    }
  }

  /**
   * Read migration journal and compute hashes for each migration file
   * Returns a map of hash -> migration filename
   */
  private readMigrationJournal(migrationsFolder: string): Map<string, string> {
    const hashToFilename = new Map<string, string>();
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');

    if (!fs.existsSync(journalPath)) {
      // No journal file - return empty map
      return hashToFilename;
    }

    try {
      const journalContent = fs.readFileSync(journalPath, 'utf-8');
      const journal = JSON.parse(journalContent) as {
        entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
      };

      for (const entry of journal.entries) {
        const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);

        if (fs.existsSync(migrationPath)) {
          const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
          const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');
          hashToFilename.set(hash, entry.tag);
        }
      }
    } catch {
      // If journal parsing fails, return empty map
      this.safeLog('warn', 'Failed to read migration journal', { journalPath });
    }

    return hashToFilename;
  }

  /**
   * Read the hashes already recorded in the journal table.
   *
   * ASYNC deliberately. Bun's SQL template returns a lazy thenable, so the previous
   * synchronous version read `.length` off a promise — always `undefined`, always an
   * empty set, so PostgreSQL reported "0 migrations applied" no matter what ran. That
   * count is exactly the signal an operator would use to notice a silently skipped set.
   *
   * The table name is interpolated rather than bound because a table identifier cannot be
   * a query parameter. Both parts are validated by `assertSafeIdentifier` at the call
   * site, which is what keeps that safe.
   */
  private async getAppliedMigrationHashes(
    migrationsTable: string,
    migrationsSchema: string,
  ): Promise<Set<string>> {
    const hashes = new Set<string>();

    try {
      if (this.connectionOptions?.type === DatabaseType.SQLITE && this.sqliteClient) {
        // SQLite has no schemas, so the journal is a bare table name.
        const tableExists = this.sqliteClient.query(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name='${migrationsTable}'
        `).all();

        if (tableExists.length > 0) {
          const migrations = this.sqliteClient.query(`
            SELECT hash FROM "${migrationsTable}"
          `).all() as Array<{ hash: string }>;

          for (const m of migrations) {
            hashes.add(m.hash);
          }
        }
      } else if (this.connectionOptions?.type === DatabaseType.POSTGRESQL && this.postgresClient) {
        // Schema-qualified: drizzle puts the journal in its own schema ('drizzle' by
        // default), so an unqualified name matched nothing here.
        const tableExistsResult = await this.postgresClient`
          SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = ${migrationsSchema} AND table_name = ${migrationsTable}
          ) as exists
        ` as unknown as Array<{ exists: boolean }>;

        if (tableExistsResult.length > 0 && tableExistsResult[0]?.exists) {
          const migrationsResult = await this.postgresClient`
            SELECT hash FROM ${this.postgresClient(migrationsSchema)}.${this.postgresClient(migrationsTable)}
          ` as unknown as Array<{ hash: string }>;

          for (const m of migrationsResult) {
            hashes.add(m.hash);
          }
        }
      }
    } catch (error) {
      // Absence is normal on a first run; anything else is worth seeing, where the old
      // bare `catch {}` hid a broken query behind a plausible-looking empty result.
      this.safeLog('debug', 'Could not read the migration journal', {
        migrationsTable,
        migrationsSchema,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return hashes;
  }

  /**
   * Run migrations
   *
   * Drizzle-kit automatically tracks applied migrations in the `__drizzle_migrations` table
   * and prevents double application of migrations. This method uses drizzle's built-in
   * migration system which ensures idempotency.
   *
   * Logs the names of each migration file that was applied during this run.
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

    const migrationsFolder = options?.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
    const migrationsTable = options?.migrationsTable ?? DEFAULT_MIGRATIONS_TABLE;
    const migrationsSchema = options?.migrationsSchema ?? DEFAULT_MIGRATIONS_SCHEMA;

    assertSafeIdentifier(migrationsTable, 'migrationsTable');
    assertSafeIdentifier(migrationsSchema, 'migrationsSchema');
    this.assertJournalNotShared(migrationsFolder, migrationsTable, migrationsSchema);

    // Read migration journal to get hash -> filename mapping
    const hashToFilename = this.readMigrationJournal(migrationsFolder);

    // Get already applied migrations before running
    const appliedBefore = await this.getAppliedMigrationHashes(migrationsTable, migrationsSchema);

    if (this.connectionOptions.type === DatabaseType.SQLITE) {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      // migrationsSchema is omitted: SQLite has no schemas and drizzle rejects it there.
      await migrate(this.db as BunSQLiteDatabase<Record<string, SQLiteTable>>, {
        migrationsFolder,
        migrationsTable,
      });
    } else if (this.connectionOptions.type === DatabaseType.POSTGRESQL) {
      if (!this.db) {
        throw new Error('Database not initialized');
      }
      await migratePostgres(this.db as BunSQLDatabase<Record<string, PgTable>>, {
        migrationsFolder,
        migrationsTable,
        migrationsSchema,
      });
    }

    // Get applied migrations after running
    const appliedAfter = await this.getAppliedMigrationHashes(migrationsTable, migrationsSchema);

    // Find newly applied migrations
    const newlyApplied: string[] = [];
    for (const hash of appliedAfter) {
      if (!appliedBefore.has(hash)) {
        const filename = hashToFilename.get(hash);
        if (filename) {
          newlyApplied.push(filename);
        }
      }
    }

    // Log each applied migration
    for (const filename of newlyApplied) {
      this.safeLog('info', `Applied migration: ${filename}`);
    }

    // A journal entry that is neither already applied nor applied just now was skipped.
    // Drizzle decides by comparing folder timestamps against the newest journal row, so
    // this is what a set generated earlier than another set's head looks like — silently,
    // until the first query against a table that was never created.
    const skipped: string[] = [];
    for (const [hash, filename] of hashToFilename) {
      if (!appliedAfter.has(hash)) {
        skipped.push(filename);
      }
    }

    if (skipped.length > 0) {
      this.safeLog(
        'warn',
        `${skipped.length} migration(s) in "${migrationsFolder}" were neither applied nor already `
        + 'recorded. Drizzle applies a migration only when its folder timestamp is newer than the '
        + 'newest row in the journal, so a set generated before another set that shares this journal '
        + 'is skipped in silence. Give this set its own journal with migrationsTable.',
        {
          migrationsFolder, migrationsTable, migrationsSchema, skipped, 
        },
      );
    }

    // Log summary
    const dbTypeName = this.connectionOptions.type === DatabaseType.SQLITE ? 'SQLite' : 'PostgreSQL';

    this.safeLog('info', `${dbTypeName} migrations applied`, { 
      migrationsFolder, 
      newMigrations: newlyApplied.length,
      appliedFiles: newlyApplied,
    });
  }

  /**
   * Close database connection
   */
  /**
   * Close the connection when the application stops.
   *
   * `close()` existed from the start and nothing in the lifecycle called it, so a service
   * from one test suite kept its connection open into the next — the direct mechanism behind
   * a suite reporting `database "..." does not exist` after an earlier suite dropped its
   * throwaway database.
   *
   * @see docs:api/drizzle.md
   */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

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
    this.gatedDb = null;
    this.dbType = null;
    this.connectionOptions = null;
    this.initialized = false;
    this.safeLog('info', 'Database connection closed');
  }

  /**
   * Execute a transaction with universal transaction client
   *
   * The transaction client provides the same API as DrizzleService
   * with automatic type inference from table schemas.
   *
   * One API and one observable behaviour on both dialects: the callback may await, and a
   * throw rolls the whole thing back. How that is reached differs, because the drivers do:
   *
   * - PostgreSQL keeps drizzle's own `transaction()`. bun-sql runs `client.begin(async ...)`,
   *   which genuinely awaits the callback, on a connection taken from the pool — correct as
   *   it stands, and unaffected by anything below.
   * - SQLite is issued as manual BEGIN / COMMIT | ROLLBACK on the raw bun:sqlite client.
   *   drizzle's bun-sqlite session is SYNCHRONOUS: `client.transaction(fn)` commits the
   *   moment `fn` returns, and an async `fn` returns a pending promise at its first `await` —
   *   so everything past that `await`, the throw included, ran after COMMIT and nothing was
   *   ever rolled back. bun:sqlite is also ONE connection, so while the transaction is open
   *   every other query is queued behind it (see {@link SQLiteTransactionGate}) rather than
   *   silently enrolled in it and rolled back with it.
   *
   * @example
   * ```typescript
   * await db.transaction(async (tx) => {
   *   const users = await tx.select().from(usersTable);
   *   await tx.insert(usersTable).values({ name: 'John' });
   *   await tx.update(usersTable).set({ name: 'Jane' }).where(eq(usersTable.id, 1));
   * });
   * ```
   *
   * @throws DrizzleTransactionError on SQLite when called from inside another transaction
   * callback, which the single connection cannot serve.
   *
   * @see docs:api/drizzle.md
   */
  async transaction<R>(
    callback: (tx: UniversalTransactionClient) => Promise<R>,
  ): Promise<R> {
    await this.waitForInit();

    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    if (this.dbType === DatabaseType.SQLITE) {
      return await this.runSQLiteTransaction(callback);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (this.db as any).transaction(async (rawTx: DatabaseInstance) => {
      const wrappedTx = new UniversalTransactionClient(rawTx);

      return await callback(wrappedTx);
    });
  }

  /**
   * Run a transaction on the single bun:sqlite connection.
   *
   * The callback receives the database itself: BEGIN is already on the connection, so its
   * statements are in the transaction with no wrapper needed — and, unlike everything handed
   * out by `getDatabase()`, they must not wait for the gate this transaction holds.
   */
  private async runSQLiteTransaction<R>(
    callback: (tx: UniversalTransactionClient) => Promise<R>,
  ): Promise<R> {
    const client = this.sqliteClient;
    if (!client) {
      throw new Error('SQLite client not available. Call initialize() first.');
    }

    // Refuses a nested transaction, and otherwise waits for whichever transaction is on the
    // connection already — two overlapping transactions are serialized, not collided.
    await this.sqliteGate.acquire();

    try {
      client.run('BEGIN');

      let result: R;
      try {
        result = await this.sqliteGate.runInContext(
          this.db!,
          async () => await callback(new UniversalTransactionClient(this.db!)),
        );
      } catch (error) {
        this.rollbackSQLite(client, error);

        throw error;
      }

      try {
        client.run('COMMIT');
      } catch (commitError) {
        // A COMMIT that fails leaves the transaction open, so it still has to be undone.
        this.rollbackSQLite(client, commitError);

        throw commitError;
      }

      return result;
    } finally {
      this.sqliteGate.releaseAcquired();
    }
  }

  /**
   * Undo the transaction without ever replacing the caller's error with the rollback's.
   *
   * What the caller needs to see is why their work failed; a ROLLBACK that also fails is an
   * operational fact for the log, not a substitute for that.
   */
  private rollbackSQLite(client: Database, cause: unknown): void {
    try {
      client.run('ROLLBACK');
    } catch (rollbackError) {
      this.safeLog('error', 'SQLite ROLLBACK failed; the transaction may still be open', {
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  // ============================================
  // Direct database operation methods
  // These methods use universal builders that infer
  // database type from table schemas
  // ============================================

  /**
   * Create a SELECT query
   * 
   * Returns a builder with from() method that infers the correct
   * database type from the table schema.
   * 
   * @example
   * ```typescript
   * // Select all columns - type inferred from table
   * const users = await this.db.select().from(usersTable);
   * 
   * // Select specific columns
   * const names = await this.db.select({ name: usersTable.name }).from(usersTable);
   * ```
   */
  select(): UniversalSelectBuilder;
  select<TFields extends Record<string, unknown>>(fields: TFields): UniversalSelectBuilder<TFields>;
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  select<TFields extends Record<string, unknown>>(fields?: TFields) {
    const db = this.getDatabase();

    return new UniversalSelectBuilder(db, fields);
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
  selectDistinct(): UniversalSelectDistinctBuilder;
  selectDistinct<TFields extends Record<string, unknown>>(fields: TFields): UniversalSelectDistinctBuilder<TFields>;
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  selectDistinct<TFields extends Record<string, unknown>>(fields?: TFields) {
    const db = this.getDatabase();

    return new UniversalSelectDistinctBuilder(db, fields);
  }

  /**
   * Create an INSERT query for SQLite table
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
  /**
   * Create an INSERT query for PostgreSQL table
   *
   * PostgreSQL is declared FIRST on purpose: the bare `PgTable` constraint is
   * dialect-branded and rejects a SQLite table, while the bare `SQLiteTable` constraint
   * accepts a PostgreSQL one. Declared the other way round, every `pgTable` matched the
   * SQLite overload and a projected `.returning({ id })` failed with
   * `PgColumn is not assignable to SQLiteColumn`.
   */
  insert<TTable extends PgTable>(table: TTable): PgInsertBuilder<TTable, BunSQLQueryResultHKT>;
  /**
   * Create an INSERT query for SQLite table
   */
  insert<TTable extends SQLiteTable>(table: TTable): SQLiteInsertBuilder<TTable, 'sync', void>;
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  insert(table: SQLiteTable | PgTable) {
    const db = this.getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).insert(table);
  }

  /**
   * Create an UPDATE query for SQLite table
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
  /**
   * Create an UPDATE query for PostgreSQL table
   *
   * PostgreSQL is declared FIRST on purpose: the bare `PgTable` constraint is
   * dialect-branded and rejects a SQLite table, while the bare `SQLiteTable` constraint
   * accepts a PostgreSQL one. Declared the other way round, every `pgTable` matched the
   * SQLite overload and a projected `.returning({ id })` failed with
   * `PgColumn is not assignable to SQLiteColumn`.
   */
  update<TTable extends PgTable>(table: TTable): PgUpdateBuilder<TTable, BunSQLQueryResultHKT>;
  /**
   * Create an UPDATE query for SQLite table
   */
  update<TTable extends SQLiteTable>(table: TTable): SQLiteUpdateBuilder<TTable, 'sync', void>;
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  update(table: SQLiteTable | PgTable) {
    const db = this.getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).update(table);
  }

  /**
   * Create a DELETE query for SQLite table
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
  /**
   * Create a DELETE query for PostgreSQL table
   *
   * PostgreSQL is declared FIRST on purpose: the bare `PgTable` constraint is
   * dialect-branded and rejects a SQLite table, while the bare `SQLiteTable` constraint
   * accepts a PostgreSQL one. Declared the other way round, every `pgTable` matched the
   * SQLite overload and a projected `.returning({ id })` failed with
   * `PgColumn is not assignable to SQLiteColumn`.
   */
  delete<TTable extends PgTable>(table: TTable): PgDeleteBase<TTable, BunSQLQueryResultHKT>;
  /**
   * Create a DELETE query for SQLite table
   */
  delete<TTable extends SQLiteTable>(table: TTable): SQLiteDeleteBase<TTable, 'sync', void>;
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  delete(table: SQLiteTable | PgTable) {
    const db = this.getDatabase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (db as any).delete(table);
  }
}
