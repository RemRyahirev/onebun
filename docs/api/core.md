---
description: OneBunApplication, MultiServiceApplication classes. Bootstrap options, graceful shutdown, metrics and tracing configuration.
---

<llm-only>

## Quick Reference for AI

**Minimal App Bootstrap**:
```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

// Uses PORT/HOST env vars if set, otherwise defaults (3000 / '0.0.0.0')
const app = new OneBunApplication(AppModule);
await app.start();

// Or with explicit port (overrides PORT env var)
const app2 = new OneBunApplication(AppModule, { port: 3000 });
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
  gracefulShutdown: true,  // default
});
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
- `onModuleInit()` - after service/controller created (sequential, in dependency order; called for all providers including standalone services)
- `onApplicationInit()` - after all modules, before HTTP starts
- `onModuleDestroy()` - during shutdown
- `beforeApplicationDestroy(signal?)` - start of shutdown
- `onApplicationDestroy(signal?)` - end of shutdown

**MultiServiceApplication** - for running multiple services in one process, useful for local development or monolith deployment.

</llm-only>

# Core Package API

Package: `@onebun/core`

## OneBunApplication

Main application class that bootstraps and runs the HTTP server.

### Constructor

```typescript
new OneBunApplication(
  moduleClass: new (...args: unknown[]) => object,
  options?: Partial<ApplicationOptions>
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

  /** Base path prefix for all routes (e.g., '/api/v1') */
  basePath?: string;

  /** Route prefix to prepend to all routes (typically service name) */
  routePrefix?: string;

  /** Enable development mode (default: NODE_ENV !== 'production') */
  development?: boolean;

  /** Custom logger layer */
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

  /** Enable graceful shutdown on SIGTERM/SIGINT (default: true) */
  gracefulShutdown?: boolean;
}
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
}
```

### Usage Example

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  port: 3000,
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

await app.start();

// Access configuration - fully typed with module augmentation
const port = app.getConfigValue('server.port');  // number (auto-inferred)
const config = app.getConfig();
const host = config.get('server.host');          // string (auto-inferred)

// Get logger
const logger = app.getLogger({ component: 'main' });
logger.info('Application started', { port, host });

// Application will automatically handle shutdown signals (SIGTERM, SIGINT)
// Or stop manually:
await app.stop();
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

## MultiServiceApplication

Run multiple services in a single process.

### Constructor

```typescript
new MultiServiceApplication(options: MultiServiceApplicationOptions)
```

### MultiServiceApplicationOptions

```typescript
interface MultiServiceApplicationOptions {
  services: ServicesMap;
  envSchema?: TypedEnvSchema;
  envOptions?: EnvLoadOptions;
  metrics?: MetricsOptions;
  tracing?: TracingOptions;
  enabledServices?: string[];
  excludedServices?: string[];
  externalServiceUrls?: Record<string, string>;
}

interface ServiceConfig {
  module: Function;
  port: number;
  host?: string;
  basePath?: string;
  routePrefix?: string;
  envOverrides?: EnvOverrides;
}

type ServicesMap = Record<string, ServiceConfig>;
```

### Usage Example

```typescript
import { MultiServiceApplication } from '@onebun/core';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';
import { envSchema } from './config';

const multiApp = new MultiServiceApplication({
  services: {
    users: {
      module: UsersModule,
      port: 3001,
      routePrefix: true, // Uses 'users' as route prefix
    },
    orders: {
      module: OrdersModule,
      port: 3002,
      routePrefix: true, // Uses 'orders' as route prefix
      envOverrides: {
        DB_NAME: { value: 'orders_db' },
      },
    },
  },
  envSchema,
  enabledServices: ['users', 'orders'],
});

await multiApp.start();

console.log('Running services:', multiApp.getRunningServices());
// ['users', 'orders']

// Stop all services
multiApp.stop();
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
export { Env, type EnvSchema, EnvValidationError } from '@onebun/envs';

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

// From @onebun/trace
export { Span } from '@onebun/trace';

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
