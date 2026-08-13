/* eslint-disable @typescript-eslint/no-explicit-any */
// Drizzle's builders are structurally typed through deeply conditional generics; the gate
// wraps them without knowing which stage it holds, so `any` is the only honest annotation.

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Why a transaction on SQLite is refused rather than executed.
 *
 * @see docs:api/drizzle.md
 */
export type DrizzleTransactionErrorCode =
  /** A synchronous statement was issued while a transaction holds the connection. */
  | 'SQLITE_TRANSACTION_SYNC_QUERY'
  /** `transaction()` was called from inside a transaction callback. */
  | 'SQLITE_TRANSACTION_NESTED';

/**
 * A transaction on SQLite could not be carried out as asked.
 *
 * Thrown instead of deadlocking or of silently enrolling a query in someone else's
 * transaction. `name` is stable (`DrizzleTransactionError`) so it can be matched without
 * importing the class, and `code` says which of the three situations it is.
 *
 * @see docs:api/drizzle.md
 */
export class DrizzleTransactionError extends Error {
  override readonly name = 'DrizzleTransactionError';

  constructor(
    readonly code: DrizzleTransactionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const NESTED_TRANSACTION_MESSAGE =
  'transaction() was called from inside a transaction() callback. SQLite has one connection and '
  + 'the outer transaction holds it, so the inner one can never start. Perform the work through '
  + 'the `tx` client of the outer callback instead.';

const syncQueryMessage = (operation: string): string =>
  `A synchronous \`.${operation}()\` was issued while a SQLite transaction holds the connection. `
  + 'Asynchronous queries are queued and run after the transaction commits or rolls back, but a '
  + 'synchronous one cannot wait — it would join the transaction and be rolled back with it. '
  + `Await the query instead of calling \`.${operation}()\`, or issue it through the transaction `
  + 'client if it belongs to the transaction.';

/**
 * Serializes SQLite transactions and queues everything else behind them.
 *
 * bun:sqlite is ONE connection, and drizzle's bun-sqlite session is synchronous, so an async
 * callback cannot be run through `client.transaction(fn)` — that commits the moment `fn`
 * returns, which for an async function is its first `await`. The transaction is therefore
 * issued as manual BEGIN / COMMIT | ROLLBACK, and this gate is what keeps the rest of the
 * application off that connection while it is open:
 *
 * - `wait()` returns `null` when no transaction is in flight — the fast path, one field read;
 * - while a transaction is in flight it returns a promise that settles after COMMIT or
 *   ROLLBACK, so a query issued meanwhile executes AFTER the transaction and is not rolled
 *   back with it;
 * - a second `transaction()` waits for the first through the same gate (serialized);
 * - a query issued from inside the callback would wait for the transaction that is waiting
 *   for it, so it is refused with {@link DrizzleTransactionError}. The tell is the async
 *   context: it is inherited by everything created inside the callback.
 *
 * @see docs:api/drizzle.md
 */
/** What an async context started inside a transaction callback carries. */
interface TransactionContext {
  gate: SQLiteTransactionGate;
  /** The client the transaction's statements are issued on. */
  database: object;
  /** Which transaction of that gate, so later work cannot be mistaken for this one. */
  transaction: number;
}

export class SQLiteTransactionGate {
  /**
   * Which gate owns the current async context. One store for the process, holding the gate
   * instance, so two DrizzleService instances (two databases) do not see each other's
   * transactions as re-entrant.
   */
  private static readonly context = new AsyncLocalStorage<TransactionContext>();

  /** Settles when the in-flight transaction ends; `null` when the connection is free. */
  private inFlight: Promise<void> | null = null;

  private release: (() => void) | null = null;

  /**
   * Which transaction is on the connection. Compared against the one an async context was
   * started under, so work left running by an EARLIER transaction is not mistaken for part
   * of the current one — it is a bystander and must queue like any other.
   */
  private currentTransaction = 0;

  /** True when the caller's async context began inside this gate's transaction callback. */
  isReentrant(): boolean {
    return SQLiteTransactionGate.context.getStore()?.gate === this;
  }

  /**
   * The transaction client to run this statement on, when the caller is inside the callback.
   *
   * This is what makes `repository.create()` — or any service query — work inside
   * `transaction()`: rather than refusing it for lack of a `tx` argument, it is issued ON the
   * open transaction, which is what the caller meant and what the old code did by accident.
   * `null` for everyone else, including work that outlived the transaction it started in.
   */
  activeTransactionDatabase(): object | null {
    const store = SQLiteTransactionGate.context.getStore();

    return store?.gate === this
      && this.inFlight !== null
      && store.transaction === this.currentTransaction
      ? store.database
      : null;
  }

  /**
   * What a query has to wait for before it may touch the connection.
   *
   * `null` means "nothing" and is the only result on the path that matters for performance.
   */
  wait(): Promise<void> | null {
    if (this.inFlight === null) {
      return null;
    }

    if (this.activeTransactionDatabase() !== null) {
      // Issued from inside the callback: it runs ON this transaction, so it waits for nothing.
      return null;
    }

    return this.drain();
  }

  /**
   * Refuse a statement that cannot be queued.
   *
   * `.all()`, `.get()`, `.run()` and `.values()` execute at call time and return rows, not a
   * promise, so there is no point at which they could wait for the transaction. Same for
   * drizzle's own `transaction()`, which would take the connection this gate is holding.
   */
  assertQueueable(operation: string): void {
    if (this.inFlight === null) {
      return;
    }

    if (this.activeTransactionDatabase() !== null) {
      // Inside the callback the connection is already this caller's; a synchronous statement
      // is issued on the transaction rather than refused.
      return;
    }

    throw new DrizzleTransactionError('SQLITE_TRANSACTION_SYNC_QUERY', syncQueryMessage(operation));
  }

  /**
   * Take the connection for a transaction, waiting for any transaction already on it.
   *
   * The loop rather than a single await: several callers wake from the same promise, and the
   * one that wins re-arms the gate before the others run, so the rest must look again.
   */
  async acquire(): Promise<void> {
    if (this.activeTransactionDatabase() !== null) {
      throw new DrizzleTransactionError('SQLITE_TRANSACTION_NESTED', NESTED_TRANSACTION_MESSAGE);
    }

    while (this.inFlight !== null) {
      await this.inFlight;
    }

    this.currentTransaction += 1;
    this.inFlight = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  /** Hand the connection back. Must run in a `finally`: COMMIT and ROLLBACK both end here. */
  releaseAcquired(): void {
    const release = this.release;
    this.inFlight = null;
    this.release = null;
    release?.();
  }

  /**
   * Run the transaction callback in an async context that marks it as this gate's, and that
   * carries the client its statements belong on.
   */
  async runInContext<R>(database: object, callback: () => Promise<R>): Promise<R> {
    return await SQLiteTransactionGate.context.run(
      { gate: this, database, transaction: this.currentTransaction },
      callback,
    );
  }

  private async drain(): Promise<void> {
    while (this.inFlight !== null) {
      await this.inFlight;
    }
  }
}

/** Methods that start a query: `db.select()`, `db.insert(t)`, `db.$count(t)`, … */
const QUERY_ENTRY_POINTS = ['select', 'selectDistinct', 'insert', 'update', 'delete', '$count'] as const;

/**
 * Methods that execute at call time and return rows rather than a promise — on a builder and,
 * with the same names, as the database's own raw-SQL shortcuts (`db.run(sql)`).
 */
const SYNC_TERMINALS = new Set(['all', 'get', 'run', 'values']);

const isThenable = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && typeof (value as any).then === 'function';

/**
 * Wrap a lazily-executed drizzle builder so its statement waits for the gate.
 *
 * The gate cannot be applied where the builder is created: drizzle's builders are lazy and
 * thenable, and the statement runs inside `then()` — `SQLiteSelectBase.execute()` calls
 * `this.all()` synchronously. So `then` is what has to be intercepted, and the objects
 * returned by chained methods have to be re-wrapped, since the one that is finally awaited
 * may not be the one this was called on: `.from()`, `.values()` and `.set()` each build a
 * new object, while `.where()` and `.limit()` mutate and return the same one.
 *
 * Measured against the ungated builder with the database stubbed out, because a real SQLite
 * query's own variance (±1.4us, from a raw-versus-raw null experiment) is several times the
 * effect: +0.27us per select, +0.20-0.23us per insert or update, +0.17us per delete, against
 * a query that costs 13-20us. An own-property variant that patches `then` on the builder
 * instead of proxying it measures the same within noise, so this keeps the shape that needs
 * no list of drizzle's method names to stay correct.
 */
function gatedBuilder<TBuilder extends object>(builder: TBuilder, gate: SQLiteTransactionGate): TBuilder {
  const originalThen = (builder as any).then as ((...args: any[]) => unknown) | undefined;

  // Only a builder that is already thenable gets a `then` — inventing one on a stage that is
  // not (`db.insert(t)` before `.values()`) would make `await` on it hang or throw.
  const gatedThen = typeof originalThen === 'function'
    ? (onFulfilled?: any, onRejected?: any): unknown => {
      const wait = gate.wait();
      if (wait === null) {
        return originalThen.call(builder, onFulfilled, onRejected);
      }

      // The statement is issued only once the gate opens: `then` is where it would run.
      return wait
        .then(() => new Promise((resolve, reject) => originalThen.call(builder, resolve, reject)))
        .then(onFulfilled, onRejected);
    }
    : undefined;

  // A stage that cannot execute has no terminals to guard, and the names overlap: `values`
  // is the rows to insert on `db.insert(t)`, and a synchronous execution on everything that
  // is already a runnable query.
  const executable = gatedThen !== undefined;

  const proxy: TBuilder = new Proxy(builder, {
    get(target, property) {
      if (property === 'then') {
        return gatedThen;
      }

      // Read and call against the real builder, never the proxy: drizzle's internals stay
      // on the object they were written for, and only what comes back out is wrapped.
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') {
        return value;
      }

      if (executable && SYNC_TERMINALS.has(property as string)) {
        return (...args: unknown[]): unknown => {
          gate.assertQueueable(property as string);

          return value.apply(target, args);
        };
      }

      if (executable && property === 'execute') {
        return (...args: unknown[]): unknown => {
          const wait = gate.wait();

          return wait === null
            ? value.apply(target, args)
            : wait.then(() => value.apply(target, args));
        };
      }

      return (...args: unknown[]): unknown => {
        const result = value.apply(target, args);
        // The chain mutates and returns the same object; keeping one proxy per builder is
        // both cheaper and what makes `builder === builder.where(...)` still hold.
        if (result === target) {
          return proxy;
        }

        // Anything else that can be awaited is another stage of the same query. Rows,
        // `toSQL()` output and subqueries are results, and are handed back untouched.
        return isThenable(result) ? gatedBuilder(result as object, gate) : result;
      };
    },
  });

  return proxy;
}

/**
 * Define gated query entry points on `target`, forwarding to the ones on `source`.
 *
 * Used for the database itself and for the object `db.with(...)` returns, which carries the
 * same five entry points.
 */
function defineGatedEntryPoints(source: any, target: any, gate: SQLiteTransactionGate): void {
  for (const method of QUERY_ENTRY_POINTS) {
    const original = source[method];
    if (typeof original !== 'function') {
      continue;
    }

    target[method] = (...args: unknown[]): unknown => {
      // Inside the callback the query is issued on the transaction itself and needs no gate:
      // it is already on the connection the transaction holds.
      const active = gate.activeTransactionDatabase() as any;
      if (active) {
        return active[method]?.apply(active, args);
      }

      const result = original.apply(source, args);

      return result !== null && typeof result === 'object'
        ? gatedBuilder(result as object, gate)
        : result;
    };
  }
}

/**
 * The database object handed out by `DrizzleService.getDatabase()` on SQLite.
 *
 * Every query built from it waits for an open transaction instead of joining it. It is the
 * database itself as prototype with the query entry points redefined on top — so anything
 * not listed here (`db.session`, `db.$client`, `db.query`, …) resolves to the real thing at
 * no cost, and nothing on the real instance is modified. The transaction's own client is
 * deliberately NOT gated: its statements belong on the connection right away.
 *
 * @see docs:api/drizzle.md
 */
export function createGatedDatabase<TDatabase extends object>(
  db: TDatabase,
  gate: SQLiteTransactionGate,
): TDatabase {
  const gated = Object.create(db) as any;
  const source = db as any;

  defineGatedEntryPoints(source, gated, gate);

  const originalWith = source.with;
  if (typeof originalWith === 'function') {
    gated.with = (...args: unknown[]): unknown => {
      const cteEntryPoints = originalWith.apply(source, args);
      defineGatedEntryPoints(cteEntryPoints, cteEntryPoints, gate);

      return cteEntryPoints;
    };
  }

  for (const method of SYNC_TERMINALS) {
    const original = source[method];
    if (typeof original !== 'function') {
      continue;
    }

    // Raw SQL through `db.run(sql)` and friends: synchronous, so it cannot be queued — but
    // inside the callback it belongs on the transaction, like everything else there.
    gated[method] = (...args: unknown[]): unknown => {
      gate.assertQueueable(method);
      const active = gate.activeTransactionDatabase() as any;

      return active
        ? active[method]?.apply(active, args)
        : original.apply(source, args);
    };
  }

  const originalTransaction = source.transaction;
  if (typeof originalTransaction === 'function') {
    gated.transaction = (...args: unknown[]): unknown => {
      // drizzle's own SQLite transaction is synchronous and takes the same single
      // connection. Starting one while the service holds it is what produced
      // `cannot start a transaction within a transaction` from the driver.
      gate.assertQueueable('transaction');

      return originalTransaction.apply(source, args);
    };
  }

  return gated as TDatabase;
}
