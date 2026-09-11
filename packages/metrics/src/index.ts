/**
 * \@onebun/metrics
 *
 * Prometheus-compatible metrics module for OneBun framework
 * Provides automatic HTTP request metrics, system metrics, and custom metrics API
 */

import { DEFAULT_HTTP_DURATION_BUCKETS, DEFAULT_SYSTEM_METRICS_INTERVAL } from './types';

// Re-export commonly used prom-client types, plus the Registry class so `metrics: { registry }`
// is constructible without a direct prom-client dependency.
export type {
  Counter,
  Gauge,
  Histogram,
  Summary,
} from 'prom-client';
export { Registry } from 'prom-client';
/**
 * prom-client's PROCESS-GLOBAL registry.
 *
 * @deprecated This is no longer the registry an application scrapes — each one owns its own,
 * so two applications in a process do not collide or serve each other's series. Reach the
 * application's registry through `metricsService.getRegistry().register`, or pass
 * `metrics: { registry: register }` to opt an application back onto this one.
 */
export { register } from 'prom-client';
// Decorators
export {
  Counted,
  CountCalls,
  Gauged,
  InjectMetric,
  MeasureGauge,
  MeasureTime,
  Timed,
  measureExecutionTime,
  WithMetrics,
} from './decorators';
// Core service
export {
  createMetricsService,
  MetricsService,
  makeMetricsService,
} from './metrics.service';

// Middleware
export {
  MetricsMiddleware,
  recordHttpMetrics,
  WithMetrics as WithMetricsMiddleware,
} from './middleware';
// Types
export type {
  CustomMetricConfig,
  HttpMetricsData,
  MetricsOptions,
  MetricsRegistry,
  SystemMetricsData,
} from './types';
export { MetricType } from './types';

/**
 * Default metrics configuration
 */
export const DEFAULT_METRICS_OPTIONS = {
  enabled: true,
  path: '/metrics',
  defaultLabels: {},
  collectHttpMetrics: true,
  collectSystemMetrics: true,
  collectGcMetrics: true,
  systemMetricsInterval: DEFAULT_SYSTEM_METRICS_INTERVAL,
  prefix: 'onebun_',
  httpDurationBuckets: DEFAULT_HTTP_DURATION_BUCKETS,
} as const;

/**
 * Convenience function to create metrics service with default options
 */
export const createDefaultMetricsService = (
  overrides: Partial<import('./types').MetricsOptions> = {},
): ReturnType<typeof import('./metrics.service').createMetricsService> => {
  const { createMetricsService } = require('./metrics.service');

  return createMetricsService({
    ...DEFAULT_METRICS_OPTIONS,
    ...overrides,
  });
};

/**
 * Convenience function to create metrics layer with default options
 */
export const makeDefaultMetricsService = (
  overrides: Partial<import('./types').MetricsOptions> = {},
): ReturnType<typeof import('./metrics.service').makeMetricsService> => {
  const { makeMetricsService } = require('./metrics.service');

  return makeMetricsService({
    ...DEFAULT_METRICS_OPTIONS,
    ...overrides,
  });
};
