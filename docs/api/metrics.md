# Metrics API

Package: `@onebun/metrics`

## Overview

OneBun provides Prometheus-compatible metrics with:
- Automatic HTTP request metrics
- System metrics (CPU, memory, event loop)
- Custom counters, gauges, and histograms

## Enabling Metrics

### In Application

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  metrics: {
    enabled: true,
    path: '/metrics',
    prefix: 'myapp_',
    collectHttpMetrics: true,
    collectSystemMetrics: true,
    collectGcMetrics: true,
    systemMetricsInterval: 5000,
    defaultLabels: {
      service: 'my-service',
      environment: process.env.NODE_ENV || 'development',
    },
  },
});
```

### Configuration Options

```typescript
interface MetricsOptions {
  /** Enable/disable metrics (default: true) */
  enabled?: boolean;

  /** HTTP path for metrics endpoint (default: '/metrics') */
  path?: string;

  /** Default labels for all metrics */
  defaultLabels?: Record<string, string>;

  /** Enable HTTP request metrics (default: true) */
  collectHttpMetrics?: boolean;

  /** Enable system metrics (default: true) */
  collectSystemMetrics?: boolean;

  /** Enable GC metrics (default: true) */
  collectGcMetrics?: boolean;

  /** System metrics collection interval in ms (default: 5000) */
  systemMetricsInterval?: number;

  /** Metric name prefix (default: 'onebun_') */
  prefix?: string;

  /** HTTP request duration histogram buckets */
  httpDurationBuckets?: number[];
}
```

## Built-in Metrics

### HTTP Metrics

```
# Request duration histogram
http_request_duration_seconds_bucket{method="GET",route="/api/users",status_code="200",le="0.1"}
http_request_duration_seconds_sum{method="GET",route="/api/users",status_code="200"}
http_request_duration_seconds_count{method="GET",route="/api/users",status_code="200"}

# Request counter
http_requests_total{method="GET",route="/api/users",status_code="200"}
```

### System Metrics

```
# Process CPU
process_cpu_seconds_total
process_cpu_user_seconds_total
process_cpu_system_seconds_total

# Memory
process_memory_bytes{type="rss"}
process_memory_bytes{type="heapTotal"}
process_memory_bytes{type="heapUsed"}
process_memory_bytes{type="external"}

# Event loop lag
nodejs_eventloop_lag_seconds

# Active handles and requests
nodejs_active_handles_total
nodejs_active_requests_total
```

## Custom Metrics

### Accessing MetricsService

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class OrderService extends BaseService {
  private metricsService: any;

  constructor() {
    super();
    // Get global metrics service
    this.metricsService = (globalThis as any).__onebunMetricsService;
  }
}
```

### Counter

Track cumulative values that only increase.

```typescript
// Create counter - returns prom-client Counter object
const ordersCounter = this.metricsService.createCounter({
  name: 'orders_created_total',
  help: 'Total number of orders created',
  labelNames: ['status', 'payment_method'],
});

// Increment using prom-client API
ordersCounter.inc({ status: 'completed', payment_method: 'credit_card' });

// Increment by value
ordersCounter.inc({ status: 'completed', payment_method: 'credit_card' }, 5);
```

### Gauge

Track values that can go up and down.

```typescript
// Create gauge - returns prom-client Gauge object
const pendingGauge = this.metricsService.createGauge({
  name: 'orders_pending',
  help: 'Number of pending orders',
  labelNames: ['priority'],
});

// Set value using prom-client API
pendingGauge.set({ priority: 'high' }, 42);

// Increment
pendingGauge.inc({ priority: 'high' });

// Decrement
pendingGauge.dec({ priority: 'high' });
```

### Histogram

Track distributions of values.

```typescript
// Create histogram - returns prom-client Histogram object
const processingHistogram = this.metricsService.createHistogram({
  name: 'order_processing_duration_seconds',
  help: 'Order processing duration in seconds',
  labelNames: ['order_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// Observe value using prom-client API
const startTime = Date.now();
// ... process order ...
const duration = (Date.now() - startTime) / 1000;

processingHistogram.observe({ order_type: 'standard' }, duration);
```

## Decorator-based Metrics

### @Timed()

Automatically time method execution.

```typescript
import { Timed } from '@onebun/metrics';

@Service()
export class OrderService extends BaseService {
  @Timed('order_processing_duration_seconds', { order_type: 'standard' })
  async processOrder(orderId: string): Promise<Order> {
    // Method execution time is automatically recorded
    return this.doProcess(orderId);
  }
}
```

### @Counted()

Automatically count method calls.

```typescript
import { Counted } from '@onebun/metrics';

@Service()
export class EmailService extends BaseService {
  @Counted('emails_sent_total', { type: 'transactional' })
  async sendEmail(to: string, subject: string): Promise<void> {
    // Counter incremented on each call
    await this.smtp.send({ to, subject });
  }
}
```

## Service Metrics Pattern

```typescript
import type { Counter, Gauge, Histogram } from 'prom-client';

@Service()
export class PaymentService extends BaseService {
  private metricsService: any;
  private paymentsCounter?: Counter<string>;
  private processingHistogram?: Histogram<string>;
  private queueGauge?: Gauge<string>;

  constructor() {
    super();
    this.metricsService = (globalThis as any).__onebunMetricsService;

    // Register custom metrics on service init
    this.registerMetrics();
  }

  private registerMetrics(): void {
    if (!this.metricsService) return;

    // Store references to metric objects for later use
    this.paymentsCounter = this.metricsService.createCounter({
      name: 'payments_processed_total',
      help: 'Total number of payments processed',
      labelNames: ['status', 'method'],
    });

    this.processingHistogram = this.metricsService.createHistogram({
      name: 'payment_processing_seconds',
      help: 'Payment processing duration',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    this.queueGauge = this.metricsService.createGauge({
      name: 'payment_queue_size',
      help: 'Current payment queue size',
    });
  }

  async processPayment(payment: Payment): Promise<PaymentResult> {
    const startTime = Date.now();

    try {
      const result = await this.gateway.charge(payment);

      // Record success using prom-client API
      this.paymentsCounter?.inc({ status: 'success', method: payment.method });

      return result;
    } catch (error) {
      // Record failure
      this.paymentsCounter?.inc({ status: 'failure', method: payment.method });

      throw error;
    } finally {
      // Record duration
      const duration = (Date.now() - startTime) / 1000;
      this.processingHistogram?.observe(duration);
    }
  }

  updateQueueSize(size: number): void {
    this.queueGauge?.set(size);
  }
}
```

## Metrics Endpoint

Access metrics at the configured path (default `/metrics`):

```bash
curl http://localhost:3000/metrics
```

**Response (Prometheus format):**

```
# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/api/users",status_code="200",le="0.1"} 42
http_request_duration_seconds_bucket{method="GET",route="/api/users",status_code="200",le="0.5"} 87
http_request_duration_seconds_bucket{method="GET",route="/api/users",status_code="200",le="1"} 95
http_request_duration_seconds_sum{method="GET",route="/api/users",status_code="200"} 12.45
http_request_duration_seconds_count{method="GET",route="/api/users",status_code="200"} 95

# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/users",status_code="200"} 95

# HELP process_memory_bytes Process memory usage in bytes
# TYPE process_memory_bytes gauge
process_memory_bytes{type="rss"} 52428800
process_memory_bytes{type="heapTotal"} 20971520
process_memory_bytes{type="heapUsed"} 15728640
```

## Prometheus Integration

### prometheus.yml

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'onebun-app'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

### Grafana Dashboard

Common queries for Grafana:

```promql
# Request rate (requests per second)
rate(http_requests_total[5m])

# Request duration 95th percentile
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Error rate
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Memory usage
process_memory_bytes{type="heapUsed"}

# Custom metric
rate(payments_processed_total{status="success"}[5m])
```

## Complete Example

```typescript
import { Module, Controller, BaseController, Service, BaseService, Get, Post, Body } from '@onebun/core';
import type { Counter, Gauge, Histogram } from 'prom-client';

// Service with custom metrics
@Service()
export class AnalyticsService extends BaseService {
  private metricsService: any;
  private eventsCounter?: Counter<string>;
  private processingHistogram?: Histogram<string>;
  private queueGauge?: Gauge<string>;

  constructor() {
    super();
    this.metricsService = (globalThis as any).__onebunMetricsService;
    this.initMetrics();
  }

  private initMetrics(): void {
    if (!this.metricsService) return;

    // Store references to prom-client metric objects
    this.eventsCounter = this.metricsService.createCounter({
      name: 'analytics_events_total',
      help: 'Total analytics events',
      labelNames: ['event_type', 'source'],
    });

    this.processingHistogram = this.metricsService.createHistogram({
      name: 'analytics_processing_seconds',
      help: 'Analytics event processing time',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
    });

    this.queueGauge = this.metricsService.createGauge({
      name: 'analytics_queue_depth',
      help: 'Current queue depth',
    });
  }

  async trackEvent(eventType: string, source: string, data: unknown): Promise<void> {
    const startTime = performance.now();

    try {
      // Process event
      await this.processEvent(eventType, data);

      // Record metrics using prom-client API
      this.eventsCounter?.inc({ event_type: eventType, source });
    } finally {
      const duration = (performance.now() - startTime) / 1000;
      this.processingHistogram?.observe(duration);
    }
  }

  updateQueueDepth(depth: number): void {
    this.queueGauge?.set(depth);
  }

  private async processEvent(eventType: string, data: unknown): Promise<void> {
    // Event processing logic
    this.logger.debug('Processing event', { eventType });
  }
}

// Controller
@Controller('/analytics')
export class AnalyticsController extends BaseController {
  constructor(private analyticsService: AnalyticsService) {
    super();
  }

  @Post('/track')
  async track(@Body() body: { event: string; source: string; data?: unknown }): Promise<Response> {
    await this.analyticsService.trackEvent(body.event, body.source, body.data);
    return this.success({ tracked: true });
  }
}

// Module
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```
