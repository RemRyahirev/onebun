/**
 * Documentation Examples Tests for @onebun/nats
 *
 * @source docs:api/queue.md
 *
 * Each test case corresponds to a code block in the documentation.
 * Keep these tests in sync with the documentation!
 */

import { DeliverPolicy } from '@nats-io/jetstream';
import {
  describe,
  it,
  expect,
  mock,
} from 'bun:test';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;


import type { NatsAdapterOptions, JetStreamAdapterOptions } from '../src/types';

import type { Message } from '@onebun/core';
import {
  OnQueueReady,
  Subscribe,
  createQueuePatternMatcher,
  getLifecycleHandlers,
  getSubscribeMetadata,
  resolveAckMode,
} from '@onebun/core';


import {
  NatsQueueAdapter,
  JetStreamQueueAdapter,
  NatsClient,
  createNatsQueueAdapter,
  createJetStreamQueueAdapter,
  createNatsClient,
  toNatsSubject,
} from '../src/index';


/**
 * @source docs:api/queue.md#pattern-syntax
 */
describe('Pattern Syntax translation table (docs/api/queue.md)', () => {
  it('translates every row of the documented table', () => {
    // From docs/api/queue.md: the "NATS subject" column of the Pattern Syntax table.
    expect(toNatsSubject('orders.created')).toBe('orders.created');
    expect(toNatsSubject('orders.*')).toBe('orders.*');
    expect(toNatsSubject('events.#')).toBe('events.>');
    expect(toNatsSubject('orders.{id}')).toBe('orders.*');
  });

  it('throws when # is not the final token', () => {
    // From docs/api/queue.md: "# must be the final token".
    expect(() => toNatsSubject('#.created')).toThrow(/final token/i);
    expect(() => toNatsSubject('events.#.created')).toThrow(/final token/i);
  });

  it('throws from the JetStreamQueueAdapter constructor for a stream declaration', () => {
    // From docs/api/queue.md: the throw surfaces from the constructor for a stream
    // declaration, before connect() is ever reached.
    expect(() => new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['#.created'] }],
    })).toThrow('#.created');
  });
});

/** `JetStreamApiCodes.StreamNotFound` — the only rejection the adapter reads as absence. */
const STREAM_NOT_FOUND_CODE = 10059;

/**
 * A `NatsQueueAdapter` whose transport is a recorder, so the pub/sub the docs describe can be
 * observed in process. Core NATS needs a live broker for anything else, and `connect()` is the
 * only seam — it is substituted on the instance, never through `mock.module`.
 */
function connectedNatsAdapter(options: NatsAdapterOptions = { servers: 'nats://localhost:4222' }) {
  const adapter = new NatsQueueAdapter(options);
  const handle: AnyRecord = {
    unsubscribe: mock(() => undefined),
    drain: mock(() => Promise.resolve()),
  };
  const client: AnyRecord = {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    isConnected: mock(() => true),
    publish: mock(() => Promise.resolve()),
    subscribe: mock(() => Promise.resolve(handle)),
  };
  (adapter as unknown as AnyRecord).client = client;

  return { adapter, client, handle };
}

/**
 * @source docs:api/queue.md#natsqueueadapter
 */
describe('Basic NATS (Pub/Sub) Example (docs/api/queue.md)', () => {
  it('should create NatsQueueAdapter with options', async () => {
    // From docs/api/queue.md: the framework instantiates the adapter with
    // `new Adapter(queue.options)` and uses it as the queue backend — so `type` is what
    // selects it, and everything after connect() has to reach the NATS transport.
    const options: NatsAdapterOptions = {
      servers: 'nats://localhost:4222',
    };

    const { adapter, client } = connectedNatsAdapter(options);

    expect(adapter.name).toBe('nats');
    expect(adapter.type).toBe('nats');
    expect(adapter.isConnected()).toBe(false);

    let ready = 0;
    adapter.on('onReady', () => {
      ready += 1;
    });

    await adapter.connect();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(ready).toBe(1);
    expect(adapter.isConnected()).toBe(true);

    // Fire-and-forget pub/sub: the published envelope goes straight out on the subject.
    const id = await adapter.publish('orders.created', { orderId: 7 });
    const [subject, payload] = client.publish.mock.calls[0] as [string, string];

    expect(subject).toBe('orders.created');
    expect(JSON.parse(payload)).toMatchObject({ id, pattern: 'orders.created', data: { orderId: 7 } });

    await adapter.disconnect();

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(adapter.isConnected()).toBe(false);
  });
});

/**
 * @source docs:api/queue.md#jetstreamqueueadapter
 */
describe('JetStream (Persistent) Example (docs/api/queue.md)', () => {
  it('should create JetStreamQueueAdapter with multi-stream configuration', async () => {
    // From docs/api/queue.md: "`streamDefaults` is merged into each stream definition
    // (per-stream values take priority)", and every declared stream is reconciled during
    // startup — created when the server does not have it yet.
    // `maxAge` is in the defaults on purpose: `retention`, `storage` and `replicas` have
    // create-path fallbacks of exactly 'limits'/'file'/1, so declaring those alone could not
    // tell a merged default apart from the fallback. Nothing supplies a `max_age`.
    const options: JetStreamAdapterOptions = {
      servers: 'nats://localhost:4222',
      streamDefaults: {
        retention: 'limits', storage: 'file', replicas: 1, maxAge: 24 * 60 * 60 * 1e9,
      },
      streams: [
        { name: 'EVENTS', subjects: ['events.>'] },
        { name: 'agent_events', subjects: ['agent.events.>'], maxAge: 7 * 24 * 60 * 60 * 1e9 },
        { name: 'agent_dlq', subjects: ['agent.dlq.>'], storage: 'memory' },
      ],
    };

    const adapter = new JetStreamQueueAdapter(options);

    expect(adapter.name).toBe('jetstream');
    expect(adapter.type).toBe('jetstream');

    const jsm: AnyRecord = {
      streams: {
        // Nothing exists on the server yet, so every declared stream takes the create path.
        info: mock(() => Promise.reject(
          Object.assign(new Error('stream not found'), { code: STREAM_NOT_FOUND_CODE }),
        )),
        add: mock(() => Promise.resolve()),
        update: mock(() => Promise.resolve()),
      },
    };
    (adapter as unknown as AnyRecord).jsm = jsm;

    await (adapter as unknown as AnyRecord).ensureAllStreams();

    const created = jsm.streams.add.mock.calls.map((call: AnyRecord[]) => call[0]);

    expect(created.map((config: AnyRecord) => config.name)).toEqual(['EVENTS', 'agent_events', 'agent_dlq']);
    // streamDefaults reaches every declared stream...
    expect(created[0]).toMatchObject({
      subjects: ['events.>'],
      retention: 'limits',
      storage: 'file',
      num_replicas: 1,
      max_age: 24 * 60 * 60 * 1e9,
    });
    // ...and a per-stream value takes priority over it, field by field.
    expect(created[1]).toMatchObject({
      subjects: ['agent.events.>'], storage: 'file', max_age: 7 * 24 * 60 * 60 * 1e9,
    });
    expect(created[2]).toMatchObject({
      subjects: ['agent.dlq.>'], storage: 'memory', max_age: 24 * 60 * 60 * 1e9,
    });
    // Reconciled, not blind-written: the server had none of them, so the update path is unused.
    expect(jsm.streams.update).not.toHaveBeenCalled();
  });
});

/**
 * @source docs:api/queue.md#feature-support-matrix
 */
describe('Feature Comparison (docs/api/queue.md)', () => {
  it('should report correct NatsQueueAdapter features', async () => {
    // From docs/api/queue.md: the NATS column of the Feature Support Matrix.
    const { adapter, client } = connectedNatsAdapter();

    // Supported
    expect(adapter.supports('pattern-subscriptions')).toBe(true);
    expect(adapter.supports('consumer-groups')).toBe(true);
    // Not supported
    expect(adapter.supports('delayed-messages')).toBe(false);
    expect(adapter.supports('priority')).toBe(false);
    expect(adapter.supports('dead-letter-queue')).toBe(false);
    expect(adapter.supports('retry')).toBe(false);

    // Three rows of that table are not `QueueFeature`s, so `supports()` cannot express them.
    await adapter.connect();

    // "Acknowledgments ❌ ²": every ackMode is accepted and rejects nothing, and none of them
    // changes a byte on the wire — the subscription is identical in all three.
    for (const ackMode of ['auto', 'manual', 'none'] as const) {
      await adapter.subscribe('orders.*', async () => undefined, { ackMode });
    }

    expect(client.subscribe.mock.calls.length).toBe(3);
    expect(client.subscribe.mock.calls.map((call: AnyRecord[]) => call[0])).toEqual([
      'orders.*', 'orders.*', 'orders.*',
    ]);
    expect(client.subscribe.mock.calls.map((call: AnyRecord[]) => (call[2] as AnyRecord).queue)).toEqual([
      undefined, undefined, undefined,
    ]);

    // "Publish deduplication ❌": messageId is echoed back as Message.id and nothing more —
    // no `Nats-Msg-Id` header reaches the broker, so a replay is stored twice.
    const id = await adapter.publish('orders.created', { total: 10 }, { messageId: 'custom-id' });
    const [, payload, headers] = client.publish.mock.calls[0] as [string, string, Record<string, string>];

    expect(id).toBe('custom-id');
    expect(JSON.parse(payload).id).toBe('custom-id');
    expect(Object.keys(headers)).toEqual([]);

    await adapter.disconnect();
  });

  it('should report correct JetStreamQueueAdapter features', () => {
    // From docs/api/queue.md: the JetStream column of the Feature Support Matrix.
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'TEST', subjects: ['test.>'] }],
    });

    // Supported
    expect(adapter.supports('pattern-subscriptions')).toBe(true);
    expect(adapter.supports('consumer-groups')).toBe(true);
    expect(adapter.supports('dead-letter-queue')).toBe(true);
    expect(adapter.supports('retry')).toBe(true);

    // Not supported
    expect(adapter.supports('delayed-messages')).toBe(false);
    expect(adapter.supports('priority')).toBe(false);
  });
});

/**
 * Drives a documented options object far enough to observe the consumer config
 * the adapter actually sends, so a snippet is proven by behaviour rather than by
 * `toBeInstanceOf`.
 */
async function consumerConfigSentFor(
  options: JetStreamAdapterOptions,
  subscribeOptions: { group?: string; prefetch?: number } = { group: 'docs-example' },
) {
  const adapter = createJetStreamQueueAdapter(options);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = adapter as any;
  a.connected = true;
  a.client = {
    isConnected: mock(() => true),
    disconnect: mock(() => Promise.resolve()),
  };
  a.jsm = {
    consumers: {
      add: mock(() => Promise.resolve()),
      // The adapter probes before it creates; a not-found rejection is what reaches `add`.
      info: mock(() => Promise.reject(Object.assign(new Error('consumer not found'), { code: 10014 }))),
      update: mock(() => Promise.resolve()),
    },
  };
  a.js = {
    consumers: {
      get: mock(() =>
        Promise.resolve({
          consume: mock(() =>
            Promise.resolve({
              // Parks instead of ending, so the adapter's 100ms restart never fires.
              async *[Symbol.asyncIterator] () {
                await new Promise(() => undefined);
              },
            }),
          ),
        }),
      ),
    },
  };

  await adapter.subscribe('events.created', async () => undefined, subscribeOptions);
  const cfg = a.jsm.consumers.add.mock.calls[0][1];
  await adapter.disconnect();

  return cfg;
}

/**
 * Retagged: this test is about the connection options of the CORE-NATS adapter, which
 * `docs:api/queue.md#natsqueueadapter` documents — it has nothing to do with JetStream,
 * where the tag used to point.
 *
 * @source docs:api/queue.md#natsqueueadapter
 */
describe('Connection options (docs/api/queue.md)', () => {
  it('should accept NatsConnectionOptions', async () => {
    // From docs/api/queue.md: the adapter is constructed from `queue.options` and connects
    // itself during `app.start()`. A real handshake needs a broker, so what is asserted here
    // is the whole in-process chain: every declared option lands on the NATS client, and that
    // client is the one `connect()` drives.
    const options: NatsAdapterOptions = {
      servers: ['nats://host1:4222', 'nats://host2:4222'], // Multiple servers
      name: 'my-client',
      token: 'secret-token',
      user: 'admin',
      pass: 'password',
      maxReconnectAttempts: 10,
      reconnectTimeWait: 2000,
      timeout: 5000,
      tls: true,
    };

    const adapter = createNatsQueueAdapter(options);

    expect(adapter).toBeInstanceOf(NatsQueueAdapter);

    const client = (adapter as unknown as AnyRecord).client as AnyRecord;

    expect(client).toBeInstanceOf(NatsClient);
    // Not one field is dropped or reshaped on the way to the client.
    expect(client.options).toEqual(options);

    // And that same client is what the adapter connects: substituted on the instance, since
    // `mock.module` would replace the transport for every file in the run.
    client.connect = mock(() => Promise.resolve());
    client.isConnected = mock(() => true);
    client.disconnect = mock(() => Promise.resolve());

    await adapter.connect();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(adapter.isConnected()).toBe(true);

    await adapter.disconnect();
  });
});

/**
 * @source docs:api/queue.md#jetstreamqueueadapter
 */
describe('Configuration Options (docs/api/queue.md)', () => {
  it('should accept JetStreamAdapterOptions', async () => {
    // From docs/api/queue.md: JetStreamAdapterOptions interface
    const options: JetStreamAdapterOptions = {
      servers: 'nats://localhost:4222',
      streamDefaults: {
        retention: 'limits',
        storage: 'file',
        replicas: 1,
        maxMsgs: 1000000,
        maxBytes: 1073741824,
        maxAge: 86400000000000,
      },
      streams: [
        {
          name: 'EVENTS',
          subjects: ['events.>'],
        },
      ],
      consumerConfig: {
        ackWait: 30000000000, // 30s in nanoseconds
        maxDeliver: 5,
        maxAckPending: 100,
      },
    };

    const adapter = createJetStreamQueueAdapter(options);
    expect(adapter).toBeInstanceOf(JetStreamQueueAdapter);

    // Behavioural: the documented consumerConfig reaches the wire, asserted on the
    // payload the adapter sends to `jsm.consumers.add` rather than on the literal.
    const cfg = await consumerConfigSentFor(options);

    expect(cfg.ack_wait).toBe(30000000000);
    expect(cfg.max_deliver).toBe(5);
    expect(cfg.max_ack_pending).toBe(100);
  });

  it('should honour a non-default consumerConfig.maxAckPending', async () => {
    // The documented value above happens to equal the built-in default, so on its own
    // it cannot distinguish "the option was read" from "the option was ignored".
    // A distinctive value can.
    const cfg = await consumerConfigSentFor({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
      consumerConfig: { maxAckPending: 17 },
    });

    expect(cfg.max_ack_pending).toBe(17);
  });

  it('should name a grouped durable after the group and the pattern', async () => {
    // From docs/api/queue.md: the durable is `${group}--${filterSubject}`, per
    // (group, pattern) rather than per group.
    const cfg = await consumerConfigSentFor({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
    });

    expect(cfg.durable_name).toMatch(/^docs-example--events_created--[0-9a-f]{12}$/);
  });

  it('should make a group-less subscription an ephemeral consumer', async () => {
    // From docs/api/queue.md: no group means ephemeral — no durable name, and
    // deliver_policy new, so it receives only what is published after it starts.
    const cfg = await consumerConfigSentFor(
      {
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
      },
      {},
    );

    expect(cfg.durable_name).toBeUndefined();
    expect(cfg.deliver_policy).toBe(DeliverPolicy.New);
  });

  it('should let prefetch override consumerConfig.maxAckPending', async () => {
    // From docs/api/queue.md: prefetch overrides consumerConfig.maxAckPending.
    const cfg = await consumerConfigSentFor(
      {
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
        consumerConfig: { maxAckPending: 17 },
      },
      { group: 'docs-example', prefetch: 42 },
    );

    expect(cfg.max_ack_pending).toBe(42);
  });
});

/**
 * @source docs:api/queue.md#natsqueueadapter
 */
describe('NatsQueueAdapter (docs/api/queue.md)', () => {
  it('should create adapter for pub/sub', () => {
    // From docs/api/queue.md: NatsQueueAdapter section
    const adapter = new NatsQueueAdapter({
      servers: 'nats://localhost:4222',
    });

    expect(adapter.name).toBe('nats');
    expect(adapter.isConnected()).toBe(false);
  });
});

/**
 * @source docs:api/queue.md#jetstreamqueueadapter
 */
describe('JetStreamQueueAdapter (docs/api/queue.md)', () => {
  it('should create adapter for persistent messaging with multi-stream', () => {
    // From docs/api/queue.md: JetStreamQueueAdapter section
    const adapter = new JetStreamQueueAdapter({
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
    });

    expect(adapter.name).toBe('jetstream');
    expect(adapter.isConnected()).toBe(false);
  });
});

/**
 * @source docs:api/queue.md#consumer-lifecycle-jetstream
 */
describe('Consumer Lifecycle (docs/api/queue.md)', () => {
  /** Builds a connected adapter whose consumer records delete() calls. */
  function connected() {
    const consumer: AnyRecord = {
      consume: mock(() => Promise.resolve({
        async *[Symbol.asyncIterator] () {
          await new Promise(() => undefined);
        },
        close: mock(() => Promise.resolve()),
      })),
      delete: mock(() => Promise.resolve(true)),
    };

    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };
    a.jsm = {
      consumers: {
        add: mock(() => Promise.resolve()),
        info: mock(() => Promise.reject(Object.assign(new Error('consumer not found'), { code: 10014 }))),
        update: mock(() => Promise.resolve()),
      },
    };
    a.js = { consumers: { get: mock(() => Promise.resolve(consumer)) } };

    return { adapter, consumer };
  }

  it('deletes the ephemeral consumer when a group-less subscription unsubscribes', async () => {
    // From docs/api/queue.md: no group means ephemeral, and it is gone once the
    // subscription ends.
    const { adapter, consumer } = connected();
    const temporary = await adapter.subscribe('events.created', async () => undefined);

    await temporary.unsubscribe();

    expect(consumer.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps a durable consumer when a grouped subscription unsubscribes', async () => {
    // From docs/api/queue.md: a durable survives unsubscribe, restart and redeploy.
    const { adapter, consumer } = connected();
    const worker = await adapter.subscribe('events.created', async () => undefined, { group: 'workers' });

    await worker.unsubscribe();

    expect(consumer.delete).not.toHaveBeenCalled();
  });
});

/**
 * @source docs:api/queue.md#message-interface
 */
describe('Negative acknowledgement (docs/api/queue.md)', () => {
  /** Drives one delivered message through the adapter and returns the raw JetStream message. */
  async function deliverOne(): Promise<{ jsMsg: AnyRecord; message: AnyRecord }> {
    const jsMsg: AnyRecord = {
      ack: mock(() => undefined),
      nak: mock(() => undefined),
      term: mock(() => undefined),
      data: new TextEncoder().encode(JSON.stringify({ pattern: 'events.created', data: {} })),
      subject: 'events.created',
      info: { redelivered: false },
    };

    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };
    a.jsm = {
      consumers: {
        add: mock(() => Promise.resolve()),
        info: mock(() => Promise.reject(Object.assign(new Error('consumer not found'), { code: 10014 }))),
        update: mock(() => Promise.resolve()),
      },
    };

    let message: AnyRecord | null = null;
    a.js = {
      consumers: {
        get: mock(() => Promise.resolve({
          consume: mock(() => Promise.resolve({
            async *[Symbol.asyncIterator] () {
              yield jsMsg;
              await new Promise(() => undefined);
            },
          })),
        })),
      },
    };

    await adapter.subscribe('events.created', async (msg) => {
      message = msg as unknown as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.disconnect();

    return { jsMsg, message: message! };
  }

  it('nack(true) asks for redelivery', async () => {
    const { jsMsg, message } = await deliverOne();

    await message.nack(true);

    expect(jsMsg.nak).toHaveBeenCalledWith();
    expect(jsMsg.term).not.toHaveBeenCalled();
  });

  it('nack(false) terminates the message so it is never redelivered', async () => {
    const { jsMsg, message } = await deliverOne();

    await message.nack(false);

    expect(jsMsg.term).toHaveBeenCalled();
    expect(jsMsg.nak).not.toHaveBeenCalled();
  });
});

/**
 * @source docs:api/queue.md#dead-letter-queue
 */
describe('Dead Letter Queue (docs/api/queue.md)', () => {
  const DLQ_SUBJECT = 'orders.dlq';

  /** Drives one always-failing delivery at the given delivery count. */
  async function failOnce(deliveryCount: number, maxRetries?: number) {
    const jsMsg: AnyRecord = {
      ack: mock(() => undefined),
      nak: mock(() => undefined),
      term: mock(() => undefined),
      data: new TextEncoder().encode(JSON.stringify({
        id: 'order-42', pattern: 'orders.created', data: { total: 10 }, metadata: {},
      })),
      subject: 'orders.created',
      info: { redelivered: deliveryCount > 1, deliveryCount },
    };

    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };
    a.jsm = {
      consumers: {
        add: mock(() => Promise.resolve()),
        info: mock(() => Promise.reject(Object.assign(new Error('consumer not found'), { code: 10014 }))),
        update: mock(() => Promise.resolve()),
      },
    };
    a.js = {
      publish: mock(() => Promise.resolve()),
      consumers: {
        get: mock(() => Promise.resolve({
          consume: mock(() => Promise.resolve({
            async *[Symbol.asyncIterator] () {
              yield jsMsg;
              await new Promise(() => undefined);
            },
          })),
        })),
      },
    };

    await adapter.subscribe('orders.created', async () => {
      throw new Error('processing failed');
    }, { deadLetter: { queue: DLQ_SUBJECT, maxRetries } });

    await new Promise((resolve) => setTimeout(resolve, 25));

    return { jsMsg, js: a.js as AnyRecord, jsm: a.jsm as AnyRecord };
  }

  it('maxRetries sets max_deliver, behind retry.attempts', async () => {
    // From docs: retry.attempts -> deadLetter.maxRetries -> consumerConfig.maxDeliver -> 3
    const { jsm } = await failOnce(1, 5);

    expect(jsm.consumers.add.mock.calls[0][1].max_deliver).toBe(5);
  });

  it('parks the message on the last attempt and terminates the original', async () => {
    // From docs: republished FIRST, terminated only once that succeeded.
    const { jsMsg, js } = await failOnce(5, 5);

    expect(js.publish.mock.calls[0][0]).toBe(DLQ_SUBJECT);
    expect(jsMsg.term).toHaveBeenCalledTimes(1);
  });

  it('carries the documented provenance metadata', async () => {
    const { js } = await failOnce(5, 5);
    const body = JSON.parse(new TextDecoder().decode(js.publish.mock.calls[0][1] as Uint8Array)) as AnyRecord;

    expect(body.id).toBe('order-42');
    expect(body.metadata['dlq.originalPattern']).toBe('orders.created');
    expect(body.metadata['dlq.deliveryCount']).toBe(5);
    expect(body.metadata['dlq.error']).toBe('processing failed');
  });

  it('rejects a wildcard deadLetter.queue at subscribe time', async () => {
    // From docs: a wildcard or self-referencing queue throws from subscribe().
    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };

    await expect(adapter.subscribe('orders.created', async () => undefined, {
      deadLetter: { queue: 'orders.*' },
    })).rejects.toThrow(/deadLetter\.queue/);
  });
});

/**
 * @source docs:api/queue.md#error-handling-in-handlers
 */
describe('Error Handling in Handlers (docs/api/queue.md)', () => {
  /**
   * Runs the documented handler verbatim against one delivery and reports which branch
   * it took. The recipe is:
   *
   *   if (message.attempt && message.attempt >= (message.maxAttempts || 3)) nack(false)
   *   else nack(true)
   */
  async function runDocumentedHandler(deliveryCount: number, attempts: number) {
    const jsMsg: AnyRecord = {
      ack: mock(() => undefined),
      nak: mock(() => undefined),
      term: mock(() => undefined),
      data: new TextEncoder().encode(JSON.stringify({
        id: 'order-1', pattern: 'orders.created', data: { orderId: 'o-1' }, metadata: {},
      })),
      subject: 'orders.created',
      info: { redelivered: deliveryCount > 1, deliveryCount },
    };

    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };
    a.jsm = {
      consumers: {
        add: mock(() => Promise.resolve()),
        info: mock(() => Promise.reject(Object.assign(new Error('consumer not found'), { code: 10014 }))),
        update: mock(() => Promise.resolve()),
      },
    };
    a.js = {
      publish: mock(() => Promise.resolve()),
      consumers: {
        get: mock(() => Promise.resolve({
          consume: mock(() => Promise.resolve({
            async *[Symbol.asyncIterator] () {
              yield jsMsg;
              await new Promise(() => undefined);
            },
          })),
        })),
      },
    };

    await adapter.subscribe('orders.created', async (message) => {
      // Verbatim from docs/api/queue.md, "Error Handling in Handlers".
      try {
        throw new Error('processing failed');
      } catch {
        if (message.attempt && message.attempt >= (message.maxAttempts || 3)) {
          await message.nack(false);
        } else {
          await message.nack(true);
        }
      }
    }, { ackMode: 'manual', retry: { attempts } });

    await new Promise((resolve) => setTimeout(resolve, 25));

    return jsMsg;
  }

  it('takes the requeue branch while attempts remain', async () => {
    const jsMsg = await runDocumentedHandler(1, 3);

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
    expect(jsMsg.term).not.toHaveBeenCalled();
  });

  it('takes the terminal branch on the last attempt', async () => {
    // Unreachable before this change: `attempt` was always undefined, so the guard
    // never held and the documented terminal branch was dead code.
    const jsMsg = await runDocumentedHandler(3, 3);

    expect(jsMsg.term).toHaveBeenCalledTimes(1);
    expect(jsMsg.nak).not.toHaveBeenCalled();
  });
});

/**
 * @source docs:api/queue.md#publishing-messages
 */
describe('Publish deduplication (docs/api/queue.md)', () => {
  /** Connects an adapter far enough to observe the js.publish arguments. */
  function connected(streams = [{ name: 'ORDERS', subjects: ['orders.>'] }]) {
    const adapter = createJetStreamQueueAdapter({ servers: 'nats://localhost:4222', streams });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };
    a.js = { publish: mock(() => Promise.resolve()) };

    return { adapter, js: a.js as AnyRecord };
  }

  it('sends messageId as the dedup header, and nothing when it is omitted', async () => {
    // From docs: "Only an id you supply enables this" — an omitted id sends no header.
    const { adapter, js } = connected();

    await adapter.publish('orders.created', { id: 1 }, { messageId: 'custom-id' });
    await adapter.publish('orders.created', { id: 2 });

    expect(js.publish.mock.calls[0][2]).toEqual({ msgID: 'custom-id' });
    expect(js.publish.mock.calls[1][2]).toBeUndefined();
  });

  it('resolves normally even when the server would drop the duplicate', async () => {
    // From docs: the duplicate is dropped server-side and publish() still resolves, so a
    // resolved publish is not proof that a new message was stored.
    const { adapter } = connected();

    await expect(adapter.publish('orders.created', { id: 1 }, { messageId: 'custom-id' }))
      .resolves.toBe('custom-id');
  });
});

/**
 * @source docs:api/queue.md#publishing-messages
 */
describe('duplicateWindow (docs/api/queue.md)', () => {
  it('emits the documented window on the wire, in nanoseconds', async () => {
    // From the docs snippet: duplicateWindow: 10 * 60 * 1e9
    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'], duplicateWindow: 10 * 60 * 1e9 }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    const jsm: AnyRecord = {
      streams: {
        info: mock(() => Promise.resolve({ config: { name: 'ORDERS', subjects: ['orders.>'], metadata: {} } })),
        update: mock(() => Promise.resolve()),
        add: mock(() => Promise.resolve()),
      },
    };
    a.jsm = jsm;

    await a.ensureAllStreams();

    expect(jsm.streams.update.mock.calls[0][1].duplicate_window).toBe(600_000_000_000);
  });
});

/**
 * @source docs:api/queue.md#consumer-lifecycle-jetstream
 */
describe('Consumer lifecycle: deleteDurableConsumer (docs/api/queue.md)', () => {
  it('is reachable through the documented downcast and refuses when disconnected', () => {
    // From docs: `queueService.getAdapter() as JetStreamQueueAdapter`, then
    // `await adapter.deleteDurableConsumer('orders.created', 'order-processors')`.
    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });

    expect(typeof adapter.deleteDurableConsumer).toBe('function');
    expect(adapter.deleteDurableConsumer('orders.created', 'order-processors'))
      .rejects.toThrow('JetStreamQueueAdapter not connected');
  });

  it('refuses to guess a stream, naming what the application declares', async () => {
    // From docs: "if no declared stream binds the pattern it throws and names every stream".
    const adapter = createJetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = adapter as any;
    a.connected = true;
    a.client = { isConnected: mock(() => true), disconnect: mock(() => Promise.resolve()) };
    a.jsm = { consumers: { delete: mock(() => Promise.resolve(true)) } };

    await expect(adapter.deleteDurableConsumer('unbound.subject', 'g')).rejects.toThrow('ORDERS');
    expect(a.jsm.consumers.delete).not.toHaveBeenCalled();
  });
});

/**
 * @source docs:api/queue.md
 */
describe('NatsClient', () => {
  it('should create client instance', () => {
    const client = createNatsClient({
      servers: 'nats://localhost:4222',
      name: 'test-client',
    });

    expect(client).toBeInstanceOf(NatsClient);
    expect(client.isConnected()).toBe(false);
  });
});

/**
 * @source docs:api/queue.md#feature-support-matrix (NATS column)
 */
describe('Feature Support Matrix - NATS (docs/api/queue.md)', () => {
  it('NATS adapter supports correct features', () => {
    // From docs/api/queue.md: Feature Support Matrix table - NATS column
    const nats = new NatsQueueAdapter({ servers: 'nats://localhost:4222' });

    expect(nats.supports('pattern-subscriptions')).toBe(true);
    expect(nats.supports('consumer-groups')).toBe(true);
    expect(nats.supports('delayed-messages')).toBe(false);
    expect(nats.supports('priority')).toBe(false);
    expect(nats.supports('dead-letter-queue')).toBe(false);
    expect(nats.supports('retry')).toBe(false);
  });

  it('JetStream adapter supports correct features', () => {
    // From docs/api/queue.md: Feature Support Matrix table - JetStream column
    const js = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'TEST', subjects: ['test.>'] }],
    });

    expect(js.supports('pattern-subscriptions')).toBe(true);
    expect(js.supports('consumer-groups')).toBe(true);
    expect(js.supports('dead-letter-queue')).toBe(true);
    expect(js.supports('retry')).toBe(true);
    expect(js.supports('delayed-messages')).toBe(false);
    expect(js.supports('priority')).toBe(false);
  });
});

/** A `Message` stand-in that records which disposition the documented handler chose. */
function documentedMessage<T>(data: T) {
  const ack = mock(() => Promise.resolve());
  const nack = mock((_requeue?: boolean) => Promise.resolve());
  const message = {
    id: 'order-1',
    pattern: 'orders.created',
    params: {},
    data,
    timestamp: Date.now(),
    redelivered: false,
    metadata: {},
    ack,
    nack,
  } as unknown as Message<T>;

  return { message, ack, nack };
}

/**
 * The service the "Subscribe Options" snippet declares, with `this.logger` calls replaced by
 * a recorder — the framework's own lint bans console output — and `processOrder` stubbed so
 * the documented try/catch has both branches to take. The decorators and their options are
 * the page's verbatim.
 *
 * Retagged: the body pins the `@Subscribe` options table, not the core-NATS adapter section
 * the tag used to name. The nack test below stays here because
 * `docs:api/queue.md#subscribe-options` is where the page states what this recipe does on
 * `NatsQueueAdapter`.
 */
class OrderService {
  readonly processed: unknown[] = [];
  readyCount = 0;

  @OnQueueReady()
  handleReady() {
    this.readyCount += 1;
  }

  @Subscribe('orders.created')
  async handleOrderCreated(message: Message<unknown>) {
    this.processed.push(message.data);
  }

  @Subscribe('orders.*', {
    ackMode: 'manual',         // 'auto' (default), 'manual' or 'none'
    group: 'order-processors', // One durable consumer per (group, pattern)
    prefetch: 10,              // Messages to process in parallel
    ackTimeout: 30_000,        // ms — max time a handler may hold a message
    retry: {
      attempts: 3,
      backoff: 'exponential',
      delay: 1000,
    },
  })
  async handleOrder(message: Message<{ fail?: boolean }>) {
    try {
      await this.processOrder(message.data);
      await message.ack();
    } catch {
      await message.nack(true); // requeue
    }
  }

  private async processOrder(data: { fail?: boolean }): Promise<void> {
    if (data.fail) {
      throw new Error('processing failed');
    }

    this.processed.push(data);
  }
}

/**
 * @source docs:api/queue.md#subscribe-options
 */
describe('Subscribe Options (docs/api/queue.md)', () => {
  it('registers every option the documented @Subscribe declares', () => {
    const subscriptions = getSubscribeMetadata(OrderService);

    expect(subscriptions.length).toBe(2);
    expect(subscriptions.map(s => s.pattern).sort()).toEqual(['orders.*', 'orders.created']);

    const manual = subscriptions.find(s => s.pattern === 'orders.*');

    expect(manual?.propertyKey).toBe('handleOrder');
    // Every field of the snippet is stored as declared — none is dropped or renamed.
    expect(manual?.options).toEqual({
      ackMode: 'manual',
      group: 'order-processors',
      prefetch: 10,
      ackTimeout: 30_000,
      retry: { attempts: 3, backoff: 'exponential', delay: 1000 },
    });

    // "'auto' (default)": a @Subscribe that declares no options resolves to auto.
    const plain = subscriptions.find(s => s.pattern === 'orders.created');

    expect(plain?.propertyKey).toBe('handleOrderCreated');
    expect(plain?.options).toBeUndefined();
    expect(resolveAckMode(plain?.options)).toBe('auto');
  });

  it('acks on success and requeues on failure, exactly as the snippet does', async () => {
    // The registered propertyKey is what the framework will invoke, so the recipe is driven
    // through it rather than through a direct method call.
    const manual = getSubscribeMetadata(OrderService).find(s => s.pattern === 'orders.*')!;
    const service = new OrderService();
    const handler = (service as unknown as AnyRecord)[String(manual.propertyKey)] as
      (message: Message<{ fail?: boolean }>) => Promise<void>;

    const ok = documentedMessage({ fail: false });
    await handler.call(service, ok.message);

    expect(ok.ack).toHaveBeenCalledTimes(1);
    expect(ok.nack).not.toHaveBeenCalled();
    expect(service.processed).toEqual([{ fail: false }]);

    const failed = documentedMessage({ fail: true });
    await handler.call(service, failed.message);

    expect(failed.nack).toHaveBeenCalledWith(true);
    expect(failed.ack).not.toHaveBeenCalled();
    expect(service.processed).toEqual([{ fail: false }]);
  });

  /**
   * @source docs:api/queue.md#lifecycle-decorators
   */
  it('registers the @OnQueueReady handler beside the subscriptions', () => {
    const handlers = getLifecycleHandlers(OrderService, 'ON_READY');

    expect(handlers.length).toBe(1);
    expect(handlers[0].propertyKey).toBe('handleReady');

    const service = new OrderService();
    (service as unknown as AnyRecord)[String(handlers[0].propertyKey)]();

    expect(service.readyCount).toBe(1);
  });

  it("reports a nacked message as failed, which is the recipe's only effect on core NATS", async () => {
    // From docs/api/queue.md#subscribe-options: on NatsQueueAdapter the recipe "does not
    // fail — it does nothing"; neither ack() nor nack() reaches the wire, and the failure
    // event is the only trace the nack leaves.
    const adapter = new NatsQueueAdapter({ servers: 'nats://localhost:4222' });

    let processed = 0;
    const failures: Error[] = [];
    adapter.on('onMessageProcessed', () => {
      processed += 1;
    });
    adapter.on('onMessageFailed', (_message, error) => {
      failures.push(error as Error);
    });

    await (adapter as unknown as AnyRecord).processMessage(
      {
        pattern: 'orders.created',
        async handler(message: Message<unknown>) {
          await message.nack(true);
        },
        options: { ackMode: 'manual' },
        matcher: createQueuePatternMatcher('orders.created'),
        paused: false,
        ackMode: 'manual',
      },
      {
        subject: 'orders.created',
        data: JSON.stringify({ id: 'readme-1', pattern: 'orders.created', data: {} }),
      },
    );

    expect(processed).toBe(0);
    expect(failures.length).toBe(1);
    // `requeue` is not honoured, so the drop is visible only through this error.
    expect(failures[0].message).toContain('nacked by its handler');
    expect(failures[0].message).toContain('readme-1');
  });
});
