---
description: "@Module, @Controller, @Service decorators. HTTP method decorators (@Get, @Post, etc). Parameter decorators (@Param, @Query, @Body)."
---

<llms-only>

## Decorator Quick Reference

**Module Structure**:
```typescript
@Module({
  imports: [OtherModule],      // import modules
  controllers: [MyController], // register controllers
  providers: [MyService],      // register services
  exports: [MyService],        // export for other modules
})
export class MyModule {}
```

**Controller with Routes**:
```typescript
@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) { super(); }

  @Get('/')           // GET /api/users
  @Get('/:id')        // GET /api/users/:id
  @Post('/')          // POST /api/users
  @Put('/:id')        // PUT /api/users/:id
  @Delete('/:id')     // DELETE /api/users/:id
}
```

**Parameter Extraction**:
```typescript
@Get('/:id')
async getUser(
  @Param('id') id: string,                      // from path (always required)
  @Query('page') page?: string,                 // optional by default
  @Query('limit', { required: true }) limit: string, // explicitly required
  @Body(schema) body: CreateUserDto,            // required based on schema
  @Header('x-api-key') key?: string,            // optional by default
  @Header('Authorization', { required: true }) auth: string, // explicitly required
): Promise<Response> {
  return this.success({ id, page, limit });
}
```

**Service Definition**:
```typescript
@Service()
export class UserService extends BaseService {
  // this.logger and this.config available from BaseService
}
```

</llms-only>

# Decorators API

Package: `@onebun/core`

## Module Decorators

### @Module()

Defines a module that groups controllers, services, and imports.

```typescript
@Module(options: ModuleOptions)
```

**ModuleOptions:**

```typescript
interface ModuleOptions {
  /** Other modules to import (their exported services become available) */
  imports?: Function[];

  /** Controller classes to register */
  controllers?: Function[];

  /** Service classes to register as providers */
  providers?: unknown[];

  /** Services to export to parent modules */
  exports?: unknown[];
}
```

**Example:**

```typescript
import { Module } from '@onebun/core';
import { CacheModule } from '@onebun/cache';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [CacheModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```

## Controller Decorators

### @Controller()

Marks a class as an HTTP controller with a base path.

```typescript
@Controller(basePath?: string)
```

**Example:**

```typescript
import { Controller, BaseController } from '@onebun/core';

@Controller('/api/users')
export class UserController extends BaseController {
  // All routes will be prefixed with /api/users
}
```

## HTTP Method Decorators

### @Get(), @Post(), @Put(), @Delete(), @Patch(), @Options(), @Head(), @All()

Define HTTP endpoints on controller methods.

```typescript
@Get(path?: string)
@Post(path?: string)
@Put(path?: string)
@Delete(path?: string)
@Patch(path?: string)
@Options(path?: string)
@Head(path?: string)
@All(path?: string)  // Matches all HTTP methods
```

**Path Parameters:**

Use `:paramName` syntax for dynamic segments:

```typescript
@Controller('/users')
export class UserController extends BaseController {
  @Get('/')              // GET /users
  async findAll() {}

  @Get('/:id')           // GET /users/123
  async findOne(@Param('id') id: string) {}

  @Get('/:userId/posts') // GET /users/123/posts
  async getUserPosts(@Param('userId') userId: string) {}

  @Post('/')             // POST /users
  async create(@Body() body: CreateUserDto) {}

  @Put('/:id')           // PUT /users/123
  async update(@Param('id') id: string, @Body() body: UpdateUserDto) {}

  @Delete('/:id')        // DELETE /users/123
  async remove(@Param('id') id: string) {}
}
```

## Parameter Decorators

All parameter decorators support an options object to control whether the parameter is required:

```typescript
interface ParamDecoratorOptions {
  required?: boolean;
}
```

### @Param()

Extract path parameter from URL. **Path parameters are always required** per OpenAPI specification.

```typescript
@Param(name: string, schema?: Type<unknown>)
```

**Example:**

```typescript
import { type } from 'arktype';

const idSchema = type('string.uuid');

@Get('/:id')
async findOne(
  @Param('id') id: string,                    // Always required (OpenAPI spec)
  @Param('id', idSchema) id: string,          // With validation, always required
) {}
```

### @Query()

Extract query parameter from URL. **Optional by default.**

```typescript
@Query(name: string, options?: ParamDecoratorOptions)
@Query(name: string, schema?: Type<unknown>, options?: ParamDecoratorOptions)
```

**Example:**

```typescript
// GET /users?page=1&limit=10
@Get('/')
async findAll(
  @Query('page') page?: string,                        // Optional (default)
  @Query('limit', { required: true }) limit: string,   // Explicitly required
) {}

// With validation schema
@Get('/search')
async search(
  @Query('q', type('string')) query?: string,                      // Optional with validation
  @Query('sort', type('string'), { required: true }) sort: string, // Required with validation
) {}
```

### @Body()

Extract and optionally validate request body. **Required is determined from schema** - if the schema accepts `undefined`, the body is optional; otherwise it's required.

```typescript
@Body(schema?: Type<unknown>, options?: ParamDecoratorOptions)
```

**Example:**

```typescript
import { type } from 'arktype';

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
});

// Schema doesn't accept undefined → required
@Post('/')
async create(
  @Body(createUserSchema) body: typeof createUserSchema.infer,
) {}

// Schema accepts undefined → optional
const optionalBodySchema = type({
  name: 'string',
}).or(type.undefined);

@Post('/optional')
async createOptional(
  @Body(optionalBodySchema) body: typeof optionalBodySchema.infer,
) {}

// Explicit override
@Post('/force-optional')
async forceOptional(
  @Body(createUserSchema, { required: false }) body: typeof createUserSchema.infer,
) {}

// Without validation - body is unknown
@Post('/simple')
async createSimple(
  @Body() body: unknown,
) {}
```

### @Header()

Extract header value. **Optional by default.**

```typescript
@Header(name: string, options?: ParamDecoratorOptions)
@Header(name: string, schema?: Type<unknown>, options?: ParamDecoratorOptions)
```

**Example:**

```typescript
@Get('/protected')
async protected(
  @Header('X-Request-ID') requestId?: string,                      // Optional (default)
  @Header('Authorization', { required: true }) auth: string,       // Explicitly required
) {}

// With validation schema
@Get('/api')
async api(
  @Header('X-API-Key', type('string'), { required: true }) apiKey: string,
) {}
```

### @Req()

Inject the raw Request object.

```typescript
@Req()
```

**Example:**

```typescript
@Get('/raw')
async handleRaw(@Req() request: Request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  // ...
}
```

### @Res()

Inject response context (limited support).

```typescript
@Res()
```

## Service Decorators

### @Service()

Marks a class as an injectable service.

```typescript
@Service(tag?: Context.Tag<T, T>)
```

**Example:**

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  // Service with auto-generated tag

  async findAll(): Promise<User[]> {
    this.logger.info('Finding all users');
    // ...
  }
}

// With custom Effect.js tag
import { Context } from 'effect';

const CustomServiceTag = Context.GenericTag<CustomService>('CustomService');

@Service(CustomServiceTag)
export class CustomService extends BaseService {
  // Service with explicit tag
}
```

### @Inject()

Explicit dependency injection (for complex cases).

```typescript
@Inject(type: new (...args: any[]) => T)
```

**Example:**

```typescript
@Controller('/users')
export class UserController extends BaseController {
  constructor(
    // Automatic injection (works in most cases)
    private userService: UserService,

    // Explicit injection (for edge cases)
    @Inject(CacheService) private cache: CacheService,
  ) {
    super();
  }
}
```

## Middleware Decorators

### @UseMiddleware()

Apply middleware to a route handler.

```typescript
@UseMiddleware(...middleware: Function[])
```

**Example:**

```typescript
const authMiddleware = async (req: Request, next: () => Promise<Response>) => {
  const token = req.headers.get('Authorization');
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  return next();
};

const logMiddleware = async (req: Request, next: () => Promise<Response>) => {
  console.log(`${req.method} ${req.url}`);
  return next();
};

@Controller('/users')
export class UserController extends BaseController {
  @Get('/protected')
  @UseMiddleware(authMiddleware)
  async protectedRoute() {
    return this.success({ message: 'Secret data' });
  }

  @Post('/action')
  @UseMiddleware(logMiddleware, authMiddleware)  // Multiple middleware
  async action() {
    return this.success({ message: 'Action performed' });
  }
}
```

## Response Decorators

### @ApiResponse()

Define response schema for documentation and validation.

```typescript
@ApiResponse(statusCode: number, options?: {
  schema?: Type<unknown>;
  description?: string;
})
```

::: tip Decorator Order
`@ApiResponse` must be placed **below** the route decorator (`@Get`, `@Post`, etc.) because the route decorator reads response schemas when it runs.
:::

**Example:**

```typescript
import { type } from 'arktype';

const userResponseSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});

@Controller('/users')
export class UserController extends BaseController {
  // @ApiResponse must be BELOW @Get
  @Get('/:id')
  @ApiResponse(200, {
    schema: userResponseSchema,
    description: 'User found successfully',
  })
  @ApiResponse(404, {
    description: 'User not found',
  })
  async findOne(@Param('id') id: string) {
    // Response will be validated against userResponseSchema
    return this.success({ id, name: 'John', email: 'john@example.com' });
  }
}
```

## Documentation Decorators

Package: `@onebun/docs`

These decorators add metadata for OpenAPI/Swagger documentation generation.

::: warning Decorator Order Matters
Due to how TypeScript decorators work with the `@Controller` wrapper:
- `@ApiTags` must be placed **above** `@Controller`
- `@ApiOperation` must be placed **above** route decorators (`@Get`, `@Post`, etc.)
- `@ApiResponse` must be placed **below** route decorators
:::

### @ApiTags()

Group endpoints under tags for documentation organization.

```typescript
import { ApiTags } from '@onebun/docs';

@ApiTags(...tags: string[])
```

Can be used on controller class or individual methods:

**Example:**

```typescript
import { Controller, BaseController, Get } from '@onebun/core';
import { ApiTags } from '@onebun/docs';

// @ApiTags must be ABOVE @Controller
@ApiTags('Users', 'User Management')
@Controller('/users')
export class UserController extends BaseController {
  // All endpoints tagged with 'Users' and 'User Management'

  // For method-level tags, place above the route decorator
  @ApiTags('Admin')
  @Get('/admins')
  async getAdmins() {
    return this.success([]);
  }
}
```

### @ApiOperation()

Describe an API operation with summary, description, and additional tags.

```typescript
import { ApiOperation } from '@onebun/docs';

@ApiOperation(options: {
  summary?: string;
  description?: string;
  tags?: string[];
})
```

**Example:**

```typescript
import { Controller, BaseController, Get, Param } from '@onebun/core';
import { ApiOperation } from '@onebun/docs';

@Controller('/users')
export class UserController extends BaseController {
  // @ApiOperation must be ABOVE the route decorator
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Returns a single user by their unique identifier. Returns 404 if user not found.',
    tags: ['Users'],
  })
  @Get('/:id')
  async getUser(@Param('id') id: string) {
    return this.success({ id, name: 'John' });
  }
}
```

### Combining Documentation Decorators

Use both `@onebun/core` and `@onebun/docs` decorators together for complete documentation:

```typescript
import { Controller, BaseController, Get, Post, Body, Param, ApiResponse } from '@onebun/core';
import { ApiTags, ApiOperation } from '@onebun/docs';
import { type } from 'arktype';

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
});

@Controller('/users')
@ApiTags('Users')
export class UserController extends BaseController {
  @ApiOperation({ summary: 'Get user by ID' })
  @Get('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User found' })
  @ApiResponse(404, { description: 'User not found' })
  async getUser(@Param('id') id: string) {
    // ...
  }

  @ApiOperation({ summary: 'Create new user', description: 'Creates a new user account' })
  @Post('/')
  @ApiResponse(201, { schema: userSchema, description: 'User created' })
  @ApiResponse(400, { description: 'Invalid input' })
  async createUser(@Body(createUserSchema) body: typeof createUserSchema.infer) {
    // ...
  }
}
```

## Tracing Decorators

### @Span()

Create a trace span for a method (from `@onebun/trace`).

```typescript
@Span(name?: string)
```

**Example:**

```typescript
import { Span } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  @Span('user-find-by-id')
  async findById(id: string): Promise<User | null> {
    // This method is automatically traced
    return this.repository.findById(id);
  }

  @Span()  // Uses method name as span name
  async processUser(user: User): Promise<void> {
    // Span name: "processUser"
  }
}
```

## Utility Functions

### getControllerMetadata()

Get metadata for a controller class.

```typescript
function getControllerMetadata(target: Function): ControllerMetadata | undefined;

interface ControllerMetadata {
  path: string;
  routes: RouteMetadata[];
}

interface RouteMetadata {
  path: string;
  method: HttpMethod;
  handler: string;
  params?: ParamMetadata[];
  middleware?: Function[];
  responseSchemas?: ResponseSchemaMetadata[];
}
```

### getModuleMetadata()

Get metadata for a module class.

```typescript
function getModuleMetadata(target: Function): ModuleMetadata | undefined;

interface ModuleMetadata {
  imports?: Function[];
  controllers?: Function[];
  providers?: unknown[];
  exports?: unknown[];
}
```

### getServiceMetadata()

Get metadata for a service class.

```typescript
function getServiceMetadata(serviceClass: Function): ServiceMetadata | undefined;

interface ServiceMetadata {
  tag: Context.Tag<unknown, unknown>;
  impl: new () => unknown;
}
```

### getServiceTag()

Get Effect.js Context tag for a service class.

```typescript
function getServiceTag<T>(serviceClass: new (...args: unknown[]) => T): Context.Tag<T, T>;
```

### registerDependencies()

Manually register constructor dependencies (fallback method).

```typescript
function registerDependencies(target: Function, dependencies: Function[]): void;
```

## Complete Example

```typescript
import {
  Module,
  Controller,
  BaseController,
  Service,
  BaseService,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Header,
  UseMiddleware,
  ApiResponse,
  Inject,
} from '@onebun/core';
import { Span } from '@onebun/trace';
import { type } from 'arktype';

// Validation schemas
const createUserSchema = type({
  name: 'string',
  email: 'string.email',
});

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});

// Service
@Service()
export class UserService extends BaseService {
  private users = new Map<string, { id: string; name: string; email: string }>();

  @Span('find-all-users')
  async findAll(): Promise<Array<typeof userSchema.infer>> {
    return Array.from(this.users.values());
  }

  @Span('find-user-by-id')
  async findById(id: string): Promise<typeof userSchema.infer | null> {
    return this.users.get(id) || null;
  }

  async create(data: typeof createUserSchema.infer): Promise<typeof userSchema.infer> {
    const user = { id: crypto.randomUUID(), ...data };
    this.users.set(user.id, user);
    this.logger.info('User created', { userId: user.id });
    return user;
  }
}

// Middleware
const authMiddleware = async (req: Request, next: () => Promise<Response>) => {
  const token = req.headers.get('Authorization');
  if (!token?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return next();
};

// Controller
@Controller('/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  @ApiResponse(200, { schema: userSchema.array() })
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Response> {
    const users = await this.userService.findAll();
    return this.success(users);
  }

  @Get('/:id')
  @ApiResponse(200, { schema: userSchema })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<Response> {
    const user = await this.userService.findById(id);
    if (!user) {
      return this.error('User not found', 404, 404);
    }
    return this.success(user);
  }

  @Post('/')
  @UseMiddleware(authMiddleware)
  @ApiResponse(201, { schema: userSchema })
  async create(
    @Body(createUserSchema) body: typeof createUserSchema.infer,
    @Header('X-Request-ID') requestId?: string,
  ): Promise<Response> {
    this.logger.info('Creating user', { requestId });
    const user = await this.userService.create(body);
    return this.success(user);
  }
}

// Module
@Module({
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```
