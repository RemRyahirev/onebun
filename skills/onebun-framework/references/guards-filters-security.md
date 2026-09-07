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
additionally makes every guard that *narrows* — each `createHttpGuard()` guard, plus `AuthGuard` and
`RolesGuard` — return `false`, which reads as a real denial. A class guard that calls `getRequest()`
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

<!-- typecheck: skip -->
```typescript
// Controller-level (all routes)
@UseGuards(AuthGuard)
@Controller('/protected')
class ProtectedController extends BaseController { ... }

// Method-level (single route)
@UseGuards(AuthGuard, new RolesGuard(['admin']))
@Delete('/:id')
async delete(@Param('id') id: string) { ... }

// Combined: controller guards run first, then route guards
@UseGuards(AuthGuard)
@Controller('/admin')
class AdminController extends BaseController {
  @UseGuards(new RolesGuard(['admin']))
  @Delete('/user/:id')
  deleteUser() { ... }
}
```

**Decorator source order does not matter** — `@UseGuards` above or below `@Get`/`@Delete` behaves identically, and the same holds for `@UseInterceptors` and `@UseFilters`. Before 0.4.5 a route-level `@UseGuards` written ABOVE the method decorator was silently discarded and the route was reachable; code written against 0.4.4 or earlier in that order needs auditing, not rewriting.

The same `@UseGuards` works on a `@WebSocketGateway` and on a queue consumer, and merges with the
transport-specific `@UseWsGuards` / `@UseMessageGuards` on the same handler — shared `@UseGuards`
first. **WebSocket is the only transport that deduplicates a guard merge.** On HTTP and on queue
every merge is a plain concat — controller+route, class+handler, `@UseGuards` + `@UseMessageGuards` —
so a guard named twice anywhere runs twice: harmless for a pure check, doubled cost and doubled side
effects for anything that logs, counts or calls out.

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
nothing fails at startup either: there are no parameter types left to fail on.

**An INSTANCE passed to `@UseGuards` is shared, a CLASS is not.** `@UseGuards(new SomeGuard(...))`
hands over one object built at decoration time, and that single object serves every concurrent
request. Stateless instances are fine — `new RolesGuard(['admin'])` only reads its constructor
argument, which is why every instance-form example here is stateless. A guard that writes the
caller onto `this`, awaits, then reads `this` back will read whatever the LAST request wrote: two
overlapping requests measurably let the denied one through. Keep per-request state in locals inside
`canActivate`, or pass the class and let the framework construct it.

Function-based guards from `createHttpGuard(fn)` have no DI by design.

### Built-in Guards

- **`AuthGuard`** — checks `Authorization: Bearer <token>` header presence
- **`RolesGuard`** — checks roles in `x-user-roles` header (comma-separated). It requires **ALL**
  listed roles (`roles.every(...)`), not any of them: `new RolesGuard(['admin', 'moderator'])` admits
  only a caller holding both. For an OR, pass a custom `rolesExtractor` or use a single role.

Both are **HTTP-only and deny everywhere else**: each begins with
`if (!isHttpContext(context)) return false`, because both read a request. Guards created by
`createHttpGuard(fn)` behave identically — the wrapper denies rather than calling `getRequest()` on
a context that has none. This turns a class-level `@UseGuards(AuthGuard)` on a class that also
carries `@Subscribe` handlers into an outage: every message is denied and nacked with
`requeue: false`. Use `WsAuthGuard` / `WsPermissionGuard` (from `@onebun/core` WebSocket) and
`MessageAuthGuard` / `MessageServiceGuard` (queue) on those transports, or write a `Guard` that
narrows with `isHttpContext` / `isWsContext` / `isQueueContext` itself.

<!-- typecheck: skip -->
```typescript
import { AuthGuard, RolesGuard } from '@onebun/core';

// admin AND moderator — both roles must be present
@UseGuards(AuthGuard, new RolesGuard(['admin', 'moderator']))

// Custom role extractor
new RolesGuard(['admin'], (ctx) => {
  const payload = parseJwt(ctx.getRequest().headers.get('authorization') ?? '');
  return payload?.roles ?? [];
});
```

### Guard Response

When an HTTP guard returns `false`: **HTTP 403** with
`{ success: false, error: 'Forbidden', code: 403, details: {} }`. HTTP 200 is used only when the
application sets `httpEnvelope: true` — that option moves *every* status into the body and always
answers 200, so the status is not the denial signal there; `code` is.

On the other transports a denial is not a Response at all. WebSocket: the handler is skipped and an
`error` frame `{ code: 'FORBIDDEN', event, message: 'Guard denied this message' }` goes back on the
same ack id — the socket is **not** closed, since one denied message must not tear down a
multiplexed connection. Queue: the message is `nack`ed with `requeue: false` (a guard decision is
deterministic, so requeueing would deny the same message forever) and surfaces as
`onMessageFailed`, not `onMessageProcessed`.

---

## Exception Filters

Catch and transform errors thrown by route handlers, guards and interceptors — with or
without parameter decorators; the two execution paths behave identically. Filters merge
global → controller → route and **the last one wins**: exactly one filter runs per error,
there is no fallthrough between user filters. A filter that re-throws or returns a
non-Response falls back to the built-in default filter, which never throws.

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
  throw error; // delegate to the default filter
});

// Class-based
class ValidationFilter implements ExceptionFilter {
  catch(error: unknown, ctx: HttpExecutionContext): Response {
    if (error instanceof ValidationError) {
      return Response.json({ success: false, error: error.message });
    }
    throw error;
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
| `OneBunBaseError` | `toHttpStatus(error.code)` | `error.toErrorResponse()` → `{ success: false, error, code, details, originalError }` |
| Any other `Error` | `toHttpStatus(error.code)`, else 500 | `{ success: false, error: message, code, details: { originalErrorName, originalCode, stack } }` |

Two things about the last row that a reader will otherwise get wrong:

- **It is not a flat 500.** The status is `toHttpStatus(error.code)` — an `Error` carrying an
  integer `code` in 100–599 answers with THAT status, so
  `Object.assign(new Error('x'), { code: 404 })` produces HTTP 404. 500 is only the fallback for a
  missing or out-of-range code, e.g. the string `'ECONNREFUSED'`. (Coercion exists because passing
  `NaN` to `new Response` throws `RangeError` from inside the filter itself.)
- **The stack trace is serialized to the client.** `details.stack` carries `error.stack` verbatim
  for this branch, and there is no option to turn it off. If unhandled errors must not leak
  internals, register a global exception filter that catches everything and rewrites the body —
  the default filter will not do it for you.

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

### CORS

**Configuring `cors` is not enough on its own.** `CorsMiddleware` answers a preflight only on a path
that already declares an `OPTIONS`-capable route — `@Options()` or `@All()`. On any other path the
`OPTIONS` request never enters the middleware chain at all: Bun's method map rejects the verb and
the fallback returns a bare `404 Not Found` with no `Access-Control-*` headers. So a cross-origin
`POST` to a path that only declares `@Post()` is blocked at preflight even with `cors` correctly
configured, while a plain `POST` to that same path does get the headers. Declare `@Options()` (or
`@All()`) on every path a browser will preflight — anything beyond a simple GET/POST with a
form-encoded body. Headers are attached to every response of a matched route, error responses
included, and never to a fallback 404.

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

// Redis backend (multi-instance)
import { RateLimitMiddleware, RedisRateLimitStore } from '@onebun/core';
middleware: [RateLimitMiddleware.configure({
  max: 100, windowMs: 60_000,
  store: new RedisRateLimitStore(redisClient),
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