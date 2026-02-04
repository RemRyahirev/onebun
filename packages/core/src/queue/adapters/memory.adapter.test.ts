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

    it('should support scheduled-jobs', () => {
      expect(adapter.supports('scheduled-jobs')).toBe(true);
    });

    it('should not support consumer-groups', () => {
      expect(adapter.supports('consumer-groups')).toBe(false);
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
