/* eslint-disable
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/no-empty-function,
   @typescript-eslint/no-unused-vars,
   @typescript-eslint/naming-convention,
   jest/unbound-method */
import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import type { TraceContext, TraceSpan } from './types.js';

import {
  SpanAttribute,
  SPAN_ATTRIBUTES,
  TraceMiddleware,
} from './middleware.js';
import { traceService, type TraceService } from './trace.service.js';
import { SpanStatusCode } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTraceSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  const ctx: TraceContext = { traceId: 'aabbcc', spanId: '1122', traceFlags: 1 };

  return {
    context: ctx,
    name: 'test-span',
    startTime: Date.now(),
    attributes: {},
    events: [],
    status: { code: SpanStatusCode.OK },
    ...overrides,
  };
}

function makeTraceContext(): TraceContext {
  return { traceId: 'aabbcc112233', spanId: 'deadbeef', traceFlags: 1 };
}

/** Build a mock TraceService and the Effect Layer that provides it. */
function makeMockTraceService(): { mockSvc: TraceService; layer: Layer.Layer<TraceService> } {
  const mockSpan = makeTraceSpan();
  const mockCtx = makeTraceContext();

  const mockSvc: TraceService = {
    getCurrentContext: mock(() => Effect.succeed(null)),
    setContext: mock(() => Effect.void),
    startSpan: mock(() => Effect.succeed(mockSpan)),
    endSpan: mock(() => Effect.void),
    addEvent: mock(() => Effect.void),
    setAttributes: mock(() => Effect.void),
    extractFromHeaders: mock(() => Effect.succeed(null)),
    injectIntoHeaders: mock(() => Effect.succeed({})),
    generateTraceContext: mock(() => Effect.succeed(mockCtx)),
    startHttpTrace: mock(() => Effect.succeed(mockSpan)),
    endHttpTrace: mock(() => Effect.void),
    shutdown: mock(async () => {}),
  };

  const layer = Layer.succeed(traceService, mockSvc);

  return { mockSvc, layer };
}

function makeRequest(
  method = 'GET',
  url = 'http://localhost/api/test',
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { method, headers });
}

// ---------------------------------------------------------------------------
// SpanAttribute decorator
// ---------------------------------------------------------------------------

describe('SpanAttribute decorator', () => {
  test('registers metadata on the prototype when propertyKey is defined', () => {
    class MyClass {
      myMethod(
        @SpanAttribute('user.id') _id: string,
        _name: string,
      ): string {
        return _id;
      }
    }

    const meta = (MyClass.prototype as any)[SPAN_ATTRIBUTES];

    expect(meta).toBeDefined();
    expect(meta['myMethod']).toBeDefined();
    expect(meta['myMethod']).toHaveLength(1);
    expect(meta['myMethod'][0]).toEqual({ paramIndex: 0, attrName: 'user.id' });
  });

  test('does nothing when propertyKey is undefined', () => {
    // Simulate constructor parameter (propertyKey is undefined)
    const decorator = SpanAttribute('some.attr');
    const target = {} as object;
    // Call with undefined propertyKey — should not throw and not write metadata
    decorator(target, undefined, 0);

    expect((target as any)[SPAN_ATTRIBUTES]).toBeUndefined();
  });

  test('accumulates multiple @SpanAttribute entries on the same method', () => {
    class Multi {
      doWork(
        @SpanAttribute('op.id') _id: string,
        @SpanAttribute('op.type') _type: string,
      ): void { /* noop */ }
    }

    const meta = (Multi.prototype as any)[SPAN_ATTRIBUTES]['doWork'];

    expect(meta).toHaveLength(2);
    // bun decorator order: decorators are applied right-to-left (index 1 first, then 0)
    const byIndex = meta.sort((a: any, b: any) => a.paramIndex - b.paramIndex);

    expect(byIndex[0]).toEqual({ paramIndex: 0, attrName: 'op.id' });
    expect(byIndex[1]).toEqual({ paramIndex: 1, attrName: 'op.type' });
  });

  // -------------------------------------------------------------------------
  // applySpanAttributes behaviour via @Traced / @Spanned wrappers:
  // we test it indirectly by verifying setAttribute is called on the span.
  // -------------------------------------------------------------------------

  test('skips undefined attribute values (no setAttribute call)', async () => {
    const setAttributeMock = mock(() => {});
    const fakeSpan = {
      setStatus: mock(() => {}),
      end: mock(() => {}),
      setAttribute: setAttributeMock,
    };

    // Patch otelTrace.getTracer to return a tracer that calls our fakeSpan
    const { trace: otelTraceModule } = await import('@opentelemetry/api');
    const originalGetTracer = otelTraceModule.getTracer.bind(otelTraceModule);

    otelTraceModule.getTracer = mock(() => ({
      startActiveSpan: mock((_name: string, cb: (s: unknown) => Promise<unknown>) => cb(fakeSpan)),
      startSpan: mock(() => fakeSpan),
    })) as unknown as typeof otelTraceModule.getTracer;

    const { Traced } = await import('./middleware.js');

    class Svc {
      @Traced()
      async process(@SpanAttribute('req.id') id: string | undefined): Promise<string> {
        return id ?? 'none';
      }
    }

    const svc = new Svc();
    await svc.process(undefined);

    expect(setAttributeMock).not.toHaveBeenCalled();

    // Restore
    otelTraceModule.getTracer = originalGetTracer;
  });

  test('skips null attribute values (no setAttribute call)', async () => {
    const setAttributeMock = mock(() => {});
    const fakeSpan = {
      setStatus: mock(() => {}),
      end: mock(() => {}),
      setAttribute: setAttributeMock,
    };

    const { trace: otelTraceModule } = await import('@opentelemetry/api');
    const originalGetTracer = otelTraceModule.getTracer.bind(otelTraceModule);

    otelTraceModule.getTracer = mock(() => ({
      startActiveSpan: mock((_name: string, cb: (s: unknown) => Promise<unknown>) => cb(fakeSpan)),
      startSpan: mock(() => fakeSpan),
    })) as unknown as typeof otelTraceModule.getTracer;

    const { Traced } = await import('./middleware.js');

    class Svc2 {
      @Traced()
      async process(@SpanAttribute('req.id') id: string | null): Promise<string> {
        return id ?? 'none';
      }
    }

    const svc = new Svc2();
    await (svc as any).process(null);

    expect(setAttributeMock).not.toHaveBeenCalled();

    otelTraceModule.getTracer = originalGetTracer;
  });

  test('calls setAttribute with primitive string value', async () => {
    const setAttributeMock = mock(() => {});
    const fakeSpan = {
      setStatus: mock(() => {}),
      end: mock(() => {}),
      setAttribute: setAttributeMock,
    };

    const { trace: otelTraceModule } = await import('@opentelemetry/api');
    const originalGetTracer = otelTraceModule.getTracer.bind(otelTraceModule);

    otelTraceModule.getTracer = mock(() => ({
      startActiveSpan: mock((_name: string, cb: (s: unknown) => Promise<unknown>) => cb(fakeSpan)),
      startSpan: mock(() => fakeSpan),
    })) as unknown as typeof otelTraceModule.getTracer;

    const { Traced } = await import('./middleware.js');

    class Svc3 {
      @Traced()
      async process(@SpanAttribute('user.id') id: string): Promise<string> {
        return id;
      }
    }

    const svc = new Svc3();
    await svc.process('user-42');

    expect(setAttributeMock).toHaveBeenCalledWith('user.id', 'user-42');

    otelTraceModule.getTracer = originalGetTracer;
  });

  test('calls setAttribute with primitive number value', async () => {
    const setAttributeMock = mock(() => {});
    const fakeSpan = {
      setStatus: mock(() => {}),
      end: mock(() => {}),
      setAttribute: setAttributeMock,
    };

    const { trace: otelTraceModule } = await import('@opentelemetry/api');
    const originalGetTracer = otelTraceModule.getTracer.bind(otelTraceModule);

    otelTraceModule.getTracer = mock(() => ({
      startActiveSpan: mock((_name: string, cb: (s: unknown) => Promise<unknown>) => cb(fakeSpan)),
      startSpan: mock(() => fakeSpan),
    })) as unknown as typeof otelTraceModule.getTracer;

    const { Traced } = await import('./middleware.js');

    class Svc4 {
      @Traced()
      async process(@SpanAttribute('page') page: number): Promise<number> {
        return page;
      }
    }

    const svc = new Svc4();
    await svc.process(3);

    expect(setAttributeMock).toHaveBeenCalledWith('page', 3);

    otelTraceModule.getTracer = originalGetTracer;
  });

  test('calls setAttribute with primitive boolean value', async () => {
    const setAttributeMock = mock(() => {});
    const fakeSpan = {
      setStatus: mock(() => {}),
      end: mock(() => {}),
      setAttribute: setAttributeMock,
    };

    const { trace: otelTraceModule } = await import('@opentelemetry/api');
    const originalGetTracer = otelTraceModule.getTracer.bind(otelTraceModule);

    otelTraceModule.getTracer = mock(() => ({
      startActiveSpan: mock((_name: string, cb: (s: unknown) => Promise<unknown>) => cb(fakeSpan)),
      startSpan: mock(() => fakeSpan),
    })) as unknown as typeof otelTraceModule.getTracer;

    const { Traced } = await import('./middleware.js');

    class Svc5 {
      @Traced()
      async process(@SpanAttribute('active') active: boolean): Promise<boolean> {
        return active;
      }
    }

    const svc = new Svc5();
    await svc.process(true);

    expect(setAttributeMock).toHaveBeenCalledWith('active', true);

    otelTraceModule.getTracer = originalGetTracer;
  });

  test('JSON.stringifies non-primitive object values', async () => {
    const setAttributeMock = mock(() => {});
    const fakeSpan = {
      setStatus: mock(() => {}),
      end: mock(() => {}),
      setAttribute: setAttributeMock,
    };

    const { trace: otelTraceModule } = await import('@opentelemetry/api');
    const originalGetTracer = otelTraceModule.getTracer.bind(otelTraceModule);

    otelTraceModule.getTracer = mock(() => ({
      startActiveSpan: mock((_name: string, cb: (s: unknown) => Promise<unknown>) => cb(fakeSpan)),
      startSpan: mock(() => fakeSpan),
    })) as unknown as typeof otelTraceModule.getTracer;

    const { Traced } = await import('./middleware.js');

    class Svc6 {
      @Traced()
      async process(@SpanAttribute('filter') filter: Record<string, unknown>): Promise<void> { /* noop */ }
    }

    const svc = new Svc6();
    const obj = { role: 'admin', limit: 10 };
    await svc.process(obj);

    expect(setAttributeMock).toHaveBeenCalledWith('filter', JSON.stringify(obj));

    otelTraceModule.getTracer = originalGetTracer;
  });
});

// ---------------------------------------------------------------------------
// TraceMiddleware.create()
// ---------------------------------------------------------------------------

describe('TraceMiddleware.create()', () => {
  let mockSvc: TraceService;
  let layer: Layer.Layer<TraceService>;

  beforeEach(() => {
    ({ mockSvc, layer } = makeMockTraceService());
  });

  /** Helper: run the middleware Effect and invoke the resulting handler. */
  async function runMiddleware(
    request: Request,
    nextFn: () => Promise<Response>,
  ): Promise<Response> {
    const middlewareFn = await Effect.runPromise(
      Effect.provide(TraceMiddleware.create(), layer),
    );

    return await middlewareFn(request, nextFn);
  }

  test('calls startHttpTrace and endHttpTrace for a successful request', async () => {
    const request = makeRequest('GET', 'http://localhost/api/users');
    const mockResponse = new Response('ok', { status: 200 });

    const response = await runMiddleware(request, async () => mockResponse);

    expect(mockSvc.startHttpTrace).toHaveBeenCalledTimes(1);
    expect(mockSvc.endHttpTrace).toHaveBeenCalledTimes(1);
    expect(response).toBe(mockResponse);
  });

  test('passes method, url and other http data to startHttpTrace', async () => {
    const request = makeRequest('POST', 'http://localhost/api/items');
    const mockResponse = new Response('created', { status: 201 });

    await runMiddleware(request, async () => mockResponse);

    const [httpData] = (mockSvc.startHttpTrace as ReturnType<typeof mock>).mock.calls[0] as [any];

    expect(httpData.method).toBe('POST');
    expect(httpData.url).toBe('http://localhost/api/items');
  });

  test('records response status code in endHttpTrace', async () => {
    const request = makeRequest('GET', 'http://localhost/api/items/1');
    const mockResponse = new Response('not found', { status: 404 });

    await runMiddleware(request, async () => mockResponse);

    const [_span, finalData] = (mockSvc.endHttpTrace as ReturnType<typeof mock>).mock.calls[0] as [any, any];

    expect(finalData.statusCode).toBe(404);
  });

  test('uses extractFromHeaders and setContext when traceparent header is present', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const extractedCtx: TraceContext = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    };

    (mockSvc.extractFromHeaders as ReturnType<typeof mock>).mockImplementation(
      () => Effect.succeed(extractedCtx),
    );

    const request = makeRequest('GET', 'http://localhost/health', { traceparent });
    const mockResponse = new Response('ok', { status: 200 });

    await runMiddleware(request, async () => mockResponse);

    expect(mockSvc.extractFromHeaders).toHaveBeenCalledTimes(1);
    expect(mockSvc.setContext).toHaveBeenCalledWith(extractedCtx);
    // generateTraceContext should NOT be called when context was extracted
    expect(mockSvc.generateTraceContext).not.toHaveBeenCalled();
  });

  test('generates new trace context when no traceparent header is present', async () => {
    // extractFromHeaders returns null (default mock)
    const request = makeRequest('GET', 'http://localhost/health');
    const mockResponse = new Response('ok', { status: 200 });

    await runMiddleware(request, async () => mockResponse);

    expect(mockSvc.generateTraceContext).toHaveBeenCalledTimes(1);
    expect(mockSvc.setContext).toHaveBeenCalledTimes(1);
  });

  test('calls addEvent and endHttpTrace with 500 on next() error', async () => {
    const request = makeRequest('GET', 'http://localhost/boom');
    const error = new TypeError('something went wrong');

    await expect(
      runMiddleware(request, async () => {
        throw error;
      }),
    ).rejects.toThrow('something went wrong');

    expect(mockSvc.addEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        'error.type': 'TypeError',
        'error.message': 'something went wrong',
      }),
    );

    const [_span, errorData] = (mockSvc.endHttpTrace as ReturnType<typeof mock>).mock.calls[0] as [any, any];

    expect(errorData.statusCode).toBe(500);
  });

  test('records user-agent header in http data', async () => {
    const request = makeRequest('GET', 'http://localhost/', { 'user-agent': 'test-agent/1.0' });
    const mockResponse = new Response('ok', { status: 200 });

    await runMiddleware(request, async () => mockResponse);

    const [httpData] = (mockSvc.startHttpTrace as ReturnType<typeof mock>).mock.calls[0] as [any];

    expect(httpData.userAgent).toBe('test-agent/1.0');
  });

  test('duration is a non-negative number in endHttpTrace', async () => {
    const request = makeRequest('GET', 'http://localhost/');
    const mockResponse = new Response('ok', { status: 200 });

    await runMiddleware(request, async () => mockResponse);

    const [_span, finalData] = (mockSvc.endHttpTrace as ReturnType<typeof mock>).mock.calls[0] as [any, any];

    expect(typeof finalData.duration).toBe('number');
    expect(finalData.duration).toBeGreaterThanOrEqual(0);
  });

  test('passes the span returned by startHttpTrace to endHttpTrace', async () => {
    const specificSpan = makeTraceSpan({ name: 'specific-span' });

    (mockSvc.startHttpTrace as ReturnType<typeof mock>).mockImplementation(
      () => Effect.succeed(specificSpan),
    );

    const request = makeRequest('GET', 'http://localhost/');
    const mockResponse = new Response('ok', { status: 200 });

    await runMiddleware(request, async () => mockResponse);

    const [spanArg] = (mockSvc.endHttpTrace as ReturnType<typeof mock>).mock.calls[0] as [any, any];

    expect(spanArg).toBe(specificSpan);
  });
});
