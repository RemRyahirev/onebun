import {
  context,
  createContextKey,
  type Context as OtelContext,
  trace as otelTrace,
  type Tracer,
} from '@opentelemetry/api';

/**
 * The key under which the owning application's tracer rides in the OpenTelemetry context.
 *
 * `createContextKey` is `Symbol.for(description)`, so two copies of this module — or the
 * deliberate re-derivation in `@onebun/core`'s `trace-scope.ts`, which cannot import this
 * package without pulling the whole OTEL SDK into core's module graph — resolve to the SAME
 * key. `packages/trace/tests/app-tracer.test.ts` pins that the two spellings agree.
 */
export const APP_TRACER_KEY = createContextKey('onebun:trace:appTracer');

/** Attach an owning tracer to a context. Plumbing for {@link runWithAppTracer}. */
export function withAppTracer(ctx: OtelContext, tracer: Tracer): OtelContext {
  return ctx.setValue(APP_TRACER_KEY, tracer);
}

/** The owning application's tracer, if some enclosing boundary established one. */
export function currentAppTracer(): Tracer | undefined {
  return context.active().getValue(APP_TRACER_KEY) as Tracer | undefined;
}

/**
 * The tracer a framework span should be created from, here and now.
 *
 * This is what `@Traced`, `@Span` and the auto-trace wrapper resolve through. They are
 * installed on a PROTOTYPE at class-decoration time — before any application exists, and once
 * for every application in the process, since the wrapper marks the method as already traced —
 * so they cannot capture an owner and must ask at call time.
 *
 * Falls back to the process-global tracer, which is byte-for-byte what those three sites did
 * before. In a single-application process the global IS that application's provider, so the
 * fallback is the correct answer and nothing changes; in a multi-application process outside
 * any framework boundary it is the first-registered provider, which is today's behaviour and
 * the documented residue rather than a regression.
 *
 * @see docs:api/trace.md
 */
export function appTracer(name = '@onebun/trace'): Tracer {
  return currentAppTracer() ?? otelTrace.getTracer(name);
}

/**
 * Run `fn` with `tracer` as the owning application's tracer.
 *
 * Elides when there is nothing to change — no tracer, or the same one already ambient — so
 * re-establishing ownership on a path that already carries it costs nothing. That matters on
 * the per-message queue path, which re-enters it for every delivery.
 *
 * @see docs:api/trace.md
 */
export function runWithAppTracer<T>(tracer: Tracer | undefined, fn: () => T): T {
  if (tracer === undefined || currentAppTracer() === tracer) {
    return fn();
  }

  return context.with(withAppTracer(context.active(), tracer), fn);
}
