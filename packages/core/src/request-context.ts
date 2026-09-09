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
 * Per-request context stored in AsyncLocalStorage.
 * Isolates trace context across concurrent requests, preventing
 * race conditions where one request overwrites another's trace IDs.
 *
 * @see docs:api/trace.md
 */
export interface RequestContext {
  traceContext: TraceInfo | null;
}

/**
 * AsyncLocalStorage for per-request context.
 *
 * @see docs:api/trace.md
 */
export const requestContextStore = new AsyncLocalStorage<RequestContext>();

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
 * - **It covers work that has no request.** A queue handler, a scheduled job and a WebSocket
 *   callback never enter the request store — nothing runs `requestContextStore.run` for them —
 *   so before this they logged with no trace id whatever. They log with one now whenever a span
 *   is open, which is whenever the handler is traced.
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
