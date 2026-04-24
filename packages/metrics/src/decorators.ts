/* eslint-disable
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/naming-convention */
// Decorators work with any class/method types - this is standard for TypeScript decorators
// PascalCase naming is standard for decorator functions (e.g., @Component, @Injectable)

import { Effect } from 'effect';

import type { CustomMetricConfig } from './types';

import { MetricsService } from './metrics.service';

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

      try {
        const result = originalMethod.apply(this, args);

        if (result instanceof Promise) {
          return result
            .then((res) => {
              recordDuration(methodName, startTime, labels);

              return res;
            })
            .catch((err) => {
              recordDuration(methodName, startTime, labels);
              throw err;
            });
        } else {
          recordDuration(methodName, startTime, labels);

          return result;
        }
      } catch (err) {
        recordDuration(methodName, startTime, labels);
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
      incrementCounter(counterName, labels);

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
              (value) => setGaugeValue(metricName, value, labels),
              logWarn,
            );
          } else {
            setGaugeValue(metricName, valueOrPromise, labels);
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
 * Helper functions for metric operations
 */
function recordDuration(metricName: string, startTime: number, labels?: string[]): void {
  const metricsService = getMetricsService();
  if (!metricsService) {
    return;
  }

  const duration = (Date.now() - startTime) / 1000;
  const histogram = metricsService.getMetric(metricName);

  if (histogram && typeof histogram.observe === 'function') {
    histogram.observe(labels ? { labels: labels.join(',') } : {}, duration);
  }
}

function incrementCounter(metricName: string, labels?: string[]): void {
  const metricsService = getMetricsService();
  if (!metricsService) {
    return;
  }

  const counter = metricsService.getMetric(metricName);

  if (counter && typeof counter.inc === 'function') {
    counter.inc(labels ? { labels: labels.join(',') } : {});
  }
}

function setGaugeValue(metricName: string, value: number, labels?: string[]): void {
  const metricsService = getMetricsService();
  if (!metricsService) {
    return;
  }

  const gauge = metricsService.getMetric(metricName);

  if (gauge && typeof gauge.set === 'function') {
    gauge.set(labels ? { labels: labels.join(',') } : {}, value);
  }
}

/**
 * Get metrics service from global context
 * This is a temporary solution until proper DI is implemented
 */
function getMetricsService(): any {
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
