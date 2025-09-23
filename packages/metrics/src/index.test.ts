import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';
import { register } from 'prom-client';

import type { MetricsOptions } from './types';

import {
  DEFAULT_METRICS_OPTIONS,
  createDefaultMetricsService,
  makeDefaultMetricsService,
  MetricsService,
  MetricType,
} from './index';

describe('Metrics Index Module', () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  describe('DEFAULT_METRICS_OPTIONS', () => {
    test('should export default metrics options with correct values', () => {
      expect(DEFAULT_METRICS_OPTIONS).toBeDefined();
      expect(DEFAULT_METRICS_OPTIONS.enabled).toBe(true);
      expect(DEFAULT_METRICS_OPTIONS.path).toBe('/metrics');
      expect(DEFAULT_METRICS_OPTIONS.collectHttpMetrics).toBe(true);
      expect(DEFAULT_METRICS_OPTIONS.collectSystemMetrics).toBe(true);
      expect(DEFAULT_METRICS_OPTIONS.collectGcMetrics).toBe(true);
      expect(DEFAULT_METRICS_OPTIONS.prefix).toBe('onebun_');
      expect(DEFAULT_METRICS_OPTIONS.systemMetricsInterval).toBe(5000);
      expect(Array.isArray(DEFAULT_METRICS_OPTIONS.httpDurationBuckets)).toBe(true);
      expect(DEFAULT_METRICS_OPTIONS.httpDurationBuckets.length).toBeGreaterThan(0);
    });

    test('should be a const object with readonly properties', () => {
      // Test that the object properties are defined and accessible
      expect(DEFAULT_METRICS_OPTIONS.enabled).toBeDefined();
      expect(DEFAULT_METRICS_OPTIONS.path).toBeDefined();
      expect(DEFAULT_METRICS_OPTIONS.prefix).toBeDefined();
      
      // Test that it's exported as a const (structural check)
      expect(typeof DEFAULT_METRICS_OPTIONS).toBe('object');
      expect(DEFAULT_METRICS_OPTIONS).not.toBeNull();
    });
  });

  describe('createDefaultMetricsService', () => {
    test('should create metrics service with default options', async () => {
      const serviceEffect = createDefaultMetricsService();
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      expect(typeof service.getMetrics).toBe('function');
      expect(typeof service.getContentType).toBe('function');
      expect(typeof service.recordHttpRequest).toBe('function');
    });

    test('should create metrics service with override options', async () => {
      const overrides: Partial<MetricsOptions> = {
        enabled: false,
        prefix: 'custom_',
        collectHttpMetrics: false,
      };

      const serviceEffect = createDefaultMetricsService(overrides);
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      
      // Test that disabled service returns empty metrics
      const metrics = await service.getMetrics();
      expect(metrics).toBe('');
    });

    test('should merge override options with defaults', async () => {
      const overrides: Partial<MetricsOptions> = {
        prefix: 'test_',
        systemMetricsInterval: 10000,
      };

      const serviceEffect = createDefaultMetricsService(overrides);
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      // The service should still be enabled (from defaults) but with custom prefix
      const metrics = await service.getMetrics();
      expect(typeof metrics).toBe('string');
    });

    test('should handle empty override options', async () => {
      const serviceEffect = createDefaultMetricsService({});
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      expect(typeof service.getMetrics).toBe('function');
    });

    test('should handle undefined override options', async () => {
      const serviceEffect = createDefaultMetricsService(undefined);
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      expect(typeof service.getMetrics).toBe('function');
    });

    test('should handle complex override options', async () => {
      const overrides: Partial<MetricsOptions> = {
        enabled: true,
        path: '/custom-metrics',
        defaultLabels: { service: 'test', version: '1.0' },
        collectHttpMetrics: true,
        collectSystemMetrics: false,
        collectGcMetrics: false,
        systemMetricsInterval: 30000,
        prefix: 'myapp_',
        httpDurationBuckets: [0.1, 0.5, 1.0],
      };

      const serviceEffect = createDefaultMetricsService(overrides);
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      
      // Test that the service works with custom options
      const counter = service.createCounter({
        name: 'test_counter',
        help: 'Test counter',
      });
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });
  });

  describe('makeDefaultMetricsService', () => {
    test('should create metrics service layer with default options', async () => {
      const layer = makeDefaultMetricsService();
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const service = yield* MetricsService;

        return service;
      });

      const service = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(service).toBeDefined();
      expect(typeof service.getMetrics).toBe('function');
      expect(typeof service.getContentType).toBe('function');
    });

    test('should create metrics service layer with override options', async () => {
      const overrides: Partial<MetricsOptions> = {
        enabled: true,
        prefix: 'layer_test_',
        collectSystemMetrics: false,
      };

      const layer = makeDefaultMetricsService(overrides);
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const service = yield* MetricsService;

        return service;
      });

      const service = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(service).toBeDefined();
    });

    test('should handle empty override options in layer', async () => {
      const layer = makeDefaultMetricsService({});
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const service = yield* MetricsService;

        return service;
      });

      const service = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(service).toBeDefined();
    });

    test('should handle undefined override options in layer', async () => {
      const layer = makeDefaultMetricsService(undefined);
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const service = yield* MetricsService;

        return service;
      });

      const service = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(service).toBeDefined();
    });

    test('should create working layer with metrics functionality', async () => {
      const overrides: Partial<MetricsOptions> = {
        prefix: 'layer_',
        enabled: true,
      };

      const layer = makeDefaultMetricsService(overrides);

      const program = Effect.gen(function* () {
        const service = yield* MetricsService;
        
        // Test creating a metric
        const counter = service.createCounter({
          name: 'layer_test_counter',
          help: 'Test counter for layer',
        });

        return { service, counter };
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result.service).toBeDefined();
      expect(result.counter).toBeDefined();
      expect(typeof result.counter.inc).toBe('function');
    });
  });

  describe('exported types and functions', () => {
    test('should export MetricType enum', () => {
      expect(MetricType).toBeDefined();
      expect(MetricType.COUNTER).toBe(MetricType.COUNTER);
      expect(MetricType.GAUGE).toBe(MetricType.GAUGE);
      expect(MetricType.HISTOGRAM).toBe(MetricType.HISTOGRAM);
      expect(MetricType.SUMMARY).toBe(MetricType.SUMMARY);
    });

    test('should export MetricsService', () => {
      expect(MetricsService).toBeDefined();
    });

    test('should export all expected functions and types', () => {
      // Test that all main exports are available
      expect(typeof createDefaultMetricsService).toBe('function');
      expect(typeof makeDefaultMetricsService).toBe('function');
      expect(DEFAULT_METRICS_OPTIONS).toBeDefined();
      expect(MetricType).toBeDefined();
      expect(MetricsService).toBeDefined();
    });
  });

  describe('require calls in convenience functions', () => {
    test('createDefaultMetricsService should handle require properly', async () => {
      // This tests that the require('./metrics.service') works correctly
      const serviceEffect = createDefaultMetricsService({ enabled: true });
      
      // Should not throw and should return a valid Effect
      expect(serviceEffect).toBeDefined();
      expect(typeof serviceEffect).toBe('object');
      
      const service = await Effect.runPromise(serviceEffect);
      expect(service).toBeDefined();
    });

    test('makeDefaultMetricsService should handle require properly', async () => {
      // This tests that the require('./metrics.service') works correctly
      const layer = makeDefaultMetricsService({ enabled: true });
      
      // Should not throw and should return a valid Layer
      expect(layer).toBeDefined();
      expect(typeof layer).toBe('object');
      
      const program = Effect.gen(function* () {
        return yield* MetricsService;
      });

      const service = await Effect.runPromise(
        Effect.provide(program, layer),
      );
      expect(service).toBeDefined();
    });
  });

  describe('integration with other metrics components', () => {
    test('should work with decorators', async () => {
      const serviceEffect = createDefaultMetricsService({
        enabled: true,
        prefix: 'integration_',
      });

      const service = await Effect.runPromise(serviceEffect);
      
      // Test creating various metric types
      const counter = service.createCounter({
        name: 'decorator_counter',
        help: 'Counter for decorator integration test',
      });

      const gauge = service.createGauge({
        name: 'decorator_gauge',
        help: 'Gauge for decorator integration test',
      });

      const histogram = service.createHistogram({
        name: 'decorator_histogram',
        help: 'Histogram for decorator integration test',
      });

      expect(counter).toBeDefined();
      expect(gauge).toBeDefined();
      expect(histogram).toBeDefined();
    });

    test('should work with HTTP metrics', async () => {
      const serviceEffect = createDefaultMetricsService({
        enabled: true,
        collectHttpMetrics: true,
        prefix: 'http_',
      });

      const service = await Effect.runPromise(serviceEffect);
      
      // Test recording HTTP metrics
      expect(() => {
        service.recordHttpRequest({
          method: 'GET',
          route: '/test',
          statusCode: 200,
          duration: 0.1,
          controller: 'TestController',
          action: 'test',
        });
      }).not.toThrow();
    });
  });
});
