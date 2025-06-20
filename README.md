1# OneBun Framework

OneBun - это фреймворк для разработки приложений на Bun.js, вдохновленный Nest.js и использующий Effect.ts для управления побочными эффектами.

## Недавние улучшения

### Интеграция логгера с Effect

Мы улучшили интеграцию логгера с библиотекой Effect, добавив следующие возможности:

1. Использование встроенного в Effect логгера с нашим форматтером и транспортом
2. Поддержка аннотаций контекста для логов
3. Правильное обработка ошибок через Cause

```typescript
// Пример использования логгера
const program = pipe(
  LoggerService,
  Effect.flatMap(logger => pipe(
    logger.info('Getting counter value', { requestId: '123' }),
    Effect.flatMap(() => CounterService),
    Effect.map(counterService => counterService.getCount())
  ))
);
```

### Работающий пример приложения

Мы создали рабочий пример приложения, демонстрирующий использование:

1. **Логгера** с контекстом и трейсингом
2. **Сервисов** с инъекцией зависимостей через Effect
3. **HTTP маршрутизации** с декораторами
4. **@onebun/requests** для внешних API вызовов с:
   - Автоматическими ретраями
   - Различными схемами аутентификации
   - Структурированной обработкой ошибок
   - Трейсингом запросов
5. **Метрики** и **трейсинг** в действии

Пример можно запустить командой `bun run dev:once` из корневой директории проекта.

Доступные эндпоинты:
- `GET /api/users` - получить пользователей через @onebun/requests
- `GET /api/users/:id` - получить пользователя по ID
- `GET /api/users/:id/posts` - получить посты пользователя
- `POST /api/posts` - создать новый пост
- `GET /api/demo/error-chain` - демонстрация цепочки ошибок
- `GET /api/demo/auth-methods` - демонстрация методов аутентификации

## Известные проблемы и планы по их решению

1. Декораторы для маршрутов не работают должным образом - метаданные не сохраняются или не считываются правильно.
2. Инъекция зависимостей через модули и контроллеры требует доработки.

## Дальнейшие шаги

1. Исправить работу декораторов для более декларативной маршрутизации
2. Улучшить систему модулей и инъекцию зависимостей
3. Добавить дополнительные транспорты для логгера (файловый, сетевой)

## Особенности

- **Модульная архитектура**: организация кода в модули с контроллерами и сервисами
- **Декларативные маршруты**: использование декораторов (@Controller, @Get, @Post и т.д.)
- **Типобезопасный DI**: использование Effect.Context и Layer для управления зависимостями
- **Встроенное логирование**: расширенное логирование на основе Effect.Logger
- **Унифицированные HTTP запросы**: @onebun/requests с ретраями, аутентификацией и трейсингом
- **Метрики и трейсинг**: автоматический сбор метрик и OpenTelemetry-совместимый трейсинг
- **Управление переменными окружения**: типизированная конфигурация с валидацией
- **Высокая производительность**: использование bun.js для максимальной скорости

## Установка

```bash
# Установка bun (если еще не установлен)
curl -fsSL https://bun.sh/install | bash

# Создание нового проекта
mkdir my-onebun-app
cd my-onebun-app
bun init

# Установка зависимостей
bun add @onebun/core @onebun/logger effect
```

## Пример использования

```typescript
import { Effect, Layer } from 'effect';
import { OneBunApplication, Controller, Get, Module } from '@onebun/core';
import { makeDevLogger, LoggerService } from '@onebun/logger';

// Service с использованием Effect Context
class CounterService extends Effect.Tag('CounterService')<CounterService>() {
  private count = 0;

  increment(): number {
    return ++this.count;
  }

  getCount(): number {
    return this.count;
  }
}

// Контроллер
@Controller('api')
class AppController {
  @Get('counter')
  async getCounter(req: Request): Promise<Response> {
    const program = Effect.gen(function* ($) {
      const counterService = yield* CounterService;
      const logger = yield* LoggerService;
      
      yield* logger.info('Getting counter value');
      
      return counterService.getCount();
    });
    
    const count = await Effect.runPromise(program);
    
    return new Response(JSON.stringify({ count }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Модуль приложения
@Module({
  controllers: [AppController],
  providers: [CounterService]
})
class AppModule {}

// Создание и запуск приложения
const startApp = async () => {
  const app = new OneBunApplication(AppModule);
  
  const rootLayer = Layer.merge(
    app.getLayer(),
    makeDevLogger(),
    Layer.succeed(CounterService, new CounterService())
  );
  
  await Effect.runPromise(
    app.start().pipe(Effect.provide(rootLayer))
  );
};

startApp().catch(console.error);
```

## Структура проекта

```
|- packages/
|  |- core/            # Основной пакет фреймворка
|  |- logger/          # Модуль логирования
|- example/            # Пример приложения
```

## Лицензия

MIT 
