/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-shadow */
import { trace as otelTrace, SpanStatusCode as OtelSpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect, FiberRef } from 'effect';

import type { TraceContext, TraceOptions } from '../src/types';

import {
  TraceServiceImpl,
  traceService,
  makeTraceService,
  traceServiceLive,
  currentTraceContext,
  currentSpan,
  TraceService,
  TraceServiceLive,
} from '../src/trace.service';

describe('TraceService', () => {
  let service: TraceServiceImpl;

  beforeEach(() => {
    service = new TraceServiceImpl();
  });

  afterEach(() => {
    // Clean up any trace context
  });

  describe('TraceServiceImpl', () => {
    test('should create instance with default options', () => {
      const instance = new TraceServiceImpl();
      expect(instance).toBeInstanceOf(TraceServiceImpl);
    });

    test('should create instance with custom options', () => {
      const options: TraceOptions = {
        enabled: false,
        serviceName: 'test-service',
        serviceVersion: '2.0.0',
        samplingRate: 0.5,
        traceHttpRequests: false,
        traceDatabaseQueries: false,
        defaultAttributes: { env: 'test' },
      };

      const instance = new TraceServiceImpl(options);
      expect(instance).toBeInstanceOf(TraceServiceImpl);
    });

    test('should get current context initially null', async () => {
      const context = await Effect.runPromise(service.getCurrentContext());
      expect(context).toBeNull();
    });

    test('should set and get trace context', async () => {
      const testContext: TraceContext = {
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      };

      // Use Effect.runPromise with the same fiber context
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* service.setContext(testContext);

          return yield* service.getCurrentContext();
        }),
      );
      
      expect(result).toEqual(testContext);
    });

    test('should start a span', async () => {
      const spanEffect = service.startSpan('test-span');
      
      // The effect should not throw when run
      await expect(Effect.runPromise(spanEffect)).resolves.toBeDefined();
    });

    test('should start a span with parent context', async () => {
      const parentContext: TraceContext = {
        traceId: 'parent-trace-id',
        spanId: 'parent-span-id',
        traceFlags: 1,
      };

      const spanEffect = service.startSpan('child-span', parentContext);
      
      await expect(Effect.runPromise(spanEffect)).resolves.toBeDefined();
    });

    test('should end a span', async () => {
      const span = await Effect.runPromise(service.startSpan('test-span'));
      
      const endEffect = service.endSpan(span);
      await expect(Effect.runPromise(endEffect)).resolves.toBeUndefined();
    });

    test('should set span attributes', async () => {
      await Effect.runPromise(service.startSpan('test-span'));
      
      const attributesEffect = service.setAttributes({
        'http.method': 'GET',
        'http.url': 'https://example.com',
      });
      
      await expect(Effect.runPromise(attributesEffect)).resolves.toBeUndefined();
    });

    test('should add event to span', async () => {
      await Effect.runPromise(service.startSpan('test-span'));
      
      const eventEffect = service.addEvent('test-event', {
        key: 'value',
      });
      
      await expect(Effect.runPromise(eventEffect)).resolves.toBeUndefined();
    });

    test('should extract trace context from headers', async () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };
      
      const contextEffect = service.extractFromHeaders(headers);
      const context = await Effect.runPromise(contextEffect);
      
      expect(context).toBeDefined();
      expect(context?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(context?.spanId).toBe('b7ad6b7169203331');
    });

    test('should extract trace context from headers with invalid traceparent', async () => {
      const headers = {
        traceparent: 'invalid-traceparent',
      };
      
      const contextEffect = service.extractFromHeaders(headers);
      const context = await Effect.runPromise(contextEffect);
      
      expect(context).toBeNull();
    });

    test('should inject trace context into headers', async () => {
      const traceContext: TraceContext = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };
      
      const headersEffect = service.injectIntoHeaders(traceContext);
      const headers = await Effect.runPromise(headersEffect);
      
      expect(headers).toBeDefined();
      expect(headers.traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[a-f0-9]{16}-01$/);
    });

    test('should start HTTP trace', async () => {
      const httpData = {
        method: 'GET',
        url: 'https://example.com/api/test',
      };
      
      const spanEffect = service.startHttpTrace(httpData);
      const span = await Effect.runPromise(spanEffect);
      expect(span).toBeDefined();
    });

    test('should end HTTP trace', async () => {
      const httpData = {
        method: 'GET',
        url: 'https://example.com/api/test',
      };
      
      const span = await Effect.runPromise(service.startHttpTrace(httpData));
      
      const endEffect = service.endHttpTrace(span, {
        statusCode: 200,
        duration: 150,
      });
      await expect(Effect.runPromise(endEffect)).resolves.toBeUndefined();
    });

    test('should generate trace context', async () => {
      const contextEffect = service.generateTraceContext();
      const context = await Effect.runPromise(contextEffect);
      
      expect(context).toBeDefined();
      expect(context.traceId).toBeDefined();
      expect(context.spanId).toBeDefined();
      expect(typeof context.traceId).toBe('string');
      expect(typeof context.spanId).toBe('string');
    });

    test('should handle disabled tracing', () => {
      const disabledService = new TraceServiceImpl({ enabled: false });
      expect(disabledService).toBeInstanceOf(TraceServiceImpl);
    });

    test('should have shutdown method', async () => {
      const instance = new TraceServiceImpl({ enabled: false });
      expect(typeof instance.shutdown).toBe('function');
      await instance.shutdown(); // should not throw
    });
  });

  describe('Context and FiberRef', () => {
    test('should export traceService context tag', () => {
      expect(traceService).toBeDefined();
    });

    test('should export currentTraceContext FiberRef', () => {
      expect(currentTraceContext).toBeDefined();
    });

    test('should export currentSpan FiberRef', () => {
      expect(currentSpan).toBeDefined();
    });

    test('should work with FiberRef for trace context', async () => {
      const testContext: TraceContext = {
        traceId: 'fiber-trace-id',
        spanId: 'fiber-span-id',
        traceFlags: 1,
      };

      // Use the same fiber for set and get operations
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* FiberRef.set(currentTraceContext, testContext);

          return yield* FiberRef.get(currentTraceContext);
        }),
      );
      
      expect(result).toEqual(testContext);
    });
  });

  describe('Layer and service creation', () => {
    test('should create layer with makeTraceService', () => {
      const layer = makeTraceService();
      expect(layer).toBeDefined();
    });

    test('should create layer with custom options', () => {
      const options: TraceOptions = {
        enabled: true,
        serviceName: 'test-service',
      };
      
      const layer = makeTraceService(options);
      expect(layer).toBeDefined();
    });

    test('should export traceServiceLive', () => {
      expect(traceServiceLive).toBeDefined();
    });

    test('should work with Effect and layer', async () => {
      const layer = makeTraceService();
      
      const program = Effect.gen(function* () {
        const service = yield* traceService;

        return service;
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBeInstanceOf(TraceServiceImpl);
    });
  });

  describe('Backward compatibility aliases', () => {
    test('should export TraceService alias', () => {
      expect(TraceService).toBe(traceService);
    });

    test('should export TraceServiceLive alias', () => {
      expect(TraceServiceLive).toBe(traceServiceLive);
    });
  });

  describe('Integration tests', () => {
    test('should create and use full trace context', async () => {
      const layer = makeTraceService({
        enabled: true,
        serviceName: 'integration-test',
      });

      const program = Effect.gen(function* () {
        const service = yield* traceService;
        
        // Start a span
        const span = yield* service.startSpan('integration-test');
        
        // Set some attributes
        yield* service.setAttributes({
          'test.type': 'integration',
          'test.value': 42,
        });
        
        // Record an event
        yield* service.addEvent('test-event', {
          milestone: 'halfway',
        });
        
        // End the span
        yield* service.endSpan(span);
        
        return 'success';
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBe('success');
    });

    test('should handle nested spans', async () => {
      const layer = makeTraceService();

      const program = Effect.gen(function* () {
        const service = yield* traceService;
        
        // Parent span
        const parentSpan = yield* service.startSpan('parent-operation');
        
        // Child span with parent context
        const childSpan = yield* service.startSpan('child-operation', parentSpan.context);
        
        // End spans
        yield* service.endSpan(childSpan);
        yield* service.endSpan(parentSpan);
        
        return 'nested-success';
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBe('nested-success');
    });
  });
});

/**
 * Spans actually reaching an exporter.
 *
 * Every case here installs a FOREIGN provider as the OpenTelemetry global and reads the spans out
 * of an `InMemorySpanExporter`. No network, and the service's own OTLP processor never sees the
 * span — which is the point: what is being tested is that the span is ENDED, not that the
 * exporter works.
 */
describe('span export', () => {
  let spanExporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    // A provider left registered by another file would make this registration a silent no-op.
    otelTrace.disable();
    spanExporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });
    otelTrace.setGlobalTracerProvider(provider);
  });

  afterEach(async () => {
    await provider.shutdown();
    otelTrace.disable();
  });

  /** A service that takes the OTel path — `hasExporter` is true — pointed at a port nothing serves. */
  function exportingService(): TraceServiceImpl {
    return new TraceServiceImpl({
      enabled: true,
      serviceName: 'export-test',
      exportOptions: { endpoint: 'http://127.0.0.1:1' },
    });
  }

  test('ends the HTTP span, so something is actually exported', async () => {
    // The defect: `startHttpTraceSync` created a real OTel span and kept only its spanContext,
    // and `endHttpTraceSync` tried to recover it via `trace.getActiveSpan()` — undefined, because
    // nothing makes the span active. `.end()` never ran, so no processor ever saw it and the
    // collector stayed empty however it was configured.
    const service = exportingService();

    const span = service.startHttpTraceSync({ method: 'GET', url: 'http://h/x', route: '/x' });
    service.endHttpTraceSync(span, { statusCode: 200, duration: 12 });

    const finished = spanExporter.getFinishedSpans();

    expect(finished).toHaveLength(1);
    expect(finished[0].name).toBe('HTTP GET /x');

    await service.shutdown();
  });

  test('carries the attributes and events the request accumulated', async () => {
    // `finishOtelSpan` is the single sink, so attributes set at start, attributes set at end, and
    // events pushed onto the record by the framework all reach OpenTelemetry. The framework
    // pushes its `error` event straight onto `span.events`, which used to reach nothing.
    const service = exportingService();

    const span = service.startHttpTraceSync({ method: 'POST', url: 'http://h/orders', route: '/orders' });
    span.events.push({ name: 'error', timestamp: Date.now(), attributes: { errorType: 'Boom' } });
    service.endHttpTraceSync(span, { statusCode: 500 });

    const [finished] = spanExporter.getFinishedSpans();

    expect(finished.attributes['http.method']).toBe('POST');
    expect(finished.attributes['http.route']).toBe('/orders');
    expect(finished.attributes['http.status_code']).toBe(500);
    expect(finished.events.map((e) => e.name)).toEqual(['error']);
    expect(finished.status.code).toBe(OtelSpanStatusCode.ERROR);

    await service.shutdown();
  });

  test('records the same attributes on the OneBun span and the exported one', async () => {
    // One accumulator. Writing http.* to OTel at start and to the record separately used to leave
    // `TraceSpan.attributes` holding only the defaults — a record that claimed less than the span.
    const service = exportingService();

    const span = service.startHttpTraceSync({ method: 'GET', url: 'http://h/y', route: '/y' });
    service.endHttpTraceSync(span, { statusCode: 204 });

    const [finished] = spanExporter.getFinishedSpans();

    expect(span.attributes['http.route']).toBe('/y');
    expect(span.attributes['http.status_code']).toBe(204);
    expect(finished.attributes).toMatchObject(span.attributes);

    await service.shutdown();
  });

  test('a second end does not export the span twice', async () => {
    // Ending is idempotent through clearing the carried span. Without that, a duplicate end
    // exports a second, contradictory copy of the same span id.
    const service = exportingService();

    const span = service.startHttpTraceSync({ method: 'GET', url: 'http://h/z', route: '/z' });
    service.endHttpTraceSync(span, { statusCode: 200 });
    service.endHttpTraceSync(span, { statusCode: 500 });

    expect(spanExporter.getFinishedSpans()).toHaveLength(1);

    await service.shutdown();
  });

  test('exports nothing when no exporter is configured', async () => {
    // The lightweight path is unchanged: no endpoint means no OTel span, so a stock application
    // emits exactly what it emits today. The end is a no-op because the SPAN carries no OTel
    // span — not because the service consults its own configuration at end time.
    const service = new TraceServiceImpl({ enabled: true, serviceName: 'no-exporter' });

    const span = service.startHttpTraceSync({ method: 'GET', url: 'http://h/q', route: '/q' });
    service.endHttpTraceSync(span, { statusCode: 200 });

    expect(spanExporter.getFinishedSpans()).toHaveLength(0);

    await service.shutdown();
  });
});

describe('layer laziness', () => {
  test('importing the package does not claim the OpenTelemetry global', () => {
    // `Layer.succeed` evaluates eagerly, so the module-level `traceServiceLive = makeTraceService()`
    // constructed a service at IMPORT time and registered a provider with no span processors.
    // The application's own exporter-carrying provider was then refused as a duplicate, silently.
    otelTrace.disable();

    // Building the layer's argument is what registration used to happen inside.
    makeTraceService({ serviceName: 'lazy-probe', enabled: true });

    const proxy = otelTrace.getTracerProvider() as { getDelegate?: () => object };
    const installed = proxy.getDelegate === undefined ? proxy : proxy.getDelegate();

    expect(installed.constructor.name).toBe('NoopTracerProvider');
  });
});
