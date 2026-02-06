# OneBun

[![CI](https://github.com/RemRyahirev/onebun/actions/workflows/publish.yml/badge.svg)](https://github.com/RemRyahirev/onebun/actions/workflows/publish.yml)
[![codecov](https://codecov.io/gh/RemRyahirev/onebun/branch/master/graph/badge.svg)](https://codecov.io/gh/RemRyahirev/onebun)
[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2+-black?logo=bun&logoColor=white)](https://bun.sh/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Documentation](https://img.shields.io/badge/docs-online-blue?logo=gitbook&logoColor=white)](https://onebun.dev/)

A Bun.js framework inspired by NestJS with Effect.ts integration. OneBun follows the principle of "exactly one default way to solve each problem" - trading flexibility for development speed and performance.

## Features

- **Modular Architecture** - Organize code in modules with controllers and services
- **Declarative Routes** - Use decorators (@Controller, @Get, @Post, etc.)
- **Type-safe DI** - Effect.Context and Layer for dependency management
- **Built-in Logging** - Extended logging based on Effect.Logger
- **Unified HTTP Requests** - @onebun/requests with retries, auth, and tracing
- **Metrics & Tracing** - Prometheus metrics and OpenTelemetry-compatible tracing
- **Environment Management** - Typed configuration with validation
- **High Performance** - Built on Bun.js for maximum speed

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

## Installation

```bash
# Install Bun if not installed
curl -fsSL https://bun.sh/install | bash

# Add core package
bun add @onebun/core
```

## Quick Start

```typescript
import { Effect, Layer } from 'effect';
import { OneBunApplication, Controller, Get, Module } from '@onebun/core';

@Controller('api')
class AppController {
  @Get('hello')
  async hello(): Promise<Response> {
    return new Response(JSON.stringify({ message: 'Hello, OneBun!' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

@Module({
  controllers: [AppController],
})
class AppModule {}

const app = new OneBunApplication(AppModule);
await Effect.runPromise(app.start());
```

## Documentation

📚 **[Full Documentation](https://onebun.dev/)**

- [Getting Started](https://onebun.dev/getting-started)
- [Architecture](https://onebun.dev/architecture)
- [API Reference](https://onebun.dev/api/core)
- [Examples](https://onebun.dev/examples/basic-app)

## Development

```bash
# Clone repository
git clone https://github.com/RemRyahirev/onebun.git
cd onebun

# Install dependencies
bun install

# Run tests
bun test

# Run example
bun run dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[LGPL-3.0](LICENSE) - You can use OneBun freely in commercial projects, but modifications to the framework itself must remain open source.
