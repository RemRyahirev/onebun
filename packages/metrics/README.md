# @onebun/metrics

Prometheus-compatible metrics module for OneBun framework providing automatic HTTP request metrics, system metrics, and custom metrics API.

## Features

- 📊 **Automatic HTTP Metrics** - Automatically collects HTTP request duration, count, and status codes
- 🖥️ **System Metrics** - Memory usage, CPU usage, and process uptime
- 🗑️ **GC Metrics** - Garbage collection duration and frequency
- 🎯 **Custom Metrics** - Easy to use API for creating counters, gauges, histograms, and summaries
- 🏷️ **Prometheus Compatible** - Standard Prometheus exposition format
- 🎨 **Decorators** - Method decorators for automatic metrics collection
- ⚡ **Effect.js Integration** - Full integration with Effect.js ecosystem

## Installation

```bash
bun add @onebun/metrics
```

## Basic Usage

### Application Setup

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  metrics: {
    enabled: true,
    path: '/metrics',
    collectHttpMetrics: true,
    collectSystemMetrics: true,
    collectGcMetrics: true,
    prefix: 'myapp_'
  }
});

await app.start();
```

### Custom Metrics in Services

```typescript
import { Service } from '@onebun/core';
import { MetricsService, MetricType } from '@onebun/metrics';

@Service()
export class UserService {
  private userLoginCounter: Counter<string>;
  private activeUsersGauge: Gauge<string>;

  constructor(private metricsService: MetricsService) {
    // Create custom metrics
    this.userLoginCounter = this.metricsService.createCounter({
      name: 'user_logins_total',
      help: 'Total number of user logins',
      labelNames: ['method', 'status']
    });

    this.activeUsersGauge = this.metricsService.createGauge({
      name: 'active_users',
      help: 'Number of currently active users'
    });
  }

  async login(method: string): Promise<void> {
    try {
      // Login logic here
      this.userLoginCounter.inc({ method, status: 'success' });
      this.activeUsersGauge.inc();
    } catch (error) {
      this.userLoginCounter.inc({ method, status: 'failure' });
      throw error;
    }
  }
}
```

### Method Decorators

```typescript
import { Controller, Get } from '@onebun/core';
import { MeasureTime, CountCalls } from '@onebun/metrics';

@Controller('/api')
export class ApiController {
  
  @Get('/heavy-operation')
  @MeasureTime('heavy_operation_duration')
  @CountCalls('heavy_operation_calls')
  async heavyOperation(): Promise<any> {
    // This method's execution time and call count will be automatically tracked
    await someHeavyWork();
    return { success: true };
  }
}
```

## Configuration Options

```typescript
interface MetricsOptions {
  // Enable/disable metrics collection (default: true)
  enabled?: boolean;

  // HTTP path for metrics endpoint (default: '/metrics')
  path?: string;

  // Default labels for all metrics
  defaultLabels?: Record<string, string>;

  // Enable HTTP request metrics (default: true)
  collectHttpMetrics?: boolean;

  // Enable system metrics (default: true)
  collectSystemMetrics?: boolean;

  // Enable GC metrics (default: true)
  collectGcMetrics?: boolean;

  // System metrics collection interval in ms (default: 5000)
  systemMetricsInterval?: number;

  // Metric name prefix (default: 'onebun_')
  prefix?: string;

  // HTTP duration histogram buckets
  httpDurationBuckets?: number[];
}
```

## Automatic Metrics

When enabled, the following metrics are automatically collected:

### HTTP Metrics
- `{prefix}http_requests_total` - Total HTTP requests by method, route, status code, controller, action
- `{prefix}http_request_duration_seconds` - HTTP request duration histogram

### System Metrics
- `{prefix}memory_usage_bytes` - Memory usage by type (rss, heap_used, heap_total, external)
- `{prefix}cpu_usage_ratio` - CPU usage ratio
- `{prefix}uptime_seconds` - Process uptime

### GC Metrics (from prom-client)
- `{prefix}nodejs_gc_duration_seconds` - Garbage collection duration
- `{prefix}nodejs_heap_*` - Various heap metrics
- `{prefix}nodejs_version_info` - Node.js version information

## Custom Metrics API

### Counter
```typescript
const requestCounter = metricsService.createCounter({
  name: 'requests_total',
  help: 'Total requests',
  labelNames: ['method', 'endpoint']
});

requestCounter.inc({ method: 'GET', endpoint: '/api/users' });
```

### Gauge
```typescript
const activeConnectionsGauge = metricsService.createGauge({
  name: 'active_connections',
  help: 'Active connections'
});

activeConnectionsGauge.set(42);
activeConnectionsGauge.inc();
activeConnectionsGauge.dec();
```

### Histogram
```typescript
const responseTimeHistogram = metricsService.createHistogram({
  name: 'response_time_seconds',
  help: 'Response time in seconds',
  buckets: [0.1, 0.5, 1, 2, 5]
});

responseTimeHistogram.observe(1.23);
```

### Summary
```typescript
const requestSizeSummary = metricsService.createSummary({
  name: 'request_size_bytes',
  help: 'Request size in bytes',
  percentiles: [0.5, 0.9, 0.95, 0.99]
});

requestSizeSummary.observe(1024);
```

## Effect.js Integration

```typescript
import { Effect } from 'effect';
import { measureExecutionTime, recordHttpMetrics } from '@onebun/metrics';

// Measure execution time with Effect
const timedOperation = measureExecutionTime(
  'my_operation_duration',
  Effect.succeed('Hello World')
);

// Record HTTP metrics
const recordMetrics = recordHttpMetrics({
  method: 'GET',
  route: '/api/test',
  statusCode: 200,
  duration: 0.123,
  controller: 'TestController',
  action: 'test'
});
```

## Viewing Metrics

Once configured, metrics are available at the configured endpoint (default: `/metrics`):

```bash
curl http://localhost:3000/metrics
```

This returns metrics in Prometheus exposition format, which can be scraped by Prometheus or viewed directly.

## Performance Considerations

- System metrics collection interval can be adjusted based on your needs
- HTTP metrics have minimal overhead (< 1ms per request)
- GC metrics are collected by the underlying prom-client library
- Consider using sampling for high-traffic applications

## Integration with Monitoring

The metrics endpoint is compatible with:
- **Prometheus** - For scraping and storage
- **Grafana** - For visualization and dashboards
- **AlertManager** - For alerting based on metrics
- Any other Prometheus-compatible monitoring solution

## License

[LGPL-3.0](../../LICENSE) 