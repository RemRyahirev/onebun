import {
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from 'fs';
import path from 'path';

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import { Env } from '../src/helpers';
import { TypedEnv } from '../src/typed-env';
import { type EnvSchema, EnvValidationError } from '../src/types';

const TEST_DIR = path.join(__dirname, '.test-typed-env');

describe('TypedEnv and ConfigProxy', () => {
  beforeEach(() => {
    // Создаем временную директорию
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    
    // Очищаем instances
    TypedEnv.clear();
    
    // Очищаем process.env
    delete process.env.TEST_STRING;
    delete process.env.TEST_NUMBER;
    delete process.env.TEST_BOOLEAN;
    delete process.env.TEST_ARRAY;
    delete process.env.TESTSTRING;
    delete process.env.TESTNUMBER;
    delete process.env.TESTBOOLEAN;
    delete process.env.TESTARRAY;
    delete process.env.NESTED_VALUE;
    delete process.env.SENSITIVE_VALUE;
    delete process.env.CUSTOM_ENV_NAME;
    delete process.env.PASSWORD;
    delete process.env.USERNAME;
    delete process.env.REQUIREDVALUE;
  });

  afterEach(() => {
    // Очищаем директорию
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    
    TypedEnv.clear();
    
    // Очищаем process.env
    delete process.env.TEST_STRING;
    delete process.env.TEST_NUMBER;
    delete process.env.TEST_BOOLEAN;
    delete process.env.TEST_ARRAY;
    delete process.env.TESTSTRING;
    delete process.env.TESTNUMBER;
    delete process.env.TESTBOOLEAN;
    delete process.env.TESTARRAY;
    delete process.env.NESTED_VALUE;
    delete process.env.SENSITIVE_VALUE;
    delete process.env.CUSTOM_ENV_NAME;
    delete process.env.PASSWORD;
    delete process.env.USERNAME;
    delete process.env.REQUIREDVALUE;
  });

  describe('Basic functionality', () => {
    it('should create and initialize config proxy', async () => {
      const schema = {
        testString: Env.string({ default: 'default_value' }),
        testNumber: Env.number({ default: 42 }),
        testBoolean: Env.boolean({ default: true }),
        testArray: Env.array({ default: ['a', 'b'] }),
      };

      const config = await TypedEnv.createAsync(schema);
      
      expect(config.isInitialized).toBe(true);
      expect(config.get('testString')).toBe('default_value');
      expect(config.get('testNumber')).toBe(42);
      expect(config.get('testBoolean')).toBe(true);
      expect(config.get('testArray')).toEqual(['a', 'b']);
    });

    it('should load values from process.env', async () => {
      process.env.TESTSTRING = 'from_env';
      process.env.TESTNUMBER = '123';
      process.env.TESTBOOLEAN = 'true';
      process.env.TESTARRAY = 'x,y,z';

      const schema = {
        testString: Env.string(),
        testNumber: Env.number(),
        testBoolean: Env.boolean(),
        testArray: Env.array(),
      };

      const config = await TypedEnv.createAsync(schema);
      
      expect(config.get('testString')).toBe('from_env');
      expect(config.get('testNumber')).toBe(123);
      expect(config.get('testBoolean')).toBe(true);
      expect(config.get('testArray')).toEqual(['x', 'y', 'z']);
    });

    it('should load values from .env file', async () => {
      const envFile = path.join(TEST_DIR, 'test.env');
      writeFileSync(envFile, `
TESTSTRING=from_file
TESTNUMBER=456
TESTBOOLEAN=false
TESTARRAY=a,b,c
`);

      const schema = {
        testString: Env.string(),
        testNumber: Env.number(),
        testBoolean: Env.boolean(),
        testArray: Env.array(),
      };

      const config = await TypedEnv.createAsync(schema, {
        envFilePath: envFile,
      });
      
      expect(config.get('testString')).toBe('from_file');
      expect(config.get('testNumber')).toBe(456);
      expect(config.get('testBoolean')).toBe(false);
      expect(config.get('testArray')).toEqual(['a', 'b', 'c']);
    });

    it('should use custom environment variable names', async () => {
      process.env.CUSTOM_ENV_NAME = 'custom_value';

      const schema = {
        testValue: Env.string({ env: 'CUSTOM_ENV_NAME' }),
      };

      const config = await TypedEnv.createAsync(schema);
      expect(config.get('testValue')).toBe('custom_value');
    });
  });

  describe('Nested schema support', () => {
    it('should support nested configuration', async () => {
      process.env.NESTED_VALUE = 'nested_env_value';
      process.env.DATABASE_HOST = 'localhost';
      process.env.DATABASE_PORT = '5432';

      const schema: EnvSchema<{
        nested: {
          value: string;
        };
        database: {
          host: string;
          port: number;
        };
      }> = {
        nested: {
          value: Env.string({ default: 'default' }),
        },
        database: {
          host: Env.string({ default: '127.0.0.1' }),
          port: Env.number({ default: 3306 }),
        },
      };

      const config = await TypedEnv.createAsync(schema);
      
      expect(config.get('nested.value')).toBe('nested_env_value');
      expect(config.get('database.host')).toBe('localhost');
      expect(config.get('database.port')).toBe(5432);
    });

    it('should generate correct environment variable names for nested paths', async () => {
      process.env.DEEP_NESTED_VALUE = 'deep_value';

      const schema: EnvSchema<{
        deep: {
          nested: {
            value: string;
          };
        };
      }> = {
        deep: {
          nested: {
            value: Env.string(),
          },
        },
      };

      const config = await TypedEnv.createAsync(schema);
      expect(config.get('deep.nested.value')).toBe('deep_value');
    });
  });

  describe('Sensitive data handling', () => {
    it('should wrap sensitive values', async () => {
      process.env.PASSWORD = 'secret_password';

      const schema = {
        password: Env.string({ sensitive: true }),
      };

      const config = await TypedEnv.createAsync(schema);
      const sensitiveValue = config.get('password');
      
      // Проверяем, что это обёрнутое значение
      expect(String(sensitiveValue)).toBe('***');
      expect(sensitiveValue.toString()).toBe('***');
      expect(JSON.stringify(sensitiveValue)).toBe('"***"');
      
      // Но фактическое значение доступно через .value
      // @ts-expect-error accessing internal value property
      expect(sensitiveValue.value).toBe('secret_password');
    });

    it('should mask sensitive values in safe config', async () => {
      process.env.PASSWORD = 'secret';
      process.env.USERNAME = 'normal';

      const schema = {
        password: Env.string({ sensitive: true }),
        username: Env.string({ sensitive: false }),
      };

      const config = await TypedEnv.createAsync(schema);
      const safeConfig = config.getSafeConfig();
      
      expect(safeConfig.password).toBe('***');
      expect(safeConfig.username).toBe('normal');
    });

    it('should mask nested sensitive values', async () => {
      process.env.DATABASE_PASSWORD = 'secret_db_pass';
      process.env.DATABASE_HOST = 'localhost';

      const schema: EnvSchema<{
        database: {
          password: string;
          host: string;
        };
      }> = {
        database: {
          password: Env.string({ sensitive: true }),
          host: Env.string({ sensitive: false }),
        },
      };

      const config = await TypedEnv.createAsync(schema);
      const safeConfig = config.getSafeConfig();
      
      expect(safeConfig.database.password).toBe('***');
      expect(safeConfig.database.host).toBe('localhost');
    });
  });

  describe('Type inference', () => {
    it('should provide correct type inference for get method', async () => {
      const schema: EnvSchema<{
        stringValue: string;
        numberValue: number;
        booleanValue: boolean;
        arrayValue: string[];
        nested: {
          value: string;
        };
      }> = {
        stringValue: Env.string(),
        numberValue: Env.number(),
        booleanValue: Env.boolean(),
        arrayValue: Env.array(),
        nested: {
          value: Env.string(),
        },
      };

      const config = await TypedEnv.createAsync(schema);
      
      // TypeScript должен правильно выводить типы
      const str: string = config.get('stringValue');
      const num: number = config.get('numberValue');
      const bool: boolean = config.get('booleanValue');
      const arr: string[] = config.get('arrayValue');
      
      expect(typeof str).toBe('string');
      expect(typeof num).toBe('number');
      expect(typeof bool).toBe('boolean');
      expect(Array.isArray(arr)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should throw validation errors for invalid values', () => {
      // Очищаем переменные окружения
      delete process.env.TESTNUMBER;
      
      process.env.TESTNUMBER = 'not_a_number';

      const schema = {
        testNumber: Env.number({ required: true }),
      };

      expect(() => TypedEnv.createAsync(schema)).toThrow(/is not a valid number/);
    });

    it('should throw for missing required values', () => {
      // Очищаем переменные окружения
      delete process.env.REQUIREDVALUE;
      
      const schema = {
        requiredValue: Env.string({ required: true }),
      };

      expect(() => TypedEnv.createAsync(schema)).toThrow(/Required variable is not set/);
    });

    it('should throw error when accessing uninitialized config', () => {
      const schema = { test: Env.string() };
      const config = TypedEnv.create(schema);
      
      // Не ждем инициализации
      expect(() => config.get('test'))
        .toThrow('Configuration not initialized');
    });

    it('should throw error when getting values before initialization', () => {
      const schema = { test: Env.string() };
      const config = TypedEnv.create(schema);
      
      expect(() => config.values)
        .toThrow('Configuration not initialized');
      
      expect(() => config.getSafeConfig())
        .toThrow('Configuration not initialized');
    });
  });

  describe('Instance management', () => {
    it('should return same instance for same key', () => {
      const schema = { test: Env.string() };
      
      const config1 = TypedEnv.create(schema, {}, 'test_key');
      const config2 = TypedEnv.create(schema, {}, 'test_key');
      
      expect(config1).toBe(config2);
    });

    it('should return different instances for different keys', () => {
      const schema = { test: Env.string() };
      
      const config1 = TypedEnv.create(schema, {}, 'key1');
      const config2 = TypedEnv.create(schema, {}, 'key2');
      
      expect(config1).not.toBe(config2);
    });

    it('should clear all instances', () => {
      const schema = { test: Env.string() };
      
      TypedEnv.create(schema, {}, 'key1');
      TypedEnv.create(schema, {}, 'key2');
      
      TypedEnv.clear();
      
      const newConfig1 = TypedEnv.create(schema, {}, 'key1');
      const newConfig2 = TypedEnv.create(schema, {}, 'key1');
      
      expect(newConfig1).toBe(newConfig2); // Same instance after clear
    });
  });

  describe('Manual initialization', () => {
    it('should allow manual initialization', async () => {
      const schema = { test: Env.string({ default: 'test_value' }) };
      const config = TypedEnv.create(schema);
      
      expect(config.isInitialized).toBe(false);
      
      await config.initialize();
      
      expect(config.isInitialized).toBe(true);
      expect(config.get('test')).toBe('test_value');
    });

    it('should handle multiple initialization calls', async () => {
      const schema = { test: Env.string({ default: 'test_value' }) };
      const config = TypedEnv.create(schema);
      
      await config.initialize();
      await config.initialize(); // Second call should be no-op
      
      expect(config.isInitialized).toBe(true);
      expect(config.get('test')).toBe('test_value');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle complex nested schema with validation', async () => {
      // Очищаем переменные окружения
      delete process.env.SERVER_PORT;
      delete process.env.SERVER_HOST;
      delete process.env.DATABASE_URL;
      delete process.env.SECURITY_ALLOWEDORIGINS;
      delete process.env.SECURITY_APISECRET;
      
      process.env.SERVER_PORT = '3000';
      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
      process.env.SECURITY_ALLOWEDORIGINS = 'http://localhost:3000,https://example.com';
      process.env.SECURITY_APISECRET = 'super_secret_key';

      const schema: EnvSchema<{
        server: {
          port: number;
          host: string;
        };
        database: {
          url: string;
        };
        security: {
          allowedOrigins: string[];
          apiSecret: string;
        };
      }> = {
        server: {
          port: Env.number({ 
            min: 1, 
            max: 65535,
            validate: Env.port(),
          }),
          host: Env.string({ default: 'localhost' }),
        },
        database: {
          url: Env.string({ 
            required: true,
            validate: Env.url(),
          }),
        },
        security: {
          allowedOrigins: Env.array({ 
            minLength: 1,
            validate(origins: string[]) {
              // Дополнительная валидация URL-ов
              return Effect.succeed(origins);
            },
          }),
          apiSecret: Env.string({ 
            sensitive: true,
            required: true,
            validate(secret: string) {
              if (secret.length < 10) {
                return Effect.fail(new EnvValidationError('', secret, 'API secret must be at least 10 characters'));
              }

              return Effect.succeed(secret);
            },
          }),
        },
      };

      const config = await TypedEnv.createAsync(schema);
      
      expect(config.get('server.port')).toBe(3000);
      expect(config.get('server.host')).toBe('localhost');
      expect(config.get('database.url')).toBe('postgres://user:pass@localhost:5432/db');
      expect(config.get('security.allowedOrigins')).toEqual([
        'http://localhost:3000', 
        'https://example.com',
      ]);
      
      // Проверяем маскировку sensitive данных
      const safeConfig = config.getSafeConfig();
      expect(safeConfig.security.apiSecret).toBe('***');
      expect(safeConfig.server.port).toBe(3000); // Не sensitive
    });
  });
}); 