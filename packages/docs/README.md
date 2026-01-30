# @onebun/docs

Documentation generation package for OneBun framework with OpenAPI/Swagger support.

## Features

- 📖 **OpenAPI Generation** - Automatic OpenAPI 3.0 specification from decorators
- 🎨 **Swagger UI** - Built-in Swagger UI for interactive API documentation
- 🔄 **JSON Schema Converter** - Convert validation schemas to JSON Schema format
- 🏷️ **Decorator-based** - Use decorators to document your API endpoints
- 📝 **Type-safe** - Full TypeScript support with type inference
- ⚡ **Effect.js Integration** - Seamless integration with Effect.js ecosystem

## Installation

```bash
bun add @onebun/docs
```

## Quick Start

### Basic Usage

```typescript
import { OneBunApplication, Controller, Get, Post, Body } from '@onebun/core';
import { ApiTag, ApiOperation, ApiResponse, ApiBody } from '@onebun/docs';

@Controller('/users')
@ApiTag('Users', 'User management endpoints')
export class UserController {
  @Get()
  @ApiOperation({ summary: 'Get all users', description: 'Returns a list of all users' })
  @ApiResponse({ status: 200, description: 'List of users returned successfully' })
  async getUsers() {
    return { users: [] };
  }

  @Post()
  @ApiOperation({ summary: 'Create user', description: 'Creates a new user' })
  @ApiBody({ description: 'User data', required: true })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async createUser(@Body() userData: CreateUserDto) {
    return { id: '1', ...userData };
  }
}
```

### Enable Swagger UI

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  docs: {
    enabled: true,
    path: '/docs',
    title: 'My API',
    version: '1.0.0',
    description: 'API documentation for my service'
  }
});

await app.start();
// Swagger UI available at http://localhost:3000/docs
```

## Decorators

### Controller Level

- `@ApiTag(name, description?)` - Group endpoints under a tag

### Method Level

- `@ApiOperation(options)` - Describe the operation
- `@ApiResponse(options)` - Document response types
- `@ApiBody(options)` - Document request body
- `@ApiParam(options)` - Document path parameters
- `@ApiQuery(options)` - Document query parameters
- `@ApiHeader(options)` - Document header parameters

## Configuration Options

```typescript
interface DocsOptions {
  // Enable/disable documentation (default: true)
  enabled?: boolean;

  // Path for Swagger UI (default: '/docs')
  path?: string;

  // API title
  title?: string;

  // API version
  version?: string;

  // API description
  description?: string;

  // Contact information
  contact?: {
    name?: string;
    email?: string;
    url?: string;
  };

  // License information
  license?: {
    name: string;
    url?: string;
  };

  // External documentation
  externalDocs?: {
    description?: string;
    url: string;
  };

  // Server URLs
  servers?: Array<{
    url: string;
    description?: string;
  }>;
}
```

## OpenAPI Generation

### Programmatic Access

```typescript
import { generateOpenApiSpec } from '@onebun/docs';

const spec = generateOpenApiSpec(AppModule, {
  title: 'My API',
  version: '1.0.0'
});

// Save to file
await Bun.write('openapi.json', JSON.stringify(spec, null, 2));
```

### JSON Schema Conversion

```typescript
import { toJsonSchema } from '@onebun/docs';
import { S } from '@onebun/core';

const userSchema = S.object({
  id: S.string(),
  email: S.string().email(),
  age: S.number().min(0).max(150)
});

const jsonSchema = toJsonSchema(userSchema);
// Returns JSON Schema compatible object
```

## Integration with Validation

The docs package works seamlessly with `@onebun/core` validation schemas:

```typescript
import { Controller, Post, Body, S } from '@onebun/core';
import { ApiOperation, ApiBody, ApiResponse } from '@onebun/docs';

const CreateUserSchema = S.object({
  name: S.string().min(1).max(100),
  email: S.string().email(),
  age: S.number().optional()
});

@Controller('/users')
export class UserController {
  @Post()
  @ApiOperation({ summary: 'Create user' })
  @ApiBody({ schema: CreateUserSchema })
  @ApiResponse({ status: 201, schema: CreateUserSchema })
  async createUser(@Body(CreateUserSchema) userData: typeof CreateUserSchema.infer) {
    return userData;
  }
}
```

## Best Practices

1. **Document all endpoints** - Add at least `@ApiOperation` and `@ApiResponse` to every endpoint
2. **Use meaningful descriptions** - Help consumers understand your API
3. **Group related endpoints** - Use `@ApiTag` for logical grouping
4. **Document error responses** - Include common error status codes
5. **Keep documentation updated** - Decorators ensure docs stay in sync with code

## License

[LGPL-3.0](../../LICENSE)
