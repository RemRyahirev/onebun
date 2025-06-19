# @onebun/envs

Simple and elegant environment variables management for OneBun framework with full TypeScript typing and automatic sensitive data masking.

## Core Philosophy

1. **One place** - define schema and settings in single file
2. **Export object** - import ready-to-use config object anywhere  
3. **Sync get()** - single method with full/partial path support
4. **Auto types** - TypeScript automatically infers all types
5. **Transparent sanitization** - sensitive data masked automatically

## Features

- ✅ **Zero boilerplate** - minimal API with maximum power
- ✅ **Full type safety** - automatic type inference for all paths
- ✅ **Transparent security** - automatic masking of sensitive data
- ✅ **Nested object support** - full dot-notation access to deep values
- ✅ **Lazy initialization** - load once, use everywhere
- ✅ **Built-in validation** - comprehensive validators included
- ✅ **Effect.js integration** - native functional programming support

## Installation

```bash
bun add @onebun/envs
```

## Quick Start

### 1. Define Configuration Schema (`config.ts`)

```typescript
import { Env, EnvSchema, TypedEnv } from '@onebun/envs';

// Define your configuration interface
interface AppConfig {
  server: {
    port: number;
    host: string;
    ssl: {
      enabled: boolean;
      cert: string;
    };
  };
  database: {
    url: string;
    password: string;
  };
  auth: {
    jwtSecret: string;
    apiKeys: string[];
  };
}

// Define schema with validation and defaults
const schema: EnvSchema<AppConfig> = {
  server: {
    port: Env.number({ env: 'PORT', default: 3000 }),
    host: Env.string({ env: 'HOST', default: '0.0.0.0' }),
    ssl: {
      enabled: Env.boolean({ env: 'SSL_ENABLED', default: false }),
      cert: Env.string({ env: 'SSL_CERT', default: '/ssl/cert.pem', sensitive: true })
    }
  },
  database: {
    url: Env.string({ env: 'DATABASE_URL', required: true, sensitive: true }),
    password: Env.string({ env: 'DB_PASSWORD', required: true, sensitive: true })
  },
  auth: {
    jwtSecret: Env.string({ env: 'JWT_SECRET', required: true, sensitive: true }),
    apiKeys: Env.array({ env: 'API_KEYS', default: [], sensitive: true })
  }
};

// Create typed configuration - everything in one line!
export const config = TypedEnv.create(schema, {
  envFilePath: '.env',
  loadDotEnv: true,
  envOverridesDotEnv: true
});
```

### 2. Use Anywhere

```typescript
import { config } from './config';

@Service()
export class MyService extends BaseService {
  async initialize() {
    // Initialize once
    await config.initialize();
    
    // Now use synchronously everywhere
    this.startServer();
  }

  private startServer() {
    // Full paths with autocomplete and type checking
    const port = config.get('server.port');           // → number
    const host = config.get('server.host');           // → string
    const sslEnabled = config.get('server.ssl.enabled'); // → boolean
    
    // Partial paths - get nested objects
    const serverConfig = config.get('server');        // → entire server section
    const sslConfig = config.get('server.ssl');       // → ssl section
    
    // Sensitive data automatically wrapped and masked
    const dbUrl = config.get('database.url');         // → SensitiveValue<string>
    const jwtSecret = config.get('auth.jwtSecret');   // → SensitiveValue<string>
    
    console.log(`Starting on ${host}:${port}`);
    console.log(`DB URL: ${dbUrl}`);                   // Prints: "***"
    console.log(`JWT Secret: ${jwtSecret}`);           // Prints: "***"
    
    // Access real value when needed
    const realDbUrl = dbUrl.value;                     // → actual string value
    
    // Get entire config or safe version for logging
    const allConfig = config.values;                   // → AppConfig
    const safeConfig = config.getSafeConfig();        // → AppConfig with "***" for sensitive
  }
}
```

## Configuration Options

### Environment Variable Configuration

Each environment variable can be configured with:

```typescript
{
  env?: string;           // Custom environment variable name
  description?: string;   // Variable description
  default?: T;           // Default value
  required?: boolean;    // Required field (throws if missing)
  sensitive?: boolean;   // Mask in logs
  separator?: string;    // Array separator (default: ',')
  validate?: Function;   // Custom validation function
}
```

### Load Options

```typescript
{
  envFilePath?: string;           // Path to .env file (default: '.env')
  loadDotEnv?: boolean;          // Load .env file (default: true)  
  envOverridesDotEnv?: boolean;  // process.env has priority (default: true)
  strict?: boolean;              // Only load defined variables (default: false)
  defaultArraySeparator?: string; // Default array separator (default: ',')
}
```

## Built-in Validators

### String Validators

```typescript
Env.string({
  validate: Env.regex(/^[a-zA-Z]+$/, 'Must contain only letters')
});

Env.string({
  validate: Env.oneOf(['small', 'medium', 'large'])
});

Env.string({
  validate: Env.url('Must be a valid URL')
});

Env.string({
  validate: Env.email('Must be a valid email')
});
```

### Number Validators

```typescript
Env.number({
  min: 1,
  max: 100,
  validate: Env.port() // Validates port range 1-65535
});
```

### Array Validators

```typescript
Env.array({
  separator: ',',
  minLength: 1,
  maxLength: 10
});
```

### Custom Validators

```typescript
import { Effect, EnvValidationError } from '@onebun/envs';

Env.string({
  validate: (value: string) => {
    if (value.startsWith('temp_')) {
      return Effect.fail(new EnvValidationError('', value, 'Temporary values not allowed'));
    }
    return Effect.succeed(value);
  }
});
```

## API Reference

### `createEnvConfig<T>(schema, options?, instanceKey?)`

Creates or returns existing environment configuration singleton.

- `schema`: Environment variables schema
- `options`: Load options (optional)
- `instanceKey`: Unique instance identifier (default: 'default')

### `SimpleEnvManager<T>`

#### Async Methods (for initial load)

- `getValues(): Promise<T>` - Get all configuration values
- `get(path: string): Promise<any>` - Get value by path
- `getTyped<K>(path: string): Promise<K>` - Get typed value by path
- `getSafeValues(): Promise<T>` - Get safe values (sensitive masked)
- `reload(): Promise<void>` - Reload from sources

#### Sync Methods (after initialization)

- `values: T` - All configuration values (sync)
- `getSync(path: string): any` - Get value by path (sync)
- `getSafeValuesSync(): T` - Get safe values (sync)

## Error Handling

```typescript
import { EnvValidationError, EnvLoadError } from '@onebun/envs';

try {
  const config = await appConfig.getValues();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error('Validation failed:', error.variable, error.reason);
  } else if (error instanceof EnvLoadError) {
    console.error('Load failed:', error.variable, error.reason);
  }
}
```

## Environment File Example

Create a `.env` file in your project root:

```env
# Server configuration
PORT=3000
HOST=localhost
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
DB_MAX_CONNECTIONS=50

# Security
JWT_SECRET=your-super-secret-jwt-key-must-be-32-chars
API_KEYS=key1,key2,key3

# Logging
ENABLE_LOGGING=true
LOG_LEVEL=info
```

## Best Practices

1. **Define schema once** - Use singleton pattern for application-wide config
2. **Mark sensitive data** - Use `sensitive: true` for passwords, secrets, API keys
3. **Use validation** - Validate critical configuration early
4. **Provide defaults** - Always provide sensible defaults for non-critical settings
5. **Document variables** - Use `description` field for team documentation
6. **Use custom env names** - Use `env` field when config key differs from env var name

## Key Features

### ✅ **Automatic Type Inference**
TypeScript automatically infers correct types for all paths:

```typescript
config.get('server.port')          // → number
config.get('server.ssl.enabled')   // → boolean  
config.get('database.url')         // → SensitiveValue<string>
config.get('server')               // → { port: number, host: string, ssl: {...} }
```

### ✅ **Transparent Sensitive Data Masking**
```typescript
const secret = config.get('auth.jwtSecret');
console.log(secret);           // Prints: "***"
console.log(secret.toString()); // Prints: "***"
console.log(secret.value);     // Returns actual value
```

### ✅ **Single Method API**
One universal method for all cases:
- Full paths: `'server.ssl.enabled'`
- Partial paths: `'server'`, `'server.ssl'`
- Root fields: `'database'`

### ✅ **Simple Initialization**
```typescript
// Create (lazy loading)
const config = TypedEnv.create(schema);

// Explicit initialization in service
await config.initialize();

// Check status
if (config.isInitialized) {
  // Can use synchronously
}
```

## Environment Variables Example

```env
# Server Configuration
PORT=8080
HOST=127.0.0.1

# SSL Configuration  
SSL_ENABLED=true
SSL_CERT=/opt/ssl/server.crt

# Database Configuration
DATABASE_URL=postgresql://user:pass@localhost:5432/myapp
DB_PASSWORD=secret123

# Authentication
JWT_SECRET=super_secret_jwt_key_at_least_32_chars_long
API_KEYS=key1,key2,key3
```

## Comparison

### ❌ Before (complex):
```typescript
const port = parseInt(process.env.PORT || '3000');
const dbUrl = process.env.DATABASE_URL; // No types!
const ssl = process.env.SSL_ENABLED === 'true'; // Manual parsing
// + validation, defaults, masking - all manual
```

### ✅ Now (simple):
```typescript
const port = config.get('server.port');     // number (automatic)
const dbUrl = config.get('database.url');   // SensitiveValue<string> (secure)  
const ssl = config.get('server.ssl.enabled'); // boolean (automatic)
// Validation, defaults, masking - included out of the box
```

**The simplest and most powerful configuration solution!** 🚀 