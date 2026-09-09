/**
 * Behaviour coverage for the snippets of docs/api/trace.md that the compile gate typechecks but
 * no test exercises: enabling tracing on an application, `this.span`, reading the current trace
 * context, propagating it to an outgoing call, manual span creation, and the complete example.
 *
 * Note for the xref scanner: `scripts/docs-xref.ts` only reads files named `docs-examples.test.ts`,
 * so the `@source` tags below are not counted as coverage until the scanner learns this name. The
 * package's existing `docs-examples.test.ts` is untouched.
 *
 * Most recipes on this page configure a whole application, so these tests import `@onebun/core`.
 * It cannot be a dependency of `@onebun/trace` — core depends on trace, so the entry would be a
 * cycle — hence the disable below; the package is resolved through the root tsconfig paths.
 */

/* eslint-disable import/no-extraneous-dependencies */

import { AsyncLocalStorage } from 'node:async_hooks';

import {
  context as otelContext,
  SpanStatusCode as OtelSpanStatusCode,
  ROOT_CONTEXT,
  trace as otelTrace,
} from '@opentelemetry/api';
import { BasicTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import type { Context as OtelContextType, ContextManager } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import {
  BaseController,
  BaseService,
  Body,
  Controller,
  createHttpClient,
  Get,
  getCurrentTraceContext,
  Module,
  OneBunApplication,
  Param,
  Post,
  Service,
} from '@onebun/core';

import { makeMockLoggerLayer } from '../../core/src/testing';
import {
  Span,
  Traced,
  TraceServiceImpl,
  type TraceSpan,
} from '../src';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_SERVER_ERROR = 500;
const SAMPLED_FLAG = 1;
const TRACE_ID_HEX_LENGTH = 32;
const W3C_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const W3C_SPAN_ID = '00f067aa0ba902b7';
const W3C_TRACEPARENT = `00-${W3C_TRACE_ID}-${W3C_SPAN_ID}-01`;
/** `00-` plus the 32-character trace id — the part of a traceparent that must match. */
const W3C_TRACEPARENT_PREFIX_LENGTH = 35;

/** The two process-wide slots the documented recipes read. */
type TraceGlobals = typeof globalThis & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  __onebunTraceService?: TraceServiceImpl;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  __onebunCurrentTraceContext?: { traceId: string };
};

const traceGlobals = globalThis as TraceGlobals;

interface Envelope<T> {
  success: boolean;
  result: T;
}

interface SeenTraceContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
}

/**
 * OpenTelemetry's own AsyncLocalStorage context manager, inlined.
 *
 * OneBun installs its own manager (`packages/trace/src/context-manager.ts`) when an application
 * starts tracing. This one exists for the tests that exercise `this.span` WITHOUT an application:
 * a bare class and a hand-rolled span have nobody to install a manager for them, and without one
 * `context.active()` is the noop manager and `trace.getActiveSpan()` can never see the span
 * `startActiveSpan` opened.
 *
 * Deliberately a foreign implementation rather than OneBun's: a test that reached for the
 * framework's own manager would prove the framework agrees with itself.
 */
class TestAsyncLocalStorageContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<OtelContextType>();

  active(): OtelContextType {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    activeContext: OtelContextType,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(activeContext, () => fn.call(thisArg as ThisParameterType<F>, ...args));
  }

  bind<T>(_activeContext: OtelContextType, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  // No `storage.disable()`: tearing down an AsyncLocalStorage under code that is inside it
  // breaks async continuation process-wide, and every later async test simply hangs.
  disable(): this {
    return this;
  }
}

let recorded: ReadableSpan[];
let tracerProvider: BasicTracerProvider;
let savedTraceService: TraceServiceImpl | undefined;

/**
 * A processor that only remembers, attached to the APPLICATION's provider.
 *
 * Every application's spans are created from its OWN provider, so a processor on the
 * process-global one sees none of them. The array is the test's own rather than an
 * `InMemorySpanExporter` because these cases assert after `app.stop()`, and stopping the
 * application shuts its provider down, which shuts an exporter down, which clears what it
 * collected.
 */
function recordingProcessor(): SpanProcessor {
  return {
    onStart: () => undefined,
    onEnd(ended: ReadableSpan) {
      recorded.push(ended);
    },
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
  };
}

beforeEach(() => {
  // A provider left registered by another test would make registration a silent no-op, and the
  // application registers one of its own in its constructor.
  otelTrace.disable();
  recorded = [];
  tracerProvider = new BasicTracerProvider({
    spanProcessors: [recordingProcessor()],
  });
  otelTrace.setGlobalTracerProvider(tracerProvider);

  savedTraceService = traceGlobals.__onebunTraceService;
  delete traceGlobals.__onebunTraceService;
  delete traceGlobals.__onebunCurrentTraceContext;
});

afterEach(async () => {
  await tracerProvider.shutdown();
  otelTrace.disable();
  otelContext.disable();

  delete traceGlobals.__onebunCurrentTraceContext;
  if (savedTraceService) {
    traceGlobals.__onebunTraceService = savedTraceService;
  } else {
    delete traceGlobals.__onebunTraceService;
  }
});

/** Names of the spans that were started AND ended, in completion order. */
function recordedSpanNames(): string[] {
  return recorded.map((finished) => finished.name);
}

/** The finished span with this name, or a loud failure listing what was recorded. */
function recordedSpan(name: string): ReadableSpan {
  const found = recorded.find((finished) => finished.name === name);

  if (!found) {
    const names = recordedSpanNames().join(', ') || '(none)';

    throw new Error(`No span named "${name}" was recorded. Recorded spans: ${names}`);
  }

  return found;
}

describe('docs/api/trace.md — Enabling Tracing', () => {
  /**
   * The documented application options claim "Automatic HTTP request tracing" and "Context
   * propagation between services". What that buys the reader is the inbound W3C trace context
   * becoming the request's own context, readable from any handler.
   *
   * @source docs:api/trace.md#in-application
   */
  it('should adopt the inbound W3C trace context for the request when tracing is enabled', async () => {
    @Controller('/traced')
    class TracedController extends BaseController {
      @Get('/context')
      async readContext() {
        return { trace: getCurrentTraceContext() };
      }
    }

    @Module({ controllers: [TracedController] })
    class TracedModule {}

    const app = new OneBunApplication(TracedModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        serviceVersion: '1.0.0',
        samplingRate: 1.0,
        traceHttpRequests: true,
        traceDatabaseQueries: true,
        defaultAttributes: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'service.name': 'my-service',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'deployment.environment': process.env.NODE_ENV ?? 'test',
        },
        spanProcessors: [recordingProcessor()],
      },
    });

    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/traced/context`, {
        headers: { traceparent: W3C_TRACEPARENT },
      });

      expect(response.status).toBe(HTTP_OK);

      const body = (await response.json()) as Envelope<{ trace: SeenTraceContext | null }>;

      // The caller's TRACE is continued and its sampling decision inherited — that is what makes
      // a trace span services — while this request takes an identity of its own and records the
      // caller's span as its parent. Adopting `spanId` verbatim, which this used to assert, meant
      // every log line here was stamped with a span living in the CALLING service: click it in a
      // backend and you land in the caller, never in the code that wrote the line.
      expect(body.result.trace).toMatchObject({
        traceId: W3C_TRACE_ID,
        parentSpanId: W3C_SPAN_ID,
        traceFlags: SAMPLED_FLAG,
      });
      expect(body.result.trace?.spanId).not.toBe(W3C_SPAN_ID);
    } finally {
      await app.stop();
    }
  });

  /**
   * With no inbound headers the application mints a context per request — `samplingRate: 1.0`
   * ("100% of requests") makes every one of them sampled.
   *
   * @source docs:api/trace.md#in-application
   */
  it('should mint a fresh sampled trace context per request when the caller sends no headers', async () => {
    @Controller('/traced')
    class TracedController extends BaseController {
      @Get('/context')
      async readContext() {
        return { trace: getCurrentTraceContext() };
      }
    }

    @Module({ controllers: [TracedController] })
    class TracedModule {}

    const app = new OneBunApplication(TracedModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        samplingRate: 1.0,
        spanProcessors: [recordingProcessor()],
      },
    });

    await app.start();

    try {
      const url = `http://localhost:${app.getPort()}/traced/context`;
      const first = (await (await fetch(url)).json()) as Envelope<{ trace: SeenTraceContext }>;
      const second = (await (await fetch(url)).json()) as Envelope<{ trace: SeenTraceContext }>;

      expect(first.result.trace.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(first.result.trace.spanId).toMatch(/^[0-9a-f]{16}$/);
      // samplingRate: 1.0 — `Math.random() < 1` always holds, so the flag is always set.
      expect(first.result.trace.traceFlags).toBe(SAMPLED_FLAG);

      // Per-request isolation: two requests never share a trace id.
      expect(second.result.trace.traceId).not.toBe(first.result.trace.traceId);
    } finally {
      await app.stop();
    }
  });

  /**
   * `enabled` is the documented switch, and it is honoured: with tracing off no context is
   * assigned to the request and nothing is published for services to pick up.
   *
   * @source docs:api/trace.md#in-application
   */
  it('should leave requests without a trace context when tracing is disabled', async () => {
    @Controller('/untraced')
    class UntracedController extends BaseController {
      @Get('/context')
      async readContext() {
        return { trace: getCurrentTraceContext(), servicePublished: '__onebunTraceService' in globalThis };
      }
    }

    @Module({ controllers: [UntracedController] })
    class UntracedModule {}

    const app = new OneBunApplication(UntracedModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: { enabled: false },
    });

    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/untraced/context`);
      const body = (await response.json()) as Envelope<{ trace: null; servicePublished: boolean }>;

      expect(body.result.trace).toBeNull();
      expect(body.result.servicePublished).toBe(false);
    } finally {
      await app.stop();
    }
  });
});

describe('docs/api/trace.md — this.span', () => {
  /**
   * The documented contract of the `this.span` getter, given an OpenTelemetry context manager:
   * inside a `@Traced()` method it is the active span, so `setAttribute` / `addEvent` land on the
   * span that gets exported, and when no span is active it is `undefined`.
   *
   * The context manager is installed by this test because there is no application here to install
   * one — a bare class, called directly. What is pinned is the contract: the getter reads the
   * *active* span and the span honours the writes. That a stock application now arrives at the
   * same answer is pinned by the next test.
   *
   * @source docs:api/trace.md#thisspan
   */
  it('should expose the active span to a BaseService once an OTel context manager is installed', async () => {
    otelContext.setGlobalContextManager(new TestAsyncLocalStorageContextManager());

    class OrderService extends BaseService {
      @Traced()
      async processOrder(orderId: string): Promise<{ id: string; spanId: string | undefined }> {
        // Set attributes dynamically
        this.span?.setAttribute('order.status', 'paid');
        this.span?.setAttribute('order.total', 129);

        // Add events
        this.span?.addEvent('validation.started');
        this.span?.addEvent('validation.completed');

        // Record warnings without throwing
        this.span?.addEvent('order.warnings', { count: 2 });

        return { id: orderId, spanId: this.span?.spanContext().spanId };
      }

      async activeSpanId(): Promise<string | undefined> {
        return this.span?.spanContext().spanId;
      }
    }

    const service = new OrderService();
    const processed = await service.processOrder('order-1');

    const span = recordedSpan('OrderService.processOrder');

    // The getter handed back the very span that was exported for this call.
    expect(processed.spanId).toBe(span.spanContext().spanId);
    expect(span.attributes['order.status']).toBe('paid');
    expect(span.attributes['order.total']).toBe(129);
    expect(span.events.map((event) => event.name)).toEqual([
      'validation.started',
      'validation.completed',
      'order.warnings',
    ]);
    expect(span.events[2].attributes).toEqual({ count: 2 });

    // "Returns undefined when no span is active (outside @Traced context)" — welded to a live
    // counterpart in the same shape, so the `undefined` reports "no span is active" rather than
    // "the getter is dead". The very same method, called inside a span opened by hand with no
    // `@Traced` anywhere, reports that span; called after it closes, it reports nothing.
    const byHand = await otelTrace
      .getTracer('docs-coverage')
      .startActiveSpan('hand-rolled-span', async (started) => {
        const seenInside = await service.activeSpanId();
        started.end();

        return { seenInside, id: started.spanContext().spanId };
      });

    expect([byHand.seenInside, await service.activeSpanId()]).toEqual([byHand.id, undefined]);
  });

  /**
   * The same snippet in a stock application — which is now the same answer.
   *
   * This test used to pin the opposite: OneBun registered no OpenTelemetry `ContextManager`, so
   * `this.span` (which is only `trace.getActiveSpan()`) could never resolve the span `@Traced`
   * had opened, and every `this.span?.…` line of the documented recipe was a silent no-op. It
   * carried a note saying it would go red the day a context manager was registered. That day
   * arrived; this is the inverted assertion.
   *
   * Still discriminating in both directions: the service is handed the *identity* of the span
   * that was exported, so it fails if `@Traced` stops producing a span, and it fails again if the
   * span produced is not the one the service can see.
   *
   * @source docs:api/trace.md#thisspan
   */
  it('should hand a stock application the exported span inside @Traced', async () => {
    @Service()
    class StockOrderService extends BaseService {
      @Traced()
      async processOrder(): Promise<string> {
        return this.span ? `span:${this.span.spanContext().spanId}` : 'no active span';
      }
    }

    @Controller('/stock')
    class StockController extends BaseController {
      constructor(private readonly orders: StockOrderService) {
        super();
      }

      @Get('/')
      async run() {
        return { seen: await this.orders.processOrder() };
      }
    }

    @Module({ controllers: [StockController], providers: [StockOrderService] })
    class StockModule {}

    const app = new OneBunApplication(StockModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        samplingRate: 1.0,
        spanProcessors: [recordingProcessor()],
      },
    });

    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/stock`);
      const body = (await response.json()) as Envelope<{ seen: string }>;

      const exported = recordedSpan('StockOrderService.processOrder');

      expect({ seen: body.result.seen, exported: recordedSpanNames() }).toEqual({
        seen: `span:${exported.spanContext().spanId}`,
        // Both, and in completion order: the method span ends inside the request, the HTTP
        // span when the response is written. The request span exists because this application
        // records spans somewhere — a `spanProcessors` entry counts for that exactly as an
        // `exportOptions.endpoint` does, since the question the OTel path asks is whether
        // anything will see the span, not how it is shipped.
        exported: ['StockOrderService.processOrder', 'HTTP GET /stock'],
      });
    } finally {
      await app.stop();
    }
  });
});

describe('docs/api/trace.md — Trace Context', () => {
  /**
   * What the "Accessing Current Context" recipe is after — a service reading the ids of the trace
   * it is running in. The working spelling is `getCurrentTraceContext()` from `@onebun/core`
   * (the same helper the logger uses to stamp `trace` on every line); the recipe's
   * `traceService.getCurrentTraceContext()` does not exist on the published service (see notes).
   *
   * @source docs:api/trace.md#accessing-current-context
   */
  it('should let a service read the trace context of the request it runs in', async () => {
    @Service()
    class ContextReadingService extends BaseService {
      async describeTrace(): Promise<{ traceId: string | null; spanId: string | null }> {
        const traceContext = getCurrentTraceContext();

        return {
          traceId: traceContext?.traceId ?? null,
          spanId: traceContext?.spanId ?? null,
        };
      }
    }

    @Controller('/ctx')
    class ContextController extends BaseController {
      constructor(private readonly contextService: ContextReadingService) {
        super();
      }

      @Get('/')
      async read() {
        return await this.contextService.describeTrace();
      }
    }

    @Module({ controllers: [ContextController], providers: [ContextReadingService] })
    class ContextModule {}

    const app = new OneBunApplication(ContextModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        spanProcessors: [recordingProcessor()],
      },
    });

    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/ctx`, {
        headers: { traceparent: W3C_TRACEPARENT },
      });
      const body = (await response.json()) as Envelope<{ traceId: string; spanId: string }>;

      // Same rule as above: the trace is the caller's, the span is this request's own.
      expect(body.result.traceId).toBe(W3C_TRACE_ID);
      expect(body.result.spanId).not.toBe(W3C_SPAN_ID);
    } finally {
      await app.stop();
    }
  });

  /**
   * The recipe's first line — `const traceService = (globalThis as any).__onebunTraceService` —
   * only works because the application publishes the service there, and everything after it hangs
   * off `if (traceService)`. Pinned here: the slot is filled with a working trace service, and its
   * Effect context API reports the span started in the same fiber.
   *
   * @source docs:api/trace.md#accessing-current-context
   */
  it('should publish a working trace service on globalThis for services to pick up', async () => {
    @Controller('/noop')
    class NoopController extends BaseController {
      @Get('/')
      async ping() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class NoopModule {}

    const app = new OneBunApplication(NoopModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        spanProcessors: [recordingProcessor()],
      },
    });

    try {
      const published = traceGlobals.__onebunTraceService;

      if (!published) {
        throw new Error('The application published no trace service on globalThis');
      }

      // It is a real trace service: it parses W3C headers the way the documented one does.
      expect(published.extractFromHeadersSync({ traceparent: W3C_TRACEPARENT })).toEqual({
        traceId: W3C_TRACE_ID,
        spanId: W3C_SPAN_ID,
        traceFlags: SAMPLED_FLAG,
      });

      const observed = await Effect.runPromise(
        Effect.flatMap(published.startSpan('service-work'), (started) =>
          Effect.map(published.getCurrentContext(), (current) => ({ started, current })),
        ),
      );

      expect(observed.current).toEqual(observed.started.context);

      // Inverted drift-pin, not a behaviour assertion — it is red only if the fiber-scoped
      // context ever becomes process-wide. The context lives in a FiberRef, so a later
      // `Effect.runPromise` starts from nothing, which is why the documented "read it later"
      // shape reports no context at all. The positive half is `observed.current` above; a
      // `getCurrentContext` that always answered null would pass this line and fail that one.
      expect(await Effect.runPromise(published.getCurrentContext())).toBeNull();
    } finally {
      await app.stop();
    }
  });

  /**
   * Drift pin for the same snippet. The page reads the context with
   * `traceService.getCurrentTraceContext()` — a method the published service does not have; the
   * interface spells it `getCurrentContext()` (`packages/trace/src/trace.service.ts`), which is
   * what the test above drives. Asserted over the service's own method names so it goes red in
   * both directions: when the page's spelling is added (the recipe starts working, and the page
   * and this test should be fixed together) and when the working spelling is renamed away.
   *
   * @source docs:api/trace.md#accessing-current-context
   */
  it('should expose getCurrentContext() and not the getCurrentTraceContext() the page prints', async () => {
    @Controller('/noop')
    class NoopController extends BaseController {
      @Get('/')
      async ping() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class NoopModule {}

    const app = new OneBunApplication(NoopModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        spanProcessors: [recordingProcessor()],
      },
    });

    try {
      const published = traceGlobals.__onebunTraceService;

      if (!published) {
        throw new Error('The application published no trace service on globalThis');
      }

      const contextReaders = Object.getOwnPropertyNames(Object.getPrototypeOf(published))
        .filter((name) => name.startsWith('getCurrent'))
        .sort();

      expect(contextReaders).toEqual(['getCurrentContext']);
    } finally {
      await app.stop();
    }
  });

  /**
   * "A call made while handling a request carries that request's trace" — and now it does.
   *
   * This test used to pin the opposite, with a note that it would go red the day propagation was
   * wired up: the client sent no W3C headers from inside a traced request, and its only
   * propagation path was an `X-Trace-Id` read from a process-wide slot the framework never
   * filled. That day arrived; this is the inverted assertion.
   *
   * The headers are asserted in the same object as the request count and the client's
   * `User-Agent`, and must stay there: without them a header assertion would hold just as well
   * for a request made by plain `fetch` instead of `createHttpClient`.
   *
   * @source docs:api/trace.md#context-propagation
   */
  it('should carry the inbound trace onto the outgoing call', async () => {
    let echoRequests = 0;
    const echo = Bun.serve({
      port: 0,
      fetch(request) {
        echoRequests += 1;

        return Response.json({ headers: Object.fromEntries(request.headers.entries()) });
      },
    });

    const client = createHttpClient({ baseUrl: `http://localhost:${echo.port}` });

    @Controller('/proxy')
    class ProxyController extends BaseController {
      @Get('/')
      async call() {
        const response = await client.get<{ headers: Record<string, string> }>('/api/data');

        return {
          inbound: getCurrentTraceContext()?.traceId ?? null,
          seen: response.success ? response.result.headers : {},
        };
      }
    }

    @Module({ controllers: [ProxyController] })
    class ProxyModule {}

    const app = new OneBunApplication(ProxyModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        spanProcessors: [recordingProcessor()],
      },
    });

    await app.start();

    try {
      const url = `http://localhost:${app.getPort()}/proxy`;
      const first = await fetch(url, { headers: { traceparent: W3C_TRACEPARENT } });
      const body = (await first.json()) as Envelope<{
        inbound: string | null;
        seen: Record<string, string | undefined>;
      }>;

      // The inbound `traceparent` became this request's trace, and the outgoing call carries it.
      expect(body.result.inbound).toBe(W3C_TRACE_ID);
      expect({
        requests: echoRequests,
        userAgent: body.result.seen['user-agent'],
        traceparent: body.result.seen['traceparent']?.slice(0, W3C_TRACEPARENT_PREFIX_LENGTH),
        traceId: body.result.seen['x-trace-id'],
        hasSpanId: Boolean(body.result.seen['x-span-id']),
      }).toEqual({
        // One call, made by `createHttpClient` — that is what makes the headers mean "the client
        // sent them" rather than "something reached the echo server".
        requests: 1,
        userAgent: 'OneBun-Requests/1.0',
        traceparent: `00-${W3C_TRACE_ID}`,
        traceId: W3C_TRACE_ID,
        // Sent WITH the trace id. Alone the id joins nothing, which is what the old path did.
        hasSpanId: true,
      });
    } finally {
      await app.stop();
      echo.stop(true);
    }
  });
});

describe('docs/api/trace.md — Manual Span Creation', () => {
  /**
   * The manual recipe: `startSpan`, then `addEvent` / `setAttributes` while the work runs, then
   * `endSpan` in a `finally`. Everything it records lands on the span object `startSpan` returned
   * — as long as the calls share a fiber (see the second assertion block).
   *
   * @source docs:api/trace.md#manual-span-creation
   */
  it('should record events and attributes on the span between startSpan and endSpan', async () => {
    const traceService = new TraceServiceImpl({ enabled: true, serviceName: 'order-service' });

    const span = await Effect.runPromise(
      Effect.flatMap(traceService.startSpan('process-order'), (started) =>
        Effect.flatMap(traceService.addEvent('validation-started'), () =>
          Effect.flatMap(traceService.addEvent('validation-completed'), () =>
            Effect.flatMap(
              traceService.setAttributes({
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'order.status': 'confirmed',
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'order.total': 42,
              }),
              () => Effect.map(traceService.endSpan(started), () => started),
            ),
          ),
        ),
      ),
    );

    expect(span.name).toBe('process-order');
    expect(span.context.traceId).toHaveLength(TRACE_ID_HEX_LENGTH);
    expect(span.events.map((event) => event.name)).toEqual([
      'validation-started',
      'validation-completed',
    ]);
    // eslint-disable-next-line @typescript-eslint/naming-convention
    expect(span.attributes).toMatchObject({ 'order.status': 'confirmed', 'order.total': 42 });
    // `endSpan` closes it — an unended span has no endTime at all.
    expect(span.endTime ?? 0).toBeGreaterThanOrEqual(span.startTime);

    // Written exactly as the page writes it — one `Effect.runPromise` per call — the annotations
    // are dropped: the "current span" is a FiberRef, and every run gets a fresh fiber. Goes red
    // when that is fixed, at which point the recipe finally does what the page says.
    const detached = await Effect.runPromise(traceService.startSpan('detached-order'));
    await Effect.runPromise(traceService.addEvent('validation-started'));
    // eslint-disable-next-line @typescript-eslint/naming-convention
    await Effect.runPromise(traceService.setAttributes({ 'order.status': 'confirmed' }));
    await Effect.runPromise(traceService.endSpan(detached));

    expect(detached.events).toEqual([]);
    expect(detached.attributes).toEqual({});
  });

  /**
   * The `catch` branch of the same recipe: the error is recorded as an event carrying its type and
   * message, and then rethrown — the span is not swallowing it.
   *
   * @source docs:api/trace.md#manual-span-creation
   */
  it('should record an error event on the span and rethrow the failure', async () => {
    const traceService = new TraceServiceImpl({ enabled: true, serviceName: 'order-service' });
    const failure = new TypeError('payment gateway unreachable');
    let span: TraceSpan | undefined;

    const attempt = Effect.flatMap(traceService.startSpan('process-order'), (started) => {
      span = started;

      return Effect.catchAll(Effect.fail(failure), (error) =>
        Effect.flatMap(
          traceService.addEvent('error', {
            errorType: error.name,
            errorMessage: error.message,
          }),
          // The `finally` of the recipe ends the span, and the `catch` rethrows.
          () => Effect.flatMap(traceService.endSpan(started), () => Effect.fail(error)),
        ),
      );
    });

    await expect(Effect.runPromise(attempt)).rejects.toThrow('payment gateway unreachable');

    if (!span) {
      throw new Error('startSpan never produced a span');
    }

    expect(span.events.map((event) => event.name)).toEqual(['error']);
    expect(span.events[0].attributes).toEqual({
      errorType: 'TypeError',
      errorMessage: 'payment gateway unreachable',
    });
    expect(span.endTime ?? 0).toBeGreaterThanOrEqual(span.startTime);
  });
});

interface OrderItem {
  productId: string;
  quantity: number;
}

interface CreateOrderDto {
  customerId: string;
  items: OrderItem[];
}

describe('docs/api/trace.md — Complete Example', () => {
  @Service()
  class InventoryService extends BaseService {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private readonly stock: Record<string, number> = { 'sku-1': 10, 'sku-2': 1 };

    @Span('inventory-check-stock')
    async checkStock(productId: string): Promise<number> {
      return this.stock[productId] ?? 0;
    }
  }

  @Service()
  class PaymentService extends BaseService {
    @Span('payment-charge')
    async charge(input: { orderId: string; amount: number; currency: string }) {
      return { transactionId: `tx-${input.orderId}`, status: 'captured', amount: input.amount };
    }
  }

  @Service()
  class OrderService extends BaseService {
    constructor(
      private readonly paymentService: PaymentService,
      private readonly inventoryService: InventoryService,
    ) {
      super();
    }

    @Span('order-create')
    async createOrder(data: CreateOrderDto) {
      await this.validateItems(data.items);

      return {
        id: 'order-1',
        customerId: data.customerId,
        itemCount: data.items.length,
        total: data.items.length * 10,
      };
    }

    @Span('order-process-payment')
    async processPayment(orderId: string) {
      return await this.paymentService.charge({ orderId, amount: 20, currency: 'USD' });
    }

    @Span('order-validate-items')
    private async validateItems(items: OrderItem[]): Promise<void> {
      for (const item of items) {
        const available = await this.inventoryService.checkStock(item.productId);
        if (available < item.quantity) {
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }
      }
    }
  }

  @Controller('/orders')
  class OrderController extends BaseController {
    constructor(private readonly orderService: OrderService) {
      super();
    }

    @Post('/')
    async create(@Body() body: CreateOrderDto) {
      const order = await this.orderService.createOrder(body);

      return this.success(order, HTTP_CREATED);
    }

    @Post('/:id/pay')
    async pay(@Param('id') id: string) {
      return await this.orderService.processPayment(id);
    }
  }

  @Module({
    controllers: [OrderController],
    providers: [OrderService, PaymentService, InventoryService],
  })
  class OrderModule {}

  function createApp(): OneBunApplication {
    return new OneBunApplication(OrderModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'order-service',
        serviceVersion: '1.0.0',
        samplingRate: 1.0,
        defaultAttributes: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'service.name': 'order-service',
        },
        spanProcessors: [recordingProcessor()],
      },
    });
  }

  /**
   * The whole example wired together: injected services, `@Span`-decorated methods and the two
   * routes. Asserted end to end — the HTTP answers the controller documents, and the spans each
   * decorated method is supposed to produce, in the order they complete.
   *
   * @source docs:api/trace.md#complete-example
   */
  it('should trace an order through the controller and its injected services', async () => {
    const app = createApp();
    await app.start();

    try {
      const base = `http://localhost:${app.getPort()}/orders`;
      const created = await fetch(base, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'cust-1', items: [{ productId: 'sku-1', quantity: 2 }] }),
      });

      expect(created.status).toBe(HTTP_CREATED);
      expect(await created.json()).toEqual({
        success: true,
        result: {
          id: 'order-1', customerId: 'cust-1', itemCount: 1, total: 10,
        },
      });

      // Inner spans close before the outer one that awaits them, and the request span closes
      // last of all — it ends when the response is written. It is recorded because this
      // application has somewhere to record spans: a `spanProcessors` entry counts for that
      // exactly as an OTLP endpoint does.
      expect(recordedSpanNames()).toEqual([
        'inventory-check-stock',
        'order-validate-items',
        'order-create',
        'HTTP POST /orders',
      ]);

      const paid = await fetch(`${base}/order-1/pay`, { method: 'POST' });

      expect(paid.status).toBe(HTTP_OK);
      expect(await paid.json()).toEqual({
        success: true,
        result: { transactionId: 'tx-order-1', status: 'captured', amount: 20 },
      });

      expect(recordedSpanNames()).toEqual([
        'inventory-check-stock',
        'order-validate-items',
        'order-create',
        'HTTP POST /orders',
        'payment-charge',
        'order-process-payment',
        'HTTP POST /orders/:id/pay',
      ]);
    } finally {
      await app.stop();
    }
  });

  /**
   * The failing branch of `validateItems`: the thrown error reaches the client as a 500 carrying
   * its message, and every span it unwound through is marked ERROR with that same message.
   *
   * @source docs:api/trace.md#complete-example
   */
  it('should mark the spans of a failed order as errors and answer 500', async () => {
    const app = createApp();
    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/orders`, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: 'cust-1', items: [{ productId: 'sku-2', quantity: 5 }] }),
      });

      expect(response.status).toBe(HTTP_SERVER_ERROR);
      // The default filter withholds an unhandled error's own message — it is written by
      // whatever threw, and cannot be told apart from one naming a path or a credential. The
      // diagnostic detail is on the SPAN, asserted below, and in the log. A message meant for
      // the client is thrown as an `HttpException`.
      expect(await response.json()).toMatchObject({
        success: false,
        error: 'Internal Server Error',
      });

      const validation = recordedSpan('order-validate-items');
      const create = recordedSpan('order-create');

      expect(validation.status).toEqual({
        code: OtelSpanStatusCode.ERROR,
        message: 'Insufficient stock for product sku-2',
      });
      expect(create.status).toEqual({
        code: OtelSpanStatusCode.ERROR,
        message: 'Insufficient stock for product sku-2',
      });

      // The lookup that succeeded is not tarred with the failure. Asserted as "not ERROR", not as
      // "UNSET": UNSET is only the OTel default that `@Span` happens to leave alone today, so
      // pinning it would turn red if `@Span` ever stamped OK on success the way `@Traced` does.
      expect(recordedSpan('inventory-check-stock').status.code).not.toBe(OtelSpanStatusCode.ERROR);
    } finally {
      await app.stop();
    }
  });
});
