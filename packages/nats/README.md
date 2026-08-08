# @onebun/nats

NATS and JetStream integration for OneBun framework.

## Installation

```bash
bun add @onebun/nats
```

## Features

- **NatsQueueAdapter** - Basic pub/sub messaging (no persistence)
- **JetStreamQueueAdapter** - Persistent messaging with acknowledgments

## Usage

### Basic NATS (Pub/Sub)

```typescript
import { OneBunApplication } from '@onebun/core';
import { NatsQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: NatsQueueAdapter,
    options: {
      servers: 'nats://localhost:4222',
    },
  },
});

await app.start();
```

Passing `adapter: NatsQueueAdapter` by itself enables the queue — no `@Subscribe` handler is required anywhere in the
application, so a producer-only service works out of the box. The connection to NATS is established during `app.start()`,
so the application fails to boot if the broker is unreachable.

### JetStream (Persistent)

```typescript
import { OneBunApplication } from '@onebun/core';
import { JetStreamQueueAdapter } from '@onebun/nats';

const app = new OneBunApplication(AppModule, {
  queue: {
    adapter: JetStreamQueueAdapter,
    options: {
      servers: 'nats://localhost:4222',
      streamDefaults: { retention: 'limits', storage: 'file' },
      streams: [
        { name: 'EVENTS', subjects: ['events.>'] },
        { name: 'agent_events', subjects: ['agent.events.>'] },
      ],
    },
  },
});

await app.start();
```

Passing `adapter: JetStreamQueueAdapter` by itself enables the queue — no `@Subscribe` handler is required anywhere in
the application, so a producer-only service works out of the box. The connection to JetStream is established during
`app.start()`, so the application fails to boot if the broker is unreachable.

### Service with Queue Handlers

The second handler below assumes `JetStreamQueueAdapter`. `ackMode: 'manual'` hands the acknowledgement to the
handler and `message.nack(true)` asks the server to redeliver — both are real only where there is a server-side
acknowledgement protocol. The same code runs unchanged under `NatsQueueAdapter` and neither call reaches the wire:
the message is delivered once and dropped whatever the handler decides, and the only trace of the `nack` is an
`onMessageFailed` event in place of `onMessageProcessed`. See the Feature Comparison table below.

```typescript
import { Subscribe, Message, OnQueueReady } from '@onebun/core';

export class OrderService {
  @OnQueueReady()
  handleReady() {
    console.log('Connected to NATS');
  }

  @Subscribe('orders.created')
  async handleOrderCreated(message: Message<OrderData>) {
    console.log('New order:', message.data);
  }

  // `group` provisions a PERMANENT durable consumer on JetStream — name the role, not the deploy
  @Subscribe('orders.*', { ackMode: 'manual', group: 'order-processors' })
  async handleOrder(message: Message<OrderData>) {
    try {
      await this.processOrder(message.data);
      await message.ack();
    } catch (error) {
      await message.nack(true); // requeue
    }
  }
}
```

## Feature Comparison

| Feature | NatsQueueAdapter | JetStreamQueueAdapter |
|---------|------------------|----------------------|
| Pattern subscriptions | Yes | Yes |
| Consumer groups | Yes (transient NATS queue group) | Yes (permanent durable consumer) |
| Persistence | No | Yes |
| Acknowledgments | No | Yes |
| Dead Letter Queue | No | Yes |
| Retry | No | Yes |
| Delayed messages | No | No |
| Priority | No | No |
| Publish deduplication | No | Yes |

On `NatsQueueAdapter` the "No" in the Acknowledgments row is a property of core NATS, not a gap in this adapter: the protocol has no acknowledgement at all, so `message.ack()` and `message.nack()` never reach the wire there. A `nack()` is still reported as `onMessageFailed` rather than `onMessageProcessed`, which is the only trace it leaves — the message itself is gone either way. `ackMode: 'none'` is therefore the only mode NatsQueueAdapter implements truthfully — `'auto'` and `'manual'` are accepted and have no effect on the wire. On JetStream all three modes are real.

## Configuration Options

### NatsConnectionOptions

```typescript
interface NatsConnectionOptions {
  servers: string | string[];  // NATS server URL(s)
  name?: string;               // Connection name
  token?: string;              // Auth token
  user?: string;               // Username
  pass?: string;               // Password
  maxReconnectAttempts?: number;
  reconnectTimeWait?: number;
  timeout?: number;
  tls?: boolean;
}
```

### JetStreamAdapterOptions

```typescript
interface JetStreamAdapterOptions extends NatsConnectionOptions {
  streamDefaults?: {
    retention?: 'limits' | 'interest' | 'workqueue';
    storage?: 'file' | 'memory';
    replicas?: number;
    maxMsgs?: number;
    maxBytes?: number;
    maxAge?: number;           // Nanoseconds
    duplicateWindow?: number;  // Nanoseconds
  };
  streams: Array<{
    name: string;              // Stream name
    subjects: string[];        // Subjects to store
    retention?: 'limits' | 'interest' | 'workqueue';
    storage?: 'file' | 'memory';
    replicas?: number;
    maxMsgs?: number;
    maxBytes?: number;
    maxAge?: number;           // Nanoseconds
    duplicateWindow?: number;  // Nanoseconds
  }>;
  consumerConfig?: {
    ackWait?: number;          // Ack timeout in NANOSECONDS, default 30s; @Subscribe({ ackTimeout }) (ms) overrides it
    maxDeliver?: number;       // Max delivery attempts, default 3; retry.attempts, then deadLetter.maxRetries, override it
    maxAckPending?: number;    // Max unacknowledged messages in flight, default 100; prefetch overrides it
  };
}
```

**Producers and consumers must declare identical stream definitions.** JetStream stores a message only
if some stream on the broker binds its subject; a subject no stream binds fails the publish with an error
naming the pattern, the NATS subject and the streams this application declares, with the broker's own
rejection attached as the cause. There is no pre-flight check against the local `streams` list — a subject
may legitimately be bound by a stream another service owns, so only the broker decides.

That shared ownership is also why `streams` is reconciled rather than reapplied. On connect the adapter compares
each declared stream against the one the broker already holds through a configuration hash: a stream whose hash
is unchanged is left alone, so an unchanged declaration performs no write at all. When the hash did change, only
the keys the application actually declared are sent — an undeclared `maxMsgs`, `maxBytes` or `maxAge` is absent
from the update rather than present and empty — so limits an operator set out of band survive every restart
instead of being erased by the next boot.

Widening a stream is allowed; narrowing it is not. Subject coverage is read from the broker's own subject list,
and the adapter refuses to start when the declaration would narrow it, naming every subject the stream already
stores that the new `subjects` would no longer cover. `storage` and `retention` cannot be changed on an existing
stream, so a declared value that diverges from the server's fails startup as well, naming the field and the
`nats stream rm` that lets OneBun recreate the stream — deleting it discards every message it holds. Both checks
run before the hash is consulted, so a stamp left behind by an out-of-band `nats stream edit` cannot wave either
of them through. That stamp lives in stream metadata, so the adapter requires nats-server 2.10 or newer.

## License

[MPL-2.0](../../LICENSE) 
