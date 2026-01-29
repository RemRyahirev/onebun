# Logger API

Package: `@onebun/logger`

## Overview

OneBun provides a structured logging system with:
- Multiple log levels
- JSON or pretty console output
- Trace context integration
- Child loggers with context inheritance

## SyncLogger Interface

```typescript
interface SyncLogger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
  child(context: Record<string, unknown>): SyncLogger;
}
```

## Log Levels

| Level | Value | Use Case |
|-------|-------|----------|
| `trace` | 0 | Very detailed debugging |
| `debug` | 1 | Debug information |
| `info` | 2 | General information |
| `warn` | 3 | Warnings |
| `error` | 4 | Errors |
| `fatal` | 5 | Fatal errors |

## Usage in Controllers/Services

```typescript
@Controller('/users')
export class UserController extends BaseController {
  @Get('/')
  async findAll(): Promise<Response> {
    // Logger is automatically available
    this.logger.info('Finding all users');
    this.logger.debug('Request received', { timestamp: Date.now() });

    try {
      const users = await this.userService.findAll();
      this.logger.info('Users found', { count: users.length });
      return this.success(users);
    } catch (error) {
      this.logger.error('Failed to find users', error);
      return this.error('Internal error', 500);
    }
  }
}
```

## Logging with Context

### Object Context

```typescript
this.logger.info('User action', {
  userId: user.id,
  action: 'login',
  ip: request.ip,
  userAgent: request.headers['user-agent'],
});

// Output (JSON):
// {"level":"info","message":"User action","userId":"123","action":"login","ip":"192.168.1.1",...}
```

### Error Logging

```typescript
try {
  await this.riskyOperation();
} catch (error) {
  // Error objects are specially handled
  this.logger.error('Operation failed', error);

  // With additional context
  this.logger.error('Operation failed', error, {
    operationId: '123',
    userId: user.id,
  });
}

// Output includes error name, message, and stack
```

### Multiple Arguments

```typescript
// Mix of arguments
this.logger.debug(
  'Processing request',
  requestData,              // Object merged into context
  { step: 1 },              // Another object merged
  'additional info',        // String goes to additionalData
  42,                       // Number goes to additionalData
);
```

## Child Loggers

Create child loggers with inherited context:

```typescript
@Service()
export class OrderService extends BaseService {
  async processOrder(orderId: string): Promise<void> {
    // Create child logger with order context
    const orderLogger = this.logger.child({
      orderId,
      operation: 'processOrder',
    });

    orderLogger.info('Starting order processing');
    // Logs: {"orderId":"123","operation":"processOrder","message":"Starting order processing",...}

    await this.validateOrder(orderId, orderLogger);
    await this.processPayment(orderId, orderLogger);

    orderLogger.info('Order processing completed');
  }

  private async validateOrder(orderId: string, logger: SyncLogger): Promise<void> {
    logger.debug('Validating order');
    // Context (orderId, operation) is inherited
  }
}
```

## Logger Configuration

### Development vs Production

Logger format is automatically selected based on `NODE_ENV`:

```typescript
// NODE_ENV !== 'production' → Pretty console output
// NODE_ENV === 'production' → JSON output

// Manual override
import { makeDevLogger, makeProdLogger } from '@onebun/logger';

const app = new OneBunApplication(AppModule, {
  loggerLayer: makeDevLogger({
    minLevel: LogLevel.Debug,
  }),
});
```

### Log Levels

```typescript
import { LogLevel } from '@onebun/logger';

const app = new OneBunApplication(AppModule, {
  loggerLayer: makeLogger({
    minLevel: LogLevel.Info,  // Ignore trace and debug
  }),
});
```

### Custom Context

```typescript
import { makeLogger } from '@onebun/logger';

const app = new OneBunApplication(AppModule, {
  loggerLayer: makeLogger({
    defaultContext: {
      serviceName: 'user-service',
      version: '1.0.0',
      environment: process.env.NODE_ENV,
    },
  }),
});

// All logs will include serviceName, version, environment
```

## Getting Logger from Application

```typescript
const app = new OneBunApplication(AppModule, { envSchema });
await app.start();

// Get root logger
const logger = app.getLogger();
logger.info('Application started');

// Get logger with context
const bootstrapLogger = app.getLogger({ className: 'Bootstrap' });
bootstrapLogger.info('Bootstrapping complete');
```

## Output Formats

### Pretty Format (Development)

```
[2024-01-15T10:30:45.123Z] INFO  [UserController] User created
  userId: "abc-123"
  email: "user@example.com"
```

### JSON Format (Production)

```json
{
  "level": "info",
  "message": "User created",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "context": {
    "className": "UserController",
    "userId": "abc-123",
    "email": "user@example.com"
  }
}
```

## Trace Context Integration

When tracing is enabled, logs automatically include trace context:

```json
{
  "level": "info",
  "message": "Processing request",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "trace": {
    "traceId": "abc123def456",
    "spanId": "span123",
    "parentSpanId": "parent456"
  }
}
```

## Effect.js Logger (Advanced)

For Effect.js integration, use async Logger interface:

```typescript
import { LoggerService, Logger } from '@onebun/logger';
import { Effect, pipe } from 'effect';

// Get logger in Effect context
const program = pipe(
  LoggerService,
  Effect.flatMap((logger: Logger) =>
    logger.info('Message from Effect')
  ),
);

// Run with logger layer
Effect.runPromise(
  Effect.provide(program, makeLogger())
);
```

## Testing

### Mock Logger

```typescript
import { makeMockLoggerLayer } from '@onebun/core';

describe('UserService', () => {
  it('should log user creation', async () => {
    const logs: Array<{ level: string; message: string }> = [];

    const mockLogger = makeMockLoggerLayer((entry) => {
      logs.push({ level: entry.level, message: entry.message });
    });

    // Use mock logger in tests
    const app = new OneBunApplication(AppModule, {
      loggerLayer: mockLogger,
    });

    // ... test code ...

    expect(logs).toContainEqual({
      level: 'info',
      message: expect.stringContaining('User created'),
    });
  });
});
```

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// trace: Very detailed, usually disabled
this.logger.trace('Entering function', { args });

// debug: Useful for debugging
this.logger.debug('Cache lookup', { key, hit: !!value });

// info: Normal operations
this.logger.info('User logged in', { userId });

// warn: Potential issues
this.logger.warn('Rate limit approaching', { current, limit });

// error: Errors that need attention
this.logger.error('Database connection failed', error);

// fatal: Critical errors
this.logger.fatal('Application cannot start', error);
```

### 2. Include Relevant Context

```typescript
// Good: Includes useful context
this.logger.info('Order placed', {
  orderId: order.id,
  customerId: order.customerId,
  total: order.total,
  itemCount: order.items.length,
});

// Bad: Missing context
this.logger.info('Order placed');
```

### 3. Use Child Loggers for Operations

```typescript
async processRequest(requestId: string, userId: string) {
  const logger = this.logger.child({ requestId, userId });

  logger.info('Request started');
  // All subsequent logs include requestId and userId

  try {
    await this.step1(logger);
    await this.step2(logger);
    logger.info('Request completed');
  } catch (error) {
    logger.error('Request failed', error);
    throw error;
  }
}
```

### 4. Don't Log Sensitive Data

```typescript
// Bad: Logs password
this.logger.info('User login', { email, password });

// Good: Omit sensitive fields
this.logger.info('User login', { email });

// Or mask them
this.logger.info('User login', { email, password: '***' });
```

### 5. Log at Entry/Exit Points

```typescript
async processOrder(orderId: string): Promise<Order> {
  this.logger.info('Processing order started', { orderId });

  try {
    const result = await this.doProcess(orderId);
    this.logger.info('Processing order completed', {
      orderId,
      duration: Date.now() - startTime,
    });
    return result;
  } catch (error) {
    this.logger.error('Processing order failed', {
      orderId,
      error,
    });
    throw error;
  }
}
```

## Complete Example

```typescript
import { Service, BaseService, Span } from '@onebun/core';

@Service()
export class PaymentService extends BaseService {
  @Span('process-payment')
  async processPayment(orderId: string, amount: number): Promise<PaymentResult> {
    const logger = this.logger.child({
      orderId,
      amount,
      operation: 'processPayment',
    });

    logger.info('Payment processing started');

    try {
      // Validate
      logger.debug('Validating payment');
      await this.validatePayment(amount);

      // Process
      logger.debug('Charging payment gateway');
      const result = await this.gateway.charge({
        orderId,
        amount,
        currency: 'USD',
      });

      if (result.success) {
        logger.info('Payment successful', {
          transactionId: result.transactionId,
        });
      } else {
        logger.warn('Payment declined', {
          reason: result.declineReason,
        });
      }

      return result;
    } catch (error) {
      logger.error('Payment processing failed', error);
      throw error;
    }
  }

  private async validatePayment(amount: number): Promise<void> {
    if (amount <= 0) {
      this.logger.warn('Invalid payment amount', { amount });
      throw new Error('Amount must be positive');
    }

    if (amount > 10000) {
      this.logger.warn('Large payment amount, additional verification required', { amount });
    }
  }
}
```
