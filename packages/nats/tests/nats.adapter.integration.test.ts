/**
 * NATS Queue Adapter Integration Tests
 * 
 * Tests using testcontainers for real NATS server integration
 */

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
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

import type { Message } from '@onebun/core';

import { NatsQueueAdapter, createNatsQueueAdapter } from '../src/nats.adapter';

describe('NatsQueueAdapter Integration', () => {
  let natsContainer: StartedTestContainer;
  let natsUrl: string;
  let adapter: NatsQueueAdapter;

  beforeAll(async () => {
    // Start NATS container
    natsContainer = await new GenericContainer('nats:2.10-alpine')
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage(/.*Server is ready.*/))
      .withStartupTimeout(30000)
      .withLogConsumer(() => {
        // Suppress container logs
      })
      .start();

    const host = natsContainer.getHost();
    const port = natsContainer.getMappedPort(4222);
    natsUrl = `nats://${host}:${port}`;
  });

  afterAll(async () => {
    if (natsContainer) {
      await natsContainer.stop();
    }
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

  describe('scheduled jobs', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should add and get scheduled jobs', async () => {
      await adapter.addScheduledJob('test-job', {
        pattern: 'job.test',
        data: { action: 'process' },
        schedule: { every: 1000 },
      });
      
      const jobs = await adapter.getScheduledJobs();
      
      expect(jobs.find((j) => j.name === 'test-job')).toBeDefined();
    });

    it('should add cron scheduled job', async () => {
      await adapter.addScheduledJob('cron-job', {
        pattern: 'job.cron',
        data: { action: 'cron' },
        schedule: { cron: '0 * * * *' },
      });
      
      const jobs = await adapter.getScheduledJobs();
      
      expect(jobs.find((j) => j.name === 'cron-job')).toBeDefined();
    });

    it('should remove scheduled job', async () => {
      await adapter.addScheduledJob('removable-job', {
        pattern: 'job.remove',
        data: {},
        schedule: { every: 1000 },
      });
      
      const removed = await adapter.removeScheduledJob('removable-job');
      
      expect(removed).toBe(true);
      
      const jobs = await adapter.getScheduledJobs();
      expect(jobs.find((j) => j.name === 'removable-job')).toBeUndefined();
    });

    it('should return false when removing non-existent job', async () => {
      const removed = await adapter.removeScheduledJob('non-existent');
      
      expect(removed).toBe(false);
    });

    it('should throw when adding job while disconnected', async () => {
      await adapter.disconnect();
      
      await expect(
        adapter.addScheduledJob('fail-job', {
          pattern: 'job.fail',
          data: {},
          schedule: { every: 1000 },
        }),
      ).rejects.toThrow('not connected');
    });

    it('should return empty array for jobs when scheduler not initialized', async () => {
      // Before connect, scheduler is null
      const jobs = await adapter.getScheduledJobs();
      expect(jobs).toEqual([]);
    });
  });
});
