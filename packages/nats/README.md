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

const app = await OneBunApplication.create(AppModule, {
  queue: {
    adapter: NatsQueueAdapter,
    options: {
      servers: 'nats://localhost:4222',
    },
  },
});
```

### JetStream (Persistent)

```typescript
import { OneBunApplication } from '@onebun/core';
import { JetStreamQueueAdapter } from '@onebun/nats';

const app = await OneBunApplication.create(AppModule, {
  queue: {
    adapter: JetStreamQueueAdapter,
    options: {
      servers: 'nats://localhost:4222',
      stream: 'EVENTS',
      createStream: true,
      streamConfig: {
        subjects: ['events.>'],
        retention: 'limits',
        maxMsgs: 1000000,
      },
    },
  },
});
```

### Service with Queue Handlers

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
| Consumer groups | Yes | Yes |
| Persistence | No | Yes |
| Acknowledgments | No | Yes |
| Dead Letter Queue | No | Yes |
| Retry | No | Yes |
| Delayed messages | No | No |
| Priority | No | No |

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
  stream: string;              // Stream name
  createStream?: boolean;      // Create stream if not exists
  streamConfig?: {
    subjects?: string[];       // Subjects to store
    retention?: 'limits' | 'interest' | 'workqueue';
    maxMsgs?: number;
    maxBytes?: number;
    maxAge?: number;
    storage?: 'file' | 'memory';
    replicas?: number;
  };
  consumerConfig?: {
    ackWait?: number;          // Ack timeout (nanoseconds)
    maxDeliver?: number;       // Max delivery attempts
    maxAckPending?: number;
  };
}
```

## License

LGPL-3.0
