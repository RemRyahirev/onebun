---
description: "BaseService class, @Service decorator, dependency injection patterns, service lifecycle, Effect.js integration."
---

# Services API

Package: `@onebun/core`

## BaseService

Base class for all application services. Provides logger and configuration access.

### Class Definition

```typescript
export class BaseService {
  protected logger: SyncLogger;                // Available after super() in constructor
  protected config: IConfig<OneBunAppConfig>;  // Available after super() in constructor

  /** Set ambient init context (called by framework before construction) */
  static setInitContext(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void;

  /** Clear ambient init context (called by framework after construction) */
  static clearInitContext(): void;

  /** Initialize service with logger and config (fallback, called by framework) */
  initializeService(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void;

  /** Check if service is initialized */
  get isInitialized(): boolean;

  /** Run an effect with error handling */
  protected async runEffect<A>(effect: Effect.Effect<never, never, A>): Promise<A>;

  /** Format an error for consistent handling */
  protected formatError(error: unknown): Error;
}
```

## Creating a Service

::: tip Automatic Logger and Config Injection
The framework automatically injects `logger` and `config` into services extending `BaseService`. Both are available **immediately after `super()`** in the constructor — you can use `this.config` and `this.logger` directly in the constructor body. The framework uses an ambient init context set before service construction.
:::

### Basic Service

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class CounterService extends BaseService {
  private count = 0;

  increment(): number {
    this.count++;
    this.logger.debug('Counter incremented', { count: this.count });
    return this.count;
  }

  decrement(): number {
    this.count--;
    return this.count;
  }

  getValue(): number {
    return this.count;
  }
}
```

### Service with Dependencies

Dependencies are automatically injected via constructor. Logger and config are available immediately after `super()`. A `@Service()` subclass that declares no constructor of its own is injected with the dependencies of the constructor it inherits — see [Inherited Constructors](/api/decorators#inherited-constructors):

```typescript
import { Service, BaseService } from '@onebun/core';
import { CacheService } from '@onebun/cache';

@Service()
export class UserService extends BaseService {
  // Dependencies are auto-injected via constructor
  // Logger and config are available immediately after super()
  constructor(
    private cacheService: CacheService,
    private repository: UserRepository,
  ) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    // Check cache first
    const cacheKey = `user:${id}`;
    const cached = await this.cacheService.get<User>(cacheKey);

    if (cached) {
      this.logger.debug('User found in cache', { id });
      return cached;
    }

    // Fetch from database
    const user = await this.repository.findById(id);

    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300 });
    }

    return user;
  }
}
```

## Service Registration

Services must be:
1. Decorated with `@Service()`
2. Listed in module's `providers` array

Within a module, all providers are automatically available to that module's controllers and to other providers in the same module. The `exports` array is only required when you want to use a provider in **another** module that imports this one (cross-module injection).

```typescript
import { Module } from '@onebun/core';
import { CacheModule } from '@onebun/cache';
import { UserService } from './user.service';
import { UserRepository } from './user.repository';

@Module({
  imports: [CacheModule],  // Makes CacheService available
  providers: [
    UserService,
    UserRepository,  // Also a service
  ],
  exports: [UserService],  // Only needed for use in other modules that import this one
})
export class UserModule {}
```

## Dependency Resolution Errors

The framework validates all dependencies at bootstrap. If a required dependency cannot be resolved, `DependencyResolutionError` is thrown with diagnostic suggestions:

```
DependencyResolutionError: Could not resolve dependency CacheService for service UserService.
  - CacheService is exported from CacheModule. Add CacheModule to imports of UserModule.
```

The error message searches all registered modules and reports:
- Whether the dependency exists in another module and needs to be imported
- Whether the dependency exists but is not exported from its module
- Whether a global module should have auto-resolved it, or is `@Global()` but was never imported by this application — a `@Global()` module still has to be imported once, anywhere
- Whether it comes from a named registration, in which case the suggestion names `forFeature(<token>)` rather than the registration's internal class
- Whether it is a parameter of a constructor the class INHERITS: a `@Service()` class that declares no constructor is injected with the dependencies of its parent's (see [Inherited Constructors](/api/decorators#inherited-constructors)), so the first suggestion says so and names the parent — `NightlyScheduler declares no constructor of its own, so it is injected with the parameters of the constructor it inherits from Scheduler (Clock, ReportSink). ...`. Since 0.9.0; such a class used to boot with the field `undefined`

Matching is by class **identity**, not by name: a same-named class in a package this application never imports is not a candidate, and it does not suppress the "decorate it with `@Service()` and list it in a module's providers" advice, which prints whenever nothing else matched.

### Circular Dependencies

The order of `providers` does not matter. Each provider is constructed after the providers of its
own module that it injects, whatever order the array lists them in — a consumer may come first:

```typescript
import { BaseService, Module, Service } from '@onebun/core';

@Service()
export class Database extends BaseService {}

@Service()
export class UserRepository extends BaseService {
  constructor(private database: Database) {
    super();
  }
}

@Service()
export class UserService extends BaseService {
  constructor(private repository: UserRepository) {
    super();
  }
}

@Module({
  // Consumers first: Database is still constructed first, then UserRepository, then UserService
  providers: [UserService, UserRepository, Database],
})
export class UserModule {}
```

A parameter typed as an abstract or base class, which DI resolves to a registered subclass (see
[Architecture](/architecture#explicit-injection-edge-cases)), follows the same rule: the consumer
waits until a provider of its module that extends the type is built, so it may be listed before
that implementation and before the implementation's own dependencies. The one exception is an
`@Optional()` parameter of that kind: it does not wait, so list the implementation first — see
[@Optional()](/api/decorators#optional).

The construction order is deterministic: providers are taken in the listed order, and one whose
dependency is not built yet goes to the back of the queue. A list that already puts dependencies
first is therefore built exactly in the listed order, and `onModuleInit` runs in that order too. A
consumer-first list boots however long its chain is — `CircularDependencyError` is reserved for a
real cycle (below).

A real cycle (A → B → A) is detected and throws `CircularDependencyError`. The chain names only the
cycle: a provider that merely waits on it — `X` in `X -> Y -> Z -> Y` — is listed among the
unresolved services, not in the chain.

```
CircularDependencyError: Circular dependency detected in module AppModule!
Dependency chain: ServiceA -> ServiceB -> ServiceA
Unresolved services: ServiceA, ServiceB
```

Restructure your code to break the cycle — e.g., extract the shared logic into a third service.

A class in the chain that declares no constructor is injected with the parameters of the one it
inherits (see [Inherited Constructors](/api/decorators#inherited-constructors)), so the chain names
it for a dependency it never mentions. The error then carries a note for it in `notes`, printed
after the unresolved services: `- UserRepo declares no constructor of its own, so it is injected
with the parameters of the constructor it inherits from RepoBase (EventBus): that is where it needs
EventBus (EventBusImpl). ...`. Since 0.9.0.

A provider waiting for a provider of its module that was never constructed is not a cycle. It fails
with `DependencyResolutionError` naming that dependency and why it has no instance: this copy of
`@onebun/core` sees no `@Service()` on it — it is undecorated, or decorated by a second copy of the
framework:

```
DependencyResolutionError: Could not resolve dependency UserRepository for service UserService.
  - UserRepository is listed in the providers of UserModule, but was never constructed: this copy of @onebun/core sees no @Service() on it, so it was skipped. Decorate it with @Service(). If it already is, the application resolves two copies of @onebun/core — deduplicate the dependency.
```

For an abstract-typed parameter the dependency named is the parameter's type, and the hint names the
provider extending it that was never constructed — `StripeGateway (it extends PaymentGateway)`. An
`@Optional()` parameter does not fail here: see [@Optional()](/api/decorators#optional). A provider
whose constructor throws is not reported this way at all — see
[When a Constructor Throws](#when-a-constructor-throws).

### When a Constructor Throws

A provider whose constructor throws ends the boot at the throw, with a `ServiceConstructionError`
that names the service and its module, followed by the constructor's own error:

```
ServiceConstructionError: Failed to create service PaymentService in module BillingModule: Error: Configuration not initialized. Provide envSchema in ApplicationOptions.
```

```typescript
import { BaseService, Module, OneBunApplication, Service, ServiceConstructionError } from '@onebun/core';

@Service()
export class PaymentService extends BaseService {
  private readonly apiKey: string;

  constructor() {
    super();
    // Throws when the application was created without envSchema
    this.apiKey = this.config.get('payments.apiKey');
  }
}

@Module({ providers: [PaymentService] })
export class BillingModule {}

const app = new OneBunApplication(BillingModule, { port: 0 });

try {
  await app.start();
} catch (error) {
  if (error instanceof ServiceConstructionError) {
    error.serviceName; // 'PaymentService'
    error.moduleName;  // 'BillingModule'
    error.cause;       // the Error the constructor threw, unchanged
  }
}
```

- `cause` is the thrown value itself, so `error.cause instanceof YourError` holds and its fields are
  there.
- `stack` holds the frames of the original throw, so the first one points at the constructor line
  that threw rather than at the framework.
- It fails the same way whether a consumer is in the same module, in a module that imports this
  one, a controller, an `@Optional()` parameter, or nothing at all.
- `TestingModule` included: its logger is silent, but the error is the rejection of `compile()`,
  not a log line.
- A throw from what the framework runs on the new instance right after the constructor is
  reported the same way: the `initializeService()` it calls on a provider that defines one, or
  wrapping its methods for `tracing.traceAll`.

An error the framework raises for its own reasons — a `OneBunBootstrapError` such as
`DependencyResolutionError`, or an error whose `name` starts with `OneBun` — is not wrapped: it
already names what is wrong.

The boot fails while the module tree is still being built, before the application holds it, so
the rollback of the failed `start()` runs no destroy hook. A provider constructed before the throw,
in this module or in one it imports, does not get its `onModuleDestroy`, and whatever its
constructor opened stays open: a timer or a connection keeps the process alive after a caught
rejection. Open resources in `onModuleInit`, which runs only once every provider is built.

The most common trigger is `this.config.get()` in a constructor of an application created without
`envSchema`: the configuration is then a stub whose every `get()` throws. See
[Accessing Configuration](#accessing-configuration).

::: warning Changed in 0.9.0
Up to 0.8.x the error was logged as `Failed to create service <Name>` and the service was dropped.
What surfaced was a failure elsewhere, and the real error was only in the log — under
`TestingModule`, the silent logger, where it never showed:

- a consumer in another module, or a controller, failed with `DependencyResolutionError: Could not
  resolve dependency <Name>`, although the dependency is decorated and listed;
- a consumer in the same module failed with a `CircularDependencyError` through 0.8.1, and from
  0.8.2 with a `DependencyResolutionError` whose hint pointed at the log;
- from 0.8.2, an `@Optional()` consumer got `undefined`, with a warning;
- with no consumer, the application booted without the service.

**Migration:** an application that booted with a provider whose constructor throws — nothing
injects it, or only an `@Optional()` parameter — now fails `start()`. Fix what the constructor
throws on (for `Configuration not initialized`, pass `envSchema`), or remove the provider from
`providers`. Code that caught `DependencyResolutionError` to detect a failing constructor should
catch `ServiceConstructionError` and read `cause`.
:::

### Optional Dependencies

Use `@Optional()` to allow a dependency to be `undefined` when not available:

```typescript
@Service()
export class AnalyticsService extends BaseService {
  constructor(@Optional() private metrics?: MetricsCollector) {
    super();
  }
}
```

See [@Optional()](/api/decorators#optional) for details.

## Lifecycle Hooks

Services can implement lifecycle hooks to execute code at specific points in the application lifecycle.

### Available Hooks

| Interface | Method | When Called |
|-----------|--------|-------------|
| `OnModuleInit` | `onModuleInit()` | After service instantiation and DI |
| `OnApplicationInit` | `onApplicationInit()` | After all modules initialized, before HTTP server starts |
| `OnModuleDestroy` | `onModuleDestroy()` | During shutdown, after HTTP server stops |
| `BeforeApplicationDestroy` | `beforeApplicationDestroy(signal?)` | After the drain and listener close — first hook of the teardown |
| `OnApplicationDestroy` | `onApplicationDestroy(signal?)` | At the very end of shutdown |

The destroy hooks also run when `start()` fails: the failed boot runs the shutdown sequence over
every instance it built before rethrowing — including one whose `onModuleInit` never ran or threw
halfway. Release what exists, as `DatabaseService` below does with `if (this.pool)`. See
[When `start()` fails](./core.md#when-start-fails).

::: warning Destroy hooks run after the server is gone
`beforeApplicationDestroy` is the first *hook*, not the first act of shutdown. Three phases precede
it: new requests are answered `503`, the in-flight ones are drained (force-closed once the drain
budget — half of `shutdownTimeout`, 7.5s by default — expires), and the HTTP listener is closed. A
request issued from inside a destroy hook to the application's own server fails to connect, so these
hooks are for cleanup, not for serving or self-calling. See
[Graceful Shutdown](./core.md#graceful-shutdown) for the full sequence.
:::

::: tip Eager Instantiation & Standalone Services
All services listed in `providers` are instantiated **eagerly** during module initialization — not lazily on first use. `onModuleInit` is called for **every** service that implements the interface, even if the service is not injected into any controller or other service.

This makes it safe to use "standalone" services whose main work happens inside `onModuleInit` — for example, cron schedulers, event listeners, or background workers.
:::

::: info Initialization Order
Pipeline elements get the module hooks too, on the instance that actually serves requests. A **middleware** or **interceptor** class receives `onModuleInit`, `onApplicationInit`, `onModuleDestroy` and `onApplicationDestroy` — the init hook runs in a pass of its own, after routes are registered and before the server accepts anything, because that is when those instances exist. **Guards do not**: a guard class is constructed per request by design, so there is no single instance for a hook to belong to, and a guard implementing `onModuleInit` is reported at startup rather than silently skipped. Put the setup in a `@Service()` the guard injects.

`onModuleInit` hooks are called **sequentially in dependency order**: if service A depends on service B, then B's `onModuleInit` will complete **before** A's `onModuleInit` starts. This guarantees that when your `onModuleInit` runs, all injected dependencies are already fully initialized.
:::

::: tip Cross-Module Lifecycle
`onModuleInit` is called for services and controllers in **all modules** across the entire import tree — not just the root module. If `AppModule` imports `UserModule` which imports `AuthModule`, then services in all three modules will have their `onModuleInit` called: `AuthModule`'s first, then `UserModule`'s, then `AppModule`'s. Every imported module is initialized before the module that imports it — see [Initialization Across Modules](#initialization-across-modules).
:::

### Usage

Implement lifecycle interfaces to hook into the application lifecycle:

```typescript
// The lifecycle interfaces are type-only exports, so they need `type` — the scaffold that
// `bun create @onebun` writes sets `verbatimModuleSyntax`, under which a value import of them
// is TS1484.
import {
  Service,
  BaseService,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@onebun/core';

@Service()
export class DatabaseService extends BaseService implements OnModuleInit, OnModuleDestroy {
  private pool: ConnectionPool | null = null;

  async onModuleInit(): Promise<void> {
    // Called after DI, before application starts
    this.pool = await createPool(this.config.get('database.url'));
    this.logger.info('Database pool initialized');
  }

  async onModuleDestroy(): Promise<void> {
    // Called during graceful shutdown
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Database pool closed');
    }
  }

  async query<T>(sql: string): Promise<T[]> {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }
    return this.pool.query(sql);
  }
}
```

::: warning Destroy hooks are bounded
`shutdownTimeout` (default **15000 ms**) caps the *whole* shutdown sequence, and the in-flight HTTP
drain may consume the first half of it — so `await this.pool.end()` above is not guaranteed to
finish. When the budget runs out the framework stops **waiting**; it does not cancel. On
`await app.stop()` the call resolves at the deadline and logs
`Shutdown timed out after <N>ms while running onModuleDestroy hooks; abandoning the rest of the teardown`,
while the overrunning hook and every hook after it keep running unawaited and complete *after*
`stop()` has already returned. On the SIGTERM/SIGINT path the process exits with code **1** as soon
as `stop()` resolves, so those trailing hooks are killed mid-flight and never complete; a shutdown
that finishes inside the budget exits **0**. Keep destroy hooks well under the budget, or raise
[`shutdownTimeout`](./core.md#graceful-shutdown).
:::

### Standalone Service Example

A service that is not injected anywhere but performs useful work via `onModuleInit`:

```typescript
import { Service, BaseService, type OnModuleInit, type OnModuleDestroy } from '@onebun/core';

@Service()
export class TaskSchedulerService extends BaseService implements OnModuleInit, OnModuleDestroy {
  private intervalId: Timer | null = null;

  async onModuleInit(): Promise<void> {
    // Start background work — no injection needed
    this.intervalId = setInterval(() => {
      this.logger.debug('Running scheduled task...');
    }, 60_000);
    this.logger.info('Task scheduler started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
```

Then simply register it in a module's `providers`:

```typescript
@Module({
  providers: [TaskSchedulerService],
  // No controllers or other services reference it — it works on its own
})
export class SchedulerModule {}
```

### Shutdown Hooks with Signal

The shutdown hooks receive the signal that triggered the shutdown (e.g., `SIGTERM`, `SIGINT`) — in
multi-service mode it is always `undefined`, because the parent stops each child with a bare
`stop()`, so keep the `|| 'unknown'` fallback:

```typescript
import { 
  Service, 
  BaseService, 
  BeforeApplicationDestroy, 
  OnApplicationDestroy 
} from '@onebun/core';

@Service()
export class CleanupService extends BaseService 
  implements BeforeApplicationDestroy, OnApplicationDestroy {

  async beforeApplicationDestroy(signal?: string): Promise<void> {
    this.logger.info(`Shutdown initiated by ${signal || 'unknown'}`);
    // Notify external services, flush buffers, etc.
  }

  async onApplicationDestroy(signal?: string): Promise<void> {
    this.logger.info('Final cleanup completed');
    // Last chance to do cleanup
  }
}
```

### Initialization Across Modules

Services' `onModuleInit` hooks run one at a time, one module at a time: **every imported module
before the module that imports it**. The deepest import goes first and the root module last; within
a module the hooks run in dependency order. So when a hook runs, the hooks of everything the service
injects have completed, whether the dependency is a provider of its own module or an export of an
import:

```typescript
import { BaseService, Module, Service, type OnModuleInit } from '@onebun/core';

@Service()
export class ConnectionService extends BaseService implements OnModuleInit {
  private open = false;

  async onModuleInit(): Promise<void> {
    // Open the pool here, not in the constructor
    this.open = true;
  }

  async query(sql: string): Promise<string[]> {
    if (!this.open) {
      throw new Error('Connection is not open yet');
    }

    return [sql];
  }
}

@Module({ providers: [ConnectionService], exports: [ConnectionService] })
export class DatabaseModule {}

@Service()
export class CatalogService extends BaseService implements OnModuleInit {
  private products: string[] = [];

  constructor(private readonly db: ConnectionService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // DatabaseModule's hooks have completed: the connection is open
    this.products = await this.db.query('SELECT name FROM products');
  }

  list(): string[] {
    return this.products;
  }
}

@Module({ imports: [DatabaseModule], providers: [CatalogService] })
export class AppModule {}
```

- A `@Global()` module is built before the rest of the tree, so its services are initialized among
  the first, even when it is listed last in `imports`.
- A module imported by several others is built and initialized once.
- Controllers' `onModuleInit` runs after the service hooks of the whole tree.
- A hook that throws stops the pass there: no later hook runs, none in the modules importing its
  module in particular, and `start()` rejects. The destroy hooks still run over every instance that
  was built (see [When `start()` fails](./core.md#when-start-fails)).
- `TestingModule.create({ providers, imports })` builds its root module from `providers`, so those
  providers are initialized after everything in `imports`.

::: warning Changed in 0.9.0
Up to 0.8.x the **root module's** own services were initialized first, before any imported
module's; below the root, imports already went first. `CatalogService` above, declared in the root
module, queried a connection whose hook had not run yet.

**Migration:** only the hooks of the root module's services move — they now run last. The same
holds for the `providers` passed to `TestingModule.create()`. Check a root-module hook that an
imported module relied on having run first, for example one that prepares state an imported
service's `onModuleInit` reads: do that work in the constructor instead, or move the reading side
to `onApplicationInit`, which runs after every `onModuleInit`. Code that worked around the old
order, such as waiting inside a root service's hook for an imported service to finish
initializing, can be removed.

Check the root module's `onModuleDestroy` hooks too. When an imported module's `onModuleInit`
throws — typically a database or cache unreachable at boot — no root-module hook has run yet, but
the failed `start()` still runs `onModuleDestroy` on every service it built. Up to 0.8.x the root's services had been
initialized by then; now their destroy hooks find nothing set up, so guard them on the state the
init hook creates, as `DatabaseService` above does with `if (this.pool)`.
:::

### Lifecycle Order

```
STARTUP:
1. Framework sets ambient init context (logger + config)
2. Service instantiation → constructor()
   └─ super() picks up logger and config from init context
   └─ this.config and this.logger are available after super()
3. Framework clears init context
4. Framework calls initializeService() (no-op if already initialized via constructor)
5. Module init hook → onModuleInit()  (sequential: imported modules first, then in dependency order)
6. Application init hook → onApplicationInit()
7. HTTP server starts

SHUTDOWN:
1. New requests answered 503 — the listener stays open on purpose
2. In-flight requests drained (force-closed once the drain deadline expires)
3. HTTP listener closed
4. Before destroy hook → beforeApplicationDestroy(signal)
5. WebSockets closed, queue stopped and disconnected, traces flushed
6. Module destroy hook → onModuleDestroy()
7. Shared Redis: the application releases nothing — the cache and the queue adapter gave their holds back when they closed; a debug line names any remaining holder
8. Application destroy hook → onApplicationDestroy(signal)
9. Logger transport flushed

FAILED START (a startup step threw):
1. The error is logged
2. The SHUTDOWN sequence runs over what was built; steps with nothing to release are skipped,
   and a loggerLayer, spanProcessors or metrics registry passed in options is left open
3. start() rejects with the error it caught (an onModuleInit failure arrives wrapped by
   Effect as a FiberFailure, message intact) — a stop() before the next start() runs no
   step again; it only closes what step 2 left open, as every stop() does
```

A destroy hook cannot serve or reach the application's own HTTP server: the listener is
closed at step 3, before hook 4, and a request to it from inside a hook is refused at the socket.

## Accessing Logger

```typescript
@Service()
export class EmailService extends BaseService {
  async send(to: string, subject: string, body: string): Promise<boolean> {
    this.logger.info('Sending email', { to, subject });

    try {
      // Send email logic
      await this.smtp.send({ to, subject, body });
      this.logger.info('Email sent successfully', { to });
      return true;
    } catch (error) {
      this.logger.error('Failed to send email', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
```

### Log Levels

```typescript
this.logger.trace('Very detailed info');  // Level 0
this.logger.debug('Debug information');   // Level 1
this.logger.info('General information');  // Level 2
this.logger.warn('Warning message');      // Level 3
this.logger.error('Error occurred');      // Level 4
this.logger.fatal('Fatal error');         // Level 5
```

### Logging with Context

```typescript
// Additional context as object
this.logger.info('User action', {
  userId: user.id,
  action: 'login',
  ip: request.ip,
});

// Error logging
this.logger.error('Operation failed', new Error('Something went wrong'));

// Multiple arguments
this.logger.debug('Processing', data, { step: 1 }, 'extra info');
```

## Accessing Configuration

```typescript
@Service()
export class DatabaseService extends BaseService {
  private readonly connectionUrl: string;
  private readonly maxConnections: number;

  constructor() {
    super();

    // Config is available immediately after super()
    // With InferConfigType + module augmentation, these are fully typed — no casts needed
    this.connectionUrl = this.config.get('database.url');
    this.maxConnections = this.config.get('database.maxConnections');
  }

  async connect(): Promise<void> {
    // Config is also available in regular methods
    this.logger.info('Connecting to database', { maxConnections: this.maxConnections });
    // ...
  }
}
```

`this.config` is live only when the application passes `envSchema`. Without it, every `get()`
throws `Configuration not initialized. Provide envSchema in ApplicationOptions.` — from a
constructor, that fails the boot with a `ServiceConstructionError` naming the service (see
[When a Constructor Throws](#when-a-constructor-throws)).

## Service with Tracing

Use `@Span()` decorator to create trace spans:

```typescript
import { Service, BaseService } from '@onebun/core';
import { Span } from '@onebun/trace';

@Service()
export class OrderService extends BaseService {
  @Span('create-order')
  async createOrder(data: CreateOrderDto): Promise<Order> {
    this.logger.info('Creating order', { customerId: data.customerId });

    // All code inside is traced
    const order = await this.repository.create(data);
    await this.notificationService.notify(data.customerId, order.id);

    return order;
  }

  @Span('process-payment')
  async processPayment(orderId: string, amount: number): Promise<PaymentResult> {
    // Traced operation
    return this.paymentGateway.charge(orderId, amount);
  }

  @Span()  // Default span name is `ClassName.methodName`
  async validateOrder(order: Order): Promise<boolean> {
    // Span name: "OrderService.validateOrder" — the class prefix is part of it
    return this.validator.validate(order);
  }
}
```

## Using Effect.js in Services

### Bridge: Effect to Promise

```typescript
import { Service, BaseService, Effect } from '@onebun/core';
import { pipe } from 'effect';

@Service()
export class DataService extends BaseService {
  // Internal Effect-based implementation
  private fetchDataEffect(id: string): Effect.Effect<Data, FetchError, never> {
    return pipe(
      Effect.tryPromise({
        try: () => fetch(`/api/data/${id}`).then(r => r.json()),
        catch: (e) => new FetchError(String(e)),
      }),
      Effect.tap((data) =>
        Effect.sync(() => this.logger.debug('Data fetched', { id }))
      ),
    );
  }

  // Public Promise-based API
  async fetchData(id: string): Promise<Data> {
    const effect = pipe(
      this.fetchDataEffect(id),
      Effect.retry({ times: 3, delay: '1 second' }),
    );

    return this.runEffect(effect);
  }
}
```

### runEffect Helper

The `runEffect` method handles Effect execution:

<!-- typecheck: skip -->
```typescript
protected async runEffect<A>(effect: Effect.Effect<never, never, A>): Promise<A> {
  try {
    return await Effect.runPromise(effect);
  } catch (error) {
    throw this.formatError(error);
  }
}
```

## Repository Pattern

Services often work with repositories:

```typescript
// user.repository.ts
import { Service, BaseService } from '@onebun/core';
import { DrizzleService, eq } from '@onebun/drizzle';
import { users } from './schema';

@Service()
export class UserRepository extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] || null;
  }

  async findAll(options?: { limit?: number; offset?: number }): Promise<User[]> {
    return await this.db.select().from(users)
      .limit(options?.limit || 100)
      .offset(options?.offset || 0);
  }

  async create(data: InsertUser): Promise<User> {
    const result = await this.db.insert(users).values(data).returning();
    return result[0];
  }

  async update(id: string, data: Partial<InsertUser>): Promise<User | null> {
    const result = await this.db.update(users).set(data).where(eq(users.id, id)).returning();
    return result[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }
}

// user.service.ts
@Service()
export class UserService extends BaseService {
  constructor(
    private repository: UserRepository,
    private cacheService: CacheService,
    private eventService: EventService,
  ) {
    super();
  }

  async createUser(data: CreateUserDto): Promise<User> {
    // Business logic
    const existingUser = await this.repository.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictError('Email already exists');
    }

    // Create user
    const user = await this.repository.create({
      ...data,
      password: await hash(data.password),
    });

    // Side effects
    await this.eventService.emit('user.created', { userId: user.id });

    this.logger.info('User created', { userId: user.id });
    return user;
  }
}
```

## Service Tags (Advanced)

For advanced Effect.js usage, you can create custom tags:

```typescript
import { Service, BaseService } from '@onebun/core';
import { Context } from 'effect';

// Create custom tag
export const UserServiceTag = Context.GenericTag<UserService>('UserService');

@Service(UserServiceTag)
export class UserService extends BaseService {
  // Service with explicit tag
}

// Use in Effect-based code
const program = pipe(
  UserServiceTag,
  Effect.flatMap((userService) => Effect.promise(() => userService.findAll())),
);
```

## Complete Service Example

```typescript
import { Service, BaseService, type } from '@onebun/core';
import { Span } from '@onebun/trace';
import { CacheService } from '@onebun/cache';

// Types
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

interface CreateUserDto {
  name: string;
  email: string;
  password: string;
}

interface UpdateUserDto {
  name?: string;
  email?: string;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

@Service()
export class UserService extends BaseService {
  private users = new Map<string, User>();

  constructor(private cacheService: CacheService) {
    super();
  }

  @Span('user-find-all')
  async findAll(options?: { page?: number; limit?: number }): Promise<PaginatedResult<User>> {
    const page = options?.page || 1;
    const limit = options?.limit || 10;
    const offset = (page - 1) * limit;

    this.logger.debug('Finding all users', { page, limit });

    const allUsers = Array.from(this.users.values());
    const items = allUsers.slice(offset, offset + limit);

    return {
      items,
      total: allUsers.length,
      page,
      limit,
    };
  }

  @Span('user-find-by-id')
  async findById(id: string): Promise<User | null> {
    // Check cache
    const cacheKey = `user:${id}`;
    const cached = await this.cacheService.get<User>(cacheKey);

    if (cached) {
      this.logger.trace('User cache hit', { id });
      return cached;
    }

    this.logger.trace('User cache miss', { id });
    const user = this.users.get(id) || null;

    if (user) {
      await this.cacheService.set(cacheKey, user, { ttl: 300 });
    }

    return user;
  }

  @Span('user-create')
  async create(data: CreateUserDto): Promise<User> {
    // Check for duplicate email
    const existingUser = await this.findByEmail(data.email);
    if (existingUser) {
      this.logger.warn('Duplicate email attempt', { email: data.email });
      throw new Error('Email already exists');
    }

    const user: User = {
      id: crypto.randomUUID(),
      name: data.name,
      email: data.email,
      createdAt: new Date(),
    };

    this.users.set(user.id, user);
    this.logger.info('User created', { userId: user.id, email: user.email });

    return user;
  }

  @Span('user-update')
  async update(id: string, data: UpdateUserDto): Promise<User | null> {
    const user = this.users.get(id);

    if (!user) {
      this.logger.warn('User not found for update', { id });
      return null;
    }

    const updatedUser = { ...user, ...data };
    this.users.set(id, updatedUser);

    // Invalidate cache
    await this.cacheService.delete(`user:${id}`);

    this.logger.info('User updated', { userId: id, fields: Object.keys(data) });
    return updatedUser;
  }

  @Span('user-delete')
  async delete(id: string): Promise<boolean> {
    const deleted = this.users.delete(id);

    if (deleted) {
      await this.cacheService.delete(`user:${id}`);
      this.logger.info('User deleted', { userId: id });
    }

    return deleted;
  }

  private async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }
}
```
