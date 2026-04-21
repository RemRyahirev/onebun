# OneBun Benchmarks

For live benchmark results, visit **[onebun.dev/benchmarks](https://onebun.dev/benchmarks)**.

Raw benchmark data is available in [this GitHub Gist](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265).

## Benchmark Scenarios

### HTTP Throughput (`benchmarks/simple/`)
- Tool: [bombardier](https://github.com/codesenberg/bombardier), 50 concurrent connections, 10s duration
- All frameworks return identical JSON: `{ success: true, result: { message: "Hello, World!" } }`
- Frameworks: Bun.serve (baseline), OneBun, Hono, Elysia, NestJS+Fastify (Bun), NestJS+Fastify (Node 24)

### Realistic CRUD — SQLite (`benchmarks/realistic/`)
- SQLite database (100 users, 500 posts, 2000 comments), Swagger docs
- Endpoints: GET list (paginated), GET detail (with JOIN), POST (write)
- Frameworks: OneBun, NestJS+Drizzle (Bun), NestJS+Drizzle (Node), NestJS+TypeORM (Node)
- Same Drizzle ORM queries in OneBun and NestJS Drizzle variants

### Realistic CRUD — PostgreSQL (`benchmarks/realistic-pg/`)
- PostgreSQL 16 (Docker), same dataset as SQLite, in-memory cache (30s TTL on GET list), Swagger docs, request validation
- Includes OneBun with full observability (`@onebun/metrics` + `@onebun/trace`) to measure overhead
- Frameworks: OneBun, OneBun (full obs), NestJS+Drizzle (Bun), NestJS+Drizzle (Node), NestJS+TypeORM (Node)

### Startup Time (`benchmarks/startup.sh`)
- Measures time from process start to first successful HTTP response
- Custom bash timing with 5ms Bun fetch polling, 10 runs per framework
- Reports mean/min/max in milliseconds

## Environment
- CI: GitHub Actions `ubuntu-latest`, weekly + on push to master
- Bun: latest, Node.js: 24
- NestJS (Node) runs pre-compiled JavaScript. All Bun entries run TypeScript directly.

## Reproducibility

```bash
# Install dependencies
bun install
cd benchmarks/simple/competitors/hono-bun && bun install
cd ../elysia && bun install
cd ../nestjs-fastify && bun install && bun run build
cd ../../../../realistic/nestjs-fastify && bun install && bun run build
cd ../nestjs-typeorm && bun install && bun run build
cd ../../realistic-pg/nestjs-fastify && bun install && bun run build
cd ../nestjs-typeorm && bun install && bun run build

# Run all benchmarks (requires bombardier; Docker for PostgreSQL)
./benchmarks/run-all.sh

# Or individual suites
./benchmarks/simple/run.sh
./benchmarks/realistic/run.sh
./benchmarks/realistic-pg/run.sh   # requires Docker
./benchmarks/startup.sh

# Parse results into JSON
bun run benchmarks/parse-results.ts
```

> **Note:** CI runs on shared GitHub Actions runners; results vary ±15–20% between runs. Relative ranking is consistent. Raw data from all runs available via [Gist revisions](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265).
