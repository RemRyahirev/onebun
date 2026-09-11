/**
 * Which application built an instance, for code that has `this` but no application handle.
 *
 * `@Timed()`, `@Counted()` and `@Gauged()` are METHOD decorators: they are applied at
 * class-definition time, before any application exists, and their wrappers receive only the
 * method's own arguments. So they resolved the metrics service through a process-wide slot that
 * the last application to start overwrites. Measured with two applications, a `@Timed()` method
 * in the FIRST one produced `beta_AlphaService_timedWork_duration_*{app="beta"}` — wrong prefix,
 * wrong identity, served from the wrong endpoint, and CREATED in the wrong registry, so the
 * second application permanently owned a series describing work it never did.
 *
 * The answer was already on `this`: at the moment the wrapper runs, the instance's own scope
 * points at the right application. This makes that reachable from a package that cannot import
 * `@onebun/core` — the stamp is read duck-typed, by symbol.
 *
 * Modelled on {@link ../http-guards/guard-binding.ts}, which solves the same shape for guards.
 */

import type { GlobalScope } from './module';

/**
 * `Symbol.for` rather than a module-local symbol: `@onebun/metrics` cannot depend on
 * `@onebun/core` (core depends on metrics, not the other way round), so the reader finds this
 * property by well-known symbol rather than by type. It also survives a duplicated `@onebun/core`
 * in the dependency tree, exactly as `@Global()` modules already rely on.
 */
export const METRICS_OWNER = Symbol.for('onebun:metrics-owner');

/**
 * Stamp an instance with the scope of the application that built it.
 *
 * The SCOPE is stored rather than the metrics service itself, so the service is dereferenced at
 * call time: an application that has stopped clears `scope.metrics`, and a stamped instance then
 * records nothing instead of writing into a disposed registry.
 *
 * Non-enumerable so it never shows up in a spread, `JSON.stringify` or a test snapshot, and
 * guarded because a frozen or proxied instance must not break construction — a missing stamp
 * only costs the fallback that every instance had before this existed.
 */
export function attachMetricsOwner(instance: object, scope: GlobalScope): void {
  try {
    Object.defineProperty(instance, METRICS_OWNER, {
      value: scope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen, sealed or proxied instance: fall back to the process-wide slot, as before.
  }
}
