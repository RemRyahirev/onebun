/**
 * Documentation Examples Tests for @onebun/envs
 *
 * @source docs:api/envs.md
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import {
  TypedEnv,
  Env,
  Effect,
  type EnvSchema,
  EnvValidationError,
  getConfig,
  clearGetConfigCache,
} from '../src';

// Counter for unique instance keys to avoid cache conflicts between tests
let testCounter = 0;
const getUniqueKey = () => `test-${Date.now()}-${++testCounter}`;

describe('Envs README Examples', () => {
  beforeEach(() => {
    // Clear all cached TypedEnv instances before each test
    TypedEnv.clear();
  });

  afterEach(() => {
    // Clear instances after tests
    TypedEnv.clear();
  });

  describe('Quick Start (README)', () => {
    beforeEach(() => {
      // Set up test environment variables
      process.env.DATABASE_URL = 'postgres://localhost:5432/testdb';
      process.env.DATABASE_PASSWORD = 'secret123';
      process.env.APP_PORT = '4000';
    });

    afterEach(() => {
      // Clean up environment variables
      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_PASSWORD;
      delete process.env.APP_PORT;
    });

    it('should define schema with Env helpers', () => {
      // From README: Define your configuration schema
      const schema = {
        app: {
          port: Env.number({ default: 3000, validate: Env.port() }),
          host: Env.string({ default: 'localhost' }),
          env: Env.string({
            default: 'development',
            validate: Env.oneOf(['development', 'production', 'test']),
          }),
        },
        database: {
          url: Env.string({
            required: true,
            validate: Env.url(),
          }),
          password: Env.string({
            sensitive: true,
            required: true,
          }),
        },
      };

      expect(schema).toBeDefined();
      expect(schema.app.port).toHaveProperty('type', 'number');
      expect(schema.app.host).toHaveProperty('type', 'string');
      expect(schema.database.url).toHaveProperty('type', 'string');
      expect(schema.database.password).toHaveProperty('sensitive', true);
    });

    /**
     * @source docs:api/envs.md#quick-start
     */
    it('should create typed configuration', async () => {
      // From README: Create typed configuration
      const schema: EnvSchema<{
        app: { port: number; host: string };
        database: { url: string };
      }> = {
        app: {
          port: Env.number({ default: 3000 }),
          host: Env.string({ default: 'localhost' }),
        },
        database: {
          url: Env.string({ env: 'DATABASE_URL' }),
        },
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());

      expect(config).toBeDefined();
      expect(typeof config.get).toBe('function');
    });

    /**
     * @source docs:api/envs.md#quick-start
     */
    it('should access values with full type safety', async () => {
      const schema: EnvSchema<{
        app: { port: number };
        database: { url: string };
      }> = {
        app: {
          port: Env.number({ default: 3000, env: 'APP_PORT' }),
        },
        database: {
          url: Env.string({ env: 'DATABASE_URL' }),
        },
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());

      // From README: Access values with full type safety
      const port = config.get('app.port'); // number
      const dbUrl = config.get('database.url'); // string

      expect(typeof port).toBe('number');
      expect(port).toBe(4000); // From env
      expect(typeof dbUrl).toBe('string');
      expect(dbUrl).toBe('postgres://localhost:5432/testdb');
    });

    /**
     * @source docs:api/envs.md#quick-start
     */
    it('should get safe config for logging', async () => {
      const schema: EnvSchema<{
        app: { port: number };
        database: { url: string; password: string };
      }> = {
        app: {
          port: Env.number({ default: 3000, env: 'APP_PORT' }),
        },
        database: {
          url: Env.string({ env: 'DATABASE_URL' }),
          password: Env.string({ env: 'DATABASE_PASSWORD', sensitive: true }),
        },
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());

      // From README: Get safe config for logging (sensitive data masked)
      const safeConfig = config.getSafeConfig();

      expect(safeConfig).toBeDefined();
      // Password should be masked
      expect((safeConfig as { database: { password: string } }).database.password).not.toBe('secret123');
    });
  });

  describe('Environment Variable Types (README)', () => {
    it('should create string configuration', () => {
      // From README: Env.string(options) - String configuration
      const stringConfig = Env.string({ default: 'localhost' });

      expect(stringConfig.type).toBe('string');
      expect(stringConfig.default).toBe('localhost');
    });

    it('should create number configuration', () => {
      // From README: Env.number(options) - Number configuration with range validation
      const numberConfig = Env.number({ default: 3000 });

      expect(numberConfig.type).toBe('number');
      expect(numberConfig.default).toBe(3000);
    });

    it('should create boolean configuration', () => {
      // From README: Env.boolean(options) - Boolean configuration
      const boolConfig = Env.boolean({ default: false });

      expect(boolConfig.type).toBe('boolean');
      expect(boolConfig.default).toBe(false);
    });

    it('should create array configuration', () => {
      // From README: Env.array(options) - Array configuration with length validation
      const arrayConfig = Env.array({ default: ['value1', 'value2'] });

      expect(arrayConfig.type).toBe('array');
      expect(arrayConfig.default).toEqual(['value1', 'value2']);
    });
  });

  describe('Built-in Validators (README)', () => {
    it('should create regex validator', () => {
      // From README: Env.regex(pattern, message?)
      const regexValidator = Env.regex(/^[a-z]+$/, 'Must be lowercase letters');

      expect(typeof regexValidator).toBe('function');
    });

    it('should create oneOf validator', () => {
      // From README: Env.oneOf(values, message?)
      const enumValidator = Env.oneOf(
        ['development', 'production', 'test'],
        'Invalid environment',
      );

      expect(typeof enumValidator).toBe('function');
    });

    it('should create url validator', () => {
      // From README: Env.url(message?)
      const urlValidator = Env.url('Must be a valid URL');

      expect(typeof urlValidator).toBe('function');
    });

    it('should create email validator', () => {
      // From README: Env.email(message?)
      const emailValidator = Env.email('Must be a valid email');

      expect(typeof emailValidator).toBe('function');
    });

    it('should create port validator', () => {
      // From README: Env.port(message?)
      const portValidator = Env.port('Must be a valid port');

      expect(typeof portValidator).toBe('function');
    });
  });

  describe('Custom Validation (README)', () => {
    beforeEach(() => {
      process.env.APIKEY = 'a'.repeat(32); // 32-character key
    });

    afterEach(() => {
      delete process.env.APIKEY;
    });

    it('should use custom validation function', async () => {
      // From README: Custom Validation example
      // Custom validate function can return Effect.succeed/Effect.fail with EnvValidationError
      const schema = {
        apiKey: Env.string({
          required: true,
          sensitive: true,
          validate(value: string) {
            if (value.length < 32) {
              return Effect.fail(
                new EnvValidationError('apiKey', value, 'API key too short'),
              );
            }

            return Effect.succeed(value);
          },
        }),
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());
      const apiKey = config.get('apiKey');

      // Sensitive values are wrapped - String() returns '***'
      expect(String(apiKey)).toBe('***');
      // The actual value is stored internally
      expect(apiKey).toBeDefined();
    });
  });

  describe('Nested Configuration (README)', () => {
    beforeEach(() => {
      // Env variable naming convention: PARENT_CHILD -> PARENT_CHILD
      // server.port -> SERVER_PORT
      // database.host -> DATABASE_HOST
      process.env.SERVER_PORT = '8080';
      process.env.DATABASE_HOST = 'db.example.com';
      process.env.DATABASE_PASSWORD = 'secret-password';
    });

    afterEach(() => {
      delete process.env.SERVER_PORT;
      delete process.env.DATABASE_HOST;
      delete process.env.DATABASE_PASSWORD;
    });

    it('should support nested configuration', async () => {
      // From README: Nested Configuration example
      // Nested schemas require EnvSchema<T> type annotation for proper typing
      const schema: EnvSchema<{
        server: {
          port: number;
          host: string;
        };
        database: {
          host: string;
          password: string;
        };
      }> = {
        server: {
          port: Env.number({ default: 3000 }),
          host: Env.string({ default: 'localhost' }),
        },
        database: {
          host: Env.string({ default: '127.0.0.1' }),
          password: Env.string({ sensitive: true }),
        },
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());

      // Access nested values using dot notation
      const serverPort = config.get('server.port');
      const dbHost = config.get('database.host');
      const dbPassword = config.get('database.password');

      expect(serverPort).toBe(8080);
      expect(dbHost).toBe('db.example.com');
      // Sensitive values are wrapped
      expect(String(dbPassword)).toBe('***');
    });
  });
});

describe('Envs API Documentation Examples', () => {
  describe('Defining Schema (docs/api/envs.md)', () => {
    it('should define schema with nested structure', () => {
      // From docs: src/config.ts example
      const envSchema = {
        // Nested structure becomes dotted paths
        server: {
          port: Env.number({ default: 3000, env: 'PORT' }),
          host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
        },
        database: {
          url: Env.string({
            env: 'DATABASE_URL',
            required: true,
            sensitive: true, // Masked in logs
          }),
          maxConnections: Env.number({
            default: 10,
            env: 'DB_MAX_CONNECTIONS',
          }),
          ssl: Env.boolean({
            default: true,
            env: 'DB_SSL',
          }),
        },
        redis: {
          host: Env.string({ default: 'localhost', env: 'REDIS_HOST' }),
          port: Env.number({ default: 6379, env: 'REDIS_PORT' }),
          password: Env.string({
            env: 'REDIS_PASSWORD',
            sensitive: true,
            required: false,
          }),
        },
        features: {
          enableCache: Env.boolean({ default: true }),
          allowedOrigins: Env.array({
            default: ['http://localhost:3000'],
            env: 'ALLOWED_ORIGINS',
            separator: ',',
          }),
        },
        app: {
          name: Env.string({ default: 'my-app' }),
          version: Env.string({ default: '1.0.0' }),
          debug: Env.boolean({ default: false, env: 'DEBUG' }),
        },
      };

      expect(envSchema.server.port).toHaveProperty('type', 'number');
      expect(envSchema.database.url).toHaveProperty('sensitive', true);
      expect(envSchema.features.allowedOrigins).toHaveProperty('type', 'array');
    });
  });

  describe('TypedEnv.create options (docs/api/envs.md)', () => {
    it('should create config with various options', async () => {
      // From docs: TypedEnv.create options
      // Flat schema - simple key names
      const schema = {
        port: Env.number({ default: 3000 }),
        debug: Env.boolean({ default: false }),
      };

      // Note: valueOverrides uses actual env variable names (UPPER_SNAKE_CASE)
      const config = await TypedEnv.createAsync(schema, {
        // Load .env file (default: true)
        loadDotEnv: false,

        // Process.env overrides .env file (default: true)
        envOverridesDotEnv: true,

        // Throw on missing required variables (default: false)
        strict: false,

        // Default separator for arrays (default: ',')
        defaultArraySeparator: ',',

        // Override specific values using env variable names
        valueOverrides: {
          PORT: 4000,
          DEBUG: true,
        },
      }, getUniqueKey());

      expect(config.get('port')).toBe(4000);
      expect(config.get('debug')).toBe(true);
    });
  });

  describe('Validation (docs/api/envs.md)', () => {
    it('should validate with custom function', async () => {
      // From docs: Built-in Validation example
      // Using flat schema with explicit env names to avoid conflicts
      const schema = {
        serverPort: Env.number({
          env: 'VALIDATION_TEST_PORT', // Explicit unique env name
          default: 3000,
          // Validation can return Effect or boolean
          validate: Env.port(), // Built-in port validator
        }),
        logLevel: Env.string({
          env: 'VALIDATION_TEST_LEVEL', // Explicit unique env name
          default: 'info',
          // Use oneOf for enum validation
          validate: Env.oneOf(['trace', 'debug', 'info', 'warn', 'error']),
        }),
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());

      expect(config.get('serverPort')).toBe(3000);
      expect(config.get('logLevel')).toBe('info');
    });
  });

  describe('Array Variables (docs/api/envs.md)', () => {
    beforeEach(() => {
      // Default env name for allowedHosts is ALLOWEDHOSTS (camelCase -> UPPERCASE)
      process.env.ALLOWEDHOSTS = 'example.com,api.example.com,localhost';
    });

    afterEach(() => {
      delete process.env.ALLOWEDHOSTS;
    });

    it('should parse array from environment variable', async () => {
      // From docs: Array Variables example
      // Note: Default env name is derived from schema key (allowedHosts -> ALLOWEDHOSTS)
      const schema = {
        allowedHosts: Env.array({
          default: ['localhost'],
          separator: ',', // Custom separator (default is ',')
        }),
      };

      const config = await TypedEnv.createAsync(schema, {}, getUniqueKey());

      // Result
      const hosts = config.get('allowedHosts');
      expect(hosts).toEqual(['example.com', 'api.example.com', 'localhost']);
    });
  });

  describe('Empty Values (docs/api/envs.md)', () => {
    afterEach(() => {
      clearGetConfigCache();
    });

    /**
     * @source docs:api/envs.md#empty-values
     */
    it('should apply the declared default when the variable is blank', () => {
      // From docs: `VAR=` means "not configured"
      const envSchema: EnvSchema<{ database: { host: string; port: number } }> = {
        database: {
          host: Env.string({ env: 'DB_HOST', default: 'localhost' }),
          port: Env.number({ env: 'DB_PORT', default: 5432 }),
        },
      };

      // .env
      // DB_HOST=
      // DB_PORT=
      const config = getConfig(envSchema, {
        loadDotEnv: false,
        valueOverrides: { DB_HOST: '', DB_PORT: '' },
      });

      expect(config.get('database.host')).toBe('localhost'); // the default, not ''
      expect(config.get('database.port')).toBe(5432); // the default, not a parse error
    });

    /**
     * @source docs:api/envs.md#empty-values
     */
    it('should not let a blank value satisfy required: true', () => {
      // From docs: DATABASE_URL= throws — an empty string does not satisfy `required`
      const envSchema: EnvSchema<{ database: { url: string } }> = {
        database: {
          url: Env.string({ env: 'DATABASE_URL', required: true }),
        },
      };

      expect(() =>
        getConfig(envSchema, {
          loadDotEnv: false,
          valueOverrides: { DATABASE_URL: '' },
        }),
      ).toThrow(
        'Environment variable validation failed for "DATABASE_URL":'
        + ' Required variable is set to an empty string. Got: an empty string',
      );
    });

    /**
     * @source docs:api/envs.md#empty-values
     */
    it('should keep whitespace as a real value', () => {
      // From docs: "What counts as empty" — only the exact empty string
      const envSchema: EnvSchema<{ database: { host: string } }> = {
        database: { host: Env.string({ env: 'WS_DB_HOST', default: 'localhost' }) },
      };

      const config = getConfig(envSchema, {
        loadDotEnv: false,
        valueOverrides: { WS_DB_HOST: '   ' },
      });

      expect(config.get('database.host')).toBe('   ');
    });

    /**
     * @source docs:api/envs.md#empty-values
     */
    it('should use the type zero value when neither default nor required is declared', () => {
      // From docs: "Neither `default` nor `required`"
      const envSchema = { host: Env.string({ env: 'ZERO_VALUE_HOST' }) };

      const config = getConfig(envSchema, { loadDotEnv: false });

      expect(config.get('host')).toBe('');
    });
  });

  describe('Rejected Values Are Never Echoed (docs/api/envs.md)', () => {
    afterEach(() => {
      clearGetConfigCache();
    });

    /**
     * @source docs:api/envs.md#rejected-values-are-never-echoed
     */
    it('should describe the rejected value instead of printing it', () => {
      // From docs: DATABASE_PASSWORD=super-secret-p@ssw0rd against a number variable
      const secret = 'super-secret-p@ssw0rd';
      const envSchema: EnvSchema<{ database: { password: number } }> = {
        database: {
          password: Env.number({ env: 'DATABASE_PASSWORD', required: true, sensitive: true }),
        },
      };

      let thrown: Error | undefined;
      try {
        getConfig(envSchema, {
          loadDotEnv: false,
          valueOverrides: { DATABASE_PASSWORD: secret },
        });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(EnvValidationError);
      expect(thrown?.message).toBe(
        'Environment variable validation failed for "DATABASE_PASSWORD":'
        + ' Value is not a valid number. Got: a string of length 21',
      );
      expect(thrown?.message).not.toContain(secret);
    });

    /**
     * @source docs:api/envs.md#rejected-values-are-never-echoed
     */
    it('should expose the same description through error.value', () => {
      // From docs: the description table
      expect(new EnvValidationError('V', undefined, 'r').value).toBe('not set');
      expect(new EnvValidationError('V', '', 'r').value).toBe('an empty string');
      expect(new EnvValidationError('V', 'hunter2', 'r').value).toBe('a string of length 7');
      expect(new EnvValidationError('V', 42, 'r').value).toBe('a number');
      expect(new EnvValidationError('V', true, 'r').value).toBe('a boolean');
      expect(new EnvValidationError('V', ['a', 'b'], 'r').value).toBe('an array of length 2');
      expect(new EnvValidationError('V', { key: 'v' }, 'r').value).toBe('an object');
    });
  });

  describe('Pre-init Config Access (docs/api/envs.md)', () => {
    afterEach(() => {
      clearGetConfigCache();
    });

    /**
     * @source docs:api/envs.md#pre-init-config-access
     */
    it('should access config synchronously before app bootstrap', () => {
      // From docs: Pre-init Config Access
      // Use getConfig() to access environment values before OneBunApplication is created
      const envSchema: EnvSchema<{
        server: { port: number; host: string };
        nats: { url: string };
      }> = {
        server: {
          port: Env.number({ default: 3000, env: 'PREINIT_PORT' }),
          host: Env.string({ default: '0.0.0.0', env: 'PREINIT_HOST' }),
        },
        nats: {
          url: Env.string({ default: 'nats://localhost:4222', env: 'PREINIT_NATS_URL' }),
        },
      };

      // Synchronous — no await needed
      const config = getConfig(envSchema, { loadDotEnv: false });

      // Same .get() API as this.config in services
      const port = config.get('server.port');
      const natsUrl = config.get('nats.url');

      expect(port).toBe(3000);
      expect(natsUrl).toBe('nats://localhost:4222');
      expect(config.isInitialized).toBe(true);

      // Can be used to configure ApplicationOptions. Note that `adapter` takes the adapter
      // CLASS, not an instance — the framework constructs it with `options` during start() —
      // and JetStream requires at least one `streams` entry or its constructor throws.
      // Passing `adapter` is by itself enough to enable the queue; no @Subscribe is needed.
      // const app = new OneBunApplication(AppModule, {
      //   envSchema,
      //   cors: { origin: config.get('server.host') },
      //   queue: {
      //     adapter: JetStreamQueueAdapter,
      //     options: {
      //       servers: config.get('nats.url'),
      //       streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
      //     },
      //   },
      // });
    });
  });
});
