import { Effect } from 'effect';

import { TraceService } from './trace.service.js';
import { TraceHeaders, HttpTraceData } from './types.js';

/**
 * HTTP trace middleware for OneBun applications
 */
export class TraceMiddleware {
  /**
   * Create trace middleware Effect
   */
  static create() {
    return Effect.flatMap(
      TraceService,
      (traceService) => Effect.succeed((request: any, next: () => Promise<any>) => {
        return Effect.runPromise(
          Effect.flatMap(
            traceService.extractFromHeaders(this.extractHeaders(request)),
            (extractedContext) => Effect.flatMap(
              extractedContext 
                ? traceService.setContext(extractedContext)
                : Effect.flatMap(
                  traceService.generateTraceContext(),
                  (newContext) => traceService.setContext(newContext),
                ),
              () => {
                const httpData: Partial<HttpTraceData> = {
                  method: request.method,
                  url: request.url,
                  route: request.route?.path,
                  userAgent: request.headers?.['user-agent'],
                  remoteAddr: this.getRemoteAddress(request),
                  requestSize: this.getRequestSize(request),
                };

                const startTime = Date.now();

                return Effect.flatMap(
                  traceService.startHttpTrace(httpData),
                  (span) => Effect.tryPromise({
                    try: () => next(),
                    catch: (error) => error as Error,
                  }).pipe(
                    Effect.tap((response) => {
                      const endTime = Date.now();
                      const finalData: Partial<HttpTraceData> = {
                        statusCode: response?.status || 200,
                        responseSize: this.getResponseSize(response),
                        duration: endTime - startTime,
                      };

                      return traceService.endHttpTrace(span, finalData);
                    }),
                    Effect.tapError((error) => {
                      const endTime = Date.now();
                      const errorData: Partial<HttpTraceData> = {
                        statusCode: 500,
                        duration: endTime - startTime,
                      };

                      return Effect.flatMap(
                        traceService.addEvent('error', {
                          'error.type': error.constructor.name,
                          'error.message': error.message,
                        }),
                        () => traceService.endHttpTrace(span, errorData),
                      );
                    }),
                  ),
                );
              },
            ),
          ),
        );
      }),
    );
  }

  /**
   * Extract trace headers from HTTP request
   */
  private static extractHeaders(request: any): TraceHeaders {
    const headers = request.headers || {};

    return {
      'traceparent': headers['traceparent'],
      'tracestate': headers['tracestate'],
      'x-trace-id': headers['x-trace-id'],
      'x-span-id': headers['x-span-id'],
    };
  }

  /**
   * Get remote address from request
   */
  private static getRemoteAddress(request: any): string | undefined {
    return request.headers?.['x-forwarded-for'] || 
           request.headers?.['x-real-ip'] || 
           request.socket?.remoteAddress ||
           request.connection?.remoteAddress;
  }

  /**
   * Get request content length
   */
  private static getRequestSize(request: any): number | undefined {
    const contentLength = request.headers?.['content-length'];

    return contentLength ? parseInt(contentLength, 10) : undefined;
  }

  /**
   * Get response content length
   */
  private static getResponseSize(response: any): number | undefined {
    if (!response) {
      return undefined;
    }
    
    const contentLength = response.headers?.['content-length'];
    if (contentLength) {
      return parseInt(contentLength, 10);
    }

    // Try to estimate from body
    if (typeof response.body === 'string') {
      return Buffer.byteLength(response.body);
    }

    if (Buffer.isBuffer(response.body)) {
      return response.body.length;
    }

    if (response.body && typeof response.body === 'object') {
      return Buffer.byteLength(JSON.stringify(response.body));
    }

    return undefined;
  }
}

/**
 * Create trace middleware function for Bun server
 */
export const createTraceMiddleware = () => {
  return TraceMiddleware.create();
};

/**
 * Trace decorator for controller methods
 */
export function Trace(operationName?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const spanName = operationName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = function (...args: any[]) {
      return Effect.flatMap(
        TraceService,
        (traceService) => Effect.flatMap(
          traceService.startSpan(spanName),
          (span) => {
            const startTime = Date.now();
            
            return Effect.tryPromise({
              try: () => originalMethod.apply(this, args),
              catch: (error) => error as Error,
            }).pipe(
              Effect.tap(() => {
                const duration = Date.now() - startTime;

                return Effect.flatMap(
                  traceService.setAttributes({
                    'method.name': propertyKey,
                    'method.duration': duration,
                  }),
                  () => traceService.endSpan(span),
                );
              }),
              Effect.tapError((error) => {
                const duration = Date.now() - startTime;

                return Effect.flatMap(
                  traceService.setAttributes({
                    'method.name': propertyKey,
                    'method.duration': duration,
                    'error.type': error.constructor.name,
                    'error.message': error.message,
                  }),
                  () => traceService.endSpan(span, {
                    code: 2, // ERROR
                    message: error.message,
                  }),
                );
              }),
            );
          },
        ),
      );
    };

    return descriptor;
  };
}

/**
 * Span decorator for creating custom spans
 */
export function Span(name?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const spanName = name || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = function (...args: any[]) {
      return Effect.flatMap(
        TraceService,
        (traceService) => Effect.flatMap(
          traceService.startSpan(spanName),
          (span) => Effect.flatMap(
            Effect.try(() => originalMethod.apply(this, args)),
            (result) => Effect.flatMap(
              traceService.endSpan(span),
              () => Effect.succeed(result),
            ),
          ),
        ),
      );
    };

    return descriptor;
  };
} 