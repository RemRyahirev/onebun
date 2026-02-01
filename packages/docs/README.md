# @onebun/docs

Documentation generation package for OneBun framework with OpenAPI/Swagger support.

## Features

- OpenAPI Generation - Automatic OpenAPI 3.1 specification from decorators
- Swagger UI - Built-in Swagger UI HTML generation for interactive API documentation
- JSON Schema Converter - Convert ArkType validation schemas to JSON Schema format
- Decorator-based - Use decorators to add metadata for documentation
- Type-safe - Full TypeScript support with type inference

## Installation

```bash
bun add @onebun/docs
```

## Quick Start

### Basic Usage

The `@onebun/docs` package provides decorators for adding documentation metadata to your controllers. Note that `@ApiResponse` for response validation is provided by `@onebun/core`.

**Important: Decorator Order Matters!**
- `@ApiTags` must be placed **above** `@Controller` (because `@Controller` wraps the class)
- `@ApiOperation` must be placed **above** route decorators (`@Get`, `@Post`, etc.)
- `@ApiResponse` must be placed **below** route decorators

```typescript
import { Controller, Get, Post, Body, BaseController, ApiResponse } from '@onebun/core';
import { ApiTags, ApiOperation } from '@onebun/docs';
import { type } from 'arktype';

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
});

// @ApiTags ABOVE @Controller
@ApiTags('Users')
@Controller('/users')
export class UserController extends BaseController {
  // @ApiOperation ABOVE @Get, @ApiResponse BELOW @Get
  @ApiOperation({ summary: 'Get all users', description: 'Returns a list of all users' })
  @Get('/')
  @ApiResponse(200, { description: 'List of users returned successfully' })
  async getUsers(): Promise<Response> {
    return this.success({ users: [] });
  }

  @ApiOperation({ summary: 'Create user', description: 'Creates a new user' })
  @Post('/')
  @ApiResponse(201, { schema: createUserSchema, description: 'User created successfully' })
  @ApiResponse(400, { description: 'Invalid input data' })
  async createUser(@Body(createUserSchema) userData: typeof createUserSchema.infer): Promise<Response> {
    return this.success({ id: '1', ...userData });
  }
}
```

## Decorators

### From @onebun/docs

#### @ApiTags(...tags)

Group endpoints under tags. Can be used on controller class or individual methods.

```typescript
import { ApiTags } from '@onebun/docs';

// @ApiTags must be ABOVE @Controller
@ApiTags('Users', 'User Management')
@Controller('/users')
export class UserController extends BaseController {
  // All endpoints in this controller will be tagged with 'Users' and 'User Management'
}
```

#### @ApiOperation(options)

Describe an API operation with summary, description, and additional tags.

```typescript
import { ApiOperation } from '@onebun/docs';

// @ApiOperation must be ABOVE route decorator
@ApiOperation({
  summary: 'Get user by ID',
  description: 'Returns a single user by their unique identifier',
  tags: ['Users'],  // Additional tags for this specific endpoint
})
@Get('/:id')
async getUser(@Param('id') id: string): Promise<Response> {
  // ...
}
```

### From @onebun/core

#### @ApiResponse(statusCode, options?)

Document and validate response types. This decorator is provided by `@onebun/core`.

```typescript
import { ApiResponse } from '@onebun/core';
import { type } from 'arktype';

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});

// @ApiResponse must be BELOW route decorator
@Get('/:id')
@ApiResponse(200, { schema: userSchema, description: 'User found' })
@ApiResponse(404, { description: 'User not found' })
async getUser(@Param('id') id: string): Promise<Response> {
  // Response will be validated against userSchema for 200 responses
}
```

## OpenAPI Generation

### Generate OpenAPI Spec from Controllers

```typescript
import { generateOpenApiSpec } from '@onebun/docs';
import { UserController } from './user.controller';
import { OrderController } from './order.controller';

const spec = generateOpenApiSpec([UserController, OrderController], {
  title: 'My API',
  version: '1.0.0',
  description: 'API documentation for my service',
});

// Save to file
await Bun.write('openapi.json', JSON.stringify(spec, null, 2));
```

### Generate Swagger UI HTML

```typescript
import { generateSwaggerUiHtml } from '@onebun/docs';

// Generate HTML that loads OpenAPI spec from a URL
const html = generateSwaggerUiHtml('/openapi.json');

// Serve as an endpoint
@Get('/docs')
async getDocs(): Promise<Response> {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
```

### JSON Schema Conversion

Convert ArkType schemas to JSON Schema format for OpenAPI documentation:

```typescript
import { arktypeToJsonSchema } from '@onebun/docs';
import { type } from 'arktype';

const userSchema = type({
  id: 'string',
  email: 'string.email',
  age: 'number > 0',
});

const jsonSchema = arktypeToJsonSchema(userSchema);
// Returns JSON Schema compatible object
```

## Integration with @onebun/core

The docs package reads metadata from `@onebun/core` decorators automatically:

- Route information from `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`
- Path parameters from `@Param`
- Query parameters from `@Query`
- Request body from `@Body`
- Response schemas from `@ApiResponse`

This means your existing controller decorators contribute to the generated OpenAPI spec.

## Best Practices

1. **Use @ApiOperation for all endpoints** - Add summary and description
2. **Use @ApiTags for grouping** - Group related endpoints logically
3. **Document response types** - Use `@ApiResponse` with schemas from `@onebun/core`
4. **Use meaningful descriptions** - Help API consumers understand your endpoints
5. **Keep documentation updated** - Decorators ensure docs stay in sync with code

## API Reference

### generateOpenApiSpec(controllers, options)

Generate OpenAPI 3.1 specification from controller classes.

**Parameters:**
- `controllers: Function[]` - Array of controller classes
- `options: { title?: string; version?: string; description?: string }` - OpenAPI info options

**Returns:** `OpenApiSpec` - OpenAPI 3.1 compliant specification object

### generateSwaggerUiHtml(specUrl)

Generate HTML page with Swagger UI.

**Parameters:**
- `specUrl: string` - URL to the OpenAPI JSON specification

**Returns:** `string` - HTML string

### arktypeToJsonSchema(schema)

Convert ArkType schema to JSON Schema.

**Parameters:**
- `schema: Type<unknown>` - ArkType schema

**Returns:** `Record<string, unknown>` - JSON Schema object

## License

[LGPL-3.0](../../LICENSE)
