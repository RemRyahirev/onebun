# OneBun

[![License: LGPL-3.0](https://img.shields.io/badge/License-LGPL--3.0-blue.svg)](LICENSE)
[![CI](https://github.com/RemRyahirev/onebun/actions/workflows/ci.yml/badge.svg)](https://github.com/RemRyahirev/onebun/actions)

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

| Package | Description |
|---------|-------------|
| [@onebun/core](packages/core) | Core framework (decorators, DI, modules) |
| [@onebun/cache](packages/cache) | Caching with in-memory and Redis support |
| [@onebun/docs](packages/docs) | OpenAPI documentation generation |
| [@onebun/drizzle](packages/drizzle) | Drizzle ORM integration |
| [@onebun/envs](packages/envs) | Environment variables management |
| [@onebun/logger](packages/logger) | Structured logging |
| [@onebun/metrics](packages/metrics) | Prometheus-compatible metrics |
| [@onebun/requests](packages/requests) | Unified HTTP client |
| [@onebun/trace](packages/trace) | OpenTelemetry tracing |

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

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [API Reference](docs/api/)
- [Examples](docs/examples/)

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
