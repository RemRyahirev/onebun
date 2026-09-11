/**
 * Documentation Examples Tests for @onebun/metrics
 *
 * @source docs:api/metrics.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';
import { Counter, register as globalRegister } from 'prom-client';

import type { MetricsService as MetricsServiceInterface } from './metrics.service';

import { BaseService, Service } from '@onebun/core';

import {
  Timed,
  Counted,
  Gauged,
  MetricsMiddleware,
  createMetricsService,
} from './';

// Helper to create metrics service for tests
const getMetricsService = (): MetricsServiceInterface => {
  return Effect.runSync(createMetricsService({ prefix: 'test_' }));
};

describe('Metrics README Examples', () => {
  describe('Method Decorators (README)', () => {
    it('should have @Timed decorator available', () => {
      // From README: Method Decorators - @Timed
      expect(Timed).toBeDefined();
      expect(typeof Timed).toBe('function');
    });

    it('should have @Counted decorator available', () => {
      // From README: Method Decorators - @Counted
      expect(Counted).toBeDefined();
      expect(typeof Counted).toBe('function');
    });

    it('should have @Gauged decorator available', () => {
      expect(Gauged).toBeDefined();
      expect(typeof Gauged).toBe('function');
    });

    it('should use decorators on controller methods', () => {
      // From README: Method Decorators example
      class ApiController {
        @Timed('heavy_operation_duration')
        @Counted('heavy_operation_calls')
        async heavyOperation(): Promise<unknown> {
          // This method's execution time and call count will be automatically tracked
          return { success: true };
        }
      }

      expect(ApiController).toBeDefined();
      expect(typeof new ApiController().heavyOperation).toBe('function');
    });
  });

  describe('Configuration Options (README)', () => {
    it('should define valid metrics options', () => {
      // From README: Configuration Options
      const metricsOptions = {
        // Enable/disable metrics collection (default: true)
        enabled: true,

        // HTTP path for metrics endpoint (default: '/metrics')
        path: '/metrics',

        // Default labels for all metrics
        defaultLabels: {
          service: 'my-service',
          environment: 'development',
        },

        // Enable HTTP request metrics (default: true)
        collectHttpMetrics: true,

        // Enable system metrics (default: true)
        collectSystemMetrics: true,

        // Enable GC metrics (default: true)
        collectGcMetrics: true,

        // System metrics collection interval in ms (default: 5000)
        systemMetricsInterval: 5000,

        // Metric name prefix (default: 'onebun_')
        prefix: 'myapp_',

        // HTTP duration histogram buckets
        httpDurationBuckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      };

      expect(metricsOptions.enabled).toBe(true);
      expect(metricsOptions.path).toBe('/metrics');
      expect(metricsOptions.prefix).toBe('myapp_');
      expect(metricsOptions.systemMetricsInterval).toBe(5000);
    });
  });
});

describe('Metrics API Documentation Examples', () => {
  let metricsService: MetricsServiceInterface;

  beforeEach(() => {
    metricsService = getMetricsService();
    metricsService.clear();
  });

  afterEach(() => {
    metricsService.clear();
  });

  describe('MetricsService (docs/api/metrics.md)', () => {
    beforeEach(() => {
      // The application publishes the service here; `this.metrics` reads it back
      (globalThis as Record<string, unknown>).__onebunMetricsService = metricsService;
    });

    afterEach(() => {
      delete (globalThis as Record<string, unknown>).__onebunMetricsService;
    });

    /**
     * @source docs:api/metrics.md#accessing-metricsservice
     */
    it('should record what a BaseService counts through this.metrics', async () => {
      // From docs: `this.metrics` is available in any BaseService or Controller
      @Service()
      class OrderService extends BaseService {
        async createOrder(status: string): Promise<{ status: string }> {
          const counter = this.metrics?.createCounter({
            name: 'orders_created_total',
            help: 'Total number of orders created',
            labelNames: ['status'],
          });

          counter?.inc({ status });

          return { status };
        }

        // Exposes the protected getter so the test can assert which instance it resolves to
        resolveMetrics(): MetricsServiceInterface | undefined {
          return this.metrics;
        }
      }

      const orderService = new OrderService();

      // The getter hands back the very service the application registered, not a fresh one
      expect(orderService.resolveMetrics()).toBe(metricsService);

      expect(await orderService.createOrder('completed')).toEqual({ status: 'completed' });

      // The counter the service created lives in the shared registry under the configured prefix
      const registered = metricsService.getMetric<Counter<string>>('orders_created_total');
      expect(registered).toBeInstanceOf(Counter);

      // ...and writing through the registry keeps feeding the same series
      registered?.inc({ status: 'completed' });

      const output = await metricsService.getMetrics();
      expect(output).toContain('# HELP test_orders_created_total Total number of orders created');
      expect(output).toContain('# TYPE test_orders_created_total counter');
      expect(output).toContain('test_orders_created_total{status="completed"} 2');
    });

    /**
     * @source docs:api/metrics.md#accessing-metricsservice
     */
    it('should yield a usable service from createMetricsService', async () => {
      // From docs: MetricsService usage
      // Use createMetricsService() to get an Effect that yields the service
      const service = Effect.runSync(createMetricsService({ prefix: 'factory_' }));

      service.createCounter({ name: 'orders_created_total', help: 'Total number of orders created' }).inc(3);
      service.createGauge({ name: 'orders_pending', help: 'Number of pending orders' }).set(7);
      service.createHistogram({
        name: 'order_duration_seconds',
        help: 'Order duration',
        buckets: [1],
      }).observe(0.5);

      const output = await service.getMetrics();
      expect(output).toContain('factory_orders_created_total 3');
      expect(output).toContain('factory_orders_pending 7');
      expect(output).toContain('factory_order_duration_seconds_bucket{le="1"} 1');
    });
  });

  describe('Counter (docs/api/metrics.md)', () => {
    /**
     * @source docs:api/metrics.md#counter
     */
    it('should create and use counter', async () => {
      // From docs: Counter example
      // createCounter returns a prom-client Counter object
      const requestsCounter = metricsService.createCounter({
        name: 'requests_total',
        help: 'Total requests',
        labelNames: ['method', 'endpoint'],
      });

      // Increment counter using prom-client API
      requestsCounter.inc({ method: 'GET', endpoint: '/api/users' });

      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('requests_total');
    });
  });

  describe('Gauge (docs/api/metrics.md)', () => {
    /**
     * @source docs:api/metrics.md#gauge
     */
    it('should create and use gauge', async () => {
      // From docs: Gauge example
      // createGauge returns a prom-client Gauge object
      const connectionsGauge = metricsService.createGauge({
        name: 'active_connections',
        help: 'Active connections',
      });

      // Use prom-client Gauge API
      connectionsGauge.set(42);
      connectionsGauge.inc();
      connectionsGauge.dec();

      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('active_connections');
    });
  });

  describe('Histogram (docs/api/metrics.md)', () => {
    /**
     * @source docs:api/metrics.md#histogram
     */
    it('should create and use histogram', async () => {
      // From docs: Histogram example
      // createHistogram returns a prom-client Histogram object
      const responseTimeHistogram = metricsService.createHistogram({
        name: 'response_time_seconds',
        help: 'Response time in seconds',
        buckets: [0.1, 0.5, 1, 2, 5],
      });

      // Observe value using prom-client API
      responseTimeHistogram.observe(1.23);

      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('response_time_seconds');
    });
  });

  describe('Custom Metrics in Services (README)', () => {
    it('should register custom metrics pattern', async () => {
      // From README: Custom Metrics in Services example
      // Create custom metrics - returns prom-client metric objects
      const loginsCounter = metricsService.createCounter({
        name: 'user_logins_total',
        help: 'Total number of user logins',
        labelNames: ['method', 'status'],
      });

      const activeUsersGauge = metricsService.createGauge({
        name: 'active_users',
        help: 'Number of currently active users',
      });

      // Simulate login using prom-client API
      loginsCounter.inc({ method: 'password', status: 'success' });
      activeUsersGauge.inc();

      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('user_logins_total');
      expect(metrics).toContain('active_users');
    });
  });

  describe('Service Metrics Pattern (docs/api/metrics.md)', () => {
    /**
     * @source docs:api/metrics.md#service-metrics-pattern
     */
    it('should implement payment service metrics pattern', async () => {
      // From docs: Service Metrics Pattern
      // Register custom metrics on service init
      const paymentsCounter = metricsService.createCounter({
        name: 'payments_processed_total',
        help: 'Total number of payments processed',
        labelNames: ['status', 'method'],
      });

      const processingHistogram = metricsService.createHistogram({
        name: 'payment_processing_seconds',
        help: 'Payment processing duration',
        buckets: [0.1, 0.5, 1, 2, 5, 10],
      });

      const queueGauge = metricsService.createGauge({
        name: 'payment_queue_size',
        help: 'Current payment queue size',
      });

      // Simulate payment processing
      const startTime = Date.now();

      // Record success using prom-client API
      paymentsCounter.inc({ status: 'success', method: 'credit_card' });

      // Record duration
      const duration = (Date.now() - startTime) / 1000;
      processingHistogram.observe(duration);

      // Set queue size
      queueGauge.set(5);

      const metrics = await metricsService.getMetrics();
      expect(metrics).toContain('payments_processed_total');
      expect(metrics).toContain('payment_processing_seconds');
      expect(metrics).toContain('payment_queue_size');
    });
  });

  describe('Built-in Metrics Format (docs/api/metrics.md)', () => {
    it('should describe HTTP metrics format', () => {
      // From docs: Built-in Metrics - HTTP Metrics
      // These are the metrics that would be automatically collected
      const expectedMetrics = [
        'http_request_duration_seconds_bucket',
        'http_request_duration_seconds_sum',
        'http_request_duration_seconds_count',
        'http_requests_total',
      ];

      // Just verifying the expected metric names
      expectedMetrics.forEach((metric) => {
        expect(typeof metric).toBe('string');
      });
    });

    it('should describe System metrics format', () => {
      // From docs: Built-in Metrics - System Metrics
      // These match the actual metric names created in MetricsService.initializeSystemMetrics()
      const expectedMetrics = [
        'memory_usage_bytes',
        'cpu_usage_ratio',
        'uptime_seconds',
      ];

      // Just verifying the expected metric names
      expectedMetrics.forEach((metric) => {
        expect(typeof metric).toBe('string');
      });
    });
  });

  describe('Middleware (docs/api/metrics.md)', () => {
    it('should have MetricsMiddleware class', () => {
      expect(MetricsMiddleware).toBeDefined();
      expect(typeof MetricsMiddleware).toBe('function');
    });
  });
});

describe('this.metrics access pattern (docs/api/metrics.md)', () => {
  let metricsService: MetricsServiceInterface;

  beforeEach(() => {
    metricsService = getMetricsService();
    metricsService.clear();
    (globalThis as Record<string, unknown>).__onebunMetricsService = metricsService;
  });

  afterEach(() => {
    metricsService.clear();
    delete (globalThis as Record<string, unknown>).__onebunMetricsService;
  });

  it('should access metrics via globalThis pattern', () => {
    // From docs: this.metrics getter reads from globalThis.__onebunMetricsService
    const service = (globalThis as Record<string, unknown>).__onebunMetricsService as MetricsServiceInterface;
    expect(service).toBeDefined();
    expect(typeof service.createCounter).toBe('function');
    expect(typeof service.createGauge).toBe('function');
    expect(typeof service.createHistogram).toBe('function');
  });
});

describe('Prometheus Format (docs/api/metrics.md)', () => {
  it('should produce Prometheus-compatible output', async () => {
    const service = getMetricsService();
    service.clear();

    const counter = service.createCounter({
      name: 'test_counter',
      help: 'Test counter',
    });

    // Use prom-client API to increment
    counter.inc();

    const metrics = await service.getMetrics();

    // Prometheus format should contain HELP and TYPE comments
    expect(metrics).toContain('# HELP');
    expect(metrics).toContain('# TYPE');
    expect(metrics).toContain('test_counter');
  });
});

/**
 * The documented promise: applying a decorator is enough.
 *
 * @source docs:api/metrics.md#decorator-based-metrics
 */
describe('decorators create the metric they record into', () => {
  let metricsService: MetricsServiceInterface;

  beforeEach(() => {
    metricsService = getMetricsService();
    metricsService.clear();
    (globalThis as Record<string, unknown>).__onebunMetricsService = metricsService;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__onebunMetricsService;
    metricsService.clear();
  });

  it('records a @Timed histogram with no prior registration', async () => {
    // The decorators used to only LOOK the metric up and do nothing when it was absent. Since
    // nothing created it, the documented snippet recorded nothing — silently, in the direction
    // that hides itself: the method ran, the scrape answered, the series never appeared.
    @Service()
    class OrderService extends BaseService {
      @Timed('order_processing_duration_seconds')
      async process(): Promise<string> {
        return 'done';
      }
    }

    await new OrderService().process();

    // Read from the SCRAPE, not from the registry object: that is what an operator sees, and it
    // is where the missing series was missing.
    const scrape = await metricsService.getMetrics();

    expect(scrape).toContain('test_order_processing_duration_seconds');
    expect(scrape).toContain('test_order_processing_duration_seconds_count 1');
  });

  it('records a @Counted counter with no prior registration', async () => {
    @Service()
    class SignupService extends BaseService {
      @Counted('signups_total')
      register(): void {
        // no body needed — the decorator is the subject
      }
    }

    const service = new SignupService();
    service.register();
    service.register();

    const scrape = await metricsService.getMetrics();

    expect(scrape).toContain('test_signups_total 2');
  });

  it('reuses the metric across calls rather than recreating it', async () => {
    // Creating on every call would throw on the second one, or silently reset the series.
    @Service()
    class PingService extends BaseService {
      @Counted('pings_total')
      ping(): void {
        // counted only
      }
    }

    const service = new PingService();
    for (let i = 0; i < 5; i++) {
      service.ping();
    }

    const scrape = await metricsService.getMetrics();

    expect(scrape).toContain('test_pings_total 5');
  });

  it('honours a metric the application registered by hand', async () => {
    // The pre-registration path still wins: an explicit createHistogram with real buckets and
    // help text is not overwritten by the decorator's generated one.
    metricsService.createHistogram({
      name: 'explicit_duration_seconds',
      help: 'Written by the application',
      buckets: [0.5, 1],
    });

    @Service()
    class ExplicitService extends BaseService {
      @Timed('explicit_duration_seconds')
      async work(): Promise<void> {
        // timed only
      }
    }

    await new ExplicitService().work();

    const scrape = await metricsService.getMetrics();

    expect(scrape).toContain('Written by the application');
    expect(scrape).toContain('test_explicit_duration_seconds_count 1');
  });

  it('shows the name prefixed on the scrape though the decorator takes it unprefixed', async () => {
    // Its own source of "my metric is missing": the decorator is given `cache_hits_total` and
    // the scrape shows `test_cache_hits_total`.
    @Service()
    class CacheStats extends BaseService {
      @Counted('cache_hits_total')
      hit(): void {
        // counted only
      }
    }

    new CacheStats().hit();

    const scrape = await metricsService.getMetrics();

    expect(scrape).toContain('test_cache_hits_total');
    expect(scrape).not.toContain('\ncache_hits_total');
  });
});

describe('One registry per application (docs/api/metrics.md)', () => {
  /**
   * @source docs:api/metrics.md#one-registry-per-application
   */
  it('puts an application back on the global registry when asked', async () => {
    // From docs: a metric registered against prom-client's global `register` no longer appears
    // in any application's /metrics — unless that application opted back onto it.
    const external = new Counter({
      name: 'docs_externally_registered_total',
      help: 'registered against the global registry rather than through the service',
      registers: [globalRegister],
    });
    external.inc();

    const optedIn = Effect.runSync(createMetricsService({ registry: globalRegister, prefix: 'optedin_' }));
    const isolated = Effect.runSync(createMetricsService({ prefix: 'isolated_' }));

    expect(await optedIn.getMetrics()).toContain('docs_externally_registered_total');
    expect(await isolated.getMetrics()).not.toContain('docs_externally_registered_total');

    // And the framework says so once rather than serving a silently shorter body.
    expect(isolated.getOrphanedMetricNames()).toContain('docs_externally_registered_total');
    expect(optedIn.getOrphanedMetricNames()).toEqual([]);

    optedIn.dispose();
    isolated.dispose();
    globalRegister.removeSingleMetric('docs_externally_registered_total');
  });
});
