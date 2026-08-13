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
    afterEach(() => {
      clearGetConfigCache();
    });

    // The exact schema the page shows under "Built-in Validation". A fresh object per call:
    // getConfig caches by schema reference.
    const builtInSchema = (): EnvSchema<{ server: { port: number }; app: { logLevel: string } }> => ({
      server: {
        port: Env.number({ default: 3000, min: 1, max: 65535 }),
      },
      app: {
        logLevel: Env.string({
          env: 'LOG_LEVEL',
          default: 'info',
          validate: Env.oneOf(['trace', 'debug', 'info', 'warn', 'error']),
        }),
      },
    });

    it('should validate with custom function', async () => {
      // From docs: Built-in Validation example
      // Using flat schema with explicit env names to avoid conflicts
      const schema = {
        serverPort: Env.number({
          env: 'VALIDATION_TEST_PORT', // Explicit unique env name
          default: 3000,
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

    /**
     * @source docs:api/envs.md#built-in-validation
     */
    it('should accept a port inside min/max and a level inside the allowed list', () => {
      const config = getConfig(builtInSchema(), {
        loadDotEnv: false,
        valueOverrides: { SERVER_PORT: 8080, LOG_LEVEL: 'debug' },
      });

      expect(config.get('server.port')).toBe(8080);
      expect(config.get('app.logLevel')).toBe('debug');
    });

    /**
     * @source docs:api/envs.md#built-in-validation
     */
    it('should reject a port above max and a level outside the list', () => {
      expect(() =>
        getConfig(builtInSchema(), {
          loadDotEnv: false,
          valueOverrides: { SERVER_PORT: 99999, LOG_LEVEL: 'info' },
        }),
      ).toThrow('Value must be <= 65535');

      expect(() =>
        getConfig(builtInSchema(), {
          loadDotEnv: false,
          valueOverrides: { SERVER_PORT: 8080, LOG_LEVEL: 'nope' },
        }),
      ).toThrow('Value must be one of: trace, debug, info, warn, error');
    });

    /**
     * From the tip under "Custom validation function failure": the built-in validators do not
     * know the variable they were attached to, so they report it without a name. Pinned because
     * the page states the message verbatim — fixing the validators must update the page too.
     *
     * @source docs:api/envs.md#validation-failures
     */
    it('should report a built-in validator failure without the variable name', () => {
      expect(() =>
        getConfig(builtInSchema(), {
          loadDotEnv: false,
          valueOverrides: { SERVER_PORT: 99999, LOG_LEVEL: 'info' },
        }),
      ).toThrow('Environment variable validation failed for "": Value must be <= 65535. Got: a number');
    });

    /**
     * From "Custom validation function failure": the name is the validator's to pass, and a
     * hand-built error carrying it reproduces the message the page prints.
     *
     * @source docs:api/envs.md#validation-failures
     */
    it('should name the variable when the custom validator passes it', () => {
      const schema: EnvSchema<{ server: { port: number } }> = {
        server: {
          port: Env.number({
            default: 3000,
            // validate returns Effect.Effect<T, EnvValidationError>
            validate: (value) =>
              value > 0 && value < 65536
                ? Effect.succeed(value)
                : Effect.fail(
                  new EnvValidationError('SERVER_PORT', value, 'Port must be between 1 and 65535'),
                ),
          }),
        },
      };

      expect(() =>
        getConfig(schema, { loadDotEnv: false, valueOverrides: { SERVER_PORT: 99999 } }),
      ).toThrow(
        'Environment variable validation failed for "SERVER_PORT":'
        + ' Port must be between 1 and 65535. Got: a number',
      );
    });

    /**
     * From "Built-in Validation": a boolean predicate is not a validator. It fails at build time,
     * and — if the type error is cast away — at runtime for EVERY variable it is attached to,
     * including the ones that only ever take their default.
     *
     * @source docs:api/envs.md#built-in-validation
     */
    it('should fail even the default when validate returns a boolean instead of an Effect', () => {
      const schema: EnvSchema<{ server: { port: number } }> = {
        server: {
          port: Env.number({
            default: 3000,
            validate: ((value: number) => value > 0 && value < 65536) as never,
          }),
        },
      };

      expect(() => getConfig(schema, { loadDotEnv: false })).toThrow('Not a valid effect: true');
    });

    /**
     * @source docs:api/envs.md#validation-error
     */
    it('should expose the rejected variable as error.variable, not error.variableName', () => {
      const schema: EnvSchema<{ database: { url: string } }> = {
        database: { url: Env.string({ env: 'DOCS_XREF_REQUIRED_URL', required: true }) },
      };

      let thrown: (EnvValidationError & { variableName?: string }) | undefined;
      try {
        getConfig(schema, { loadDotEnv: false });
      } catch (error) {
        thrown = error as EnvValidationError & { variableName?: string };
      }

      expect(thrown).toBeInstanceOf(EnvValidationError);
      expect(thrown?.variable).toBe('DOCS_XREF_REQUIRED_URL');
      expect(thrown?.variableName).toBeUndefined();
    });
  });

  describe('Deriving values (docs/api/envs.md)', () => {
    afterEach(() => {
      clearGetConfigCache();
    });

    /**
     * @source docs:api/envs.md#deriving-values
     */
    it('should split and trim an array variable', () => {
      const envSchema: EnvSchema<{ features: { flags: string[] } }> = {
        features: { flags: Env.array({ env: 'DOCS_FEATURE_FLAGS', separator: ',' }) },
      };

      const config = getConfig(envSchema, {
        loadDotEnv: false,
        valueOverrides: { DOCS_FEATURE_FLAGS: 'a, b ,c' },
      });

      expect(config.get('features.flags')).toEqual(['a', 'b', 'c']);
    });

    /**
     * @source docs:api/envs.md#deriving-values
     */
    it('should derive a unit at the call site rather than in the schema', () => {
      const envSchema: EnvSchema<{ server: { timeoutSeconds: number } }> = {
        server: { timeoutSeconds: Env.number({ env: 'DOCS_TIMEOUT_SECONDS', default: 30 }) },
      };

      const config = getConfig(envSchema, { loadDotEnv: false });

      expect(config.get('server.timeoutSeconds')).toBe(30);
      expect(config.get('server.timeoutSeconds') * 1000).toBe(30_000);
    });

    /**
     * @source docs:api/envs.md#deriving-values
     */
    it('should never run a transform option — there is no such hook', () => {
      // TypeScript rejects `transform` outright; this is the JS caller (or the cast) the page
      // warns about: the key survives on the config object and nothing ever reads it.
      const withTransform = {
        ...Env.string({ env: 'DOCS_TRANSFORM_FLAGS' }),
        transform: (value: string) => value.split(','),
      };
      const envSchema: EnvSchema<{ features: { flags: string } }> = {
        features: { flags: withTransform },
      };

      const config = getConfig(envSchema, {
        loadDotEnv: false,
        valueOverrides: { DOCS_TRANSFORM_FLAGS: 'a,b' },
      });

      expect(config.get('features.flags')).toBe('a,b');
    });
  });

  describe('Standalone Usage (docs/api/envs.md)', () => {
    beforeEach(() => {
      TypedEnv.clear();
    });

    afterEach(() => {
      TypedEnv.clear();
    });

    const schemaA = (): EnvSchema<{ server: { port: number } }> => ({
      server: { port: Env.number({ default: 3000, env: 'DOCS_STANDALONE_PORT' }) },
    });
    const schemaB = (): EnvSchema<{ database: { host: string } }> => ({
      database: { host: Env.string({ default: 'db.example.com', env: 'DOCS_STANDALONE_HOST' }) },
    });

    /**
     * From the warning under "Standalone Usage": `TypedEnv.create` is keyed, not per-schema. A
     * second call on the same key returns the first instance and discards schema AND options.
     *
     * @source docs:api/envs.md#standalone-usage
     */
    it('should return the cached instance for a key and ignore the new schema', async () => {
      const first = TypedEnv.create(schemaA(), { loadDotEnv: false });
      await first.initialize();

      const second = TypedEnv.create(schemaB(), { loadDotEnv: false });
      await second.initialize();

      expect(second as unknown).toBe(first as unknown);
      expect(second.values as unknown).toEqual({ server: { port: 3000 } });
      expect(second.get('database.host')).toBeUndefined();
    });

    /**
     * @source docs:api/envs.md#standalone-usage
     */
    it('should isolate a standalone instance when a distinct key is passed', async () => {
      const shared = TypedEnv.create(schemaA(), { loadDotEnv: false });
      await shared.initialize();

      const standalone = TypedEnv.create(schemaB(), { loadDotEnv: false }, 'standalone');
      await standalone.initialize();

      expect(standalone as unknown).not.toBe(shared as unknown);
      expect(standalone.get('database.host')).toBe('db.example.com');
    });

    /**
     * From "`strict` does nothing": the option is accepted by the types and read by nothing.
     *
     * @source docs:api/envs.md#strict-does-nothing
     */
    it('should behave identically with strict on and off', async () => {
      const schema = (): EnvSchema<{ database: { url: string } }> => ({
        database: { url: Env.string({ env: 'DOCS_STRICT_PROBE_URL' }) },
      });

      const strictOn = TypedEnv.create(schema(), { loadDotEnv: false, strict: true }, 'strict-on');
      await strictOn.initialize();
      const strictOff = TypedEnv.create(schema(), { loadDotEnv: false, strict: false }, 'strict-off');
      await strictOff.initialize();

      // Not "make everything required": an unset variable with no `required` flag still parses
      // to the type's zero value under strict: true.
      expect(strictOn.values).toEqual({ database: { url: '' } });
      expect(strictOn.values).toEqual(strictOff.values);
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
