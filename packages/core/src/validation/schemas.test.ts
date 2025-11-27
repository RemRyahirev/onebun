import { type } from 'arktype';
import {
  describe,
  test,
  expect,
} from 'bun:test';

import {
  stringSchema,
  numberSchema,
  booleanSchema,
  optionalSchema,
  arraySchema,
  type as exportedType,
} from './schemas';

describe('Validation Schemas', () => {
  describe('stringSchema', () => {
    test('should create a string schema', () => {
      const schema = stringSchema();
      expect(schema('test')).toBe('test');
      const invalidResult = schema(123);
      expect(invalidResult instanceof type.errors).toBe(true);
    });
  });

  describe('numberSchema', () => {
    test('should create a number schema', () => {
      const schema = numberSchema();
      expect(schema(42)).toBe(42);
      const invalidResult = schema('test');
      expect(invalidResult instanceof type.errors).toBe(true);
    });
  });

  describe('booleanSchema', () => {
    test('should create a boolean schema', () => {
      const schema = booleanSchema();
      expect(schema(true)).toBe(true);
      expect(schema(false)).toBe(false);
      const invalidResult = schema('test');
      expect(invalidResult instanceof type.errors).toBe(true);
    });
  });

  describe('optionalSchema', () => {
    test('should create an optional schema that accepts undefined', () => {
      const schema = optionalSchema(stringSchema());
      expect(schema('test')).toBe('test');
      // @ts-expect-error - Testing that optional schema accepts undefined
      expect(schema(undefined)).toBe(undefined);
      const invalidResult = schema(123);
      expect(invalidResult instanceof type.errors).toBe(true);
    });

    test('should work with number schema', () => {
      const schema = optionalSchema(numberSchema());
      expect(schema(42)).toBe(42);
      // @ts-expect-error - Testing that optional schema accepts undefined
      expect(schema(undefined)).toBe(undefined);
      const invalidResult = schema('test');
      expect(invalidResult instanceof type.errors).toBe(true);
    });
  });

  describe('arraySchema', () => {
    test('should create an array schema', () => {
      const schema = arraySchema(stringSchema());
      expect(schema(['test', 'foo'])).toEqual(['test', 'foo']);
      const invalidResult1 = schema('test');
      expect(invalidResult1 instanceof type.errors).toBe(true);
      const invalidResult2 = schema([123]);
      expect(invalidResult2 instanceof type.errors).toBe(true);
    });

    test('should work with number schema', () => {
      const schema = arraySchema(numberSchema());
      expect(schema([1, 2, 3])).toEqual([1, 2, 3]);
      const invalidResult = schema(['test']);
      expect(invalidResult instanceof type.errors).toBe(true);
    });
  });

  describe('type re-export', () => {
    test('should re-export type from arktype', () => {
      const schema = exportedType('string');
      expect(schema('test')).toBe('test');
    });
  });
});
