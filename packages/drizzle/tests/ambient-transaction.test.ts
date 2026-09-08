/**
 * A repository call inside `transaction()` joins the transaction — on PostgreSQL too.
 *
 * `db.transaction(cb)` hands `cb` a transaction client, and statements issued through that
 * client are in the transaction. Nothing else was: `BaseRepository` captures
 * `drizzleService.getDatabase()` in its constructor, so a repository call from inside the
 * callback took another pooled connection and its writes survived the ROLLBACK. Measured
 * before the fix, against this same container: of two rows written inside one callback that
 * then threw, the one written through `tx` was gone and the one written through a repository
 * remained.
 *
 * That made atomicity dialect-dependent — SQLite has one connection and
 * `SQLiteTransactionGate` already carried the transaction the same way — which is the sharpest
 * edge a database layer can have, because the repository layer is exactly where a user stops
 * thinking about connections.
 *
 * A live server, not a mock: what is being asserted is that a ROLLBACK removes rows, which
 * only the server can answer.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { createPostgresContainer, type TestContainer } from '@onebun/core/testing';

import { DrizzleService } from '../src/drizzle.service';
import {
  integer,
  pgTable,
  serial,
  text,
} from '../src/pg';
import { BaseRepository } from '../src/repository';
import { DatabaseType } from '../src/types';

const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  weight: integer('weight'),
});

class NotesRepository extends BaseRepository<typeof notes> {
  constructor(service: DrizzleService) {
    super(service, notes);
  }
}

let container: TestContainer;
let service: DrizzleService;
let repo: NotesRepository;

/** Read through the raw client, so the assertion never goes through the code under test. */
async function bodies(): Promise<string[]> {
  const client = service.getPostgreSQLClient();
  const rows = await client!`SELECT body FROM notes ORDER BY id`;

  return (rows as unknown as Array<{ body: string }>).map(row => row.body);
}

beforeAll(async () => {
  container = await createPostgresContainer();
  service = new DrizzleService();
  await service.initialize({
    type: DatabaseType.POSTGRESQL,
    options: { connectionString: container.url },
  });

  const client = service.getPostgreSQLClient();
  await client!`CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL, weight integer)`;

  repo = new NotesRepository(service);
});

afterAll(async () => {
  await service.close();
  await container.stop();
});

afterEach(async () => {
  const client = service.getPostgreSQLClient();
  await client!`TRUNCATE notes RESTART IDENTITY`;
});

/** A promise plus its resolver, for coordinating two transactions that must overlap. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>(settle => {
    resolve = settle;
  });

  return { promise, resolve };
}

/**
 * Fail loudly instead of parking.
 *
 * Every coordination point below waits for another transaction to reach a certain line. If
 * routing ever regressed into a deadlock — two transactions each holding a connection the
 * other needs — the plain `await` would hang with no output at all, and bun's per-case budget
 * does not interrupt a promise that simply never settles.
 */
async function within<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('a repository call inside transaction()', () => {
  it('rolls back with the transaction instead of surviving it', async () => {
    // The defect, stated as the test that failed before the fix: the repository row remained.
    await expect(service.transaction(async tx => {
      await tx.insert(notes).values({ body: 'through tx' });
      await repo.create({ body: 'through repository' });

      throw new Error('rollback everything');
    })).rejects.toThrow('rollback everything');

    expect(await bodies()).toEqual([]);
  });

  it('commits with the transaction', async () => {
    await service.transaction(async tx => {
      await tx.insert(notes).values({ body: 'through tx' });
      await repo.create({ body: 'through repository' });
    });

    expect(await bodies()).toEqual(['through tx', 'through repository']);
  });

  it('rolls back two repositories together, which is the pattern this exists for', async () => {
    const second = new NotesRepository(service);

    await expect(service.transaction(async () => {
      await repo.create({ body: 'first repository' });
      await second.create({ body: 'second repository' });

      throw new Error('all or nothing');
    })).rejects.toThrow('all or nothing');

    expect(await bodies()).toEqual([]);
  });

  it('reads its own uncommitted writes, so a read-then-write inside the callback is coherent', async () => {
    await service.transaction(async () => {
      await repo.create({ body: 'written inside' });

      // On a second pooled connection this would see nothing: the row is not committed yet.
      expect((await repo.findAll()).map(row => row.body)).toEqual(['written inside']);
    });
  });

  it('goes back to the pool outside a transaction', async () => {
    await repo.create({ body: 'outside' });

    expect(await bodies()).toEqual(['outside']);
  });
});

describe('the service query methods inside transaction()', () => {
  it('join the transaction as well, not only repositories', async () => {
    await expect(service.transaction(async () => {
      await service.insert(notes).values({ body: 'through the service' });

      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await bodies()).toEqual([]);
  });

  it('see the transaction through select() too', async () => {
    await service.transaction(async () => {
      await service.insert(notes).values({ body: 'uncommitted' });

      const rows = await service.select().from(notes);
      expect((rows as Array<{ body: string }>).map(row => row.body)).toEqual(['uncommitted']);
    });
  });
});

describe('a transaction opened inside a transaction', () => {
  it('is a savepoint: the inner rollback keeps the outer work', async () => {
    // Routed to the pool instead, the inner transaction would be an independent one on a
    // second connection — able to block on a row its own outer transaction holds.
    await service.transaction(async () => {
      await repo.create({ body: 'outer' });

      await expect(service.transaction(async () => {
        // On the same connection the outer's uncommitted row is visible. On a second pooled
        // one it could not be — READ COMMITTED shows only what is committed — so this is what
        // distinguishes a savepoint from an independent transaction, rather than the row
        // counts below, which come out the same either way.
        expect((await repo.findAll()).map(row => row.body)).toEqual(['outer']);

        await repo.create({ body: 'inner' });

        throw new Error('inner fails');
      })).rejects.toThrow('inner fails');

      await repo.create({ body: 'outer after inner' });
    });

    expect(await bodies()).toEqual(['outer', 'outer after inner']);
  });

  it('rolls back with the outer one when the outer one fails', async () => {
    await expect(service.transaction(async () => {
      await repo.create({ body: 'outer' });
      await service.transaction(async () => {
        await repo.create({ body: 'inner' });
      });

      throw new Error('outer fails');
    })).rejects.toThrow('outer fails');

    expect(await bodies()).toEqual([]);
  });
});

describe('concurrency inside the callback', () => {
  it('serializes parallel repository calls onto the one connection the transaction holds', async () => {
    // A PostgreSQL connection runs one statement at a time. The driver queues them rather
    // than failing, so `Promise.all` in a callback is safe — it is simply not parallel.
    await service.transaction(async () => {
      await Promise.all([
        repo.create({ body: 'parallel a' }),
        repo.create({ body: 'parallel b' }),
      ]);
    });

    expect((await bodies()).sort()).toEqual(['parallel a', 'parallel b']);
  });

  it('rolls parallel work back together', async () => {
    await expect(service.transaction(async () => {
      await Promise.all([
        repo.create({ body: 'parallel a' }),
        repo.create({ body: 'parallel b' }),
      ]);

      throw new Error('rollback');
    })).rejects.toThrow('rollback');

    expect(await bodies()).toEqual([]);
  });

  it('does not leak the transaction to a second one running at the same time', async () => {
    // Two overlapping transactions on a pool: each callback must see its own, and neither
    // may be rolled back by the other. AsyncLocalStorage is per-context, so this is the test
    // that a process-global cell could not pass.
    const failing = service.transaction(async () => {
      await repo.create({ body: 'doomed' });
      await new Promise(resolve => setTimeout(resolve, 50));

      throw new Error('this one fails');
    });

    const succeeding = service.transaction(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      await repo.create({ body: 'survivor' });
    });

    await expect(failing).rejects.toThrow('this one fails');
    await succeeding;

    expect(await bodies()).toEqual(['survivor']);
  });
});

describe('concurrent transactions', () => {
  it('keeps every one of five simultaneous transactions separate, and commits them all', async () => {
    await Promise.all(
      Array.from({ length: 5 }, async (_unused, index) =>
        await service.transaction(async () => await repo.create({ body: `row ${index}`, weight: index }))),
    );

    expect((await bodies()).sort()).toEqual(['row 0', 'row 1', 'row 2', 'row 3', 'row 4']);
  });

  it('rolls back only the ones that failed, however they interleave', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, async (_unused, index) =>
        await service.transaction(async () => {
          await repo.create({ body: `row ${index}` });

          if (index % 2 === 1) {
            throw new Error(`row ${index} fails`);
          }
        })),
    );

    expect(results.filter(r => r.status === 'rejected')).toHaveLength(3);
    expect((await bodies()).sort()).toEqual(['row 0', 'row 2', 'row 4']);
  });

  it('does not leak one transaction into another that overlaps it', async () => {
    // The context is per-async-tree, so this is the case a process-global cell could not pass:
    // both callbacks are open at once, and each must be rolled back only by its own failure.
    const doomedStarted = deferred();
    const survivorWrote = deferred();

    const doomed = service.transaction(async () => {
      await repo.create({ body: 'doomed' });
      doomedStarted.resolve();
      await within('the survivor to write', 5000, survivorWrote.promise);

      throw new Error('this one fails');
    });

    const survivor = service.transaction(async () => {
      await within('the doomed transaction to write', 5000, doomedStarted.promise);
      await repo.create({ body: 'survivor' });
      survivorWrote.resolve();
    });

    await expect(doomed).rejects.toThrow('this one fails');
    await survivor;

    expect(await bodies()).toEqual(['survivor']);
  });

  it('keeps nested savepoints apart when two transactions are nesting at the same time', async () => {
    const bothInside = deferred();
    let arrived = 0;

    const barrier = async (): Promise<void> => {
      arrived += 1;
      if (arrived === 2) {
        bothInside.resolve();
      }

      await within('both transactions to reach the savepoint', 5000, bothInside.promise);
    };

    const [first, second] = await Promise.all([
      service.transaction(async () => {
        await repo.create({ body: 'first outer' });
        await barrier();
        await expect(service.transaction(async () => {
          await repo.create({ body: 'first inner' });

          throw new Error('first inner fails');
        })).rejects.toThrow('first inner fails');

        return 'first done';
      }),
      service.transaction(async () => {
        await repo.create({ body: 'second outer' });
        await barrier();
        await service.transaction(async () => await repo.create({ body: 'second inner' }));

        return 'second done';
      }),
    ]);

    expect([first, second]).toEqual(['first done', 'second done']);
    // Only the first transaction's savepoint rolled back, and it took only its own row.
    expect((await bodies()).sort()).toEqual(['first outer', 'second inner', 'second outer']);
  });

  it('stays correct when there are more transactions than connections', async () => {
    // Two connections, six transactions: they queue on the pool. Correctness must not depend
    // on there being a connection free — and a pool this small is also where a routing bug
    // would show up as a deadlock rather than as wrong data.
    const small = new DrizzleService();
    await small.initialize({
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: container.url, pool: { max: 2 } },
    });

    try {
      const isolated = new NotesRepository(small);

      await within('six transactions through a pool of two', 20_000, Promise.all(
        Array.from({ length: 6 }, async (_unused, index) =>
          await small.transaction(async () => await isolated.create({ body: `queued ${index}` }))),
      ));

      expect((await bodies()).sort())
        .toEqual(['queued 0', 'queued 1', 'queued 2', 'queued 3', 'queued 4', 'queued 5']);
    } finally {
      await small.close();
    }
  });
});

describe('isolation between concurrent transactions', () => {
  it('does not show one transaction the uncommitted rows of another', async () => {
    // READ COMMITTED: what B must NOT see is A's unwritten-to-disk row. If a repository call
    // in B were routed onto A's connection, it would see it — which is the failure this test
    // exists to catch, and the reason routing is keyed by async context rather than by service.
    const aWrote = deferred();
    const bRead = deferred();
    let seenByB: string[] = ['not read'];

    const a = service.transaction(async () => {
      await repo.create({ body: 'written by A' });
      aWrote.resolve();
      await within('B to read', 5000, bRead.promise);
    });

    const b = service.transaction(async () => {
      await within('A to write', 5000, aWrote.promise);
      seenByB = (await repo.findAll()).map(row => row.body);
      bRead.resolve();
    });

    await Promise.all([a, b]);

    expect(seenByB).toEqual([]);
    // And once both have committed, the row is visible to everyone.
    expect(await bodies()).toEqual(['written by A']);
  });

  it('shows each transaction its own uncommitted write and nobody elses', async () => {
    const bothWrote = deferred();
    let wrote = 0;
    const seen: Record<string, string[]> = {};

    const write = async (body: string): Promise<void> => {
      await repo.create({ body });
      wrote += 1;
      if (wrote === 2) {
        bothWrote.resolve();
      }

      await within('both transactions to write', 5000, bothWrote.promise);
      seen[body] = (await repo.findAll()).map(row => row.body);
    };

    await Promise.all([
      service.transaction(async () => await write('from A')),
      service.transaction(async () => await write('from B')),
    ]);

    expect(seen['from A']).toEqual(['from A']);
    expect(seen['from B']).toEqual(['from B']);
    expect((await bodies()).sort()).toEqual(['from A', 'from B']);
  });

  it('does not let a rolled-back transaction take a concurrent transaction row with it', async () => {
    const bothWrote = deferred();
    let wrote = 0;

    const write = async (body: string): Promise<void> => {
      await repo.create({ body });
      wrote += 1;
      if (wrote === 2) {
        bothWrote.resolve();
      }

      await within('both transactions to write', 5000, bothWrote.promise);
    };

    const failing = service.transaction(async () => {
      await write('rolled back');

      throw new Error('rollback');
    });
    const committing = service.transaction(async () => await write('committed'));

    await expect(failing).rejects.toThrow('rollback');
    await committing;

    expect(await bodies()).toEqual(['committed']);
  });

  it('does not enroll a query issued outside any transaction into an open one', async () => {
    // The bystander case: a request that happens to run while a transaction is open must go
    // to the pool, and must survive that transaction's rollback.
    const txWrote = deferred();
    const bystanderWrote = deferred();

    const failing = service.transaction(async () => {
      await repo.create({ body: 'inside' });
      txWrote.resolve();
      await within('the bystander to write', 5000, bystanderWrote.promise);

      throw new Error('rollback');
    });

    const bystander = (async () => {
      await within('the transaction to write', 5000, txWrote.promise);
      await repo.create({ body: 'outside' });
      bystanderWrote.resolve();
    })();

    await expect(failing).rejects.toThrow('rollback');
    await bystander;

    expect(await bodies()).toEqual(['outside']);
  });
});

describe('two DrizzleService instances', () => {
  it('do not see each other transactions, even against the same database', async () => {
    // The store is keyed by the owning AmbientTransaction, so a second service — a second
    // database in the ordinary case, the same one here to make the check observable — has its
    // own pool and its own transactions. Without the owner check, the second service would
    // issue its write on the first one connection and lose it to a rollback it never caused.
    const other = new DrizzleService();
    await other.initialize({
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: container.url },
    });

    try {
      const foreign = new NotesRepository(other);

      await expect(service.transaction(async () => {
        await repo.create({ body: 'mine' });
        await foreign.create({ body: 'the other service' });

        throw new Error('rollback');
      })).rejects.toThrow('rollback');

      // Only the row written through the service that owns the transaction is undone.
      expect(await bodies()).toEqual(['the other service']);
    } finally {
      await other.close();
    }
  });
});

describe('work the callback leaves running', () => {
  it('lands on the pool, not on the connection a later transaction has taken', async () => {
    // The async context outlives the transaction. If the finished handle is still honoured,
    // a write issued after COMMIT goes to whatever that handle points at — and once the pool
    // has handed that connection to somebody else, THEIR rollback takes this row with it.
    // Measured: without the closing `finally` the row below is deleted by transaction B,
    // which never touched it.
    //
    // `max: 1` is what makes the reuse certain rather than likely, so this is a test and not
    // a coin flip.
    const single = new DrizzleService();
    await single.initialize({
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: container.url, pool: { max: 1 } },
    });

    try {
      const isolated = new NotesRepository(single);
      let release = (): void => undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      let escaped: Promise<unknown> = Promise.resolve();

      await single.transaction(async () => {
        await isolated.create({ body: 'A committed' });
        // Created inside the callback, started only once the gate opens — which is while a
        // LATER transaction holds the connection.
        escaped = gate.then(async () => await isolated.create({ body: 'left over from A' }));
      });

      await expect(single.transaction(async () => {
        await isolated.create({ body: 'B row' });
        release();
        await new Promise(resolve => setTimeout(resolve, 150));

        throw new Error('B rolls back');
      })).rejects.toThrow('B rolls back');

      await escaped;

      expect(await bodies()).toEqual(['A committed', 'left over from A']);
    } finally {
      await single.close();
    }
  });
});
