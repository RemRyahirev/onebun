import {
  describe,
  it,
  expect,
} from 'bun:test';
import { Effect } from 'effect';

import { EnvParser } from '../src/parser';
import { EnvValidationError } from '../src/types';

describe('EnvParser', () => {
  describe('string parsing', () => {
    it('should parse string values', async () => {
      const config = { type: 'string' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', 'hello', config));
      expect(result).toBe('hello');
    });

    it('should return default value for undefined string', async () => {
      const config = { type: 'string' as const, default: 'default_value' };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe('default_value');
    });

    it('should return empty string when no default and not required', async () => {
      const config = { type: 'string' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe('');
    });

    it('should throw for required string when undefined', async () => {
      const config = { type: 'string' as const, required: true };
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config)))
        .rejects.toThrow('Required variable is not set');
    });

    it('should apply custom validation', async () => {
      const config = {
        type: 'string' as const,
        validate(value: string) {
          if (value.length < 3) {
            return Effect.fail(new EnvValidationError('', value, 'too short'));
          }

          return Effect.succeed(value);
        },
      };
      
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', 'hi', config)))
        .rejects.toThrow('too short');
      
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', 'hello', config));
      expect(result).toBe('hello');
    });
  });

  describe('number parsing', () => {
    it('should parse valid numbers', async () => {
      const config = { type: 'number' as const };
      
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '42', config))).resolves.toBe(42);
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '3.14', config))).resolves.toBe(3.14);
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '-100', config))).resolves.toBe(-100);
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '0', config))).resolves.toBe(0);
    });

    it('should return default value for undefined number', async () => {
      const config = { type: 'number' as const, default: 42 };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe(42);
    });

    it('should return 0 when no default and not required', async () => {
      const config = { type: 'number' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe(0);
    });

    it('should throw for invalid number strings', async () => {
      const config = { type: 'number' as const };
      
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', 'not_a_number', config)))
        .rejects.toThrow('is not a valid number');
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '12.34.56', config)))
        .rejects.toThrow('is not a valid number');
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '', config)))
        .rejects.toThrow('is not a valid number');
    });

    it('should throw for required number when undefined', async () => {
      const config = { type: 'number' as const, required: true };
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config)))
        .rejects.toThrow('Required variable is not set');
    });
  });

  describe('boolean parsing', () => {
    it('should parse truthy values', async () => {
      const config = { type: 'boolean' as const };
      
      for (const value of ['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'ON']) {
        const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', value, config));
        expect(result).toBe(true);
      }
    });

    it('should parse falsy values', async () => {
      const config = { type: 'boolean' as const };
      
      for (const value of ['false', 'FALSE', 'False', '0', 'no', 'NO', 'off', 'OFF']) {
        const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', value, config));
        expect(result).toBe(false);
      }
    });

    it('should return default value for undefined boolean', async () => {
      const config = { type: 'boolean' as const, default: true };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe(true);
    });

    it('should return false when no default and not required', async () => {
      const config = { type: 'boolean' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe(false);
    });

    it('should throw for invalid boolean strings', async () => {
      const config = { type: 'boolean' as const };
      
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', 'maybe', config)))
        .rejects.toThrow('is not a valid boolean');
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', '2', config)))
        .rejects.toThrow('is not a valid boolean');
    });
  });

  describe('array parsing', () => {
    it('should parse comma-separated arrays', async () => {
      const config = { type: 'array' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', 'a,b,c', config));
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should trim array elements', async () => {
      const config = { type: 'array' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', ' a , b , c ', config));
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should use custom separator', async () => {
      const config = { type: 'array' as const, separator: '|' };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', 'a|b|c', config));
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should use separator from options', async () => {
      const config = { type: 'array' as const };
      const options = { defaultArraySeparator: ';' };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', 'a;b;c', config, options));
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should return empty array for empty string', async () => {
      const config = { type: 'array' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', '', config));
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only string', async () => {
      const config = { type: 'array' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', '   ', config));
      expect(result).toEqual([]);
    });

    it('should return default value for undefined array', async () => {
      const config = { type: 'array' as const, default: ['x', 'y'] };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toEqual(['x', 'y']);
    });

    it('should return empty array when no default and not required', async () => {
      const config = { type: 'array' as const };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toEqual([]);
    });
  });

  describe('unknown type', () => {
    it('should throw for unknown type', async () => {
      const config = { type: 'unknown' };
      // @ts-expect-error - Test for unknown type
      expect(Effect.runPromise(EnvParser.parse('TEST_VAR', 'value', config)))
        .rejects.toThrow('Unknown type: unknown');
    });
  });

  describe('non-string input values', () => {
    it('should handle non-string resolved values', async () => {
      const config = { type: 'string' as const, default: 42 };
      const result = await Effect.runPromise(EnvParser.parse('TEST_VAR', undefined, config));
      expect(result).toBe(42);
    });
  });
}); 