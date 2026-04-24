/**
 * Universal Interceptors
 *
 * Wrap handler execution across HTTP, WebSocket, and Queue transports.
 * Apply with `@UseInterceptors()` on controllers, gateways, or handlers,
 * or globally via `ApplicationOptions.interceptors`.
 *
 * Execution order: middleware → guards → interceptors(handler) → response
 */

import type { IConfig, OneBunAppConfig } from '../module/config.interface';
import type {
  ExecutionContext,
  Interceptor,
  ResolvedInterceptor,
} from '../types';

import type { SyncLogger } from '@onebun/logger';
import { HttpStatusCode } from '@onebun/requests';

import { HttpException } from '../exception-filters/http-exception';
import { isHttpContext, isWsContext } from '../types';

// ============================================================================
// Interceptor Composition
// ============================================================================

/**
 * Compose interceptors into an onion chain around the handler.
 * First interceptor in the list wraps outermost.
 *
 * @param interceptors - Array of resolved interceptor functions
 * @param context - Execution context for this request/message/event
 * @param handler - The inner handler to wrap
 * @returns A function that executes the full interceptor chain
 * @see docs:api/interceptors.md
 */
export function composeInterceptors(
  interceptors: ResolvedInterceptor[],
  context: ExecutionContext,
  handler: () => Promise<unknown>,
): () => Promise<unknown> {
  let current = handler;

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i];
    const next = current;
    current = () => interceptor(context, next);
  }

  return current;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a custom interceptor from a plain function.
 * Returns a class constructor compatible with `@UseInterceptors()`.
 *
 * @param fn - Interceptor function receiving the execution context and next handler
 * @returns Interceptor class constructor
 * @see docs:api/interceptors.md
 *
 * @example
 * ```typescript
 * const TimingInterceptor = createInterceptor(async (ctx, next) => {
 *   const start = Date.now();
 *   const result = await next();
 *   console.log(`Took ${Date.now() - start}ms`);
 *   return result;
 * });
 *
 * @UseInterceptors(TimingInterceptor)
 * @Get('/data')
 * getData() { ... }
 * ```
 */
export function createInterceptor(
  fn: (context: ExecutionContext, next: () => Promise<unknown>) => Promise<unknown>,
): new () => Interceptor {
  return class implements Interceptor {
    async intercept(
      context: ExecutionContext,
      next: () => Promise<unknown>,
    ): Promise<unknown> {
      return await fn(context, next);
    }
  };
}

// ============================================================================
// Base Class (DI support)
// ============================================================================

/**
 * Base class for interceptors that need DI (logger, config, injected services).
 *
 * Extend this class and implement `intercept()`. Constructor-based DI is
 * fully supported — inject any service from the module's DI scope just like
 * you would in a controller or middleware.
 *
 * `this.config` and `this.logger` are available immediately after `super()`
 * when created through the framework DI.
 *
 * Interceptors are instantiated **once** at application startup and reused
 * for every matching request/message.
 *
 * @see docs:api/interceptors.md
 *
 * @example
 * ```typescript
 * class AuditInterceptor extends BaseInterceptor {
 *   constructor(private auditService: AuditService) {
 *     super();
 *   }
 *
 *   async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
 *     const result = await next();
 *     if (isHttpContext(ctx)) {
 *       await this.auditService.log(ctx.getHandler(), (result as Response).status);
 *     }
 *     return result;
 *   }
 * }
 * ```
 */
export abstract class BaseInterceptor implements Interceptor {
  /** Logger instance scoped to the interceptor class name */
  protected logger!: SyncLogger;

  /** Configuration instance for accessing environment variables */
  protected config!: IConfig<OneBunAppConfig>;

  /** Flag to track initialization status */
  private _initialized = false;

  /**
   * Ambient init context set by the framework before interceptor construction.
   * @internal
   */
  private static _initContext: { logger: SyncLogger; config: IConfig<OneBunAppConfig> } | null =
    null;

  /**
   * Set the ambient init context before constructing an interceptor.
   * Called by the framework (OneBunModule) before `new InterceptorClass(...)`.
   * @internal
   */
  static setInitContext(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    BaseInterceptor._initContext = { logger, config };
  }

  /**
   * Clear the ambient init context after interceptor construction.
   * Called by the framework (OneBunModule) after `new InterceptorClass(...)`.
   * @internal
   */
  static clearInitContext(): void {
    BaseInterceptor._initContext = null;
  }

  constructor() {
    if (BaseInterceptor._initContext) {
      const { logger, config } = BaseInterceptor._initContext;
      const className = this.constructor.name;
      this.logger = logger.child({ className });
      this.config = config;
      this._initialized = true;
    }
  }

  /**
   * Initialize interceptor with logger and config.
   * Fallback for interceptors not constructed through the DI system.
   * If already initialized via the constructor init context, this is a no-op.
   * @internal
   */
  initializeInterceptor(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    if (this._initialized) {
      return;
    }

    const className = this.constructor.name;
    this.logger = logger.child({ className });
    this.config = config;
    this._initialized = true;
  }

  abstract intercept(
    context: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown>;
}

// ============================================================================
// Built-in Interceptors
// ============================================================================

/**
 * Get a human-readable label for the execution context (transport-aware).
 * @internal
 */
function getContextLabel(context: ExecutionContext): string {
  if (isHttpContext(context)) {
    const req = context.getRequest();
    const urlObj = new URL(req.url);

    return `${req.method} ${urlObj.pathname}`;
  }

  if (isWsContext(context)) {
    const handler = context.getHandler();

    return `WS ${handler.pattern || handler.handler}`;
  }

  // Queue context
  return `Queue ${context.getPattern()}`;
}

/**
 * Interceptor that logs incoming requests/messages and responses with timing.
 * Works across HTTP, WebSocket, and Queue transports.
 *
 * Logs `Incoming <label>` before and `Completed <label> DURATIONms` after
 * handler execution. On error, logs `Failed <label> DURATIONms` and re-throws.
 *
 * @see docs:api/interceptors.md
 *
 * @example
 * ```typescript
 * // HTTP controller
 * @UseInterceptors(LoggingInterceptor)
 * @Controller('/api/users')
 * class UserController extends BaseController { ... }
 *
 * // WebSocket gateway
 * @UseInterceptors(LoggingInterceptor)
 * @WebSocketGateway({ path: '/ws' })
 * class ChatGateway extends BaseWebSocketGateway { ... }
 * ```
 */
export class LoggingInterceptor extends BaseInterceptor {
  async intercept(
    context: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const label = getContextLabel(context);
    const start = performance.now();

    this.logger.info(`Incoming ${label}`);

    try {
      const result = await next();
      const duration = Math.round(performance.now() - start);

      if (isHttpContext(context) && result instanceof Response) {
        this.logger.info(`Completed ${label} ${result.status} ${duration}ms`);
      } else {
        this.logger.info(`Completed ${label} ${duration}ms`);
      }

      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      this.logger.error(
        `Failed ${label} ${duration}ms`,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }
}

/**
 * Interceptor that aborts handler execution after a specified timeout.
 * Works across HTTP, WebSocket, and Queue transports.
 *
 * For HTTP, throws `HttpException(408)`. For other transports, throws a generic `Error`.
 *
 * Pass as an **instance** since it requires a constructor argument.
 *
 * @see docs:api/interceptors.md
 *
 * @example
 * ```typescript
 * @UseInterceptors(new TimeoutInterceptor(5000))
 * @Get('/slow')
 * slowRoute() { ... }
 * ```
 */
export class TimeoutInterceptor extends BaseInterceptor {
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super();
    this.timeoutMs = timeoutMs;
  }

  async intercept(
    context: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    return await Promise.race([
      next(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          const message = `Request timed out after ${this.timeoutMs}ms`;
          reject(
            isHttpContext(context)
              ? new HttpException(HttpStatusCode.REQUEST_TIMEOUT, message)
              : new Error(message),
          );
        }, this.timeoutMs);
      }),
    ]);
  }
}

export {
  isHttpContext,
  isQueueContext,
  isWsContext,
} from '../types';

export type {
  ExecutionContext,
  HttpExecutionContext,
  Interceptor,
  ResolvedInterceptor,
} from '../types';
