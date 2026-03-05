/**
 * HTTP Guards
 *
 * Guards for authorizing HTTP requests before they reach the route handler.
 * Apply with `@UseGuards()` on controllers or individual routes.
 */

import type { HttpExecutionContext, HttpGuard, OneBunRequest } from '../types';

// ============================================================================
// Execution Context Implementation
// ============================================================================

/**
 * Implementation of HttpExecutionContext
 */
export class HttpExecutionContextImpl implements HttpExecutionContext {
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
 */
export async function executeHttpGuards(
  guards: (Function | HttpGuard)[],
  context: HttpExecutionContext,
): Promise<boolean> {
  for (const guard of guards) {
    let guardInstance: HttpGuard;

    if (typeof guard === 'function') {
      guardInstance = new (guard as new () => HttpGuard)();
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
): new () => HttpGuard {
  return class implements HttpGuard {
    canActivate(context: HttpExecutionContext): boolean | Promise<boolean> {
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
 * @example
 * ```typescript
 * @UseGuards(AuthGuard)
 * @Get('/profile')
 * getProfile() { ... }
 * ```
 */
export class AuthGuard implements HttpGuard {
  canActivate(context: HttpExecutionContext): boolean {
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
export class RolesGuard implements HttpGuard {
  private readonly roles: string[];
  private readonly rolesExtractor: (ctx: HttpExecutionContext) => string[];

  constructor(
    roles: string[],
    rolesExtractor: (ctx: HttpExecutionContext) => string[] = defaultRolesExtractor,
  ) {
    this.roles = roles;
    this.rolesExtractor = rolesExtractor;
  }

  canActivate(context: HttpExecutionContext): boolean {
    const userRoles = this.rolesExtractor(context);

    return this.roles.every((role) => userRoles.includes(role));
  }
}
