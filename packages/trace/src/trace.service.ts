import {
  trace,
  context,
  SpanKind,
  SpanStatusCode as OtelSpanStatusCode,
} from '@opentelemetry/api';
import {
  Effect,
  Layer,
  Context,
  FiberRef,
} from 'effect';

import { HttpStatusCode } from '@onebun/requests';

import {
  TraceContext,
  TraceSpan,
  TraceOptions,
  TraceHeaders,
  SpanStatus,
  SpanStatusCode,
  HttpTraceData,
} from './types.js';


/**
 * Index of trace flags in W3C traceparent header regex match array
 */
const TRACE_FLAGS_MATCH_INDEX = 3;


/**
 * Trace service interface
 */
export interface TraceService {
  /**
   * Get current trace context
   */
  getCurrentContext(): Effect.Effect<TraceContext | null>;

  /**
   * Set trace context
   */
  setContext(traceContext: TraceContext): Effect.Effect<void>;

  /**
   * Start a new span
   */
  startSpan(name: string, parentContext?: TraceContext): Effect.Effect<TraceSpan>;

  /**
   * End a span
   */
  endSpan(span: TraceSpan, status?: SpanStatus): Effect.Effect<void>;

  /**
   * Add event to current span
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): Effect.Effect<void>;

  /**
   * Set span attributes
   */
  setAttributes(attributes: Record<string, string | number | boolean>): Effect.Effect<void>;

  /**
   * Extract trace context from HTTP headers
   */
  extractFromHeaders(headers: TraceHeaders): Effect.Effect<TraceContext | null>;

  /**
   * Inject trace context into HTTP headers
   */
  injectIntoHeaders(traceContext: TraceContext): Effect.Effect<TraceHeaders>;

  /**
   * Generate new trace context
   */
  generateTraceContext(): Effect.Effect<TraceContext>;

  /**
   * Start HTTP request tracing
   */
  startHttpTrace(data: Partial<HttpTraceData>): Effect.Effect<TraceSpan>;

  /**
   * End HTTP request tracing
   */
  endHttpTrace(span: TraceSpan, data: Partial<HttpTraceData>): Effect.Effect<void>;
}

/**
 * Trace service tag for Effect dependency injection
 */
export const traceService = Context.GenericTag<TraceService>('@onebun/trace/TraceService');

/**
 * Current trace context stored in fiber
 */
export const currentTraceContext = FiberRef.unsafeMake<TraceContext | null>(null);

/**
 * Current span stored in fiber
 */

export const currentSpan = FiberRef.unsafeMake<TraceSpan | null>(null);

/**
 * Implementation of TraceService
 */
export class TraceServiceImpl implements TraceService {
  private readonly tracer = trace.getTracer('@onebun/trace');
  private readonly options: Required<TraceOptions>;

  constructor(options: TraceOptions = {}) {
    this.options = {
      enabled: true,
      serviceName: 'onebun-service',
      serviceVersion: '1.0.0',
      samplingRate: 1.0,
      traceHttpRequests: true,
      traceDatabaseQueries: true,
      defaultAttributes: {},
      exportOptions: {},
      ...options,
    };
  }

  getCurrentContext(): Effect.Effect<TraceContext | null> {
    return FiberRef.get(currentTraceContext);
  }

  setContext(traceContext: TraceContext): Effect.Effect<void> {
    return FiberRef.set(currentTraceContext, traceContext);
  }

  startSpan(name: string, parentContext?: TraceContext): Effect.Effect<TraceSpan> {
    if (!this.options.enabled) {
      return Effect.flatMap(
        this.generateTraceContext(),
        // eslint-disable-next-line @typescript-eslint/no-shadow
        (context) => {
          const mockSpan: TraceSpan = {
            context,
            name,
            startTime: Date.now(),
            attributes: {},
            events: [],
            status: { code: SpanStatusCode.OK },
          };

          return Effect.flatMap(
            FiberRef.set(currentSpan, mockSpan),
            () => Effect.succeed(mockSpan),
          );
        },
      );
    }

    const currentContext = context.active();
    const span = this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes: this.options.defaultAttributes,
    }, currentContext);

    const spanContext = span.spanContext();
    const traceContext: TraceContext = {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      parentSpanId: parentContext?.spanId,
    };

    const traceSpan: TraceSpan = {
      context: traceContext,
      name,
      startTime: Date.now(),
      attributes: { ...this.options.defaultAttributes },
      events: [],
      status: { code: SpanStatusCode.OK },
    };

    return Effect.flatMap(
      FiberRef.set(currentSpan, traceSpan),
      () => Effect.flatMap(
        this.setContext(traceContext),
        () => Effect.succeed(traceSpan),
      ),
    );
  }

  endSpan(span: TraceSpan, status?: SpanStatus): Effect.Effect<void> {
    if (!this.options.enabled) {
      return Effect.void;
    }

    span.endTime = Date.now();
    if (status) {
      span.status = status;
    }

    // Find the OTel span and end it
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && activeSpan.spanContext().spanId === span.context.spanId) {
      if (status?.code === SpanStatusCode.ERROR) {
        activeSpan.setStatus({
          code: OtelSpanStatusCode.ERROR,
          message: status.message,
        });
      }
      activeSpan.end();
    }

    return FiberRef.set(currentSpan, null);
  }

  addEvent(name: string, attributes?: Record<string, string | number | boolean>): Effect.Effect<void> {
    if (!this.options.enabled) {
      return Effect.void;
    }

    return Effect.flatMap(
      FiberRef.get(currentSpan),
      (span) => {
        if (span) {
          span.events.push({
            name,
            timestamp: Date.now(),
            attributes,
          });

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.addEvent(name, attributes);
          }
        }

        return Effect.void;
      },
    );
  }

  setAttributes(attributes: Record<string, string | number | boolean>): Effect.Effect<void> {
    if (!this.options.enabled) {
      return Effect.void;
    }

    return Effect.flatMap(
      FiberRef.get(currentSpan),
      (span) => {
        if (span) {
          Object.assign(span.attributes, attributes);

          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            activeSpan.setAttributes(attributes);
          }
        }

        return Effect.void;
      },
    );
  }

  extractFromHeaders(headers: TraceHeaders): Effect.Effect<TraceContext | null> {
    if (!this.options.enabled) {
      return Effect.succeed(null);
    }

    // Try W3C traceparent header first
    const TRACE_ID_LENGTH = 32;
    const SPAN_ID_LENGTH = 16;
    const FLAGS_LENGTH = 2;
    const HEX_BASE = 16;
    const traceparent = headers['traceparent'];
    if (traceparent) {
      const match = traceparent.match(new RegExp(`^00-([0-9a-f]{${TRACE_ID_LENGTH}})-([0-9a-f]{${SPAN_ID_LENGTH}})-([0-9a-f]{${FLAGS_LENGTH}})$`));
      if (match) {

        return Effect.succeed({
          traceId: match[1],
          spanId: match[2],
          traceFlags: parseInt(match[TRACE_FLAGS_MATCH_INDEX], HEX_BASE),
        });
      }
    }

    // Fallback to custom headers
    const traceId = headers['x-trace-id'];
    const spanId = headers['x-span-id'];

    if (traceId && spanId) {
      return Effect.succeed({
        traceId,
        spanId,
        traceFlags: 1,
      });
    }

    return Effect.succeed(null);
  }

  injectIntoHeaders(traceContext: TraceContext): Effect.Effect<TraceHeaders> {
    const HEX_BASE = 16;
    const PAD_LENGTH = 2;

    return Effect.succeed({
      traceparent: `00-${traceContext.traceId}-${traceContext.spanId}-${traceContext.traceFlags.toString(HEX_BASE).padStart(PAD_LENGTH, '0')}`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-trace-id': traceContext.traceId,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-span-id': traceContext.spanId,
    });
  }

  generateTraceContext(): Effect.Effect<TraceContext> {
    const TRACE_ID_LENGTH = 32;
    const SPAN_ID_LENGTH = 16;

    return Effect.succeed({
      traceId: this.generateId(TRACE_ID_LENGTH),
      spanId: this.generateId(SPAN_ID_LENGTH),
      traceFlags: Math.random() < this.options.samplingRate ? 1 : 0,
    });
  }

  startHttpTrace(data: Partial<HttpTraceData>): Effect.Effect<TraceSpan> {
    const spanName = `HTTP ${data.method || 'REQUEST'} ${data.route || data.url || '/'}`;

    return Effect.flatMap(
      this.startSpan(spanName),
      (span) => {
        const attributes: Record<string, string | number | boolean> = {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'http.method': data.method || 'UNKNOWN',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'http.url': data.url || '',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'http.route': data.route || '',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'http.user_agent': data.userAgent || '',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'http.remote_addr': data.remoteAddr || '',
        };

        if (data.requestSize !== undefined) {
          attributes['http.request_content_length'] = data.requestSize;
        }

        return Effect.flatMap(
          this.setAttributes(attributes),
          () => Effect.succeed(span),
        );
      },
    );
  }

  endHttpTrace(span: TraceSpan, data: Partial<HttpTraceData>): Effect.Effect<void> {
    const attributes: Record<string, string | number | boolean> = {};

    if (data.statusCode !== undefined) {
      attributes['http.status_code'] = data.statusCode;
    }

    if (data.responseSize !== undefined) {
      attributes['http.response_content_length'] = data.responseSize;
    }

    if (data.duration !== undefined) {
      attributes['http.duration'] = data.duration;
    }

    const HTTP_ERROR_THRESHOLD = HttpStatusCode.BAD_REQUEST;
    const status: SpanStatus = {
      code: (data.statusCode && data.statusCode >= HTTP_ERROR_THRESHOLD) ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      message: data.statusCode && data.statusCode >= HTTP_ERROR_THRESHOLD ? `HTTP ${data.statusCode}` : undefined,
    };

    return Effect.flatMap(
      this.setAttributes(attributes),
      () => this.endSpan(span, status),
    );
  }

  private generateId(length: number): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }

    return result;
  }
}

/**
 * Create TraceService layer
 */
export const makeTraceService = (options?: TraceOptions): Layer.Layer<TraceService> =>
  Layer.succeed(traceService, new TraceServiceImpl(options));

/**
 * Default trace service layer
 */
export const traceServiceLive = makeTraceService();

// Backward compatibility aliases
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TraceService = traceService;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TraceServiceLive = traceServiceLive;
