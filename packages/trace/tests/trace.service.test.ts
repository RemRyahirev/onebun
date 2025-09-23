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
