---
name: Routes migration cookies headers
overview: Миграция на Bun routes API (BunRequest + CookieMap + native params), добавление @Cookie декоратора, экспорт типов OneBunRequest/OneBunResponse, интеграционные тесты, обновление документации.
todos:
  - id: update-bun-types
    content: Обновить bun-types с 1.2.2 до актуальной версии (с BunRequest и CookieMap)
    status: completed
  - id: migrate-routes
    content: Мигрировать Bun.serve в application.ts с fetch на routes API
    status: completed
  - id: onebun-request-response
    content: Ввести OneBunRequest/OneBunResponse алиасы, использовать везде внутри фреймворка
    status: completed
  - id: add-cookie-paramtype
    content: Добавить COOKIE в ParamType enum и обработку в executeHandler
    status: completed
  - id: add-cookie-decorator
    content: Создать декоратор @Cookie и экспортировать из @onebun/core
    status: completed
  - id: fix-multi-set-cookie
    content: Исправить потерю множественных Set-Cookie заголовков в Object.fromEntries
    status: completed
  - id: integration-tests
    content: "Интеграционные тесты: @Req (BunRequest), @Cookie, custom headers, Set-Cookie"
    status: completed
  - id: docs-examples
    content: Smoke-тесты в docs-examples.test.ts для cookies, headers, @Cookie
    status: completed
  - id: update-docs
    content: "Обновить decorators.md и controllers.md: @Cookie, OneBunRequest, cookies, headers"
    status: completed
  - id: run-checks
    content: Прогнать bunx tsc --noEmit, bun lint, bun test, bun run publish:check
    status: completed
isProject: false
---

# Миграция на Bun routes API + cookies/headers

## Принципы

- **Все эндпоинты в routes** — декоратор-роуты, docs, metrics, healthcheck. В `fetch` fallback только WebSocket upgrade + 404
- **OneBunRequest / OneBunResponse** — единый тип везде: внутри фреймворка, в декораторах, в пользовательском коде. Алиас на `BunRequest` / `Response`
- **Нативные возможности Bun** — `req.params` для path-параметров, `req.cookies` (CookieMap) для cookies

## Этап 1: Обновить bun-types

Текущая версия: 1.2.2 (нет `BunRequest`, `CookieMap`). Нужно обновить до актуальной (>= 1.2.3).

```bash
bun add -d bun-types@latest
```

Проверить что `BunRequest`, `CookieMap` доступны в типах после обновления.

## Этап 2: Ввести OneBunRequest / OneBunResponse

### types.ts

Файл: `[packages/core/src/types.ts](packages/core/src/types.ts)`

```typescript
/**
 * HTTP Request type used in OneBun controllers.
 * Extends standard Web API Request with:
 * - .cookies (CookieMap) for reading/setting cookies
 * - .params for accessing route parameters
 * @see https://bun.com/reference/bun/BunRequest
 */
export type OneBunRequest = import('bun').BunRequest;

/**
 * HTTP Response type used in OneBun controllers.
 * Standard Web API Response.
 */
export type OneBunResponse = Response;
```

### index.ts

Файл: `[packages/core/src/index.ts](packages/core/src/index.ts)` — добавить в экспорт из `./types`:

```typescript
type OneBunRequest,
type OneBunResponse,
```

### Заменить `Request` на `OneBunRequest` внутри фреймворка

Во всех местах в application.ts, controller.ts, декораторах, middleware-типах, где используется `Request`:

- `req: Request` -> `req: OneBunRequest`
- JSDoc/комментарии: Request -> OneBunRequest
- Типы middleware: `(req: Request, next: ...) => Response` -> `(req: OneBunRequest, next: ...) => OneBunResponse`

## Этап 3: Миграция Bun.serve на routes API

Основной файл: `[packages/core/src/application/application.ts](packages/core/src/application/application.ts)`

### 3.1. Построение routes объекта (замена строк 434-515)

Текущий код строит `Map<string, RouteData>`. Заменяем на построение Bun routes объекта:

```typescript
// routes формат Bun: { "/path": handler } или { "/path": { GET: handler, POST: handler } }
const bunRoutes: Record<string, ((req: OneBunRequest, server: Server) => OneBunResponse | Promise<OneBunResponse>) | Record<string, (req: OneBunRequest, server: Server) => OneBunResponse | Promise<OneBunResponse>>> = {};

for (const controllerClass of controllers) {
  // ... получить metadata, controller instance (как сейчас) ...

  for (const route of controllerMetadata.routes) {
    const fullPath = normalizePath(`${appPrefix}${controllerPath}${route.path}`);
    const method = this.mapHttpMethod(route.method);
    const handler = /* bound handler */;

    // Создать обёрточный handler со всей OneBun-логикой
    const wrappedHandler = createRouteHandler(app, route, handler, controller, fullPath, method);

    // Добавить в bunRoutes с группировкой по path + method
    if (!bunRoutes[fullPath]) {
      bunRoutes[fullPath] = { [method]: wrappedHandler };
    } else if (typeof bunRoutes[fullPath] === 'object') {
      (bunRoutes[fullPath] as Record<string, Function>)[method] = wrappedHandler;
    }
  }
}
```

### 3.2. Обёрточная функция createRouteHandler

Выносим всю текущую логику из fetch (tracing, metrics, middleware, executeHandler) в отдельную функцию, которая создаёт handler для routes:

```typescript
function createRouteHandler(
  app: OneBunApplication,
  routeMeta: RouteMetadata,
  handler: Function,
  controller: Controller,
  fullPath: string,
  method: string,
): (req: OneBunRequest, server: Server) => Promise<OneBunResponse> {
  return async (req, server) => {
    const startTime = Date.now();

    // 1. Tracing setup (строки 593-660)
    // 2. Query params extraction from URL (строки 713-731)
    // 3. Middleware chain (строки 793-845) или прямой executeHandler (строки 846-887)
    // 4. Metrics recording
    // 5. Tracing end
    // 6. Return response
  };
}
```

### 3.3. Добавить framework-эндпоинты в routes

Docs, metrics — тоже через routes:

```typescript
// Docs endpoints
if (app.options.docs?.enabled !== false && app.openApiSpec) {
  bunRoutes[docsPath] = { GET: (req) => new Response(app.swaggerHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) };
  bunRoutes[openApiPath] = { GET: (req) => new Response(JSON.stringify(app.openApiSpec, null, 2), { headers: { 'Content-Type': 'application/json' } }) };
}

// Metrics endpoint
if (app.metricsService) {
  bunRoutes[metricsPath] = { GET: async (req) => { /* ... */ } };
}
```

### 3.4. Bun.serve с routes + минимальный fetch

```typescript
this.server = Bun.serve<WsClientData>({
  port: this.options.port,
  hostname: this.options.host,
  websocket: wsHandlers,
  routes: bunRoutes,
  async fetch(req, server) {
    // WebSocket upgrade
    if (hasWebSocketGateways && app.wsHandler) {
      const upgradeHeader = req.headers.get('upgrade')?.toLowerCase();
      if (upgradeHeader === 'websocket') {
        const response = await app.wsHandler.handleUpgrade(req, server);
        if (response === undefined) return undefined;
        return response;
      }
    }

    // 404 for everything else
    return new Response('Not Found', { status: 404 });
  },
});
```

### 3.5. Изменения в executeHandler

Файл: `[application.ts:983-1212](packages/core/src/application/application.ts)`

Сигнатура:

```typescript
async function executeHandler(
  route: { handler: Function; controller: Controller; params?: ParamMetadata[]; ... },
  req: OneBunRequest,       // BunRequest с .cookies и .params
  queryParams: Record<string, string | string[]>,  // query parameters отдельно
): Promise<OneBunResponse>
```

Изменения в switch по `param.type`:

- `ParamType.PATH`: `args[param.index] = param.name ? (req.params as Record<string, string>)[param.name] : undefined`
- `ParamType.QUERY`: `args[param.index] = param.name ? queryParams[param.name] : undefined`
- `ParamType.COOKIE`: `args[param.index] = param.name ? req.cookies.get(param.name) ?? undefined : undefined` (NEW)
- `ParamType.HEADER`: без изменений
- `ParamType.BODY`: без изменений
- `ParamType.REQUEST`: `args[param.index] = req` (теперь OneBunRequest)
- `ParamType.RESPONSE`: deprecated, оставить `undefined`

### 3.6. Удаляемый код

- Весь ручной route matching: exact match Map.get (строка 709), regex pattern matching loop (строки 734-749)
- `pathPattern`, `pathParams` в route metadata (строки 487-498) — Bun делает это нативно
- Вся "основная логика" из fetch body (строки 708-938) — перемещается в createRouteHandler

## Этап 4: Декоратор @Cookie

### types.ts

```typescript
export enum ParamType {
  PATH = 'path',
  QUERY = 'query',
  BODY = 'body',
  HEADER = 'header',
  COOKIE = 'cookie',    // NEW
  REQUEST = 'request',
  RESPONSE = 'response',
}
```

### decorators.ts (после Header, строка 494)

```typescript
/**
 * Cookie parameter decorator.
 * Extracts a cookie value by name using BunRequest.cookies (CookieMap).
 * Optional by default.
 * @example @Cookie('session_id')
 * @example @Cookie('session_id', { required: true })
 */
export const Cookie = createParamDecorator(ParamType.COOKIE);
```

### index.ts — убедиться что Cookie экспортируется через `export * from './decorators'`

## Этап 5: Fix множественные Set-Cookie

В executeHandler при пересоздании Response (строка 1122-1130):

```typescript
// BEFORE (теряет дубликаты Set-Cookie):
const responseHeaders = Object.fromEntries(result.headers.entries());

// AFTER (сохраняет все заголовки):
const newHeaders = new Headers(result.headers);
newHeaders.set('Content-Type', 'application/json');
return new Response(JSON.stringify(validatedResult), {
  status: responseStatusCode,
  headers: newHeaders,
});
```

## Этап 6: Тесты

### Обновление тестовой инфраструктуры

Mock `Bun.serve` в application.test.ts нужно обновить. Текущий mock перехватывает `options.fetch`. С routes нужно:

```typescript
(Bun as any).serve = mock((options: any) => {
  // Сохранить routes для тестирования
  const routes = options.routes || {};
  const fetchFallback = options.fetch;

  // Эмулировать route matching:
  (mockServer as any).fetchHandler = async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const routeHandler = routes[path];
    if (routeHandler) {
      // Создать BunRequest-like объект с cookies и params
      const bunReq = Object.assign(request, {
        params: {},  // extract from path if needed
        cookies: new Map(),  // simplified CookieMap mock
      });

      if (typeof routeHandler === 'function') return routeHandler(bunReq, mockServer);
      if (routeHandler[method]) return routeHandler[method](bunReq, mockServer);
    }
    if (fetchFallback) return fetchFallback(request, mockServer);
    return new Response('Not Found', { status: 404 });
  };

  return mockServer;
});
```

### Новые интеграционные тесты в application.test.ts

- `@Req()` инжектит объект с `.cookies` и `.params`
- `@Cookie('session')` извлекает cookie
- `@Cookie('missing')` возвращает `undefined`
- Custom headers сохраняются в response
- `Set-Cookie` одиночный и множественный сохраняются
- Route params через `req.params` работают

### Smoke-тесты в docs-examples.test.ts

- `@Cookie('name')` пример
- `req.cookies.set()` для установки cookies
- Custom response headers
- `@Req()` с `OneBunRequest` типом

## Этап 7: Документация

### docs/api/decorators.md

- Новая секция `### @Cookie()` после `@Header()`:
  - Сигнатура, options, примеры
  - Связь с `CookieMap`
- Обновить `### @Req()`:
  - Тип: `OneBunRequest` (extends Web API Request, добавляет `.cookies` и `.params`)
  - Примеры: чтение cookies, доступ к params
- Пометить `@Res()` как deprecated
- Обновить LLM-only quick reference

### docs/api/controllers.md

- Новая секция "Working with Cookies":
  - Чтение через `@Cookie('name')`
  - Чтение через `req.cookies.get('name')` в `@Req()`
  - Установка через `req.cookies.set('name', 'value', options)`
  - Удаление через `req.cookies.delete('name')`
- Новая секция "Custom Response Headers":
  - Возврат `new Response(body, { headers: { 'X-Custom': 'value' } })`
  - Set-Cookie через заголовок или `req.cookies.set()`
- Обновить типы: `Request` -> `OneBunRequest`, упомянуть `OneBunResponse`

## Что уже выполнено

### Этап 1: Обновление bun-types

* Обновлён bun-types с 1.2.2 до ^1.3.8 во всех 13 package.json файлах (root + все пакеты + example + future-example)
* Обновлён engines.bun в core до >=1.2.12
* Подтверждена доступность типов BunRequest и CookieMap
* Попутно исправлены ошибки типизации, вызванные обновлением bun-types:
  * Server теперь требует generic аргумент — добавлен Server<WsClientData> в ws-base-gateway.ts, ws-handler.ts, ws.types.ts
  * typeof fetch теперь содержит preconnect — добавлены as unknown as typeof fetch в моках (3 теста)
  * Удалены 2 устаревших @ts-expect-error в schemas.test.ts

### Этап 2: Типы OneBunRequest / OneBunResponse

* Добавлены типы OneBunRequest (алиас на BunRequest) и OneBunResponse (алиас на Response) в types.ts с JSDoc
* Экспортированы из index.ts
* Заменён тип Request на OneBunRequest | Request в:
  * application.ts — executeHandler() (совместимо с текущим fetch и будущим routes API)
  * controller.ts — isJson(), parseJson()
  * ws-handler.ts — handleUpgrade()

### Этап 3: Миграция Bun.serve на routes API

* Добавлена утилитная функция `extractQueryParams(url)` для выделения query params из URL (с поддержкой array notation и repeated keys)
* Создана функция `createRouteHandler()` — обёрточная функция, которая инкапсулирует полный жизненный цикл обработки HTTP-запроса: tracing setup → middleware chain → executeHandler → metrics recording → tracing end → error handling
* Построение routes заменено с `Map<string, RouteData>` на `bunRoutes: Record<string, ...>` — объект routes для Bun API
* Удалена вся ручная маршрутизация: regex pattern matching, pathPattern/pathParams в метаданных route, exact match по Map.get + fallback через цикл
* Path parameters теперь обрабатываются нативно Bun через `req.params` (BunRequest) вместо ручного regex-извлечения
* Для консистентного matching trailing slash регистрируются обе варианты пути (`/api/users` и `/api/users/`)
* Framework endpoints (docs/swagger, openapi.json, metrics) перенесены из fetch handler в bunRoutes как обычные route entries
* `Bun.serve` теперь использует `routes: bunRoutes` + минимальный `fetch` fallback (только WebSocket upgrade + 404)
* `executeHandler` обновлён: принимает `OneBunRequest` (без `| Request`) и отдельный `queryParams` вместо общего `paramValues`; PATH params берутся из `req.params`, QUERY params — из отдельного аргумента
* Обновлена тестовая инфраструктура:
  * Добавлены `matchRoutePattern()` и `createRoutesAwareMock()` — эмуляция Bun route matching в тестах
  * Все 4 секции тестов, мокающие `Bun.serve`, переведены на новый мок
* Все 1991 тестов проходят, TypeScript без ошибок, линтер без ошибок, publish:check OK

### Этап 4: Декоратор @Cookie

* Добавлен `COOKIE = 'cookie'` в `ParamType` enum в types.ts
* Создан декоратор `@Cookie` в decorators.ts через `createParamDecorator(ParamType.COOKIE)` — поддерживает те же сигнатуры, что и `@Query`/`@Header` (name, schema, options)
* Cookie optional по умолчанию (как Query и Header), через `{ required: true }` можно сделать обязательным
* Добавлена обработка `ParamType.COOKIE` в `executeHandler` — извлекает cookie через `req.cookies.get(name)` (CookieMap из BunRequest)
* Cookie автоматически экспортируется из `@onebun/core` через `export * from './decorators'`
* Обновлён JSDoc в `ParamDecoratorOptions` — добавлено упоминание `@Cookie`
* Обновлён тестовый мок `createRoutesAwareMock` — парсит Cookie заголовок из запроса в Map для корректной эмуляции CookieMap

### Этап 5: Fix множественных Set-Cookie заголовков

* Заменён `Object.fromEntries(result.headers.entries())` + spread в `executeHandler` на `new Headers(result.headers)` + `.set('Content-Type', ...)`
* `new Headers()` конструктор корректно сохраняет все заголовки, включая множественные `Set-Cookie`
* Все 1991 тестов проходят, TypeScript без ошибок, линтер без ошибок, publish:check OK

### Этап 6: Тесты

* Добавлены интеграционные тесты в `application.test.ts` (новый describe "Cookies, Headers, and @Req()"):
  * `@Cookie('session')` извлекает cookie из заголовка Cookie
  * `@Cookie('missing')` возвращает `undefined` для отсутствующего cookie
  * `@Cookie('token', { required: true })` возвращает 500 при отсутствующем обязательном cookie
  * Извлечение нескольких cookies одновременно (`@Cookie('theme')`, `@Cookie('lang')`, `@Cookie('session')`)
  * `@Req()` инжектит объект с `.cookies` (Map с get) и `.params`
  * Route params доступны через `req.params` в `@Req()`
  * Custom headers сохраняются в Response (`X-Custom-Header`, `X-Request-ID`)
  * Одиночный `Set-Cookie` заголовок сохраняется
  * Множественные `Set-Cookie` заголовки сохраняются (3 отдельных cookie)
  * Комбинация `@Cookie`, `@Param`, `@Query`, `@Header` в одном обработчике
* Добавлены smoke-тесты в `docs-examples.test.ts`:
  * `@Cookie` декоратор: optional, required, with validation, combined with other decorators
  * `@Req()` с `OneBunRequest` типом: доступ к `.cookies`, `.params`
  * `OneBunRequest` и `OneBunResponse` типы
  * Custom Response Headers
  * Set-Cookie через Headers API
  * Working with Cookies: чтение через `@Cookie`, чтение/установка/удаление через `req.cookies`
* Все 2015 тестов проходят (было 1991 — +24 новых), TypeScript без ошибок, линтер без ошибок

### Этап 7: Документация

* Обновлён `docs/api/decorators.md`:
  * Добавлена секция `### @Cookie()` после `@Header()` — сигнатура, options, примеры с optional/required/validation
  * Обновлён `### @Req()` — тип `OneBunRequest`, описание `.cookies` (CookieMap) и `.params`, примеры
  * `### @Res()` помечен как deprecated с объяснением альтернативы
  * LLM-only quick reference обновлён: добавлены `@Cookie`, `@Req` с `OneBunRequest`, `req.cookies` API, custom headers, deprecated `@Res()`
  * Complete Example обновлён: `Cookie`, `Req`, `OneBunRequest` добавлены в импорты
* Обновлён `docs/api/controllers.md`:
  * Добавлена секция "Working with Cookies" — чтение через `@Cookie()`, чтение/установка/удаление через `req.cookies`
  * Добавлена секция "Custom Response Headers" — custom headers, множественные Set-Cookie через Headers API
  * Типы обновлены: `Request` → `OneBunRequest` в `isJson()`, `parseJson()`, примерах
  * Complete Controller Example обновлён: `Cookie`, `Req`, `OneBunRequest` добавлены в импорты
* Все 2015 тестов проходят, TypeScript без ошибок, линтер без ошибок, publish:check OK
