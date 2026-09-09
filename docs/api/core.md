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
- Use `@UseGuards(AuthGuard)` on a controller or route method to add authorization
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
- `app.start()` - starts HTTP server
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
  /** Start the HTTP server */
  async start(): Promise<void>;

  /**
   * Drain in-flight requests, then stop the server and run the destroy hooks.
   * Idempotent: a second call awaits the first shutdown instead of repeating it.
   * Always resolves within `shutdownTimeout`.
   */
  async stop(options?: { 
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
8. Flushes traces
9. Calls `onModuleDestroy()` hooks on all services and controllers
10. Releases the shared Redis connection (disconnected when the last consumer lets go)
11. Calls `onApplicationDestroy(signal)` hooks on all services and controllers
12. Flushes the logger transport

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

// Programmatic shutdown — drains, then closes server, WebSocket, and shared Redis
await app.stop();

// Keep shared Redis open for other consumers
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
}

type ServicesMap = Record<string, ServiceConfig>;
```

Two per-service keys are accepted but always overwritten with the services-map key:
`tracing.serviceName` and `metrics.defaultLabels.service`. `tracing: { serviceName: 'users-service' }`
on the `users` service reaches nothing — the tracer reports `users`. Rename the map key instead.
`metrics.prefix` and the rest are merged service-over-application as documented above.

`static` is the one option that does **not** cascade: it is honoured per service only, an
application-level `static` is not passed to the children.

::: warning envOverrides are not per-service yet
Keys are **environment variable names** (`DB_NAME`), never `config.get()` paths — a wrong key is
ignored silently. And with two or more services the scoping does not hold: every service reads the
ENV resolved for the first service to start, so the other services' `envOverrides` are dropped.
With a single service, or with overrides declared at application level, they apply as written.
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
