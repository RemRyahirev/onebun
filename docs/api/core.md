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
```
Auto-ordering: CorsMiddleware → RateLimitMiddleware → [user middleware] → SecurityHeadersMiddleware

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
- `onModuleDestroy()` - during shutdown
- `beforeApplicationDestroy(signal?)` - start of shutdown
- `onApplicationDestroy(signal?)` - end of shutdown

**Multi-Service Mode** — pass `{ services: ... }` to `OneBunApplication` constructor for running multiple services in one process.

</llm-only>

# Core Package API

Package: `@onebun/core`

## OneBunApplication

Main application class that bootstraps and runs the HTTP server.

### Constructor

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

  /** Stop the HTTP server with optional cleanup options */
  async stop(options?: { 
    closeSharedRedis?: boolean; 
    signal?: string;  // e.g., 'SIGTERM', 'SIGINT'
  }): Promise<void>;

  /** Enable graceful shutdown signal handlers (SIGTERM, SIGINT) */
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
  getLayer(): Layer.Layer<never, never, unknown>;

  /** Get a service instance by class from the module container */
  getService<T>(serviceClass: new (...args: unknown[]) => T): T;

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

### Graceful Shutdown

OneBun enables graceful shutdown **by default**. When the application receives SIGTERM or SIGINT signals, it automatically:
1. Calls `beforeApplicationDestroy(signal)` hooks on all services and controllers
2. Stops the HTTP server
3. Closes all WebSocket connections
4. Calls `onModuleDestroy()` hooks on all services and controllers
5. Disconnects shared Redis connection
6. Calls `onApplicationDestroy(signal)` hooks on all services and controllers

```typescript
// Default: graceful shutdown is enabled
const app = new OneBunApplication(AppModule);
await app.start();
// SIGTERM/SIGINT handlers are automatically registered

// To disable automatic shutdown handling:
const app = new OneBunApplication(AppModule, {
  gracefulShutdown: false,
});
await app.start();
app.enableGracefulShutdown(); // Enable manually later if needed

// Programmatic shutdown
await app.stop(); // Closes server, WebSocket, and shared Redis

// Keep shared Redis open for other consumers
await app.stop({ closeSharedRedis: false });

// Pass signal for lifecycle hooks
await app.stop({ signal: 'SIGTERM' });
```

### Lifecycle Hooks

Services and controllers can implement lifecycle hooks to execute code at specific points:

| Interface | Method | When Called |
|-----------|--------|-------------|
| `OnModuleInit` | `onModuleInit()` | After instantiation and DI |
| `OnApplicationInit` | `onApplicationInit()` | After all modules, before HTTP server |
| `OnModuleDestroy` | `onModuleDestroy()` | During shutdown, after HTTP server stops |
| `BeforeApplicationDestroy` | `beforeApplicationDestroy(signal?)` | Start of shutdown |
| `OnApplicationDestroy` | `onApplicationDestroy(signal?)` | End of shutdown |

See [Services API](./services.md#lifecycle-hooks) for detailed usage examples.

## Multi-Service Mode

Run multiple services in a single process using the unified `OneBunApplication` constructor.

### Constructor

```typescript
new OneBunApplication(options: MultiServiceApplicationOptions)
```

### MultiServiceApplicationOptions

```typescript
interface MultiServiceApplicationOptions {
  services: ServicesMap;
  envSchema?: TypedEnvSchema;
  envOptions?: EnvLoadOptions;
  metrics?: MetricsOptions;
  tracing?: TracingOptions;
  queue?: QueueApplicationOptions;
  enabledServices?: string[];
  excludedServices?: string[];
  externalServiceUrls?: Record<string, string>;
}

interface ServiceConfig {
  module: Function;
  port: number;
  host?: string;
  basePath?: string;
  routePrefix?: boolean;
  envOverrides?: EnvOverrides;
}

type ServicesMap = Record<string, ServiceConfig>;
```

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
  getLayer(): Layer.Layer<never, never, unknown>;
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

**Global Module Utilities:**

```typescript
// Check if module is global
import { isGlobalModule } from '@onebun/core';
isGlobalModule(DatabaseModule); // true

// Clear global registries (for testing)
import { clearGlobalServicesRegistry } from '@onebun/core';
clearGlobalServicesRegistry();
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
