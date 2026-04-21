# Changelog

## 2026-04-21

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.3.6 | 0.3.7 |
| `@onebun/drizzle` | 0.3.2 | 0.3.3 |
| `@onebun/metrics` | 0.3.3 | 0.3.4 |
| `@onebun/trace` | 0.3.2 | 0.3.3 |

### Performance

- **Synchronous trace hot path** — replaced Effect-based async calls with sync methods (`extractFromHeadersSync`, `startHttpTraceSync`, `endHttpTraceSync`) on the HTTP request critical path, eliminating `Effect.runPromise()` overhead per request
- **Smart OTel span creation** — OTel spans are only created when an exporter endpoint is configured; lightweight context propagation otherwise
- **Cron parser rewrite** — replaced second-by-second iteration (O(31M) worst case) with field-level skipping through months/days/hours/minutes (O(~1.5K) worst case), ~100–1000x faster
- **SQLite statement caching** (`@onebun/drizzle`) — wraps `client.prepare()` with a Map cache; patches drizzle's `.get()` to use native `stmt.get()` instead of materializing all rows
- **Metrics status code caching** — lazy-cached `toString()` for HTTP status codes, removed per-request `.toUpperCase()` on method strings
- **Pre-compiled traceparent regex** and optimized trace ID generation via `crypto.getRandomValues()` + `Buffer.toString('hex')`

### @onebun/drizzle

- **SQLite pragmas support** — new `pragmas` option in `SQLiteConnectionOptions` (defaults to `journal_mode = WAL`, `synchronous = NORMAL`), executed on connection
- **Statement caching & `.get()` patch** applied automatically on SQLite database init

### @onebun/metrics

- **Exported `register` from prom-client** — downstream packages can now access the Prometheus registry via `@onebun/metrics` without a direct `prom-client` dependency

### Benchmarks

Complete restructuring from a flat directory into three distinct scenarios:

- **`benchmarks/simple/`** — basic HTTP throughput (hello world), successor to the old `run-http.sh`. Competitors: Bun.serve, Hono, Elysia, NestJS+Fastify
- **`benchmarks/realistic/`** (new) — SQLite CRUD with Drizzle ORM, Swagger docs, paginated lists, JOINs, writes. Competitors: NestJS+Fastify (Bun & Node 24), NestJS+TypeORM (Node 24)
- **`benchmarks/realistic-pg/`** (new) — PostgreSQL CRUD with in-memory cache, request validation, and an additional OneBun variant with full observability (`@onebun/metrics` + `@onebun/trace`) to measure overhead. Requires Docker (PostgreSQL 16)
- **`benchmarks/run-all.sh`** — unified runner for all three suites; gracefully skips PostgreSQL benchmarks if Docker is unavailable
- **Startup timing** — replaced `hyperfine` with custom bash timing (`date +%s%N` + HTTP polling)
- **`parse-results.ts`** — expanded to handle per-endpoint metrics for realistic benchmarks, outputs structured JSON with `http`, `startup`, `realistic`, `realisticPg` sections

### Documentation

- **BenchmarkResults.vue** — redesigned to display three benchmark scenarios with methodology descriptions, observability overhead table, and fallback to `benchmark-fallback.json` when gist is unreachable
- **Features page** — reframed validation section as "Out-of-the-Box Validation", noting ArkType is re-exported from `@onebun/core` with zero extra packages
- **Migration guide** — fairer NestJS comparison, acknowledging `nestjs-zod` + `patchNestJsSwagger()` as an alternative; OneBun advantage positioned as zero-config, not uniqueness
- **API docs** — clarified schema messaging ("one schema = type + validation + docs")

### CI

- Added PostgreSQL 16 service container for realistic-pg benchmarks
- Increased workflow timeout from 30 to 45 minutes
- Extended trigger paths to include `packages/drizzle/src/**`, `packages/cache/src/**`, `packages/docs/src/**`
- Replaced separate `run-http.sh` + `startup.sh` with unified `run-all.sh`

### Other

- **Roadmap** — restructured phases, added performance tracks (observability hot path, Drizzle/SQLite), separated post-1.0 ecosystem vision
- **Root dependencies** — removed `prom-client` and `testcontainers` from root `package.json`
- **Gitignore** — added `benchmarks/**/*.db` for SQLite benchmark artifacts
