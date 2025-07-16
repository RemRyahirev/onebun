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
import { EnvLoader } from '../src/loader';
import { TypedEnv } from '../src/typed-env';
import { EnvSchema, EnvValidationError } from '../src/types';

const TEST_DIR = path.join(__dirname, '.test-integration');

describe('Integration Tests', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    
    TypedEnv.clear();
    
    // Clear test env vars
    delete process.env.NODE_ENV;
    delete process.env.NODEENV;
    delete process.env.PORT;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_POOLSIZE;
    delete process.env.JWT_SECRET;
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
    delete process.env.DEBUG;
    delete process.env.LOG_LEVEL;
    delete process.env.REQUIREDVAR;
    delete process.env.MINVALUE;
    delete process.env.MAXVALUE;
    delete process.env.TESTSTRING;
    delete process.env.TESTNUMBER;
    delete process.env.REQUIREDVALUE;
    delete process.env.APP_ENV;
    delete process.env.APP_PORT;
    delete process.env.APP_HOST;
    delete process.env.SECURITY_JWTSECRET;
    delete process.env.SECURITY_ALLOWEDORIGINS;
    delete process.env.SECURITY_CORSENABLED;
    delete process.env.LOGGING_DEBUG;
    delete process.env.LOGGING_LEVEL;
    delete process.env.LOGGING_FORMAT;
    delete process.env.FEATURES_NEWUI;
    delete process.env.FEATURES_BETAAPI;
    delete process.env.FEATURES_MAXUPLOADSIZE;
    delete process.env.FEATURES_RATELIMITREQUESTS;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    
    TypedEnv.clear();
  });

  describe('Real-world application configuration', () => {
    it('should handle complete application config from .env file', async () => {
      const envFile = path.join(TEST_DIR, 'app.env');
      writeFileSync(envFile, `
# Application Configuration
APP_ENV=production
APP_PORT=8080
APP_HOST=0.0.0.0

# Database
DATABASE_URL=postgres://user:password@db.example.com:5432/myapp
DATABASE_POOLSIZE=20

# Security
SECURITY_JWTSECRET=very_secure_jwt_secret_key_123456
SECURITY_ALLOWEDORIGINS=https://app.example.com,https://admin.example.com
SECURITY_CORSENABLED=true

# Redis Cache
REDIS_HOST=cache.example.com
REDIS_PORT=6379
REDIS_PASSWORD=redis_password_123

# Logging
LOGGING_DEBUG=false
LOGGING_LEVEL=info
LOGGING_FORMAT=json

# Features
FEATURES_NEWUI=true
FEATURES_BETAAPI=false
FEATURES_MAXUPLOADSIZE=50
FEATURES_RATELIMITREQUESTS=100
`);

      const schema: EnvSchema<{
        app: {
          env: string;
          port: number;
          host: string;
        };
        database: {
          url: string;
          poolSize: number;
        };
        security: {
          jwtSecret: string;
          allowedOrigins: string[];
          corsEnabled: boolean;
        };
        redis: {
          host: string;
          port: number;
          password: string;
        };
        logging: {
          debug: boolean;
          level: string;
          format: string;
        };
        features: {
          newUi: boolean;
          betaApi: boolean;
          maxUploadSize: number;
          rateLimitRequests: number;
        };
      }> = {
        app: {
          env: Env.string({ 
            default: 'development',
            validate: Env.oneOf(['development', 'production', 'test'] as const),
          }),
          port: Env.number({ 
            default: 3000,
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
          poolSize: Env.number({ 
            default: 10,
            min: 1,
            max: 100,
          }),
        },
        security: {
          jwtSecret: Env.string({ 
            sensitive: true,
            required: true,
            validate(secret: string) {
              if (secret.length < 20) {
                return Effect.fail(new EnvValidationError('', secret, 'JWT secret must be at least 20 characters'));
              }

              return Effect.succeed(secret);
            },
          }),
          allowedOrigins: Env.array({ 
            default: [],
          }),
          corsEnabled: Env.boolean({ default: false }),
        },
        redis: {
          host: Env.string({ default: 'localhost' }),
          port: Env.number({ 
            default: 6379,
            validate: Env.port(),
          }),
          password: Env.string({ 
            sensitive: true,
            default: '',
          }),
        },
        logging: {
          debug: Env.boolean({ default: false }),
          level: Env.string({ 
            default: 'info',
            validate: Env.oneOf(['debug', 'info', 'warn', 'error'] as const),
          }),
          format: Env.string({ 
            default: 'text',
            validate: Env.oneOf(['text', 'json'] as const),
          }),
        },
        features: {
          newUi: Env.boolean({ default: false }),
          betaApi: Env.boolean({ default: false }),
          maxUploadSize: Env.number({ 
            default: 10,
            min: 1,
            max: 1000,
          }),
          rateLimitRequests: Env.number({ 
            default: 60,
            min: 1,
          }),
        },
      };

      const config = await TypedEnv.createAsync(schema, {
        envFilePath: envFile,
      });

      // Проверяем основные настройки приложения
      expect(config.get('app.env')).toBe('production');
      expect(config.get('app.port')).toBe(8080);
      expect(config.get('app.host')).toBe('0.0.0.0');

      // Проверяем настройки базы данных
      expect(config.get('database.url')).toBe('postgres://user:password@db.example.com:5432/myapp');
      expect(config.get('database.poolSize')).toBe(20);

      // Проверяем настройки безопасности
      expect(config.get('security.allowedOrigins')).toEqual([
        'https://app.example.com',
        'https://admin.example.com',
      ]);
      expect(config.get('security.corsEnabled')).toBe(true);

      // Проверяем настройки Redis
      expect(config.get('redis.host')).toBe('cache.example.com');
      expect(config.get('redis.port')).toBe(6379);

      // Проверяем настройки логирования
      expect(config.get('logging.debug')).toBe(false);
      expect(config.get('logging.level')).toBe('info');
      expect(config.get('logging.format')).toBe('json');

      // Проверяем фича флаги
      expect(config.get('features.newUi')).toBe(true);
      expect(config.get('features.betaApi')).toBe(false);
      expect(config.get('features.maxUploadSize')).toBe(50);
      expect(config.get('features.rateLimitRequests')).toBe(100);

      // Проверяем маскировку чувствительных данных
      const safeConfig = config.getSafeConfig();
      expect(safeConfig.security.jwtSecret).toBe('***');
      expect(safeConfig.redis.password).toBe('***');
      expect(safeConfig.app.port).toBe(8080); // Не sensitive
    });

    it('should handle environment override of .env file', async () => {
      const envFile = path.join(TEST_DIR, 'override.env');
      writeFileSync(envFile, `
PORT=3000
NODEENV=development
DEBUG=false
`);

      // Устанавливаем переменные окружения для переопределения
      process.env.PORT = '8080';
      process.env.DEBUG = 'true';
      // NODE_ENV оставляем без переопределения

      const schema = {
        port: Env.number(),
        nodeEnv: Env.string(),
        debug: Env.boolean(),
      };

      const config = await TypedEnv.createAsync(schema, {
        envFilePath: envFile,
        envOverridesDotEnv: true,
      });

      // Переменные окружения должны переопределить .env файл
      expect(config.get('port')).toBe(8080);
      expect(config.get('debug')).toBe(true);
      // Эта переменная должна взяться из .env файла
      expect(config.get('nodeEnv')).toBe('development');
    });

    it('should prioritize .env file over environment when configured', async () => {
      const envFile = path.join(TEST_DIR, 'priority.env');
      writeFileSync(envFile, `
PORT=3000
DEBUG=false
`);

      process.env.PORT = '8080';
      process.env.DEBUG = 'true';

      const schema = {
        port: Env.number(),
        debug: Env.boolean(),
      };

      const config = await TypedEnv.createAsync(schema, {
        envFilePath: envFile,
        envOverridesDotEnv: false, // .env файл имеет приоритет
      });

      // .env файл должен переопределить переменные окружения
      expect(config.get('port')).toBe(3000);
      expect(config.get('debug')).toBe(false);
    });
  });

  describe('Error scenarios', () => {
    it('should handle validation errors gracefully', () => {
      // Очищаем переменные окружения
      delete process.env.PORT;
      delete process.env.EMAIL;
      delete process.env.URL;
      
      const envFile = path.join(TEST_DIR, 'invalid.env');
      writeFileSync(envFile, `
PORT=invalid_port
EMAIL=invalid_email
URL=not_a_url
`);

      const schema = {
        port: Env.number({ 
          required: true,
          validate: Env.port(),
        }),
        email: Env.string({ 
          required: true,
          validate: Env.email(),
        }),
        url: Env.string({ 
          required: true,
          validate: Env.url(),
        }),
      };

      // Должна быть ошибка валидации порта
      expect(() => TypedEnv.createAsync(schema, {
        envFilePath: envFile,
      })).toThrow(/is not a valid number/);
    });

    it('should handle missing required variables', () => {
      // Очищаем переменные окружения
      delete process.env.REQUIREDVAR;
      delete process.env.OPTIONALVAR;
      
      const schema = {
        requiredVar: Env.string({ required: true }),
        optionalVar: Env.string({ default: 'default_value' }),
      };

      expect(() => TypedEnv.createAsync(schema)).toThrow(/Required variable is not set/);
    });
  });

  describe('Direct loader usage', () => {
    it('should work with EnvLoader directly', async () => {
      const envFile = path.join(TEST_DIR, 'direct.env');
      writeFileSync(envFile, `
KEY1=value1
KEY2=value2
QUOTED="quoted value"
`);

      process.env.KEY3 = 'value3';

      const variables = await Effect.runPromise(EnvLoader.load({
        envFilePath: envFile,
        loadDotEnv: true,
        envOverridesDotEnv: true,
      }));

      expect(variables.KEY1).toBe('value1');
      expect(variables.KEY2).toBe('value2');
      expect(variables.QUOTED).toBe('quoted value');
      expect(variables.KEY3).toBe('value3');
    });

    it('should check .env file existence', async () => {
      const existingFile = path.join(TEST_DIR, 'exists.env');
      writeFileSync(existingFile, 'KEY=value');

      const existsResult = await Effect.runPromise(
        EnvLoader.checkDotEnvExists(existingFile),
      );
      expect(existsResult).toBe(true);

      const notExistsResult = await Effect.runPromise(
        EnvLoader.checkDotEnvExists(path.join(TEST_DIR, 'nonexistent.env')),
      );
      expect(notExistsResult).toBe(false);
    });
  });

  describe('Complex validation scenarios', () => {
    it('should handle interdependent validations', async () => {
      // Очищаем переменные окружения
      delete process.env.MINVALUE;
      delete process.env.MAXVALUE;
      delete process.env.CURRENTVALUE;
      delete process.env.MIN_VALUE;
      delete process.env.MAX_VALUE;
      delete process.env.CURRENT_VALUE;
      
      process.env.MINVALUE = '10';
      process.env.MAXVALUE = '100';
      process.env.CURRENTVALUE = '50';

      const schema = {
        minValue: Env.number({ required: true }),
        maxValue: Env.number({ required: true }),
        currentValue: Env.number({ 
          required: true,
          validate(value: number) {
            // Простая валидация без доступа к другим значениям
            if (value < 0) {
              return Effect.fail(new EnvValidationError('', value, 'Value must be positive'));
            }

            return Effect.succeed(value);
          },
        }),
      };

      const config = await TypedEnv.createAsync(schema);
      
      expect(config.get('minValue')).toBe(10);
      expect(config.get('maxValue')).toBe(100);
      expect(config.get('currentValue')).toBe(50);

      // Дополнительная валидация после инициализации
      const min = config.get('minValue');
      const max = config.get('maxValue');
      const current = config.get('currentValue');
      
      expect(current).toBeGreaterThanOrEqual(min);
      expect(current).toBeLessThanOrEqual(max);
    });
  });

  describe('Performance scenarios', () => {
    it('should handle large configurations efficiently', async () => {
      // Создаем большую конфигурацию
      const largeSchema: Record<string, unknown> = {};
      const expectedValues: Record<string, unknown> = {};

      for (let i = 0; i < 100; i++) {
        largeSchema[`string_${i}`] = Env.string({ default: `default_${i}` });
        largeSchema[`number_${i}`] = Env.number({ default: i });
        largeSchema[`boolean_${i}`] = Env.boolean({ default: i % 2 === 0 });
        
        expectedValues[`string_${i}`] = `default_${i}`;
        expectedValues[`number_${i}`] = i;
        expectedValues[`boolean_${i}`] = i % 2 === 0;
      }

      const startTime = performance.now();
      const config = await TypedEnv.createAsync(largeSchema as EnvSchema<Record<string, unknown>>);
      const endTime = performance.now();

      // Проверяем, что инициализация произошла достаточно быстро
      expect(endTime - startTime).toBeLessThan(1000); // Менее 1 секунды

      // Проверяем несколько случайных значений
      expect(config.get('string_0')).toBe('default_0');
      expect(config.get('number_50')).toBe(50);
      expect(config.get('boolean_99')).toBe(false);
    });
  });
}); 