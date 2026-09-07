# Universal Interceptors

Interceptors wrap handler execution across **HTTP routes, WebSocket handlers, and Queue
subscribers**. They run after guards but before the handler. Apply with `@UseInterceptors()`.

Three rules decide whether an interceptor works at all. Each one fails **silently** — nothing
throws at startup, the interceptor just misbehaves or never runs:

1. **A class with constructor parameters MUST carry a class decorator** (`@Service()`).
   `extends BaseInterceptor` does NOT buy DI.
2. **One instance per registration site, built at startup** — never keep per-request state on `this`.
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

## Lifetime: one instance per registration site, shared by every request

An interceptor class is instantiated when handlers are **registered** (application startup), once
per registration site, and that instance serves every request or message that reaches the handler.
A global interceptor gets a separate instance for each route it wraps. An interceptor passed as an
**instance** (`new TimeoutInterceptor(5000)`) is not copied at all — the resolver hands it through
untouched, so that one object serves every site the decorator is attached to. Wider sharing, same
rule about `this`.

Measured on a two-route controller with the same interceptor registered both globally and at
controller level: **4 instances constructed at startup, 0 more after any number of requests**; two
hits on `/c/a` were served by one instance (its own counter read 1, then 2) and `/c/b` by a
different one.

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

// Global (ApplicationOptions) — HTTP routes only, never WS or queue
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
| `TimeoutInterceptor` | `@onebun/core` | **Instance only** — `new TimeoutInterceptor(5000)` | HTTP, WS, `@Subscribe` |
| `CacheInterceptor` | `@onebun/cache` | **Not usable as a class** — subclass it, see below | HTTP GET only |

- **LoggingInterceptor** — transport-aware: `Incoming GET /path`, `Incoming WS chat:general`,
  `Incoming Queue orders.created`. Safe as a class: it has no constructor arguments, and
  `this.logger` comes from the ambient init context, not from DI.
- **TimeoutInterceptor** — throws `HttpException(408)` for HTTP, plain `Error` elsewhere. Passing the
  CLASS instead of an instance does not error: `timeoutMs` is injected as `undefined`, the budget
  collapses to ~0 ms, and every handler that awaits real work answers
  `408 "Request timed out after undefinedms"`.
- **CacheInterceptor** — caches 2xx GET responses via `CacheService`, passes through non-GET and
  non-HTTP. It is declared with **no class decorator**, so `@UseInterceptors(CacheInterceptor)`
  injects `cacheService: undefined` and every GET 500s with
  `undefined is not an object (evaluating 'this.cacheService.get')` — importing `CacheModule` does
  not help, because the problem is missing metadata, not a missing provider.

Wrap it in a decorated subclass of your own; that is the whole fix:

```typescript
import { CacheInterceptor, CacheService } from '@onebun/cache';
import { Service } from '@onebun/core';

@Service()
export class AppCacheInterceptor extends CacheInterceptor {
  constructor(cacheService: CacheService) {
    super(cacheService);
  }
}
```

Then apply `@UseInterceptors(AppCacheInterceptor)` and keep `CacheModule` in the module `imports`
so `CacheService` is resolvable. Verified: the raw class returns 500, the subclass returns 200 and
caches.

## Execution order by transport

**HTTP:** middleware → guards[→filters] → interceptors[→filters] → handler[→filters]. Filters sit
INSIDE the interceptor chain, not after it — an interceptor's try/catch around `await next()` never
sees a handler error, because the handler is already filtered by then; an error the interceptor
itself throws is filtered.
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
- Interceptors are singletons per registration site; NestJS scopes them with `Scope.REQUEST`, which
  has no equivalent here
