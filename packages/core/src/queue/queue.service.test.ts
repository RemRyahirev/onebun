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

  describe('scheduled jobs', () => {
    test('addJob should delegate to scheduler addJob', () => {
      service.addJob({
        type: 'interval',
        name: 'test-interval',
        intervalMs: 5000,
        pattern: 'test.pattern',
      });

      expect(service.hasJob('test-interval')).toBe(true);
    });

    test('removeJob should delegate to scheduler removeJob', () => {
      service.addJob({
        type: 'interval',
        name: 'remove-me',
        intervalMs: 5000,
        pattern: 'test.pattern',
      });

      const removed = service.removeJob('remove-me');
      expect(removed).toBe(true);
      expect(service.hasJob('remove-me')).toBe(false);
    });

    test('removeJob should return false for non-existent job', () => {
      expect(service.removeJob('nonexistent')).toBe(false);
    });

    test('getJob should delegate to scheduler getJob', () => {
      service.addJob({
        type: 'cron',
        name: 'my-cron',
        expression: '*/5 * * * *',
        pattern: 'cron.pattern',
      });

      const job = service.getJob('my-cron');
      expect(job).toBeDefined();
      expect(job!.name).toBe('my-cron');
      expect(job!.type).toBe('cron');
      expect(job!.pattern).toBe('cron.pattern');
    });

    test('getJob should return undefined for non-existent job', () => {
      expect(service.getJob('nonexistent')).toBeUndefined();
    });

    test('getJobs should delegate to scheduler getJobs', () => {
      service.addJob({
        type: 'interval',
        name: 'job-a',
        intervalMs: 1000,
        pattern: 'a.pattern',
      });
      service.addJob({
        type: 'timeout',
        name: 'job-b',
        timeoutMs: 2000,
        pattern: 'b.pattern',
      });

      const jobs = service.getJobs();
      expect(jobs.length).toBe(2);
      expect(jobs.some((j) => j.name === 'job-a')).toBe(true);
      expect(jobs.some((j) => j.name === 'job-b')).toBe(true);
    });

    test('hasJob should delegate to scheduler hasJob', () => {
      expect(service.hasJob('nope')).toBe(false);

      service.addJob({
        type: 'interval',
        name: 'exists',
        intervalMs: 1000,
        pattern: 'test.pattern',
      });

      expect(service.hasJob('exists')).toBe(true);
    });

    test('pauseJob should delegate to scheduler pauseJob', () => {
      service.addJob({
        type: 'interval',
        name: 'pausable',
        intervalMs: 1000,
        pattern: 'test.pattern',
      });

      const paused = service.pauseJob('pausable');
      expect(paused).toBe(true);

      const job = service.getJob('pausable');
      expect(job!.paused).toBe(true);
    });

    test('pauseJob should return false for non-existent job', () => {
      expect(service.pauseJob('nonexistent')).toBe(false);
    });

    test('resumeJob should delegate to scheduler resumeJob', () => {
      service.addJob({
        type: 'interval',
        name: 'resumable',
        intervalMs: 1000,
        pattern: 'test.pattern',
      });

      service.pauseJob('resumable');
      const resumed = service.resumeJob('resumable');
      expect(resumed).toBe(true);

      const job = service.getJob('resumable');
      expect(job!.paused).toBe(false);
    });

    test('resumeJob should return false for non-existent job', () => {
      expect(service.resumeJob('nonexistent')).toBe(false);
    });

    test('updateJob should delegate to scheduler updateJob', () => {
      service.addJob({
        type: 'interval',
        name: 'updatable',
        intervalMs: 1000,
        pattern: 'test.pattern',
      });

      const updated = service.updateJob({
        type: 'interval',
        name: 'updatable',
        intervalMs: 5000,
      });
      expect(updated).toBe(true);

      const job = service.getJob('updatable');
      expect(job!.schedule.every).toBe(5000);
    });

    test('updateJob should return false for non-existent job', () => {
      const updated = service.updateJob({
        type: 'interval',
        name: 'nonexistent',
        intervalMs: 1000,
      });
      expect(updated).toBe(false);
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
