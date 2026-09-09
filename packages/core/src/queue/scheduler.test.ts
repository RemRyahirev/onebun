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

/**
 * Let the microtask queue drain.
 *
 * A delivery is a chain of awaits — the tick, the data provider, the publish, the subscriber — so
 * a single `await Promise.resolve()` only gets as far as the first link. That matters more since
 * ticks began consulting the in-flight registry: a run that has not settled yet is indistinguishable
 * from one that is genuinely slow, and the next tick is skipped as an overlap.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

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

  /**
   * A run under way when the application stops is finished, not abandoned.
   *
   * `executeJob`'s promise used to be stored nowhere, so `stop()` had nothing to wait for. A
   * 400 ms job with `stop()` called 120 ms in returned in 3 ms; the job body then finished into
   * a void and its `publish()` was rejected by an adapter that had already disconnected. The
   * message never reached a subscriber, and on the real deploy path — `process.exit(0)` right
   * after `stop()` resolves — nothing was logged either.
   */
  /**
   * An interval job does not run concurrently with itself, and its leading run is a choice.
   *
   * `setInterval` does not care whether the last tick finished. `startIntervalJob` never read
   * `job.overlapStrategy` — declared, defaulted, and consulted only on the cron path — and fired
   * the leading run from all four entry points, so `pause()`/`resume()` and `updateJob()` each
   * injected an execution the schedule never asked for.
   *
   * Measured on the old code, 50 ms period and a 120 ms body over 400 ms: 8 invocations, 3 bodies
   * at once, a duplicate published every tick; leading runs start=1, resume=2, update=3.
   */
  describe('interval overlap and the leading run', () => {
    it('does not enter a body that outlives its period a second time', async () => {
      let entered = 0;
      let concurrent = 0;
      let maxConcurrent = 0;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      scheduler.addIntervalJob('slow', 50, 'overlap.slow', async () => {
        entered += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await blocked;
        concurrent -= 1;

        return { built: true };
      });

      scheduler.start();
      await Promise.resolve();

      // Four periods pass while the first run is still blocked.
      for (let tick = 0; tick < 4; tick += 1) {
        advanceTime(50);
        await Promise.resolve();
      }

      expect(entered).toBe(1);
      expect(maxConcurrent).toBe(1);

      release();
      await scheduler.drain();
    });

    it('runs concurrently when the caller asks for it', async () => {
      let entered = 0;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      scheduler.addIntervalJob('parallel', 50, 'overlap.parallel', async () => {
        entered += 1;
        await blocked;

        return { built: true };
      }, { overlapStrategy: 'queue' });

      scheduler.start();
      await Promise.resolve();

      advanceTime(50);
      await Promise.resolve();

      expect(entered).toBe(2);

      release();
      await scheduler.drain();
    });

    it('waits out the first period when the leading run is turned off', async () => {
      const entries: number[] = [];

      scheduler.addIntervalJob('deferred', 50, 'overlap.deferred', () => {
        entries.push(entries.length);

        return { built: true };
      }, { runOnStart: false });

      scheduler.start();
      await Promise.resolve();

      // "Every hour, starting next hour" — previously impossible, the first run was at boot.
      expect(entries).toHaveLength(0);

      advanceTime(50);
      await Promise.resolve();

      expect(entries).toHaveLength(1);
    });

    it('adds no execution on pause/resume or updateJob', async () => {
      let entered = 0;

      scheduler.addIntervalJob('counted', 1_000, 'overlap.counted', () => {
        entered += 1;

        return { built: true };
      });

      scheduler.start();
      await Promise.resolve();

      expect(entered).toBe(1);

      scheduler.pauseJob('counted');
      scheduler.resumeJob('counted');
      await Promise.resolve();

      // Resuming continues a schedule; it does not begin one.
      expect(entered).toBe(1);

      scheduler.updateJob({ name: 'counted', type: 'interval', intervalMs: 2_000 });
      await Promise.resolve();

      expect(entered).toBe(1);
    });
  });

  describe('shutdown drains runs already under way', () => {
    it('resolves only after the running job returned, and its message still arrives', async () => {
      const delivered: Message[] = [];
      await adapter.subscribe('drain.job', async (message) => {
        delivered.push(message);
      });

      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      let started = false;

      scheduler.addIntervalJob('blocking', 60_000, 'drain.job', async () => {
        started = true;
        await blocked;

        return { built: true };
      });

      scheduler.start();
      advanceTime(1);
      await Promise.resolve();

      expect(started).toBe(true);

      scheduler.stop();

      const drained = scheduler.drain();
      let settled = false;

      void drained.then(() => {
        settled = true;
      });

      // Give the drain every chance to resolve early. It must not: the job has not returned.
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      release();
      await drained;

      expect(settled).toBe(true);
      // And the run got far enough to publish, because the adapter was still connected.
      expect(delivered).toHaveLength(1);
    });

    it('reports a job that outlives the bound, before the drain resolves', async () => {
      const reported: string[] = [];
      scheduler.setErrorHandler((name) => {
        reported.push(name);
      });

      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });

      scheduler.addIntervalJob('overrunning', 60_000, 'drain.slow', async () => {
        await blocked;

        return { built: true };
      });

      scheduler.start();
      advanceTime(1);
      await Promise.resolve();

      scheduler.stop();

      const drained = scheduler.drain(1_000);

      advanceTime(1_001);
      await drained;

      // Named, and named while the logger the handler writes through is still alive — the
      // application tears it down immediately after `stop()` resolves.
      expect(reported).toEqual(['overrunning']);

      release();
    });

    it('returns immediately when nothing is running', async () => {
      scheduler.start();

      await scheduler.drain();

      expect(scheduler.getJobs()).toHaveLength(0);
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
      await flush();
      expect(received.length).toBe(1);

      // Pause the job
      scheduler.pauseJob('int-paused');

      // Advance time — no new messages
      advanceTime(500);
      await Promise.resolve();
      expect(received.length).toBe(1);

      // Resume restarts the interval, and deliberately does NOT fire immediately. This used to
      // assert a second message here: the leading run was emitted from all four entry points, so
      // every pause/resume cycle injected an execution the schedule never asked for, and a job
      // paused and resumed on a health check ran extra times for no stated reason. The leading
      // run belongs to STARTING a job; resuming continues one.
      scheduler.resumeJob('int-paused');

      advanceTime(10);
      await flush();
      expect(received.length).toBe(1);

      // The schedule itself is alive again: the next period delivers. Several microtask turns
      // because delivery is a chain of awaits — the tick, the data provider, the publish and the
      // subscriber — and one turn only gets as far as the tick.
      advanceTime(100);
      await flush();
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
