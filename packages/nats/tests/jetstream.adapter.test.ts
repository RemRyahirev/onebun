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
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
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

  describe('multi-stream support', () => {
    it('should accept streams array in constructor', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'EVENTS', subjects: ['events.>'] },
          { name: 'COMMANDS', subjects: ['commands.>'] },
        ],
      });

      expect(multiAdapter).toBeInstanceOf(JetStreamQueueAdapter);
      expect(multiAdapter.name).toBe('jetstream');
    });

    it('should accept streamDefaults merged into each stream', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'EVENTS', subjects: ['events.>'] },
          { name: 'COMMANDS', subjects: ['commands.>'], retention: 'workqueue' },
        ],
        streamDefaults: {
          retention: 'limits',
          storage: 'memory',
          replicas: 1,
        },
      });

      expect(multiAdapter).toBeInstanceOf(JetStreamQueueAdapter);
    });

    it('should resolve stream name from subject pattern', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'EVENTS', subjects: ['events.>'] },
          { name: 'COMMANDS', subjects: ['commands.>'] },
          { name: 'LOGS', subjects: ['logs.app.*'] },
        ],
      });

      // Exact match via multi-level wildcard
      expect(multiAdapter.resolveStreamForSubject('events.created')).toBe('EVENTS');
      expect(multiAdapter.resolveStreamForSubject('events.user.updated')).toBe('EVENTS');
      expect(multiAdapter.resolveStreamForSubject('commands.run')).toBe('COMMANDS');

      // Single-level wildcard
      expect(multiAdapter.resolveStreamForSubject('logs.app.info')).toBe('LOGS');
    });

    it('should not match > wildcard against zero trailing tokens', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'SPECIFIC', subjects: ['events.>'] },
          { name: 'CATCH_ALL', subjects: ['*'] },
        ],
      });

      // 'events' alone should NOT match 'events.>' — falls through to CATCH_ALL
      expect(multiAdapter.resolveStreamForSubject('events')).toBe('CATCH_ALL');
      // But 'events.created' should match 'events.>'
      expect(multiAdapter.resolveStreamForSubject('events.created')).toBe('SPECIFIC');
    });

    it('should throw if streams array is empty', () => {
      expect(() => new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [],
      })).toThrow('JetStreamQueueAdapter requires at least one stream definition');
    });

    it('should fallback to first stream for unknown subjects', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'DEFAULT', subjects: ['default.>'] },
          { name: 'EVENTS', subjects: ['events.>'] },
        ],
      });

      expect(multiAdapter.resolveStreamForSubject('unknown.topic')).toBe('DEFAULT');
    });
  });

  describe('createJetStreamQueueAdapter', () => {
    it('should create adapter instance', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [{ name: 'MY_STREAM', subjects: ['my.>'] }],
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
      expect(created.name).toBe('jetstream');
    });

    it('should accept stream configuration', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          {
            name: 'EVENTS', subjects: ['events.>'], retention: 'limits', maxMsgs: 1000000, 
          },
        ],
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
    });

    it('should accept consumer configuration', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
        consumerConfig: {
          ackWait: 30000000000,
          maxDeliver: 5,
        },
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
    });
  });
});
