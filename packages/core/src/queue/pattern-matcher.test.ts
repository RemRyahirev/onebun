/**
 * Queue Pattern Matcher Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  matchQueuePattern,
  isQueuePatternMatch,
  createQueuePatternMatcher,
  isQueuePattern,
  getQueuePatternParams,
  buildFromQueuePattern,
  findMatchingTopics,
} from './pattern-matcher';

describe('queue-pattern-matcher', () => {
  describe('matchQueuePattern', () => {
    it('should match exact strings', () => {
      const result = matchQueuePattern('orders.created', 'orders.created');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({});
    });

    it('should not match different strings', () => {
      const result = matchQueuePattern('orders.created', 'orders.updated');
      expect(result.matched).toBe(false);
    });

    it('should match single-level wildcard (*)', () => {
      const result = matchQueuePattern('orders.*', 'orders.created');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({});
    });

    it('should match single-level wildcard in the middle', () => {
      const result = matchQueuePattern('orders.*.status', 'orders.123.status');
      expect(result.matched).toBe(true);
    });

    it('should not match single-level wildcard with extra segments', () => {
      const result = matchQueuePattern('orders.*', 'orders.123.status');
      expect(result.matched).toBe(false);
    });

    it('should match multi-level wildcard (#)', () => {
      const result = matchQueuePattern('events.#', 'events.user.created');
      expect(result.matched).toBe(true);
    });

    it('should match multi-level wildcard with many segments', () => {
      const result = matchQueuePattern('events.#', 'events.user.order.payment.completed');
      expect(result.matched).toBe(true);
    });

    it('should match multi-level wildcard at end (empty)', () => {
      // events.# should match events.anything, not just 'events'
      const result = matchQueuePattern('events.#', 'events.');
      expect(result.matched).toBe(true);
    });

    it('should extract named parameters', () => {
      const result = matchQueuePattern('orders.{orderId}', 'orders.123');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({ orderId: '123' });
    });

    it('should extract multiple parameters', () => {
      const result = matchQueuePattern('users.{userId}.orders.{orderId}', 'users.456.orders.123');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({ userId: '456', orderId: '123' });
    });

    it('should handle combined wildcard and parameters', () => {
      const result = matchQueuePattern('service.{name}.*', 'service.auth.login');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({ name: 'auth' });
    });

    it('should not match when parameter value contains separator', () => {
      const result = matchQueuePattern('orders.{id}', 'orders.123.extra');
      expect(result.matched).toBe(false);
    });
  });

  describe('isQueuePatternMatch', () => {
    it('should return true for matching patterns', () => {
      expect(isQueuePatternMatch('orders.*', 'orders.created')).toBe(true);
      expect(isQueuePatternMatch('events.#', 'events.user.created')).toBe(true);
    });

    it('should return false for non-matching patterns', () => {
      expect(isQueuePatternMatch('orders.*', 'users.created')).toBe(false);
    });
  });

  describe('createQueuePatternMatcher', () => {
    it('should create reusable matcher function', () => {
      const matcher = createQueuePatternMatcher('orders.{orderId}.status');

      const result1 = matcher('orders.123.status');
      expect(result1.matched).toBe(true);
      expect(result1.params).toEqual({ orderId: '123' });

      const result2 = matcher('orders.456.status');
      expect(result2.matched).toBe(true);
      expect(result2.params).toEqual({ orderId: '456' });

      const result3 = matcher('orders.123.other');
      expect(result3.matched).toBe(false);
    });

    it('should optimize exact match patterns', () => {
      const matcher = createQueuePatternMatcher('orders.created');

      expect(matcher('orders.created').matched).toBe(true);
      expect(matcher('orders.updated').matched).toBe(false);
    });
  });

  describe('isQueuePattern', () => {
    it('should return true for single-level wildcard patterns', () => {
      expect(isQueuePattern('orders.*')).toBe(true);
    });

    it('should return true for multi-level wildcard patterns', () => {
      expect(isQueuePattern('events.#')).toBe(true);
    });

    it('should return true for parameter patterns', () => {
      expect(isQueuePattern('orders.{id}')).toBe(true);
    });

    it('should return false for literal strings', () => {
      expect(isQueuePattern('orders.created')).toBe(false);
    });
  });

  describe('getQueuePatternParams', () => {
    it('should extract parameter names', () => {
      const params = getQueuePatternParams('users.{userId}.orders.{orderId}');
      expect(params).toEqual(['userId', 'orderId']);
    });

    it('should return empty array for patterns without parameters', () => {
      const params = getQueuePatternParams('orders.*');
      expect(params).toEqual([]);
    });
  });

  describe('buildFromQueuePattern', () => {
    it('should build topic from pattern and params', () => {
      const result = buildFromQueuePattern('orders.{id}.status', { id: '123' });
      expect(result).toBe('orders.123.status');
    });

    it('should handle multiple parameters', () => {
      const result = buildFromQueuePattern('users.{uid}.orders.{oid}', { uid: '456', oid: '123' });
      expect(result).toBe('users.456.orders.123');
    });

    it('should remove wildcards', () => {
      const result = buildFromQueuePattern('orders.*.status', {});
      expect(result).toBe('orders..status');
    });
  });

  describe('findMatchingTopics', () => {
    it('should find all matching topics', () => {
      const topics = ['orders.created', 'orders.updated', 'users.created', 'orders.deleted'];
      const matching = findMatchingTopics('orders.*', topics);
      expect(matching).toEqual(['orders.created', 'orders.updated', 'orders.deleted']);
    });

    it('should find topics with multi-level wildcard', () => {
      const topics = ['events.user.created', 'events.order.created', 'logs.info', 'events.deep.nested.event'];
      const matching = findMatchingTopics('events.#', topics);
      expect(matching).toEqual(['events.user.created', 'events.order.created', 'events.deep.nested.event']);
    });

    it('should return empty array when nothing matches', () => {
      const topics = ['users.created', 'users.updated'];
      const matching = findMatchingTopics('orders.*', topics);
      expect(matching).toEqual([]);
    });
  });
});
