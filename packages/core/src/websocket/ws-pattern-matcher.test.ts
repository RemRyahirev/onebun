/**
 * WebSocket Pattern Matcher Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  matchPattern,
  isPatternMatch,
  createPatternMatcher,
  isPattern,
  getPatternParams,
  buildFromPattern,
  findMatchingValues,
} from './ws-pattern-matcher';

describe('ws-pattern-matcher', () => {
  describe('matchPattern', () => {
    it('should match exact strings', () => {
      const result = matchPattern('chat:message', 'chat:message');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({});
    });

    it('should not match different strings', () => {
      const result = matchPattern('chat:message', 'chat:other');
      expect(result.matched).toBe(false);
    });

    it('should match wildcard (*) patterns', () => {
      const result = matchPattern('chat:*', 'chat:general');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({});
    });

    it('should match wildcard in the middle', () => {
      const result = matchPattern('user:*:action', 'user:123:action');
      expect(result.matched).toBe(true);
    });

    it('should not match wildcard with extra segments', () => {
      const result = matchPattern('chat:*', 'chat:general:extra');
      expect(result.matched).toBe(false);
    });

    it('should extract named parameters', () => {
      const result = matchPattern('chat:{roomId}', 'chat:general');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({ roomId: 'general' });
    });

    it('should extract multiple parameters', () => {
      const result = matchPattern('user:{userId}:room:{roomId}', 'user:123:room:general');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({ userId: '123', roomId: 'general' });
    });

    it('should handle combined wildcard and parameters', () => {
      const result = matchPattern('service:{service}:*', 'service:auth:login');
      expect(result.matched).toBe(true);
      expect(result.params).toEqual({ service: 'auth' });
    });

    it('should not match when parameter value contains separator', () => {
      const result = matchPattern('chat:{roomId}', 'chat:room:sub');
      expect(result.matched).toBe(false);
    });
  });

  describe('isPatternMatch', () => {
    it('should return true for matching patterns', () => {
      expect(isPatternMatch('chat:*', 'chat:general')).toBe(true);
    });

    it('should return false for non-matching patterns', () => {
      expect(isPatternMatch('chat:*', 'room:general')).toBe(false);
    });
  });

  describe('createPatternMatcher', () => {
    it('should create reusable matcher function', () => {
      const matcher = createPatternMatcher('chat:{roomId}:message');

      const result1 = matcher('chat:general:message');
      expect(result1.matched).toBe(true);
      expect(result1.params).toEqual({ roomId: 'general' });

      const result2 = matcher('chat:private:message');
      expect(result2.matched).toBe(true);
      expect(result2.params).toEqual({ roomId: 'private' });

      const result3 = matcher('chat:other:action');
      expect(result3.matched).toBe(false);
    });
  });

  describe('isPattern', () => {
    it('should return true for wildcard patterns', () => {
      expect(isPattern('chat:*')).toBe(true);
    });

    it('should return true for parameter patterns', () => {
      expect(isPattern('chat:{roomId}')).toBe(true);
    });

    it('should return false for literal strings', () => {
      expect(isPattern('chat:general')).toBe(false);
    });
  });

  describe('getPatternParams', () => {
    it('should extract parameter names', () => {
      const params = getPatternParams('chat:{roomId}:user:{userId}');
      expect(params).toEqual(['roomId', 'userId']);
    });

    it('should return empty array for patterns without parameters', () => {
      const params = getPatternParams('chat:*');
      expect(params).toEqual([]);
    });
  });

  describe('buildFromPattern', () => {
    it('should build value from pattern and params', () => {
      const result = buildFromPattern('chat:{roomId}:message', { roomId: 'general' });
      expect(result).toBe('chat:general:message');
    });

    it('should handle multiple parameters', () => {
      const result = buildFromPattern('user:{id}:room:{room}', { id: '123', room: 'test' });
      expect(result).toBe('user:123:room:test');
    });
  });

  describe('findMatchingValues', () => {
    it('should find all matching values', () => {
      const values = ['chat:general', 'chat:private', 'room:lobby', 'chat:admin'];
      const matching = findMatchingValues('chat:*', values);
      expect(matching).toEqual(['chat:general', 'chat:private', 'chat:admin']);
    });

    it('should return empty array when nothing matches', () => {
      const values = ['room:lobby', 'room:admin'];
      const matching = findMatchingValues('chat:*', values);
      expect(matching).toEqual([]);
    });
  });
});
