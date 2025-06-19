/**
 * @onebun/metrics
 * 
 * Prometheus-compatible metrics module for OneBun framework
 * Provides automatic HTTP request metrics, system metrics, and custom metrics API
 */

// Core service
export {
  MetricsService,
  makeMetricsService,
  createMetricsService
} from './metrics.service';

// Types
export type {
  MetricsOptions,
  HttpMetricsData,
  SystemMetricsData,
  MetricsRegistry,
  CustomMetricConfig
} from './types';

export { MetricType } from './types';

// Middleware
export {
  MetricsMiddleware,
  WithMetrics as WithMetricsMiddleware,
  recordHttpMetrics
} from './middleware';

// Decorators
export {
  MeasureTime,
  CountCalls,
  MeasureGauge,
  InjectMetric,
  WithMetrics,
  measureExecutionTime
} from './decorators';

// Re-export commonly used prom-client types
export type {
  Counter,
  Gauge,
  Histogram,
  Summary
} from 'prom-client';

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
  systemMetricsInterval: 5000,
  prefix: 'onebun_',
  httpDurationBuckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
} as const;

/**
 * Convenience function to create metrics service with default options
 */
export const createDefaultMetricsService = (overrides: Partial<import('./types').MetricsOptions> = {}) => {
  const { createMetricsService } = require('./metrics.service');
  return createMetricsService({
    ...DEFAULT_METRICS_OPTIONS,
    ...overrides
  });
};

/**
 * Convenience function to create metrics layer with default options
 */
export const makeDefaultMetricsService = (overrides: Partial<import('./types').MetricsOptions> = {}) => {
  const { makeMetricsService } = require('./metrics.service');
  return makeMetricsService({
    ...DEFAULT_METRICS_OPTIONS,
    ...overrides
  });
}; 