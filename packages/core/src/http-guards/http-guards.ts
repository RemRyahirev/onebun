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
 * `@UseGuards()` accepts anything shaped like this on all three transports, class-level and
 * method-level; each level has one metadata key that all three transports read. The context is the discriminated union
 * `ExecutionContext`: narrow it with `isHttpContext()`, `isWsContext()` or `isQueueContext()`
 * before touching transport-specific accessors.
 *
 * A guard that reaches a transport it was not written for MUST return `false` rather than
 * fall through to `undefined` — that is what the narrowing is for. On WebSocket and queue a
 * guard that throws is treated as a denial and logged; on HTTP a throw travels to the route's
 * exception filters, so `throw new HttpException(401, ...)` answers with that exception.
 *
 * `HttpGuard`, `WsGuard` and `MessageGuard` all satisfy this interface — method parameters
 * are checked bivariantly — so a single-transport guard compiles wherever a `Guard` is expected.
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
 * Guard that admits a request whose `Authorization` header starts with `Bearer `.
 *
 * It checks presence only: the token after the scheme is never decoded, verified or checked for
 * expiry, so `Authorization: Bearer anything` passes. It is a starter example, not authentication —
 * production code verifies the token in a guard of its own that injects the verifying service; see
 * docs:api/guards.md, "Production Authentication".
 *
 * @see docs:api/guards.md
 *
 * @example
 * ```typescript
 * @UseGuards(BearerPresenceGuard)
 * @Get('/profile')
 * getProfile() { ... }
 * ```
 */
export class BearerPresenceGuard implements Guard {
  canActivate(context: ExecutionContext): boolean {
    // HTTP-only: on a queue or WebSocket handler there is no request to read a header from,
    // so this denies rather than passing or throwing. Use `MessageAuthorizationPresenceGuard` /
    // `WsAuthGuard` there — see docs:api/guards.md, "One decorator, three transports".
    if (!isHttpContext(context)) {
      return false;
    }

    const auth = context.getRequest().headers.get('authorization');

    return auth !== null && auth.startsWith('Bearer ');
  }
}

/**
 * Guard that requires every listed role to be among the roles `rolesExtractor` returns for the
 * current request (AND, not OR).
 *
 * It compares and does nothing else: where the roles come from is the extractor's decision, and
 * both constructor arguments are required. The extractor has to read a VERIFIED identity — the
 * one a verifying guard ahead of this one recorded on the request context — and never a request
 * header, which the caller writes. See docs:api/guards.md, "Production Authentication".
 *
 * The constructor throws a `TypeError` when `rolesExtractor` is not a function, so a call that
 * gets past the type checker fails with a message naming the fix. Pass the guard as an instance:
 * `@UseGuards(RolesGuard)` makes the framework construct it with no arguments on every request,
 * and each one answers 500 without reaching the handler.
 *
 * @see docs:api/guards.md
 *
 * @example
 * ```typescript
 * // VerifiedTokenGuard verified the token and ran updateRequestContext({ user })
 * const rolesOfVerifiedUser = () => getRequestContext()?.user?.roles ?? [];
 *
 * @UseGuards(VerifiedTokenGuard, new RolesGuard(['admin', 'moderator'], rolesOfVerifiedUser))
 * @Delete('/users/:id')
 * deleteUser() { ... }
 * ```
 */
export class RolesGuard implements Guard {
  private readonly roles: string[];
  private readonly rolesExtractor: (ctx: HttpExecutionContext) => string[];

  constructor(
    roles: string[],
    rolesExtractor: (ctx: HttpExecutionContext) => string[],
  ) {
    // The type already requires the extractor. This catches what slips past it — an `any`, a
    // JavaScript caller, or the class handed to `@UseGuards(RolesGuard)`, which the framework
    // constructs with no arguments — with a message that names the fix rather than a TypeError
    // about calling `undefined` from inside `canActivate`.
    if (typeof rolesExtractor !== 'function') {
      throw new TypeError(
        'RolesGuard requires a rolesExtractor as its second argument: a function returning the roles '
        + 'of the verified caller, e.g. `() => getRequestContext()?.user?.roles ?? []`. Pass an INSTANCE, '
        + 'not the class: `@UseGuards(new RolesGuard([\'admin\'], rolesExtractor))`. '
        + `Received: ${String(rolesExtractor)}`,
      );
    }

    this.roles = roles;
    this.rolesExtractor = rolesExtractor;
  }

  canActivate(context: ExecutionContext): boolean {
    // HTTP-only, same rule as BearerPresenceGuard: the extractor takes a request.
    if (!isHttpContext(context)) {
      return false;
    }

    const userRoles = this.rolesExtractor(context);

    return this.roles.every((role) => userRoles.includes(role));
  }
}
