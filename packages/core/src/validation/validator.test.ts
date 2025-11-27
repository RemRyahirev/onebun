import { type } from 'arktype';
import {
  describe,
  test,
  expect,
} from 'bun:test';

import { validate, validateOrThrow } from './validator';

describe('Validation Validator', () => {
  describe('validate', () => {
    test('should return success for valid data', () => {
      const schema = type('string');
      const result = validate(schema, 'test');
      expect(result.success).toBe(true);
      expect(result.data).toBe('test');
      expect(result.errors).toBeUndefined();
    });

    test('should return failure for invalid data', () => {
      const schema = type('string');
      const result = validate(schema, 123);
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    test('should work with number schema', () => {
      const schema = type('number');
      const result = validate(schema, 42);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    test('should work with object schema', () => {
      const schema = type({ name: 'string', age: 'number' });
      const result = validate(schema, { name: 'John', age: 30 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'John', age: 30 });
    });

    test('should fail for invalid object schema', () => {
      const schema = type({ name: 'string', age: 'number' });
      const result = validate(schema, { name: 'John', age: 'thirty' });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('validateOrThrow', () => {
    test('should return data for valid input', () => {
      const schema = type('string');
      const result = validateOrThrow(schema, 'test');
      expect(result).toBe('test');
    });

    test('should throw error for invalid input', () => {
      const schema = type('string');
      expect(() => {
        validateOrThrow(schema, 123);
      }).toThrow();
    });

    test('should include validation errors in thrown error', () => {
      const schema = type('string');
      try {
        validateOrThrow(schema, 123);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error & { validationErrors?: string[] };
        expect(err.validationErrors).toBeDefined();
        expect(Array.isArray(err.validationErrors)).toBe(true);
      }
    });

    test('should work with complex schema', () => {
      const schema = type({
        name: 'string',
        age: 'number',
        email: 'string',
      });
      const data = { name: 'John', age: 30, email: 'john@example.com' };
      const result = validateOrThrow(schema, data);
      expect(result).toEqual(data);
    });
  });
});
