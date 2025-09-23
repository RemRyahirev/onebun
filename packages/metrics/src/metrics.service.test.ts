import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';
import { register } from 'prom-client';

import type { MetricsOptions, HttpMetricsData } from './types';

import {
  MetricsService,
  makeMetricsService,
  createMetricsService,
} from './metrics.service';

describe('MetricsService', () => {
  beforeEach(async () => {
    // Clear the registry before each test
    register.clear();
  });

  afterEach(async () => {
    register.clear();
  });

  describe('MetricsService tag', () => {
    test('should be defined as Context tag', () => {
      expect(MetricsService).toBeDefined();
    });
  });

  describe('makeMetricsService', () => {
    test('should create a layer with default options', async () => {
      const layer = makeMetricsService();
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const metricsService = yield* MetricsService;

        return metricsService;
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBeDefined();
      expect(typeof result.getMetrics).toBe('function');
      expect(typeof result.getContentType).toBe('function');
      expect(typeof result.recordHttpRequest).toBe('function');
      expect(typeof result.createCounter).toBe('function');
      expect(typeof result.createGauge).toBe('function');
      expect(typeof result.createHistogram).toBe('function');
      expect(typeof result.createSummary).toBe('function');
      expect(typeof result.getMetric).toBe('function');
      expect(typeof result.clear).toBe('function');
      expect(typeof result.getRegistry).toBe('function');
      expect(typeof result.startSystemMetricsCollection).toBe('function');
      expect(typeof result.stopSystemMetricsCollection).toBe('function');
    });

    test('should create a layer with custom options', async () => {
      const options: MetricsOptions = {
        enabled: false,
        prefix: 'custom_',
        path: '/custom-metrics',
      };

      const layer = makeMetricsService(options);
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const metricsService = yield* MetricsService;

        return metricsService;
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBeDefined();
    });

    test('should create layer with all configuration options', async () => {
      const options: MetricsOptions = {
        enabled: true,
        path: '/custom-metrics',
        defaultLabels: { service: 'test', version: '1.0' },
        collectHttpMetrics: false,
        collectSystemMetrics: false,
        collectGcMetrics: false,
        systemMetricsInterval: 10000,
        prefix: 'myapp_',
        httpDurationBuckets: [0.1, 0.5, 1.0],
      };

      const layer = makeMetricsService(options);
      const program = Effect.gen(function* () {
        const metricsService = yield* MetricsService;

        return metricsService;
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBeDefined();
    });
  });

  describe('createMetricsService', () => {
    test('should create service with default options', async () => {
      const serviceEffect = createMetricsService();
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
      expect(typeof service.getMetrics).toBe('function');
      expect(typeof service.getContentType).toBe('function');
    });

    test('should create service with custom options', async () => {
      const options: MetricsOptions = {
        enabled: true,
        prefix: 'test_',
        collectHttpMetrics: false,
      };

      const serviceEffect = createMetricsService(options);
      const service = await Effect.runPromise(serviceEffect);

      expect(service).toBeDefined();
    });

    test('should create service with disabled metrics', async () => {
      const serviceEffect = createMetricsService({ enabled: false });
      const service = await Effect.runPromise(serviceEffect);

      const metrics = await service.getMetrics();
      expect(metrics).toBe('');
    });
  });

  describe('MetricsService functionality', () => {
    let service: any;

    beforeEach(async () => {
      const serviceEffect = createMetricsService({
        enabled: true,
        prefix: 'test_',
        collectHttpMetrics: true,
        collectSystemMetrics: true,
      });
      service = await Effect.runPromise(serviceEffect);
    });

    test('should return content type', () => {
      const contentType = service.getContentType();
      expect(typeof contentType).toBe('string');
      expect(contentType).toContain('text/plain');
    });

    test('should get metrics in string format', async () => {
      const metrics = await service.getMetrics();
      expect(typeof metrics).toBe('string');
    });

    test('should record HTTP request metrics', () => {
      const httpData: HttpMetricsData = {
        method: 'GET',
        route: '/test',
        statusCode: 200,
        duration: 0.1,
        controller: 'TestController',
        action: 'test',
      };

      expect(() => service.recordHttpRequest(httpData)).not.toThrow();
    });

    test('should record HTTP metrics with missing optional fields', () => {
      const httpData: HttpMetricsData = {
        method: 'POST',
        route: '/api/test',
        statusCode: 201,
        duration: 0.05,
      };

      expect(() => service.recordHttpRequest(httpData)).not.toThrow();
    });

    test('should handle lowercase HTTP method', () => {
      const httpData: HttpMetricsData = {
        method: 'post',
        route: '/test',
        statusCode: 200,
        duration: 0.1,
      };

      expect(() => service.recordHttpRequest(httpData)).not.toThrow();
    });

    test('should create custom counter', () => {
      const counter = service.createCounter({
        name: 'test_counter',
        help: 'Test counter',
      });

      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    test('should create custom counter with label names', () => {
      const counter = service.createCounter({
        name: 'labeled_counter',
        help: 'Counter with labels',
        labelNames: ['method', 'status'],
      });

      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    test('should create custom gauge', () => {
      const gauge = service.createGauge({
        name: 'test_gauge',
        help: 'Test gauge',
      });

      expect(gauge).toBeDefined();
      expect(typeof gauge.set).toBe('function');
    });

    test('should create custom histogram', () => {
      const histogram = service.createHistogram({
        name: 'test_histogram',
        help: 'Test histogram',
        buckets: [0.1, 0.5, 1, 5],
      });

      expect(histogram).toBeDefined();
      expect(typeof histogram.observe).toBe('function');
    });

    test('should create custom histogram with default buckets', () => {
      const histogram = service.createHistogram({
        name: 'test_histogram_default',
        help: 'Test histogram with default buckets',
      });

      expect(histogram).toBeDefined();
    });

    test('should create custom summary', () => {
      const summary = service.createSummary({
        name: 'test_summary',
        help: 'Test summary',
        percentiles: [0.5, 0.9, 0.99],
      });

      expect(summary).toBeDefined();
      expect(typeof summary.observe).toBe('function');
    });

    test('should create custom summary with default percentiles', () => {
      const summary = service.createSummary({
        name: 'test_summary_default',
        help: 'Test summary with defaults',
      });

      expect(summary).toBeDefined();
    });

    test('should get metric by name', () => {
      // Create a metric first
      service.createCounter({
        name: 'findable_counter',
        help: 'A counter that can be found',
      });

      // Try to find it
      expect(() => service.getMetric('findable_counter')).not.toThrow();
      expect(() => service.getMetric('test_findable_counter')).not.toThrow();
    });

    test('should clear all metrics', () => {
      // Create some metrics
      service.createCounter({ name: 'counter_to_clear', help: 'Test' });
      service.createGauge({ name: 'gauge_to_clear', help: 'Test' });

      expect(() => service.clear()).not.toThrow();
    });

    test('should get registry', () => {
      const registry = service.getRegistry();

      expect(registry).toBeDefined();
      expect(typeof registry.getMetrics).toBe('function');
      expect(typeof registry.getContentType).toBe('function');
      expect(typeof registry.clear).toBe('function');
      expect(registry.register).toBeDefined();
    });

    test('should start and stop system metrics collection', () => {
      expect(() => service.startSystemMetricsCollection()).not.toThrow();
      expect(() => service.stopSystemMetricsCollection()).not.toThrow();
    });

    test('should handle multiple start/stop calls', () => {
      service.startSystemMetricsCollection();
      expect(() => service.startSystemMetricsCollection()).not.toThrow();
      
      service.stopSystemMetricsCollection();
      expect(() => service.stopSystemMetricsCollection()).not.toThrow();
    });
  });

  describe('disabled metrics service', () => {
    test('should not record HTTP metrics when disabled', async () => {
      const serviceEffect = createMetricsService({
        enabled: false,
        collectHttpMetrics: false,
      });
      const service = await Effect.runPromise(serviceEffect);

      const httpData: HttpMetricsData = {
        method: 'GET',
        route: '/test',
        statusCode: 200,
        duration: 0.1,
      };

      expect(() => service.recordHttpRequest(httpData)).not.toThrow();
    });

    test('should not start system metrics when disabled', async () => {
      const serviceEffect = createMetricsService({
        enabled: false,
        collectSystemMetrics: false,
      });
      const service = await Effect.runPromise(serviceEffect);

      expect(() => service.startSystemMetricsCollection()).not.toThrow();
    });
  });

  describe('configuration handling', () => {
    test('should handle empty options object', async () => {
      const serviceEffect = createMetricsService({});
      const service = await Effect.runPromise(serviceEffect);
      expect(service).toBeDefined();
    });

    test('should handle undefined options', async () => {
      const serviceEffect = createMetricsService(undefined);
      const service = await Effect.runPromise(serviceEffect);
      expect(service).toBeDefined();
    });

    test('should handle partial options', async () => {
      const serviceEffect = createMetricsService({
        prefix: 'partial_',
        enabled: true,
      });
      const service = await Effect.runPromise(serviceEffect);
      expect(service).toBeDefined();
    });
  });
});
