# @onebun/envs

Environment variables management package for OneBun framework with strict TypeScript support, validation, and Effect integration.

## Features

- 🔒 **Type-safe**: Full TypeScript support with type inference
- 🛡️ **Validation**: Built-in validators and custom validation support
- 📊 **Effect Integration**: Uses Effect library for error handling
- 🔧 **Environment Loading**: Support for `.env` files and environment variables
- 🎭 **Sensitive Data**: Automatic masking of sensitive values in logs
- 🏗️ **Nested Configuration**: Support for nested configuration objects
- 📝 **Validation Helpers**: Pre-built validators for common use cases

## Installation

```bash
bun add @onebun/envs
```

## Quick Start

```typescript
import { TypedEnv, Env } from '@onebun/envs';

// Define your configuration schema
const schema = {
  app: {
    port: Env.number({ default: 3000, validate: Env.port() }),
    host: Env.string({ default: 'localhost' }),
    env: Env.string({ 
      default: 'development',
      validate: Env.oneOf(['development', 'production', 'test'])
    })
  },
  database: {
    url: Env.string({ 
      required: true, 
      validate: Env.url() 
    }),
    password: Env.string({ 
      sensitive: true, 
      required: true 
    })
  }
};

// Create typed configuration
const config = await TypedEnv.createAsync(schema);

// Access values with full type safety
const port = config.get('app.port'); // number
const dbUrl = config.get('database.url'); // string

// Get safe config for logging (sensitive data masked)
console.log(config.getSafeConfig());
// Output: { app: { port: 3000, host: 'localhost', env: 'development' }, database: { url: 'postgres://...', password: '***' } }
```

## API Reference

### Environment Variable Types

- `Env.string(options)` - String configuration
- `Env.number(options)` - Number configuration with range validation
- `Env.boolean(options)` - Boolean configuration
- `Env.array(options)` - Array configuration with length validation

### Built-in Validators

- `Env.regex(pattern, message?)` - Regular expression validation
- `Env.oneOf(values, message?)` - Enum validation
- `Env.url(message?)` - URL validation
- `Env.email(message?)` - Email validation
- `Env.port(message?)` - Port number validation (1-65535)

### Configuration Options

```typescript
interface EnvVariableConfig<T> {
  env?: string;           // Custom environment variable name
  description?: string;   // Variable description
  type: EnvValueType;    // Variable type
  default?: T;           // Default value
  required?: boolean;    // Required field
  sensitive?: boolean;   // Sensitive field (masked in logs)
  validate?: Function;   // Custom validation function
  separator?: string;    // Array separator (default: ',')
}
```

## Testing

The package includes comprehensive unit tests with high coverage:

```bash
# Run tests
bun test

# Run tests with coverage
bun run test:coverage
```

### Test Structure

- **Unit Tests**: 95+ tests covering all core functionality
- **Integration Tests**: Real-world scenarios and complex configurations  
- **Error Handling**: Comprehensive error scenarios and edge cases
- **Performance Tests**: Large configuration handling and efficiency

### Test Coverage

- ✅ **Types**: Error classes and type definitions
- ✅ **Parser**: String-to-type conversion and validation
- ✅ **Loader**: .env file loading and process.env handling
- ✅ **TypedEnv**: Configuration creation and management
- ✅ **Helpers**: All built-in validators and utilities
- ✅ **Integration**: End-to-end workflows and complex scenarios

### Running Specific Tests

```bash
# Run specific test file
bun test tests/parser.test.ts

# Run tests matching pattern
bun test --match "*validation*"

# Run tests in watch mode
bun test --watch
```

## Environment Variable Loading

The package supports multiple sources for environment variables:

1. **Process Environment**: `process.env` variables
2. **.env Files**: Support for `.env` file loading
3. **Priority Control**: Configure which source takes precedence

```typescript
const config = await TypedEnv.createAsync(schema, {
  envFilePath: '.env.production',
  envOverridesDotEnv: true,  // process.env overrides .env file
  loadDotEnv: true           // enable .env file loading
});
```

## Advanced Usage

### Custom Validation

```typescript
const schema = {
  apiKey: Env.string({
    required: true,
    sensitive: true,
    validate: (value: string) => {
      if (value.length < 32) {
        return Effect.fail(new Error('API key too short'));
      }
      return Effect.succeed(value);
    }
  })
};
```

### Nested Configuration

```typescript
const schema = {
  server: {
    http: {
      port: Env.number({ default: 3000 }),
      host: Env.string({ default: 'localhost' })
    },
    https: {
      port: Env.number({ default: 3443 }),
      cert: Env.string({ sensitive: true })
    }
  }
};

// Access nested values
const httpPort = config.get('server.http.port');
const httpsCert = config.get('server.https.cert');
```

## Error Handling

All validation errors are properly typed and provide detailed context:

```typescript
try {
  const config = await TypedEnv.createAsync(schema);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.log(`Validation failed for ${error.variable}: ${error.reason}`);
    console.log(`Got value: ${error.value}`);
  }
}
```

## License

MIT 