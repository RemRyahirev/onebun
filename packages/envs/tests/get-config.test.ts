import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import type { EnvSchema } from '../src/types';

import { clearGetConfigCache, getConfig } from '../src/get-config';
import { Env } from '../src/helpers';

describe('getConfig', () => {
  beforeEach(() => {
    clearGetConfigCache();
  });

  afterEach(() => {
    clearGetConfigCache();
  });

  describe('basic resolution', () => {
    it('should resolve config from process.env', () => {
      process.env.TEST_PORT = '8080';
      process.env.TEST_HOST = 'example.com';

      try {
        const schema = {
          port: Env.number({ env: 'TEST_PORT', default: 3000 }),
          host: Env.string({ env: 'TEST_HOST', default: 'localhost' }),
        };

        const config = getConfig(schema, { loadDotEnv: false });

        expect(config.get('port')).toBe(8080);
        expect(config.get('host')).toBe('example.com');
      } finally {
        delete process.env.TEST_PORT;
        delete process.env.TEST_HOST;
      }
    });

    it('should use defaults when env vars not set', () => {
      const schema = {
        port: Env.number({ env: 'GETCONFIG_MISSING_PORT', default: 3000 }),
        debug: Env.boolean({ env: 'GETCONFIG_MISSING_DEBUG', default: false }),
      };

      const config = getConfig(schema, { loadDotEnv: false });

      expect(config.get('port')).toBe(3000);
      expect(config.get('debug')).toBe(false);
    });
  });

  describe('nested schemas', () => {
    it('should support nested config with dot-notation get()', () => {
      process.env.SERVER_PORT = '4000';
      process.env.DB_HOST = 'db.local';

      try {
        const schema: EnvSchema<{
          server: { port: number; host: string };
          database: { host: string };
        }> = {
          server: {
            port: Env.number({ env: 'SERVER_PORT', default: 3000 }),
            host: Env.string({ default: 'localhost' }),
          },
          database: {
            host: Env.string({ env: 'DB_HOST', default: '127.0.0.1' }),
          },
        };

        const config = getConfig(schema, { loadDotEnv: false });

        expect(config.get('server.port')).toBe(4000);
        expect(config.get('server.host')).toBe('localhost');
        expect(config.get('database.host')).toBe('db.local');
      } finally {
        delete process.env.SERVER_PORT;
        delete process.env.DB_HOST;
      }
    });
  });

  describe('types', () => {
    it('should correctly parse number, boolean, string, and array', () => {
      process.env.GC_NUM = '42';
      process.env.GC_BOOL = 'true';
      process.env.GC_STR = 'hello';
      process.env.GC_ARR = 'a,b,c';

      try {
        const schema = {
          num: Env.number({ env: 'GC_NUM' }),
          bool: Env.boolean({ env: 'GC_BOOL' }),
          str: Env.string({ env: 'GC_STR' }),
          arr: Env.array({ env: 'GC_ARR' }),
        };

        const config = getConfig(schema, { loadDotEnv: false });

        expect(config.get('num')).toBe(42);
        expect(config.get('bool')).toBe(true);
        expect(config.get('str')).toBe('hello');
        expect(config.get('arr')).toEqual(['a', 'b', 'c']);
      } finally {
        delete process.env.GC_NUM;
        delete process.env.GC_BOOL;
        delete process.env.GC_STR;
        delete process.env.GC_ARR;
      }
    });
  });

  describe('.env file', () => {
    const tmpDir = join(tmpdir(), 'getconfig-test');
    const envFilePath = join(tmpDir, '.env');

    beforeEach(() => {
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it('should load values from .env file synchronously', () => {
      writeFileSync(envFilePath, 'DOTENV_PORT=9090\nDOTENV_NAME=myapp\n');

      const schema = {
        port: Env.number({ env: 'DOTENV_PORT', default: 3000 }),
        name: Env.string({ env: 'DOTENV_NAME', default: 'default' }),
      };

      const config = getConfig(schema, { envFilePath });

      expect(config.get('port')).toBe(9090);
      expect(config.get('name')).toBe('myapp');
    });
  });

  describe('priority chain', () => {
    const tmpDir = join(tmpdir(), 'getconfig-priority-test');
    const envFilePath = join(tmpDir, '.env');

    beforeEach(() => {
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true });
      }
      delete process.env.PRIO_VAL;
    });

    it('should prioritize: valueOverrides > process.env > .env', () => {
      writeFileSync(envFilePath, 'PRIO_VAL=from-dotenv\n');
      process.env.PRIO_VAL = 'from-process';

      const schema = {
        val: Env.string({ env: 'PRIO_VAL', default: 'default' }),
      };

      // valueOverrides wins
      const config1 = getConfig(schema, {
        envFilePath,
        valueOverrides: { PRIO_VAL: 'from-override' },
      });
      expect(config1.get('val')).toBe('from-override');

      clearGetConfigCache();

      // process.env wins over .env (default behavior)
      const config2 = getConfig(schema, { envFilePath });
      expect(config2.get('val')).toBe('from-process');

      clearGetConfigCache();

      // .env wins over process.env when envOverridesDotEnv = false
      const config3 = getConfig(schema, { envFilePath, envOverridesDotEnv: false });
      expect(config3.get('val')).toBe('from-dotenv');
    });
  });

  describe('sensitive values', () => {
    it('should mask sensitive values in getSafeConfig()', () => {
      process.env.GC_SECRET = 'my-secret';

      try {
        const schema: EnvSchema<{ secret: string; plain: string }> = {
          secret: Env.string({ env: 'GC_SECRET', sensitive: true }),
          plain: Env.string({ default: 'visible' }),
        };

        const config = getConfig(schema, { loadDotEnv: false });
        const safe = config.getSafeConfig();

        expect(safe.secret).toBe('***');
        expect(safe.plain).toBe('visible');
      } finally {
        delete process.env.GC_SECRET;
      }
    });
  });

  describe('validation', () => {
    it('should throw on validation error', () => {
      process.env.GC_BAD_PORT = '99999';

      try {
        const schema = {
          port: Env.number({ env: 'GC_BAD_PORT', validate: Env.port() }),
        };

        expect(() => getConfig(schema, { loadDotEnv: false })).toThrow();
      } finally {
        delete process.env.GC_BAD_PORT;
      }
    });
  });

  describe('isInitialized', () => {
    it('should be true after getConfig()', () => {
      const schema = {
        val: Env.string({ default: 'test' }),
      };

      const config = getConfig(schema, { loadDotEnv: false });

      expect(config.isInitialized).toBe(true);
    });
  });

  describe('caching', () => {
    it('should return same instance for same schema reference', () => {
      const schema = {
        val: Env.string({ default: 'test' }),
      };

      const config1 = getConfig(schema, { loadDotEnv: false });
      const config2 = getConfig(schema, { loadDotEnv: false });

      expect(config1).toBe(config2);
    });

    it('should return different instances after clearGetConfigCache()', () => {
      const schema = {
        val: Env.string({ default: 'test' }),
      };

      const config1 = getConfig(schema, { loadDotEnv: false });
      clearGetConfigCache();
      const config2 = getConfig(schema, { loadDotEnv: false });

      expect(config1).not.toBe(config2);
    });
  });

  describe('values property', () => {
    it('should return full config object via .values', () => {
      const schema: EnvSchema<{ app: { name: string; port: number } }> = {
        app: {
          name: Env.string({ default: 'test-app' }),
          port: Env.number({ default: 3000 }),
        },
      };

      const config = getConfig(schema, { loadDotEnv: false });

      expect(config.values).toEqual({ app: { name: 'test-app', port: 3000 } });
    });
  });
});
