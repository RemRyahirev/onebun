/**
 * One shared connection per process means one configuration.
 *
 * `configure()` assigned its argument with no check, so a second application pointing at a
 * different Redis silently kept whichever connection existed first — same host, same database,
 * same key prefix. Two services that believed they were on separate databases were on one, and
 * one service's `clear()` then wiped the other's keys, with nothing said at any point.
 *
 * Unlike a registration conflict, this call is written by the user at startup rather than
 * evaluated at import, so the refusal lands where it can be acted on.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { SharedRedisProvider } from './shared-redis';

const PRIMARY = { url: 'redis://127.0.0.1:6379/0' };
const SECONDARY = { url: 'redis://127.0.0.1:6379/1' };

describe('a second, disagreeing shared Redis configuration', () => {
  afterEach(async () => {
    await SharedRedisProvider.reset();
  });

  test('should refuse a different target instead of silently keeping the first', () => {
    SharedRedisProvider.configure(PRIMARY);

    let thrown: Error | undefined;
    try {
      SharedRedisProvider.configure(SECONDARY);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.name).toBe('OneBunSharedRedisConflictError');
    // Both targets, so the reader can see WHICH two configurations disagree.
    expect(thrown?.message).toContain('redis://127.0.0.1:6379/0');
    expect(thrown?.message).toContain('redis://127.0.0.1:6379/1');
    // And both call sites.
    const sites = thrown?.message.match(/shared-redis-conflict\.test\.ts:\d+:\d+/g) ?? [];

    expect(sites.length).toBe(2);
    expect(sites[0]).not.toBe(sites[1]);

    expect(thrown?.message).toContain('createClient');
    expect(thrown?.message).toContain('reset()');

    // The configuration in force is unchanged — a refused call changes nothing.
    expect(SharedRedisProvider.getOptions()).toEqual(PRIMARY);
  });

  test('should refuse a different key prefix on the same server', () => {
    SharedRedisProvider.configure({ url: PRIMARY.url, keyPrefix: 'users:' });

    // Same connection, different namespace: the prefix is baked into the client, so the second
    // consumer would have written and cleared under the FIRST one's prefix.
    expect(() => SharedRedisProvider.configure({ url: PRIMARY.url, keyPrefix: 'orders:' }))
      .toThrow(/already configured for a different target/);
  });

  test('should accept the same target stated again', () => {
    SharedRedisProvider.configure({ url: PRIMARY.url, keyPrefix: 'app:' });

    // A library re-stating the configuration, or a second call in the same boot, asks for
    // nothing new. `reconnect` defaults to true in the client, so absent and true agree.
    expect(() => SharedRedisProvider.configure({ url: PRIMARY.url, keyPrefix: 'app:' })).not.toThrow();
    expect(() => SharedRedisProvider.configure({ url: PRIMARY.url, keyPrefix: 'app:', reconnect: true }))
      .not.toThrow();
  });

  test('should let go of the configuration on reset', async () => {
    SharedRedisProvider.configure(PRIMARY);
    await SharedRedisProvider.reset();

    expect(SharedRedisProvider.isConfigured()).toBe(false);
    expect(() => SharedRedisProvider.configure(SECONDARY)).not.toThrow();
  });

  test('should not print the password of either target', () => {
    SharedRedisProvider.configure({ url: 'redis://app:hunter2@127.0.0.1:6379/0' });

    let message = '';
    try {
      SharedRedisProvider.configure({ url: 'redis://app:s3cret@127.0.0.1:6379/1' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('s3cret');
    expect(message).toContain('***');
  });
});
