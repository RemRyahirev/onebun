---
description: "Message queues with @Subscribe, @Cron, @Interval decorators. In-memory, Redis, NATS, JetStream backends. Message guards."
---

# Queue API

## Overview

OneBun provides a unified queue system for message-based communication. It supports multiple backends (in-memory, Redis, NATS, JetStream) with a consistent API. The queue system includes:

- Message publishing and subscribing with pattern matching
- Scheduled jobs (cron, interval, timeout)
- Message guards for authorization
- Auto and manual acknowledgment modes

## Setup

The queue system **auto-enables** when any controller in your application uses queue decorators (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`). No explicit configuration is required for basic usage with the in-memory adapter.

### Application Configuration

Configure the queue backend via the `queue` option in `OneBunApplication`:

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

// Default: in-memory adapter, auto-detected
const app = new OneBunApplication(AppModule, {
  port: 3000,
});

// Explicit: Redis adapter
const app = new OneBunApplication(AppModule, {
  port: 3000,
  queue: {
    adapter: 'redis',
    redis: {
      useSharedProvider: true,   // Use shared Redis connection (recommended)
      prefix: 'myapp:queue:',   // Key prefix for Redis keys
    },
  },
});

// Explicit: Redis with dedicated connection
const app = new OneBunApplication(AppModule, {
  port: 3000,
  queue: {
    adapter: 'redis',
    redis: {
      useSharedProvider: false,
      url: 'redis://localhost:6379',
      prefix: 'myapp:queue:',
    },
  },
});
```

For NATS/JetStream, pass a custom adapter instance (see [Queue Adapters](#queue-adapters) below).

### QueueApplicationOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | auto | Enable queue system (auto-enabled if handlers detected) |
| `adapter` | `'memory' \| 'redis'` | `'memory'` | Queue adapter type |
| `redis.useSharedProvider` | `boolean` | `true` | Use shared Redis connection pool |
| `redis.url` | `string` | - | Redis URL (required if `useSharedProvider: false`) |
| `redis.prefix` | `string` | `'onebun:queue:'` | Key prefix for Redis keys |

### Registering Controllers with Queue Decorators

Classes that use `@Subscribe`, `@Cron`, `@Interval`, or `@Timeout` must be registered in a module's `controllers` array. The framework automatically discovers and registers queue handlers from all controllers during startup via `initializeQueue()`.

```typescript
import { Module, Controller, BaseController } from '@onebun/core';
import { Subscribe, Cron, CronExpression, Message } from '@onebun/core';

// Controller with queue decorators
@Controller('/orders')
class OrderProcessor extends BaseController {
  @Subscribe('orders.created')
  async handleOrderCreated(message: Message<{ orderId: string }>) {
    this.logger.info('Processing order', { orderId: message.data.orderId });
    // Process the order...
  }

  @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.expired' })
  getCleanupData() {
    return { timestamp: Date.now() };
  }
}

// Register in module's controllers array
@Module({
  controllers: [OrderProcessor],
})
class OrderModule {}
```

::: warning
Queue handlers are only discovered in classes registered in the `controllers` array of a `@Module`. Classes in `providers` will **not** be scanned for queue decorators.
:::

<llm-only>

**Technical details for AI agents:**
- Queue auto-enables by checking all **controllers** (not providers) for `hasQueueDecorators()` which inspects `@Subscribe`, `@Cron`, `@Interval`, `@Timeout` metadata
- `initializeQueue(controllers)` is called during `app.start()` after `ensureModule().setup()` — it receives `getControllers()` result
- The adapter is created, connected, then `QueueService` is initialized and handlers are registered via `registerService(instance, class)` for each controller with queue decorators
- `registerService()` processes: subscribe handlers → cron jobs → interval jobs → timeout jobs → lifecycle handlers
- Message guards (`@UseMessageGuards`) are applied as wrappers around the actual handler
- The scheduler (`QueueScheduler`) manages cron/interval/timeout jobs with configurable overlap strategies: `SKIP`, `QUEUE`, `REPLACE`
- Queue shutdown sequence: `queueService.stop()` → `queueAdapter.disconnect()`

**QueueApplicationOptions interface:**
```typescript
interface QueueApplicationOptions {
  enabled?: boolean;
  adapter?: 'memory' | 'redis';
  redis?: {
    useSharedProvider?: boolean;
    url?: string;
    prefix?: string;
  };
}
```

</llm-only>

### Error Handling in Handlers

```typescript
@Controller('/orders')
class OrderProcessor extends BaseController {
  @Subscribe('orders.created', {
    ackMode: 'manual',
    retry: { attempts: 3, backoff: 'exponential', delay: 1000 },
  })
  async handleOrder(message: Message<{ orderId: string }>) {
    try {
      await this.processOrder(message.data);
      await message.ack();  // Acknowledge success
    } catch (error) {
      this.logger.error('Order processing failed', error);

      if (message.attempt && message.attempt >= (message.maxAttempts || 3)) {
        this.logger.error('Max retries reached, moving to DLQ', {
          orderId: message.data.orderId,
        });
        await message.ack();  // Remove from queue
      } else {
        await message.nack(true);  // Requeue for retry
      }
    }
  }
}
```

## Quick Start

```typescript
import {
  Module,
  Service,
  BaseService,
  OneBunApplication,
  Subscribe,
  Cron,
  Interval,
  Message,
  CronExpression,
  OnQueueReady,
  QueueService,
} from '@onebun/core';

// Service with queue handlers
@Service()
class EventProcessor extends BaseService {
  constructor(private queueService: QueueService) {
    super();
  }

  @OnQueueReady()
  onReady() {
    this.logger.info('Queue connected and ready');
  }

  // Subscribe to messages
  @Subscribe('orders.created')
  async handleOrderCreated(message: Message<{ orderId: number }>) {
    this.logger.info('New order:', { orderId: message.data.orderId });
  }

  // Scheduled job: every hour
  @Cron(CronExpression.EVERY_HOUR, { pattern: 'cleanup.expired' })
  getCleanupData() {
    return { timestamp: Date.now() };
  }

  // Interval job: every 30 seconds
  @Interval(30000, { pattern: 'metrics.collect' })
  getMetricsData() {
    return { cpu: process.cpuUsage() };
  }

  // Publish messages programmatically
  async createOrder(data: { userId: string }) {
    await this.queueService.publish('orders.created', {
      orderId: Date.now(),
      userId: data.userId,
    });
  }
}

// Module
@Module({
  providers: [EventProcessor],
})
class AppModule {}

// Application
const app = new OneBunApplication(AppModule, { port: 3000 });
await app.start();
```

## Subscribe Decorator

The `@Subscribe` decorator marks a method as a message handler.

```typescript
@Subscribe('orders.*')
async handleOrder(message: Message<OrderData>) {
  console.log('Order:', message.pattern, message.data);
}
```

### Pattern Syntax

| Pattern | Example Match | Description |
|---------|--------------|-------------|
| `orders.created` | `orders.created` | Exact match |
| `orders.*` | `orders.created`, `orders.updated` | Single-level wildcard |
| `events.#` | `events.user.created`, `events.order.paid` | Multi-level wildcard |
| `orders.{id}` | `orders.123` → `{ id: '123' }` | Named parameter |

### Subscribe Options

```typescript
@Subscribe('orders.*', {
  ackMode: 'manual',        // 'auto' (default) or 'manual'
  group: 'order-processors', // Consumer group for load balancing
  prefetch: 10,             // Messages to process in parallel
  retry: {
    attempts: 3,
    backoff: 'exponential',
    delay: 1000,
  },
})
async handleOrder(message: Message<OrderData>) {
  try {
    await this.processOrder(message.data);
    await message.ack();
  } catch (error) {
    await message.nack(true); // requeue
  }
}
```

## Message Interface

```typescript
interface Message<T> {
  id: string;              // Unique message ID
  pattern: string;         // Message pattern/topic
  data: T;                 // Message payload
  timestamp: number;       // Unix timestamp in ms
  metadata: MessageMetadata;
  redelivered?: boolean;   // True if redelivered
  attempt?: number;        // Current attempt number
  maxAttempts?: number;    // Max attempts allowed
  
  ack(): Promise<void>;    // Acknowledge (manual mode)
  nack(requeue?: boolean): Promise<void>; // Negative ack
}

interface MessageMetadata {
  headers?: Record<string, string>;
  authorization?: string;  // Bearer token
  serviceId?: string;      // Calling service ID
  traceId?: string;        // Distributed tracing
  spanId?: string;
  parentSpanId?: string;
}
```

## Scheduling Decorators

### @Cron

Executes on a cron schedule. The decorated method returns data to publish.

```typescript
import { Cron, CronExpression } from '@onebun/core';

// Daily at 9 AM
@Cron('0 0 9 * * *', { pattern: 'reports.daily' })
getDailyReportData() {
  return { type: 'daily', date: new Date() };
}

// Using CronExpression enum
@Cron(CronExpression.EVERY_HOUR, { pattern: 'health.check' })
getHealthData() {
  return { status: 'ok' };
}
```

#### CronExpression Constants

| Constant | Expression | Description |
|----------|------------|-------------|
| `EVERY_SECOND` | `* * * * * *` | Every second |
| `EVERY_5_SECONDS` | `*/5 * * * * *` | Every 5 seconds |
| `EVERY_MINUTE` | `0 * * * * *` | Every minute |
| `EVERY_5_MINUTES` | `0 */5 * * * *` | Every 5 minutes |
| `EVERY_HOUR` | `0 0 * * * *` | Every hour |
| `EVERY_DAY_AT_MIDNIGHT` | `0 0 0 * * *` | Daily at midnight |
| `EVERY_DAY_AT_NOON` | `0 0 12 * * *` | Daily at noon |
| `EVERY_WEEKDAY` | `0 0 0 * * 1-5` | Mon-Fri at midnight |
| `EVERY_WEEK` | `0 0 0 * * 0` | Sunday at midnight |
| `EVERY_MONTH` | `0 0 0 1 * *` | 1st of month |

### @Interval

Executes at fixed intervals.

```typescript
// Every 60 seconds
@Interval(60000, { pattern: 'metrics.collect' })
getMetrics() {
  return { cpu: process.cpuUsage() };
}
```

### @Timeout

Executes once after a delay.

```typescript
// After 5 seconds
@Timeout(5000, { pattern: 'init.complete' })
getInitData() {
  return { startedAt: this.startTime };
}
```

## Message Guards

Guards control access to message handlers, similar to WebSocket guards.

### Built-in Guards

```typescript
import { 
  UseMessageGuards,
  MessageAuthGuard,
  MessageServiceGuard,
  MessageHeaderGuard,
  MessageTraceGuard,
} from '@onebun/core';

// Require authorization token
@UseMessageGuards(MessageAuthGuard)
@Subscribe('secure.events')
async handleSecure(message: Message) {}

// Require specific service
@UseMessageGuards(new MessageServiceGuard(['payment-service']))
@Subscribe('internal.events')
async handleInternal(message: Message) {}

// Require header
@UseMessageGuards(new MessageHeaderGuard('x-api-key'))
@Subscribe('api.events')
async handleApi(message: Message) {}

// Require trace context
@UseMessageGuards(MessageTraceGuard)
@Subscribe('traced.events')
async handleTraced(message: Message) {}
```

### Composite Guards

```typescript
import { MessageAllGuards, MessageAnyGuard } from '@onebun/core';

// All guards must pass
@UseMessageGuards(new MessageAllGuards([
  MessageAuthGuard,
  new MessageServiceGuard(['allowed-service']),
]))
@Subscribe('strict.events')
async handleStrict(message: Message) {}

// Any guard can pass
@UseMessageGuards(new MessageAnyGuard([
  new MessageServiceGuard(['internal-service']),
  MessageAuthGuard,
]))
@Subscribe('flexible.events')
async handleFlexible(message: Message) {}
```

### Custom Guards

```typescript
import { createMessageGuard } from '@onebun/core';

const customGuard = createMessageGuard((context) => {
  const metadata = context.getMetadata();
  return metadata.headers?.['x-custom'] === 'expected';
});

@UseMessageGuards(customGuard)
@Subscribe('custom.events')
async handleCustom(message: Message) {}
```

## Lifecycle Decorators

```typescript
import {
  OnQueueReady,
  OnQueueError,
  OnMessageReceived,
  OnMessageProcessed,
  OnMessageFailed,
} from '@onebun/core';

class EventService {
  @OnQueueReady()
  handleReady() {
    console.log('Queue connected');
  }

  @OnQueueError()
  handleError(error: Error) {
    console.error('Queue error:', error);
  }

  @OnMessageReceived()
  handleReceived(message: Message) {
    console.log(`Received: ${message.id}`);
  }

  @OnMessageProcessed()
  handleProcessed(message: Message) {
    console.log(`Processed: ${message.id}`);
  }

  @OnMessageFailed()
  handleFailed(message: Message, error: Error) {
    console.error(`Failed: ${message.id}`, error);
  }
}
```

## Queue Adapters

### InMemoryQueueAdapter

In-process message bus. Good for development and testing.

```typescript
import { InMemoryQueueAdapter } from '@onebun/core';

const adapter = new InMemoryQueueAdapter();
await adapter.connect();

await adapter.subscribe('events.*', async (message) => {
  console.log('Received:', message.data);
});

await adapter.publish('events.created', { id: 1 });
```

**Supported Features:**
- Pattern subscriptions
- Delayed messages
- Priority
- Scheduled jobs

### RedisQueueAdapter

Distributed queue using Redis. Uses SharedRedisProvider by default.

```typescript
import { RedisQueueAdapter } from '@onebun/core';

// Using shared Redis (default)
const adapter = new RedisQueueAdapter();

// Or custom connection
const adapter = new RedisQueueAdapter({
  useSharedClient: false,
  url: 'redis://localhost:6379',
  keyPrefix: 'myapp:queue:',
});

await adapter.connect();
```

**Supported Features:**
- All features (pattern subscriptions, delayed messages, priority, consumer groups, DLQ, retry, scheduled jobs)

### NatsQueueAdapter

NATS pub/sub for lightweight messaging (no persistence).

```typescript
import { NatsQueueAdapter } from '@onebun/nats';

const adapter = new NatsQueueAdapter({
  servers: 'nats://localhost:4222',
});
await adapter.connect();
```

**Supported Features:**
- Pattern subscriptions
- Consumer groups
- Scheduled jobs

### JetStreamQueueAdapter

NATS JetStream for persistent, reliable messaging.

```typescript
import { JetStreamQueueAdapter } from '@onebun/nats';

const adapter = new JetStreamQueueAdapter({
  servers: 'nats://localhost:4222',
  stream: 'EVENTS',
  createStream: true,
  streamConfig: {
    subjects: ['events.>'],
    retention: 'limits',
    maxMsgs: 1000000,
  },
});
await adapter.connect();
```

**Supported Features:**
- Pattern subscriptions
- Consumer groups
- Dead letter queue
- Retry
- Scheduled jobs

## Feature Support Matrix

| Feature | Memory | Redis | NATS | JetStream |
|---------|--------|-------|------|-----------|
| Pattern subscriptions | ✅ | ✅ | ✅ | ✅ |
| Delayed messages | ✅ | ✅ | ❌ | ❌ |
| Priority | ✅ | ✅ | ❌ | ❌ |
| Consumer groups | ❌ | ✅ | ✅ | ✅ |
| Dead letter queue | ❌ | ✅ | ❌ | ✅ |
| Retry | ❌ | ✅ | ❌ | ✅ |
| Scheduled jobs | ✅ | ✅ | ✅ | ✅ |
| Persistence | ❌ | ✅ | ❌ | ✅ |

## Publishing Messages

### QueueService

```typescript
import { QueueService } from '@onebun/core';

class OrderService {
  constructor(private queue: QueueService) {}

  async createOrder(data: OrderData) {
    // Publish with options
    await this.queue.publish('orders.created', data, {
      delay: 1000,           // Delay 1 second
      priority: 10,          // Higher = more important
      messageId: 'custom-id',
      metadata: {
        authorization: 'Bearer token',
        serviceId: 'order-service',
        traceId: 'trace-123',
      },
    });

    // Batch publish
    await this.queue.publishBatch([
      { pattern: 'orders.created', data: order1 },
      { pattern: 'orders.created', data: order2 },
    ]);
  }
}
```

## Cron Parser

OneBun includes a built-in cron parser (no external dependencies).

```typescript
import { 
  parseCronExpression,
  getNextRun,
  isValidCronExpression,
} from '@onebun/core';

// Parse expression
const schedule = parseCronExpression('0 30 9 * * 1-5');
// { seconds: [0], minutes: [30], hours: [9], ... }

// Get next run time
const nextRun = getNextRun(schedule);
console.log('Next run:', nextRun);

// Validate expression
if (isValidCronExpression('0 0 * * *')) {
  console.log('Valid!');
}
```

### Supported Syntax

| Field | Values | Special |
|-------|--------|---------|
| Seconds | 0-59 | `*`, `*/N`, `N-M`, `N,M` |
| Minutes | 0-59 | `*`, `*/N`, `N-M`, `N,M` |
| Hours | 0-23 | `*`, `*/N`, `N-M`, `N,M` |
| Day of month | 1-31 | `*`, `*/N`, `N-M`, `N,M` |
| Month | 1-12 | `*`, `*/N`, `N-M`, `N,M` |
| Day of week | 0-6 (0=Sun) | `*`, `*/N`, `N-M`, `N,M` |

## Pattern Matcher

```typescript
import {
  matchQueuePattern,
  isQueuePatternMatch,
  createQueuePatternMatcher,
} from '@onebun/core';

// Match with parameter extraction
const result = matchQueuePattern('orders.{id}.status', 'orders.123.status');
// { matched: true, params: { id: '123' } }

// Simple match check
if (isQueuePatternMatch('events.*', 'events.user')) {
  console.log('Matched!');
}

// Create reusable matcher (optimized)
const matcher = createQueuePatternMatcher('orders.*.status');
matcher('orders.123.status'); // { matched: true, params: {} }
matcher('orders.456.status'); // { matched: true, params: {} }
```
