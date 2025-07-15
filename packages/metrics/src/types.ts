import { register } from 'prom-client';

/**
 * Default system metrics collection interval (5 seconds)
 */
export const DEFAULT_SYSTEM_METRICS_INTERVAL = 5000;

/**
 * Default HTTP duration buckets for histogram metrics (in seconds)
 */
/* eslint-disable no-magic-numbers -- Standard Prometheus histogram buckets defined in one place */
export const DEFAULT_HTTP_DURATION_BUCKETS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];
/* eslint-enable no-magic-numbers */
 

/**
 * Default metrics max age in seconds (10 minutes)
 */
export const DEFAULT_METRICS_MAX_AGE_SECONDS = 600;

/**
 * Metrics module configuration options
 */
export interface MetricsOptions {
  /**
   * Enable/disable metrics collection
   * @defaultValue true
   */
  enabled?: boolean;

  /**
   * HTTP path for exposing metrics endpoint
   * @defaultValue '/metrics'
   */
  path?: string;

  /**
   * Default labels to add to all metrics
   */
  defaultLabels?: Record<string, string>;

  /**
   * Enable automatic HTTP metrics collection
   * @defaultValue true
   */
  collectHttpMetrics?: boolean;

  /**
   * Enable automatic system metrics collection
   * @defaultValue true
   */
  collectSystemMetrics?: boolean;

  /**
   * Enable GC metrics collection
   * @defaultValue true
   */
  collectGcMetrics?: boolean;

  /**
   * Collection interval for system metrics in milliseconds
   * @defaultValue 5000
   */
  systemMetricsInterval?: number;

  /**
   * Custom prefix for all metrics
   * @defaultValue 'onebun_'
   */
  prefix?: string;

  /**
   * Buckets for HTTP request duration histogram
   * @defaultValue [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
   */
  httpDurationBuckets?: number[];
}

/**
 * HTTP metrics data
 */
export interface HttpMetricsData {
  method: string;
  route: string;
  statusCode: number;
  duration: number;
  controller?: string;
  action?: string;
}

/**
 * System metrics data
 */
export interface SystemMetricsData {
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  uptime: number;
}

/**
 * Metrics registry interface
 */
export interface MetricsRegistry {
  getMetrics(): Promise<string>;
  getContentType(): string;
  clear(): void;
  register: typeof register;
}

/**
 * Custom metric types
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary'
}

/**
 * Custom metric configuration
 */
export interface CustomMetricConfig {
  name: string;
  help: string;
  type: MetricType;
  labelNames?: string[];
  buckets?: number[]; // for histogram
  percentiles?: number[]; // for summary
  maxAgeSeconds?: number; // for summary
  ageBuckets?: number; // for summary
} 