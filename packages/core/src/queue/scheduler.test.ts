/**
 * Queue Scheduler Tests
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import type { Message } from './types';

import { useFakeTimers } from '../testing/test-utils';

import { InMemoryQueueAdapter } from './adapters/memory.adapter';
import { QueueScheduler, createQueueScheduler } from './scheduler';

describe('QueueScheduler', () => {
  let adapter: InMemoryQueueAdapter;
  let scheduler: QueueScheduler;
  let advanceTime: (ms: number) => void;
  let restore: () => void;

  beforeEach(async () => {
    const fakeTimers = useFakeTimers();
    advanceTime = fakeTimers.advanceTime;
    restore = fakeTimers.restore;

    adapter = new InMemoryQueueAdapter();
    await adapter.connect();
    scheduler = new QueueScheduler(adapter);
  });

  afterEach(async () => {
    scheduler.stop();
    await adapter.disconnect();
    restore();
  });

  describe('interval jobs', () => {
    it('should execute interval job immediately on start', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test.interval', async (message) => {
        received.push(message);
      });

      scheduler.addIntervalJob('test-interval', 100000, 'test.interval', () => ({ count: 1 }));
      scheduler.start();

      // Advance time and flush async handlers
      advanceTime(10);
      await Promise.resolve();

      // Should execute immediately
      expect(received.length).toBe(1);
    });

    it('should use data from getDataFn', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test.data', async (message) => {
        received.push(message);
      });

      let counter = 0;
      scheduler.addIntervalJob('test-data', 100000, 'test.data', () => ({
        counter: ++counter,
      }));
      scheduler.start();

      advanceTime(10);
      await Promise.resolve();

      expect(received.length).toBe(1);
      expect((received[0].data as { counter: number }).counter).toBe(1);
    });

    it('should include metadata in messages', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test.meta', async (message) => {
        received.push(message);
      });

      scheduler.addIntervalJob('test-meta', 100000, 'test.meta', () => ({}), {
        metadata: { serviceId: 'test-service' },
      });
      scheduler.start();

      advanceTime(10);
      await Promise.resolve();

      expect(received.length).toBe(1);
      expect(received[0].metadata.serviceId).toBe('test-service');
    });
  });

  describe('timeout jobs', () => {
    it('should execute timeout job after delay', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test.timeout', async (message) => {
        received.push(message);
      });

      scheduler.addTimeoutJob('test-timeout', 50, 'test.timeout', () => ({ fired: true }));
      scheduler.start();

      // Should not have fired yet
      expect(received.length).toBe(0);

      // Advance time past the timeout and flush async handlers
      advanceTime(100);
      await Promise.resolve();

      expect(received.length).toBe(1);
      expect((received[0].data as { fired: boolean }).fired).toBe(true);
    });

    it('should remove job after execution', () => {
      scheduler.addTimeoutJob('one-time', 30, 'test.one-time');
      scheduler.start();

      expect(scheduler.hasJob('one-time')).toBe(true);

      advanceTime(50);

      expect(scheduler.hasJob('one-time')).toBe(false);
    });
  });

  describe('cron jobs', () => {
    it('should add cron job with next run time', () => {
      scheduler.addCronJob('test-cron', '* * * * * *', 'test.cron', () => ({ cron: true }));

      const job = scheduler.getJob('test-cron');
      expect(job).toBeDefined();
      expect(job!.schedule.cron).toBe('* * * * * *');
      expect(job!.nextRun).toBeDefined();
    });

    it('should track job running state', () => {
      scheduler.addCronJob('cron-job', '0 0 * * * *', 'test.cron', () => ({}), {
        overlapStrategy: 'skip',
      });

      const job = scheduler.getJob('cron-job');
      expect(job).toBeDefined();
      // Initially not running
      expect(job!.isRunning).toBeFalsy();
    });
  });

  describe('job management', () => {
    it('should add and remove jobs', () => {
      scheduler.addIntervalJob('job1', 1000, 'test');
      scheduler.addIntervalJob('job2', 2000, 'test');

      expect(scheduler.hasJob('job1')).toBe(true);
      expect(scheduler.hasJob('job2')).toBe(true);

      const removed = scheduler.removeJob('job1');
      expect(removed).toBe(true);
      expect(scheduler.hasJob('job1')).toBe(false);
      expect(scheduler.hasJob('job2')).toBe(true);
    });

    it('should return false when removing non-existent job', () => {
      const removed = scheduler.removeJob('non-existent');
      expect(removed).toBe(false);
    });

    it('should get all jobs info', () => {
      scheduler.addIntervalJob('interval-job', 1000, 'test.interval');
      scheduler.addCronJob('cron-job', '0 0 * * * *', 'test.cron');

      const jobs = scheduler.getJobs();
      expect(jobs.length).toBe(2);

      const intervalJob = jobs.find((j) => j.name === 'interval-job');
      expect(intervalJob).toBeDefined();
      expect(intervalJob!.pattern).toBe('test.interval');
      expect(intervalJob!.schedule.every).toBe(1000);

      const cronJob = jobs.find((j) => j.name === 'cron-job');
      expect(cronJob).toBeDefined();
      expect(cronJob!.pattern).toBe('test.cron');
      expect(cronJob!.schedule.cron).toBe('0 0 * * * *');
    });

    it('should get specific job info', () => {
      scheduler.addIntervalJob('my-job', 5000, 'test.pattern');

      const job = scheduler.getJob('my-job');
      expect(job).toBeDefined();
      expect(job!.name).toBe('my-job');
      expect(job!.pattern).toBe('test.pattern');
      expect(job!.schedule.every).toBe(5000);
    });

    it('should return undefined for non-existent job', () => {
      const job = scheduler.getJob('non-existent');
      expect(job).toBeUndefined();
    });
  });

  describe('start/stop', () => {
    it('should not execute jobs before start', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test', async (message) => {
        received.push(message);
      });

      scheduler.addIntervalJob('test', 100000, 'test');
      // Not calling start()

      advanceTime(50);
      expect(received.length).toBe(0);
    });

    it('should stop scheduler cleanly', async () => {
      scheduler.addIntervalJob('test', 100000, 'test');
      scheduler.start();

      // Should not throw
      scheduler.stop();
      expect(true).toBe(true);
    });

    it('should handle multiple start calls', () => {
      scheduler.start();
      scheduler.start(); // Should not throw
      expect(true).toBe(true);
    });

    it('should handle multiple stop calls', () => {
      scheduler.stop();
      scheduler.stop(); // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('createQueueScheduler', () => {
    it('should create scheduler instance', () => {
      const created = createQueueScheduler(adapter);
      expect(created).toBeInstanceOf(QueueScheduler);
    });
  });
});
