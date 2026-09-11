/**
 * The metrics service of the application that built an instance.
 *
 * `@Timed()`, `@Counted()` and `@Gauged()` are METHOD decorators: applied at class-definition
 * time, before any application exists, with wrappers that receive only the method's own
 * arguments. So they read a process-wide slot that the last application to start overwrites —
 * measured, a `@Timed()` method in the FIRST of two applications produced
 * `beta_AlphaService_timedWork_duration_*{app="beta"}`: wrong prefix, wrong identity, wrong
 * endpoint, and created in the wrong registry, so the second application permanently owned a
 * series describing work it never did.
 *
 * The answer is on `this`. A wrapper has no application at decoration time but it has the
 * INSTANCE at call time, and `@onebun/core` stamps every instance it builds with the scope of
 * the application that built it. This reads that stamp.
 *
 * Duck-typed by well-known symbol because `@onebun/metrics` cannot import `@onebun/core` — core
 * depends on metrics, not the other way round.
 */

/** Must match `METRICS_OWNER` in `@onebun/core`'s `module/metrics-owner.ts`. */
const METRICS_OWNER = Symbol.for('onebun:metrics-owner');

/**
 * The metrics service belonging to whoever built `thisArg`, or `undefined`.
 *
 * Dereferenced through the scope on every call rather than captured: an application that has
 * stopped clears its `metrics`, so a stamped instance of a stopped application records nothing
 * instead of writing into a disposed registry.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ownerMetricsService(thisArg: unknown): any {
  if (thisArg === null || (typeof thisArg !== 'object' && typeof thisArg !== 'function')) {
    return undefined;
  }

  const scope = (thisArg as Record<symbol, unknown>)[METRICS_OWNER];
  if (scope === null || typeof scope !== 'object') {
    return undefined;
  }

  return (scope as { metrics?: unknown }).metrics;
}
