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
