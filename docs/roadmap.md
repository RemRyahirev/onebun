# Roadmap

OneBun is actively developed. This page outlines our priorities and planned features.

## Current Status

OneBun is at **v0.2.x** — a pre-1.0 release focused on API stabilization and filling production gaps. The core framework, DI system, and all listed packages are functional and tested.

## Phase 1: Production-Ready

Critical features required for production deployments.

### HTTP Guards & Authentication

Guards already exist for [WebSocket](/api/websocket) and [Queue](/api/queue), but HTTP — the primary transport — lacks them.

| Feature | Status |
|---------|--------|
| `CanActivate` interface for HTTP | Planned |
| `@UseGuards()` decorator for controllers/routes | Planned |
| Built-in `AuthGuard` (token verification) | Planned |
| Built-in `RolesGuard` (RBAC) | Planned |
| `createGuard(fn)` factory | Planned |

### Exception Filters

Customizable error handling without modifying framework internals.

| Feature | Status |
|---------|--------|
| `ExceptionFilter` interface | Planned |
| `@UseFilters()` decorator | Planned |
| Global exception filter via `ApplicationOptions` | Planned |
| Default filter (current `OneBunBaseError` handling) | Planned |

### Testing Utilities

First-class testing support for DI-based applications.

| Feature | Status |
|---------|--------|
| `TestingModule.create()` with mock providers | Planned |
| `.overrideProvider().useValue()` / `.useClass()` | Planned |
| HTTP testing without starting a server | Planned |
| Mock logger, config (existing) | Done |
| Fake timers (existing) | Done |

### Security Middleware

Built-in security primitives.

| Feature | Status |
|---------|--------|
| CORS middleware | Planned |
| Rate limiting (in-memory + Redis) | Planned |
| Security headers (helmet-like) | Planned |

---

## Phase 2: Developer Experience

Features that significantly improve adoption and day-to-day development.

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

Project and component generation.

| Feature | Status |
|---------|--------|
| `bunx create-onebun my-app` | Planned |
| `bunx onebun generate module/controller/service` | Planned |

### Documentation

| Document | Status |
|----------|--------|
| Migration guide (NestJS to OneBun) | Planned |
| Deployment guide (Docker, k8s, CI/CD) | Planned |
| Testing guide | Planned |
| Expanded Troubleshooting / FAQ | Planned |

---

## Phase 3: Ecosystem

Post-1.0 features for broader adoption.

| Feature | Status |
|---------|--------|
| Performance benchmarks | Planned |
| GraphQL + Drizzle integration | Planned |
| Plugin system | Planned |
| Build-time config validation | Planned |

---

## Already Implemented

These features are fully functional but may not be immediately obvious. Check the linked documentation for details.

| Feature | Package | Docs |
|---------|---------|------|
| Graceful shutdown | `@onebun/core` | [Core](/api/core) |
| Swagger UI + OpenAPI 3.1 | `@onebun/docs` | [API Docs](/api/docs) |
| WebSocket guards (6 built-in) | `@onebun/core` | [WebSocket](/api/websocket) |
| Queue/message guards (4 built-in) | `@onebun/core` | [Queue](/api/queue) |
| ArkType validation (replaces pipes) | `@onebun/core` | [Validation](/api/validation) |
| Server-Sent Events (SSE) | `@onebun/core` | [Controllers](/api/controllers) |
| Static file serving with SPA fallback | `@onebun/core` | [Core](/api/core) |
| Multi-service applications | `@onebun/core` | [Multi-Service example](/examples/multi-service) |
| Prometheus metrics + system metrics | `@onebun/metrics` | [Metrics](/api/metrics) |
| OpenTelemetry tracing | `@onebun/trace` | [Tracing](/api/trace) |
| Typed HTTP client with auth schemes | `@onebun/requests` | [HTTP Client](/api/requests) |
| NATS + JetStream | `@onebun/nats` | [Queue](/api/queue) |
