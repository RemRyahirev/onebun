---
layout: home
description: "A complete, batteries-included TypeScript backend framework for Bun.js. NestJS-style architecture, full ecosystem: WebSocket, Drizzle, queues, cache, metrics, tracing, ArkType validation, typed clients."

hero:
  name: OneBun Framework
  text: A complete, batteries-included TypeScript backend framework for Bun.js
  tagline: One framework. One runtime. Everything you need for production backend services.
  image:
    src: /logo.png
    alt: OneBun Framework
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/RemRyahirev/onebun

features:
  - icon: 🚀
    title: Bun.js Native
    details: Built specifically for Bun.js runtime. Fast startup, native TypeScript support, and modern JavaScript features.
  - icon: 🎯
    title: One Solution per Problem
    details: Opinionated framework that provides a single, well-designed solution for each common problem. Less decisions, more productivity.
  - icon: 🔧
    title: Effect.ts Powered
    details: Leverages Effect.ts internally for robust error handling, dependency injection, and composable side effects.
  - icon: 📦
    title: Modular Architecture
    details: NestJS-inspired module system with decorators, controllers, and services. Familiar patterns, modern implementation.
  - icon: 🔌
    title: WebSocket Gateway
    details: Real-time communication with Socket.IO protocol support, room management, pattern matching, and type-safe clients.
  - icon: 🧪
    title: Battle-Tested
    details: Comprehensive test suite with high coverage — verified on every commit
    link: https://codecov.io/gh/RemRyahirev/onebun
---

**A complete, batteries-included TypeScript backend framework for Bun.js.**

OneBun brings NestJS-style architecture — modules, dependency injection, decorators — to the Bun.js runtime, with a full ecosystem of built-in packages: WebSocket (+ Socket.IO + typed client), microservices with single-image deployment, database integration (Drizzle ORM), message queues (Redis, NATS, JetStream), caching, Prometheus metrics, OpenTelemetry tracing, ArkType validation with auto-generated OpenAPI documentation, and typed inter-service HTTP clients.

One framework. One runtime. Everything you need for production backend services.

## Quick Reference

| Aspect | Details |
|--------|---------|
| **Runtime** | Bun.js (not Node.js compatible) |
| **Language** | TypeScript (strict mode, no `any`) |
| **Architecture** | NestJS-inspired with Effect.ts for side effects |
| **Philosophy** | One default solution per problem |
| **API Style** | Promise-based for client code, Effect.js internally |

## Core Concepts

### Application Structure

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

### Decorator System

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@Module()` | Define module with imports, controllers, providers | `@Module({ controllers: [UserController] })` |
| `@Controller(path)` | Define HTTP controller | `@Controller('/users')` |
| `@Service()` | Mark class as injectable service | `@Service()` |
| `@Get()`, `@Post()`, etc. | Define HTTP endpoints | `@Get('/:id')` |
| `@Body()`, `@Param()`, `@Query()` | Parameter injection | `@Param('id') id: string` |
| `@Inject()` | Explicit DI — rarely needed; prefer constructor params | `@Inject(AbstractService)` |
| `@WebSocketGateway()` | Define WebSocket gateway | `@WebSocketGateway({ path: '/ws' })` |
| `@OnMessage()`, `@OnConnect()`, etc. | WebSocket event handlers | `@OnMessage('chat:*')` |

### Base Classes

| Class | Purpose | Inherit When |
|-------|---------|--------------|
| `BaseController` | HTTP controller functionality | Creating any controller |
| `BaseService` | Service with logger and config | Creating any service |
| `BaseWebSocketGateway` | WebSocket gateway with rooms and emit | Creating WebSocket gateway |

## Minimal Working Example

```typescript
import {
  BaseController,
  BaseService,
  Controller,
  Env,
  Get,
  Module,
  OneBunApplication,
  Post,
  Body,
  Service,
  type InferConfigType,
} from '@onebun/core';

// ============================================================================
// 1. Environment Schema (src/config.ts)
// ============================================================================
const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
};

type AppConfig = InferConfigType<typeof envSchema>;

declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}

// ============================================================================
// 2. Service Layer (src/counter.service.ts)
// ============================================================================
@Service()
class CounterService extends BaseService {
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

// ============================================================================
// 3. Controller Layer (src/counter.controller.ts)
// ============================================================================
@Controller('/api/counter')
class CounterController extends BaseController {
  constructor(private counterService: CounterService) {
    super();
  }

  @Get('/')
  async getValue() {
    const value = this.counterService.getValue();
    return { value };
  }

  @Post('/increment')
  async increment(@Body() body?: { amount?: number }) {
    const newValue = this.counterService.increment(body?.amount);
    return { value: newValue };
  }
}

// ============================================================================
// 4. Module Definition (src/app.module.ts)
// ============================================================================
@Module({
  controllers: [CounterController],
  providers: [CounterService],
})
class AppModule {}

// ============================================================================
// 5. Application Entry Point (src/index.ts)
// ============================================================================
const app = new OneBunApplication(AppModule, {
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true },
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

## Key Patterns

### Response Format

Controllers return plain data (auto-wrapped) and throw for errors:

```typescript
// Success: return plain data (auto-wrapped)
return data;                              // → { success: true, result: data }

// Error: throw HttpException
throw new HttpException(400, 'message');  // → { success: false, error: 'message', code: 400 }
```

### Dependency Injection

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

### Validation with ArkType

```typescript
// src/user.schema.ts — schema + inferred type in one file
import { type } from '@onebun/core';

export const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  age: 'number > 0',
});

export type CreateUserDto = typeof createUserSchema.infer;
```

```typescript
// In controller — import named type, don't use typeof inline
import { createUserSchema, type CreateUserDto } from './user.schema';

@Post('/')
async createUser(@Body(createUserSchema) user: CreateUserDto) {
  // user is validated and typed
}
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

Only `@onebun/core` is required — it includes `logger`, `envs`, `requests`, `metrics`, `trace`, `effect`, and `arktype` as transitive dependencies.

```json
{
  "dependencies": {
    "@onebun/core": "^0.3.0"
  }
}
```

Add optional packages as needed:

```json
{
  "@onebun/drizzle": "^0.3.0",
  "@onebun/cache": "^0.3.0",
  "@onebun/nats": "^0.3.0",
  "@onebun/docs": "^0.3.0"
}
```
