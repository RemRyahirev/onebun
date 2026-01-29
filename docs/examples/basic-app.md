# Basic Application Example

A minimal OneBun application with a single controller and service.

## Project Structure

```
basic-app/
├── src/
│   ├── index.ts
│   ├── app.module.ts
│   ├── config.ts
│   ├── hello.controller.ts
│   └── hello.service.ts
├── .env
├── package.json
└── tsconfig.json
```

## package.json

```json
{
  "name": "basic-app",
  "version": "1.0.0",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "typecheck": "bunx tsc --noEmit"
  },
  "dependencies": {
    "@onebun/core": "^0.1.0",
    "@onebun/logger": "^0.1.0",
    "@onebun/envs": "^0.1.0",
    "effect": "^3.0.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.0.0"
  }
}
```

## tsconfig.json

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
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

## .env

```bash
PORT=3000
HOST=0.0.0.0
APP_NAME=basic-app
DEBUG=true
```

## src/config.ts

```typescript
import { Env } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000, env: 'PORT' }),
    host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
  },
  app: {
    name: Env.string({ default: 'basic-app', env: 'APP_NAME' }),
    debug: Env.boolean({ default: false, env: 'DEBUG' }),
  },
};

export type AppConfig = typeof envSchema;
```

## src/hello.service.ts

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class HelloService extends BaseService {
  private greetCount = 0;

  /**
   * Generate a greeting message
   * @param name - Name to greet
   * @returns Greeting message
   */
  greet(name: string): string {
    this.greetCount++;
    this.logger.info('Generating greeting', {
      name,
      greetCount: this.greetCount,
    });
    return `Hello, ${name}! You are visitor #${this.greetCount}`;
  }

  /**
   * Get simple greeting
   */
  sayHello(): string {
    return 'Hello from OneBun!';
  }

  /**
   * Get statistics
   */
  getStats(): { greetCount: number; uptime: number } {
    return {
      greetCount: this.greetCount,
      uptime: process.uptime(),
    };
  }
}
```

## src/hello.controller.ts

```typescript
import {
  Controller,
  BaseController,
  Get,
  Param,
} from '@onebun/core';

import { HelloService } from './hello.service';

@Controller('/api')
export class HelloController extends BaseController {
  constructor(private helloService: HelloService) {
    super();
  }

  /**
   * GET /api/hello
   * Simple hello endpoint
   */
  @Get('/hello')
  async hello(): Promise<Response> {
    this.logger.info('Hello endpoint called');
    const message = this.helloService.sayHello();
    return this.success({ message });
  }

  /**
   * GET /api/hello/:name
   * Greet a specific person
   */
  @Get('/hello/:name')
  async greet(@Param('name') name: string): Promise<Response> {
    this.logger.info('Greet endpoint called', { name });
    const greeting = this.helloService.greet(name);
    return this.success({ greeting });
  }

  /**
   * GET /api/stats
   * Get service statistics
   */
  @Get('/stats')
  async stats(): Promise<Response> {
    const stats = this.helloService.getStats();
    return this.success(stats);
  }

  /**
   * GET /api/health
   * Health check endpoint
   */
  @Get('/health')
  async health(): Promise<Response> {
    return this.success({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  }
}
```

## src/app.module.ts

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

## src/index.ts

```typescript
import { OneBunApplication } from '@onebun/core';

import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  host: '0.0.0.0',
  development: true,
  envSchema,
  envOptions: {
    loadDotEnv: true,
  },
  metrics: {
    enabled: true,
    path: '/metrics',
  },
  tracing: {
    enabled: true,
    serviceName: 'basic-app',
  },
});

app.start()
  .then(() => {
    const logger = app.getLogger({ className: 'Bootstrap' });
    logger.info('Basic app started successfully!');
    logger.info(`Server: http://localhost:3000`);
    logger.info(`Metrics: http://localhost:3000/metrics`);
  })
  .catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
```

## Running the Application

```bash
# Install dependencies
bun install

# Start in development mode
bun run dev

# Or start once
bun run start
```

## Testing the API

```bash
# Simple hello
curl http://localhost:3000/api/hello
# Response: {"success":true,"result":{"message":"Hello from OneBun!"}}

# Greet by name
curl http://localhost:3000/api/hello/World
# Response: {"success":true,"result":{"greeting":"Hello, World! You are visitor #1"}}

curl http://localhost:3000/api/hello/Alice
# Response: {"success":true,"result":{"greeting":"Hello, Alice! You are visitor #2"}}

# Get stats
curl http://localhost:3000/api/stats
# Response: {"success":true,"result":{"greetCount":2,"uptime":12.345}}

# Health check
curl http://localhost:3000/api/health
# Response: {"success":true,"result":{"status":"healthy","timestamp":"2024-01-15T10:30:00.000Z"}}

# Metrics
curl http://localhost:3000/metrics
```

## Key Takeaways

1. **Decorators**: Use `@Module`, `@Controller`, `@Service`, `@Get` to define structure
2. **Base Classes**: Extend `BaseController` and `BaseService` for built-in features
3. **DI**: Services are automatically injected via constructor
4. **Responses**: Use `this.success()` for standardized JSON responses
5. **Logging**: Use `this.logger` for structured logging
6. **Config**: Define schema in `config.ts`, load via `envSchema` option
