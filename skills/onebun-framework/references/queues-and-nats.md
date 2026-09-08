# Queues, NATS, and JetStream — Full Reference

## Queue System Overview

The queue system in `@onebun/core` provides a unified API across multiple backends.
Queue handlers are discovered only in classes listed in a module's `controllers` array —
placing them in `providers` will silently skip them. The queue system is enabled when **any**
of these holds:

1. a controller carries a `@Subscribe`, `@Cron`, `@Interval`, or `@Timeout` decorator, or
2. `queue.enabled: true` is set in `ApplicationOptions`, or
3. a backend is explicitly configured via `queue.adapter`, `queue.options`, or `queue.redis`.

**`queue.redis` enables the queue but does not select the Redis adapter.** Enablement and adapter
selection are two independent decisions and only `queue.adapter` makes the second one — the adapter is
literally `queueOptions?.adapter ?? 'memory'`. So `queue: { redis: { url } }` on its own boots the
**in-memory** adapter, logs "Queue system initialized with in-memory adapter", and silently ignores
every Redis setting you passed. Always write both: `queue: { adapter: 'redis', redis: { url } }`.

An explicit `queue.enabled: false` overrides all three and keeps the queue disabled: the app
logs exactly one warning naming the contradiction and does not throw — the adapter is never
constructed, and an injected `QueueService` will throw.

Because an explicitly configured backend enables the queue on its own, a producer-only
application — one that configures an adapter and publishes but has no `@Subscribe` handler
anywhere — now constructs and connects its adapter during `app.start()`. Such an app fails to
boot when the broker is unreachable, where it previously started fine and discarded every
`publish()`.

## Message Type

```typescript
interface Message<T> {
  id: string;                    // unique message ID
  pattern: string;               // message topic/pattern
  data: T;                       // payload
  timestamp: number;             // unix timestamp (ms)
  metadata: MessageMetadata;     // headers, auth token, service ID, trace context
  redelivered?: boolean;
  attempt?: number;              // current retry attempt
  maxAttempts?: number;

  ack(): Promise<void>;          // acknowledge (manual ack mode)
  nack(requeue?: boolean): Promise<void>;  // negative ack; requeue=false (the default) means
                                           // never redeliver — JetStream term()s it, Redis sends
                                           // it to deadLetter if configured, memory drops it,
                                           // plain NATS does nothing
}
```

Only the JetStream adapter populates `attempt` and `maxAttempts`; on the memory, Redis and core-NATS adapters both fields are always `undefined`.

## Decorators

### @Subscribe(pattern, options?)

<!-- typecheck: skip -->
```typescript
@Subscribe('events.created', {
  ackMode: 'auto' | 'manual' | 'none',  // default: 'auto'
  ackTimeout: 30_000,                 // ms — ack deadline before redelivery
  prefetch: 10,                       // max in-flight unacked + pull batch size
  group: 'worker-group',              // consumer group for load balancing
  retry: {
    attempts: 3,
    backoff: 'fixed' | 'linear' | 'exponential',
    delay: 1000,                       // ms
  },
  deadLetter: {
    queue: 'events.dead',
    maxRetries: 5,
  },
})
async handleEvent(message: Message<MyPayload>) { ... }
```

On JetStream `prefetch` becomes the consumer's `max_ack_pending` and also caps the pull batch,
`retry.attempts` becomes `max_deliver`, and `ackTimeout` becomes `ack_wait`; all three override the
adapter-level `consumerConfig`.

Under 'none' there is no redelivery and no dead-letter routing on any adapter. `retry`, `deadLetter`,
`ack_wait`, `max_deliver` and the `attempt`/`maxAttempts`/`redelivered` fields all go inert with it;
JetStream creates the consumer with `ack_policy: none` and omits the redelivery knobs, Redis skips both
the requeue and the dead-letter branch, memory suppresses `nack(true)`, and `NatsQueueAdapter` never had
an acknowledgement protocol to begin with. A failing handler still emits `onMessageFailed`.

`deadLetter` is honoured on JetStream. `max_deliver` resolves as `retry.attempts` ->
`deadLetter.maxRetries` -> `consumerConfig.maxDeliver` -> 3.

JetStream routes the terminal delivery to deadLetter.queue and term()s the original — republishing first, terminating only once that succeeded, so a failed republish leaves the message for the server to redeliver rather than losing it.

Redis ignores deadLetter.queue and deadLetter.maxRetries: it treats `deadLetter` as an on/off flag and routes to `queue:dlq:${pattern}`.

The same routing applies to `message.nack(false)` (and the bare `nack()`) under `ackMode: 'manual'`;
`nack(true)` still asks for redelivery. The republished message keeps its original `id` and gains
`dlq.originalPattern`, `dlq.deliveryCount` and `dlq.error` in `metadata`. `deadLetter.queue` must be a
literal subject bound by a declared stream — a wildcard, or a queue equal to the subscription's own
pattern, throws from `subscribe()` at startup.

### @Cron(expression, options)

`options` is **required** here, unlike `@Subscribe` — `pattern` is a required field of
`CronDecoratorOptions`. A scheduled method does not just run: the framework publishes its return value
as a message, and `pattern` is the only address that message can go to. `@Cron(CronExpression.EVERY_HOUR)`
alone is `TS2554: Expected 2 arguments, but got 1`. Same for `@Interval` and `@Timeout`.

<!-- typecheck: skip -->
```typescript
@Cron(CronExpression.EVERY_HOUR, {
  pattern: 'cleanup.hourly',          // message pattern for the job
  metadata: { source: 'scheduler' },
  name: 'hourly-cleanup',             // unique job name
  overlapStrategy: 'skip' | 'queue',  // default: 'skip'
})
getCleanupData() { return { timestamp: Date.now() }; }
```

### @Interval(ms, options) / @Timeout(ms, options)

`options` is required on both, for the same reason: `pattern` is a required field of
`IntervalDecoratorOptions` / `TimeoutDecoratorOptions`. `name` defaults to the method name;
`overlapStrategy` exists on `@Cron` only.

<!-- typecheck: skip -->
```typescript
@Interval(30000, { pattern: 'metrics.collect', name: 'metrics' })
getMetrics() { return { memory: process.memoryUsage() }; }

@Timeout(5000, { pattern: 'startup.warmup', name: 'warmup' })
getWarmupData() { return { type: 'warmup' }; }
```

### Queue Lifecycle Decorators

<!-- typecheck: skip -->
```typescript
@OnQueueReady()         // queue adapter connected
@OnQueueError()         // queue error occurred
@OnMessageReceived()    // message arrived (before handler)
@OnMessageProcessed()   // handler completed successfully
@OnMessageFailed()      // handler threw an error
```

## QueueService API

<!-- typecheck: skip -->
```typescript
// Publishing
await queueService.publish<T>(pattern, data, options?);
await queueService.publishBatch<T>(messages);

// Subscribing programmatically
const sub = await queueService.subscribe<T>(pattern, handler, options?);

// Dynamic job management (all synchronous — no await needed)
queueService.addJob({ type: 'cron', name: 'cleanup', expression: '0 * * * *', pattern: 'jobs.cleanup' });
queueService.addJob({ type: 'interval', name: 'heartbeat', intervalMs: 5000, pattern: 'jobs.heartbeat' });
queueService.addJob({ type: 'timeout', name: 'warmup', timeoutMs: 3000, pattern: 'jobs.warmup' });
queueService.removeJob('cleanup');            // returns boolean
queueService.pauseJob('cleanup');             // clears timers, sets paused: true
queueService.resumeJob('cleanup');            // restarts timers
queueService.updateJob({ type: 'cron', name: 'cleanup', expression: '0 */2 * * *' });
const job = queueService.getJob('cleanup');   // ScheduledJobInfo | undefined
const jobs = queueService.getJobs();          // ScheduledJobInfo[]
queueService.hasJob('cleanup');               // boolean

// Feature detection — pass the string, not an enum member
queueService.supports('delayed-messages');
queueService.supports('consumer-groups');

// Events — the names are the QueueEvents keys, `on`-prefixed camelCase, NOT dotted
queueService.on('onMessageReceived', handler);
queueService.off('onMessageReceived', handler);
```

`QueueFeature` is a string-literal union **type**, not an enum object, and `packages/core/src/queue/index.ts`
re-exports it inside an `export type { ... }` block — so `QueueFeature.DELAYED_MESSAGES` is not merely the
wrong spelling, there is no runtime binding to import at all (`TS2304: Cannot find name 'QueueFeature'`).
The six members: `'delayed-messages' | 'priority' | 'dead-letter-queue' | 'retry' | 'consumer-groups' |
'pattern-subscriptions'`.

`on`/`off` are typed `<E extends keyof QueueEvents>`. The five keys: `onReady`, `onError`,
`onMessageReceived`, `onMessageProcessed`, `onMessageFailed`. Read the key off this list, **not** off the
decorator name — the three message ones match (`@OnMessageReceived` → `'onMessageReceived'`), but the two
queue-level ones do not: `@OnQueueReady` emits `'onReady'` and `@OnQueueError` emits `'onError'`, with no
`Queue` in the key. A dotted name like `'message.received'` is a type error, and if forced through with a
cast it silently never fires — the handler is filed under a key nothing emits.

### Dynamic Job Management

Jobs can be added, removed, paused, resumed, and updated at runtime via `QueueService`.
All management methods are **synchronous** (no async/await needed).

**AddJobOptions** is a discriminated union by `type`:

| Type | Required fields | Description |
|---|---|---|
| `'cron'` | `name`, `expression`, `pattern` | Cron-scheduled job |
| `'interval'` | `name`, `intervalMs`, `pattern` | Repeating interval job |
| `'timeout'` | `name`, `timeoutMs`, `pattern` | One-shot delayed job |

All types support optional: `getDataFn`, `metadata`, `overlapStrategy` (cron only).

**ScheduledJobInfo** returned by `getJob()` / `getJobs()`:

<!-- typecheck: skip -->
```typescript
{
  name: string;
  type: 'cron' | 'interval' | 'timeout';
  pattern: string;
  paused: boolean;
  declarative: boolean;    // true = from decorator, false = from addJob()
  schedule: { cron?: string; every?: number; timeout?: number };
  nextRun?: Date;
  lastRun?: Date;
  isRunning?: boolean;
}
```

Jobs created via `@Cron`/`@Interval`/`@Timeout` decorators are also accessible dynamically
by name (method name by default, or custom via `name` option in decorator).

```typescript
// Filter by origin
const decoratorJobs = queueService.getJobs().filter(j => j.declarative);
const dynamicJobs = queueService.getJobs().filter(j => !j.declarative);
```

### PublishOptions

<!-- typecheck: skip -->
```typescript
{
  delay?: number;                // ms before delivery
  priority?: number;             // higher = more important
  messageId?: string;            // custom message ID
  metadata?: Partial<MessageMetadata>;
  repeat?: {
    pattern?: string;            // cron expression
    every?: number;              // ms interval
    limit?: number;              // max repetitions
    endDate?: Date;
  };
}
```

## Message Guards

**Reach for `@UseGuards` — it is ONE decorator across all three transports** (HTTP routes, WebSocket
handlers, queue `@Subscribe` consumers), works class- and method-level, and resolves guard constructor
dependencies through the owner module's DI container. Resolution happens at **registration**, so a guard
whose dependency cannot be resolved fails `app.start()` with a `DependencyResolutionError` naming it,
instead of throwing once per delivered message and dropping each one.

<!-- typecheck: skip -->
```typescript
import { UseGuards, MessageAuthGuard, createMessageGuard } from '@onebun/core';

// Built-in guards — method-level here; the same decorator on the class covers every @Subscribe in it
@UseGuards(MessageAuthGuard)
@Subscribe('events.admin')
async handleAdmin(message: Message<unknown>) { ... }

// Custom guard — the context has NO `.message` property, only accessors
const OnlyFromServiceA = createMessageGuard((context) => {
  const metadata = context.getMetadata();

  return metadata.serviceId === 'service-a';
});

@UseGuards(OnlyFromServiceA)
@Subscribe('events.internal')
async handleInternal(message: Message<unknown>) { ... }
```

`MessageExecutionContext` exposes `type: 'queue'` plus five accessors — `getMessage<T>()`,
`getMetadata()`, `getPattern()`, `getHandler()`, `getClass()`. `context.message` does not compile
(`TS2339`): `message` is a private constructor field of the impl class, absent from the interface. Every
built-in guard uses `context.getMetadata()`.

**What denial does:** the framework calls `await message.nack(false)` — explicitly no redelivery, because
an authorization decision is deterministic and requeueing would deny the same message forever. JetStream
`term()`s it, Redis routes it to the DLQ when `deadLetter` is configured, memory drops it. On every
adapter `onMessageFailed` fires and `onMessageProcessed` never does, so a denial shows up in metrics as a
failure rather than a success. The framework also logs the denial at `warn`, naming the consumer class,
the method, the pattern and the message id — but **not** which guard denied, so with several guards on
one consumer the log will not tell you which one refused. A guard that *throws* is logged at `error`, and
that line does name the guard; it is then treated as a denial (the queue path has no exception-filter
chain, and failing open would be a silent authorization bypass).

`@UseMessageGuards` still exists and still works — method-level and queue-only, so the type system checks
the context for you. `getMessageGuards()` merges it with the shared `@UseGuards` list, shared first.
**The merge does not deduplicate**: a guard listed under both decorators on the same consumer runs
**twice per message** (on WebSocket the equivalent merge *is* deduplicated — the queue path is the
exception). List each guard under one decorator only.

Built-in message guards: `MessageAuthGuard`, `MessageServiceGuard`, `MessageHeaderGuard`,
`MessageTraceGuard`, `MessageAllGuards`, `MessageAnyGuard`. The four leaf guards — and anything from
`createMessageGuard()` — return `false` (deny) when handed a non-queue context, since `@UseGuards` can put
them on an HTTP route where `getMetadata()` does not exist. The two combinators, `MessageAllGuards` and
`MessageAnyGuard`, check no transport of their own; they only deny on HTTP because their built-in children
do, so a hand-written child needs its own `isQueueContext(context)` check (exported from `@onebun/core`).
Both also take their children in their own constructor at decoration time, before any module exists, so a
child class with a constructor dependency gets nothing: pass already-constructed children, or just write
`@UseGuards(A, B)` and let each be DI-resolved in order.

## Queue Adapters

### Feature Support Matrix

| Feature | InMemory | Redis | NATS | JetStream |
|---|---|---|---|---|
| Pattern subscriptions | Yes | Yes | Yes | Yes |
| Delayed messages | Yes | Yes | No | No |
| Priority | Yes | Yes | No | No |
| Consumer groups | No | Yes | Yes | Yes |
| Dead letter queue | No | Yes | No | Yes |
| Retry | No | Yes | No | Yes |
| Persistence | No | Yes | No | Yes |
| Scheduled jobs | Yes | Yes | Yes | Yes |

### Type-safe adapter configuration

`QueueApplicationOptions` is generic — when you pass a class constructor as `adapter`,
the `options` field is automatically typed to match the adapter's constructor parameter.
No type assertions needed.

```typescript
// Type definition:
interface QueueApplicationOptions<A extends QueueAdapterConstructor = QueueAdapterConstructor> {
  // tri-state: undefined = auto (a queue decorator or an explicit backend enables it),
  // true = force on, false = force off (one warning when a backend is configured)
  enabled?: boolean;
  adapter?: 'memory' | 'redis' | A;
  options?: A extends QueueAdapterConstructor<infer O> ? O : never;  // ← auto-inferred
  // ...
}
```

### InMemoryQueueAdapter (default)

No configuration needed — used automatically when no adapter is specified.

### RedisQueueAdapter

```typescript
const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: 'redis',
    redis: { useSharedProvider: true, prefix: 'myapp:queue:' },
  },
});
```

Delivery is list-based: a message is pushed onto `queue:q:<topic>` and a wake-up frame naming
that topic goes out on the single `queue:wake` channel. Two replicas on the same pattern compete
for a message with an atomic `LPOP` rather than both receiving it, and a message published before
anyone subscribed is still delivered — the list holds it. Pattern subscriptions additionally poll,
finding backlog keys with `SCAN` (never `KEYS`) over the translated glob — see
[Pattern Wildcards](#pattern-wildcards).

## NATS Configuration

### NatsQueueAdapter (fire-and-forget)

```typescript
import { NatsQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: NatsQueueAdapter,       // pass class, not instance
    options: {                       // ← typed as NatsAdapterOptions
      servers: 'nats://localhost:4222',
      token: 'secret',
      maxReconnectAttempts: 10,
      reconnectTimeWait: 2000,
      timeout: 5000,
    },
  },
});
```

- No persistence — messages are fire-and-forget
- Consumer groups via NATS queue groups
- Pattern conversion via `toNatsSubject`: OneBun's `#` wildcard → NATS `>`, and a `{name}` parameter → NATS `*` (automatic)

### JetStreamQueueAdapter (persistent, with acks)

```typescript
import { JetStreamQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: JetStreamQueueAdapter,  // pass class, not instance
    options: {                       // ← typed as JetStreamAdapterOptions
      servers: 'nats://localhost:4222',

      // Required: define which streams handle which subjects
      streams: [
        {
          name: 'EVENTS',
          subjects: ['events.>'],          // NATS wildcard syntax
          retention: 'limits',             // 'limits' | 'interest' | 'workqueue'
          storage: 'file',                 // 'file' | 'memory'
          maxMsgs: 1_000_000,
          maxBytes: 1_073_741_824,         // 1GB
          maxAge: 86_400_000_000_000,      // nanoseconds (24h)
          replicas: 1,
        },
        {
          name: 'COMMANDS',
          subjects: ['commands.>'],
          retention: 'workqueue',
          storage: 'memory',
        },
      ],

      // Optional: defaults merged into each stream definition
      streamDefaults: {
        retention: 'limits',
        storage: 'file',
        replicas: 1,
      },

      // Optional: consumer defaults — every field is a fallback that a @Subscribe
      // option overrides (see the precedence list below)
      consumerConfig: {
        ackWait: 30_000_000_000,            // ack_wait, nanoseconds (default 30s)
        maxDeliver: 5,                      // max_deliver — deliveries before the DLQ (default 3)
        maxAckPending: 100,                 // max_ack_pending — unacked in flight (default 100)
      },
    },
  },
});
```

Key JetStream behaviors:
- **Stream reconciliation**: on connect the adapter probes `streams.info` first, so streams are
  created when absent and reconciled only when their configuration hash changed — an unchanged
  declaration performs no `streams.update` call at all, a changed one is an update that carries
  every pre-existing metadata key forward, and a detected reconcile cycle fails startup. The update
  payload carries **only the keys the application actually declared**, never an explicit
  `undefined`, so limits an operator set out of band on `max_msgs`/`max_bytes`/`max_age` survive
  every restart. Like consumer stamping, the stamp lives in stream metadata and requires
  **nats-server 2.10+**
- **Streams are never narrowed or silently recreated**: a declaration that would no longer cover a
  subject the stream already stores fails startup and names each dropped subject — widening is
  allowed — and a declared `storage` or `retention` that differs from the server's fails startup
  naming the field and `nats stream rm <stream>`, since neither can be changed in place. Both
  guards read the server's own config and run *before* the hash comparison, so a stale stamp left
  by an out-of-band `nats stream edit` cannot wave a narrowing declaration through. A
  `streams.info` rejection is treated as absence only when it carries the numeric `StreamNotFound`
  code (10059) and is otherwise rethrown as itself. Every such failure emits `onError` in addition
  to throwing
- **Create-path-only fields**: `retention`, `storage` and the `num_replicas` default are sent on
  create only — `update` cannot change the first two, and applying a default on update would
  rewrite a value the application never asked about. A value you declare yourself, directly or
  through `streamDefaults`, counts as declared and is sent on both paths — but `retention` and `storage` are creation-only whether declared or not: they reach the divergence guard, never `streams.update()`
- **Durable consumers** are created when a `@Subscribe` carries a `group`.
  A durable is identified per (group, pattern), not per group — the name is
  `${group}--${filterSubject}--${digest}`: group and subject with every character outside `[-\w]`
  replaced by `_`, plus a 12-hex digest of the raw pair — sanitisation alone aliases `orders.*` with
  `orders.>`, and `orders.new` with `orders_new`, so the digest is what keeps them apart. Two
  subscriptions sharing a group but filtering different subjects are therefore two consumers
  instead of one: under the old group-only name the second subscription silently took over the
  first's consumer, so one subject received everything and the other received nothing. The same
  group with the *same* pattern still resolves to a single durable, which is exactly what lets
  several instances share the work. Durables outlive unsubscribe, disconnect and restarts and are
  never deleted implicitly — drop one with `nats consumer rm <stream> <consumer>`
- **Poison messages**: a payload that fails to parse, or valid JSON that is not a OneBun envelope, is `term()`ed and reported to `@OnQueueError` — never acked, never retried, never handed to the handler as `undefined`. Consume-loop errors reach `@OnQueueError` too rather than being swallowed.
- **Consumer lifecycle**: framework-generated ephemerals (no `group`) are deleted on `unsubscribe()` and `disconnect()`; `group` durables are never deleted implicitly, because `QueueService.stop()` unsubscribes on every graceful shutdown and a durable exists to survive restarts. Delete one deliberately with `nats consumer rm <stream> <consumer>`.
- **A `group` is a PERMANENT server resource on JetStream — never template it per run or per deploy.** The durable is named `${group}--${filterSubject}--${digest}`, so a group built from a build number, pod name or timestamp leaves a new orphaned consumer behind every deploy, each holding its own position and `max_ack_pending` budget. Name the ROLE. Note the same option means something else on `NatsQueueAdapter`: there it is a stateless NATS queue group that dies with its members.
- **Decommission a durable in code with `deleteDurableConsumer(pattern, group)`** — not on the `QueueAdapter` interface (only JetStream has durables), so it needs `queueService.getAdapter() as JetStreamQueueAdapter`. Returns `true` when one was removed and `false` when there was none, so it is safe to call twice; rethrows a permissions denial rather than reporting it as already gone; and resolves the stream STRICTLY, throwing when no declared stream binds the pattern instead of falling back to the first. Re-subscribing afterwards creates a fresh durable with `deliver_policy: new`, so the old position is gone for good.
- **Ephemeral consumers** send no `durable_name` and are named `consumer-<uuid>` from
  `crypto.randomUUID()`, not from a timestamp two subscriptions created in the same millisecond
  would share and then fight over.
  Group-less subscriptions are ephemeral: deliver_policy new, deleted on unsubscribe/disconnect.
  Creation always sets `deliver_policy` explicitly to `new` rather than leaning on the server
  default, so on a stream that retains messages a freshly created consumer starts at the moment it
  subscribes instead of replaying the backlog; no `inactive_threshold` is sent. `ack_policy`,
  `deliver_policy`, `durable_name` and `name` are
  immutable on an existing consumer and are creation-only here — the update path sends only
  `ack_wait`, `filter_subject`, `max_ack_pending`, `max_deliver` and `metadata`. Identity is not
  part of the hashed subset either: two subscriptions differing only in `group` carry different
  durable names but the same config hash
- **Subject-to-stream mapping** is automatic — adapter matches subscription patterns to
  configured stream subjects
- **Ack modes**: both `auto` and `manual` use `AckPolicy.Explicit` — acknowledgements are always
  tracked server-side. `ackMode` selects *who* acknowledges, never whether the server tracks
  acknowledgements at all: `auto` acks on the handler's behalf (and `nak`s when it throws),
  `manual` leaves it to the handler's `message.ack()` / `message.nack()`. Without an explicit
  policy `ack_wait`, `max_deliver`, `max_ack_pending`, `retry` and the dead-letter queue are all
  inert and a throwing handler is never redelivered
- **Consumer config precedence**: `max_ack_pending` = `prefetch` > `consumerConfig.maxAckPending` >
  `100`; `max_deliver` = `retry.attempts` > `deadLetter.maxRetries` > `consumerConfig.maxDeliver` >
  `3` — four steps, and `deadLetter.maxRetries` is the one that is easy to forget: a subscription
  declaring `deadLetter: { queue: 'x', maxRetries: 5 }` and no `retry.attempts` gets `max_deliver: 5`,
  overriding `consumerConfig.maxDeliver`. `retry.attempts` deliberately stays ahead of it so a
  configuration written before dead-letter queues existed keeps the exact `max_deliver` it had;
  `ack_wait` =
  `ackTimeout` (ms) > `consumerConfig.ackWait` (ns) > 30s. The pull batch is
  `min(max_ack_pending, prefetch ?? 10)`. `ackTimeout` is hashed config, not identity: changing it
  reconciles the existing durable in place on the next start, no `nats consumer rm`
- **Consumer reconciliation**: on subscribe the adapter probes `consumers.info` first, then
  records a config hash in consumer metadata under three `onebun.*` keys, which requires
  **nats-server 2.10+**; a matching hash is a no-op (no `consumers.update` call at all), a
  differing one is an update that carries every pre-existing metadata key forward, and a detected
  reconcile cycle — the desired hash was applied moments ago and has already been replaced, so two
  processes are writing different configurations — fails startup rather than flapping
- **Startup fails loudly, never silently** when a consumer cannot be reused: a `consumers.info`
  rejection is treated as absence only when it carries the numeric `ConsumerNotFound` code (10014)
  and is otherwise rethrown as itself, an ephemeral subscription refuses to hijack a consumer whose
  name is already taken (pass `group` for a stable durable name), and an existing consumer whose
  `ack_policy` is not explicit is rejected with `nats consumer rm <stream> <consumer>` — that field
  cannot be changed in place. Every such failure emits `onError` in addition to throwing
- **Consume loop auto-restarts** if a subscription dies, and a *deleted consumer* is now detected through `messages.status()` and re-created automatically — `@OnQueueError` fires when it happens. Messages published while the consumer was gone are NOT redelivered: deleting a consumer destroys its position. `heartbeats_missed` and `stream_not_found` are reported but deliberately not repaired.
- **Graceful shutdown awaits in-flight handlers**: `unsubscribe()` and `disconnect()` do not
  resolve until the handler each subscription is currently executing has returned, bounded by a
  fixed **30s** drain timeout equal to the default `ackWait` (not configurable). An ack published
  after the connection closes is buffered and silently dropped, so an abandoned handler's work is
  redelivered and runs twice on the next boot — and `QueueService.stop()` unsubscribes on every
  deploy. `disconnect()` clears `running` on every subscription BEFORE draining, so each loop
  hands its next message back instead of starting one more handler to wait for
- Time units: `@Subscribe({ ackTimeout })` is **milliseconds**, like every other duration in
  `@onebun/core`; everything on the JetStream wire — `consumerConfig.ackWait`, `maxAge`,
  `duplicateWindow` — is **nanoseconds** (NATS convention). The adapter converts `ackTimeout`
  (×1_000_000), and it does nothing under `ackMode: 'none'`

### Pattern Wildcards

| OneBun | NATS | Redis key glob | Meaning |
|---|---|---|---|
| `events.*` | `events.*` | `events.*` | Single-level wildcard |
| `events.#` | `events.>` | `events.*` | Multi-level wildcard (auto-converted) |
| `events.{id}` | `events.*` | `events.*` | Named parameter — widened on the wire, re-checked in process |
| `events.created` | `events.created` | `events.created` | Exact match |

A # is only translated as the final token; toNatsSubject throws on a # in any other position.
The throw surfaces from the `JetStreamQueueAdapter` constructor for a stream declaration, and
from the awaited `publish()` / `subscribe()` call otherwise.

On the Redis adapter {name}, * and a trailing # all translate to the glob *; a non-trailing # throws.
Redis could serve `*.created` — the rejection keeps one pattern language across every adapter. The
glob only narrows which keys `SCAN` walks; `createQueuePatternMatcher(pattern)`, built from the
original pattern, decides what a handler actually receives, so a glob that over-matches is safe.

A captured `{name}` value never reaches the handler on any adapter: the matcher computes it and the
adapter discards it. `message.pattern` carries the concrete topic (`orders.123`); parse it yourself
if you need the id.