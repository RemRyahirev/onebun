# OneBun

**NestJS-style DI & modules for Bun.js — with ArkType validation, Prometheus metrics, and OpenTelemetry tracing built in.**

[![CI](https://github.com/RemRyahirev/onebun/actions/workflows/publish.yml/badge.svg)](https://github.com/RemRyahirev/onebun/actions/workflows/publish.yml)
[![codecov](https://codecov.io/gh/RemRyahirev/onebun/branch/master/graph/badge.svg)](https://codecov.io/gh/RemRyahirev/onebun)
<!-- Replace bde6a4c4930c19a963199fa0bea2b265 with your actual Gist ID to enable the test count badge -->
[![Tests](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265/raw/onebun-test-badge.json)](https://github.com/RemRyahirev/onebun/actions/workflows/publish.yml)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2+-black?logo=bun&logoColor=white)](https://bun.sh/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Documentation](https://img.shields.io/badge/docs-online-blue?logo=gitbook&logoColor=white)](https://onebun.dev/)

## Why OneBun?

NestJS deserves a Bun-native alternative. OneBun gives you the module system and DI you know, without the Express/Fastify legacy — plus observability and validation that just work out of the box.

| Feature | OneBun | NestJS + Fastify | Hono | Elysia |
|---------|--------|-----------------|------|--------|
| **Runtime** | Bun-native | Node.js | Multi-runtime | Bun-native |
| **DI & Modules** | Built-in (Effect.ts) | Built-in | -- | -- |
| **Validation** | ArkType (type = runtime = OpenAPI) | class-validator | Zod (optional) | t.Object |
| **Observability** | Built-in (Prometheus + OTEL) | Community packages | -- | -- |
| **Type Safety** | Full (strict, no `any`) | Partial (decorators) | Full | Full |

## 30-Second Quickstart

```bash
bun create @onebun my-app
cd my-app
bun run dev
```

Or add OneBun to an existing project:

```bash
bun add @onebun/core
```

```typescript
import {
  BaseController, Controller, Get, Module, OneBunApplication, Service, BaseService, Post, Body, type,
} from '@onebun/core';

const CreateUser = type({ name: 'string', email: 'string.email' });

@Service()
class UserService extends BaseService {
  getAll() { return [{ id: 1, name: 'Alice' }]; }
}

@Controller('/users')
class UserController extends BaseController {
  constructor(private users: UserService) { super(); }

  @Get('/')
  async list() { return this.users.getAll(); }

  @Post('/')
  async create(@Body(CreateUser) body: typeof CreateUser.infer) {
    return this.success(body, 201);  // this.success() only when custom status needed
  }
}

@Module({ controllers: [UserController], providers: [UserService] })
class AppModule {}

const app = new OneBunApplication(AppModule, {
  port: 3000,
  metrics: { enabled: true },   // Prometheus at /metrics
  tracing: { enabled: true },   // OpenTelemetry spans
});
await app.start();
```

One schema (`CreateUser`) gives you the TypeScript type, runtime validation, and OpenAPI spec — no duplication.

## Key Features

- **NestJS-style architecture** — modules, controllers, services with full dependency injection via Effect.ts
- **ArkType validation** — one schema = TypeScript type + runtime check + OpenAPI spec
- **Built-in Prometheus metrics & OpenTelemetry tracing** — no community packages needed
- **Redis / in-memory caching** with decorator-driven TTL
- **Typed environment variables** with validation and defaults
- **WebSocket support** — Socket.IO protocol, rooms, guards, typed clients
- **Queue system** — `@Cron`, `@Interval`, `@Timeout`, `@Subscribe` decorators
- **Drizzle ORM integration** — database access with migrations
- **NATS / JetStream** — message bus for microservices
- **OpenAPI / Swagger** — auto-generated from ArkType schemas and route decorators
- **2500+ tests** with high coverage ([Codecov](https://codecov.io/gh/RemRyahirev/onebun))

**[Benchmarks](https://onebun.dev/benchmarks)** | [Raw data](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265)

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [@onebun/core](packages/core) | [![npm](https://img.shields.io/npm/v/@onebun/core?color=blue)](https://www.npmjs.com/package/@onebun/core) | Core framework (decorators, DI, modules) |
| [@onebun/cache](packages/cache) | [![npm](https://img.shields.io/npm/v/@onebun/cache?color=blue)](https://www.npmjs.com/package/@onebun/cache) | Caching with in-memory and Redis support |
| [@onebun/docs](packages/docs) | [![npm](https://img.shields.io/npm/v/@onebun/docs?color=blue)](https://www.npmjs.com/package/@onebun/docs) | OpenAPI documentation generation |
| [@onebun/drizzle](packages/drizzle) | [![npm](https://img.shields.io/npm/v/@onebun/drizzle?color=blue)](https://www.npmjs.com/package/@onebun/drizzle) | Drizzle ORM integration |
| [@onebun/nats](packages/nats) | [![npm](https://img.shields.io/npm/v/@onebun/nats?color=blue)](https://www.npmjs.com/package/@onebun/nats) | NATS integration |
| [@onebun/envs](packages/envs) | [![npm](https://img.shields.io/npm/v/@onebun/envs?color=blue)](https://www.npmjs.com/package/@onebun/envs) | Environment variables management |
| [@onebun/logger](packages/logger) | [![npm](https://img.shields.io/npm/v/@onebun/logger?color=blue)](https://www.npmjs.com/package/@onebun/logger) | Structured logging |
| [@onebun/metrics](packages/metrics) | [![npm](https://img.shields.io/npm/v/@onebun/metrics?color=blue)](https://www.npmjs.com/package/@onebun/metrics) | Prometheus-compatible metrics |
| [@onebun/requests](packages/requests) | [![npm](https://img.shields.io/npm/v/@onebun/requests?color=blue)](https://www.npmjs.com/package/@onebun/requests) | Unified HTTP client |
| [@onebun/trace](packages/trace) | [![npm](https://img.shields.io/npm/v/@onebun/trace?color=blue)](https://www.npmjs.com/package/@onebun/trace) | OpenTelemetry tracing |

## Documentation

Full documentation is available at **[onebun.dev](https://onebun.dev/)**.

## Contributing

PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MPL-2.0](LICENSE) — use OneBun freely in commercial projects. Modifications to the framework's source files must remain open source; your application code stays yours.
