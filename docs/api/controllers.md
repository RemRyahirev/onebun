# Controllers API

Package: `@onebun/core`

## BaseController

Base class for all HTTP controllers. Provides standardized response methods, logger, and configuration access.

### Class Definition

```typescript
export class Controller {
  protected logger: SyncLogger;
  protected config: unknown;

  /** Initialize controller with logger and config (called by framework) */
  initializeController(logger: SyncLogger, config: unknown): void;

  /** Get a service instance by tag or class */
  protected getService<T>(tag: Context.Tag<T, T>): T;
  protected getService<T>(serviceClass: new (...args: unknown[]) => T): T;

  /** Set a service instance (used internally) */
  setService<T>(tag: Context.Tag<T, T>, instance: T): void;

  /** Check if request has JSON content type */
  protected isJson(req: Request): boolean;

  /** Parse JSON from request body */
  protected async parseJson<T = unknown>(req: Request): Promise<T>;

  /** Create standardized success response */
  protected success<T = unknown>(result: T, status?: number): Response;

  /** Create standardized error response */
  public error(message: string, code?: number, status?: number): Response;

  /** Create JSON response (alias for success) */
  protected json<T = unknown>(data: T, status?: number): Response;

  /** Create text response */
  protected text(data: string, status?: number): Response;
}
```

### Usage

Always extend `BaseController` (exported as `BaseController` from `@onebun/core`):

```typescript
import { Controller, BaseController, Get, Post, Body } from '@onebun/core';
import { UserService } from './user.service';

@Controller('/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();  // Always call super()
  }

  @Get('/')
  async findAll(): Promise<Response> {
    const users = await this.userService.findAll();
    return this.success(users);
  }
}
```

## Response Methods

### success()

Create a standardized success response.

```typescript
protected success<T = unknown>(result: T, status: number = 200): Response
```

**Response Format:**

```json
{
  "success": true,
  "result": <your data>
}
```

**Examples:**

```typescript
@Get('/')
async getUser(): Promise<Response> {
  // Simple data
  return this.success({ name: 'John', age: 30 });

  // Array
  return this.success([{ id: 1 }, { id: 2 }]);

  // With custom status
  return this.success({ id: '123' }, 201);  // Created
}
```

### error()

Create a standardized error response.

```typescript
public error(
  message: string,
  code: number = 500,
  status: number = 500
): Response
```

**Response Format:**

```json
{
  "success": false,
  "code": <error code>,
  "message": "<error message>"
}
```

**Examples:**

```typescript
@Get('/:id')
async findOne(@Param('id') id: string): Promise<Response> {
  const user = await this.userService.findById(id);

  if (!user) {
    return this.error('User not found', 404, 404);
  }

  return this.success(user);
}

@Post('/')
async create(@Body() body: unknown): Promise<Response> {
  try {
    const user = await this.userService.create(body);
    return this.success(user, 201);
  } catch (e) {
    // Validation error
    return this.error('Invalid data', 400, 400);
  }
}
```

### json()

Alias for `success()`. Creates JSON response.

```typescript
protected json<T = unknown>(data: T, status: number = 200): Response
```

### text()

Create plain text response.

```typescript
protected text(data: string, status: number = 200): Response
```

**Example:**

```typescript
@Get('/health')
async health(): Promise<Response> {
  return this.text('OK');
}

@Get('/version')
async version(): Promise<Response> {
  return this.text('1.0.0', 200);
}
```

## Accessing Services

### Via Constructor Injection (Recommended)

```typescript
@Controller('/users')
export class UserController extends BaseController {
  constructor(
    private userService: UserService,
    private cacheService: CacheService,
  ) {
    super();
  }

  @Get('/')
  async findAll(): Promise<Response> {
    // Use injected services directly
    const cached = await this.cacheService.get('users');
    if (cached) return this.success(cached);

    const users = await this.userService.findAll();
    await this.cacheService.set('users', users, { ttl: 60 });
    return this.success(users);
  }
}
```

### Via getService() (Legacy)

```typescript
@Controller('/users')
export class UserController extends BaseController {
  @Get('/')
  async findAll(): Promise<Response> {
    // By class
    const userService = this.getService(UserService);

    // By tag
    const userService = this.getService(UserServiceTag);

    const users = await userService.findAll();
    return this.success(users);
  }
}
```

## Accessing Logger

```typescript
@Controller('/users')
export class UserController extends BaseController {
  @Get('/')
  async findAll(): Promise<Response> {
    // Log levels: trace, debug, info, warn, error, fatal
    this.logger.info('Finding all users');
    this.logger.debug('Request received', { timestamp: Date.now() });

    try {
      const users = await this.userService.findAll();
      this.logger.info('Users found', { count: users.length });
      return this.success(users);
    } catch (error) {
      this.logger.error('Failed to find users', error);
      return this.error('Internal error', 500);
    }
  }
}
```

## Accessing Configuration

```typescript
@Controller('/users')
export class UserController extends BaseController {
  @Get('/info')
  async info(): Promise<Response> {
    // Access typed configuration
    const port = (this.config as any).get('server.port');
    const appName = (this.config as any).get('app.name');

    return this.success({
      port,
      appName,
      configAvailable: this.config !== null,
    });
  }
}
```

## Request Helpers

### isJson()

Check if request has JSON content type.

```typescript
@Post('/')
async create(@Req() req: Request): Promise<Response> {
  if (!this.isJson(req)) {
    return this.error('Content-Type must be application/json', 400, 400);
  }
  // ...
}
```

### parseJson()

Parse JSON from request body (when not using @Body decorator).

```typescript
@Post('/')
async create(@Req() req: Request): Promise<Response> {
  const body = await this.parseJson<CreateUserDto>(req);
  // body is typed as CreateUserDto
}
```

## HTTP Status Codes

Import common status codes:

```typescript
import { HttpStatusCode } from '@onebun/core';

@Get('/:id')
async findOne(@Param('id') id: string): Promise<Response> {
  const user = await this.userService.findById(id);

  if (!user) {
    return this.error('Not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
  }

  return this.success(user, HttpStatusCode.OK);
}

@Post('/')
async create(@Body() body: CreateUserDto): Promise<Response> {
  const user = await this.userService.create(body);
  return this.success(user, HttpStatusCode.CREATED);
}
```

**Available Status Codes:**

```typescript
enum HttpStatusCode {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  CONFLICT = 409,
  UNPROCESSABLE_ENTITY = 422,
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
}
```

## Complete Controller Example

```typescript
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
  Header,
  UseMiddleware,
  HttpStatusCode,
} from '@onebun/core';
import { type } from 'arktype';

import { UserService } from './user.service';
import { authMiddleware } from './middleware/auth';

// Validation schemas
const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'role?': '"admin" | "user"',
});

const updateUserSchema = type({
  'name?': 'string',
  'email?': 'string.email',
  'role?': '"admin" | "user"',
});

const paginationSchema = type({
  page: 'string.numeric.parse',
  limit: 'string.numeric.parse',
});

@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  /**
   * GET /api/users
   * List all users with pagination
   */
  @Get('/')
  async findAll(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ): Promise<Response> {
    this.logger.info('Listing users', { page, limit });

    const users = await this.userService.findAll({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

    return this.success({
      users: users.items,
      total: users.total,
      page: users.page,
      limit: users.limit,
    });
  }

  /**
   * GET /api/users/:id
   * Get user by ID
   */
  @Get('/:id')
  async findOne(@Param('id') id: string): Promise<Response> {
    this.logger.debug('Finding user', { id });

    const user = await this.userService.findById(id);

    if (!user) {
      this.logger.warn('User not found', { id });
      return this.error('User not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
    }

    return this.success(user);
  }

  /**
   * POST /api/users
   * Create new user (requires authentication)
   */
  @Post('/')
  @UseMiddleware(authMiddleware)
  async create(
    @Body(createUserSchema) body: typeof createUserSchema.infer,
    @Header('X-Request-ID') requestId?: string,
  ): Promise<Response> {
    this.logger.info('Creating user', { email: body.email, requestId });

    try {
      const user = await this.userService.create(body);
      this.logger.info('User created', { userId: user.id });
      return this.success(user, HttpStatusCode.CREATED);
    } catch (error) {
      if (error instanceof Error && error.message.includes('duplicate')) {
        return this.error('Email already exists', HttpStatusCode.CONFLICT, HttpStatusCode.CONFLICT);
      }
      throw error;
    }
  }

  /**
   * PUT /api/users/:id
   * Update user
   */
  @Put('/:id')
  @UseMiddleware(authMiddleware)
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: typeof updateUserSchema.infer,
  ): Promise<Response> {
    this.logger.info('Updating user', { id, fields: Object.keys(body) });

    const user = await this.userService.update(id, body);

    if (!user) {
      return this.error('User not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
    }

    return this.success(user);
  }

  /**
   * DELETE /api/users/:id
   * Delete user
   */
  @Delete('/:id')
  @UseMiddleware(authMiddleware)
  async remove(@Param('id') id: string): Promise<Response> {
    this.logger.info('Deleting user', { id });

    const deleted = await this.userService.delete(id);

    if (!deleted) {
      return this.error('User not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
    }

    return this.success({ deleted: true });
  }

  /**
   * GET /api/users/search
   * Search users
   */
  @Get('/search')
  async search(
    @Query('q') query: string,
    @Query('field') field: string = 'name',
  ): Promise<Response> {
    if (!query) {
      return this.error('Query parameter "q" is required', HttpStatusCode.BAD_REQUEST, HttpStatusCode.BAD_REQUEST);
    }

    const users = await this.userService.search(query, field);
    return this.success(users);
  }
}
```
