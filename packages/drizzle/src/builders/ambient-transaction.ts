/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle's builders are structurally typed through deeply conditional generics; this routes
// them without knowing which stage it holds, so `any` is the only honest annotation.

import { AsyncLocalStorage } from 'node:async_hooks';

import type { PostgreSQLTransactionOptions } from '../types';

import { DrizzleTransactionError } from './transaction-gate';

/**
 * The open transaction a caller is inside: the client its statements belong on, and the
 * settings it runs under.
 *
 * @see docs:api/drizzle.md
 */
export interface ActiveTransaction {
  /** The client the transaction's statements are issued on. */
  readonly database: object;
  /**
   * The settings of the OUTERMOST transaction. A savepoint has none of its own — PostgreSQL
   * fixes them before the transaction's first statement — so it carries these on.
   */
  readonly options: Readonly<PostgreSQLTransactionOptions>;
}

/**
 * The open transaction, and whether it is still open.
 *
 * A mutable cell rather than a plain handle, because the async context outlives the
 * transaction: work spawned inside the callback and still running after COMMIT inherits the
 * store, and issuing a statement on a finished transaction is not what the caller meant. The
 * flag is cleared in a `finally`, so such work falls back to the pool.
 */
interface TransactionCell extends ActiveTransaction {
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
 * client** are in the transaction. Nothing else is on its own: a repository holds
 * `drizzleService.getDatabase()` from its constructor, so without this carrier
 * `repository.create()` called from inside the callback would take another pooled connection and
 * its writes would survive the ROLLBACK — of two rows written inside one callback that then
 * throws, the one written through `tx` would be gone and the one written through a repository
 * would remain.
 *
 * Atomicity would then be dialect-dependent, which is the sharpest edge a database layer can
 * have: SQLite has one connection, so there the same code is correct by design, through
 * {@link SQLiteTransactionGate}, which carries the transaction the same way.
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
    return this.activeTransaction()?.database ?? null;
  }

  /** The transaction this caller is inside, with its settings; `null` under the same rules. */
  activeTransaction(): ActiveTransaction | null {
    const store = AmbientTransaction.context.getStore();

    return store?.owner === this && store.cell.open ? store.cell : null;
  }

  /**
   * Run the transaction callback in an async context that carries `database` and the settings
   * the transaction runs under.
   *
   * The cell is closed before this returns, in a `finally`, so a statement issued by work the
   * callback left running cannot land on a transaction that has already ended.
   */
  async runInContext<R>(
    database: object,
    options: Readonly<PostgreSQLTransactionOptions>,
    callback: () => Promise<R>,
  ): Promise<R> {
    const cell: TransactionCell = { database, options, open: true };

    try {
      return await AmbientTransaction.context.run({ owner: this, cell }, callback);
    } finally {
      cell.open = false;
    }
  }
}

/**
 * Every setting a savepoint would have to change: the keys of drizzle's `PgTransactionConfig`.
 * `deferrable` is among them although `DrizzleService.transaction()` does not take it, because
 * a config handed to drizzle's own `transaction(fn, config)` can carry it.
 */
const TRANSACTION_SETTING_KEYS = ['isolationLevel', 'accessMode', 'deferrable'] as const;

/**
 * Settings asked for that the enclosing transaction does not run under, in words.
 *
 * @see docs:api/drizzle.md
 */
export interface TransactionOptionsMismatch {
  /** What was asked for: `isolationLevel 'serializable'`, … */
  asked: string;
  /** What the enclosing transaction runs under for the same keys. */
  held: string;
}

function describeSetting(settings: Readonly<Record<string, unknown>>, key: string): string {
  const value = settings[key];
  if (value === undefined) {
    return `no ${key} (the server default)`;
  }

  return `${key} ${typeof value === 'string' ? `'${value}'` : String(value)}`;
}

/**
 * What `requested` asks for that the enclosing transaction does not run under, or `null` when a
 * savepoint can serve it.
 *
 * Every setting `requested` sets has to be one the outermost transaction was opened with, at the
 * same value. One it leaves out is satisfied by whatever the enclosing transaction runs under,
 * and a `requested` that is not an object asks for nothing.
 *
 * @see docs:api/drizzle.md
 */
export function findTransactionOptionsMismatch(
  requested: unknown,
  enclosing: Readonly<PostgreSQLTransactionOptions>,
): TransactionOptionsMismatch | null {
  if (requested === null || typeof requested !== 'object') {
    return null;
  }

  const asked = requested as Readonly<Record<string, unknown>>;
  const held = enclosing as Readonly<Record<string, unknown>>;
  const differing = TRANSACTION_SETTING_KEYS
    .filter(key => asked[key] !== undefined && asked[key] !== held[key]);
  if (differing.length === 0) {
    return null;
  }

  return {
    asked: differing.map(key => describeSetting(asked, key)).join(' and '),
    held: differing.map(key => describeSetting(held, key)).join(' and '),
  };
}

const rawConfigMismatchMessage = ({ asked, held }: TransactionOptionsMismatch): string =>
  `drizzle's transaction(fn, config) asked for ${asked}, inside a DrizzleService.transaction() `
  + `opened with ${held}. Called there it opens a SAVEPOINT of that transaction, which runs under `
  + 'its settings and would ignore the config: PostgreSQL fixes them before the first statement of '
  + 'a transaction. Pass the options to the outermost DrizzleService.transaction() instead, or call '
  + 'this one without a config.';

/** Handles already guarded, so the service's own nested call does not wrap one twice. */
const guardedTransactions = new WeakSet<object>();

/**
 * The transaction client of a `DrizzleService.transaction()` callback on PostgreSQL — what
 * `tx.getRawTransaction()` returns and what the ambient cell routes `getDatabase()` onto.
 *
 * drizzle's transaction as prototype, with `transaction()` redefined on top; everything else
 * resolves to the real transaction and nothing on it is modified. drizzle's `transaction(fn,
 * config)` on a transaction opens a SAVEPOINT and drops `config`, because PostgreSQL fixes the
 * settings before a transaction's first statement — so `fn` would run under settings other than
 * the ones it asked for, and nothing would say so. Here a config that asks for anything the
 * outermost transaction does not run under is refused before the savepoint opens; a call without
 * a config, or with one the transaction already satisfies, is passed through, and the savepoint
 * handle its callback receives is guarded the same way.
 *
 * @see docs:api/drizzle.md
 */
export function createGuardedTransaction<TTransaction extends object>(
  transaction: TTransaction,
  options: Readonly<PostgreSQLTransactionOptions>,
): TTransaction {
  const source = transaction as any;
  const originalTransaction = source.transaction;
  if (guardedTransactions.has(transaction) || typeof originalTransaction !== 'function') {
    return transaction;
  }

  const guarded = Object.create(transaction) as any;
  guarded.transaction = (callback: unknown, ...rest: unknown[]): unknown => {
    const mismatch = findTransactionOptionsMismatch(rest[0], options);
    if (mismatch !== null) {
      // Rejected rather than thrown: the call it stands for returns a promise.
      return Promise.reject(
        new DrizzleTransactionError('POSTGRESQL_TRANSACTION_OPTIONS_MISMATCH', rawConfigMismatchMessage(mismatch)),
      );
    }

    // The savepoint's own handle carries the same `transaction()`, so the rule holds however
    // deep drizzle's API is nested.
    const guardedCallback = typeof callback === 'function'
      ? (savepoint: object, ...more: unknown[]): unknown =>
        callback(createGuardedTransaction(savepoint, options), ...more)
      : callback;

    return originalTransaction.call(source, guardedCallback, ...rest);
  };
  guardedTransactions.add(guarded);

  return guarded as TTransaction;
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
      // `active` is the guarded client (see createGuardedTransaction), so a config the
      // savepoint would silently drop is refused there.
      const active = ambient.activeDatabase() as any;

      return active
        ? active.transaction?.apply(active, args)
        : originalTransaction.apply(source, args);
    };
  }

  return routed as TDatabase;
}
