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

The queue system is **enabled** when any one of three conditions holds: a controller in your application uses queue decorators (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`); `queue.enabled: true` is present in application options; or a backend is explicitly configured via `queue.adapter`, `queue.options` or `queue.redis`. Setting `queue.enabled` to `false` overrides all three and keeps the queue disabled. No explicit configuration is required for basic usage with the in-memory adapter, which remains the default.

::: warning `queue.redis` does not select the Redis adapter on its own
`queue.redis` carries Redis *settings*; it does not choose the adapter. The adapter is chosen by `queue.adapter`, which defaults to `'memory'`. So `queue: { redis: { url } }` on its own enables the queue with the **in-memory** adapter and the Redis settings are ignored. Always pair them: `queue: { adapter: 'redis', redis: { url } }`.
:::

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
| `enabled` | `boolean` | auto | Enable queue system. Auto-enabled when a controller has queue decorators, when set to `true`, or when a backend is configured via `adapter`, `options` or `redis`. An explicit `enabled: false` is the opt-out and wins over a configured backend |
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

::: tip Producer-only apps
An application with **zero** queue decorators still gets a live queue as soon as `queue.adapter`, `queue.options` or `queue.redis` is set. Such a producer-only service can inject `QueueService` and call `publish()` without declaring a single `@Subscribe` handler — the message reaches the broker instead of the call throwing. The trade-off: the adapter is now constructed and connected during `app.start()`, so the application **fails to boot** when the broker is unreachable, where previously it started fine and silently discarded every published message. Set `queue.enabled: false` if you want the queue to stay off despite a configured backend.
:::

<llm-only>

**Technical details for AI agents:**
- Queue enablement is resolved by `resolveQueueEnablement(queueOptions, hasQueueHandlers)` in `application/queue-enablement.ts`. Resolution order: `queue.enabled === false` is evaluated **first** and always wins — the queue stays disabled and the adapter is never constructed. Otherwise the queue is enabled when **any** of: `queue.enabled === true`, or any **controller** (not provider) passes `hasQueueDecorators()` which inspects `@Subscribe`, `@Cron`, `@Interval`, `@Timeout` metadata, or `hasExplicitQueueAdapterConfig()` finds an explicit `queue.adapter`, `queue.options` or `queue.redis`
- When `queue.enabled === false` suppresses a configured backend, the decision reports `contradiction: true` and the caller logs exactly one warning (`QUEUE_DISABLED_WITH_ADAPTER_WARNING`); nothing throws
- `hasExplicitQueueAdapterConfig()` treats `queue.redis` as an enabling signal, but the adapter itself is still `queueOptions?.adapter ?? 'memory'` (`application.ts`). A config of `queue: { redis: {...} }` with no `adapter` therefore enables the queue with `InMemoryQueueAdapter` and silently drops the Redis settings — pre-existing, but newly reachable now that a backend config alone enables the queue
- Controllers are collected recursively from the entire module tree via `getControllers()` (root + all child modules)
- `initializeQueue(controllers)` is called during `app.start()` after `ensureModule().setup()` — it receives `getControllers()` result
- Both `controllerClass` and `instance.constructor` are checked for queue decorators (defensive against `@Controller` wrapping edge cases)
- The adapter is created, connected, then `QueueService` is initialized and handlers are registered via `registerService(instance, class)` for each controller with queue decorators
- `registerService()` processes: subscribe handlers → cron jobs → interval jobs → timeout jobs → lifecycle handlers
- `@Interval` handlers fire immediately on scheduler start, then repeat at the configured interval
- Scheduler error handler logs warnings for failed jobs via `QueueScheduler.setErrorHandler()`
- Message guards (`@UseMessageGuards`) are applied as wrappers around the actual handler
- The scheduler (`QueueScheduler`) manages cron/interval/timeout jobs with configurable overlap strategies: `'skip'` (default — skip execution if previous is still running), `'queue'` (publish as regular message even if previous is running)
- Queue shutdown sequence: `queueService.stop()` → `queueAdapter.disconnect()`
- Debug logging emits per-controller diagnostics during handler registration (controller name, decorator detection result)
- Dynamic job management: `addJob()`, `getJob()`, `getJobs()`, `hasJob()`, `pauseJob()`, `resumeJob()`, `removeJob()`, `updateJob()` on `QueueService` — all synchronous, delegate to `QueueScheduler`
- Jobs created via decorators are also accessible through the dynamic API by their name (method name by default, overridable via `name` option)

**QueueApplicationOptions interface:**
```typescript
// Generic: options type is inferred from the adapter constructor
interface QueueApplicationOptions<A extends QueueAdapterConstructor = QueueAdapterConstructor> {
  // undefined = auto (queue decorators or a backend config), true = force on, false = force off (logs one warning)
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
        await message.nack(false);  // Terminate: never redeliver this message
      } else {
        await message.nack(true);  // Requeue for retry
      }
    }
  }
}
```

Only the JetStream adapter populates `attempt` and `maxAttempts`; on the memory, Redis and core-NATS adapters both fields are always `undefined`.

**A handler written this way never throws, and it is still reported as a failure.** That matters
because it is the shape this page recommends: the `catch` swallows the exception and calls
`nack()`, so the handler resolves normally and nothing about its control flow distinguishes it
from a success. Every adapter reads the nack the message recorded and emits `onMessageFailed`
with an error naming the message, rather than `onMessageProcessed`. A handler that nacks *and*
then throws emits exactly one event, carrying the thrown error — it has a stack the synthesised
one does not.

`ack()` and `nack()` are first-call-wins on every adapter: the first disposition the handler
chooses is the one that counts, and a later call is a no-op. A handler's return value is never a
signal — returning `false` or an error object still counts as success. The rule does not vary
with `ackMode`, `'none'` included: `'none'` removes redelivery, not observability.

<llm-only>

**Technical details for AI agents — message disposition events:**
- One delivery emits exactly one of `onMessageProcessed` or `onMessageFailed`, never both and never two of either. The decision lives immediately after the awaited handler call, INSIDE the handler's `try`, on all four adapters
- The branch is `wasNacked(message) ? emit('onMessageFailed', message, nackedError(message)) : emit('onMessageProcessed', message)`. `wasNacked` and `nackedError` are exported from `@onebun/core` (`packages/core/src/queue/ack-mode.ts`) so the error text does not depend on which broker is behind the subscription
- `wasNacked` is STRUCTURAL, not an `instanceof`: `(message as Partial<NackAwareMessage>).wasNacked === true`. The four message classes live in two packages and share no base class, and an adapter with no nack state correctly answers false
- `NackAwareMessage` is deliberately NOT part of the public `Message` interface. Whether a message was nacked is the adapter's bookkeeping — a handler already knows what it called, and widening `Message` would invite handlers to read the flag back and branch on it
- Because the check sits inside the `try`, a throw skips it entirely: nack-then-throw carries the THROWN error. The synthesised error carries no `cause`, because the handler never raised one
- On JetStream the auto-ack is additionally gated: `if (acknowledgesAutomatically(entry.options) && !wasNacked(message))`. That `msg.ack()` is on the raw `JsMsg`, not the wrapper, so it bypasses the wrapper's first-call-wins guard — ungated, it settled a message the handler had just `nak()`ed and cancelled the redelivery
- Two deliveries emit NO event at all on `NatsQueueAdapter`: one whose pattern does not match the subscription's matcher (it returns before `onMessageReceived`, and no message object is constructed) and one whose payload fails `JSON.parse`. JetStream instead emits `onError` and `term()`s a poison message
- `onMessageProcessed` does not mean "the handler ran": `QueueService` returns early when a message guard refuses a message, and that path still reports processed.

</llm-only>

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

| Pattern | Example Match | Description | NATS subject |
|---------|--------------|-------------|--------------|
| `orders.created` | `orders.created` | Exact match | `orders.created` |
| `orders.*` | `orders.created`, `orders.updated` | Single-level wildcard | `orders.*` |
| `events.#` | `events.user.created`, `events.order.paid` | Multi-level wildcard | `events.>` |
| `orders.{id}` | `orders.123` → `{ id: '123' }` | Named parameter | `orders.*` |

The **NATS subject** column applies to the `NatsQueueAdapter` and `JetStreamQueueAdapter`
only. NATS has no equivalent of a named parameter, so `{name}` widens to `*` on the wire
and the pattern is re-checked in process — a subscription never receives a message its
pattern does not match.

On those two adapters `#` **must be the final token**: it translates to the NATS `>`
wildcard, which NATS accepts only at the end of a subject. A `#` anywhere else
(`#.created`, `events.#.created`) throws — from the `JetStreamQueueAdapter` constructor
for a stream declaration, and from the awaited `publish()` / `subscribe()` call otherwise.

<llm-only>

**Technical details for AI agents:**
- `toNatsSubject is the only OneBun-to-NATS subject translation in the package.` It lives in `packages/nats/src/subject.ts`, is re-exported from `packages/nats/src/index.ts`, and has five call sites: `jetstream.adapter.ts:231` (stream declarations, in the constructor), `:315` (`publish`), `:352` (the consumer `filter_subject`), `:475` (`resolveStreamForSubject`) and `nats.adapter.ts:283` (the core-NATS subscription)
- The rules: a token containing a `{name}` parameter becomes `*`; a trailing `#` token becomes `>`; `*` and literal tokens pass through; a `#` in any other position throws
- Translation only ever widens. The transport delivers a superset and `entry.matcher`, built by `createQueuePatternMatcher(pattern)` from the ORIGINAL pattern, narrows it back — which makes the match check in the consume loop load-bearing, not redundant. A non-matching message is `ack()`ed, never left unacked
- Stream declarations are translated eagerly in the `JetStreamQueueAdapter` constructor, so `resolvedStreams[].natsSubjects` — the input to `ensureStream`'s subject-coverage guard and to `resolveStreamForSubject` — is already in NATS form. A declaration of `orders.{id}` binds `orders.*`
- The publish path translates the pattern but does not widen a concrete subject: `publish('orders.123', …)` sends `orders.123`
- Publishing is not pre-validated against the locally declared streams; a failed publish reports both the OneBun pattern and the translated NATS subject, with the broker's rejection attached as `cause`

</llm-only>

### Subscribe Options

```typescript
@Subscribe('orders.*', {
  ackMode: 'manual',        // 'auto' (default), 'manual' or 'none'
  group: 'order-processors', // One durable consumer per (group, pattern) — a PERMANENT server resource
  prefetch: 10,             // Messages to process in parallel
  ackTimeout: 30_000,       // ms — max time a handler may hold a message before redelivery
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

This recipe assumes an adapter that acknowledges. On `NatsQueueAdapter` it does not fail — it
does nothing: core NATS has no acknowledgement protocol, so `ack()` and `nack()` are permanent
no-ops there and `ackMode` has no effect on the wire. A nack is still reported as
`onMessageFailed` so the drop is visible, but the message is not requeued, because nothing in
the protocol can redeliver it. See [NatsQueueAdapter](#natsqueueadapter) and the
[Feature Support Matrix](#feature-support-matrix).

Whatever the adapter, a handler that nacks and returns normally is reported as a failure, not a
success: `onMessageFailed` fires with an error naming the message, and `onMessageProcessed` does
not fire at all.

#### ackMode: 'none'

Fire-and-forget. The message is delivered exactly once and nothing is acknowledged, so
there is no redelivery and no dead-letter routing on any adapter. Choose it when losing a
message costs less than processing it twice — a telemetry firehose, say, where a replayed
sample is worse than a missing one.

```typescript
@Subscribe('telemetry.samples', { ackMode: 'none' })
async ingest(message: Message<Sample>) {
  await this.write(message.data);   // if this throws, the sample is gone
}
```

Everything that depends on the broker tracking delivery state goes inert with it:

| Option or field | Under `'none'` |
|---|---|
| `retry.attempts` | ignored — nothing is redelivered |
| `deadLetter` | ignored — there is no failure event to route |
| `ackTimeout` | ignored — no effect under `ackMode: 'none'` |
| `ack_wait` | not sent to the server |
| `max_deliver` | not sent to the server |
| `Message.attempt` | never populated |
| `Message.maxAttempts` | never populated |
| `Message.redelivered` | always `false` |

A handler that throws still emits `onMessageFailed`, so failures remain observable — the
message itself is simply not retried. `message.ack()` and `message.nack()` become no-ops.

Per adapter: JetStream creates the consumer with `ack_policy: none`; Redis skips both the
requeue and the dead-letter branch; the in-memory adapter suppresses `nack(true)`, which
would otherwise resurrect a message in the one mode that promises a single delivery; and
`NatsQueueAdapter` gains nothing, because core NATS never had an acknowledgement protocol —
`'none'` is simply the only mode that describes it truthfully.

<llm-only>

**Technical details for AI agents — ackMode 'none':**
- One resolver, not a negation per adapter: `resolveAckMode`, `acknowledgesAutomatically` and `tracksDelivery` live in `packages/core/src/queue/ack-mode.ts` and are exported from `@onebun/core`. `acknowledgesAutomatically` is true for `'auto'` only; `'manual'` and `'none'` both answer false, for opposite reasons. `tracksDelivery` is false for `'none'` only. Every adapter reads these instead of testing the raw option, so a fourth union member cannot fall into the auto branch silently
- JetStream sets ack_policy: none and omits ack_wait, max_deliver and max_ack_pending from the payload entirely — spread from `redeliveryConfig(resolved)`, so the keys are ABSENT rather than present-and-undefined. They are also excluded from the reconcile hash and from `divergingFields()`: the server accepts them and ignores them, so recording them would stamp a redelivery policy that cannot occur
- Redis skips dead-letter routing and the requeue together — `onNack` returns early when `tracksDelivery()` is false, before either branch
- memory suppresses requeue: `nack(true)` no longer re-dispatches under `'none'`, because that is the one mode promising a single delivery
- NatsQueueAdapter is already a no-op on this axis: core NATS has no acknowledgement protocol, so nothing on the wire varies with the mode. It resolves the mode once onto the subscription entry so the choice is named in one place
- The consume loop calls neither `msg.ack()` nor `msg.nak()` under `'none'`, on either the success or the failure path
- Only the JetStream adapter populates `attempt` and `maxAttempts`; on the memory, Redis and core-NATS adapters both fields are always `undefined`.

</llm-only>

## Message Interface

```typescript
interface Message<T> {
  id: string;              // Unique message ID
  pattern: string;         // Message pattern/topic
  data: T;                 // Message payload
  timestamp: number;       // Unix timestamp in ms
  metadata: MessageMetadata;
  redelivered?: boolean;   // True if redelivered — always false under ackMode: 'none'
  attempt?: number;        // Current attempt number — inert under ackMode: 'none'
  maxAttempts?: number;    // Max attempts allowed — inert under ackMode: 'none'
  
  ack(): Promise<void>;    // Acknowledge (manual mode)
  nack(requeue?: boolean): Promise<void>; // Negative ack; requeue=false means never redeliver
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

`nack(true)` asks for the message to be delivered again. `nack(false)` — and the bare `nack()`,
since `requeue` defaults to `false` — says the opposite: do not deliver this message again.

What "do not deliver again" costs is adapter-specific, and only the first line below holds
everywhere:

| Adapter | `nack(false)` |
|---|---|
| JetStream | terminated on the server; never redelivered, and the delivery does not count against `maxDeliver` |
| Redis | moved to the dead-letter queue if `deadLetter` is configured, otherwise dropped |
| In-memory | dropped; this adapter has no dead-letter queue |
| NATS (pub/sub) | no effect — plain NATS has no acknowledgement, so neither form does anything |

So `nack(false)` never redelivers, but it does not universally mean "send to the dead-letter
queue". Publish the payload somewhere yourself if you need to keep it.

Only the JetStream adapter populates `attempt` and `maxAttempts`; on the memory, Redis and core-NATS adapters both fields are always `undefined`.

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

## Interceptors

`@UseInterceptors()` works on queue handlers — same decorator as HTTP and WebSocket. Interceptors wrap handler execution for logging, timing, or other cross-cutting concerns.

```typescript
@UseInterceptors(LoggingInterceptor)
@Controller('/processor')
class EventProcessor extends BaseController {
  @Subscribe('events.created')
  @UseInterceptors(new TimeoutInterceptor(10000))
  async handleEvent(message: Message<{ id: string }>) {
    // handler code
  }
}
```

See [Interceptors](/api/interceptors) for full documentation.

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

This snippet by itself enables the queue: an explicit `queue.adapter` is a backend configuration, so no `@Subscribe`, `@Cron`, `@Interval` or `@Timeout` decorator is needed anywhere in the application.

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

**Acknowledgements do not exist here.** Core NATS is fire-and-forget: the protocol has no
acknowledgement, no redelivery and no delivery state, so `message.ack()` and `message.nack()`
are permanent no-ops on this adapter and `ackMode` changes nothing on the wire. `'auto'`,
`'manual'` and `'none'` are all accepted — `'none'` is simply the only one that describes what
this adapter really does. A handler written against the `ackMode: 'manual'` recipe therefore
runs unchanged and silently accomplishes nothing; if you need the acknowledgements that recipe
implies, the adapter you want is `JetStreamQueueAdapter`.

One thing the nack does still do is report. A handler that catches its own exception and calls
`message.nack()` returns normally, so nothing distinguishes it from a success by control flow —
the subscription reads the nack and emits `onMessageFailed` rather than `onMessageProcessed`,
so a dropped message is visible to metrics and tracing instead of being counted as handled.
The message itself is still gone: `requeue` cannot be honoured by a protocol that never
redelivers.

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

Streams are reconciled during startup, not recreated: a stream the server does not have yet is created, and a stream that already exists is reconciled only when its configuration hash changed. `streamDefaults` is merged into each stream definition (per-stream values take priority). `QueueService` is automatically available for injection in any controller or service. When using `@Subscribe('agent.events.task.done')`, the adapter automatically resolves the correct stream — and, since that subscription declares no `group`, its consumer is ephemeral: every process running it gets its own, and each one delivers only what is published after it starts, never the backlog already stored in `agent_events`. Passing `adapter: JetStreamQueueAdapter` alone enables the queue, so a producer-only service with zero `@Subscribe` handlers still connects to NATS during `app.start()`.

**Supported Features:**
- Pattern subscriptions
- Consumer groups
- Dead letter queue
- Retry
- Scheduled jobs

**Reconciliation on connect.** Each declared stream is reconciled during startup rather than blindly rewritten. The adapter first asks the server for the stream; only a genuine "stream not found" rejection counts as absence and leads to a create. Any other rejection — permissions denied, JetStream disabled, a transport timeout — is reported as itself, instead of being read as a missing stream and turned into the opaque `stream name already in use` that the follow-up create would raise. When the stream already exists, the update carries **only the keys this application declared**. A limit the declaration says nothing about is never sent, so `maxMsgs`, `maxBytes` and `maxAge` set out of band survive every connect: a stream pre-provisioned by an operator keeps the limits that operator gave it. `retention`, `storage` and the replica default apply on creation only — `update` cannot change the first two, and applying a default on update would rewrite a value the application never asked about. A limit or replica count declared in `streamDefaults` counts as declared and is sent on both paths; `retention` and `storage` are creation-only whether you declare them or not, and reach the divergence guard rather than the wire.

An unchanged stream configuration performs no write at all. A changed one is updated in place, carrying every pre-existing metadata key forward.

Startup fails loudly, and `onError` fires, when an existing stream cannot be reconciled safely — the adapter fails startup rather than diverging silently:

- **A declaration that would narrow an existing stream.** Subject coverage is checked against the server's own subject list before anything else, so a stale stamp left by an out-of-band `nats stream edit` cannot wave a narrowing declaration through. The error names every subject the stream stores today that the declaration would no longer cover, because applying it would stop those subjects being stored and silently drop their messages. Widening is always allowed: every service sharing a stream must declare identical subjects, or at least a superset of what the stream already binds.
- **A `storage` or `retention` that differs from the server's.** Neither can be changed on an existing stream, so this is checked before the configuration hash too — a matching hash must never mask a field an update cannot carry. The error names the diverging field and the only way forward, `nats stream rm <STREAM>`, which discards every message the stream holds.
- **A reconcile cycle.** Two processes writing different definitions for the same stream, where the desired configuration was applied moments ago and has since been replaced; the error names the fields they disagree on.

The reconciliation stamp lives in JetStream stream metadata, so streams, like consumers, require nats-server 2.10 or newer. A rejection that names a server-version requirement is re-reported with that requirement stated.

<llm-only>

**Technical details for AI agents — stream reconciliation:**
- `ensureStream()` in `packages/nats/src/jetstream.adapter.ts` is probe-first: it calls `jsm.streams.info(name)` before anything else, never a blind `streams.add()` inside a bare `catch {}`. A rejection is absence only when `isNotFoundError(err, jsModule.JetStreamApiCodes.StreamNotFound)` matches the numeric API code; every other rejection emits `onError` and is rethrown as itself
- Branch order once `info` resolves is load-bearing: ensureStream checks subject coverage first, then create-only divergence, then the hash. Coverage comes from the server's `config.subjects`, so a stale stamp cannot approve a narrowing declaration; the create-only guard sits ahead of the hash for the same reason the consumer path checks its ack policy first — a matching hash must not mask a field `streams.update` cannot carry
- `buildStreamConfig(stream, forCreate)` emits ONLY declared keys — an undeclared key is absent, never present-and-undefined, because the client's update merges with a shallow `Object.assign` and `max_msgs: undefined` would overwrite the server's value. `forCreate` adds `name`, `retention ?? 'limits'`, `storage ?? 'file'` and `num_replicas ?? 1`; those defaults never reach `streams.update()`
- The hash is `hashReconcileConfig(hashableStreamSubset(desired))` over `{ subjects, max_msgs, max_bytes, max_age, num_replicas }`. `name` and `metadata` are excluded so a stamp write does not change the hash; `retention` and `storage` are excluded because the create-only guard owns them
- `droppedSubjects(existingSubjects, configured)` keeps the server's subjects that no configured pattern covers, matched through `natsSubjectMatches()`; `divergingCreateOnlyFields(config, stream)` compares `storage` and `retention` only when the application declared them
- `decideStamp(metadata, desiredHash)` drives the write: `noop` → `streams.update()` is not called at all; `update` → `stampMetadata(metadata, hash, prevHash)` copies the server's existing metadata map in first, then sets `onebun.config-hash`, `onebun.prev-config-hash` and `onebun.reconciled-at`; `cycle` → `streamCycleMessage()` naming `divergingStreamFields()`
- Every failure routes through `failStream()`, which emits `onError` before the error is thrown — `ensureAllStreams()` runs during `connect()`, before any `@OnQueueError` handler is registered, so a throw alone would reach nobody
- `streamWriteFailureMessage()` appends the nats-server 2.10 metadata hint when the cause matches `/requires server/i`

</llm-only>

**Consumer defaults.** `consumerConfig` supplies the values every subscription starts from:

```typescript
const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: JetStreamQueueAdapter,
    options: {
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
      consumerConfig: {
        ackWait: 30 * 1e9,  // nanoseconds the server waits for an acknowledgement
        maxDeliver: 5,      // deliveries before the message goes to the dead-letter queue
        maxAckPending: 200, // messages delivered but not yet acknowledged
      },
    },
  },
});
```

Per-subscription options win over these defaults, field by field:

- **`max_ack_pending`** — the rule is *prefetch overrides consumerConfig.maxAckPending*, and `100` applies when neither is set. The pull batch is the smaller of the resolved `max_ack_pending` and `prefetch` (`10` when `prefetch` is absent), so a batch can never outrun the acknowledgement window.
- **`max_deliver`** — `retry.attempts` on `@Subscribe` overrides `consumerConfig.maxDeliver`, and `3` applies when neither is set.
- **`ack_wait`** — `ackTimeout` on `@Subscribe` overrides `consumerConfig.ackWait`, and 30 seconds (`30_000_000_000` nanoseconds) applies when neither is set.

**`ackTimeout`: how long a handler may hold a message.** It is the per-subscription form of `ack_wait` — the window the server waits for an acknowledgement before it assumes the consumer died and redelivers. Mind the units: `ackTimeout` is in milliseconds, like every other duration in `@onebun/core`, while `consumerConfig.ackWait` is in nanoseconds, because it is a NATS-native value passed through untouched. The adapter converts, so `ackTimeout: 30_000` and `ackWait: 30 * 1e9` describe the same window.

Set it per handler when one subscription's work is slower than the rest: a handler that routinely runs longer than `ack_wait` is redelivered while it is still working, and the same message is then processed twice concurrently. Raising `ackTimeout` for that one handler costs nothing elsewhere.

Changing `ackTimeout` does not require deleting anything. It belongs to the hashed consumer configuration rather than to the durable name, so an existing durable consumer is reconciled in place on the next start, keeping its position and its backlog — no `nats consumer rm`, and no second consumer splitting the group's load. Two processes that disagree on it fail startup with a reconcile-cycle error naming `ack_wait` and both values, rather than rewriting each other's consumer on every deploy.

`ackTimeout` has no effect under `ackMode: 'none'`: the server tracks no acknowledgements there, so `ack_wait` is never sent and there is no redelivery for it to govern.

<llm-only>

**Technical details for AI agents — ackTimeout:**
- ackTimeout is resolved before consumerConfig.ackWait and is part of the hashed consumer config subset
- The precedence chain is `ackTimeout -> consumerConfig.ackWait -> DEFAULT_ACK_WAIT_NANOSECONDS`, resolved once at the head of `resolveConsumerConfig()` in `packages/nats/src/jetstream.adapter.ts`. The test is `options?.ackTimeout !== undefined`, not `??`, so the field's presence decides, and the conversion is `options.ackTimeout * NANOSECONDS_PER_MILLISECOND`
- Units differ by layer on purpose: `SubscribeOptions` lives in `@onebun/core`, where every duration is milliseconds; nanoseconds appear only on the NATS-native adapter types, so `NANOSECONDS_PER_MILLISECOND` is declared beside `DEFAULT_ACK_WAIT_NANOSECONDS` and applied at exactly one site
- It deliberately does NOT participate in the durable name. Identity stays per (group, pattern), so a changed `ackTimeout` reaches `consumers.update()` — a disagreement surfaces as the config-stamp cycle throw instead of silently splitting one group's load across two consumers
- Because `ack_wait` was already in the hashed subset, no stamp code changed: `decideStamp` returns `noop` for an unchanged value and `update` for a changed one, and the cycle message reports each diverging field with BOTH values (`ack_wait (this process 45000000000, on server 30000000000)`) — the two config hashes identify the writers but are not actionable on their own
- Under `ackMode: 'none'` `resolved.tracksDelivery` is false, so `redeliveryConfig()` spreads `{}` and `ack_wait` is absent from the payload regardless of `ackTimeout`; `divergingFields()` returns before comparing it for the same reason
- Only the JetStream adapter implements it. In-memory, Redis and core NATS have no server-side acknowledgement window, so they ignore the field.

</llm-only>

Consumers are always created with an explicit acknowledgement policy, under both `ackMode: 'auto'` and `ackMode: 'manual'`. `ackMode` selects *who* acknowledges — the adapter on the handler's behalf, or the handler itself — never whether the server tracks acknowledgements. Server-side tracking is what makes `ackWait`, `maxDeliver`, `maxAckPending`, `message.ack()`, `message.nack()`, retries and the dead-letter queue work at all.

**Negative acknowledgement.** `nack(true)` asks the server to redeliver the message immediately; it counts against `maxDeliver`, and once that is exhausted the message stops. `nack(false)`, and the bare `nack()`, terminate the message instead: the server drops it permanently, it is never redelivered, and the delivery does not consume a `maxDeliver` attempt. Terminating does not move the payload anywhere — publish it yourself first if you need it kept.

**A consumer that vanishes.** If the consumer is deleted server-side — by an operator, by an ephemeral timing out, or by a stream being recreated — the client does not fail. It retries internally forever, so the subscription simply stops receiving while `isConnected()` keeps reporting healthy. The adapter now watches the consumer's notification channel: a deleted or missing consumer emits `@OnQueueError` and is re-created automatically from the same configuration the subscription was built with, and delivery resumes without a restart.

One consequence is unavoidable and worth planning for: deleting a consumer destroys its position on the server, so messages published while it was gone are not delivered to the re-created one. They remain in the stream, subject to its retention, but this subscription will not see them. Nothing the client does can recover a position the server no longer has.

`heartbeats_missed` and `stream_not_found` are reported to `@OnQueueError` as well but are deliberately not repaired: a missing stream is an operator problem, and re-creating a consumer against a stream that does not exist cannot help.

**Messages the adapter cannot read.** A payload that fails to parse, or one that parses as JSON but carries no `data` field and so is not a OneBun envelope, is `term()`ed — terminated on the server and never redelivered — and the failure is emitted to `@OnQueueError` with the subject and the underlying parse error. It is not acknowledged and it is not retried: a payload that does not parse will not parse on a redelivery either, so `maxDeliver` attempts would only spend the acknowledgement window on a message that can never succeed. The message is never handed to your handler with an undefined payload. This most often means another producer publishes to a subject this application subscribes to.

Errors from the consume loop itself — a vanished consumer, a broken connection — now reach `@OnQueueError` as well, instead of being swallowed where a failing consumer looked exactly like an idle one.

**Consumer identity.** A subscription that declares a `group` gets a durable consumer named `${group}--${filterSubject}--${digest}`: the group and the subject with every character outside `[-\w]` — the `.`, `*` and `>` a subject is made of among them — replaced by an underscore, followed by a short digest of the raw pair. The digest is not decoration. Sanitisation is lossy: `orders.*` and `orders.>` both reduce to `orders__`, as do `orders.new` and `orders_new`, and `--` is itself legal inside a group name — without the digest those pairs would share one consumer. A durable is therefore per (group, pattern), not per group. Two handlers sharing a group but filtering different subjects are two consumers, each fed by its own subject; naming both after the group alone made the second silently take the first's consumer over, so one subject received everything and the other received nothing. The same pattern in the same group still resolves to a single durable, which is exactly what lets several instances of a service share the work — load balancing is unchanged.

A subscription without a `group` is ephemeral. It is named after a freshly generated identifier no concurrent subscription can produce, it is never shared with another handler or another process, and it receives only messages published *after* the subscription starts: whatever the stream already holds is not replayed to it. A durable behaves the same way the first time it is created, and afterwards resumes where it left off — a consumer's name, its durability and its delivery policy are fixed when it is created, and reconciliation never rewrites them.

<llm-only>

**Technical details for AI agents — consumer identity:**
- Consumer identity is derived per (group, pattern) in `subscribe()` (`packages/nats/src/jetstream.adapter.ts`): with a group the name is the sanitised group, `--`, the sanitised filter subject (the pattern with `#` rewritten to `>`); without one it is `consumer-${crypto.randomUUID()}`. `isDurable` is `Boolean(options?.group)` and is threaded into `ensureConsumer()`/`addConsumer()`
- Consumer names are sanitised with [^-\w] -> _ before they reach consumers.add, then suffixed with a 12-hex digest of the raw (group, subject) pair because that sanitisation is lossy — `sanitizeConsumerName()`, applied to the group and the filter subject separately, because the client's `validName` accepts neither subject separators nor wildcards
- The old scheme was the bare group name, so a second subscription in the same group with a different pattern resolved to the SAME consumer and overwrote its `filter_subject`; the old ephemeral name was `consumer-${Date.now()}`, so two group-less subscriptions created inside one millisecond collided. A residual collision is not silent: the ephemeral branch of `ensureConsumer()` fails startup rather than adopting a consumer someone else owns
- Group-less means ephemeral: deliver_policy new, deleted on unsubscribe/disconnect, while durables are never implicitly deleted — `addConsumer()` sends `durable_name: isDurable ? consumerName : undefined` with `name` always set, and sends no `inactive_threshold`, leaving the server's own default to decide how long an idle ephemeral lingers
- `deliver_policy` is explicit, not left to the server: `subscribe()` passes `jsModule.DeliverPolicy.New` into `resolveConsumerConfig(ackPolicy, deliverPolicy, options, consumerConfig)`, so a consumer created against a stream that retains messages starts at the subscription instead of replaying the backlog once
- ack_policy, deliver_policy, durable_name and name are immutable on an existing consumer, so they are creation-only: only `addConsumer()` sends them, and the `consumers.update()` call in `ensureConsumer()` sends `ack_wait`, `filter_subject`, `max_ack_pending`, `max_deliver` and `metadata` — nothing else
- Consumer metadata is owned solely by the config-hash stamp in ensureConsumer(); identity is not part of the hashed subset, so two subscriptions differing only in `group` carry different durable names and the same config hash

</llm-only>

**Reconciliation on subscribe.** Each `@Subscribe` reconciles its consumer during startup rather than blindly creating one. The adapter first asks the server for the consumer; only a genuine "consumer not found" rejection counts as absence and leads to a create. Any other rejection — permissions denied, JetStream disabled, a transport timeout — is reported as itself instead of being mistaken for a missing consumer. When the consumer already exists, the adapter compares its stored configuration against the desired one, and **an unchanged consumer configuration performs no update at all**. A changed configuration is rewritten in place, carrying every pre-existing metadata key forward. Startup fails loudly, and `onError` fires, when the existing consumer cannot be reconciled safely: a subscription without a `group` whose generated name is already taken, a consumer whose acknowledgement policy is not explicit, or a consumer that two processes are rewriting with different configurations in a reconcile cycle.

The reconciliation stamp lives in JetStream consumer metadata, which requires nats-server 2.10 or newer.

**Publishing requires a bound subject.** JetStream stores a message only if some stream on the broker binds its subject, and the server's own rejection for an unbound subject is `jetstream is not enabled` — which names neither the subject nor the streams, and sends operators looking for a JetStream that is disabled when it is not. The adapter re-reports it with the context the server omits, keeping the original rejection as the error's `cause`:

```
Failed to publish OneBun pattern "orders.created" to JetStream subject "orders.created". The most common cause is that no stream on the broker binds that subject. This application declares "EVENTS" (events.>). ...
```

There is no pre-flight check against the `streams` this application declares. A subject may legitimately be bound by a stream some other service owns, so the publish is always attempted and only the broker decides.

**Graceful shutdown waits for running handlers.** `unsubscribe()` and `disconnect()` do not resolve until the handler each subscription is currently executing has finished. This matters because an acknowledgement published after the connection closes is buffered and then dropped without raising anything: the handler completes, its `ack()` goes nowhere, the server redelivers after `ackWait`, and the work runs a second time on the next boot. Since `QueueService.stop()` unsubscribes every subscription during graceful shutdown, that happened on every deploy — to exactly the handler shape that charges a card or sends an email.

The wait is bounded by a fixed **30 seconds**, matching the default `ackWait`: past that point the server has already redelivered the message, so waiting longer cannot prevent the duplicate. A handler that has not returned by then is left running and shutdown proceeds without it. The timeout is not configurable — keep handlers shorter than `ackWait`, and if a unit of work genuinely takes longer, acknowledge it early and track its completion yourself.

Shutdown stops pulling before it waits: `disconnect()` marks every subscription as no longer running first, so each consume loop hands its next message back to the server instead of starting one more handler for the drain to wait on. At most one handler per subscription is ever in flight.

::: warning Consumers created before this release must be deleted once
Consumers created by an earlier OneBun release carry a non-explicit acknowledgement policy, under which acknowledgements, `ackWait`, `maxDeliver`, `maxAckPending`, retries and the dead-letter queue were all inert — a handler that threw was never redelivered. A consumer's acknowledgement policy cannot be changed in place, so `subscribe()` refuses to start against such a consumer and names it in the error. Delete it once and let OneBun recreate it:

```bash
nats consumer rm <STREAM> <CONSUMER>
```
:::

<llm-only>

**Technical details for AI agents:**
- Wire values are resolved once per subscription by `resolveConsumerConfig(ackPolicy, deliverPolicy, options, consumerConfig)` in `packages/nats/src/jetstream.adapter.ts` — the single source of truth. `maxAckPending = options?.prefetch ?? consumerConfig?.maxAckPending ?? 100`; `maxDeliver = options?.retry?.attempts ?? consumerConfig?.maxDeliver ?? 3`; `ackWait = options?.ackTimeout !== undefined ? options.ackTimeout * 1_000_000 : consumerConfig?.ackWait ?? 30_000_000_000`; `consumeBatch = Math.min(maxAckPending, options?.prefetch ?? 10)`
- `consumerConfig.maxAckPending` was declared but read nowhere before this change — it is now wired through `resolveConsumerConfig()`
- `ackPolicy` is always `AckPolicy.Explicit`, passed into `resolveConsumerConfig()` from `subscribe()` for both `ackMode: 'auto'` and `ackMode: 'manual'`. It arrives as a parameter, together with `deliverPolicy`, so the function stays synchronous and needs no access to the dynamically imported client module. Previously any mode other than `'manual'` produced `ack_policy: none`, under which the server tracks no acknowledgements and every ack-dependent feature is inert
- `Message.nack(true)` calls `jsMsg.nak()` with NO argument — `nak(millis?: number)` takes a delay, and passing anything non-numeric reaches the wire as a null delay, which is a plain nak. `nack(false)` and the bare `nack()` call `jsMsg.term()`. `term(reason?)` accepts a reason string only on nats-server 2.11+, so the adapter deliberately calls it bare
- `ensureConsumer()` is probe-first: it calls `jsm.consumers.info(stream, consumer)` before anything else, never a blind `consumers.add()` inside a bare `catch {}`
- Rejections are classified by NUMERIC API code via `isNotFoundError(err, jsModule.JetStreamApiCodes.ConsumerNotFound)` (`ConsumerNotFound` = `10014`). Only that code means absence → `addConsumer()` creates the consumer and stamps the desired hash. Every other rejection emits `onError` and is rethrown as itself. `code` is read by plain property access, not `Object.hasOwn` — the client exposes it as a prototype getter over a private field, so own-property checks, spreading and JSON round-trips lose it
- When `info` resolves, the branch order is: (1) not durable (`options.group` absent) → hard fail, an ephemeral must not hijack an existing consumer; (2) `config.ack_policy !== AckPolicy.Explicit` → hard fail naming `nats consumer rm <stream> <consumer>`, asserted positively against `Explicit` and checked **before** the hash comparison, because a legacy consumer can carry a matching hash and a stamp-first order would return `noop` with acknowledgements still disabled; (3) `decideStamp(metadata, desiredHash)`
- `decideStamp` returns `noop` when the applied hash equals the desired one — the consumer is left untouched: consumers.update is not called
- `decideStamp` returns `cycle` when the desired hash sits in the previous-hash key and the reconcile timestamp is within `CONFIG_CYCLE_WINDOW_MS` (300000 ms) — two writers disagreeing. A missing or unparseable timestamp counts as *inside* the window. The error names the diverging fields via `divergingFields()`
- `decideStamp` returns `update` otherwise; `stampMetadata(existing, hash, prevHash)` copies the server's existing metadata map in first, because the client's update merges with a shallow `Object.assign` and the map sent replaces the server's wholesale — any key not carried forward is destroyed
- Three metadata keys, `CONFIG_STAMP_KEYS` in `packages/nats/src/config-stamp.ts`: `onebun.config-hash` (currently applied), `onebun.prev-config-hash` (the hash it replaced, deleted rather than left stale when absent), `onebun.reconciled-at` (ISO-8601 of the last write). Consumer metadata requires nats-server 2.10 or newer
- The hash is the first 32 hex characters of a sha256 over the sorted subset `{ ack_wait, filter_subject, max_ack_pending, max_deliver }` (`hashReconcileConfig()`); array values are sorted through a copy and `undefined` keys dropped, so declaration order is not a config change
- Every failure branch routes through `failConsumer()`, which emits `onError` **before** throwing — `subscribe()` is awaited during boot, before any `@OnQueueError` handler is registered, so a throw alone would reach nobody
- `config-stamp.ts` is package-internal and deliberately not re-exported from `src/index.ts`
- `JetStreamSubscriptionEntry.inFlight` holds the promise of the handler currently executing, assigned inside the SAME try that catches a handler failure — never a second wrapper, which would report every failure twice — and cleared in that try's `finally`. At most one is pending per entry, because the consume loop awaits each handler before pulling the next message
- `drainHandlers(entries)` awaits those promises through `awaitBounded(Promise.allSettled(pending), HANDLER_DRAIN_TIMEOUT_MS)` (30000 ms, deliberately equal to the default `ack_wait`), then clears `inFlight` on every entry so a later release does not restart the wait. `awaitBounded` clears its own timer on settle — a pending 30s timer would keep the process alive past the shutdown that created it
- `releaseSubscription(entry)` drains AFTER clearing `running` and the restart timer but BEFORE closing the pull handle and deleting an ephemeral, so the handler can still acknowledge over a live connection
- `disconnect()` clears `running` on every entry, then drains once, then runs the releases under a separate `RELEASE_TIMEOUT_MS` (5000 ms) bound: 30s belongs to the application's handler, 5s to the network teardown that follows it. `client.disconnect()` is called only after both

</llm-only>

### Consumer Lifecycle (JetStream)

A subscription that declares no `group` gets a framework-generated ephemeral consumer. Nothing
outside the process can address it, so it is deleted when the subscription ends — on
`unsubscribe()` and on `disconnect()`. Without that, every restart left another consumer behind
on the server.

A subscription that declares a `group` gets a durable, and a durable is never deleted
implicitly. That is deliberate rather than an omission: `QueueService.stop()` unsubscribes every
subscription on graceful shutdown, so deleting durables here would discard their position on
every deploy and redeliver everything already acknowledged. A durable exists precisely to
survive restarts. Delete one when you actually mean to, with `nats consumer rm <stream> <consumer>`.

```typescript
// Ephemeral: no group. The consumer is gone once the subscription ends.
const temporary = await queueService.subscribe('events.created', handler);
await temporary.unsubscribe();   // the server-side consumer is deleted

// Durable: group set. Survives unsubscribe, restart and redeploy.
const worker = await queueService.subscribe('events.created', handler, { group: 'workers' });
await worker.unsubscribe();      // the consumer, and its position, remain
```

Pausing loses nothing. `pause()` stops the adapter pulling new batches, and a message already
pulled when the pause lands is `nak()`ed and redelivered on `resume()`, not abandoned — an
abandoned message would occupy the acknowledgement window until `ackWait` expired.

**A `group` names a permanent server resource — do not template it per run or per deploy.** The durable is named from the group and the pattern together (`${group}--${filterSubject}--${digest}`), so a group built from a build number, a pod name or a timestamp creates a brand-new consumer every time and leaves the previous one behind forever. Streams accumulate them, each holding its own position and its own `max_ack_pending` budget. Pick a group that names the *role* — `order-processors` — not the deployment.

`group` also means two different things depending on the adapter, and the difference is not cosmetic. On `NatsQueueAdapter` it is a stateless NATS queue group: the broker round-robins between whoever is connected right now, and nothing survives them. On JetStream it provisions a durable consumer that outlives every process. The same option, the same value, one transient and one permanent.

**Decommissioning one.** When a durable genuinely has to go — a retired handler, or a trail left by a templated group — `deleteDurableConsumer()` is the supported way. It is not on the `QueueAdapter` interface, because only JetStream has durables, so it needs a downcast:

```typescript
import { JetStreamQueueAdapter } from '@onebun/nats';

const adapter = queueService.getAdapter() as JetStreamQueueAdapter;

await adapter.deleteDurableConsumer('orders.created', 'order-processors');
// true  — the consumer was removed
// false — there was no such consumer; safe to call twice
```

It resolves the stream strictly: if no declared stream binds the pattern it throws and names every stream the application declares, rather than falling back to the first one. On a destructive call a mistyped pattern must not delete a consumer on an unrelated stream. A permissions denial is rethrown as itself — only a genuine consumer-not-found produces `false`.

Subscribing again with the same `(pattern, group)` after a delete creates a fresh durable under the same name. Fresh means fresh: a new consumer carries `deliver_policy: new`, so it starts from the moment it is created and does not replay what the stream still holds. Deleting a durable therefore discards its position permanently — that is the cost, and it is why `unsubscribe()` never does it for you.

<llm-only>

**Technical details for AI agents:**
- Delete the ephemeral consumer on unsubscribe and disconnect; never delete a `group` durable implicitly. `entry.durable` is set at subscribe time from `Boolean(options.group)` and is the only gate on `consumer.delete()`
- `releaseSubscription(entry)` clears the restart timer, drains the in-flight handler, closes the pull handle and then, only for an ephemeral, deletes the consumer. `disconnect()` drains every subscription first, then runs every release under `Promise.allSettled` with a bounded timeout BEFORE `client.disconnect()`, because the delete needs a live connection; a release skips the delete entirely when `client.isConnected()` is already false
- The delete goes through `entry.consumer.delete()`, not the manager — `this.jsm` is nulled during disconnect
- `entry.paused` is checked BEFORE `consumer.consume()`, so a paused subscription pulls nothing; the restart timer keeps re-checking so `resume()` needs no extra wiring
- A message pulled and then dropped because the subscription paused or stopped is `nak()`ed, never left to age out of `ackWait`
- `deleteDurableConsumer(pattern, group)` is the ONLY code path that removes a durable. It resolves the stream through `requireStreamForSubject()`, a strict variant that THROWS when nothing matches — `resolveStreamForSubject()` keeps its `resolvedStreams[0]` fallback for publish/subscribe, which would be a footgun on a destructive call
- It returns `false` only for `JetStreamApiCodes.ConsumerNotFound`; every other rejection is rethrown as itself, so a permissions denial is never reported as "already gone"
- The consumer name is derived by the same `durableConsumerName(group, toNatsSubject(pattern))` that `subscribe()` uses, so the pair that created a durable is the pair that removes it

</llm-only>

### Dead Letter Queue

A message whose handler keeps failing eventually runs out of attempts. Without a dead-letter queue the server simply stops redelivering it and the application never hears about it again. `deadLetter` gives that message somewhere to go:

```typescript
@Subscribe('orders.created', {
  deadLetter: { queue: 'orders.dlq', maxRetries: 5 },
})
async handleOrder(message: Message<OrderData>) {
  await this.processOrder(message.data);   // throws often enough and it lands in orders.dlq
}
```

**How many attempts.** `maxRetries` sets the server's `max_deliver`, behind `retry.attempts`. The full order is `retry.attempts` → `deadLetter.maxRetries` → `consumerConfig.maxDeliver` → `3`. `retry.attempts` stays first so any configuration written before dead-letter queues existed keeps the exact `max_deliver` it had.

**What happens on the last attempt.** The payload is republished to `deadLetter.queue` **first**, and only once that succeeded is the original terminated. If the republish fails, the original is deliberately left alone — the server redelivers it or exhausts `max_deliver` as it always would — and the failure is reported to `@OnQueueError`. Terminating first and republishing second would turn a failed republish into a lost message, which is the one outcome a dead-letter queue exists to prevent.

The same routing happens when a handler under `ackMode: 'manual'` calls `message.nack(false)` — or the bare `message.nack()`, which means the same thing. That is deliberate: `nack(false)` already means *never deliver this again*, so with a dead-letter queue configured it parks the message rather than discarding it. `nack(true)` still asks for redelivery.

**What arrives in the queue.** The republished message keeps the original `id`, and its `metadata` gains three provenance keys alongside whatever the producer set:

```typescript
@Subscribe('orders.dlq')
async inspectFailures(message: Message<OrderData>) {
  message.metadata['dlq.originalPattern'];  // 'orders.created'
  message.metadata['dlq.deliveryCount'];    // 5
  message.metadata['dlq.error'];            // the handler's error message
}
```

**`deadLetter.queue` must be a literal subject, bound by a declared stream.** A wildcard (`*`, `#`, `>`) is rejected, because a message is published to exactly one subject; so is a queue equal to the subscription's own pattern, which would hand every dead letter straight back to the handler that just rejected it. Both throw from `subscribe()` at startup, not on the first failure. The `agent_dlq` stream in the [JetStreamQueueAdapter](#jetstreamqueueadapter) example above is the shape to copy — the dead-letter subject needs a stream just like any other.

**What happens to the original.** `term()` removes it under `retention: 'workqueue'` and `'interest'`. Under the default `retention: 'limits'` the payload stays in the source stream until retention evicts it — terminating only stops redelivery. Either way the dead-letter copy is a normal stored message with its own retention, so it survives independently of the original.

::: warning Redis behaves differently for now
The Redis adapter routes dead letters to `queue:dlq:${pattern}` and ignores both `deadLetter.queue` and `deadLetter.maxRetries` — it treats `deadLetter` as an on/off flag. Aligning it with the semantics above is tracked separately.
:::

<llm-only>

**Technical details for AI agents — dead-letter queue:**
- `deadLetter.maxRetries` is resolved once in `resolveConsumerConfig()` in `packages/nats/src/jetstream.adapter.ts`: `options?.retry?.attempts ?? options?.deadLetter?.maxRetries ?? consumerConfig?.maxDeliver ?? 3`. Nothing outside that function computes `max_deliver`
- `routeToDeadLetter(entry, msg, message, error)` is the ONLY code that publishes to `deadLetter.queue`. It has exactly two triggers: the auto-nack branch of the consume loop when `msg.info.deliveryCount >= max_deliver`, and `JetStreamMessage.nack(false)` — which receives it as a closure built at message construction, so it is `undefined` when no queue is configured and the bare `term()` behaviour is unchanged
- Order inside the helper is load-bearing: `await this.publish(queue, …)` first, `msg.term()` only after it resolves. On a rejected republish it emits `onError` with the rejection as `cause` and returns WITHOUT terminating
- The republish goes through the adapter's own `publish()`, never a second raw `js.publish`, so subject translation, `resolveStreamForSubject()` and the publish diagnostics all apply to dead letters unchanged
- Envelope: `messageId` carries the original id; `metadata` is the original map spread first, then `dlq.originalPattern`, `dlq.deliveryCount` and `dlq.error`. `MessageMetadata` has an index signature, so no `any` is involved
- `validateDeadLetterQueue(queue, pattern)` runs in `subscribe()` before the consumer is created: it rejects any token that is `*`, `>` or contains `#`, and rejects `queue === pattern`
- A dead-letter queue is impossible under a non-explicit ack policy — the server tracks no delivery state, so there is no terminal delivery to detect

</llm-only>

## Feature Support Matrix

| Feature | Memory | Redis | NATS | JetStream |
|---------|--------|-------|------|-----------|
| Pattern subscriptions | ✅ | ✅ | ✅ ¹ | ✅ ¹ |
| Delayed messages | ✅ | ✅ | ❌ | ❌ |
| Priority | ✅ | ✅ | ❌ | ❌ |
| Consumer groups | ❌ | ✅ | ✅ | ✅ |
| Dead letter queue | ❌ | ✅ | ❌ | ✅ |
| Retry | ❌ | ✅ | ❌ | ✅ |
| Scheduled jobs | ✅ | ✅ | ✅ | ✅ |
| Persistence | ❌ | ✅ | ❌ | ✅ |
| Publish deduplication | ❌ | ❌ | ❌ | ✅ |
| Acknowledgments | ✅ | ✅ | ❌ ² | ✅ |

¹ On NATS and JetStream `#` must be the final token of a pattern — see
[Pattern Syntax](#pattern-syntax).

² `NatsQueueAdapter` accepts every `ackMode` and rejects nothing, but core NATS has no
acknowledgement protocol at all, so `message.ack()` and `message.nack()` are permanent
no-ops there — see [NatsQueueAdapter](#natsqueueadapter).

## Publishing Messages

### QueueService: availability and injection

**QueueService is available via DI.** You can inject it in the constructor of controllers, providers, WebSocket gateways, and middleware (e.g. `constructor(private queueService: QueueService)`). The framework registers a proxy in the module before creating controllers; when the queue is enabled during `app.start()`, the proxy delegates to the real `QueueService`. No wrapper or `getQueueService()` is required for normal DI-based code.

**When is the real QueueService created?**  
The queue system is initialized during `app.start()`, after the module is set up, inside `initializeQueue()`. It is only created when the queue is enabled, which happens when any one of three conditions holds: at least one controller has queue decorators (`@Subscribe`, `@Cron`, `@Interval`, `@Timeout`); `queue.enabled: true` is present in application options; or a backend is explicitly configured via `queue.adapter`, `queue.options` or `queue.redis`. An explicit `queue.enabled: false` overrides a configured backend and keeps the queue disabled — one warning is logged and the adapter is never constructed.

**If the queue is not enabled but you injected QueueService:**  
The injected instance is a proxy. Any call to a method (e.g. `publish()`, `subscribe()`) will throw an error with a message explaining how to enable the queue (register a controller with queue decorators, set `queue.enabled: true` in application options, or configure a backend via `queue.adapter`, `queue.options` or `queue.redis` — the message also states that an explicit `queue.enabled: false` overrides a configured backend and keeps the queue disabled).

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

**`messageId` and deduplication.** On JetStream the id is sent as the `Nats-Msg-Id` header, and the server refuses a second message carrying an id it has already seen inside the stream's deduplication window. That makes an outbox safe to replay: publishing the same logical message twice stores it once. The duplicate is dropped *server-side* and `publish()` still resolves normally — there is no error and no local signal, so do not treat a resolved publish as proof that a new message was stored.

Only an id you supply enables this. When `messageId` is omitted — or empty — the adapter generates one, uses it as `Message.id`, and sends no header: a generated id is unique per call and would only grow the server's deduplication index. On the memory, Redis and core-NATS adapters `messageId` is echoed back as `Message.id` and nothing more.

The window is per stream and defaults to two minutes, which is usually too short for a crash-and-restart cycle. Widen it with `duplicateWindow`, in nanoseconds:

```typescript
streams: [
  {
    name: 'ORDERS',
    subjects: ['orders.>'],
    duplicateWindow: 10 * 60 * 1e9,   // 10 minutes
  },
]
```

It is sent only when you declare it, on both the create and the update path, so a window an operator set out of band is never reset by a deploy.


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
