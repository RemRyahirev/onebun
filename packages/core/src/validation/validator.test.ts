import { type } from 'arktype';
import {
  describe,
  test,
  expect,
} from 'bun:test';

import type { Type } from 'arktype';

import { DuplicateArkTypeError } from './arktype-interop';
import { validate, validateOrThrow } from './validator';

const ARK_KIND_KEY = ' arkKind';

/**
 * Faithful stand-in for an `ArkErrors` bag produced by a SECOND physical copy of arktype.
 * Same shape and same ` arkKind: 'errors'` brand as `@ark/schema`'s own class, but a different
 * class object — so it is NOT `instanceof` core's `type.errors`, exactly like the real thing.
 * Behaviour verified against a real second arktype 2.2.0 install.
 */
class ForeignArkErrors extends Array<{ path: string[]; data: unknown; message: string }> {
  get summary(): string {
    return this.map((issue) => issue.message).join('\n');
  }
}

function makeForeignArkErrors(message: string, options?: { branded?: boolean }): unknown {
  const errors = new ForeignArkErrors();
  errors.push({ path: ['age'], data: 'thirty', message });

  Object.assign(errors, { byPath: { age: errors[0] }, count: 1 });

  if (options?.branded !== false) {
    Object.assign(errors, { [ARK_KIND_KEY]: 'errors' });
  }

  return errors;
}

/**
 * A schema as it arrives from a second physical arktype copy: a branded callable whose failures
 * are that copy's `ArkErrors`, not core's.
 */
function makeForeignSchema(
  isValid: (data: unknown) => boolean,
  message: string,
  options?: { branded?: boolean },
): Type<unknown> {
  const schema = (data: unknown): unknown =>
    (isValid(data) ? data : makeForeignArkErrors(message, options));

  Object.assign(schema, { [ARK_KIND_KEY]: 'root' });

  return schema as unknown as Type<unknown>;
}

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

  describe('schemas from a different physical arktype copy', () => {
    const badInput = { name: 'John', age: 'thirty' };
    const isValid = (data: unknown): boolean =>
      typeof (data as { age?: unknown })?.age === 'number';

    test('should report failure for a foreign ArkErrors instead of failing open', () => {
      const foreignSchema = makeForeignSchema(isValid, 'age must be a number (was a string)');

      // The precondition that used to defeat `result instanceof type.errors`.
      expect(foreignSchema(badInput) instanceof type.errors).toBe(false);

      const result = validate(foreignSchema, badInput);

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors).toEqual(['age must be a number (was a string)']);
    });

    test('should still report success for valid data under a foreign copy', () => {
      const foreignSchema = makeForeignSchema(isValid, 'age must be a number (was a string)');
      const good = { name: 'John', age: 30 };

      const result = validate(foreignSchema, good);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(good);
    });

    test('should make validateOrThrow throw instead of returning the error array as data', () => {
      const foreignSchema = makeForeignSchema(isValid, 'age must be a number (was a string)');

      expect(() => {
        validateOrThrow(foreignSchema, badInput);
      }).toThrow('Validation failed: age must be a number (was a string)');
    });

    test('should attach validationErrors when a foreign schema rejects', () => {
      const foreignSchema = makeForeignSchema(isValid, 'age must be a number (was a string)');

      try {
        validateOrThrow(foreignSchema, badInput);
        expect('unreachable').toBe('threw');
      } catch (error) {
        const err = error as Error & { validationErrors?: string[] };
        expect(err.validationErrors).toEqual(['age must be a number (was a string)']);
      }
    });
  });

  describe('unrecognisable ArkType results', () => {
    const badInput = { name: 'John', age: 'thirty' };
    const isValid = (data: unknown): boolean =>
      typeof (data as { age?: unknown })?.age === 'number';

    test('should throw a framework error naming the duplicate-arktype cause', () => {
      const foreignSchema = makeForeignSchema(isValid, 'boom', { branded: false });

      expect(() => {
        validate(foreignSchema, badInput);
      }).toThrow(DuplicateArkTypeError);
    });

    test('should spell out the cause and the remedy in the message', () => {
      const foreignSchema = makeForeignSchema(isValid, 'boom', { branded: false });

      try {
        validate(foreignSchema, badInput);
        expect('unreachable').toBe('threw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('Duplicate arktype installation detected');
        expect(message).toContain('More than one physical copy of `arktype` is loaded');
        expect(message).toContain('Deduplicate arktype to a single copy');
        expect(message).toContain('Detected ArkType registries:');
      }
    });

    test('should never hand an unrecognisable ArkType internal back as validated data', () => {
      const foreignSchema = makeForeignSchema(isValid, 'boom', { branded: false });

      expect(() => {
        validateOrThrow(foreignSchema, badInput);
      }).toThrow(DuplicateArkTypeError);
    });
  });
});
