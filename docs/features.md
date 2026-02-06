---
description: Complete overview of OneBun Framework capabilities — DI, WebSocket, microservices, validation, database, queue, cache, observability, and production features.
---

<llm-only>

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
- Typed `ApiResponse<T>` with success/error discrimination
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

</llm-only>

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
- **Typed responses**: `ApiResponse<T>` with success/error discrimination

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
