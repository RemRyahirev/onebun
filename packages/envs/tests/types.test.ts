import {
  describe,
  it,
  expect,
} from 'bun:test';

import { EnvValidationError, EnvLoadError } from '../src/types';

describe('EnvValidationError', () => {
  it('should create error with correct properties', () => {
    const error = new EnvValidationError('TEST_VAR', 'invalid_value', 'not a number');
    
    expect(error.name).toBe('EnvValidationError');
    expect(error.variable).toBe('TEST_VAR');
    expect(error.value).toBe('invalid_value');
    expect(error.reason).toBe('not a number');
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": not a number. Got: "invalid_value"');
  });

  it('should be instance of Error', () => {
    const error = new EnvValidationError('TEST_VAR', 'value', 'reason');
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle undefined value', () => {
    const error = new EnvValidationError('TEST_VAR', undefined, 'required');
    expect(error.value).toBeUndefined();
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": required. Got: undefined');
  });

  it('should handle object values', () => {
    const value = { key: 'value' };
    const error = new EnvValidationError('TEST_VAR', value, 'invalid object');
    expect(error.value).toBe(value);
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": invalid object. Got: {"key":"value"}');
  });

  it('should handle null value', () => {
    const error = new EnvValidationError('TEST_VAR', null, 'null value');
    expect(error.value).toBeNull();
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": null value. Got: null');
  });

  it('should handle number values', () => {
    const error = new EnvValidationError('TEST_VAR', 42, 'invalid number');
    expect(error.value).toBe(42);
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": invalid number. Got: 42');
  });

  it('should handle boolean values', () => {
    const error = new EnvValidationError('TEST_VAR', true, 'invalid boolean');
    expect(error.value).toBe(true);
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": invalid boolean. Got: true');
  });

  it('should handle array values', () => {
    const value = ['a', 'b', 'c'];
    const error = new EnvValidationError('TEST_VAR', value, 'invalid array');
    expect(error.value).toBe(value);
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": invalid array. Got: ["a","b","c"]');
  });

  it('should handle circular reference objects', () => {
    const value: Record<string, unknown> = { key: 'value' };
    value.self = value; // создаем циклическую ссылку
    const error = new EnvValidationError('TEST_VAR', value, 'circular object');
    expect(error.value).toBe(value);
    expect(error.message).toBe('Environment variable validation failed for "TEST_VAR": circular object. Got: [object Object]');
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