/**
 * Tests for QueueServiceProxy
 */

import {
  describe,
  test,
  expect,
} from 'bun:test';


import { InMemoryQueueAdapter } from './adapters/memory.adapter';
import { QueueServiceProxy, QUEUE_NOT_ENABLED_ERROR_MESSAGE } from './queue-service-proxy';
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
    expect(() => proxy.addJob({ type: 'cron', name: 'j', expression: '* * * * *', pattern: 'e' })).toThrow(
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
    expect(() => proxy.getAdapter()).toThrow(QUEUE_NOT_ENABLED_ERROR_MESSAGE);
  });
});
