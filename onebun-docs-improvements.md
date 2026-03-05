# OneBun: Улучшение документации

## Контекст проблемы

При анализе OneBun Framework AI-агент (Claude Opus) прочитал полную документацию (llms-full.txt, ai-docs page, project description) и сделал вывод что фреймворк — ранний MVP с базовым DI и контроллерами. В реальности OneBun — зрелый batteries-included фреймворк с WebSocket (+ Socket.IO + typed client), микросервисами, OpenAPI генерацией, Drizzle ORM интеграцией, queue системой (in-memory, Redis, NATS, JetStream), CacheModule, Prometheus metrics, OpenTelemetry tracing, ArkType validation, typed HTTP clients, graceful shutdown и другими возможностями.

Причина ошибки — документация отлично описывает **как использовать** каждую фичу (API reference), но не имеет верхнеуровневого слоя, который сообщает **что фреймворк умеет** до того как читатель углубится в детали. Ниже — конкретные предложения по исправлению.

---

## 1. Создать страницу «Features Overview»

### Где

Новая страница `/features.md` (или `/overview.md`). В навигации — между Home и Getting Started:

```
## Introduction
[Home](/onebun/)
[Features](/onebun/features)        ← NEW
[Getting Started](/onebun/getting-started)
[Architecture](/onebun/architecture)
```

### Что должно быть на странице

Цель — за 2 минуты чтения дать полную картину возможностей фреймворка. Не API reference, а обзор с кратким пояснением каждой возможности и ссылкой на детальную документацию.

Примерная структура:

```markdown
# Features Overview

OneBun is a complete, batteries-included backend framework for Bun.js. 
It provides everything needed to build production-grade TypeScript services 
— from HTTP routing to database integration, from message queues to observability.

## Core Framework (@onebun/core)

### Dependency Injection & Modules
NestJS-inspired module system with automatic constructor-based DI, 
module imports/exports, and service scoping.
→ [API Reference](/api/core)

### Controllers & Routing  
Decorator-based HTTP controllers with @Get, @Post, @Put, @Delete, @Patch.
Path parameters, query parameters, body parsing, header extraction.
Standardized ApiResponse format across the application.
→ [API Reference](/api/controllers)

### Guards
Custom guard support for authentication and authorization. 
Write guard functions and apply them via decorators to protect routes.
→ [API Reference](/api/decorators)

### Middleware
Request/response middleware with @UseMiddleware decorator.
Supports middleware chaining on individual routes.
→ [API Reference](/api/decorators)

## WebSocket (@onebun/core)

### WebSocket Gateway
Decorator-based WebSocket handlers with @WebSocketGateway, @SubscribeMessage.
Built on Bun's native WebSocket support for maximum performance.

### Socket.IO Support  
Optional Socket.IO adapter for browser compatibility, 
rooms, namespaces, and broadcasting.

### Typed WebSocket Client
Auto-generated typed client for type-safe frontend ↔ backend 
WebSocket communication.
→ [API Reference](/api/websocket)

## Microservices (@onebun/core)

### MultiServiceApplication
Run multiple services from a single codebase and Docker image:
- **Development**: all services in one process (`bun run src/index.ts`)
- **Production**: one service per process (`ONEBUN_SERVICES=users bun run src/index.ts`)
- **Flexible**: any combination via environment variables

### Inter-Service Communication  
Typed HTTP clients with `createServiceDefinition` + `createServiceClient`.
HMAC authentication for service-to-service calls.

### Kubernetes-Ready  
Environment-based service selection, external service URL configuration,
single Docker image for all services.
→ [Multi-Service Example](/examples/multi-service)

## Validation (@onebun/core + ArkType)

### Single Source of Truth
One ArkType schema serves as:
- **TypeScript type** (compile-time safety)
- **Runtime validation** (request body, query params)
- **OpenAPI 3.1 schema** (auto-generated documentation)

Zero duplication between types, validation rules, and API docs.

### @Body() Validation
Pass ArkType schema to @Body decorator for automatic validation 
with typed error responses.
→ [API Reference](/api/validation)

## API Documentation (@onebun/docs)

### OpenAPI Auto-Generation
Automatic OpenAPI 3.1 spec from decorators and ArkType schemas.
Install `@onebun/docs` and get Swagger UI with zero configuration.

### Documentation Decorators
@ApiTags, @ApiOperation, @ApiResponse for additional metadata.
→ [API Reference](/api/decorators)

## Database (@onebun/drizzle)

### Drizzle ORM Integration
Schema-first approach with full type inference.
Supports PostgreSQL and SQLite (via bun:sqlite).

### Migrations
- CLI: `bunx onebun-drizzle generate` / `push` / `studio`
- Programmatic: `generateMigrations()`, `pushSchema()`
- Auto-migrate on startup: `autoMigrate: true`

### Repository Pattern
BaseRepository with built-in CRUD operations, 
custom queries via Drizzle query builder.
→ [API Reference](/api/drizzle)

## Queue & Scheduler (@onebun/core + @onebun/nats)

### Queue System
Background job processing with multiple backends:
- **In-memory** — zero config, for development and simple use cases
- **Redis Pub/Sub** — distributed queues via Redis
- **NATS** — high-performance messaging (via @onebun/nats)
- **JetStream** — persistent, at-least-once delivery (via @onebun/nats)

### Scheduler
Cron-like task scheduling with the same backend options.
→ [API Reference](/api/queue)

## Caching (@onebun/cache)

### CacheModule
- **In-memory cache** — with TTL, max size, cleanup intervals
- **Redis cache** — with shared connection pool support
- Batch operations: getMany, setMany, deleteMany
- Cache-aside, invalidation, and warming patterns
→ [API Reference](/api/cache)

## HTTP Client (@onebun/requests)

### createHttpClient()
Full-featured HTTP client with:
- **Authentication**: Bearer, API Key, Basic, HMAC (inter-service)
- **Retries**: fixed, linear, exponential backoff strategies
- **Typed responses**: ApiResponse<T> with success/error discrimination

### Typed Service Clients
`createServiceDefinition()` + `createServiceClient()` for 
type-safe inter-service REST communication without code generation.
→ [API Reference](/api/requests)

## Observability

### Prometheus Metrics (@onebun/metrics)
- Automatic HTTP request metrics (duration, count, status codes)
- System metrics (CPU, memory, event loop, GC)
- Custom metrics: Counter, Gauge, Histogram
- Decorator-based: @Timed(), @Counted()
- Endpoint: GET /metrics
→ [API Reference](/api/metrics)

### OpenTelemetry Tracing (@onebun/trace)
- Automatic HTTP request tracing
- @Span() decorator for custom spans
- Trace context propagation in logs
- Configurable sampling, export to external collectors
→ [API Reference](/api/trace)

### Structured Logging (@onebun/logger)
- JSON (production) and pretty (development) output
- Log levels: trace, debug, info, warn, error, fatal
- Child loggers with context inheritance
- Automatic trace context in log entries
→ [API Reference](/api/logger)

## Configuration (@onebun/envs)

### Type-Safe Environment Variables
- Schema definition with Env.string(), Env.number(), Env.boolean(), Env.array()
- Validation, defaults, transforms
- Sensitive value masking in logs
- .env file support
- Per-service overrides in MultiServiceApplication
→ [API Reference](/api/envs)

## Production Features

### Graceful Shutdown
Enabled by default. Handles SIGTERM/SIGINT, closes HTTP server, 
WebSocket connections, and Redis connections.

### Shared Redis Connection
Single Redis connection pool shared between Cache, WebSocket, 
and Queue modules. Reduced memory footprint and connection count.

### Effect.js Integration
Internal architecture built on Effect.js for type-safe 
side effect management. Optional Effect API for advanced use cases.
```

### Заметки для реализации

- Структура выше — примерная. Адаптируй под реальные названия API и текущее состояние фич.
- Каждый раздел должен содержать 2-4 предложения описания + ссылку на API reference.
- Не нужно дублировать API reference — цель страницы в том чтобы показать ЧТО есть, а не КАК использовать.
- Если какая-то фича ещё в разработке (interceptors, pipes) — не включать на эту страницу.

---

## 2. Добавить feature summary в начало llms-full.txt

### Проблема

llms-full.txt — это конкатенация всех страниц документации. При больших объёмах AI-агенты и RAG-системы могут обрезать контент. Сейчас файл начинается со страницы AI Documentation (мета-информация о форматах), затем примеры, затем API pages в алфавитном порядке. WebSocket, Queue, Validation — в конце файла, и при обрезке теряются.

### Решение

Добавить в самое начало llms-full.txt (до первой страницы) блок-резюме:

```markdown
# OneBun Framework — Complete Documentation

## Framework Summary

OneBun is a batteries-included TypeScript backend framework for Bun.js runtime,
inspired by NestJS architecture. It provides a complete ecosystem for building
production-grade backend services.

### Core Capabilities
- **Modules & DI**: NestJS-style @Module, @Controller, @Service, @Injectable with automatic constructor injection
- **HTTP Routing**: Decorator-based (@Get, @Post, @Put, @Delete, @Patch) with path params, query, body, headers
- **Guards**: Custom route guards for authentication/authorization
- **Middleware**: @UseMiddleware decorator with chaining support
- **Graceful Shutdown**: Enabled by default, handles SIGTERM/SIGINT

### WebSocket
- WebSocket Gateway with @WebSocketGateway, @SubscribeMessage decorators
- Socket.IO adapter support (rooms, namespaces, broadcasting)
- Auto-generated typed WebSocket client for frontend integration

### Microservices
- MultiServiceApplication: run multiple services from single codebase/image
- Dev: all services in one process. Prod: ONEBUN_SERVICES=name selects services
- Typed inter-service HTTP clients with createServiceDefinition/createServiceClient
- HMAC authentication for service-to-service communication

### Validation (ArkType)
- Single source of truth: one schema = TypeScript type + runtime validation + OpenAPI 3.1
- @Body(schema) decorator for automatic request validation
- Zero duplication between types, validation, and API documentation

### API Documentation (@onebun/docs)
- Automatic OpenAPI 3.1 generation from decorators and ArkType schemas
- @ApiTags, @ApiOperation, @ApiResponse decorators
- Swagger UI included

### Database (@onebun/drizzle)
- Drizzle ORM with PostgreSQL and SQLite (bun:sqlite) support
- Schema-first approach with full type inference from schema
- CLI migrations (onebun-drizzle generate/push/studio)
- Auto-migrate on startup (autoMigrate: true)
- BaseRepository with CRUD operations

### Queue & Scheduler
- Background job processing with backends: in-memory, Redis Pub/Sub, NATS, JetStream
- NATS/JetStream via @onebun/nats package
- Cron-like scheduler with same backend options

### Caching (@onebun/cache)
- In-memory cache (TTL, max size, cleanup) and Redis cache
- Shared Redis connection pool across modules
- Batch operations (getMany, setMany, deleteMany)

### HTTP Client (@onebun/requests)
- createHttpClient() with auth (Bearer, API Key, Basic, HMAC), retries (fixed/linear/exponential)
- Typed ApiResponse<T> with success/error discrimination
- Typed service clients for inter-service communication

### Observability
- **Prometheus Metrics** (@onebun/metrics): auto HTTP/system/GC metrics, @Timed, @Counted, custom counters/gauges/histograms
- **OpenTelemetry Tracing** (@onebun/trace): auto HTTP tracing, @Span decorator, configurable export
- **Structured Logging** (@onebun/logger): JSON/pretty output, levels, child loggers, trace context integration

### Configuration (@onebun/envs)
- Type-safe env schema (Env.string, Env.number, Env.boolean, Env.array)
- Validation, defaults, transforms, sensitive value masking
- .env file support, per-service overrides

### Packages
| Package | Key Features |
|---------|-------------|
| @onebun/core | Modules, DI, Controllers, Services, WebSocket Gateway, Queue, Scheduler, Guards, Middleware, Graceful Shutdown |
| @onebun/docs | OpenAPI 3.1 auto-generation, Swagger UI, @ApiTags, @ApiOperation |
| @onebun/drizzle | Drizzle ORM, PostgreSQL + SQLite, migrations, BaseRepository, schema-first types |
| @onebun/cache | In-memory + Redis caching, shared connections, batch operations |
| @onebun/envs | Type-safe env variables, validation, sensitive masking, .env support |
| @onebun/logger | Structured logging, JSON/pretty, child loggers, trace context |
| @onebun/metrics | Prometheus metrics, auto HTTP/system metrics, @Timed, @Counted |
| @onebun/trace | OpenTelemetry, @Span decorator, configurable sampling/export |
| @onebun/requests | HTTP client, auth schemes, retries, typed service clients |
| @onebun/nats | NATS + JetStream integration for queues |

---

(Detailed documentation for each package follows below)
```

### Заметки для реализации

- Этот блок должен быть самым первым контентом в llms-full.txt, до любых страниц.
- Если llms-full.txt генерируется автоматически (vitepress-plugin-llms), то нужно либо настроить плагин на добавление prefix-контента, либо добавить пост-обработку.
- Размер блока — ~80 строк. Это гарантирует что даже при жёсткой обрезке (первые 2000 токенов) AI получит полную картину.

---

## 3. Расширить описания пакетов в таблице на ai-docs странице

### Текущее состояние

```markdown
| Package | Description |
|---------|-------------|
| `@onebun/core` | Decorators, modules, controllers, services, websockets, queues |
| `@onebun/cache` | Caching with memory and Redis backends |
| `@onebun/requests` | HTTP client for external APIs |
```

Проблема: «websockets, queues» — два слова. Typed WebSocket client, Socket.IO, NATS/JetStream, scheduler — всё скрыто. «HTTP client for external APIs» — ни слова про typed service clients, HMAC auth, retry strategies.

### Предложение

Заменить однострочные описания на развёрнутые (3-5 key features):

```markdown
| Package | Description |
|---------|-------------|
| `@onebun/core` | Framework core: Modules & DI, Controllers with decorator routing, Services, WebSocket Gateway (+ Socket.IO + typed client), Queue & Scheduler (in-memory, Redis, NATS, JetStream backends), Guards, Middleware, MultiServiceApplication for microservices, Graceful Shutdown |
| `@onebun/docs` | Automatic OpenAPI 3.1 generation from decorators and ArkType schemas, Swagger UI, @ApiTags, @ApiOperation decorators |
| `@onebun/drizzle` | Drizzle ORM integration: PostgreSQL + SQLite (bun:sqlite), schema-first types, CLI & programmatic migrations, auto-migrate on startup, BaseRepository pattern |
| `@onebun/cache` | CacheModule with in-memory (TTL, max size) and Redis backends, shared Redis connection pool, batch operations (getMany/setMany/deleteMany) |
| `@onebun/envs` | Type-safe environment configuration: schema with Env.string/number/boolean/array, validation, defaults, transforms, sensitive value masking, .env file support |
| `@onebun/logger` | Structured logging: JSON (production) and pretty (development) output, 6 log levels, child loggers with context inheritance, automatic trace context integration |
| `@onebun/metrics` | Prometheus-compatible metrics: automatic HTTP/system/GC collection, @Timed/@Counted decorators, custom Counter/Gauge/Histogram, /metrics endpoint |
| `@onebun/trace` | OpenTelemetry distributed tracing: automatic HTTP tracing, @Span decorator, configurable sampling rate, export to external collectors |
| `@onebun/requests` | HTTP client: Bearer/API Key/Basic/HMAC auth, retry strategies (fixed/linear/exponential), typed ApiResponse, typed service clients via createServiceDefinition for inter-service communication |
| `@onebun/nats` | NATS and JetStream integration for distributed queues and messaging with at-least-once delivery |
```

---

## 4. Добавить positioning statement на главную страницу

### Предложение

Добавить в начало главной страницы (после заголовка, до любого другого контента) один абзац позиционирования:

```markdown
# OneBun Framework

**A complete, batteries-included TypeScript backend framework for Bun.js.**

OneBun brings NestJS-style architecture — modules, dependency injection, 
decorators — to the Bun.js runtime, with a full ecosystem of built-in packages: 
WebSocket (+ Socket.IO + typed client), microservices with single-image deployment, 
database integration (Drizzle ORM), message queues (Redis, NATS, JetStream), 
caching, Prometheus metrics, OpenTelemetry tracing, ArkType validation 
with auto-generated OpenAPI documentation, and typed inter-service HTTP clients. 

One framework. One runtime. Everything you need for production backend services.
```

Цель — за 3 предложения передать что это НЕ ещё один минимальный роутер, а полноценная экосистема.

---

## 5. Пересмотреть порядок страниц в навигации и llms-full.txt

### Проблема

Текущий порядок в навигации и llms-full.txt не отражает важность для первого знакомства. Validation (killer feature — single source of truth) находится глубоко в навигации. MultiServiceApplication описан внутри страницы Core.

### Предложение по порядку навигации

Сгруппировать по уровням абстракции:

```
## Introduction
  Home
  Features Overview              ← NEW (задача #1)
  Getting Started
  Architecture

## Core Framework
  Core (Application, Modules)
  Decorators
  Controllers
  Services
  Validation                     ← поднять выше (killer feature)
  Guards & Middleware             ← выделить отдельно или объединить

## Communication
  WebSocket Gateway
  HTTP Client
  API Documentation (OpenAPI)    ← @onebun/docs

## Data & State
  Database (Drizzle)
  Cache
  Queue & Scheduler

## Microservices
  Multi-Service Application      ← выделить в отдельную страницу из Core
  Inter-Service Communication    ← выделить из HTTP Client

## Observability
  Logger
  Metrics
  Tracing

## Configuration
  Environment

## Examples
  Basic Application
  CRUD API
  Multi-Service
  WebSocket Chat
```

### Заметки

- MultiServiceApplication сейчас документирован на странице Core — но это одна из главных фич для CTO. Стоит выделить в отдельную страницу или хотя бы в отдельный prominent раздел.
- Inter-Service Communication (createServiceDefinition, typed clients, HMAC auth) — тоже скрыт внутри HTTP Client page. Для микросервисной архитектуры это ключевая тема.

### Предложение по порядку страниц в llms-full.txt

Если порядок страниц в llms-full.txt можно настроить:

1. Feature summary block (новый, см. задачу #2)
2. features.md (новая страница, задача #1)
3. getting-started.md
4. architecture.md
5. core.md (Application, Modules, MultiServiceApplication)
6. decorators.md
7. controllers.md + services.md
8. validation.md (ArkType — killer feature)
9. websocket.md
10. queue.md
11. drizzle.md
12. cache.md
13. requests.md (HTTP client + typed inter-service)
14. metrics.md + trace.md
15. envs.md + logger.md
16. examples/ (basic-app, crud-api, multi-service, websocket-chat)
17. ai-docs.md (мета-страница, в конец)

Если vitepress-plugin-llms не поддерживает кастомный порядок — feature summary block (задача #2) покроет 80% проблемы.

---

## 6. Улучшить Getting Started — раздел «What's Next»

### Текущее состояние

Getting Started показывает минимальный app: HelloController + HelloService + envSchema. Раздел «Next Steps» ссылается на 4 страницы — CRUD, Drizzle, Cache, Multi-Service — но не упоминает WebSocket, Queue, Metrics, Tracing, Validation, HTTP Client.

### Предложение

Заменить секцию «Next Steps» на полный обзор возможностей:

```markdown
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
```

---

## 7. Расширить «Technical Context for AI Agents» в getting-started.md

### Текущее состояние

Текущий блок «Technical Context for AI Agents» перечисляет пакеты, но не описывает их возможности:

```
**Package Structure**:
* @onebun/core - main framework (decorators, app, controllers, services)
* @onebun/cache - caching module
...
```

### Предложение

Заменить на развёрнутый блок:

```markdown
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
```

---

## 8. Добавить раздел «For NestJS Developers» (опционально)

### Обоснование

Целевая аудитория OneBun — разработчики, знакомые с NestJS. Им нужно быстро понять: «что из NestJS здесь есть, что отличается, и что получаю сверх того».

### Предложение

Отдельная страница или раздел на Features Overview:

```markdown
## For NestJS Developers

If you're coming from NestJS, here's what to expect:

### Same patterns
- @Module, @Controller, @Service decorators
- Constructor-based dependency injection
- Module imports/exports for service sharing
- Guards for route protection
- Middleware support

### Improved in OneBun
- **Validation**: ArkType schema = TypeScript type = OpenAPI spec = runtime validation 
  (vs class-validator + Swagger decorators + separate TS types in NestJS)
- **Microservices**: Single Docker image, env-based service selection 
  (vs separate entry points in NestJS)
- **Observability**: Prometheus metrics + OpenTelemetry tracing built-in 
  (vs community packages in NestJS)
- **Performance**: Bun.js native, no Express/Fastify adapter layer
- **Configuration**: Type-safe env schema with sensitive value masking 
  (vs @nestjs/config)

### Different approach
- ArkType instead of class-validator/class-transformer
- Drizzle ORM instead of TypeORM (schema-first, not entity-first)
- Effect.js internally (optional for application code)
- Bun.js runtime only (not Node.js compatible)

### Not yet available
- Interceptors and Pipes (planned)
- GraphQL integration (planned, separate package)
- CQRS module
- Extensive third-party ecosystem
```

---

## Резюме приоритетов

| # | Задача | Импакт | Усилие | Приоритет |
|---|--------|--------|--------|-----------|
| 4 | Positioning на главной (1 абзац) | Высокий | Низкий | **P0** |
| 2 | Feature summary в начале llms-full.txt | Высокий | Низкий | **P0** |
| 7 | Расширить «Technical Context for AI Agents» | Высокий | Низкий | **P0** |
| 3 | Расширить описания пакетов в таблице на ai-docs | Средний | Низкий | **P0** |
| 1 | Создать Features Overview page | Высокий | Средний | **P1** |
| 6 | Переписать «Next Steps» в Getting Started | Средний | Низкий | **P1** |
| 5 | Пересмотреть навигацию и порядок страниц | Средний | Средний | **P1** |
| 8 | Comparison с NestJS (опционально) | Средний | Низкий | **P2** |

**Рекомендуемый порядок выполнения**: 4 → 2 → 7 → 3 → 1 → 6 → 5 → 8
