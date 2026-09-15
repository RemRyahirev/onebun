import { AsyncLocalStorage } from 'node:async_hooks';

import { isSpanContextValid, trace } from '@opentelemetry/api';

/**
 * Per-request trace information stored in AsyncLocalStorage.
 */
export interface TraceInfo {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  /**
   * W3C trace flags; bit 0 is "sampled".
   *
   * Always present at runtime — the trace service puts it there — and declared optional only
   * because a caller constructing a `TraceInfo` by hand has nothing meaningful to say about it.
   * Read when rendering an outgoing `traceparent`, so that a downstream service inherits this
   * request's sampling decision instead of being told everything is sampled.
   */
  traceFlags?: number;
}

/**
 * Per-unit-of-work context stored in AsyncLocalStorage.
 *
 * Isolates the trace context across concurrent requests, preventing a race where one request
 * overwrites another's trace ids — and, since it is an ambient the framework establishes at every
 * entry point, it is also where an application hangs the things it computes once per request and
 * reads at any depth: the authenticated user, the tenant, the transaction this request opened.
 *
 * **Extend it by declaration merging**, which is what keeps the reads typed and cast-free:
 *
 * ```typescript
 * declare module '@onebun/core' {
 *   interface RequestContext {
 *     user?: AuthenticatedUser;
 *   }
 * }
 * ```
 *
 * **An augmented member MUST be optional.** This is not style — a required one does not compile.
 * `@onebun/core` ships TypeScript sources rather than built `.d.ts`, so a consumer program
 * typechecks this file; a required member makes every framework-internal construction of a
 * `RequestContext` an error inside `node_modules`, where there is nothing you can edit to fix it.
 * It is also not caught by `docs:typecheck`, which discards diagnostics from non-snippet files.
 *
 * @see docs:api/request-context.md
 */
export interface RequestContext {
  traceContext: TraceInfo | null;
}

/**
 * Everything a caller may write. `traceContext` is deliberately absent: it is the framework's,
 * it must agree with the active span, and a caller who replaces it makes every log line and every
 * outgoing `traceparent` name a span that does not exist.
 */
export type RequestContextPatch = Partial<Omit<RequestContext, 'traceContext'>>;

/**
 * AsyncLocalStorage for the per-unit-of-work context.
 *
 * Exported for the same reason the store's helpers are: a caller establishing its own boundary —
 * a bespoke worker loop, a test — needs to open a scope. Prefer {@link getRequestContext} and
 * {@link updateRequestContext} for reading and writing inside one.
 *
 * @see docs:api/request-context.md
 */
export const requestContextStore = new AsyncLocalStorage<RequestContext>();

/**
 * A fresh context for a new unit of work.
 *
 * One constructor rather than object literals at each boundary, so an augmented member that ever
 * does need a framework-side default has exactly one place to acquire it.
 *
 * @see docs:api/request-context.md
 */
export function createRequestContext(traceContext: TraceInfo | null): RequestContext {
  return { traceContext };
}

/**
 * The context of the unit of work this code is running in, or `undefined` outside one.
 *
 * Never throws. A guard, an interceptor or a service may legitimately run outside a scope — a
 * lifecycle hook, a CORS preflight short-circuit, the framework's own `/metrics` endpoint — and
 * code shared between those and a request handler must not have to know which it is in.
 *
 * @see docs:api/request-context.md
 *
 * @example
 * ```typescript
 * const user = getRequestContext()?.user;
 * ```
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

/**
 * Merge `patch` into the current context. Returns whether there was a context to merge into.
 *
 * **It mutates the stored object rather than replacing it**, and that is the only semantics under
 * which this is useful: `AsyncLocalStorage` propagates a mutation of the stored object outward and
 * inward, while replacing the store's value is possible only by opening a new scope, whose effect
 * ends with that scope. A middleware that wrote a replacement would find the handler reading the
 * old value.
 *
 * **Outside a scope it is a no-op returning `false`, not a throw.** Throwing would require every
 * boundary that can reach shared code to open a scope first, and several deliberately do not: the
 * CORS preflight short-circuit runs a resolved middleware instance directly, the `/docs`,
 * `/openapi.json` and `/metrics` endpoints answer without one, and 404s and static assets skip the
 * ALS frame on purpose because it is the cheapest path in the server. A guard shared between a
 * route and any of those would 500 on the wrong one. The boolean is there so a caller that needs
 * to know can ask.
 *
 * @param patch - the members to merge
 * @returns `true` if a context was present and updated, `false` if there was none
 *
 * @see docs:api/request-context.md
 *
 * @example
 * ```typescript
 * updateRequestContext({ user: await verify(token) });
 * ```
 */
export function updateRequestContext(patch: RequestContextPatch): boolean {
  const store = requestContextStore.getStore();

  if (store === undefined) {
    return false;
  }

  Object.assign(store, patch);

  return true;
}

/**
 * The context a nested boundary should start from: a shallow COPY of the enclosing one, or a fresh
 * empty context when there is none.
 *
 * The copy is what makes entering a scope here safe to add. Before this, the untraced entry branch
 * entered no scope at all, so background work simply read the enclosing store — a queue handler
 * dispatched from inside an HTTP request kept reading that request's values. Copying preserves
 * every read exactly as it was, and isolates WRITES, which previously reached back into the
 * enclosing request and outlived the work that made them.
 *
 * @internal
 */
export function inheritRequestContext(): RequestContext {
  const store = requestContextStore.getStore();

  return store === undefined ? createRequestContext(null) : { ...store };
}

/**
 * The trace this code is running in, or `null` if it is not running in one.
 *
 * The OpenTelemetry active span comes FIRST, and that ordering is the whole point:
 *
 * - **It is the span that exists.** The request store used to be filled with a trace context
 *   generated separately from the span — `generateTraceContextSync()` alongside
 *   `startHttpTraceSync()` — so every log line carried ids belonging to no span at all, and a
 *   trace id copied out of the logs found nothing in the backend. That is fixed at the source
 *   too, but reading the span first means the two can no longer drift apart.
 * - **It is what outgoing calls already use.** `wireOutgoingTraceContext` resolves the same
 *   way, so a downstream service and this service's own logs name the same span instead of
 *   disagreeing.
 * - **It covers work whose store carries nothing.** A queue handler, a scheduled job and a
 *   WebSocket callback all enter the store now, but an untraced one enters it with a `null` trace
 *   context — there is no span to name. Reading the active span first means they still log with a
 *   trace id whenever one is open, which is whenever the handler is traced.
 * - **It is the innermost span.** A line logged inside a `@Traced` method names that method's
 *   span rather than the request's, which is the more useful of the two and, again, matches
 *   what an outgoing call from the same place would send.
 *
 * An invalid span context — the all-zero ids of a non-recording span — is not a trace and is
 * skipped, so a disabled tracer cannot stamp `00000000…` onto every log line.
 *
 * @see docs:api/trace.md
 */
export function getCurrentTraceContext(): TraceInfo | null {
  const stored = requestContextStore.getStore()?.traceContext ?? null;
  const activeSpan = trace.getActiveSpan();

  if (activeSpan) {
    const spanContext = activeSpan.spanContext();

    if (isSpanContextValid(spanContext)) {
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        // A `SpanContext` describes a span, not the edge to its parent, so the parent id has to
        // come from the request scope — and only when that scope is describing THIS span. Inside
        // a `@Traced` method the active span is a child of the request's, and answering with the
        // request's parent there would name a grandparent as the parent.
        parentSpanId: stored?.spanId === spanContext.spanId ? stored.parentSpanId : undefined,
        traceFlags: spanContext.traceFlags,
      };
    }
  }

  return stored;
}
