/**
 * The startup contract: a database the application CONFIGURED is a database it REQUIRES.
 *
 * What these pin down is the difference between a process that refuses to start and a
 * process that starts, passes readiness and then fails every request that touches the
 * database. `DrizzleService` used to do the second on both configuration paths — the module
 * options path warned that migrations had failed and carried on, the `DB_URL` path logged a
 * single `debug` line and carried on — so a container with a dead database rolled out green.
 *
 * The three failures that must reach `app.start()`: the file cannot be opened, the server
 * does not answer, a migration that exists fails. The two that must NOT: no configuration at
 * all, and no migrations to run.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  beforeEach,
} from 'bun:test';

import {
  Module,
  OneBunApplication,
  resetRegistrations,
} from '@onebun/core';
import { createTestService } from '@onebun/core/testing';

import {
  DatabaseType,
  DrizzleModule,
  DrizzleService,
  DrizzleStartupError,
} from '../src';

const APP_OPTIONS = {
  port: 0,
  metrics: { enabled: false },
  gracefulShutdown: false,
} as const;

/** A port nothing listens on: the connection is refused immediately. */
const DEAD_PORT = 5999;
const DEAD_URL = `postgresql://app:hunter2@127.0.0.1:${DEAD_PORT}/orders`;

const ENV_KEYS = ['DB_TYPE', 'DB_URL', 'DB_AUTO_MIGRATE', 'DB_MIGRATIONS_FOLDER', 'DB_ALLOW_DEGRADED_START'];

/**
 * What a mocked logger level was called with, joined into one string.
 *
 * The mock lives behind `SyncLogger`, which knows nothing about bun's `mock()`, so the cast
 * is where the test says "this logger is the test double".
 */
function loggedAt(logger: unknown, level: 'debug' | 'info' | 'warn' | 'error'): string {
  const mocked = (logger as Record<string, { mock: { calls: unknown[][] } }>)[level];

  return mocked.mock.calls
    .map((call) => call.map((argument) => (
      typeof argument === 'string' ? argument : JSON.stringify(argument)
    )).join(' '))
    .join('\n');
}

/** Build an application around whatever imports are given, and always release the port. */
async function startAndStop(
  imports: unknown[],
): Promise<{ rejection: Error | null; listening: boolean }> {
  @Module({ imports: imports as never })
  class AppModule {}

  const app = new OneBunApplication(AppModule, APP_OPTIONS);
  let rejection: Error | null = null;

  try {
    await app.start();
  } catch (error) {
    rejection = error as Error;
  }

  const listening = app.getServer() !== null;
  await app.stop().catch(() => undefined);

  return { rejection, listening };
}

// forRoot() writes into a process-wide registry that outlives the file. Two unnamed calls that
// configure the module differently are refused at app.start(), so a test that boots must not
// inherit a registration written by an earlier test — or by an earlier FILE in the same run,
// which is how this suite used to leak across package boundaries.
beforeEach(() => {
  resetRegistrations();
});

describe('startup contract — a configured database is a required one', () => {
  let scratch: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'onebun-startup-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    // forRoot() writes into a process-wide registry, and so does the environment.
    resetRegistrations();
    DrizzleModule.clearOptions();
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  /** A migrations folder drizzle will accept, holding one migration with the given SQL. */
  function migrationsFolderWith(name: string, sql: string): string {
    const folder = join(scratch, name);
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{
        idx: 0, version: '6', when: Date.now(), tag: '0000_init', breakpoints: true,
      }],
    }));
    writeFileSync(join(folder, '0000_init.sql'), sql);

    return folder;
  }

  describe('a migration that exists and fails', () => {
    test('fails app.start(), and the HTTP server never binds', async () => {
      const folder = migrationsFolderWith('broken-migration', 'CREATE TABLE users (this is not valid sql;');

      const { rejection, listening } = await startAndStop([
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
          migrationsFolder: folder,
        }),
      ]);

      expect(rejection).not.toBeNull();
      expect(rejection?.message).toContain('Migrations in');
      expect(rejection?.message).toContain(folder);
      expect(rejection?.message).toContain('allowDegradedStart');
      expect(listening).toBe(false);
    });

    test('is a DrizzleStartupError naming the migrate stage', async () => {
      const folder = migrationsFolderWith('broken-migration-2', 'SELECT nonexistent_function();');

      DrizzleModule.forRoot({
        connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
        migrationsFolder: folder,
      });

      const { instance } = createTestService(DrizzleService);
      const failure = await instance.onModuleInit().then(() => null, (error: unknown) => error);

      expect(failure).toBeInstanceOf(DrizzleStartupError);
      expect((failure as DrizzleStartupError).stage).toBe('migrate');
      await instance.close();
    });
  });

  describe('an unreachable database', () => {
    test('fails app.start() on the module-options path', async () => {
      const { rejection, listening } = await startAndStop([
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.POSTGRESQL, options: { connectionString: DEAD_URL } },
        }),
      ]);

      expect(rejection).not.toBeNull();
      expect(rejection?.message).toContain('SELECT 1');
      expect(listening).toBe(false);
    });

    test('fails app.start() on the DB_URL environment path', async () => {
      process.env.DB_TYPE = 'postgresql';
      process.env.DB_URL = DEAD_URL;

      const { rejection, listening } = await startAndStop([DrizzleModule]);

      expect(rejection).not.toBeNull();
      expect(rejection?.message).toContain('SELECT 1');
      expect(listening).toBe(false);
    });

    test('is reported without the password, with the target, the wait and the opt-out', async () => {
      DrizzleModule.forRoot({
        connection: { type: DatabaseType.POSTGRESQL, options: { connectionString: DEAD_URL } },
      });

      const { instance, logger } = createTestService(DrizzleService);
      const failure = await instance.onModuleInit().then(() => null, (error: unknown) => error as Error);

      expect(failure).toBeInstanceOf(DrizzleStartupError);
      const message = failure!.message;

      // The target, so an operator knows WHICH database refused...
      expect(message).toContain('127.0.0.1:5999');
      expect(message).toContain('/orders');
      // ...but never the password. A startup error is a leak channel like any other.
      expect(message).not.toContain('hunter2');
      expect(message).toContain(':***@');
      // The bound that applied, and the one option that opts out.
      expect(message).toContain('5000ms connect timeout');
      expect(message).toContain('allowDegradedStart');
      // Not a word about a missing migration journal: the database is down, and that used to
      // be the ONLY line an operator saw.
      expect(message).not.toContain('_journal.json');

      // Nothing was left at debug, and the password is absent from the logs too.
      const logged = `${loggedAt(logger, 'debug')}\n${loggedAt(logger, 'info')}`;
      expect(logged).not.toContain('hunter2');

      await instance.close();
    });

    test('gives up inside the connect timeout when the host accepts and never answers', async () => {
      // A closed port is refused immediately; a black hole is what a dropped route or a
      // stalled proxy looks like, and it used to hold app.start() open forever.
      const blackHole = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data() { /* accept the bytes, answer nothing */ } },
      });

      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.POSTGRESQL,
          options: {
            connectionString: `postgresql://app:hunter2@127.0.0.1:${blackHole.port}/orders`,
            pool: { timeout: 250 },
          },
        },
      });

      const { instance } = createTestService(DrizzleService);
      const startedAt = Date.now();
      const failure = await instance.onModuleInit().then(() => null, (error: unknown) => error as Error);
      const elapsed = Date.now() - startedAt;

      expect(failure).toBeInstanceOf(DrizzleStartupError);
      expect((failure as DrizzleStartupError).stage).toBe('connect');
      expect(failure!.message).toContain('250ms connect timeout');
      expect(elapsed).toBeLessThan(5000);

      await instance.close();
      // Dropping the listener settles the query still in flight, so the loop drains.
      blackHole.stop(true);
    });

    test('still checks reachability when autoMigrate is off — the documented happy path', async () => {
      const { rejection } = await startAndStop([
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.POSTGRESQL, options: { connectionString: DEAD_URL } },
          autoMigrate: false,
        }),
      ]);

      expect(rejection).not.toBeNull();
      expect(rejection?.message).toContain('SELECT 1');
    });
  });

  describe('a SQLite file that cannot be opened', () => {
    test('names the directory that does not exist', async () => {
      const missing = join(scratch, 'no-such-directory', 'app.db');

      const { rejection, listening } = await startAndStop([
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.SQLITE, options: { url: missing } },
        }),
      ]);

      expect(rejection).not.toBeNull();
      expect(rejection?.message).toContain(join(scratch, 'no-such-directory'));
      expect(rejection?.message).toContain('does not exist');
      expect(listening).toBe(false);
    });

    test('names the write permission when the directory is there but closed', async () => {
      const readOnlyDir = join(scratch, 'read-only');
      mkdirSync(readOnlyDir, { recursive: true });
      chmodSync(readOnlyDir, 0o500);

      try {
        const { rejection, listening } = await startAndStop([
          DrizzleModule.forRoot({
            connection: { type: DatabaseType.SQLITE, options: { url: join(readOnlyDir, 'app.db') } },
          }),
        ]);

        expect(rejection).not.toBeNull();
        expect(rejection?.message).toContain('may not write to it');
        expect(rejection?.message).not.toContain('does not exist');
        expect(listening).toBe(false);
      } finally {
        chmodSync(readOnlyDir, 0o700);
      }
    });

    test('starts read-only with no pragma list at all, and reads through the connection', async () => {
      // A read-only SQLite file is an ordinary deployment — a shipped dataset, a mounted
      // read-only volume — so it must boot without the operator hand-writing a pragma list.
      // It did not: the default set opens with `journal_mode = WAL`, which rewrites the
      // database header and cannot run on a read-only handle.
      const file = join(scratch, 'read-only-default.db');
      const seed = new Database(file);
      seed.run('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
      seed.run("INSERT INTO t (id, name) VALUES (1, 'one')");
      seed.close();

      DrizzleModule.forRoot({
        connection: {
          type: DatabaseType.SQLITE,
          options: { url: file, options: { readonly: true } },
        },
      });

      const { instance } = createTestService(DrizzleService);
      await instance.onModuleInit();

      try {
        const client = instance.getSQLiteClient();
        expect(client).not.toBeNull();
        // Reading is the whole point of the connection, so assert it rather than the boot.
        expect(client?.query('SELECT name FROM t WHERE id = 1').all()).toEqual([{ name: 'one' }]);
      } finally {
        await instance.close();
      }
    });

    test('still refuses a write pragma the caller asked for, naming it and how to drop it', async () => {
      // The defaults are the framework's choice and it filters them. An explicit list is the
      // caller's, so it is applied exactly as given — and the message has to say whose it is.
      const file = join(scratch, 'read-only-explicit.db');
      new Database(file).close();

      const { rejection } = await startAndStop([
        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: {
              url: file,
              options: { readonly: true },
              pragmas: ['journal_mode = WAL'],
            },
          },
        }),
      ]);

      expect(rejection).not.toBeNull();
      expect(rejection?.message).toContain('PRAGMA journal_mode = WAL failed');
      expect(rejection?.message).toContain('read-only');
      expect(rejection?.message).toContain('`pragmas`');
    });

    test('opens read-only when the pragmas do not write', async () => {
      const file = join(scratch, 'read-only-ok.db');
      new Database(file).close();

      const { rejection, listening } = await startAndStop([
        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: { url: file, options: { readonly: true }, pragmas: [] },
          },
        }),
      ]);

      expect(rejection).toBeNull();
      expect(listening).toBe(true);
    });
  });

  describe('what must keep starting', () => {
    test('no ./drizzle folder and autoMigrate at its default is not a failure', async () => {
      DrizzleModule.forRoot({
        connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
      });

      const { instance, logger } = createTestService(DrizzleService);
      await instance.onModuleInit();

      expect(instance.getDatabase()).toBeDefined();
      // "No migrations" is not a failure, and it is no longer reported as one: the old
      // `warn` blamed a missing meta/_journal.json for what was simply an application that
      // has never generated a migration.
      const warnings = loggedAt(logger, 'warn');
      expect(warnings).not.toContain('Auto-migration failed');
      expect(warnings).not.toContain('_journal.json');

      await instance.close();
    });

    test('an application that configures no database at all is untouched', async () => {
      const { rejection, listening } = await startAndStop([DrizzleModule]);

      expect(rejection).toBeNull();
      expect(listening).toBe(true);
    });
  });

  describe('allowDegradedStart — the one opt-out', () => {
    test('starts anyway on the module-options path, and says why', async () => {
      DrizzleModule.forRoot({
        connection: { type: DatabaseType.POSTGRESQL, options: { connectionString: DEAD_URL } },
        allowDegradedStart: true,
      });

      const { instance, logger } = createTestService(DrizzleService);
      await instance.onModuleInit();

      const warnings = loggedAt(logger, 'warn');
      expect(warnings).toContain('SELECT 1');
      expect(warnings).toContain('allowDegradedStart is set');
      expect(warnings).not.toContain('hunter2');

      await instance.close();
    });

    test('starts anyway on the environment path via DB_ALLOW_DEGRADED_START', async () => {
      process.env.DB_TYPE = 'postgresql';
      process.env.DB_URL = DEAD_URL;
      process.env.DB_ALLOW_DEGRADED_START = 'true';

      const { rejection, listening } = await startAndStop([DrizzleModule]);

      expect(rejection).toBeNull();
      expect(listening).toBe(true);
    });

    test('the environment path degrades LOUDLY — the failure is not a debug line', async () => {
      process.env.DB_TYPE = 'postgresql';
      process.env.DB_URL = DEAD_URL;
      process.env.DB_ALLOW_DEGRADED_START = 'true';

      const { instance, logger } = createTestService(DrizzleService);
      await instance.onModuleInit();

      // What this replaces: `debug('Failed to auto-initialize database from environment')`
      // and nothing else — no warn, no error, on the documented default configuration path.
      const warnings = loggedAt(logger, 'warn');
      expect(warnings).toContain('SELECT 1');
      expect(warnings).toContain('127.0.0.1:5999');
      expect(warnings).not.toContain('hunter2');

      await instance.close();
    });

    test('does not accept a migration failure unless it is set', async () => {
      const folder = migrationsFolderWith('broken-migration-3', 'CREATE TABLE ((;');

      DrizzleModule.forRoot({
        connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
        migrationsFolder: folder,
        allowDegradedStart: true,
      });

      const { instance, logger } = createTestService(DrizzleService);
      await instance.onModuleInit();

      const warnings = loggedAt(logger, 'warn');
      expect(warnings).toContain('Migrations in');
      expect(instance.getDatabase()).toBeDefined();

      await instance.close();
    });
  });
});
