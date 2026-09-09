/**
 * The trace an outgoing request should be attributed to.
 *
 * Deliberately structural rather than an OpenTelemetry `SpanContext`: `@onebun/requests` has no
 * `@onebun/*` dependencies and no OpenTelemetry ones either, because core depends on requests and
 * not the reverse. What crosses the seam is three fields.
 *
 * @see docs:api/trace.md
 */
export interface OutgoingTraceContext {
  /** 32 lowercase hex characters, not all zero. */
  traceId: string;
  /** 16 lowercase hex characters, not all zero — the span the callee should hang off. */
  spanId: string;
  /** W3C trace flags. Bit 0 is "sampled". Defaults to sampled when omitted. */
  traceFlags?: number;
}

/**
 * Answers "what trace is this call part of?", or `null` outside any traced scope.
 *
 * @see docs:api/trace.md
 */
export type TraceContextProvider = () => OutgoingTraceContext | null | undefined;

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);
const SAMPLED_FLAG = 1;
const TRACE_FLAGS_HEX_LENGTH = 2;
const HEX_RADIX = 16;

let provider: TraceContextProvider | null = null;

/**
 * Tell the HTTP client where to read the ambient trace context from.
 *
 * `OneBunApplication` calls this at construction, pointing it at the per-request context it
 * already keeps in `AsyncLocalStorage`. It exists as a seam rather than a direct import because
 * an ambient process-global was the previous answer and it never worked: nothing assigned
 * `globalThis.__onebunCurrentTraceContext`, so every outgoing call went out untraced and silent —
 * and had anything assigned it, one global cell shared by every in-flight request would have
 * attributed calls to whichever request wrote last.
 *
 * Pass `null` to unregister. Registering is idempotent; the last caller wins.
 *
 * @see docs:api/trace.md
 */
export function setTraceContextProvider(next: TraceContextProvider | null): void {
  provider = next;
}

/**
 * The ambient trace context, if there is one and it is usable.
 *
 * A provider that throws, or that answers with ids the W3C format cannot express, yields
 * `undefined` — a header is dropped rather than sent malformed. A peer that receives a broken
 * `traceparent` may reject the request outright, so "no header" is strictly the safer failure.
 */
export function currentOutgoingTraceContext(): OutgoingTraceContext | undefined {
  if (!provider) {
    return undefined;
  }

  let resolved: OutgoingTraceContext | null | undefined;

  try {
    resolved = provider();
  } catch {
    // A trace lookup must never break the request it is describing.
    return undefined;
  }

  if (!resolved || !isUsableTraceContext(resolved)) {
    return undefined;
  }

  return resolved;
}

/**
 * Can these ids be put on the wire?
 *
 * The all-zero ids are the spec's "invalid" sentinels: OpenTelemetry hands them out for
 * non-recording spans, so they arrive here routinely rather than as corruption, and a peer that
 * honoured them would join a trace that does not exist.
 */
export function isUsableTraceContext(traceContext: OutgoingTraceContext): boolean {
  return TRACE_ID_PATTERN.test(traceContext.traceId)
    && SPAN_ID_PATTERN.test(traceContext.spanId)
    && traceContext.traceId !== INVALID_TRACE_ID
    && traceContext.spanId !== INVALID_SPAN_ID;
}

/**
 * Render a W3C `traceparent` value: `00-<trace-id>-<parent-id>-<trace-flags>`.
 *
 * Assumes {@link isUsableTraceContext} already passed.
 *
 * @see docs:api/trace.md
 */
export function formatTraceparent(traceContext: OutgoingTraceContext): string {
  const flags = (traceContext.traceFlags ?? SAMPLED_FLAG)
    .toString(HEX_RADIX)
    .padStart(TRACE_FLAGS_HEX_LENGTH, '0')
    .slice(-TRACE_FLAGS_HEX_LENGTH);

  return `00-${traceContext.traceId}-${traceContext.spanId}-${flags}`;
}
