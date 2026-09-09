import type { TraceInfo } from '../request-context';
import type { MessageMetadata, PublishOptions } from './types';

import { getCurrentTraceContext } from '../request-context';


/**
 * A trace id set by hand, with no flags, is read as sampled.
 *
 * The same reading `extractFromHeadersSync` gives an `x-trace-id`/`x-span-id` header pair that
 * arrives without a `traceparent`. Consistency matters more here than either default is worth on
 * its own: a producer who states a trace id and nothing else means "this belongs to that trace",
 * and answering "unsampled" would quietly drop it.
 */
const SAMPLED = 1;

/**
 * Stamp the publishing side's trace onto a message, so the consumer can join it.
 *
 * Nothing wrote `metadata.traceId` before this. The field was declared, documented, and read by
 * `MessageTraceGuard` — which therefore refused every message ever published, since the value it
 * required could only be set by hand at every call site.
 *
 * The source is `getCurrentTraceContext()`, which since the boundary spans landed answers inside
 * an HTTP request, a `@Traced` method, a queue handler, a scheduler tick and a WebSocket handler.
 * A publish from any of those carries that unit of work as the cause.
 *
 * **An explicit `traceId` is never overwritten.** A caller relaying a message on behalf of
 * something else is stating the causal trace, and the ambient one is not it.
 *
 * **No ambient trace means no ids, and that is deliberate.** Minting one here would put an id in
 * the message that names no span — the defect this framework spent WI-355 removing from its own
 * log lines. A publish from `onModuleInit` genuinely has no trace to join, and `MessageTraceGuard`
 * refusing it is the guard doing its stated job rather than the silent drop it used to be.
 *
 * @see docs:api/queue.md
 */
export function withTraceMetadata(options?: PublishOptions): PublishOptions | undefined {
  if (options?.metadata?.traceId !== undefined) {
    return options;
  }

  const current = getCurrentTraceContext();

  if (!current) {
    return options;
  }

  const metadata: MessageMetadata = {
    ...options?.metadata,
    traceId: current.traceId,
    spanId: current.spanId,
    traceFlags: current.traceFlags ?? SAMPLED,
  };

  if (current.parentSpanId !== undefined) {
    metadata.parentSpanId = current.parentSpanId;
  }

  return { ...options, metadata };
}

/**
 * The trace a delivered message was published in, as a parent for the delivery's own span.
 *
 * Read, never written back. The in-memory adapter hands the SAME metadata object to every
 * subscription on a pattern and again on every retry, so stamping the consumer's own ids onto it
 * would rewrite the provenance the next subscriber is about to read.
 *
 * Both ids are required: a trace id with no span id names a trace but no point inside it, which
 * is not a parent. Well-formedness is left to `Tracer.startSpan`, which discards a parent that
 * fails `isSpanContextValid` and roots the span instead.
 *
 * @see docs:api/queue.md
 */
export function publisherTraceContext(metadata: MessageMetadata | undefined): TraceInfo | undefined {
  if (metadata?.traceId === undefined || metadata.spanId === undefined) {
    return undefined;
  }

  return {
    traceId: metadata.traceId,
    spanId: metadata.spanId,
    traceFlags: metadata.traceFlags ?? SAMPLED,
  };
}
