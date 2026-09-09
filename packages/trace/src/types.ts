import type { Span as OtelSpan } from '@opentelemetry/api';

/**
 * Where a `TraceSpan` keeps the OpenTelemetry span it was started from.
 *
 * The OTel span used to be created and then dropped, with `endHttpTraceSync` trying to recover it
 * through `trace.getActiveSpan()` — which is `undefined`, because nothing ever makes the span
 * active. So `.end()` never ran, `BatchSpanProcessor.onEnd` never fired, and the collector stayed
 * empty however it was configured. The span object survives the whole request already; carrying
 * the OTel span on it means ending never depends on ambient state.
 *
 * A SYMBOL key, not a field. `JSON.stringify` and `Object.keys` skip own symbol properties, so a
 * user logging a span cannot serialize the live span graph — which reaches the
 * `BatchSpanProcessor` and through it the exporter's `Authorization` header. `Symbol.for` matches
 * this package's existing convention and survives a duplicated copy of the package.
 *
 * @see docs:api/trace.md
 */
export const OTEL_SPAN: unique symbol = Symbol.for('onebun:trace:otelSpan');

/**
 * Trace context interface
 */
export interface TraceContext {
  /**
   * Trace ID
   */
  traceId: string;

  /**
   * Span ID
   */
  spanId: string;

  /**
   * Parent span ID
   */
  parentSpanId?: string;

  /**
   * Trace flags
   */
  traceFlags: number;

  /**
   * Baggage items
   */
  baggage?: Record<string, string>;
}

/**
 * Span interface
 */
export interface TraceSpan {
  /**
   * Span context
   */
  context: TraceContext;

  /**
   * Span name
   */
  name: string;

  /**
   * Start time
   */
  startTime: number;

  /**
   * End time
   */
  endTime?: number;

  /**
   * Span attributes
   */
  attributes: Record<string, string | number | boolean>;

  /**
   * Span events
   */
  events: TraceEvent[];

  /**
   * Span status
   */
  status: SpanStatus;

  /**
   * The OpenTelemetry span this was started from, when one was created.
   *
   * Present only when an exporter is configured — without one no OTel span is built and the
   * lightweight path generates ids directly. Cleared once the span has been ended, which is what
   * makes a second end a no-op rather than a lie.
   */
  [OTEL_SPAN]?: OtelSpan;
}

/**
 * Span event interface
 */
export interface TraceEvent {
  /**
   * Event name
   */
  name: string;

  /**
   * Event timestamp
   */
  timestamp: number;

  /**
   * Event attributes
   */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Span status
 */
export interface SpanStatus {
  /**
   * Status code
   */
  code: SpanStatusCode;

  /**
   * Status message
   */
  message?: string;
}

/**
 * Span status codes
 */
export enum SpanStatusCode {
  /**
   * The operation completed successfully.
   */
  OK = 1,

  /**
   * An error occurred.
   */
  ERROR = 2,
}

/**
 * HTTP trace headers
 */
export interface TraceHeaders {
  /**
   * Trace parent header (W3C)
   */
  traceparent?: string;

  /**
   * Trace state header (W3C)
   */
  tracestate?: string;

  /**
   * X-Trace-Id header (custom)
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'x-trace-id'?: string;

  /**
   * X-Span-Id header (custom)
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'x-span-id'?: string;
}

/**
 * Trace options configuration
 */
export interface TraceOptions {
  /**
   * Enable/disable tracing
   * @defaultValue true
   */
  enabled?: boolean;

  /**
   * Service name for tracing
   */
  serviceName?: string;

  /**
   * Service version
   */
  serviceVersion?: string;

  /**
   * Sampling rate (0.0 to 1.0)
   * @defaultValue 1.0
   */
  samplingRate?: number;

  /**
   * Enable automatic HTTP request tracing
   * @defaultValue true
   */
  traceHttpRequests?: boolean;

  /**
   * Enable automatic database query tracing
   * @defaultValue true
   */
  traceDatabaseQueries?: boolean;

  /**
   * Custom attributes to add to all spans
   */
  defaultAttributes?: Record<string, string | number | boolean>;

  /**
   * Export traces to external system
   */
  exportOptions?: TraceExportOptions;

  /**
   * Extra span processors for THIS application's provider, appended to whatever
   * `exportOptions` produces.
   *
   * OpenTelemetry keeps one tracer provider per process and refuses a duplicate, so in a
   * process running several applications only the first installs its own globally. Every
   * application's spans are created from its OWN provider, which means a processor registered
   * on the process-global provider does not see them — this is how to observe or export the
   * spans of a specific application, and how a test captures them without going through the
   * global.
   *
   * Typed as `unknown[]` so `TraceOptions` stays importable without the OpenTelemetry SDK in
   * scope; the values must be `SpanProcessor`s from `@opentelemetry/sdk-trace-base`.
   *
   * @see docs:api/trace.md
   */
  spanProcessors?: unknown[];
}

/**
 * Trace export options
 */
export interface TraceExportOptions {
  /**
   * Export endpoint URL
   */
  endpoint?: string;

  /**
   * Export headers
   */
  headers?: Record<string, string>;

  /**
   * Export timeout in milliseconds
   * @defaultValue 10000
   */
  timeout?: number;

  /**
   * Batch size for exporting
   * @defaultValue 100
   */
  batchSize?: number;

  /**
   * Batch timeout in milliseconds
   * @defaultValue 5000
   */
  batchTimeout?: number;

  /**
   * Retries after the first attempt when an export fails.
   *
   * `BatchSpanProcessor` splices a batch out of its buffer before handing it to the exporter,
   * so a batch the exporter gives up on is gone — there is no second chance and no queue to
   * put it back on. Retrying here is the only thing standing between a collector redeploy and
   * a hole in the traces.
   *
   * Set to `0` to restore at-most-once delivery.
   *
   * @defaultValue 3
   */
  retryAttempts?: number;

  /**
   * Delay in milliseconds before the first retry. Doubles on each subsequent retry, capped at
   * 5000ms. A `Retry-After` header from the collector overrides it.
   *
   * @defaultValue 200
   */
  retryDelay?: number;

  /**
   * Ceiling on the total wall time one batch may spend being exported, retries and waits
   * included. Retrying stops once the next attempt would cross it.
   *
   * This is what keeps a dead collector from holding shutdown open: the final flush is a
   * normal export and obeys the same budget.
   *
   * @defaultValue 10000
   */
  retryBudget?: number;

  /**
   * Called once for a batch that was given up on, with the failure, the number of spans lost
   * and how many attempts were made.
   *
   * `OneBunApplication` wires this to its own logger when you do not, because an export that
   * fails without a word is the defect this option exists to prevent.
   */
  onExportFailure?: (error: Error, spanCount: number, attempts: number) => void;
}

/**
 * HTTP request trace data
 */
export interface HttpTraceData {
  method: string;
  url: string;
  route?: string;
  statusCode?: number;
  userAgent?: string;
  remoteAddr?: string;
  requestSize?: number;
  responseSize?: number;
  duration?: number;

  /**
   * The caller's trace, extracted from the inbound headers, when there is one.
   *
   * Makes the request's span a child of the caller's rather than the root of a new trace, which
   * is the difference between one distributed trace and one per service. Omitted — or carrying
   * ids the W3C format cannot express — starts a fresh trace, because a span parented to garbage
   * is worse than a span parented to nothing.
   */
  parentContext?: TraceContext;
}
