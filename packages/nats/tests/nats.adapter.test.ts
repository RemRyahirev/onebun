/**
 * NATS Queue Adapter Tests
 * 
 * Note: These tests don't require a running NATS server.
 * They test the adapter's properties and error handling.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
} from 'bun:test';

import type {
  Message,
  MessageHandler,
  SubscribeOptions,
} from '@onebun/core';
import { createQueuePatternMatcher, resolveAckMode } from '@onebun/core';

import { NatsQueueAdapter, createNatsQueueAdapter } from '../src/nats.adapter';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>;

function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('NatsQueueAdapter', () => {
  let adapter: NatsQueueAdapter;

  beforeEach(() => {
    adapter = new NatsQueueAdapter({
      servers: 'nats://localhost:4222',
    });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('nats');
    });

    it('should have correct type', () => {
      expect(adapter.type).toBe('nats');
    });
  });

  describe('lifecycle', () => {
    it('should not be connected initially', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    /**
     * The real `NatsClient` with only the driver connection substituted on it: the driver is
     * resolved through a module-level dynamic import, and `mock.module` is banned in this repo.
     * The double models what `@nats-io/nats-core` does — a drain that succeeds ends by closing,
     * one that fails leaves the connection open.
     */
    function connectWith(drain: () => Promise<void>) {
      const state = { closed: false };
      let markClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        markClosed = () => {
          state.closed = true;
          resolve();
        };
      });
      const nc = {
        drain: mock(async () => {
          await drain();
          markClosed();
        }),
        close: mock(async () => {
          markClosed();
        }),
        isClosed: mock(() => state.closed),
        closed: mock(() => closed),
      };
      const unsubscribe = mock(() => undefined);
      const a = asAny(adapter);
      a.client.nc = nc;
      a.connected = true;
      a.subscriptions = [{ pattern: 'orders.*', handle: { unsubscribe } }];

      return { nc, state, unsubscribe };
    }

    it('disconnect() on a healthy connection drains, closes and resolves', async () => {
      const { nc, state, unsubscribe } = connectWith(() => Promise.resolve());
      expect(adapter.isConnected()).toBe(true);

      await expect(adapter.disconnect()).resolves.toBeUndefined();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(nc.drain).toHaveBeenCalledTimes(1);
      expect(state.closed).toBe(true);
      expect(adapter.isConnected()).toBe(false);
    });

    it('disconnect() during an outage closes the connection, resets its state and rethrows the drain error', async () => {
      const drainError = new Error('connection disconnected');
      const { nc, state } = connectWith(() => Promise.reject(drainError));

      await expect(adapter.disconnect()).rejects.toBe(drainError);

      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(state.closed).toBe(true);
      expect(asAny(adapter).connected).toBe(false);
      expect(asAny(adapter).client.getConnection()).toBeNull();
      expect(adapter.isConnected()).toBe(false);
    });

    it('disconnect() resets its own state when the client disconnect rejects', async () => {
      connectWith(() => Promise.resolve());
      const failure = new Error('connection disconnected');
      const a = asAny(adapter);
      a.client.disconnect = mock(() => Promise.reject(failure));
      a.client.isConnected = mock(() => true);

      await expect(adapter.disconnect()).rejects.toBe(failure);

      // The client double still answers `isConnected() === true`, so a false here can only
      // come from the adapter's own flag.
      expect(adapter.isConnected()).toBe(false);
      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(a.client.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('feature support', () => {
    it('should support pattern-subscriptions', () => {
      expect(adapter.supports('pattern-subscriptions')).toBe(true);
    });

    it('should support consumer-groups', () => {
      expect(adapter.supports('consumer-groups')).toBe(true);
    });

    it('should not support delayed-messages', () => {
      expect(adapter.supports('delayed-messages')).toBe(false);
    });

    it('should not support priority', () => {
      expect(adapter.supports('priority')).toBe(false);
    });

    it('should not support dead-letter-queue', () => {
      expect(adapter.supports('dead-letter-queue')).toBe(false);
    });

    it('should not support retry', () => {
      expect(adapter.supports('retry')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw when publishing without connecting', async () => {
      await expect(adapter.publish('test', { data: 'test' })).rejects.toThrow(
        'NatsQueueAdapter not connected',
      );
    });

    it('should throw when subscribing without connecting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await expect(adapter.subscribe('test', async () => {})).rejects.toThrow(
        'NatsQueueAdapter not connected',
      );
    });

  });

  describe("ackMode 'none'", () => {
    it('accepts none the same way it accepts auto and manual', async () => {
      // Core NATS has no acknowledgement protocol at all — `ack()`/`nack()` on this
      // adapter's Message are permanent no-ops — so 'none' is the only mode that
      // describes what it really does. Nothing on the wire varies with the choice.
      await expect(adapter.subscribe('test', async () => undefined, { ackMode: 'none' }))
        .rejects.toThrow('NatsQueueAdapter not connected');
      await expect(adapter.subscribe('test', async () => undefined, { ackMode: 'auto' }))
        .rejects.toThrow('NatsQueueAdapter not connected');
    });

    it('type-checks none as a valid AckMode on SubscribeOptions', () => {
      const options: SubscribeOptions = { ackMode: 'none' };

      expect(options.ackMode).toBe('none');
    });
  });

  describe('message disposition events', () => {
    /**
     * Drives `processMessage` directly. The alternative is a live broker, and the
     * behaviour under test is entirely local: which event the loop emits once the
     * handler has returned.
     */
    async function deliver(handler: MessageHandler, options?: SubscribeOptions): Promise<{
      processed: Message[];
      failed: Array<{ message: Message; error: Error }>;
    }> {
      const processed: Message[] = [];
      const failed: Array<{ message: Message; error: Error }> = [];

      adapter.on('onMessageProcessed', (message) => {
        processed.push(message as Message);
      });
      adapter.on('onMessageFailed', (message, error) => {
        failed.push({ message: message as Message, error: error as Error });
      });

      const entry = {
        pattern: 'orders.created',
        handler,
        options,
        matcher: createQueuePatternMatcher('orders.created'),
        paused: false,
        ackMode: resolveAckMode(options),
      };
      const natsMsg = {
        subject: 'orders.created',
        data: JSON.stringify({
          id: 'msg-1',
          pattern: 'orders.created',
          data: { orderId: 7 },
          timestamp: 1,
          metadata: {},
        }),
      };

      await asAny(adapter).processMessage(entry, natsMsg);

      return { processed, failed };
    }

    it('reports a nacked message as failed, not processed', async () => {
      // The bug this pins: a handler that catches its own exception and nacks RESOLVES,
      // so the loop used to read it as a success and every queue metric counted it as one.
      const { processed, failed } = await deliver(async (message) => {
        await message.nack(true);
      });

      expect(processed.length).toBe(0);
      expect(failed.length).toBe(1);
      expect(failed[0].error.message).toContain('nacked by its handler');
      expect(failed[0].message.id).toBe('msg-1');
    });

    it('still reports an acked message as processed', async () => {
      const { processed, failed } = await deliver(async (message) => {
        await message.ack();
      });

      expect(processed.length).toBe(1);
      expect(failed.length).toBe(0);
    });

    it('reports a handler that returns without acknowledging as processed', async () => {
      const { processed, failed } = await deliver(async () => undefined);

      expect(processed.length).toBe(1);
      expect(failed.length).toBe(0);
    });

    it('emits exactly one event when a handler both nacks and throws', async () => {
      const { processed, failed } = await deliver(async (message) => {
        await message.nack(true);
        throw new Error('Handler error');
      });

      expect(processed.length).toBe(0);
      expect(failed.length).toBe(1);
      // The throw is the more specific signal, so it wins over the generic nack error.
      expect(failed[0].error.message).toBe('Handler error');
    });

    it('lets the first disposition win when a handler acks then nacks', async () => {
      const { processed, failed } = await deliver(async (message) => {
        await message.ack();
        await message.nack(true);
      });

      expect(processed.length).toBe(1);
      expect(failed.length).toBe(0);
    });

    it("reports a nacked message as failed under ackMode 'none' too", async () => {
      // 'none' changes nothing here: core NATS never acknowledged anything in any mode,
      // so the mode cannot be what decides whether a drop is observable.
      const { processed, failed } = await deliver(async (message) => {
        await message.nack(true);
      }, { ackMode: 'none' });

      expect(processed.length).toBe(0);
      expect(failed.length).toBe(1);
    });
  });

  describe('captured pattern parameters', () => {
    /**
     * Same shape as the disposition tests above: `processMessage` is the whole delivery path
     * once a frame has arrived, and what is under test is entirely local. NATS widens `{id}`
     * to `*` on the wire, so the broker captures nothing — the values can only come from the
     * in-process match that narrows the subject back.
     */
    async function deliverTo(pattern: string, subject: string): Promise<Message | null> {
      let received: Message | null = null;

      const entry = {
        pattern,
        async handler(message: Message) {
          received = message;
        },
        options: undefined,
        matcher: createQueuePatternMatcher(pattern),
        paused: false,
        ackMode: resolveAckMode(undefined),
      };
      const natsMsg = {
        subject,
        data: JSON.stringify({
          id: 'msg-1',
          pattern: subject,
          data: { n: 1 },
          timestamp: 1,
          metadata: {},
        }),
      };

      await asAny(adapter).processMessage(entry, natsMsg);

      return received;
    }

    it('hands the handler the value its {name} captured', async () => {
      const message = await deliverTo('orders.{id}', 'orders.123');

      expect(message?.params).toEqual({ id: '123' });
      expect(message?.pattern).toBe('orders.123');
    });

    it('captures every parameter of a multi-parameter pattern', async () => {
      const message = await deliverTo('orders.{id}.items.{itemId}', 'orders.42.items.abc');

      expect(message?.params).toEqual({ id: '42', itemId: 'abc' });
    });

    it('answers with an empty object for a pattern that captures nothing', async () => {
      expect((await deliverTo('orders.*', 'orders.created'))?.params).toEqual({});
      expect((await deliverTo('events.#', 'events.user.signed'))?.params).toEqual({});
      expect((await deliverTo('orders.created', 'orders.created'))?.params).toEqual({});
    });

    it('does not put the captured values on the wire as metadata', async () => {
      // They are a function of the SUBSCRIBER's pattern, so the envelope never carries them.
      const message = await deliverTo('orders.{id}', 'orders.9');

      expect(Object.keys(message?.metadata ?? {})).not.toContain('params');
    });
  });

  describe('delivery subject', () => {
    /**
     * `processMessage` with a frame the server delivered on `subject` whose envelope names
     * `envelopePattern`. Any client allowed to publish on one subject can write another pattern
     * into the envelope; the subject is the server's.
     */
    async function deliverOn(
      pattern: string,
      frame: { subject: string; data: string; headers?: Map<string, string[]> },
    ): Promise<Message | null> {
      let received: Message | null = null;

      const entry = {
        pattern,
        async handler(message: Message) {
          received = message;
        },
        options: undefined,
        matcher: createQueuePatternMatcher(pattern),
        paused: false,
        ackMode: resolveAckMode(undefined),
      };

      await asAny(adapter).processMessage(entry, frame);

      return received;
    }

    function envelope(pattern: string): string {
      return JSON.stringify({
        id: 'forged-1', pattern, data: { ok: true }, timestamp: 1, metadata: { claimedBy: 'b' },
      });
    }

    it('captures params from the subject the message arrived on, not from the envelope', async () => {
      // onebun-FB-53: delivered on `app-a.wq.result.1`, the envelope claiming `app-b.wq.result.999`.
      const message = await deliverOn('*.wq.result.{id}', {
        subject: 'app-a.wq.result.1',
        data: envelope('app-b.wq.result.999'),
      });

      expect(message?.pattern).toBe('app-a.wq.result.1');
      expect(message?.subject).toBe('app-a.wq.result.1');
      expect(message?.params).toEqual({ id: '1' });
      // The rest of the envelope is the publisher's to write, and arrives as written.
      expect(message?.id).toBe('forged-1');
      expect(message?.metadata).toEqual({ claimedBy: 'b' });
    });

    it('does not run a handler its subject does not match, whatever the envelope names', async () => {
      // `jobs.v{version}` subscribes the wider `jobs.*`, so the server hands it `jobs.x` too.
      const message = await deliverOn('jobs.v{version}', { subject: 'jobs.x', data: envelope('jobs.v2') });

      expect(message).toBeNull();
    });

    it('runs the handler its subject matches, whatever the envelope names', async () => {
      const message = await deliverOn('jobs.v{version}', { subject: 'jobs.v3', data: envelope('jobs.x') });

      expect(message?.params).toEqual({ version: '3' });
      expect(message?.pattern).toBe('jobs.v3');
    });

    it('delivers a message whose envelope pattern is not a string, matched on its subject', async () => {
      const message = await deliverOn('orders.{id}', {
        subject: 'orders.8',
        data: JSON.stringify({
          id: 'n-1', pattern: 123, data: {}, timestamp: 1,
        }),
      });

      expect(message?.params).toEqual({ id: '8' });
      expect(message?.pattern).toBe('orders.8');
    });

    it('exposes the wire headers and no stream', async () => {
      const headers = new Map([['X-Probe', ['a', 'b']]]);
      const message = await deliverOn('orders.created', {
        subject: 'orders.created',
        data: envelope('orders.created'),
        headers,
      });

      expect(message?.headers?.get('X-Probe')).toEqual(['a', 'b']);
      // Core NATS has no streams.
      expect(message?.stream).toBeUndefined();
    });

    it('leaves headers undefined on a message that carried none', async () => {
      const message = await deliverOn('orders.created', { subject: 'orders.created', data: envelope('orders.created') });

      expect(message?.headers).toBeUndefined();
    });

    it('carries headers through a spread, as an own property like JetStream', async () => {
      const headers = new Map([['X-Probe', ['a']]]);
      const message = await deliverOn('orders.created', {
        subject: 'orders.created',
        data: envelope('orders.created'),
        headers,
      });

      expect(({ ...message } as Message).headers).toBe(headers);
      expect(Object.keys(message!)).toContain('headers');
    });

    describe('a message published through publish()', () => {
      /**
       * Publishes through the adapter, then delivers exactly what reached the client. The
       * expectation is what the envelope-reading path gave — `pattern` from the envelope's own
       * field, `params` from matching it — so this pins "unchanged for publish()".
       */
      async function roundTrip(subscription: string, topic: string) {
        const sent: Array<{ subject: string; data: string; headers?: Record<string, string> }> = [];
        const a = asAny(adapter);
        a.connected = true;
        a.client = {
          publish: mock(async (subject: string, data: string, headers?: Record<string, string>) => {
            sent.push({ subject, data, headers });
          }),
        };

        // eslint-disable-next-line @typescript-eslint/naming-convention
        await adapter.publish(topic, { n: 1 }, { metadata: { headers: { 'X-Probe': 'p' } } });

        const [frame] = sent;
        const envelopePattern = (JSON.parse(frame.data) as { pattern: string }).pattern;
        const message = await deliverOn(subscription, {
          subject: frame.subject,
          data: frame.data,
          headers: new Map(Object.entries(frame.headers ?? {}).map(([name, value]) => [name, [value]])),
        });

        return {
          message,
          envelopePattern,
          expectedParams: createQueuePatternMatcher(subscription)(envelopePattern).params,
        };
      }

      for (const [subscription, topic] of [
        ['orders.{id}', 'orders.42'],
        ['{kind}.{id}', 'orders.42'],
        ['orders.*', 'orders.created'],
        ['orders.#', 'orders.42.shipped'],
        ['orders.created', 'orders.created'],
      ] as const) {
        it(`shows the same pattern and params as before for ${topic} on ${subscription}`, async () => {
          const { message, envelopePattern, expectedParams } = await roundTrip(subscription, topic);

          expect(message?.pattern).toBe(envelopePattern);
          expect(message?.params).toEqual(expectedParams);
          expect(message?.subject).toBe(topic);
          expect(message?.headers?.get('X-Probe')).toEqual(['p']);
        });
      }
    });
  });

  describe('event handlers', () => {
    it('should register and unregister event handlers', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler = () => {};

      // Should not throw
      adapter.on('onReady', handler);
      adapter.off('onReady', handler);

      expect(true).toBe(true);
    });

    it('should register multiple handlers for same event', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler1 = () => {};
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler2 = () => {};

      adapter.on('onError', handler1);
      adapter.on('onError', handler2);

      expect(true).toBe(true);
    });
  });

  describe('createNatsQueueAdapter', () => {
    it('should create adapter instance', () => {
      const created = createNatsQueueAdapter({
        servers: 'nats://localhost:4222',
      });

      expect(created).toBeInstanceOf(NatsQueueAdapter);
      expect(created.name).toBe('nats');
    });

    it('should accept multiple servers', () => {
      const created = createNatsQueueAdapter({
        servers: ['nats://host1:4222', 'nats://host2:4222'],
      });

      expect(created).toBeInstanceOf(NatsQueueAdapter);
    });
  });
});
