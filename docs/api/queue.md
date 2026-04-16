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

For NATS/JetStream or other backends, use a custom adapter constructor (see [Custom adapter: NATS JetStream](#custom-adapter-nats-jetstream) below).

### QueueApplicationOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | auto | Enable queue system (auto-enabled if handlers detected) |
| `adapter` | `'memory' \| 'redis'` or adapter class | `'memory'` | Built-in type or custom adapter constructor (e.g. for NATS JetStream) |
| `options` | inferred from adapter | - | Options passed to the custom adapter constructor — type-safe when `adapter` is a class |
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

::: tip Scheduled-only Controllers
If your controllers use **only** scheduling decorators (`@Cron`, `@Interval`, `@Timeout`) without `@Subscribe`, the queue system still auto-initializes with the in-memory adapter. No explicit `queue` configuration is needed. This works regardless of where in the module tree the controller is located — root, child, or deeply nested modules.
:::

::: info Scheduled Job Error Handling
Errors thrown inside `@Cron`, `@Interval`, and `@Timeout` handlers are caught and logged as warnings. The scheduler continues running — one failed job does not affect other scheduled jobs.
:::

<llm-only>

**Technical details for AI agents:**
- Queue auto-enables by checking all **controllers** (not providers) for `hasQueueDecorators()` which inspects `@Subscribe`, `@Cron`, `@Interval`, `@Timeout` metadata
- Controllers are collected recursively from the entire module tree via `getControllers()` (root + all child modules)
- `initializeQueue(controllers)` is called during `app.start()` after `ensureModule().setup()` — it receives `getControllers()` result
- Both `controllerClass` and `instance.constructor` are checked for queue decorators (defensive against `@Controller` wrapping edge cases)
- The adapter is created, connected, then `QueueService` is initialized and handlers are registered via `registerService(instance, class)` for each controller with queue decorators
- `registerService()` processes: subscribe handlers → cron jobs → interval jobs → timeout jobs → lifecycle handlers
- `@Interval` handlers fire immediately on scheduler start, then repeat at the configured interval
- Scheduler error handler logs warnings for failed jobs via `QueueScheduler.setErrorHandler()`
- Message guards (`@UseMessageGuards`) are applied as wrappers around the actual handler
- The scheduler (`QueueScheduler`) manages cron/interval/timeout jobs with configurable overlap strategies: `SKIP`, `QUEUE`, `REPLACE`
- Queue shutdown sequence: `queueService.stop()` → `queueAdapter.disconnect()`
- Debug logging emits per-controller diagnostics during handler registration (controller name, decorator detection result)
- Dynamic job management: `addJob()`, `getJob()`, `getJobs()`, `hasJob()`, `pauseJob()`, `resumeJob()`, `removeJob()`, `updateJob()` on `QueueService` — all synchronous, delegate to `QueueScheduler`
- Jobs created via decorators are also accessible through the dynamic API by their name (method name by default, overridable via `name` option)

**QueueApplicationOptions interface:**
```typescript
// Generic: options type is inferred from the adapter constructor
interface QueueApplicationOptions<A extends QueueAdapterConstructor = QueueAdapterConstructor> {
  enabled?: boolean;
  adapter?: 'memory' | 'redis' | A;
  options?: A extends QueueAdapterConstructor<infer O> ? O : never;
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

Queue handlers (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`) are only discovered in classes registered in a module's **controllers** array. Use a controller (not a provider) for queue handlers.

```typescript
import {
  Module,
  Controller,
  BaseController,
  OneBunApplication,
  Subscribe,
  Cron,
  Interval,
  Message,
  CronExpression,
  OnQueueReady,
  QueueService,
} from '@onebun/core';

// Controller with queue handlers (must be in controllers array)
@Controller('/events')
class EventProcessor extends BaseController {
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

// Module: register in controllers so queue handlers are discovered
@Module({
  controllers: [EventProcessor],
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
  this.logger.info('Order received', { pattern: message.pattern, data: message.data });
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

Lifecycle handlers run only when the class is registered as a **controller** (in a module's `controllers` array).

```typescript
import {
  Controller,
  BaseController,
  OnQueueReady,
  OnQueueError,
  OnMessageReceived,
  OnMessageProcessed,
  OnMessageFailed,
} from '@onebun/core';

@Controller('/events')
class EventProcessor extends BaseController {
  @OnQueueReady()
  handleReady() {
    this.logger.info('Queue connected');
  }

  @OnQueueError()
  handleError(error: Error) {
    this.logger.error('Queue error', error);
  }

  @OnMessageReceived()
  handleReceived(message: Message) {
    this.logger.info('Received', { id: message.id });
  }

  @OnMessageProcessed()
  handleProcessed(message: Message) {
    this.logger.info('Processed', { id: message.id });
  }

  @OnMessageFailed()
  handleFailed(message: Message, error: Error) {
    this.logger.error('Failed', { id: message.id, error });
  }
}
```

## Queue Adapters

### InMemoryQueueAdapter

In-process message bus. Good for development and testing. This is the default adapter when `queue.adapter` is not specified:

```typescript
const app = new OneBunApplication(AppModule, {
  queue: { adapter: 'memory' },
});
```

**Supported Features:**
- Pattern subscriptions
- Delayed messages
- Priority
- Scheduled jobs

### RedisQueueAdapter

Distributed queue using Redis. Uses SharedRedisProvider by default:

```typescript
const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: 'redis',
    redis: { useSharedProvider: true, prefix: 'myapp:queue:' },
  },
});
```

Or with a dedicated Redis connection:

```typescript
const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: 'redis',
    redis: { useSharedProvider: false, url: 'redis://localhost:6379' },
  },
});
```

**Supported Features:**
- All features (pattern subscriptions, delayed messages, priority, consumer groups, DLQ, retry, scheduled jobs)

### Custom adapter: NATS JetStream

To use a custom backend (e.g. NATS JetStream), pass the adapter **constructor** and **options** in `queue`:

```typescript
import { OneBunApplication, type QueueAdapter } from '@onebun/core';
import { Module, Controller, BaseController, Subscribe, Message } from '@onebun/core';
import { AppModule } from './app.module';

// If you have an adapter class (e.g. from @onebun/nats or your own):
class NatsJetStreamAdapter implements QueueAdapter {
  readonly name = 'nats-jetstream';
  readonly type = 'jetstream';
  constructor(private opts: { servers: string; streams?: Array<{ name: string; subjects: string[] }> }) {}
  async connect() { /* connect to NATS */ }
  async disconnect() { /* disconnect */ }
  isConnected() { return true; }
  async publish() { return ''; }
  async publishBatch() { return []; }
  async subscribe() { return { unsubscribe: async () => {}, pause: () => {}, resume: () => {}, pattern: '', isActive: true }; }
  supports() { return false; }
  on() {}
  off() {}
}

@Controller('/jobs')
class JobHandler extends BaseController {
  @Subscribe('jobs.created')
  async handle(message: Message<{ id: string }>) {
    this.logger.info('Job', { id: message.data.id });
  }
}

@Module({ controllers: [JobHandler] })
class AppModule {}

const app = new OneBunApplication(AppModule, {
  port: 3000,
  queue: {
    adapter: NatsJetStreamAdapter,
    options: {
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
    },
  },
});
await app.start();
```

The framework instantiates the adapter with `new Adapter(queue.options)` and uses it as the queue backend. When you pass a class constructor as `adapter`, `options` is automatically typed to match the adapter's constructor argument — no type assertions needed. For a ready-made NATS/JetStream adapter, use the `@onebun/nats` package if available and pass its adapter class and options the same way.

### NatsQueueAdapter

NATS pub/sub for lightweight messaging (no persistence). Pass the adapter class in application options — the framework handles instantiation and connection automatically:

```typescript
import { OneBunApplication } from '@onebun/core';
import { NatsQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: NatsQueueAdapter,
    options: { servers: 'nats://localhost:4222' },
  },
});
await app.start();
```

`QueueService` is automatically available for injection in any controller or service across all modules — no additional imports or configuration required.

**Supported Features:**
- Pattern subscriptions
- Consumer groups
- Scheduled jobs

### JetStreamQueueAdapter

NATS JetStream for persistent, reliable messaging. Pass the adapter class in application options:

```typescript
import { OneBunApplication } from '@onebun/core';
import { JetStreamQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: JetStreamQueueAdapter,
    options: {
      servers: 'nats://localhost:4222',
      streamDefaults: {
        retention: 'limits',
        storage: 'file',
        replicas: 1,
      },
      streams: [
        {
          name: 'EVENTS',
          subjects: ['events.>'],
        },
        {
          name: 'agent_events',
          subjects: ['agent.events.>'],
          maxAge: 7 * 24 * 60 * 60 * 1e9,
        },
        {
          name: 'agent_dlq',
          subjects: ['agent.dlq.>'],
          maxAge: 7 * 24 * 60 * 60 * 1e9,
          storage: 'memory',
        },
      ],
    },
  },
});
await app.start();
```

All streams are created automatically during startup. `streamDefaults` is merged into each stream definition (per-stream values take priority). `QueueService` is automatically available for injection in any controller or service. When using `@Subscribe('agent.events.task.done')`, the adapter automatically resolves the correct stream.

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

### QueueService: availability and injection

**QueueService is available via DI.** You can inject it in the constructor of controllers, providers, WebSocket gateways, and middleware (e.g. `constructor(private queueService: QueueService)`). The framework registers a proxy in the module before creating controllers; when the queue is enabled during `app.start()`, the proxy delegates to the real `QueueService`. No wrapper or `getQueueService()` is required for normal DI-based code.

**When is the real QueueService created?**  
The queue system is initialized during `app.start()`, after the module is set up, inside `initializeQueue()`. It is only created when the queue is enabled: either at least one controller has queue decorators (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`) or `queue.enabled` is set to `true` in application options.

**If the queue is not enabled but you injected QueueService:**  
The injected instance is a proxy. Any call to a method (e.g. `publish()`, `subscribe()`) will throw an error with a message explaining how to enable the queue (`queue.enabled: true` or register a controller with queue decorators).

**Getting QueueService without DI:**  
Use `app.getQueueService()` when you do not have DI (e.g. bootstrap scripts or code that only has the app reference). It returns `QueueService | null` when the queue is not enabled.

### QueueService

Inject `QueueService` in your controller, provider, middleware, or gateway constructor:

```typescript
import { QueueService } from '@onebun/core';

@Service()
class OrderService extends BaseService {
  constructor(private queue: QueueService) {
    super();
  }

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

## Dynamic Job Management

QueueService provides programmatic control over scheduled jobs at runtime.

### Adding Jobs

```typescript
// Cron job
queueService.addJob({
  type: 'cron',
  name: 'cleanup',
  expression: '0 * * * *',
  pattern: 'jobs.cleanup',
});

// Interval job
queueService.addJob({
  type: 'interval',
  name: 'heartbeat',
  intervalMs: 5000,
  pattern: 'jobs.heartbeat',
});

// Timeout job (one-time)
queueService.addJob({
  type: 'timeout',
  name: 'warmup',
  timeoutMs: 3000,
  pattern: 'jobs.warmup',
});
```

### Querying Jobs

```typescript
const job = queueService.getJob('cleanup');
const allJobs = queueService.getJobs();
const exists = queueService.hasJob('cleanup');

// Filter by origin — decorator-created vs dynamic
const decoratorJobs = allJobs.filter(j => j.declarative);
const dynamicJobs = allJobs.filter(j => !j.declarative);
```

`ScheduledJobInfo` fields: `name`, `type`, `pattern`, `paused`, `declarative`, `schedule`, `lastRun`, `nextRun`, `isRunning`. The `declarative` field is `true` for jobs created via `@Cron`/`@Interval`/`@Timeout` decorators, `false` for jobs added via `addJob()`.

### Controlling Jobs

```typescript
queueService.pauseJob('cleanup');   // Pause
queueService.resumeJob('cleanup');  // Resume
queueService.removeJob('cleanup');  // Delete
```

### Updating Jobs

```typescript
queueService.updateJob({ type: 'cron', name: 'cleanup', expression: '*/5 * * * *' });
queueService.updateJob({ type: 'interval', name: 'heartbeat', intervalMs: 10000 });
```

Jobs created via decorators (`@Cron`, `@Interval`, `@Timeout`) are also accessible
through this API by their name (defaults to method name, overridable via `name` option in decorator).

<llm-only>

**Technical details for AI agents:**
- `addJob()`, `getJob()`, `getJobs()`, `hasJob()`, `pauseJob()`, `resumeJob()`, `removeJob()`, `updateJob()` are all synchronous methods on `QueueService`
- They delegate to `QueueScheduler` which manages the underlying timers/cron jobs
- `addJob()` accepts a discriminated union `AddJobOptions` with `type: 'cron' | 'interval' | 'timeout'`
- `updateJob()` accepts `UpdateJobOptions` — same discriminated union but fields (except `name` and `type`) are optional
- `getJob()` returns `ScheduledJobInfo | undefined`, `getJobs()` returns `ScheduledJobInfo[]`
- `ScheduledJobInfo` includes: `name`, `type`, `pattern`, `paused`, `declarative`, `schedule` (with `cron?`, `every?`, `timeout?`), `lastRun`, `nextRun`, `isRunning`
- `declarative: true` for jobs created via `@Cron`/`@Interval`/`@Timeout` decorators, `false` for jobs added via `addJob()`
- Jobs added via decorators are registered during `registerService()` and get default names from method names
- Decorator-created jobs can be overridden with a custom `name` via the decorator options (e.g. `@Cron('...', { name: 'my-job' })`)
- Scheduler management is entirely in-process — it does not use the queue adapter for persistence
- `pauseJob()` clears timers and sets `paused: true`; `resumeJob()` restarts timers
- `updateJob()` validates type match, updates timing parameters in-place, and restarts timer if running

</llm-only>

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
