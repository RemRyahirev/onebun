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

**Order of execution:** global middleware → controller middleware → route middleware → guards → handler

**If a guard returns `false` or rejects:** responds with `{ success: false, error: 'Forbidden', code: 403 }` (HTTP 403, or HTTP 200 when `httpEnvelope` mode is enabled).

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

Reads a comma-separated list of roles from the `x-user-roles` request header and verifies that at least one required role is present.

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

When a guard returns `false`, the framework responds with HTTP 200 and a JSON error body (consistent with the framework's error envelope):

```json
{
  "success": false,
  "error": "Forbidden",
  "code": 403
}
```

## Execution Order

```
Request → [Global Middleware] → [Module Middleware] → [Controller Middleware] → [Route Middleware]
       → [Controller Guards] → [Route Guards]
       → Route Handler
       → [Exception Filters on error]
       → Response
```
