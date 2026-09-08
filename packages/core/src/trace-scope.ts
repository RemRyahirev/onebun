import { context, ROOT_CONTEXT } from '@opentelemetry/api';

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
 * A no-op when no context manager is installed — `context.with` then just calls `fn`.
 *
 * @param fn - work that should begin its own trace
 * @returns whatever `fn` returns
 *
 * @see docs:api/trace.md
 */
export function inRootTraceScope<T>(fn: () => T): T {
  return context.with(ROOT_CONTEXT, fn);
}
