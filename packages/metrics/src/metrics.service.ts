import {
  Context,
  Effect,
  Layer,
} from 'effect';
import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  register,
  Registry,
  Summary,
} from 'prom-client';

import type {
  CustomMetricConfig,
  HttpMetricsData,
  MetricsOptions,
  MetricsRegistry,
} from './types';
import type { Metric } from 'prom-client';

import {
  DEFAULT_HTTP_DURATION_BUCKETS,
  DEFAULT_METRICS_MAX_AGE_SECONDS,
  DEFAULT_SYSTEM_METRICS_INTERVAL,
} from './types';

/* eslint-disable @typescript-eslint/no-magic-numbers -- Metrics constants defined in one place */
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

/**
 * Cached status code strings to avoid toString() per request.
 * Populated lazily on first use of each code.
 */
const statusCodeCache = new Map<number, string>();

/**
 * The process-metric collectors prom-client installs, kept once per prefix.
 *
 * `collectDefaultMetrics()` has no disposer and its collectors install a `PerformanceObserver`
 * and an event-loop-delay monitor that nothing can take back, so calling it once per
 * application would leak a set per application — measured at ~90 KB and two live observers
 * each. Before registries were per application the second call THREW on the duplicate name,
 * which capped the process at one set by accident; this keeps that cap on purpose.
 *
 * The same metric objects are then registered into each application's registry, which
 * prom-client allows: `registerMetric` only rejects a DIFFERENT metric owning the name.
 * Two applications sharing a prefix therefore share the underlying counters — their totals
 * stay correct (the process collectors describe the process, not the application), but a
 * delta-based collector like `process_cpu_*` is consumed by whichever scrape arrives first.
 * In multi-service mode the documented setup gives each service its own prefix, so they do
 * not share at all.
 */
const defaultCollectorsByPrefix = new Map<string, Metric<string>[]>();

/**
 * Install prom-client's process metrics into a registry, collecting them at most once per prefix.
 */
function installDefaultCollectors(target: Registry, prefix: string): void {
  let collectors = defaultCollectorsByPrefix.get(prefix);

  if (collectors === undefined) {
    const staging = new Registry();
    collectDefaultMetrics({
      register: staging,
      prefix,
      gcDurationBuckets: GC_DURATION_BUCKETS,
    });

    // `getMetricsAsArray()` returns the metric OBJECTS (`Object.values(this._metrics)` in
    // prom-client's registry.js), which is what has to be re-registered. The published type
    // describes the serialized shape instead, hence the cast — and if that ever stops being
    // true, `registerMetric` throws at boot rather than quietly exposing nothing.
    collectors = staging.getMetricsAsArray() as unknown as Metric<string>[];
    defaultCollectorsByPrefix.set(prefix, collectors);
  }

  for (const collector of collectors) {
    target.registerMetric(collector);
  }
}

function getStatusCodeString(code: number): string {
  let str = statusCodeCache.get(code);
  if (str === undefined) {
    str = code.toString();
    statusCodeCache.set(code, str);
  }

  return str;
}


/**
 * Metrics service interface
 *
 * @see docs:api/metrics.md
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

  /**
   * Metric names registered against prom-client's process-global registry that this
   * application's registry does not have, and which therefore never reach its /metrics.
   *
   * A metric built as `new Counter({ ..., registers: [register] })` used to be scraped because
   * the application scraped that same registry. It no longer does, and this is what lets the
   * framework say so instead of serving a silently shorter body.
   */
  getOrphanedMetricNames(): string[];

  /**
   * Release what this service holds: the system-metrics timer and its own registry.
   */
  dispose(): void;
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
  /**
   * This application's own registry.
   *
   * Everything used to go into prom-client's process-global `register`, so a second
   * application in the process either threw on a duplicate metric name or — with a distinct
   * prefix, which is what the multi-service docs recommend — served every other service's
   * series from its own /metrics, all stamped with whichever service started last.
   */
  private readonly registry: Registry;
  /** Whether the orphan diagnostic has already been reported; it is a once-per-app notice. */
  private orphansReported = false;

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
    // `registry` is the escape hatch: passing prom-client's `register` restores the previous
    // process-wide behaviour verbatim, for code that registered metrics against it directly.
    this.registry = (this.options.registry as Registry | undefined) ?? new Registry();

    if (this.options.enabled) {
      this.initializeMetrics();
    }
  }

  private initializeMetrics(): void {
    // Set default labels if provided
    if (this.options.defaultLabels) {
      // Per registry, and applied at render time — which is why setting them on the shared
      // registry restamped an already-running application's series with a later one's identity.
      this.registry.setDefaultLabels(this.options.defaultLabels);
    }

    // Collect default metrics (GC, etc.)
    if (this.options.collectGcMetrics) {
      installDefaultCollectors(this.registry, this.options.prefix!);
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
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: `${this.options.prefix}http_request_duration_seconds`,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code', 'controller', 'action'],
      buckets: this.options.httpDurationBuckets!,
      registers: [this.registry],
    });
  }

  private initializeSystemMetrics(): void {
    this.systemMemoryUsage = new Gauge({
      name: `${this.options.prefix}memory_usage_bytes`,
      help: 'Memory usage in bytes',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.systemCpuUsage = new Gauge({
      name: `${this.options.prefix}cpu_usage_ratio`,
      help: 'CPU usage ratio',
      registers: [this.registry],
    });

    this.systemUptime = new Gauge({
      name: `${this.options.prefix}uptime_seconds`,
      help: 'Process uptime in seconds',
      registers: [this.registry],
    });
  }

  async getMetrics(): Promise<string> {
    if (!this.options.enabled) {
      return '';
    }

    return await this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  recordHttpRequest(data: HttpMetricsData): void {
    if (!this.options.enabled || !this.options.collectHttpMetrics) {
      return;
    }

    const labels = {
      method: data.method,
      route: data.route,
      status_code: getStatusCodeString(data.statusCode),
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
      registers: [this.registry],
    });
  }

  createGauge(config: Omit<CustomMetricConfig, 'type'>): Gauge<string> {
    return new Gauge({
      name: `${this.options.prefix}${config.name}`,
      help: config.help,
      labelNames: config.labelNames || [],
      registers: [this.registry],
    });
  }

  createHistogram(config: Omit<CustomMetricConfig, 'type'>): Histogram<string> {
    return new Histogram({
      name: `${this.options.prefix}${config.name}`,
      help: config.help,
      labelNames: config.labelNames || [],
      buckets: config.buckets || DEFAULT_CUSTOM_HISTOGRAM_BUCKETS,
      registers: [this.registry],
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
      registers: [this.registry],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMetric<T = any>(name: string): T | undefined {
    const fullName = name.startsWith(this.options.prefix!) ? name : `${this.options.prefix}${name}`;

    return this.registry.getSingleMetric(fullName) as T;
  }

  clear(): void {
    this.registry.clear();
  }

  getRegistry(): MetricsRegistry {
    return {
      getMetrics: () => this.getMetrics(),
      getContentType: () => this.getContentType(),
      clear: () => this.clear(),
      register: this.registry,
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
      delete this.systemMetricsInterval;
    }
  }

  getOrphanedMetricNames(): string[] {
    // Nothing is orphaned when this application IS scraping the process-global registry.
    if (this.registry === register) {
      return [];
    }

    const mine = new Set(this.registry.getMetricsAsArray().map((metric) => metric.name));

    return register.getMetricsAsArray()
      .map((metric) => metric.name)
      .filter((name) => !mine.has(name));
  }

  /** Whether the orphan notice has been given yet. Once per application, not once per scrape. */
  shouldReportOrphans(): boolean {
    if (this.orphansReported) {
      return false;
    }
    this.orphansReported = true;

    return true;
  }

  dispose(): void {
    this.stopSystemMetricsCollection();
    // Only this application's registry. The shared process collectors stay in the per-prefix
    // cache and in any sibling application's registry — clearing those would blind a service
    // that is still running.
    this.registry.clear();
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
export const makeMetricsService = (
  options?: MetricsOptions,
): Layer.Layer<MetricsService, never, never> =>
  Layer.succeed(MetricsService, new MetricsServiceImpl(options));

/**
 * Create metrics service with configuration
 *
 * @see docs:api/metrics.md
 */
export const createMetricsService = (
  options?: MetricsOptions,
): Effect.Effect<MetricsService, never, never> => Effect.succeed(new MetricsServiceImpl(options));
