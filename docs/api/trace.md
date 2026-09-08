---
description: "Distributed tracing with @Span decorator. TraceService, W3C trace context, span attributes, OpenTelemetry-compatible export."
---

# Tracing API

Package: `@onebun/trace`

## Overview

OneBun provides OpenTelemetry-compatible distributed tracing with:
- Automatic HTTP request tracing
- Context propagation between services
- Custom span creation
- Integration with logging

## Enabling Tracing

### In Application

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    serviceVersion: '1.0.0',
    samplingRate: 1.0,  // 100% of requests
    traceHttpRequests: true,
    traceDatabaseQueries: true,
    defaultAttributes: {
      'service.name': 'my-service',
      'deployment.environment': process.env.NODE_ENV,
    },
  },
});
```

### Configuration Options

```typescript
interface TracingOptions {
  /** Enable/disable tracing (default: true) */
  enabled?: boolean;

  /** Service name for traces (default: 'onebun-service') */
  serviceName?: string;

  /** Service version (default: '1.0.0') */
  serviceVersion?: string;

  /** Sampling rate 0.0-1.0 (default: 1.0) */
  samplingRate?: number;

  /** Auto-trace HTTP requests (default: true) */
  traceHttpRequests?: boolean;

  /** Auto-trace database queries (default: true) */
  traceDatabaseQueries?: boolean;

  /** Default span attributes */
  defaultAttributes?: Record<string, string | number | boolean>;

  /** Export configuration */
  exportOptions?: {
    endpoint?: string;
    headers?: Record<string, string>;
    timeout?: number;
    batchSize?: number;
    batchTimeout?: number;
  };
}
```

## @Span() Decorator

Create trace spans for methods.

```typescript
import { Service, BaseService } from '@onebun/core';
import { Span, SpanAttribute } from '@onebun/trace';

@Service()
export class UserService extends BaseService {
  @Span('find-user-by-id')
  async findById(
    @SpanAttribute('user.id') id: string,
  ): Promise<User | null> {
    // This method execution is traced, id is auto-recorded as span attribute
    return this.repository.findById(id);
  }

  @Span()  // Uses method name as span name
  async processUser(user: User): Promise<void> {
    await this.validate(user);
    await this.save(user);
  }

  @Span('user-search')
  async search(
    @SpanAttribute('search.query') query: string,
  ): Promise<User[]> {
    const normalized = await this.normalizeQuery(query);
    // Add dynamic attributes via this.span
    this.span?.setAttribute('search.resultCount', normalized.length);
    return this.repository.search(normalized);
  }

  @Span('normalize-query')
  private async normalizeQuery(query: string): Promise<string> {
    return query.toLowerCase().trim();
  }
}
```

## @SpanAttribute() Decorator

Automatically records method arguments as span attributes. Works with `@Traced()`, `@Span()`, and auto-traced methods.

<!-- typecheck: skip -->
```typescript
@Traced('order.create')
async createOrder(
  @SpanAttribute('order.customerId') customerId: string,
  @SpanAttribute('order.total') total: number,
  @SpanAttribute('order.items') items: OrderItem[],  // objects → JSON.stringify
): Promise<Order> { ... }
```

Values are recorded as:
- `string`, `number`, `boolean` → recorded as-is
- Objects/arrays → `JSON.stringify`
- `undefined`/`null` → skipped

## this.span

`BaseService` and `BaseController` provide a `this.span` getter for imperative access to the active OpenTelemetry span. The API is fully synchronous.

```typescript
@Service()
export class OrderService extends BaseService {
  @Traced()
  async processOrder(orderId: string): Promise<Order> {
    const order = await this.repository.findById(orderId);

    // Set attributes dynamically
    this.span?.setAttribute('order.status', order.status);
    this.span?.setAttribute('order.total', order.total);

    // Add events
    this.span?.addEvent('validation.started');
    await this.validate(order);
    this.span?.addEvent('validation.completed');

    // Record exceptions without throwing
    if (order.hasWarnings) {
      this.span?.addEvent('order.warnings', {
        count: order.warnings.length,
      });
    }

    return order;
  }
}
```

Returns `undefined` when no span is active (outside `@Traced` context).

## Trace Context

### Automatic HTTP Context

Trace context is automatically extracted from and propagated via HTTP headers:

```
traceparent: 00-abc123def456789-span123-01
tracestate: onebun=true
x-trace-id: abc123def456789
x-span-id: span123
```

### Accessing Current Context

```typescript
@Service()
export class MyService extends BaseService {
  async doSomething(): Promise<void> {
    // Access trace service
    const traceService = (globalThis as any).__onebunTraceService;

    if (traceService) {
      // Get current trace context
      const context = await Effect.runPromise(
        traceService.getCurrentTraceContext()
      );

      this.logger.info('Current trace', {
        traceId: context.traceId,
        spanId: context.spanId,
      });
    }
  }
}
```

### Context Propagation

When making HTTP calls, trace context is automatically propagated:

```typescript
import { createHttpClient } from '@onebun/core';

const client = createHttpClient({
  baseUrl: 'http://other-service:3000',
});

// Trace headers are automatically added to outgoing requests
const response = await client.get('/api/data');
```

## Manual Span Creation

```typescript
@Service()
export class OrderService extends BaseService {
  private traceService: any;

  constructor() {
    super();
    this.traceService = (globalThis as any).__onebunTraceService;
  }

  async processOrder(orderId: string): Promise<Order> {
    if (!this.traceService) {
      return this.doProcess(orderId);
    }

    // Start a span manually
    const span = await Effect.runPromise(
      this.traceService.startSpan('process-order', {
        orderId,
        operation: 'processOrder',
      })
    );

    try {
      // Add events during processing
      await Effect.runPromise(
        this.traceService.addEvent('validation-started')
      );

      await this.validateOrder(orderId);

      await Effect.runPromise(
        this.traceService.addEvent('validation-completed')
      );

      // Process the order
      const order = await this.doProcess(orderId);

      // Add attributes
      await Effect.runPromise(
        this.traceService.setAttributes({
          'order.status': order.status,
          'order.total': order.total,
        })
      );

      return order;
    } catch (error) {
      // Record error in span
      await Effect.runPromise(
        this.traceService.addEvent('error', {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      );
      throw error;
    } finally {
      // End the span
      await Effect.runPromise(
        this.traceService.endSpan(span)
      );
    }
  }
}
```

## Trace-Log Integration

Logs automatically include trace context:

```json
{
  "level": "info",
  "message": "Processing order",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "context": {
    "orderId": "abc-123"
  },
  "trace": {
    "traceId": "abc123def456789",
    "spanId": "span456",
    "parentSpanId": "span123"
  }
}
```

## Exporting Traces

OneBun exports traces via OTLP HTTP using a custom `fetch()`-based exporter (guaranteed Bun compatibility). When `exportOptions.endpoint` is configured, a `BasicTracerProvider` with `BatchSpanProcessor` is automatically registered.

### OTLP Exporter

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    serviceVersion: '1.0.0',
    exportOptions: {
      endpoint: 'http://localhost:4318',  // OTel Collector OTLP HTTP
      headers: {
        'Authorization': 'Bearer token',
      },
      timeout: 10000,    // request timeout (default: 10000ms)
      batchSize: 100,     // spans per batch (default: 100)
      batchTimeout: 5000, // max wait before flush (default: 5000ms)
    },
  },
});
```

Traces are batched and sent to `{endpoint}/v1/traces` in OTLP JSON format. On application shutdown a
final flush is attempted — attempted, not guaranteed: nothing retries a failed export, and the batch is
dropped from the buffer before the send is tried, so an unreachable collector loses it.

::: tip What shutdown does to the process-global registration
OpenTelemetry keeps **one** tracer provider per process, and it refuses a duplicate
registration. So in a process running several applications, only the first one to start
actually installs its provider; the others create theirs and are quietly refused.

Shutdown accounts for that:

- **An application that did not install the global leaves it alone.** If you registered your
  own OpenTelemetry SDK before starting the app, stopping the app does not touch it. It used to:
  the teardown called `trace.disable()` unconditionally, which unregisters the global whoever
  put it there.
- **When the owner stops and another OneBun application is still running, the global is handed
  over to it.** Tracing keeps working for the survivors instead of going silently dark.
- **Only when the last one stops is the registration removed.** Leaving a shut-down provider
  installed would accept spans and drop them without a word.

The failure this replaces was quiet and total: one `app.stop()` left every other application in
the process resolving a non-recording tracer, so every subsequent span carried an all-zero trace
id, correlated with nothing and was never exported.

One limit remains, and it is not fixed here: because duplicate registration is refused, a
non-first application's spans go to the FIRST application's provider and exporter, not to its
own. Its configured endpoint and service name are not used while it is a guest. Run one
application per process if the applications need different trace destinations.
:::

<llm-only>

**Technical details for AI agents — the global tracer provider slot:**
- `initTracerProvider(options)` in `packages/trace/src/provider.ts` builds the `BasicTracerProvider`, registers it, and returns `{ provider, shutdown }`. `TraceServiceImpl` holds that result and calls `shutdown()` from `OneBunApplication.stop()`
- Ownership is recorded from the RETURN VALUE of `trace.setGlobalTracerProvider(provider)`, which is `false` when something already holds the slot. A successful registration means the slot was empty and is now ours, regardless of what the module remembered — an earlier draft also required the remembered owner to be `null`, which left a provider installed but unowned after any external `trace.disable()`, so its own shutdown declined to release it
- `installedTracerProvider()` is exported and re-derives ownership from reality: `trace.getTracerProvider()` returns a `ProxyTracerProvider` wrapper, so identity is read through its public `getDelegate()`. Shutdown releases the global only when the remembered owner AND the installed delegate are both this provider
- Teardown has three cases and only the last disables anything: not the owner -> touch nothing; owner with another live provider -> `trace.disable()` immediately followed by `setGlobalTracerProvider(successor)`, because a duplicate registration would be refused; owner with nothing left -> `trace.disable()`
- `shutdown()` is idempotent via a `shutdownStarted` flag, and removes the provider from the live set BEFORE flushing so a concurrent shutdown cannot elect a provider that is on its way down. `releaseGlobal` runs in a `finally`, because a failed flush is still a dead provider

</llm-only>

::: warning The shutdown flush is not isolated from the rest of the teardown
The flush runs after the queue adapter disconnects and before `onModuleDestroy`, and it is awaited without a `try`/`catch`. If the collector is unreachable while spans are still buffered, the last batch export fails, the flush rejects, and the shutdown sequence stops there: `onModuleDestroy` / `onApplicationDestroy` hooks, the shared Redis release and the final log flush never run. `app.stop()` itself still resolves — the only trace of the failure is a `Shutdown sequence failed` error in the log. Until that step is guarded, point `exportOptions.endpoint` at a collector that outlives the app, or leave the endpoint unset in environments where it does not.
:::

### SigNoz / OTel Collector Integration

```yaml
# docker-compose.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318"    # OTLP HTTP
    volumes:
      - ./otel-config.yaml:/etc/otel/config.yaml
```

### Jaeger Integration

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # UI
      - "4318:4318"    # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

### Custom Exporter

For advanced use cases, you can use the `OtlpFetchSpanExporter` directly:

```typescript
import { OtlpFetchSpanExporter } from '@onebun/trace';

const exporter = new OtlpFetchSpanExporter({
  endpoint: 'http://localhost:4318',
  headers: { 'X-Custom': 'value' },
  timeout: 5000,
});
```

## Auto-Tracing

Automatically trace all async methods on services and controllers without adding `@Traced()` to each method.

### Global Auto-Trace

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    traceAll: true,  // ← all async methods auto-traced
    exportOptions: { endpoint: 'http://localhost:4318' },
  },
});
```

### Filtering

<!-- typecheck: skip -->
```typescript
tracing: {
  traceAll: true,
  traceFilter: {
    asyncOnly: true,             // default: only async methods
    excludeMethods: ['helper'],  // skip specific methods
    includeClasses: ['*Service', '*Repository'],  // only these
    excludeClasses: ['HealthController'],          // skip these
  },
}
```

### Class-Level Control

<!-- typecheck: skip -->
```typescript
import { TraceAll, NoTrace, Traced } from '@onebun/trace';

// Opt-out when traceAll is true
@Service()
@NoTrace()
class InternalService extends BaseService {
  async helper() { ... }   // NOT traced

  @Traced()
  async critical() { ... } // traced (method override)
}

// @TraceAll() never opts a class in — see the warning below
@Service()
@TraceAll()
class ImportantService extends BaseService {
  async findAll() { ... }  // NOT traced while traceAll is false
}
```

::: warning `@TraceAll()` cannot opt a class in
`@TraceAll()` has no effect today. The application hands auto-trace options to the module graph only when `traceAll: true`, and a class is inspected for `@TraceAll()` / `@NoTrace()` only when the module received those options — so with `traceAll: false` nothing is ever inspected, and with `traceAll: true` the class would have been traced anyway. To trace a subset, use `traceAll: true` narrowed by `traceFilter.includeClasses` / `excludeClasses`, or put `@Traced()` on the individual methods, which wraps at class-definition time and needs no wiring at all. `@NoTrace()` works as documented, because it only ever has to take effect while `traceAll` is true.
:::

### Priority

Method-level decorators always win over class-level. Class-level narrows the global setting but cannot widen it: `@NoTrace` takes a class out of `traceAll: true`, while `@TraceAll` cannot bring one into `traceAll: false`.

| Global | Class | Method | Result |
|--------|-------|--------|--------|
| `traceAll: true` | — | — | auto-traced |
| `traceAll: true` | `@NoTrace` | — | NOT traced |
| `traceAll: true` | `@NoTrace` | `@Traced` | traced |
| `traceAll: false` | `@TraceAll` | — | NOT traced (`@TraceAll` is never read) |
| `traceAll: false` | `@TraceAll` | `@Traced` | traced |
| any | — | `@Traced` | traced |

### Excluded Methods

These are never auto-traced (framework internals):
- Lifecycle hooks: `onModuleInit`, `onModuleDestroy`, etc.
- Base class methods: `success`, `error`, `json`, `text`, `sse`, etc.
- Constructor

## Sampling

Control what percentage of requests are traced:

<!-- typecheck: skip -->
```typescript
tracing: {
  // Sample 10% of requests in production
  samplingRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
}
```

## Best Practices

### 1. Meaningful Span Names

<!-- typecheck: skip -->
```typescript
// Good: descriptive, includes operation type
@Span('user-create')
@Span('order-process-payment')
@Span('cache-lookup')

// Bad: too generic
@Span('process')
@Span('do-thing')
```

### 2. Add Relevant Attributes

<!-- typecheck: skip -->
```typescript
@Span('user-find-by-id')
async findById(id: string): Promise<User | null> {
  // Add context that helps with debugging
  const traceService = (globalThis as any).__onebunTraceService;
  if (traceService) {
    await Effect.runPromise(
      traceService.setAttributes({
        'user.id': id,
        'db.system': 'postgresql',
        'db.operation': 'SELECT',
      })
    );
  }

  return this.repository.findById(id);
}
```

### 3. Trace Error Boundaries

<!-- typecheck: skip -->
```typescript
@Span('process-order')
async processOrder(orderId: string): Promise<Order> {
  try {
    return await this.doProcess(orderId);
  } catch (error) {
    // Trace service will record the error
    this.logger.error('Order processing failed', error);
    throw error;
  }
}
```

### 4. Don't Over-Trace

<!-- typecheck: skip -->
```typescript
// Good: trace business-significant operations
@Span('place-order')
async placeOrder(data: OrderData): Promise<Order> {}

// Avoid: tracing every tiny utility function
// @Span('format-date')  // Too granular
formatDate(date: Date): string {}
```

## Complete Example

```typescript
import { Module, Controller, BaseController, Service, BaseService, Get, Post, Param, Body, HttpException } from '@onebun/core';
import { Span } from '@onebun/trace';

// Service with comprehensive tracing
@Service()
export class OrderService extends BaseService {
  private traceService: any;

  constructor(
    private paymentService: PaymentService,
    private inventoryService: InventoryService,
  ) {
    super();
    this.traceService = (globalThis as any).__onebunTraceService;
  }

  @Span('order-create')
  async createOrder(data: CreateOrderDto): Promise<Order> {
    this.logger.info('Creating order', { customerId: data.customerId });

    // Validate items
    await this.validateItems(data.items);

    // Create order record
    const order = await this.repository.create(data);

    // Add trace attributes
    await this.addTraceAttributes({
      'order.id': order.id,
      'order.item_count': order.items.length,
      'order.total': order.total,
    });

    return order;
  }

  @Span('order-process-payment')
  async processPayment(orderId: string): Promise<PaymentResult> {
    const order = await this.repository.findById(orderId);

    // Nested traced call
    const result = await this.paymentService.charge({
      orderId,
      amount: order.total,
      currency: 'USD',
    });

    await this.addTraceEvent('payment-completed', {
      transactionId: result.transactionId,
      status: result.status,
    });

    return result;
  }

  @Span('order-validate-items')
  private async validateItems(items: OrderItem[]): Promise<void> {
    for (const item of items) {
      const available = await this.inventoryService.checkStock(item.productId);
      if (available < item.quantity) {
        await this.addTraceEvent('validation-failed', {
          productId: item.productId,
          requested: item.quantity,
          available,
        });
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }
    }

    await this.addTraceEvent('validation-passed', {
      itemCount: items.length,
    });
  }

  private async addTraceAttributes(attributes: Record<string, unknown>): Promise<void> {
    if (this.traceService) {
      await Effect.runPromise(
        this.traceService.setAttributes(attributes)
      );
    }
  }

  private async addTraceEvent(name: string, attributes?: Record<string, unknown>): Promise<void> {
    if (this.traceService) {
      await Effect.runPromise(
        this.traceService.addEvent(name, attributes)
      );
    }
  }
}

// Controller
@Controller('/orders')
export class OrderController extends BaseController {
  constructor(private orderService: OrderService) {
    super();
  }

  @Post('/')
  async create(@Body() body: CreateOrderDto) {
    const order = await this.orderService.createOrder(body);
    return this.success(order, 201);
  }

  @Post('/:id/pay')
  async pay(@Param('id') id: string) {
    return await this.orderService.processPayment(id);
  }
}

// Application with tracing
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'order-service',
    serviceVersion: '1.0.0',
    samplingRate: 1.0,
    defaultAttributes: {
      'service.name': 'order-service',
      'deployment.environment': process.env.NODE_ENV || 'development',
    },
    exportOptions: {
      endpoint: process.env.OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
    },
  },
});
```
