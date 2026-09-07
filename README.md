<!--
  Do not edit README.md — it is generated from this template plus regions marked in docs/.
  Run `bun run readme:generate` after changing either; `bun run readme:check` guards it in CI.

  Placeholders are double-braced names, substituted by scripts/generate-readme.ts:
    install, quickstart-example, features  — regions in docs/
    packages, license, packageCount        — derived from package.json
-->
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

NestJS deserves a Bun-native alternative. OneBun gives you the module system and DI you know, without the Express/Fastify legacy — plus observability and validation that work out of the box.

See [Framework Comparison](https://onebun.dev/features#framework-comparison) for how it lines up against NestJS, Hono and Elysia, feature by feature.

## Installation

```bash
bun create @onebun my-app
cd my-app
bun run dev
```

Or add OneBun to an existing project:

```bash
bun add @onebun/core
```

## Quickstart

```typescript
import {
  BaseController, Controller, Get, Module, OneBunApplication, Service, BaseService, Post, Body, type,
} from '@onebun/core';

const CreateUser = type({ name: 'string', email: 'string.email' });
type CreateUserBody = typeof CreateUser.infer;

@Service()
class UserService extends BaseService {
  getAll() {
    return [{ id: 1, name: 'Alice' }];
  }
}

@Controller('/users')
class UserController extends BaseController {
  constructor(private users: UserService) {
    super();
  }

  @Get('/')
  async list() {
    return this.users.getAll();
  }

  @Post('/')
  async create(@Body(CreateUser) body: CreateUserBody) {
    return this.success(body, 201); // this.success() only when a custom status is needed
  }
}

@Module({ controllers: [UserController], providers: [UserService] })
class AppModule {}

const app = new OneBunApplication(AppModule, {
  port: 3000,
  metrics: { enabled: true }, // Prometheus at /metrics
  tracing: { enabled: true }, // OpenTelemetry spans
});

await app.start();
```

One schema (`CreateUser`) gives you the TypeScript type, runtime validation and the OpenAPI spec — no
extra packages, no duplication.

## Key Features

- **NestJS-style architecture** — modules, controllers and services with full dependency injection via Effect.ts
- **ArkType validation** — one schema is the TypeScript type, the runtime check and the OpenAPI spec, wired end to end
- **Built-in Prometheus metrics and OpenTelemetry tracing** — no community packages needed
- **Redis / in-memory caching** with decorator-driven TTL
- **Typed environment variables** with validation and defaults
- **WebSocket support** — Socket.IO protocol, rooms, guards, typed clients
- **Queue system** — `@Cron`, `@Interval`, `@Timeout` and `@Subscribe` decorators
- **Drizzle ORM integration** — database access with migrations
- **NATS / JetStream** — message bus for microservices
- **OpenAPI / Swagger** — generated from ArkType schemas and route decorators

**[Benchmarks](https://onebun.dev/benchmarks)** | [Raw data](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265)

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [@onebun/core](packages/core) | [![npm](https://img.shields.io/npm/v/@onebun/core?color=blue)](https://www.npmjs.com/package/@onebun/core) | Core package — decorators, DI, modules, controllers |
| [@onebun/cache](packages/cache) | [![npm](https://img.shields.io/npm/v/@onebun/cache?color=blue)](https://www.npmjs.com/package/@onebun/cache) | Caching module — in-memory and Redis support |
| [@onebun/create](packages/create-onebun) | [![npm](https://img.shields.io/npm/v/@onebun/create?color=blue)](https://www.npmjs.com/package/@onebun/create) | Scaffold a new OneBun project |
| [@onebun/docs](packages/docs) | [![npm](https://img.shields.io/npm/v/@onebun/docs?color=blue)](https://www.npmjs.com/package/@onebun/docs) | Documentation generation — OpenAPI, Swagger UI |
| [@onebun/drizzle](packages/drizzle) | [![npm](https://img.shields.io/npm/v/@onebun/drizzle?color=blue)](https://www.npmjs.com/package/@onebun/drizzle) | Drizzle ORM module — SQLite and PostgreSQL support |
| [@onebun/envs](packages/envs) | [![npm](https://img.shields.io/npm/v/@onebun/envs?color=blue)](https://www.npmjs.com/package/@onebun/envs) | Environment variables management — typed config with validation |
| [@onebun/logger](packages/logger) | [![npm](https://img.shields.io/npm/v/@onebun/logger?color=blue)](https://www.npmjs.com/package/@onebun/logger) | Structured logging — JSON and pretty output with trace support |
| [@onebun/metrics](packages/metrics) | [![npm](https://img.shields.io/npm/v/@onebun/metrics?color=blue)](https://www.npmjs.com/package/@onebun/metrics) | Prometheus-compatible metrics — HTTP, system, and custom metrics |
| [@onebun/nats](packages/nats) | [![npm](https://img.shields.io/npm/v/@onebun/nats?color=blue)](https://www.npmjs.com/package/@onebun/nats) | NATS and JetStream integration |
| [@onebun/requests](packages/requests) | [![npm](https://img.shields.io/npm/v/@onebun/requests?color=blue)](https://www.npmjs.com/package/@onebun/requests) | Unified HTTP client — retries, auth, tracing, and metrics |
| [@onebun/trace](packages/trace) | [![npm](https://img.shields.io/npm/v/@onebun/trace?color=blue)](https://www.npmjs.com/package/@onebun/trace) | OpenTelemetry-compatible tracing — distributed tracing support |

## Documentation

Full documentation is available at **[onebun.dev](https://onebun.dev/)**.

Working with an AI assistant? OneBun ships an agent skill and LLM-optimized docs — see [AI Documentation](https://onebun.dev/ai-docs).

## Contributing

PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MPL-2.0](LICENSE) — use OneBun freely in commercial projects. Modifications to the framework's source files must remain open source; your application code stays yours.
