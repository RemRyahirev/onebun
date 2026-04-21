# OneBun Benchmark Suite

Reproducible benchmarks for comparing OneBun framework performance against competitors.

## Prerequisites

### bombardier (HTTP load testing)

```bash
# macOS
brew install bombardier

# Linux (download binary)
curl -L https://github.com/codesenberg/bombardier/releases/download/v1.2.6/bombardier-linux-amd64 -o bombardier
chmod +x bombardier && sudo mv bombardier /usr/local/bin/
```

### Docker (for PostgreSQL benchmarks)

Required only for `realistic-pg` benchmarks. Install from [docker.com](https://docs.docker.com/get-docker/).

### Bun

Bun v1.2.12+ is required. Install from [bun.sh](https://bun.sh).

### Node.js 24

Required for NestJS (Node) benchmarks. Use [fnm](https://github.com/Schniz/fnm) locally or `actions/setup-node` in CI.

### Competitor dependencies

```bash
# Simple HTTP competitors
cd benchmarks/simple/competitors/hono-bun && bun install
cd ../elysia && bun install
cd ../nestjs-fastify && bun install && bun run build

# Realistic SQLite competitors
cd benchmarks/realistic/nestjs-fastify && bun install && bun run build
cd ../nestjs-typeorm && bun install && bun run build

# Realistic PostgreSQL competitors
cd benchmarks/realistic-pg/nestjs-fastify && bun install && bun run build
cd ../nestjs-typeorm && bun install && bun run build
```

## Running Benchmarks

### All benchmarks

```bash
./benchmarks/run-all.sh
```

Runs simple + realistic (SQLite) + realistic-pg (if Docker available) + startup.

### Simple HTTP throughput

```bash
./benchmarks/simple/run.sh
```

Single endpoint returning static JSON. 50 concurrent connections, 10 seconds.

### Realistic CRUD (SQLite)

```bash
./benchmarks/realistic/run.sh
```

Tests OneBun vs NestJS with SQLite and Swagger docs.

### Realistic CRUD (PostgreSQL)

```bash
./benchmarks/realistic-pg/run.sh
```

Tests OneBun vs NestJS with PostgreSQL, in-memory cache, request validation, and Swagger docs. Includes OneBun with full observability (metrics + tracing). Requires Docker.

### Startup time

```bash
./benchmarks/startup.sh
```

Measures cold start time using custom bash timing with 5ms Bun fetch polling, 10 runs per framework.

## Parsing & Publishing Results

```bash
# Parse bombardier output + startup.json into structured JSON
bun run benchmarks/parse-results.ts

# Upload to GitHub Gist (requires GIST_TOKEN and BENCHMARK_GIST_ID env vars)
bun run benchmarks/upload-gist.ts
```

Results are written to `benchmarks/results/benchmark-results.json`.

## Methodology

- **HTTP throughput**: bombardier with `-c 50 -d 10s -p r -l` (50 connections, 10 seconds, latency distribution)
- **Startup time**: custom bash timing (`date +%s%N`) with Bun HTTP polling at 5ms intervals
- All benchmarks run sequentially to avoid resource contention
- Servers are warmed up with 1-2 requests before benchmarking begins

> **Note:** CI runs on shared GitHub Actions runners; results vary ±15–20% between runs due to noisy-neighbor effects. Relative ranking between frameworks is consistent. Raw data from all CI runs is available via [Gist revisions](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265).

## Frameworks Compared

| Framework | Scenario | Description |
|-----------|----------|-------------|
| **OneBun** | all | Full-featured framework (DI, decorators, middleware, Effect.ts) |
| **OneBun (full obs)** | realistic-pg | OneBun + `@onebun/metrics` + `@onebun/trace` |
| **Bun.serve** | simple | Raw Bun HTTP server (baseline, no framework overhead) |
| **Hono** | simple | Lightweight web framework for Bun/Deno/Node |
| **Elysia** | simple | Bun-native web framework focused on performance |
| **NestJS + Fastify (Bun)** | simple, realistic, realistic-pg | NestJS on Bun runtime with Fastify adapter |
| **NestJS + Fastify (Node)** | simple, realistic, realistic-pg | NestJS on Node.js 24 with Fastify adapter |
| **NestJS + TypeORM (Node)** | realistic, realistic-pg | Canonical NestJS stack with TypeORM |
