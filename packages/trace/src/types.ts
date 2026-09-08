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
}
