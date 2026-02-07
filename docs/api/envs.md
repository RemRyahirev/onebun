---
description: Type-safe environment configuration. Env.string(), Env.number(), Env.boolean(). Validation, defaults, sensitive data handling.
---

# Environment Configuration API

Package: `@onebun/envs`

## Overview

OneBun provides type-safe environment configuration with validation, default values, and sensitive data handling.

## Env Helper

### Type Definitions

```typescript
// String variable
Env.string(options?: StringEnvOptions)

// Number variable
Env.number(options?: NumberEnvOptions)

// Boolean variable
Env.boolean(options?: BooleanEnvOptions)

// Array variable
Env.array(options?: ArrayEnvOptions)
```

### Options Interface

```typescript
interface EnvVariableConfig {
  /** Environment variable name (defaults to uppercase path) */
  env?: string;

  /** Type of the variable */
  type: 'string' | 'number' | 'boolean' | 'array';

  /** Default value if not set */
  default?: unknown;

  /** Whether the variable is required (default: true if no default) */
  required?: boolean;

  /** Mark as sensitive (will be masked in logs) */
  sensitive?: boolean;

  /** Validation function */
  validate?: (value: unknown) => boolean;

  /** Transform function */
  transform?: (value: unknown) => unknown;

  /** Description for documentation */
  description?: string;
}
```

## Defining Schema

```typescript
// src/config.ts
import { Env, type InferConfigType } from '@onebun/core';

// Define schema using Env helpers
export const envSchema = {
  // Nested structure becomes dotted paths
  server: {
    port: Env.number({ default: 3000, env: 'PORT' }),
    host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
  },

  database: {
    url: Env.string({
      env: 'DATABASE_URL',
      required: true,
      sensitive: true,  // Masked in logs
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

// Infer config type automatically from schema
export type AppConfig = InferConfigType<typeof envSchema>;
// Result: { server: { port: number; host: string }; database: { url: string; ... }; ... }

// Module augmentation for global type inference
declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}
```

## Type Inference and Module Augmentation

OneBun provides automatic type inference for configuration access using TypeScript's module augmentation feature.

### InferConfigType

The `InferConfigType` utility automatically extracts value types from your schema:

```typescript
import { Env, type InferConfigType } from '@onebun/core';

const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
    host: Env.string({ default: '0.0.0.0' }),
  },
  database: {
    url: Env.string({ required: true }),
  },
};

type Config = InferConfigType<typeof envSchema>;
// Result: { server: { port: number; host: string }; database: { url: string } }
```

### Module Augmentation

To enable typed config access throughout your application (in controllers, services, etc.), use TypeScript's module augmentation:

```typescript
// config.ts
import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000 }),
  },
};

export type AppConfig = InferConfigType<typeof envSchema>;

// This enables typed access to this.config.get() everywhere
declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}
```

After this setup, `this.config.get('server.port')` in any controller or service will return `number` (not `unknown`).

### Without Module Augmentation

If you don't use module augmentation, you can still access config but need type assertions:

```typescript
// Works but requires manual typing
const port = this.config.get('server.port') as number;
```

## Loading Configuration

### In Application

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  envSchema,
  envOptions: {
    // Path to .env file (relative to cwd or absolute)
    envFilePath: '.env',

    // Load .env file (default: true)
    loadDotEnv: true,

    // Process.env overrides .env file (default: true)
    envOverridesDotEnv: true,

    // Throw on missing required variables (default: false)
    strict: true,

    // Default separator for arrays (default: ',')
    defaultArraySeparator: ',',

    // Override specific values using env variable names (takes precedence)
    // Note: Use actual env variable names, not dot-notation paths
    valueOverrides: {
      PORT: 4000,        // Overrides server.port (env: 'PORT')
      DEBUG: true,       // Overrides app.debug (env: 'DEBUG')
    },
  },
});
```

### Standalone Usage

```typescript
import { TypedEnv } from '@onebun/envs';

const config = TypedEnv.create(envSchema, {
  envFilePath: '.env',
  loadDotEnv: true,
});

// Must initialize before use
await config.initialize();

// Now safe to access
const port = config.get('server.port');
```

## Accessing Configuration

With module augmentation in place, config access is fully typed - no `as any` needed!

### In Controllers

```typescript
@Controller('/info')
export class InfoController extends BaseController {
  @Get('/')
  async getInfo(): Promise<Response> {
    // Fully typed access - no casting needed
    const serverPort = this.config.get('server.port');  // number
    const appName = this.config.get('app.name');        // string
    const debug = this.config.get('app.debug');          // boolean

    return this.success({
      appName,
      serverPort,
      debug,
    });
  }
}
```

### In Services

```typescript
@Service()
export class DatabaseService extends BaseService {
  async connect(): Promise<void> {
    // Fully typed access
    const url = this.config.get('database.url');              // string (sensitive)
    const maxConnections = this.config.get('database.maxConnections'); // number
    const ssl = this.config.get('database.ssl');               // boolean

    this.logger.info('Connecting to database', { maxConnections, ssl });

    // url.value for sensitive values
    await this.client.connect(url.value);
  }
}
```

### From Application

With module augmentation, both `getConfig()` and `getConfigValue()` provide full type inference:

```typescript
// In config.ts - define module augmentation for type safety
declare module '@onebun/core' {
  interface OneBunAppConfig {
    server: { port: number; host: string };
    database: { url: string; maxConnections: number };
  }
}

// In index.ts
const app = new OneBunApplication(AppModule, { envSchema });
await app.start();

// Get config service - returns IConfig<OneBunAppConfig>
const config = app.getConfig();

// Typed access with autocomplete - no manual type annotation needed!
const port = config.get('server.port');          // number (auto-inferred)
const host = config.get('server.host');          // string (auto-inferred)
const dbUrl = config.get('database.url');        // string (auto-inferred)

// Convenience method - also fully typed
const maxConns = app.getConfigValue('database.maxConnections'); // number (auto-inferred)

// Get all values - typed as OneBunAppConfig
const values = config.values;

// Get safe config (sensitive values masked) - typed as OneBunAppConfig
const safeConfig = config.getSafeConfig();
console.log(safeConfig);
// { server: { port: 3000, host: 'localhost' }, database: { url: '***', ... } }
```

## Sensitive Values

Values marked as `sensitive: true` are automatically wrapped:

```typescript
const envSchema = {
  database: {
    password: Env.string({ sensitive: true }),
  },
};

// Access the value (fully typed with module augmentation)
const password = this.config.get('database.password');

// password.toString() returns '***'
// password.value returns actual value

// Safe for logging
this.logger.info('Config', { password }); // Logs '***'

// Get actual value
const actualPassword = password.value;
```

## Environment Variable Naming

By default, nested paths are converted to uppercase with underscores:

| Schema Path | Environment Variable |
|-------------|---------------------|
| `server.port` | `SERVER_PORT` |
| `database.url` | `DATABASE_URL` |
| `redis.host` | `REDIS_HOST` |

Override with `env` option:

```typescript
const envSchema = {
  server: {
    port: Env.number({
      env: 'PORT',  // Uses PORT instead of SERVER_PORT
    }),
  },
};
```

## Array Variables

```typescript
const envSchema = {
  allowedHosts: Env.array({
    default: ['localhost'],
    env: 'ALLOWED_HOSTS',
    separator: ',',  // Custom separator
  }),
};

// .env
// ALLOWED_HOSTS=example.com,api.example.com,localhost

// Result
config.get('allowedHosts');
// ['example.com', 'api.example.com', 'localhost']
```

## Startup Validation

Environment variables are validated **at application startup** during the `TypedEnv.create()` / `initialize()` phase. If any validation fails, the application throws an `EnvValidationError` and does not start.

### When Validation Runs

1. `OneBunApplication` constructor calls `TypedEnv.create(envSchema, options)` 
2. `TypedEnv.create()` iterates over the schema and parses each variable
3. For each variable: load value → parse type → run custom validation → apply transform
4. If any step fails, an `EnvValidationError` is thrown immediately

### Validation Failures

**Missing required variable** (no default, `required: true` or implicit):

```typescript
const envSchema = {
  database: {
    url: Env.string({ env: 'DATABASE_URL', required: true }),
  },
};

// If DATABASE_URL is not set in environment or .env file:
// Throws: EnvValidationError: Environment variable validation failed for "DATABASE_URL":
//         Required variable is not set. Got: undefined
```

**Custom validation function failure:**

```typescript
import { Effect } from 'effect';
import { EnvValidationError } from '@onebun/envs';

const envSchema = {
  server: {
    port: Env.number({
      default: 3000,
      // validate returns Effect.Effect<T, EnvValidationError>
      validate: (value) =>
        value > 0 && value < 65536
          ? Effect.succeed(value)
          : Effect.fail(new EnvValidationError('', value, 'Port must be between 1 and 65535')),
    }),
  },
};

// If PORT=99999:
// Throws: EnvValidationError: Environment variable validation failed for "SERVER_PORT":
//         Port must be between 1 and 65535. Got: 99999
```

::: tip
For common range validation, use `min`/`max` options instead of a custom `validate` function:
```typescript
Env.number({ default: 3000, min: 1, max: 65535 })
```
Or use built-in validators like `Env.port()`:
```typescript
Env.number({ default: 3000, validate: Env.port() })
```
:::

### Catching Startup Errors

```typescript
import { OneBunApplication, EnvValidationError } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

try {
  const app = new OneBunApplication(AppModule, {
    envSchema,
    envOptions: {
      strict: true,  // Throw on any missing required variable
    },
  });

  await app.start();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(`Configuration error: ${error.message}`);
    console.error(`Variable: ${error.variable}`);
    console.error(`Value: ${error.value}`);
    process.exit(1);
  }
  throw error;
}
```

### Strict Mode

By default, all environment variables (including ones not in the schema) are loaded from `process.env`. Enable `strict: true` to only load variables explicitly defined in the schema:

```typescript
const app = new OneBunApplication(AppModule, {
  envSchema,
  envOptions: {
    strict: true,  // Only load variables defined in envSchema
  },
});
```

To make individual variables required (throw if missing), set `required: true` on each variable:

```typescript
const envSchema = {
  database: {
    url: Env.string({ env: 'DATABASE_URL', required: true }),
  },
};
```

<llm-only>

**Technical details for AI agents:**
- `EnvParser.parse()` returns `Effect.Effect<T, EnvValidationError>` — parsing is Effect-based internally
- `TypedEnv.parseNestedSchema()` runs `Effect.runSync()` on each variable — errors are thrown synchronously
- `EnvValidationError` has properties: `variable` (env var name), `value` (raw value), `reason` (description)
- Error message format: `Environment variable validation failed for "${variable}": ${reason}. Got: ${formatValue(value)}`
- Variables without `env` option get auto-generated names: `server.port` → `SERVER_PORT`
- `required` must be explicitly set to `true` — if not set and no `default` is provided, a type-default is used (empty string, 0, false, [])
- Parsing order: resolve value → parse by type → validate (validate function must return `Effect.Effect<T, EnvValidationError>`)
- `strict` option in `EnvLoadOptions` means "only load variables defined in schema" (default: false), NOT "make all variables required"
- `validate` function signature: `(value: T) => Effect.Effect<T, EnvValidationError>` — use `Effect.succeed(value)` for valid, `Effect.fail(new EnvValidationError(...))` for invalid

</llm-only>

## Validation

### Built-in Validation

```typescript
const envSchema = {
  server: {
    port: Env.number({
      default: 3000,
      validate: (value) => value > 0 && value < 65536,
    }),
  },
  app: {
    logLevel: Env.string({
      default: 'info',
      validate: (value) =>
        ['trace', 'debug', 'info', 'warn', 'error'].includes(value as string),
    }),
  },
};
```

### Validation Error

```typescript
import { EnvValidationError } from '@onebun/core';

try {
  await config.initialize();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(`Invalid value for ${error.variableName}: ${error.message}`);
  }
}
```

## Transform

Transform values after parsing:

```typescript
const envSchema = {
  server: {
    timeout: Env.number({
      env: 'TIMEOUT_SECONDS',
      default: 30,
      transform: (value) => (value as number) * 1000,  // Convert to ms
    }),
  },
  features: {
    flags: Env.string({
      env: 'FEATURE_FLAGS',
      transform: (value) => (value as string).split(',').map(f => f.trim()),
    }),
  },
};
```

## .env File Format

```bash
# .env file
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
DB_MAX_CONNECTIONS=20
DB_SSL=true

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret123

# Features
ALLOWED_ORIGINS=http://localhost:3000,https://example.com

# App
APP_NAME=my-awesome-app
DEBUG=false
```

## Multi-Service Configuration

Override environment variables per service:

```typescript
const multiApp = new MultiServiceApplication({
  services: {
    users: {
      module: UsersModule,
      port: 3001,
      envOverrides: {
        // Use different database
        'database.url': { fromEnv: 'USERS_DATABASE_URL' },
        // Set specific value
        'app.name': { value: 'users-service' },
      },
    },
    orders: {
      module: OrdersModule,
      port: 3002,
      envOverrides: {
        'database.url': { fromEnv: 'ORDERS_DATABASE_URL' },
        'app.name': { value: 'orders-service' },
      },
    },
  },
  envSchema,
});
```

## Complete Example

```typescript
// config.ts
import { Env, type InferConfigType } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({
      default: 3000,
      env: 'PORT',
      validate: (v) => (v as number) > 0 && (v as number) < 65536,
    }),
    host: Env.string({ default: '0.0.0.0' }),
  },

  database: {
    url: Env.string({
      env: 'DATABASE_URL',
      required: true,
      sensitive: true,
    }),
    poolSize: Env.number({ default: 10 }),
    ssl: Env.boolean({ default: process.env.NODE_ENV === 'production' }),
  },

  auth: {
    jwtSecret: Env.string({
      env: 'JWT_SECRET',
      required: true,
      sensitive: true,
    }),
    jwtExpiresIn: Env.string({ default: '7d' }),
    bcryptRounds: Env.number({ default: 10 }),
  },

  cache: {
    enabled: Env.boolean({ default: true }),
    ttl: Env.number({ default: 300 }),  // 5 minutes
    redis: {
      host: Env.string({ default: 'localhost' }),
      port: Env.number({ default: 6379 }),
    },
  },

  cors: {
    origins: Env.array({
      default: ['http://localhost:3000'],
      env: 'CORS_ORIGINS',
    }),
    credentials: Env.boolean({ default: true }),
  },

  logging: {
    level: Env.string({
      default: 'info',
      validate: (v) => ['trace', 'debug', 'info', 'warn', 'error'].includes(v as string),
    }),
    format: Env.string({
      default: 'json',
      validate: (v) => ['json', 'pretty'].includes(v as string),
    }),
  },
};

// Automatic type inference
export type AppConfig = InferConfigType<typeof envSchema>;

// Module augmentation for global typed config access
declare module '@onebun/core' {
  interface OneBunAppConfig extends AppConfig {}
}

// index.ts
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { envSchema } from './config';

const app = new OneBunApplication(AppModule, {
  envSchema,
  envOptions: {
    envFilePath: '.env',
    strict: process.env.NODE_ENV === 'production',
  },
});

app.start().then(() => {
  const logger = app.getLogger();
  const config = app.getConfig();

  logger.info('Application started', {
    port: config.get('server.port'),
    config: config.getSafeConfig(),  // Sensitive values masked
  });
});
```
