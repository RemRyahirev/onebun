/**
 * Span nesting.
 *
 * Before a context manager was installed, `trace.getActiveSpan()` was `undefined` everywhere, so
 * nothing linked one span to another: the HTTP span and every `@Traced` method arrived at the
 * collector as separate ROOT spans with different trace ids. A request that fanned out to five
 * methods produced six unrelated traces — visible, and useless as a waterfall.
 *
 * These tests assert the shape of what is exported, not that a decorator exists.
 *
 * Nesting is only observable through a whole application and through the queue machinery, so these
 * tests import `@onebun/core`. It cannot be a dependency of `@onebun/trace` — core depends on
 * trace, so the entry would be a cycle — hence the disable below; the package is resolved through
 * the root tsconfig paths.
 */

/* eslint-disable import/no-extraneous-dependencies */

import {
  context as otelContext,
  ROOT_CONTEXT,
  trace as otelTrace,
} from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  InMemoryQueueAdapter,
  Module,
  OneBunApplication,
  QueueScheduler,
  Service,
} from '@onebun/core';

import { makeMockLoggerLayer } from '../../core/src/testing';
import {
  installContextManager,
  OneBunContextManager,
  releaseContextManager,
  resetContextManagerStateForTests,
} from '../src/context-manager';
import { Traced } from '../src/middleware';

/** Marker used to prove a foreign manager is still the installed one. */
const FOREIGN_MARKER: unique symbol = Symbol.for('onebun:test:foreignContextMarker');

/** Endpoint that is never reached — `hasExporter` only has to be true for the OTel path. */
const UNUSED_COLLECTOR = 'http://127.0.0.1:9/unused';

let spanExporter: InMemorySpanExporter;
let tracerProvider: BasicTracerProvider;

beforeEach(() => {
  otelTrace.disable();
  spanExporter = new InMemorySpanExporter();
  tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  otelTrace.setGlobalTracerProvider(tracerProvider);
});

afterEach(async () => {
  await tracerProvider.shutdown();
  otelTrace.disable();
});

function span(name: string): ReadableSpan {
  const found = spanExporter.getFinishedSpans().find((finished) => finished.name === name);

  if (!found) {
    const recorded = spanExporter.getFinishedSpans().map((s) => s.name).join(', ') || '(none)';

    throw new Error(`No span named "${name}" was recorded. Recorded: ${recorded}`);
  }

  return found;
}

describe('spans nest within a request', () => {
  @Service()
  class NestingService extends BaseService {
    @Traced('orders.load')
    async load(): Promise<string> {
      return 'loaded';
    }

    @Traced('orders.price')
    async price(): Promise<string> {
      return 'priced';
    }
  }

  @Controller('/orders')
  class NestingController extends BaseController {
    constructor(private readonly orders: NestingService) {
      super();
    }

    @Get('/')
    async list(): Promise<{ steps: string[] }> {
      return { steps: [await this.orders.load(), await this.orders.price()] };
    }
  }

  @Module({ controllers: [NestingController], providers: [NestingService] })
  class NestingModule {}

  it('parents every @Traced method to the HTTP span, in one trace', async () => {
    const app = new OneBunApplication(NestingModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'nesting-service',
        exportOptions: { endpoint: UNUSED_COLLECTOR },
      },
    });

    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/orders`);
      await response.json();
    } finally {
      await app.stop();
    }

    const http = span('HTTP GET /orders');
    const load = span('orders.load');
    const price = span('orders.price');

    // One trace, not three. This is the assertion the whole item is about.
    expect([load.spanContext().traceId, price.spanContext().traceId])
      .toEqual([http.spanContext().traceId, http.spanContext().traceId]);

    // And a waterfall, not a flat list: both methods hang off the request.
    expect([load.parentSpanContext?.spanId, price.parentSpanContext?.spanId])
      .toEqual([http.spanContext().spanId, http.spanContext().spanId]);

    // The HTTP span itself is a root — a request does not inherit the previous one, which is
    // what `ROOT_CONTEXT` at the request boundary buys: Bun reuses a keep-alive connection's
    // async context, so `context.active()` there would chain request N+1 under request N.
    expect(http.parentSpanContext).toBeUndefined();
  });

  it('starts a separate trace per request over one keep-alive connection', async () => {
    const app = new OneBunApplication(NestingModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'nesting-service',
        exportOptions: { endpoint: UNUSED_COLLECTOR },
      },
    });

    await app.start();

    try {
      for (let i = 0; i < 2; i++) {
        const response = await fetch(`http://localhost:${app.getPort()}/orders`, {
          headers: { connection: 'keep-alive' },
        });
        await response.json();
      }
    } finally {
      await app.stop();
    }

    const httpSpans = spanExporter.getFinishedSpans().filter((s) => s.name === 'HTTP GET /orders');
    const traceIds = new Set(httpSpans.map((s) => s.spanContext().traceId));

    expect(httpSpans).toHaveLength(2);
    expect(traceIds.size).toBe(2);
    expect(httpSpans.every((s) => s.parentSpanContext === undefined)).toBe(true);
  });
});

/**
 * Where work stops belonging to whatever scheduled it.
 *
 * An `AsyncLocalStorage` context follows the async call graph, and that graph is not causality: a
 * timer armed during a request keeps the request's context, and so does a socket callback
 * registered at upgrade. Left alone, a cron job would appear as a child of a request that finished
 * days ago, and would keep appearing under it for the life of the process — a trace that grows
 * forever and names the wrong cause. Worse than no nesting at all, which is why these boundaries
 * re-root explicitly rather than trusting the runtime's propagation rules.
 */
describe('background work starts its own trace', () => {
  const TICK_MS = 5;
  const SETTLE_MS = 40;

  beforeEach(() => {
    resetContextManagerStateForTests();
    otelContext.disable();
    installContextManager();
  });

  afterEach(() => {
    otelContext.disable();
    resetContextManagerStateForTests();
  });

  /** The trace ids of every span named `name`, deduplicated. */
  function traceIdsOf(name: string): Set<string> {
    return new Set(
      spanExporter.getFinishedSpans()
        .filter((finished) => finished.name === name)
        .map((finished) => finished.spanContext().traceId),
    );
  }

  it('re-roots a scheduled job away from the request that armed its timer', async () => {
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    await adapter.subscribe('jobs.tick', async () => {
      await otelTrace.getTracer('probe').startActiveSpan('job.work', async (jobSpan) => {
        jobSpan.end();
      });
    });

    const scheduler = new QueueScheduler(adapter);
    scheduler.addIntervalJob('ticker', TICK_MS, 'jobs.tick');

    // Start the scheduler from INSIDE a request-shaped span, which is the situation that used to
    // adopt every future tick.
    await otelTrace.getTracer('probe').startActiveSpan('HTTP POST /start', async (request) => {
      scheduler.start();
      await Bun.sleep(SETTLE_MS);
      request.end();
    });

    scheduler.stop();
    await adapter.disconnect();

    const ticks = spanExporter.getFinishedSpans().filter((finished) => finished.name === 'job.work');
    const request = span('HTTP POST /start');

    expect(ticks.length).toBeGreaterThan(0);
    // Not one of them hangs off the request. A single parented tick would be the whole point.
    expect(ticks.every((tick) => tick.parentSpanContext === undefined)).toBe(true);
    // And each tick is its own trace rather than all of them sharing the request's.
    expect(traceIdsOf('job.work').size).toBe(ticks.length);
    expect(traceIdsOf('job.work').has(request.spanContext().traceId)).toBe(false);
  });

  it('re-roots a queue message away from the request that published it', async () => {
    const adapter = new InMemoryQueueAdapter();
    await adapter.connect();

    await adapter.subscribe('orders.created', async () => {
      await otelTrace.getTracer('probe').startActiveSpan('order.consume', async (consumed) => {
        consumed.end();
      });
    });

    await otelTrace.getTracer('probe').startActiveSpan('HTTP POST /orders', async (request) => {
      await adapter.publish('orders.created', { id: 1 });
      await Bun.sleep(SETTLE_MS);
      request.end();
    });

    await adapter.disconnect();

    const consumed = span('order.consume');
    const request = span('HTTP POST /orders');

    // A message consumed under the publisher's span would make every retry — minutes later, on a
    // different process even — a child of a request that is long gone.
    expect(consumed.parentSpanContext).toBeUndefined();
    expect(consumed.spanContext().traceId).not.toBe(request.spanContext().traceId);
  });
});

/**
 * The context manager is a process-global slot, like the tracer provider before it. The rules are
 * the same, and were learned the same way: never assume the slot still holds what you put there,
 * and never remove what you did not install.
 */
describe('context manager ownership', () => {
  beforeEach(() => {
    resetContextManagerStateForTests();
    otelContext.disable();
  });

  afterEach(() => {
    otelContext.disable();
    resetContextManagerStateForTests();
  });

  it('does not take the slot from a manager that is already installed', () => {
    const foreign = new OneBunContextManager().enable();
    otelContext.setGlobalContextManager(foreign);

    expect(installContextManager()).toBe(false);

    // Still theirs, untouched: their manager propagates context perfectly well, and taking the
    // slot would break more than it fixes.
    const probe = ROOT_CONTEXT.setValue(FOREIGN_MARKER, true);
    expect(foreign.with(probe, () => otelContext.active().getValue(FOREIGN_MARKER))).toBe(true);
  });

  it('keeps the manager alive while another application is still using it', () => {
    expect(installContextManager()).toBe(true);
    expect(installContextManager()).toBe(true);

    // First application stops. The second is still serving requests.
    releaseContextManager();

    const stillPropagates = otelTrace.getTracer('probe').startActiveSpan('after-first-release', (s) => {
      const seen = otelTrace.getActiveSpan()?.spanContext().spanId;
      s.end();

      return seen === s.spanContext().spanId;
    });

    expect(stillPropagates).toBe(true);

    releaseContextManager();
  });

  it('re-derives ownership instead of trusting what it remembers', () => {
    expect(installContextManager()).toBe(true);

    // Anyone can do this — another library, a test teardown. It is a process-global wipe, and it
    // does not tell us. Remembering "we installed one" would report success forever after while
    // nothing propagated.
    otelContext.disable();

    expect(installContextManager()).toBe(true);

    const propagates = otelTrace.getTracer('probe').startActiveSpan('after-external-wipe', (s) => {
      const seen = otelTrace.getActiveSpan()?.spanContext().spanId;
      s.end();

      return seen === s.spanContext().spanId;
    });

    expect(propagates).toBe(true);
  });
});

/**
 * An inbound `traceparent` continues the caller's trace.
 *
 * It already became the trace ids in this service's LOGS, so log correlation across services
 * worked. Its exported spans did not: `startHttpTraceSync` built its span from `context.active()`,
 * which the request boundary re-roots to `ROOT_CONTEXT` on purpose, and the parsed inbound context
 * reached the span not at all. Two services, one trace id in the logs, two unrelated traces in the
 * backend — and the half an operator found by following the logs looked complete.
 */
describe('inbound trace context', () => {
  const REMOTE_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
  const REMOTE_SPAN_ID = '00f067aa0ba902b7';
  const REMOTE_TRACEPARENT = `00-${REMOTE_TRACE_ID}-${REMOTE_SPAN_ID}-01`;

  @Controller('/inbound')
  class InboundController extends BaseController {
    @Get('/')
    async read(): Promise<{ ok: boolean }> {
      return { ok: true };
    }
  }

  @Module({ controllers: [InboundController] })
  class InboundModule {}

  async function requestWith(headers: Record<string, string>): Promise<void> {
    const app = new OneBunApplication(InboundModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: {
        enabled: true,
        serviceName: 'callee',
        exportOptions: { endpoint: UNUSED_COLLECTOR },
      },
    });

    await app.start();

    try {
      const response = await fetch(`http://localhost:${app.getPort()}/inbound`, { headers });
      await response.json();
    } finally {
      await app.stop();
    }
  }

  it('parents the HTTP span to the caller span named in the traceparent', async () => {
    await requestWith({ traceparent: REMOTE_TRACEPARENT });

    const http = span('HTTP GET /inbound');

    expect(http.spanContext().traceId).toBe(REMOTE_TRACE_ID);
    expect(http.parentSpanContext?.spanId).toBe(REMOTE_SPAN_ID);
    // Marked remote so the SDK and the backend know the parent lives in another process.
    expect(http.parentSpanContext?.isRemote).toBe(true);
  });

  it('starts a fresh root when the caller sends nothing', async () => {
    await requestWith({});

    const http = span('HTTP GET /inbound');

    expect(http.parentSpanContext).toBeUndefined();
    expect(http.spanContext().traceId).not.toBe(REMOTE_TRACE_ID);
  });

  it('starts a fresh root rather than parenting to garbage', async () => {
    // The `x-trace-id` / `x-span-id` pair is taken verbatim from headers anyone can set — only
    // the `traceparent` branch is regex-checked — so the ids are re-validated at the span.
    await requestWith({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-trace-id': 'not-a-trace-id',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-span-id': REMOTE_SPAN_ID,
    });

    const http = span('HTTP GET /inbound');

    expect(http.parentSpanContext).toBeUndefined();
    expect(http.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('starts a fresh root for the all-zero invalid ids', async () => {
    // OpenTelemetry hands these out for non-recording spans, so they arrive routinely rather than
    // as corruption; a span parented to them belongs to a trace that does not exist.
    await requestWith({ traceparent: `00-${'0'.repeat(32)}-${'0'.repeat(16)}-01` });

    const http = span('HTTP GET /inbound');

    expect(http.parentSpanContext).toBeUndefined();
    expect(http.spanContext().traceId).not.toBe('0'.repeat(32));
  });
});
