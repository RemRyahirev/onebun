# Universal Interceptors

Interceptors wrap handler execution across **HTTP routes, WebSocket handlers, and Queue
subscribers**. They run after guards but before the handler. Apply with `@UseInterceptors()`.

Three rules decide whether an interceptor works at all. Each one fails **silently** — nothing
throws at startup, the interceptor just misbehaves or never runs:

1. **A class with constructor parameters MUST carry a class decorator** (`@Service()`).
   `extends BaseInterceptor` does NOT buy DI.
2. **One instance per class per application, built at startup** — shared by every route, gateway
   handler and subscription that names the class; never keep per-request state on `this`.
3. **On the queue side only `@Subscribe` is intercepted, and only via a CLASS-level
   `@UseInterceptors`** — `@Cron`/`@Interval`/`@Timeout` and method-level `@UseInterceptors` on a
   subscriber are ignored.

## Interface

```typescript
interface Interceptor {
  intercept(
    context: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown>;
}

// Discriminated union of all transport contexts
type ExecutionContext = HttpExecutionContext | WsExecutionContext | MessageExecutionContext;
// Each has readonly type: 'http' | 'ws' | 'queue'

// Type guards for narrowing
isHttpContext(ctx)   // → ctx is HttpExecutionContext
isWsContext(ctx)     // → ctx is WsExecutionContext
isQueueContext(ctx)  // → ctx is MessageExecutionContext
```

## Lifecycle hooks

An interceptor class receives the module lifecycle hooks on the instance that serves requests:
`onModuleInit` runs in its own pass after routes are registered and before the server accepts
anything, and `onModuleDestroy` on the way down. The same holds for middleware. Guards do not get
them — a guard is constructed per request, so there is no instance to initialize, and the framework
warns at startup if a guard class implements `onModuleInit`.

## Lifetime: one instance per class, shared by every request

An interceptor class is instantiated when handlers are **registered** (application startup), once
per class per application, and that instance serves every request or message that reaches any
handler it wraps — including a global interceptor across every route, and the same class used on
HTTP, WebSocket and the queue. An interceptor passed as an **instance**
(`new TimeoutInterceptor(5000)`) is not copied either: the resolver hands it through untouched, so
the caller owns its lifetime and two instances of one class stay two.

Through 0.6.0 the instance was per registration SITE: a class covering three routes was constructed
three times, each route bound to its own copy, so a counter or a limiter on `this` counted per route
without saying so.

Consequences, in order of how often they bite:

- **Never write per-request state to `this`** — `this.startTime`, `this.currentUser`,
  `this.requestId` all leak across concurrent requests. Keep it in locals inside `intercept()`.
- Injected dependencies are resolved once, so an interceptor cannot depend on request scope.
- Surprising because **guards are the opposite**: passing a guard CLASS constructs it per
  invocation, so `this` state is safe there. That habit does not carry over to interceptors.

## Three ways to create

### 1. Function-based (simplest)

No DI, no `this.logger` — use it for anything stateless.

```typescript
import { createInterceptor } from '@onebun/core';

const TimingInterceptor = createInterceptor(async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  console.log(`Took ${Date.now() - start}ms`);
  return result;
});
```

### 2. Class implementing `Interceptor` (no constructor dependencies)

Safe to leave undecorated **only** because the constructor takes nothing.

```typescript
import { isHttpContext, type ExecutionContext, type Interceptor } from '@onebun/core';

class AddHeaderInterceptor implements Interceptor {
  async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
    const result = await next();
    if (isHttpContext(ctx) && result instanceof Response) {
      return new Response(await result.text(), {
        status: result.status,
        headers: { ...Object.fromEntries(result.headers.entries()), 'x-custom': 'true' },
      });
    }
    return result;
  }
}
```

### 3. Class with DI — the class decorator is what makes it work

`@Service()` (any CLASS decorator; a decorator on `intercept` does not count) is what buys
constructor injection. `extends BaseInterceptor` adds only `this.logger` and `this.config`.

```typescript
import type { ExecutionContext } from '@onebun/core';
import { BaseInterceptor, Service, isHttpContext } from '@onebun/core';

@Service()
class AuditInterceptor extends BaseInterceptor {
  constructor(private auditService: AuditService) {
    super();
    // this.logger and this.config are available right after super()
  }

  async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
    const result = await next();
    if (isHttpContext(ctx)) {
      await this.auditService.log(ctx.getHandler(), (result as Response).status);
    }
    this.logger.info(`Handler ${ctx.type} completed`);
    return result;
  }
}
```

**Drop the decorator and nothing complains at startup.** TypeScript emits `design:paramtypes` only
for a class that carries a class decorator; without it the resolver sees zero dependencies, builds
the interceptor with `new Cls()`, and every injected field is `undefined`. The first request then
dies with `TypeError: undefined is not an object (evaluating 'this.auditService.log')` — at request
time, per request, not at boot. This holds whether or not the class extends `BaseInterceptor`.

The failure modes split cleanly:

| Class | Symptom |
|---|---|
| Undecorated, has constructor params | Boots fine; every injected field `undefined`; `TypeError` at request time |
| Decorated, dependency not in any `providers` | `app.start()` fails loudly with `DependencyResolutionError` |

Register the **dependency** (`AuditService`) in a module's `providers`. The interceptor class itself
never needs to be a provider — `@Service()` on it is only there to force metadata emission.

## Applying interceptors

<!-- typecheck: skip -->
```typescript
// HTTP route-level — works
@Get('/data')
@UseInterceptors(TimingInterceptor)
async getData() { ... }

// HTTP controller-level (all routes)
@UseInterceptors(LoggingInterceptor)
@Controller('/api')
class ApiController extends BaseController { ... }

// WebSocket gateway-level
@UseInterceptors(LoggingInterceptor)
@WebSocketGateway({ path: '/ws' })
class ChatGateway extends BaseWebSocketGateway { ... }

// Queue — CLASS level only, and the class must be a @Controller
@UseInterceptors(LoggingInterceptor)
@Controller('/orders')
class OrderController extends BaseController {
  @Subscribe('orders.created')
  handleOrder(message: Message) { ... }   // intercepted

  @Interval(60_000, { pattern: 'orders.sweep' })
  sweep() { ... }                          // NOT intercepted (pattern is required)
}

// Global (ApplicationOptions) — every transport: HTTP routes, WS message handlers and
// @Subscribe subscribers, wrapping outermost. Scheduled handlers are still not wrapped.
const app = new OneBunApplication(AppModule, {
  interceptors: [LoggingInterceptor],
});
```

Two queue-side traps, both silent:

- **Method-level `@UseInterceptors` on a `@Subscribe` handler never runs** (either decorator order).
  `UseInterceptors` in its method form stores metadata on the *prototype*, while
  `QueueService.registerService` looks the method interceptors up on the *class* — so the lookup
  returns nothing and only the class-level list survives. Put queue interceptors on the class; if
  one subscriber needs different wrapping, give it its own consumer class.
- **`@Subscribe` is only registered from classes listed in a module's `controllers`.** A
  `@Subscribe` on a `@Service()` provider is never wired to the queue at all, so there is nothing
  for an interceptor to wrap.

## Built-in interceptors

| Interceptor | Package | How to pass | Transports |
|---|---|---|---|
| `LoggingInterceptor` | `@onebun/core` | Class — `@UseInterceptors(LoggingInterceptor)` | HTTP, WS, `@Subscribe` |
| `TimeoutInterceptor` | `@onebun/core` | **Instance only** — `new TimeoutInterceptor(5000)`; the class form throws at construction | HTTP, WS, `@Subscribe` |
| `CacheInterceptor` | `@onebun/cache` | Class — `@UseInterceptors(CacheInterceptor)` with `CacheModule` imported | HTTP GET only |

- **LoggingInterceptor** — transport-aware: `Incoming GET /path`, `Incoming WS chat:general`,
  `Incoming Queue orders.created`. Safe as a class: it has no constructor arguments, and
  `this.logger` comes from the ambient init context, not from DI.
- **TimeoutInterceptor** — throws `HttpException(408)` for HTTP, plain `Error` elsewhere. A number
  cannot come from DI, so the class form is rejected at CONSTRUCTION with a message naming the
  mistake. It used to accept it silently: `timeoutMs` was `undefined`, the budget collapsed to
  ~0 ms, and every handler answered `408 "Request timed out after undefinedms"`.
- **CacheInterceptor** — caches 2xx GET responses via `CacheService`, passes through non-GET and
  non-HTTP. Use it directly as a class, with `CacheModule` in the module `imports` so
  `CacheService` is resolvable. It used to ship with **no class decorator**, so
  `@UseInterceptors(CacheInterceptor)` injected `cacheService: undefined` and every GET 500ed;
  importing `CacheModule` did not help, because the missing piece was metadata rather than a
  provider. The workaround of wrapping it in a decorated subclass is no longer needed.

**Writing your own interceptor with constructor dependencies: decorate it.** TypeScript emits
`design:paramtypes` only for a decorated class, and that is exactly the metadata
`resolveInterceptors()` reads. Undecorated means uninjected, and the failure lands at request time
as a 500 rather than at startup:

```typescript
@Service()                       // load-bearing, not decoration
export class AuditInterceptor extends BaseInterceptor {
  constructor(private readonly audit: AuditService) {
    super();
  }
}
```

The same trap applies to guards, filters and middleware. The interceptor itself does not go in
`providers` — the resolver instantiates it; only its dependency must be resolvable.

## Execution order by transport

**HTTP:** middleware → guards[→filters] → [filters→ interceptors → params + validation → handler].
Filters sit ABOVE the interceptor chain and below the middleware chain — an interceptor's try/catch
around `await next()` sees a handler error, a validation error, and can rethrow for the filters to
answer; an error the interceptor itself throws is filtered the same way. A guard rejection is
filtered outside the chain and never reaches an interceptor. Through 0.6.0 the handler was already
filtered by the time `next()` returned, so that catch block was dead code on HTTP only.
**WebSocket:** guards → interceptors → handler
**Queue:** guards → interceptors → handler, for `@Subscribe` subscribers only. `@Cron`, `@Interval`
and `@Timeout` jobs are handed to the scheduler as bound methods, so neither interceptors nor guards
wrap them — a class-level `@UseInterceptors` silently does nothing for those handlers. If a
scheduled job needs the wrapping, use the `pattern` those decorators already require: the scheduler
publishes the job's return value to it, and a `@Subscribe` on that pattern IS intercepted. Keep the
job body trivial and put the logic in the subscriber.

Interceptors wrap in onion order: global outermost → class-level → method-level innermost.

## Key differences from NestJS

- No RxJS — `next` is `() => Promise<unknown>`, not `CallHandler` returning Observable
- Universal `ExecutionContext` discriminated union with type guards (vs NestJS `switchToHttp()`)
- Single `@UseInterceptors()` covers HTTP and WS at class or method level, but on the queue side
  only class level (NestJS has separate patterns)
- `BaseInterceptor` with ambient init context (same pattern as `BaseMiddleware`) — it supplies
  `this.logger`/`this.config`, not constructor DI
- Interceptors are singletons per class per application; NestJS scopes them with `Scope.REQUEST`,
  which has no equivalent here
