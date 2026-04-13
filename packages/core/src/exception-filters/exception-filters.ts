/**
 * Exception Filters
 *
 * Intercept and transform errors thrown by route handlers.
 * Apply with `@UseFilters()` on controllers or individual routes,
 * or globally via `ApplicationOptions.filters`.
 */

import type { HttpExecutionContext, OneBunResponse } from '../types';

import {
  createErrorResponse,
  HttpStatusCode,
  OneBunBaseError,
} from '@onebun/requests';

import { HttpException } from './http-exception';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Exception Filter interface — implement to handle errors thrown by route handlers.
 *
 * @example
 * ```typescript
 * class HttpExceptionFilter implements ExceptionFilter {
 *   catch(error: unknown, ctx: HttpExecutionContext): Response {
 *     const status = error instanceof OneBunBaseError ? error.code : 500;
 *     return new Response(JSON.stringify({ message: String(error) }), {
 *       status,
 *       headers: { 'Content-Type': 'application/json' },
 *     });
 *   }
 * }
 * ```
 */
export interface ExceptionFilter {
  catch(error: unknown, context: HttpExecutionContext): OneBunResponse | Promise<OneBunResponse>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a custom exception filter from a plain function.
 *
 * @param fn - Filter function receiving the error and execution context
 * @returns An ExceptionFilter instance
 *
 * @example
 * ```typescript
 * const logAndForwardFilter = createExceptionFilter((error, ctx) => {
 *   console.error(`[${ctx.getController()}#${ctx.getHandler()}]`, error);
 *   return new Response('Internal Error', { status: 500 });
 * });
 *
 * @UseFilters(logAndForwardFilter)
 * @Get('/risky')
 * riskyRoute() { ... }
 * ```
 */
export function createExceptionFilter(
  fn: (error: unknown, context: HttpExecutionContext) => OneBunResponse | Promise<OneBunResponse>,
): ExceptionFilter {
  return { catch: fn };
}

// ============================================================================
// Default filter (wraps existing error-handling logic)
// ============================================================================

/**
 * Create the default exception filter.
 *
 * @param options.httpEnvelope - When true, all error responses use HTTP 200 (envelope mode).
 *   When false (default), proper HTTP status codes are used.
 */
export function createDefaultExceptionFilter(
  options: { httpEnvelope?: boolean } = {},
): ExceptionFilter {
  const { httpEnvelope = false } = options;

  return {
    catch(error: unknown): OneBunResponse {
      if (error instanceof HttpException) {
        const errorResponse = createErrorResponse(
          error.message,
          error.statusCode,
          error.message,
        );

        return new Response(JSON.stringify(errorResponse), {
          status: httpEnvelope ? HttpStatusCode.OK : error.statusCode,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
      }

      if (error instanceof OneBunBaseError) {
        return new Response(JSON.stringify(error.toErrorResponse()), {
          status: httpEnvelope ? HttpStatusCode.OK : error.code,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof Error && 'code' in error
          ? Number((error as { code: unknown }).code)
          : HttpStatusCode.INTERNAL_SERVER_ERROR;

      const errorResponse = createErrorResponse(message, code, message, undefined, {
        originalErrorName: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
      });

      return new Response(JSON.stringify(errorResponse), {
        status: httpEnvelope ? HttpStatusCode.OK : code,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
      });
    },
  };
}

/**
 * Default exception filter instance with proper HTTP status codes.
 * For envelope mode (always HTTP 200), use `createDefaultExceptionFilter({ httpEnvelope: true })`.
 */
export const defaultExceptionFilter: ExceptionFilter = createDefaultExceptionFilter();
