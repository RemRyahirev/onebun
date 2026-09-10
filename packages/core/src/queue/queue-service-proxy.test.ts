/**
 * Tests for QueueServiceProxy
 */

import {
  describe,
  test,
  expect,
} from 'bun:test';


import { InMemoryQueueAdapter } from './adapters/memory.adapter';
import {
  QueueServiceProxy,
  QUEUE_NOT_ENABLED_ERROR_MESSAGE,
  QUEUE_NOT_READY_ERROR_MESSAGE,
  QUEUE_STOPPED_ERROR_MESSAGE,
} from './queue-service-proxy';
import { QueueService } from './queue.service';

describe('QueueServiceProxy', () => {
  test('throws with expected message when delegate is null', async () => {
    const proxy = new QueueServiceProxy();
    expect(() => proxy.getAdapter()).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.getScheduler()).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    await expect(proxy.publish('e', {})).rejects.toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    await expect(proxy.publishBatch([{ pattern: 'e', data: {} }])).rejects.toThrow(
      QUEUE_NOT_ENABLED_ERROR_MESSAGE,
    );
    await expect(
      proxy.subscribe('e', async () => {
        /* no-op for throw test */
      }),
    ).rejects.toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.addJob({
      type: 'cron', name: 'j', expression: '* * * * *', pattern: 'e', 
    })).toThrow(
      QUEUE_NOT_ENABLED_ERROR_MESSAGE,
    );
    expect(() => proxy.removeJob('j')).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.getJob('j')).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.getJobs()).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.hasJob('j')).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.pauseJob('j')).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.resumeJob('j')).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() => proxy.updateJob({ type: 'cron', name: 'j', expression: '* * * * *' })).toThrow(
      QUEUE_NOT_ENABLED_ERROR_MESSAGE,
    );
    expect(() => proxy.supports('pattern-subscriptions')).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() =>
      proxy.on('onReady', () => {
        /* no-op */
      }),
    ).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(() =>
      proxy.off('onReady', () => {
        /* no-op */
      }),
    ).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
  });

  test('delegates to real QueueService after setDelegate', async () => {
    const adapter = new InMemoryQueueAdapter();
    const real = new QueueService({ adapter: 'memory' as const });
    await real.initialize(adapter);
    await real.start();

    const proxy = new QueueServiceProxy();
    proxy.setDelegate(real);

    expect(proxy.getAdapter()).toBe(adapter);
    expect(proxy.getScheduler()).toBe(real.getScheduler());
    expect(proxy.supports('pattern-subscriptions')).toBe(true);

    const ids = await proxy.publish('test.event', { x: 1 });
    expect(ids).toBeDefined();
    expect(typeof ids).toBe('string');

    const received: unknown[] = [];
    const sub = await proxy.subscribe('test.event', async (msg) => {
      received.push(msg.data);
    });
    expect(sub.isActive).toBe(true);

    await proxy.publish('test.event', { y: 2 });
    // Allow microtask for handler
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ y: 2 });

    await real.stop();
    proxy.setDelegate(null);
    // Not "not enabled": this queue WAS enabled and has shut down, and telling its user to
    // configure a backend they already configured is the report this replaced.
    expect(() => proxy.getAdapter()).toThrow(QUEUE_STOPPED_ERROR_MESSAGE);
  });

  test('holds a publish issued while the queue is still starting, and flushes it', async () => {
    const adapter = new InMemoryQueueAdapter();
    const real = new QueueService({ adapter: 'memory' });
    await real.initialize(adapter);
    await real.start();

    const proxy = new QueueServiceProxy();
    proxy.markStarting();

    const received: unknown[] = [];
    await real.subscribe('held.event', async (message) => {
      received.push(message.data);
    });

    // Answered with the id it will ship under, so the caller is not handed a placeholder.
    const messageId = await proxy.publish('held.event', { held: true });
    expect(typeof messageId).toBe('string');
    expect(received.length).toBe(0);

    proxy.setDelegate(real);
    expect(await proxy.flushPendingPublishes()).toEqual([]);
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toEqual([{ held: true }]);

    await real.stop();
  });

  test('refuses everything that cannot be held while the queue is starting', () => {
    const proxy = new QueueServiceProxy();
    proxy.markStarting();

    expect(() => proxy.getScheduler()).toThrow(QUEUE_NOT_READY_ERROR_MESSAGE);
    expect(() => proxy.getJobs()).toThrow(QUEUE_NOT_READY_ERROR_MESSAGE);
  });

  test('keeps the not-enabled message for a proxy that was never told a queue is coming', () => {
    const proxy = new QueueServiceProxy();

    expect(() => proxy.getAdapter()).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
    expect(proxy.publish('nowhere', {})).rejects.toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
  });
});
