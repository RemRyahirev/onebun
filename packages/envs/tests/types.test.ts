import {
  describe,
  expect,
  it,
} from 'bun:test';

import { EnvLoadError, EnvValidationError } from '../src/types';

describe('EnvValidationError', () => {
  it('should create error with correct properties', () => {
    const error = new EnvValidationError('TEST_VAR', 'invalid_value', 'not a number');

    expect(error.name).toBe('EnvValidationError');
    expect(error.variable).toBe('TEST_VAR');
    // The rejected value is described, never retained — 'invalid_value' is 13 characters.
    expect(error.value).toBe('a string of length 13');
    expect(error.reason).toBe('not a number');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": not a number. Got: a string of length 13',
    );
    expect(error.message).not.toContain('invalid_value');
  });

  it('should be instance of Error', () => {
    const error = new EnvValidationError('TEST_VAR', 'value', 'reason');
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle undefined value', () => {
    const error = new EnvValidationError('TEST_VAR', undefined, 'required');
    expect(error.value).toBe('not set');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": required. Got: not set',
    );
  });

  it('should handle object values', () => {
    const value = { key: 'secret-value' };
    const error = new EnvValidationError('TEST_VAR', value, 'invalid object');
    expect(error.value).toBe('an object');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": invalid object. Got: an object',
    );
    expect(error.message).not.toContain('secret-value');
  });

  it('should handle null value', () => {
    const error = new EnvValidationError('TEST_VAR', null, 'null value');
    expect(error.value).toBe('null');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": null value. Got: null',
    );
  });

  it('should handle number values', () => {
    const error = new EnvValidationError('TEST_VAR', 42, 'invalid number');
    expect(error.value).toBe('a number');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": invalid number. Got: a number',
    );
    expect(error.message).not.toContain('42');
  });

  it('should handle boolean values', () => {
    const error = new EnvValidationError('TEST_VAR', true, 'invalid boolean');
    expect(error.value).toBe('a boolean');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": invalid boolean. Got: a boolean',
    );
  });

  it('should handle array values', () => {
    const value = ['a', 'b', 'c'];
    const error = new EnvValidationError('TEST_VAR', value, 'invalid array');
    expect(error.value).toBe('an array of length 3');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": invalid array. Got: an array of length 3',
    );
  });

  it('should handle circular reference objects', () => {
    const value: Record<string, unknown> = { key: 'value' };
    value.self = value; // создаем циклическую ссылку
    const error = new EnvValidationError('TEST_VAR', value, 'circular object');
    // Nothing is serialized, so a cycle can no longer throw on the error path.
    expect(error.value).toBe('an object');
    expect(error.message).toBe(
      'Environment variable validation failed for "TEST_VAR": circular object. Got: an object',
    );
  });
});

describe('EnvLoadError', () => {
  it('should create error with correct properties', () => {
    const error = new EnvLoadError('TEST_VAR', 'file not found');

    expect(error.name).toBe('EnvLoadError');
    expect(error.variable).toBe('TEST_VAR');
    expect(error.reason).toBe('file not found');
    expect(error.message).toBe('Failed to load environment variable "TEST_VAR": file not found');
  });

  it('should be instance of Error', () => {
    const error = new EnvLoadError('TEST_VAR', 'reason');
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle empty reason', () => {
    const error = new EnvLoadError('TEST_VAR', '');
    expect(error.reason).toBe('');
    expect(error.message).toBe('Failed to load environment variable "TEST_VAR": ');
  });
});
