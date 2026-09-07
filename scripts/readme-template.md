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

{{install}}

## Quickstart

{{quickstart-example}}

## Key Features

{{features}}

**[Benchmarks](https://onebun.dev/benchmarks)** | [Raw data](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265)

## Packages

{{packages}}

## Documentation

Full documentation is available at **[onebun.dev](https://onebun.dev/)**.

Working with an AI assistant? OneBun ships an agent skill and LLM-optimized docs — see [AI Documentation](https://onebun.dev/ai-docs).

## Contributing

PRs are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[{{license}}](LICENSE) — use OneBun freely in commercial projects. Modifications to the framework's source files must remain open source; your application code stays yours.
