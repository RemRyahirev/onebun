# Changelog

## 0.4.4 — 2026-04-25

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.3 | 0.4.4 |
| `@onebun/logger` | 0.4.1 | 0.4.2 |

### Breaking Changes

- **⚠️ Fail-fast dependency resolution** — unresolved DI dependencies now throw `DependencyResolutionError` at bootstrap instead of silently injecting `undefined`. Services, controllers, middleware, and interceptors with missing required dependencies will crash immediately with an actionable error message that names the missing dependency and suggests which module to import or export. Use the new `@Optional()` decorator to opt into the previous behavior for intentionally optional dependencies (`@onebun/core`)
- **⚠️ Circular dependencies throw** — circular dependency detection now throws `CircularDependencyError` instead of logging an error and continuing with broken wiring. The error includes the full dependency chain for debugging (`@onebun/core`)
- **⚠️ Missing controller metadata throws** — controllers listed in a module's `controllers` array without a `@Controller()` decorator now throw `OneBunBootstrapError` at startup instead of being silently skipped. WebSocket gateways (`@WebSocketGateway()`) are correctly excluded from this check (`@onebun/core`)

### Improvements

- **`DependencyResolutionError` with diagnostic suggestions** — when a dependency cannot be resolved, the error message searches all registered modules to find where the missing type is provided: suggests adding the module to imports, adding the type to exports, or notes when a global module should have auto-resolved it (`@onebun/core`)
- **`@Optional()` decorator** — marks constructor parameters as optional for DI. When the dependency cannot be resolved, `undefined` is injected instead of throwing. Works with services, controllers, middleware, and interceptors (`@onebun/core`)
- **Per-request trace context isolation** — HTTP request trace context is now stored in `AsyncLocalStorage` instead of `globalThis`, eliminating a race condition where concurrent requests could overwrite each other's trace IDs. Each request gets its own isolated trace context scope via `requestContextStore.run()` (`@onebun/core`)
- **`traceContextGetter` in logger** — `SyncLogger` and `LoggerImpl` now accept a `traceContextGetter` callback for reading per-request trace context from `AsyncLocalStorage`, replacing the `globalThis.__onebunCurrentTraceContext` fallback. The `globalThis.__onebunTraceService` fallback is preserved for non-HTTP contexts (WebSocket, queues) (`@onebun/logger`)
- **Bootstrap error propagation** — `OneBunBootstrapError` and its subclasses (`DependencyResolutionError`, `CircularDependencyError`) are now re-thrown from the service creation catch block instead of being swallowed (`@onebun/core`)

### New Exports

- `DependencyResolutionError`, `CircularDependencyError`, `OneBunBootstrapError` — bootstrap error classes (`@onebun/core`)
- `@Optional()`, `isOptionalParam()` — optional DI parameter decorator and checker (`@onebun/core`)
- `getRegisteredModules()` — iterator over all `@Module()`-registered modules and their metadata (`@onebun/core`)
- `requestContextStore`, `getCurrentTraceContext()`, `RequestContext` — per-request `AsyncLocalStorage` for trace context isolation (`@onebun/core`)
- `LoggerConfig.traceContextGetter` — optional callback for per-request trace context resolution (`@onebun/logger`)

### Tests

- 3 circular dependency tests: direct A↔B cycle, three-way A→B→C→A chain, self-dependency A→A
- 3 fail-fast DI tests: missing required dep throws with error details, suggestion includes module name, `@Optional()` allows graceful undefined
- Updated logger test from `globalThis` trace context to `traceContextGetter` callback
- Fixed 2 existing tests that relied on warn-and-continue behavior for missing controller metadata

## 0.4.2 — 2026-04-24

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.1 | 0.4.2 |
| `@onebun/cache` | 0.4.1 | 0.4.2 |
| `@onebun/docs` | 0.4.2 | 0.4.3 |
| `@onebun/drizzle` | 0.4.1 | 0.4.2 |
| `@onebun/envs` | 0.4.0 | 0.4.1 |
| `@onebun/logger` | 0.4.0 | 0.4.1 |
| `@onebun/metrics` | 0.4.0 | 0.4.1 |
| `@onebun/nats` | 0.4.1 | 0.4.2 |
| `@onebun/requests` | 0.4.1 | 0.4.2 |
| `@onebun/trace` | 0.4.0 | 0.4.1 |

### Improvements

- **Documentation cross-reference system** — new `@see docs:<path>` JSDoc tags link exported symbols to their documentation pages, and `@source docs:<path>#<section>` tags in `docs-examples.test.ts` link tests to the doc snippets they validate. New `bun run docs:xref` script builds forward and reverse maps, validates links, and detects unreferenced or untested doc pages. Supports `--json`, `--markdown`, `--check` (for CI) output modes
- **163 `@see docs:` tags** added across all packages — every exported decorator, class, interface, and factory function now references its documentation page(s)
- **Unified test doc-reference format** — 12 `docs-examples.test.ts` files migrated from ad-hoc `* - docs/api/...` bullet lists and `@source docs/...` to the standardized `@source docs:...` format (198 test references total)

### Documentation

- **`docs/api/guards.md`** — fixed `RolesGuard` description: documented as "at least one required role" (OR logic) but the implementation uses `every()` requiring **all** roles (AND logic)
- **`docs/api/websocket.md`** — added missing `excludeClientIds?: string[]` parameter to `emitToRooms()` and `emitToRoomPattern()` signatures; documented previously undocumented `disconnectRoomPattern(pattern, reason?)` method
- **`docs/api/cache.md`** — fixed `CacheStats` interface: `keys`/`size` corrected to `entries`/`hitRate` matching the actual type definition
- **`docs/architecture.md`** — corrected provider instantiation order (dependency order, not declaration order), controller `onModuleInit` execution (parallel via `Promise.all`), request flow (trace context extraction, exception filter placement, metrics recording), metadata storage description (WeakMap-based system, not Reflect.metadata keys), and DI auto-detection algorithm (removed non-existent constructor source analysis fallback)
- **`docs/getting-started.md`** and **`docs/api/controllers.md`** — removed incorrect "static routes must come before parametric" comments; clarified that Bun's router resolves by specificity

### Other

- New `scripts/docs-xref.ts` cross-reference scanner and `docs:xref` script in `package.json`
- Updated `peerDependencies` in `@onebun/cache`, `@onebun/docs`, `@onebun/drizzle`, `@onebun/nats` to `@onebun/core@^0.4.2`

## 0.4.1 — 2026-04-24

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.4.0 | 0.4.1 |
| `@onebun/cache` | 0.4.0 | 0.4.1 |
| `@onebun/docs` | 0.4.1 | 0.4.2 |
| `@onebun/drizzle` | 0.4.0 | 0.4.1 |
| `@onebun/nats` | 0.4.0 | 0.4.1 |

### Breaking Changes

- **⚠️ Intra-minor breaking change (rare case)** — `getService()` → `getApplication()` technically breaks semver within 0.4.x. Justified because 0.4.0 shipped less than 24h ago, no known deployments exist, and the rename completes the unified-entry-point breaking change already announced in 0.4.0. Users who already migrated to 0.4.0 must also rename the method call.
- **`getService()` renamed to `getApplication()`** — in multi-service mode, `app.getService(name)` is now `app.getApplication(name)` to avoid confusion with DI service resolution (`@onebun/core`)

### Improvements

- **Interceptors across all transports** — new `Interceptor` interface with `intercept(context, next)` method, `BaseInterceptor` base class with DI support, and `@UseInterceptors()` decorator. Works on HTTP controllers, WebSocket gateways, and queue handlers. Supports global (via `ApplicationOptions.interceptors`), controller/gateway-level, and route/handler-level interceptors with onion-model execution order (`@onebun/core`)
- **Built-in interceptors** — `createInterceptor()` factory for inline interceptors, `LoggingInterceptor` (request timing), `TimeoutInterceptor` (configurable deadline), `TransformInterceptor` (response mapping) (`@onebun/core`)
- **`CacheInterceptor`** — caches HTTP GET 2xx responses via `CacheService`; non-GET and non-HTTP transports pass through. Apply with `@UseInterceptors(CacheInterceptor)` (`@onebun/cache`)
- **`ExecutionContext` type discriminant** — `HttpExecutionContext.type = 'http'`, `WsExecutionContext.type = 'ws'`, `MessageExecutionContext.type = 'queue'` for type-safe narrowing in universal interceptors; `isHttpContext()` / `isWsContext()` / `isQueueContext()` type guards exported (`@onebun/core`)
- **Multi-service mode guards** — single-service methods (`getPort()`, `getConfig()`, etc.) now throw a clear error when called on a multi-service app, and vice versa (`@onebun/core`)
- **Removed `effect` from example dependencies** — examples no longer list `effect` as a direct dependency; it is provided transitively by `@onebun/core`
- **Test script runs examples** — `bun test` now also runs `bun test examples/`

### Documentation

- New `docs/api/interceptors.md` page (468 lines) with full guide: interface, base class, built-in interceptors, execution order, transport-specific usage, DI examples
- Updated request pipeline diagram in `docs/api/controllers.md` to include interceptors step
- `docs/api/core.md`, `docs/api/websocket.md`, `docs/api/queue.md` updated with interceptor references
- `docs/architecture.md` and `docs/features.md` updated to reflect interceptor support
- `docs/migration-nestjs.md` updated with interceptor migration notes
- `docs/roadmap.md` — interceptor items marked as complete; new items added for filters and guard unification across transports
- Navigation sidebar updated with Interceptors page

### Tests

- Added 23 unit tests for interceptor core (`composeInterceptors`, `createInterceptor`, `BaseInterceptor`, `LoggingInterceptor`, `TimeoutInterceptor`, `TransformInterceptor`, context type guards)
- Added 9 HTTP interceptor integration tests (route-level, controller-level, global, short-circuit, onion order, guard+interceptor interaction, guard rejection bypass)
- Added 14 multi-service mode tests (mode detection, mode guards, start/stop integration with filtering by options and ENV)
- Added 7 docs-example tests for interceptor documentation code samples
- Hardcoded ports in guard rejection tests replaced with `port: 0`

### Other

- Removed direct `effect` dependency from `@onebun/cache`, `@onebun/docs`, `@onebun/drizzle`, and example `package.json` files (provided transitively)
- Updated `peerDependencies` in `@onebun/cache`, `@onebun/docs`, `@onebun/drizzle`, `@onebun/nats` to `@onebun/core@^0.4.1`
- `scripts/publish.ts` — minor publish script adjustments

## 0.4.0 — 2026-04-23

### Package Versions

| Package | Previous | New |
|---------|----------|-----|
| `@onebun/core` | 0.3.8 | 0.4.0 |
| `@onebun/cache` | 0.3.2 | 0.4.0 |
| `@onebun/docs` | 0.3.4 | 0.4.0 |
| `@onebun/drizzle` | 0.3.3 | 0.4.0 |
| `@onebun/envs` | 0.3.1 | 0.4.0 |
| `@onebun/logger` | 0.3.1 | 0.4.0 |
| `@onebun/metrics` | 0.3.4 | 0.4.0 |
| `@onebun/requests` | 0.3.4 | 0.4.0 |
| `@onebun/trace` | 0.3.4 | 0.4.0 |
| `@onebun/nats` | 0.3.2 | 0.4.0 |
| `@onebun/create` | 0.3.3 | 0.4.0 |

### Breaking Changes

- **`MultiServiceApplication` removed** — replaced by `OneBunApplication` multi-service mode. Pass `{ services: ... }` to the constructor instead of using a separate class. The internal implementation moved to `MultiServiceOrchestrator` (`@onebun/core`)

### Improvements

- **Unified application entry point** — `OneBunApplication` now handles both single-service and multi-service modes via constructor overloads. New methods in multi-service mode: `getApplication(name)`, `getServiceUrl(name)`, `getRunningServices()`, `isServiceRunning(name)` (`@onebun/core`)
- **Optional leading slash in route decorators** — `@Controller('users')` equals `@Controller('/users')`, `@Get(':id')` equals `@Get('/:id')`. NestJS-style paths work out of the box without migration (`@onebun/core`)
- **Version bump script: peerDependencies support** — `bun version:bump` now updates `peerDependencies` alongside `dependencies` and `devDependencies` for `@onebun/*` internal packages

### Documentation

- All docs and examples updated: `MultiServiceApplication` → `OneBunApplication` multi-service mode
- Added leading-slash-optional notes in controllers and decorators docs
- Migration guide: route path format no longer requires changes (step 7 removed)
- `docs/api/core.md` updated with multi-service constructor signature and new methods

## 2026-04-22

### Bug Fixes

- **Guard rejection now returns HTTP 403** — guard reject responses previously returned `200 OK` regardless of `httpEnvelope` setting; now returns `403 Forbidden` by default (`200 OK` when `httpEnvelope: true`), consistent with exception filter behavior (`@onebun/core`)

### Breaking Changes

- **Removed `getService()` / `setService()` from `Controller`** — legacy service-access methods and the internal `services` Map have been removed; use constructor injection instead. `app.getService()` on `OneBunApplication` is unaffected (`@onebun/core`)

### Improvements

- **Decorator order independence** — `@ApiTags`, `@ApiOperation`, and `@ApiResponse` now work correctly regardless of their position relative to `@Controller` or route decorators. The OpenAPI spec generator reads response schemas via `getResponseSchemasMetadata()` (new export) with prototype chain walk, so `@ApiResponse` above `@Get` is now picked up in generated specs (`@onebun/core`, `@onebun/docs`)
- **Removed `__decorate` polyfill** — Bun handles `emitDecoratorMetadata` natively since v1.0.3; the `Reflect.metadata` polyfill is retained as it is still required (`@onebun/core`)

### Documentation

- **AuthGuard** — `docs/roadmap.md` corrected from "token verification" to "Bearer header presence check"; added "Not a Token Validator" warning in `docs/api/guards.md`
- **Guard rejection** — `docs/api/guards.md` llm-only section updated to reflect 403 default
- **Decorator order** — removed all "Decorator Order" warning boxes from `docs/api/docs.md` and `docs/api/decorators.md`
- **Controller API** — removed "Via getService() (Legacy)" section; SSE examples rewritten with constructor injection (`docs/api/controllers.md`, `packages/core/README.md`)

### Tests

- Added 2 integration tests for guard rejection HTTP status codes (403 / 200 with `httpEnvelope`)
- Added 7 tests for decorator order independence (`@ApiTags`, `@ApiOperation`, `@ApiResponse` in both positions)
- Removed 6 obsolete tests (4 `__decorate` polyfill, 1 `getService` controller, 1 `getService` docs-example)

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
