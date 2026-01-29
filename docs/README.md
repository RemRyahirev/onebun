# OneBun Framework - AI Documentation

> **Purpose**: This documentation is designed for AI agents to understand and implement applications using the OneBun framework. It provides structured, code-focused guidance with clear patterns and complete examples.

## Quick Reference

| Aspect | Details |
|--------|---------|
| **Runtime** | Bun.js (not Node.js compatible) |
| **Language** | TypeScript (strict mode, no `any`) |
| **Architecture** | NestJS-inspired with Effect.ts for side effects |
| **Philosophy** | One default solution per problem |
| **API Style** | Promise-based for client code, Effect.js internally |

## Core Concepts

### 1. Application Structure

```
my-app/
├── src/
│   ├── index.ts              # Entry point - creates OneBunApplication
│   ├── app.module.ts         # Root module
│   ├── config.ts             # Environment schema
│   ├── users/
│   │   ├── users.module.ts   # Feature module
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   └── entities/
│   │       └── user.entity.ts
│   └── posts/
│       └── ...
├── package.json
└── tsconfig.json
```

### 2. Decorator System

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@Module()` | Define module with imports, controllers, providers | `@Module({ controllers: [UserController] })` |
| `@Controller(path)` | Define HTTP controller | `@Controller('/users')` |
| `@Service()` | Mark class as injectable service | `@Service()` |
| `@Get()`, `@Post()`, etc. | Define HTTP endpoints | `@Get('/:id')` |
| `@Body()`, `@Param()`, `@Query()` | Parameter injection | `@Param('id') id: string` |
| `@Inject()` | Explicit dependency injection | `@Inject(UserService)` |

### 3. Base Classes

| Class | Purpose | Inherit When |
|-------|---------|--------------|
| `BaseController` | HTTP controller functionality | Creating any controller |
| `BaseService` | Service with logger and config | Creating any service |

## Documentation Structure

### [Getting Started](./getting-started.md)
Step-by-step guide to create your first OneBun application.

### [Architecture](./architecture.md)
Deep dive into framework architecture, DI system, and Effect.js integration.

### API Reference
- [Core Package](./api/core.md) - Application, modules, lifecycle
- [Decorators](./api/decorators.md) - All available decorators
- [Controllers](./api/controllers.md) - HTTP controllers and routing
- [Services](./api/services.md) - Service layer and DI
- [Validation](./api/validation.md) - ArkType-based validation
- [Environment](./api/envs.md) - Type-safe configuration
- [Logger](./api/logger.md) - Structured logging
- [HTTP Client](./api/requests.md) - External API calls
- [Cache](./api/cache.md) - In-memory and Redis caching
- [Database](./api/drizzle.md) - Drizzle ORM integration
- [Metrics](./api/metrics.md) - Prometheus metrics
- [Tracing](./api/trace.md) - Distributed tracing

### Examples
- [Basic Application](./examples/basic-app.md) - Minimal working app
- [CRUD API](./examples/crud-api.md) - Full CRUD with validation
- [Multi-Service](./examples/multi-service.md) - Microservices pattern

## Minimal Working Example

```typescript
// src/config.ts
import { Env } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
};

export type AppConfig = typeof envSchema;
```

```typescript
// src/counter.service.ts
import { BaseService, Service } from '@onebun/core';

@Service()
export class CounterService extends BaseService {
  private value = 0;

  getValue(): number {
    this.logger.debug('Getting counter value', { value: this.value });
    return this.value;
  }

  increment(amount = 1): number {
    this.value += amount;
    return this.value;
  }
}
```

```typescript
// src/counter.controller.ts
import { BaseController, Controller, Get, Post, Body } from '@onebun/core';
import { CounterService } from './counter.service';

@Controller('/api/counter')
export class CounterController extends BaseController {
  constructor(private counterService: CounterService) {
    super();
  }

  @Get('/')
  async getValue(): Promise<Response> {
    const value = this.counterService.getValue();
    return this.success({ value });
  }

  @Post('/increment')
  async increment(@Body() body?: { amount?: number }): Promise<Response> {
    const newValue = this.counterService.increment(body?.amount);
    return this.success({ value: newValue });
  }
}
```

```typescript
// src/app.module.ts
import { Module } from '@onebun/core';
import { CounterController } from './counter.controller';
import { CounterService } from './counter.service';

@Module({
  controllers: [CounterController],
  providers: [CounterService],
})
export class AppModule {}
```

```typescript
// src/index.ts
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true },
});

app.start();
```

## Key Patterns for AI Agents

### 1. Response Format
Always use standardized responses:
```typescript
// Success
return this.success(data);           // { success: true, result: data }

// Error
return this.error('message', 400);   // { success: false, code: 400, message: 'message' }
```

### 2. Dependency Injection
Dependencies are auto-detected from constructor:
```typescript
@Controller('/users')
export class UserController extends BaseController {
  // CounterService is automatically injected
  constructor(private counterService: CounterService) {
    super();
  }
}
```

### 3. Validation with ArkType
```typescript
import { type } from 'arktype';

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  age: 'number > 0',
});

@Post('/')
async createUser(@Body(createUserSchema) user: typeof createUserSchema.infer) {
  // user is validated and typed
}
```

### 4. Environment Configuration
```typescript
// Access config in service/controller
const port = this.config.get('server.port');
```

## Commands

```bash
# Development
bun run dev           # Start with watch mode
bun run dev:once      # Start once

# Testing
bun test              # Run all tests

# Type checking
bunx tsc --noEmit     # Check TypeScript errors

# Linting
bun lint              # Check lint errors
```

## Package Dependencies

```json
{
  "dependencies": {
    "@onebun/core": "^0.1.0",
    "@onebun/logger": "^0.1.0",
    "@onebun/envs": "^0.1.0",
    "@onebun/requests": "^0.1.0",
    "@onebun/metrics": "^0.1.0",
    "@onebun/trace": "^0.1.0",
    "@onebun/cache": "^0.1.0",
    "@onebun/drizzle": "^0.1.0",
    "effect": "^3.x",
    "arktype": "^2.x"
  }
}
```
