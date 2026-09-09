import {
  context,
  type Context as OtelContext,
  type Span as OtelSpan,
  SpanStatusCode as OtelSpanStatusCode,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  type Tracer,
} from '@opentelemetry/api';
import {
  Context,
  Effect,
  FiberRef,
  Layer,
} from 'effect';

import { HttpStatusCode } from '@onebun/requests';

import { activateSpanInCurrentScope } from './context-manager.js';
import {
  initTracerProvider,
  installedTracerProvider,
  type TracerProviderResult,
} from './provider.js';
import {
  type HttpTraceData,
  OTEL_SPAN,
  type SpanStatus,
  SpanStatusCode,
  type TraceContext,
  type TraceHeaders,
  type TraceOptions,
  type TraceSpan,
} from './types.js';

/**
 * Index of trace flags in W3C traceparent header regex match array
 */
const TRACE_FLAGS_MATCH_INDEX = 3;

/**
 * Pre-compiled W3C traceparent header regex (avoids re-compilation per request)
 */
const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Turn a caller's trace context into an OpenTelemetry context a span can be started from.
 *
 * `isRemote: true` so the SDK knows the parent lives in another process — `ParentBasedSampler`
 * reads it, and so do backends deciding where a trace begins.
 *
 * The ids are deliberately NOT re-validated here. Only the `traceparent` branch of
 * `extractFromHeadersSync` is regex-checked; the `x-trace-id` / `x-span-id` pair is taken verbatim
 * from headers anyone can set, and the all-zero ids are the spec's "invalid" sentinels that
 * OpenTelemetry hands out routinely for non-recording spans. All of them arrive here — and
 * `Tracer.startSpan` already discards a parent that fails `isSpanContextValid`, producing a root
 * span, which is exactly the wanted outcome. A check here would be a second copy of that rule with
 * no test able to tell the two apart. The behaviour is pinned instead, in `context-nesting.test.ts`.
 */
function remoteParentContext(parent: TraceContext | undefined): OtelContext | undefined {
  if (!parent) {
    return undefined;
  }

  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: parent.traceId,
    spanId: parent.spanId,
    traceFlags: parent.traceFlags,
    isRemote: true,
  });
}

/**
 * Trace service interface
 *
 * @see docs:api/trace.md
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
  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): Effect.Effect<void>;

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

  /**
   * Shutdown the trace service, flushing pending spans
   */
  shutdown(): Promise<void>;

  // --- Sync hot-path methods (avoid Effect.runPromise overhead) ---

  /**
   * Extract trace context from HTTP headers (sync, for hot path)
   */
  extractFromHeadersSync(headers: TraceHeaders): TraceContext | null;

  /**
   * Generate new trace context (sync, for hot path)
   */
  generateTraceContextSync(): TraceContext;

  /**
   * Start HTTP request tracing (sync, for hot path)
   */
  startHttpTraceSync(data: Partial<HttpTraceData>): TraceSpan;

  /**
   * End HTTP request tracing (sync, for hot path)
   */
  endHttpTraceSync(span: TraceSpan, data: Partial<HttpTraceData>): void;
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
  private readonly tracer;
  private readonly options: Required<TraceOptions>;
  private readonly providerResult: TracerProviderResult | null = null;
  private readonly hasExporter: boolean;
  private readonly hasDefaultAttributes: boolean;

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
      spanProcessors: [],
      ...options,
    };

    // "Does this application record spans anywhere", which is the question the OTel path
    // actually depends on — not "is an OTLP endpoint configured".
    //
    // `enabled` and not the endpoint alone: derived from the endpoint by itself, a service built
    // with `{ enabled: false, exportOptions: { endpoint } }` starts spans that
    // `endHttpTraceSync` — which returns early when disabled — never ends.
    //
    // And `spanProcessors` counts: a caller that attached its own processor wants real spans
    // even with no OTLP endpoint, and gating on the endpoint would hand it the lightweight
    // path and nothing to observe.
    this.hasExporter = this.options.enabled
      && (!!this.options.exportOptions?.endpoint || this.options.spanProcessors.length > 0);
    this.hasDefaultAttributes = Object.keys(this.options.defaultAttributes).length > 0;

    // Initialize TracerProvider BEFORE creating the tracer
    // so trace.getTracer() returns a real tracer, not NoopTracer
    if (this.options.enabled) {
      this.providerResult = initTracerProvider(this.options);
    }

    // THIS application's provider, not the process-global one. OpenTelemetry keeps a single
    // tracer provider per process and refuses a duplicate registration, so in a process running
    // several applications only the first installs its own. Reading the global here is what
    // made every later application's provider dead weight: it was built with that
    // application's `service.name` resource and its own OTLP exporter, and then never used —
    // its spans went to the FIRST application's collector, labelled as the first
    // application's service. Measured with `serviceName: 'users'` and `'orders'`: each own
    // provider reports its own name, the global reports 'users' for both.
    //
    // The global registration in `initTracerProvider` stays, as a best-effort answer for
    // third-party instrumentation that resolves through `trace.getTracer()` on its own.
    this.tracer = this.providerResult?.provider.getTracer('@onebun/trace')
      ?? trace.getTracer('@onebun/trace');
  }

  /**
   * The tracer this application's spans are created from.
   *
   * Exposed so the framework can establish it as the ambient owner at each boundary where work
   * enters the application — see `appTracer()` in `app-tracer.ts`, which is what the
   * decoration-time wrappers (`@Traced`, `@Span`, auto-trace) resolve through. Those are
   * installed on a prototype before any application exists and cannot capture one.
   *
   * @see docs:api/trace.md
   */
  getTracer(): Tracer {
    return this.tracer;
  }

  /**
   * Is this application's provider the one installed in the process-global slot?
   *
   * `false` for every application but the first, which is exactly when resolving through the
   * global gives the wrong answer and the ambient owner has to be established instead.
   *
   * @see docs:api/trace.md
   */
  ownsInstalledProvider(): boolean {
    return this.providerResult !== null
      && installedTracerProvider() === this.providerResult.provider;
  }

  async shutdown(): Promise<void> {
    if (this.providerResult) {
      await this.providerResult.shutdown();
    }
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

          return Effect.flatMap(FiberRef.set(currentSpan, mockSpan), () =>
            Effect.succeed(mockSpan),
          );
        },
      );
    }

    const currentContext = context.active();
    const span = this.tracer.startSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        attributes: this.options.defaultAttributes,
      },
      currentContext,
    );

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

    return Effect.flatMap(FiberRef.set(currentSpan, traceSpan), () =>
      Effect.flatMap(this.setContext(traceContext), () => Effect.succeed(traceSpan)),
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

  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): Effect.Effect<void> {
    if (!this.options.enabled) {
      return Effect.void;
    }

    return Effect.flatMap(FiberRef.get(currentSpan), (span) => {
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
    });
  }

  setAttributes(attributes: Record<string, string | number | boolean>): Effect.Effect<void> {
    if (!this.options.enabled) {
      return Effect.void;
    }

    return Effect.flatMap(FiberRef.get(currentSpan), (span) => {
      if (span) {
        Object.assign(span.attributes, attributes);

        const activeSpan = trace.getActiveSpan();
        if (activeSpan) {
          activeSpan.setAttributes(attributes);
        }
      }

      return Effect.void;
    });
  }

  extractFromHeaders(headers: TraceHeaders): Effect.Effect<TraceContext | null> {
    return Effect.succeed(this.extractFromHeadersSync(headers));
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

    return Effect.flatMap(this.startSpan(spanName), (span) => {
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

      return Effect.flatMap(this.setAttributes(attributes), () => Effect.succeed(span));
    });
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
      code:
        data.statusCode && data.statusCode >= HTTP_ERROR_THRESHOLD
          ? SpanStatusCode.ERROR
          : SpanStatusCode.OK,
      message:
        data.statusCode && data.statusCode >= HTTP_ERROR_THRESHOLD
          ? `HTTP ${data.statusCode}`
          : undefined,
    };

    return Effect.flatMap(this.setAttributes(attributes), () => this.endSpan(span, status));
  }

  // --- Sync hot-path implementations ---

  extractFromHeadersSync(headers: TraceHeaders): TraceContext | null {
    if (!this.options.enabled) {
      return null;
    }

    const HEX_BASE = 16;
    const traceparent = headers['traceparent'];
    if (traceparent) {
      const match = traceparent.match(TRACEPARENT_REGEX);
      if (match) {
        return {
          traceId: match[1],
          spanId: match[2],
          traceFlags: parseInt(match[TRACE_FLAGS_MATCH_INDEX], HEX_BASE),
        };
      }
    }

    const traceId = headers['x-trace-id'];
    const spanId = headers['x-span-id'];

    if (traceId && spanId) {
      return { traceId, spanId, traceFlags: 1 };
    }

    return null;
  }

  generateTraceContextSync(): TraceContext {
    const TRACE_ID_LENGTH = 32;
    const SPAN_ID_LENGTH = 16;

    return {
      traceId: this.generateId(TRACE_ID_LENGTH),
      spanId: this.generateId(SPAN_ID_LENGTH),
      traceFlags: Math.random() < this.options.samplingRate ? 1 : 0,
    };
  }

  startHttpTraceSync(data: Partial<HttpTraceData>): TraceSpan {
    const spanName = `HTTP ${data.method || 'REQUEST'} ${data.route || data.url || '/'}`;

    let traceContext: TraceContext;
    let startedOtelSpan: OtelSpan | undefined;
    let httpAttributes: Record<string, string | number | boolean> = {};

    if (this.hasExporter) {
      // Full OTel span path — only when spans will be exported.
      //
      // The caller's context when the inbound headers carried one, so the span continues that
      // trace instead of starting its own. `context.active()` cannot supply it: the request
      // boundary re-roots to ROOT_CONTEXT deliberately (a keep-alive connection would otherwise
      // chain request N+1 under request N), so a remote parent has to be handed in.
      const currentOtelContext = remoteParentContext(data.parentContext) ?? context.active();
      const otelSpan = this.tracer.startSpan(
        spanName,
        {
          kind: SpanKind.INTERNAL,
          attributes: this.options.defaultAttributes,
        },
        currentOtelContext,
      );

      const spanCtx = otelSpan.spanContext();
      traceContext = {
        traceId: spanCtx.traceId,
        spanId: spanCtx.spanId,
        traceFlags: spanCtx.traceFlags,
      };

      startedOtelSpan = otelSpan;

      // Recorded on the OneBun span, not written to OTel here. `finishOtelSpan` is the single
      // place attributes reach OpenTelemetry, so the two records cannot disagree and nothing can
      // be written twice. Writing here as well used to leave `TraceSpan.attributes` holding only
      // the defaults — a record that claimed less than the span it described.
      httpAttributes = {
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
        httpAttributes['http.request_content_length'] = data.requestSize;
      }
    } else {
      // Lightweight path — no OTel span creation, just context propagation
      traceContext = this.generateTraceContextSync();
    }

    return {
      context: traceContext,
      name: spanName,
      startTime: Date.now(),
      attributes: {
        ...(this.hasDefaultAttributes ? this.options.defaultAttributes : {}),
        ...httpAttributes,
      },
      events: [],
      status: { code: SpanStatusCode.OK },
      // Carried, not dropped. Undefined on the lightweight path, which is what makes the end a
      // no-op there without consulting instance configuration.
      [OTEL_SPAN]: startedOtelSpan,
    };
  }

  /**
   * Make an HTTP span the parent of everything the request goes on to do.
   *
   * Separate from `startHttpTraceSync` because the caller enters the request's context scope
   * before the span exists — see `ContextScope` in `context-manager.ts` for why that order is
   * the cheap one. Returns whether the span became active; `false` means spans from this request
   * will arrive as separate roots, which is what happens when the context-manager slot belongs to
   * someone else's SDK.
   *
   * @see docs:api/trace.md
   */
  activateSpanSync(span: TraceSpan): boolean {
    const otelSpan = span[OTEL_SPAN];

    return otelSpan === undefined ? false : activateSpanInCurrentScope(otelSpan);
  }

  endHttpTraceSync(span: TraceSpan, data: Partial<HttpTraceData>): void {
    if (!this.options.enabled) {
      return;
    }

    span.endTime = Date.now();

    const HTTP_ERROR_THRESHOLD = HttpStatusCode.BAD_REQUEST;
    if (data.statusCode && data.statusCode >= HTTP_ERROR_THRESHOLD) {
      span.status = { code: SpanStatusCode.ERROR, message: `HTTP ${data.statusCode}` };
    }

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

    Object.assign(span.attributes, attributes);

    // Gated on the SPAN's own provenance, not on `this.hasExporter`. A span is finished the way
    // it was started, so a service whose configuration is read at a different time from the start
    // cannot orphan it — and that asymmetry is where this bug lived.
    this.finishOtelSpan(span);
  }

  /**
   * Flush a OneBun span onto the OpenTelemetry span it was started from, and end it.
   *
   * The ONLY place `.end()` is called. Everything the request accumulated — attributes set at
   * start and at end, events pushed by the framework or by user code, the error status — reaches
   * OpenTelemetry here and nowhere else, so the exported span cannot disagree with the record and
   * nothing can be written twice.
   *
   * Idempotent by clearing the carried span: a second end is a no-op rather than a second,
   * contradictory export of the same span.
   */
  private finishOtelSpan(span: TraceSpan): void {
    const otelSpan = span[OTEL_SPAN];

    if (!otelSpan) {
      return;
    }

    span[OTEL_SPAN] = undefined;

    otelSpan.setAttributes(span.attributes);

    for (const event of span.events) {
      otelSpan.addEvent(event.name, event.attributes, event.timestamp);
    }

    if (span.status.code === SpanStatusCode.ERROR) {
      otelSpan.setStatus({ code: OtelSpanStatusCode.ERROR, message: span.status.message });
    }

    otelSpan.end();
  }

  private generateId(length: number): string {
    const bytes = new Uint8Array(length / 2);
    crypto.getRandomValues(bytes);

    return Buffer.from(bytes).toString('hex');
  }
}

/**
 * Create TraceService layer
 *
 * @see docs:api/trace.md
 */
export const makeTraceService = (options?: TraceOptions): Layer.Layer<TraceService> =>
  // `Layer.sync`, not `Layer.succeed`. `succeed` evaluates its argument at CALL time, so merely
  // writing `makeTraceService({…})` — never mind building the layer — constructed a service, which
  // registers a TracerProvider as the OpenTelemetry global. At module scope that made it an IMPORT
  // side effect: importing the package claimed the global with a provider carrying no span
  // processors, and the application's own exporter-carrying provider was then refused as a
  // duplicate. OTel reports that refusal only on its `diag` channel, which nothing here listens
  // to, so the application logged "Trace service initialized successfully" and exported nothing.
  Layer.sync(traceService, () => new TraceServiceImpl(options));

/**
 * The one service the default layer yields.
 *
 * Memoized because `Layer.sync` runs its thunk on every build, and each run would register another
 * provider. One default layer, one service, one registration, however many times it is provided.
 */
let defaultTraceService: TraceServiceImpl | undefined;

/**
 * Default trace service layer
 */
export const traceServiceLive: Layer.Layer<TraceService> = Layer.sync(traceService, () => {
  defaultTraceService ??= new TraceServiceImpl();

  return defaultTraceService;
});

// Backward compatibility aliases
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TraceService = traceService;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const TraceServiceLive = traceServiceLive;
