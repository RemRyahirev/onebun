import { SpanStatusCode as OtelSpanStatusCode, trace as otelTrace } from '@opentelemetry/api';
import { Effect } from 'effect';

import type { HttpTraceData, TraceHeaders } from './types.js';

import { HttpStatusCode } from '@onebun/requests';

import { ALREADY_TRACED } from './auto-trace.js';
import { traceService } from './trace.service.js';

/**
 * Symbol for storing @SpanAttribute metadata on the prototype
 */
export const SPAN_ATTRIBUTES = Symbol.for('onebun:spanAttributes');

/**
 * Metadata entry for a @SpanAttribute parameter
 */
export interface SpanAttributeEntry {
  paramIndex: number;
  attrName: string;
}

/**
 * Read @SpanAttribute metadata and set span attributes from method arguments
 */
function applySpanAttributes(
  target: unknown,
  methodName: string | symbol,
  args: unknown[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeSpan: any,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (target as any)?.[SPAN_ATTRIBUTES]?.[String(methodName)] as
    | SpanAttributeEntry[]
    | undefined;
  if (!meta) {
    return;
  }

  for (const { paramIndex, attrName } of meta) {
    const value = args[paramIndex];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      activeSpan.setAttribute(attrName, value);
    } else {
      activeSpan.setAttribute(attrName, JSON.stringify(value));
    }
  }
}

/**
 * @SpanAttribute() — parameter decorator.
 * Automatically records the method argument as a span attribute when used
 * with @Traced() or @Spanned().
 *
 * @param name - The span attribute name (e.g. 'user.id', 'db.operation')
 *
 * @example
 * ```typescript
 * \@Traced()
 * async findById(
 *   \@SpanAttribute('user.id') id: string,
 * ): Promise<User | null> { ... }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function SpanAttribute(name: string): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = (target as any)[SPAN_ATTRIBUTES] ?? {};
    const key = String(propertyKey);
    existing[key] = existing[key] ?? [];
    existing[key].push({ paramIndex: parameterIndex, attrName: name });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (target as any)[SPAN_ATTRIBUTES] = existing;
  };
}

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
 * Trace decorator for async/await controller and service methods.
 *
 * Creates an OpenTelemetry span around the decorated method. Works with
 * methods that return Promises — the span is automatically ended when
 * the Promise resolves or rejects.
 *
 * @param operationName - Custom span name. Defaults to `ClassName.methodName`
 *
 * @example
 * ```typescript
 * class WorkspaceService extends BaseService {
 *   \@Traced('workspace.findAll')
 *   async findAll(): Promise<Workspace[]> { ... }
 * }
 * ```
 */
export function trace(operationName?: string): MethodDecorator {
  return (target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const targetConstructor =
      target && typeof target === 'object' && target.constructor
        ? target.constructor
        : { name: 'Unknown' };
    const spanName = operationName || `${targetConstructor.name}.${String(propertyKey)}`;
    const decoratorTarget = target;

    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const tracer = otelTrace.getTracer('@onebun/trace');

      return await tracer.startActiveSpan(spanName, async (activeSpan) => {
        applySpanAttributes(decoratorTarget, propertyKey, args, activeSpan);

        try {
          const result = await originalMethod.apply(this, args);
          activeSpan.setStatus({ code: OtelSpanStatusCode.OK });

          return result;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          activeSpan.setStatus({ code: OtelSpanStatusCode.ERROR, message: err.message });
          activeSpan.recordException(err);
          throw error;
        } finally {
          activeSpan.end();
        }
      });
    };

    // Mark as traced to prevent auto-trace from double-wrapping
    (wrapped as unknown as Record<symbol, boolean>)[ALREADY_TRACED] = true;
    descriptor.value = wrapped;

    return descriptor;
  };
}

/**
 * Span decorator for creating custom spans around async methods.
 *
 * Lighter version of \@trace — creates a span without automatic error attribute
 * enrichment. Best for internal methods where you want basic span tracking.
 *
 * @param name - Custom span name. Defaults to `ClassName.methodName`
 */
export function span(name?: string): MethodDecorator {
  return (target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    const targetConstructor =
      target && typeof target === 'object' && target.constructor
        ? target.constructor
        : { name: 'Unknown' };
    const resolvedName = name || `${targetConstructor.name}.${String(propertyKey)}`;
    const decoratorTarget = target;

    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const tracer = otelTrace.getTracer('@onebun/trace');

      return await tracer.startActiveSpan(resolvedName, async (activeSpan) => {
        applySpanAttributes(decoratorTarget, propertyKey, args, activeSpan);

        try {
          const result = await originalMethod.apply(this, args);

          return result;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          activeSpan.setStatus({ code: OtelSpanStatusCode.ERROR, message: err.message });
          throw error;
        } finally {
          activeSpan.end();
        }
      });
    };

    // Mark as traced to prevent auto-trace from double-wrapping
    (wrapped as unknown as Record<symbol, boolean>)[ALREADY_TRACED] = true;
    descriptor.value = wrapped;

    return descriptor;
  };
}

// Aliases — all point to the same async-compatible implementations
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Trace = trace;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Span = span;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Traced = trace;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const Spanned = span;
