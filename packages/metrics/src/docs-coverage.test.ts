/**
 * Behavioural coverage for the sections of `docs/api/metrics.md` that no test names.
 *
 * The compile gate proves those snippets typecheck; it cannot prove the framework still DOES what
 * the prose around them promises. Every test here drives the documented recipe and asserts the
 * consequence the reader is being sold — the series that appears in the scrape, the value the
 * gauge holds, the bucket the observation landed in, the endpoint that answers (and the one that
 * does not).
 *
 * NOTE ON THE FILENAME: the package already has a `docs-examples.test.ts`, so these tests live in
 * the second name `scripts/docs-xref.ts` scans for `@source` tags — `docs-coverage.test.ts`. Both
 * are ordinary test files; the distinction is only which one the directory already had.
 *
 * @source docs:api/metrics.md
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect } from 'effect';

import type {
  Counter,
  Gauge,
  Histogram,
} from 'prom-client';

import {
  BaseController,
  BaseService,
  Body,
  Controller,
  Get,
  Module,
  OneBunApplication,
  Post,
  resetRegistrations,
  Service,
} from '@onebun/core';
import { useFakeTimers } from '@onebun/core/testing';
import type { MetricsService } from '@onebun/metrics';
import {
  Counted,
  createMetricsService,
  Gauged,
  register,
  Timed,
} from '@onebun/metrics';

/**
 * The application publishes its metrics service here; `this.metrics` and the decorators read it
 * back. Tests that boot an application take the handle from the same place the framework does.
 */
const METRICS_GLOBAL = '__onebunMetricsService';

function publishedMetricsService(): MetricsService {
  const service = (globalThis as Record<string, unknown>)[METRICS_GLOBAL] as MetricsService | undefined;

  if (!service) {
    throw new Error('The application published no metrics service');
  }

  return service;
}

/** Reads a metric back out of the registry, failing loudly when the registration never happened. */
function requireMetric<T>(service: MetricsService, name: string): T {
  const metric = service.getMetric<T>(name);

  if (metric === undefined) {
    throw new Error(`The registry has no metric named ${name}`);
  }

  return metric;
}

/**
 * Reads the numeric value of one exposition line out of a scrape.
 *
 * A gauge that was registered but never collected still renders — prom-client seeds a gauge that
 * declares no label names with `0` — so a test that means "the collection loop ran" has to look at
 * the value, not at the presence of the series.
 */
function seriesValue(scrape: string, series: string): number {
  const line = scrape.split('\n').find((entry) => entry.startsWith(`${series} `));

  if (line === undefined) {
    throw new Error(`The scrape has no series ${series}`);
  }

  return Number(line.slice(series.length + 1));
}

/** A service that only ever registers what the test asks it to. */
function isolatedMetricsService(prefix: string): MetricsService {
  return Effect.runSync(createMetricsService({
    prefix,
    collectGcMetrics: false,
    collectHttpMetrics: false,
    collectSystemMetrics: false,
  }));
}

beforeEach(() => {
  resetRegistrations();
  register.clear();
  delete (globalThis as Record<string, unknown>)[METRICS_GLOBAL];
});

afterEach(() => {
  resetRegistrations();
  register.clear();
  delete (globalThis as Record<string, unknown>)[METRICS_GLOBAL];
});

describe('docs/api/metrics.md — Enabling Metrics', () => {
  /**
   * From "In Application": the block handed to `new OneBunApplication` is not decoration. `path`
   * decides where the scrape lives (and, crucially, where it does NOT), `prefix` renames every
   * series, `defaultLabels` are stamped on all of them, `collectHttpMetrics` counts the requests
   * the app actually served, `collectSystemMetrics` fills the process gauges and `collectGcMetrics`
   * pulls in the runtime histogram.
   *
   * @source docs:api/metrics.md#in-application
   */
  it('honours every metrics option the application block sets', async () => {
    @Controller('/api/users')
    class UsersController extends BaseController {
      @Get('/')
      list(): { users: string[] } {
        return { users: ['ann'] };
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      gracefulShutdown: false,
      tracing: { enabled: false },
      metrics: {
        enabled: true,
        path: '/internal-metrics',
        prefix: 'myapp_',
        collectHttpMetrics: true,
        collectSystemMetrics: true,
        collectGcMetrics: true,
        systemMetricsInterval: 5000,
        defaultLabels: {
          service: 'my-service',
          environment: 'test',
        },
      },
    });

    try {
      await app.start();

      const base = `http://127.0.0.1:${app.getPort()}`;

      // Two real requests through the pipeline — the counter must count them, not merely exist.
      expect((await fetch(`${base}/api/users`)).status).toBe(200);
      expect((await fetch(`${base}/api/users`)).status).toBe(200);

      // `path` moves the endpoint; it does not add a second one.
      expect((await fetch(`${base}/metrics`)).status).toBe(404);

      const scrape = await fetch(`${base}/internal-metrics`);
      expect(scrape.status).toBe(200);
      expect(scrape.headers.get('content-type')).toContain('text/plain');

      const body = await scrape.text();

      // prefix + defaultLabels + collectHttpMetrics, all in one line of the scrape.
      expect(body).toContain(
        'myapp_http_requests_total{method="GET",route="/api/users",status_code="200",'
        + 'controller="UsersController",action="unknown",service="my-service",environment="test"} 2',
      );
      expect(body).toContain('myapp_http_request_duration_seconds_count');

      // collectSystemMetrics: the process gauges are registered AND collected once at startup. The
      // labelled memory gauge grows no `type="rss"` child until a collection writes one, so its mere
      // presence carries the promise; the unlabelled uptime gauge renders `0` from registration
      // alone, so only a value above zero separates "collected" from "merely registered".
      expect(body).toMatch(/myapp_memory_usage_bytes\{type="rss",service="my-service",environment="test"} \d+/);
      expect(seriesValue(body, 'myapp_uptime_seconds{service="my-service",environment="test"}')).toBeGreaterThan(0);

      // collectGcMetrics pulls prom-client's default runtime metrics in under the same prefix.
      expect(body).toContain('# TYPE myapp_nodejs_gc_duration_seconds histogram');

      // Nothing leaked under the framework default prefix.
      expect(body).not.toContain('onebun_http_requests_total');
    } finally {
      // `stop()` leaves the system-metrics interval running; kill it so the run can exit.
      publishedMetricsService().stopSystemMetricsCollection();
      await app.stop();
    }
  });

  /**
   * From "Configuration Options": the defaults the comments advertise. No options at all means the
   * `onebun_` prefix and the documented HTTP duration buckets.
   *
   * @source docs:api/metrics.md#configuration-options
   */
  it('defaults to the onebun_ prefix and the documented duration buckets', async () => {
    const service = Effect.runSync(createMetricsService({ collectGcMetrics: false }));

    service.createCounter({ name: 'jobs_total', help: 'Jobs' }).inc(2);
    service.recordHttpRequest({
      method: 'GET', route: '/api/users', statusCode: 200, duration: 0.02, 
    });

    const output = await service.getMetrics();

    expect(output).toContain('onebun_jobs_total 2');

    // The prefix is applied on write and understood on read.
    const counter = requireMetric<Counter<string>>(service, 'http_requests_total');
    expect(await counter.get()).toMatchObject({
      name: 'onebun_http_requests_total',
      values: [{
        value: 1,
        labels: {
          method: 'GET',
          route: '/api/users',
          status_code: '200',
          controller: 'unknown',
          action: 'unknown',
        },
      }],
    });

    const histogram = requireMetric<Histogram<string>>(service, 'http_request_duration_seconds');
    const buckets = (await histogram.get()).values
      .filter((entry) => entry.metricName === 'onebun_http_request_duration_seconds_bucket')
      .map((entry) => entry.labels.le);

    expect(buckets).toEqual([0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, '+Inf']);
  });

  /**
   * From "Configuration Options": `enabled: false` silences the scrape and skips the built-in
   * metrics entirely — `recordHttpRequest` becomes a no-op rather than a crash.
   *
   * @source docs:api/metrics.md#configuration-options
   */
  it('produces nothing at all when enabled is false', async () => {
    const service = Effect.runSync(createMetricsService({ prefix: 'off_', enabled: false }));

    service.recordHttpRequest({
      method: 'GET', route: '/api/users', statusCode: 200, duration: 0.02, 
    });

    expect(await service.getMetrics()).toBe('');
    expect(register.getSingleMetric('off_http_requests_total')).toBeUndefined();
    expect(await register.metrics()).not.toContain('off_');
  });

  /**
   * From "Configuration Options": `collectHttpMetrics: false` drops the request metrics while
   * custom ones keep working, and `httpDurationBuckets` really replaces the bucket layout.
   *
   * @source docs:api/metrics.md#configuration-options
   */
  it('drops HTTP metrics when asked to, and uses the buckets it was given when not', async () => {
    const withoutHttp = Effect.runSync(createMetricsService({
      prefix: 'nohttp_',
      collectHttpMetrics: false,
      collectGcMetrics: false,
      collectSystemMetrics: false,
    }));

    withoutHttp.createCounter({ name: 'jobs_total', help: 'Jobs' }).inc();
    withoutHttp.recordHttpRequest({
      method: 'GET', route: '/api/users', statusCode: 200, duration: 0.5, 
    });

    const silent = await withoutHttp.getMetrics();
    expect(silent).toContain('nohttp_jobs_total 1');
    expect(silent).not.toContain('nohttp_http_requests_total');

    register.clear();

    const withBuckets = Effect.runSync(createMetricsService({
      prefix: 'buckets_',
      collectGcMetrics: false,
      collectSystemMetrics: false,
      httpDurationBuckets: [0.25, 0.75],
    }));

    withBuckets.recordHttpRequest({
      method: 'GET', route: '/api/users', statusCode: 200, duration: 0.5, 
    });

    const output = await withBuckets.getMetrics();
    expect(output).toContain('buckets_http_request_duration_seconds_bucket{le="0.25",method="GET",'
      + 'route="/api/users",status_code="200",controller="unknown",action="unknown"} 0');
    expect(output).toContain('buckets_http_request_duration_seconds_bucket{le="0.75",method="GET",'
      + 'route="/api/users",status_code="200",controller="unknown",action="unknown"} 1');
    expect(output).not.toContain('le="0.001"');
  });

  /**
   * From "Configuration Options": `systemMetricsInterval` is the period of the collection loop —
   * one collection immediately, one per interval afterwards, and none once it is stopped.
   *
   * @source docs:api/metrics.md#configuration-options
   */
  it('re-collects system metrics on the configured interval until stopped', () => {
    const timers = useFakeTimers();

    try {
      const service = Effect.runSync(createMetricsService({
        prefix: 'sysint_',
        collectGcMetrics: false,
        collectHttpMetrics: false,
        collectSystemMetrics: true,
        systemMetricsInterval: 1000,
      }));

      const uptime = requireMetric<Gauge<string>>(service, 'uptime_seconds');
      const originalSet = uptime.set.bind(uptime) as (value: number) => void;
      let collections = 0;

      // Substituted on the instance (never mock.module): every collection sets uptime exactly once.
      uptime.set = ((value: number): void => {
        collections += 1;
        originalSet(value);
      }) as unknown as Gauge<string>['set'];

      service.startSystemMetricsCollection();
      expect(collections).toBe(1);

      timers.advanceTime(2500);
      expect(collections).toBe(3);

      service.stopSystemMetricsCollection();
      timers.advanceTime(10000);
      expect(collections).toBe(3);
    } finally {
      timers.restore();
    }
  });
});

describe('docs/api/metrics.md — Decorator-based Metrics', () => {
  /**
   * From "@Timed()": the decorated method's execution time lands in the named histogram, and the
   * method still returns what it returned before.
   *
   * The prose says the histogram is recorded "automatically" — it does not mention that the metric
   * must already exist; `@Timed` looks the name up and stays silent when it is missing. The second
   * half of this test pins that gap so a future fix is visible.
   *
   * @source docs:api/metrics.md#timed
   */
  it('records the elapsed time of a @Timed method into the named histogram', async () => {
    const service = isolatedMetricsService('test_');
    (globalThis as Record<string, unknown>)[METRICS_GLOBAL] = service;

    service.createHistogram({
      name: 'order_processing_duration_seconds',
      help: 'Order processing duration in seconds',
      buckets: [0.1, 0.5],
    });

    const timers = useFakeTimers();

    try {
      @Service()
      class OrderService extends BaseService {
        processed: string[] = [];

        @Timed('order_processing_duration_seconds')
        async processOrder(orderId: string): Promise<string> {
          // The clock is fake, so "work took 250ms" is exact rather than approximate.
          timers.advanceTime(250);
          this.processed.push(orderId);

          return await Promise.resolve(`order:${orderId}`);
        }

        @Timed('never_registered_duration_seconds')
        async processUntracked(orderId: string): Promise<string> {
          timers.advanceTime(10);

          return await Promise.resolve(`untracked:${orderId}`);
        }
      }

      const orders = new OrderService();

      expect(await orders.processOrder('o-1')).toBe('order:o-1');
      expect(orders.processed).toEqual(['o-1']);

      const output = await service.getMetrics();
      expect(output).toContain('test_order_processing_duration_seconds_bucket{le="0.1"} 0');
      expect(output).toContain('test_order_processing_duration_seconds_bucket{le="0.5"} 1');
      expect(output).toContain('test_order_processing_duration_seconds_sum 0.25');
      expect(output).toContain('test_order_processing_duration_seconds_count 1');

      // No pre-registration needed: the decorator creates its histogram on first use, with
      // generic buckets and a generated help string. This assertion used to be the opposite —
      // it pinned "records nothing" as a documented gap, which is exactly the silent failure
      // the decorators were fixed to stop producing.
      expect(await orders.processUntracked('o-2')).toBe('untracked:o-2');

      const afterUntracked = await service.getMetrics();
      expect(afterUntracked).toContain('test_never_registered_duration_seconds_count 1');
      expect(afterUntracked).toContain('Recorded by the @Timed decorator');
    } finally {
      timers.restore();
    }
  });

  /**
   * From "@Counted()": one increment per call, and the method body runs untouched — same arguments,
   * same side effects.
   *
   * @source docs:api/metrics.md#counted
   */
  it('increments the named counter once per @Counted call', async () => {
    const service = isolatedMetricsService('test_');
    (globalThis as Record<string, unknown>)[METRICS_GLOBAL] = service;

    service.createCounter({ name: 'emails_sent_total', help: 'Total emails sent' });

    @Service()
    class EmailService extends BaseService {
      sent: Array<{ to: string; subject: string }> = [];

      @Counted('emails_sent_total')
      async sendEmail(to: string, subject: string): Promise<void> {
        await Promise.resolve();
        this.sent.push({ to, subject });
      }
    }

    const emails = new EmailService();

    await emails.sendEmail('ann@example.com', 'Welcome');
    await emails.sendEmail('bob@example.com', 'Invoice');

    expect(emails.sent).toEqual([
      { to: 'ann@example.com', subject: 'Welcome' },
      { to: 'bob@example.com', subject: 'Invoice' },
    ]);

    const counter = requireMetric<Counter<string>>(service, 'emails_sent_total');
    expect((await counter.get()).values).toEqual([{ value: 2, labels: {} }]);
    expect(await service.getMetrics()).toContain('test_emails_sent_total 2');
  });

  /**
   * From "@Gauged()": the callback receives the class instance, runs AFTER the method has finished,
   * and may be async — the gauge ends up holding whatever the instance state says at that moment.
   *
   * @source docs:api/metrics.md#gauged
   */
  it('updates the gauge from instance state after the method completes, sync or async', async () => {
    const service = isolatedMetricsService('test_');
    (globalThis as Record<string, unknown>)[METRICS_GLOBAL] = service;

    service.createGauge({ name: 'queue_depth', help: 'Number of pending items' });
    service.createGauge({ name: 'total_items', help: 'Number of stored items' });

    const gate = Promise.withResolvers<void>();

    @Service()
    class QueueService extends BaseService {
      pendingItems: string[] = ['a', 'b', 'c'];
      stored: string[] = [];

      // Sync — read instance state directly
      @Gauged('queue_depth', (self: QueueService) => self.pendingItems.length)
      async processNext(): Promise<void> {
        await gate.promise;
        this.pendingItems.shift();
      }

      // Async — the callback itself returns a promise
      @Gauged('total_items', async (self: QueueService) => await Promise.resolve(self.stored.length))
      async addItem(item: string): Promise<void> {
        await Promise.resolve();
        this.stored.push(item);
      }
    }

    const queue = new QueueService();
    const queueDepth = requireMetric<Gauge<string>>(service, 'queue_depth');
    const totalItems = requireMetric<Gauge<string>>(service, 'total_items');

    // "after method execution": while the method is still in flight the gauge is untouched — it
    // still reads the 0 a fresh unlabelled gauge starts at, not the 3 items sitting in the queue.
    const inFlight = queue.processNext();
    await Bun.sleep(0);
    expect((await queueDepth.get()).values).toEqual([{ value: 0, labels: {} }]);

    gate.resolve();
    await inFlight;
    expect((await queueDepth.get()).values).toEqual([{ value: 2, labels: {} }]);

    // The async callback is awaited, not dropped — and it is re-read on every call.
    await queue.addItem('x');
    await Bun.sleep(0);
    expect((await totalItems.get()).values).toEqual([{ value: 1, labels: {} }]);

    await queue.addItem('y');
    await Bun.sleep(0);
    expect((await totalItems.get()).values).toEqual([{ value: 2, labels: {} }]);
    expect(queue.stored).toEqual(['x', 'y']);
  });
});

describe('docs/api/metrics.md — Complete Example', () => {
  /**
   * From "Complete Example": a service that grabs `this.metrics` in its constructor, a controller
   * that calls it, a module that wires both. The end of the story is the scrape: the counter
   * separates event types, the histogram counted both calls, and the gauge holds what the last
   * `updateQueueDepth` put there.
   *
   * @source docs:api/metrics.md#complete-example
   */
  it('exposes the counters, histogram and gauge the example service registers', async () => {
    @Service()
    class AnalyticsService extends BaseService {
      private eventsCounter?: Counter<string>;
      private processingHistogram?: Histogram<string>;
      private queueGauge?: Gauge<string>;

      constructor() {
        super();
        this.initMetrics();
      }

      async trackEvent(eventType: string, source: string, data: unknown): Promise<void> {
        const startTime = performance.now();

        try {
          await this.processEvent(eventType, data);

          this.eventsCounter?.inc({ event_type: eventType, source });
        } finally {
          const duration = (performance.now() - startTime) / 1000;
          this.processingHistogram?.observe(duration);
        }
      }

      updateQueueDepth(depth: number): void {
        this.queueGauge?.set(depth);
      }

      private initMetrics(): void {
        if (!this.metrics) {
          return;
        }

        this.eventsCounter = this.metrics.createCounter({
          name: 'analytics_events_total',
          help: 'Total analytics events',
          labelNames: ['event_type', 'source'],
        });

        this.processingHistogram = this.metrics.createHistogram({
          name: 'analytics_processing_seconds',
          help: 'Analytics event processing time',
          buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
        });

        this.queueGauge = this.metrics.createGauge({
          name: 'analytics_queue_depth',
          help: 'Current queue depth',
        });
      }

      private async processEvent(eventType: string, data: unknown): Promise<void> {
        await Promise.resolve(data);
        this.logger.debug('Processing event', { eventType });
      }
    }

    @Controller('/analytics')
    class AnalyticsController extends BaseController {
      constructor(private analyticsService: AnalyticsService) {
        super();
      }

      @Post('/track')
      async track(@Body() body: { event: string; source: string; data?: unknown }): Promise<{ tracked: boolean }> {
        await this.analyticsService.trackEvent(body.event, body.source, body.data);

        return { tracked: true };
      }
    }

    @Module({
      controllers: [AnalyticsController],
      providers: [AnalyticsService],
    })
    class AnalyticsModule {}

    const app = new OneBunApplication(AnalyticsModule, {
      port: 0,
      gracefulShutdown: false,
      tracing: { enabled: false },
      metrics: {
        enabled: true,
        prefix: 'ex_',
        collectGcMetrics: false,
        collectSystemMetrics: false,
      },
    });

    try {
      await app.start();

      const base = `http://127.0.0.1:${app.getPort()}`;
      const track = async (event: string, source: string): Promise<unknown> => {
        const response = await fetch(`${base}/analytics/track`, {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, source, data: { page: '/home' } }),
        });

        expect(response.status).toBe(200);

        return await response.json();
      };

      expect(await track('click', 'web')).toEqual({ success: true, result: { tracked: true } });
      expect(await track('view', 'app')).toEqual({ success: true, result: { tracked: true } });
      expect(await track('click', 'web')).toEqual({ success: true, result: { tracked: true } });

      app.getService(AnalyticsService).updateQueueDepth(5);

      const body = await (await fetch(`${base}/metrics`)).text();

      // The counter really separates the label sets the controller passed through.
      expect(body).toContain('ex_analytics_events_total{event_type="click",source="web"} 2');
      expect(body).toContain('ex_analytics_events_total{event_type="view",source="app"} 1');

      // The histogram observed every call, with the buckets the service declared.
      expect(body).toContain('ex_analytics_processing_seconds_count 3');
      expect(body).toContain('ex_analytics_processing_seconds_bucket{le="0.001"}');
      expect(body).not.toContain('ex_analytics_processing_seconds_bucket{le="1"}');

      // The gauge holds the last value written, not an accumulation.
      expect(body).toContain('ex_analytics_queue_depth 5');
    } finally {
      await app.stop();
    }
  });
});
