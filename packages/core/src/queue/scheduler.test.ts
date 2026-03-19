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

  describe('addJob', () => {
    it('should add a cron job visible via getJob', () => {
      scheduler.addJob({
        type: 'cron',
        name: 'my-cron',
        expression: '0 0 * * * *',
        pattern: 'test.cron',
      });

      const job = scheduler.getJob('my-cron');
      expect(job).toBeDefined();
      expect(job!.type).toBe('cron');
      expect(job!.paused).toBe(false);
      expect(job!.declarative).toBe(false);
      expect(job!.schedule.cron).toBe('0 0 * * * *');
    });

    it('should add an interval job visible via getJob', () => {
      scheduler.addJob({
        type: 'interval',
        name: 'my-interval',
        intervalMs: 5000,
        pattern: 'test.interval',
      });

      const job = scheduler.getJob('my-interval');
      expect(job).toBeDefined();
      expect(job!.type).toBe('interval');
      expect(job!.paused).toBe(false);
      expect(job!.declarative).toBe(false);
      expect(job!.schedule.every).toBe(5000);
    });

    it('should add a timeout job visible via getJob', () => {
      scheduler.addJob({
        type: 'timeout',
        name: 'my-timeout',
        timeoutMs: 3000,
        pattern: 'test.timeout',
      });

      const job = scheduler.getJob('my-timeout');
      expect(job).toBeDefined();
      expect(job!.type).toBe('timeout');
      expect(job!.paused).toBe(false);
      expect(job!.declarative).toBe(false);
      expect(job!.schedule.timeout).toBe(3000);
    });
  });

  describe('getJobs returns type, paused, and timeout', () => {
    it('should return correct type, paused, and schedule for all job types', () => {
      scheduler.addJob({
        type: 'cron', name: 'c1', expression: '* * * * *', pattern: 'p', 
      });
      scheduler.addJob({
        type: 'interval', name: 'i1', intervalMs: 1000, pattern: 'p', 
      });
      scheduler.addJob({
        type: 'timeout', name: 't1', timeoutMs: 2000, pattern: 'p', 
      });

      const jobs = scheduler.getJobs();
      expect(jobs.length).toBe(3);

      const cronJob = jobs.find((j) => j.name === 'c1');
      expect(cronJob!.type).toBe('cron');
      expect(cronJob!.paused).toBe(false);

      const intervalJob = jobs.find((j) => j.name === 'i1');
      expect(intervalJob!.type).toBe('interval');
      expect(intervalJob!.paused).toBe(false);
      expect(intervalJob!.schedule.every).toBe(1000);

      const timeoutJob = jobs.find((j) => j.name === 't1');
      expect(timeoutJob!.type).toBe('timeout');
      expect(timeoutJob!.paused).toBe(false);
      expect(timeoutJob!.schedule.timeout).toBe(2000);
    });
  });

  describe('declarative field', () => {
    it('should mark jobs added via addCronJob with declarative option as declarative', () => {
      scheduler.addCronJob('dec-cron', '* * * * *', 'p', undefined, { declarative: true });

      const job = scheduler.getJob('dec-cron');
      expect(job).toBeDefined();
      expect(job!.declarative).toBe(true);
    });

    it('should mark jobs added via addIntervalJob with declarative option as declarative', () => {
      scheduler.addIntervalJob('dec-interval', 1000, 'p', undefined, { declarative: true });

      const job = scheduler.getJob('dec-interval');
      expect(job).toBeDefined();
      expect(job!.declarative).toBe(true);
    });

    it('should mark jobs added via addTimeoutJob with declarative option as declarative', () => {
      scheduler.addTimeoutJob('dec-timeout', 1000, 'p', undefined, { declarative: true });

      const job = scheduler.getJob('dec-timeout');
      expect(job).toBeDefined();
      expect(job!.declarative).toBe(true);
    });

    it('should mark jobs added via addJob as not declarative', () => {
      scheduler.addJob({
        type: 'cron', name: 'dyn-cron', expression: '* * * * *', pattern: 'p', 
      });

      const job = scheduler.getJob('dyn-cron');
      expect(job).toBeDefined();
      expect(job!.declarative).toBe(false);
    });
  });

  describe('pauseJob', () => {
    it('should pause an existing job and return true', () => {
      scheduler.addJob({
        type: 'interval', name: 'j1', intervalMs: 1000, pattern: 'p', 
      });

      const result = scheduler.pauseJob('j1');
      expect(result).toBe(true);

      const job = scheduler.getJob('j1');
      expect(job!.paused).toBe(true);
    });

    it('should return false for nonexistent job', () => {
      const result = scheduler.pauseJob('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('resumeJob', () => {
    it('should resume a paused job and return true', () => {
      scheduler.addJob({
        type: 'interval', name: 'j1', intervalMs: 1000, pattern: 'p', 
      });
      scheduler.pauseJob('j1');

      const result = scheduler.resumeJob('j1');
      expect(result).toBe(true);

      const job = scheduler.getJob('j1');
      expect(job!.paused).toBe(false);
    });

    it('should return false for nonexistent job', () => {
      const result = scheduler.resumeJob('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for non-paused job', () => {
      scheduler.addJob({
        type: 'interval', name: 'j1', intervalMs: 1000, pattern: 'p', 
      });

      const result = scheduler.resumeJob('j1');
      expect(result).toBe(false);
    });
  });

  describe('updateJob', () => {
    it('should update cron expression', () => {
      scheduler.addJob({
        type: 'cron',
        name: 'c1',
        expression: '0 0 * * * *',
        pattern: 'p',
      });

      const result = scheduler.updateJob({ type: 'cron', name: 'c1', expression: '*/5 * * * *' });
      expect(result).toBe(true);

      const job = scheduler.getJob('c1');
      expect(job!.schedule.cron).toBe('*/5 * * * *');
    });

    it('should update interval', () => {
      scheduler.addJob({
        type: 'interval', name: 'i1', intervalMs: 1000, pattern: 'p', 
      });

      const result = scheduler.updateJob({ type: 'interval', name: 'i1', intervalMs: 5000 });
      expect(result).toBe(true);

      const job = scheduler.getJob('i1');
      expect(job!.schedule.every).toBe(5000);
    });

    it('should update timeout', () => {
      scheduler.addJob({
        type: 'timeout', name: 't1', timeoutMs: 1000, pattern: 'p', 
      });

      const result = scheduler.updateJob({ type: 'timeout', name: 't1', timeoutMs: 9000 });
      expect(result).toBe(true);

      const job = scheduler.getJob('t1');
      expect(job!.schedule.timeout).toBe(9000);
    });

    it('should return false when type does not match', () => {
      scheduler.addJob({
        type: 'interval', name: 'i1', intervalMs: 1000, pattern: 'p', 
      });

      const result = scheduler.updateJob({ type: 'cron', name: 'i1', expression: '* * * * *' });
      expect(result).toBe(false);
    });

    it('should return false for nonexistent job', () => {
      const result = scheduler.updateJob({ type: 'cron', name: 'nope', expression: '* * * * *' });
      expect(result).toBe(false);
    });
  });

  describe('paused jobs do not fire', () => {
    it('should not fire paused cron job', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test.cron', async (message) => {
        received.push(message);
      });

      // Every second cron
      scheduler.addJob({
        type: 'cron',
        name: 'cron-paused',
        expression: '* * * * * *',
        pattern: 'test.cron',
      });
      scheduler.pauseJob('cron-paused');
      scheduler.start();

      // Advance time well past when cron would fire
      advanceTime(5000);
      await Promise.resolve();

      expect(received.length).toBe(0);
    });

    it('should not fire paused interval job, and resume restarts it', async () => {
      const received: Message[] = [];
      await adapter.subscribe('test.interval', async (message) => {
        received.push(message);
      });

      scheduler.addJob({
        type: 'interval',
        name: 'int-paused',
        intervalMs: 100,
        pattern: 'test.interval',
      });
      scheduler.start();

      // Should fire immediately on start
      advanceTime(10);
      await Promise.resolve();
      expect(received.length).toBe(1);

      // Pause the job
      scheduler.pauseJob('int-paused');

      // Advance time — no new messages
      advanceTime(500);
      await Promise.resolve();
      expect(received.length).toBe(1);

      // Resume — should restart interval and fire immediately
      scheduler.resumeJob('int-paused');

      advanceTime(10);
      await Promise.resolve();
      expect(received.length).toBe(2);
    });
  });

  describe('createQueueScheduler', () => {
    it('should create scheduler instance', () => {
      const created = createQueueScheduler(adapter);
      expect(created).toBeInstanceOf(QueueScheduler);
    });
  });
});
