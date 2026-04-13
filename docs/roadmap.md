# Roadmap

OneBun is actively developed. This page outlines what is already shipped, what is coming next, and our longer-term vision.

## Current Status (v0.2.x)

OneBun is at **v0.2.x** — a pre-1.0 release focused on API stabilization and filling production gaps. The core framework, DI system, and all listed packages are functional and tested. Most features needed for production HTTP services are already implemented.

---

## Already Implemented

All features below are shipped, tested, and documented. If something looks missing, check the linked docs first.

### Core Framework

| Feature | Package | Docs |
|---------|---------|------|
| Module system (`@Module`, `@Global`) | `@onebun/core` | [Core](/api/core) |
| Controllers & routing (`@Get`, `@Post`, etc.) | `@onebun/core` | [Controllers](/api/controllers) |
| Services & DI via Effect.Context + Layer | `@onebun/core` | [Services](/api/services) |
| Middleware (`@UseMiddleware`, `@Middleware`) | `@onebun/core` | [Middleware](/api/middleware) |
| Lifecycle hooks (`OnModuleInit`, `OnApplicationDestroy`, etc.) | `@onebun/core` | [Core](/api/core) |
| Graceful shutdown (SIGTERM/SIGINT handling) | `@onebun/core` | [Core](/api/core) |
| Static file serving with SPA fallback | `@onebun/core` | [Core](/api/core) |
| Multi-service applications | `@onebun/core` | [Multi-Service example](/examples/multi-service) |

### HTTP Guards & Authentication

| Feature | Package | Docs |
|---------|---------|------|
| `CanActivate` interface for HTTP | `@onebun/core` | [Guards](/api/guards) |
| `@UseGuards()` decorator for controllers/routes | `@onebun/core` | [Guards](/api/guards) |
| Built-in `AuthGuard` (token verification) | `@onebun/core` | [Guards](/api/guards) |
| Built-in `RolesGuard` (RBAC) | `@onebun/core` | [Guards](/api/guards) |
| `createGuard(fn)` factory | `@onebun/core` | [Guards](/api/guards) |

### Exception Filters

| Feature | Package | Docs |
|---------|---------|------|
| `ExceptionFilter` interface | `@onebun/core` | [Exception Filters](/api/exception-filters) |
| `@UseFilters()` decorator | `@onebun/core` | [Exception Filters](/api/exception-filters) |
| Global exception filter via `ApplicationOptions.filters` | `@onebun/core` | [Exception Filters](/api/exception-filters) |
| `HttpException` with proper status codes | `@onebun/core` | [Exception Filters](/api/exception-filters) |

### Validation

| Feature | Package | Docs |
|---------|---------|------|
| ArkType validation (single-source-of-truth for types, runtime validation, OpenAPI schema) | `@onebun/core` | [Validation](/api/validation) |

### Security Middleware

| Feature | Package | Docs |
|---------|---------|------|
| CORS middleware | `@onebun/core` | [Middleware](/api/middleware) |
| Rate limiting (in-memory + Redis) | `@onebun/core` | [Middleware](/api/middleware) |
| Security headers (helmet-like) | `@onebun/core` | [Middleware](/api/middleware) |

### WebSocket & Queues

| Feature | Package | Docs |
|---------|---------|------|
| WebSocket gateway (`@WebSocketGateway`, `@SubscribeMessage`) | `@onebun/core` | [WebSocket](/api/websocket) |
| WebSocket guards (6 built-in) | `@onebun/core` | [WebSocket](/api/websocket) |
| Queue system (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`) | `@onebun/core` | [Queue](/api/queue) |
| Queue guards (4 built-in) | `@onebun/core` | [Queue](/api/queue) |
| Server-Sent Events (SSE) | `@onebun/core` | [Controllers](/api/controllers) |
| NATS + JetStream | `@onebun/nats` | [Queue](/api/queue) |

### Testing Utilities

| Feature | Package | Docs |
|---------|---------|------|
| `TestingModule.create()` with mock providers | `@onebun/core` | [Testing](/api/testing) |
| `.overrideProvider().useValue()` / `.useClass()` | `@onebun/core` | [Testing](/api/testing) |
| HTTP integration testing | `@onebun/core` | [Testing](/api/testing) |
| Mock logger, config | `@onebun/core` | [Testing](/api/testing) |
| Fake timers | `@onebun/core` | [Testing](/api/testing) |

### Ecosystem Packages

| Feature | Package | Docs |
|---------|---------|------|
| Swagger UI + OpenAPI 3.1 generation | `@onebun/docs` | [API Docs](/api/docs) |
| Structured logging via Effect.ts | `@onebun/logger` | [Logger](/api/logger) |
| Typed environment variables with validation | `@onebun/envs` | [Envs](/api/envs) |
| Redis / in-memory caching | `@onebun/cache` | [Cache](/api/cache) |
| Prometheus metrics + system metrics | `@onebun/metrics` | [Metrics](/api/metrics) |
| OpenTelemetry tracing | `@onebun/trace` | [Tracing](/api/trace) |
| Typed HTTP client with auth schemes | `@onebun/requests` | [HTTP Client](/api/requests) |
| Drizzle ORM integration | `@onebun/drizzle` | [Drizzle](/api/drizzle) |

---

## Phase 1: Next Up

High-impact features that round out the request pipeline and developer experience.

### HTTP Interceptors

Transform requests/responses in the pipeline (logging, mapping, caching).

| Feature | Status |
|---------|--------|
| `Interceptor` interface | Planned |
| `@UseInterceptors()` decorator | Planned |
| Built-in: Logging, Cache, Timeout interceptors | Planned |

### Health Checks

Kubernetes-ready health endpoints.

| Feature | Status |
|---------|--------|
| `HealthModule` with `/health` and `/ready` | Planned |
| Database, Redis, NATS indicators | Planned |
| Status aggregation, liveness/readiness probes | Planned |

### CLI & Scaffolding

| Feature | Status |
|---------|--------|
| `bunx create-onebun my-app` | Done |
| `bunx onebun generate module/controller/service` | Planned |

### Documentation

| Document | Status |
|----------|--------|
| Migration guide (NestJS to OneBun) | Done — [Migration from NestJS](/migration-nestjs) |
| Deployment guide (Docker, k8s, CI/CD) | Planned |
| Testing guide | Planned |
| Expanded Troubleshooting / FAQ | Planned |

---

## Phase 2: Ecosystem

Post-1.0 features for broader adoption.

| Feature | Status |
|---------|--------|
| GraphQL integration | Planned |
| Plugin system | Planned |
| Performance benchmarks page | Done — [Benchmarks](/benchmarks) |
| Build-time config validation | Planned |
