/**
 * Documentation Examples Tests for @onebun/metrics
 *
 * This file tests code examples from:
 * - packages/metrics/README.md
 * - docs/api/metrics.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import type { MetricsService as MetricsServiceInterface } from './metrics.service';

import {
  MeasureTime,
  CountCalls,
  MetricsMiddleware,
  createMetricsService,
} from './';

// Helper to create metrics service for tests
const getMetricsService = (): MetricsServiceInterface => {
  return Effect.runSync(createMetricsService({ prefix: 'test_' }));
};

describe('Metrics README Examples', () => {
  describe('Method Decorators (README)', () => {
    it('should have @MeasureTime decorator available', () => {
      // From README: Method Decorators - @MeasureTime
      expect(MeasureTime).toBeDefined();
      expect(typeof MeasureTime).toBe('function');
    });

    it('should have @CountCalls decorator available', () => {
      // From README: Method Decorators - @CountCalls
      expect(CountCalls).toBeDefined();
      expect(typeof CountCalls).toBe('function');
    });

    it('should use decorators on controller methods', () => {
      // From README: Method Decorators example
      class ApiController {
        @MeasureTime('heavy_operation_duration')
        @CountCalls('heavy_operation_calls')
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
    it('should create metrics service instance', () => {
      // From docs: MetricsService usage
      // Use createMetricsService() to get an Effect that yields the service
      const service = Effect.runSync(createMetricsService());

      expect(service).toBeDefined();
      expect(typeof service.createCounter).toBe('function');
      expect(typeof service.createGauge).toBe('function');
      expect(typeof service.createHistogram).toBe('function');
    });
  });

  describe('Counter (docs/api/metrics.md)', () => {
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
      const expectedMetrics = [
        'process_cpu_seconds_total',
        'process_cpu_user_seconds_total',
        'process_cpu_system_seconds_total',
        'process_memory_bytes',
        'nodejs_eventloop_lag_seconds',
        'nodejs_active_handles_total',
        'nodejs_active_requests_total',
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
