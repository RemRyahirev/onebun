import { AsyncLocalStorage } from 'node:async_hooks';

import {
  context,
  ROOT_CONTEXT,
  trace as otelTrace,
} from '@opentelemetry/api';

import type {
  Context,
  ContextManager,
  Span,
} from '@opentelemetry/api';

/**
 * The mutable cell one context scope keeps.
 *
 * OpenTelemetry contexts are immutable — `setValue` returns a new one — so a context manager
 * normally stores the context itself and a change means opening a nested scope. This one stores a
 * cell instead, for a single reason: the framework enters the request's scope BEFORE it knows
 * whether there will be a span to put in it.
 *
 * The HTTP span is created a few statements later, inside header parsing and after the per-request
 * timeout is applied, and making it active by nesting would mean wrapping the entire request body
 * — several hundred lines, on the measured hot path — in another callback. Promoting the span
 * inside the scope that already exists costs one assignment.
 *
 * Nesting still nests: `with()` always allocates a fresh cell, so a `@Traced` method that opens a
 * child span cannot leak it back into the request scope when it returns.
 */
interface ContextScope {
  current: Context;
}

/**
 * Marker used to prove, from the outside, that the manager behind the OpenTelemetry global is
 * this one and not somebody else's.
 */
const OWNERSHIP_PROBE: unique symbol = Symbol.for('onebun:trace:contextOwnershipProbe');

/**
 * An OpenTelemetry `ContextManager` over `AsyncLocalStorage`.
 *
 * Written rather than taken from `@opentelemetry/context-async-hooks` because that package's
 * manager reaches into Node's `events` internals to bind `EventEmitter` listeners, which is the
 * part least likely to behave identically under Bun and the part nothing here needs. What the
 * framework needs is the other 40 lines.
 *
 * @see docs:api/trace.md
 */
export class OneBunContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<ContextScope>();
  private enabled = false;

  active(): Context {
    if (!this.enabled) {
      return ROOT_CONTEXT;
    }

    return this.storage.getStore()?.current ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    activeContext: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(
      { current: activeContext },
      () => fn.apply(thisArg as ThisParameterType<F>, args),
    );
  }

  bind<T>(bound: Context, target: T): T {
    if (typeof target !== 'function') {
      // Deliberately not the `EventEmitter` case the SDK's manager also handles: nothing in the
      // framework binds an emitter, and guessing at Node's internals under Bun to support a call
      // that is never made would be the riskiest code in the file.
      return target;
    }

    const manager = this;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return function boundToContext(this: unknown, ...args: any[]): any {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return manager.with(bound, target as any, this, ...args);
    } as unknown as T;
  }

  enable(): this {
    this.enabled = true;

    return this;
  }

  /**
   * Stop answering with stored contexts.
   *
   * Deliberately does NOT call `storage.disable()`. Tearing down an `AsyncLocalStorage` under
   * code that is inside it breaks async continuation for the whole process — awaits stop
   * resuming, with no error, and everything downstream simply hangs. Measured: with the call in
   * place, a test file that disabled a context manager made every async test in every later file
   * time out.
   *
   * Nothing needs it either. The flag alone makes `active()` answer `ROOT_CONTEXT`, and requests
   * still in flight when an application shuts down finish on their own storage rather than
   * losing their continuation.
   */
  disable(): this {
    this.enabled = false;

    return this;
  }

  /**
   * Make `span` the active span of the scope that is already open, instead of opening a new one.
   *
   * Returns `false` when there is no scope to promote it into — a caller outside any `with()`,
   * which is the honest answer rather than silently creating a scope that would end at the next
   * statement.
   */
  activateSpanInCurrentScope(span: Span): boolean {
    const scope = this.storage.getStore();

    if (!scope) {
      return false;
    }

    scope.current = otelTrace.setSpan(scope.current, span);

    return true;
  }
}

/**
 * The manager THIS package installed as the OpenTelemetry global, if any.
 *
 * Same rule as the tracer provider (`provider.ts`): the context manager is one slot shared by the
 * whole process, `setGlobalContextManager` refuses a duplicate, and `context.disable()` is a
 * process-global de-registration scoped to nothing. Recording what we installed is what lets
 * shutdown tell "remove the manager I put there" from "remove someone else's".
 */
let installedManager: OneBunContextManager | null = null;

/**
 * How many live trace services are relying on the installed manager.
 *
 * A process can hold several applications; the last one out turns off the light. Without the
 * count, the first application to stop would strip context propagation from its still-running
 * siblings — the same defect `releaseGlobal` exists to prevent for providers.
 */
let managerUsers = 0;

/**
 * Is the manager we installed still the one behind the global?
 *
 * There is no getter for the registered manager, so identity is proved by behaviour: open a scope
 * on OUR manager carrying a marker, and ask the GLOBAL what is active. If the global is ours it
 * sees the marker; if anyone re-registered in the meantime, their manager has no such scope and
 * answers `ROOT_CONTEXT`.
 *
 * This is the provider lesson restated — a remembered ownership flag goes stale the moment
 * somebody else touches the slot, so it is re-derived rather than trusted.
 */
function ourManagerIsInstalled(): boolean {
  const manager = installedManager;

  if (!manager) {
    return false;
  }

  const probe = ROOT_CONTEXT.setValue(OWNERSHIP_PROBE, manager);

  return manager.with(probe, () => context.active().getValue(OWNERSHIP_PROBE) === manager);
}

/**
 * Install a context manager, or join the one already installed by this package.
 *
 * Returns whether spans will nest from here on. `false` means the slot belongs to somebody else —
 * a user's own OpenTelemetry SDK, or another library — and we leave it alone: their manager still
 * propagates context, and taking the slot from them would break more than it fixes.
 *
 * @see docs:api/trace.md
 */
export function installContextManager(): boolean {
  // Re-derived, never remembered. `context.disable()` is a process-global wipe that anyone can
  // call — another library, a test teardown — and a `installedManager !== null` check would then
  // report success while the slot sat empty and nothing propagated. That is exactly the stale
  // ownership flag `releaseGlobal` was fixed for on the provider side.
  if (ourManagerIsInstalled()) {
    managerUsers++;

    return true;
  }

  // A fresh instance rather than re-registering the old one: whoever wiped the slot may also
  // have disabled its storage, and a manager whose `AsyncLocalStorage` is dead answers
  // `ROOT_CONTEXT` to everything without saying so.
  const manager = new OneBunContextManager().enable();

  if (!context.setGlobalContextManager(manager)) {
    return false;
  }

  installedManager = manager;
  // `++`, not `= 1`: a wipe from outside is not a release, and any claims taken before it are
  // still owed a `releaseContextManager()` call.
  managerUsers++;

  return true;
}

/**
 * Give up one claim on the installed context manager.
 *
 * The manager is removed only when this package installed it, still owns it, and nothing else in
 * the process is using it. Anything else and the slot is left exactly as found.
 */
export function releaseContextManager(): void {
  if (!installedManager || managerUsers === 0) {
    return;
  }

  managerUsers--;

  if (managerUsers > 0) {
    return;
  }

  if (ourManagerIsInstalled()) {
    context.disable();
  }

  installedManager.disable();
  installedManager = null;
}

/**
 * Make `span` active for the scope the caller is already in.
 *
 * Returns `false` when the framework's manager is not the installed one, or when there is no open
 * scope — in both cases the span is still recorded and exported, it simply has no children.
 *
 * @see docs:api/trace.md
 */
export function activateSpanInCurrentScope(span: Span): boolean {
  return installedManager?.activateSpanInCurrentScope(span) ?? false;
}

/**
 * Test seam: forget what is installed without touching the global.
 *
 * @internal
 */
export function resetContextManagerStateForTests(): void {
  installedManager = null;
  managerUsers = 0;
}
