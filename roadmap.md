# OneBun — Роадмап

> Приоритизированный план развития на основе внешнего ревью и внутреннего бэклога.
> Последнее обновление: 2026-02-28

---

## Фаза 1: Production-Ready (критичные блокеры) ✅

### HTTP Guards / Auth
- [x] Интерфейс `CanActivate` для HTTP (по аналогии с `WsGuard`)
- [x] Декоратор `@UseGuards(...guards)` для контроллеров и роутов
- [x] Встроенные guards: `AuthGuard`, `RolesGuard` (RBAC)
- [x] Фабрика `createGuard(fn)` (как в WS/Queue)
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

### Документация (пробелы Фазы 1)
- [x] Раздел про graceful shutdown в docs (уже реализован в коде)
- [x] Документирование SSE (уже реализовано в коде)
- [x] Документация для Guards (`docs/api/guards.md`)
- [x] Документация для Exception Filters (`docs/api/exception-filters.md`)
- [x] Документация для Security Middleware (`docs/api/security.md`)

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
- [x] `bun create @onebun my-app` — создание проекта из шаблона
- [ ] `bunx onebun generate module/controller/service`

### Документация (пробелы Фазы 2)
- [ ] Migration guide: NestJS → OneBun
- [ ] Deployment guide: Docker, k8s, CI/CD
- [ ] Testing guide: unit, integration, e2e
- [ ] Расширенный Troubleshooting / FAQ
- [ ] Changelog на сайте документации

---

## Фаза 3: Ecosystem (после 1.0)

### Функциональность
- [x] Performance benchmarks vs Hono, Elysia, NestJS+Fastify
- [ ] GraphQL + Drizzle интеграция (@pothos/plugin-drizzle)
- [ ] Config validation at build time (документирование паттерна с ArkType)
- [ ] Plugin system — формальный API для расширений
- [x] Рассмотреть переход на MPL-2.0 лицензию

---

## Отдельный бэклог (из plan.md)

### Модули
- [ ] TimescaleDB поддержка в Drizzle
- [ ] Redis модуль
- [ ] Kafka: сервис и декораторы
- [ ] ClickHouse модуль
- [ ] WS: легковесные diff-ы для обновлений

### Инфраструктура
- [ ] Шаблоны: single app, multi app
- [ ] Базовые конфиги: tsconfig, eslint, werf
- [ ] Локальная инфраструктура и CI
- [ ] Оптимизация `getNextRun` в cron-parser: пропускать неподходящие месяцы/дни/часы целиком вместо посекундного перебора (~31M итераций для невозможных расписаний)

### Auth (расширенная)
- [ ] Межсервисная авторизация
- [ ] Криптографические подписи
- [ ] Уникальные credentials для вызывающих сервисов

### Интеграции
- [ ] HashiCorp Vault
- [ ] Temporal
- [ ] Template services (library, inter-service auth, admin)

---

## Уже реализовано (но не замечено при ревью)

Следующие фичи уже есть в коде, но были пропущены в ревью — проблема discoverability документации:

- **Graceful shutdown** — полная реализация с SIGTERM/SIGINT, drain HTTP/WS/Queue, lifecycle hooks
- **Swagger UI** — `@onebun/docs`, OpenAPI 3.1, CDN-based Swagger UI
- **WS Guards** — 6 встроенных + `createGuard()` + `@UseWsGuards()`
- **Queue Guards** — 4 встроенных + `createMessageGuard()` + `@UseMessageGuards()`
- **ArkType валидация** — заменяет pipes через `@Body(schema)`, `@Query(schema)` и т.д.
- **SSE (Server-Sent Events)** — встроенная поддержка
