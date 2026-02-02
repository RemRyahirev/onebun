---
layout: home
description: OneBun framework overview - Bun.js framework with Effect.ts, NestJS-inspired DI, and one default solution per problem.

hero:
  name: OneBun Framework
  text: Bun.js Framework with Effect.ts
  tagline: NestJS-inspired framework with one default solution per problem. Promise-based API for client code, Effect.js internally.
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
---

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
| `@Inject()` | Explicit dependency injection | `@Inject(UserService)` |
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
  port: 3000,
  envSchema,
  metrics: { enabled: true },
  tracing: { enabled: true },
});

app.start();
```

## Key Patterns

### Response Format

Always use standardized responses:

```typescript
// Success
return this.success(data);           // { success: true, result: data }

// Error
return this.error('message', 400);   // { success: false, code: 400, message: 'message' }
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
