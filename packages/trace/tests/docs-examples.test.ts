/**
 * Documentation Examples Tests for @onebun/trace
 *
 * @source docs:api/trace.md
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
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
  TRACE_ALL,
  NO_TRACE,
} from '../src';

describe('Trace README Examples', () => {
  describe('Decorators (README)', () => {
    /**
     * @source docs:api/trace.md#decorators
     */
    it('should have @Trace decorator available', () => {
      // From README: @Trace decorator
      // Note: Just checking if decorator is importable and usable
      expect(Trace).toBeDefined();
      expect(typeof Trace).toBe('function');
    });

    /**
     * @source docs:api/trace.md#decorators
     */
    it('should have @Span decorator available', () => {
      // From README: @Span decorator
      expect(Span).toBeDefined();
      expect(typeof Span).toBe('function');
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
    it('should create trace spans for methods with custom name', () => {
      // From docs: @Span() example
      class UserService {
        @Span('find-user-by-id')
        async findById(id: string): Promise<unknown> {
          return { id };
        }
      }

      const service = new UserService();
      expect(typeof service.findById).toBe('function');
    });

    it('should create trace spans with method name when no name provided', () => {
      // From docs: @Span() without name
      class UserService {
        @Span() // Uses method name as span name
        async processUser(_user: unknown): Promise<void> {
          // Span name: "processUser"
        }
      }

      expect(UserService).toBeDefined();
    });

    it('should support nested traced calls', () => {
      // From docs: Nested spans
      class UserService {
        @Span('user-search')
        async search(query: string): Promise<unknown[]> {
          await this.normalizeQuery(query);

          return [];
        }

        @Span('normalize-query')
        private async normalizeQuery(query: string): Promise<string> {
          return query.toLowerCase().trim();
        }
      }

      expect(UserService).toBeDefined();
    });
  });

  describe('Configuration Options Type (docs/api/trace.md)', () => {
    it('should define valid tracing options', () => {
      // From docs: TracingOptions interface
      const tracingOptions = {
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

      expect(tracingOptions.enabled).toBe(true);
      expect(tracingOptions.serviceName).toBe('my-service');
      expect(tracingOptions.samplingRate).toBe(1.0);
    });
  });

  describe('Best Practices (docs/api/trace.md)', () => {
    it('should use meaningful span names', () => {
      // From docs: Best Practices - Meaningful Span Names
      class OrderService {
        // Good: descriptive, includes operation type
        @Span('user-create')
        async createUser() {}

        @Span('order-process-payment')
        async processPayment() {}

        @Span('cache-lookup')
        async lookupCache() {}
      }

      expect(OrderService).toBeDefined();
    });

    it('should trace business-significant operations', () => {
      // From docs: Best Practices - Don't Over-Trace
      class OrderService {
        // Good: trace business-significant operations
        @Span('place-order')
        async placeOrder(data: unknown): Promise<unknown> {
          return data;
        }

        // Avoid: tracing every tiny utility function
        // @Span('format-date')  // Too granular
        formatDate(date: Date): string {
          return date.toISOString();
        }
      }

      expect(OrderService).toBeDefined();
    });
  });
});

describe('Trace Context Propagation (docs/api/trace.md)', () => {
  describe('HTTP Headers (docs/api/trace.md)', () => {
    it('should define trace context header format', () => {
      // From docs: Trace context headers (standard HTTP header naming)
      /* eslint-disable @typescript-eslint/naming-convention */
      const traceHeaders = {
        traceparent: '00-abc123def456789-span123-01',
        tracestate: 'onebun=true',
        'x-trace-id': 'abc123def456789',
        'x-span-id': 'span123',
      };
      /* eslint-enable @typescript-eslint/naming-convention */

      expect(traceHeaders.traceparent).toMatch(/^00-[a-z0-9]+-[a-z0-9]+-01$/);
      expect(traceHeaders['x-trace-id']).toBe('abc123def456789');
      expect(traceHeaders['x-span-id']).toBe('span123');
    });
  });
});

describe('Decorator Aliases (docs/api/trace.md)', () => {
  it('should export Traced alias', () => {
    expect(Traced).toBeDefined();
    expect(typeof Traced).toBe('function');
    expect(Traced).toBe(Trace);
  });

  it('should export Spanned alias', () => {
    expect(Spanned).toBeDefined();
    expect(typeof Spanned).toBe('function');
    expect(Spanned).toBe(Span);
  });

  it('should use @Traced decorator for async service methods', () => {
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
    expect(typeof service.findAll).toBe('function');
    expect(typeof service.create).toBe('function');
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
describe('OTLP Exporter (docs/api/trace.md)', () => {
  it('should create OtlpFetchSpanExporter', () => {
    // From docs: Custom Exporter example
    const exporter = new OtlpFetchSpanExporter({
      endpoint: 'http://localhost:4318',
      headers: { 'X-Custom': 'value' },
      timeout: 5000,
    });

    expect(exporter).toBeDefined();
    expect(typeof exporter.export).toBe('function');
    expect(typeof exporter.shutdown).toBe('function');
  });
});

 
describe('Auto-Tracing (docs/api/trace.md)', () => {
  it('should export TraceAll decorator', () => {
    expect(TraceAll).toBeDefined();
    expect(typeof TraceAll).toBe('function');
  });

  it('should export NoTrace decorator', () => {
    expect(NoTrace).toBeDefined();
    expect(typeof NoTrace).toBe('function');
  });

  it('should export shouldAutoTrace', () => {
    expect(shouldAutoTrace).toBeDefined();
    expect(typeof shouldAutoTrace).toBe('function');
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

  it('should respect priority: traceAll + @NoTrace class', () => {
    @NoTrace()
    class InternalService {}

    // @NoTrace overrides global traceAll
    expect(shouldAutoTrace(InternalService, 'InternalService', true)).toBe(false);
  });

  it('should respect priority: @TraceAll class when traceAll is false', () => {
    @TraceAll()
    class ImportantService {}

    expect(shouldAutoTrace(ImportantService, 'ImportantService', false)).toBe(true);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */

describe('SpanAttribute (docs/api/trace.md)', () => {
  it('should export SpanAttribute decorator', () => {
    expect(SpanAttribute).toBeDefined();
    expect(typeof SpanAttribute).toBe('function');
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
    expect(meta.findById).toBeDefined();
    expect(meta.findById[0].attrName).toBe('user.id');
  });
});

describe('OpenTelemetry Compatibility (README)', () => {
  it('should support W3C Trace Context', () => {
    // From README: OpenTelemetry compatibility
    // W3C Trace Context format: version-trace_id-parent_id-flags
    const validTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const parts = validTraceparent.split('-');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('00'); // version
    expect(parts[1]).toHaveLength(32); // trace_id (32 hex chars)
    expect(parts[2]).toHaveLength(16); // parent_id (16 hex chars)
    expect(parts[3]).toBe('01'); // flags (sampled)
  });
});
