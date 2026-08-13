---
description: Guards — authorization and access control for HTTP routes, WebSocket message handlers and queue consumers.
---

<llm-only>

## Quick Reference for AI

**Guard interface:**
```typescript
import { Guard, HttpGuard, HttpExecutionContext, createHttpGuard, UseGuards } from '@onebun/core';
```

**Three ways to create a guard:**
1. `createHttpGuard(fn)` — inline function-based guard (simplest)
2. Implement `Guard` (any transport) or `HttpGuard` / `WsGuard` / `MessageGuard` (one transport), class-based, for DI
3. Use built-in `AuthGuard`, `RolesGuard` (HTTP), `WsAuthGuard` & friends (WebSocket), `MessageAuthGuard` & friends (queue)

**ONE decorator, three transports.** `@UseGuards` works on HTTP routes, WebSocket `@OnMessage` handlers and queue `@Subscribe` consumers, class-level and method-level, exactly like `@UseInterceptors`. Before 0.4.5 it wrote a metadata key only HTTP route registration read, so on a WebSocket or queue handler it was a SILENT no-op — no type error, no warning, no log line, and the handler ran completely unguarded. **Audit every queue consumer and WebSocket handler you guarded with `@UseGuards` before upgrading.**

**Applying guards:**
- `@UseGuards(MyGuard)` on a controller/gateway/consumer class — applies to every route, message handler and subscription on it
- `@UseGuards(MyGuard)` on a method — applies to that handler only
- Both can be combined; class guards run first, then method guards
- `@UseWsGuards` (WebSocket) and `@UseMessageGuards` (queue) still exist and still work. They are the narrower spelling for a guard that only makes sense on one transport; guards from both decorators are merged, shared `@UseGuards` first
- Decorator source order does NOT matter: `@UseGuards` above or below `@Get`/`@OnMessage`/`@Subscribe` behaves identically. Before 0.4.5 a route-level `@UseGuards` written ABOVE the method decorator was silently discarded and the route was reachable — audit any route guarded that way if you are upgrading from 0.4.4 or earlier. The same applied to `@UseInterceptors` and `@UseFilters`
- Class-based guards get full dependency injection on ALL THREE transports — constructor dependencies, `this.config` and `this.logger` all work inside `canActivate`. Dependencies are resolved once when handlers are registered; the guard INSTANCE is still created per invocation, so stashing per-request state on `this` remains safe. Passing an instance — `@UseGuards(new RolesGuard(['admin']))` — shares that one instance, as it always did. Function-based guards from `createHttpGuard(fn)` have no DI by design
- **The guard class must carry a decorator for constructor DI to work at all** — `@Service()` is the conventional one. TypeScript only emits the `design:paramtypes` metadata the DI reads for a class that has at least one decorator; an undecorated guard class with constructor parameters receives `undefined` for each and throws inside `canActivate`. This applies on HTTP too
- A DECORATED guard whose constructor dependency cannot be resolved fails the application at STARTUP with `DependencyResolutionError`, instead of being constructed with `undefined`. Register the DEPENDENCY in the module's `providers` — registering the guard itself does not help
- A class-level `@UseGuards` is INHERITED by a subclass controller, base first then the subclass's own. `@UseMiddleware`, `@UseInterceptors` and `@UseFilters` inherit the same way; routes do not

**Order of execution:** global middleware → controller middleware → route middleware → class guards → method guards → interceptors → handler

**Denial per transport** (a guard returning `false`):
| Transport | What the caller sees | Is the work lost? |
|---|---|---|
| HTTP | `{ success: false, error: 'Forbidden', code: 403 }`, HTTP 403 (200 with `httpEnvelope`) | n/a |
| WebSocket | an `error` frame: `{ event: 'error', data: { code: 'FORBIDDEN', event, message } }`, carrying the ack id if the client sent one. **The socket stays open** | n/a |
| Queue | `message.nack(false)` — no redelivery. Dead-letters on adapters with a DLQ, and the adapter raises `onMessageFailed` (never `onMessageProcessed`) on all of them | no: reported, not silently dropped |

**If a guard THROWS:** on HTTP the error goes through the route's exception filters, so `throw new HttpException(401, 'Token expired')` produces that status and message. On WebSocket and queue there is no filter chain to carry it, so a throw is treated as a DENIAL (fail closed) and logged at `error` with the guard class name, the handler and the message id.

**Universal ExecutionContext** — narrow before use:
```typescript
context.type                        // 'http' | 'ws' | 'queue'
isHttpContext(ctx)  // → getRequest(): OneBunRequest, getHandler(): string, getController(): string
isWsContext(ctx)    // → getClient(), getSocket(), getData(), getHandler(), getPatternParams()
isQueueContext(ctx) // → getMessage(), getMetadata(), getPattern(), getHandler(), getClass()
```
A guard that lands on a transport it cannot read must return `false`. Every built-in guard does exactly that, so `@UseGuards(AuthGuard)` on a `@Subscribe` handler DENIES — it does not pass and does not throw.

**Built-in guards:**
- HTTP: `AuthGuard` (checks `Authorization: Bearer <token>` presence), `RolesGuard` (comma-separated roles in `x-user-roles`; `new RolesGuard(['admin', 'user'])`)
- WebSocket: `WsAuthGuard`, `WsPermissionGuard`, `WsRoomGuard`, `WsAnyPermissionGuard`, `WsServiceGuard`
- Queue: `MessageAuthGuard`, `MessageServiceGuard`, `MessageHeaderGuard`, `MessageTraceGuard`

</llm-only>

# Guards

Guards implement authorization and access control. They run **after** middleware but **before** the handler, and one decorator — `@UseGuards` — covers HTTP routes, WebSocket message handlers and queue consumers.

## Interface

A guard is any object with a `canActivate` method. Write it against one transport, or against the union:

```typescript
import type { Guard, HttpGuard, ExecutionContext, HttpExecutionContext } from '@onebun/core';

// Single transport — the common case
interface HttpGuard {
  canActivate(context: HttpExecutionContext): boolean | Promise<boolean>;
}

// Any transport
interface Guard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

interface HttpExecutionContext {
  readonly type: 'http';
  getRequest(): OneBunRequest;  // incoming request
  getHandler(): string;          // name of the controller method being invoked
  getController(): string;       // name of the controller class
}
```

`HttpGuard`, `WsGuard` and `MessageGuard` all satisfy `Guard`, so existing single-transport guards keep compiling and keep working.

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

Constructor dependencies are injected the same way a service's are, and `this.config` / `this.logger` are available inside `canActivate`. The dependencies are resolved once, when handlers are registered; the guard instance itself is still constructed per invocation, so request state held on `this` cannot leak between concurrent requests.

Register the guard's DEPENDENCIES in the module's `providers` — the guard class itself does not need to be a provider, and adding it there does not make an unresolvable dependency resolvable. A dependency that cannot be resolved fails the application at startup rather than arriving as `undefined`.

::: danger The guard class must be decorated
`@Service()` on the guard is not decoration for its own sake. TypeScript emits the `design:paramtypes` metadata that dependency injection reads **only for a class that carries at least one decorator**. An undecorated guard class with constructor parameters gets `undefined` for every one of them, on every transport, and throws inside `canActivate` — and because there are no parameter types to resolve, nothing fails at startup either.

```typescript
class ApiKeyGuard {                          // ← no decorator
  constructor(private keys: KeyService) {}   // ← this.keys is undefined at run time
  canActivate(ctx: HttpExecutionContext) { return this.keys.check(ctx); }
}
```
:::

::: warning Upgrading from 0.4.4 or earlier
Guards received no dependency injection at all: they were constructed with no arguments on every request, so `this.config` and `this.logger` were `undefined` and the example above threw a `TypeError` at request time. On WebSocket and queue handlers that remained true until 0.4.5.
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

## One Decorator, Three Transports

`@UseGuards` is the same decorator on an HTTP route, a WebSocket `@OnMessage` handler and a queue `@Subscribe` consumer — the shape `@UseInterceptors` has always had.

```typescript
@Controller('/orders')
@UseGuards(TenantActiveGuard)          // every route, message handler and subscription below
class OrderController extends BaseController {
  @Get('/:id')
  find(@Param('id') id: string) { /* ... */ }

  @UseGuards(new RolesGuard(['admin']))
  @Delete('/:id')
  remove(@Param('id') id: string) { /* ... */ }

  @Subscribe('orders.*')               // guarded by TenantActiveGuard too
  async onOrderEvent(message: Message<OrderData>) { /* ... */ }
}
```

::: danger Upgrading from 0.4.4 or earlier
`@UseGuards` on a `@Subscribe` or `@OnMessage` handler was a **silent no-op**: no type error, no warning, nothing in the logs, and the handler ran completely unguarded. Audit every queue consumer and WebSocket handler you believed was guarded. `@UseMessageGuards` and `@UseWsGuards` were unaffected.
:::

### What a guard sees on each transport

`canActivate` receives an `ExecutionContext` — a discriminated union. Narrow it before touching anything:

```typescript
import { isHttpContext, isWsContext, isQueueContext } from '@onebun/core';
import type { Guard, ExecutionContext } from '@onebun/core';

@Service()
class TenantActiveGuard implements Guard {
  constructor(private tenants: TenantService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    let tenantId: string | undefined;

    if (isHttpContext(ctx)) {
      tenantId = ctx.getRequest().headers.get('x-tenant-id') ?? undefined;
    } else if (isQueueContext(ctx)) {
      tenantId = ctx.getMetadata().headers?.['x-tenant-id'];
    } else if (isWsContext(ctx)) {
      tenantId = ctx.getClient().metadata.tenantId as string | undefined;
    }

    // No branch matched, or no tenant on the one that did: deny. Never fall through to `true`.
    return tenantId !== undefined && await this.tenants.isActive(tenantId);
  }
}
```

| | HTTP | WebSocket | Queue |
|---|---|---|---|
| `ctx.type` | `'http'` | `'ws'` | `'queue'` |
| Payload | `getRequest(): OneBunRequest` | `getData<T>()`, `getSocket()` | `getMessage<T>()` |
| Identity | request headers / cookies | `getClient()` — `auth`, `rooms`, `metadata` | `getMetadata()` — `authorization`, `serviceId`, `headers`, `traceId` |
| Routing | `getHandler()`, `getController()` — strings | `getHandler()` — handler metadata, `getPatternParams()` | `getPattern()`, `getHandler()`, `getClass()` |

A guard written for one transport must **deny** on the others, not fall through. Every built-in guard already does: `@UseGuards(AuthGuard)` on a `@Subscribe` handler denies every message rather than reading `getRequest()` off a context that has none. So do the guards produced by `createHttpGuard()`, `createGuard()` (WebSocket) and `createMessageGuard()` (queue).

### What denial does on each transport

| Transport | Response | Message/connection |
|---|---|---|
| **HTTP** | `{ success: false, error: 'Forbidden', code: 403 }` with status 403 — status 200 under `httpEnvelope` | — |
| **WebSocket** | an `error` frame: `{ event: 'error', data: { code: 'FORBIDDEN', event, message } }`, carrying the client's ack id when it sent one | **the socket stays open.** One denied message must not tear down a connection multiplexing others |
| **Queue** | `message.nack(false)` — explicitly no redelivery | dead-lettered where the adapter has a DLQ; `onMessageFailed` is raised on every adapter, `onMessageProcessed` never. The message is reported, not silently swallowed |

Queue denial does not requeue on purpose: an authorization decision is deterministic, so redelivery would deny the same message forever. `requeue: false` terminates it server-side on JetStream, routes it to the dead-letter queue on Redis when `deadLetter` is configured, and drops it on the in-memory adapter — and in all three cases `onMessageFailed` fires, so a denial is visible to metrics instead of looking like a success.

The framework also logs every denial itself, at `warn`, naming the guard, the handler and the message id — and a guard that **throws** on WebSocket or queue is logged at `error` and treated as a denial. Neither transport has an exception-filter chain to carry a thrown guard, and failing open would turn a broken guard into a silent authorization bypass. HTTP is the deliberate exception: there a throw still travels to the filters, which is what makes `throw new HttpException(401, 'Token expired')` produce a 401.

### Transport-specific decorators

`@UseWsGuards` and `@UseMessageGuards` are still exported and still work. Reach for them when a guard only makes sense on one transport, so the type system checks the context for you:

```typescript
@UseWsGuards(WsAuthGuard)                          // WsExecutionContext, checked
@OnMessage('admin:*')
handleAdmin(@Client() client: WsClientData) { /* ... */ }

@UseMessageGuards(new MessageServiceGuard(['payment-service']))
@Subscribe('events.internal.*')
async handleInternal(message: Message<EventData>) { /* ... */ }
```

Guards from both decorators are merged on the same handler, shared `@UseGuards` first, and the same guard listed twice runs once. Both give class guards the same dependency injection `@UseGuards` does.

The composite helpers `MessageAllGuards` / `MessageAnyGuard` / `WsAllGuards` / `WsAnyGuard` are the exception: they take their children in their own constructor, at decoration time, before any module exists, so a child class with a constructor dependency gets nothing. Pass already-constructed children, or list the guards directly — `@UseGuards(A, B)` resolves each one with full DI and runs them in order.

## Built-in Guards

`AuthGuard` and `RolesGuard` are HTTP-only: both read the request. On a WebSocket or queue handler they deny. Use `WsAuthGuard` / `WsPermissionGuard` and `MessageAuthGuard` / `MessageServiceGuard` there — see [WebSocket](/api/websocket) and [Queue](/api/queue).

### AuthGuard

Checks for a `Authorization: Bearer <token>` header. Returns `false` if the header is missing or does not start with `Bearer `, and `false` on any non-HTTP context.

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

This section describes HTTP. WebSocket and queue denial are covered in [What denial does on each transport](#what-denial-does-on-each-transport).

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

HTTP:

```
Request → [Global Middleware] → [Module Middleware] → [Controller Middleware] → [Route Middleware]
       → [Controller Guards] → [Route Guards]   → [Exception Filters if a guard throws]
       → [Interceptors] → Route Handler         → [Exception Filters on error]
       → Response
```

WebSocket and queue skip the middleware chain — it is HTTP-only — and otherwise match:

```
Message → [Class Guards] → [Handler Guards] → [Interceptors] → Handler
       → denial: error frame (WS) / nack without requeue (queue), plus a framework log line
```
