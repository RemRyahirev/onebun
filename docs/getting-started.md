---
description: Installation and basic setup guide for OneBun framework. Prerequisites, project structure, modules, controllers, services.
---

<llm-only>

## Technical Context for AI Agents

**Framework Version**: 0.1.0  
**Runtime**: Bun.js 1.2.12+ (NOT Node.js compatible)  
**TypeScript**: strict mode required

**Key Patterns**:
- Always extend BaseController for HTTP controllers
- Always extend BaseService for services
- Use @Module decorator for DI container registration
- Prefer Promise API over Effect API in application code
- Effect.pipe is used internally, not Effect.gen

**Package Structure**:
- @onebun/core - main framework (decorators, app, controllers, services)
- @onebun/cache - caching module
- @onebun/drizzle - database integration
- @onebun/envs - environment configuration
- @onebun/logger - logging
- @onebun/metrics - Prometheus metrics
- @onebun/trace - distributed tracing
- @onebun/requests - HTTP client
- @onebun/nats - NATS/JetStream integration

**Common Mistakes**:
- Forgetting super() call in controller/service constructors
- Using Node.js APIs instead of Bun.js
- Using Effect.gen instead of Effect.pipe
- Not registering services in @Module providers array

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

## Next Steps

1. **Add More Features**: See [CRUD API Example](./examples/crud-api.md)
2. **Add Database**: See [Drizzle Integration](./api/drizzle.md)
3. **Add Caching**: See [Cache Module](./api/cache.md)
4. **Multi-Service**: See [Multi-Service Example](./examples/multi-service.md)

## Common Issues

### Decorator Errors
Ensure `experimentalDecorators` and `emitDecoratorMetadata` are `true` in tsconfig.json.

### Service Not Found
- Check that service has `@Service()` decorator
- Ensure service is listed in module's `providers` array
- Service class must have `@Service()` decorator for DI to work (enables TypeScript metadata emission)

### Type Errors
Run `bunx tsc --noEmit` to check TypeScript errors before starting the app.
