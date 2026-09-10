/**
 * Middleware chain execution.
 *
 * One implementation, two callers: the per-route chain and the `Bun.serve` fallback that answers
 * static files and unmatched paths. They used to be one implementation and one bare `new
 * Response(...)` — so `security: true` put its headers on controller routes and not on the SPA
 * those routes serve, and `rateLimit` bounded only the paths that happened to match a controller.
 */

import type { ProfileMark, Profiler } from '../profiler';
import type { OneBunRequest, OneBunResponse } from '../types';

/** A resolved middleware: the bound `use()` of an instantiated `BaseMiddleware`. */
type ChainMiddleware = (
  req: OneBunRequest,
  next: () => Promise<OneBunResponse>,
) => Promise<OneBunResponse> | OneBunResponse;

/**
 * The name a profiler mark carries for this middleware.
 *
 * `_middlewareName` is stamped on the bound function by `resolveMiddleware`, because binding
 * loses the class name that makes a profile readable.
 */
function middlewareName(middleware: Function, index: number): string {
  return (middleware as { _middlewareName?: string })._middlewareName
    || middleware.name
    || `middleware[${index}]`;
}

/**
 * Run `middleware` in order, then `terminal`, unwinding back out through each one.
 *
 * Middleware post-processes what `next()` returns — `CorsMiddleware`, `SecurityHeadersMiddleware`
 * and `RateLimitMiddleware` all set headers on the way back — so the terminal producing the
 * response has to sit INSIDE the chain rather than after it.
 */
export async function runMiddlewareChain(
  middleware: readonly Function[],
  req: OneBunRequest,
  terminal: () => Promise<OneBunResponse>,
  profiler?: Profiler | null,
): Promise<OneBunResponse> {
  if (middleware.length === 0) {
    return await terminal();
  }

  const next = async (index: number): Promise<OneBunResponse> => {
    if (index >= middleware.length) {
      return await terminal();
    }

    const current = middleware[index] as ChainMiddleware;

    if (profiler) {
      const mark: ProfileMark = profiler.start('middleware', middlewareName(middleware[index], index));
      const result = await current(req, async () => await next(index + 1));
      profiler.end(mark);

      return result;
    }

    return await current(req, async () => await next(index + 1));
  };

  return await next(0);
}
