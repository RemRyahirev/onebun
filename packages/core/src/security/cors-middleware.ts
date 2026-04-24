import type { OneBunRequest, OneBunResponse } from '../types';

import { BaseMiddleware } from '../module/middleware';

/**
 * CORS (Cross-Origin Resource Sharing) configuration options.
 * Passed via `ApplicationOptions.cors`.
 *
 * @see docs:api/security.md
 */
export interface CorsOptions {
  /**
   * Allowed origin(s).
   * - `'*'` — allow any origin
   * - `string` — exact match
   * - `RegExp` — regex match
   * - `string[]` / `RegExp[]` — list of allowed origins
   * - `(origin: string) => boolean` — custom predicate
   * @defaultValue '*'
   */
  origin?: string | RegExp | Array<string | RegExp> | ((origin: string) => boolean);

  /**
   * Allowed HTTP methods.
   * @defaultValue ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS']
   */
  methods?: string[];

  /**
   * Allowed request headers.
   * @defaultValue ['Content-Type', 'Authorization']
   */
  allowedHeaders?: string[];

  /**
   * Headers to expose to the browser.
   */
  exposedHeaders?: string[];

  /**
   * Allow credentials (cookies, Authorization header).
   * @defaultValue false
   */
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds.
   * @defaultValue 86400 (24 hours)
   */
  maxAge?: number;

  /**
   * Whether to pass the CORS preflight request to the next handler.
   * When `false` (default) preflight requests are handled by the middleware
   * and never reach route handlers.
   * @defaultValue false
   */
  preflightContinue?: boolean;
}

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];
const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization'];
const DEFAULT_MAX_AGE = 86400;
const NO_CONTENT = 204;

/**
 * Resolves whether the given `origin` is allowed by the CORS configuration.
 */
function isOriginAllowed(
  origin: string,
  allowed: NonNullable<CorsOptions['origin']>,
): boolean {
  if (allowed === '*') {
    return true;
  }

  if (typeof allowed === 'string') {
    return origin === allowed;
  }

  if (allowed instanceof RegExp) {
    return allowed.test(origin);
  }

  if (typeof allowed === 'function') {
    return allowed(origin);
  }

  return (allowed as Array<string | RegExp>).some((item) =>
    typeof item === 'string' ? origin === item : item.test(origin),
  );
}

/**
 * Built-in CORS middleware.
 *
 * Handles preflight `OPTIONS` requests and sets appropriate CORS response
 * headers for all other requests. Configure once via `ApplicationOptions.cors`
 * and the framework will instantiate this middleware automatically.
 *
 * @example
 * ```typescript
 * const app = new OneBunApplication(AppModule, {
 *   cors: {
 *     origin: 'https://my-frontend.example.com',
 *     credentials: true,
 *   },
 * });
 * ```
 *
 * When using manually (e.g. from `ApplicationOptions.middleware`):
 * ```typescript
 * const app = new OneBunApplication(AppModule, {
 *   middleware: [CorsMiddleware.configure({ origin: /example\.com$/ })],
 * });
 * ```
 *
 * @see docs:api/security.md
 */
export class CorsMiddleware extends BaseMiddleware {
  private readonly options: Required<
    Pick<CorsOptions, 'methods' | 'allowedHeaders' | 'maxAge' | 'credentials' | 'preflightContinue'>
  > &
    Pick<CorsOptions, 'origin' | 'exposedHeaders'>;

  /**
   * Create a pre-configured CorsMiddleware class with the given options.
   * Returns a constructor — pass the result directly to `ApplicationOptions.middleware`.
   *
   * @example
   * ```typescript
   * const app = new OneBunApplication(AppModule, {
   *   middleware: [CorsMiddleware.configure({ origin: 'https://example.com' })],
   * });
   * ```
   */
  static configure(options: CorsOptions = {}): typeof CorsMiddleware {
    class ConfiguredCorsMiddleware extends CorsMiddleware {
      constructor() {
        super(options);
      }
    }

    return ConfiguredCorsMiddleware;
  }

  constructor(options: CorsOptions = {}) {
    super();

    this.options = {
      origin: options.origin ?? '*',
      methods: options.methods ?? DEFAULT_METHODS,
      allowedHeaders: options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
      exposedHeaders: options.exposedHeaders,
      credentials: options.credentials ?? false,
      maxAge: options.maxAge ?? DEFAULT_MAX_AGE,
      preflightContinue: options.preflightContinue ?? false,
    };
  }

  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    const origin = req.headers.get('origin') ?? '';
    const headers = new Headers();

    // Determine the effective origin for the Access-Control-Allow-Origin header
    const { origin: allowedOrigin } = this.options;
    const allowAll = allowedOrigin === '*' && !this.options.credentials;

    if (allowAll) {
      headers.set('Access-Control-Allow-Origin', '*');
    } else if (origin && isOriginAllowed(origin, allowedOrigin ?? '*')) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.append('Vary', 'Origin');
    } else if (!origin) {
      // Non-browser request (no Origin header) — set wildcard if configured
      if (allowedOrigin === '*') {
        headers.set('Access-Control-Allow-Origin', '*');
      }
    }

    if (this.options.credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }

    if (this.options.exposedHeaders && this.options.exposedHeaders.length > 0) {
      headers.set('Access-Control-Expose-Headers', this.options.exposedHeaders.join(', '));
    }

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', this.options.methods.join(', '));
      headers.set('Access-Control-Allow-Headers', this.options.allowedHeaders.join(', '));
      headers.set('Access-Control-Max-Age', String(this.options.maxAge));

      if (this.options.preflightContinue) {
        const response = await next();
        // Copy CORS headers onto the response from next()
        for (const [key, value] of headers.entries()) {
          response.headers.set(key, value);
        }

        return response;
      }

      return new Response(null, { status: NO_CONTENT, headers });
    }

    // For non-OPTIONS requests — let the handler run, then attach CORS headers
    const response = await next();
    for (const [key, value] of headers.entries()) {
      response.headers.set(key, value);
    }

    return response;
  }
}
