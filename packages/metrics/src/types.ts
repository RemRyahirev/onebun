import { register } from 'prom-client';

/**
 * Metrics module configuration options
 */
export interface MetricsOptions {
  /**
   * Enable/disable metrics collection
   * @default true
   */
  enabled?: boolean;

  /**
   * HTTP path for exposing metrics endpoint
   * @default '/metrics'
   */
  path?: string;

  /**
   * Default labels to add to all metrics
   */
  defaultLabels?: Record<string, string>;

  /**
   * Enable automatic HTTP metrics collection
   * @default true
   */
  collectHttpMetrics?: boolean;

  /**
   * Enable automatic system metrics collection
   * @default true
   */
  collectSystemMetrics?: boolean;

  /**
   * Enable GC metrics collection
   * @default true
   */
  collectGcMetrics?: boolean;

  /**
   * Collection interval for system metrics in milliseconds
   * @default 5000
   */
  systemMetricsInterval?: number;

  /**
   * Custom prefix for all metrics
   * @default 'onebun_'
   */
  prefix?: string;

  /**
   * Buckets for HTTP request duration histogram
   * @default [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
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