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
3. Use a built-in starter guard: `BearerPresenceGuard`, `RolesGuard` (HTTP), `WsAuthGuard` & friends (WebSocket), `MessageAuthorizationPresenceGuard` & friends (queue). They check that something is present or compare values they are handed; none verifies a credential. Production authentication is option 2 — see **Production Authentication** below

**ONE decorator, three transports.** `@UseGuards` works on HTTP routes, WebSocket `@OnMessage` handlers and queue `@Subscribe` consumers, class-level and method-level. One decorator covers all three transports — each level (class, method) has one metadata key that every transport reads — so a guarded WebSocket or queue handler is enforced exactly as a guarded route is. Guards and interceptors differ only in inheritance by an overriding method, and the rule is the same on every transport: a method-level `@UseGuards` on a base method guards every method that overrides it (HTTP route, WebSocket gateway and queue consumer registration all collect method guards up the prototype chain with `getMethodGuards`, base method first), while a method-level `@UseInterceptors` is read from the method that declares the handler, so an overriding method does not inherit the base method's interceptor list

**Applying guards:**
- `@UseGuards(MyGuard)` on a controller/gateway/consumer class — applies to every route, message handler and subscription on it, but NOT to `@Cron`/`@Interval`/`@Timeout` methods: those are producers and are never guarded (nor intercepted), silently
- `@UseGuards(MyGuard)` on a method — applies to that handler only
- Both can be combined; class guards run first, then method guards
- A method-level `@UseGuards` on a base method guards every override of that method in a subclass, on all three transports and on every WebSocket gateway handler type (`@OnMessage`, `@OnConnect`, `@OnDisconnect`, `@OnJoinRoom`, `@OnLeaveRoom`): class guards, then the base method's guards, then the override's own. An override cannot drop an inherited method guard. Only `@UseGuards` carries over: `@UseWsGuards` and `@UseMessageGuards` are read from the method that declares the handler
- A client's room join is guarded through the `@OnJoinRoom` handlers whose pattern matches the room, and every one of their guards must allow it: one denial keeps the client out and runs none of those handlers. Each handler's list starts with the gateway-level guards (class-level `@UseGuards`, inherited from a base gateway class too), so with several matching handlers those are asked once per handler, each with that handler's context. A room NO `@OnJoinRoom` handler matches is decided by the gateway-level guards alone — same list, same order, once each; only a gateway without gateway-level guards lets such a join through without asking any guard. Every guard (and interceptor) of a join or leave — matched or handler-less — reads the room from `ctx.getRoomName()`: the room the gateway adds the client to or removes it from, what `@RoomName()` injects; `undefined` on `@OnMessage`/`@OnConnect`/`@OnDisconnect`. NEVER derive the room from `getData()`: the gateway takes the string data, else a non-empty `data.room`, else the `join:`/`leave:` suffix, so `join:user:42` with `{ room: '' }`, `5`, `[]` or `{}` joins `user:42` and `join:lobby` with data `'user:42'` joins `user:42`. For a handler-less join `getHandler()` = `{ type: 'joinRoom', handler: '', params: [], guards }` (no `pattern`) and `getPatternParams()` = `{}`; a guard recognises it by `handler === ''`. A gateway-level guard written for `@OnMessage` handlers must handle that context — one that denies or throws on it keeps clients out of every room no handler matches. To keep clients out of server-filled rooms: `@UseGuards(createGuard((ctx) => !ctx.getRoomName()?.startsWith('user:')))` on the gateway. The guards run BEFORE the client is added, so `client.rooms` does not list the room yet — a `WsRoomGuard` naming the room being joined denies every join to it. The guards cover the client's own `join` message only: a server-side `joinRoom(clientId, room)` never asks them. A `leave` never waits for a join: it takes effect at once and cancels any join of the same room still waiting on its guards — the client's own `leave` and a server-side `leaveRoom(clientId, room)` alike, the latter only on the instance holding the connection (with shared Redis storage, a `leaveRoom()` on another instance does not cancel it). A cancelled join — by a leave, or by a Socket.IO move — is answered at once with the same `FORBIDDEN` error frame, and its guards' later verdict is ignored. A Socket.IO connection whose CONNECT moves it to another gateway leaves every room it had at the moment of the move, so no membership crosses to another gateway. Its identity there is the new gateway's own: a gateway with an `authenticate` hook runs it at the CONNECT and `auth`/`metadata` become fresh copies of its answer (a refusal answers `connect_error` and the connection stays where it was, rooms and identity intact); once the hook allowed, the first gateway takes no new message (at most 100 are held; more refuses the move, or closes the connection once the move is being recorded and can no longer be refused), the move waits (up to 10 s, else refused) for every message the first gateway is still serving — a join pending on its guards included, waited for rather than cancelled — and only then swaps the identity, so no guard or handler body the first gateway awaits sees the target's hook grant. Work a handler starts WITHOUT awaiting it is not waited for: after the swap it reads, and can write, the new identity. A gateway without a hook refuses a move from a gateway that has one. Between two hook-less gateways the connection moves as it is — including whatever a handler wrote to `client.auth` before the CONNECT; the rule covers what hooks grant, not what handlers write. A message the move took the connection away from runs no further guard and no handler body and is answered `FORBIDDEN` (`Message cancelled: the connection moved to another gateway`); a close is not a move, and a closed connection's message runs on. A guard on `@OnLeaveRoom` never keeps a client in a room: the leave happens first, a denial skips only the handler
- `@UseWsGuards` (WebSocket) and `@UseMessageGuards` (queue) are the narrower spelling for a guard that only makes sense on one transport; guards from both decorators are merged, shared `@UseGuards` first, and deduplicated by identity — a guard written under both decorators runs once
- **Deduplication is by identity, at every level and on every transport.** Method-level guards are collected up the prototype chain and deduplicated on the way (`getMethodGuards` ends in `[...new Set(...)]`), so a guard inherited from a base method and re-declared on the override runs once; the merge of the class-level list with the method-level list is deduplicated too, so the same guard named at BOTH levels runs once per request or message — a guard that hits a database does that work once, and a denial is logged once
- Decorator source order does NOT matter: `@UseGuards` above or below `@Get`/`@OnMessage`/`@Subscribe` behaves identically. The same holds for `@UseInterceptors` and `@UseFilters`
- Class-based guards get full dependency injection on ALL THREE transports — constructor dependencies, `this.config` and `this.logger` all work inside `canActivate`. `this.config` is the APPLICATION's config object, so it is only a usable one when the app was created with `envSchema`: without a schema the framework installs a `NotInitializedConfig` stub whose every `get()` throws `Configuration not initialized`, and on HTTP that throw reaches the exception filters as a 500 rather than a 403. Dependencies are resolved once when handlers are registered; when the guard CLASS is passed, the instance is created per invocation, so stashing per-request state on `this` is safe there. Passing an INSTANCE — `@UseGuards(new RolesGuard(['admin']))` — shares that one object across every concurrent request: per-request state on `this` leaks between them and can let a denied request through. Use locals inside `canActivate` in that form. Function-based guards from `createHttpGuard(fn)` have no DI by design
- **The guard class must carry a decorator for constructor DI to work at all** — `@Service()` is the conventional one. TypeScript only emits the `design:paramtypes` metadata the DI reads for a class that has at least one decorator; an undecorated guard class with constructor parameters receives `undefined` for each and throws inside `canActivate`. This applies on HTTP too, and to an undecorated subclass of a decorated guard: it never receives the base's types (startup warns `<Guard> declares a constructor with parameters, but no types were emitted ...`, or `<Guard> declares no constructor of its own ...` when it declares none). A DECORATED subclass that declares no constructor is injected with the base guard's constructor dependencies, `@Inject` and `@Optional()` included (since 0.9.0) — see [Inherited Constructors](/api/decorators#inherited-constructors)
- A DECORATED guard whose constructor dependency cannot be resolved fails the application at STARTUP with `DependencyResolutionError`, instead of being constructed with `undefined`. Register the DEPENDENCY in the module's `providers` — registering the guard itself does not help
- A class-level `@UseGuards` is INHERITED by a subclass controller, base first then the subclass's own. `@UseMiddleware`, `@UseInterceptors` and `@UseFilters` inherit the same way; routes do not

**Order of execution:** global middleware → controller middleware → route middleware → class guards → method guards → interceptors → handler

**Denial per transport** (a guard returning `false`):
| Transport | What the caller sees | Is the work lost? |
|---|---|---|
| HTTP | `{ success: false, error: 'Forbidden', code: 403, details: {} }`, HTTP 403 (200 with `httpEnvelope`) | n/a |
| WebSocket | `@OnMessage` and `@OnJoinRoom`: an `error` frame: `{ event: 'error', data: { code: 'FORBIDDEN', event, message } }`, carrying the ack id if the client sent one. A denied `@OnJoinRoom` also keeps the client OUT of the room — its guards run before the room changes — and runs none of the room's `@OnJoinRoom` handlers; a join of a room no handler matches that the gateway-level guards deny is answered and kept out the same way. `@OnConnect`, `@OnDisconnect`, `@OnLeaveRoom`: no frame, the handler just does not run — a denied `@OnDisconnect` skips the cleanup written in it, and a denied `@OnLeaveRoom` still removes the client from the room, which the framework does before the handler. **The socket stays open** | n/a |
| Queue | `message.nack(false)` — no redelivery. Dead-letters on adapters with a DLQ, and the adapter raises `onMessageFailed` (never `onMessageProcessed`) on all of them | no: reported, not silently dropped |

**If a guard THROWS:** on HTTP the error goes through the route's exception filters, so `throw new HttpException(401, 'Token expired')` produces that status and message. On WebSocket and queue there is no filter chain to carry it, so a throw is treated as a DENIAL (fail closed) and logged at `error` with the guard class name, the handler and the message id.

**Universal ExecutionContext** — narrow before use:
```typescript
context.type                        // 'http' | 'ws' | 'queue'
isHttpContext(ctx)  // → getRequest(): OneBunRequest, getHandler(): string, getController(): string
isWsContext(ctx)    // → getClient(), getSocket(), getData(), getHandler(), getPatternParams(), getRoomName()
isQueueContext(ctx) // → getMessage(), getMetadata(), getPattern(), getHandler(), getClass()
```
A guard that lands on a transport it cannot read must return `false`. Every built-in LEAF guard does exactly that, so `@UseGuards(BearerPresenceGuard)` on a `@Subscribe` handler DENIES — it does not pass and does not throw. The four composites — `MessageAllGuards`, `MessageAnyGuard`, `WsAllGuards`, `WsAnyGuard` — carry NO transport check of their own; they just delegate, so they deny off-transport only for as long as every child does. A hand-written child inside one will reach `getMetadata()` on an HTTP context and throw.

**Built-in guards** — starter examples, not an authentication scheme:
- HTTP: `BearerPresenceGuard` (admits any `Authorization` header that starts with `Bearer `; the token is never decoded or verified), `RolesGuard` (`new RolesGuard(['admin', 'user'])`; roles come from the `rolesExtractor` argument, and with none from the comma-separated `x-user-roles` request header — a value the CALLER sends, so the default authorizes nothing on its own)
- WebSocket: `WsAuthGuard` (requires `client.auth.authenticated === true`, which the framework sets only when the gateway's `authenticate` hook accepts the client), `WsPermissionGuard`, `WsRoomGuard`, `WsAnyPermissionGuard`, `WsServiceGuard`
- Queue: `MessageAuthorizationPresenceGuard` (admits any message with a non-empty `metadata.authorization`; nothing verifies the value), `MessageServiceGuard`, `MessageHeaderGuard`, `MessageTraceGuard`

**Production authentication (HTTP):**
- A `@Service()` guard class that injects the service doing the verification (signature, expiry, session lookup), verifies the Bearer token in `canActivate`, and writes the verified identity with `updateRequestContext({ user })`. Register the injected service in the module's `providers`
- Declare the identity by augmenting `RequestContext` (`user?: AuthenticatedUser` — the member MUST be optional)
- `new RolesGuard(['admin'], () => getRequestContext()?.user?.roles ?? [])` — the extractor reads the verified identity, never a request header
- The verifying guard must run BEFORE `RolesGuard`: put it at class level (class guards run first) or earlier in the same `@UseGuards(...)` list. Where it did not run, the extractor returns `[]` and `RolesGuard` denies
- Handlers and services read the same identity with `getRequestContext()?.user`
- WebSocket verifies once per connection in the gateway's `authenticate` hook; queue metadata is publisher-written, so verify a signature in a guard of your own

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

`HttpGuard`, `WsGuard` and `MessageGuard` all satisfy `Guard`, so a single-transport guard can be passed anywhere a `Guard` is expected.

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
  // BaseService provides this.config automatically — no need to inject ConfigService,
  // but the application must have been created with an `envSchema` (see below)
  canActivate(ctx: HttpExecutionContext): boolean {
    const key = ctx.getRequest().headers.get('x-api-key');
    return key === this.config.get('auth.apiKey');
  }
}
```

Constructor dependencies are injected the same way a service's are, and `this.config` / `this.logger` are available inside `canActivate`. The dependencies are resolved once, when handlers are registered; the guard instance itself is still constructed per invocation **when you pass the guard class**, so request state held on `this` cannot leak between concurrent requests.

`this.config` is the application's own config object, which exists only when the application was created with an `envSchema`. Without one the framework installs a `NotInitializedConfig` stub, and every `get()` on it throws `Configuration not initialized. Provide envSchema in ApplicationOptions.` — so the guard above answers 500 rather than 403 on an app that never declared a schema. Declare the schema, or read the value from `process.env` as the function-based example does.

::: danger An instance passed to `@UseGuards` is shared
`@UseGuards(new RolesGuard(['admin']))` hands the framework an already-built object, and that ONE
instance serves every concurrent request — it is constructed once, at decoration time, not per
invocation. A guard written that way that stores the caller on `this`, awaits, and then reads
`this` back will read whatever the LAST request wrote: two overlapping requests can let the
denied one through. Keep per-request state in locals inside `canActivate` there, never on `this`.
Stateless instances — `new RolesGuard(['admin'])` reads only its constructor argument — are
unaffected; every instance-form example on this page is stateless for that reason.
:::

Register the guard's DEPENDENCIES in the module's `providers` — the guard class itself does not need to be a provider, and adding it there does not make an unresolvable dependency resolvable. A dependency that cannot be resolved fails the application at startup rather than arriving as `undefined`.

::: danger The guard class must be decorated
`@Service()` on the guard is not decoration for its own sake. TypeScript emits the `design:paramtypes` metadata that dependency injection reads **only for a class that carries at least one decorator**. An undecorated guard class with constructor parameters gets `undefined` for every one of them, on every transport, and throws inside `canActivate` — and because there are no parameter types to resolve, nothing fails at startup either. The one case that is reported is a guard that extends a decorated base guard taking dependencies: startup warns `<Guard> declares a constructor with parameters, but no types were emitted ...`, or `<Guard> declares no constructor of its own ...` when it declares none. Decorated, a subclass that declares no constructor is injected with the base guard's dependencies — see [Inherited Constructors](/api/decorators#inherited-constructors).

```typescript
class ApiKeyGuard {                          // ← no decorator
  constructor(private keys: KeyService) {}   // ← this.keys is undefined at run time
  canActivate(ctx: HttpExecutionContext) { return this.keys.check(ctx); }
}
```
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
import { BearerPresenceGuard } from '@onebun/core';

@UseGuards(BearerPresenceGuard)
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
  @UseGuards(BearerPresenceGuard, new RolesGuard(['admin']))
  @Delete('/:id')
  async delete(@Param('id') id: string) {
    // reached only when a Bearer header is present AND the extracted roles include 'admin'
    // — see the RolesGuard warning below for what "extracted" must mean
  }
}
```

Decorator source order does not matter — `@UseGuards` above or below the route decorator behaves identically, and the same holds for `@UseInterceptors` and `@UseFilters`.

### On a base controller

A class-level guard is inherited by every controller that extends the class, so a shared protected base can carry it once. The base does not need to be a `@Controller`.

```typescript
@UseGuards(BearerPresenceGuard)
class ProtectedController extends BaseController {}

@Controller('/admin')
class AdminController extends ProtectedController {
  @Get('/stats')
  stats() { /* requires a Bearer token */ }
}
```

Base guards run before the subclass's own, matching the controller-then-route order. Routes declared on the base are not mounted under the subclass — see [Controllers — Extending a Base Controller](/api/controllers#extending-a-base-controller).

### On an overriding method

A method-level guard on a base method guards every method that overrides it in a subclass. The override adds its own guards to the inherited ones; it cannot drop them.

```typescript
import { AuthGuard, BaseController, Controller, Delete, Param, RolesGuard, UseGuards } from '@onebun/core';

class AccountHandlers extends BaseController {
  @UseGuards(AuthGuard)
  remove(id: string) {
    return { removed: id };
  }
}

@Controller('/accounts')
class AdminAccountController extends AccountHandlers {
  @UseGuards(new RolesGuard(['admin']))
  @Delete('/:id')
  override remove(@Param('id') id: string) {
    // reached only after AuthGuard (from the base method), then RolesGuard
    return { removed: id };
  }
}
```

The order is class guards, then the base method's guards, then the override's own. Base method guards come first for the same reason base class guards do: the override specialises the base method, so its own checks run after the base ones, and a denial by an inherited guard stops the call before the override's guards run. A guard named on both the base method and the override runs once. The rule is the same on an HTTP route, every WebSocket gateway handler — `@OnMessage`, `@OnConnect`, `@OnDisconnect`, `@OnJoinRoom` and `@OnLeaveRoom` — and a queue `@Subscribe` consumer, and it is resolved once, when the handler is registered. On `@OnConnect`, `@OnDisconnect` and `@OnLeaveRoom` a denial sends no error frame: a denied `@OnConnect` leaves the connection open without running the handler or sending its reply, a denied `@OnDisconnect` does not run, so cleanup written in it is skipped, and a denied `@OnLeaveRoom` skips its handler while the client still leaves the room. A denied `@OnJoinRoom` keeps the client out of the room and answers with the `FORBIDDEN` frame a denied `@OnMessage` gets (see [What denial does on each transport](#what-denial-does-on-each-transport)). A guard on a base method that one of these handlers overrides applies there too — on a join it decides whether the client joins. It covers `@UseGuards` only: the transport-specific `@UseWsGuards` and `@UseMessageGuards`, and `@UseInterceptors`, are read from the method that declares the handler.

### Combining controller + route guards

Guards from both levels are merged and run sequentially — controller guards first, then route guards.

```typescript
@UseGuards(BearerPresenceGuard)        // applied to every route
@Controller('/admin')
class AdminController extends BaseController {

  @Get('/stats')
  getStats() { /* needs Bearer token only */ }

  @UseGuards(new RolesGuard(['admin'])) // additionally checks for the 'admin' role
  @Delete('/user/:id')
  deleteUser(@Param('id') id: string) { /* Bearer header + extracted roles include 'admin' */ }
}
```

The two lists are merged controller-first and deduplicated by identity: naming the same guard on the controller AND on the route runs it once per request. Queue consumers and WebSocket handlers merge their two levels the same way.

## One Decorator, Three Transports

`@UseGuards` is the same decorator on an HTTP route, a WebSocket `@OnMessage` handler and a queue `@Subscribe` consumer, at class level and at method level on all three. `@UseInterceptors` works at class level and at method level on all three as well. The two differ for an overriding method, the same way on every transport: a method-level `@UseGuards` on a base method guards every override of it (see [On an overriding method](#on-an-overriding-method)), while an overriding method does not inherit the base method's interceptor list (see [Queue handler](/api/interceptors#queue-handler)).

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

Scheduled handlers are the exception, because they are not consumers. A `@Cron`, `@Interval` or
`@Timeout` method is a data PROVIDER — the framework publishes its return value to the decorator's
`pattern` — so there is no caller to authorize, and neither `@UseGuards` nor `@UseInterceptors`
wraps it. Both are accepted without a type error and silently do nothing there, including a
class-level `@UseGuards` on a class that also carries routes and subscriptions. Guard the work
inside the method, or put the authorization on the `@Subscribe` consumer of the pattern the job
publishes to — that consumer is guarded normally.

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
| Routing | `getHandler()`, `getController()` — strings | `getHandler()` — handler metadata, `getPatternParams()`; `getRoomName()` — the room a join or leave changes, `undefined` elsewhere; for a room join no `@OnJoinRoom` handler matches, a handler with an empty `handler` name and no `pattern` | `getPattern()` — the SUBSCRIPTION pattern, `getHandler()`, `getClass()`; the captured values are on the message, `getMessage().params` |

A guard written for one transport must **deny** on the others, not fall through. Every built-in leaf guard already does: `@UseGuards(BearerPresenceGuard)` on a `@Subscribe` handler denies every message rather than reading `getRequest()` off a context that has none. So do the guards produced by `createHttpGuard()`, `createGuard()` (WebSocket) and `createMessageGuard()` (queue).

The composites are the exception — `MessageAllGuards`, `MessageAnyGuard`, `WsAllGuards` and `WsAnyGuard` check nothing themselves, they only delegate to their children. Wrapping built-ins, that inherits their denial; wrapping a hand-written child, it does not, and the child reaches for an accessor the context does not have. Put the `isQueueContext()` / `isWsContext()` check in the child, as the built-ins do.

### What denial does on each transport

| Transport | Response | Message/connection |
|---|---|---|
| **HTTP** | `{ success: false, error: 'Forbidden', code: 403, details: {} }` with status 403 — status 200 under `httpEnvelope` | — |
| **WebSocket** | `@OnMessage` and `@OnJoinRoom`: an `error` frame: `{ event: 'error', data: { code: 'FORBIDDEN', event, message } }`, carrying the client's ack id when it sent one; a denied join leaves the client out of the room. `@OnConnect`, `@OnDisconnect`, `@OnLeaveRoom`: no frame — the handler does not run | **the socket stays open.** One denied message must not tear down a connection multiplexing others |
| **Queue** | `message.nack(false)` — explicitly no redelivery | dead-lettered where the adapter has a DLQ; `onMessageFailed` is raised on every adapter, `onMessageProcessed` never. The message is reported, not silently swallowed |

A guard on `@OnJoinRoom` decides whether the client joins the room. The framework asks it before the room changes, so a denied join changes nothing: the client is not stored as a member, not subscribed to the room's topic and not added to `client.rooms`, it receives none of the room's broadcasts, and no `@OnJoinRoom` handler runs. The client gets one `FORBIDDEN` frame — the same one a denied `@OnMessage` gets, with `event` set to the join event it sent (`join` or `join:<room>`). When several `@OnJoinRoom` handlers match the room, the guards of each are asked in declaration order and one denial is enough: the client stays out and none of the handlers runs, not even those whose guards allowed. When every guard allows, the client joins and the handlers run after the join, as they do without guards, and none of their guards is asked again for them. Because the guards run first, a guard that reads `client.rooms` sees the client before the join: a `WsRoomGuard` naming the room being joined denies every join to that room.

A gateway-level `@UseGuards` decides every join of the gateway's rooms. Each matching handler's guard list starts with it, so it is asked as part of each handler's list — once per matching handler, with that handler's context. A room that no `@OnJoinRoom` handler matches is decided by the gateway-level guards alone, asked in the same order, once each, with the same consequences: a denial keeps the client out and answers the same `FORBIDDEN` frame, and a join waiting on them is cancelled and answered by a leave or a Socket.IO move like any other. Only a gateway with no gateway-level guards lets a client join such a room without asking a guard. The context of that join describes a handler that does not exist — `getHandler()` is `{ type: 'joinRoom', handler: '', params: [], guards }`, with no `pattern`, and `getPatternParams()` is `{}` — so a gateway-level guard written with `@OnMessage` handlers in mind must handle it: one that denies or throws on it keeps clients out of every room no handler matches. A guard tells that join by its empty `handler` name.

Every guard of a join or a leave, and every interceptor of an `@OnJoinRoom` or `@OnLeaveRoom` handler, reads the room from `getRoomName()`: the room the gateway adds the client to or removes it from — the one `@RoomName()` injects. It is `undefined` on `@OnMessage`, `@OnConnect` and `@OnDisconnect`. A guard deciding by room reads it there and never from `getData()`, which is whatever the client sent: the gateway takes the room from string data, else from a non-empty `room` field of the data, else from the `join:<room>` / `leave:<room>` event, so the data of `join:user:42` may be `{ room: '' }`, `5` or `{}`, and the data `'user:42'` sent as `join:lobby` joins `user:42`. See [WebSocket — Room joins and leaves](/api/websocket#room-joins-and-leaves).

The guards decide the client's own `join` message and nothing else: a server-side `joinRoom(clientId, room)`, called from a handler or a service, adds the client without asking them. A guard that answers late changes nothing until it answers, and the client is in no new room meanwhile. A `leave` does not wait for it: the leave takes effect at once and cancels the join if it names the same room — whether the client sent the leave or the server called `leaveRoom(clientId, room)`, a kick cannot be undone by a join that was already being decided. A server-side `leaveRoom()` reaches a pending join only on the instance holding the connection: with several instances sharing Redis storage, `leaveRoom()` called on another instance removes the stored membership but does not cancel a join whose guards are still deciding there, and that join lands afterwards. A Socket.IO move to another gateway cancels it too. A cancelled join is answered at once with the same `FORBIDDEN` frame, its `message` naming why, so an ack id is never left unanswered even by a guard that never settles; whatever the guard says afterwards is ignored. A connection that closes before the answer is not added and asks no further guard. Joins waiting on guards are not limited in number, as the guards of concurrent `@OnMessage` frames are not — a guard that never settles is an application bug on either.

A Socket.IO CONNECT that moves a connection to another gateway takes it out of every room it joined before the move, in the same step as the move, so a membership granted under one gateway's guards — or under none — never reaches another gateway's rooms. A server-side `joinRoom()` still writing when the move lands is taken back. The identity the new gateway's guards read is the new gateway's own: when it has an `authenticate` hook, the hook runs at the CONNECT with the upgrade's token and request, and `client.auth` and `client.metadata` become fresh copies of what it returns before any of its guards runs; a hook that refuses refuses the CONNECT, and the connection stays on its gateway as it was. The swap waits until the first gateway has finished every message it was serving for the connection — new ones are held meanwhile — so a guard of the first gateway that is still deciding never reads the new identity either. The wait covers what guards and handlers await: work a handler leaves running without awaiting it reads the new identity once the swap is done. A gateway without a hook is never reached from a gateway that has one — that CONNECT is refused — so a `WsPermissionGuard` on it cannot be passed with permissions another gateway's hook granted. What a handler writes to `client.auth` is another matter: between two gateways without a hook it moves with the connection. Whatever the move, a guard or handler body of a gateway the move took the connection away from does not run: the message is answered with the `FORBIDDEN` frame, `message` naming the move. A connection that merely closed is not stopped this way. See [WebSocket — Moving to another namespace](/api/websocket#moving-to-another-namespace).

The other WebSocket lifecycle handlers have no message to answer, so a denial there is silent to the client. A denied `@OnConnect` leaves the connection open, with neither the handler nor its reply. A denied `@OnDisconnect` does not run, so cleanup written in it is skipped; the framework still unregisters the client and removes it from storage. A denied `@OnLeaveRoom` does not run either, and the client leaves the room all the same: the framework removes it before the handler, so a guard there decides whether the handler runs, never whether the client stays in the room.

Queue denial does not requeue on purpose: an authorization decision is deterministic, so redelivery would deny the same message forever. `requeue: false` terminates it server-side on JetStream, routes it to the dead-letter queue on Redis when `deadLetter` is configured, and drops it on the in-memory adapter — and in all three cases `onMessageFailed` fires, so a denial is visible to metrics instead of looking like a success.

The framework also logs every denial itself, at `warn`, naming the guard, the handler and the message id — and a guard that **throws** on WebSocket or queue is logged at `error` and treated as a denial. Neither transport has an exception-filter chain to carry a thrown guard, and failing open would turn a broken guard into a silent authorization bypass. HTTP is the deliberate exception: there a throw still travels to the filters, which is what makes `throw new HttpException(401, 'Token expired')` produce a 401.

### Transport-specific decorators

`@UseWsGuards` and `@UseMessageGuards` are the transport-specific spellings of `@UseGuards`. Reach for them when a guard only makes sense on one transport, so the type system checks the context for you:

<!-- typecheck: skip -->
```typescript
@UseWsGuards(WsAuthGuard)                          // WsExecutionContext, checked
@OnMessage('admin:*')
handleAdmin(@Client() client: WsClientData) { /* ... */ }

@UseMessageGuards(new MessageServiceGuard(['payment-service']))
@Subscribe('events.internal.*')
async handleInternal(message: Message<EventData>) { /* ... */ }
```

Guards from both decorators are merged on the same handler, shared `@UseGuards` first, and deduplicated by identity — the same guard written under both decorators, or at both class and method level, runs once. That holds on all three transports. Both decorators give class guards the same dependency injection `@UseGuards` does.

The composite helpers `MessageAllGuards` / `MessageAnyGuard` / `WsAllGuards` / `WsAnyGuard` are the exception: they take their children in their own constructor, at decoration time, before any module exists, so a child class with a constructor dependency gets nothing. Pass already-constructed children, or list the guards directly — `@UseGuards(A, B)` resolves each one with full DI and runs them in order.

## Built-in Guards

The built-in guards are **starter examples**. Each one checks that something is present, or compares a value it is handed; none of them verifies a credential. They get a route guarded while a project is young. Before a check has to hold against a caller who lies, replace the presence check with a guard that verifies the credential, and hand `RolesGuard` the identity that guard verified — see [Production Authentication](#production-authentication).

`BearerPresenceGuard` and `RolesGuard` are HTTP-only: both read the request. On a WebSocket or queue handler they deny. Use `WsAuthGuard` / `WsPermissionGuard` and `MessageAuthorizationPresenceGuard` / `MessageServiceGuard` there — see [WebSocket](/api/websocket) and [Queue](/api/queue).

### BearerPresenceGuard {#authguard}

Checks for an `Authorization: Bearer <token>` header. Returns `false` if the header is missing or does not start with `Bearer `, and `false` on any non-HTTP context.

```typescript
import { BearerPresenceGuard } from '@onebun/core';

@UseGuards(BearerPresenceGuard)
@Controller('/secure')
class SecureController extends BaseController { /* ... */ }
```

::: warning Not a Token Validator
`BearerPresenceGuard` checks only that an `Authorization: Bearer ...` header is present.
It does **not** validate or decode the token: `Authorization: Bearer anything` passes. Verify the token in a guard of your own, as in [Production Authentication](#production-authentication).
:::

### RolesGuard

Verifies that **all** required roles are present (AND logic). The roles come from the `rolesExtractor` passed as the second constructor argument; with no extractor, from a comma-separated `x-user-roles` request header.

::: danger The default trusts a header the caller controls
Pass a `rolesExtractor` that reads a **verified** identity — the claims of a token your own code decoded — as in the example below. It is the second constructor argument, and it is the supported way to use this guard.

Without one, `RolesGuard` falls back to the `x-user-roles` request header. That header arrives from the caller and nothing verifies it, so `curl -H 'Authorization: Bearer anything' -H 'x-user-roles: admin'` satisfies `BearerPresenceGuard` and `RolesGuard` together. On the default extractor the guard reports what the caller claims to be, not what the caller is.

If an already-deployed application depends on the header, the stop-gap is a middleware that **overwrites** `x-user-roles` on every request — `headers.set(...)`, never "set it if absent", because an absent-only write leaves a forged value in place. Bun's incoming `Headers` are mutable, so this does work. It is remediation and not the supported answer: the trust decision stays in a channel the client can write, guarded only by an ordering convention nothing enforces. Attach the middleware to one controller, forget it on another, and the bypass is back with no type error.
:::

<!-- typecheck: skip -->
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

Decoding a payload is not verifying it. This extractor is sound only behind a guard that has already checked that token's signature; without one, a caller writes whatever roles it likes into the payload and nothing checks the signature beside it. [Production Authentication](#production-authentication) hands the extractor the identity that guard verified, so nothing is decoded twice.

## Production Authentication

Authentication is checking a credential against something the caller cannot forge: a signature, a session store, an identity provider. That check belongs to your application, in a guard that injects the service doing it. The setup has three parts — the identity type, the guard that verifies and records it, and a `RolesGuard` whose `rolesExtractor` reads the recorded identity.

### The verified identity

The identity lives on the [request context](/api/request-context), the per-request store the framework opens for every routed request. Declare it by declaration merging:

<!-- typecheck: skip -->
```typescript
// auth.types.ts
export interface AuthenticatedUser {
  id: string;
  roles: string[];
}

declare module '@onebun/core' {
  interface RequestContext {
    user?: AuthenticatedUser;   // must be optional
  }
}
```

The request context is backed by `AsyncLocalStorage`, so two requests in flight together never see each other's identity, and the next guard, the handler and every service below them read the same value. The alternatives fail on one of those counts: a request header is written by the caller, so an identity put there is trusted only as long as every route overwrites it first; a field on the guard is visible to neither `RolesGuard` nor the handler, and a guard instance passed to `@UseGuards` is shared by every concurrent request.

### The verifying guard

```typescript
import type { HttpExecutionContext, HttpGuard } from '@onebun/core';
import {
  BaseService,
  HttpException,
  Service,
  updateRequestContext,
} from '@onebun/core';

@Service()
class TokenService extends BaseService {
  // Check the signature and expiry against your signing key or identity provider,
  // and answer null for anything that fails.
  async verify(token: string): Promise<AuthenticatedUser | null> {
    return await verifyJwt(token);
  }
}

@Service()
class VerifiedTokenGuard implements HttpGuard {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(ctx: HttpExecutionContext): Promise<boolean> {
    const header = ctx.getRequest().headers.get('authorization');
    if (!header?.startsWith('Bearer ')) {
      return false;                                              // 403 Forbidden
    }

    const user = await this.tokens.verify(header.slice('Bearer '.length));
    if (!user) {
      throw new HttpException(401, 'Invalid or expired token');  // 401, through the filters
    }

    updateRequestContext({ user });

    return true;
  }
}
```

Register `TokenService` in the module's `providers`; the guard itself is not a provider. `@Service()` on the guard is what makes the constructor injection work — see [Class-based guard](#class-based-guard). Passing the guard as a class gives every request its own instance.

### Roles from the verified identity

```typescript
import {
  BaseController,
  Controller,
  Delete,
  Get,
  getRequestContext,
  Param,
  RolesGuard,
  UseGuards,
} from '@onebun/core';

const rolesOfVerifiedUser = () => getRequestContext()?.user?.roles ?? [];

@UseGuards(VerifiedTokenGuard)                    // class level: runs first on every route
@Controller('/admin')
class AdminController extends BaseController {
  @Get('/me')
  me() {
    return getRequestContext()?.user;             // the identity the guard verified
  }

  @UseGuards(new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/users/:id')
  deleteUser(@Param('id') id: string) { /* reached only by a verified admin */ }
}
```

Order is what makes this sound. Class-level guards run before route-level ones, so the identity is written before `RolesGuard` reads it; inside one `@UseGuards(...)` list guards run left to right, so `@UseGuards(VerifiedTokenGuard, new RolesGuard(['admin'], rolesOfVerifiedUser))` works on a single route too. On a route where the verifying guard did not run, the context carries no `user`, the extractor returns `[]` and `RolesGuard` denies.

The one `RolesGuard` instance serves every request, which is safe: it reads only its constructor arguments and the request context.

The other transports verify elsewhere. A WebSocket client is verified once, at the upgrade, by the gateway's [`authenticate`](/api/websocket#authentication) hook, and `WsAuthGuard` / `WsPermissionGuard` read what it attached. Queue metadata is written by the publisher, so a consumer that has to trust the sender verifies a signature in a guard of its own — see [Queue](/api/queue).

## Guard Response

This section describes HTTP. WebSocket and queue denial are covered in [What denial does on each transport](#what-denial-does-on-each-transport).

When a guard returns `false`, the framework responds with HTTP 403 and a JSON error body. With `httpEnvelope: true`, the HTTP status is 200 while the error details remain in the body:

```json
{
  "success": false,
  "error": "Forbidden",
  "code": 403,
  "details": {}
}
```

Returning `false` and throwing are different tools. `false` is a plain refusal — a route-level
exception filter cannot change it, so the status and the `error`/`code` values are a stable
contract. Do not deep-compare the whole object: `details` is a `Record<string, unknown>` that
exception filters populate, and it is `{}` only on this plain-denial path. Throwing lets the guard
choose the status and message:

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
