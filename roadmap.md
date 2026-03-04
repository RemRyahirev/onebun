# OneBun — Роадмап

> Приоритизированный план развития на основе внешнего ревью и внутреннего бэклога.
> Последнее обновление: 2026-02-28

---

## Фаза 1: Production-Ready (критичные блокеры)

### HTTP Guards / Auth
- [ ] Интерфейс `CanActivate` для HTTP (по аналогии с `WsGuard`)
- [ ] Декоратор `@UseGuards(...guards)` для контроллеров и роутов
- [ ] Встроенные guards: `AuthGuard`, `RolesGuard` (RBAC)
- [ ] Фабрика `createGuard(fn)` (как в WS/Queue)
- [ ] Интеграция в request pipeline между middleware и handler

### Exception Filters
- [ ] Интерфейс `ExceptionFilter` с методом `catch(error, context)`
- [ ] Декоратор `@UseFilters(...filters)` на контроллер/роут
- [ ] Глобальный exception filter через `ApplicationOptions`
- [ ] Дефолтный фильтр — текущая логика обработки `OneBunBaseError`

### Testing Utilities
- [ ] `TestingModule.create({ imports, controllers, providers, overrides })`
- [ ] `.overrideProvider(Token).useValue(mock)` / `.useClass(MockClass)`
- [ ] `.compile()` → экземпляр приложения для тестирования
- [ ] HTTP-тестирование без поднятия сервера

### Security Middleware
- [ ] `CorsMiddleware` с конфигурацией через `ApplicationOptions.cors`
- [ ] `RateLimitMiddleware` (in-memory + Redis бэкенды)
- [ ] `SecurityHeadersMiddleware` (аналог helmet)

### Документация (пробелы Фазы 1)
- [ ] Раздел про graceful shutdown в docs (уже реализован в коде)
- [ ] Документирование SSE (уже реализовано в коде)

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
- [ ] Пакет `create-onebun` / `@onebun/cli`
- [ ] `bunx create-onebun my-app` — создание проекта из шаблона
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
- [ ] Performance benchmarks vs Hono, Elysia, NestJS+Fastify
- [ ] GraphQL + Drizzle интеграция (@pothos/plugin-drizzle)
- [ ] Config validation at build time (документирование паттерна с ArkType)
- [ ] Plugin system — формальный API для расширений
- [ ] Рассмотреть переход на MPL-2.0 лицензию

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
