---
description: Migration guide for NestJS developers moving to OneBun. Concept mapping, decorator comparison, side-by-side examples, and key differences.
---

# Migration from NestJS

If you are a NestJS developer looking to move to Bun.js, OneBun is designed to feel familiar.
Most NestJS concepts map directly, so migrating is mostly about swapping decorators and
adopting a few new conventions.

This guide walks through the mapping of concepts, decorators, and code patterns.

## Concept Mapping

| NestJS | OneBun | Notes |
|--------|--------|-------|
| `@Module()` | `@Module()` | Same structure: `imports`, `controllers`, `providers`, `exports` |
| `@Injectable()` | `@Service()` | Services extend `BaseService` for logger/config access |
| `@Controller()` | `@Controller()` | Controllers extend `BaseController` for `this.success()` / `this.error()` |
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
import {
  BaseController, Controller, Get, Post, Put, Delete,
  Param, Body, Query, UseGuards, ApiResponse,
} from '@onebun/core';
import { ApiTags, ApiOperation } from '@onebun/docs';
import { type } from 'arktype';

import { AuthGuard } from './auth.guard';
import { UserService } from './user.service';

// ArkType schema = TypeScript type + runtime validation + OpenAPI spec
const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});

const updateUserSchema = type({
  'name?': 'string',
  'email?': 'string.email',
  'age?': 'number > 0',
});

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});

@ApiTags('Users')
@Controller('/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @ApiOperation({ summary: 'List all users' })
  @Get('/')
  @ApiResponse(200, { schema: userSchema.array() })
  async findAll(@Query('page') page?: string): Promise<Response> {
    const users = await this.userService.findAll(page);
    return this.success(users);
  }

  @Get('/:id')
  @ApiResponse(200, { schema: userSchema })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<Response> {
    const user = await this.userService.findOne(id);
    if (!user) {
      return this.error('User not found', 404, 404);
    }
    return this.success(user);
  }

  @Post('/')
  @UseGuards(AuthGuard)
  @ApiResponse(201, { schema: userSchema })
  async create(
    @Body(createUserSchema) body: typeof createUserSchema.infer,
  ): Promise<Response> {
    const user = await this.userService.create(body);
    return this.success(user);
  }

  @Put('/:id')
  @UseGuards(AuthGuard)
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: typeof updateUserSchema.infer,
  ): Promise<Response> {
    const user = await this.userService.update(id, body);
    return this.success(user);
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string): Promise<Response> {
    await this.userService.remove(id);
    return this.success({ deleted: true });
  }
}
```

**Key differences:**
- Controllers extend `BaseController` and call `super()` in the constructor
- Route handlers return `Response` via `this.success()` / `this.error()`
- Validation is declarative: pass ArkType schema to `@Body(schema)` instead of DTO classes with `class-validator`
- One schema gives you TypeScript types, runtime validation, and OpenAPI spec -- no duplication

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

app.start();
```

No separate validation pipe is needed -- pass ArkType schemas directly to `@Body()` decorators.
Metrics and tracing are enabled via application options, not separate packages.

## What is Different

### Effect.ts for DI (Transparent to You)

OneBun uses Effect.ts internally for dependency injection and resource management.
As an application developer, you write normal classes and constructors -- the Effect
machinery is invisible. You only interact with Effect directly if you choose to for
advanced async composition.

### ArkType Replaces class-validator + class-transformer

In NestJS, you typically define DTO classes with `class-validator` decorators, then duplicate
those types for Swagger with `@nestjs/swagger` decorators. In OneBun, a single ArkType schema
serves three purposes at once:

```typescript
// This one definition gives you:
// 1. TypeScript type (typeof schema.infer)
// 2. Runtime validation (@Body(schema))
// 3. OpenAPI 3.1 schema (auto-generated docs)
const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});
```

No DTO classes, no `class-validator` decorators, no `@ApiProperty()` annotations.

### Bun-Only

OneBun runs exclusively on Bun.js 1.2.12+. There is no Node.js compatibility layer
and no Express/Fastify adapter. This means:
- Native TypeScript execution (no compilation step)
- Bun's built-in HTTP server (no adapter overhead)
- `bun:sqlite` for local SQLite
- `bun:test` for testing
- Hot reload via `bun run --watch`

### Response Pattern

OneBun controllers return `Response` objects via helper methods:

```typescript
// Success response: { success: true, result: data }
return this.success(data);

// Error response: { success: false, error: message, statusCode: code }
return this.error('Not found', 404, 404);
```

This provides a consistent API response envelope across all endpoints.

## What is Not Yet Available in OneBun

| Feature | Status | Notes |
|---------|--------|-------|
| Interceptors | Planned | No equivalent yet |
| GraphQL (`@nestjs/graphql`) | Not available (post-1.0 consideration) | Use REST + OpenAPI |
| CQRS (`@nestjs/cqrs`) | Not available | -- |
| Multiple transport layers | Partial | NATS/JetStream + Redis supported; no RabbitMQ, Kafka, gRPC |
| Microservices (`@nestjs/microservices`) | Different approach | `MultiServiceApplication` for multi-service from single image |
| Pipes (class-based) | Not available | ArkType schemas handle validation |
| Dynamic modules (`forRoot`/`forAsync`) | Not available | Use env schema + module imports |

## What is Unique to OneBun

These features are built into the framework -- no community packages needed:

- **Prometheus metrics** (`@onebun/metrics`) -- auto HTTP/system metrics, `@Timed()`, `@Counted()`, custom counters/gauges/histograms at `/metrics`
- **OpenTelemetry tracing** (`@onebun/trace`) -- auto HTTP tracing, `@Span()` decorator, configurable sampling and export
- **Redis/in-memory cache** (`@onebun/cache`) -- `CacheModule` with TTL, batch operations, shared Redis connection
- **Typed environment variables** (`@onebun/envs`) -- schema-based config with validation, defaults, sensitive value masking
- **ArkType validation** -- one schema = TypeScript type + runtime validation + OpenAPI 3.1 spec
- **Multi-service from single Docker image** -- `MultiServiceApplication` with `ONEBUN_SERVICES` env var to select which services to run
- **WebSocket guards and queue guards** -- guards work not only on HTTP routes but also on WebSocket messages and queue handlers
- **Typed inter-service HTTP clients** -- `createServiceDefinition()` + `createServiceClient()` with HMAC auth, no code generation
- **Auto-generated typed WebSocket client** -- type-safe frontend SDK generated from gateway decorators

## Quick Migration Checklist

1. Install Bun.js 1.2.12+ and initialize your project with `bun init`
2. Replace `@nestjs/*` packages with `@onebun/*` packages
3. Update `tsconfig.json` (ensure `experimentalDecorators` and `emitDecoratorMetadata` are `true`)
4. Replace `@Injectable()` with `@Service()` and extend `BaseService`
5. Update controllers to extend `BaseController` and add `super()` call
6. Replace DTO classes + `class-validator` with ArkType schemas
7. Update route handlers to return `this.success()` / `this.error()`
8. Replace Express `Request`/`Response` types with `OneBunRequest`/`OneBunResponse`
9. Move `ConfigService` usage to `this.config` (from `BaseService`)
10. Move `Logger` usage to `this.logger` (from `BaseService`)
11. Update entry point from `NestFactory.create()` to `new OneBunApplication()`
12. Run `bun run typecheck` and `bun test` to verify everything works
