# OneBun — Роадмап

> Приоритизированный план развития.
> Последнее обновление: 2026-04-21

---

## Фаза 1: Production-Ready (критичные блокеры) ✅

### HTTP Guards / Auth
- [x] Интерфейс `CanActivate` для HTTP
- [x] Декоратор `@UseGuards(...guards)` для контроллеров и роутов
- [x] Встроенные guards: `AuthGuard`, `RolesGuard` (RBAC)
- [x] Фабрика `createHttpGuard(fn)`
- [x] Интеграция в request pipeline между middleware и handler

### Exception Filters
- [x] Интерфейс `ExceptionFilter` с методом `catch(error, context)`
- [x] Декоратор `@UseFilters(...filters)` на контроллер/роут
- [x] Глобальный exception filter через `ApplicationOptions`
- [x] Дефолтный фильтр — текущая логика обработки `OneBunBaseError`

### Testing Utilities
- [x] `TestingModule.create({ imports, controllers, providers, overrides })`
- [x] `.overrideProvider(Token).useValue(mock)` / `.useClass(MockClass)`
- [x] `.compile()` → экземпляр приложения для тестирования
- [x] HTTP-тестирование через реальный сервер на случайном порту

### Security Middleware
- [x] `CorsMiddleware` с конфигурацией через `ApplicationOptions.cors`
- [x] `RateLimitMiddleware` (in-memory + Redis бэкенды)
- [x] `SecurityHeadersMiddleware` (аналог helmet)

### Документация
- [x] Graceful shutdown
- [x] SSE
- [x] Guards
- [x] Exception Filters
- [x] Security Middleware

---

## Фаза 2: Developer Experience (adoption)

### HTTP Interceptors
- [ ] Интерфейс `Interceptor` с методом `intercept(context, next)`
- [ ] Декоратор `@UseInterceptors(...interceptors)`
- [ ] Встроенные: `LoggingInterceptor`, `CacheInterceptor`, `TimeoutInterceptor`

### Health Checks
- [ ] `HealthModule` с `HealthController` (`/health`, `/ready`)
- [ ] Встроенные индикаторы: Database, Redis, NATS
- [ ] Агрегация статусов, liveness/readiness probes

### CLI / Scaffolding
- [x] Пакет `create-onebun` / `@onebun/cli`
- [x] `bun create @onebun my-app`
- [ ] `bunx onebun generate module/controller/service`

### DX-улучшения
- [ ] Необязательный ведущий слэш в route decorators: `@Get(':id')`
- [ ] Scoped providers: `REQUEST` и `TRANSIENT` scope
- [ ] Per-route middleware на уровне модуля: `configureMiddleware()` с паттернами

### Performance: Observability hot path
- [x] Объединить 4-5 последовательных `Effect.runPromise()` в request tracing pipeline в один `Effect.pipe()` с одним `runPromise` (packages/core/src/application/application.ts:740-766)
- [x] Skip span creation когда нет OTLP exporter endpoint (избежать аллокаций без пользы)
- [ ] Buffered async logger transport (замена синхронного `console.log()` в `ConsoleTransport`)

### Performance: Drizzle/SQLite
- [ ] Пропозал в drizzle-orm: заменить `stmt.values()[0]` на `stmt.get()` в bun-sqlite adapter `.get()` метода
- [ ] Пропозал в drizzle-orm: использовать `Database.query()` (cached) вместо `Database.prepare()` (uncached)

### Документация
- [x] Migration guide: NestJS → OneBun
- [ ] Deployment guide: Docker, k8s, CI/CD
- [ ] Testing guide: unit, integration, e2e
- [ ] Расширенный Troubleshooting / FAQ
- [ ] Changelog на сайте документации

---

## Фаза 3: Road to 1.0

### Framework features
- [ ] Unified application entry point (merge `OneBunApplication` и `MultiServiceApplication`)
- [ ] Scoped providers (`REQUEST`, `TRANSIENT`)
- [ ] Provider-not-found suggestions ("did you mean X?")

### Tooling & scaffolding
- [ ] Multi-service starter template (`--template multi-service`)
- [ ] Observability stack template (`--with-observability`: docker-compose с Prometheus, Grafana, Jaeger, Loki)
- [ ] `@onebun/tsconfig` — shareable TS config
- [ ] `@onebun/eslint-config` — shareable lint rules

### Документация
- [ ] Deployment guide (Docker, k8s, CI/CD)
- [ ] Testing guide (unit, integration, e2e)
- [ ] Expanded Troubleshooting / FAQ

---

## In Design — Experimental tracks

- **Remote Modules** — cross-process service calls via DI, deploy-time topology
- **@onebun/devtools** — visual project explorer (DI graph, module topology, route map, metric overlay)
- **Autonomous fault isolation for root-modules** — failing root-module в dev не роняет siblings

---

## Post-1.0 Ecosystem

### Framework & integrations
- [ ] GraphQL integration (`@pothos/plugin-drizzle`)
- [ ] Plugin system — формальный API для расширений
- [ ] Build-time config validation (ArkType at build time)
- [ ] HashiCorp Vault integration
- [ ] ClickHouse integration
- [ ] Real-time shared config via WebSocket (feature flags, shared settings)
- [ ] Client-facing authentication (Passport-style: JWT, OAuth, sessions)
- [ ] Redoc-style static API documentation

### Scaffolding templates
- [ ] Admin template (auth, RBAC, endpoint discovery, web UI scaffold)
- [ ] Library (shared config) template
- [ ] Inter-service auth template (key rotation, runtime permissions)

---

## Under consideration (demand-driven)

- **TimescaleDB integration** — по запросу
- **Dynamic DI modules** — not planned unless concrete use cases emerge
- **Temporal integration** — undecided, demand-driven

---

## Not planned

- **Node.js compatibility** — Bun-only
- **Kafka / RabbitMQ** — NATS + JetStream only
- **Alternative ORMs** — Drizzle only
- **Runtime DI container manipulation** — no monkey-patching
- **Plugin ecosystem breadth** — deep integration > wide ecosystem
