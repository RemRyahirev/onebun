/**
 * `DrizzleService.transaction(callback, options)` — the isolation level and access mode of the
 * transaction it opens.
 *
 * `transaction()` is the one way to open a transaction that everything called from inside the
 * callback joins (repositories, service queries, other services). Without settings on it, a
 * consistent read snapshot could only be had through the driver's own `transaction(fn, config)`,
 * which sets no ambient context — so every helper called from it read outside the snapshot.
 *
 * PostgreSQL is checked against a live server: what is asserted is what the SERVER says the
 * transaction runs under, and that it refuses a write — neither of which a stub can answer.
 * SQLite has no per-transaction equivalent and refuses the options before anything runs.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import {
  createPostgresContainer,
  createTestService,
  type TestContainer,
} from '@onebun/core/testing';

import { DrizzleService, DrizzleTransactionError } from '../src/drizzle.service';
import { sql } from '../src/index';
import {
  integer,
  pgTable,
  serial,
  text,
} from '../src/pg';
import { BaseRepository } from '../src/repository';
import {
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
} from '../src/sqlite';
import { DatabaseType, type PostgreSQLTransactionOptions } from '../src/types';

const notes = pgTable('option_notes', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  weight: integer('weight'),
});

class NotesRepository extends BaseRepository<typeof notes> {
  constructor(service: DrizzleService) {
    super(service, notes);
  }
}

/** Starting and stopping the Postgres container takes far longer than a hook's default 5 s. */
const CONTAINER_BOOT_MS = 120_000;

/** A promise plus its resolver, for coordinating two transactions that must overlap. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(settle => {
    resolve = settle;
  });

  return { promise, resolve };
}

/** The rejection of `work`, so its `code` can be asserted; fails the test if it resolved. */
async function rejectionOf(work: Promise<unknown>): Promise<DrizzleTransactionError> {
  const outcome = await work.then(() => null, (error: unknown) => error);
  expect(outcome).toBeInstanceOf(DrizzleTransactionError);

  return outcome as DrizzleTransactionError;
}

/**
 * The message the SERVER rejected `work` with. drizzle wraps a failed statement in an error of
 * its own that names the query, with the driver's error as `cause`.
 */
async function serverErrorOf(work: Promise<unknown>): Promise<string> {
  const outcome = await work.then(() => null, (error: unknown) => error);
  expect(outcome).toBeInstanceOf(Error);
  const cause = (outcome as Error).cause;
  expect(cause).toBeInstanceOf(Error);

  return (cause as Error).message;
}

describe('transaction options on PostgreSQL', () => {
  let container: TestContainer;
  let service: DrizzleService;
  let repo: NotesRepository;

  /** Read through the raw client, so the assertion never goes through the code under test. */
  async function bodies(): Promise<string[]> {
    const client = service.getPostgreSQLClient();
    const rows = await client!`SELECT body FROM option_notes ORDER BY id`;

    return (rows as unknown as Array<{ body: string }>).map(row => row.body);
  }

  /**
   * A run-time setting as the server reports it, read through the routed database — so inside
   * a callback it is the setting of the transaction (or savepoint) the caller is in.
   */
  async function setting(name: 'transaction_isolation' | 'transaction_read_only'): Promise<string> {
    const rows = await service.getPostgreSQLDatabase().execute(sql.raw(`SHOW ${name}`));

    return String((rows as unknown as Array<Record<string, unknown>>)[0][name]);
  }

  beforeAll(async () => {
    container = await createPostgresContainer();
    service = new DrizzleService();
    await service.initialize({
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: container.url },
    });

    const client = service.getPostgreSQLClient();
    await client!`CREATE TABLE option_notes (id serial PRIMARY KEY, body text NOT NULL, weight integer)`;

    repo = new NotesRepository(service);
  }, CONTAINER_BOOT_MS);

  afterAll(async () => {
    await service?.close();
    await container?.stop();
  }, CONTAINER_BOOT_MS);

  afterEach(async () => {
    const client = service.getPostgreSQLClient();
    await client!`TRUNCATE option_notes RESTART IDENTITY`;
  });

  describe('the transaction runs under the options it was opened with', () => {
    it.each([
      'read committed',
      'repeatable read',
      'serializable',
    ] as const)('reports isolation level %s from the server', async (isolationLevel) => {
      const reported = await service.transaction(
        async () => await setting('transaction_isolation'),
        { isolationLevel },
      );

      expect(reported).toBe(isolationLevel);
    });

    it('reports read only, and the server refuses a write in it', async () => {
      const refusal = await serverErrorOf(service.transaction(async () => {
        expect(await setting('transaction_read_only')).toBe('on');

        await repo.create({ body: 'refused' });
      }, { accessMode: 'read only' }));

      expect(refusal).toContain('cannot execute INSERT in a read-only transaction');
      expect(await bodies()).toEqual([]);
    });

    it('refuses a locking read in a read-only transaction', async () => {
      // FOR UPDATE and FOR SHARE take row locks, which PostgreSQL counts as a write.
      await repo.create({ body: 'locked' });

      for (const lock of ['FOR UPDATE', 'FOR SHARE']) {
        const refusal = await serverErrorOf(service.transaction(async () => {
          await service.getPostgreSQLDatabase().execute(sql.raw(`SELECT id FROM option_notes ${lock}`));
        }, { accessMode: 'read only' }));

        expect(refusal).toContain('in a read-only transaction');
      }
    });

    it('takes both options together', async () => {
      const reported = await service.transaction(async () => [
        await setting('transaction_isolation'),
        await setting('transaction_read_only'),
      ], { isolationLevel: 'repeatable read', accessMode: 'read only' });

      expect(reported).toEqual(['repeatable read', 'on']);
    });

    it('allows writes with accessMode read write', async () => {
      await service.transaction(async () => {
        expect(await setting('transaction_read_only')).toBe('off');
        await repo.create({ body: 'written' });
      }, { accessMode: 'read write' });

      expect(await bodies()).toEqual(['written']);
    });

    it('keeps one snapshot for every read under repeatable read, the repository ones included', async () => {
      // The case the options exist for: a response assembled from several reads must not show
      // a commit that landed between two of them.
      await repo.create({ body: 'before' });
      const firstRead = deferred();
      const committed = deferred();

      const reads = service.transaction(async () => {
        const first = (await repo.findAll()).map(row => row.body);
        firstRead.resolve();
        await committed.promise;
        const second = (await repo.findAll()).map(row => row.body);

        return { first, second };
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });

      await firstRead.promise;
      // A second pooled connection, outside the transaction.
      await repo.create({ body: 'committed in between' });
      committed.resolve();

      expect(await reads).toEqual({ first: ['before'], second: ['before'] });
    });

    it('without options runs at the server default and sees a commit between two reads', async () => {
      await repo.create({ body: 'before' });
      const firstRead = deferred();
      const committed = deferred();

      const reads = service.transaction(async () => {
        const level = await setting('transaction_isolation');
        const first = (await repo.findAll()).map(row => row.body);
        firstRead.resolve();
        await committed.promise;
        const second = (await repo.findAll()).map(row => row.body);

        return { level, first, second };
      });

      await firstRead.promise;
      await repo.create({ body: 'committed in between' });
      committed.resolve();

      expect(await reads).toEqual({
        level: 'read committed',
        first: ['before'],
        second: ['before', 'committed in between'],
      });
    });

    it('treats an empty options object as no options', async () => {
      const reported = await service.transaction(async () => {
        await repo.create({ body: 'written' });

        return await setting('transaction_isolation');
      }, {});

      expect(reported).toBe('read committed');
      expect(await bodies()).toEqual(['written']);
    });

    it('keeps the options of two overlapping transactions apart', async () => {
      const bothOpen = deferred();
      let open = 0;
      const arrive = async (): Promise<void> => {
        open += 1;
        if (open === 2) {
          bothOpen.resolve();
        }

        await bothOpen.promise;
      };

      const [serializable, plain] = await Promise.all([
        service.transaction(async () => {
          await arrive();

          return await setting('transaction_isolation');
        }, { isolationLevel: 'serializable' }),
        service.transaction(async () => {
          await arrive();

          return await setting('transaction_isolation');
        }),
      ]);

      expect([serializable, plain]).toEqual(['serializable', 'read committed']);
    });
  });

  describe('a nested transaction()', () => {
    it('with no options is a savepoint under the enclosing settings', async () => {
      const reported = await service.transaction(async () => await service.transaction(
        async () => await setting('transaction_isolation'),
      ), { isolationLevel: 'serializable' });

      expect(reported).toBe('serializable');
    });

    it('with equal options is a savepoint: the inner rollback keeps the outer work', async () => {
      const options: PostgreSQLTransactionOptions = { isolationLevel: 'serializable', accessMode: 'read write' };

      await service.transaction(async () => {
        await repo.create({ body: 'outer' });

        await expect(service.transaction(async () => {
          // The outer's uncommitted row is visible: same connection, same transaction.
          expect((await repo.findAll()).map(row => row.body)).toEqual(['outer']);
          expect(await setting('transaction_isolation')).toBe('serializable');
          await repo.create({ body: 'inner' });

          throw new Error('inner fails');
        }, options)).rejects.toThrow('inner fails');

        await repo.create({ body: 'outer after inner' });
      }, options);

      expect(await bodies()).toEqual(['outer', 'outer after inner']);
    });

    it('may repeat a subset of the enclosing options', async () => {
      const reported = await service.transaction(async () => await service.transaction(
        async () => await setting('transaction_read_only'),
        { accessMode: 'read only' },
      ), { isolationLevel: 'repeatable read', accessMode: 'read only' });

      expect(reported).toBe('on');
    });

    it('with a different isolation level throws before its callback runs, and leaves the outer usable', async () => {
      let innerRan = false;

      await service.transaction(async () => {
        await repo.create({ body: 'outer' });

        const error = await rejectionOf(service.transaction(async () => {
          innerRan = true;
        }, { isolationLevel: 'serializable' }));

        expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
        expect(error.message).toContain('serializable');
        expect(error.message).toContain('repeatable read');

        await repo.create({ body: 'outer after refusal' });
      }, { isolationLevel: 'repeatable read' });

      expect(innerRan).toBe(false);
      expect(await bodies()).toEqual(['outer', 'outer after refusal']);
    });

    it('with a different access mode throws', async () => {
      const error = await rejectionOf(service.transaction(async () => {
        await service.transaction(async () => undefined, { accessMode: 'read write' });
      }, { accessMode: 'read only' }));

      expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
    });

    it('with an option the enclosing transaction was opened without throws', async () => {
      // The enclosing transaction runs at whatever the server default is; the framework cannot
      // vouch that it is the level asked for, so it refuses rather than guess.
      const error = await rejectionOf(service.transaction(async () => {
        await service.transaction(async () => undefined, { isolationLevel: 'read committed' });
      }));

      expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
      expect(error.message).toContain('server default');
    });

    it('is checked against the outermost transaction through a savepoint without options', async () => {
      await service.transaction(async () => {
        await service.transaction(async () => {
          const error = await rejectionOf(service.transaction(async () => undefined, {
            isolationLevel: 'serializable',
          }));
          expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');

          // The same level as the outermost one passes.
          expect(await service.transaction(
            async () => await setting('transaction_isolation'),
            { isolationLevel: 'repeatable read' },
          )).toBe('repeatable read');
        });
      }, { isolationLevel: 'repeatable read' });
    });
  });

  describe("drizzle's own transaction(fn, config) inside a transaction() callback", () => {
    /** drizzle's transaction API as the database and the transaction handle both expose it. */
    type RawTransactionApi = {
      transaction: <T>(fn: (tx: unknown) => Promise<T>, config?: Record<string, unknown>) => Promise<T>;
    };
    const routedDatabase = (): RawTransactionApi => service.getPostgreSQLDatabase() as unknown as RawTransactionApi;

    it('refuses a config the enclosing transaction does not run under, through getDatabase()', async () => {
      // The workaround the feature replaces, left in half-migrated code: drizzle's savepoint
      // would drop the config, and the inner reads would run at read committed.
      let innerRan = false;

      await service.transaction(async () => {
        await repo.create({ body: 'outer' });

        const error = await rejectionOf(routedDatabase().transaction(async () => {
          innerRan = true;
        }, { isolationLevel: 'serializable' }));

        expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
        expect(error.message).toContain("isolationLevel 'serializable'");
        expect(error.message).toContain('server default');

        // The refusal opened nothing: the outer transaction goes on and commits.
        await repo.create({ body: 'outer after refusal' });
      });

      expect(innerRan).toBe(false);
      expect(await bodies()).toEqual(['outer', 'outer after refusal']);
    });

    it('refuses it through tx.getRawTransaction() as well', async () => {
      const error = await rejectionOf(service.transaction(async (tx) => {
        const raw = tx.getRawTransaction() as unknown as RawTransactionApi;
        await raw.transaction(async () => undefined, { accessMode: 'read write' });
      }, { accessMode: 'read only' }));

      expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
    });

    it('refuses it on the savepoint handle drizzle passes to fn, however deep', async () => {
      const error = await rejectionOf(service.transaction(async () => {
        await routedDatabase().transaction(async (savepoint) => {
          await (savepoint as RawTransactionApi).transaction(async () => undefined, {
            isolationLevel: 'serializable',
          });
        });
      }, { isolationLevel: 'repeatable read' }));

      expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
    });

    it('refuses deferrable, which no DrizzleService transaction is opened with', async () => {
      const error = await rejectionOf(service.transaction(async () => {
        await routedDatabase().transaction(async () => undefined, { deferrable: true });
      }, { isolationLevel: 'serializable', accessMode: 'read only' }));

      expect(error.code).toBe('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH');
      expect(error.message).toContain('deferrable true');
    });

    it('opens a savepoint for a config the enclosing transaction already satisfies', async () => {
      const reported = await service.transaction(async () => await routedDatabase().transaction(
        async () => await setting('transaction_isolation'),
        { isolationLevel: 'repeatable read' },
      ), { isolationLevel: 'repeatable read', accessMode: 'read only' });

      expect(reported).toBe('repeatable read');
    });

    it('without a config is a savepoint, as it always is', async () => {
      await service.transaction(async (tx) => {
        await repo.create({ body: 'outer' });

        const raw = tx.getRawTransaction() as unknown as RawTransactionApi;
        await expect(raw.transaction(async () => {
          expect((await repo.findAll()).map(row => row.body)).toEqual(['outer']);
          await repo.create({ body: 'inner' });

          throw new Error('inner fails');
        })).rejects.toThrow('inner fails');

        await routedDatabase().transaction(async () => {
          await repo.create({ body: 'inner kept' });
        });
      }, { isolationLevel: 'serializable' });

      expect(await bodies()).toEqual(['outer', 'inner kept']);
    });

    it('outside any transaction() callback opens its own transaction with the config, as drizzle does', async () => {
      const reported = await routedDatabase().transaction(async (tx) => {
        const rows = await (tx as { execute: (query: unknown) => Promise<unknown> })
          .execute(sql`SHOW transaction_isolation`);

        return (rows as Array<{ transaction_isolation: string }>)[0].transaction_isolation;
      }, { isolationLevel: 'serializable' });

      expect(reported).toBe('serializable');
    });
  });

  describe('a malformed option', () => {
    it('is refused before the transaction begins', async () => {
      let ran = false;
      const error = await rejectionOf(service.transaction(async () => {
        ran = true;
      }, { isolationLevel: 'repeatable read; DROP TABLE option_notes' as never }));

      expect(error.code).toBe('TRANSACTION_OPTIONS_INVALID');
      expect(ran).toBe(false);
      expect(await bodies()).toEqual([]);
    });
  });
});

describe('transaction options on SQLite', () => {
  const users = sqliteTable('option_users', {
    id: sqliteInteger('id').primaryKey({ autoIncrement: true }),
    name: sqliteText('name').notNull(),
  });

  let service: DrizzleService;

  beforeEach(async () => {
    const { instance } = createTestService(DrizzleService);
    service = instance;
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    });

    service.getSQLiteClient()!.run(`
      CREATE TABLE option_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);
  });

  afterEach(async () => {
    await service.close();
  });

  const names = async (): Promise<string[]> =>
    (await service.select().from(users)).map(row => row.name);

  it.each([
    { isolationLevel: 'serializable' },
    { accessMode: 'read only' },
    { isolationLevel: 'read committed', accessMode: 'read write' },
  ] satisfies PostgreSQLTransactionOptions[])('refuses %o before the callback runs', async (options) => {
    let ran = false;

    const error = await rejectionOf(service.transaction(async () => {
      ran = true;
    }, options));

    expect(error.code).toBe('SQLITE_TRANSACTION_OPTIONS_UNSUPPORTED');
    expect(error.message).toContain('PostgreSQL');
    expect(ran).toBe(false);

    // Nothing was left open on the single connection: the next transaction begins and commits.
    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'after' });
    });
    expect(await names()).toEqual(['after']);
  });

  it('refuses at once, without waiting for a transaction that holds the connection', async () => {
    const holding = deferred();
    const release = deferred();

    const holder = service.transaction(async () => {
      holding.resolve();
      await release.promise;
    });
    await holding.promise;

    // Were the options checked after taking the connection, this would wait for `release`.
    const error = await rejectionOf(service.transaction(async () => undefined, { accessMode: 'read only' }));
    expect(error.code).toBe('SQLITE_TRANSACTION_OPTIONS_UNSUPPORTED');

    release.resolve();
    await holder;
  });

  it('runs as before with no options, with an empty object, and with only undefined values', async () => {
    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'none' });
    });
    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'empty' });
    }, {});
    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'undefined' });
    }, { isolationLevel: undefined, accessMode: undefined });

    expect(await names()).toEqual(['none', 'empty', 'undefined']);
  });

  it('refuses an unknown option or value as malformed rather than unsupported', async () => {
    const unknownKey = await rejectionOf(service.transaction(
      async () => undefined,
      { deferrable: true } as unknown as PostgreSQLTransactionOptions,
    ));
    expect(unknownKey.code).toBe('TRANSACTION_OPTIONS_INVALID');
    expect(unknownKey.message).toContain('deferrable');

    const unknownValue = await rejectionOf(service.transaction(
      async () => undefined,
      { accessMode: 'read-only' } as unknown as PostgreSQLTransactionOptions,
    ));
    expect(unknownValue.code).toBe('TRANSACTION_OPTIONS_INVALID');
    expect(unknownValue.message).toContain("'read only'");
  });
});
