---
description: OneBunApplication class, single-service and multi-service modes. Bootstrap options, graceful shutdown, metrics and tracing configuration.
---

<llm-only>

## Quick Reference for AI

**Minimal App Bootstrap**:
```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, { envSchema });

app
  .start()
  .then(() => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.info('Application started');
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error('Failed to start:', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
```

**Port/Host Resolution Priority**:
1. Explicit option passed to constructor
2. Environment variable (PORT / HOST)
3. Default value (3000 / '0.0.0.0')

**With Full Options**:
```typescript
const app = new OneBunApplication(AppModule, {
  port: 3000,          // overrides PORT env var
  host: '0.0.0.0',     // overrides HOST env var
  basePath: '/api/v1',
  envSchema,  // from @onebun/envs
  metrics: { enabled: true, path: '/metrics', prefix: 'myapp_' },
  tracing: { enabled: true, serviceName: 'my-service' },
  loggerOptions: { minLevel: 'info', format: 'json' },
  gracefulShutdown: true,  // default
  // Security shortcuts (auto-add built-in middleware):
  cors: { origin: 'https://my-frontend.com', credentials: true },
  rateLimit: { windowMs: 60_000, max: 100 },
  security: true,
  // Exception filters (applied globally to all routes):
  filters: [myGlobalExceptionFilter],
});
```

**Guards, Interceptors, and Filters**:
- Use `@UseGuards(SomeGuard)` on a controller or route method to decide whether a request reaches the handler. The built-in `AuthGuard` and `RolesGuard` are primitives, not an authorization scheme: one checks that an `Authorization: Bearer` header is present, the other compares a list of roles it was handed — see [Guards](./guards.md) for what you must hand it
- Use `@UseInterceptors(LoggingInterceptor)` to wrap handler execution (logging, caching, timeouts)
- Use `@UseFilters(myFilter)` on a controller or route method to add error handling
- All three decorators merge with parent-level (controller + route, global + controller + route)
- See [Guards](./guards.md), [Interceptors](./interceptors.md), and [Exception Filters](./exception-filters.md) for full docs

**Security Middleware shorthand**:
```typescript
// CORS + rate limiting + security headers in one line each:
cors: { origin: '*' }           // or: cors: true
rateLimit: { max: 100 }         // or: rateLimit: true
security: { xFrameOptions: 'DENY' }  // or: security: true
trustProxy: true                // only behind a proxy — see Security Middleware
```
Auto-ordering: CorsMiddleware → RateLimitMiddleware → [user middleware] → SecurityHeadersMiddleware

Rate limiting keys on the transport peer address, not on `x-forwarded-for`. Set
`trustProxy: true` when the application sits behind a load balancer — see
[Security Middleware](./security.md#client-identification-and-trustproxy).

**Static files (SPA on same host)**:
```typescript
const app = new OneBunApplication(AppModule, {
  static: { root: './dist', fallbackFile: 'index.html' },
});
await app.start();
// API at /api, docs at /docs; all other GET requests serve from ./dist or index.html for SPA routing
```

**Important Methods**:
- `app.start()` - starts HTTP server. When it rejects it has ALREADY run the `stop()` sequence over what the boot acquired (listener, queue connection, metrics sampler, destroy hooks) and rethrows the error it caught — see [When `start()` fails](#when-start-fails) for what that error is: the catch has nothing to clean up, a later `stop()` runs none of that again, and the process ends by itself — so exit non-zero from the catch. A `loggerLayer`, `tracing.spanProcessors` or `metrics.registry` you passed in is left open for the next attempt; a `stop()` after the failure closes them, as every `stop()` does. To retry, build a new `OneBunApplication` per attempt, or call `start()` again on the same instance
- `app.stop()` - graceful shutdown (calls lifecycle hooks)
- `app.getService(ServiceClass)` - get service instance by class
- `app.getLogger({ className: 'X' })` - get logger instance
- `app.getConfig()` - get typed config service
- `app.getConfigValue('path.to.config')` - read config value (fully typed with module augmentation)
- `app.getHttpUrl()` - get listening URL

**Lifecycle Hooks** (implement via `implements OnModuleInit`, etc.):
- `onModuleInit()` - after service/controller created (sequential, in dependency order; called for all providers including standalone services; works across the entire module import tree)
- `onApplicationInit()` - after all modules, before HTTP starts
- `beforeApplicationDestroy(signal?)` - FIRST destroy hook, but NOT the start of shutdown: it runs after new requests are refused with 503, after the in-flight drain, and after the HTTP listener is closed. A request issued from inside it is refused (connection refused, not 503)
- `onModuleDestroy()` - after `beforeApplicationDestroy`, WebSocket close, queue stop and trace flush; before `onApplicationDestroy`
- `onApplicationDestroy(signal?)` - last destroy hook; only the DI scope disposal and the logger flush follow it
- in multi-service mode `signal` is always `undefined` in both hooks — the parent owns the signal handler and stops each child with a bare `stop()`

**Multi-Service Mode** — pass `{ services: ... }` to `OneBunApplication` constructor for running multiple services in one process. Each sub-application owns its DI scope: one global service instance per sub-application, and dynamic-module options are captured per application at import time.

</llm-only>

# Core Package API

Package: `@onebun/core`

## OneBunApplication

Main application class that bootstraps and runs the HTTP server.

### Constructor

<!-- typecheck: skip -->
```typescript
// Single-service mode
new OneBunApplication(
  moduleClass: new (...args: unknown[]) => object,
  options?: Partial<ApplicationOptions>
)

// Multi-service mode
new OneBunApplication(
  options: MultiServiceApplicationOptions
)
```

### ApplicationOptions

```typescript
interface ApplicationOptions {
  /** Application name for metrics/tracing labels */
  name?: string;

  /** Port to listen on
   * Priority: explicit option > PORT env variable > default (3000)
   */
  port?: number;

  /** Host to listen on
   * Priority: explicit option > HOST env variable > default ('0.0.0.0')
   */
  host?: string;

  /** Maximum idle time (seconds) before the server closes a connection.
   * A connection is idle when no data is sent or received.
   * Set to 0 to disable. Default: 120.
   */
  idleTimeout?: number;

  /** Maximum request body size in bytes.
   * Enforced by Bun on the request headers — before routing, before middleware — so an
   * oversized body is refused with 413 and never read into the process.
   * Absent leaves Bun's default of 128 MiB (134217728).
   */
  maxRequestBodySize?: number;

  /** Base path prefix for all routes (e.g., '/api/v1') */
  basePath?: string;

  /** Route prefix to prepend to all routes (typically service name) */
  routePrefix?: string;

  /** Enable development mode (default: NODE_ENV !== 'production') */
  development?: boolean;

  /** Logger configuration options.
   * Provides a declarative way to configure logging.
   * Priority: loggerLayer > loggerOptions > LOG_LEVEL/LOG_FORMAT env > NODE_ENV defaults
   */
  loggerOptions?: LoggerOptions;

  /** Custom logger layer (advanced, takes precedence over loggerOptions) */
  loggerLayer?: Layer.Layer<Logger>;

  /** Environment configuration schema */
  envSchema?: TypedEnvSchema;

  /** Environment loading options */
  envOptions?: {
    envFilePath?: string;
    loadDotEnv?: boolean;
    envOverridesDotEnv?: boolean;
    strict?: boolean;
    defaultArraySeparator?: string;
    valueOverrides?: Record<string, string | number | boolean>;
  };

  /** Metrics configuration */
  metrics?: MetricsOptions;

  /** Tracing configuration */
  tracing?: TracingOptions;

  /** WebSocket configuration */
  websocket?: WebSocketApplicationOptions;

  /** Static file serving: serve files from a directory for requests not matched by API routes */
  static?: StaticApplicationOptions;

  /**
   * Application-wide middleware class constructors applied to every route
   * before module-level, controller-level and route-level middleware.
   * Classes must extend BaseMiddleware. DI is fully supported.
   * Execution order: global → module → controller → route → handler.
   * See Controllers API — Middleware for details.
   */
  middleware?: MiddlewareClass[];

  /** Enable graceful shutdown on SIGTERM/SIGINT (default: true) */
  gracefulShutdown?: boolean;

  /**
   * Deadline for the whole shutdown sequence in ms (default: 15000).
   * The first half bounds the in-flight request drain — connections still open when it
   * expires are force-closed and counted in a warning — and the rest bounds the destroy
   * hooks. On the signal path a shutdown that hits the deadline exits with code 1.
   */
  shutdownTimeout?: number;

  /** Global exception filters. Route/controller filters take priority. */
  filters?: ExceptionFilter[];

  /**
   * CORS shorthand — auto-prepends CorsMiddleware.
   * Pass `true` for permissive defaults, or a CorsOptions object for custom config.
   * See Security Middleware for details.
   */
  cors?: CorsOptions | true;

  /**
   * Rate limiting shorthand — auto-prepends RateLimitMiddleware.
   * Pass `true` for defaults (100 req / 60s, in-memory), or a RateLimitOptions object.
   * See Security Middleware for details.
   */
  rateLimit?: RateLimitOptions | true;

  /**
   * Whether proxy headers (x-forwarded-for, cf-connecting-ip, x-real-ip) sent by the
   * caller may override the transport peer when identifying the client.
   * Off by default — those headers are attacker-controlled on a direct connection.
   * Enable only when every request arrives through a proxy that overwrites them.
   * Consumed by the default rate-limit key and the remoteAddr span field.
   * @default false
   */
  trustProxy?: boolean;

  /**
   * Security headers shorthand — auto-appends SecurityHeadersMiddleware.
   * Pass `true` for all defaults, or a SecurityHeadersOptions object.
   * See Security Middleware for details.
   */
  security?: SecurityHeadersOptions | true;
}
```

#### Bounding the request body {#max-request-body-size}

`maxRequestBodySize` is the only place an application can lower the transport's body limit. Bun
refuses an oversized request on its headers — before routing, before middleware, before any
framework code runs — and answers `413 Request Entity Too Large`:

```typescript
const app = new OneBunApplication(AppModule, {
  maxRequestBodySize: 1024 * 1024, // 1 MiB; absent leaves Bun's 128 MiB default
});
```

Two things it is not interchangeable with:

- **A `content-length` check in middleware** runs after the transport has accepted the body, so it
  bounds what reaches your domain layer rather than what reaches the process — and it trusts a
  header the caller writes, which makes it a guard against accident, not against an attacker.
- **`rateLimit`** bounds how many requests arrive. One 100 MB upload is one request.

The refusal happens for unmatched paths too, since it precedes routing, and neither handlers nor
middleware are invoked for a request that exceeds the limit.

#### StaticApplicationOptions

When `static` is set, the same HTTP server serves API routes (and `/docs`, `/metrics`, WebSocket) as usual; any request that does not match those routes is served from a filesystem directory.

```typescript
interface StaticApplicationOptions {
  /** Filesystem path to the directory to serve (static root). Absolute or relative to cwd. */
  root: string;

  /**
   * URL path prefix under which static files are served.
   * Omit or '/' = serve static for all paths not matched by API.
   * Example: '/app' = only paths starting with /app are served (prefix stripped when resolving file).
   */
  pathPrefix?: string;

  /**
   * Fallback file name (e.g. 'index.html') for SPA-style client-side routing.
   * When the requested file is not found, this file under static root is returned.
   */
  fallbackFile?: string;

  /**
   * TTL in ms for caching file existence checks. Use 0 to disable. Default: 60000.
   * Uses @onebun/cache CacheService when available, otherwise in-memory cache.
   */
  fileExistenceCacheTtlMs?: number;
}
```

**Example: SPA on same host**

```typescript
const app = new OneBunApplication(AppModule, {
  static: {
    root: './dist',
    fallbackFile: 'index.html',
  },
});
await app.start();
// GET /api/*, /docs, /metrics, /ws handled by framework; GET /, /dashboard, etc. serve dist/ or index.html
```

**Static responses go through the global middleware chain.** A served file carries the same
`security` headers a controller route does — which is the reason to serve a SPA from the API origin
at all — and it consumes `rateLimit` budget like any other request. Size `max` for the number of
assets a page pulls, or put the assets behind a CDN. Through 0.6.0 static responses and unmatched
paths bypassed the chain entirely: no security headers, and rate limiting bounded only the paths
that happened to match a controller.

**Example: static under a path prefix**

```typescript
const app = new OneBunApplication(AppModule, {
  static: {
    root: './public',
    pathPrefix: '/assets',
  },
});
// Only GET /assets/* are served from ./public; e.g. /assets/logo.png -> public/logo.png
```

### Methods

```typescript
class OneBunApplication {
  /**
   * Start the HTTP server.
   * Rejects with the error that stopped the boot, after releasing everything the boot had
   * acquired — the same sequence as `stop()`. A failure in `onModuleInit` arrives wrapped by
   * Effect (`FiberFailure`, message intact). A retry may call it again on the same instance.
   */
  async start(): Promise<void>;

  /**
   * Drain in-flight requests, then stop the server and run the destroy hooks.
   * Idempotent: a second call awaits the first shutdown instead of repeating it.
   * Always resolves within `shutdownTimeout`.
   */
  async stop(options?: { 
    /** @deprecated Ignored — an application releases no shared Redis hold. */
    closeSharedRedis?: boolean; 
    signal?: string;  // e.g., 'SIGTERM', 'SIGINT'
  }): Promise<void>;

  /** Enable graceful shutdown signal handlers (SIGTERM, SIGINT). Registers at most once. */
  enableGracefulShutdown(): void;

  /** Get configuration service with full type inference via module augmentation */
  getConfig(): IConfig<OneBunAppConfig>;

  /** Get configuration value by path with full type inference via module augmentation */
  getConfigValue<P extends DeepPaths<OneBunAppConfig>>(path: P): DeepValue<OneBunAppConfig, P>;
  getConfigValue<T = unknown>(path: string): T;

  /** Get logger instance */
  getLogger(context?: Record<string, unknown>): SyncLogger;

  /** Get HTTP URL where application is listening */
  getHttpUrl(): string;

  /** Get root module layer */
  getLayer(selections?: ServiceSelection[]): Layer.Layer<never, never, unknown>;

  /** Get a service instance by class from the module container, optionally naming a registration */
  getService<T>(serviceClass: new (...args: unknown[]) => T, token?: symbol | string): T;

  /** Get a child OneBunApplication instance by service name (multi-service mode only) */
  getApplication(name: string): OneBunApplication | undefined;

  /** Get URL for a service — local if running, external if configured (multi-service mode only) */
  getServiceUrl(name: string): string;

  /** Get all running service names (multi-service mode only) */
  getRunningServices(): string[];

  /** Check if a specific service is running (multi-service mode only) */
  isServiceRunning(name: string): boolean;
}
```

### Usage Example

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  basePath: '/api/v1',
  envSchema,
  metrics: {
    enabled: true,
    path: '/metrics',
    prefix: 'myapp_',
  },
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    samplingRate: 1.0,
  },
});

app
  .start()
  .then(() => {
    // Access configuration - fully typed with module augmentation
    const port = app.getConfigValue('server.port');  // number (auto-inferred)
    const config = app.getConfig();
    const host = config.get('server.host');          // string (auto-inferred)

    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.info('Application started', { port, host });
  })
  .catch((error: unknown) => {
    const logger = app.getLogger({ className: 'AppBootstrap' });
    logger.error('Failed to start:', error instanceof Error ? error : new Error(String(error)));
    // The failed start() already released everything, so without this the process exits 0
    process.exit(1);
  });

// Application will automatically handle shutdown signals (SIGTERM, SIGINT)
```

### Accessing Services Outside of Requests

Use `getService()` to access services outside of the request context, for example in background tasks or scripts:

```typescript
const app = new OneBunApplication(AppModule, options);
await app.start();

// Get a service instance
const userService = app.getService(UserService);

// Use the service
await userService.performBackgroundTask();
await userService.sendScheduledEmails();
```

### Service identity

Every `@Service()` class gets one Effect tag, keyed by the class NAME. Constructor injection and `getService(Class, token)` do not use that key — they resolve by tag identity at the module boundary — so this is invisible to most applications. It becomes visible wherever one application holds TWO instances of one service class.

**Named registrations.** `DrizzleModule.forRoot({ ..., as: MAIN_DB })` and `forRoot({ ..., as: ANALYTICS_DB })` both provide `DrizzleService`: one class, one key, two instances. Name the one you want and you always get it:

```typescript
const main = app.getService(DrizzleService, MAIN_DB);
```

Ask without naming one and there is no correct answer, so `app.getService(DrizzleService)` throws rather than choosing. The instance it would otherwise return depends on the order the modules were imported in, which is not something your code should depend on.

**`getLayer()` carries one instance per service class.** The value it returns is an Effect `Context`, and a `Context` has exactly one slot per key. An application with two registrations of one service — or with two service classes that share a name — has more instances than the layer has slots, so `getLayer()` reports that instead of silently returning whichever instance was merged last.

**Say which instance takes the slot.** `getLayer()` accepts `[ServiceClass, token]` pairs, the layer counterpart of `getService(Class, token)`:

<!-- typecheck: skip -->
```typescript
const layer = app.getLayer([[MailerService, PRIMARY_MAILER]]);

await Effect.runPromise(Effect.provide(program, layer));
```

`ServiceSelection` is the `[ServiceClass, token]` pair type. The layer still holds one instance per class — that is a property of `Context`, not a choice — but which one is yours to state rather than a function of module import order. Every ambiguous class must be named; leaving one out still refuses, and the message names only what is still unresolved. Naming an unambiguous class is allowed and simply pins what was already going to be there. To reach a single instance without building a layer at all, `getService(Class, token)` or `@Inject(token)`.

**Two service classes with the same name.** Two classes called `CacheService` from different packages are separate services to the framework, and injection resolves each of them correctly. They mint the same tag key, so they cannot both appear in a layer. If your application needs both in one layer, give one an explicit tag:

```typescript
import { Context } from 'effect';

export const BillingCacheTag = Context.GenericTag<CacheService>('@acme/billing/CacheService');

@Service(BillingCacheTag)
export class CacheService extends BaseService {}
```

The convention the framework packages follow is `@scope/package/ClassName`.

**One copy of `@onebun/core` per application.** Decorator metadata is held per copy of the framework. If `node_modules` resolves two copies, classes decorated by one copy are invisible to the other and boot fails with a dependency error naming a service that is correctly decorated. Deduplicate the dependency; there is no runtime workaround.

<llm-only>
**Technical details for AI agents:**
- `@Service()` mints `Context.GenericTag(target.name)` — one tag OBJECT per class, and `tag.key` is the bare class name. Effect keys `Context`/`Layer` by `tag.key`; OneBun's own maps (`serviceInstances`, `GlobalScope.services`, overrides) are keyed by the tag OBJECT, which is why injection is unaffected by a name collision
- `getService(Class)` and untokened `getLayer()` throw `OneBunAmbiguousServiceError` when the module tree holds 2+ instances under one key. `getService(Class, token)` is exempt — it names one registration — and so is `getLayer(selections)` for every class the selections name; a class left unnamed still throws, and the message lists only the unresolved ones. The check runs after `ensureSingleServiceMode`, so multi-service mode still reports its own error first
- `getLayer(selections)` builds the module layer and merges `Layer.succeed(tag, instance)` per selection ON TOP. Last-merged wins for a shared tag in Effect — the same rule that makes the untokened form ambiguous is what lets a selection resolve it
- The DI ordering pass in `createServicesWithDI` keys `availableServiceClasses`/`createdServices` by class OBJECT. Keyed by name, two same-named provider classes made boot depend on the order of the `providers` array
- The same pass stops on NO PROGRESS — a full rotation of the pending queue that builds nothing — not on an attempt budget. Through 0.8.1 it gave up after `2 * providers.length` dequeues, while a consumer-first listing needs up to N(N+1)/2, so a reversed chain of 4 failed with a `CircularDependencyError` that named no cycle. After a stall, `CircularDependencyError` is thrown only when the waits close a cycle, and its `chain` is trimmed to that cycle; otherwise the error is `DependencyResolutionError` naming the dependency that left the queue unconstructed
- A parameter typed as an abstract or base class resolves by `instanceof` (`resolveDependencyByType`'s fallback), and the abstract class is never in `availableServiceClasses`. So the same pass defers such a consumer on the first listed provider that EXTENDS the type and is still to be built (`providerToWaitFor`); without that, a consumer listed before its implementation threw `DependencyResolutionError` at once, and only a full dependencies-first sort booted. Deferral never changes WHICH subclass is injected: resolution still takes the first instance built. An `@Optional()` parameter waits only for its OWN class while that is still pending: a provider that left the queue unconstructed (constructor threw, or undecorated) gives it `undefined` plus a warning, and typed as an abstract class it never waits — as through 0.8.1, since waiting would turn `Impl(Consumer)` + `Consumer(@Optional() Base)`, which boots with `undefined`, into a `CircularDependencyError`
- The framework's own tag keys `LoggerService`, `ConfigService`, `QueueService` and `SharedRedisService` are NOT namespaced, so a user service with one of those names shares their key. It reaches nothing at runtime — the framework reads its logger from its own layer, never from `rootLayer` — but it does make `getLayer()` ambiguous
</llm-only>

### Graceful Shutdown

OneBun enables graceful shutdown **by default**. On SIGTERM or SIGINT — and on any
`await app.stop()` — it runs this sequence, in this order:

1. **Refuses new requests**: every route answers `503 Service Unavailable`
   (`{"success": false, "error": "Service Unavailable", ...}`). The listener stays open on
   purpose, so a load balancer sees a refusal instead of a dropped connection. A WebSocket
   upgrade attempted from here on is refused with `503` too, which matters because step 2 is
   itself an invitation to reconnect.
2. **Closes WebSocket connections**: each open socket is closed with RFC 6455 code **1001**
   ("going away") and the reason `Server shutting down`, and every `@OnDisconnect` handler is
   awaited — while the gateway, its client storage and the DI scope are all still alive.
   Bounded at 5 seconds; anything still open after that is cut by step 4.
3. **Drains in-flight requests**: waits for the requests already being served to finish.
   Anything still open when the drain deadline expires is force-closed, and a `warn` names
   how many connections were cut.
4. **Closes the HTTP listener** — before any destroy hook runs.
5. Calls `beforeApplicationDestroy(signal)` hooks on all services and controllers
6. Releases the remaining WebSocket resources: ping timers and client storage
7. Stops the queue service and disconnects the queue adapter, after waiting for a scheduled job
   that is mid-run (bounded at 30 seconds)
8. Stops system-metrics collection — the 5-second sampler started at boot. Nothing used to stop
   it, so its `setInterval` kept the event loop alive and a script that booted and stopped an
   application never terminated
9. Flushes traces
10. Calls `onModuleDestroy()` hooks on all services and controllers
11. Releases the shared Redis connection (disconnected when the last consumer lets go)
12. Calls `onApplicationDestroy(signal)` hooks on all services and controllers
13. Flushes the logger transport

Steps 1–4 are what keeps a rolling deploy from cutting responses that were mid-flight: the
destroy hooks no longer run while the socket is still accepting work.

::: warning Bun reports the close code as 1000 to its own client
The server sends 1001 — that is what a `close` callback on the server side reports, and what the
reason accompanies. Bun's `WebSocket` client currently surfaces the code as **1000** regardless.
Measured against a bare `Bun.serve` with no framework involved. If your client branches on the
code, branch on the reason instead until that changes.

WebSocket connections used to be closed by nothing at all: the shutdown severed them at the very
end with `server.stop(true)`, so a client saw no close frame, stayed `readyState === 1`, and
learned the service was gone only when the process died — an abnormal 1006 at an arbitrary
moment. `@OnDisconnect` ran, but after the client storage had already been wiped.
:::

**Bounded, always**. `shutdownTimeout` (default **15000 ms**) caps the whole sequence.
The first half of that budget bounds the drain; the rest bounds the destroy hooks. `stop()`
resolves when the deadline expires whatever is still running, logging what that was; on the
signal path the process then exits with code **1** instead of 0.

**Idempotent**. `stop()` runs once per application. A second call — sequential, overlapping,
or a second signal — awaits the first shutdown and re-runs nothing. A signal arriving during
a shutdown is logged (`Already shutting down, ignoring SIGINT`) and does not restart the
drain. `enableGracefulShutdown()` registers its listeners at most once per instance.

```typescript
// Default: graceful shutdown is enabled, with a 15s budget
const app = new OneBunApplication(AppModule);
await app.start();
// SIGTERM/SIGINT handlers are automatically registered

// Give slow requests more room to finish (drain gets the first half: 15s here)
const app = new OneBunApplication(AppModule, {
  shutdownTimeout: 30_000,
});

// To disable automatic shutdown handling:
const app = new OneBunApplication(AppModule, {
  gracefulShutdown: false,
});
await app.start();
app.enableGracefulShutdown(); // Register the handlers yourself instead

// Programmatic shutdown — drains, then closes the server and WebSocket connections.
// The shared Redis client is NOT released here: whoever acquired a hold gives it back, and
// the connection closes when the last holder does.
await app.stop();

// Deprecated and ignored — kept only so existing call sites still compile
await app.stop({ closeSharedRedis: false });

// Pass signal for lifecycle hooks
await app.stop({ signal: 'SIGTERM' });
```

**Multi-service mode**: the *parent* application registers the one SIGTERM/SIGINT handler
for the process; child services never register their own. The handler runs
`stopAll()`, which stops every service **concurrently** (each service still drains its own
requests), and the process exits only after the last service has finished its hooks. Pass
`gracefulShutdown: false` in `MultiServiceApplicationOptions` to install no handler at all.

The signal name is **not** forwarded to the children: `stopAll()` calls each child's `stop()`
with no arguments, so `beforeApplicationDestroy(signal)` and `onApplicationDestroy(signal)` both
receive `undefined` in multi-service mode — even when the parent was given an explicit
`stop({ signal: 'SIGTERM' })`. Do not branch on `signal` there.

### When `start()` fails {#when-start-fails}

A `start()` that rejects has already stopped the application. Before the error reaches your
`catch`, it runs the [shutdown sequence](#graceful-shutdown) over whatever the boot got as far as
acquiring — the HTTP listener, the WebSocket storage, the queue service and the adapter's
connection, the system-metrics sampler, the trace and log flushes — and the destroy hooks. Then it
rethrows the error it caught; nothing in the rollback replaces it.

So a process that catches a failed boot ends on its own. It used to stay alive instead: the queue
adapter's connection and the metrics sampler each kept the event loop open, so a test or a
supervisor that caught the rejection without calling `stop()` hung until something killed it.

- **Nothing to clean up in the catch.** `await app.stop()` after a rejected `start()` resolves and
  runs none of the sequence again: it awaits the rollback that already ran, and the destroy hooks
  do not run twice. It does close what the rollback left open for a retry, as every `stop()` does:
  it shuts down the `tracing.spanProcessors` you passed in, releases a `metrics.registry` you passed
  in, and flushes and closes every OTLP log transport in the process — a `loggerLayer` you passed in
  included, and the log export of any other application still running in the process.
- **Exit non-zero yourself.** With nothing holding the process, a catch that only logs lets it end
  with code `0` — a failed boot reported to the supervisor as a success. End the catch with
  `process.exit(1)`, as the [minimal example](../index.md#minimal-working-example) does.
- **The error is the one that stopped the boot.** The log leads with it
  (`Failed to start application:`), then brackets the teardown between
  `Rolling back the failed start: releasing what it acquired` and `Failed start rolled back`. A
  teardown step that fails is logged — `Shutdown step "disconnecting the queue adapter" failed; ...`
  and a summary, `Rollback of the failed start completed with 1 failed step(s): ...` — and never
  takes the original error's place.
- **Match a hook failure on its message, not its class.** `start()` rethrows the value it caught.
  Thrown from `onApplicationInit`, a queue subscription or a taken port, that is the very object
  thrown. Thrown from a service's or controller's `onModuleInit` — where a backend unreachable at
  boot usually fails — it reaches `start()` already wrapped by Effect as a `FiberFailure`: the
  message is intact, the class is not, so `instanceof` and `toBe` do not hold there. The
  [cache](./cache.md#telling-this-failure-apart-from-any-other) and
  [drizzle](./drizzle.md#startup-contract) startup errors are matched that way.
- **The rollback closes what the application built, and nothing you passed in.** It disposes the
  application's own metrics registry, shuts down its trace provider and OTLP span exporter, and
  closes the OTLP transport of the logger it built — `Failed to start application:` is flushed to
  the collector first, and a line you log in the catch afterwards through `app.getLogger()`
  reaches the console only. A `loggerLayer`, the `tracing.spanProcessors` and a
  `metrics.registry` from your options stay open and keep working: the processors are flushed,
  not shut down, and nothing registered on the registry is cleared. In multi-service mode the
  services that did start keep exporting their logs.
- **A `loggerLayer` you built keeps an OTLP transport open.** Its flush timer holds the process
  alive after the rollback, as it would after any failed attempt you intend to retry. When you give
  up without `process.exit()`, close it with `await app.stop()` or with `shutdownLogger()` from
  `@onebun/logger`.
- **Destroy hooks run for everything that was built**, including a service whose `onModuleInit`
  never ran, or threw halfway: the boot may have failed before it, or in it. Release what exists
  (`if (this.pool) { ... }`), not what `onModuleInit` would have opened.
- **Retry with a new instance — or the same one.** A new `OneBunApplication` per attempt is the
  simplest retry: the next attempt shares nothing with the failed one except what you pass to
  both, and a `loggerLayer`, `tracing.spanProcessors` or `metrics.registry` shared that way still
  works, because the rollback left it open. Calling `start()` again on the instance whose start
  failed boots as well: nothing of the failed attempt is left running, the retry rebuilds the
  metrics registry, the trace provider and the OTLP log transport the rollback closed, reuses what
  you passed in, and a `stop()` after the retry stops it.

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2_000;

async function startWithRetry(): Promise<OneBunApplication> {
  for (let attempt = 1; ; attempt++) {
    // A new instance per attempt: the one whose start() failed has released everything
    const app = new OneBunApplication(AppModule);
    try {
      await app.start();

      return app;
    } catch (error) {
      // Nothing to stop() here — the failed start() released what it had acquired
      if (attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await Bun.sleep(RETRY_DELAY_MS);
    }
  }
}
```

The rollback is bounded by `shutdownTimeout` like any shutdown. In multi-service mode each service
rolls back its own failed start; the services that did start are not stopped by it, and the
parent's `stop()` does not reach them either — exit the process from the catch.

<llm-only>

- Mechanism: the single-service `start()` catch logs `Failed to start application:`, then calls `rollBackFailedStart()` → `executeShutdown({ rollback: true })` — the SAME `performShutdown` as `stop()`. `rollback` changes the wording of the first, last and summary lines, and narrows the three telemetry steps to what the application owns (next bullet). Every step is guarded (`runShutdownStep`), the sequence is raced against `shutdownTimeout`, and `rollBackFailedStart` catches on top, so `start()` rethrows exactly the value its catch received — the rollback never substitutes its own error
- Telemetry in the rollback, versus `stop()`: metrics — the sampler is always stopped, but `dispose()` (registry `clear()`, `__onebunMetricsService` handed back) runs only when the application created the registry (`ownsMetricsRegistry()`: no `metrics.registry` in options); traces — `traceService.shutdown({ spanProcessors: 'flush' })` (`TraceShutdownOptions`): `forceFlush()` on the provider, shutdown of only the `BatchSpanProcessor` it built from `exportOptions`, global slot and context manager handed back — `stop()` calls `shutdown()`, which reaches the caller's processors too; logs — `shutdownLoggerLayer(this.loggerLayer)` when the application built the layer, nothing for a `loggerLayer` from options — `stop()` calls the process-wide `shutdownLogger()`. Measured on the version that shut all three down: a `loggerLayer` or `spanProcessors` shared across attempts (the documented new-instance loop, or a same-instance retry) exported no log line and no span from the attempt that booted; a `metrics.registry` lost everything registered on it; a started multi-service sibling stopped exporting logs
- The rollback does NOT take the shutdown latch (`shutdownPromise`), which is terminal: its outcome is kept as `rollbackPromise` until the next `start()`. While it is set, `stop()` and a signal await it and run no step of the sequence again (no destroy hook or `disconnect()` twice), then run the three narrowed telemetry steps in their `stop()` form — `executeShutdown({ afterRollback: true })` → `closeWhatTheRollbackLeftOpen()`, bounded by `shutdownTimeout`, each step guarded: `dispose()` of a `metrics.registry` from options, `traceService.shutdown()` (a plain shutdown after the `'flush'` one shuts down exactly the caller's processors that pass left running, and releases nothing again), and the process-wide `shutdownLogger()`. Its outcome is merged into the rollback's (`timedOut` OR-ed, failures concatenated). Without it, what the caller passed in outlived a `stop()` that had always closed it: an OTLP `loggerLayer`'s flush timer, or a span processor holding a ref'd handle until its `shutdown()`, kept alive a process that `stop()` after a failed start had always let exit (measured: killed at 12 s, 0.8.1 exited in 0.4 s). Stock OTel exporters in a `BatchSpanProcessor` do not hold the loop, so they exited either way The next `start()` awaits and clears `rollbackPromise`, so a `stop()` after a successful retry is a real stop. A `stop()` that began while the failing `start()` was still booting is awaited instead of a second sequence
- Same-instance retry: the `start()` that clears `rollbackPromise` calls `reacquireAfterRollback()` unless the application had been `stop()`ped before (latch set). It rebuilds what the rollback closed: the metrics service when the application owns its registry (new registry and sampler; `__onebunMetricsService` re-pointed — with a `metrics.registry` from options the service is kept, since registering its metric names on the same registry again would throw, and `start()` restarts its sampler), the trace service (new provider built with the same `spanProcessors` instances; the global slot and the context manager are claimed again) and — only when the application built its own logger and it exports over OTLP — the logger layer. Not rebuilt, and not needing it: a `loggerLayer` passed in options (still open). Not rebuilt: a logger taken with `getLogger()` before the retry (console only). The failed attempt's queue connection and sampler are gone, not running beside the retry's (tests pin one live connection and one sampler)
- A `start()` that fails on an application that is already running (a second `start()` while the first boot serves, e.g. on its own explicit port) is NOT rolled back — the rollback would reach the running boot's listener, sampler and observability. It rethrows and leaves that attempt's partial resources, as before the rollback existed
- `start()` after a successful `stop()` behaves as it did before the rollback existed: it boots with the metrics registry disposed and the trace provider shut down, and the `stop()` after it is a no-op (terminal latch) — build a new instance to restart
- That value is NOT always the object user code threw. Service and controller `onModuleInit` run inside `Effect.runPromise(module.setup())`, so their failure arrives as Effect's `FiberFailure` (`Runtime.isFiberFailure(e)` is true, `e.message` is the original message, `e.name` is prefixed `(FiberFailure) `): assert with `toThrow('<message>')` / match on the message, never `toBe(thrown)` or `instanceof`. Failures outside Effect — `onApplicationInit`, middleware/interceptor `onModuleInit`, a queue `subscribe`, `Bun.serve` on a taken port, env schema validation — arrive as the thrown object itself; an env LOADING failure (`EnvLoadError`, run through `Effect.runPromise`) arrives as a `FiberFailure` too. Same caveat as `DrizzleStartupError` and `CacheBackendUnavailableError`
- Measured before the fix (FB-30): a JetStream application whose `@Subscribe` named a subject no declared stream binds was still alive 12 s after catching the rejection; disconnecting the adapter alone did not end it and neither did disabling metrics alone — both held the loop. The in-memory adapter's 100 ms delayed-message interval, the scheduler's job timers, a bound listener and an OTLP log transport's flush timer are the same class of holder
- A failure inside handler registration (a refused `subscribe`) happens before `QueueService.start()`, and `QueueService.stop()` returns early for a service that never started; the adapter `disconnect()` that follows is what closes the connection and the subscriptions made so far
- `publish()` calls from `onModuleInit` are held until the queue is ready; a boot that fails before that point never sends them, although their message ids were already returned
- `shutdownLoggerLayer(layer)` at the end of the rollback closes only the application's own transport, so whatever the caller logs in its catch through `app.getLogger()` after the rollback reaches the console but not the collector; a line logged through a `loggerLayer` of its own is still exported, on that transport's next batch or at its `shutdownLogger()`
- A failure inside the adapter's own `connect()` (JetStream: a declared stream the server refuses, such as `replicas: 3` on one node or a narrowing change; a server without JetStream) happens before the adapter counts itself connected, and its `disconnect()` returns early in that state. So `connect()` closes the connection it opened before rethrowing — the rollback's adapter step has nothing left to release. An adapter written for this interface must do the same: release in `connect()`'s catch, as `RedisQueueAdapter` and `JetStreamQueueAdapter` do
- Tests: `packages/core/src/application/failed-start-rollback.test.ts` (what is released, error identity and the `onModuleInit` `FiberFailure`, logs, `stop()` a no-op after a failure and a real stop after a retry, same-instance retry with one live connection and one sampler, OTLP logger rebuilt, a `loggerLayer` and `spanProcessors` shared with a new instance and with a same-instance retry still exporting, a `stop()` after the failure closing that `loggerLayer`, and shutting down the `spanProcessors` and releasing the `metrics.registry` passed in, a `metrics.registry` kept with what is on it, a started multi-service sibling still exporting logs, restart after `stop()`, a failed second `start()` on a running application), `packages/core/src/application/failed-start-exit.test.ts` (a spawned process ends by itself, also with OTLP log export switched on from the environment), `packages/nats/tests/failed-start-exit.integration.test.ts` (the same against a real nats-server, including a stream refused inside the adapter's `connect()`)

</llm-only>

### Lifecycle Hooks

Services and controllers can implement lifecycle hooks to execute code at specific points:

| Interface | Method | When Called |
|-----------|--------|-------------|
| `OnModuleInit` | `onModuleInit()` | After instantiation and DI |
| `OnApplicationInit` | `onApplicationInit()` | After all modules, before HTTP server |
| `OnModuleDestroy` | `onModuleDestroy()` | During shutdown, after HTTP server stops |
| `BeforeApplicationDestroy` | `beforeApplicationDestroy(signal?)` | After the drain and listener close — first hook of the teardown |
| `OnApplicationDestroy` | `onApplicationDestroy(signal?)` | End of shutdown |

The listener is already closed when `beforeApplicationDestroy` runs, so a hook cannot serve or
self-call over HTTP — traffic was refused with `503` from the start of the drain, well before it.
The three destroy hooks also run when `start()` fails, for every instance that was built — see
[When `start()` fails](#when-start-fails).
In multi-service mode `signal` is `undefined` in both hooks — see [Graceful Shutdown](#graceful-shutdown).

See [Services API](./services.md#lifecycle-hooks) for detailed usage examples.

## Multi-Service Mode

Run multiple services in a single process using the unified `OneBunApplication` constructor.

### Constructor

<!-- typecheck: skip -->
```typescript
new OneBunApplication(options: MultiServiceApplicationOptions)
```

### MultiServiceApplicationOptions

```typescript
interface MultiServiceApplicationOptions {
  services: ServicesMap;
  envSchema?: TypedEnvSchema;
  envOptions?: EnvLoadOptions;
  queue?: QueueApplicationOptions;
  enabledServices?: string[];
  excludedServices?: string[];
  externalServiceUrls?: Record<string, string>;
  /** One process-level SIGTERM/SIGINT handler on the parent (default: true) */
  gracefulShutdown?: boolean;
  /** Shutdown deadline in ms for stopAll() and every child (default: 15000) */
  shutdownTimeout?: number;

  // Defaults for every service — a service that sets the same key wins
  host?: string;
  basePath?: string;
  routePrefix?: boolean;
  envOverrides?: EnvOverrides;
  logger?: { minLevel?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace' };
  metrics?: MetricsOptions;
  tracing?: TracingOptions;
  middleware?: MiddlewareClass[];
  static?: StaticApplicationOptions;
  maxRequestBodySize?: number;
}

interface ServiceConfig {
  /** Root module CLASS — a bare `Function` is not assignable */
  module: new (...args: unknown[]) => object;
  port: number;
  host?: string;
  basePath?: string;
  routePrefix?: boolean;
  envOverrides?: EnvOverrides;
  /** Extra ENV variables for this service only */
  envSchemaExtend?: TypedEnvSchema;
  logger?: { minLevel?: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'trace' };
  metrics?: MetricsOptions;
  tracing?: TracingOptions;
  middleware?: MiddlewareClass[];
  static?: StaticApplicationOptions;
  /** Body cap for this service's listener; falls back to the application-level value */
  maxRequestBodySize?: number;
}

type ServicesMap = Record<string, ServiceConfig>;
```

Two per-service keys are accepted but always overwritten with the services-map key:
`tracing.serviceName` and `metrics.defaultLabels.service`. `tracing: { serviceName: 'users-service' }`
on the `users` service reaches nothing — the tracer reports `users`. Rename the map key instead.
`metrics.prefix` and the rest are merged service-over-application as documented above.

`static` is the one option that does **not** cascade: it is honoured per service only, an
application-level `static` is not passed to the children.

::: warning envOverrides keys are variable names
Keys are **environment variable names** (`DB_NAME`), never `config.get()` paths — a wrong key is
ignored silently.

Per-service scoping itself holds: each service gets its own configuration instance, so its
`envOverrides` and `envSchemaExtend` apply to it alone. Through 0.6.0 they did not — every service
after the first read the ENV resolved for the first one to start.
:::

### Usage Example

```typescript
import { OneBunApplication } from '@onebun/core';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';
import { envSchema } from './config';

const app = new OneBunApplication({
  services: {
    users: {
      module: UsersModule,
      port: 3001,
      routePrefix: true,
    },
    orders: {
      module: OrdersModule,
      port: 3002,
      routePrefix: true,
      envOverrides: {
        DB_NAME: { value: 'orders_db' },
      },
    },
  },
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true },
});

await app.start();
console.log('Running:', app.getRunningServices());
console.log('Users URL:', app.getServiceUrl('users'));

// Access child application
const usersApp = app.getApplication('users');
```

## OneBunModule

Internal module class (usually not used directly).

```typescript
class OneBunModule implements Module {
  static create(
    moduleClass: Function,
    loggerLayer?: Layer.Layer<never, never, unknown>,
    config?: unknown,
  ): Module;

  setup(): Effect.Effect<unknown, never, void>;
  getControllers(): Function[];
  getControllerInstance(controllerClass: Function): Controller | undefined;
  getServiceInstance<T>(tag: Context.Tag<T, T>): T | undefined;
  getLayer(selections?: ServiceSelection[]): Layer.Layer<never, never, unknown>;
  getExportedServices(): Map<Context.Tag<unknown, unknown>, unknown>;
}
```

### Global Modules

Modules decorated with `@Global()` automatically make their exported services available in all other modules without explicit import. This is useful for cross-cutting concerns like database connections.

```typescript
import { Module, Global, Service, BaseService } from '@onebun/core';

@Service()
export class DatabaseService extends BaseService {
  async query(sql: string) { /* ... */ }
}

// Mark module as global
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

// Root module imports DatabaseModule once
@Module({
  imports: [DatabaseModule],
})
export class AppModule {}

// All other modules can inject DatabaseService without importing DatabaseModule
@Module({
  providers: [UserService], // UserService can inject DatabaseService automatically
})
export class UserModule {}
```

**Import order does not matter.** A `@Global()` module's services reach every module that can see it regardless of where it sits in an `imports` array — and whether or not the importing module lists it at all. A sibling import that happens to initialize the global module first no longer leaves the importer with nothing.

**Visibility, not instance count.** `@Global()` makes a module's exported services reachable from every module without an explicit import; a module without it is reachable only where it is imported. Either way the module itself is constructed exactly ONCE per application, so two modules importing the same one share its services rather than each getting a copy.

**Scope: one instance per application.** A `@Global()` module contributes exactly one instance per application — not one per process. Two applications in the same process each build their own, so a second `DrizzleModule.forRoot()` or `CacheModule.forRoot()` opens its own connection instead of silently reusing the first application's. In multi-service mode the boundary is the sub-application: one global service instance per sub-application, and stopping one leaves its siblings untouched.

**Globality itself is still per process.** The instances are per application; the answer to "is this module ambient?" is not — it lives in one `Set` keyed by the module class. Two unnamed `forRoot()` calls that disagree about it, or about what they configure, therefore cannot each be honoured, and the framework refuses rather than letting the last one decide: an application importing the contested module fails at `start()` with `OneBunConflictingRegistrationError` naming both call sites. Give each configuration a token — `forRoot({ as: TOKEN })` with `forFeature(TOKEN)` — when they must coexist.

The options a dynamic module was imported with are **captured per application** at import time, so a later `forRoot()` in the same process cannot retroactively change what an already-running application is using.

**Global Module Utilities:**

```typescript
// Check if module is global
import { isGlobalModule } from '@onebun/core';
isGlobalModule(DatabaseModule); // true
```

## Metrics Options

```typescript
interface MetricsOptions {
  /** Enable/disable metrics (default: true) */
  enabled?: boolean;

  /** HTTP path for metrics endpoint (default: '/metrics') */
  path?: string;

  /** Default labels for all metrics */
  defaultLabels?: Record<string, string>;

  /** Enable automatic HTTP metrics (default: true) */
  collectHttpMetrics?: boolean;

  /** Enable automatic system metrics (default: true) */
  collectSystemMetrics?: boolean;

  /** Enable GC metrics (default: true) */
  collectGcMetrics?: boolean;

  /** System metrics collection interval in ms (default: 5000) */
  systemMetricsInterval?: number;

  /** Custom prefix for all metrics (default: 'onebun_') */
  prefix?: string;

  /** Buckets for HTTP duration histogram */
  httpDurationBuckets?: number[];
}
```

## Tracing Options

```typescript
interface TracingOptions {
  /** Enable/disable tracing (default: true) */
  enabled?: boolean;

  /** Service name (default: 'onebun-service') */
  serviceName?: string;

  /** Service version (default: '1.0.0') */
  serviceVersion?: string;

  /** Sampling rate 0.0-1.0 (default: 1.0) */
  samplingRate?: number;

  /** Trace HTTP requests (default: true) */
  traceHttpRequests?: boolean;

  /** Trace database queries (default: true) */
  traceDatabaseQueries?: boolean;

  /** Default span attributes */
  defaultAttributes?: Record<string, string | number | boolean>;

  /** Export options for external tracing systems */
  exportOptions?: {
    endpoint?: string;
    headers?: Record<string, string>;
    timeout?: number;
    batchSize?: number;
    batchTimeout?: number;
  };
}
```

## redactConnectionUrl

Print a connection target without printing its credentials.

```typescript
import { redactConnectionUrl } from '@onebun/core';

redactConnectionUrl('postgresql://app:hunter2@db:5432/orders?sslmode=require');
// 'postgresql://app:***@db:5432/orders?sslmode=require'
```

Scheme, user, host, port, path and query survive; only the password is replaced. A URL that
carries no password is returned unchanged, and a string with no `://` is replaced wholesale —
there is no host in it worth preserving and no way to find its credentials, so echoing it back is
the one thing that would leak.

It is public because the guarantee has to hold in more than one package: `@onebun/drizzle` and
the shared Redis provider both name their target in a startup error, and a hand-rolled redactor
per package is how one of them ends up failing open. Use it anywhere your own code prints a
connection string — a health endpoint, a startup log, an error.

::: tip Why it does not parse
Two obvious implementations fail **open** on exactly the passwords that need this most.
`new URL()` rejects a URL whose password contains a raw `/`, so the `catch` branch prints the
credential. A single regex that classes the password as `[^@/]*` matches nothing when the
password holds a `/`, and stops at the first `@` when it holds an `@`. Cloud providers emit both
characters routinely. This finds the authority by position and cuts the userinfo at its **last**
`@`, so no character inside a password can end the match early.
:::

## Re-exports

The core package re-exports commonly used items:

```typescript
// From @onebun/envs
export { Env, type EnvSchema, type InferConfigType, EnvValidationError } from '@onebun/envs';

// From @onebun/logger
export type { SyncLogger } from '@onebun/logger';

// From @onebun/requests
export {
  createHttpClient,
  type ErrorResponse,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  NotFoundError,
  OneBunBaseError,
  type SuccessResponse,
} from '@onebun/requests';

// From effect
export { Effect, Layer } from 'effect';

// Internal
export { OneBunApplication } from './application';
export { Controller as BaseController } from './controller';
export { BaseService, Service, getServiceTag } from './service';
export { OneBunModule } from './module';
export * from './decorators';
export * from './validation';
```
