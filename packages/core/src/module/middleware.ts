import type { IConfig, OneBunAppConfig } from './config.interface';
import type { OneBunRequest, OneBunResponse } from '../types';

import type { SyncLogger } from '@onebun/logger';

/**
 * Base class for all OneBun middleware.
 *
 * Extend this class to create middleware with access to the framework's
 * logger (scoped to the middleware class name) and configuration.
 * Constructor-based DI is fully supported — inject any service from
 * the module's DI scope just like you would in a controller.
 *
 * Middleware is instantiated **once** at application startup and reused
 * for every matching request.
 *
 * @example Simple middleware (no DI)
 * ```typescript
 * class LoggingMiddleware extends BaseMiddleware {
 *   async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
 *     this.logger.info(`${req.method} ${new URL(req.url).pathname}`);
 *     return next();
 *   }
 * }
 * ```
 *
 * @example Middleware with DI
 * ```typescript
 * class AuthMiddleware extends BaseMiddleware {
 *   constructor(private authService: AuthService) {
 *     super();
 *   }
 *
 *   async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
 *     const secret = this.config.get('auth.jwtSecret');
 *     const token = req.headers.get('Authorization');
 *     if (!this.authService.verify(token, secret)) {
 *       this.logger.warn('Authentication failed');
 *       return new Response('Unauthorized', { status: 401 });
 *     }
 *     return next();
 *   }
 * }
 * ```
 */
export abstract class BaseMiddleware {
  /** Logger instance scoped to the middleware class name */
  protected logger!: SyncLogger;

  /** Configuration instance for accessing environment variables */
  protected config!: IConfig<OneBunAppConfig>;

  /**
   * Initialize middleware with logger and config.
   * Called by the framework after DI construction — do NOT call manually.
   * @internal
   */
  initializeMiddleware(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    const className = this.constructor.name;
    this.logger = logger.child({ className });
    this.config = config;
    this.logger.debug(`Middleware ${className} initialized`);
  }

  /**
   * The middleware handler.
   *
   * @param req - The incoming request (OneBunRequest with `.cookies`, `.params`, etc.)
   * @param next - Call to invoke the next middleware or the route handler
   * @returns A response — either from `next()` or a short-circuit response
   */
  abstract use(
    req: OneBunRequest,
    next: () => Promise<OneBunResponse>,
  ): Promise<OneBunResponse> | OneBunResponse;
}
