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

## Middleware

OneBun provides a class-based middleware system that operates at four levels: **application-wide**, **module-level**, **controller-level**, and **route-level**. All middleware extends `BaseMiddleware`, giving automatic access to a scoped logger, configuration, and full DI support through the constructor. Use the `@Middleware()` class decorator so that constructor dependencies are resolved automatically.

### BaseMiddleware

Every middleware class extends `BaseMiddleware` and implements the `use()` method. Use the `@Middleware()` decorator on the class so that constructor dependencies (if any) are resolved automatically:

```typescript
import { BaseMiddleware, Middleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';

@Middleware()
class RequestLogMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
    // Pre-processing: run before the handler
    // this.logger is scoped to the class name automatically
    this.logger.info(`${req.method} ${new URL(req.url).pathname}`);

    // Call next() to continue the chain (other middleware or the handler)
    const response = await next();

    // Post-processing: run after the handler (optional)
    response.headers.set('X-Request-Duration', String(Date.now()));

    return response;
  }
}
```

- `this.logger` — `SyncLogger` scoped to the middleware class name (e.g., `RequestLogMiddleware`)
- `this.config` — `IConfig` for reading environment variables
- `req` — the incoming `OneBunRequest` (extends `Request` with `.cookies` and `.params`)
- `next()` — calls the next middleware or the route handler; returns `OneBunResponse`
- Return an `OneBunResponse` directly to short-circuit the chain (e.g., for auth failures)

### Middleware with Dependency Injection

Middleware supports full constructor-based DI, just like controllers. Decorate the middleware class with `@Middleware()` so that the framework can resolve constructor dependencies automatically (TypeScript emits `design:paramtypes` when a class has a decorator). Inject any service available in the module's DI scope. You can still use `@Inject()` on parameters when needed.

```typescript
import { BaseMiddleware, Middleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';
import { AuthService } from './auth.service';

@Middleware()
class AuthMiddleware extends BaseMiddleware {
  constructor(private authService: AuthService) {
    super();
  }

  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
    const token = req.headers.get('Authorization');
    const secret = this.config.get('auth.jwtSecret');

    if (!this.authService.verify(token, secret)) {
      this.logger.warn('Authentication failed');
      return new Response(JSON.stringify({
        success: false, code: 401, message: 'Unauthorized',
      }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    return next();
  }
}
```

Middleware is instantiated **once** at application startup and reused for every request.

### Route-Level Middleware

Apply middleware to a single route handler using `@UseMiddleware()` as a method decorator. Pass **class constructors** (not instances):

```typescript
import { Controller, BaseController, Get, Post, UseMiddleware } from '@onebun/core';

@Controller('/api')
export class ApiController extends BaseController {
  @Get('/public')
  publicEndpoint() {
    return { message: 'Anyone can see this' };
  }

  @Post('/protected')
  @UseMiddleware(AuthMiddleware)
  protectedEndpoint() {
    return { message: 'Auth required' };
  }
}
```

You can pass multiple middleware to a single `@UseMiddleware()` — they execute left to right:

```typescript
@Post('/action')
@UseMiddleware(LogMiddleware, AuthMiddleware, RateLimitMiddleware)
action() {
  return { ok: true };
}
```

### Controller-Level Middleware

Apply middleware to **every route** in a controller by using `@UseMiddleware()` as a class decorator:

```typescript
import { Controller, BaseController, Get, Put, UseMiddleware } from '@onebun/core';

@Controller('/admin')
@UseMiddleware(AuthMiddleware)
export class AdminController extends BaseController {
  // AuthMiddleware runs before every handler in this controller

  @Get('/dashboard')
  getDashboard() {
    return { stats: { users: 100 } };
  }

  @Put('/settings')
  updateSettings() {
    return { updated: true };
  }
}
```

Controller-level middleware can be combined with route-level middleware. The execution order is always **controller -> route**:

```typescript
@Controller('/admin')
@UseMiddleware(AuthMiddleware)       // Runs first on all routes
export class AdminController extends BaseController {
  @Get('/dashboard')
  getDashboard() {
    // Only AuthMiddleware runs
    return { stats: {} };
  }

  @Put('/settings')
  @UseMiddleware(AuditLogMiddleware) // Runs second, only on this route
  updateSettings() {
    // AuthMiddleware, then AuditLogMiddleware
    return { updated: true };
  }
}
```

### Module-Level Middleware

Apply middleware to **all controllers within a module** (including controllers in imported child modules) by implementing the `OnModuleConfigure` interface:

```typescript
import {
  Module,
  type OnModuleConfigure,
  type MiddlewareClass,
} from '@onebun/core';
import { UserController } from './user.controller';
import { ProfileController } from './profile.controller';

@Module({
  controllers: [UserController, ProfileController],
})
export class UserModule implements OnModuleConfigure {
  configureMiddleware(): MiddlewareClass[] {
    return [TenantMiddleware];
  }
}
```

Module middleware is **inherited by child modules**. If `RootModule` imports `UserModule`, and both configure middleware, the execution order is: root module middleware -> user module middleware:

```typescript
@Module({
  imports: [UserModule, OrderModule],
  controllers: [HealthController],
})
export class AppModule implements OnModuleConfigure {
  configureMiddleware(): MiddlewareClass[] {
    return [RequestIdMiddleware]; // Applied to ALL controllers in AppModule + UserModule + OrderModule
  }
}
```

In this setup:
- `HealthController` gets: `[RequestIdMiddleware]`
- Controllers in `UserModule` get: `[RequestIdMiddleware, TenantMiddleware]`
- Controllers in `OrderModule` get: `[RequestIdMiddleware]` (if OrderModule has no own middleware)

### Application-Wide Middleware

Apply middleware to **every route in every controller** by passing the `middleware` option to `OneBunApplication`:

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';
import { RequestIdMiddleware, CorsMiddleware } from './middleware';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  middleware: [RequestIdMiddleware, CorsMiddleware],
});

await app.start();
```

Application-wide middleware runs **before** any module-level, controller-level or route-level middleware.

### Application-Wide Middleware with MultiServiceApplication

For multi-service setups, middleware can be defined at the application level (shared by all services) or per service:

```typescript
import { MultiServiceApplication } from '@onebun/core';

const app = new MultiServiceApplication({
  services: {
    users: { module: UsersModule, port: 3001 },
    orders: {
      module: OrdersModule,
      port: 3002,
      middleware: [OrderSpecificMiddleware], // Overrides app-level middleware
    },
  },
  middleware: [RequestIdMiddleware, CorsMiddleware], // Shared middleware for all services
});
```

### Middleware Execution Order

When all four levels are used, middleware executes in this order:

```
HTTP Request
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. Application-wide middleware              │
│    (ApplicationOptions.middleware)           │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 2. Module-level middleware                  │
│    (OnModuleConfigure.configureMiddleware()) │
│    Root module -> ... -> owner module       │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 3. Controller-level middleware              │
│    (@UseMiddleware on the class)            │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 4. Route-level middleware                   │
│    (@UseMiddleware on the method)           │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 5. Controller Handler                       │
└─────────────────────────────────────────────┘
    │
    ▼
  Response (flows back through the chain)
```

Each middleware can perform **pre-processing** (before `next()`) and **post-processing** (after `next()`) — similar to the "onion model."

### Real-World Examples

#### Custom Authentication Middleware

```typescript
import { BaseMiddleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';

export class JwtAuthMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      this.logger.warn('Missing or invalid Authorization header');
      return new Response(JSON.stringify({
        success: false,
        code: 401,
        message: 'Missing or invalid Authorization header',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate the token (your logic here)
    const token = authHeader.slice(7);
    this.logger.debug('Validating JWT token');
    // ... verify token, attach user info, etc.

    return next();
  }
}
```

#### Request Validation Middleware

```typescript
import { BaseMiddleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';

export class JsonOnlyMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      const contentType = req.headers.get('Content-Type');
      if (!contentType?.includes('application/json')) {
        this.logger.warn(`Invalid Content-Type: ${contentType}`);
        return new Response(JSON.stringify({
          success: false,
          code: 415,
          message: 'Content-Type must be application/json',
        }), {
          status: 415,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return next();
  }
}
```

#### Timing / Logging Middleware

```typescript
import { BaseMiddleware, type OneBunRequest, type OneBunResponse } from '@onebun/core';

export class TimingMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
    const start = performance.now();
    const response = await next();
    const duration = (performance.now() - start).toFixed(2);
    response.headers.set('X-Response-Time', `${duration}ms`);
    this.logger.info(`${req.method} ${new URL(req.url).pathname} — ${duration}ms`);
    return response;
  }
}
```

#### Combining All Levels

```typescript
// Global: runs on every request in the application
const app = new OneBunApplication(AppModule, {
  middleware: [RequestIdMiddleware, TimingMiddleware],
});

// Controller: runs on every route in AdminController
@Controller('/admin')
@UseMiddleware(JwtAuthMiddleware)
class AdminController extends BaseController {
  @Get('/stats')
  getStats() { /* ... */ }

  // Route: runs only on POST /admin/users, after JwtAuth
  @Post('/users')
  @UseMiddleware(JsonOnlyMiddleware)
  createUser() { /* ... */ }
}
```

For `GET /admin/stats`, the execution order is:
1. `RequestIdMiddleware` (global)
2. `TimingMiddleware` (global)
3. `JwtAuthMiddleware` (controller)
4. `getStats()` handler

For `POST /admin/users`, the execution order is:
1. `RequestIdMiddleware` (global)
2. `TimingMiddleware` (global)
3. `JwtAuthMiddleware` (controller)
4. `JsonOnlyMiddleware` (route)
5. `createUser()` handler

<!-- llm-only: Middleware is class-based, extending BaseMiddleware. All middleware classes have this.logger (SyncLogger scoped to class name) and this.config (IConfig). Full constructor DI is supported — inject any service from the module's DI scope. Middleware is instantiated once at startup. Pass class constructors (not instances) everywhere: @UseMiddleware(AuthMiddleware), ApplicationOptions.middleware: [CorsMiddleware], OnModuleConfigure.configureMiddleware(): [TenantMiddleware]. Middleware precedence is global → module → controller → route → handler. -->

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

> **Connection keep-alive:** SSE endpoints automatically get:
> - **Per-request timeout**: 600 seconds (10 minutes) by default, configurable via `@Sse({ timeout: seconds })` or `@Get('/path', { timeout: seconds })`. Set to `0` to disable.
> - **Heartbeat**: a comment (`: heartbeat\n\n`) sent every 30 seconds by default via the `@Sse()` decorator. Override with `@Sse({ heartbeat: ms })` or disable with `@Sse({ heartbeat: 0 })`.
> - The global `idleTimeout` (default: 120 seconds) applies to all other connections.
>
> For regular (non-SSE) endpoints that run long, use `@Get('/path', { timeout: 300 })` or `{ timeout: 0 }` to disable.

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
   * Default for @Sse() decorator: 30000 (30 seconds).
   * For sse() method: no default — set explicitly if needed.
   */
  heartbeat?: number;
}
```

### @Sse() Decorator

The `@Sse()` decorator marks a method as an SSE endpoint. The method should be an async generator that yields `SseEvent` objects. By default, a heartbeat is sent every 30 seconds and the per-request timeout is 600 seconds (10 minutes).

```typescript
@Sse()                           // defaults: heartbeat=30s, timeout=600s
@Sse({ heartbeat: 15000 })      // custom heartbeat, default timeout
@Sse({ timeout: 0 })            // no timeout, default heartbeat
@Sse({ heartbeat: 5000, timeout: 3600 })  // custom both
```

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

### Handling Client Disconnect (Abort)

When a client disconnects (via `AbortController`, `EventSource.close()`, or browser navigation), OneBun properly terminates the async generator by calling `iterator.return()`. This triggers the generator's `finally` block, providing a natural cleanup hook.

#### `try/finally` Cleanup (Idiomatic for `@Sse()`)

Use `try/finally` inside the generator to run cleanup logic on client disconnect. This is the recommended approach for `@Sse()` decorator endpoints:

```typescript
@Controller('/events')
export class EventsController extends BaseController {
  @Get('/stream')
  @Sse({ heartbeat: 15000 })
  async *stream(): SseGenerator {
    const subscription = this.eventService.subscribe();
    try {
      for await (const event of subscription) {
        yield { event: 'update', data: event };
      }
    } finally {
      // Runs when client disconnects -- cleanup resources
      subscription.unsubscribe();
    }
  }
}
```

#### SSE Proxy Pattern with `try/finally`

When proxying a 3rd party SSE stream, use `try/finally` to abort the upstream connection on client disconnect:

```typescript
@Controller('/proxy')
export class ProxyController extends BaseController {
  @Get('/events')
  @Sse()
  async *proxyEvents(): SseGenerator {
    const ac = new AbortController();
    try {
      const response = await fetch('https://api.example.com/events', {
        signal: ac.signal,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        yield { event: 'proxied', data: text };
      }
    } finally {
      // Client disconnected -- abort the upstream SSE connection
      ac.abort();
    }
  }
}
```

#### `onAbort` Callback (for `sse()` helper)

The `sse()` method accepts an `onAbort` callback that fires when the client disconnects. This is useful when you have cleanup logic that doesn't fit in a `try/finally`:

```typescript
@Controller('/events')
export class EventsController extends BaseController {
  @Get('/live')
  live(): Response {
    const subscription = this.eventService.subscribe();

    return this.sse(subscription, {
      heartbeat: 15000,
      onAbort: () => subscription.unsubscribe(),
    });
  }
}
```

#### Factory Function with `AbortSignal` (SSE proxy via `sse()`)

The `sse()` method also accepts a factory function `(signal: AbortSignal) => AsyncIterable`. The framework creates an `AbortController` internally and aborts it on client disconnect. This is the cleanest approach for SSE proxying with the `sse()` helper:

```typescript
@Controller('/proxy')
export class ProxyController extends BaseController {
  @Get('/events')
  proxy(): Response {
    return this.sse((signal) => this.proxyUpstream(signal));
  }

  private async *proxyUpstream(signal: AbortSignal): SseGenerator {
    const response = await fetch('https://api.example.com/events', { signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      yield { event: 'proxied', data: decoder.decode(value) };
    }
    // When client disconnects -> signal aborted -> fetch aborted automatically
  }
}
```

### Comparison: @Sse() vs sse()

| Feature | @Sse() Decorator | sse() Method |
|---------|------------------|--------------|
| Use case | Dedicated SSE endpoints | Programmatic/conditional SSE |
| Syntax | `async *method()` generator | Return `this.sse(generator)` |
| Heartbeat | `@Sse({ heartbeat: ms })` (default: 30s) | `this.sse(gen, { heartbeat: ms })` (no default) |
| Timeout | `@Sse({ timeout: s })` (default: 600s) | Use `@Get('/path', { timeout: s })` |
| Response type | Auto-wrapped | Explicit Response return |
| Disconnect cleanup | `try/finally` in generator | `onAbort` callback or `try/finally` |
| SSE proxy | `try/finally` + `AbortController` | Factory function with `AbortSignal` |

**Use `@Sse()` when:**
- The endpoint is always an SSE stream
- You want cleaner async generator syntax
- You need built-in heartbeat and timeout defaults

**Use `sse()` when:**
- You need conditional SSE (sometimes SSE, sometimes JSON)
- You're composing generators from multiple sources
- You want more control over the Response object
- You need the factory function pattern with `AbortSignal`

## File Uploads

OneBun supports file uploads via `multipart/form-data` and JSON with base64-encoded data. The framework auto-detects the content type and provides a unified `OneBunFile` object regardless of the upload method.

### Single File Upload

```typescript
import { Controller, Post, UploadedFile, MimeType, OneBunFile, BaseController } from '@onebun/core';

@Controller('/api/files')
export class FileController extends BaseController {
  @Post('/avatar')
  async uploadAvatar(
    @UploadedFile('avatar', {
      maxSize: 5 * 1024 * 1024,        // 5 MB
      mimeTypes: [MimeType.ANY_IMAGE],  // Any image type
    }) file: OneBunFile,
  ): Promise<Response> {
    // Write to disk
    await file.writeTo(`./uploads/${file.name}`);

    // Or convert to base64
    const base64 = await file.toBase64();

    // Or get as Buffer
    const buffer = await file.toBuffer();

    return this.success({
      filename: file.name,
      size: file.size,
      type: file.type,
    });
  }
}
```

### Multiple File Upload

```typescript
@Post('/documents')
async uploadDocuments(
  @UploadedFiles('docs', {
    maxCount: 10,
    maxSize: 10 * 1024 * 1024,
    mimeTypes: [MimeType.PDF, MimeType.DOCX],
  }) files: OneBunFile[],
): Promise<Response> {
  for (const file of files) {
    await file.writeTo(`./uploads/${file.name}`);
  }
  return this.success({ uploaded: files.length });
}
```

### File with Form Fields

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

### JSON Base64 Upload

The same decorators work for JSON bodies with base64-encoded files. The client can send:

```json
{
  "avatar": {
    "data": "iVBORw0KGgo...",
    "filename": "photo.png",
    "mimeType": "image/png"
  }
}
```

Or a simplified format:

```json
{
  "avatar": "iVBORw0KGgo..."
}
```

The controller code is identical — `@UploadedFile('avatar')` will work for both `multipart/form-data` and `application/json` content types.

::: warning
`@Body()` cannot be used on the same method as `@UploadedFile`, `@UploadedFiles`, or `@FormField`. Both consume the request body.
:::
