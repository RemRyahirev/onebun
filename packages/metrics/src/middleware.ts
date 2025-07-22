import { Effect } from 'effect';

import type { HttpMetricsData } from './types';

import { HttpStatusCode } from '@onebun/requests';

import { MetricsService } from './metrics.service';

/**
 * Metrics middleware for automatic HTTP metrics collection
 */
export class MetricsMiddleware {
  constructor(private metricsService: MetricsService) {}

  /**
   * Create middleware function for HTTP request metrics
   */
  createHttpMetricsMiddleware() {
    return async (
      req: Request,
      context: {
        controller?: string;
        action?: string;
        route?: string;
      } = {},
    ): Promise<(response: Response, startTime: number) => void> => {
      return (response: Response, requestStartTime: number) => {
        const duration = (Date.now() - requestStartTime) / 1000; // Convert to seconds
        const url = new URL(req.url);

        const metricsData: HttpMetricsData = {
          method: req.method,
          route: context.route || url.pathname,
          statusCode: response.status,
          duration,
          controller: context.controller,
          action: context.action,
        };

        this.metricsService.recordHttpRequest(metricsData);
      };
    };
  }

  /**
   * Wrap controller method with metrics collection
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapControllerMethod<T extends (...args: any[]) => any>(
    originalMethod: T,
    controllerName: string,
    methodName: string,
    route: string,
  ): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (async (...args: any[]) => {
      const startTime = Date.now();
      let statusCode = HttpStatusCode.OK;
      try {
        const result = await originalMethod.apply(this, args);

        // If result is a Response, extract status code
        if (result instanceof Response) {
          statusCode = result.status;
        }

        return result;
      } catch (err) {
        statusCode = HttpStatusCode.INTERNAL_SERVER_ERROR; // Default error status
        throw err;
      } finally {
        const duration = (Date.now() - startTime) / 1000;

        this.metricsService.recordHttpRequest({
          method: 'UNKNOWN', // Will be overridden by actual request
          route,
          statusCode,
          duration,
          controller: controllerName,
          action: methodName,
        });
      }
    }) as T;
  }
}

/**
 * Decorator for automatic metrics collection on controller methods
 */
// eslint-disable-next-line @typescript-eslint/naming-convention,@typescript-eslint/no-explicit-any
export function WithMetrics(route?: string): any {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: any, 
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    const originalMethod = descriptor.value;
    const controllerName = target.constructor.name;
    const routePath = route || `/${propertyKey}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = function (...args: any[]) {
      const startTime = Date.now(); 

      try {
        const result = originalMethod.apply(this, args);

        // Handle both sync and async methods
        if (result instanceof Promise) {
          return result
            .then((res) => {
              recordMetrics(controllerName, propertyKey, routePath, startTime, HttpStatusCode.OK);

              return res;
            })
            .catch((err) => {
              recordMetrics(
                controllerName,
                propertyKey,
                routePath,
                startTime,
                HttpStatusCode.INTERNAL_SERVER_ERROR,
              );
              throw err;
            });
        } else {
          recordMetrics(controllerName, propertyKey, routePath, startTime, HttpStatusCode.OK);

          return result;
        }
      } catch (err) {
        recordMetrics(
          controllerName,
          propertyKey,
          routePath,
          startTime,
          HttpStatusCode.INTERNAL_SERVER_ERROR,
        );
        throw err;
      }
    };

    return descriptor;
  };
}

/**
 * Helper function to record metrics
 */
function recordMetrics(
  controller: string,
  action: string,
  route: string,
  startTime: number,
  statusCode: number,
): void {
  const duration = (Date.now() - startTime) / 1000;

  // This would ideally get the metrics service from the current context
  // For now, we'll store this information and let the application handle it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof globalThis !== 'undefined' && (globalThis as any).__onebunMetricsService) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metricsService = (globalThis as any).__onebunMetricsService; 
    metricsService.recordHttpRequest({
      method: 'UNKNOWN',
      route,
      statusCode,
      duration,
      controller,
      action,
    });
  }
}

/**
 * Effect-based metrics collection
 */
export const recordHttpMetrics = (
  data: HttpMetricsData,
): Effect.Effect<void, never, MetricsService> =>
  Effect.gen(function* () {
    const metricsService = yield* MetricsService;
    metricsService.recordHttpRequest(data);
  });
