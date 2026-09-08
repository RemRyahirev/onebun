import { AsyncLocalStorage } from 'node:async_hooks';

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
 * Get the current request's trace context, or null if outside a request scope.
 */
export function getCurrentTraceContext(): TraceInfo | null {
  return requestContextStore.getStore()?.traceContext ?? null;
}
