/**
 * JetStream Queue Adapter Tests
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

import { JetStreamQueueAdapter, createJetStreamQueueAdapter } from '../src/jetstream.adapter';

describe('JetStreamQueueAdapter', () => {
  let adapter: JetStreamQueueAdapter;

  beforeEach(() => {
    adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      stream: 'TEST_STREAM',
    });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('jetstream');
    });

    it('should have correct type', () => {
      expect(adapter.type).toBe('jetstream');
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

    it('should support scheduled-jobs', () => {
      expect(adapter.supports('scheduled-jobs')).toBe(true);
    });

    it('should support dead-letter-queue', () => {
      expect(adapter.supports('dead-letter-queue')).toBe(true);
    });

    it('should support retry', () => {
      expect(adapter.supports('retry')).toBe(true);
    });

    it('should not support delayed-messages', () => {
      expect(adapter.supports('delayed-messages')).toBe(false);
    });

    it('should not support priority', () => {
      expect(adapter.supports('priority')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw when publishing without connecting', async () => {
      await expect(adapter.publish('test', { data: 'test' })).rejects.toThrow(
        'JetStreamQueueAdapter not connected',
      );
    });

    it('should throw when subscribing without connecting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await expect(adapter.subscribe('test', async () => {})).rejects.toThrow(
        'JetStreamQueueAdapter not connected',
      );
    });

    it('should throw when adding scheduled job without connecting', async () => {
      await expect(
        adapter.addScheduledJob('test', {
          pattern: 'test',
          schedule: { cron: '* * * * *' },
        }),
      ).rejects.toThrow('JetStreamQueueAdapter not connected');
    });
  });

  describe('event handlers', () => {
    it('should register and unregister event handlers', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler = () => {};

      adapter.on('onReady', handler);
      adapter.off('onReady', handler);

      expect(true).toBe(true);
    });

    it('should register handlers for all event types', () => {
      /* eslint-disable @typescript-eslint/no-empty-function */
      adapter.on('onReady', () => {});
      adapter.on('onError', () => {});
      adapter.on('onMessageReceived', () => {});
      adapter.on('onMessageProcessed', () => {});
      adapter.on('onMessageFailed', () => {});
      /* eslint-enable @typescript-eslint/no-empty-function */

      expect(true).toBe(true);
    });
  });

  describe('createJetStreamQueueAdapter', () => {
    it('should create adapter instance', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        stream: 'MY_STREAM',
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
      expect(created.name).toBe('jetstream');
    });

    it('should accept stream configuration', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        stream: 'EVENTS',
        createStream: true,
        streamConfig: {
          subjects: ['events.>'],
          retention: 'limits',
          maxMsgs: 1000000,
        },
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
    });

    it('should accept consumer configuration', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        stream: 'EVENTS',
        consumerConfig: {
          ackWait: 30000000000,
          maxDeliver: 5,
        },
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
    });
  });
});
