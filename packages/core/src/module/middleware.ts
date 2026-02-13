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
 * Middleware extending this class have `this.config` and `this.logger` available
 * immediately after `super()` in the constructor when created through the framework DI.
 * The framework sets an ambient init context before calling the constructor, and
 * BaseMiddleware reads from it in its constructor.
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
 * @example Middleware with DI and constructor access
 * ```typescript
 * class AuthMiddleware extends BaseMiddleware {
 *   private readonly jwtSecret: string;
 *
 *   constructor(private authService: AuthService) {
 *     super();
 *     // this.config and this.logger are available here!
 *     this.jwtSecret = this.config.get('auth.jwtSecret');
 *   }
 *
 *   async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
 *     const token = req.headers.get('Authorization');
 *     if (!this.authService.verify(token, this.jwtSecret)) {
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

  /** Flag to track initialization status */
  private _initialized = false;

  /**
   * Ambient init context set by the framework before middleware construction.
   * This allows the BaseMiddleware constructor to pick up logger and config
   * so they are available immediately after super() in subclass constructors.
   * @internal
   */
  private static _initContext: { logger: SyncLogger; config: IConfig<OneBunAppConfig> } | null =
    null;

  /**
   * Set the ambient init context before constructing a middleware.
   * Called by the framework (OneBunModule) before `new MiddlewareClass(...)`.
   * @internal
   */
  static setInitContext(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    BaseMiddleware._initContext = { logger, config };
  }

  /**
   * Clear the ambient init context after middleware construction.
   * Called by the framework (OneBunModule) after `new MiddlewareClass(...)`.
   * @internal
   */
  static clearInitContext(): void {
    BaseMiddleware._initContext = null;
  }

  constructor() {
    // Pick up logger and config from ambient init context if available.
    // This makes this.config and this.logger available immediately after super()
    // in subclass constructors.
    if (BaseMiddleware._initContext) {
      const { logger, config } = BaseMiddleware._initContext;
      const className = this.constructor.name;
      this.logger = logger.child({ className });
      this.config = config;
      this._initialized = true;
    }
  }

  /**
   * Initialize middleware with logger and config.
   * This is a fallback for middleware not constructed through the DI system
   * (e.g., in tests or when created manually). If the middleware was already
   * initialized via the constructor init context, this is a no-op.
   * Called by the framework after DI construction — do NOT call manually.
   * @internal
   */
  initializeMiddleware(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    if (this._initialized) {
      return; // Already initialized (via constructor or previous call)
    }

    const className = this.constructor.name;
    this.logger = logger.child({ className });
    this.config = config;
    this._initialized = true;
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
