# References

Полезные ссылки на документации различных технологий, используемых в проекте OneBun.

## Bun.js

### Документация
- [Официальная документация](https://bun.sh/docs)
- [TypeScript в рантайме](https://bun.sh/docs/runtime/typescript)
- [Разрешение модулей](https://bun.sh/docs/runtime/modules)
- [HTTP сервер](https://bun.sh/docs/api/http)
- [WebSocket Server](https://bun.sh/docs/api/websockets)
- [Web API](https://bun.sh/docs/api/web-api)

### Особенности для OneBun

**Нулевая сборка**: Bun выполняет TypeScript напрямую. В `package.json` пакетов можно использовать `.ts` как точки входа:
```json
{
  "main": "src/index.ts",
  "exports": { ".": { "import": "./src/index.ts", "types": "./src/index.ts" } }
}
```

**Монорепозиторий**: пакеты импортируют друг друга без сборки — Bun разрешает `src/index.ts` автоматически.

### Решение проблем с TypeScript в Bun

- **Экспорты**: предпочитать `export { Type } from './file'` вместо `export * from './file'` — Bun может некорректно обрабатывать типы при wildcard re-export
- **Циклические зависимости**: объединять взаимозависимые интерфейсы в одном файле или создавать промежуточный файл с общими типами
- **Критические DI-типы**: создавать отдельные файлы, минимизировать зависимости, указывать первыми в `index.ts`


## Effect.js

### Документация
- [Официальная документация](https://effect.website/docs/introduction)
- [Документация для LLMs](https://effect.website/llms.txt)
- [Документация для LLMs (сжатый формат)](https://effect.website/llms-small.txt)

### Ключевые разделы
- [Управление контекстом](https://effect.website/docs/context-management/context)
- [Система слоев (Layers)](https://effect.website/docs/requirements-management/layers)
- [Обработка ошибок](https://effect.website/docs/error-management/error-handling)
- [Схемы и валидация](https://effect.website/docs/schema)
- [Логирование](https://effect.website/docs/observability/logging)

### API Reference
- [Context API](https://effect-ts.github.io/effect/effect/Context.ts.html)
- [Layer API](https://effect-ts.github.io/effect/effect/Layer.ts.html)
- [Effect API](https://effect-ts.github.io/effect/effect/Effect.ts.html)
- [Logger API](https://effect-ts.github.io/effect/effect/Logger.ts.html)

### Основные концепции в OneBun

```typescript
// Effect<A, E, R> — вычисление с результатом A, ошибкой E, зависимостями R

// DI: теги и слои
const MyService = Context.GenericTag<MyServiceInterface>("MyService");
const myServiceLayer = Layer.succeed(MyService, implementation);

// Используем pipe-синтаксис (НЕ Effect.gen с генераторами)
pipe(
  MyService,
  Effect.flatMap(service => service.doSomething()),
  Effect.provide(myServiceLayer)
);

// Композиция слоев (Layer.merge принимает только 2 аргумента)
Layer.merge(Layer.merge(layer1, layer2), layer3);

// Типизированные ошибки
pipe(
  effect,
  Effect.catchTag("MyError", error => /* обработка */),
  Effect.catchAll(error => /* общая обработка */)
);
```

### Логирование в Effect.js

Форматтеры: `prettyLogger` (dev), `jsonLogger` (prod), `logfmtLogger`, `stringLogger`.

```typescript
// Уровни логирования
pipe(
  Effect.log("Info"),
  Effect.andThen(Effect.logDebug("Debug")),
  Effect.provide(Logger.withMinimumLogLevel(LogLevel.Debug))
);

// Отключение логирования
Effect.provide(Logger.withMinimumLogLevel(LogLevel.None));
```

### Известные особенности версий

- `Context.GenericTag<Interface>("TagName")` (не `Context.Tag`)
- `Layer.merge` принимает только 2 аргумента — используйте вложенные вызовы
- Продвинутая система типов может вызывать проблемы при смешивании подходов
- Для отладки async эффектов: `Effect.tap` и `Effect.withSpan`


## TypeScript

- [Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Разрешение модулей](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Декораторы](https://www.typescriptlang.org/docs/handbook/decorators.html)


## ArkType

- [Документация](https://arktype.io/)
- [GitHub](https://github.com/arktypeio/arktype)
- **Использование**: runtime валидация в `@onebun/core`
- TypeScript-first валидация с выводом типов
- Генерация JSON Schema для OpenAPI документации
- Интеграция с Drizzle через drizzle-arktype


## Drizzle ORM

- [Документация](https://orm.drizzle.team/)
- [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview)
- [GitHub](https://github.com/drizzle-team/drizzle-orm)

**Schema-first**: схемы (`pgTable`/`sqliteTable`) как единая точка истины. Типы через `$inferSelect`/`$inferInsert`. Миграции через drizzle-kit.

### Drizzle ArkType (экспортируется из @onebun/drizzle)

- `createSelectSchema(table)` — валидация данных из БД
- `createInsertSchema(table)` — валидация при вставке
- `createUpdateSchema(table)` — валидация при обновлении

```typescript
import { createInsertSchema } from '@onebun/drizzle';
import { users } from './schema/users';

const insertUserSchema = createInsertSchema(users);

@Post('/users')
async createUser(@Body(insertUserSchema) userData: typeof insertUserSchema.infer) {
  // userData валидирован и типизирован
}
```


## Prometheus & OpenTelemetry

- [prom-client (GitHub)](https://github.com/siimon/prom-client)
- [Prometheus docs](https://prometheus.io/docs/)
- [OpenTelemetry docs](https://opentelemetry.io/docs/)
- [OpenTelemetry JS SDK](https://opentelemetry.io/docs/languages/js/)


## WebSocket

### Bun WebSocket
- [Bun WebSocket Server](https://bun.sh/docs/api/websockets)

### Socket.IO Protocol
- [Engine.IO Protocol](https://socket.io/docs/v4/engine-io-protocol/)
- [Socket.IO Protocol](https://socket.io/docs/v4/socket-io-protocol/)
- [Socket.IO Client API](https://socket.io/docs/v4/client-api/)

### NestJS WebSocket (референсная архитектура)
- [NestJS Gateways](https://docs.nestjs.com/websockets/gateways)
- [NestJS Exception Filters](https://docs.nestjs.com/websockets/exception-filters)
- [NestJS Guards](https://docs.nestjs.com/websockets/guards)

### @onebun/core WebSocket

**Gateway Pattern**:
```typescript
@WebSocketGateway({ path: '/ws' })
export class ChatGateway extends BaseWebSocketGateway {
  @OnConnect()
  handleConnect(@Client() client: WsClientData) {
    return { event: 'welcome', data: { clientId: client.id } };
  }

  @OnMessage('chat:message')
  handleMessage(@Client() client: WsClientData, @MessageData() data: { text: string }) {
    this.broadcast('chat:message', { userId: client.id, text: data.text });
  }
}
```

**Pattern Matching**: `chat:*`, `user:*:action`, `chat:{roomId}:message`, `service:{service}:*`

**Storage**: In-Memory (single-instance) или Redis (multi-instance с pub/sub)

**Guards**: `@UseWsGuards(WsAuthGuard)` для авторизации на уровне обработчиков

**Typed Client**:
```typescript
const definition = createWsServiceDefinition(ChatModule);
const client = createWsClient(definition, { url: 'ws://localhost:3000', auth: { token: 'xxx' } });
await client.connect();
await client.ChatGateway.emit('chat:message', { text: 'Hello' });
```


## @onebun/logger

```typescript
import { makeDevLogger, LoggerService } from '@onebun/logger';

const loggerLayer = makeDevLogger();
const program = pipe(
  LoggerService,
  Effect.flatMap(logger => pipe(
    logger.info('Info message'),
    Effect.flatMap(() => logger.error('Error', new Error('details'))),
  ))
);
pipe(program, Effect.provide(loggerLayer), Effect.runPromise);
```


## @onebun/requests

### Схемы авторизации
- **Bearer Token**: `Authorization: Bearer <token>`
- **API Key**: header или query parameter
- **Basic Auth**: `Authorization: Basic <base64(user:pass)>`
- **OneBun Auth**: HMAC-подписи для межсервисного взаимодействия
- **Custom Auth**: пользовательские interceptor'ы

### Retry стратегии
- **Fixed**: фиксированная задержка
- **Linear**: линейное увеличение
- **Exponential**: экспоненциальный backoff

```typescript
import { createHttpClient } from '@onebun/requests';

const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  auth: { type: 'bearer', token: 'your-token' },
  retries: { max: 3, delay: 1000, backoff: 'exponential' }
});

const response = await Effect.runPromise(client.get('/users'));
```

### Dual API

- **Promise методы** (default): `get`, `post`, `put` — для простых CRUD и async/await
- **Effect методы**: `getEffect`, `postEffect`, `putEffect` — для сложных workflow и композиций


## @onebun/docs

- Генерация OpenAPI 3.1 спецификации из метаданных контроллеров
- Swagger UI endpoint
- Декораторы: `@ApiOperation`, `@ApiTags`