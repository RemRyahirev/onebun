/**
 * HTTP Guards
 *
 * Guards for authorizing HTTP requests before they reach the route handler.
 * Apply with `@UseGuards()` on controllers or individual routes.
 */

import type {
  ExecutionContext,
  HttpExecutionContext,
  OneBunRequest,
} from '../types';

import { isHttpContext } from '../types';

// ============================================================================
// Universal Guard Contract
// ============================================================================

/**
 * Universal Guard interface — ONE guard contract across HTTP, WebSocket and queue handlers.
 *
 * `@UseGuards()` accepts anything shaped like this on all three transports, mirroring
 * `@UseInterceptors()`, which has always shared one metadata key across them. The context is
 * the discriminated union `ExecutionContext`: narrow it with `isHttpContext()`,
 * `isWsContext()` or `isQueueContext()` before touching transport-specific accessors.
 *
 * A guard that reaches a transport it was not written for MUST return `false` rather than
 * fall through to `undefined` — that is what the narrowing is for. On WebSocket and queue a
 * guard that throws is treated as a denial and logged; on HTTP a throw still travels to the
 * route's exception filters, so `throw new HttpException(401, ...)` keeps its meaning.
 *
 * `HttpGuard`, `WsGuard` and `MessageGuard` all satisfy this interface — method parameters
 * are checked bivariantly — so existing single-transport guards keep compiling unchanged.
 *
 * @see docs:api/guards.md
 *
 * @example
 * ```typescript
 * class TenantGuard implements Guard {
 *   canActivate(ctx: ExecutionContext): boolean {
 *     if (isHttpContext(ctx)) return ctx.getRequest().headers.get('x-tenant') === 'acme';
 *     if (isQueueContext(ctx)) return ctx.getMetadata().headers?.['x-tenant'] === 'acme';
 *     if (isWsContext(ctx)) return ctx.getClient().metadata.tenant === 'acme';
 *     return false;
 *   }
 * }
 * ```
 */
export interface Guard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

// ============================================================================
// Execution Context Implementation
// ============================================================================

/**
 * Implementation of HttpExecutionContext
 *
 * @see docs:api/guards.md
 */
export class HttpExecutionContextImpl implements HttpExecutionContext {
  readonly type = 'http' as const;

  constructor(
    private readonly request: OneBunRequest,
    private readonly handlerName: string,
    private readonly controllerName: string,
  ) {}

  getRequest(): OneBunRequest {
    return this.request;
  }

  getHandler(): string {
    return this.handlerName;
  }

  getController(): string {
    return this.controllerName;
  }
}

// ============================================================================
// Guard Execution Helper
// ============================================================================

/**
 * Execute a list of HTTP guards sequentially.
 * Returns false as soon as any guard denies access (short-circuit).
 *
 * @param guards - Array of guard class constructors or instances
 * @param context - Execution context for this request
 * @returns Whether all guards passed
 * @see docs:api/guards.md
 */
export async function executeHttpGuards(
  guards: (Function | Guard)[],
  context: HttpExecutionContext,
): Promise<boolean> {
  for (const guard of guards) {
    let guardInstance: Guard;

    if (typeof guard === 'function') {
      guardInstance = new (guard as new () => Guard)();
    } else {
      guardInstance = guard;
    }

    const result = await guardInstance.canActivate(context);
    if (!result) {
      return false;
    }
  }

  return true;
}

/**
 * Create a custom HTTP guard from a plain function.
 * Returns a class constructor compatible with `@UseGuards()`.
 *
 * @param fn - Guard function receiving the execution context
 * @returns Guard class constructor
 *
 * @see docs:api/guards.md
 *
 * @example
 * ```typescript
 * const ApiKeyGuard = createHttpGuard((ctx) => {
 *   return ctx.getRequest().headers.get('x-api-key') === process.env.API_KEY;
 * });
 *
 * @UseGuards(ApiKeyGuard)
 * @Get('/protected')
 * getData() { ... }
 * ```
 */
export function createHttpGuard(
  fn: (context: HttpExecutionContext) => boolean | Promise<boolean>,
): new () => Guard {
  return class implements Guard {
    canActivate(context: ExecutionContext): boolean | Promise<boolean> {
      // `@UseGuards` reaches queue and WebSocket handlers too. The function was written
      // against a request, so anywhere else it denies instead of reading `getRequest` off a
      // context that has none and throwing a TypeError per message.
      if (!isHttpContext(context)) {
        return false;
      }

      return fn(context);
    }
  };
}

// ============================================================================
// Built-in Guards
// ============================================================================

/**
 * Guard that requires a valid Bearer token in the Authorization header.
 * Does NOT validate the token — only checks that the header is present.
 * Combine with a custom middleware or guard to validate the token itself.
 *
 * @see docs:api/guards.md
 *
 * @example
 * ```typescript
 * @UseGuards(AuthGuard)
 * @Get('/profile')
 * getProfile() { ... }
 * ```
 */
export class AuthGuard implements Guard {
  canActivate(context: ExecutionContext): boolean {
    // HTTP-only: on a queue or WebSocket handler there is no request to read a header from,
    // so this denies rather than passing or throwing. Use `MessageAuthGuard` / `WsAuthGuard`
    // there — see docs:api/guards.md, "One decorator, three transports".
    if (!isHttpContext(context)) {
      return false;
    }

    const auth = context.getRequest().headers.get('authorization');

    return auth !== null && auth.startsWith('Bearer ');
  }
}

/**
 * Default roles extractor — reads comma-separated roles from the `x-user-roles` header.
 * Set this header from your auth middleware after validating the token.
 */
function defaultRolesExtractor(ctx: HttpExecutionContext): string[] {
  const rolesHeader = ctx.getRequest().headers.get('x-user-roles');

  return rolesHeader ? rolesHeader.split(',').map((r) => r.trim()) : [];
}

/**
 * Guard that requires all specified roles to be present on the request.
 * By default reads roles from the `x-user-roles` header (comma-separated).
 * Provide a custom `rolesExtractor` to read roles from a different source
 * (e.g. a JWT claim decoded by a preceding auth middleware).
 *
 * @see docs:api/guards.md
 *
 * @example
 * ```typescript
 * // All specified roles must be present
 * @UseGuards(new RolesGuard(['admin', 'moderator']))
 * @Delete('/users/:id')
 * deleteUser() { ... }
 *
 * // Custom roles extractor
 * @UseGuards(new RolesGuard(['admin'], (ctx) => ctx.getRequest().headers.get('x-roles')?.split('|') ?? []))
 * @Get('/admin')
 * adminPanel() { ... }
 * ```
 */
export class RolesGuard implements Guard {
  private readonly roles: string[];
  private readonly rolesExtractor: (ctx: HttpExecutionContext) => string[];

  constructor(
    roles: string[],
    rolesExtractor: (ctx: HttpExecutionContext) => string[] = defaultRolesExtractor,
  ) {
    this.roles = roles;
    this.rolesExtractor = rolesExtractor;
  }

  canActivate(context: ExecutionContext): boolean {
    // HTTP-only, same rule as AuthGuard: the extractor takes a request.
    if (!isHttpContext(context)) {
      return false;
    }

    const userRoles = this.rolesExtractor(context);

    return this.roles.every((role) => userRoles.includes(role));
  }
}
