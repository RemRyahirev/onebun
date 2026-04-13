# OneBun Benchmark Suite

Reproducible benchmarks for comparing OneBun framework performance against competitors.

## Prerequisites

### bombardier (HTTP load testing)

```bash
# macOS
brew install bombardier

# Linux (download binary)
wget https://github.com/codesenberg/bombardier/releases/latest/download/bombardier-linux-amd64 -O bombardier
chmod +x bombardier && sudo mv bombardier /usr/local/bin/
```

### hyperfine (startup time measurement)

```bash
# macOS
brew install hyperfine

# Linux
sudo apt install hyperfine
# or
wget https://github.com/sharkdp/hyperfine/releases/latest/download/hyperfine_1.18.0_amd64.deb
sudo dpkg -i hyperfine_1.18.0_amd64.deb
```

### Bun

Bun v1.2.12+ is required. Install from [bun.sh](https://bun.sh).

### Competitor dependencies

```bash
cd benchmarks/competitors/hono-bun && bun install
cd benchmarks/competitors/elysia && bun install
cd benchmarks/competitors/nestjs-fastify && bun install
```

## Running Benchmarks

### HTTP throughput (bombardier)

```bash
./benchmarks/run-http.sh
```

Runs each server with 50 concurrent connections for 10 seconds and produces a comparison table.

### Cold startup time (hyperfine)

```bash
./benchmarks/startup.sh
```

Measures cold start time using hyperfine with 10 runs per framework.

## Methodology

- **HTTP throughput**: bombardier with `-c 50 -d 10s -p r` (50 connections, 10 seconds, results printed)
- **Startup time**: hyperfine with `--warmup 3 --runs 10` and `--cleanup` to kill the process
- Each server returns the same `{ "message": "Hello, World!" }` JSON payload on `GET /`
- Servers are given 2 seconds to start before benchmarking begins
- All benchmarks run sequentially to avoid resource contention

## Recording Results

When publishing benchmark results, always record:

- **Machine**: CPU model, core count, RAM
- **OS**: name and version
- **Bun version**: `bun --version`
- **Date**: when the benchmarks were run
- **Commit**: git SHA of the OneBun repo

## Frameworks Compared

| Framework | Description |
|-----------|-------------|
| **OneBun** | Full-featured framework (DI, decorators, middleware, Effect.ts) |
| **Bun.serve** | Raw Bun HTTP server (baseline, no framework overhead) |
| **Hono** | Lightweight web framework for Bun/Deno/Node |
| **Elysia** | Bun-native web framework focused on performance |
| **NestJS + Fastify** | Enterprise Node.js framework (closest feature comparison) |
