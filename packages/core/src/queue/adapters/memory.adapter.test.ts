/**
 * In-Memory Queue Adapter Tests
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import type { Message } from '../types';

import { useFakeTimers } from '../../testing/test-utils';

import { InMemoryQueueAdapter, createInMemoryQueueAdapter } from './memory.adapter';

describe('InMemoryQueueAdapter', () => {
  let adapter: InMemoryQueueAdapter;

  beforeEach(() => {
    adapter = new InMemoryQueueAdapter();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('lifecycle', () => {
    it('should connect successfully', async () => {
      expect(adapter.isConnected()).toBe(false);
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should handle multiple connect calls', async () => {
      await adapter.connect();
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it('should have correct name and type', () => {
      expect(adapter.name).toBe('memory');
      expect(adapter.type).toBe('memory');
    });
  });

  describe('publish/subscribe', () => {
    it('should publish and receive messages', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.created', async (message) => {
        received.push(message);
      });

      await adapter.publish('orders.created', { orderId: 123 });

      expect(received.length).toBe(1);
      expect(received[0].data).toEqual({ orderId: 123 });
      expect(received[0].pattern).toBe('orders.created');
    });

    it('should accept ackTimeout and ignore it', async () => {
      // The documented contract for adapters with no server-side acknowledgement
      // window: the option is accepted and has no effect, it never throws.
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.created', async (message) => {
        received.push(message);
      }, { ackTimeout: 30_000 });

      await adapter.publish('orders.created', { orderId: 123 });

      expect(received.length).toBe(1);
    });

    it('should match wildcard patterns', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.*', async (message) => {
        received.push(message);
      });

      await adapter.publish('orders.created', { type: 'created' });
      await adapter.publish('orders.updated', { type: 'updated' });
      await adapter.publish('users.created', { type: 'user' }); // Should not match

      expect(received.length).toBe(2);
      expect(received[0].data).toEqual({ type: 'created' });
      expect(received[1].data).toEqual({ type: 'updated' });
    });

    it('should match multi-level wildcard (#)', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('events.#', async (message) => {
        received.push(message);
      });

      await adapter.publish('events.user.created', { type: 'user' });
      await adapter.publish('events.order.payment.completed', { type: 'payment' });

      expect(received.length).toBe(2);
    });

    it('should return message ID on publish', async () => {
      await adapter.connect();

      const messageId = await adapter.publish('test', { data: 'test' });
      expect(messageId).toMatch(/^msg-\d+-\d+$/);
    });

    it('should use custom message ID when provided', async () => {
      await adapter.connect();

      const messageId = await adapter.publish('test', { data: 'test' }, { messageId: 'custom-id' });
      expect(messageId).toBe('custom-id');
    });
  });

  describe('captured pattern parameters', () => {
    it('hands the handler the value its {name} captured', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.{id}', async (message) => {
        received.push(message);
      });

      await adapter.publish('orders.123', { total: 10 });

      expect(received).toHaveLength(1);
      expect(received[0].params).toEqual({ id: '123' });
      // The pattern stays the DELIVERED topic; the captured values are the new information.
      expect(received[0].pattern).toBe('orders.123');
    });

    it('captures every parameter of a multi-parameter pattern, in the right order', async () => {
      // A single-parameter case passes on a coincidence — one captured group cannot be
      // mismatched with another, and a regex that captured the wrong segment would still
      // produce something. Two parameters at different depths cannot.
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.{id}.items.{itemId}', async (message) => {
        received.push(message);
      });

      await adapter.publish('orders.42.items.abc', { qty: 1 });

      expect(received).toHaveLength(1);
      expect(received[0].params).toEqual({ id: '42', itemId: 'abc' });
    });

    it('gives each subscription its own values for one published topic', async () => {
      // Params are a function of the SUBSCRIBER's pattern, not of the publish. One topic
      // reaching two patterns must not give both the same object, or the second handler
      // reads the first one's capture.
      await adapter.connect();

      const byName: Record<string, Record<string, string>> = {};
      await adapter.subscribe('orders.{id}', async (message) => {
        byName.single = message.params;
      });
      await adapter.subscribe('orders.{orderId}', async (message) => {
        byName.renamed = message.params;
      });
      await adapter.subscribe('orders.*', async (message) => {
        byName.wildcard = message.params;
      });

      await adapter.publish('orders.777', { total: 1 });

      expect(byName.single).toEqual({ id: '777' });
      expect(byName.renamed).toEqual({ orderId: '777' });
      // A `*` captures nothing, and answers with an object rather than undefined.
      expect(byName.wildcard).toEqual({});
    });

    it('answers with an empty object for a pattern that captures nothing', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.created', async (message) => {
        received.push(message);
      });
      await adapter.subscribe('events.#', async (message) => {
        received.push(message);
      });

      await adapter.publish('orders.created', { a: 1 });
      await adapter.publish('events.user.signed.up', { b: 2 });

      expect(received).toHaveLength(2);
      // Never undefined: a handler reads `message.params.x` without guarding the access.
      expect(received[0].params).toEqual({});
      expect(received[1].params).toEqual({});
    });

    it('carries the same values into every retry of a failed delivery', async () => {
      await adapter.connect();

      const seen: Array<Record<string, string>> = [];
      await adapter.subscribe('orders.{id}', async (message) => {
        seen.push(message.params);

        if (seen.length < 3) {
          throw new Error('not yet');
        }
      }, { retry: { attempts: 3, delay: 0 } });

      await adapter.publish('orders.555', { total: 1 });

      expect(seen).toEqual([{ id: '555' }, { id: '555' }, { id: '555' }]);
    });

    it('gives two subscriptions distinct objects, and one delivery one object across retries', async () => {
      // The documented ownership rule, as identity rather than as equal values: a handler that
      // mutates `params` can only affect its own next attempt, never another subscription.
      await adapter.connect();

      const first: Array<Record<string, string>> = [];
      const second: Array<Record<string, string>> = [];

      await adapter.subscribe('orders.{id}', async (message) => {
        first.push(message.params);

        if (first.length < 2) {
          throw new Error('retry me');
        }
      }, { retry: { attempts: 2, delay: 0 } });

      await adapter.subscribe('orders.{orderId}', async (message) => {
        second.push(message.params);
      });

      await adapter.publish('orders.5', { total: 1 });

      // Same delivery, two attempts: one object.
      expect(first).toHaveLength(2);
      expect(first[0]).toBe(first[1]);
      // Different subscription: a different object, and different names.
      expect(second[0]).not.toBe(first[0]);
      expect(second[0]).toEqual({ orderId: '5' });
    });

    it('does not put the captured values on the wire as metadata', async () => {
      // They are derived per subscription, so a publisher never sends them and a
      // metadata key of the same name is the publisher's own.
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('orders.{id}', async (message) => {
        received.push(message);
      });

      await adapter.publish('orders.9', { total: 1 });

      expect(Object.keys(received[0].metadata)).not.toContain('params');
    });
  });

  describe('delayed messages', () => {
    let advanceTime: (ms: number) => void;
    let restore: () => void;

    beforeEach(() => {
      const fakeTimers = useFakeTimers();
      advanceTime = fakeTimers.advanceTime;
      restore = fakeTimers.restore;
    });

    afterEach(() => {
      restore();
    });

    it('should delay message delivery', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('delayed', async (message) => {
        received.push(message);
      });

      await adapter.publish('delayed', { data: 'delayed' }, { delay: 50 });

      // Message should not be received immediately
      expect(received.length).toBe(0);

      // Advance time past the delay + processing
      advanceTime(200);

      expect(received.length).toBe(1);
      expect(received[0].data).toEqual({ data: 'delayed' });
    });

    // The buffer used to be sorted priority-first and read head-first, so a far-future message
    // with a high priority sat at index 0 and held every earlier-due message behind it.
    it('should not let a later, higher-priority message hold back a due one', async () => {
      await adapter.connect();

      const received: string[] = [];
      await adapter.subscribe('due.*', async (message) => {
        received.push(message.pattern);
      });

      await adapter.publish('due.slow', {}, { delay: 3000, priority: 10 });
      await adapter.publish('due.soon', {}, { delay: 100, priority: 1 });

      advanceTime(300);

      expect(received).toEqual(['due.soon']);
    });

    it('should still deliver equal-priority delayed messages on time', async () => {
      await adapter.connect();

      const received: string[] = [];
      await adapter.subscribe('equal.*', async (message) => {
        received.push(message.pattern);
      });

      await adapter.publish('equal.slow', {}, { delay: 3000 });
      await adapter.publish('equal.soon', {}, { delay: 100 });

      advanceTime(300);

      expect(received).toEqual(['equal.soon']);
    });

    it('should order by priority among messages that come due together', async () => {
      await adapter.connect();

      const received: string[] = [];
      await adapter.subscribe('batch.*', async (message) => {
        received.push(message.pattern);
      });

      await adapter.publish('batch.low', {}, { delay: 100, priority: 1 });
      await adapter.publish('batch.high', {}, { delay: 100, priority: 10 });
      await adapter.publish('batch.mid', {}, { delay: 100, priority: 5 });

      advanceTime(300);

      expect(received).toEqual(['batch.high', 'batch.mid', 'batch.low']);
    });
  });

  describe('subscription management', () => {
    it('should unsubscribe successfully', async () => {
      await adapter.connect();

      const received: Message[] = [];
      const subscription = await adapter.subscribe('test', async (message) => {
        received.push(message);
      });

      await adapter.publish('test', { count: 1 });
      expect(received.length).toBe(1);

      await subscription.unsubscribe();

      await adapter.publish('test', { count: 2 });
      expect(received.length).toBe(1); // Still 1, no new messages
    });

    it('should pause and resume subscription', async () => {
      await adapter.connect();

      const received: Message[] = [];
      const subscription = await adapter.subscribe('test', async (message) => {
        received.push(message);
      });

      await adapter.publish('test', { count: 1 });
      expect(received.length).toBe(1);

      subscription.pause();

      await adapter.publish('test', { count: 2 });
      expect(received.length).toBe(1); // Paused

      subscription.resume();

      await adapter.publish('test', { count: 3 });
      expect(received.length).toBe(2);
    });

    it('should report subscription state', async () => {
      await adapter.connect();

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const subscription = await adapter.subscribe('test', async () => {});

      expect(subscription.isActive).toBe(true);
      expect(subscription.pattern).toBe('test');

      subscription.pause();
      expect(subscription.isActive).toBe(false);

      subscription.resume();
      expect(subscription.isActive).toBe(true);

      await subscription.unsubscribe();
      expect(subscription.isActive).toBe(false);
    });
  });

  describe('batch publishing', () => {
    it('should publish multiple messages', async () => {
      await adapter.connect();

      const received: Message[] = [];
      await adapter.subscribe('batch.*', async (message) => {
        received.push(message);
      });

      const ids = await adapter.publishBatch([
        { pattern: 'batch.1', data: { index: 1 } },
        { pattern: 'batch.2', data: { index: 2 } },
        { pattern: 'batch.3', data: { index: 3 } },
      ]);

      expect(ids.length).toBe(3);
      expect(received.length).toBe(3);
    });
  });

  describe('message acknowledgment', () => {
    it('should auto-ack by default', async () => {
      await adapter.connect();

      let messageRef: Message | null = null;
      await adapter.subscribe('test', async (message) => {
        messageRef = message;
      });

      await adapter.publish('test', { data: 'test' });

      expect(messageRef).not.toBeNull();
      // In auto mode, ack is called automatically
    });

    it('should support manual ack mode', async () => {
      await adapter.connect();

      let messageRef: Message | null = null;
      await adapter.subscribe(
        'test',
        async (message) => {
          messageRef = message;
          // In manual mode, we need to ack
          await message.ack();
        },
        { ackMode: 'manual' },
      );

      await adapter.publish('test', { data: 'test' });

      expect(messageRef).not.toBeNull();
    });

    it('should support nack with requeue', async () => {
      // This test uses real timers because requeue uses setImmediate internally
      await adapter.connect();

      let callCount = 0;
      await adapter.subscribe(
        'test',
        async (message) => {
          callCount++;
          if (callCount === 1) {
            await message.nack(true); // Requeue
          } else {
            await message.ack();
          }
        },
        { ackMode: 'manual' },
      );

      await adapter.publish('test', { data: 'test' });

      // Wait for requeue processing (setImmediate is used for requeue)
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callCount).toBeGreaterThanOrEqual(2); // Should be called at least twice due to requeue
    });
  });

  describe("ackMode 'none'", () => {
    it('delivers a failing handler exactly once and still reports the failure', async () => {
      // Fire-and-forget: nothing is acknowledged, so there is nothing to redeliver.
      await adapter.connect();

      let calls = 0;
      const failures: Error[] = [];
      adapter.on('onMessageFailed', (_message, error) => {
        failures.push(error);
      });

      await adapter.subscribe('test', async () => {
        calls += 1;
        throw new Error('handler failed');
      }, { ackMode: 'none' });

      await adapter.publish('test', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(calls).toBe(1);
      expect(failures).toHaveLength(1);
    });

    it('suppresses nack(true), which would otherwise resurrect the message', async () => {
      // 'none' is the one mode that promises a single delivery; honouring a requeue here
      // would break exactly that promise.
      await adapter.connect();

      let calls = 0;
      await adapter.subscribe('test', async (message) => {
        calls += 1;
        await message.nack(true);
      }, { ackMode: 'none' });

      await adapter.publish('test', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(calls).toBe(1);
    });

    it('still requeues on nack(true) under manual mode', async () => {
      // The contrast that proves the suppression is mode-scoped, not global.
      await adapter.connect();

      let calls = 0;
      await adapter.subscribe('test', async (message) => {
        calls += 1;
        if (calls === 1) {
          await message.nack(true);
        }
      }, { ackMode: 'manual' });

      await adapter.publish('test', { data: 'test' });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(calls).toBeGreaterThan(1);
    });
  });

  describe('events', () => {
    it('should emit onReady event on connect', async () => {
      let readyEmitted = false;
      adapter.on('onReady', () => {
        readyEmitted = true;
      });

      await adapter.connect();
      expect(readyEmitted).toBe(true);
    });

    it('should emit onMessageReceived event', async () => {
      await adapter.connect();

      let receivedMessage: Message | null = null;
      adapter.on('onMessageReceived', (message) => {
        receivedMessage = message as Message;
      });

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await adapter.subscribe('test', async () => {});
      await adapter.publish('test', { data: 'test' });

      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.pattern).toBe('test');
    });

    it('should emit onMessageProcessed event', async () => {
      await adapter.connect();

      let processed = false;
      adapter.on('onMessageProcessed', () => {
        processed = true;
      });

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await adapter.subscribe('test', async () => {});
      await adapter.publish('test', { data: 'test' });

      expect(processed).toBe(true);
    });

    it('should emit onMessageFailed, not onMessageProcessed, for a nacked message', async () => {
      // A handler that catches its own exception and nacks RESOLVES, so the dispatch loop
      // used to read it as a success and every queue metric counted a drop as throughput.
      await adapter.connect();

      let processed = 0;
      const failures: Error[] = [];
      adapter.on('onMessageProcessed', () => {
        processed += 1;
      });
      adapter.on('onMessageFailed', (_message, error) => {
        failures.push(error as Error);
      });

      await adapter.subscribe('test', async (message) => {
        await message.nack(false);
      });
      await adapter.publish('test', { data: 'test' });

      expect(processed).toBe(0);
      expect(failures.length).toBe(1);
      expect(failures[0].message).toContain('nacked by its handler');
    });

    it('should emit onMessageFailed event on error', async () => {
      await adapter.connect();

      let failedMessage: Message | null = null;
      let failedError: Error | null = null;
      adapter.on('onMessageFailed', (message, error) => {
        failedMessage = message as Message;
        failedError = error as Error;
      });

      await adapter.subscribe('test', async () => {
        throw new Error('Handler error');
      });
      await adapter.publish('test', { data: 'test' });

      expect(failedMessage).not.toBeNull();
      expect(failedError).not.toBeNull();
      expect(failedError!.message).toBe('Handler error');
    });

    it('should unregister event handlers', async () => {
      let callCount = 0;
      const handler = () => {
        callCount++;
      };

      adapter.on('onReady', handler);
      await adapter.connect();
      expect(callCount).toBe(1);

      await adapter.disconnect();
      adapter.off('onReady', handler);

      await adapter.connect();
      expect(callCount).toBe(1); // Should still be 1
    });
  });

  describe('feature support', () => {
    it('should support pattern-subscriptions', () => {
      expect(adapter.supports('pattern-subscriptions')).toBe(true);
    });

    it('should support delayed-messages', () => {
      expect(adapter.supports('delayed-messages')).toBe(true);
    });

    it('should support priority', () => {
      expect(adapter.supports('priority')).toBe(true);
    });

    it('should not support consumer-groups', () => {
      expect(adapter.supports('consumer-groups')).toBe(false);
    });

    it('should not support dead-letter-queue', () => {
      expect(adapter.supports('dead-letter-queue')).toBe(false);
    });

    it('should support retry', () => {
      // In-process and non-persistent — a restart loses the attempt counter with the message.
      // It still honours `retry.attempts`, and `false` here would be a `supports()` that lies.
      expect(adapter.supports('retry')).toBe(true);
    });
  });

  describe('retry under ackMode auto', () => {
    it('delivers exactly once when no retry is configured', async () => {
      // The behaviour-preservation pin. Adding retries must not upgrade existing subscriptions:
      // a handler with a non-idempotent side effect would perform it three times instead of one.
      await adapter.connect();

      let calls = 0;
      const failures: Error[] = [];
      adapter.on('onMessageFailed', (_message, error) => {
        failures.push(error);
      });

      await adapter.subscribe('orders.created', async () => {
        calls += 1;
        throw new Error('handler exploded');
      });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(50);

      expect(calls).toBe(1);
      expect(failures).toHaveLength(1);
    });

    it('honours retry.attempts, reporting every failed attempt', async () => {
      await adapter.connect();

      let calls = 0;
      const failures: Error[] = [];
      adapter.on('onMessageFailed', (_message, error) => {
        failures.push(error);
      });

      await adapter.subscribe('orders.created', async () => {
        calls += 1;
        throw new Error('handler exploded');
      }, { retry: { attempts: 5, backoff: 'fixed', delay: 1 } });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(200);

      // Five attempts requested, five delivered — this used to be one, with `retry` read by
      // nothing in the adapter at all.
      expect(calls).toBe(5);
      expect(failures).toHaveLength(5);
    });

    it('stops retrying as soon as the handler succeeds', async () => {
      await adapter.connect();

      let calls = 0;
      let processed = 0;
      adapter.on('onMessageProcessed', () => {
        processed += 1;
      });

      await adapter.subscribe('orders.created', async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('transient');
        }
      }, { retry: { attempts: 5, delay: 1 } });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(200);

      expect(calls).toBe(3);
      expect(processed).toBe(1);
    });

    it('numbers the attempts and marks every delivery after the first as redelivered', async () => {
      await adapter.connect();

      const seen: Array<{ attempt?: number; maxAttempts?: number; redelivered?: boolean }> = [];

      await adapter.subscribe('orders.created', async (message) => {
        seen.push({
          attempt: message.attempt,
          maxAttempts: message.maxAttempts,
          redelivered: message.redelivered,
        });
        throw new Error('handler exploded');
      }, { retry: { attempts: 3, delay: 1 } });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(200);

      // All three fields were permanently absent before: declared on the message class, assigned
      // from constructor options no call site passed.
      expect(seen).toEqual([
        { attempt: 1, maxAttempts: 3, redelivered: false },
        { attempt: 2, maxAttempts: 3, redelivered: true },
        { attempt: 3, maxAttempts: 3, redelivered: true },
      ]);
    });

    it('leaves the delivery fields inert under ackMode none', async () => {
      // 'none' promises exactly one delivery and no tracking. A counter there would advertise
      // state the mode does not keep.
      await adapter.connect();

      const seen: Array<{ attempt?: number; maxAttempts?: number; redelivered?: boolean }> = [];
      let calls = 0;

      await adapter.subscribe('orders.created', async (message) => {
        calls += 1;
        seen.push({
          attempt: message.attempt,
          maxAttempts: message.maxAttempts,
          redelivered: message.redelivered,
        });
        throw new Error('handler exploded');
      }, { ackMode: 'none', retry: { attempts: 4, delay: 1 } });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(100);

      expect(calls).toBe(1);
      expect(seen).toEqual([{ attempt: undefined, maxAttempts: undefined, redelivered: false }]);
    });

    it('retries only the subscription that failed, not its healthy neighbours', async () => {
      // The requeue used to re-enter `dispatch()`, which walks every matching subscription — so
      // one broken consumer re-invoked the working ones on the same topic.
      await adapter.connect();

      let failing = 0;
      let healthy = 0;

      await adapter.subscribe('orders.created', async () => {
        failing += 1;
        throw new Error('handler exploded');
      }, { retry: { attempts: 3, delay: 1 } });

      await adapter.subscribe('orders.created', async () => {
        healthy += 1;
      });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(200);

      expect(failing).toBe(3);
      expect(healthy).toBe(1);
    });

    it('does not fan a manual nack(true) out to other subscriptions', async () => {
      await adapter.connect();

      let requeueing = 0;
      let healthy = 0;

      await adapter.subscribe('orders.created', async (message) => {
        requeueing += 1;
        if (requeueing === 1) {
          await message.nack(true);
        } else {
          await message.ack();
        }
      }, { ackMode: 'manual' });

      await adapter.subscribe('orders.created', async () => {
        healthy += 1;
      });

      await adapter.publish('orders.created', { orderId: 1 });
      await Bun.sleep(100);

      expect(requeueing).toBe(2);
      // Measured as 2 before the fix: a neighbour re-ran because someone else asked for a requeue.
      expect(healthy).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should throw when publishing without connecting', async () => {
      await expect(adapter.publish('test', { data: 'test' })).rejects.toThrow();
    });

    it('should throw when subscribing without connecting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await expect(adapter.subscribe('test', async () => {})).rejects.toThrow();
    });
  });

  describe('createInMemoryQueueAdapter', () => {
    it('should create adapter instance', () => {
      const created = createInMemoryQueueAdapter();
      expect(created).toBeInstanceOf(InMemoryQueueAdapter);
    });
  });
});
