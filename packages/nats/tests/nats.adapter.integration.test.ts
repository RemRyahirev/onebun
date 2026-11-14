/**
 * NATS Queue Adapter Integration Tests
 * 
 * Tests using testcontainers for real NATS server integration
 */

import { headers } from '@nats-io/transport-node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';

import type { Message } from '@onebun/core';
import { createNatsContainer, type TestContainer } from '@onebun/core/testing';


import {
  createNatsClient,
  type NatsClient,
  type NatsMessage,
} from '../src/nats-client';
import { NatsQueueAdapter, createNatsQueueAdapter } from '../src/nats.adapter';

/**
 * Kept below bun's default 5s per-test timeout, so a predicate that never holds fails the case
 * with pollUntil's own message rather than with a bare "timed out" and the reason lost.
 */
const POLL_DEADLINE_MS = 3_000;
const POLL_INTERVAL_MS = 10;

/** Polls instead of sleeping for a guessed duration, so a slow container costs latency, not a flake. */
async function pollUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(`pollUntil: predicate did not hold within ${POLL_DEADLINE_MS}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Returns once the server has registered every subscription `client` has sent so far.
 *
 * `subscribe()` resolves when the SUB is queued on the subscriber's own connection, not when the
 * server has it. A publish on that same connection is ordered behind it; one on another
 * connection is not, and can reach the server first — the message is then dropped, and a
 * request is rejected at once with no responders. A flush is a round trip on the subscriber's
 * connection, which the server answers only after processing everything sent before it.
 */
async function subscriptionsRegistered(client: NatsClient): Promise<void> {
  await client.getConnection().flush();
}

/** The adapter's own client, which it keeps private — needed only to flush its subscriptions. */
function clientOf(queue: NatsQueueAdapter): NatsClient {
  return (queue as unknown as { client: NatsClient }).client;
}

describe('NatsQueueAdapter Integration', () => {
  let nats: TestContainer;
  let natsUrl: string;
  let adapter: NatsQueueAdapter;

  beforeAll(async () => {
    nats = await createNatsContainer();
    natsUrl = nats.url;
  });

  afterAll(async () => {
    await nats.stop();
  });

  beforeEach(() => {
    adapter = createNatsQueueAdapter({
      servers: natsUrl,
    });
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });

  describe('lifecycle', () => {
    it('should connect successfully', async () => {
      await adapter.connect();
      
      expect(adapter.isConnected()).toBe(true);
    });

    it('should not connect twice', async () => {
      await adapter.connect();
      await adapter.connect(); // Should be no-op
      
      expect(adapter.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await adapter.connect();
      await adapter.disconnect();
      
      expect(adapter.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw
      await adapter.disconnect();
      
      expect(adapter.isConnected()).toBe(false);
    });

    it('should emit onReady event on connect', async () => {
      const onReady = mock(() => undefined);
      adapter.on('onReady', onReady);
      
      await adapter.connect();
      
      expect(onReady).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishing', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should publish a message and return message ID', async () => {
      const messageId = await adapter.publish('test.topic', { hello: 'world' });
      
      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe('string');
      expect(messageId).toMatch(/^nats-/);
    });

    it('should publish with custom message ID', async () => {
      const customId = 'custom-msg-123';
      const messageId = await adapter.publish('test.topic', { data: 1 }, {
        messageId: customId,
      });
      
      expect(messageId).toBe(customId);
    });

    it('should publish with metadata', async () => {
      const messageId = await adapter.publish('test.topic', { data: 1 }, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        metadata: { source: 'test', headers: { 'X-Custom': 'value' } },
      });
      
      expect(messageId).toBeDefined();
    });

    it('should throw when publishing while disconnected', async () => {
      await adapter.disconnect();
      
      await expect(
        adapter.publish('test.topic', { data: 1 }),
      ).rejects.toThrow('not connected');
    });

    it('should publish batch messages', async () => {
      const ids = await adapter.publishBatch([
        { pattern: 'test.batch', data: { num: 1 } },
        { pattern: 'test.batch', data: { num: 2 } },
        { pattern: 'test.batch', data: { num: 3 } },
      ]);
      
      expect(ids).toHaveLength(3);
      expect(ids.every((id) => id.startsWith('nats-'))).toBe(true);
    });
  });

  describe('subscribing', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should subscribe and receive messages', async () => {
      const received: Message<{ value: number }>[] = [];
      
      const subscription = await adapter.subscribe<{ value: number }>(
        'test.subscribe',
        async (message) => {
          received.push(message);
        },
      );
      
      expect(subscription).toBeDefined();
      expect(subscription.pattern).toBe('test.subscribe');
      expect(subscription.isActive).toBe(true);
      
      // Publish a message
      await adapter.publish('test.subscribe', { value: 42 });
      
      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 30));
      
      expect(received).toHaveLength(1);
      expect(received[0].data).toEqual({ value: 42 });
      
      await subscription.unsubscribe();
    });

    it('should support pattern subscriptions with wildcard', async () => {
      const received: Message<{ type: string }>[] = [];
      
      const subscription = await adapter.subscribe<{ type: string }>(
        'orders.*',
        async (message) => {
          received.push(message);
        },
      );
      
      // Publish to different sub-topics
      await adapter.publish('orders.created', { type: 'created' });
      await adapter.publish('orders.updated', { type: 'updated' });
      await adapter.publish('orders.deleted', { type: 'deleted' });
      
      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 30));
      
      expect(received.length).toBeGreaterThanOrEqual(3);
      
      await subscription.unsubscribe();
    });

    it('should unsubscribe from pattern', async () => {
      let received = 0;
      
      const subscription = await adapter.subscribe('test.unsub', async () => {
        received++;
      });
      
      // Receive one message
      await adapter.publish('test.unsub', { data: 1 });
      await new Promise((r) => setTimeout(r, 30));
      
      const countBeforeUnsub = received;
      
      await subscription.unsubscribe();
      expect(subscription.isActive).toBe(false);
      
      // Publish after unsubscribe
      await adapter.publish('test.unsub', { data: 2 });
      await new Promise((r) => setTimeout(r, 30));
      
      // Should not receive new messages
      expect(received).toBe(countBeforeUnsub);
    });

    it('should pause and resume subscription', async () => {
      const received: number[] = [];
      
      const subscription = await adapter.subscribe<{ n: number }>('test.pause', async (msg) => {
        received.push(msg.data.n);
      });
      
      // Receive first message
      await adapter.publish('test.pause', { n: 1 });
      await new Promise((r) => setTimeout(r, 30));
      
      // Pause
      subscription.pause();
      expect(subscription.isActive).toBe(false);
      
      // This message should be ignored
      await adapter.publish('test.pause', { n: 2 });
      await new Promise((r) => setTimeout(r, 30));
      
      // Resume
      subscription.resume();
      expect(subscription.isActive).toBe(true);
      
      // This message should be received
      await adapter.publish('test.pause', { n: 3 });
      await new Promise((r) => setTimeout(r, 30));
      
      // Should have messages 1 and 3, but not 2
      expect(received).toContain(1);
      expect(received).toContain(3);
      // Note: Message 2 may or may not be received depending on timing
      
      await subscription.unsubscribe();
    });

    it('should emit onMessageReceived event', async () => {
      const onReceived = mock(() => undefined);
      adapter.on('onMessageReceived', onReceived);
      
      await adapter.subscribe('test.events', async () => undefined);
      await adapter.publish('test.events', { data: 1 });
      
      await new Promise((r) => setTimeout(r, 30));
      
      expect(onReceived).toHaveBeenCalled();
    });

    it('should emit onMessageProcessed event', async () => {
      const onProcessed = mock(() => undefined);
      adapter.on('onMessageProcessed', onProcessed);
      
      await adapter.subscribe('test.processed', async () => undefined);
      await adapter.publish('test.processed', { data: 1 });
      
      await new Promise((r) => setTimeout(r, 30));
      
      expect(onProcessed).toHaveBeenCalled();
    });

    it('should emit onMessageFailed event on handler error', async () => {
      const onFailed = mock(() => undefined);
      adapter.on('onMessageFailed', onFailed);
      
      await adapter.subscribe('test.fail', async () => {
        throw new Error('Handler error');
      });
      await adapter.publish('test.fail', { data: 1 });
      
      await new Promise((r) => setTimeout(r, 30));
      
      expect(onFailed).toHaveBeenCalled();
    });

    it('should support queue groups (consumer groups)', async () => {
      const consumer1Messages: number[] = [];
      const consumer2Messages: number[] = [];
      
      // Two consumers in the same queue group
      await adapter.subscribe<{ n: number }>(
        'test.queue',
        async (msg) => {
          consumer1Messages.push(msg.data.n);
        },
        { group: 'test-group' },
      );
      
      await adapter.subscribe<{ n: number }>(
        'test.queue',
        async (msg) => {
          consumer2Messages.push(msg.data.n);
        },
        { group: 'test-group' },
      );
      
      // Publish multiple messages
      for (let i = 1; i <= 10; i++) {
        await adapter.publish('test.queue', { n: i });
      }
      
      await new Promise((r) => setTimeout(r, 50));
      
      // Messages should be distributed between consumers
      const totalReceived = consumer1Messages.length + consumer2Messages.length;
      expect(totalReceived).toBe(10);
    });
  });

  describe('message properties', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should include message ID in received message', async () => {
      let receivedMessage: Message<unknown> | null = null;
      
      await adapter.subscribe('test.msgid', async (msg) => {
        receivedMessage = msg;
      });
      
      const sentId = await adapter.publish('test.msgid', { data: 1 });
      await new Promise((r) => setTimeout(r, 30));
      
      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.id).toBe(sentId);
    });

    it('should include pattern in received message', async () => {
      let receivedMessage: Message<unknown> | null = null;
      
      await adapter.subscribe('test.pattern', async (msg) => {
        receivedMessage = msg;
      });
      
      await adapter.publish('test.pattern', { data: 1 });
      await new Promise((r) => setTimeout(r, 30));
      
      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.pattern).toBe('test.pattern');
    });

    it('should include timestamp in received message', async () => {
      const beforePublish = Date.now();
      let receivedMessage: Message<unknown> | null = null;
      
      await adapter.subscribe('test.timestamp', async (msg) => {
        receivedMessage = msg;
      });
      
      await adapter.publish('test.timestamp', { data: 1 });
      await new Promise((r) => setTimeout(r, 30));
      
      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.timestamp).toBeGreaterThanOrEqual(beforePublish);
    });

    it('should include metadata in received message', async () => {
      let receivedMessage: Message<unknown> | null = null;
      
      await adapter.subscribe('test.metadata', async (msg) => {
        receivedMessage = msg;
      });
      
      await adapter.publish('test.metadata', { data: 1 }, {
        metadata: { source: 'test', priority: 'high' },
      });
      await new Promise((r) => setTimeout(r, 30));
      
      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.metadata).toEqual({ source: 'test', priority: 'high' });
    });

    it('should support ack() on message', async () => {
      let receivedMessage: Message<unknown> | null = null;
      
      await adapter.subscribe('test.ack', async (msg) => {
        receivedMessage = msg;
        await msg.ack(); // Should not throw
      });
      
      await adapter.publish('test.ack', { data: 1 });
      await new Promise((r) => setTimeout(r, 30));
      
      expect(receivedMessage).not.toBeNull();
    });

    it('should support nack() on message', async () => {
      let receivedMessage: Message<unknown> | null = null;
      
      await adapter.subscribe('test.nack', async (msg) => {
        receivedMessage = msg;
        await msg.nack(true); // Should not throw
      });
      
      await adapter.publish('test.nack', { data: 1 });
      await new Promise((r) => setTimeout(r, 30));

      expect(receivedMessage).not.toBeNull();
    });
  });

  /**
   * onebun-FB-39. A message carrying headers used to throw inside the client's consume loop,
   * which ended the loop: the handler never ran, and neither did it for any message after —
   * headers or not. Every case here crosses a real server, because the object the driver hands
   * back for received headers is the thing that was misread, and nothing short of a real
   * delivery produces one.
   *
   * Where the publisher is a different connection from a subscriber, the case waits for
   * `subscriptionsRegistered` before publishing; where both are the adapter, one connection
   * already orders the SUB ahead of the PUB.
   */
  describe('message headers', () => {
    /** Clients opened by a case, closed after it whether it passed or not. */
    let clients: NatsClient[] = [];

    async function connectedClient(): Promise<NatsClient> {
      const client = createNatsClient({ servers: natsUrl });
      clients.push(client);
      await client.connect();

      return client;
    }

    beforeEach(async () => {
      await adapter.connect();
    });

    afterEach(async () => {
      await Promise.all(clients.map(async (client) => await client.disconnect()));
      clients = [];
    });

    it('delivers a message published with metadata.headers, which the handler reads back as published', async () => {
      const received: Message<{ value: number }>[] = [];
      await adapter.subscribe<{ value: number }>('hdr.roundtrip', async (message) => {
        received.push(message);
      }, { ackMode: 'none' });

      await adapter.publish('hdr.roundtrip', { value: 42 }, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        metadata: { headers: { 'X-Probe': 'yes', 'x-api-key': 'k-1' } },
      });
      await pollUntil(() => received.length === 1);

      expect(received[0].data).toEqual({ value: 42 });
      // eslint-disable-next-line @typescript-eslint/naming-convention
      expect(received[0].metadata.headers).toEqual({ 'X-Probe': 'yes', 'x-api-key': 'k-1' });
    });

    it('keeps the subscription alive: a message without headers still arrives after one with them', async () => {
      const received: number[] = [];
      await adapter.subscribe<{ n: number }>('hdr.survives', async (message) => {
        received.push(message.data.n);
      });

      // eslint-disable-next-line @typescript-eslint/naming-convention
      await adapter.publish('hdr.survives', { n: 1 }, { metadata: { headers: { 'X-Probe': 'yes' } } });
      await adapter.publish('hdr.survives', { n: 2 });
      await pollUntil(() => received.length === 2);

      expect(received).toEqual([1, 2]);
    });

    it('sends metadata.headers on the wire too, names in the case they were published with', async () => {
      const observer = await connectedClient();
      const seen: NatsMessage[] = [];
      await observer.subscribe('hdr.wire', (msg) => {
        seen.push(msg);
      });
      await subscriptionsRegistered(observer);

      await adapter.publish('hdr.wire', { value: 1 }, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        metadata: { headers: { 'X-Probe': 'yes', 'x-lower': 'v' } },
      });
      await pollUntil(() => seen.length === 1);

      expect([...seen[0].headers!.entries()]).toEqual([['X-Probe', ['yes']], ['x-lower', ['v']]]);
    });

    it('delivers a message whose wire headers repeat a name, and exposes every value of it', async () => {
      // Another client's publish: MessageMetadata.headers cannot hold two values for one name, so
      // only a raw driver publish puts a repeated header on the wire.
      const sender = await connectedClient();
      const observer = await connectedClient();
      const handled: Message<{ value: number }>[] = [];
      const seen: NatsMessage[] = [];
      await adapter.subscribe<{ value: number }>('hdr.multi', async (message) => {
        handled.push(message);
      });
      await observer.subscribe('hdr.multi', (msg) => {
        seen.push(msg);
      });
      await subscriptionsRegistered(clientOf(adapter));
      await subscriptionsRegistered(observer);

      const wire = headers();
      wire.append('X-Multi', 'a');
      wire.append('X-Multi', 'b');
      const envelope = {
        id: 'foreign-1', pattern: 'hdr.multi', data: { value: 7 }, timestamp: Date.now(), metadata: {},
      };
      sender.getConnection().publish('hdr.multi', JSON.stringify(envelope), { headers: wire });
      await pollUntil(() => handled.length === 1 && seen.length === 1);

      expect(handled[0].data).toEqual({ value: 7 });
      expect(seen[0].headers!.get('X-Multi')).toEqual(['a', 'b']);
    });

    it('takes pattern and params from the subject, not the envelope, and exposes the wire headers', async () => {
      // onebun-FB-53: a client allowed to publish on `forge.a.>` writes an envelope naming
      // `forge.b.result.999`. The server routes by subject, so the handler must read that too.
      const sender = await connectedClient();
      const received: Message<unknown>[] = [];
      await adapter.subscribe('forge.*.result.{id}', async (message) => {
        received.push(message);
      });
      await subscriptionsRegistered(clientOf(adapter));

      const wire = headers();
      wire.append('X-Multi', 'a');
      wire.append('X-Multi', 'b');
      const envelope = {
        id: 'forged-1', pattern: 'forge.b.result.999', data: {}, timestamp: Date.now(), metadata: {},
      };
      sender.getConnection().publish('forge.a.result.1', JSON.stringify(envelope), { headers: wire });
      await pollUntil(() => received.length === 1);

      expect(received[0].subject).toBe('forge.a.result.1');
      expect(received[0].pattern).toBe('forge.a.result.1');
      expect(received[0].params).toEqual({ id: '1' });
      expect(received[0].headers?.get('X-Multi')).toEqual(['a', 'b']);
      expect(received[0].stream).toBeUndefined();
    });

    it('leaves NatsMessage.headers absent on a message that carried none', async () => {
      const sender = await connectedClient();
      const observer = await connectedClient();
      const seen: NatsMessage[] = [];
      await observer.subscribe('hdr.none', (msg) => {
        seen.push(msg);
      });
      await subscriptionsRegistered(observer);

      await sender.publish('hdr.none', 'plain');
      await pollUntil(() => seen.length === 1);

      expect(seen[0].data).toBe('plain');
      expect(seen[0].headers).toBeUndefined();
    });

    it('resolves a request whose reply carries headers, with every value of each', async () => {
      const requester = await connectedClient();
      const responder = await connectedClient();
      await responder.subscribe('hdr.rpc', (msg) => {
        const wire = headers();
        wire.append('X-Reply', 'a');
        wire.append('X-Reply', 'b');
        wire.set('x-lower', 'v');
        responder.getConnection().publish(msg.reply!, 'pong', { headers: wire });
      });
      await subscriptionsRegistered(responder);

      const response = await requester.request('hdr.rpc', 'ping', { timeout: POLL_DEADLINE_MS });

      expect(response.data).toBe('pong');
      expect([...response.headers!.entries()]).toEqual([['X-Reply', ['a', 'b']], ['x-lower', ['v']]]);
    });

    it('resolves a request whose reply carries no headers, with headers absent', async () => {
      const requester = await connectedClient();
      const responder = await connectedClient();
      await responder.subscribe('hdr.rpc-plain', async (msg) => {
        await responder.publish(msg.reply!, 'pong');
      });
      await subscriptionsRegistered(responder);

      const response = await requester.request('hdr.rpc-plain', 'ping', { timeout: POLL_DEADLINE_MS });

      expect(response.data).toBe('pong');
      expect(response.headers).toBeUndefined();
    });
  });

  /**
   * `inboxPrefix` against a real server, observed from the other end of the wire.
   *
   * It cannot be asserted from the client that set it — the option is consumed inside the
   * driver — so this watches a second connection receive the request and reads the reply
   * subject the first one generated. That subject IS the inbox, which is the whole reason the
   * option exists: a broker that grants a tenant SUBSCRIBE on `_INBOX_<tenant>.>` and nothing
   * wider cannot answer a client still using the driver's `_INBOX` default.
   */
  describe('inboxPrefix', () => {
    const PREFIX = '_INBOX_tenant_app';

    it('generates reply subjects under the configured prefix', async () => {
      const requester = createNatsClient({ servers: natsUrl, inboxPrefix: PREFIX });
      const responder = createNatsClient({ servers: natsUrl });

      try {
        await requester.connect();
        await responder.connect();

        let replySubject: string | undefined;
        await responder.subscribe('inbox.echo', async (msg) => {
          replySubject = msg.reply;
          await responder.publish(msg.reply!, 'pong');
        });
        await subscriptionsRegistered(responder);

        const response = await requester.request('inbox.echo', 'ping', { timeout: 5_000 });

        expect(response.data).toBe('pong');
        expect(replySubject).toBeDefined();
        expect(replySubject!.startsWith(`${PREFIX}.`)).toBe(true);
      } finally {
        await requester.disconnect();
        await responder.disconnect();
      }
    });

    it('uses the driver default when no prefix is configured', async () => {
      // The control: without this, a prefix that never reached the driver would still pass the
      // case above if the assertion were written against a default that happened to match.
      const requester = createNatsClient({ servers: natsUrl });
      const responder = createNatsClient({ servers: natsUrl });

      try {
        await requester.connect();
        await responder.connect();

        let replySubject: string | undefined;
        await responder.subscribe('inbox.default', async (msg) => {
          replySubject = msg.reply;
          await responder.publish(msg.reply!, 'pong');
        });
        await subscriptionsRegistered(responder);

        await requester.request('inbox.default', 'ping', { timeout: 5_000 });

        expect(replySubject!.startsWith('_INBOX.')).toBe(true);
      } finally {
        await requester.disconnect();
        await responder.disconnect();
      }
    });
  });

});
