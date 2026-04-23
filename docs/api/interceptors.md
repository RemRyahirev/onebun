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
2. Class implementing `Interceptor` interface (class-based, no DI)
3. Class extending `BaseInterceptor` (class-based with DI — provides `this.logger` and `this.config`)

**Applying interceptors:**
- `@UseInterceptors(MyInterceptor)` on a controller/gateway class — applies to all handlers
- `@UseInterceptors(MyInterceptor)` on a handler method — applies to that handler only
- Global via `ApplicationOptions.interceptors` — applies to all handlers in the application
- All three can be combined; onion wrapping order: global (outermost) → controller/gateway → handler (innermost)

**Interceptors work across all transports:**
- HTTP controllers (`@Controller`)
- WebSocket gateways (`@WebSocketGateway`)
- Queue handlers (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`)

**Built-in interceptors:**
- `LoggingInterceptor` — logs with transport-aware labels: `Incoming METHOD /path` for HTTP, `Incoming WS pattern` for WebSocket, `Incoming Queue pattern` for Queue
- `TimeoutInterceptor` — pass as **instance**: `new TimeoutInterceptor(5000)` (takes `timeoutMs` constructor arg); throws `HttpException(408)` for HTTP, generic `Error` for other transports
- `CacheInterceptor` — from `@onebun/cache`, caches GET 2xx HTTP responses via `CacheService`; non-HTTP transports pass through; requires `CacheModule` import in the module tree

**ExecutionContext — discriminated union:**
```typescript
type ExecutionContext = HttpExecutionContext | WsExecutionContext | MessageExecutionContext;
```
Use `isHttpContext(ctx)`, `isWsContext(ctx)`, `isQueueContext(ctx)` for type-safe narrowing.

**Key differences from NestJS:** No RxJS — uses `next: () => Promise<unknown>` instead of Observable.

**Execution order:**
- HTTP: middleware → guards → interceptors(handler) → exception filters → response
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

### With DI

Extend `BaseInterceptor` to get constructor injection, `this.logger`, and `this.config` — just like controllers and services:

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
import { WebSocketGateway, SubscribeMessage, UseInterceptors, LoggingInterceptor } from '@onebun/core';

@UseInterceptors(LoggingInterceptor)
@WebSocketGateway({ path: '/ws' })
class ChatGateway extends BaseWebSocketGateway {
  @SubscribeMessage('chat:send')
  handleMessage(client: WsClientData, data: unknown) {
    return { event: 'chat:received', data };
  }
}
```

### Queue handler

Applies to queue subscribers, cron jobs, intervals, and timeouts:

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

Pass interceptors in `ApplicationOptions.interceptors`. They wrap every handler in the application:

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

From `@onebun/cache` — caches successful (2xx) HTTP GET responses via `CacheService`. Non-GET requests and non-HTTP transports pass through without caching. Requires `CacheModule` to be imported so that `CacheService` is available for DI:

```typescript
import { CacheInterceptor } from '@onebun/cache';
import { CacheModule } from '@onebun/cache';

@Module({
  imports: [CacheModule],
  controllers: [DataController],
})
class DataModule {}

@UseInterceptors(CacheInterceptor)
@Controller('/api/data')
class DataController extends BaseController {
  @Get('/')
  getData() { return { items: [1, 2, 3] }; }
}
```

## Execution Order

Each transport has its own pipeline. Interceptors sit between guards and the handler in all three:

**HTTP:**

```
Request → [Global Middleware] → [Module Middleware] → [Controller Middleware] → [Route Middleware]
       → [Controller Guards] → [Route Guards]
       → [Global Interceptors → [Controller Interceptors → [Route Interceptors → Handler]]]
       → [Exception Filters on error]
       → Response
```

**WebSocket:**

```
Message → [Guards] → [Global Interceptors → [Gateway Interceptors → [Handler Interceptors → Handler]]]
```

**Queue:**

```
Message → [Guards] → [Global Interceptors → [Controller Interceptors → [Handler Interceptors → Handler]]]
```

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
