# Анализ фреймворка OneBun

> **Дата:** 27 февраля 2026
> **Источник:** [onebun.dev](https://onebun.dev/) | [GitHub](https://github.com/RemRyahirev/onebun)
> **Версия на момент анализа:** 0.2.x | 96 коммитов | 0 stars | 1 автор (RemRyahirev)

---

## 1. Соизмеримость с другими фреймворками (NestJS, Hono, Elysia)

OneBun — это **NestJS, переписанный под Bun.js с Effect.ts под капотом**. Архитектурно ближе всего именно к Nest: модули, контроллеры, сервисы, декораторы, DI через конструктор.

### vs NestJS

- Почти идентичная архитектура (Module/Controller/Service/DI/lifecycle hooks), но заточен строго под Bun, не совместим с Express/Fastify адаптерами.
- Вместо class-validator/class-transformer используется **ArkType** (валидация + типы + OpenAPI из одной схемы — реальное преимущество).
- **Effect.ts** внутри вместо rxjs — более мощная и modern система side-effect управления, но и более высокий порог входа при необходимости лезть внутрь.
- Пакетная система из коробки: cache, drizzle, NATS, metrics, tracing — в Nest всё ставится отдельно.
- **Но:** 0 stars, 0 forks, ~96 коммитов, один автор. NestJS — 70k+ stars, 7k+ forks, сотни контрибьюторов, огромная экосистема.

### vs Hono

- Разные философии. Hono — минималистичный, мультирантаймовый (Node, Bun, Deno, Cloudflare Workers, etc.), без мнения о структуре.
- OneBun — opinionated, batteries-included, только Bun.
- Hono даёт свободу в архитектуре, OneBun навязывает NestJS-паттерн.
- Для микросервисов/API-first OneBun удобнее из коробки, для легковесных сервисов и edge — Hono выигрывает.

### vs Elysia

- Elysia — тоже Bun-first, но с фокусом на перформанс и end-to-end type safety через "eden treaty". Более минималистична, менее opinionated.
- OneBun предлагает полный enterprise-стек (observability, queue, cache, multi-service), Elysia — нет.

### Итог

По функциональному покрытию OneBun близок к NestJS и превосходит Hono/Elysia по "batteries included". Но по зрелости экосистемы, комьюнити и production battle-testing — он на совершенно другом уровне, практически на нуле.

---

## 2. Зрелость фреймворка: чего не хватает

Версии пакетов `0.2.x` — явный pre-1.0 статус. GitHub: 0 stars, 0 forks, один мейнтейнер. Выглядит как хороший pet-project / early-stage OSS.

### MUST (без этого в прод нельзя)

| Фича | Описание |
|-------|----------|
| **Authentication / Authorization** | Нет guards, interceptors, middleware-цепочки для аутентификации. В NestJS — Guards, Passport, RBAC. Критично для любого реального API. |
| **Error handling middleware / Exception filters** | Есть `this.error()` в контроллерах, но нет глобального exception filter / error boundary для необработанных ошибок. |
| **Testing utilities** | Нет `TestingModule`, мок-провайдеров, утилит для интеграционного тестирования. Для фреймворка с DI — must. |
| **Graceful shutdown** | Lifecycle hooks описаны, но не документирован graceful drain для HTTP-соединений и очередей. |
| **Security basics** | CORS, helmet, rate limiting — не упомянуты вообще. |

### SHOULD (сильно влияет на adoption)

| Фича | Описание |
|-------|----------|
| **CLI / scaffolding** | Нет `nest g module/controller/service`-аналога. Для opinionated фреймворка очень ожидаемо. |
| **Interceptors / Pipes / Guards** | В NestJS — ключевые абстракции. OneBun имеет middleware, но не показывает guards/interceptors. |
| **Migration tooling** | Drizzle упомянут, но нет документации по миграциям. |
| **Health checks** | Для k8s-деплоя нужны readiness/liveness пробы. |
| **Swagger UI** | OpenAPI генерация упомянута, но неясно, есть ли встроенный Swagger UI endpoint. |
| **Более широкое покрытие БД** | Только PostgreSQL/SQLite через Drizzle. Нет MongoDB, MySQL. |

### COULD (nice to have)

| Фича | Описание |
|-------|----------|
| **GraphQL support** | Есть в NestJS, нет в OneBun. |
| **CQRS / Event Sourcing** | NestJS имеет пакеты для этого. |
| **i18n** | Для мультиязычных API. |
| **File upload handling** | Не документирован. |
| **Plugin system** | Для расширения сообществом. |
| **SSE (Server-Sent Events)** | Для реактивного стриминга без WebSocket. |
| **Config validation at build time** | ArkType позволяет, но не описано. |

---

## 3. Качество документации

### Что хорошо

- Чёткий getting started с пошаговыми инструкциями
- Архитектурная страница с диаграммами lifecycle
- Примеры кода в каждом разделе
- Наличие AI Docs (llms.txt) — forward-thinking подход для LLM-assisted разработки
- Навигация по разделам (Core, Communication, Data & State, Observability, Examples)

### Чего не хватает

| Раздел | Комментарий |
|--------|-------------|
| **Migration guide** | Нет гайда "переход с NestJS" или "переход с Hono", хотя это очевидная ЦА. |
| **Deployment guide** | Docker, k8s, CI/CD — ничего. Для "production backend framework" критично. |
| **Configuration deep dive** | Env schema описана поверхностно, нет примеров с секретами, validation errors, multi-env. |
| **Testing guide** | Полностью отсутствует. |
| **Performance benchmarks** | Заявлен как быстрый, но нет ни одного бенчмарка. |
| **Troubleshooting / FAQ** | Только 3 пункта в getting started. |
| **Changelog / Roadmap** | 109 тегов на GitHub, но нет release notes и публичного roadmap на сайте. |
| **Production use cases** | Нет (ожидаемо для нового фреймворка). |

**Общая оценка документации:** твёрдая тройка. Достаточно для старта, недостаточно для production adoption.

---

## 4. Целевая аудитория

### Кто ЦА

1. **NestJS-разработчики, которые хотят перейти на Bun** — основная аудитория. Знакомые паттерны, но на более быстром рантайме.

2. **Backend-разработчики на TS, ищущие opinionated фреймворк для Bun** — в экосистеме Bun нет "NestJS-like" фреймворка. Elysia и Hono минималистичны, OneBun закрывает нишу "полного решения".

3. **Разработчики микросервисов на TS** — MultiServiceApplication, typed HTTP clients, NATS/JetStream, metrics/tracing — явно enterprise-microservices стек.

### Был бы интересен этим аудиториям?

| Аудитория | Вердикт | Почему |
|-----------|---------|--------|
| NestJS-мигранты | ⚠️ Ограниченно | Идеологически — да, но рисковать на 0-star фреймворке с одним автором ради прироста скорости Bun нереалистично для продакшена. Подходит для side-projects и экспериментов. |
| Bun-энтузиасты | ⚠️ Ограниченно | Bun-комьюнити ценит минимализм (Hono/Elysia) или голый `Bun.serve()`. Opinionated тяжеловес — не совсем в духе. |
| Enterprise-команды | ❌ Нет | Без комьюнити, без production track record, один мейнтейнер. LGPL-3.0 лицензия формально не мешает, но может потребовать доп. ревью у корпоративных юристов (см. раздел про лицензию). |

---

## Резюме

Фреймворк **архитектурно грамотный и функционально амбициозный**. Автор очевидно хорошо знает NestJS, Effect.ts и Bun. Но в текущем состоянии (v0.2.x, solo-developer, 0 community) — это больше **proof-of-concept / portfolio project**, чем готовый инструмент для продакшена.

**Для реального adoption нужно:**

1. Дорасти до 1.0
2. Получить хотя бы пару десятков stars и контрибьюторов
3. Показать production case
4. Закрыть MUST-фичи (auth, error handling, testing, security)
5. Написать deployment и testing guides
6. Рассмотреть смену лицензии (см. раздел ниже)

---

## Приложение: Рекомендация по лицензии

Текущая лицензия **LGPL-3.0** в целом корректна для задачи "используй свободно, но не перепродавай фреймворк как свой". Твой бизнес-код, работающий поверх OneBun, остаётся полностью твоим. Модификации самого фреймворка обязаны быть открыты.

Однако LGPL имеет нюансы: тонкая обёртка поверх (без изменения исходных файлов) формально не попадает под copyleft, а корпоративные юристы часто отправляют LGPL на дополнительное ревью из-за copyleft-компонента. Также есть серая зона при сборке в single binary (`bun build --compile`).

### Альтернативы

| Лицензия | Плюсы | Минусы | Примеры |
|----------|-------|--------|---------|
| **MPL-2.0** (рекомендуется) | Copyleft на уровне файлов: изменённые файлы фреймворка остаются открытыми, свой код — полностью твой. В "green zone" у корпоративных юристов. Проще и понятнее LGPL, меньше серых зон с bundling. | Не запрещает конкурирующий managed service на базе фреймворка. | Firefox, Terraform (до BSL), Syncthing |
| **BSL 1.1** | Можно прямо прописать: "нельзя предлагать как конкурирующий фреймворк/managed service". Через N лет (обычно 3–4) автоматически конвертируется в Apache 2.0. | Часть OSS-комьюнити не считает BSL "настоящим open source" — может оттолкнуть контрибьюторов. | MariaDB, Sentry, CockroachDB |
| **LGPL-3.0** (текущая) | Уже закрывает основной кейс: модификации фреймворка остаются открытыми. | Серая зона с single binary, "yellow zone" у корпоративных юристов, не защищает от тонких обёрток. | GNU libs, Qt (dual) |

### Вывод

**MPL-2.0** — оптимальный выбор для OneBun: защищает от "форкнул → закрыл → продаю", не пугает enterprise, полноценный OSS, и лишён серых зон LGPL при бандлинге.
