# @onebun/logger

Structured logging package for OneBun framework with Effect.js integration.

## Features

- 📝 **Structured Logging** - JSON and pretty-print output formats
- 🎨 **Pretty Console Output** - Colorized logs for development
- 📊 **JSON Format** - Line-delimited JSON for production
- 🔍 **Trace Integration** - Automatic trace ID inclusion in logs
- 👶 **Child Loggers** - Create loggers with inherited context
- ⚡ **Effect.js Integration** - Full Effect.js ecosystem support
- 🔄 **Dual API** - Both Effect and synchronous interfaces
- 🏷️ **Log Levels** - trace, debug, info, warn, error, fatal

## Installation

```bash
bun add @onebun/logger
```

## Quick Start

### Basic Usage

```typescript
import { createSyncLogger, makeLogger, LoggerService } from '@onebun/logger';
import { Effect, Layer } from 'effect';

// Create a logger based on NODE_ENV
const loggerLayer = makeLogger();

// Use with Effect
const program = Effect.gen(function* () {
  const logger = yield* LoggerService;
  yield* logger.info('Application started');
  yield* logger.debug('Debug information', { userId: 123 });
});

await Effect.runPromise(Effect.provide(program, loggerLayer));
```

### Synchronous API

```typescript
import { createSyncLogger, makeDevLogger, LoggerService } from '@onebun/logger';
import { Effect, Layer } from 'effect';

// Get logger instance
const loggerLayer = makeDevLogger();
const logger = Effect.runSync(
  Effect.provide(LoggerService, loggerLayer)
);

// Create sync wrapper
const syncLogger = createSyncLogger(logger);

// Use directly
syncLogger.info('Hello, World!');
syncLogger.error('Something went wrong', new Error('Oops'));
syncLogger.debug('Debug data', { userId: 123, action: 'login' });
```

## Log Levels

| Level | Value | Description |
|-------|-------|-------------|
| `trace` | 0 | Detailed tracing information |
| `debug` | 1 | Debug information for development |
| `info` | 2 | General informational messages |
| `warn` | 3 | Warning messages |
| `error` | 4 | Error messages |
| `fatal` | 5 | Critical errors that may crash the app |

## Output Formats

### Pretty Format (Development)

```
2024-01-15T10:30:00.000Z [INFO   ] Application started
2024-01-15T10:30:00.001Z [DEBUG  ] User logged in {"userId":123}
2024-01-15T10:30:00.002Z [ERROR  ] Request failed {"error":"Connection timeout"}
```

With trace context:
```
2024-01-15T10:30:00.000Z [INFO   ] [trace:34da6a3c span:902b7f00] Processing request
```

### JSON Format (Production)

```json
{"timestamp":"2024-01-15T10:30:00.000Z","level":"info","message":"Application started"}
{"timestamp":"2024-01-15T10:30:00.001Z","level":"debug","message":"User logged in","context":{"userId":123}}
{"timestamp":"2024-01-15T10:30:00.002Z","level":"error","message":"Request failed","error":{"name":"Error","message":"Connection timeout","stack":"..."}}
```

## Child Loggers

Create loggers with additional context:

```typescript
const logger = createSyncLogger(baseLogger);

// Create child logger with context
const requestLogger = logger.child({ 
  requestId: 'abc-123',
  userId: 456 
});

// All logs include the context
requestLogger.info('Processing request');
// Output: {"...", "context": {"requestId": "abc-123", "userId": 456}}

// Create nested child
const dbLogger = requestLogger.child({ component: 'database' });
dbLogger.debug('Query executed');
// Output: {"...", "context": {"requestId": "abc-123", "userId": 456, "component": "database"}}
```

## Configuration

```typescript
import { makeDevLogger, makeProdLogger, LogLevel } from '@onebun/logger';
import { PrettyFormatter, JsonFormatter } from '@onebun/logger';
import { ConsoleTransport } from '@onebun/logger';

// Development logger with custom config
const devLogger = makeDevLogger({
  minLevel: LogLevel.Debug,
  defaultContext: {
    service: 'my-service',
    version: '1.0.0'
  }
});

// Production logger
const prodLogger = makeProdLogger({
  minLevel: LogLevel.Info,
  defaultContext: {
    service: 'my-service',
    environment: 'production'
  }
});

// Auto-select based on NODE_ENV
const logger = makeLogger(); // dev if NODE_ENV !== 'production'
```

## Logging with Context

```typescript
// Log with inline context
logger.info('User action', { userId: 123, action: 'login' });

// Log with error
logger.error('Request failed', new Error('Network error'));

// Log with error and context
logger.error('Database error', new Error('Connection lost'), { 
  database: 'users',
  query: 'SELECT * FROM users' 
});

// Multiple arguments
logger.debug('Processing', { step: 1 }, { items: 10 }, 'extra data');
```

## Trace Integration

The logger automatically includes trace information when used with `@onebun/trace`:

```typescript
import { TraceService } from '@onebun/trace';

// Trace context is automatically included in logs
@Get('/users/:id')
@Trace('get-user')
async getUser(@Param('id') id: string) {
  this.logger.info('Fetching user', { userId: id });
  // Log automatically includes traceId and spanId
  return this.userService.findById(id);
}
```

## Effect.js Integration

```typescript
import { Effect, pipe } from 'effect';
import { LoggerService } from '@onebun/logger';

const program = pipe(
  LoggerService,
  Effect.flatMap((logger) =>
    pipe(
      logger.info('Starting operation'),
      Effect.flatMap(() => performOperation()),
      Effect.tap(() => logger.info('Operation completed')),
      Effect.catchAll((error) =>
        pipe(
          logger.error('Operation failed', error),
          Effect.flatMap(() => Effect.fail(error))
        )
      )
    )
  )
);
```

## Best Practices

1. **Use appropriate log levels** - Don't log everything at info level
2. **Include context** - Add relevant data for debugging
3. **Use child loggers** - Maintain context across related operations
4. **Protect sensitive data** - Don't log passwords or tokens
5. **Use JSON in production** - Easier to parse and analyze
6. **Enable trace integration** - Correlate logs across services

## License

[LGPL-3.0](../../LICENSE)
