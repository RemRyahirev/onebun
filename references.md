# References

## Bun.js

### Документация
- [Официальная документация](https://bun.sh/docs)
- [Руководство по TypeScript](https://bun.sh/docs/typescript)
- [TypeScript в рантайме](https://bun.sh/docs/runtime/typescript)
- [Разрешение модулей](https://bun.sh/docs/runtime/modules)
- [HTTP сервер](https://bun.sh/docs/api/http)

### Особенности разработки с Bun.js

#### Нулевая сборка
- Bun может выполнять TypeScript файлы напрямую без предварительной компиляции:
  ```typescript
  // Запуск TypeScript файла без компиляции
  bun run src/index.ts
  ```

- В package.json можно использовать .ts файлы как точки входа:
  ```json
  {
    "main": "src/index.ts",
    "module": "src/index.ts",
    "types": "src/index.ts",
    "exports": {
      ".": {
        "import": "./src/index.ts",
        "types": "./src/index.ts"
      }
    }
  }
  ```

#### Преимущества для монорепозиториев
- Проекты в монорепозитории могут импортировать друг друга без предварительной сборки:
  ```typescript
  // Прямой импорт из другого пакета в монорепозитории
  import { Component } from '@monorepo/package';
  // Bun найдет src/index.ts в этом пакете и загрузит его напрямую
  ```

- ESM модули по умолчанию:
  ```json
  {
    "type": "module"
  }
  ```

- Импорт без указания расширения файла:
  ```typescript
  // Bun корректно разрешает импорты без расширений
  import { helper } from './utils';
  ```

#### Оптимизация рабочего процесса
- Нет необходимости в компиляции перед запуском
- Мгновенная обратная связь при изменении кода (с режимом `--watch`)
- Более простая структура проекта без дополнительных папок для скомпилированного кода
- Упрощённая конфигурация CI/CD
- Нет различий между разработкой и продакшном
- Отсутствие проблем "работает на моей машине"

### Решение проблем с TypeScript в Bun

#### Экспорты и импорты
- **Проблемы с перенаправлением экспортов**: При использовании `export * from './file'` Bun может некорректно обрабатывать типы
- **Решение**: 
  - Использовать прямые экспорты: `export { Type } from './file'` вместо `export * from './file'`
  - Объединять связанные типы в один файл
  - Явно экспортировать интерфейсы для DI-контейнеров

#### Циклические зависимости
- Критично избегать циклических зависимостей между файлами
- **Рекомендации**:
  - Объединить взаимозависимые интерфейсы в одном файле
  - Создать промежуточный файл с общими типами
  - Использовать локальные определения интерфейсов где возможно

#### Критические типы
- Для типов, используемых в runtime через DI:
  - Создавать отдельные файлы для каждого критического типа
  - Минимизировать зависимости в этих файлах
  - Указывать эти файлы первыми в экспортах основного index.ts

#### Крайние случаи
- При неразрешимых проблемах с экспортами TypeScript:
  - Использовать `typeof` для преобразования значений в типы

## Effect.js

### Документация
- [Документация Effect](https://effect.website/docs/introduction)
- [Документация для LLMs](https://effect.website/llms.txt) - полный набор ссылок для моделей ИИ
- [Документация в сжатом формате](https://effect.website/llms-small.txt) - оптимизированный для ИИ формат

### Ключевые разделы
- [Управление контекстом](https://effect.website/docs/context-management/context)
- [Система слоев (Layers)](https://effect.website/docs/requirements-management/layers)
- [IO операции](https://effect.website/docs/io)
- [Схемы и валидация](https://effect.website/docs/schema)
- [Типы данных](https://effect.website/docs/data-types)
- [Логирование](https://effect.website/docs/observability/logging)
- [Обработка ошибок](https://effect.website/docs/error-management/error-handling)

### API Reference
- [Context API](https://effect-ts.github.io/effect/effect/Context.ts.html)
- [Layer API](https://effect-ts.github.io/effect/effect/Layer.ts.html)
- [Effect API](https://effect-ts.github.io/effect/effect/Effect.ts.html)
- [Logger API](https://effect-ts.github.io/effect/effect/Logger.ts.html)

### Основные концепции в OneBun

#### Основной тип Effect
```typescript
// Effect<R, E, A> представляет вычисление:
// R - требуемые зависимости (контекст)
// E - тип возможной ошибки
// A - тип успешного результата
```

#### Dependency Injection
```typescript
// Создание тэгов для сервисов
const MyService = Context.GenericTag<MyServiceInterface>("MyService");

// Предоставление реализации
const myServiceLayer = Layer.succeed(MyService, myServiceImplementation);

// Использование сервиса через pipe-синтаксис
pipe(
  MyService,
  Effect.flatMap(service => service.doSomething()),
  Effect.provide(myServiceLayer)
);
```

#### Обработка ошибок
```typescript
// Типизированные ошибки
const MyError = Schema.TaggedError("MyError");

// Перехват ошибок
pipe(
  effect,
  Effect.catchTag("MyError", error => /* обработка ошибки */),
  Effect.catchAll(error => /* общая обработка */)
);
```

#### Композиция слоев
```typescript
// Создание и композиция слоев
const layer1 = Layer.succeed(Service1, implementation1);
const layer2 = Layer.succeed(Service2, implementation2);
const combinedLayer = Layer.merge(layer1, layer2);

// Внедрение слоя
pipe(effect, Effect.provide(combinedLayer));
```

#### Pipe-синтаксис vs генераторы
В OneBun предпочтительно использовать pipe-синтаксис вместо генераторов (`Effect.gen`):

```typescript
// Предпочтительный подход (pipe-синтаксис)
pipe(
  initialValue,
  Effect.flatMap(value => doSomething(value)),
  Effect.catchAll(error => handleError(error)),
  Effect.provide(myLayer),
  Effect.runPromise
);

// Менее предпочтительный подход (генераторы)
Effect.gen(function* () {
  const service = yield* MyService;
  const result = yield* service.doSomething();
  return result;
});
```

Преимущества pipe-синтаксиса:
- Лучшая производительность
- Большая типобезопасность
- Предсказуемый порядок выполнения
- Согласованность с функциональным подходом
- Лучшая читаемость для сложных композиций

### Логирование в Effect.js

#### Документация
- [Официальная документация](https://effect.website/docs/observability/logging/)
- [Logger Module API](https://effect-ts.github.io/effect/effect/Logger.ts.html)

#### Уровни логирования
```typescript
import { Effect, Logger, LogLevel } from 'effect';

// Включение DEBUG логов
const withDebugLogs = Logger.withMinimumLogLevel(LogLevel.Debug);

// Логирование с разными уровнями
const program = pipe(
  Effect.log("Info сообщение"),
  Effect.andThen(Effect.logDebug("Debug сообщение")),
  Effect.andThen(Effect.logWarning("Warning сообщение")),
  Effect.andThen(Effect.logError("Error сообщение")),
  Effect.provide(withDebugLogs)
);
```

#### Форматтеры логов
- **prettyLogger**: Цветной вывод для консоли (разработка)
- **jsonLogger**: JSON формат для обработки логов (продакшн)
- **logfmtLogger**: Компактный key-value формат
- **stringLogger**: Простой текстовый формат

#### Отключение логирования
```typescript
import { Logger, LogLevel, Effect, Layer, pipe } from 'effect';

// Метод 1: Установка минимального уровня на None
const disableLoggingLayer = Logger.withMinimumLogLevel(LogLevel.None);
pipe(
  program,
  Effect.provide(Layer.merge(yourLayer, disableLoggingLayer)),
  Effect.runPromise
);

// Метод 2: Перехват и игнорирование ошибок логирования
pipe(
  program,
  Effect.tapErrorCause(() => Effect.succeed(undefined)),
  Effect.runPromise
);
```

### OneBun Logger (@onebun/logger)

Кастомный логгер для OneBun, обеспечивающий:
- Форматированные логи с различными уровнями
- Различные транспорты для вывода
- Интеграцию с Effect.js

#### Основные классы
- **Logger**: Основной класс для логирования
- **Transport**: Транспорты для отправки логов (Console, File и др.)
- **Formatter**: Форматтеры для вывода логов (Pretty, JSON)

#### Пример использования
```typescript
import { makeDevLogger, LoggerService } from '@onebun/logger';
import { Effect, pipe } from 'effect';

// Создание слоя логгера
const loggerLayer = makeDevLogger();

// Использование логгера в программе
const program = pipe(
  LoggerService,
  Effect.flatMap(logger => pipe(
    logger.info('Информационное сообщение'),
    Effect.flatMap(() => logger.error('Сообщение об ошибке', new Error('Детали'))),
    Effect.flatMap(() => Effect.succeed('Результат'))
  ))
);

// Запуск программы с логгером
pipe(
  program,
  Effect.provide(loggerLayer),
  Effect.runPromise
);
```

### Проблемы с версиями Effect.js

- **Быстрое развитие API**: Effect.js активно развивается, API может меняться между версиями
- **Различия в синтаксисе генераторов**:
  - Ранние версии: `yield* ServiceTag`
  - Новые версии: `yield ServiceTag`
- **Изменения в создании тегов контекста**:
  - Ранние версии: `Context.Tag<Interface>()`
  - Новые версии: `Context.GenericTag<Interface>("TagName")`
- **Ограничения Layer.merge**:
  ```typescript
  // Вместо Layer.merge(layer1, layer2, layer3)
  // Используйте вложенные вызовы
  Layer.merge(Layer.merge(layer1, layer2), layer3)
  ```
- **Продвинутая система типов**: Может вызывать проблемы компиляции при смешивании подходов
- **Отладка асинхронных эффектов**: Используйте `Effect.tap` и `Effect.withSpan`
- **Управление ресурсами**: Используйте `Effect.scoped` и `Scope.extend`

## TypeScript

### Документация
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Разрешение модулей](https://www.typescriptlang.org/docs/handbook/module-resolution.html)
- [Файлы деклараций](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)

### Рекомендуемые настройки для Bun.js
```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

# OneBun Framework - References

Полезные ссылки на документации различных технологий, используемых в проекте OneBun.

## Core Technologies

### Effect.js
- **Официальная документация**: https://effect.website/
- **GitHub**: https://github.com/Effect-TS/effect
- **Основные концепции**: 
  - Effect.js - библиотека для функционального программирования с поддержкой типобезопасности
  - Использует Effect.gen() для генераторного стиля (но мы используем Effect.pipe)
  - Система зависимостей через Layer и Context
  - Встроенная обработка ошибок и ресурсов

### TypeScript
- **Официальная документация**: https://www.typescriptlang.org/docs/
- **Строгая типизация**: настроена strict mode для максимальной безопасности типов
- **Декораторы**: включены экспериментальные декораторы для метаданных

### Bun.js
- **Официальная документация**: https://bun.sh/docs
- **Runtime**: используется вместо Node.js для максимальной производительности
- **Package manager**: встроенный менеджер пакетов
- **Bundler**: встроенный бандлер и компилятор

## OneBun Framework Packages

### @onebun/core
- **Назначение**: Основной пакет фреймворка с базовой функциональностью
- **Возможности**:
  - Декораторы для контроллеров и сервисов
  - Система модулей и DI
  - Базовые HTTP-роуты
  - Интеграция с Effect.js

### @onebun/logger
- **Назначение**: Система логирования с поддержкой трейсинга
- **Возможности**:
  - Structured logging с JSON форматом
  - Контекстные логи с trace ID
  - Различные уровни логирования
  - Интеграция с Effect.js

### @onebun/envs
- **Назначение**: Управление переменными окружения
- **Возможности**:
  - Типизированные environment variables
  - Валидация и парсинг значений
  - Загрузка из .env файлов
  - Интеграция с Effect.js

### @onebun/metrics
- **Назначение**: Сбор метрик в формате Prometheus
- **Возможности**:
  - HTTP request метрики (count, duration)
  - System метрики (memory, CPU, uptime)
  - Custom метрики (counters, gauges, histograms)
  - Автоматический сбор через декораторы

### @onebun/trace
- **Назначение**: Distributed tracing с OpenTelemetry совместимостью
- **Возможности**:
  - W3C Trace Context propagation
  - Автоматический HTTP tracing
  - Custom spans и события
  - Интеграция с логированием

### @onebun/requests
- **Назначение**: Унифицированный HTTP клиент для внешних вызовов
- **Возможности**:
  - Множественные схемы авторизации
  - Автоматические ретраи с backoff стратегиями
  - Интеграция с трейсингом и метриками
  - Типизированные ошибки с цепочкой контекста
  - Единый формат ответов

#### Схемы авторизации:
- **Bearer Token**: `Authorization: Bearer <token>`
- **API Key**: Header или query parameter
- **Basic Auth**: `Authorization: Basic <base64(user:pass)>`
- **OneBun Auth**: HMAC-подписи для межсервисного взаимодействия
- **Custom Auth**: Пользовательские interceptor'ы

#### Retry стратегии:
- **Fixed**: фиксированная задержка между попытками
- **Linear**: линейное увеличение задержки
- **Exponential**: экспоненциальный backoff

#### Пример использования:
```typescript
import { createHttpClient } from '@onebun/requests';

const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  auth: {
    type: 'bearer',
    token: 'your-token'
  },
  retries: {
    max: 3,
    delay: 1000,
    backoff: 'exponential'
  }
});

const response = await Effect.runPromise(client.get('/users'));
```

## Third-party Libraries

### Drizzle ORM
- **Официальная документация**: https://orm.drizzle.team/
- **GitHub**: https://github.com/drizzle-team/drizzle-orm
- **Использование**: TypeScript ORM для работы с базами данных
- **Особенности**:
  - Schema-first подход: схемы (`pgTable`/`sqliteTable`) как единая точка истины
  - Автоматический вывод типов через `$inferSelect` и `$inferInsert`
  - Миграции через drizzle-kit
  - Поддержка PostgreSQL, MySQL, SQLite

### Drizzle Kit
- **Документация**: https://orm.drizzle.team/kit-docs/overview
- **Использование**: Генерация и применение миграций
- **Особенности**:
  - Автоматическое отслеживание примененных миграций
  - Защита от двойного применения через таблицу `__drizzle_migrations`
  - Генерация миграций из схем

### ArkType
- **GitHub**: https://github.com/arktypeio/arktype
- **Документация**: https://arktype.io/
- **Использование**: Runtime валидация и типизация в @onebun/core
- **Особенности**:
  - TypeScript-first валидация с выводом типов
  - Генерация JSON Schema для OpenAPI документации
  - Интеграция с Drizzle через drizzle-arktype
  - Валидация запросов и ответов на эндпоинтах

### Drizzle ArkType
- **GitHub**: https://github.com/drizzle-team/drizzle-orm/tree/main/drizzle-arktype
- **Использование**: Генерация схем валидации из Drizzle схем в @onebun/drizzle
- **API** (экспортируется из @onebun/drizzle):
  - `createSelectSchema(table)` - схема для валидации данных из БД
  - `createInsertSchema(table)` - схема для валидации данных при вставке
  - `createUpdateSchema(table)` - схема для валидации данных при обновлении
- **Совместимость**: Полностью совместим с Drizzle схемами, используемыми в @onebun/drizzle
- **Пример использования**:
  ```typescript
  import { createInsertSchema, createSelectSchema } from '@onebun/drizzle';
  import { users } from './schema/users';
  
  const insertUserSchema = createInsertSchema(users);
  const selectUserSchema = createSelectSchema(users);
  
  @Post('/users')
  async createUser(@Body(insertUserSchema) userData: typeof insertUserSchema.infer) {
    // userData валидирован и типизирован
  }
  ```

### Prometheus Client
- **GitHub**: https://github.com/siimon/prom-client
- **Документация**: https://prometheus.io/docs/
- **Использование**: сбор и экспорт метрик в формате Prometheus

### OpenTelemetry
- **Официальная документация**: https://opentelemetry.io/docs/
- **JavaScript SDK**: https://opentelemetry.io/docs/languages/js/
- **Использование**: distributed tracing и observability

## OneBun Framework Packages

### @onebun/core
- **Валидация**: Интеграция с arktype для валидации запросов и ответов
- **Декораторы**: @Body, @Query, @Param поддерживают arktype схемы
- **Валидация ответов**: Декоратор @ApiResponse для валидации и документации ответов

### @onebun/drizzle
- **Валидация**: Экспорт функций createSelectSchema, createInsertSchema, createUpdateSchema
- **Интеграция**: Автоматическая генерация arktype схем из Drizzle таблиц

### @onebun/docs
- **OpenAPI**: Генерация OpenAPI 3.1 спецификации из метаданных контроллеров
- **Swagger UI**: Endpoint для отображения Swagger UI
- **Декораторы**: @ApiOperation, @ApiTags для метаданных API
- **Будущее**: Поддержка AsyncAPI и Pretty docs (redoc и т.д.)

## Development Guidelines

### Code Style
- Используем строгий TypeScript без any
- Предпочитаем Effect.pipe вместо Effect.gen
- Все публичные API должны быть типизированы
- Комментарии на английском языке

### Validation
- Используем arktype для валидации запросов и ответов
- Схемы Drizzle → arktype → TypeScript типы → JSON Schema для документации
- Единый источник истины: одна схема для БД, валидации и документации

### Error Handling
- Все ошибки типизированы через Effect.Effect<T, E>
- Используем chainable error context для трассировки
- Логируем ошибки с trace context

### Testing
- Unit тесты для каждого модуля
- Integration тесты для HTTP endpoints
- Performance тесты для critical paths

### Documentation
- README.md для каждого пакета
- Inline documentation с JSDoc
- Примеры использования в documentation

## Effect-TS
- [Официальная документация](https://effect.website/docs/introduction)
- [Getting Started Guide](https://effect.website/docs/getting-started)
- [Effect vs Promise](https://effect.website/docs/effect-vs-promise)
- [Error Handling](https://effect.website/docs/error-handling)

## Bun.js
- [Официальная документация](https://bun.sh/docs)
- [TypeScript Support](https://bun.sh/docs/typescript)
- [Web API](https://bun.sh/docs/api/web-api)

## TypeScript
- [Handbook](https://www.typescriptlang.org/docs/)
- [Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)

## OneBun Framework - Dual API Guidelines

### Promise API (Default)
Простой и знакомый подход для большинства случаев использования:

```typescript
// ✅ Простые CRUD операции
const users = await client.get<User[]>('/users');

// ✅ Стандартное обработка ошибок
try {
  const user = await client.post<User>('/users', userData);
  return user;
} catch (error) {
  logger.error('Failed to create user', error);
  throw error;
}
```

### Effect API (Advanced)
Для сложных композиций и функционального программирования:

```typescript
// ✅ Композиция операций
const result = pipe(
  client.getEffect<User[]>('/users'),
  Effect.flatMap(users => processUsers(users)),
  Effect.catchAll(error => handleError(error))
);

// ✅ Цепочки зависимых операций
const workflow = pipe(
  getUserEffect(id),
  Effect.flatMap(user => updateUserEffect(user)),
  Effect.flatMap(user => notifyUserEffect(user))
);
```

### Когда использовать каждый API

#### Promise API подходит для:
- Простых CRUD операций
- Команд, знакомых с async/await
- Миграции существующих кодовых баз
- Минимальной кривой обучения

#### Effect API подходит для:
- Сложных workflows с множественными зависимостями
- Продвинутого error handling и recovery стратегий
- Функционального программирования
- Композируемого и тестируемого кода
- Управления сложными async операциями

### Принципы именования

- **Promise методы**: стандартные имена (`get`, `post`, `put`, etc.)
- **Effect методы**: стандартные имена + суффикс `Effect` (`getEffect`, `postEffect`, `putEffect`, etc.)

Это обеспечивает:
- Интуитивное понимание API
- Обратную совместимость
- Легкий переход между подходами
- Автокомплит в IDE

### Migration Guide

При миграции с Effect-only API на dual API:

1. **Сохраните существующие Effect методы** с суффиксом `Effect`
2. **Добавьте Promise обёртки** как основные методы
3. **Обновите документацию** с примерами обеих подходов
4. **Обеспечьте** постепенную миграцию без breaking changes

## WebSocket

### Bun WebSocket
- [Bun WebSocket Server](https://bun.sh/docs/api/websockets)
- [WebSocket Examples](https://bun.sh/guides/websocket)
- **Особенности**: Встроенная поддержка WebSocket в Bun.serve с pub/sub

### Socket.IO Protocol
- [Engine.IO Protocol](https://socket.io/docs/v4/engine-io-protocol/) - транспортный уровень Socket.IO
- [Socket.IO Protocol](https://socket.io/docs/v4/socket-io-protocol/) - прикладной уровень
- [Socket.IO Client](https://socket.io/docs/v4/client-api/) - клиентское API

### NestJS WebSocket (Reference Architecture)
- [NestJS Gateways](https://docs.nestjs.com/websockets/gateways) - архитектурный паттерн для гейтвеев
- [NestJS Exception Filters](https://docs.nestjs.com/websockets/exception-filters) - обработка ошибок
- [NestJS Guards](https://docs.nestjs.com/websockets/guards) - авторизация для WebSocket

### @onebun/core WebSocket Features

#### Gateway Pattern
```typescript
import { 
  WebSocketGateway, 
  BaseWebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnMessage,
  Client,
  MessageData,
} from '@onebun/core';

@WebSocketGateway({ path: '/ws' })
export class ChatGateway extends BaseWebSocketGateway {
  @OnConnect()
  handleConnect(@Client() client: WsClientData) {
    return { event: 'welcome', data: { clientId: client.id } };
  }

  @OnMessage('chat:message')
  handleMessage(
    @Client() client: WsClientData,
    @MessageData() data: { text: string }
  ) {
    this.broadcast('chat:message', {
      userId: client.id,
      text: data.text,
    });
  }
}
```

#### Pattern Matching
- Wildcard patterns: `chat:*`, `user:*:action`
- Parameterized patterns: `chat:{roomId}:message`
- Combined patterns: `service:{service}:*`

#### Storage Options
- **In-Memory**: Default для single-instance deployments
- **Redis**: Для multi-instance deployments с pub/sub

#### Guards
```typescript
import { UseWsGuards, WsAuthGuard, WsPermissionGuard } from '@onebun/core';

@UseWsGuards(WsAuthGuard)
@OnMessage('admin:*')
handleAdminMessage(@Client() client: WsClientData) {
  // Only authenticated clients
}
```

#### Typed Client
```typescript
import { createWsServiceDefinition, createWsClient } from '@onebun/core';

const definition = createWsServiceDefinition(ChatModule);
const client = createWsClient(definition, {
  url: 'ws://localhost:3000',
  auth: { token: 'xxx' },
});

await client.connect();
await client.ChatGateway.emit('chat:message', { text: 'Hello' });
```