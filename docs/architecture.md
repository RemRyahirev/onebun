---
description: System architecture overview. Module hierarchy, DI container, request lifecycle, Effect.js integration patterns.
---

<llm-only>

## Internal Architecture Notes

**DI Resolution Order**:
1. Module imports resolved first (depth-first)
2. Providers instantiated in declaration order
3. Controllers receive injected services via constructor (from the same module's providers and imported modules' exports)
4. **Exports are only required for cross-module injection.** Within a module, any provider can be injected into controllers and other providers without being listed in `exports`.

**Lifecycle Hooks Order**:
1. Services created (ambient init context provides logger/config to `BaseService` constructor — `this.config` and `this.logger` are available after `super()`) → `onModuleInit()` called on each service (sequentially in dependency order; called for all providers, even standalone ones not injected anywhere)
2. Controllers created → `onModuleInit()` called on each controller
3. All modules ready → `onApplicationInit()` called (before HTTP server starts)
4. Shutdown signal → `beforeApplicationDestroy(signal?)` called
5. HTTP server stops → `onModuleDestroy()` called
6. Cleanup complete → `onApplicationDestroy(signal?)` called

**Accessing Services Outside Requests**:
- `app.getService(ServiceClass)` - returns service instance by class

**Effect.js Usage**:
- Framework internals use Effect.pipe for composition
- Services can use Effect for complex async flows
- Application code typically uses Promise wrappers
- Layer system manages service lifecycles

**Request Flow**:
1. Bun.serve receives HTTP request
2. TraceMiddleware adds trace context
3. Middleware chain executes (global → module → controller → route)
4. Parameter decorators extract @Param, @Query, @Body
5. Controller method executes with injected services
6. Response serialized (this.success/this.error or direct return)
7. MetricsMiddleware records metrics

**Module Metadata Storage**:
- Reflect.metadata stores decorator info
- MODULE_METADATA_KEY for @Module options
- CONTROLLER_METADATA_KEY for route paths
- METHOD_METADATA_KEY for HTTP methods
- PARAM_METADATA_KEY for parameter extraction

</llm-only>

# OneBun Architecture

## Overview

OneBun is built on three pillars:
1. **NestJS-inspired DI** - Decorators for modules, controllers, services
2. **Effect.js** - Type-safe side effect management internally
3. **Bun.js** - Fast runtime with native TypeScript support

## Component Hierarchy

```
OneBunApplication
    │
    ├── OneBunModule (Root Module)
    │   ├── Controllers[]
    │   │   └── Routes[] (from decorators)
    │   ├── Services[] (Providers)
    │   └── Child Modules[]
    │       └── (recursive structure)
    │
    ├── Logger (SyncLogger)
    ├── ConfigService
    ├── MetricsService (optional)
    └── TraceService (optional)
```

## Dependency Injection System

### How DI Works

1. **Service Registration**: `@Service()` decorator registers class with Effect.js Context tag
2. **Module Assembly**: `@Module()` collects controllers and providers
3. **Dependency Resolution**: Framework analyzes constructor parameters
4. **Instance Creation**: Services created in dependency order, then controllers

### DI Resolution Flow

```typescript
// 1. Service is decorated
@Service()
export class UserService extends BaseService {
  // Dependencies are injected via constructor
  // Logger and config are injected automatically
  constructor(private cacheService: CacheService) {
    super();
  }
}

// 2. Module declares dependencies
@Module({
  imports: [CacheModule],  // provides CacheService
  providers: [UserService],
  controllers: [UserController],
})
export class UserModule {}

// 3. At startup, framework:
//    a. Creates CacheService first (from imported module)
//    b. Sets ambient init context (logger + config)
//    c. Creates UserService with CacheService injected
//       (config and logger available in constructor after super())
//    d. Clears init context
//    e. Creates UserController with UserService injected
```

### Auto-Detection Algorithm

The framework uses multiple strategies to detect dependencies:

```typescript
// Priority 1: TypeScript design:paramtypes (when emitDecoratorMetadata is true)
const designTypes = Reflect.getMetadata('design:paramtypes', target);

// Priority 2: Constructor source code analysis (fallback)
// Matches patterns like: "private userService: UserService"
const constructorStr = target.toString();
const typeMatch = param.match(/:\s*([A-Za-z][A-Za-z0-9]*)/);

// Note: Classes MUST have a decorator (@Service, @Controller, etc.) for
// design:paramtypes to be emitted. Without a decorator, DI will not work.
```

### Automatic DI (Recommended)

In most cases, dependencies are injected automatically without any decorator:

```typescript
@Controller('/users')
export class UserController extends BaseController {
  constructor(
    private userService: UserService,  // Automatically injected
    private cache: CacheService,        // Automatically injected
  ) {
    super();
  }
}
```

### Explicit Injection (Edge Cases)

Use `@Inject()` only when automatic DI cannot resolve the dependency:

```typescript
import { Inject } from '@onebun/core';

@Controller('/users')
export class UserController extends BaseController {
  constructor(
    // Use @Inject for:
    // - Interface/abstract class injection
    // - Token-based injection
    // - Overriding automatic resolution
    @Inject(UserService) private userService: UserService,
  ) {
    super();
  }
}
```

## Effect.js Integration

### Internal vs External API

| Layer | API Style | Why |
|-------|-----------|-----|
| Framework internals | Effect.js | Composable error handling, resource management |
| Client code (controllers, services) | Promises | Simpler, familiar API |
| Advanced use cases | Both | `Effect.runPromise()` bridge |

### Effect.js in Module System

```typescript
// Module initialization returns Effect
setup(): Effect.Effect<unknown, never, void> {
  return this.createControllerInstances();
}

// Layer composition for DI
const layer = Layer.merge(
  Layer.succeed(ServiceTag, serviceInstance),
  loggerLayer,
);
```

### Using Effect.js in Services

```typescript
@Service()
export class DataService extends BaseService {
  // Promise-based (recommended for most cases)
  async fetchData(): Promise<Data> {
    return await fetch('/api/data').then(r => r.json());
  }

  // Effect-based (for advanced composition)
  fetchDataEffect(): Effect.Effect<Data, FetchError, never> {
    return pipe(
      Effect.tryPromise({
        try: () => fetch('/api/data'),
        catch: (e) => new FetchError(e),
      }),
      Effect.flatMap((response) =>
        Effect.tryPromise(() => response.json())
      ),
    );
  }

  // Bridge: use Effect internally, expose Promise
  async fetchWithRetry(): Promise<Data> {
    const effect = pipe(
      this.fetchDataEffect(),
      Effect.retry({ times: 3 }),
    );
    return Effect.runPromise(effect);
  }
}
```

## Request Lifecycle

```
HTTP Request
    │
    ▼
┌─────────────────────────────────────────────┐
│ Bun.serve fetch handler                     │
│  ├── Extract trace headers                  │
│  ├── Start trace span (if enabled)          │
│  └── Match route                            │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Middleware Chain                            │
│  ├── Global middleware (ApplicationOptions) │
│  ├── Module middleware (OnModuleConfigure)  │
│  ├── Controller middleware (@UseMiddleware) │
│  └── Route middleware (@UseMiddleware)      │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Parameter Extraction & Validation           │
│  ├── Path params (@Param)                   │
│  ├── Query params (@Query)                  │
│  ├── Body (@Body) with ArkType validation   │
│  └── Headers (@Header)                      │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Controller Handler                          │
│  ├── Execute handler method                 │
│  └── Return Response                        │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ Response Processing                         │
│  ├── Response validation (if schema)        │
│  ├── Record metrics                         │
│  ├── End trace span                         │
│  └── Return to client                       │
└─────────────────────────────────────────────┘
```

## Module System

### Module Types

1. **Root Module**: Entry point, contains app-level configuration
2. **Feature Modules**: Domain-specific (UserModule, OrderModule)
3. **Infrastructure Modules**: Cross-cutting (CacheModule, DrizzleModule)

### Module Lifecycle

**Initialization Phase:**

```typescript
// Phase 1: Import child modules and collect exported services
if (metadata.imports) {
  for (const importModule of metadata.imports) {
    const childModule = new OneBunModule(importModule, loggerLayer, config);
    // Merge layers, collect exported services
  }
}

// Phase 2: Create this module's services with DI
this.createServicesWithDI(metadata);

// Phase 3: Call onModuleInit() on services that implement it
// (sequentially in dependency order — dependencies complete before dependents)
await this.callServicesOnModuleInit();

// Phase 4: Create controllers with injected services
this.createControllersWithDI();

// Phase 5: Call onModuleInit() on controllers that implement it
await this.callControllersOnModuleInit();

// Phase 6: After all modules ready, call onApplicationInit() (before HTTP server)
await this.callOnApplicationInit();
```

**Shutdown Phase:**

```typescript
// Phase 1: Call beforeApplicationDestroy(signal) on all services and controllers
await this.callBeforeApplicationDestroy(signal);

// Phase 2: HTTP server stops (handled by application)

// Phase 3: Call onModuleDestroy() on all services and controllers
await this.callOnModuleDestroy();

// Phase 4: Call onApplicationDestroy(signal) on all services and controllers
await this.callOnApplicationDestroy(signal);
```

### Lifecycle Hooks

Services and controllers can implement lifecycle hooks by importing the interfaces:

```typescript
import { 
  OnModuleInit, 
  OnApplicationInit, 
  OnModuleDestroy,
  BeforeApplicationDestroy,
  OnApplicationDestroy 
} from '@onebun/core';

@Service()
export class DatabaseService extends BaseService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection | null = null;

  async onModuleInit(): Promise<void> {
    this.connection = await createConnection(this.config.database.url);
    this.logger.info('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection?.close();
    this.logger.info('Database disconnected');
  }
}
```

### Service Export/Import

**Exports are only needed when a module is imported by another.** Within a module, all of its providers are automatically available to its controllers and to other providers in the same module; you do not need to list them in `exports`.

```typescript
// CacheModule exports CacheService so that importing modules can use it
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}

// UserModule imports and uses CacheService
@Module({
  imports: [CacheModule],
  providers: [UserService],  // can inject CacheService (imported)
})
export class UserModule {}
```

Example without exports (same-module only): a module with `providers: [MyService]` and `controllers: [MyController]` can inject `MyService` into `MyController` without listing `MyService` in `exports`.

## Controller Architecture

### Route Registration

```typescript
@Controller('/users')
export class UserController extends BaseController {
  @Get('/')          // GET /users/
  @Get('/:id')       // GET /users/:id
  @Post('/')         // POST /users/
  @Put('/:id')       // PUT /users/:id
  @Delete('/:id')    // DELETE /users/:id
}
```

### Metadata Storage

```typescript
// Stored in META_CONTROLLERS Map
const metadata: ControllerMetadata = {
  path: '/users',
  routes: [
    {
      path: '/',
      method: HttpMethod.GET,
      handler: 'findAll',
      params: [],
      middleware: [],
    },
    {
      path: '/:id',
      method: HttpMethod.GET,
      handler: 'findOne',
      params: [{ type: ParamType.PATH, name: 'id', index: 0 }],
    },
  ],
};
```

## Service Architecture

### BaseService Features

```typescript
export class BaseService {
  protected logger: SyncLogger;  // Available after super() in constructor
  protected config: unknown;     // Available after super() in constructor

  // Logger and config are injected via ambient init context,
  // making them available immediately after super() in subclass constructors.
  // initializeService() is kept as a fallback for manual/test usage.
}

// Lifecycle hooks are optional - implement the interface to use:
// onModuleInit is called for ALL providers, even standalone services
// not injected anywhere. Hooks run sequentially in dependency order.
@Service()
class MyService extends BaseService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // Called after construction and DI injection
    // All dependencies' onModuleInit have already completed
  }
}
```

### Service Layer Pattern

```typescript
@Service()
export class UserService extends BaseService {
  // Dependencies injected via constructor
  // Logger and config available immediately after super()
  constructor(
    private repository: UserRepository,  // Data access
    private cacheService: CacheService,  // Cross-cutting
  ) {
    super();
    // this.config and this.logger are available here
  }

  async findById(id: string): Promise<User | null> {
    // Check cache first
    const cached = await this.cacheService.get(`user:${id}`);
    if (cached) return cached;

    // Fetch from database
    const user = await this.repository.findById(id);

    // Cache result
    if (user) {
      await this.cacheService.set(`user:${id}`, user, { ttl: 300 });
    }

    return user;
  }
}
```

## Configuration System

### Schema Definition

```typescript
export const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
  database: {
    url: Env.string({ env: 'DATABASE_URL', sensitive: true }),
    maxConnections: Env.number({ default: 10 }),
  },
  features: {
    enableCache: Env.boolean({ default: true }),
    allowedOrigins: Env.array({ separator: ',' }),
  },
};
```

### Configuration Flow

```
.env file → EnvLoader → EnvParser → ConfigProxy → TypedEnv
                ↓
           validation
                ↓
           type-safe access: config.get('database.url')
```

## Observability Stack

### Logging

```typescript
// Levels: trace, debug, info, warn, error, fatal
this.logger.info('User created', { userId: user.id });

// Child loggers inherit context
const childLogger = this.logger.child({ requestId: '123' });
```

### Metrics (Prometheus)

```
http_request_duration_seconds{method, route, status_code}
http_requests_total{method, route, status_code}
process_cpu_seconds_total
process_memory_bytes{type}
```

### Tracing (OpenTelemetry-compatible)

```typescript
// Automatic HTTP request tracing
// Headers: traceparent, tracestate, x-trace-id, x-span-id

// Manual span creation
@Span('operation-name')
async myOperation(): Promise<void> {
  // Span automatically created and closed
}
```

## Error Handling

### Standard Error Types

```typescript
import { OneBunBaseError, NotFoundError, InternalServerError } from '@onebun/core';

// Throw typed errors
throw new NotFoundError('User', userId);

// Caught and converted to standard response:
// { success: false, code: 404, message: "User not found" }
```

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  code: number;      // HTTP-like error code
  message: string;   // Human-readable message
  details?: unknown; // Additional error details
}
```

## Multi-Service Architecture

### Single Process, Multiple Services

```typescript
const multiApp = new MultiServiceApplication({
  services: {
    users: {
      module: UsersModule,
      port: 3001,
    },
    orders: {
      module: OrdersModule,
      port: 3002,
      envOverrides: {
        DB_NAME: { value: 'orders_db' },
      },
    },
  },
  envSchema,
});
```

### Service Communication

```typescript
// Generate typed client from service definition
const usersClient = createServiceClient(UsersServiceDefinition, {
  baseUrl: 'http://localhost:3001',
});

// Call with full type safety
const user = await usersClient.users.findById('123');
```
