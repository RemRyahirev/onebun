---
description: "@Module, @Controller, @Service decorators. HTTP method decorators (@Get, @Post, etc). Parameter decorators (@Param, @Query, @Body)."
---

<llm-only>

## Decorator Quick Reference

**Module Structure**:
```typescript
@Module({
  imports: [OtherModule],      // import modules
  controllers: [MyController], // register controllers
  providers: [MyService],      // register services (auto-available in this module)
  exports: [MyService],        // only needed for other modules that import this one
})
export class MyModule {}

// Global module - exports available everywhere without import
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
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
  @Cookie('session') session?: string,          // optional by default
  @Cookie('token', { required: true }) token: string, // explicitly required
): Promise<Response> {
  return this.success({ id, page, limit });
}

// Access raw request (OneBunRequest = BunRequest with .cookies and .params)
@Get('/raw')
async raw(@Req() req: OneBunRequest) {
  const session = req.cookies.get('session');
  const userId = req.params.id;
}
```

**@Cookie & @Req**:
```typescript
// Read cookie by name (optional by default)
@Cookie('session') session?: string
@Cookie('session', { required: true }) session: string

// Access full request (OneBunRequest = BunRequest with .cookies/.params)
@Req() req: OneBunRequest

// Read/set/delete cookies via CookieMap
req.cookies.get('session')
req.cookies.set('session', 'value', { httpOnly: true, path: '/' })
req.cookies.delete('session')

// Custom response headers / Set-Cookie
return new Response(body, { headers: { 'X-Custom': 'value' } })

// @Res() is deprecated — always return Response from handler
```

**File Upload** (multipart/form-data or JSON+base64, auto-detected):
```typescript
import { UploadedFile, UploadedFiles, FormField, OneBunFile, MimeType } from '@onebun/core';

@Post('/upload')
async upload(
  @UploadedFile('avatar', { maxSize: 5_000_000, mimeTypes: [MimeType.ANY_IMAGE] }) file: OneBunFile,
  @UploadedFiles('docs', { maxCount: 10 }) docs: OneBunFile[],
  @FormField('name', { required: true }) name: string,
  @FormField('email') email?: string,
): Promise<Response> {
  await file.writeTo(`./uploads/${file.name}`);
  const base64 = await file.toBase64();
  const buffer = await file.toBuffer();
  return this.success({ name: file.name, size: file.size });
}

// JSON base64 format: { "avatar": "base64..." } or { "avatar": { "data": "base64...", "filename": "photo.png", "mimeType": "image/png" } }
// WARNING: @Body() cannot be used with file decorators on same method
```

**Service Definition**:
```typescript
@Service()
export class UserService extends BaseService {
  // this.logger and this.config available from BaseService
}
```

</llm-only>

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

### @Global()

Marks a module as global. Global modules export their providers to all modules automatically without explicit import. This is useful for modules that provide cross-cutting concerns like database access or caching.

```typescript
@Global()
```

**Example:**

```typescript
import { Module, Global } from '@onebun/core';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

// Now DatabaseService is available in ALL modules without importing DatabaseModule
@Module({
  controllers: [UserController],
  providers: [UserService], // UserService can inject DatabaseService
})
export class UserModule {}
```

**Related Functions:**

```typescript
// Check if a module is global
function isGlobalModule(target: Function): boolean;

// Remove module from global registry (used internally)
function removeFromGlobalModules(target: Function): void;
```

<llm-only>
**Technical details for AI agents:**
- Global modules are stored in a Set and checked during module initialization
- Global services are registered in a separate registry and automatically injected into all modules
- To opt out of global behavior dynamically, use `removeFromGlobalModules()` (e.g., for multi-DB scenarios)
- The `@Global()` decorator only runs once at module definition time
</llm-only>

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

### @Cookie()

Extract cookie value from request. Uses `BunRequest.cookies` (CookieMap) under the hood. **Optional by default.**

```typescript
@Cookie(name: string, options?: ParamDecoratorOptions)
@Cookie(name: string, schema?: Type<unknown>, options?: ParamDecoratorOptions)
```

**Example:**

```typescript
// GET /api/me (with Cookie: session=abc123; theme=dark)
@Get('/me')
async getMe(
  @Cookie('session') session?: string,                       // Optional (default)
  @Cookie('session', { required: true }) session: string,    // Explicitly required
) {}

// With validation schema
@Get('/prefs')
async prefs(
  @Cookie('theme', type('"light" | "dark"')) theme?: string,  // Optional with validation
) {}
```

### @Req()

Inject the raw request object. The type is `OneBunRequest` (alias for `BunRequest`), which extends the standard Web API `Request` with:

- `.cookies` — a `CookieMap` for reading and setting cookies
- `.params` — route parameters extracted by Bun's routes API

```typescript
@Req()
```

**Example:**

```typescript
import type { OneBunRequest } from '@onebun/core';

@Get('/raw')
async handleRaw(@Req() req: OneBunRequest) {
  const url = new URL(req.url);
  const headers = Object.fromEntries(req.headers);

  // Access cookies via CookieMap
  const session = req.cookies.get('session');

  // Access route params (populated by Bun routes API)
  // For route '/users/:id', req.params.id is available
}
```

### @Res() (deprecated)

::: warning Deprecated
`@Res()` is deprecated and currently injects `undefined`. Use `return new Response(...)` from your handler instead. Direct response manipulation is not supported — return a `Response` object to set custom headers, status codes, and cookies.
:::

```typescript
@Res()
```

## File Upload Decorators

Decorators for handling file uploads via `multipart/form-data` or JSON with base64-encoded data. The framework auto-detects the content type and provides a unified `OneBunFile` object.

### @UploadedFile()

Extracts a single file from the request. Required by default.

```typescript
@UploadedFile(fieldName?: string, options?: FileUploadOptions)
```

**FileUploadOptions:**

```typescript
interface FileUploadOptions {
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Allowed MIME types, supports wildcards like 'image/*'. Use MimeType enum. */
  mimeTypes?: string[];
  /** Whether the file is required (default: true) */
  required?: boolean;
}
```

**Example:**

```typescript
import { Controller, Post, UploadedFile, MimeType, OneBunFile, BaseController } from '@onebun/core';

@Controller('/api/files')
export class FileController extends BaseController {
  @Post('/avatar')
  async uploadAvatar(
    @UploadedFile('avatar', {
      maxSize: 5 * 1024 * 1024,
      mimeTypes: [MimeType.ANY_IMAGE],
    }) file: OneBunFile,
  ): Promise<Response> {
    await file.writeTo(`./uploads/${file.name}`);
    return this.success({ filename: file.name, size: file.size });
  }
}
```

### @UploadedFiles()

Extracts multiple files from the request. Required by default (at least one file expected).

```typescript
@UploadedFiles(fieldName?: string, options?: FilesUploadOptions)
```

**FilesUploadOptions:**

```typescript
interface FilesUploadOptions extends FileUploadOptions {
  /** Maximum number of files allowed */
  maxCount?: number;
}
```

**Example:**

```typescript
@Post('/documents')
async uploadDocs(
  @UploadedFiles('docs', { maxCount: 10 }) files: OneBunFile[],
): Promise<Response> {
  for (const file of files) {
    await file.writeTo(`./uploads/${file.name}`);
  }
  return this.success({ count: files.length });
}

// All files from request (no field name filter)
@Post('/batch')
async uploadBatch(
  @UploadedFiles(undefined, { maxCount: 20 }) files: OneBunFile[],
): Promise<Response> {
  return this.success({ count: files.length });
}
```

### @FormField()

Extracts a non-file form field from the request. Optional by default.

```typescript
@FormField(fieldName: string, options?: ParamDecoratorOptions)
```

**Example:**

```typescript
@Post('/profile')
async createProfile(
  @UploadedFile('avatar', { mimeTypes: [MimeType.ANY_IMAGE] }) avatar: OneBunFile,
  @FormField('name', { required: true }) name: string,
  @FormField('email') email: string,
): Promise<Response> {
  await avatar.writeTo(`./uploads/${avatar.name}`);
  return this.success({ name, email, avatar: avatar.name });
}
```

### OneBunFile

Unified file wrapper returned by `@UploadedFile` and `@UploadedFiles`. Works the same regardless of upload method (multipart or JSON+base64).

```typescript
class OneBunFile {
  readonly name: string;          // File name
  readonly size: number;          // File size in bytes
  readonly type: string;          // MIME type
  readonly lastModified: number;  // Last modified timestamp

  async toBase64(): Promise<string>;        // Convert to base64 string
  async toBuffer(): Promise<Buffer>;        // Convert to Buffer
  async toArrayBuffer(): Promise<ArrayBuffer>; // Convert to ArrayBuffer
  toBlob(): Blob;                           // Get underlying Blob
  async writeTo(path: string): Promise<void>; // Write to disk

  static fromBase64(data: string, filename?: string, mimeType?: string): OneBunFile;
}
```

### MimeType Enum

Common MIME types for use with file upload options:

```typescript
import { MimeType } from '@onebun/core';

// Wildcards
MimeType.ANY           // '*/*'
MimeType.ANY_IMAGE     // 'image/*'
MimeType.ANY_VIDEO     // 'video/*'
MimeType.ANY_AUDIO     // 'audio/*'

// Images
MimeType.PNG, MimeType.JPEG, MimeType.GIF, MimeType.WEBP, MimeType.SVG

// Documents
MimeType.PDF, MimeType.JSON, MimeType.XML, MimeType.ZIP, MimeType.CSV, MimeType.XLSX, MimeType.DOCX

// Video/Audio
MimeType.MP4, MimeType.WEBM, MimeType.MP3, MimeType.WAV

// Text
MimeType.PLAIN, MimeType.HTML, MimeType.CSS, MimeType.JAVASCRIPT

// Binary
MimeType.OCTET_STREAM
```

### JSON Base64 Upload Format

When sending files via `application/json`, the framework accepts two formats:

```typescript
// Full format with metadata
{ "avatar": { "data": "iVBORw0KGgo...", "filename": "photo.png", "mimeType": "image/png" } }

// Simplified format (raw base64 string)
{ "avatar": "iVBORw0KGgo..." }
```

The same `@UploadedFile` decorator works for both multipart and JSON uploads.

::: warning
`@Body()` cannot be used together with `@UploadedFile`, `@UploadedFiles`, or `@FormField` on the same method, since both consume the request body.
:::

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

Explicit dependency injection for edge cases. **In most cases, automatic DI works without this decorator.**

```typescript
@Inject(type: new (...args: any[]) => T)
```

**When to use @Inject:**
- Interface or abstract class injection
- Token-based injection (custom Context.Tag)
- Overriding automatic resolution

**Example:**

```typescript
@Controller('/users')
export class UserController extends BaseController {
  constructor(
    // Automatic injection (works in most cases) - no @Inject needed
    private userService: UserService,
    private cacheService: CacheService,

    // @Inject needed only for edge cases:
    // - When injecting by interface instead of concrete class
    // - When using custom Effect.js Context.Tag
    @Inject(SomeAbstractService) private abstractService: SomeAbstractService,
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
  Cookie,
  Req,
  UseMiddleware,
  ApiResponse,
  Inject,
  type OneBunRequest,
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
