/**
 * Tests for QueueService
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import type { Message } from './types';

import { InMemoryQueueAdapter } from './adapters/memory.adapter';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  let adapter: InMemoryQueueAdapter;
  let service: QueueService;

  beforeEach(async () => {
    adapter = new InMemoryQueueAdapter();
    service = new QueueService({ adapter: 'memory' as const });
    await service.initialize(adapter);
  });

  afterEach(async () => {
    await service.stop();
  });

  describe('lifecycle', () => {
    test('should initialize with adapter', async () => {
      expect(service.getAdapter()).toBe(adapter);
    });

    test('should start and stop correctly', async () => {
      await service.start();
      expect(adapter.isConnected()).toBe(true);

      await service.stop();
      expect(adapter.isConnected()).toBe(false);
    });

    test('should handle multiple start calls', async () => {
      await service.start();
      await service.start(); // Should not throw
      expect(adapter.isConnected()).toBe(true);
    });

    test('should handle multiple stop calls', async () => {
      await service.start();
      await service.stop();
      await service.stop(); // Should not throw
    });

    test('should throw when getting adapter before initialization', () => {
      const uninitializedService = new QueueService({ adapter: 'memory' as const });
      expect(() => uninitializedService.getAdapter()).toThrow('Queue adapter not initialized');
    });

    test('should throw when starting without initialization', async () => {
      const uninitializedService = new QueueService({ adapter: 'memory' as const });
      await expect(uninitializedService.start()).rejects.toThrow('Queue adapter not initialized');
    });
  });

  describe('publish/subscribe', () => {
    test('should publish and receive messages', async () => {
      await service.start();

      const received: Message[] = [];
      await service.subscribe('test.pattern', async (message) => {
        received.push(message);
      });

      await service.publish('test.pattern', { data: 'hello' });

      expect(received.length).toBe(1);
      expect(received[0].data).toEqual({ data: 'hello' });
    });

    test('should publish batch messages', async () => {
      await service.start();

      const received: Message[] = [];
      await service.subscribe('batch.*', async (message) => {
        received.push(message);
      });

      const ids = await service.publishBatch([
        { pattern: 'batch.1', data: { index: 1 } },
        { pattern: 'batch.2', data: { index: 2 } },
      ]);

      expect(ids.length).toBe(2);
      expect(received.length).toBe(2);
    });

    test('should track subscriptions', async () => {
      await service.start();

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const sub1 = await service.subscribe('pattern1', async () => {});
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const sub2 = await service.subscribe('pattern2', async () => {});

      expect(sub1.isActive).toBe(true);
      expect(sub2.isActive).toBe(true);

      // Stop should unsubscribe all
      await service.stop();
      expect(sub1.isActive).toBe(false);
      expect(sub2.isActive).toBe(false);
    });
  });

  describe('scheduler', () => {
    test('should provide access to scheduler', async () => {
      const scheduler = service.getScheduler();
      expect(scheduler).toBeDefined();
    });

    test('should throw when getting scheduler before initialization', () => {
      const uninitializedService = new QueueService({ adapter: 'memory' as const });
      expect(() => uninitializedService.getScheduler()).toThrow('Queue scheduler not initialized');
    });

    test('should start scheduler with service', async () => {
      const scheduler = service.getScheduler();

      const received: Message[] = [];
      await service.subscribe('scheduled.test', async (message) => {
        received.push(message);
      });

      // Add interval job that fires immediately
      scheduler.addIntervalJob('test-job', 100000, 'scheduled.test', () => ({ test: true }));

      await service.start();

      // Should have received message immediately due to runImmediately default
      expect(received.length).toBe(1);
    });
  });

  describe('features', () => {
    test('should check feature support', async () => {
      await service.start();

      expect(service.supports('pattern-subscriptions')).toBe(true);
      expect(service.supports('delayed-messages')).toBe(true);
      expect(service.supports('consumer-groups')).toBe(false);
    });
  });

  describe('events', () => {
    test('should register and unregister event handlers', async () => {
      await service.start();

      let readyCount = 0;
      const handler = () => {
        readyCount++;
      };

      service.on('onReady', handler);
      // Reconnect to trigger onReady
      await adapter.disconnect();
      await adapter.connect();
      expect(readyCount).toBe(1);

      service.off('onReady', handler);
      await adapter.disconnect();
      await adapter.connect();
      expect(readyCount).toBe(1); // Should still be 1
    });

    test('should emit onMessageReceived event', async () => {
      await service.start();

      let receivedMessage: Message | null = null;
      service.on('onMessageReceived', (message) => {
        receivedMessage = message as Message;
      });

      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await service.subscribe('test', async () => {});
      await service.publish('test', { data: 'test' });

      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage!.pattern).toBe('test');
    });
  });

  describe('scheduled jobs via adapter', () => {
    test('should add and remove scheduled jobs', async () => {
      await service.start();

      await service.addScheduledJob('test-scheduled', {
        pattern: 'scheduled.pattern',
        schedule: { every: 60000 },
      });

      const jobs = await service.getScheduledJobs();
      expect(jobs.some((j) => j.name === 'test-scheduled')).toBe(true);

      const removed = await service.removeScheduledJob('test-scheduled');
      expect(removed).toBe(true);

      const jobsAfter = await service.getScheduledJobs();
      expect(jobsAfter.some((j) => j.name === 'test-scheduled')).toBe(false);
    });

    test('should return false when removing non-existent job', async () => {
      await service.start();

      const removed = await service.removeScheduledJob('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('error handling', () => {
    test('should handle subscription errors gracefully', async () => {
      await service.start();

      let errorReceived = false;
      service.on('onMessageFailed', () => {
        errorReceived = true;
      });

      await service.subscribe('error.test', async () => {
        throw new Error('Handler error');
      });

      await service.publish('error.test', { data: 'test' });

      expect(errorReceived).toBe(true);
    });
  });
});
