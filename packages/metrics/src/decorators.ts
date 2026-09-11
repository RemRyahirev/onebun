/* eslint-disable
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/naming-convention */
// Decorators work with any class/method types - this is standard for TypeScript decorators
// PascalCase naming is standard for decorator functions (e.g., @Component, @Injectable)

import { Effect } from 'effect';

import type { CustomMetricConfig } from './types';

import { MetricsService } from './metrics.service';
import { ownerMetricsService } from './owner';

/**
 * Decorator for measuring method execution time.
 * Records duration in a histogram metric.
 * Default metric name: `{ClassName}_{methodName}_duration`
 *
 * @see docs:api/metrics.md
 */
export function Timed(metricName?: string, labels?: string[]): MethodDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value;
    const methodName = metricName || `${target.constructor.name}_${String(propertyKey)}_duration`;

    descriptor.value = function (...args: any[]): any {
      const startTime = Date.now();
      // Captured before the continuations: `this` is what says which application owns this
      // measurement, and the `.then`/`.catch` closures do not have it.
      const owner = this;

      try {
        const result = originalMethod.apply(this, args);

        if (result instanceof Promise) {
          return result
            .then((res) => {
              recordDuration(methodName, startTime, labels, owner);

              return res;
            })
            .catch((err) => {
              recordDuration(methodName, startTime, labels, owner);
              throw err;
            });
        } else {
          recordDuration(methodName, startTime, labels, owner);

          return result;
        }
      } catch (err) {
        recordDuration(methodName, startTime, labels, owner);
        throw err;
      }
    };

    return descriptor;
  };
}

/**
 * Decorator for counting method calls.
 * Increments a counter metric on each call.
 * Default metric name: `{ClassName}_{methodName}_calls_total`
 *
 * @see docs:api/metrics.md
 */
export function Counted(metricName?: string, labels?: string[]): MethodDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value;
    const counterName =
      metricName || `${target.constructor.name}_${String(propertyKey)}_calls_total`;

    descriptor.value = function (...args: any[]): any {
      incrementCounter(counterName, labels, this);

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Decorator for measuring gauge values.
 * Updates a gauge metric after method execution.
 * The `getValue` callback receives the class instance, so you can read instance state.
 * Supports both sync and async callbacks:
 *
 * ```typescript
 * @Gauged('queue_depth', (self) => self.pendingItems.length)
 * @Gauged('db_count', async (self) => self.repo.count())
 * ```
 *
 * @see docs:api/metrics.md
 */
export function Gauged<T extends object>(
  metricName: string,
  getValue: (instance: T) => number | Promise<number>,
  labels?: string[],
): (target: T, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor {
  return (
    target: T,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value;

    descriptor.value = function (this: T, ...args: any[]): any {
      const result = originalMethod.apply(this, args);
      const instance = this;
      const logger = 'logger' in this && this.logger as { warn(msg: string, ctx?: object): void }
        | undefined;
      const logWarn = (error: unknown): void => {
        const msg = `Failed to update gauge ${metricName}`;
        if (logger) {
          logger.warn(msg, { error });
        }
      };

      // Update gauge after method execution
      const updateGauge = (): void => {
        try {
          const valueOrPromise = getValue(instance);

          if (valueOrPromise instanceof Promise) {
            valueOrPromise.then(
              (value) => setGaugeValue(metricName, value, labels, instance),
              logWarn,
            );
          } else {
            setGaugeValue(metricName, valueOrPromise, labels, instance);
          }
        } catch (error) {
          logWarn(error);
        }
      };

      if (result instanceof Promise) {
        return result.then((res) => {
          updateGauge();

          return res;
        });
      } else {
        updateGauge();

        return result;
      }
    };

    return descriptor;
  };
}

/**
 * Decorator for automatic metric creation and injection
 */
export function InjectMetric(config: CustomMetricConfig): PropertyDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
  ): void => {
    // For now, just log the configuration
    // eslint-disable-next-line no-console
    console.log(
      `Metric ${config.name} will be injected into ${target.constructor.name}.${String(propertyKey)}`,
    );
  };
}

/**
 * Class decorator for automatic metric initialization
 */
export function WithMetrics(
  options: { prefix?: string } = {},
): <T extends new (...args: any[]) => any>(constructor: T) => T {
  return <T extends new (...args: any[]) => any>(constructor: T): T =>
    class extends constructor {
      constructor(...args: any[]) {
        super(...args);
        // For now, just log initialization
        // eslint-disable-next-line no-console
        console.log(
          `WithMetrics applied to ${constructor.name} with prefix: ${options.prefix || 'none'}`,
        );
      }
    };
}

/**
 * Fetch the metric a decorator writes to, creating it on first use.
 *
 * The decorators used to only LOOK IT UP, and do nothing when the name was absent from the
 * registry. Since nothing ever created it, `@Timed('order_duration_seconds')` copied from the
 * documentation recorded nothing at all — and did so in the direction that hides itself: the
 * method ran, the scrape answered, and the series simply never appeared. The reader went looking
 * for the fault in Prometheus.
 *
 * Creating on first use is what the documentation already promises ("execution time is
 * automatically recorded"). The alternative — refusing an unregistered name — would mean
 * demanding a manual `createHistogram()` alongside every decorator, which is a worse API and not
 * what the page says.
 *
 * `labelNames` is derived from the decorator's own labels, which are fixed at decoration time, so
 * a given decorated method always produces the same shape. Two decorators sharing one name with
 * different label sets is a real conflict, and `prom-client` reports it rather than this silently
 * papering over it.
 */
function resolveMetric(
  kind: 'histogram' | 'counter' | 'gauge',
  metricName: string,
  labels: string[] | undefined,
  owner: unknown,
): any {
  const metricsService = getMetricsService(owner);
  if (!metricsService) {
    return undefined;
  }

  const existing = metricsService.getMetric(metricName);
  if (existing) {
    return existing;
  }

  const config = {
    name: metricName,
    help: `Recorded by the @${kind === 'histogram' ? 'Timed' : kind === 'counter' ? 'Counted' : 'Gauged'} decorator`,
    labelNames: labels ? ['labels'] : [],
  };

  try {
    if (kind === 'histogram') {
      return metricsService.createHistogram(config);
    }

    return kind === 'counter'
      ? metricsService.createCounter(config)
      : metricsService.createGauge(config);
  } catch {
    // A name already taken by a metric of a different type, or a label-set conflict. The
    // registry owns that diagnosis; re-reading is enough to keep recording where it can.
    return metricsService.getMetric(metricName);
  }
}

/**
 * Helper functions for metric operations
 */
function recordDuration(metricName: string, startTime: number, labels: string[] | undefined, owner: unknown): void {
  const duration = (Date.now() - startTime) / 1000;
  const histogram = resolveMetric('histogram', metricName, labels, owner);

  if (histogram && typeof histogram.observe === 'function') {
    histogram.observe(labels ? { labels: labels.join(',') } : {}, duration);
  }
}

function incrementCounter(metricName: string, labels: string[] | undefined, owner: unknown): void {
  const counter = resolveMetric('counter', metricName, labels, owner);

  if (counter && typeof counter.inc === 'function') {
    counter.inc(labels ? { labels: labels.join(',') } : {});
  }
}

function setGaugeValue(metricName: string, value: number, labels: string[] | undefined, owner: unknown): void {
  const gauge = resolveMetric('gauge', metricName, labels, owner);

  if (gauge && typeof gauge.set === 'function') {
    gauge.set(labels ? { labels: labels.join(',') } : {}, value);
  }
}

/**
 * The metrics service these decorators should record into.
 *
 * The instance the decorated method is running on FIRST: a method decorator has no application
 * at decoration time, but `this` at call time carries the scope of the application that built
 * it. Reading the process-wide slot alone put a first application's measurements into a second
 * application's registry, under its prefix and its labels.
 *
 * The slot remains the fallback, for an instance the framework did not build — a plain class,
 * a static method, a detached function reference. In a single-application process that is the
 * same service either way.
 */
function getMetricsService(owner?: unknown): any {
  const fromOwner = ownerMetricsService(owner);
  if (fromOwner) {
    return fromOwner;
  }

  if (typeof globalThis !== 'undefined') {
    return (globalThis as any).__onebunMetricsService;
  }

  return undefined;
}

/**
 * @deprecated Use `Timed` instead. Will be removed in 1.0.
 */
export const MeasureTime = Timed;

/**
 * @deprecated Use `Counted` instead. Will be removed in 1.0.
 */
export const CountCalls = Counted;

/**
 * @deprecated Use `Gauged` instead. Will be removed in 1.0.
 */
export const MeasureGauge = Gauged;

/**
 * Effect-based decorators
 */
export const measureExecutionTime = <A, E, R>(
  metricName: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | MetricsService> => {
  const MILLISECONDS_PER_SECOND = 1000;

  const observeMetric = (
    metricsService: { getMetric: (name: string) =>
      { observe?: (labels: Record<string, string>, value: number) => void } | undefined; },
    startTime: number,
    labels: Record<string, string> = {},
  ) => {
    const duration = (Date.now() - startTime) / MILLISECONDS_PER_SECOND;
    const histogram = metricsService.getMetric(metricName);
    if (histogram && typeof histogram.observe === 'function') {
      histogram.observe(labels, duration);
    }
  };

  return MetricsService.pipe(
    Effect.andThen((metricsService) => {
      const startTime = Date.now();

      return effect.pipe(
        Effect.tap(() => Effect.sync(() => observeMetric(metricsService, startTime))),
        Effect.tapError(() =>
          Effect.sync(() => observeMetric(metricsService, startTime, { status: 'error' }))),
      );
    }),
  );
};
