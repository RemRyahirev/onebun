---
description: BaseController class, response methods (success/error), routing patterns, middleware integration, service injection.
---

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
  protected isJson(req: OneBunRequest | Request): boolean;

  /** Parse JSON from request body */
  protected async parseJson<T = unknown>(req: OneBunRequest | Request): Promise<T>;

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

## Lifecycle Hooks

Controllers can implement lifecycle hooks, just like services.

### Available Hooks

| Interface | Method | When Called |
|-----------|--------|-------------|
| `OnModuleInit` | `onModuleInit()` | After controller instantiation |
| `OnApplicationInit` | `onApplicationInit()` | After all modules initialized |
| `OnModuleDestroy` | `onModuleDestroy()` | During shutdown |
| `BeforeApplicationDestroy` | `beforeApplicationDestroy(signal?)` | Start of shutdown |
| `OnApplicationDestroy` | `onApplicationDestroy(signal?)` | End of shutdown |

### Usage

```typescript
import { 
  Controller, 
  BaseController, 
  OnModuleInit, 
  OnModuleDestroy 
} from '@onebun/core';

@Controller('/api')
export class ApiController extends BaseController implements OnModuleInit, OnModuleDestroy {
  private connections: WebSocket[] = [];

  async onModuleInit(): Promise<void> {
    this.logger.info('API controller initialized');
  }

  async onModuleDestroy(): Promise<void> {
    // Cleanup any resources
    for (const ws of this.connections) {
      ws.close();
    }
    this.logger.info('API controller destroyed');
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
    // Access typed configuration (with module augmentation, no cast needed)
    const port = this.config.get('server.port');    // number
    const appName = this.config.get('app.name');    // string

    return this.success({
      port,
      appName,
      configAvailable: this.config.isInitialized,
    });
  }
}
```

## Working with Cookies

OneBun uses Bun's native `CookieMap` (available on `BunRequest`) for cookie management. There are two ways to work with cookies:

### Reading Cookies via `@Cookie()` Decorator

The simplest way to read a cookie value — extract it directly as a handler parameter:

```typescript
import { Controller, BaseController, Get, Cookie } from '@onebun/core';

@Controller('/api')
export class PrefsController extends BaseController {
  @Get('/preferences')
  async getPrefs(
    @Cookie('theme') theme?: string,    // Optional by default
    @Cookie('lang') lang?: string,
  ) {
    return {
      theme: theme ?? 'light',
      lang: lang ?? 'en',
    };
  }
}
```

### Reading Cookies via `req.cookies`

For more control, use `@Req()` to access the full `CookieMap`:

```typescript
import { Controller, BaseController, Get, Req, type OneBunRequest } from '@onebun/core';

@Controller('/api')
export class ApiController extends BaseController {
  @Get('/session')
  async session(@Req() req: OneBunRequest) {
    const session = req.cookies.get('session');
    return { session };
  }
}
```

### Setting Cookies via `req.cookies`

```typescript
import { Controller, BaseController, Post, Req, Body, type OneBunRequest } from '@onebun/core';

@Controller('/api')
export class AuthController extends BaseController {
  @Post('/login')
  async login(@Req() req: OneBunRequest, @Body() body: unknown) {
    // Set cookie via CookieMap
    req.cookies.set('session', 'new-session-id', {
      httpOnly: true,
      path: '/',
      maxAge: 3600,
    });

    return { loggedIn: true };
  }
}
```

### Deleting Cookies

```typescript
@Post('/logout')
async logout(@Req() req: OneBunRequest) {
  req.cookies.delete('session');
  return { loggedOut: true };
}
```

## Custom Response Headers

To return custom headers, return a `Response` object directly from your handler:

```typescript
@Controller('/api')
export class DownloadController extends BaseController {
  @Get('/download')
  async download() {
    return new Response(JSON.stringify({ data: 'file content' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
        'Cache-Control': 'no-store',
      },
    });
  }
}
```

### Setting Cookies via Set-Cookie Header

For multiple `Set-Cookie` headers, use the `Headers` API with `append()`:

```typescript
@Controller('/api')
export class AuthController extends BaseController {
  @Post('/login')
  async login(@Body() body: unknown) {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.append('Set-Cookie', 'session=abc123; Path=/; HttpOnly');
    headers.append('Set-Cookie', 'theme=dark; Path=/');

    return new Response(JSON.stringify({ loggedIn: true }), {
      status: 200,
      headers,
    });
  }
}
```

::: tip Multiple Set-Cookie Headers
OneBun correctly preserves multiple `Set-Cookie` headers. Use `Headers.append()` (not `set()`) to add multiple cookies without overwriting previous ones.
:::

## Request Helpers

### isJson()

Check if request has JSON content type.

```typescript
@Post('/')
async create(@Req() req: OneBunRequest): Promise<Response> {
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
async create(@Req() req: OneBunRequest): Promise<Response> {
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
  Cookie,
  Req,
  UseMiddleware,
  HttpStatusCode,
  type OneBunRequest,
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

## Server-Sent Events (SSE)

Server-Sent Events provide a way to push data from the server to the client over HTTP. OneBun provides the `@Sse()` decorator and `sse()` method for creating SSE endpoints.

### SseEvent Type

```typescript
interface SseEvent {
  /** Event name (optional, defaults to 'message') */
  event?: string;
  /** Event data (will be JSON serialized) */
  data: unknown;
  /** Event ID for reconnection (Last-Event-ID header) */
  id?: string;
  /** Reconnection interval in milliseconds */
  retry?: number;
}
```

### SseOptions

```typescript
interface SseOptions {
  /**
   * Heartbeat interval in milliseconds.
   * When set, the server will send a comment (": heartbeat\n\n")
   * at this interval to keep the connection alive.
   */
  heartbeat?: number;
}
```

### @Sse() Decorator

The `@Sse()` decorator marks a method as an SSE endpoint. The method should be an async generator that yields `SseEvent` objects.

```typescript
import {
  Controller,
  BaseController,
  Get,
  Sse,
  type SseGenerator,
} from '@onebun/core';

@Controller('/events')
export class EventsController extends BaseController {
  /**
   * Simple SSE endpoint
   * Client: new EventSource('/events/stream')
   */
  @Get('/stream')
  @Sse()
  async *stream(): SseGenerator {
    for (let i = 0; i < 10; i++) {
      await Bun.sleep(1000);
      yield { event: 'tick', data: { count: i, timestamp: Date.now() } };
    }
    // Stream closes automatically when generator completes
  }

  /**
   * SSE with heartbeat for long-lived connections
   * Sends ": heartbeat\n\n" every 15 seconds to keep connection alive
   */
  @Get('/live')
  @Sse({ heartbeat: 15000 })
  async *live(): SseGenerator {
    // Initial connection event
    yield { event: 'connected', data: { clientId: crypto.randomUUID() } };

    // Infinite stream - client can disconnect anytime
    while (true) {
      const update = await this.getService(DataService).waitForUpdate();
      yield { event: 'update', data: update };
    }
  }

  /**
   * SSE with event IDs for reconnection support
   */
  @Get('/notifications')
  @Sse({ heartbeat: 30000 })
  async *notifications(): SseGenerator {
    let eventId = 0;

    while (true) {
      const notification = await this.getService(NotificationService).poll();
      eventId++;
      yield {
        event: 'notification',
        data: notification,
        id: String(eventId),
        retry: 5000,  // Client should retry after 5 seconds on disconnect
      };
    }
  }
}
```

### sse() Method

The `sse()` method provides an alternative way to create SSE responses programmatically:

```typescript
@Controller('/events')
export class EventsController extends BaseController {
  /**
   * Using sse() method instead of @Sse() decorator
   */
  @Get('/manual')
  events(): Response {
    return this.sse(async function* () {
      yield { event: 'start', data: { timestamp: Date.now() } };

      for (let i = 0; i < 5; i++) {
        await Bun.sleep(1000);
        yield { event: 'progress', data: { percent: (i + 1) * 20 } };
      }

      yield { event: 'complete', data: { success: true } };
    }());
  }

  /**
   * Using sse() with heartbeat option
   */
  @Get('/with-heartbeat')
  eventsWithHeartbeat(): Response {
    const generator = async function* () {
      while (true) {
        await Bun.sleep(5000);
        yield { data: { ping: true } };
      }
    };

    return this.sse(generator(), { heartbeat: 10000 });
  }
}
```

### SSE Wire Format

OneBun automatically formats events according to the SSE specification:

```
event: tick
id: 123
retry: 5000
data: {"count":1,"timestamp":1699999999999}

```

For multi-line data:

```
data: {"line1":"value1",
data: "line2":"value2"}

```

### Client-Side Usage

```typescript
// Browser JavaScript
const eventSource = new EventSource('/events/stream');

eventSource.addEventListener('tick', (event) => {
  const data = JSON.parse(event.data);
  console.log('Tick:', data.count);
});

eventSource.addEventListener('error', (event) => {
  console.error('SSE error:', event);
});

// Close connection when done
eventSource.close();
```

### Comparison: @Sse() vs sse()

| Feature | @Sse() Decorator | sse() Method |
|---------|------------------|--------------|
| Use case | Dedicated SSE endpoints | Programmatic/conditional SSE |
| Syntax | `async *method()` generator | Return `this.sse(generator)` |
| Heartbeat | `@Sse({ heartbeat: ms })` | `this.sse(gen, { heartbeat: ms })` |
| Response type | Auto-wrapped | Explicit Response return |

**Use `@Sse()` when:**
- The endpoint is always an SSE stream
- You want cleaner async generator syntax
- You need built-in heartbeat support

**Use `sse()` when:**
- You need conditional SSE (sometimes SSE, sometimes JSON)
- You're composing generators from multiple sources
- You want more control over the Response object
