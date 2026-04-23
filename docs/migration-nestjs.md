---
description: Migration guide for NestJS developers moving to OneBun. Concept mapping, decorator comparison, side-by-side examples, and key differences.
---

# Migration from NestJS

If you are a NestJS developer looking to move to Bun.js, OneBun is designed to feel familiar.
Most NestJS concepts map directly, so migrating is mostly about swapping decorators and
adopting a few new conventions.

This guide walks through the mapping of concepts, decorators, and code patterns.

## Why Consider Migrating

OneBun is not a port of NestJS to Bun. It is a separate framework that borrows NestJS's architecture (modules, DI, decorators) but makes different trade-offs — prioritizing convention over configuration, collapsing boilerplate, and shipping infrastructure features as built-in packages rather than community add-ons.

Here are specific reasons a NestJS team might benefit from switching.

### Performance you can verify

OneBun is **~1.3–2.7× faster** than NestJS on production workloads (depending on stack) while performing **on par with Hono** on Bun. Benchmarks run in CI on every commit and are [published with full methodology](/benchmarks). Yes, OneBun is slower than Elysia (a lightweight Bun-native HTTP toolkit), but that is a different class of tool — no DI, no modules, no observability stack. The comparison that matters is against NestJS, and the gap is significant.

### Zero build step

Bun executes TypeScript directly. No `tsc`, no `swc`, no `ts-node`, no `tsup`. Your source code **is** your runtime code. `bun run --watch` for dev, `bun run src/main.ts` for production. One fewer thing to debug when something breaks between local and CI.

### Less boilerplate where it counts

**Logger and config injection disappear.** In NestJS, every service that needs logging or configuration must inject `Logger` and `ConfigService` through the constructor. In a project with 50+ services, that is a lot of repeated `private readonly logger = new Logger(MyService.name)`. In OneBun, `this.logger` and `this.config` are available on every `BaseService` and `BaseController` automatically — typed, structured, zero setup.

**Validation, types, and API docs collapse into one artifact.** A single ArkType schema gives you a TypeScript type (via `infer`), runtime validation, and an OpenAPI 3.1 spec. In canonical NestJS with `class-validator`, that is three separate things: a DTO class with validation decorators, `@ApiProperty()` annotations for Swagger, and a TypeScript interface. With `nestjs-zod` and `patchNestJsSwagger()`, NestJS teams can achieve a similar one-schema workflow. OneBun ships this wired out of the box — ArkType is re-exported from `@onebun/core`, no additional packages, no bridge libraries, no patching. Adding a field to an endpoint means editing one schema. Types, validation, and docs update automatically.

### Built-in infrastructure — not community packages

NestJS's strength is its ecosystem, but that ecosystem means pulling in separate packages, each with its own configuration pattern, version matrix, and maintenance status. OneBun ships the most common infrastructure needs as first-party packages with a unified API:

| What you need | NestJS approach | OneBun approach |
|---|---|---|
| **Caching** | `@nestjs/cache-manager` + `cache-manager` + store adapter | `@onebun/cache` — in-memory or Redis, TTL, batch ops, one import |
| **Queues** | `@nestjs/bull` or `@nestjs/bullmq` + separate Redis | `@onebun/nats` — unified API for in-memory, Redis, and NATS JetStream backends |
| **Scheduled jobs** | `@nestjs/schedule` (in-memory cron only) | Built into `@onebun/nats` — in-memory, Redis, or JetStream. Same decorator, three backends |
| **Metrics** | `prom-client` + custom middleware or community package | `@onebun/metrics` — auto HTTP/system metrics, `@Timed()`, `@Counted()`, `@Gauged()`, `/metrics` endpoint |
| **Tracing** | OpenTelemetry SDK + manual instrumentation | `@onebun/trace` — auto HTTP tracing, `@Span()`, `@TraceAll()`, configurable sampling |
| **Typed HTTP clients** | Axios wrappers without type safety, or gRPC with code generation | `@onebun/requests` — `createServiceDefinition()` + `createServiceClient()`, typed, no codegen |
| **Environment config** | `@nestjs/config` + manual validation (Joi/Zod) | `@onebun/envs` — schema-based, validated at startup, sensitive value masking in logs |

### Shared Redis connection pool

A typical NestJS project with BullMQ, caching, rate limiting, and sessions opens 4+ separate Redis connections. OneBun uses a **single shared Redis pool** for cache, WebSocket state, queues, and rate limiting. Fewer connections, less memory, simpler infrastructure.

### Guards that work everywhere

In NestJS, guards protect HTTP routes. Want authorization on WebSocket messages? Write custom middleware. Want to gate a queue handler? Build it yourself. In OneBun, `@UseGuards(AuthGuard)` works identically on HTTP routes, WebSocket message handlers, and queue consumers. One pattern, all transports.

### Multi-service without the pain

NestJS can technically run multiple services from one codebase, but wiring that up for local development (running some services together, others separately) is manual and fragile. OneBun's `OneBunApplication` multi-service mode lets you run all services in a single process during development and split them via `ONEBUN_SERVICES` env var in production — same code, same Docker image, no glue scripts.

### Type-safe WebSocket clients

In NestJS, the WebSocket client is a hope-based contract — you emit event names as strings and pray they match the server. OneBun generates a **typed client SDK** from your gateway decorators. If the server event changes, the client won't compile.

## What is Unique to OneBun

These features are built into the framework -- no community packages needed:

- **Prometheus metrics** (`@onebun/metrics`) -- auto HTTP/system metrics, `@Timed()`, `@Counted()`, `@Gauged()`, custom counters/gauges/histograms at `/metrics`
- **OpenTelemetry tracing** (`@onebun/trace`) -- auto HTTP tracing, `@Span()` decorator, configurable sampling and export
- **Redis/in-memory cache** (`@onebun/cache`) -- `CacheModule` with TTL, batch operations, shared Redis connection
- **Typed environment variables** (`@onebun/envs`) -- schema-based config with validation, defaults, sensitive value masking
- **ArkType validation** -- one schema = TypeScript type + runtime validation + OpenAPI 3.1 spec
- **Multi-service architecture** -- run all services in a single process during development, split by `ONEBUN_SERVICES` env var in production. Same code, same Docker image — no glue scripts or docker-compose hacks for local dev
- **WebSocket guards and queue guards** -- guards work not only on HTTP routes but also on WebSocket messages and queue handlers
- **Typed inter-service HTTP clients** -- `createServiceDefinition()` + `createServiceClient()` with Bearer/ApiKey/Basic auth, no code generation (HMAC auth planned)
- **Auto-generated typed WebSocket client** -- type-safe frontend SDK generated from gateway decorators
- **SSE (Server-Sent Events)** -- `@Sse()` decorator with heartbeat, per-route timeout, auto-abort on disconnect; `this.sse()` for programmatic streaming
- **Static file serving with SPA fallback** -- serve frontend build from the same host/port as the API, with `fallbackFile` for client-side routing
- **OTLP log export** -- structured logs sent to OpenTelemetry Collector alongside console output, batch-based with configurable flush
- **Auto-trace all methods** -- `traceAll: true` in tracing config + `@TraceAll()`/`@NoTrace()` per-class overrides with filtering
- **Shared Redis connection pool** -- single connection reused by cache, WebSocket storage, and queue — less memory, fewer connections
- **Project scaffolding** -- `bun create @onebun my-app` creates ready-to-run project with TypeScript config, env schema, Docker Compose

## Concept Mapping

| NestJS | OneBun | Notes |
|--------|--------|-------|
| `@Module()` | `@Module()` | Same structure: `imports`, `controllers`, `providers`, `exports` |
| `@Injectable()` | `@Service()` | Services extend `BaseService` for logger/config access |
| `@Controller()` | `@Controller()` | Controllers extend `BaseController`. Return plain objects (auto-wrapped), throw `HttpException` for errors |
| Pipe (`@UsePipes`) | ArkType schema in `@Body()` | Declarative schema, not class-based. One schema = type + validation + OpenAPI |
| Guard (`@UseGuards`) | Guard (`@UseGuards`) | Same `CanActivate`-style pattern via `HttpGuard` interface |
| Exception Filter (`@UseFilters`) | Exception Filter (`@UseFilters`) | Same pattern. `HttpException` for throwing, `ExceptionFilter` for catching |
| Interceptor | -- | Not yet available (planned) |
| Middleware | Middleware | Class-based with `@Middleware()` decorator and full constructor DI |
| `@Global()` | `@Global()` | Same behavior: exports available everywhere without explicit import |
| `ConfigService` | `this.config` | Built-in on `BaseService`/`BaseController`, type-safe env schema |
| `Logger` | `this.logger` | Built-in on `BaseService`/`BaseController`, structured JSON logging |
| `@Inject()` | `@Inject()` | Rarely needed -- auto DI works for most cases |
| Lifecycle hooks | Lifecycle hooks | `OnModuleInit`, `OnApplicationInit`, `OnModuleDestroy`, etc. |
| `@Sse()` | `@Sse()` + `this.sse()` | Built-in heartbeat, per-route timeout, auto-abort on disconnect |
| Static files (`ServeStaticModule`) | `static` option | Built-in with SPA fallback, no extra module needed |

## Decorator Mapping

### Structure

| NestJS | OneBun | Package |
|--------|--------|---------|
| `@Module()` | `@Module()` | `@onebun/core` |
| `@Injectable()` | `@Service()` | `@onebun/core` |
| `@Controller()` | `@Controller()` | `@onebun/core` |
| `@Global()` | `@Global()` | `@onebun/core` |
| `@Inject()` | `@Inject()` | `@onebun/core` |

### HTTP Methods

| NestJS | OneBun | Notes |
|--------|--------|-------|
| `@Get()` | `@Get()` | Same |
| `@Post()` | `@Post()` | Same |
| `@Put()` | `@Put()` | Same |
| `@Delete()` | `@Delete()` | Same |
| `@Patch()` | `@Patch()` | Same |
| `@Options()` | `@Options()` | Same |
| `@Head()` | `@Head()` | Same |
| `@All()` | `@All()` | Same |

### Parameter Extraction

| NestJS | OneBun | Notes |
|--------|--------|-------|
| `@Param()` | `@Param()` | Same. Supports ArkType schema for validation |
| `@Body()` | `@Body()` | Pass ArkType schema for validation: `@Body(schema)` |
| `@Query()` | `@Query()` | Same. Supports `{ required: true }` option |
| `@Headers()` | `@Header()` | Singular name, same behavior |
| `@Req()` | `@Req()` | Returns `OneBunRequest` (not Express `Request`) |
| `@Res()` | -- | Deprecated. Return `Response` from handler instead |
| `@UploadedFile()` | `@UploadedFile()` | Similar. Also supports JSON+base64 uploads |
| -- | `@Cookie()` | New. Extract cookie values directly |
| -- | `@FormField()` | New. Extract non-file form fields |

### Cross-Cutting

| NestJS | OneBun | Notes |
|--------|--------|-------|
| `@UseGuards()` | `@UseGuards()` | Same. Supports class-level and method-level |
| `@UseFilters()` | `@UseFilters()` | Same. Supports class-level and method-level |
| `@UseInterceptors()` | -- | Not yet available |
| `@UsePipes()` | -- | Replaced by ArkType schemas in `@Body()` / `@Param()` |
| `@UseMiddleware()` (custom) | `@UseMiddleware()` | Built-in. Class-level and method-level |

### Documentation

| NestJS (`@nestjs/swagger`) | OneBun (`@onebun/docs`) | Notes |
|---|---|---|
| `@ApiTags()` | `@ApiTags()` | Must be above `@Controller` |
| `@ApiOperation()` | `@ApiOperation()` | Must be above route decorator |
| `@ApiResponse()` | `@ApiResponse()` | Must be below route decorator |
| `@ApiProperty()` | -- | Not needed: ArkType schema generates OpenAPI automatically |

### Observability

| NestJS | OneBun | Notes |
|--------|--------|-------|
| -- | `@Span()` | OpenTelemetry span decorator (`@onebun/trace`) |
| -- | `@Timed()` | Prometheus duration metric (`@onebun/metrics`) |
| -- | `@Counted()` | Prometheus counter metric (`@onebun/metrics`) |
| -- | `@Gauged()` | Prometheus gauge metric (`@onebun/metrics`) |

## Side-by-Side Examples

### CRUD Controller

**NestJS:**

```typescript
import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateUserDto, UpdateUserDto } from './dto';
import { UserService } from './user.service';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  async findAll(@Query('page') page?: number) {
    return this.userService.findAll(page);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Put(':id')
  @UseGuards(AuthGuard('jwt'))
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
```

**OneBun:**

```typescript
// src/users/user.schema.ts — schemas live in separate files
import { type } from '@onebun/core';

export const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});
export type CreateUserBody = typeof createUserSchema.infer;

export const updateUserSchema = type({
  'name?': 'string',
  'email?': 'string.email',
  'age?': 'number > 0',
});
export type UpdateUserBody = typeof updateUserSchema.infer;

export const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});
```

```typescript
// src/users/user.controller.ts
import {
  BaseController, Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards, HttpException, ApiResponse,
} from '@onebun/core';
import { ApiTags, ApiOperation } from '@onebun/docs';

import { AuthGuard } from './auth.guard';
import { UserService } from './user.service';
import {
  createUserSchema, type CreateUserBody,
  updateUserSchema, type UpdateUserBody,
  userSchema,
} from './user.schema';

@ApiTags('Users')
@Controller('/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @ApiOperation({ summary: 'List all users' })
  @Get('/')
  @ApiResponse(200, { schema: userSchema.array() })
  async findAll(@Query('page') page?: string) {
    return this.userService.findAll(page);
  }

  @Get('/:id')
  @ApiResponse(200, { schema: userSchema })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string) {
    const user = await this.userService.findOne(id);
    if (!user) {
      throw new HttpException(404, 'User not found');
    }
    return user;
  }

  @Post('/')
  @UseGuards(AuthGuard)
  @ApiResponse(201, { schema: userSchema })
  async create(@Body(createUserSchema) body: CreateUserBody) {
    return this.userService.create(body);
  }

  @Put('/:id')
  @UseGuards(AuthGuard)
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: UpdateUserBody,
  ) {
    return this.userService.update(id, body);
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string) {
    await this.userService.remove(id);
    return { deleted: true };
  }
}
```

**Key differences:**
- Controllers extend `BaseController` and call `super()` in the constructor
- Route handlers return plain objects (auto-wrapped to `{ success: true, result: data }`), throw `HttpException` for errors
- Validation is declarative: pass ArkType schema to `@Body(schema)` instead of DTO classes with `class-validator`
- One schema gives you TypeScript types, runtime validation, and OpenAPI spec -- no duplication
- Schemas live in separate files; controllers import named types (not inline `typeof schema.infer`)

### Service

**NestJS:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private configService: ConfigService) {}

  async findAll(page?: number): Promise<User[]> {
    this.logger.log('Finding all users');
    const limit = this.configService.get<number>('PAGE_SIZE', 20);
    // ...
  }
}
```

**OneBun:**

```typescript
import { BaseService, Service } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  // this.logger and this.config are available automatically from BaseService

  async findAll(page?: string): Promise<User[]> {
    this.logger.info('Finding all users');
    // this.config provides typed access to your env schema
    // ...
  }
}
```

**Key differences:**
- `@Service()` instead of `@Injectable()`
- Extend `BaseService` to get `this.logger` and `this.config` for free
- No need to inject `Logger` or `ConfigService` manually

### Module

**NestJS:**

```typescript
import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

**OneBun:**

```typescript
import { Module } from '@onebun/core';

import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

Modules are virtually identical. The only import path changes.

### Guard

**NestJS:**

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return !!request.headers.authorization;
  }
}
```

**OneBun:**

```typescript
import { createHttpGuard } from '@onebun/core';

// Function-based (simplest)
export const AuthGuard = createHttpGuard(async (context) => {
  const req = context.getRequest();
  return !!req.headers.get('Authorization');
});

// Or class-based with DI
import type { HttpGuard, HttpExecutionContext } from '@onebun/core';

export class AuthGuard implements HttpGuard {
  async canActivate(context: HttpExecutionContext): Promise<boolean> {
    const req = context.getRequest();
    return !!req.headers.get('Authorization');
  }
}
```

### Middleware

**NestJS:**

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    console.log(`${req.method} ${req.url}`);
    next();
  }
}
```

**OneBun:**

```typescript
import {
  Middleware,
  BaseMiddleware,
  type OneBunRequest,
  type OneBunResponse,
} from '@onebun/core';

@Middleware()
export class LoggerMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    this.logger.info(`${req.method} ${new URL(req.url).pathname}`);
    return next();
  }
}
```

**Key differences:**
- `@Middleware()` decorator enables auto DI for constructor dependencies
- Extend `BaseMiddleware` for `this.logger` access
- `next()` returns the response (no separate `res` object)
- Uses `OneBunRequest`/`OneBunResponse`, not Express types

### Application Bootstrap

**NestJS:**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(3000);
}
bootstrap();
```

**OneBun:**

```typescript
import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  envSchema,
  envOptions: { loadDotEnv: true },
  metrics: { enabled: true, path: '/metrics' },
  tracing: { enabled: true, serviceName: 'my-app' },
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

No separate validation pipe is needed -- pass ArkType schemas directly to `@Body()` decorators.
Metrics and tracing are enabled via application options, not separate packages.

## What is Different

### Effect.ts for DI (Transparent to You)

OneBun uses Effect.ts internally for dependency injection and resource management.
As an application developer, you write normal classes and constructors -- the Effect
machinery is invisible. You only interact with Effect directly if you choose to for
advanced async composition.

### ArkType Instead of class-validator

In canonical NestJS with `class-validator`, you define DTO classes with validation decorators,
then duplicate those types for Swagger with `@nestjs/swagger` decorators. In OneBun, a single
ArkType schema serves three purposes at once:

```typescript
// This one definition gives you:
// 1. TypeScript type (CreateUserBody)
// 2. Runtime validation (@Body(schema))
// 3. OpenAPI 3.1 schema (auto-generated docs)
export const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});

export type CreateUserBody = typeof createUserSchema.infer;
```

No DTO classes, no `class-validator` decorators, no `@ApiProperty()` annotations.

NestJS teams using `nestjs-zod` already have a similar one-schema pattern. The difference in OneBun: ArkType is re-exported from `@onebun/core` — no bridge packages, no `patchNestJsSwagger()`, no setup.

### Bun-Only

OneBun runs exclusively on Bun.js 1.2.12+. There is no Node.js compatibility layer
and no Express/Fastify adapter. This means:
- Native TypeScript execution (no compilation step)
- Bun's built-in HTTP server (no adapter overhead)
- `bun:sqlite` for local SQLite
- `bun:test` for testing
- Hot reload via `bun run --watch`

### Response Pattern

OneBun controllers return plain objects -- the framework auto-wraps them into a standard envelope:

```typescript
// Return plain data -- auto-wrapped to: { success: true, result: data }
return data;

// Throw for errors -- produces: { success: false, error: 'Not found', code: 404 }
throw new HttpException(404, 'Not found');
```

This provides a consistent API response envelope across all endpoints.

For custom HTTP status codes on success, use `this.success(data, statusCode)`:

```typescript
@Post('/')
async create(@Body(createUserSchema) body: CreateUserBody) {
  const user = await this.userService.create(body);
  return this.success(user, 201);  // HTTP 201 + { success: true, result: user }
}
```

### Route Path Format

OneBun supports both path styles out of the box. `@Get(':id')` and `@Get('/:id')` are equivalent — the framework normalizes paths automatically. No migration step needed:

```typescript
// NestJS
@Get(':id')
@Post()

// OneBun — both styles work identically
@Get(':id')     // NestJS-compatible, no change needed
@Get('/:id')    // explicit slash style
@Post()         // omit path for root
@Post('/')      // explicit root — also fine
```

### Singleton Services Only

NestJS supports three provider scopes: `DEFAULT` (singleton), `REQUEST` (per-request), `TRANSIENT` (new instance per injection). OneBun services are **singletons only** — one instance per application lifetime, created at startup.

If you relied on `REQUEST` scope for per-request state in NestJS, pass request-specific data through method arguments instead.

### Provider Patterns

NestJS supports `useFactory`, `useValue`, `useClass`, and `useExisting` in module providers. OneBun supports **class-based providers only** — list `@Service()` classes in the `providers` array. The `useValue`/`useClass` patterns are available in `TestingModule.overrideProvider()` for testing.

If you used `useFactory` for dynamic providers, use `getConfig()` for pre-init config or `onModuleInit()` for async initialization.

### Module Middleware Configuration

NestJS uses `configure(consumer: MiddlewareConsumer)` with a fluent API to apply middleware to routes. OneBun uses `configureMiddleware()` which returns an array of middleware classes applied to all routes in the module:

```typescript
// NestJS
export class UserModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('users');
  }
}

// OneBun
export class UserModule implements OnModuleConfigure {
  configureMiddleware(): MiddlewareClass[] {
    return [LoggerMiddleware];  // applied to all controllers in this module
  }
}
```

OneBun does not support per-route middleware configuration at the module level — use `@UseMiddleware()` on individual routes or controllers instead.

### Testing Approach

NestJS uses `Test.createTestingModule()` with `supertest` for HTTP testing. OneBun's `TestingModule` starts a **real HTTP server** on a random port and makes actual HTTP requests:

```typescript
// NestJS
const module = await Test.createTestingModule({
  controllers: [UserController],
  providers: [UserService],
}).compile();
const app = module.createNestApplication();
await app.init();
const response = await request(app.getHttpServer()).get('/users');

// OneBun
const module = await TestingModule
  .create({ controllers: [UserController], providers: [UserService] })
  .overrideProvider(UserService).useValue(mockService)
  .compile();  // starts real server on random port
const response = await module.inject('GET', '/users');
await module.close();  // always close in afterEach
```

## What is Not Yet Available in OneBun

| Feature | Status | Notes |
|---------|--------|-------|
| Interceptors | Planned | No equivalent yet |
| GraphQL (`@nestjs/graphql`) | Planned (post-1.0) | Use REST + OpenAPI for now |
| CQRS (`@nestjs/cqrs`) | Not available | -- |
| Multiple transport layers | Partial | NATS/JetStream + Redis supported; no RabbitMQ, Kafka, gRPC |
| Microservices (`@nestjs/microservices`) | Different approach | `OneBunApplication` multi-service mode — pass `{ services: ... }` for multi-service from single image |
| Pipes (class-based) | Not available | ArkType schemas handle validation |
| Scoped providers (`REQUEST`, `TRANSIENT`) | Not available | All services are singletons |
| `useFactory` / `useExisting` providers | Not available | Class-based `@Service()` only; `useValue`/`useClass` in tests only |
| Per-route module middleware (`forRoutes`) | Not available | Use `@UseMiddleware()` on controllers/routes |
| Dynamic modules (`forRoot`/`forAsync`) | Partial | `DrizzleModule.forRoot()`, `CacheModule.forRoot()` — no `forAsync`, use `getConfig()` for dynamic values |

## Quick Migration Checklist

1. Install Bun.js 1.2.12+ and create project with `bun create @onebun my-app` (or `bun init -y && bun add @onebun/core`) — see [Getting Started](/getting-started)
2. Replace `@nestjs/*` packages with `@onebun/core` (includes logger, envs, metrics, trace, requests as transitive deps)
3. Update `tsconfig.json` (ensure `experimentalDecorators` and `emitDecoratorMetadata` are `true`)
4. Replace `@Injectable()` with `@Service()` and extend `BaseService` — see [Services](/api/services)
5. Update controllers to extend `BaseController` and add `super()` call — see [Controllers](/api/controllers)
6. Replace DTO classes + `class-validator` with ArkType schemas — see [Validation](/api/validation)
7. ~~Update route paths~~ — not needed, `@Get(':id')` works as-is in OneBun
8. Update route handlers to return plain objects and throw `HttpException` for errors
9. Replace Express `Request`/`Response` types with `OneBunRequest`/`OneBunResponse`
10. Move `ConfigService` usage to `this.config` (from `BaseService`)
11. Move `Logger` usage to `this.logger` (from `BaseService`)
12. Update entry point from `NestFactory.create()` to `new OneBunApplication()` — see [Getting Started](/getting-started)
13. Run `bun run typecheck` and `bun test` to verify everything works
