import { Effect } from 'effect';

import type { HttpTraceData, TraceHeaders } from './types.js';

import { HttpStatusCode } from '@onebun/requests';

import { traceService } from './trace.service.js';

/**
 * HTTP trace middleware for OneBun applications
 */
export class TraceMiddleware {
  /**
   * Create trace middleware Effect
   */
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  static create() {
    return Effect.flatMap(traceService, (traceServiceInstance) =>
      Effect.succeed((request: Request, next: () => Promise<Response>) => {
        return Effect.runPromise(
          Effect.flatMap(
            traceServiceInstance.extractFromHeaders(TraceMiddleware.extractHeaders(request)),
            (extractedContext) =>
              Effect.flatMap(
                extractedContext
                  ? traceServiceInstance.setContext(extractedContext)
                  : Effect.flatMap(traceServiceInstance.generateTraceContext(), (newContext) =>
                    traceServiceInstance.setContext(newContext),
                  ),
                () => {
                  const httpData: Partial<HttpTraceData> = {
                    method: request.method,
                    url: request.url,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    route: (request as any).route?.path,
                    userAgent: request.headers.get('user-agent') || undefined,
                    remoteAddr: TraceMiddleware.getRemoteAddress(request),
                    requestSize: TraceMiddleware.getRequestSize(request),
                  };

                  const startTime = Date.now();

                  return Effect.flatMap(
                    traceServiceInstance.startHttpTrace(httpData),
                    (_httpSpan) =>
                      Effect.tryPromise({
                        try: () => next(),
                        catch: (error) => error as Error,
                      }).pipe(
                        Effect.tap((response) => {
                          const endTime = Date.now();
                          const finalData: Partial<HttpTraceData> = {
                            statusCode:
                              (response && typeof response === 'object' && 'status' in response
                                ? (response.status as number)
                                : undefined) || HttpStatusCode.OK,
                            responseSize: TraceMiddleware.getResponseSize(response),
                            duration: endTime - startTime,
                          };

                          return traceServiceInstance.endHttpTrace(_httpSpan, finalData);
                        }),
                        Effect.tapError((error) => {
                          const endTime = Date.now();
                          const errorData: Partial<HttpTraceData> = {
                            statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR,
                            duration: endTime - startTime,
                          };

                          return Effect.flatMap(
                            traceServiceInstance.addEvent('error', {
                              // eslint-disable-next-line @typescript-eslint/naming-convention
                              'error.type': error.constructor.name,
                              // eslint-disable-next-line @typescript-eslint/naming-convention
                              'error.message': error.message,
                            }),
                            () => traceServiceInstance.endHttpTrace(_httpSpan, errorData),
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
  private static extractHeaders(request: Request): TraceHeaders {
    return {
      traceparent: request.headers.get('traceparent') || undefined,
      tracestate: request.headers.get('tracestate') || undefined,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-trace-id': request.headers.get('x-trace-id') || undefined,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-span-id': request.headers.get('x-span-id') || undefined,
    };
  }

  /**
   * Get remote address from request
   */
  private static getRemoteAddress(request: unknown): string | undefined {
    if (!request || typeof request !== 'object') {
      return undefined;
    }

    const headers = 'headers' in request ? (request.headers as Record<string, string>) : {};
    const socket = 'socket' in request ? (request.socket as { remoteAddress?: string }) : {};
    const connection =
      'connection' in request ? (request.connection as { remoteAddress?: string }) : {};

    return (
      headers['x-forwarded-for'] ||
      headers['x-real-ip'] ||
      socket.remoteAddress ||
      connection.remoteAddress
    );
  }

  /**
   * Get request content length
   */
  private static getRequestSize(request: unknown): number | undefined {
    if (!request || typeof request !== 'object' || !('headers' in request)) {
      return undefined;
    }

    const headers = request.headers as Record<string, string>;
    const contentLength = headers['content-length'];

    return contentLength ? parseInt(contentLength, 10) : undefined;
  }

  /**
   * Get response content length
   */
  private static getResponseSize(response: unknown): number | undefined {
    if (!response || typeof response !== 'object') {
      return undefined;
    }

    const DECIMAL_BASE = 10;

    if ('headers' in response) {
      const headers = response.headers as Record<string, string>;
      const contentLength = headers['content-length'];
      if (contentLength) {
        return parseInt(contentLength, DECIMAL_BASE);
      }
    }

    // Try to estimate from body
    if ('body' in response) {
      const body = response.body;

      if (typeof body === 'string') {
        return Buffer.byteLength(body);
      }

      if (Buffer.isBuffer(body)) {
        return body.length;
      }

      if (body && typeof body === 'object') {
        return Buffer.byteLength(JSON.stringify(body));
      }
    }

    return undefined;
  }
}

/**
 * Create trace middleware function for Bun server
 */
export const createTraceMiddleware = (): TraceMiddleware => {
  return TraceMiddleware.create();
};

/**
 * Trace decorator for controller methods
 */
export function trace(operationName?: string): MethodDecorator {
  return (target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const targetConstructor =
      target && typeof target === 'object' && target.constructor
        ? target.constructor
        : { name: 'Unknown' };
    const spanName = operationName || `${targetConstructor.name}.${String(propertyKey)}`;

    descriptor.value = function (...args: unknown[]) {
      return Effect.flatMap(traceService, (traceServiceInstance) =>
        Effect.flatMap(traceServiceInstance.startSpan(spanName), (_traceSpan) => {
          const startTime = Date.now();

          return Effect.tryPromise({
            try: () => originalMethod.apply(this, args),
            catch: (error) => error as Error,
          }).pipe(
            Effect.tap(() => {
              const duration = Date.now() - startTime;

              return Effect.flatMap(
                traceServiceInstance.setAttributes({
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'method.name': String(propertyKey),
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'method.duration': duration,
                }),
                () => traceServiceInstance.endSpan(_traceSpan),
              );
            }),
            Effect.tapError((error) => {
              const duration = Date.now() - startTime;

              return Effect.flatMap(
                traceServiceInstance.setAttributes({
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'method.name': String(propertyKey),
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'method.duration': duration,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'error.type': error.constructor.name,
                  // eslint-disable-next-line @typescript-eslint/naming-convention
                  'error.message': error.message,
                }),
                () =>
                  traceServiceInstance.endSpan(_traceSpan, {
                    code: 2, // ERROR
                    message: error.message,
                  }),
              );
            }),
          );
        }),
      );
    };

    return descriptor;
  };
}

/**
 * Span decorator for creating custom spans
 */
export function span(name?: string): MethodDecorator {
  return (target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const targetConstructor =
      target && typeof target === 'object' && target.constructor
        ? target.constructor
        : { name: 'Unknown' };
    const spanName = name || `${targetConstructor.name}.${String(propertyKey)}`;

    descriptor.value = function (...args: unknown[]) {
      return Effect.flatMap(traceService, (traceServiceInstance) =>
        Effect.flatMap(traceServiceInstance.startSpan(spanName), (spanInstance) =>
          Effect.flatMap(
            Effect.try(() => originalMethod.apply(this, args)),
            (result) =>
              Effect.flatMap(traceServiceInstance.endSpan(spanInstance), () =>
                Effect.succeed(result),
              ),
          ),
        ),
      );
    };

    return descriptor;
  };
}

// Backward compatibility aliases
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Trace = trace;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Span = span;
