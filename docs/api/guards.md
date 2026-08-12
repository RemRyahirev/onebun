---
description: HTTP Guards — authorization and access control for routes and controllers.
---

<llm-only>

## Quick Reference for AI

**Guard interface:**
```typescript
import { HttpGuard, HttpExecutionContext, createHttpGuard, UseGuards } from '@onebun/core';
```

**Three ways to create a guard:**
1. `createHttpGuard(fn)` — inline function-based guard (simplest)
2. Implement `HttpGuard` interface (class-based, for DI)
3. Use built-in `AuthGuard`, `RolesGuard`

**Applying guards:**
- `@UseGuards(MyGuard)` on a controller class — applies to all routes
- `@UseGuards(MyGuard)` on a route method — applies to that route only
- Both can be combined; controller guards run first, then route guards
- Decorator source order does NOT matter: `@UseGuards` above or below `@Get`/`@Delete` behaves identically. Before 0.4.5 a route-level `@UseGuards` written ABOVE the method decorator was silently discarded and the route was reachable — audit any route guarded that way if you are upgrading from 0.4.4 or earlier. The same applied to `@UseInterceptors` and `@UseFilters`
- Class-based guards get full dependency injection — constructor dependencies, `this.config` and `this.logger` all work inside `canActivate`. Dependencies are resolved once when routes are built; the guard INSTANCE is still created per request, so stashing request state on `this` remains safe. Passing an instance — `@UseGuards(new RolesGuard(['admin']))` — shares that one instance across requests, as it always did. Function-based guards from `createHttpGuard(fn)` have no DI by design
- A guard whose constructor dependency cannot be resolved now fails the application at STARTUP instead of being constructed with `undefined`. Register the DEPENDENCY in the module's `providers` — registering the guard itself does not help
- A class-level `@UseGuards` is INHERITED by a subclass controller, base first then the subclass's own. `@UseMiddleware`, `@UseInterceptors` and `@UseFilters` inherit the same way; routes do not

**Order of execution:** global middleware → controller middleware → route middleware → guards → handler

**If a guard returns `false`:** responds with `{ success: false, error: 'Forbidden', code: 403 }` (HTTP 403, or HTTP 200 when `httpEnvelope` mode is enabled). **If a guard throws or rejects:** the error goes through the route's exception filters, so `throw new HttpException(401, 'Token expired')` produces that status and message instead of the fixed Forbidden envelope.

**HttpExecutionContext:**
```typescript
context.getRequest()    // OneBunRequest — full request object
context.getHandler()    // string — method name on the controller
context.getController() // string — controller class name
```

**Built-in guards:**
- `AuthGuard` — checks `Authorization: Bearer <token>` header presence
- `RolesGuard` — checks comma-separated roles in `x-user-roles` header; configure with `new RolesGuard(['admin', 'user'])`

</llm-only>

# HTTP Guards

Guards provide a way to implement authorization and access control for HTTP routes. They run **after** middleware but **before** the route handler.

## Interface

```typescript
import type { HttpGuard, HttpExecutionContext } from '@onebun/core';

interface HttpGuard {
  canActivate(context: HttpExecutionContext): boolean | Promise<boolean>;
}

interface HttpExecutionContext {
  getRequest(): OneBunRequest;  // incoming request
  getHandler(): string;          // name of the controller method being invoked
  getController(): string;       // name of the controller class
}
```

## Creating Guards

### Function-based guard

The simplest way — use the `createHttpGuard` factory:

```typescript
import { createHttpGuard } from '@onebun/core';

const apiKeyGuard = createHttpGuard((ctx) => {
  return ctx.getRequest().headers.get('x-api-key') === process.env.API_KEY;
});
```

### Class-based guard

Implement the `HttpGuard` interface directly. Class-based guards benefit from DI — inject services through the constructor:

```typescript
import type { HttpGuard, HttpExecutionContext } from '@onebun/core';
import { Service, BaseService } from '@onebun/core';

@Service()
class ApiKeyGuard extends BaseService implements HttpGuard {
  // BaseService provides this.config automatically — no need to inject ConfigService
  canActivate(ctx: HttpExecutionContext): boolean {
    const key = ctx.getRequest().headers.get('x-api-key');
    return key === this.config.get('auth.apiKey');
  }
}
```

Constructor dependencies are injected the same way a service's are, and `this.config` / `this.logger` are available inside `canActivate`. The dependencies are resolved once, when routes are built; the guard instance itself is still constructed per request, so request state held on `this` cannot leak between concurrent requests.

Register the guard's DEPENDENCIES in the module's `providers` — the guard class itself does not need to be a provider, and adding it there does not make an unresolvable dependency resolvable. A dependency that cannot be resolved fails the application at startup rather than arriving as `undefined`.

::: warning Upgrading from 0.4.4 or earlier
Guards received no dependency injection at all: they were constructed with no arguments on every request, so `this.config` and `this.logger` were `undefined` and the example above threw a `TypeError` at request time.
:::

### Async guard

`canActivate` may return a `Promise<boolean>`:

```typescript
const jwtGuard = createHttpGuard(async (ctx) => {
  const token = ctx.getRequest().headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  try {
    await verifyJwt(token);
    return true;
  } catch {
    return false;
  }
});
```

## Applying Guards

### On a controller (all routes)

```typescript
import { Controller, Get, UseGuards } from '@onebun/core';
import { AuthGuard } from '@onebun/core';

@UseGuards(AuthGuard)
@Controller('/protected')
class ProtectedController extends BaseController {
  @Get('/')
  index() {
    return { message: 'authenticated' };
  }
}
```

### On a single route

```typescript
@Controller('/resources')
class ResourceController extends BaseController {
  @UseGuards(AuthGuard, new RolesGuard(['admin']))
  @Delete('/:id')
  async delete(@Param('id') id: string) {
    // only accessible with Bearer token AND admin role
  }
}
```

Decorator source order does not matter — `@UseGuards` above or below the route decorator behaves identically, and the same holds for `@UseInterceptors` and `@UseFilters`.

::: warning Upgrading from 0.4.4 or earlier
A route-level `@UseGuards` written **above** the method decorator used to be silently discarded: the guard never ran and the route answered as if it were unprotected. Audit every route-level guard in your codebase — the order shown above is exactly the one that was broken. `@UseInterceptors` and `@UseFilters` were skipped the same way.
:::

### On a base controller

A class-level guard is inherited by every controller that extends the class, so a shared protected base can carry it once. The base does not need to be a `@Controller`.

```typescript
@UseGuards(AuthGuard)
class ProtectedController extends BaseController {}

@Controller('/admin')
class AdminController extends ProtectedController {
  @Get('/stats')
  stats() { /* requires a Bearer token */ }
}
```

Base guards run before the subclass's own, matching the controller-then-route order. Routes declared on the base are not mounted under the subclass — see [Controllers — Extending a Base Controller](/api/controllers#extending-a-base-controller).

::: warning Upgrading from 0.4.4 or earlier
Class-level decorators were not inherited at all: a subclass of a guarded base answered as if unprotected, with no error and nothing in the logs. Audit any shared protected base controller.
:::

### Combining controller + route guards

Guards from both levels are merged and run sequentially — controller guards first, then route guards.

```typescript
@UseGuards(AuthGuard)                  // applied to every route
@Controller('/admin')
class AdminController extends BaseController {

  @Get('/stats')
  getStats() { /* needs Bearer token only */ }

  @UseGuards(new RolesGuard(['admin'])) // additionally needs 'admin' role
  @Delete('/user/:id')
  deleteUser(@Param('id') id: string) { /* needs Bearer + admin role */ }
}
```

## Built-in Guards

### AuthGuard

Checks for a `Authorization: Bearer <token>` header. Returns `false` if the header is missing or does not start with `Bearer `.

```typescript
import { AuthGuard } from '@onebun/core';

@UseGuards(AuthGuard)
@Controller('/secure')
class SecureController extends BaseController { /* ... */ }
```

::: warning Not a Token Validator
`AuthGuard` checks only that an `Authorization: Bearer ...` header is present.
It does **not** validate or decode the token. Combine with a custom guard or middleware for JWT verification, token expiry checks, etc.
:::

### RolesGuard

Reads a comma-separated list of roles from the `x-user-roles` request header and verifies that **all** required roles are present (AND logic).

```typescript
import { RolesGuard, UseGuards } from '@onebun/core';

@UseGuards(new RolesGuard(['admin', 'moderator']))
@Delete('/post/:id')
async deletePost(@Param('id') id: string) { /* ... */ }
```

**Custom role extractor:**

```typescript
const guard = new RolesGuard(
  ['admin'],
  (ctx) => {
    // extract roles from JWT payload stored in header
    const payload = parseJwtPayload(ctx.getRequest().headers.get('authorization') ?? '');
    return payload?.roles ?? [];
  },
);
```

## Guard Response

When a guard returns `false`, the framework responds with HTTP 403 and a JSON error body. With `httpEnvelope: true`, the HTTP status is 200 while the error details remain in the body:

```json
{
  "success": false,
  "error": "Forbidden",
  "code": 403
}
```

Returning `false` and throwing are different tools. `false` is a plain refusal and always
produces exactly the envelope above — a route-level exception filter cannot change it, so
the contract is stable. Throwing lets the guard choose the status and message:

```typescript
const authGuard = createHttpGuard((ctx) => {
  const token = ctx.getRequest().headers.get('authorization');
  if (!token) {
    return false;                                          // 403 Forbidden
  }
  if (isExpired(token)) {
    throw new HttpException(401, 'Token expired');          // 401, through the filters
  }

  return true;
});
```

## Execution Order

```
Request → [Global Middleware] → [Module Middleware] → [Controller Middleware] → [Route Middleware]
       → [Controller Guards] → [Route Guards]   → [Exception Filters if a guard throws]
       → Route Handler                          → [Exception Filters on error]
       → Response
```
