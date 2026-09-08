/**
 * Cache Interceptor
 *
 * Universal interceptor that caches GET responses using CacheService.
 * Only caches successful (2xx) HTTP GET responses. Non-HTTP transports pass through.
 *
 * @example
 * ```typescript
 * import { CacheInterceptor } from '@onebun/cache';
 *
 * @UseInterceptors(CacheInterceptor)
 * @Controller('/api/data')
 * class DataController extends BaseController { ... }
 * ```
 */

import type { ExecutionContext } from '@onebun/core';
import {
  BaseInterceptor,
  isHttpContext,
  Service,
} from '@onebun/core';

import { CacheService } from './cache.service';

const CACHE_KEY_PREFIX = 'interceptor:';
const MIN_SUCCESS_STATUS = 200;
const MAX_SUCCESS_STATUS = 300;

interface CachedResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * Interceptor that caches HTTP GET responses.
 *
 * Requires `CacheModule` to be imported in the module tree so that
 * `CacheService` is available for DI injection.
 *
 * Only caches responses with 2xx status codes. Non-GET requests
 * and non-HTTP transports pass through without caching.
 *
 * @see docs:api/cache.md
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [CacheModule],
 *   controllers: [DataController],
 * })
 * class DataModule {}
 *
 * @UseInterceptors(CacheInterceptor)
 * @Controller('/api/data')
 * class DataController extends BaseController {
 *   @Get('/')
 *   getData() { return { items: [...] }; }
 * }
 * ```
 */
// `@Service()` is load-bearing, not decoration. TypeScript emits `design:paramtypes` only for a
// DECORATED class, and `resolveInterceptors()` reads exactly that metadata to find constructor
// dependencies. Without it the interceptor was built with an empty argument list, `cacheService`
// landed `undefined`, and every GET this wrapped answered HTTP 500 — while the class was
// exported, documented and presented as ready to use.
//
// The same trap applies to any shipped guard, filter or middleware that declares constructor
// dependencies: undecorated means uninjected, and the failure is at request time rather than at
// startup.
@Service()
export class CacheInterceptor extends BaseInterceptor {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  async intercept(
    context: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    // Only cache HTTP GET requests
    if (!isHttpContext(context)) {
      return await next();
    }

    const req = context.getRequest();

    if (req.method !== 'GET') {
      return await next();
    }

    const cacheKey = this.buildCacheKey(context);
    const cached = await this.cacheService.get<CachedResponse>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);

      return new Response(cached.body, {
        status: cached.status,
        headers: cached.headers,
      });
    }

    const response = await next();

    // Cache successful responses
    if (response instanceof Response && response.status >= MIN_SUCCESS_STATUS && response.status < MAX_SUCCESS_STATUS) {
      const body = await response.clone().text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      await this.cacheService.set<CachedResponse>(cacheKey, {
        status: response.status,
        body,
        headers,
      });
    }

    return response;
  }

  private buildCacheKey(context: ExecutionContext): string {
    if (!isHttpContext(context)) {
      return '';
    }

    const req = context.getRequest();
    const urlObj = new URL(req.url);

    return `${CACHE_KEY_PREFIX}${req.method}:${urlObj.pathname}${urlObj.search}`;
  }
}
