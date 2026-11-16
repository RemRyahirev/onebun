# Guards, Exception Filters & Security Middleware

## Guards

On HTTP, guards run **after** middleware but **before** the route handler. They implement
authorization/access control.

`@UseGuards` is **one decorator across three transports**, not an HTTP-only concept: it applies to
HTTP routes, WebSocket `@OnMessage` handlers and queue `@Subscribe` handlers, at class level as well
as method level. It does **not** reach `@Cron` / `@Interval` / `@Timeout` — scheduled handlers are
registered straight onto the scheduler as bound methods and are never guarded or intercepted, with
no warning.

### Interface

```typescript
// Transport-agnostic — this is the shape `@UseGuards` accepts everywhere
interface Guard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

// HTTP-only convenience: same method, context already narrowed
interface HttpGuard {
  canActivate(context: HttpExecutionContext): boolean | Promise<boolean>;
}

interface HttpExecutionContext {
  readonly type: 'http';      // discriminant — REQUIRED, not decoration
  getRequest(): OneBunRequest;
  getHandler(): string;       // controller method name
  getController(): string;    // controller class name
}
```

**`type` is load-bearing.** `ExecutionContext` is the discriminated union
`HttpExecutionContext | WsExecutionContext | MessageExecutionContext`, and `isHttpContext(ctx)` is
literally `ctx.type === 'http'`. `type` is a required member, so a context hand-rolled without it —
typically in a unit test — does not typecheck as `HttpExecutionContext` at all. At runtime it
additionally makes every guard that *narrows* — each `createHttpGuard()` guard, plus `BearerPresenceGuard`
and `RolesGuard` — return `false`, which reads as a real denial. A class guard that calls `getRequest()`
directly (like `ApiKeyGuard` below) never narrows and will not notice, which is what makes the
omission easy to ship. Use `isWsContext` / `isQueueContext` for the other two.

### Creating Guards

```typescript
import { createHttpGuard, UseGuards } from '@onebun/core';

// Function-based (simplest)
const apiKeyGuard = createHttpGuard((ctx) => {
  return ctx.getRequest().headers.get('x-api-key') === process.env.API_KEY;
});

// Async guard
const jwtGuard = createHttpGuard(async (ctx) => {
  const token = ctx.getRequest().headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  try { await verifyJwt(token); return true; } catch { return false; }
});

// Class-based (has DI access)
@Service()
class ApiKeyGuard extends BaseService implements HttpGuard {
  canActivate(ctx: HttpExecutionContext): boolean {
    // `this.config` only works when the application passes `envSchema` — see below
    return ctx.getRequest().headers.get('x-api-key') === this.config.get('auth.apiKey');
  }
}
```

### Applying Guards

`VerifiedTokenGuard` and `rolesOfVerifiedUser` below are the verifying guard and the `RolesGuard`
extractor from "Production Authentication" further down.

<!-- typecheck: skip -->
```typescript
// Controller-level (all routes)
@UseGuards(BearerPresenceGuard)
@Controller('/protected')
class ProtectedController extends BaseController { ... }

// Method-level (single route) — one list runs left to right, so the identity exists before RolesGuard
@UseGuards(VerifiedTokenGuard, new RolesGuard(['admin'], rolesOfVerifiedUser))
@Delete('/:id')
async delete(@Param('id') id: string) { ... }

// Combined: controller guards run first, then route guards
@UseGuards(VerifiedTokenGuard)
@Controller('/admin')
class AdminController extends BaseController {
  @UseGuards(new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/user/:id')
  deleteUser() { ... }
}
```

**Decorator source order does not matter** — `@UseGuards` above or below `@Get`/`@Delete` behaves identically, and the same holds for `@UseInterceptors` and `@UseFilters`.

The same `@UseGuards` works on a `@WebSocketGateway` and on a queue consumer, and merges with the
transport-specific `@UseWsGuards` / `@UseMessageGuards` on the same handler — shared `@UseGuards`
first. **Every guard merge deduplicates by identity**, on all three transports: controller+route,
class+handler, and `@UseGuards` + `@UseWsGuards`/`@UseMessageGuards`. A guard named twice runs once,
so a guard that logs, counts or calls out does it once per invocation, at whatever levels it is named.

**A method-level `@UseGuards` on a base method guards every override of it**, on an HTTP route,
every WebSocket gateway handler type (`@OnMessage`, `@OnConnect`, `@OnDisconnect`, `@OnJoinRoom`,
`@OnLeaveRoom`) and a queue consumer alike. Order: class guards, then the base method's guards,
then the override's own; a guard named on both the base method and the override runs once. The
override adds guards, it cannot drop an inherited one. Only `@UseGuards` carries over —
`@UseWsGuards`, `@UseMessageGuards` and `@UseInterceptors` are read from the method that declares
the handler, so an override does not inherit those.

**A guard on `@OnJoinRoom` is access control for the room.** It runs BEFORE the room changes; a
denial keeps the client out (not stored, not subscribed, not in `client.rooms`, no broadcasts),
runs none of the room's `@OnJoinRoom` handlers and answers with the same `FORBIDDEN` error frame a
denied `@OnMessage` gets. The guards of every `@OnJoinRoom` handler whose pattern matches the room
are asked, in declaration order; one denial is enough. Each handler's list starts with the
gateway-level guards (class-level `@UseGuards`, base gateway classes included), so with several
matching handlers those run once per handler. When all allow, the client joins and the handlers run
after it, no guard asked again for them. **A gateway-level `@UseGuards` decides EVERY client join**:
a room no `@OnJoinRoom` handler matches (e.g. a server-filled `user:<id>`) is decided by the
gateway-level guards alone — same order, once each, same `FORBIDDEN` frame, cancelled by a leave or
a move like any pending join. Only a gateway WITHOUT gateway-level guards lets such a join through
unasked. **A room guard reads the room from `ctx.getRoomName()`** — on every guard of a join or
leave (matched or handler-less) and every `@OnJoinRoom`/`@OnLeaveRoom` interceptor it is the room
the gateway adds the client to or removes it from, what `@RoomName()` injects; `undefined` on
`@OnMessage`/`@OnConnect`/`@OnDisconnect`. NEVER derive the room from `getData()`: the gateway takes
string data, else a non-empty `data.room`, else the `join:`/`leave:` suffix, so `join:user:42` with
`{ room: '' }`, `5`, `[]` or `{}` joins `user:42`, and `join:lobby` with `'user:42'` joins `user:42`.
Server-filled rooms: `@UseGuards(createGuard((ctx) => !ctx.getRoomName()?.startsWith('user:')))` on
the gateway. In a handler-less join `getHandler()` = `{ type: 'joinRoom', handler: '', params: [],
guards }` (no `pattern`) and `getPatternParams()` = `{}` — recognise it by `handler === ''`; a
gateway-level guard written for `@OnMessage` must cope — one that denies or throws on it keeps
clients out of every room no handler matches. The
guard sees the client before the join, so `client.rooms` does not list the room yet —
`WsRoomGuard('<the room being joined>')` denies every join to it. The guards cover only the client's own
`join` message: a server-side `joinRoom(clientId, room)` never asks them. A `leave` never waits for
a join — the client's `leave` and a server-side `leaveRoom()` (a kick) apply at once and cancel a
still-pending join of the same room; the kick only on the instance holding the connection — with
shared Redis storage, `leaveRoom()` on another instance does not cancel it and the join lands later. A cancelled join (by a leave or a Socket.IO move) is answered at
once with the same `FORBIDDEN` frame; its guards' later verdict is ignored. A connection that closes
before the guard answers is not added. Pending joins are not limited in number. A Socket.IO CONNECT
that moves a connection to another gateway (`40/<namespace>,`) takes it out of every room it had in
the same step (a server-side `joinRoom()` still writing is taken back), so no membership crosses
gateways and the client rejoins rooms on the new gateway. A hook's grant does NOT cross a move: a
target gateway with an `authenticate` hook runs it at the CONNECT (same token, a request with the
upgrade's URL and headers) and `client.auth` / `client.metadata` become fresh copies of its answer;
a hook that returns `false`, throws or takes over 10 s answers `connect_error` `Unauthorized` and the
connection stays on its gateway, rooms and identity intact. Once the hook allowed, new EVENTs are
held (≤ 100; more refuses the move, or closes the connection once the move is being recorded) and the swap waits (≤ 10 s, else `connect_error` `The connection
could not be moved`) until the first gateway finished every message it was serving — a join pending
on its guards is waited for, not cancelled — so no guard or handler body the first gateway awaits
sees the target's grant; held EVENTs then go to whichever gateway the connection ends on. Work a
handler starts WITHOUT awaiting it is not waited for and reads/writes the new identity after the
swap. A second CONNECT meanwhile is refused. A target WITHOUT a hook refuses a move from a gateway that has one (`connect_error`).
Between two hook-less gateways the connection moves as it is, INCLUDING what a handler wrote to
`client.auth` — authenticate in the hook, never by assigning `client.auth` in a handler. A guard or
handler body of a gateway a move took the connection away from never runs (answered `FORBIDDEN`,
`Message cancelled: the connection moved to another gateway`); a close is not a move — a closed
connection's message runs on. Every gateway a Socket.IO client
reaches with `io('/<namespace>')` that guards on `client.auth` needs its OWN `authenticate` hook —
or the client connects with `?namespace=<namespace>`. A `join`/`leave` whose room is not a string is
ignored.

The other lifecycle denials are silent to the client. A denied `@OnConnect` leaves the socket open
without running the handler or sending its reply; a denied `@OnDisconnect` skips the cleanup written
in it (the framework still unregisters the client); a denied `@OnLeaveRoom` skips the handler, and
the client leaves the room anyway — the framework removes it first, so a leave guard can never keep
a client in a room.

**Class-based guards get DI on their DEPENDENCIES, not on the instance.** Constructor dependencies,
`this.config` and `this.logger` all work inside `canActivate`, and the dependencies are resolved
once, at handler registration. But `this.config` is a `NotInitializedConfig` stub unless the
application passes `envSchema` in `ApplicationOptions`, and **every `.get()` on that stub throws** —
a throwing guard is filtered, so the caller gets a 500 with a serialized stack, not a 403. Pass
`envSchema`, or inject a `@Service()` that owns the secret. The guard object itself is still
constructed **per invocation** — deliberately, so request state stashed on `this` across an `await`
cannot leak between concurrent requests. This holds on all three transports.

**Register the guard's DEPENDENCIES in the module's `providers`, not the guard.** The guard class is
never a provider, and listing it there does not make an unresolvable dependency resolvable:
`providers: [MyGuard]` with `MyGuard`'s own dependency unregistered still fails the whole
application at boot with `DependencyResolutionError`. Register the dependency instead and leave the
guard out of `providers` entirely. Resolution failures then surface at startup — with two escapes:
an `@Optional()` parameter gets `undefined` deliberately, and an undecorated guard class has no
parameter types left to fail on (next paragraph).

**The guard class must carry a decorator** — `@Service()` is the usual one. TypeScript emits the
`design:paramtypes` metadata DI reads only for classes with at least one decorator, so an
undecorated guard with constructor parameters receives `undefined` for every one of them and
nothing fails at startup either: there are no parameter types left to fail on. That holds for an
undecorated guard that EXTENDS a decorated base guard too: without a decorator nothing tells a
constructor it declares from none, so DI never hands it the base's dependencies — by position into
parameters that may differ — whatever the import order of `reflect-metadata`, and even when its
parameters match the base's. Decorate the subclass: one that declares no constructor is then
injected with the base guard's constructor dependencies, `@Inject` and `@Optional()` included
(since 0.9.0), and one that declares its own gets its own parameters. Startup warns about an
undecorated subclass (`<Guard> declares a constructor with parameters, but no types were emitted
...`, or `<Guard> declares no constructor of its own ...`): add `@Service()` to it.

**An INSTANCE passed to `@UseGuards` is shared, a CLASS is not.** `@UseGuards(new SomeGuard(...))`
hands over one object built at decoration time, and that single object serves every concurrent
request. Stateless instances are fine — `RolesGuard` keeps nothing but its constructor arguments,
which is why every instance-form example here is stateless. A guard that writes the
caller onto `this`, awaits, then reads `this` back will read whatever the LAST request wrote: two
overlapping requests measurably let the denied one through. Keep per-request state in locals inside
`canActivate`, or pass the class and let the framework construct it.

Function-based guards from `createHttpGuard(fn)` have no DI by design.

### Built-in Guards

The built-in guards are **starter examples**: each checks that something is present or compares a
value it is handed, and none verifies a credential. Production auth is the setup under
"Production Authentication" below.

- **`BearerPresenceGuard`** — checks `Authorization: Bearer <token>` header presence; the token is
  never decoded or verified, so `Bearer anything` passes
- **`RolesGuard`** — `new RolesGuard(roles, rolesExtractor)`, **both arguments required**. It
  compares the required roles against whatever the extractor returns and reads nothing from the
  request on its own. It requires **ALL** listed roles (`roles.every(...)`), not any of them:
  `new RolesGuard(['admin', 'moderator'], rolesOfVerifiedUser)` admits only a caller holding both.
  For an OR, require a single role, or have the extractor add one when any accepted role is held.

**`RolesGuard` is exactly as trustworthy as its extractor.** Read a verified identity —
`() => getRequestContext()?.user?.roles ?? []`, written by a verifying guard that ran first — never
a request header: an extractor reading `x-user-roles` returns what the caller wrote, so
`curl -H 'x-user-roles: admin'` passes, with `BearerPresenceGuard` in front or not. A header is
sound only when a middleware you control OVERWRITES it on every request (`headers.set`), never
fills it in only when absent — an absent-only write leaves a forged value in place — and that rests
on an ordering convention nothing enforces. Always pass an **instance**: a missing extractor is a
compile error and a `TypeError` at construction, and the class form `@UseGuards(RolesGuard)` is
constructed with no arguments on every request and answers 500 without reaching the handler. The
same trust problem applies on the queue side: `MessageAuthorizationPresenceGuard` and
`MessageServiceGuard` trust `metadata.authorization` and `metadata.serviceId`, which the publisher
writes and the broker does not authenticate.

`BearerPresenceGuard` and `RolesGuard` are **HTTP-only and deny everywhere else**: each begins with
`if (!isHttpContext(context)) return false`, because both read a request. Guards created by
`createHttpGuard(fn)` behave identically — the wrapper denies rather than calling `getRequest()` on
a context that has none. This turns a class-level `@UseGuards(BearerPresenceGuard)` on a class that also
carries `@Subscribe` handlers into an outage: every message is denied and nacked with
`requeue: false`. Use `WsAuthGuard` / `WsPermissionGuard` (from `@onebun/core` WebSocket) and
`MessageAuthorizationPresenceGuard` / `MessageServiceGuard` (queue) on those transports, or write a `Guard` that
narrows with `isHttpContext` / `isWsContext` / `isQueueContext` itself.

<!-- typecheck: skip -->
```typescript
import { getRequestContext, RolesGuard } from '@onebun/core';

// admin AND moderator — both roles must be present on the identity VerifiedTokenGuard recorded
const rolesOfVerifiedUser = () => getRequestContext()?.user?.roles ?? [];
@UseGuards(VerifiedTokenGuard, new RolesGuard(['admin', 'moderator'], rolesOfVerifiedUser))

// Roles from the token payload
new RolesGuard(['admin'], (ctx) => {
  const payload = parseJwt(ctx.getRequest().headers.get('authorization') ?? '');
  return payload?.roles ?? [];
});
```

Decoding a payload is not verifying it: that extractor is sound only behind a guard that already
checked the token's signature.

### Production Authentication

Verification belongs to the application, in a guard that injects the service doing it. The verified
identity goes on the request context (`AsyncLocalStorage`, per request), and `RolesGuard` reads it
from there — never from a header, which the caller writes, and never from a field on a guard, which
`RolesGuard` and the handler cannot see.

<!-- typecheck: skip -->
```typescript
import type { HttpExecutionContext, HttpGuard } from '@onebun/core';
import { getRequestContext, HttpException, RolesGuard, Service, updateRequestContext } from '@onebun/core';

interface AuthenticatedUser { id: string; roles: string[] }

declare module '@onebun/core' {
  interface RequestContext {
    user?: AuthenticatedUser;   // MUST be optional
  }
}

@Service()
class VerifiedTokenGuard implements HttpGuard {
  constructor(private readonly tokens: TokenService) {}   // TokenService goes in `providers`

  async canActivate(ctx: HttpExecutionContext): Promise<boolean> {
    const header = ctx.getRequest().headers.get('authorization');
    if (!header?.startsWith('Bearer ')) return false;                         // 403
    const user = await this.tokens.verify(header.slice('Bearer '.length));   // signature + expiry
    if (!user) throw new HttpException(401, 'Invalid or expired token');     // 401
    updateRequestContext({ user });
    return true;
  }
}

const rolesOfVerifiedUser = () => getRequestContext()?.user?.roles ?? [];

@UseGuards(VerifiedTokenGuard)                                   // class level: runs first
@Controller('/admin')
class AdminController extends BaseController {
  @UseGuards(new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/users/:id')
  deleteUser(@Param('id') id: string) { ... }
}
```

The verifying guard must run before `RolesGuard` — class level, or earlier in the same
`@UseGuards(...)` list. Where it did not run, the context has no `user`, the extractor returns `[]`
and `RolesGuard` denies. Handlers and services read the identity with `getRequestContext()?.user`.
WebSocket verifies once per connection in the gateway's `authenticate` hook (`WsAuthGuard` and
`WsPermissionGuard` read what it attached); queue metadata is publisher-written, so verify a
signature in a guard of your own.

### Guard Response

When an HTTP guard returns `false`: **HTTP 403** with
`{ success: false, error: 'Forbidden', code: 403, details: {} }`. HTTP 200 is used only when the
application sets `httpEnvelope: true` — that option moves *every* status into the body and always
answers 200, so the status is not the denial signal there; `code` is.

On the other transports a denial is not a Response at all. WebSocket: the handler is skipped and an
`error` frame `{ code: 'FORBIDDEN', event, message: 'Guard denied this message' }` goes back on the
same ack id — for a denied `@OnMessage` and a denied room join alike — and the socket is **not**
closed, since one denied message must not tear down a multiplexed connection. Queue: the message is `nack`ed with `requeue: false` (a guard decision is
deterministic, so requeueing would deny the same message forever) and surfaces as
`onMessageFailed`, not `onMessageProcessed`.

---

## Exception Filters

Catch and transform errors thrown by route handlers, guards and interceptors — with or
without parameter decorators; the two execution paths behave identically. Filters are tried
**most specific outwards** — route, then controller, then global, then the built-in default —
and the first one to return a Response answers. **Returning `undefined` declines** and hands the
error one level out; that is the supported way to say "not mine". A filter that THROWS is treated
as a bug: reported with its name and answered by the default filter, without consulting the rest
of the chain — so never rethrow to decline.

Interceptors sit INSIDE that boundary: a handler error reaches
`try { await next() } catch` before any filter sees it.

Middleware is NOT filtered, by design: it post-processes the response `next()` returns, so
filtering above the chain would strip the headers `cors`/`security`/`rateLimit` add. A
guard returning `false` is not an error either — it always yields HTTP 403 with
`{success:false,error:'Forbidden',code:403,details:{}}` and never reaches a filter, while a guard
that *throws* is filtered.

### Creating Filters

```typescript
import { createExceptionFilter, UseFilters } from '@onebun/core';
import type { ExceptionFilter, HttpExecutionContext } from '@onebun/core';

// Function-based
const myFilter = createExceptionFilter((error, ctx) => {
  if (error instanceof MyCustomError) {
    return Response.json({ success: false, error: error.message }, { status: 200 });
  }

  return undefined; // decline: the next filter outwards gets it
});

// Class-based
class ValidationFilter implements ExceptionFilter {
  catch(error: unknown, ctx: HttpExecutionContext): Response | undefined {
    if (error instanceof ValidationError) {
      return Response.json({ success: false, error: error.message });
    }

    return undefined; // decline
  }
}
```

### Applying Filters

<!-- typecheck: skip -->
```typescript
// Global
const app = new OneBunApplication(AppModule, { filters: [myFilter] });

// Controller-level
@UseFilters(new ValidationFilter())
@Controller('/users')
class UserController extends BaseController { ... }

// Method-level
@UseFilters(myFilter)
@Post('/')
async create() { ... }
```

### HttpException

Throw from handlers to get a specific HTTP status code:

```typescript
import { HttpException } from '@onebun/core';

throw new HttpException(400, 'Bad input');
throw new HttpException(404, 'Not found');
throw new HttpException(409, 'Conflict');
```

The `defaultExceptionFilter` handles these with the real HTTP status code.
Framework validation errors automatically throw `HttpException(400, ...)`: a failed `@Body(schema)`
/ `@Param(name, schema)` / `@Query(name, schema)` ArkType check, and a missing value for any
parameter marked required — including the file decorators **`@UploadedFile`**, **`@UploadedFiles`**
and **`@FormField`**. There is no `@File` decorator in `@onebun/core`; those three are the only
file/form parameter decorators.

### Default Filter Behavior

| Error type | HTTP status | Body |
|---|---|---|
| `HttpException` | exception's `statusCode` | `{ success: false, error: message, code: statusCode, details: {} }` |
| `OneBunBaseError` | `error.code` when it is 400–599, else 500 | `error.toErrorResponse()` → `{ success: false, error, code, details, originalError }` |
| Any other `Error` or thrown value | `toHttpStatus(error.code)`, else 500 | `{ success: false, error: 'Internal Server Error', code, details: {} }` |

Three things about the last row that a reader will otherwise get wrong:

- **It is not a flat 500.** The status is `toHttpStatus(error.code)` — an `Error` carrying an
  integer `code` in 100–599 answers with THAT status, so
  `Object.assign(new Error('x'), { code: 404 })` produces HTTP 404. 500 is only the fallback for a
  missing or out-of-range code, e.g. the string `'ECONNREFUSED'`. (Coercion exists because passing
  `NaN` to `new Response` throws `RangeError` from inside the filter itself.)
- **The error's own message is NOT in the body.** It answers with the fixed string
  `UNHANDLED_ERROR_MESSAGE` (`'Internal Server Error'`), because a message written by a driver, a
  socket or the file system routinely names an absolute path, an internal host and port, or the
  password in a connection string, and nothing in the filter can tell those from a harmless
  message. The first two rows keep their messages: those are author-written and client-facing.
  To return specific wording to a client, throw an `HttpException` — that is what it is for.
- **No stack trace and no `details` either.** `details` is present and empty. Both the message and
  the details come back under `exposeErrorDetails: true` in `ApplicationOptions` — one flag for
  both, deliberately not derived from `NODE_ENV`, since an unset or mistyped `NODE_ENV` would flip
  a security-relevant default the wrong way with no signal.

Nothing is lost operationally: an error that reaches this row is logged whole, message and stack
included, before the default filter answers — grep the logs for `Unhandled error in <Controller>.<handler>`.

**What gets logged at error level.** `Unhandled error in <Controller>.<handler>:` is written only
when no route/controller/global filter answered — the error is on its way to the default filter —
and never for an `HttpException` or a `OneBunBaseError`, except an HTTP-client failure the handler let
escape (logged with `{ code, details }`, see below). An error a filter answered is not logged
by the framework, so mapping a domain error class to a 4xx in a filter produces no error-level line;
a filter that answers a real failure reports it itself. A filter that throws or rejects — including
one that rethrows to decline — is logged as `Exception filter <name> threw; …`, and one that
returns neither a Response nor `undefined`/`null` as `… returned neither a Response nor undefined; …`,
each followed by the unhandled line for the error it was handed: decline with `return undefined`.
The line is written after every filter settled, so an async filter that never settles leaves the
request pending with nothing logged — bound slow work in a filter. HTTP only — WebSocket and queue
handlers have no exception-filter chain.

**The `OneBunBaseError` row leaves an HTTP-client error's transport details out.** A
`OneBunBaseError` is sent whole, `details` and `originalError` included — except the transport
details of an error `@onebun/requests` produced: an `HTTP_ERROR`'s `details.headers` (the upstream's
`set-cookie`), `details.url` and `details.details` (the upstream's body); a `REDIRECT_ERROR`'s
`details.url` and `details.location`; the raw error in `details.details` of a transport failure
(Bun's connection error names the URL) and of `RESPONSE_PARSE/READ/DECODE_ERROR`. They are dropped at
any depth — `client.req()` with an `errors` map nests the failure under `details.originalError` — by serializing with the
`withoutTransportDetails` replacer (exported from `@onebun/requests` and `@onebun/core`). Every
Promise method of the HTTP client and the service client rejects with such a `OneBunBaseError` (the class
the status names, the client's record as `details` by reference), so an escaped client call answers with
the upstream's status minus the transport details, not an unhandled 500. A
code outside 400–599 (a `TransportError`'s `0`, a `REDIRECT_ERROR`'s 3xx, a `RESPONSE_PARSE_ERROR`'s 2xx)
answers HTTP 500 and keeps the `code` in the body; a OneBun client reading such a body takes the HTTP
status (500), never a `TransportError` — a body's `code` counts only when it is 400–599. A OneBun
callee's own error (`{ success: false, error, code, details }` in its body) keeps its status and `error`
on the way out, but its `details` and `originalError` go out as `{}`: they were written for the calling
service's code, which reads them whole. To pass them on, throw your own error with a copy
(`new ConflictError(e.error, { ...e.details })`). The escaped client failure no filter answered is also
LOGGED at error level (`Unhandled error in <Controller>.<handler>:` with the error and `{ code, details }`, `details` minus
the transport details: no URL, upstream headers or body — log those where you catch), unlike a `OneBunBaseError`
the application throws itself; `isHttpClientFailure(error)` (from `@onebun/core` / `@onebun/requests`)
tells one apart. The client's own `AUTH_ERROR` (signing failed) is an `UnauthorizedError`, 401 — map it
if your caller must not read it as its own credentials failing.
`exposeErrorDetails: true` sends them. Only records the client built are touched: an author-written
`details: { headers, url }` is sent whole, and so is a COPY of a client record
(`{ ...e.details, extra }`) — rebuild errors from `e.details` by reference, or pick fields. A filter
of your own that serializes such an error, or puts its `details` into a body of its own (a
`ValidationError` from an upstream's 422 carries the client's record as `details`):
`JSON.stringify(body, withoutTransportDetails)`. A filter of your own that answers with `error.code` as
the HTTP status must map a code outside 400–599 to 500 (`error.code >= 400 && error.code <= 599 ?
error.code : 500`): `new Response(body, { status: 0 })` throws RangeError, the filter is reported as
buggy and the default filter answers, and a 3xx or 2xx would read as success. Filters see only throws:
a handler that RETURNS a client failure (`return outcome.left`) sends it whole as its `result`.

`httpEnvelope: true` overrides the status column: every row answers HTTP 200 and the real status
lives in `code`.

---

## Security Middleware

Three built-in middleware, enabled via `ApplicationOptions` shortcuts:

```typescript
const app = new OneBunApplication(AppModule, {
  cors: { origin: 'https://my-app.com', credentials: true },
  rateLimit: { windowMs: 60_000, max: 100 },
  security: true,
});
```

**Auto-ordering:** CORS → RateLimit → [user middleware] → SecurityHeaders

### Bounding the request body

`maxRequestBodySize` (bytes) on `ApplicationOptions` — or per service in multi-service mode — is
the only way to lower the transport limit; absent it is Bun's 128 MiB. Bun refuses an oversized
request on its headers with `413`, before routing and before any middleware, so the body never
enters the process. A `content-length` check in middleware is not the same thing: it runs after the
transport accepted the body and trusts a header the caller writes. `rateLimit` is not the same
thing either — it bounds how many requests arrive, and one 100 MB upload is one request.

```typescript
const app = new OneBunApplication(AppModule, { maxRequestBodySize: 1024 * 1024 });
```

### CORS

**Configuring `cors` is enough.** A browser preflight is answered before routing, so no
`@Options()` route is needed on the paths a frontend calls. A path declaring only `@Post()` answers
its preflight correctly, and so does a path that does not exist. Do not declare `@Options()` on a
path just so a browser's preflight succeeds — CORS answers it.

Four details worth keeping straight:

- The split between a preflight and an API probe is the `Access-Control-Request-Method` header,
  which the Fetch spec requires on every real preflight. A bare `curl -X OPTIONS` reaches the
  application — your `@Options()` handler, or an honest `404`.
- A declared `@Options()` route is never shadowed by the short-circuit: Bun's router runs first, so
  a matched path never reaches the fallback the short-circuit lives in.
- A real preflight is still answered by CORS even where an `@Options()` route exists, because a
  preflight response without the grant is a blocked request whatever its status. `preflightContinue:
  true` hands it back to you and disables the short-circuit.
- A disallowed origin gets a well-formed `204` with no `Access-Control-Allow-Origin`. The browser
  blocks it, which is its decision to make.

Headers are attached to every response of a matched route, error responses included.

<!-- typecheck: skip -->
```typescript
// All origins (default)
cors: true

// Custom
cors: {
  origin: 'https://example.com',  // or RegExp, Array, function
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600,
}

// Manual via middleware array
middleware: [CorsMiddleware.configure({ origin: /\.example\.com$/ })]
```

### Rate Limiting

<!-- typecheck: skip -->
```typescript
// Defaults: 100 req / 60s, in-memory, keyed by transport peer address
rateLimit: true

// Custom
rateLimit: { windowMs: 15 * 60 * 1000, max: 200 }

// Redis backend (multi-instance) — counts with a Lua script, so replicas cannot
// lose each other's increments. `keyPrefix` defaults to 'rl:'; set it when two
// applications share one Redis, or they share buckets.
import { RateLimitMiddleware, RedisRateLimitStore } from '@onebun/core';
middleware: [RateLimitMiddleware.configure({
  max: 100, windowMs: 60_000,
  store: new RedisRateLimitStore(redisClient, { keyPrefix: 'intake:rl:' }),
})]

// Custom key (e.g., by API key instead of client address)
RateLimitMiddleware.configure({
  max: 50, windowMs: 60_000,
  keyGenerator: (req) => req.headers.get('x-api-key') ?? getClientAddress(req) ?? 'unknown',
})
```

**The default key is the transport peer, not `x-forwarded-for`.** `defaultKeyGenerator` is
`getClientAddress(req) ?? 'unknown'`, which resolves to `server.requestIP()` — an address the caller
cannot forge. The proxy headers you would assume are honoured (`x-forwarded-for`,
`cf-connecting-ip`, `x-real-ip`) are consulted **only** when the application sets
`ApplicationOptions.trustProxy: true`, and that defaults to `false`.

Both directions bite. Behind a load balancer *without* `trustProxy: true`, the peer is the proxy, so
every caller shares one bucket and the limit fires for everybody at once. With `trustProxy: true` on
a directly reachable app, any caller sets its own `x-forwarded-for` and picks its own bucket, so the
limit means nothing. Turn it on when — and only when — every request genuinely arrives through a
proxy that overwrites the header. The same flag also drives `remoteAddr` on HTTP spans, so the
framework gives one answer to "who called".

Rate limit exceeded: HTTP 429,
`{ success: false, error: 'Too Many Requests', code: 429, details: {} }`, with `RateLimit-Limit`,
`RateLimit-Remaining: 0` and `RateLimit-Reset` (`standardHeaders`, default `true`). **`Retry-After`
is emitted only under `legacyHeaders: true`, which defaults to `false`** — it is bundled with the
`X-RateLimit-*` set, so a client that keys off `Retry-After` sees nothing on a default setup.

### Security Headers

Sets helmet-equivalent headers (CSP, HSTS, X-Frame-Options, etc.):

<!-- typecheck: skip -->
```typescript
// All defaults
security: true

// Custom
security: {
  contentSecurityPolicy: "default-src 'self'; img-src *",
  strictTransportSecurity: false,  // disable in dev
  xFrameOptions: 'DENY',
}
```

Each option: `string` (custom value) or `false` (disable).

---

## Execution Order

```
Request → Global Middleware → Module Middleware → Controller Middleware → Route Middleware
       → Controller Guards → Route Guards
       → Global Interceptors → Controller Interceptors → Route Interceptors
       → Route Handler
       → Exception Filters (on error)
       → Response
```

On the other transports the same class-level/handler-level guard merge happens, minus middleware
and filters:

```
WS message   → Gateway Guards + Handler Guards → Gateway/Handler Interceptors → @OnMessage handler
Queue msg    → Class Guards + Handler Guards   → Class/Handler Interceptors   → @Subscribe handler
Scheduled    → @Cron / @Interval / @Timeout handler        (NO guards, NO interceptors)
```

The scheduled row is the trap: a class-level `@UseGuards` or `@UseInterceptors` on a service that
mixes `@Subscribe` with `@Cron` covers the subscribers and silently skips the cron jobs. Put the
check inside the scheduled method itself.