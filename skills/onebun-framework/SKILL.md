---
name: onebun-framework
description: >
  Idiomatic usage of the OneBun framework (@onebun/*) for Bun.js applications.
  Use this skill whenever the user is building, modifying, or reviewing code that uses
  OneBun — modules, services, controllers, middleware, guards, interceptors, exception filters,
  HttpException, security (CORS, rate limiting, security headers), database (Drizzle),
  caching, NATS messaging, environment config, validation, or any @onebun/* package.
  Trigger on any mention of OneBun, @onebun/core, @onebun/drizzle, @onebun/cache,
  @onebun/nats, @onebun/metrics, @onebun/trace, @onebun/requests, @onebun/envs,
  @onebun/logger, @onebun/docs, or when the user is creating Bun.js services with
  NestJS-like module architecture. Also trigger when the codebase already imports from
  @onebun/* packages, even if the user doesn't mention OneBun explicitly.
---

# OneBun Framework — Idiomatic Usage Guide

OneBun is a Bun.js framework inspired by NestJS with module architecture, type-safe DI,
and built-in observability. This skill ensures you write correct, idiomatic OneBun code.

## Critical Rule — Documentation Lookup Hierarchy

**Always check the latest OneBun documentation before writing code.** The framework updates
frequently, and outdated patterns cause hard-to-debug issues. Use this three-tier lookup order:

### 1. Context7 (primary — fastest, most structured)

Use the Context7 MCP tool with library ID `/remryahirev/onebun` to verify current API,
decorators, and patterns before implementing anything non-trivial.

```
Context7 query: "How to [specific thing] in OneBun"
Library ID: /remryahirev/onebun
```

### 2. Official documentation site (fallback if Context7 lacks info)

Fetch `https://onebun.dev/llms-full.txt` via WebFetch — that is the complete documentation in a
single file (~650 KB), rebuilt on every release.

```
WebFetch: url="https://onebun.dev/llms-full.txt" prompt="How to [specific thing]"
```

**Do not fetch `llms.txt` for answers.** Despite the name, `https://onebun.dev/llms.txt` is the
llms.txt-standard *index* — ~5 KB of links, zero API content. Fetching it and finding nothing is
not evidence that the docs lack the answer; it means you fetched the table of contents. Use it only
when you want the list of page URLs.

### 3. Source code (last resort)

Only read source files directly when neither Context7 nor onebun.dev has the answer — for
example, when investigating internal implementation details or undocumented edge cases.
Start with the relevant package's `src/` directory and look at types/interfaces first.

## Packages Overview

| Package | Purpose |
|---|---|
| `@onebun/core` | DI, modules, controllers, services, guards, exception filters, middleware, security, WebSocket, queues |
| `@onebun/drizzle` | Drizzle ORM integration (SQLite, PostgreSQL) |
| `@onebun/cache` | In-memory and Redis caching |
| `@onebun/nats` | NATS / JetStream queue backend |
| `@onebun/envs` | Type-safe environment config (re-exported as `Env` from core) |
| `@onebun/logger` | Structured logging (consumed via `BaseService.logger`) |
| `@onebun/metrics` | Prometheus-compatible metrics |
| `@onebun/trace` | OpenTelemetry tracing |
| `@onebun/requests` | HTTP client with retries and tracing |
| `@onebun/docs` | OpenAPI 3.1 spec generation |

## Project Structure

```
src/
  index.ts              — bootstrap: new OneBunApplication(AppModule, opts)
  config.ts             — envSchema using Env.string/number/boolean
  app.module.ts         — root @Module with imports of infrastructure + domain modules
  db/
    schema.ts           — Drizzle table definitions
    migrations/         — auto-generated SQL migrations
  {domain}/
    {domain}.module.ts  — @Module({ controllers, providers, exports })
    {domain}.service.ts — @Service() extends BaseService
    {domain}.controller.ts — @Controller() extends BaseController
    {domain}.repository.ts — @Service() extends BaseService, injects DrizzleService (optional)
  auth/
    *.middleware.ts     — @Middleware() extends BaseMiddleware
  validation/
    schemas.ts          — ArkType schemas for HTTP validation
```

## Bootstrap

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  envSchema,
});

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

### Multi-Service Mode

`OneBunApplication` also supports running multiple services from a single process via
constructor overloading — pass an options object with `services` instead of a module class:

```typescript
import { OneBunApplication } from '@onebun/core';

const app = new OneBunApplication({
  services: {
    users: { module: UsersModule, port: 3001, routePrefix: true },
    orders: { module: OrdersModule, port: 3002, routePrefix: true },
  },
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true },
});

await app.start();
app.getRunningServices();              // ['users', 'orders']
app.getServiceUrl('users');            // 'http://0.0.0.0:3001'
app.getApplication('users');           // OneBunApplication | undefined
```

Multi-service mode methods: `getApplication(name)`, `getServiceUrl(name)`,
`getRunningServices()`, `isServiceRunning(name)`. Single-service methods
(`getConfig`, `getPort`, etc.) throw in multi-service mode — reach them through the
sub-application instead.

**`getApplication()` returns `OneBunApplication | undefined`** — it is a `Map.get` on the
running-applications map, so it is `undefined` for an unknown name and before `start()` resolves.
Always use optional chaining; `app.getApplication('users').getPort()` is a TS2532 error under
`strict`, which the scaffolded tsconfig turns on.

<!-- typecheck: skip -->
```typescript
app.getApplication('users')?.getPort();
await app.getApplication('users')?.stop({ closeSharedRedis: false });
```

## Environment Config

Define in `src/config.ts`. **All defaults belong here, not in service class properties.**
`this.config` is available in constructors (after `super()`), so there's no need for
property-level defaults with `?? fallback` patterns.

```typescript
import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000, env: 'PORT' }),
    host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
  },
  db: {
    path: Env.string({ default: './data/app.db', env: 'DB_PATH' }),
  },
  auth: {
    apiKey: Env.string({ env: 'API_KEY', default: 'dev-key' }),
  },
  budget: {
    reserveFloorCents: Env.number({ env: 'BUDGET_RESERVE_FLOOR_CENTS', default: 2000 }),
  },
};

// REQUIRED: module augmentation for proper typed config access
export type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}
```

The module augmentation (`InferConfigType` + `declare module`) is **required** for
`this.config.get()` to have proper types. Without it, config values are untyped.

Access in services/controllers: `this.config.get('server.port')` — dot-path notation.
Available in constructor after `super()` call.

### Pre-initialization config with `getConfig()`

For accessing typed config **before** `OneBunApplication` is created (e.g., to configure
`ApplicationOptions` dynamically). Synchronous, cached by schema reference.

```typescript
import { OneBunApplication, getConfig } from '@onebun/core';
import { envSchema, type AppConfig } from './config';

const config = getConfig<AppConfig>(envSchema);  // synchronous — no await

const app = new OneBunApplication(AppModule, {
  envSchema,
  cors: { origin: config.get('server.corsOrigin') },
  rateLimit: {
    windowMs: config.get('rateLimit.windowMs'),
    max: config.get('rateLimit.max'),
  },
  queue: {
    adapter: JetStreamQueueAdapter,
    options: {
      servers: config.get('nats.url'),
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],  // required by JetStream
    },
  },
});
```

Key points:
- Same `.get(path)` API as `this.config` in services
- Results cached per schema reference (`WeakMap`) — calling twice returns same instance
- Accepts same `EnvLoadOptions` as second argument (envFilePath, loadDotEnv, valueOverrides, etc.)
- `clearGetConfigCache()` available for testing

## Modules

```typescript
import { Module, Global } from '@onebun/core';

@Module({
  imports: [OtherModule],           // import other modules
  controllers: [MyController],      // HTTP controllers
  providers: [MyService, MyRepo],   // injectable services
})
export class MyModule {}
```

**`exports` only when needed**: Only add `exports: [MyService]` if another module imports
this module and needs to inject that service. Don't export by default.

```typescript
// Use @Global() to make exports available everywhere without importing
@Global()
@Module({
  providers: [SharedService],
  exports: [SharedService],
})
export class SharedModule {}
```

**One @Global() service instance per application** — not per process, and in multi-service mode
one per sub-application. Two applications in the same process each build their own, so a second
`DrizzleModule.forRoot()` or `CacheModule.forRoot()` opens its own connection rather than
silently reusing the first one's. The options a dynamic module is imported with are captured
per application at import time.

**Class-based providers only.** An object entry — `{ provide: X, useValue: v }` — throws
`OneBunInvalidProviderError` naming the module. Substitute implementations with
`TestingModule.overrideProvider()` instead.

**`exports` accepts services, never modules.** `exports: [SomeModule]` — the NestJS re-export
idiom — throws `OneBunInvalidExportError`. Import the module that provides the service directly
wherever the service is needed.

**Import order is not semantic.** A `@Global()` module's services reach every module regardless
of where it sits in an `imports` array, and whether or not the importing module lists it at all.

## Services

```typescript
import {
  Service, BaseService, type OnModuleInit, type OnModuleDestroy,
} from '@onebun/core';

@Service()
export class MyService extends BaseService implements OnModuleInit, OnModuleDestroy {
  // Config values as class fields — initialized from this.config in constructor
  private readonly reserveFloor: number;

  constructor(private otherService: OtherService) {
    super();
    // this.logger and this.config available after super()
    this.reserveFloor = this.config.get('budget.reserveFloorCents');
  }

  async onModuleInit(): Promise<void> {
    // Called after DI wiring, before HTTP server starts
    this.logger.info('MyService initialized');
  }

  async onModuleDestroy(): Promise<void> {
    // Called on graceful shutdown — clean up timers, connections
  }

  doWork() {
    this.logger.info('Working', { key: 'value' });     // structured logging
    const port = this.config.get('server.port');        // typed config access
  }
}
```

Key rules:
- Always `extends BaseService` — provides `this.logger` and `this.config`
- Constructor injection by type — no `@Inject()` tokens needed
- **Lifecycle interfaces are type-only exports** — import them as `type OnModuleInit`, otherwise
  TS1484 under `verbatimModuleSyntax`, which `bun create @onebun` writes into the scaffolded tsconfig
- **`implements OnModuleInit` is a style rule, not a runtime requirement.** The framework
  duck-types the *instance* (`'onModuleInit' in obj && typeof obj.onModuleInit === 'function'`), so
  a class carrying only the method gets every hook called. Write `implements` anyway — it is the only
  thing that turns a misspelled `onModulInit` into a compile error instead of a hook that silently
  never fires
- `this.config` is available in the constructor (after `super()`), so use it there for
  config-derived fields instead of hardcoding defaults in class properties.
  Cost: such a service cannot be built by `createTestService` — see Testing below
- All defaults belong in `envSchema` (config.ts), not in service code
- Use `onModuleInit` only for async initialization that can't be done in constructor

## Controllers

See `references/controllers.md` for the full decorator reference.

```typescript
import {
  Controller, BaseController, Get, Post, Put, Delete,
  Param, Query, Body, Header, Cookie, Req,
  UseMiddleware, HttpStatusCode, HttpException,
  type OneBunRequest,
} from '@onebun/core';
import { type CreateItemBody, type UpdateItemBody } from '../validation/schemas';

@Controller('/api/items')
@UseMiddleware(AuthMiddleware)    // class-level middleware
export class ItemController extends BaseController {
  constructor(private itemService: ItemService) {
    super();
  }

  @Get('/')
  async findAll(@Query('limit') limit?: string) {
    return this.itemService.findAll(limit ? parseInt(limit) : 10);
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    const item = await this.itemService.findById(id);
    if (!item) throw new HttpException(HttpStatusCode.NOT_FOUND, 'Not found');
    return item;
  }

  @Post('/')
  async create(@Body(createItemSchema) body: CreateItemBody) {
    return this.itemService.create(body);
  }
}
```

**Important rules:**
- **Leading slash is optional** in `@Controller()` and route decorators. `@Controller('users')`
  equals `@Controller('/users')`, `@Get(':id')` equals `@Get('/:id')`. NestJS-style paths work as-is.
- Return plain data from controller methods — auto-wrapped to `{ success: true, result: data }`
- Throw `HttpException` for errors — auto-converted to `{ success: false, error: message, code: statusCode }`
- Use `OneBunRequest` (not `Request`) with `@Req()` decorator
- ArkType schema `infer` types should be exported from the validation file as named types,
  then imported and used in controllers — don't inline `typeof schema.infer` in controller signatures
- **Route ordering does not matter**: Bun's router resolves by specificity (static > parametric > wildcard),
  so declaration order in controllers has no effect on matching

Response patterns (in priority order):
- Return plain data → auto-wrapped to `{ success: true, result: data }` with HTTP 200
- `throw new HttpException(statusCode, message)` → `{ success: false, error: message, code: statusCode }` with real HTTP status
- `this.success(data, statusCode)` → explicit success with custom HTTP status (e.g., 201 Created)
- `this.error(message, code, statusCode)` → explicit error response (legacy, prefer HttpException)

## Middleware

**Middleware is class-based only. There is no function form.**

```typescript
import { Middleware, BaseMiddleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';

@Middleware()
export class AuthMiddleware extends BaseMiddleware {
  // @Middleware() is here only to make TS emit design:paramtypes for this constructor
  constructor(private authService: AuthService) {
    super();
  }

  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    const token = req.headers.get('Authorization');
    if (!token || !await this.authService.verify(token)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    return next();
  }
}
```

Apply with `@UseMiddleware(AuthMiddleware)` at class or method level, or globally via
`ApplicationOptions.middleware: [AuthMiddleware]` — **class constructors everywhere, never
instances and never functions.**

For a middleware that needs no dependencies, still write a class — drop the `@Middleware()`
decorator (it only exists to make TS emit `design:paramtypes` for constructor DI) and use
`this.logger`, which `BaseMiddleware` provides:

```typescript
import { BaseMiddleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';

export class LoggerMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    this.logger.info(`${req.method} ${new URL(req.url).pathname}`);
    return next();
  }
}
```

Why the function form is worse than unsupported: `@UseMiddleware(...middleware: Function[])`
accepts a plain function without a type error, but every middleware path funnels through
`OneBunModule.resolveMiddleware()`, which does `new middlewareConstructor(...deps)` and then binds
`instance.use`. A function passed there is **`new`-ed once during `app.start()`**, so the app always
dies at startup, never at compile time — only the message varies: an arrow or `async` function throws
`function is not a constructor`, a plain `function` runs with every argument `undefined` and dies on
the first thing it touches (`next is not a function`, `undefined is not an object (evaluating
'req.headers')`).

## HttpException

Throw `HttpException` from handlers, guards, or middleware to return a specific HTTP status:

```typescript
import { HttpException } from '@onebun/core';

throw new HttpException(400, 'Invalid input');
throw new HttpException(404, 'User not found');
throw new HttpException(409, 'Already exists');
```

The `defaultExceptionFilter` converts `HttpException` to JSON with the matching HTTP status code.
Framework validation errors automatically throw `HttpException(400, ...)`: a missing required
parameter, a failed ArkType schema on `@Body`/`@Param`/`@Query`, and file validation in
`@UploadedFile` / `@UploadedFiles`. **There is no `@File` decorator** — the file-upload decorators
are `@UploadedFile(fieldName?, options?)` and `@UploadedFiles(fieldName?, options?)`; the `file`
module exports only `OneBunFile`, `MimeType`, `matchMimeType`, `validateFile`.

| Error type | HTTP status | Response body |
|---|---|---|
| `HttpException` | exception's statusCode | `{ success: false, error: message, code: statusCode }` |
| `OneBunBaseError` | error's code | `{ success: false, error: message, code: errorCode }` |
| Any other `Error` | 500 | `{ success: false, error: message, code: 500 }` |

## Guards, Exception Filters, Security

See `references/guards-filters-security.md` for full details on:

- **Guards**: `HttpGuard`, `@UseGuards()`, `createHttpGuard()`, built-in `AuthGuard`/`RolesGuard`
- **Exception Filters**: `ExceptionFilter`, `@UseFilters()`, `createExceptionFilter()`, `defaultExceptionFilter`
- **Security Middleware**: `cors`, `rateLimit`, `security` options on `ApplicationOptions`

Quick example — guards + filters:

```typescript
import { Controller, Get, UseGuards, UseFilters, AuthGuard, HttpException } from '@onebun/core';

@UseGuards(AuthGuard)
@Controller('/api/admin')
class AdminController extends BaseController {
  @Get('/stats')
  async stats() {
    const data = await this.service.getStats();
    if (!data) throw new HttpException(404, 'Stats not found');
    return data;
  }
}
```

Quick example — security options:

```typescript
const app = new OneBunApplication(AppModule, {
  cors: { origin: 'https://my-app.com', credentials: true },
  rateLimit: { windowMs: 60_000, max: 100 },
  security: true,
});
```

## Validation (ArkType)

HTTP body/query validation uses ArkType schemas. **Schemas and their inferred types live in
`validation/schemas.ts`** — controllers import the types, not inline `typeof schema.infer`.

```typescript
// src/validation/schemas.ts
import { type } from '@onebun/core';

export const createUserSchema = type({
  name: 'string',                    // required string
  'email?': 'string.email',         // optional email
  age: 'number > 0',                // positive number
  role: '"admin" | "user"',         // enum
  'tags?': 'string[]',              // optional string array
  amount: 'number % 1 >= 0',        // non-negative integer
});

// Export inferred type for use in controllers and services
export type CreateUserBody = typeof createUserSchema.infer;
```

<!-- typecheck: skip -->
```typescript
// In controller — import the type, don't inline typeof
import { createUserSchema, type CreateUserBody } from '../validation/schemas';

@Post('/')
async create(@Body(createUserSchema) body: CreateUserBody) {
  return this.service.create(body);
}
```

**Only `@Body` takes a bare schema.** `@Body(schema)` works because BODY ignores the parameter
name and reads `req.json()`. Every other param decorator is name-first, and validating query or
path input means one named parameter per value:

<!-- typecheck: skip -->
```typescript
@Get('/')
async list(
  @Query('page', pageSchema) page?: number,
  @Query('limit', limitSchema) limit?: number,
) { /* ... */ }
```

`@Query(schema)` with the schema as the only argument compiles, binds `undefined`, and raises no
validation error — the whole query string is dropped silently. The four working signatures are
`@Query(name)`, `@Query(name, options)`, `@Query(name, schema)`, `@Query(name, schema, options)`.
If you want a validated query *object*, build it in the handler from named params; the framework
has no whole-query form.

## Database (Drizzle)

See `references/drizzle.md` for complete patterns.

Setup in `app.module.ts`:

```typescript
import { DrizzleModule, DatabaseType } from '@onebun/drizzle';

@Module({
  imports: [
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.SQLITE,
        options: { url: process.env.DB_PATH || './data/app.db' },
      },
      // autoMigrate: true is the default — don't specify it explicitly
      migrationsFolder: './src/db/migrations',
    }),
  ],
})
export class AppModule {}
```

Inject `DrizzleService` in services/repositories:

```typescript
import { DrizzleService, eq, sql } from '@onebun/drizzle';

@Service()
export class MyRepository extends BaseService {
  constructor(private db: DrizzleService) { super(); }

  async findById(id: string) {
    return this.db.select().from(myTable).where(eq(myTable.id, id));
  }

  async atomicUpdate(id: string, amount: number) {
    return this.db.transaction(async (trx) => {
      const updated = await trx.update(myTable)
        .set({ balance: sql`${myTable.balance} + ${amount}` })
        .where(eq(myTable.id, id))
        .returning();
      await trx.insert(logTable).values({ entityId: id, amount });
      return updated[0];
    });
  }
}
```

Schema conventions:
- Import table builders from `@onebun/drizzle/sqlite` (or `/pg`)
- Timestamps: `integer('col', { mode: 'timestamp_ms' })` — milliseconds as integer
- IDs: ULID as `text('id').primaryKey()`
- Money: integer in cents, never float
- JSON columns: `text('col', { mode: 'json' }).$type<MyType>()`
- Type exports: `typeof myTable.$inferSelect` and `.$inferInsert`

CLI:
```bash
bunx onebun-drizzle generate    # generate migrations
bunx onebun-drizzle push        # apply to DB
bunx onebun-drizzle studio      # visual browser
```

## Message Queues

See `references/queues-and-nats.md` for the full queue system reference including all adapters,
NATS/JetStream configuration, message guards, and scheduled jobs.

Queue handlers are discovered only in `controllers` (not `providers`). The queue system is
enabled when **any** of these holds:

1. a controller carries a queue decorator (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`), or
2. `queue.enabled: true` is set in `ApplicationOptions`, or
3. a backend is explicitly configured via `queue.adapter`, `queue.options`, or `queue.redis`.

An explicit `queue.enabled: false` overrides all three and keeps the queue disabled: the app
logs exactly one warning naming the contradiction and does not throw — the adapter is never
constructed.

### Quick example — handlers and publishing

```typescript
import {
  Subscribe, Cron, Interval, Timeout,
  Message, QueueService, CronExpression,
} from '@onebun/core';

@Controller('/processor')
class EventProcessor extends BaseController {
  constructor(private queueService: QueueService) { super(); }

  @Subscribe('events.created')
  async handleEvent(message: Message<{ id: string }>) {
    this.logger.info('Event received', { id: message.data.id });
  }

  @Subscribe('events.important', {
    ackMode: 'manual',
    retry: { attempts: 3, backoff: 'exponential', delay: 1000 },
  })
  async handleImportant(message: Message<unknown>) {
    try {
      await this.process(message.data);
      await message.ack();
    } catch (e) {
      await message.nack(true);  // requeue
    }
  }

  // `options` is REQUIRED for all three schedulers — `pattern` names the subject the
  // return value is published to. One argument throws while the class body is evaluated.
  @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.hourly' })
  getCleanupData() { return { timestamp: Date.now() }; }

  @Interval(30000, { pattern: 'metrics.sampled' })
  getMetrics() { return { memory: process.memoryUsage() }; }

  @Timeout(5000, { pattern: 'startup.warmup' })
  getWarmupData() { return { type: 'warmup' }; }

  async publishSomething() {
    await this.queueService.publish('events.created', { id: '123' });
  }
}
```

### Dynamic job management

Jobs can be added, removed, paused, resumed, and updated at runtime via `QueueService`.
All management methods are **synchronous** (no await needed).

```typescript
// Add jobs dynamically
queueService.addJob({ type: 'cron', name: 'cleanup', expression: '0 * * * *', pattern: 'jobs.cleanup' });
queueService.addJob({ type: 'interval', name: 'heartbeat', intervalMs: 5000, pattern: 'jobs.heartbeat' });

// Query, pause, resume, update, remove
const job = queueService.getJob('cleanup');   // ScheduledJobInfo | undefined
const all = queueService.getJobs();           // ScheduledJobInfo[]
queueService.pauseJob('cleanup');
queueService.resumeJob('cleanup');
queueService.updateJob({ type: 'cron', name: 'cleanup', expression: '0 */2 * * *' });
queueService.removeJob('cleanup');

// Decorator-created jobs are also accessible by name
const decoratorJobs = queueService.getJobs().filter(j => j.declarative);
```

### Queue adapters

Four adapters available — each with different feature support:

| Adapter | Package | Persistence | DLQ | Retry | Consumer Groups |
|---|---|---|---|---|---|
| `InMemoryQueueAdapter` | `@onebun/core` | No | No | No | No |
| `RedisQueueAdapter` | `@onebun/core` | Yes | Yes | Yes | Yes |
| `NatsQueueAdapter` | `@onebun/nats` | No | No | No | Yes |
| `JetStreamQueueAdapter` | `@onebun/nats` | Yes | Yes | Yes | Yes |

Default adapter is `InMemoryQueueAdapter`. Configure via `ApplicationOptions.queue.adapter`.
Setting `queue.adapter` (or `queue.options` / `queue.redis`) enables the queue by itself — a
producer-only app that publishes but has no `@Subscribe` handler anywhere still gets a live
adapter. The adapter is therefore constructed and connected during `app.start()`, so such an
app fails to boot when the broker is unreachable instead of silently discarding every
`publish()`.

**Type-safe adapter config:** When you pass a class constructor as `adapter`, the `options`
field is automatically typed to match the adapter's constructor parameter — no type assertions needed.

### NATS / JetStream setup

```typescript
import { JetStreamQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  envSchema,
  queue: {
    adapter: JetStreamQueueAdapter,    // pass class, not instance
    options: {                         // ← auto-typed as JetStreamAdapterOptions
      servers: 'nats://localhost:4222',
      streams: [
        {
          name: 'EVENTS',
          subjects: ['events.>'],        // '>' = NATS multi-level wildcard
          retention: 'limits',
          storage: 'file',
        },
      ],
      consumerConfig: {
        ackWait: 30_000_000_000,         // nanoseconds (30s)
        maxDeliver: 5,
        maxAckPending: 100,
      },
    },
  },
});
```

Key points about JetStream:
- `streams` is required — each stream defines which subjects it handles
- `streamDefaults` can set shared defaults merged into every stream definition
- Subject patterns: OneBun's `#` wildcard is converted to NATS `>` and a `{name}` parameter to NATS `*`
  automatically; `#` must be the final token, any other position throws
- Consumers are durable when using consumer groups (`group` option in `@Subscribe`)
- Streams are created when absent on connect, and reconciled only when their configuration hash changed —
  an unchanged declaration writes nothing, undeclared keys are never sent so limits set out of band survive,
  a declaration that would stop covering a subject the stream already stores fails startup, and
  `storage`/`retention` cannot be changed in place (delete the stream to change them). The stamp lives in
  stream metadata, so this needs nats-server 2.10+; every failure emits `onError` as well as throwing

## Testing

See `references/testing.md` for the full testing reference including TestingModule,
testcontainers, and fake timers.

`testcontainers` is a **required** peer dependency of `@onebun/core` — `bun add -d testcontainers`.
The `@onebun/core/testing` barrel value-imports it, so it is needed for *any* import from that
subpath, including `createTestService` and `TestingModule`, not just the container helpers.

### Unit testing — `createTestService` / `createTestController`

For testing services and controllers in isolation without bootstrapping the full app:

```typescript
import { expect } from 'bun:test';
import { createTestService } from '@onebun/core/testing';

import type { Mock } from 'bun:test';

const { instance, logger, config } = createTestService(MyService, {
  config: { 'server.port': 3000, 'budget.reserveFloorCents': 500 },
  deps: [mockDependency],   // constructor dependencies in order
});

instance.doWork();

// logger methods are bun:test mocks at runtime, but typed as plain SyncLogger —
// the cast is required, `logger.info.mock` is a TS2339 error without it.
const info = logger.info as unknown as Mock<(message: string, ...args: unknown[]) => void>;
expect(info.mock.calls.length).toBeGreaterThan(0);
```

```typescript
import { createTestController } from '@onebun/core/testing';

const { instance } = createTestController(MyController, {
  deps: [mockService],
});
```

**Neither helper can build a class that reads `this.config` or `this.logger` in its constructor.**
Both do `new Class(...deps)` *first* and only then call `initializeService` / `initializeController`;
neither sets the ambient init context that `OneBunModule` sets around the real DI construction. So
during the constructor those fields are still `undefined`, and the config-in-constructor shape this
skill prescribes above dies with `TypeError: undefined is not an object (evaluating 'this.config.get')`.
The helpers only support classes that touch config after construction. For everything else, boot
through `TestingModule` — that path does set the init context — and hand it the schema:
`TestingModule.create({ ... }).setOptions({ envSchema }).compile()`. Without `envSchema` the
constructor's `this.config.get()` throws `Configuration not initialized`, DI logs it to the silent
test logger and drops the service, and boot fails with `DependencyResolutionError: Could not resolve
dependency <Service> for controller <Ctrl>` — the message names DI, the cause is the missing schema.

### Integration testing — `TestingModule`

For full HTTP integration tests with a real server:

```typescript
import { TestingModule, type CompiledTestingModule } from '@onebun/core/testing';

import { envSchema } from '../src/config';

describe('ItemController', () => {
  let app: CompiledTestingModule;

  beforeEach(async () => {
    app = await TestingModule
      .create({ controllers: [ItemController], providers: [ItemService] })
      .setOptions({ envSchema })    // required as soon as anything reads this.config
      .overrideProvider(ItemService).useValue(mockItemService)
      .compile();    // starts real HTTP server on random port
  });

  afterEach(() => app.close());

  test('GET /items', async () => {
    const res = await app.inject('GET', '/items');
    expect(res.status).toBe(200);

    // `inject()` resolves to a plain Web `Response` (OneBunResponse = Response).
    // The `{ success, result }` envelope is in the parsed body, NOT on the response object —
    // `res.success` is `undefined` at runtime and a TS2339 error at compile time.
    const body = await res.json() as { success: boolean; result: unknown[] };
    expect(body.success).toBe(true);
  });
});
```

### Testcontainers

For integration tests that need real Redis or NATS:

```typescript
import { createRedisContainer, createNatsContainer } from '@onebun/core/testing';

const redis = await createRedisContainer();         // redis:7-alpine
const nats = await createNatsContainer({
  enableJetStream: true,                             // passes --js flag
});

// Use redis.url / nats.url in test config
// Always call stop() in afterAll:
await redis.stop();
await nats.stop();
```

## Modifying Existing Code

When adding features to existing OneBun code, also fix any anti-patterns you encounter
in the code you're touching. For example, if adding caching to a service that has hardcoded
defaults with `?? fallback` instead of envSchema, or a plain function passed to
`@UseMiddleware()` — fix those too. The principle: leave code better than you found it,
at least in the areas you're modifying.

## Common Anti-Patterns

| Anti-pattern | Correct approach |
|---|---|
| Initializing async resources in constructor | Use the `onModuleInit()` lifecycle hook |
| `onModuleInit()` without `implements OnModuleInit` | Works — hooks are duck-typed off the instance. Add `implements` anyway so a misspelled hook name fails to compile instead of silently never running |
| `import { OnModuleInit } from '@onebun/core'` | Lifecycle interfaces are type-only exports: `import { type OnModuleInit }` — otherwise TS1484 under `verbatimModuleSyntax` |
| A plain function passed to `@UseMiddleware()` | Middleware is class-only: `class X extends BaseMiddleware`. A function is `new`-ed at startup and never runs per request |
| Hardcoding defaults in service properties (`?? 2000`) | All defaults belong in `envSchema` (config.ts), never use `?? fallback` in services |
| `const config = this.config;` intermediate variable | Always use `this.config.get()` directly — never assign this.config to a local variable |
| `typeof schema.infer` in controller signature | Export named type from schemas.ts, import it in controller |
| Explicit `Promise<Response>` or `Promise<OneBunResponse>` return type | Omit return type — let TS infer it (framework auto-wraps plain data) |
| `Request` type for raw request | Use `OneBunRequest` from `@onebun/core` |
| `exports: [Service]` in every module | Only export when another module needs to inject this service |
| `autoMigrate: true` in DrizzleModule.forRoot() | It's the default — omit it |
| Importing a module just for one service | Use `@Global()` on shared modules |
| Using `@Inject()` tokens | OneBun resolves by type — just use constructor params |
| Wrapping every return in `this.success()` | Return plain objects — auto-wrapped to `{ success: true, result }` |
| Using `this.error()` for error responses | `throw new HttpException(statusCode, message)` — caught by exception filter |
| Manual `.env` parsing | Use `envSchema` with `Env.string/number/boolean` |
| Creating DrizzleService manually | Import `DrizzleModule.forRoot()` — it's auto-provided |
| Missing `InferConfigType` module augmentation | Always add to config.ts for typed `this.config.get()` |
| Validation in service layer for HTTP input | Use `@Body(schema)` (whole body) or `@Query('name', schema)` (one param at a time) with ArkType |
| `@Query(schema)` — schema as the only argument | **Silently binds `undefined`** and validates nothing: with no name the pipeline evaluates `param.name ? queryParams[param.name] : undefined`. There is no whole-query form — name every param: `@Query('page', pageSchema)` |
| `adapter: new JetStreamQueueAdapter(opts)` (instance) | `adapter: JetStreamQueueAdapter, options: { ... }` (class + type-safe options). The class is `JetStreamQueueAdapter`; `JetStreamAdapter` does not exist (`JetStreamAdapterOptions` is the options type) |
| Accessing config before app startup without `getConfig()` | Use `getConfig(envSchema)` for typed pre-init config access |
| Using `@opentelemetry/sdk-trace-node` | Use `@opentelemetry/sdk-trace-base` — `sdk-trace-node` is Bun-incompatible |
| Using `@opentelemetry/exporter-trace-otlp-http` directly | OneBun has `OtlpFetchSpanExporter` using native `fetch()` for Bun compatibility |
| Manual OTLP exporter setup for traces | Configure `tracing.exportOptions.endpoint` — provider is auto-registered |
| Duplicate full paths across controllers (`/users/me` in two controllers) | Second registration overwrites first — keep each path in one controller |
| `console.error` in bootstrap `.catch()` | Use `app.getLogger()` — framework logger is available even before `start()` resolves |
| `error` without type annotation in `.catch()` | Always type as `(error: unknown)` and wrap: `error instanceof Error ? error : new Error(String(error))` |
| `bun add effect arktype @onebun/logger @onebun/envs` | These are transitive dependencies of `@onebun/core` — only install `@onebun/core`. The one exception is `testcontainers`, a required (not optional) peer: `bun add -d testcontainers` |
| `export type AppConfig = typeof envSchema` | Use `InferConfigType<typeof envSchema>` — `typeof` gives schema shape, not resolved value types |

## Checklist for New Services

When creating a new OneBun service from scratch:

1. `bun create @onebun my-app` (preferred) or `bun init -y && bun add @onebun/core` (manual).
   Only `@onebun/core` is needed at runtime — `logger`, `envs`, `requests`, `metrics`, `trace`,
   `effect`, and `arktype` are all transitive dependencies.
2. `bun add -d testcontainers` as soon as you write a test. It is a **required** peer of
   `@onebun/core` (deliberately not marked optional), and `@onebun/core/testing` value-imports it,
   so `createTestService` and `TestingModule` fail to import without it — not just the container helpers.
3. Add optional packages as needed: `@onebun/drizzle`, `@onebun/cache`, `@onebun/nats`, `@onebun/docs`.
4. Create `src/config.ts` with `envSchema` + `InferConfigType` + module augmentation
5. Create `src/app.module.ts` — root module importing infrastructure + domain modules
6. Create `src/index.ts` — bootstrap with `new OneBunApplication(AppModule, { envSchema })`
7. Create `src/validation/schemas.ts` — ArkType schemas with exported inferred types
8. Create domain modules following the `{domain}/` folder convention
9. Only add `exports` to modules that provide services to other modules
10. Create `drizzle.config.ts` if using database
11. Run `bunx onebun-drizzle generate && bunx onebun-drizzle push` for migrations

## Reference Files

For detailed patterns, read these files when needed:
- `references/controllers.md` — full decorator reference, route params, response patterns
- `references/drizzle.md` — schema definition, repository pattern, migrations, transactions
- `references/guards-filters-security.md` — guards, exception filters, HttpException, security middleware
- `references/interceptors.md` — HTTP interceptors, createInterceptor, BaseInterceptor, built-in interceptors
- `references/queues-and-nats.md` — queue adapters, NATS/JetStream config, message guards, scheduled jobs
- `references/testing.md` — TestingModule, createTestService/Controller, testcontainers, fake timers, mocks
- `references/observability.md` — OTLP trace export, async trace decorators, OTLP log transport, full observability setup