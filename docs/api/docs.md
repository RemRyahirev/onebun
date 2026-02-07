---
description: "Automatic OpenAPI 3.1 documentation generation from decorators and ArkType schemas. Swagger UI, @ApiTags, @ApiOperation setup."
---

<llm-only>

## Quick Reference for AI

**Setup**: Install `@onebun/docs` and it auto-enables. No manual configuration required.

```typescript
bun add @onebun/docs
```

**How it works**:
1. Framework detects `@onebun/docs` at startup via dynamic import
2. `initializeDocs()` collects all controller metadata (routes, params, schemas)
3. `generateOpenApiSpec()` builds OpenAPI 3.1 spec from metadata
4. Swagger UI HTML is served at `/docs`, JSON spec at `/openapi.json`

**Decorator order matters**:
- `@ApiTags` → ABOVE `@Controller`
- `@ApiOperation` → ABOVE route decorator (`@Get`, `@Post`, etc.)
- `@ApiResponse` → BELOW route decorator

**ArkType → OpenAPI**: ArkType schemas passed to `@Body(schema)` or `@ApiResponse(code, { schema })` are automatically converted to JSON Schema via `arktypeToJsonSchema()` which uses ArkType's built-in `toJsonSchema()`.

**Configuration**: `docs` key in `ApplicationOptions`:
```typescript
interface DocsApplicationOptions {
  enabled?: boolean;       // default: true (if @onebun/docs installed)
  path?: string;           // default: '/docs'
  jsonPath?: string;       // default: '/openapi.json'
  title?: string;          // default: app name or 'OneBun API'
  version?: string;        // default: '1.0.0'
  description?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; url?: string };
  servers?: Array<{ url: string; description?: string }>;
}
```

**Common mistakes**:
- Placing `@ApiTags` below `@Controller` — tags won't be read
- Placing `@ApiResponse` above `@Get`/`@Post` — response schemas won't be attached to the route
- Forgetting to install `@onebun/docs` — no error, docs silently disabled
- Not passing ArkType schema to `@Body()` — request body won't appear in OpenAPI spec

</llm-only>

# API Documentation (OpenAPI)

Package: `@onebun/docs`

## Overview

OneBun automatically generates OpenAPI 3.1 documentation from your controllers, decorators, and ArkType validation schemas. Install the package and get a Swagger UI with zero configuration.

**Key features:**
- Automatic OpenAPI 3.1 spec generation from route metadata
- ArkType schemas → JSON Schema conversion (single source of truth)
- Swagger UI served at `/docs`
- OpenAPI JSON spec served at `/openapi.json`
- `@ApiTags`, `@ApiOperation`, `@ApiResponse` decorators for additional metadata

## Installation

```bash
bun add @onebun/docs
```

That's it. When `@onebun/docs` is installed, documentation is **automatically enabled** on application startup. No imports or configuration required in your application code.

## How It Works

1. On startup, the framework detects `@onebun/docs` via dynamic import
2. All controller metadata (routes, parameters, validation schemas) is collected
3. An OpenAPI 3.1 specification is generated from this metadata
4. Swagger UI is served at the configured path (default: `/docs`)

```
Application starts
  ↓
Detects @onebun/docs installed
  ↓
Collects controller metadata (routes, @Body schemas, @Param, @Query, @Header)
  ↓
Converts ArkType schemas to JSON Schema
  ↓
Generates OpenAPI 3.1 spec
  ↓
Serves Swagger UI at /docs
Serves OpenAPI JSON at /openapi.json
```

## Configuration

Customize documentation via the `docs` option in `OneBunApplication`:

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  docs: {
    enabled: true,              // default: true (if @onebun/docs installed)
    path: '/docs',              // Swagger UI path (default: '/docs')
    jsonPath: '/openapi.json',  // OpenAPI JSON path (default: '/openapi.json')
    title: 'My API',            // API title
    version: '2.0.0',           // API version
    description: 'My awesome OneBun API',
    contact: {
      name: 'API Support',
      email: 'support@example.com',
      url: 'https://example.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
    servers: [
      { url: 'https://api.example.com', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Development' },
    ],
  },
});

await app.start();
// Swagger UI:  http://localhost:3000/docs
// OpenAPI JSON: http://localhost:3000/openapi.json
```

### DocsApplicationOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable docs (auto-disabled if `@onebun/docs` not installed) |
| `path` | `string` | `'/docs'` | Swagger UI path |
| `jsonPath` | `string` | `'/openapi.json'` | OpenAPI JSON spec path |
| `title` | `string` | App name or `'OneBun API'` | API title in spec |
| `version` | `string` | `'1.0.0'` | API version in spec |
| `description` | `string` | - | API description |
| `contact` | `object` | - | Contact info (`name`, `email`, `url`) |
| `license` | `object` | - | License info (`name`, `url`) |
| `servers` | `array` | - | Server URLs with descriptions |
| `externalDocs` | `object` | - | External docs link (`description`, `url`) |

### Disabling Documentation

```typescript
// Explicitly disable
const app = new OneBunApplication(AppModule, {
  docs: { enabled: false },
});

// Or simply don't install @onebun/docs — docs are silently skipped
```

## Documentation Decorators

### @ApiTags()

Group endpoints under tags in the Swagger UI. Imported from `@onebun/docs`.

::: warning Decorator Order
`@ApiTags` must be placed **above** `@Controller` because the controller decorator reads tag metadata when it runs.
:::

```typescript
import { Controller, BaseController, Get } from '@onebun/core';
import { ApiTags } from '@onebun/docs';

// @ApiTags ABOVE @Controller
@ApiTags('Users', 'User Management')
@Controller('/users')
export class UserController extends BaseController {
  // All endpoints in this controller are tagged with 'Users' and 'User Management'

  @Get('/')
  async findAll(): Promise<Response> {
    return this.success([]);
  }
}
```

Can also be used on individual methods (place above the route decorator):

```typescript
@ApiTags('Admin')
@Get('/admins')
async getAdmins(): Promise<Response> {
  return this.success([]);
}
```

### @ApiOperation()

Describe an API operation with summary, description, and additional tags. Imported from `@onebun/docs`.

::: warning Decorator Order
`@ApiOperation` must be placed **above** route decorators (`@Get`, `@Post`, etc.).
:::

```typescript
import { Controller, BaseController, Get, Post, Param, Body } from '@onebun/core';
import { ApiOperation } from '@onebun/docs';
import { type } from 'arktype';

@Controller('/users')
export class UserController extends BaseController {
  // @ApiOperation ABOVE @Get
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Returns a single user by their unique identifier. Returns 404 if not found.',
    tags: ['Users'],
  })
  @Get('/:id')
  async getUser(@Param('id') id: string): Promise<Response> {
    return this.success({ id, name: 'John' });
  }
}
```

### @ApiResponse()

Define response schemas for documentation and validation. Imported from `@onebun/core`.

::: warning Decorator Order
`@ApiResponse` must be placed **below** route decorators (`@Get`, `@Post`, etc.) because the route decorator reads response schemas when it runs.
:::

```typescript
import { Controller, BaseController, Get, Param, ApiResponse } from '@onebun/core';
import { type } from 'arktype';

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});

@Controller('/users')
export class UserController extends BaseController {
  @Get('/:id')
  // @ApiResponse BELOW @Get
  @ApiResponse(200, {
    schema: userSchema,
    description: 'User found successfully',
  })
  @ApiResponse(404, {
    description: 'User not found',
  })
  async getUser(@Param('id') id: string): Promise<Response> {
    return this.success({ id, name: 'John', email: 'john@example.com' });
  }
}
```

## ArkType to OpenAPI Schema

ArkType schemas passed to `@Body(schema)` or `@ApiResponse(code, { schema })` are automatically converted to OpenAPI-compatible JSON Schema. This provides a **single source of truth**: one schema definition serves as TypeScript type, runtime validation, and OpenAPI documentation.

```typescript
import { type } from 'arktype';

// Define schema once
const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});

// Use in @Body — generates both validation AND OpenAPI request body schema
@Post('/')
async createUser(
  @Body(createUserSchema) body: typeof createUserSchema.infer,
): Promise<Response> {
  // body is validated and typed
  return this.success(body);
}
```

The resulting OpenAPI spec will include:

```json
{
  "requestBody": {
    "required": true,
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "email": { "type": "string", "format": "email" },
            "age": { "type": "number", "exclusiveMinimum": 0 }
          },
          "required": ["name", "email"]
        }
      }
    }
  }
}
```

## Programmatic Usage

For advanced use cases (CI pipelines, custom documentation tools):

```typescript
import { generateOpenApiSpec, generateSwaggerUiHtml, arktypeToJsonSchema } from '@onebun/docs';
import { getControllerMetadata } from '@onebun/core';

// Generate OpenAPI spec from controller classes
const spec = generateOpenApiSpec(
  [UserController, OrderController],
  {
    title: 'My API',
    version: '1.0.0',
    description: 'Generated API documentation',
  },
);

// Convert spec to JSON
const json = JSON.stringify(spec, null, 2);

// Generate Swagger UI HTML pointing to a spec URL
const html = generateSwaggerUiHtml('/openapi.json');

// Convert an ArkType schema to JSON Schema
import { type } from 'arktype';
const schema = type({ name: 'string', age: 'number' });
const jsonSchema = arktypeToJsonSchema(schema);
```

## Complete Example

```typescript
// src/config.ts
import { Env } from '@onebun/core';

export const envSchema = {
  server: {
    port: Env.number({ default: 3000, env: 'PORT' }),
  },
};

// src/user.controller.ts
import {
  Controller,
  BaseController,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ApiResponse,
  Service,
  BaseService,
  Module,
} from '@onebun/core';
import { ApiTags, ApiOperation } from '@onebun/docs';
import { type } from 'arktype';

// ---- Schemas (single source of truth) ----

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});

const updateUserSchema = type({
  'name?': 'string',
  'email?': 'string.email',
  'age?': 'number > 0',
});

// ---- Service ----

@Service()
class UserService extends BaseService {
  private users = new Map<string, typeof userSchema.infer>();

  async findAll(): Promise<Array<typeof userSchema.infer>> {
    return Array.from(this.users.values());
  }

  async findById(id: string): Promise<typeof userSchema.infer | null> {
    return this.users.get(id) || null;
  }

  async create(data: typeof createUserSchema.infer): Promise<typeof userSchema.infer> {
    const user = { id: crypto.randomUUID(), ...data };
    this.users.set(user.id, user);
    return user;
  }

  async update(id: string, data: typeof updateUserSchema.infer): Promise<typeof userSchema.infer | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }
}

// ---- Controller with full documentation ----

@ApiTags('Users')
@Controller('/api/users')
class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @ApiOperation({ summary: 'List all users', description: 'Returns all users. Supports pagination via query params.' })
  @Get('/')
  @ApiResponse(200, { schema: userSchema.array(), description: 'List of users' })
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Response> {
    const users = await this.userService.findAll();
    return this.success(users);
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @Get('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User found' })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<Response> {
    const user = await this.userService.findById(id);
    if (!user) return this.error('User not found', 404, 404);
    return this.success(user);
  }

  @ApiOperation({ summary: 'Create a new user' })
  @Post('/')
  @ApiResponse(201, { schema: userSchema, description: 'User created' })
  @ApiResponse(400, { description: 'Invalid input' })
  async create(
    @Body(createUserSchema) body: typeof createUserSchema.infer,
  ): Promise<Response> {
    const user = await this.userService.create(body);
    return this.success(user);
  }

  @ApiOperation({ summary: 'Update a user' })
  @Put('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User updated' })
  @ApiResponse(404, { description: 'User not found' })
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: typeof updateUserSchema.infer,
  ): Promise<Response> {
    const user = await this.userService.update(id, body);
    if (!user) return this.error('User not found', 404, 404);
    return this.success(user);
  }

  @ApiOperation({ summary: 'Delete a user' })
  @Delete('/:id')
  @ApiResponse(200, { description: 'User deleted' })
  @ApiResponse(404, { description: 'User not found' })
  async delete(@Param('id') id: string): Promise<Response> {
    const deleted = await this.userService.delete(id);
    if (!deleted) return this.error('User not found', 404, 404);
    return this.success({ deleted: true });
  }
}

// ---- Module ----

@Module({
  controllers: [UserController],
  providers: [UserService],
})
class UserModule {}

// ---- Application ----

import { OneBunApplication } from '@onebun/core';

const app = new OneBunApplication(UserModule, {
  port: 3000,
  docs: {
    title: 'User Management API',
    version: '1.0.0',
    description: 'API for managing users',
  },
});

await app.start();
// Swagger UI:   http://localhost:3000/docs
// OpenAPI JSON:  http://localhost:3000/openapi.json
// API endpoint:  http://localhost:3000/api/users
```

After starting the application:
- Visit `http://localhost:3000/docs` for interactive Swagger UI
- Fetch `http://localhost:3000/openapi.json` for the raw OpenAPI specification
- All endpoints, request/response schemas, and parameter types are auto-documented
