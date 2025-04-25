import { Effect, Layer, Context, pipe } from 'effect';
import { makeDevLogger, LoggerService } from '@onebun/logger';

// Определение интерфейса сервиса
interface CounterServiceInterface {
  increment(): number;
  getCount(): number;
}

// Тег контекста для сервиса
const CounterService = Context.GenericTag<CounterServiceInterface>("CounterService");

// Имплементация сервиса
class CounterServiceImpl implements CounterServiceInterface {
  private count = 0;

  increment(): number {
    return ++this.count;
  }

  getCount(): number {
    return this.count;
  }
}

// Создаем слой для сервиса
const counterServiceLayer = Layer.succeed(
  CounterService,
  new CounterServiceImpl()
);

// Создаем слой для логгера
const loggerLayer = makeDevLogger();

// Обработчики запросов
const handleHello = (): Response => {
  return new Response(JSON.stringify({ message: 'Hello OneBun!' }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

const handleCounter = async (): Promise<Response> => {
  // Создаем и запускаем программу с эффектом логгирования
  const program = pipe(
    LoggerService,
    Effect.flatMap(logger => pipe(
      logger.info('Getting counter value'),
      Effect.flatMap(() => CounterService),
      Effect.map(counterService => counterService.getCount())
    ))
  );
  
  // Запускаем с объединенным слоем
  const count = await pipe(
    program,
    Effect.provide(Layer.merge(loggerLayer, counterServiceLayer)),
    // Отключаем стандартный вывод логов в Effect
    Effect.tapErrorCause(() => Effect.succeed(undefined)),
    Effect.runPromise
  );
  
  return new Response(JSON.stringify({ count }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

const handleCounterIncrement = async (): Promise<Response> => {
  // Создаем и запускаем программу с эффектом логгирования
  const program = pipe(
    LoggerService,
    Effect.flatMap(logger => pipe(
      logger.info('Incrementing counter'),
      Effect.flatMap(() => CounterService),
      Effect.map(counterService => counterService.increment())
    ))
  );
  
  // Запускаем с объединенным слоем
  const count = await pipe(
    program,
    Effect.provide(Layer.merge(loggerLayer, counterServiceLayer)),
    // Отключаем стандартный вывод логов в Effect
    Effect.tapErrorCause(() => Effect.succeed(undefined)),
    Effect.runPromise
  );
  
  return new Response(JSON.stringify({ count }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

// Простой роутер
interface RouteHandler {
  method: string;
  handler: (req: Request) => Response | Promise<Response>;
}

const routes = new Map<string, RouteHandler>([
  ['/api/hello', { method: 'GET', handler: () => handleHello() }],
  ['/api/counter', { method: 'GET', handler: () => handleCounter() }],
  ['/api/counter/increment', { method: 'POST', handler: () => handleCounterIncrement() }],
]);

// Запускаем HTTP сервер
const server = Bun.serve({
  port: 3000,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    
    console.log(`Request: ${method} ${path}`);
    console.log('Available routes:', Array.from(routes.keys()));
    
    const route = routes.get(path);
    if (route && (route.method === method || route.method === 'ALL')) {
      try {
        return await route.handler(req);
      } catch (error) {
        console.error('Error handling request:', error);
        return new Response(
          JSON.stringify({ error: (error as Error).message }), 
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    
    return new Response('Not Found', { status: 404 });
  }
});

console.log(`Server is running at http://localhost:${server.port}`); 