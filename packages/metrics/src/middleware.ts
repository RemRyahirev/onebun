import { Effect } from 'effect';

import type { HttpMetricsData } from './types';

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
      const startTime = Date.now();

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
  wrapControllerMethod<T extends (...args: any[]) => any>(
    originalMethod: T,
    controllerName: string,
    methodName: string,
    route: string,
  ): T {
    return (async (...args: any[]) => {
      const startTime = Date.now();
      let statusCode = 200;
      let error: any;

      try {
        const result = await originalMethod.apply(this, args);
        
        // If result is a Response, extract status code
        if (result instanceof Response) {
          statusCode = result.status;
        }
        
        return result;
      } catch (err) {
        error = err;
        statusCode = 500; // Default error status
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
export function WithMetrics(route?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const controllerName = target.constructor.name;
    const routePath = route || `/${propertyKey}`;

    descriptor.value = function (...args: any[]) {
      const startTime = Date.now();
      
      try {
        const result = originalMethod.apply(this, args);
        
        // Handle both sync and async methods
        if (result instanceof Promise) {
          return result
            .then((res) => {
              recordMetrics(controllerName, propertyKey, routePath, startTime, 200);

              return res;
            })
            .catch((err) => {
              recordMetrics(controllerName, propertyKey, routePath, startTime, 500);
              throw err;
            });
        } else {
          recordMetrics(controllerName, propertyKey, routePath, startTime, 200);

          return result;
        }
      } catch (err) {
        recordMetrics(controllerName, propertyKey, routePath, startTime, 500);
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
  if (typeof globalThis !== 'undefined' && (globalThis as any).__onebunMetricsService) {
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
