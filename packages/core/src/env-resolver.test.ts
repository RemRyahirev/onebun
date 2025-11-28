import {
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { TypedEnv } from '@onebun/envs';

import { resolveEnvOverrides, resolveEnvOverridesSync } from './env-resolver';

describe('env-resolver', () => {
  beforeEach(() => {
    TypedEnv.clear();
    // Clean up test env vars
    delete process.env.USERS_DB_HOST;
    delete process.env.USERS_DB_NAME;
    delete process.env.COMMON_HOST;
  });

  describe('resolveEnvOverrides', () => {
    test('should resolve literal value overrides', async () => {
      const overrides = {
        DB_NAME: { value: 'users_db' },
        DB_PORT: { value: 5432 },
        DEBUG: { value: true },
      };

      const resolved = await resolveEnvOverrides(overrides);

      expect(resolved.DB_NAME).toBe('users_db');
      expect(resolved.DB_PORT).toBe(5432);
      expect(resolved.DEBUG).toBe(true);
    });

    test('should resolve fromEnv references', async () => {
      process.env.USERS_DB_HOST = 'localhost';
      process.env.USERS_DB_NAME = 'users_database';

      const overrides = {
        DB_HOST: { fromEnv: 'USERS_DB_HOST' },
        DB_NAME: { fromEnv: 'USERS_DB_NAME' },
      };

      const resolved = await resolveEnvOverrides(overrides);

      expect(resolved.DB_HOST).toBe('localhost');
      expect(resolved.DB_NAME).toBe('users_database');
    });

    test('should handle mixed literal and fromEnv overrides', async () => {
      process.env.COMMON_HOST = 'shared-host.local';

      const overrides = {
        DB_HOST: { fromEnv: 'COMMON_HOST' },
        DB_NAME: { value: 'my_database' },
        DB_PORT: { value: 3306 },
      };

      const resolved = await resolveEnvOverrides(overrides);

      expect(resolved.DB_HOST).toBe('shared-host.local');
      expect(resolved.DB_NAME).toBe('my_database');
      expect(resolved.DB_PORT).toBe(3306);
    });

    test('should return empty string for missing fromEnv references', async () => {
      // NONEXISTENT_VAR is not set - TypedEnv returns empty string for optional vars
      const overrides = {
        DB_HOST: { fromEnv: 'NONEXISTENT_VAR' },
        DB_NAME: { value: 'my_database' },
      };

      const resolved = await resolveEnvOverrides(overrides);

      // Empty string is returned because TypedEnv returns '' for non-required vars
      expect(resolved.DB_HOST).toBe('');
      expect(resolved.DB_NAME).toBe('my_database');
    });

    test('should handle empty overrides', async () => {
      const resolved = await resolveEnvOverrides({});

      expect(Object.keys(resolved)).toHaveLength(0);
    });

    test('should use baseEnvOptions when reading fromEnv', async () => {
      // Set up env var that we'll read via fromEnv
      process.env.TEST_VAR = 'test_value';

      const overrides = {
        MY_VAR: { fromEnv: 'TEST_VAR' },
      };

      const resolved = await resolveEnvOverrides(overrides, {
        loadDotEnv: false,
      });

      expect(resolved.MY_VAR).toBe('test_value');
    });
  });

  describe('resolveEnvOverridesSync', () => {
    test('should resolve literal value overrides synchronously', () => {
      const overrides = {
        DB_NAME: { value: 'users_db' },
        DB_PORT: { value: 5432 },
        DEBUG: { value: false },
      };

      const resolved = resolveEnvOverridesSync(overrides);

      expect(resolved.DB_NAME).toBe('users_db');
      expect(resolved.DB_PORT).toBe(5432);
      expect(resolved.DEBUG).toBe(false);
    });

    test('should throw for fromEnv references', () => {
      const overrides = {
        DB_HOST: { fromEnv: 'SOME_VAR' },
      };

      expect(() => resolveEnvOverridesSync(overrides)).toThrow(
        'Cannot resolve fromEnv reference synchronously',
      );
    });

    test('should handle empty overrides synchronously', () => {
      const resolved = resolveEnvOverridesSync({});

      expect(Object.keys(resolved)).toHaveLength(0);
    });

    test('should handle multiple literal values', () => {
      const overrides = {
        VAR1: { value: 'string' },
        VAR2: { value: 123 },
        VAR3: { value: true },
        VAR4: { value: '' },
        VAR5: { value: 0 },
      };

      const resolved = resolveEnvOverridesSync(overrides);

      expect(resolved.VAR1).toBe('string');
      expect(resolved.VAR2).toBe(123);
      expect(resolved.VAR3).toBe(true);
      expect(resolved.VAR4).toBe('');
      expect(resolved.VAR5).toBe(0);
    });
  });
});
