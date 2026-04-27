import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request trace information stored in AsyncLocalStorage.
 */
export interface TraceInfo {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
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
