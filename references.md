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