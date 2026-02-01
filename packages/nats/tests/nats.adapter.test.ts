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

import { NatsQueueAdapter, createNatsQueueAdapter } from '../src/nats.adapter';

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

    it('should support scheduled-jobs', () => {
      expect(adapter.supports('scheduled-jobs')).toBe(true);
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

    it('should throw when adding scheduled job without connecting', async () => {
      await expect(
        adapter.addScheduledJob('test', {
          pattern: 'test',
          schedule: { every: 1000 },
        }),
      ).rejects.toThrow('NatsQueueAdapter not connected');
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
