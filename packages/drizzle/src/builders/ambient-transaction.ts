/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle's builders are structurally typed through deeply conditional generics; this routes
// them without knowing which stage it holds, so `any` is the only honest annotation.

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The open transaction, and whether it is still open.
 *
 * A mutable cell rather than a plain handle, because the async context outlives the
 * transaction: work spawned inside the callback and still running after COMMIT inherits the
 * store, and issuing a statement on a finished transaction is not what the caller meant. The
 * flag is cleared in a `finally`, so such work falls back to the pool exactly as it does today.
 */
interface TransactionCell {
  /** The client the transaction's statements are issued on. */
  database: object;
  /** False from the moment the transaction commits or rolls back. */
  open: boolean;
}

/** What an async context started inside a transaction callback carries. */
interface AmbientTransactionContext {
  /** Which service's transaction, so two databases do not see each other's. */
  owner: AmbientTransaction;
  cell: TransactionCell;
}

/**
 * Carries the open PostgreSQL transaction to everything called from inside its callback.
 *
 * `db.transaction(cb)` hands `cb` a transaction client, and statements issued **through that
 * client** are in the transaction. Nothing else is: a repository holds
 * `drizzleService.getDatabase()` from its constructor, so `repository.create()` called from
 * inside the callback took another pooled connection and its writes survived the ROLLBACK.
 * Measured against `postgres:16-alpine` — of two rows written inside one callback that then
 * threw, the one written through `tx` was gone and the one written through a repository
 * remained.
 *
 * That made atomicity dialect-dependent, which is the sharpest edge a database layer can
 * have: SQLite has one connection, so there the same code was already correct — by design,
 * through {@link SQLiteTransactionGate}, which carries the transaction the same way.
 *
 * This is the PostgreSQL half of that mechanism. It is deliberately the smaller half: there
 * is no gate and no queue, because a pool has connections to spare and only the routing
 * question — *which* client does this statement belong on — has to be answered.
 *
 * @see docs:api/drizzle.md
 */
export class AmbientTransaction {
  /**
   * One store for the process, holding the owning instance, so two `DrizzleService`s do not
   * mistake each other's transactions for their own.
   */
  private static readonly context = new AsyncLocalStorage<AmbientTransactionContext>();

  /**
   * The transaction client this statement belongs on, or `null` to use the pool.
   *
   * `null` for everyone outside a callback of *this* service, and for work that outlived the
   * transaction it was started in.
   */
  activeDatabase(): object | null {
    const store = AmbientTransaction.context.getStore();

    return store?.owner === this && store.cell.open ? store.cell.database : null;
  }

  /**
   * Run the transaction callback in an async context that carries `database`.
   *
   * The cell is closed before this returns, in a `finally`, so a statement issued by work the
   * callback left running cannot land on a transaction that has already ended.
   */
  async runInContext<R>(database: object, callback: () => Promise<R>): Promise<R> {
    const cell: TransactionCell = { database, open: true };

    try {
      return await AmbientTransaction.context.run({ owner: this, cell }, callback);
    } finally {
      cell.open = false;
    }
  }
}

/** Methods that start a query: `db.select()`, `db.insert(t)`, `db.$count(t)`, … */
const QUERY_ENTRY_POINTS = [
  'select',
  'selectDistinct',
  'insert',
  'update',
  'delete',
  'execute',
  '$count',
] as const;

/**
 * The database object handed out by `DrizzleService.getDatabase()` on PostgreSQL.
 *
 * The database itself as prototype with the query entry points redefined on top, so anything
 * not listed (`db.$client`, `db.query`, `db.session`, …) resolves to the real thing at no
 * cost and nothing on the real instance is modified. The dispatch is one `AsyncLocalStorage`
 * read per query when no transaction is open.
 *
 * Each entry point asks {@link AmbientTransaction.activeDatabase} at **call** time, not at
 * construction time — which is what makes a repository work, since it captured this object
 * in its constructor long before any transaction existed.
 *
 * @see docs:api/drizzle.md
 */
export function createTransactionAwareDatabase<TDatabase extends object>(
  db: TDatabase,
  ambient: AmbientTransaction,
): TDatabase {
  const routed = Object.create(db) as any;
  const source = db as any;

  for (const method of QUERY_ENTRY_POINTS) {
    const original = source[method];
    if (typeof original !== 'function') {
      continue;
    }

    routed[method] = (...args: unknown[]): unknown => {
      const active = ambient.activeDatabase() as any;

      return active
        ? active[method]?.apply(active, args)
        : original.apply(source, args);
    };
  }

  const originalWith = source.with;
  if (typeof originalWith === 'function') {
    routed.with = (...args: unknown[]): unknown => {
      const active = ambient.activeDatabase() as any;

      return active
        ? active.with?.apply(active, args)
        : originalWith.apply(source, args);
    };
  }

  const originalTransaction = source.transaction;
  if (typeof originalTransaction === 'function') {
    routed.transaction = (...args: unknown[]): unknown => {
      // A transaction opened inside a transaction is a SAVEPOINT on the connection already
      // held, which is what drizzle's own nested `tx.transaction()` emits. Routed to the
      // pool instead it would be an INDEPENDENT transaction on a second connection — able to
      // block on a row its own outer transaction holds, which is a deadlock with itself.
      const active = ambient.activeDatabase() as any;

      return active
        ? active.transaction?.apply(active, args)
        : originalTransaction.apply(source, args);
    };
  }

  return routed as TDatabase;
}
