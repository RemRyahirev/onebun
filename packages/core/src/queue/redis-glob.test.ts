import {
  describe,
  expect,
  it,
} from 'bun:test';

import { toRedisQueueGlob } from './redis-glob';

describe('toRedisQueueGlob', () => {
  it('passes a literal pattern through unchanged', () => {
    expect(toRedisQueueGlob('orders.created')).toBe('orders.created');
  });

  it('widens a named parameter to a single-token glob', () => {
    expect(toRedisQueueGlob('orders.{id}')).toBe('orders.*');
    expect(toRedisQueueGlob('orders.{id}.items.{itemId}')).toBe('orders.*.items.*');
  });

  it('widens a parameter embedded in a token', () => {
    // The whole token becomes `*`: Redis globs cannot express "this token, with a hole in it",
    // and widening is safe because the in-process matcher narrows it back.
    expect(toRedisQueueGlob('orders.v{version}')).toBe('orders.*');
  });

  it('translates a trailing # to a glob', () => {
    expect(toRedisQueueGlob('events.#')).toBe('events.*');
  });

  it('leaves * as it is', () => {
    expect(toRedisQueueGlob('events.*')).toBe('events.*');
  });

  it('throws on a # outside the final token, naming the pattern and the rule', () => {
    // Redis could serve `*.created` perfectly well. The throw is about keeping one pattern
    // language across adapters — NATS cannot express this at all, and a pattern that works on
    // Redis and throws on NATS is a dialect.
    expect(() => toRedisQueueGlob('#.created')).toThrow();
    expect(() => toRedisQueueGlob('events.#.created')).toThrow();

    try {
      toRedisQueueGlob('#.created');
      throw new Error('expected toRedisQueueGlob to throw');
    } catch (error) {
      expect((error as Error).message).toContain('#.created');
      expect((error as Error).message).toMatch(/final token/i);
    }
  });
});
