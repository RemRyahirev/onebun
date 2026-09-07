/**
 * Documentation Examples Tests for @onebun/trace
 *
 * Every tagged test here runs the documented example against a real
 * `BasicTracerProvider` + `InMemorySpanExporter` registered as the global
 * OpenTelemetry provider, so the assertions are about spans that were actually
 * produced: their names, attributes, status and ordering. A decorator that stops
 * creating a span — or creates it under another name, without the documented
 * attributes — fails these tests.
 *
 * @source docs:api/trace.md
 */

import { SpanStatusCode as OtelSpanStatusCode, trace as otelTrace } from '@opentelemetry/api';
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
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import {
  applyAutoTrace,
  NoTrace,
  OtlpFetchSpanExporter,
  shouldAutoTrace,
  Span,
  SpanAttribute,
  SPAN_ATTRIBUTES,
  Spanned,
  Trace,
  TraceAll,
  Traced,
  type TraceOptions,
  TraceServiceImpl,
  TRACE_ALL,
  NO_TRACE,
} from '../src';

const HTTP_OK = 200;
const SAMPLED_FLAG = 1;
const NOT_SAMPLED_FLAG = 0;
const W3C_TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const W3C_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const W3C_SPAN_ID = '00f067aa0ba902b7';

/**
 * Shape of the OTLP JSON payload the exporter POSTs, as documented in
 * docs/api/trace.md ("Exporting Traces").
 */
interface OtlpAttribute {
  key: string;
  value: Record<string, unknown>;
}

interface OtlpPayload {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string };
      spans: Array<{ name: string; attributes: OtlpAttribute[] }>;
    }>;
  }>;
}

let spanExporter: InMemorySpanExporter;
let tracerProvider: BasicTracerProvider;

beforeEach(() => {
  // A previously registered global provider would make registration a no-op.
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

/** Names of the spans that were started AND ended, in completion order. */
function recordedSpanNames(): string[] {
  return spanExporter.getFinishedSpans().map((finished) => finished.name);
}

/** The finished span with this name, or a loud failure listing what was recorded. */
function recordedSpan(name: string): ReadableSpan {
  const found = spanExporter.getFinishedSpans().find((finished) => finished.name === name);

  if (!found) {
    const recorded = recordedSpanNames().join(', ') || '(none)';

    throw new Error(`No span named "${name}" was recorded. Recorded spans: ${recorded}`);
  }

  return found;
}

describe('Trace README Examples', () => {
  describe('Decorators (README)', () => {
    /**
     * `@Trace` is the alias of the decorator the docs spell `@Traced()`. The
     * "Class-Level Control" section promises a method-level `@Traced()` keeps
     * producing a span even inside a `@NoTrace()` class.
     *
     * @source docs:api/trace.md#class-level-control
     */
    it('should have @Trace decorator available', async () => {
      expect(Trace).toBe(Traced);

      @NoTrace()
      class InternalService {
        async helper(): Promise<string> {
          return 'helper';
        }

        @Trace()
        async critical(): Promise<string> {
          return 'critical';
        }
      }

      const service = new InternalService();

      // The class opts out of auto-tracing entirely...
      expect(shouldAutoTrace(InternalService, 'InternalService', true)).toBe(false);

      expect(await service.helper()).toBe('helper');
      expect(await service.critical()).toBe('critical');

      // ...but the method decorator still emits its own span, and only that one.
      expect(recordedSpanNames()).toEqual(['InternalService.critical']);
    });

    /**
     * @source docs:api/trace.md#span-decorator
     */
    it('should have @Span decorator available', async () => {
      expect(Span).toBe(Spanned);

      class UserService {
        @Span('find-user-by-id')
        async findById(@SpanAttribute('user.id') id: string): Promise<{ id: string }> {
          return { id };
        }
      }

      const result = await new UserService().findById('user-42');

      // The method still returns its value through the span wrapper.
      expect(result).toEqual({ id: 'user-42' });

      const span = recordedSpan('find-user-by-id');
      expect(span.attributes['user.id']).toBe('user-42');
      expect(span.ended).toBe(true);
    });

    it('should use @Trace decorator with name', () => {
      // From README: @Trace example
      class UserController {
        @Trace('get-all-users')
        async getUsers() {
          return [];
        }
      }

      expect(UserController).toBeDefined();
      expect(typeof new UserController().getUsers).toBe('function');
    });

    it('should use @Trace decorator without name (uses method name)', () => {
      // From README: @Trace() without name
      class UserController {
        @Trace() // Uses method name as span name
        async createUser(userData: unknown) {
          return userData;
        }
      }

      expect(UserController).toBeDefined();
    });

    it('should use @Span decorator for services', () => {
      // From README: @Span example
      class UserService {
        @Span('database-query')
        async findAll() {
          return [];
        }

        @Span() // Uses 'UserService.validateUser' as name
        async validateUser(_id: string) {
          return true;
        }
      }

      expect(UserService).toBeDefined();
    });
  });
});

describe('Trace API Documentation Examples', () => {
  describe('@Span() Decorator (docs/api/trace.md)', () => {
    /**
     * @source docs:api/trace.md#span-decorator
     */
    it('should create trace spans for methods with custom name', async () => {
      class UserService {
        @Span('find-user-by-id')
        async findById(@SpanAttribute('user.id') id: string): Promise<{ id: string }> {
          return { id };
        }
      }

      const service = new UserService();
      expect(await service.findById('user-7')).toEqual({ id: 'user-7' });

      // The custom name replaces the default `ClassName.methodName`.
      expect(recordedSpanNames()).toEqual(['find-user-by-id']);
      expect(recordedSpanNames()).not.toContain('UserService.findById');
      expect(recordedSpan('find-user-by-id').attributes['user.id']).toBe('user-7');
    });

    /**
     * @source docs:api/trace.md#span-decorator
     */
    it('should create trace spans with method name when no name provided', async () => {
      class UserService {
        @Span() // Uses method name as span name
        async processUser(user: { id: string }): Promise<{ id: string }> {
          return user;
        }
      }

      await new UserService().processUser({ id: 'u-1' });

      // The method name is qualified with the class it lives on.
      expect(recordedSpanNames()).toEqual(['UserService.processUser']);
    });

    /**
     * @source docs:api/trace.md#span-decorator
     */
    it('should support nested traced calls', async () => {
      class UserService {
        @Span('user-search')
        async search(@SpanAttribute('search.query') query: string): Promise<string[]> {
          return [await this.normalizeQuery(query)];
        }

        @Span('normalize-query')
        private async normalizeQuery(query: string): Promise<string> {
          return query.toLowerCase().trim();
        }
      }

      expect(await new UserService().search('  HeLLo ')).toEqual(['hello']);

      // Both spans exist; the inner one finishes before the outer one that wraps it.
      expect(recordedSpanNames()).toEqual(['normalize-query', 'user-search']);
      expect(recordedSpan('user-search').attributes['search.query']).toBe('  HeLLo ');
    });
  });

  describe('Configuration Options Type (docs/api/trace.md)', () => {
    /**
     * @source docs:api/trace.md#configuration-options
     */
    it('should define valid tracing options', () => {
      // From docs: TracingOptions interface — typed, so a renamed/removed option
      // breaks compilation instead of silently drifting.
      const tracingOptions: TraceOptions = {
        // Enable/disable tracing (default: true)
        enabled: true,

        // Service name for traces (default: 'onebun-service')
        serviceName: 'my-service',

        // Service version (default: '1.0.0')
        serviceVersion: '1.0.0',

        // Sampling rate 0.0-1.0 (default: 1.0)
        samplingRate: 1.0,

        // Auto-trace HTTP requests (default: true)
        traceHttpRequests: true,

        // Auto-trace database queries (default: true)
        traceDatabaseQueries: true,

        /* eslint-disable @typescript-eslint/naming-convention */
        // Default span attributes (OpenTelemetry standard naming)
        defaultAttributes: {
          'service.name': 'my-service',
          'deployment.environment': 'production',
        },

        // Export configuration
        exportOptions: {
          endpoint: 'http://jaeger:4318/v1/traces',
          headers: { Authorization: 'Bearer token' },
          /* eslint-enable @typescript-eslint/naming-convention */
          timeout: 10000,
          batchSize: 100,
          batchTimeout: 5000,
        },
      };

      const service = new TraceServiceImpl(tracingOptions);

      // samplingRate 1.0 → every generated context is flagged as sampled.
      expect(service.generateTraceContextSync().traceFlags).toBe(SAMPLED_FLAG);

      // defaultAttributes are attached to every span the service starts.
      const span = Effect.runSync(service.startSpan('configured-operation'));
      expect(span.name).toBe('configured-operation');
      expect(span.attributes['service.name']).toBe('my-service');
      expect(span.attributes['deployment.environment']).toBe('production');
      // Shape, not just width: a length check alone survives the all-zero INVALID context that a
      // dead tracer returns, because zeros are exactly 32 and 16 characters long.
      expect(span.context.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.context.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(span.context.traceId).not.toBe('0'.repeat(W3C_TRACE_ID.length));
      expect(span.context.spanId).not.toBe('0'.repeat(W3C_SPAN_ID.length));
    });

    /**
     * @source docs:api/trace.md#sampling
     */
    it('should honour samplingRate when generating trace context', () => {
      const always = new TraceServiceImpl({ samplingRate: 1.0 });
      const never = new TraceServiceImpl({ samplingRate: 0 });

      expect(always.generateTraceContextSync().traceFlags).toBe(SAMPLED_FLAG);
      expect(never.generateTraceContextSync().traceFlags).toBe(NOT_SAMPLED_FLAG);
    });

    /**
     * @source docs:api/trace.md#configuration-options
     */
    it('should stop extracting trace context when enabled is false', () => {
      const disabled = new TraceServiceImpl({ enabled: false });
      const enabled = new TraceServiceImpl({ enabled: true });

      expect(disabled.extractFromHeadersSync({ traceparent: W3C_TRACEPARENT })).toBeNull();
      expect(enabled.extractFromHeadersSync({ traceparent: W3C_TRACEPARENT })).not.toBeNull();
    });
  });

  describe('Best Practices (docs/api/trace.md)', () => {
    /**
     * @source docs:api/trace.md#1-meaningful-span-names
     */
    it('should use meaningful span names', async () => {
      class OrderService {
        // Good: descriptive, includes operation type
        @Span('user-create')
        async createUser(): Promise<string> {
          return 'created';
        }

        @Span('order-process-payment')
        async processPayment(): Promise<string> {
          return 'paid';
        }

        @Span('cache-lookup')
        async lookupCache(): Promise<string> {
          return 'hit';
        }
      }

      const service = new OrderService();
      await service.createUser();
      await service.processPayment();
      await service.lookupCache();

      // The descriptive names reach the exporter verbatim.
      expect(recordedSpanNames()).toEqual([
        'user-create',
        'order-process-payment',
        'cache-lookup',
      ]);
    });

    /**
     * @source docs:api/trace.md#4-dont-over-trace
     */
    it('should trace business-significant operations', async () => {
      class OrderService {
        // Good: trace business-significant operations
        @Span('place-order')
        async placeOrder(data: { id: string }): Promise<{ id: string }> {
          return data;
        }

        // Avoid: tracing every tiny utility function
        // @Span('format-date')  // Too granular
        formatDate(date: Date): string {
          return date.toISOString();
        }
      }

      const service = new OrderService();

      expect(await service.placeOrder({ id: 'order-1' })).toEqual({ id: 'order-1' });
      expect(service.formatDate(new Date(0))).toBe('1970-01-01T00:00:00.000Z');

      // Only the decorated business operation produced a span.
      expect(recordedSpanNames()).toEqual(['place-order']);
    });

    /**
     * @source docs:api/trace.md#3-trace-error-boundaries
     */
    it('should record the error on the span and rethrow it', async () => {
      class OrderService {
        @Span('process-order')
        async processOrder(orderId: string): Promise<never> {
          throw new Error(`processing failed for ${orderId}`);
        }
      }

      await expect(new OrderService().processOrder('order-9')).rejects.toThrow(
        'processing failed for order-9',
      );

      const span = recordedSpan('process-order');
      expect(span.status.code).toBe(OtelSpanStatusCode.ERROR);
      expect(span.status.message).toBe('processing failed for order-9');
      expect(span.ended).toBe(true);
    });
  });
});

describe('Trace Context Propagation (docs/api/trace.md)', () => {
  describe('HTTP Headers (docs/api/trace.md)', () => {
    /**
     * @source docs:api/trace.md#automatic-http-context
     */
    it('should define trace context header format', () => {
      const service = new TraceServiceImpl({ enabled: true });

      const extracted = service.extractFromHeadersSync({
        traceparent: W3C_TRACEPARENT,
        tracestate: 'onebun=true',
      });

      if (!extracted) {
        throw new Error('extractFromHeadersSync returned null for a valid traceparent');
      }

      expect(extracted.traceId).toBe(W3C_TRACE_ID);
      expect(extracted.spanId).toBe(W3C_SPAN_ID);
      expect(extracted.traceFlags).toBe(SAMPLED_FLAG);

      // The same context is propagated back out in the documented header set.
      const headers = Effect.runSync(service.injectIntoHeaders(extracted));

      expect(headers.traceparent).toBe(W3C_TRACEPARENT);
      expect(headers['x-trace-id']).toBe(W3C_TRACE_ID);
      expect(headers['x-span-id']).toBe(W3C_SPAN_ID);
    });

    /**
     * @source docs:api/trace.md#automatic-http-context
     */
    it('should accept x-trace-id / x-span-id when traceparent is absent', () => {
      const service = new TraceServiceImpl({ enabled: true });

      const extracted = service.extractFromHeadersSync({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'x-trace-id': 'abc123def456789',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'x-span-id': 'span123',
      });

      expect(extracted).toEqual({
        traceId: 'abc123def456789',
        spanId: 'span123',
        traceFlags: SAMPLED_FLAG,
      });

      // A malformed traceparent is not silently accepted.
      expect(service.extractFromHeadersSync({ traceparent: 'not-a-traceparent' })).toBeNull();
    });
  });
});

describe('Decorator Aliases (docs/api/trace.md)', () => {
  /**
   * @source docs:api/trace.md#spanattribute-decorator
   */
  it('should export Traced alias', async () => {
    expect(Traced).toBe(Trace);

    class WorkspaceService {
      @Traced('workspace.findAll')
      async findAll(): Promise<string[]> {
        return ['ws-1'];
      }
    }

    expect(await new WorkspaceService().findAll()).toEqual(['ws-1']);

    const span = recordedSpan('workspace.findAll');
    // @Traced marks a successful call as OK.
    expect(span.status.code).toBe(OtelSpanStatusCode.OK);
  });

  /**
   * @source docs:api/trace.md#span-decorator
   */
  it('should export Spanned alias', async () => {
    expect(Spanned).toBe(Span);

    class CacheService {
      @Spanned('cache-lookup')
      async lookup(key: string): Promise<string> {
        return `value:${key}`;
      }
    }

    expect(await new CacheService().lookup('k')).toBe('value:k');
    expect(recordedSpanNames()).toEqual(['cache-lookup']);
  });

  it('should use @Traced decorator for async service methods', async () => {
    // From docs: @Traced() decorator
    class WorkspaceService {
      @Traced()
      async findAll(): Promise<unknown[]> {
        return [];
      }

      @Traced('workspace.create')
      async create(dto: unknown): Promise<unknown> {
        return dto;
      }
    }

    const service = new WorkspaceService();

    expect(await service.findAll()).toEqual([]);
    expect(await service.create({ name: 'ws' })).toEqual({ name: 'ws' });

    // Without a name the span falls back to `ClassName.methodName`.
    expect(recordedSpanNames()).toEqual(['WorkspaceService.findAll', 'workspace.create']);
  });

  /**
   * @source docs:api/trace.md#3-trace-error-boundaries
   */
  it('should record the exception on the span for @Traced methods', async () => {
    class PaymentService {
      @Traced('payment.charge')
      async charge(): Promise<never> {
        throw new Error('card declined');
      }
    }

    await expect(new PaymentService().charge()).rejects.toThrow('card declined');

    const span = recordedSpan('payment.charge');
    expect(span.status.code).toBe(OtelSpanStatusCode.ERROR);
    expect(span.status.message).toBe('card declined');
    expect(span.events.map((event) => event.name)).toContain('exception');
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
describe('OTLP Exporter (docs/api/trace.md)', () => {
  /**
   * @source docs:api/trace.md#custom-exporter
   */
  it('should create OtlpFetchSpanExporter', async () => {
    // From docs: Custom Exporter example
    const exporter = new OtlpFetchSpanExporter({
      endpoint: 'http://localhost:4318',
      headers: { 'X-Custom': 'value' },
      timeout: 5000,
    });

    class OrderService {
      @Traced('order.create')
      async createOrder(@SpanAttribute('order.customerId') customerId: string): Promise<string> {
        return customerId;
      }
    }

    await new OrderService().createOrder('cust-1');

    const fetchMock = mock((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response('', { status: HTTP_OK })));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      const result = await new Promise<ExportResult>((resolve) => {
        exporter.export(spanExporter.getFinishedSpans(), resolve);
      });

      expect(result.code).toBe(0); // ExportResultCode.SUCCESS
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('value');
      expect(headers['Content-Type']).toBe('application/json');

      const payload = JSON.parse(init.body as string) as OtlpPayload;
      const exported = payload.resourceSpans[0].scopeSpans[0].spans;
      expect(exported.map((exportedSpan) => exportedSpan.name)).toEqual(['order.create']);
      expect(exported[0].attributes).toContainEqual({
        key: 'order.customerId',
        value: { stringValue: 'cust-1' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  /**
   * @source docs:api/trace.md#exporting-traces
   */
  it('should POST spans to {endpoint}/v1/traces', async () => {
    // A trailing slash on the endpoint must not produce a double slash.
    const exporter = new OtlpFetchSpanExporter({ endpoint: 'http://collector:4318/' });

    class ReportService {
      @Traced('report.build')
      async build(): Promise<string> {
        return 'ok';
      }
    }

    await new ReportService().build();

    const fetchMock = mock((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response('', { status: HTTP_OK })));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    try {
      await new Promise<ExportResult>((resolve) => {
        exporter.export(spanExporter.getFinishedSpans(), resolve);
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://collector:4318/v1/traces');
      expect(init.method).toBe('POST');

      const payload = JSON.parse(init.body as string) as OtlpPayload;
      expect(payload.resourceSpans[0].scopeSpans[0].scope.name).toBe('@onebun/trace');
      expect(payload.resourceSpans[0].scopeSpans[0].spans.map((exported) => exported.name))
        .toEqual(['report.build']);

      // The resource block carries the service identity (its value comes from the
      // provider the application configures, so only the key is asserted here).
      const resourceKeys = payload.resourceSpans[0].resource.attributes.map((attr) => attr.key);
      expect(resourceKeys).toContain('service.name');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Auto-Tracing (docs/api/trace.md)', () => {
  /**
   * @source docs:api/trace.md#class-level-control
   */
  it('should export TraceAll decorator', async () => {
    @TraceAll()
    class ImportantService {
      async findAll(): Promise<string[]> {
        return ['a'];
      }
    }

    const service = new ImportantService();

    // Opt-in even though the global traceAll is false.
    expect(shouldAutoTrace(ImportantService, 'ImportantService', false)).toBe(true);

    applyAutoTrace(service, 'ImportantService');
    expect(await service.findAll()).toEqual(['a']);

    expect(recordedSpanNames()).toEqual(['ImportantService.findAll']);
  });

  /**
   * @source docs:api/trace.md#class-level-control
   */
  it('should export NoTrace decorator', async () => {
    class InternalService {
      @NoTrace()
      async helper(): Promise<string> {
        return 'helper';
      }

      async critical(): Promise<string> {
        return 'critical';
      }
    }

    const service = new InternalService();
    applyAutoTrace(service, 'InternalService');

    expect(await service.helper()).toBe('helper');
    expect(await service.critical()).toBe('critical');

    // The @NoTrace method is skipped, its sibling is not.
    expect(recordedSpanNames()).toEqual(['InternalService.critical']);
  });

  /**
   * @source docs:api/trace.md#global-auto-trace
   */
  it('should export shouldAutoTrace', async () => {
    class UserService {
      async findAll(): Promise<number> {
        return 1;
      }
    }

    // Undecorated class: the global traceAll flag decides.
    expect(shouldAutoTrace(UserService, 'UserService', true)).toBe(true);
    expect(shouldAutoTrace(UserService, 'UserService', false)).toBe(false);

    const service = new UserService();
    applyAutoTrace(service, 'UserService');
    expect(await service.findAll()).toBe(1);

    expect(recordedSpanNames()).toEqual(['UserService.findAll']);
  });

  it('should set TRACE_ALL symbol via @TraceAll()', () => {
    @TraceAll()
    class MyService {}

    expect((MyService as unknown as Record<symbol, boolean>)[TRACE_ALL]).toBe(true);
  });

  it('should set NO_TRACE symbol via @NoTrace() on class', () => {
    @NoTrace()
    class MyService {}

    expect((MyService as unknown as Record<symbol, boolean>)[NO_TRACE]).toBe(true);
  });

  /**
   * @source docs:api/trace.md#priority
   */
  it('should respect priority: traceAll + @NoTrace class', () => {
    @NoTrace()
    class InternalService {}

    // @NoTrace overrides global traceAll
    expect(shouldAutoTrace(InternalService, 'InternalService', true)).toBe(false);
  });

  /**
   * @source docs:api/trace.md#priority
   */
  it('should respect priority: @TraceAll class when traceAll is false', () => {
    @TraceAll()
    class ImportantService {}

    expect(shouldAutoTrace(ImportantService, 'ImportantService', false)).toBe(true);
  });

  /**
   * @source docs:api/trace.md#priority
   */
  it('should respect priority: @NoTrace class + @Traced method', async () => {
    @NoTrace()
    class InternalService {
      async helper(): Promise<string> {
        return 'helper';
      }

      @Traced()
      async critical(): Promise<string> {
        return 'critical';
      }
    }

    const service = new InternalService();
    expect(shouldAutoTrace(InternalService, 'InternalService', true)).toBe(false);

    await service.helper();
    await service.critical();

    // Method-level @Traced wins over the class-level opt-out.
    expect(recordedSpanNames()).toEqual(['InternalService.critical']);
  });

  /**
   * @source docs:api/trace.md#priority
   */
  it('should respect priority: @TraceAll class + @NoTrace method', async () => {
    @TraceAll()
    class ImportantService {
      async findAll(): Promise<string> {
        return 'all';
      }

      @NoTrace()
      async helper(): Promise<string> {
        return 'helper';
      }
    }

    const service = new ImportantService();
    expect(shouldAutoTrace(ImportantService, 'ImportantService', false)).toBe(true);

    applyAutoTrace(service, 'ImportantService');
    await service.findAll();
    await service.helper();

    expect(recordedSpanNames()).toEqual(['ImportantService.findAll']);
  });

  /**
   * @source docs:api/trace.md#filtering
   */
  it('should apply includeClasses / excludeClasses filters', () => {
    class Anything {}

    const filter = {
      includeClasses: ['*Service', '*Repository'],
      excludeClasses: ['HealthController'],
    };

    expect(shouldAutoTrace(Anything, 'UserService', true, filter)).toBe(true);
    expect(shouldAutoTrace(Anything, 'UserRepository', true, filter)).toBe(true);
    expect(shouldAutoTrace(Anything, 'AppController', true, filter)).toBe(false);
    expect(shouldAutoTrace(Anything, 'HealthController', true, { excludeClasses: ['HealthController'] }))
      .toBe(false);
  });

  /**
   * @source docs:api/trace.md#filtering
   */
  it('should skip excludeMethods and sync methods when auto-tracing', async () => {
    class UserRepository {
      async load(): Promise<string> {
        return 'loaded';
      }

      async helper(): Promise<string> {
        return 'helped';
      }

      buildKey(id: string): string {
        return `user:${id}`;
      }
    }

    const repository = new UserRepository();
    applyAutoTrace(repository, 'UserRepository', { excludeMethods: ['helper'] });

    await repository.load();
    await repository.helper();
    repository.buildKey('1');

    // `helper` is excluded by name, `buildKey` by the asyncOnly default.
    expect(recordedSpanNames()).toEqual(['UserRepository.load']);
  });

  /**
   * @source docs:api/trace.md#excluded-methods
   */
  it('should never auto-trace framework internals', async () => {
    class UserController {
      async onModuleInit(): Promise<void> {
        // lifecycle hook
      }

      async success(): Promise<string> {
        return 'base-class helper';
      }

      async findAll(): Promise<string> {
        return 'handler';
      }
    }

    const controller = new UserController();
    applyAutoTrace(controller, 'UserController');

    await controller.onModuleInit();
    await controller.success();
    await controller.findAll();

    expect(recordedSpanNames()).toEqual(['UserController.findAll']);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

describe('SpanAttribute (docs/api/trace.md)', () => {
  /**
   * @source docs:api/trace.md#spanattribute-decorator
   */
  it('should export SpanAttribute decorator', async () => {
    class OrderService {
      @Traced('order.create')
      async createOrder(
        @SpanAttribute('order.customerId') customerId: string,
        @SpanAttribute('order.total') total: number,
        @SpanAttribute('order.express') express: boolean,
        @SpanAttribute('order.items') items: Array<{ sku: string }>,
        @SpanAttribute('order.coupon') _coupon?: string,
      ): Promise<number> {
        return items.length + total + (express ? 1 : 0) + customerId.length;
      }
    }

    await new OrderService().createOrder('cust-1', 42, true, [{ sku: 'a' }]);

    const span = recordedSpan('order.create');

    // string / number / boolean are recorded as-is, objects are JSON.stringify-ed.
    expect(span.attributes['order.customerId']).toBe('cust-1');
    expect(span.attributes['order.total']).toBe(42);
    expect(span.attributes['order.express']).toBe(true);
    expect(span.attributes['order.items']).toBe('[{"sku":"a"}]');

    // undefined arguments are skipped, not recorded as "undefined".
    expect(Object.keys(span.attributes)).not.toContain('order.coupon');
  });

  it('should store metadata for @SpanAttribute parameters', () => {
    class UserService {
      @Traced()

      async findById(@SpanAttribute('user.id') id: string) {
        return { id };
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (UserService.prototype as any)[SPAN_ATTRIBUTES];
    expect(meta).toBeDefined();
    expect(meta.findById).toEqual([{ paramIndex: 0, attrName: 'user.id' }]);
  });
});

describe('OpenTelemetry Compatibility (README)', () => {
  it('should emit a W3C traceparent for a context it generated itself', () => {
    // This used to split a traceparent literal the test itself declared and assert its parts. No
    // symbol from @onebun/trace appeared in it, so nothing the package could ever do would fail it.
    // Extraction of an inbound traceparent is already covered above; what is pinned here is the
    // format the service PRODUCES: version, real hex ids of the right width, and the sampled flag.
    const service = new TraceServiceImpl({ enabled: true, samplingRate: 1.0 });
    const context = service.generateTraceContextSync();

    const headers = Effect.runSync(service.injectIntoHeaders(context));
    const parts = (headers.traceparent ?? '').split('-');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('00');
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{16}$/);
    expect(parts[3]).toBe('01');
    // ...and the header carries THIS context, not a fresh one.
    expect(parts[1]).toBe(context.traceId);
    expect(parts[2]).toBe(context.spanId);
  });
});
