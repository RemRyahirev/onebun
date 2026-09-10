---
description: Interceptors — wrap handler execution across HTTP, WebSocket, and Queue transports for logging, caching, timeouts, and response transformation.
---

<llm-only>

## Quick Reference for AI

**Interceptor imports:**
```typescript
import {
  Interceptor,
  ExecutionContext,
  isHttpContext,
  isWsContext,
  isQueueContext,
  createInterceptor,
  UseInterceptors,
  BaseInterceptor,
  LoggingInterceptor,
  TimeoutInterceptor,
} from '@onebun/core';
```
```typescript
import { CacheInterceptor } from '@onebun/cache';
```

**Three ways to create an interceptor:**
1. `createInterceptor(fn)` — inline function-based interceptor (simplest)
2. Class implementing `Interceptor` — constructor DI works, provided the class carries a **class** decorator (`@Service()` is the conventional one; a method decorator does not count)
3. Class extending `BaseInterceptor` — same DI, plus `this.logger` and `this.config`

**Interceptor lifetime:** an interceptor class is instantiated when handlers are REGISTERED, once per class per application, and that one instance serves every route, gateway handler and subscription that names it. Through 0.6.0 it was once per registration SITE, so a class covering three routes was three instances and any state it kept was silently per route. Never keep per-request state on `this` — guards are the opposite (per-invocation) and that habit does not carry over

**Applying interceptors:**
- `@UseInterceptors(MyInterceptor)` on a controller/gateway class — applies to all handlers
- `@UseInterceptors(MyInterceptor)` on a handler method — applies to that handler only, on HTTP routes and WS handlers; on a `@Subscribe` handler the method form is silently dropped, put queue interceptors on the class
- Global via `ApplicationOptions.interceptors` — every transport: HTTP routes, WebSocket message handlers and `@Subscribe` queue subscribers. Merged outermost, ahead of gateway/class-level and handler-level lists. Through 0.6.0 it was HTTP only, and the other two silently ran without it
- All three can be combined; onion wrapping order: global (outermost) → controller/gateway → handler (innermost)

**Interceptors work across all transports:**
- HTTP controllers (`@Controller`)
- WebSocket gateways (`@WebSocketGateway`)
- Queue subscribers (`@Subscribe`) only — `@Cron`/`@Interval`/`@Timeout` handlers are NOT intercepted

**Built-in interceptors:**
- `LoggingInterceptor` — logs with transport-aware labels: `Incoming METHOD /path` for HTTP, `Incoming WS pattern` for WebSocket, `Incoming Queue pattern` for Queue
- `TimeoutInterceptor` — pass as **instance**: `new TimeoutInterceptor(5000)` (takes `timeoutMs` constructor arg); throws `HttpException(408)` for HTTP, generic `Error` for other transports
- `CacheInterceptor` — from `@onebun/cache`, caches GET 2xx HTTP responses via `CacheService`; non-HTTP transports pass through. Use it directly: `@UseInterceptors(CacheInterceptor)` with `CacheModule` imported. It carries `@Service()`, which is what makes TypeScript emit `design:paramtypes` and lets the resolver inject `CacheService` — an undecorated class with constructor dependencies is built with zero arguments and fails at request time

**ExecutionContext — discriminated union:**
```typescript
type ExecutionContext = HttpExecutionContext | WsExecutionContext | MessageExecutionContext;
```
Use `isHttpContext(ctx)`, `isWsContext(ctx)`, `isQueueContext(ctx)` for type-safe narrowing.

**Key differences from NestJS:** No RxJS — uses `next: () => Promise<unknown>` instead of Observable.

**Execution order:**
- HTTP: middleware → guards[→filters] → [filters→ interceptors → handler] → response. Filters sit ABOVE the interceptor chain and below the middleware chain: an interceptor wrapping `await next()` in a try/catch sees a handler error, an error from parameter extraction or schema validation, and it can rethrow to let the filters answer. An error the interceptor itself throws is filtered the same way. Guards are outside the chain, so a guard rejection is filtered without reaching an interceptor. Through 0.6.0 the handler was already filtered by the time `next()` returned, so that catch block was dead code on HTTP — and only on HTTP, since queue and WebSocket have no filter layer.
- WS: guards → interceptors(handler)
- Queue: guards → interceptors(handler)

</llm-only>

# Interceptors

Interceptors wrap handler execution, letting you run logic **before** and **after** the handler. Common use cases include logging, caching, timeouts, and response transformation. Unlike middleware (which only sees HTTP requests), interceptors work across all transports — HTTP controllers, WebSocket gateways, and Queue handlers — and can control when and whether the handler runs and modify the result it returns.

## Interface

```typescript
import type { Interceptor, ExecutionContext } from '@onebun/core';

interface Interceptor {
  intercept(
    context: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown>;
}
```

`ExecutionContext` is a discriminated union across all three transports:

```typescript
type ExecutionContext = HttpExecutionContext | WsExecutionContext | MessageExecutionContext;
```

Each variant carries a `type` discriminant:

| Transport | `type` | Key methods |
|-----------|--------|-------------|
| HTTP | `'http'` | `getRequest()`, `getHandler()`, `getController()` |
| WebSocket | `'ws'` | `getClient()`, `getSocket()`, `getData()`, `getHandler()` |
| Queue | `'queue'` | `getMessage()`, `getMetadata()`, `getPattern()`, `getHandler()` |

Use the type guard functions for safe narrowing:

```typescript
import { isHttpContext, isWsContext, isQueueContext } from '@onebun/core';

if (isHttpContext(ctx)) {
  // ctx is HttpExecutionContext — access ctx.getRequest(), etc.
}
if (isWsContext(ctx)) {
  // ctx is WsExecutionContext — access ctx.getClient(), etc.
}
if (isQueueContext(ctx)) {
  // ctx is MessageExecutionContext — access ctx.getMessage(), etc.
}
```

The `next()` function calls the handler (or the next interceptor in the chain). Calling `await next()` executes the handler and returns its result. You can run code before the call, after the call, or skip the call entirely.

## Creating Interceptors

### Function-based

The simplest way — use the `createInterceptor` factory:

```typescript
import { createInterceptor } from '@onebun/core';

const TimingInterceptor = createInterceptor(async (ctx, next) => {
  const start = performance.now();
  const result = await next();
  const duration = Math.round(performance.now() - start);

  if (isHttpContext(ctx)) {
    const response = result as Response;
    response.headers.set('X-Response-Time', `${duration}ms`);
  }

  return result;
});
```

### Class-based

Implement the `Interceptor` interface directly:

```typescript
import type { Interceptor, ExecutionContext } from '@onebun/core';

class AddHeaderInterceptor implements Interceptor {
  async intercept(
    ctx: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const result = await next();

    if (isHttpContext(ctx)) {
      const response = result as Response;
      response.headers.set('X-Powered-By', 'OneBun');
    }

    return result;
  }
}
```

An interceptor is instantiated when handlers are registered, never per request: **one instance per
class per application**, shared by every route, WebSocket handler and queue subscription that names
it — so a counter, a limiter or a cache on `this` counts what you expect it to. Passing an
*instance* instead of a class opts out: the caller owns it, and two instances of the same class stay
two. Never hold per-request state on `this` — keep it in locals inside `intercept()`. Guards are the
opposite: passing the guard CLASS constructs the guard per invocation, so state on `this` is safe
there.

Through 0.6.0 the instance was per registration site: a class covering three routes was constructed
three times, each route permanently bound to its own copy, and a global interceptor got one instance
per route in the application.

### With DI

Constructor injection works for any interceptor class that carries a class decorator; extend
`BaseInterceptor` to additionally get `this.logger` and `this.config`:

```typescript
import type { ExecutionContext } from '@onebun/core';
import { BaseInterceptor, Service, isHttpContext } from '@onebun/core';

@Service()
class AuditInterceptor extends BaseInterceptor {
  constructor(private auditService: AuditService) {
    super();
  }

  async intercept(
    ctx: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const result = await next();

    if (isHttpContext(ctx)) {
      await this.auditService.log(ctx.getHandler(), (result as Response).status);
      this.logger.info(`Audited ${ctx.getHandler()}`);
    }

    return result;
  }
}
```

::: danger The interceptor class must carry a CLASS decorator
DI is what `@Service()` buys here, not `BaseInterceptor`: the injector reads `design:paramtypes`, and
TypeScript emits that metadata only when the class itself is decorated — a class decorator, or a
decorator on a **constructor parameter** such as `@Inject(TOKEN)`. A decorator on the `intercept`
method does not count, because the metadata is emitted for the member it sits on.

Use `@Service()`. The constructor-parameter form works, but it makes DI depend on a token you might
later remove, and the failure it leaves behind is the silent one described below.

- **Undecorated class with constructor parameters** — every parameter is `undefined` at run time and
  nothing fails at startup. This is true whether or not the class extends `BaseInterceptor`;
  extending it supplies `this.logger` and `this.config`, never the constructor arguments.
- **Decorated class whose dependency cannot be resolved** — `app.start()` fails loudly with
  `DependencyResolutionError`. Register the DEPENDENCY in a module's `providers`.
:::

## Applying Interceptors

### Route-level

```typescript
import { Controller, Get, UseInterceptors } from '@onebun/core';

@Controller('/api')
class ApiController extends BaseController {
  @UseInterceptors(TimingInterceptor)
  @Get('/data')
  getData() {
    return { items: [1, 2, 3] };
  }
}
```

### Controller-level

Applies to every route in the controller:

```typescript
import { Controller, Get, UseInterceptors, LoggingInterceptor } from '@onebun/core';

@UseInterceptors(LoggingInterceptor)
@Controller('/api/users')
class UserController extends BaseController {
  @Get('/')
  list() { return []; }

  @Get('/:id')
  getById(@Param('id') id: string) { return { id }; }
}
```

### WebSocket gateway

Applies to every message handler in the gateway:

```typescript
import {
  WebSocketGateway,
  BaseWebSocketGateway,
  OnMessage,
  UseInterceptors,
  LoggingInterceptor,
  type WsClientData,
} from '@onebun/core';

@UseInterceptors(LoggingInterceptor)
@WebSocketGateway({ path: '/ws' })
class ChatGateway extends BaseWebSocketGateway {
  @OnMessage('chat:send')
  handleMessage(client: WsClientData, data: unknown) {
    return { event: 'chat:received', data };
  }
}
```

### Queue handler

A class-level `@UseInterceptors` wraps the queue subscribers (`@Subscribe`) declared on that class.
Put queue interceptors on the class: the METHOD form does nothing on a `@Subscribe` handler, because
the method decorator writes its metadata to the prototype while queue registration looks it up on the
class — nothing errors, the interceptor simply never runs. If one subscriber needs different
wrapping, give it its own consumer class.

Scheduled handlers — `@Cron`, `@Interval`, `@Timeout` — are **not** wrapped either: the scheduler calls
the bound method directly. If such a job publishes to a `pattern`, the interceptors of the class holding
a `@Subscribe` on that pattern still run, once per delivered message.

```typescript
import { Controller, Subscribe, UseInterceptors, LoggingInterceptor } from '@onebun/core';

@UseInterceptors(LoggingInterceptor)
@Controller('/orders')
class OrderController extends BaseController {
  @Subscribe('order.created')
  async handleOrderCreated(message: Message) {
    await this.processOrder(message.data);
  }
}
```

### Global

Pass interceptors in `ApplicationOptions.interceptors`. They wrap every **HTTP route**, every
**WebSocket message handler** and every **`@Subscribe` queue subscriber** in the application, and
they wrap outermost — ahead of a gateway-level or class-level `@UseInterceptors`, which is the same
order HTTP routes use. Through 0.6.0 the list was merged at HTTP route registration only, so a
global logging or metrics interceptor covered HTTP and silently skipped the other two transports.

Scheduled handlers (`@Cron`, `@Interval`, `@Timeout`) are still not wrapped — see the pipeline
table below.

```typescript
import { OneBunApplication, LoggingInterceptor } from '@onebun/core';

const app = new OneBunApplication(AppModule, {
  interceptors: [LoggingInterceptor],
});
```

### Combined

Controller and route interceptors can be combined. Wrapping follows onion order — global outermost, route innermost:

```typescript
@UseInterceptors(LoggingInterceptor)            // wraps all routes in this controller
@Controller('/api')
class ApiController extends BaseController {
  @Get('/fast')
  fast() { return { ok: true }; }

  @UseInterceptors(new TimeoutInterceptor(5000)) // additionally wraps this route only
  @Get('/slow')
  slow() { return { ok: true }; }
}
```

## Cross-Transport Usage

Interceptors receive an `ExecutionContext` that may represent any transport. Use the type guard functions for transport-specific logic while keeping a single interceptor class:

```typescript
import {
  BaseInterceptor,
  isHttpContext,
  isWsContext,
  isQueueContext,
} from '@onebun/core';
import type { ExecutionContext } from '@onebun/core';

class MetricsInterceptor extends BaseInterceptor {
  async intercept(
    ctx: ExecutionContext,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const start = performance.now();

    let label: string;
    if (isHttpContext(ctx)) {
      const req = ctx.getRequest();
      label = `HTTP ${req.method} ${new URL(req.url).pathname}`;
    } else if (isWsContext(ctx)) {
      const handler = ctx.getHandler();
      label = `WS ${handler.pattern || handler.handler}`;
    } else {
      label = `Queue ${ctx.getPattern()}`;
    }

    try {
      const result = await next();
      const duration = Math.round(performance.now() - start);
      this.logger.info(`${label} completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      this.logger.error(`${label} failed in ${duration}ms`);
      throw error;
    }
  }
}
```

This single interceptor can be applied to HTTP controllers, WebSocket gateways, and Queue handlers alike:

```typescript
@UseInterceptors(MetricsInterceptor)
@Controller('/api/users')
class UserController extends BaseController { /* ... */ }

@UseInterceptors(MetricsInterceptor)
@WebSocketGateway({ path: '/ws' })
class ChatGateway extends BaseWebSocketGateway { /* ... */ }
```

## Built-in Interceptors

### LoggingInterceptor

Logs incoming requests and messages with timing across all transports. Produces transport-aware labels:

- **HTTP:** `Incoming GET /api/users` / `Completed GET /api/users 200 12ms`
- **WebSocket:** `Incoming WS chat:send` / `Completed WS chat:send 3ms`
- **Queue:** `Incoming Queue order.created` / `Completed Queue order.created 5ms`

On error, logs `Failed <label> <duration>ms` and re-throws.

```typescript
import { LoggingInterceptor, UseInterceptors } from '@onebun/core';

@UseInterceptors(LoggingInterceptor)
@Controller('/api')
class ApiController extends BaseController { /* ... */ }
```

### TimeoutInterceptor

Aborts handler execution after the specified number of milliseconds. For HTTP, throws `HttpException(408)`. For WebSocket and Queue transports, throws a generic `Error`. Pass as an **instance** because it takes a constructor argument:

<!-- typecheck: skip -->
```typescript
import { TimeoutInterceptor, UseInterceptors } from '@onebun/core';

@UseInterceptors(new TimeoutInterceptor(5000))
@Get('/slow')
async slowRoute() { /* ... */ }
```

::: info Route timeout vs. interceptor timeout
The route-level `timeout` option (in `@Get('/path', { timeout: 10 })`) sets Bun's idle connection timeout in **seconds**. `TimeoutInterceptor` limits total handler **processing time** in **milliseconds** — they serve different purposes and can be used together.
:::

### CacheInterceptor

From `@onebun/cache` — caches successful (2xx) HTTP GET responses via `CacheService`. Non-GET requests and non-HTTP transports pass through without caching. Requires `CacheModule` to be imported so that `CacheService` is available for DI.

Use it directly — `CacheInterceptor` carries `@Service()`, so the resolver injects `CacheService`:

```typescript
import { CacheInterceptor, CacheModule } from '@onebun/cache';

@UseInterceptors(CacheInterceptor)
@Controller('/api/data')
class DataController extends BaseController {
  @Get('/')
  getData() { return { items: [1, 2, 3] }; }
}

@Module({
  imports: [CacheModule],
  controllers: [DataController],
})
class DataModule {}
```

The interceptor does not belong in `providers` — the resolver instantiates it; only its
dependency has to be resolvable, which is what `CacheModule` provides.

::: warning Writing your own interceptor with constructor dependencies
Decorate it. TypeScript emits `design:paramtypes` only for a **decorated** class, and that is the
metadata the resolver reads to find constructor dependencies. Without a decorator the class is
built with zero arguments, the dependency lands `undefined`, and the failure arrives at request
time as a 500 rather than at startup.

```typescript
@Service()                       // ← load-bearing, not decoration
class AuditInterceptor extends BaseInterceptor {
  constructor(private readonly audit: AuditService) {
    super();
  }
}
```

This applies to guards, filters and middleware alike. `CacheInterceptor` shipped without it and
answered 500 on every GET it wrapped.
:::

## Execution Order

Each transport has its own pipeline. Interceptors sit between guards and the handler in all three:

**HTTP:**

```
Request → [Global Middleware] → [Module Middleware] → [Controller Middleware] → [Route Middleware]
       → [Controller Guards] → [Route Guards]        (a guard error is filtered here)
       → [Exception Filters on error
            → [Global Interceptors → [Controller Interceptors → [Route Interceptors
                 → params + validation → Handler]]]]
       → Response
```

The filter boundary wraps the interceptor chain, so an interceptor sees a handler error and can
rethrow it for the filters to answer. It sits below the middleware chain because middleware sets
headers after `await next()` — CORS and security headers are on error responses too.

**WebSocket:**

```
Message → [Guards] → [Global Interceptors → [Gateway Interceptors → [Handler Interceptors → Handler]]]
```

**Queue:**

```
Message → [Guards] → [Global Interceptors → [Controller Interceptors → Handler]]
```

All three transports read `ApplicationOptions.interceptors`, and it wraps outermost on each. Queue
has no handler level, because a method-level `@UseInterceptors` never reaches a `@Subscribe`
handler.

Interceptors use **onion wrapping**: the first interceptor in the list (global) wraps outermost and sees the result last. The innermost interceptor (handler-level) runs closest to the handler.

## Short-circuiting

An interceptor can return a result **without** calling `next()`, skipping the handler and all inner interceptors:

```typescript
const MaintenanceInterceptor = createInterceptor(async (ctx, next) => {
  if (isMaintenanceMode()) {
    if (isHttpContext(ctx)) {
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return { error: 'Service temporarily unavailable' };
  }
  return await next();
});
```

## Response Transformation

An interceptor can modify the result returned by `next()`:

```typescript
const WrapResponseInterceptor = createInterceptor(async (ctx, next) => {
  const result = await next();

  if (isHttpContext(ctx) && result instanceof Response) {
    const body = await result.json();
    return new Response(
      JSON.stringify({ success: true, data: body }),
      { status: result.status, headers: result.headers },
    );
  }

  return result;
});
```
