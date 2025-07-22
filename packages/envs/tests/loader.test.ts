import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import path from 'path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect } from 'effect';

import { EnvLoader } from '../src/loader';

const TEST_DIR = path.join(__dirname, '.test-env-files');

describe('EnvLoader', () => {
  beforeEach(() => {
    // Создаем временную директорию для тестовых файлов
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // Очищаем process.env от тестовых переменных
    delete process.env.TEST_VAR_1;
    delete process.env.TEST_VAR_2;
    delete process.env.TEST_OVERRIDE;
  });

  afterEach(() => {
    // Очищаем временную директорию
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }

    // Очищаем process.env
    delete process.env.TEST_VAR_1;
    delete process.env.TEST_VAR_2;
    delete process.env.TEST_OVERRIDE;
  });

  describe('load method', () => {
    it('should load from process.env when no .env file', async () => {
      process.env.TEST_VAR_1 = 'value1';
      process.env.TEST_VAR_2 = 'value2';

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: path.join(TEST_DIR, 'nonexistent.env'),
          loadDotEnv: true,
        }),
      );

      expect(result.TEST_VAR_1).toBe('value1');
      expect(result.TEST_VAR_2).toBe('value2');
    });

    it('should load from .env file', async () => {
      const envFile = path.join(TEST_DIR, 'test.env');
      writeFileSync(
        envFile,
        `
# This is a comment
TEST_VAR_1=from_file
TEST_VAR_2=another_value

# Empty line above
QUOTED_VAR="quoted value"
SINGLE_QUOTED='single quoted'
MULTILINE="line1\\nline2"
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
          loadDotEnv: true,
        }),
      );

      expect(result.TEST_VAR_1).toBe('from_file');
      expect(result.TEST_VAR_2).toBe('another_value');
      expect(result.QUOTED_VAR).toBe('quoted value');
      expect(result.SINGLE_QUOTED).toBe('single quoted');
      expect(result.MULTILINE).toBe('line1\nline2');
    });

    it('should prioritize process.env over .env file by default', async () => {
      const envFile = path.join(TEST_DIR, 'test.env');
      writeFileSync(envFile, 'TEST_OVERRIDE=from_file');

      process.env.TEST_OVERRIDE = 'from_process';

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
          loadDotEnv: true,
          envOverridesDotEnv: true,
        }),
      );

      expect(result.TEST_OVERRIDE).toBe('from_process');
    });

    it('should prioritize .env file when envOverridesDotEnv is false', async () => {
      const envFile = path.join(TEST_DIR, 'test.env');
      writeFileSync(envFile, 'TEST_OVERRIDE=from_file');

      process.env.TEST_OVERRIDE = 'from_process';

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
          loadDotEnv: true,
          envOverridesDotEnv: false,
        }),
      );

      expect(result.TEST_OVERRIDE).toBe('from_file');
    });

    it('should skip .env loading when loadDotEnv is false', async () => {
      const envFile = path.join(TEST_DIR, 'test.env');
      writeFileSync(envFile, 'TEST_VAR_1=from_file');

      process.env.TEST_VAR_2 = 'from_process';

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
          loadDotEnv: false,
        }),
      );

      expect(result.TEST_VAR_1).toBeUndefined();
      expect(result.TEST_VAR_2).toBe('from_process');
    });

    it('should handle non-existent .env file gracefully', async () => {
      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: path.join(TEST_DIR, 'nonexistent.env'),
          loadDotEnv: true,
        }),
      );

      expect(result).toBeTypeOf('object');
    });

    it('should throw EnvLoadError for invalid file operations', async () => {
      // Создаем файл с неправильными permissions (только на Unix-like системах)
      const envFile = path.join(TEST_DIR, 'test.env');
      writeFileSync(envFile, 'TEST_VAR=value');

      // Симулируем ошибку чтения, мокируя Bun.file
      const originalFile = Bun.file;
      // @ts-expect-error Mocking Bun.file
      Bun.file = () => ({
        exists: () => Promise.resolve(true),
        text: () => Promise.reject(new Error('Permission denied')),
      });

      try {
        expect(
          Effect.runPromise(
            EnvLoader.load({
              envFilePath: envFile,
              loadDotEnv: true,
            }),
          ),
        ).rejects.toThrow('Permission denied');
      } finally {
        // Restoring original
        Bun.file = originalFile;
      }
    });
  });

  describe('parseDotEnvContent', () => {
    it('should parse basic key=value pairs', async () => {
      const envFile = path.join(TEST_DIR, 'basic.env');
      writeFileSync(envFile, 'KEY1=value1\nKEY2=value2');

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.KEY1).toBe('value1');
      expect(result.KEY2).toBe('value2');
    });

    it('should ignore comments and empty lines', async () => {
      const envFile = path.join(TEST_DIR, 'comments.env');
      writeFileSync(
        envFile,
        `
# This is a comment
KEY1=value1

# Another comment
KEY2=value2
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.KEY1).toBe('value1');
      expect(result.KEY2).toBe('value2');
    });

    it('should handle quoted values', async () => {
      const envFile = path.join(TEST_DIR, 'quoted.env');
      writeFileSync(
        envFile,
        `
DOUBLE_QUOTED="double quoted value"
SINGLE_QUOTED='single quoted value'
MIXED_QUOTES="value with 'inner' quotes"
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.DOUBLE_QUOTED).toBe('double quoted value');
      expect(result.SINGLE_QUOTED).toBe('single quoted value');
      expect(result.MIXED_QUOTES).toBe("value with 'inner' quotes");
    });

    it('should handle escape sequences', async () => {
      const envFile = path.join(TEST_DIR, 'escaped.env');
      writeFileSync(
        envFile,
        `
NEWLINE="line1\\nline2"
TAB="value\\twith\\ttabs"
BACKSLASH="path\\\\file"
QUOTES="say \\"hello\\""
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.NEWLINE).toBe('line1\nline2');
      expect(result.TAB).toBe('value\twith\ttabs');
      expect(result.BACKSLASH).toBe('path\\file');
      expect(result.QUOTES).toBe('say "hello"');
    });

    it('should ignore lines without equals sign', async () => {
      const envFile = path.join(TEST_DIR, 'invalid.env');
      writeFileSync(
        envFile,
        `
VALID_KEY=value
INVALID_LINE_WITHOUT_EQUALS
ANOTHER_VALID=another_value
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.VALID_KEY).toBe('value');
      expect(result.INVALID_LINE_WITHOUT_EQUALS).toBeUndefined();
      expect(result.ANOTHER_VALID).toBe('another_value');
    });

    it('should handle empty values', async () => {
      const envFile = path.join(TEST_DIR, 'empty.env');
      writeFileSync(
        envFile,
        `
EMPTY_VALUE=
QUOTED_EMPTY=""
SINGLE_QUOTED_EMPTY=''
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.EMPTY_VALUE).toBe('');
      expect(result.QUOTED_EMPTY).toBe('');
      expect(result.SINGLE_QUOTED_EMPTY).toBe('');
    });

    it('should handle values with spaces', async () => {
      const envFile = path.join(TEST_DIR, 'spaces.env');
      writeFileSync(
        envFile,
        `
SPACED_KEY = spaced value
TRIMMED_KEY=  value with spaces  
`,
      );

      const result = await Effect.runPromise(
        EnvLoader.load({
          envFilePath: envFile,
        }),
      );

      expect(result.SPACED_KEY).toBe('spaced value');
      expect(result.TRIMMED_KEY).toBe('value with spaces');
    });
  });

  describe('checkDotEnvExists', () => {
    it('should return true for existing file', async () => {
      const envFile = path.join(TEST_DIR, 'exists.env');
      writeFileSync(envFile, 'KEY=value');

      const exists = await Effect.runPromise(EnvLoader.checkDotEnvExists(envFile));
      expect(exists).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const exists = await Effect.runPromise(
        EnvLoader.checkDotEnvExists(path.join(TEST_DIR, 'nonexistent.env')),
      );
      expect(exists).toBe(false);
    });

    it('should use default .env path', async () => {
      const exists = await Effect.runPromise(EnvLoader.checkDotEnvExists());
      expect(typeof exists).toBe('boolean');
    });
  });

  describe('loadProcessEnv', () => {
    it('should exclude undefined values', async () => {
      process.env.DEFINED_VAR = 'defined';
      process.env.UNDEFINED_VAR = undefined;

      const result = await Effect.runPromise(
        EnvLoader.load({
          loadDotEnv: false,
        }),
      );

      expect(result.DEFINED_VAR).toBe('defined');
      expect(result.UNDEFINED_VAR).toBeUndefined();
    });
  });
});
