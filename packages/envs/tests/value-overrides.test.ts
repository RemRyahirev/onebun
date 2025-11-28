import {
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import { Effect } from 'effect';

import { EnvLoader } from '../src/loader';
import { TypedEnv } from '../src/typed-env';

describe('valueOverrides', () => {
  beforeEach(() => {
    TypedEnv.clear();
    // Clean up any test env vars
    delete process.env.TEST_VALUE;
    delete process.env.TEST_OVERRIDE;
    delete process.env.TEST_NUMBER;
  });

  describe('EnvLoader with valueOverrides', () => {
    test('should apply valueOverrides with highest priority', async () => {
      process.env.TEST_VALUE = 'from_env';

      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
          valueOverrides: {
            TEST_VALUE: 'from_override',
          },
        }),
      );

      expect(result.TEST_VALUE).toBe('from_override');
    });

    test('should override .env file values', async () => {
      // Mock .env file content
      const originalFile = Bun.file;
      const mockFile = mock(() => ({
        exists: () => Promise.resolve(true),
        text: () => Promise.resolve('TEST_VALUE=from_dotenv'),
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).file = mockFile;

      try {
        const result = await Effect.runPromise(
          EnvLoader.load({
            loadDotEnv: true,
            valueOverrides: {
              TEST_VALUE: 'from_override',
            },
          }),
        );

        expect(result.TEST_VALUE).toBe('from_override');
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Bun as any).file = originalFile;
      }
    });

    test('should convert number values to strings', async () => {
      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
          valueOverrides: {
            TEST_NUMBER: 42,
          },
        }),
      );

      expect(result.TEST_NUMBER).toBe('42');
    });

    test('should convert boolean values to strings', async () => {
      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
          valueOverrides: {
            TEST_BOOL: true,
          },
        }),
      );

      expect(result.TEST_BOOL).toBe('true');
    });

    test('should work together with process.env when no conflict', async () => {
      process.env.TEST_VALUE = 'from_env';

      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
          valueOverrides: {
            TEST_OVERRIDE: 'from_override',
          },
        }),
      );

      expect(result.TEST_VALUE).toBe('from_env');
      expect(result.TEST_OVERRIDE).toBe('from_override');
    });

    test('should not modify result when valueOverrides is undefined', async () => {
      process.env.TEST_VALUE = 'from_env';

      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
          valueOverrides: undefined,
        }),
      );

      expect(result.TEST_VALUE).toBe('from_env');
    });

    test('should not modify result when valueOverrides is empty', async () => {
      process.env.TEST_VALUE = 'from_env';

      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
          valueOverrides: {},
        }),
      );

      expect(result.TEST_VALUE).toBe('from_env');
    });
  });

  describe('TypedEnv with valueOverrides', () => {
    test('should use valueOverrides in TypedEnv', async () => {
      process.env.TEST_VALUE = 'from_env';

      const schema = {
        TEST_VALUE: { type: 'string' as const },
      };

      const config = await TypedEnv.createAsync(
        schema,
        {
          loadDotEnv: false,
          valueOverrides: {
            TEST_VALUE: 'from_override',
          },
        },
        'test-override-1',
      );

      expect(config.get('TEST_VALUE')).toBe('from_override');
    });

    test('should parse overridden number values correctly', async () => {
      const schema = {
        TEST_NUMBER: { type: 'number' as const },
      };

      const config = await TypedEnv.createAsync(
        schema,
        {
          loadDotEnv: false,
          valueOverrides: {
            TEST_NUMBER: 3000,
          },
        },
        'test-override-2',
      );

      expect(config.get('TEST_NUMBER')).toBe(3000);
    });

    test('should parse overridden boolean values correctly', async () => {
      const schema = {
        TEST_BOOL: { type: 'boolean' as const },
      };

      const config = await TypedEnv.createAsync(
        schema,
        {
          loadDotEnv: false,
          valueOverrides: {
            TEST_BOOL: false,
          },
        },
        'test-override-3',
      );

      expect(config.get('TEST_BOOL')).toBe(false);
    });
  });
});
