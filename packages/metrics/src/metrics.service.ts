import {
  Effect,
  Layer,
  Context,
} from 'effect';
import {
  register,
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Summary,
} from 'prom-client';

import type {
  MetricsOptions,
  HttpMetricsData,
  MetricsRegistry,
  CustomMetricConfig,
} from './types';

import {
  DEFAULT_SYSTEM_METRICS_INTERVAL,
  DEFAULT_HTTP_DURATION_BUCKETS,
  DEFAULT_METRICS_MAX_AGE_SECONDS,
} from './types';

/* eslint-disable no-magic-numbers -- Metrics constants defined in one place */
/**
 * Default histogram buckets for GC metrics
 */
const GC_DURATION_BUCKETS = [0.001, 0.01, 0.1, 1, 2, 5];

/**
 * Default histogram buckets for custom metrics
 */
const DEFAULT_CUSTOM_HISTOGRAM_BUCKETS = [0.001, 0.01, 0.1, 1, 10];

/**
 * Default percentiles for summary metrics
 */
const DEFAULT_SUMMARY_PERCENTILES = [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999];

/**
 * Default number of age buckets for summary metrics
 */
const DEFAULT_SUMMARY_AGE_BUCKETS = 5;

/**
 * Microseconds to seconds conversion factor
 */
const MICROSECONDS_TO_SECONDS = 1000000;
/* eslint-enable no-magic-numbers */

/**
 * Metrics service interface
 */
export interface MetricsService {
  /**
   * Get metrics in Prometheus format
   */
  getMetrics(): Promise<string>;

  /**
   * Get content type for metrics response
   */
  getContentType(): string;

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(data: HttpMetricsData): void;

  /**
   * Create a custom counter
   */
  createCounter(config: Omit<CustomMetricConfig, 'type'>): Counter<string>;

  /**
   * Create a custom gauge
   */
  createGauge(config: Omit<CustomMetricConfig, 'type'>): Gauge<string>;

  /**
   * Create a custom histogram
   */
  createHistogram(config: Omit<CustomMetricConfig, 'type'>): Histogram<string>;

  /**
   * Create a custom summary
   */
  createSummary(config: Omit<CustomMetricConfig, 'type'>): Summary<string>;

  /**
   * Get a metric by name
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMetric<T = any>(name: string): T | undefined;

  /**
   * Clear all metrics
   */
  clear(): void;

  /**
   * Get metrics registry
   */
  getRegistry(): MetricsRegistry;

  /**
   * Start collecting system metrics
   */
  startSystemMetricsCollection(): void;

  /**
   * Stop collecting system metrics
   */
  stopSystemMetricsCollection(): void;
}

/**
 * Metrics service tag for dependency injection
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const MetricsService = Context.GenericTag<MetricsService>('@onebun/metrics/MetricsService');

/**
 * Metrics service implementation
 */
class MetricsServiceImpl implements MetricsService {
  private options: MetricsOptions;
  private httpRequestsTotal!: Counter<string>;
  private httpRequestDuration!: Histogram<string>;
  private systemMemoryUsage!: Gauge<string>;
  private systemCpuUsage!: Gauge<string>;
  private systemUptime!: Gauge<string>;
  private systemMetricsInterval?: Timer;
  private cpuUsageBaseline: NodeJS.CpuUsage;

  constructor(options: MetricsOptions = {}) {
    this.options = {
      enabled: true,
      path: '/metrics',
      collectHttpMetrics: true,
      collectSystemMetrics: true,
      collectGcMetrics: true,
      systemMetricsInterval: DEFAULT_SYSTEM_METRICS_INTERVAL,
      prefix: 'onebun_',
      httpDurationBuckets: DEFAULT_HTTP_DURATION_BUCKETS,
      ...options,
    };

    this.cpuUsageBaseline = process.cpuUsage();

    if (this.options.enabled) {
      this.initializeMetrics();
    }
  }

  private initializeMetrics(): void {
    // Set default labels if provided
    if (this.options.defaultLabels) {
      register.setDefaultLabels(this.options.defaultLabels);
    }

    // Collect default metrics (GC, etc.)
    if (this.options.collectGcMetrics) {
      collectDefaultMetrics({
        register,
        prefix: this.options.prefix,
        gcDurationBuckets: GC_DURATION_BUCKETS,
      });
    }

    // Initialize HTTP metrics
    if (this.options.collectHttpMetrics) {
      this.initializeHttpMetrics();
    }

    // Initialize system metrics
    if (this.options.collectSystemMetrics) {
      this.initializeSystemMetrics();
    }
  }

  private initializeHttpMetrics(): void {
    this.httpRequestsTotal = new Counter({
      name: `${this.options.prefix}http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'controller', 'action'],
      registers: [register],
    });

    this.httpRequestDuration = new Histogram({
      name: `${this.options.prefix}http_request_duration_seconds`,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code', 'controller', 'action'],
      buckets: this.options.httpDurationBuckets!,
      registers: [register],
    });
  }

  private initializeSystemMetrics(): void {
    this.systemMemoryUsage = new Gauge({
      name: `${this.options.prefix}memory_usage_bytes`,
      help: 'Memory usage in bytes',
      labelNames: ['type'],
      registers: [register],
    });

    this.systemCpuUsage = new Gauge({
      name: `${this.options.prefix}cpu_usage_ratio`,
      help: 'CPU usage ratio',
      registers: [register],
    });

    this.systemUptime = new Gauge({
      name: `${this.options.prefix}uptime_seconds`,
      help: 'Process uptime in seconds',
      registers: [register],
    });
  }

  async getMetrics(): Promise<string> {
    if (!this.options.enabled) {
      return '';
    }

    return await register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }

  recordHttpRequest(data: HttpMetricsData): void {
    if (!this.options.enabled || !this.options.collectHttpMetrics) {
      return;
    }

    const labels = {
      method: data.method.toUpperCase(),
      route: data.route,
      status_code: data.statusCode.toString(),
      controller: data.controller || 'unknown',
      action: data.action || 'unknown',
    };

    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, data.duration);
  }

  createCounter(config: Omit<CustomMetricConfig, 'type'>): Counter<string> {
    return new Counter({
      name: `${this.options.prefix}${config.name}`,
      help: config.help,
      labelNames: config.labelNames || [],
      registers: [register],
    });
  }

  createGauge(config: Omit<CustomMetricConfig, 'type'>): Gauge<string> {
    return new Gauge({
      name: `${this.options.prefix}${config.name}`,
      help: config.help,
      labelNames: config.labelNames || [],
      registers: [register],
    });
  }

  createHistogram(config: Omit<CustomMetricConfig, 'type'>): Histogram<string> {
    return new Histogram({
      name: `${this.options.prefix}${config.name}`,
      help: config.help,
      labelNames: config.labelNames || [],
      buckets: config.buckets || DEFAULT_CUSTOM_HISTOGRAM_BUCKETS,
      registers: [register],
    });
  }

  createSummary(config: Omit<CustomMetricConfig, 'type'>): Summary<string> {
    return new Summary({
      name: `${this.options.prefix}${config.name}`,
      help: config.help,
      labelNames: config.labelNames || [],
      percentiles: config.percentiles || DEFAULT_SUMMARY_PERCENTILES,
      maxAgeSeconds: config.maxAgeSeconds || DEFAULT_METRICS_MAX_AGE_SECONDS,
      ageBuckets: config.ageBuckets || DEFAULT_SUMMARY_AGE_BUCKETS,
      registers: [register],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMetric<T = any>(name: string): T | undefined {
    const fullName = name.startsWith(this.options.prefix!) ? name : `${this.options.prefix}${name}`;

    return register.getSingleMetric(fullName) as T;
  }

  clear(): void {
    register.clear();
  }

  getRegistry(): MetricsRegistry {
    return {
      getMetrics: () => this.getMetrics(),
      getContentType: () => this.getContentType(),
      clear: () => this.clear(),
      register,
    };
  }

  startSystemMetricsCollection(): void {
    if (!this.options.enabled || !this.options.collectSystemMetrics || this.systemMetricsInterval) {
      return;
    }

    this.systemMetricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.options.systemMetricsInterval!);

    // Collect initial metrics
    this.collectSystemMetrics();
  }

  stopSystemMetricsCollection(): void {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
      this.systemMetricsInterval = undefined;
    }
  }

  private collectSystemMetrics(): void {
    try {
      // Memory metrics
      const memUsage = process.memoryUsage();
      this.systemMemoryUsage.set({ type: 'rss' }, memUsage.rss);
      this.systemMemoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
      this.systemMemoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
      this.systemMemoryUsage.set({ type: 'external' }, memUsage.external);

      // CPU metrics
      const cpuUsage = process.cpuUsage(this.cpuUsageBaseline);
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / MICROSECONDS_TO_SECONDS; // Convert microseconds to seconds
      this.systemCpuUsage.set(cpuPercent);
      this.cpuUsageBaseline = process.cpuUsage();

      // Uptime
      this.systemUptime.set(process.uptime());
    } catch (error) {
      // Silently ignore metrics collection errors
      // eslint-disable-next-line no-console
      console.warn('Failed to collect system metrics:', error);
    }
  }
}

/**
 * Create metrics service layer
 */
export const makeMetricsService = (options?: MetricsOptions): Layer.Layer<MetricsService, never, never> =>
  Layer.succeed(MetricsService, new MetricsServiceImpl(options));

/**
 * Create metrics service with configuration
 */
export const createMetricsService = (options?: MetricsOptions): Effect.Effect<MetricsService, never, never> =>
  Effect.succeed(new MetricsServiceImpl(options));
