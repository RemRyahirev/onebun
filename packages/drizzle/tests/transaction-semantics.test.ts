/**
 * What `DrizzleService.transaction()` guarantees on SQLite.
 *
 * bun:sqlite is one synchronous connection, and drizzle's own bun-sqlite transaction commits
 * the moment the callback returns — which, for an `async` callback, is its first `await`.
 * Everything here pins the behaviour that replaces it: a real rollback across awaits, other
 * queries queued rather than enrolled, and the two situations the single connection cannot
 * serve refused by name instead of deadlocking.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { createTestService } from '@onebun/core/testing';

import { UniversalTransactionClient } from '../src/builders';
import { DrizzleService, DrizzleTransactionError } from '../src/drizzle.service';
import { eq, sql } from '../src/index';
import {
  integer,
  sqliteTable,
  text,
} from '../src/sqlite';
import { DatabaseType } from '../src/types';

const users = sqliteTable('tx_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/** A real macrotask: proves the callback survives suspension, not just microtask ordering. */
const tick = async (ms = 5): Promise<void> => await new Promise((res) => setTimeout(res, ms));

describe('DrizzleService.transaction() on SQLite', () => {
  let service: DrizzleService;

  beforeEach(async () => {
    delete process.env.DB_URL;
    delete process.env.DB_TYPE;

    const { instance } = createTestService(DrizzleService);
    service = instance;
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: ':memory:' },
    });

    service.getSQLiteClient()!.run(`
      CREATE TABLE tx_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      )
    `);
  });

  afterEach(async () => {
    await service.close();
  });

  const names = async (): Promise<string[]> => {
    const rows = await service.select().from(users);

    return rows.map((row) => row.name);
  };

  test('rolls back everything when an async callback throws after an await', async () => {
    let caught: Error | null = null;

    try {
      await service.transaction(async (tx) => {
        await tx.insert(users).values({ name: 'u1' });
        await tick();
        await tx.insert(users).values({ name: 'u2' });

        throw new Error('boom');
      });
    } catch (error) {
      caught = error as Error;
    }

    // The caller's own error, not the driver's and not a rollback failure.
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toBe('boom');

    // The whole point: before the fix both rows survived, because the native transaction had
    // already committed at the first await.
    expect(await names()).toEqual([]);
  });

  test('commits an async callback that returns, and yields its value', async () => {
    const result = await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'kept' });
      await tick();
      await tx.insert(users).values({ name: 'also kept' });

      return 'done';
    });

    expect(result).toBe('done');
    expect(await names()).toEqual(['kept', 'also kept']);
  });

  test('does not route SQLite through drizzle own transaction()', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawDb = (service as any).db as { transaction: unknown };
    let drizzleTransactionCalls = 0;
    rawDb.transaction = () => {
      drizzleTransactionCalls += 1;

      throw new Error('drizzle transaction() must not be used on SQLite');
    };

    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'manual' });
    });

    expect(drizzleTransactionCalls).toBe(0);
    expect(await names()).toEqual(['manual']);
  });

  test('queues a concurrent non-transactional write and does not roll it back', async () => {
    const transactionOpen = deferred();
    let concurrentFinished = false;

    // The async context of this request begins HERE, outside the transaction. That is what
    // makes it a genuine bystander: a request started inside the callback would inherit the
    // callback's context and be refused as re-entrant instead of queued.
    const concurrent = (async () => {
      await transactionOpen.promise;
      await service.insert(users).values({ name: 'bystander' });
      concurrentFinished = true;

      return 'written';
    })();

    let caught: Error | null = null;
    try {
      await service.transaction(async (tx) => {
        await tx.insert(users).values({ name: 'doomed' });
        transactionOpen.resolve();

        // Long enough for the queued write to reach the gate and be held there.
        await tick(20);
        expect(concurrentFinished).toBe(false);

        throw new Error('rollback me');
      });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught?.message).toBe('rollback me');
    expect(await concurrent).toBe('written');

    // Applied after the ROLLBACK, and therefore not undone by it.
    expect(await names()).toEqual(['bystander']);
  });

  test('runs a service query issued from inside the callback ON the transaction', async () => {
    // A repository method, or any other code that holds the service rather than the `tx`
    // argument. It used to join the transaction by accident (single connection) and was
    // never rolled back; refusing it would have made repositories unusable inside a
    // transaction, so it is issued on the transaction instead.
    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'through-tx' });
      await service.insert(users).values({ name: 'through-service' });
    });

    expect((await names()).sort()).toEqual(['through-service', 'through-tx']);
  }, 5000);

  test('rolls back a service query issued from inside the callback, like the rest', async () => {
    let caught: unknown;
    try {
      await service.transaction(async (tx) => {
        await tx.insert(users).values({ name: 'inside' });
        await service.insert(users).values({ name: 'routed' });
        throw new Error('rollback me');
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe('rollback me');
    // Routed onto the transaction means routed INTO it: both rows are gone.
    expect(await names()).toEqual([]);
  }, 5000);

  test('does not route work that outlived the transaction it started in', async () => {
    // Fire-and-forget keeps the async context of the transaction that spawned it. Once that
    // transaction is over the context is stale, so the statement must queue like any other
    // bystander rather than be issued on a client whose transaction has already ended.
    let reachDatabase: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      reachDatabase = resolve;
    });
    let leaked: Promise<unknown> | null = null;

    await service.transaction(async () => {
      leaked = (async () => {
        await held;
        await service.insert(users).values({ name: 'bystander' });
      })();
    });

    const second = service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'doomed' });
      reachDatabase();
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new Error('second fails');
    });

    await second.catch(() => undefined);
    await leaked;

    expect(await names()).toEqual(['bystander']);
  }, 5000);

  test('refuses a synchronous query issued while a transaction holds the connection', async () => {
    const transactionOpen = deferred();

    const bystander = (async () => {
      await transactionOpen.promise;

      // .get() executes at call time and returns a row, so it cannot be queued behind the
      // transaction. Refused rather than silently enrolled and rolled back with it.
      try {
        service.select().from(users).get();

        return null;
      } catch (error) {
        return error;
      }
    })();

    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'holder' });
      transactionOpen.resolve();
      await tick(10);
    });

    const error = await bystander;
    expect(error).toBeInstanceOf(DrizzleTransactionError);
    expect((error as DrizzleTransactionError).code).toBe('SQLITE_TRANSACTION_SYNC_QUERY');
    expect(await names()).toEqual(['holder']);
  }, 5000);

  test('refuses a nested transaction instead of deadlocking on the single connection', async () => {
    let caught: unknown;

    try {
      await service.transaction(async (tx) => {
        await tx.insert(users).values({ name: 'outer' });
        await service.transaction(async (innerTx) => {
          await innerTx.insert(users).values({ name: 'inner' });
        });
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DrizzleTransactionError);
    expect((caught as DrizzleTransactionError).code).toBe('SQLITE_TRANSACTION_NESTED');
    expect(await names()).toEqual([]);
  }, 5000);

  test('serializes two overlapping transactions and commits both', async () => {
    const firstOpen = deferred();
    const secondStarted = deferred();

    const first = service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 't1-a' });
      firstOpen.resolve();
      // Held open while the second transaction is issued.
      await secondStarted.promise;
      await tick(10);
      await tx.insert(users).values({ name: 't1-b' });
    });

    await firstOpen.promise;

    const second = service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 't2' });
    });
    secondStarted.resolve();

    // Neither call sees `cannot start a transaction within a transaction`: the second waits
    // for the first rather than colliding with it on the one connection.
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    expect(await names()).toEqual(['t1-a', 't1-b', 't2']);
  }, 5000);

  test('leaves the gate open after a rollback, so later queries just work', async () => {
    await expect(service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'gone' });

      throw new Error('undo');
    })).rejects.toThrow('undo');

    await service.insert(users).values({ name: 'after' });
    expect(await names()).toEqual(['after']);

    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'later' });
    });
    expect(await names()).toEqual(['after', 'later']);
  });

  test('the gated database still serves every query shape', async () => {
    // The gate wraps builders, so the whole query surface has to survive the wrapping:
    // chains that mutate in place, chains that build a new object, synchronous reads,
    // subqueries, prepared statements and aggregates.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = service.getDatabase() as any;

    const [inserted] = await db.insert(users).values({ name: 'shape' }).returning();
    expect(inserted.name).toBe('shape');

    const builder = db.select().from(users);
    // `.where()` mutates and returns the same builder, so it must stay the same object.
    expect(builder.where(eq(users.id, inserted.id))).toBe(builder);
    expect(await builder.limit(1)).toEqual([inserted]);

    expect(db.select().from(users).get()).toEqual(inserted);
    expect(db.select().from(users).all()).toEqual([inserted]);
    expect(await db.select().from(users).execute()).toEqual([inserted]);
    expect(db.select().from(users).prepare().all()).toEqual([inserted]);

    const subquery = db.select().from(users).as('sq');
    expect(await db.select().from(subquery)).toEqual([inserted]);

    expect(await db.$count(users)).toBe(1);
    expect(db.all(sql`SELECT name FROM tx_users`)).toEqual([{ name: 'shape' }]);
  });

  test('refuses drizzle own transaction() taken through getDatabase() while one is open', async () => {
    const transactionOpen = deferred();

    const outsider = (async () => {
      await transactionOpen.promise;

      try {
        // Synchronous and on the same connection: this is what produced the driver's
        // `cannot start a transaction within a transaction`.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service.getDatabase() as any).transaction(() => undefined);

        return null;
      } catch (error) {
        return error;
      }
    })();

    await service.transaction(async (tx) => {
      await tx.insert(users).values({ name: 'holder' });
      transactionOpen.resolve();
      await tick(10);
    });

    expect(await outsider).toBeInstanceOf(DrizzleTransactionError);
    expect(await names()).toEqual(['holder']);
  }, 5000);
});

describe('DrizzleService.transaction() on PostgreSQL', () => {
  /**
   * No live server: what has to hold is that the PostgreSQL path is the one it always was —
   * drizzle's own `transaction()`, which bun-sql implements as `client.begin(async ...)` on a
   * pooled connection. Only SQLite gets the manual BEGIN/COMMIT.
   */
  const makePostgresService = (): {
    service: DrizzleService;
    calls: Array<(tx: unknown) => Promise<unknown>>;
    rawTx: object;
    rawDb: object;
  } => {
    const { instance } = createTestService(DrizzleService);
    const calls: Array<(tx: unknown) => Promise<unknown>> = [];
    const rawTx = { marker: 'pg-tx' };
    const rawDb = {
      async transaction(callback: (tx: unknown) => Promise<unknown>) {
        calls.push(callback);

        return await callback(rawTx);
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = instance as any;
    internals.db = rawDb;
    internals.dbType = DatabaseType.POSTGRESQL;
    internals.initialized = true;
    internals.connectionOptions = {
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: 'postgresql://u:p@h:5432/d' },
    };

    return {
      service: instance, calls, rawTx, rawDb,
    };
  };

  test('routes through drizzle own transaction() and wraps the connection it hands back', async () => {
    const {
      service, calls, rawTx,
    } = makePostgresService();

    let seen: UniversalTransactionClient | null = null;
    const result = await service.transaction(async (tx) => {
      seen = tx;

      return 'pg-result';
    });

    expect(result).toBe('pg-result');
    expect(calls.length).toBe(1);
    expect(seen).toBeInstanceOf(UniversalTransactionClient);
    expect(seen!.getRawTransaction()).toBe(rawTx as never);
  });

  test('hands out the database ungated, since a transaction takes its own connection', () => {
    const { service, rawDb } = makePostgresService();

    expect(service.getDatabase()).toBe(rawDb as never);
  });

  test('does not refuse a nested transaction on PostgreSQL', async () => {
    const { service, calls } = makePostgresService();

    await service.transaction(async () => {
      await service.transaction(async () => 'inner');
    });

    expect(calls.length).toBe(2);
  });
});
