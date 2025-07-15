# OneBun Framework - Development Commands & Guidelines

## Type Checking & Linting Commands

### TypeScript Type Checking
```bash
bunx tsc --noEmit
```
- Проверяет типы TypeScript без генерации файлов
- Должен выполняться без ошибок перед коммитом

### Linting
```bash
bun lint
```
- Запускает ESLint для проверки стиля кода
- Многие "Resolve error" связаны с конфигурацией и не критичны

## Code Style Guidelines

### Type Safety
- Использовать `any` только при необходимости с комментарием `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Предпочитать типизированные интерфейсы вместо `unknown` где возможно
- Всегда исправлять ошибки TypeScript перед коммитом

### Decorator Types
- Декораторы контроллеров используют `(...args: any[]) => any` для совместимости
- Это обоснованное использование `any` для поддержки различных конструкторов

### Configuration Access
- В контроллерах config имеет тип `unknown`, используем `(this.config as any)?.get()` с eslint-disable

## General Guidelines

### Language & Communication
- **Chat communication**: Russian with English technical terms
- **All code, comments, and content**: English (exception: md files for Russian audience)
- **Documentation**: English-first for international audience
- **References**: Maintain `references.md` in project root as structured knowledge base

### Technology Stack
- **Runtime**: Bun.js (no Node.js compatibility)
- **Language**: TypeScript with best practices (minimal `any` usage)
- **Project structure**: Monorepo on Bun.js
- **Functional programming**: Effect library (using `Effect.pipe`, avoiding `Effect.gen`)
- **Validation**: arktype with auto-generated OpenAPI 3.1 documentation via JSON Schema
- **ORM**: Drizzle
- **Type checking**: Always run `bunx tsc --noEmit` and fix all TypeScript errors

## Project Philosophy

**One way to solve each problem** - sacrifice flexibility for development speed and performance. Default/built-in solution for every common problem.

## Architecture Overview

### Core Framework (@onebun/core)
Main package that ties everything together with reasonable defaults.

**Components:**
- **Decorators**: NestJS-like decorators (`@Module`, `@Controller`, `@Injectable`, `@Get`, etc.)
- **HTTP Server**: Built-in web server with automatic metrics/tracing integration
- **App Interface**: Minimal unit for service deployment (services can have multiple apps)
- **Client Generation**: Tool to generate typed HTTP clients from exported interfaces

### Standalone Packages

#### @onebun/envs
Environment variable management with type safety.

**Features:**
- File and environment variable loading (env vars take priority)
- Validation and default values
- Type-safe access via dot-notation paths (`config.get('app.port')`)
- Runtime value updates (useful for testing)
- Sensitive data masking for logging
- Required fields validation (app crashes if missing)

#### @onebun/logger
Structured logging with context preservation.

**Features:**
- **Dev mode**: Colorized console output
- **Prod mode**: JSON line format
- Log levels with `LOG_LEVEL` environment variable
- Automatic trace ID injection
- Object formatting for dev mode
- Timestamp on every record
- Customizable transports and formatters

#### @onebun/metrics
Prometheus-compatible metrics collection.

**Features:**
- Wrapper around `prom-client`
- Automatic endpoint metrics
- System metrics (CPU, memory, GC)
- Custom metrics interfaces
- Built-in /metrics endpoint

#### @onebun/trace
Distributed tracing with OpenTelemetry.

**Features:**
- Uses `@opentelemetry/api`
- Automatic trace generation
- Inter-service trace propagation
- Integration with logger and metrics

#### @onebun/requests
Unified HTTP client for internal and external calls.

**Features:**
- Built on `fetch` and `effect`
- Automatic retries with backoff
- Response validation
- External call metrics collection
- Trace propagation
- Standardized error handling

## Error Handling & Response Standardization

### Error Types
```typescript
export interface OneBunError<E extends string = string, R extends string = string> {
  error: E;
  code: number;
  message?: string;
  traceId?: string;
  details?: Record<string, unknown>;
  originalError?: OneBunError<R>;
}

export interface SuccessResponse<T = any> {
  success: true;
  result: T;
  traceId?: string;
}

export interface ErrorResponse<E extends string = string, R extends string = string> extends OneBunError<E, R> {
  success: false;
}

export type ApiResponse<T = any, E extends string = string, R extends string = string> = 
  SuccessResponse<T> | ErrorResponse<E, R>;
```

### Response Standardization
- All OneBun applications return `ApiResponse` format
- All `@onebun/requests` calls return `ApiResponse` format
- Error chain preservation through `originalError`
- Automatic trace ID propagation

## Planned Features

### Core Extensions
- **Cache**: Local (in-memory) and Redis caching with flexible TTL
- **WebSocket**: Built-in WS server with typed client generation and lightweight diff support
- **Auth**: Inter-service authentication (Bearer + cryptographic signatures)
- **Health checks**: Standardized health endpoints with infrastructure dependency checks
- **Validation**: Type-safe validation without code duplication
- **Swagger**: Auto-generated documentation from types and decorators
- **HashiCorp Vault**: Built-in service for secrets management

### Database Modules
- **SQLite**: Typed, code-first with migrations
- **PostgreSQL**: Typed, code-first with migrations
- **Redis**: Typed interface with reasonable defaults
- **Kafka**: Event subscription and emission decorators
- **ClickHouse**: Analytics database with typed, code-first approach

### Base Configurations
- **tsconfig.json**: Base TypeScript configuration
- **biome.json**: Base linting/formatting configuration
- **werf.yaml**: Base deployment configuration

### Templates
- **Single app**: Full application template with all dependencies
- **Multi app**: Microservices template for multiple services in one repo
- **CLI tool**: Interactive project management and scaffolding

### Template Services
- **Library service**: Reference data management with CRUD + WebSocket
- **Inter-service auth**: Authentication service
- **Admin service**: Admin panel with RBAC (using CASL)

### Infrastructure
- **Temporal integration**: Workflow orchestration
- **Local infrastructure**: Local development environment setup
- **Local CI**: GitLab CI emulation and testing tools

## Development Workflow

### Project Creation
```bash
bunx create-onebun-app my-service --template=single
# or
bunx create-onebun-app my-microservices --template=multi
```

### Type Safety Validation
```bash
bunx tsc --noEmit
```

### Project Structure
```
example/                  # example app
future-example/           # vision of future of example app (use it as reference to evolve current state of framework)
packages/
├── core/                 # @onebun/core
├── envs/                 # @onebun/envs
├── logger/               # @onebun/logger
├── metrics/              # @onebun/metrics
├── trace/                # @onebun/trace
├── requests/             # @onebun/requests
├── modules/
│   ├── postgres/         # @onebun/postgres
│   ├── redis/            # @onebun/redis
│   └── kafka/            # @onebun/kafka
├── templates/
│   ├── single-app/
│   └── multi-app/
└── cli/                  # @onebun/cli
```

### Integration Example
```typescript
import { OneBunApp } from '@onebun/core';
import { UserModule } from './user.module';
import { envSchema } from './config';

const app = new OneBunApplication(UserModule, {
  port: 3001,
  host: '0.0.0.0',
  development: true,
  envSchema,
  envOptions: {
    envFilePath: '../../.env',
  },
  metrics: {
    enabled: true,
    path: '/metrics',
    collectHttpMetrics: true,
    collectSystemMetrics: true,
    collectGcMetrics: true,
    prefix: 'example_app_',
  },
  tracing: {
    enabled: true,
    serviceName: 'onebun-example',
    serviceVersion: '0.1.0',
    samplingRate: 1.0,
    traceHttpRequests: true,
    traceDatabaseQueries: true,
    defaultAttributes: {
      'service.name': 'onebun-example',
      'service.version': '0.1.0',
      'deployment.environment': 'development',
    },
  },
});
```

## AI Assistant Guidelines

When working on OneBun project:

1. **Always use TypeScript** with strict typing
2. **Prefer Effect.pipe** over Effect.gen
3. **Validate types** with `bunx tsc --noEmit`
4. **Follow response standardization** using ApiResponse types
5. **Use arktype for validation** with OpenAPI generation
6. **Maintain references.md** with structured documentation
7. **Code in English**, communicate in Russian with English terms
8. **One solution per problem** - prefer built-in approaches
9. **Performance first** - leverage Bun.js capabilities
10. **Type safety first** - ensure full TypeScript coverage
