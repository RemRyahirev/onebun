/* eslint-disable
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/naming-convention */
// Decorators work with any class/method types - this is standard for TypeScript decorators
// PascalCase naming is standard for decorator functions (e.g., @Component, @Injectable)

import { Effect } from 'effect';

import type { CustomMetricConfig } from './types';

import { MetricsService } from './metrics.service';

/**
 * Decorator for measuring method execution time
 */
export function MeasureTime(metricName?: string, labels?: string[]): MethodDecorator {
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
 * Decorator for counting method calls
 */
export function CountCalls(metricName?: string, labels?: string[]): MethodDecorator {
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
 * Decorator for measuring gauge values
 */
export function MeasureGauge(
  metricName: string,
  getValue: () => number,
  labels?: string[],
): MethodDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]): any {
      const result = originalMethod.apply(this, args);

      // Update gauge after method execution
      const updateGauge = (): void => {
        try {
          const value = getValue();
          setGaugeValue(metricName, value, labels);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`Failed to update gauge ${metricName}:`, error);
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
 * Effect-based decorators
 */
export const measureExecutionTime = <A, E, R>(
  metricName: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | MetricsService> =>
  Effect.gen(function* () {
    const metricsService = yield* MetricsService;
    const startTime = Date.now();

    try {
      const result = yield* effect;
      const duration = (Date.now() - startTime) / 1000;

      // Record to histogram if exists
      const histogram = metricsService.getMetric(metricName);
      if (histogram && typeof histogram.observe === 'function') {
        histogram.observe({}, duration);
      }

      return result;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;

      // Still record the duration even on error
      const histogram = metricsService.getMetric(metricName);
      if (histogram && typeof histogram.observe === 'function') {
        histogram.observe({ status: 'error' }, duration);
      }

      throw error;
    }
  });
