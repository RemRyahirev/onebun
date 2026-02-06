---
description: Installation and basic setup guide for OneBun framework. Prerequisites, project structure, modules, controllers, services.
---

<llm-only>

## Technical Context for AI Agents

**Framework Version**: 0.1.0
**Runtime**: Bun.js 1.2.12+ (NOT Node.js compatible)
**TypeScript**: strict mode required

**Framework Scope**: OneBun is a batteries-included backend framework.
It is NOT a minimal router — it provides the full stack:
DI, REST, WebSocket (Socket.IO + typed client), database (Drizzle ORM),
cache (memory + Redis), queues (memory/Redis/NATS/JetStream), scheduler,
Prometheus metrics, OpenTelemetry tracing, typed HTTP clients with inter-service
HMAC auth, auto-generated OpenAPI docs, ArkType validation (schema = types = docs),
microservice orchestration (MultiServiceApplication), and graceful shutdown.

**Package Structure**:
* @onebun/core - DI, modules, controllers, services, guards, middleware,
  WebSocket gateway, queue system, MultiServiceApplication, graceful shutdown
* @onebun/cache - in-memory + Redis caching with DI, shared Redis connection
* @onebun/drizzle - Drizzle ORM (PostgreSQL, SQLite), schema-first, auto-migrations, BaseRepository
* @onebun/docs - auto-generated OpenAPI 3.1 from ArkType schemas and decorators
* @onebun/envs - type-safe env config with validation, sensitive masking, .env loading
* @onebun/logger - structured logging (JSON/pretty), child loggers, trace context
* @onebun/metrics - Prometheus metrics, @Timed/@Counted, auto HTTP/system metrics
* @onebun/trace - OpenTelemetry, @Span decorator, configurable sampling/export
* @onebun/requests - HTTP client with retries, auth schemes, typed inter-service clients
* @onebun/nats - NATS/JetStream queue backends

**Key Patterns**:
* Always extend BaseController for HTTP controllers
* Always extend BaseService for services
* Use @Module decorator for DI container registration
* ArkType schema in @Body(schema) provides: TS type inference + runtime validation + OpenAPI schema
* Prefer Promise API over Effect API in application code
* Effect.pipe is used internally, not Effect.gen

**Common Mistakes**:
* Forgetting super() call in controller/service constructors
* Using Node.js APIs instead of Bun.js
* Using Effect.gen instead of Effect.pipe
* Not registering services in @Module providers array
* Placing @ApiResponse above route decorator (must be below)
* Placing @ApiTags below @Controller (must be above)

</llm-only>

# Getting Started with OneBun

## Prerequisites

- **Bun.js** 1.2.12+ (not Node.js)
- TypeScript knowledge
- Basic understanding of decorators

## Step 1: Project Setup

```bash
# Create project directory
mkdir my-onebun-app
cd my-onebun-app

# Initialize Bun project
bun init -y

# Install OneBun packages
bun add @onebun/core @onebun/logger @onebun/envs @onebun/requests effect arktype
```

## Step 2: TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**Critical**: `experimentalDecorators` and `emitDecoratorMetadata` must be `true`.

## Step 3: Create Environment Schema

`src/config.ts`:

```typescript
import { Env } from '@onebun/core';

/**
 * Type-safe environment configuration schema
 * All env variables are validated and typed at startup
 */
export const envSchema = {
  server: {
    port: Env.number({ default: 3000, env: 'PORT' }),
    host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
  },
  app: {
    name: Env.string({ default: 'my-onebun-app', env: 'APP_NAME' }),
    debug: Env.boolean({ default: true, env: 'DEBUG' }),
  },
  // Database example (optional)
  database: {
    url: Env.string({ env: 'DATABASE_URL', sensitive: true }),
  },
};

export type AppConfig = typeof envSchema;
```

## Step 4: Create a Service

`src/hello.service.ts`:

```typescript
import { BaseService, Service } from '@onebun/core';

@Service()
export class HelloService extends BaseService {
  private greetCount = 0;

  /**
   * Generate a greeting message
   */
  greet(name: string): string {
    this.greetCount++;
    this.logger.info('Generating greeting', { name, count: this.greetCount });
    return `Hello, ${name}! You are visitor #${this.greetCount}`;
  }

  /**
   * Get total greet count
   */
  getCount(): number {
    return this.greetCount;
  }
}
```

**Key Points**:
- `@Service()` decorator registers the class for DI
- `BaseService` provides `this.logger` and `this.config`
- Constructor receives dependencies automatically

## Step 5: Create a Controller

`src/hello.controller.ts`:

```typescript
import {
  BaseController,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@onebun/core';
import { type } from 'arktype';

import { HelloService } from './hello.service';

// Define validation schema
const greetBodySchema = type({
  name: 'string',
  'message?': 'string',
});

@Controller('/api/hello')
export class HelloController extends BaseController {
  // HelloService is automatically injected
  constructor(private helloService: HelloService) {
    super();
  }

  /**
   * GET /api/hello
   * Basic hello endpoint
   */
  @Get('/')
  async hello(): Promise<Response> {
    this.logger.info('Hello endpoint called');
    return this.success({ message: 'Hello from OneBun!' });
  }

  /**
   * GET /api/hello/:name
   * Greet a specific person
   */
  @Get('/:name')
  async greetByPath(@Param('name') name: string): Promise<Response> {
    const greeting = this.helloService.greet(name);
    return this.success({ greeting });
  }

  /**
   * POST /api/hello/greet
   * Greet with validated body
   */
  @Post('/greet')
  async greetWithBody(
    @Body(greetBodySchema) body: typeof greetBodySchema.infer,
  ): Promise<Response> {
    const greeting = this.helloService.greet(body.name);
    return this.success({
      greeting,
      customMessage: body.message,
    });
  }

  /**
   * GET /api/hello/stats
   * Get service statistics
   */
  @Get('/stats')
  async stats(): Promise<Response> {
    return this.success({
      totalGreets: this.helloService.getCount(),
      uptime: process.uptime(),
    });
  }
}
```

**Key Points**:
- `@Controller(path)` defines base path for all routes
- `BaseController` provides `this.success()`, `this.error()`, `this.logger`
- `@Param('name')` extracts path parameters
- `@Body(schema)` validates and injects request body
- Constructor DI is automatic (just declare private property)

## Step 6: Create the Module

`src/app.module.ts`:

```typescript
import { Module } from '@onebun/core';

import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

@Module({
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
```

**Module Structure**:
- `controllers`: Array of controller classes
- `providers`: Array of service classes
- `imports`: Array of other modules to import
- `exports`: Array of services to export to parent modules

## Step 7: Create Entry Point

`src/index.ts`:

```typescript
import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  // port and host can be omitted - they'll use PORT/HOST env vars or defaults (3000/'0.0.0.0')
  // port: 3000,
  // host: '0.0.0.0',
  development: true,
  envSchema,
  envOptions: {
    loadDotEnv: true,
  },
  metrics: {
    enabled: true,
    path: '/metrics',
    collectHttpMetrics: true,
    collectSystemMetrics: true,
  },
  tracing: {
    enabled: true,
    serviceName: 'my-onebun-app',
    traceHttpRequests: true,
  },
});

app.start()
  .then(() => {
    const logger = app.getLogger({ className: 'Bootstrap' });
    logger.info('Application started successfully');
  })
  .catch((error) => {
    console.error('Failed to start application:', error);
    process.exit(1);
  });
```

## Step 8: Create .env File (Optional)

`.env`:

```bash
PORT=3000
HOST=0.0.0.0
APP_NAME=my-onebun-app
DEBUG=true
```

## Step 9: Add Scripts to package.json

```json
{
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "dev:once": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

## Step 10: Run the Application

```bash
# Start in development mode with hot reload
bun run dev

# Or start once
bun run dev:once
```

## Test Your API

```bash
# Basic hello
curl http://localhost:3000/api/hello

# Greet by name
curl http://localhost:3000/api/hello/World

# Greet with body
curl -X POST http://localhost:3000/api/hello/greet \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "message": "Welcome!"}'

# Get stats
curl http://localhost:3000/api/hello/stats

# Get metrics (Prometheus format)
curl http://localhost:3000/metrics
```

## Expected Responses

```json
// GET /api/hello
{
  "success": true,
  "result": { "message": "Hello from OneBun!" }
}

// GET /api/hello/World
{
  "success": true,
  "result": { "greeting": "Hello, World! You are visitor #1" }
}

// POST /api/hello/greet
{
  "success": true,
  "result": {
    "greeting": "Hello, Alice! You are visitor #2",
    "customMessage": "Welcome!"
  }
}
```

## Project Structure Summary

```
my-onebun-app/
├── src/
│   ├── index.ts           # Application entry point
│   ├── app.module.ts      # Root module
│   ├── config.ts          # Environment schema
│   ├── hello.controller.ts
│   └── hello.service.ts
├── .env                   # Environment variables
├── package.json
└── tsconfig.json
```

## What's Next

You've built a basic OneBun application. Here's what else the framework offers:

### Add Features to Your App
- **[Validation](/api/validation)** — ArkType schemas: one definition = TS types + runtime validation + OpenAPI 3.1 docs
- **[Database](/api/drizzle)** — Drizzle ORM with PostgreSQL/SQLite, schema-first types, auto-migrations
- **[Caching](/api/cache)** — In-memory and Redis with DI integration
- **[Queue & Scheduler](/api/queue)** — Background jobs with in-memory, Redis, NATS, JetStream backends
- **[WebSocket](/api/websocket)** — Real-time communication with Socket.IO support and typed clients

### Production Readiness
- **[Metrics](/api/metrics)** — Prometheus-compatible: auto HTTP/system metrics, @Timed/@Counted decorators
- **[Tracing](/api/trace)** — OpenTelemetry with @Span decorator, trace context in logs
- **[HTTP Client](/api/requests)** — Typed clients with retries, auth schemes, inter-service HMAC

### Scale to Microservices
- **[Multi-Service](/examples/multi-service)** — Run multiple services from one codebase with MultiServiceApplication
- **[OpenAPI Docs](/api/decorators#documentation-decorators)** — Auto-generated API documentation from schemas

### Complete Examples
- **[CRUD API](/examples/crud-api)** — Full CRUD with validation, error handling, repository pattern
- **[WebSocket Chat](/examples/websocket-chat)** — Real-time chat application
- **[Multi-Service](/examples/multi-service)** — Microservices with inter-service communication

## Common Issues

### Decorator Errors
Ensure `experimentalDecorators` and `emitDecoratorMetadata` are `true` in tsconfig.json.

### Service Not Found
- Check that service has `@Service()` decorator
- Ensure service is listed in module's `providers` array
- Service class must have `@Service()` decorator for DI to work (enables TypeScript metadata emission)

### Type Errors
Run `bunx tsc --noEmit` to check TypeScript errors before starting the app.
