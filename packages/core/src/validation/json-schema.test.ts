import { type } from 'arktype';
import {
  describe,
  test,
  expect,
} from 'bun:test';

import { toJsonSchema, getJsonSchema } from './json-schema';

describe('JSON Schema Converter', () => {
  describe('toJsonSchema', () => {
    test('should convert simple string schema to JSON Schema', () => {
      const schema = type('string');
      const jsonSchema = toJsonSchema(schema);
      expect(jsonSchema).toBeDefined();
      expect(typeof jsonSchema).toBe('object');
    });

    test('should convert number schema to JSON Schema', () => {
      const schema = type('number');
      const jsonSchema = toJsonSchema(schema);
      expect(jsonSchema).toBeDefined();
      expect(typeof jsonSchema).toBe('object');
    });

    test('should convert object schema to JSON Schema', () => {
      const schema = type({
        name: 'string',
        age: 'number',
      });
      const jsonSchema = toJsonSchema(schema);
      expect(jsonSchema).toBeDefined();
      expect(typeof jsonSchema).toBe('object');
    });
  });

  describe('getJsonSchema', () => {
    test('should return JSON Schema for valid schema', () => {
      const schema = type('string');
      const jsonSchema = getJsonSchema(schema);
      expect(jsonSchema).toBeDefined();
      expect(typeof jsonSchema).toBe('object');
    });

    test('should use fallback when provided', () => {
      const schema = type('string');
      const customFallback = { type: 'custom', description: 'Custom fallback' };
      const jsonSchema = getJsonSchema(schema, {
        fallback: () => customFallback,
      });
      expect(jsonSchema).toBeDefined();
    });

    test('should return default fallback on error without custom fallback', () => {
      // Mock a schema that throws an error
      const schema = type('string');
      // Create a mock that throws an error
      const originalToJsonSchema = schema.toJsonSchema.bind(schema);
      try {
        // Temporarily replace toJsonSchema to throw an error
        (schema as unknown as { toJsonSchema: () => Record<string, unknown> }).toJsonSchema = () => {
          throw new Error('Test error');
        };
        const jsonSchema = getJsonSchema(schema);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe('object');
        expect(jsonSchema.description).toContain('Schema validation is available');
      } finally {
        // Restore original method
        (schema as unknown as { toJsonSchema: unknown }).toJsonSchema = originalToJsonSchema;
      }
    });

    test('should use custom fallback on error', () => {
      const schema = type('string');
      const customFallback = { type: 'custom', description: 'Custom fallback' };
      
      // Mock a schema that throws an error
      const originalToJsonSchema = schema.toJsonSchema.bind(schema);
      try {
        (schema as unknown as { toJsonSchema: () => Record<string, unknown> }).toJsonSchema = () => {
          throw new Error('Test error');
        };
        const jsonSchema = getJsonSchema(schema, {
          fallback: () => customFallback,
        });
        expect(jsonSchema).toEqual(customFallback);
      } finally {
        (schema as unknown as { toJsonSchema: unknown }).toJsonSchema = originalToJsonSchema;
      }
    });

    test('should work with array schema', () => {
      const schema = type('string[]');
      const jsonSchema = getJsonSchema(schema);
      expect(jsonSchema).toBeDefined();
      expect(typeof jsonSchema).toBe('object');
    });
  });
});
