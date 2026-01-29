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
import { Service, BaseService, Span } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  @Span('find-user-by-id')
  async findById(id: string): Promise<User | null> {
    // This method execution is traced
    return this.repository.findById(id);
  }

  @Span()  // Uses method name as span name
  async processUser(user: User): Promise<void> {
    // Span name: "processUser"
    await this.validate(user);
    await this.save(user);
  }

  @Span('user-search')
  async search(query: string): Promise<User[]> {
    // Nested spans are automatically linked
    const normalized = await this.normalizeQuery(query);
    return this.repository.search(normalized);
  }

  @Span('normalize-query')
  private async normalizeQuery(query: string): Promise<string> {
    return query.toLowerCase().trim();
  }
}
```

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

### OTLP Exporter

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    exportOptions: {
      endpoint: 'http://jaeger:4318/v1/traces',  // OTLP HTTP endpoint
      headers: {
        'Authorization': 'Bearer token',
      },
      timeout: 10000,
      batchSize: 100,
      batchTimeout: 5000,
    },
  },
});
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

## Sampling

Control what percentage of requests are traced:

```typescript
tracing: {
  // Sample 10% of requests in production
  samplingRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
}
```

## Best Practices

### 1. Meaningful Span Names

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
import { Module, Controller, BaseController, Service, BaseService, Get, Post, Param, Body, Span } from '@onebun/core';

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
  async create(@Body() body: CreateOrderDto): Promise<Response> {
    const order = await this.orderService.createOrder(body);
    return this.success(order, 201);
  }

  @Post('/:id/pay')
  async pay(@Param('id') id: string): Promise<Response> {
    const result = await this.orderService.processPayment(id);
    return this.success(result);
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
