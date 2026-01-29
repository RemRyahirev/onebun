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
import { Env } from '@onebun/core';

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

export type AppConfig = typeof envSchema;
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

    // Override specific values (takes precedence)
    valueOverrides: {
      'server.port': 4000,
      'app.debug': true,
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

### In Controllers

```typescript
@Controller('/info')
export class InfoController extends BaseController {
  @Get('/')
  async getInfo(): Promise<Response> {
    const config = this.config as any;

    const serverPort = config.get('server.port');
    const appName = config.get('app.name');
    const debug = config.get('app.debug');

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
    const config = this.config as any;

    const url = config.get('database.url');
    const maxConnections = config.get('database.maxConnections');
    const ssl = config.get('database.ssl');

    this.logger.info('Connecting to database', { maxConnections, ssl });

    // url.value for sensitive values
    await this.client.connect(url.value);
  }
}
```

### From Application

```typescript
const app = new OneBunApplication(AppModule, { envSchema });
await app.start();

// Get config service
const config = app.getConfig();

// Get specific value
const port = app.getConfigValue<number>('server.port');

// Get all values
const values = config.values;

// Get safe config (sensitive values masked)
const safeConfig = config.getSafeConfig();
console.log(safeConfig);
// { server: { port: 3000 }, database: { url: '***', ... } }
```

## Sensitive Values

Values marked as `sensitive: true` are automatically wrapped:

```typescript
const envSchema = {
  database: {
    password: Env.string({ sensitive: true }),
  },
};

// Access the value
const config = this.config as any;
const password = config.get('database.password');

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
import { Env } from '@onebun/core';

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

export type Config = typeof envSchema;

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
