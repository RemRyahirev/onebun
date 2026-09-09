import {
  context,
  createContextKey,
  isSpanContextValid,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Tracer,
} from '@opentelemetry/api';

import { requestContextStore, type TraceInfo } from './request-context';

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
 * Options for the span `inEntrySpan` opens.
 */
export interface EntrySpanOptions {
  /** Defaults to `SpanKind.CONSUMER` — the kind for work arriving from somewhere else. */
  kind?: SpanKind;
  attributes?: Attributes;
  /**
   * Open a span at all. `false` re-roots and establishes ownership exactly as
   * {@link inRootTraceScope} does, and nothing more — the `tracing.traceBackgroundWork: false`
   * shape. Ownership is deliberately NOT dropped with the span: `@Traced` inside the handler
   * resolves its tracer from the ambient key at call time, and without an owner it would resolve
   * to whichever application won the process-wide provider slot.
   *
   * @defaultValue true
   */
  openSpan?: boolean;
}

/** Whether a handler returned a promise, without assuming it returned one. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === 'function';
}

/**
 * Re-root like {@link inRootTraceScope}, and open a span the work actually belongs to.
 *
 * `inRootTraceScope` alone leaves background work with NO active span, and a log line can only
 * name a span that exists: measured on a plain `@Subscribe` handler with tracing enabled, every
 * entry came out as `(no trace on the entry)`. HTTP has never had this problem because the request
 * path starts a span of its own; this is the same treatment for the work that arrives by other
 * means — a queue message, a scheduler tick, a WebSocket frame.
 *
 * **The span is opened only against an explicit `owner`.** Falling back to the ambient tracer, the
 * way `inRootTraceScope` does for ownership, would let an application with tracing switched off
 * mint spans into a sibling application's provider — one process keeps a single OpenTelemetry
 * provider, so the ambient tracer at a boundary is not necessarily this application's. With no
 * owner this is `inRootTraceScope` byte for byte, and costs the same.
 *
 * **The request scope is entered too, and that is not redundant.** `requestContextStore` is a
 * second AsyncLocalStorage, and re-rooting the OpenTelemetry context does not touch it: a handler
 * reached from a publish inside an HTTP request keeps reading that request's stored context long
 * after it finished. Entering the scope here with this span's own identity closes that leak, and
 * keeps the store and the active span in agreement the way {@link getCurrentTraceContext} expects.
 *
 * **A failure sets the status but does not record the exception.** The HTTP boundary does exactly
 * this (`endHttpTraceSync`), and a handler that is itself `@Traced` already records the throw on
 * its own span — recording it here as well would file two exception events for one error.
 *
 * @param name - the span name; keep it low-cardinality, ids belong in attributes
 * @param fn - the work
 * @param owner - the tracer of the application this work belongs to; no span without it
 * @param options - span kind and attributes
 * @returns whatever `fn` returns
 *
 * @see docs:api/trace.md
 */
export function inEntrySpan<T>(
  name: string,
  fn: () => T,
  owner?: Tracer,
  options?: EntrySpanOptions,
): T {
  if (owner === undefined || options?.openSpan === false) {
    return inRootTraceScope(fn, owner);
  }

  return context.with(ROOT_CONTEXT.setValue(APP_TRACER_KEY, owner), () => owner.startActiveSpan(
    name,
    { kind: options?.kind ?? SpanKind.CONSUMER, attributes: options?.attributes },
    (span): T => {
      const spanContext = span.spanContext();
      const traceContext: TraceInfo | null = isSpanContextValid(spanContext)
        ? {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          traceFlags: spanContext.traceFlags,
        }
        : null;

      let ended = false;
      const end = (error?: unknown): void => {
        if (ended) {
          return;
        }

        ended = true;

        if (error !== undefined) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        }

        span.end();
      };

      return requestContextStore.run({ traceContext }, (): T => {
        try {
          const result = fn();

          if (isThenable(result)) {
            return result.then(
              (value) => {
                end();

                return value;
              },
              (error: unknown) => {
                end(error);
                throw error;
              },
            ) as T;
          }

          end();

          return result;
        } catch (error) {
          end(error);
          throw error;
        }
      });
    },
  ));
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
