import type { OneBunRequest, OneBunResponse } from '../types';

import { BaseMiddleware } from '../module/middleware';

/**
 * Configuration for each security header directive.
 * Set to `false` to disable a specific header entirely.
 */
export interface SecurityHeadersOptions {
  /**
   * `Content-Security-Policy`
   * @defaultValue "default-src 'self'"
   * Set to `false` to disable.
   */
  contentSecurityPolicy?: string | false;

  /**
   * `Cross-Origin-Opener-Policy`
   * @defaultValue 'same-origin'
   * Set to `false` to disable.
   */
  crossOriginOpenerPolicy?: string | false;

  /**
   * `Cross-Origin-Resource-Policy`
   * @defaultValue 'same-origin'
   * Set to `false` to disable.
   */
  crossOriginResourcePolicy?: string | false;

  /**
   * `Origin-Agent-Cluster`
   * @defaultValue '?1'
   * Set to `false` to disable.
   */
  originAgentCluster?: string | false;

  /**
   * `Referrer-Policy`
   * @defaultValue 'no-referrer'
   * Set to `false` to disable.
   */
  referrerPolicy?: string | false;

  /**
   * `Strict-Transport-Security` (HSTS)
   * @defaultValue 'max-age=15552000; includeSubDomains'
   * Set to `false` to disable.
   */
  strictTransportSecurity?: string | false;

  /**
   * `X-Content-Type-Options`
   * @defaultValue 'nosniff'
   * Set to `false` to disable.
   */
  xContentTypeOptions?: string | false;

  /**
   * `X-DNS-Prefetch-Control`
   * @defaultValue 'off'
   * Set to `false` to disable.
   */
  xDnsPrefetchControl?: string | false;

  /**
   * `X-Download-Options`
   * @defaultValue 'noopen'
   * Set to `false` to disable.
   */
  xDownloadOptions?: string | false;

  /**
   * `X-Frame-Options`
   * @defaultValue 'SAMEORIGIN'
   * Set to `false` to disable.
   */
  xFrameOptions?: string | false;

  /**
   * `X-Permitted-Cross-Domain-Policies`
   * @defaultValue 'none'
   * Set to `false` to disable.
   */
  xPermittedCrossDomainPolicies?: string | false;

  /**
   * `X-XSS-Protection`
   * @defaultValue '0' (disabled by recommendation, modern browsers use CSP instead)
   * Set to `false` to omit the header entirely.
   */
  xXssProtection?: string | false;
}

const DEFAULTS: Required<SecurityHeadersOptions> = {
  contentSecurityPolicy: "default-src 'self'",
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  originAgentCluster: '?1',
  referrerPolicy: 'no-referrer',
  strictTransportSecurity: 'max-age=15552000; includeSubDomains',
  xContentTypeOptions: 'nosniff',
  xDnsPrefetchControl: 'off',
  xDownloadOptions: 'noopen',
  xFrameOptions: 'SAMEORIGIN',
  xPermittedCrossDomainPolicies: 'none',
  xXssProtection: '0',
};

/**
 * Maps camelCase option keys to the actual HTTP header names.
 */
const HEADER_MAP: Record<keyof SecurityHeadersOptions, string> = {
  contentSecurityPolicy: 'Content-Security-Policy',
  crossOriginOpenerPolicy: 'Cross-Origin-Opener-Policy',
  crossOriginResourcePolicy: 'Cross-Origin-Resource-Policy',
  originAgentCluster: 'Origin-Agent-Cluster',
  referrerPolicy: 'Referrer-Policy',
  strictTransportSecurity: 'Strict-Transport-Security',
  xContentTypeOptions: 'X-Content-Type-Options',
  xDnsPrefetchControl: 'X-DNS-Prefetch-Control',
  xDownloadOptions: 'X-Download-Options',
  xFrameOptions: 'X-Frame-Options',
  xPermittedCrossDomainPolicies: 'X-Permitted-Cross-Domain-Policies',
  xXssProtection: 'X-XSS-Protection',
};

/**
 * Built-in security headers middleware — analogous to [helmet](https://helmetjs.github.io/).
 *
 * Sets a sensible default set of security-related HTTP response headers on every
 * response. Individual headers can be overridden or disabled via the options object.
 *
 * @example Default usage (all headers with recommended defaults)
 * ```typescript
 * const app = new OneBunApplication(AppModule, {
 *   middleware: [SecurityHeadersMiddleware],
 * });
 * ```
 *
 * @example Custom CSP + disable HSTS (e.g. in development)
 * ```typescript
 * const app = new OneBunApplication(AppModule, {
 *   middleware: [
 *     SecurityHeadersMiddleware.configure({
 *       contentSecurityPolicy: "default-src 'self'; img-src *",
 *       strictTransportSecurity: false,
 *     }),
 *   ],
 * });
 * ```
 */
export class SecurityHeadersMiddleware extends BaseMiddleware {
  private readonly resolvedHeaders: Array<[string, string]>;

  /**
   * Create a pre-configured SecurityHeadersMiddleware class with the given options.
   * Returns a constructor — pass the result directly to `ApplicationOptions.middleware`.
   */
  static configure(options: SecurityHeadersOptions): typeof SecurityHeadersMiddleware {
    class ConfiguredSecurityHeadersMiddleware extends SecurityHeadersMiddleware {
      constructor() {
        super(options);
      }
    }

    return ConfiguredSecurityHeadersMiddleware;
  }

  constructor(options: SecurityHeadersOptions = {}) {
    super();

    const merged: SecurityHeadersOptions = { ...DEFAULTS, ...options };
    this.resolvedHeaders = (Object.keys(HEADER_MAP) as Array<keyof SecurityHeadersOptions>)
      .filter((key) => merged[key] !== false && merged[key] !== undefined)
      .map((key) => [HEADER_MAP[key], merged[key] as string]);
  }

  async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    const response = await next();

    for (const [header, value] of this.resolvedHeaders) {
      response.headers.set(header, value);
    }

    return response;
  }
}
