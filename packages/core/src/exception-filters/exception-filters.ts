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
 * @see docs:api/exception-filters.md
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
 * @see docs:api/exception-filters.md
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
 * @see docs:api/exception-filters.md
 */
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

/**
 * Coerces an error's `code` to a status `new Response` will accept.
 *
 * Returns 500 for anything that is not an integer inside the HTTP range — a string
 * `code` such as `ECONNREFUSED`, a zero, an errno. Without this the filter throws
 * RangeError while building the response, which loses the error it was handling.
 */
function toHttpStatus(code: unknown): number {
  const numeric = Number(code);

  return Number.isInteger(numeric) && numeric >= MIN_HTTP_STATUS && numeric <= MAX_HTTP_STATUS
    ? numeric
    : HttpStatusCode.INTERNAL_SERVER_ERROR;
}

/**
 * What the default filter answers for an error it did not recognise.
 *
 * A fixed string rather than `error.message`: the message of an unhandled error is written by
 * whatever threw it — a driver, a socket, the file system — and routinely names absolute
 * paths, internal hosts and ports, or the credentials inside a connection string. The real
 * message goes to the log, and comes back in the response only under `exposeErrorDetails`.
 *
 * @see docs:api/exception-filters.md
 */
export const UNHANDLED_ERROR_MESSAGE = 'Internal Server Error';

/**
 * Build the framework's fallback exception filter.
 *
 * @param options.httpEnvelope - Always answer HTTP 200 and carry the real code in the body.
 * @param options.exposeErrorDetails - Disclose an unhandled error to the caller: its real
 *   `message` in place of {@link UNHANDLED_ERROR_MESSAGE}, plus `details` — the error's class
 *   name, its non-HTTP `code`, and its **stack trace**. Off by default, and deliberately not
 *   tied to `NODE_ENV`: a deployment with an unset or mistyped `NODE_ENV` would then disclose
 *   all of it publicly, which is the failure mode this guards against. Turn it on knowingly,
 *   in a development configuration you can read. One knob, not two — a message that names an
 *   internal host is not meaningfully safer than the stack that names the file.
 *
 * @see docs:api/exception-filters.md
 */
export function createDefaultExceptionFilter(
  options: { httpEnvelope?: boolean; exposeErrorDetails?: boolean } = {},
): ExceptionFilter {
  const { httpEnvelope = false, exposeErrorDetails = false } = options;

  return {
    catch(error: unknown): OneBunResponse {
      if (error instanceof HttpException) {
        const errorResponse = createErrorResponse(
          error.message,
          error.statusCode,
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
          status: httpEnvelope ? HttpStatusCode.OK : toHttpStatus(error.code),
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          },
        });
      }

      // NOT `error.message`. A runtime message routinely carries exactly what an unhandled
      // error must not disclose to an unauthenticated caller, and none of it is chosen by the
      // author: `ENOENT: no such file or directory, open '/srv/app/config/private.pem'` names
      // an absolute path, `connect ECONNREFUSED 10.0.3.17:5432` an internal host and port,
      // `getaddrinfo ENOTFOUND internal-billing.svc.cluster.local` the service topology, and a
      // connection string echoed back by a URL parser carries the password. Driver errors
      // quote the failing statement and sometimes its bound parameters.
      //
      // The two branches above keep their messages, because `HttpException` and
      // `OneBunBaseError` are author-written and client-facing. This branch is the one where
      // the text came from a library or the kernel, and there is no way to tell a safe one
      // from a leaking one — which is why it is withheld wholesale rather than filtered. A
      // denylist of shapes would always miss the shape it had not met.
      //
      // Nothing is lost to the operator: the application logs the whole error, stack included,
      // before this filter runs. `exposeErrorDetails` returns the real message here alongside
      // the stack.
      const message = exposeErrorDetails
        ? (error instanceof Error ? error.message : String(error))
        : UNHANDLED_ERROR_MESSAGE;
      const originalCode = error instanceof Error && 'code' in error
        ? (error as { code: unknown }).code
        : undefined;
      // A thrown Error may carry a non-HTTP `code` — a socket failure carries the string
      // 'ECONNREFUSED', and `Number()` of that is NaN. Passing NaN (or 0, or 600) to
      // `new Response` throws RangeError from inside the filter, so the filter itself
      // failed and the error escaped as a bare 500. Anything outside the HTTP range is a
      // 500 instead, with the original preserved in `details.originalCode`.
      const code = toHttpStatus(originalCode);

      // `details` is withheld unless explicitly asked for. It used to be unconditional, so
      // every unhandled error answered the caller with `error.stack` — absolute filesystem
      // paths, dependency versions and internal module layout, on the DEFAULT path taken by
      // every unhandled throw rather than by some unusual one. Nothing is lost by withholding
      // it: the application logs the whole error, stack included, before this filter runs.
      const errorResponse = exposeErrorDetails
        ? createErrorResponse(message, code, undefined, {
          originalErrorName: error instanceof Error ? error.name : 'UnknownError',
          originalCode,
          stack: error instanceof Error ? error.stack : undefined,
        })
        : createErrorResponse(message, code);

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
 *
 * @see docs:api/exception-filters.md
 */
export const defaultExceptionFilter: ExceptionFilter = createDefaultExceptionFilter();
