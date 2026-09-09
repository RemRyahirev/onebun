import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  type Tracer,
} from '@opentelemetry/api';

/**
 * The key under which the owning application's tracer rides in the OpenTelemetry context.
 *
 * Deliberately re-derived here rather than imported from `@onebun/trace`, which is where it is
 * defined and exported as `APP_TRACER_KEY`. `createContextKey` is `Symbol.for(description)`, so
 * both spellings resolve to the SAME key — `packages/core/src/trace-scope.test.ts` pins that
 * they agree, and a drift would be caught there rather than as spans quietly going to the wrong
 * provider.
 *
 * The duplication buys a real property: this module is imported eagerly by the scheduler, the
 * queue adapters, the WebSocket handler and the application itself. Importing `@onebun/trace`
 * from here would pull the OpenTelemetry SDK, the resource and semantic-convention packages and
 * the OTLP exporter into core's module graph at load time — defeating the deliberate lazy
 * `require('@onebun/trace')` in `OneBunApplication`, which exists so an application that does
 * not use tracing does not pay for it.
 */
const APP_TRACER_KEY = createContextKey('onebun:trace:appTracer');

/**
 * Run `fn` with no active span, so anything it traces starts a new trace.
 *
 * Once an OpenTelemetry context manager is installed, context follows the async call graph — and
 * that graph is not the same shape as causality. A `setTimeout` scheduled inside a request keeps
 * the request's context; so does a WebSocket callback registered during the upgrade, and a queue
 * handler reached from a publish that happened mid-request. Left alone, a cron job would appear as
 * a child of whichever request was in flight when its timer was armed, and would keep appearing
 * under that finished request for the life of the process — a trace that grows forever and names
 * the wrong cause.
 *
 * That is worse than no nesting at all, so every boundary where work stops belonging to the thing
 * that scheduled it re-roots explicitly. The list is short and deliberate: scheduled jobs, queue
 * message delivery, WebSocket callbacks.
 *
 * **Re-rooting drops the parent, not the owner.** OpenTelemetry keeps one tracer provider per
 * process and refuses a duplicate, so in a process running several applications the framework
 * has to carry which application a piece of work belongs to; that travels in the same context as
 * the parent span. Dropping it here would send a queue handler's `@Traced` spans to whichever
 * application happened to register its provider first, under that application's `service.name`.
 * So the owner is preserved across the re-root, and `owner` overrides it where the caller knows
 * better.
 *
 * A no-op when no context manager is installed — `context.with` then just calls `fn`.
 *
 * @param fn - work that should begin its own trace
 * @param owner - the tracer of the application this work belongs to, when the caller knows it
 * @returns whatever `fn` returns
 *
 * @see docs:api/trace.md
 */
export function inRootTraceScope<T>(fn: () => T, owner?: Tracer): T {
  const tracer = owner ?? (context.active().getValue(APP_TRACER_KEY) as Tracer | undefined);

  return context.with(
    tracer === undefined ? ROOT_CONTEXT : ROOT_CONTEXT.setValue(APP_TRACER_KEY, tracer),
    fn,
  );
}

/**
 * Run `fn` with `tracer` as the owning application's tracer, without re-rooting the trace.
 *
 * For boundaries that must establish ownership but must NOT break parentage — a queue handler
 * already inside its adapter's re-root, an application's own startup.
 *
 * Elides when there is nothing to change, so re-establishing ownership on a path that already
 * carries it costs neither a context frame nor an allocation.
 *
 * @see docs:api/trace.md
 */
export function runWithAppTracer<T>(tracer: Tracer | undefined, fn: () => T): T {
  if (tracer === undefined || context.active().getValue(APP_TRACER_KEY) === tracer) {
    return fn();
  }

  return context.with(context.active().setValue(APP_TRACER_KEY, tracer), fn);
}
