/**
 * Documentation Examples Tests for @onebun/core
 *
 * - packages/core/README.md
 * @source docs:api/core.md
 * @source docs:api/controllers.md
 * @source docs:api/decorators.md
 * @source docs:api/services.md
 * @source docs:api/validation.md
 * @source docs:api/websocket.md
 * @source docs:api/guards.md
 * @source docs:api/interceptors.md
 * @source docs:api/exception-filters.md
 * @source docs:api/security.md
 * @source docs:examples/basic-app.md
 * @source docs:examples/crud-api.md
 * @source docs:examples/websocket-chat.md
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';
import { Effect, type Layer } from 'effect';

import type {
  WsClientData,
  WsExecutionContext,
  WsServerType,
} from './';
import type {
  OnModuleInit,
  OnApplicationInit,
  OnModuleDestroy,
  BeforeApplicationDestroy,
  OnApplicationDestroy,
} from './';
// Not part of the documented public surface, so these stay internal imports.
import type { QueueAdapterConstructor } from './queue/types';
import type { QueueApplicationOptions } from './types';
import type { ServerWebSocket } from 'bun';

// Through the public specifier, not './types' or a deep path: the documentation tells
// readers to import these from '@onebun/core', and reaching past the barrel is exactly
// how `HttpGuard` stayed absent from it while every one of these tests passed.
import type {
  ExceptionFilter,
  Guard,
  QueueAdapter,
  SseEvent,
  SseGenerator,
  OneBunRequest,
  OneBunResponse,
  MiddlewareClass,
  OnModuleConfigure,
  ExecutionContext,
  HttpExecutionContext,
  HttpGuard,
  ValidationSchema,
  ApplicationOptions,
} from '@onebun/core';
import { type } from '@onebun/core';


import { registerDependencies } from './decorators/decorators';
import { createGlobalScope, OneBunModule } from './module/module';
import { MessageExecutionContextImpl } from './queue/guards';
import { makeMockLoggerLayer } from './testing';

import {
  All,
  Controller,
  Get,
  HttpMethod,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Header,
  Req,
  Cookie,
  Module,
  Global,
  isGlobalModule,
  Service,
  BaseService,
  BaseController,
  UseMiddleware,
  getControllerMiddleware,
  getServiceTag,
  getControllerMetadata,
  HttpStatusCode,
  ParamType,
  NotFoundError,
  InternalServerError,
  OneBunBaseError,
  Env,
  validate,
  validateOrThrow,
  DuplicateArkTypeError,
  hasDuplicateArkTypeCopies,
  isArkErrors,
  OneBunApplication,
  createServiceDefinition,
  createServiceClient,
  WebSocketGateway,
  getGatewayMetadata,
  BaseWebSocketGateway,
  OnConnect,
  OnDisconnect,
  OnJoinRoom,
  OnLeaveRoom,
  OnMessage,
  Client,
  Socket,
  MessageData,
  RoomName,
  PatternParams,
  WsServer,
  UseWsGuards,
  isHttpContext,
  isQueueContext,
  isWsContext,
  WsAuthGuard,
  WsPermissionGuard,
  WsAnyPermissionGuard,
  createGuard,
  createInMemoryWsStorage,
  SharedRedisProvider,
  Sse,
  getSseMetadata,
  formatSseEvent,
  createSseStream,
  createWsServiceDefinition,
  createWsClient,
  createNativeWsClient,
  matchPattern,
  hasOnModuleInit,
  hasOnApplicationInit,
  hasOnModuleDestroy,
  hasBeforeApplicationDestroy,
  hasOnApplicationDestroy,
  callOnModuleInit,
  callOnApplicationInit,
  callOnModuleDestroy,
  callBeforeApplicationDestroy,
  callOnApplicationDestroy,
  UploadedFile,
  UploadedFiles,
  FormField,
  OneBunFile,
  MimeType,
  matchMimeType,
  BaseMiddleware,
  DEFAULT_IDLE_TIMEOUT,
  DEFAULT_SSE_HEARTBEAT_MS,
  DEFAULT_SSE_TIMEOUT,
  UseGuards,
  AuthGuard,
  RolesGuard,
  createHttpGuard,
  HttpExecutionContextImpl,
  UseFilters,
  createExceptionFilter,
  defaultExceptionFilter,
  HttpException,
  UseInterceptors,
  createInterceptor,
  BaseInterceptor,
  LoggingInterceptor,
  TimeoutInterceptor,
  CorsMiddleware,
  RateLimitMiddleware,
  MemoryRateLimitStore,
  SecurityHeadersMiddleware,
  bindClientAddress,
  createClientAddressBinding,
  getClientAddress,
  getPeerAddress,
  Optional,
  CircularDependencyError,
  DependencyResolutionError,
  registerModule,
  resetRegistrations,
} from './';


/**
 * @source docs:index.md#minimal-working-example
 */
describe('Minimal Working Example (docs/index.md)', () => {
  it('should define complete counter application in single block', () => {
    // From docs/index.md: Minimal Working Example
    // This test validates all components work together

    // ============================================================================
    // 1. Environment Schema (src/config.ts)
    // ============================================================================
    const envSchema = {
      server: {
        port: Env.number({ default: 3000 }),
        host: Env.string({ default: '0.0.0.0' }),
      },
    };

    // ============================================================================
    // 2. Service Layer (src/counter.service.ts)
    // ============================================================================
    @Service()
    class CounterService extends BaseService {
      private value = 0;

      getValue(): number {
        return this.value;
      }

      increment(amount = 1): number {
        this.value += amount;

        return this.value;
      }
    }

    // ============================================================================
    // 3. Controller Layer (src/counter.controller.ts)
    // ============================================================================
    @Controller('/api/counter')
    class CounterController extends BaseController {
      constructor(private counterService: CounterService) {
        super();
      }

      @Get('/')
      async getValue(): Promise<Response> {
        const value = this.counterService.getValue();

        return this.success({ value });
      }

      @Post('/increment')
      async increment(@Body() body?: { amount?: number }): Promise<Response> {
        const newValue = this.counterService.increment(body?.amount);

        return this.success({ value: newValue });
      }
    }

    // ============================================================================
    // 4. Module Definition (src/app.module.ts)
    // ============================================================================
    @Module({
      controllers: [CounterController],
      providers: [CounterService],
    })
    class AppModule {}

    // ============================================================================
    // 5. Application Entry Point (src/index.ts)
    // ============================================================================
    const app = new OneBunApplication(AppModule, {
      port: 3000,
      envSchema,
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: true },
      tracing: { enabled: true },
    });

    // Verify all components
    expect(envSchema.server.port.type).toBe('number');
    expect(envSchema.server.host.type).toBe('string');
    expect(CounterService).toBeDefined();
    expect(CounterController).toBeDefined();
    expect(AppModule).toBeDefined();
    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
    expect(typeof app.stop).toBe('function');
  });

  /**
   * The sample's `.catch()` ends in `process.exit(1)` because a failed boot leaves a live
   * process that never binds a port. Pins the half a test can assert: `start()` rejects,
   * and nothing is listening afterwards.
   *
   * @source docs:index.md#minimal-working-example
   */
  it('should reject start() when boot fails, so the sample .catch() runs', async () => {
    @Service()
    class UnreachableBackendService extends BaseService implements OnModuleInit {
      async onModuleInit(): Promise<void> {
        throw new Error('backend unreachable at boot');
      }
    }

    @Module({ providers: [UnreachableBackendService] })
    class FailingModule {}

    const app = new OneBunApplication(FailingModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });

    await expect(app.start()).rejects.toThrow();

    // The HTTP server never bound — which is why the catch must exit non-zero
    expect(app.getPort()).toBe(0);
  });
});

describe('Core README Examples', () => {
  describe('Quick Start (README)', () => {
    it('should define controller with @Controller decorator', () => {
      // From README: Quick Start example
      @Controller('/api')
      class AppController extends BaseController {
        @Get('/hello')
        async hello() {
          return { message: 'Hello, OneBun!' };
        }
      }

      expect(AppController).toBeDefined();
    });

    it('should define module with @Module decorator', () => {
      // From README: Module definition
      @Controller('/api')
      class AppController extends BaseController {
        @Get('/hello')
        async hello() {
          return { message: 'Hello, OneBun!' };
        }
      }

      @Module({
        controllers: [AppController],
      })
      class AppModule {}

      expect(AppModule).toBeDefined();
    });
  });

  describe('Route Decorators (README)', () => {
    it('should define routes with HTTP method decorators', () => {
      // From README: Route Decorators example
      @Controller('/users')
      class UsersController extends BaseController {
        @Get()
        getAllUsers() {
          // Handle GET /users
          return [];
        }

        @Get('/:id')
        getUserById(@Param('id') id: string) {
          // Handle GET /users/:id
          return { id };
        }

        @Post()
        createUser(@Body() userData: unknown) {
          // Handle POST /users
          return userData;
        }

        @Put('/:id')
        updateUser(@Param('id') id: string, @Body() userData: unknown) {
          // Handle PUT /users/:id
          return { id, ...userData as object };
        }

        @Delete('/:id')
        deleteUser(@Param('id') id: string) {
          // Handle DELETE /users/:id
          return { deleted: id };
        }
      }

      expect(UsersController).toBeDefined();
    });
  });

  describe('Parameter Decorators (README)', () => {
    it('should use parameter decorators', () => {
      // From README: Parameter Decorators example
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/search')
        search(
          @Query('q') query: string,
          @Query('limit') limit: string,
        ) {
          // Handle GET /api/search?q=something&limit=10
          return { results: [], query, limit };
        }

        @Post('/users/:id/profile')
        updateProfile(
          @Param('id') userId: string,
          @Body() _profileData: unknown,
          @Header('Authorization') _token: string,
        ) {
          // Handle POST /api/users/123/profile
          return { success: true, userId };
        }
      }

      expect(ApiController).toBeDefined();
    });
  });

  describe('Middleware (README)', () => {
    it('should use middleware decorator', () => {
      // From README: Middleware example
      function loggerMiddleware(
        _req: OneBunRequest,
        next: () => Promise<OneBunResponse>,
      ): Promise<Response> {
        // eslint-disable-next-line no-console
        console.log('Request received');

        return next();
      }

      function authMiddleware(
        req: OneBunRequest,
        next: () => Promise<OneBunResponse>,
      ): Promise<Response> {
        const token = req.headers.get('Authorization');
        if (!token) {
          return Promise.resolve(new Response('Unauthorized', { status: 401 }));
        }

        return next();
      }

      @Controller('/admin')
      class AdminController extends BaseController {
        @Get('/dashboard')
        @UseMiddleware(loggerMiddleware, authMiddleware)
        getDashboard() {
          return { stats: {} };
        }
      }

      expect(AdminController).toBeDefined();
      expect(loggerMiddleware).toBeDefined();
      expect(authMiddleware).toBeDefined();
    });
  });

  describe('Services (README)', () => {
    it('should define service with @Service decorator', () => {
      // From README: Services example
      @Service()
      class UserService extends BaseService {
        private users: Array<{ id: string; name?: string }> = [];

        findAll() {
          return this.users;
        }

        findById(id: string) {
          return this.users.find((user) => user.id === id);
        }

        create(userData: { name: string }) {
          const user = { id: Date.now().toString(), ...userData };
          this.users.push(user);

          return user;
        }
      }

      expect(UserService).toBeDefined();
    });
  });

  describe('Modules (README)', () => {
    it('should define module with providers and exports', () => {
      // From README: Modules example
      @Service()
      class UsersService extends BaseService {}

      @Controller('/users')
      class UsersController extends BaseController {}

      @Module({
        controllers: [UsersController],
        providers: [UsersService],
      })
      class UsersModule {}

      expect(UsersModule).toBeDefined();
    });
  });
});

describe('Decorators API Documentation Examples', () => {
  describe('@Module() decorator (docs/api/decorators.md)', () => {
    it('should define module with all options', () => {
      @Service()
      class UserService extends BaseService {}

      @Controller('/api/users')
      class UserController extends BaseController {}

      // From docs: @Module() example
      @Module({
        imports: [], // Other modules to import
        controllers: [UserController],
        providers: [UserService],
        exports: [UserService],
      })
      class UserModule {}

      expect(UserModule).toBeDefined();
    });
  });

  describe('@Controller() decorator (docs/api/decorators.md)', () => {
    it('should define controller with base path', () => {
      // From docs: @Controller() example
      @Controller('/api/users')
      class UserController extends BaseController {
        // All routes will be prefixed with /api/users
      }

      expect(UserController).toBeDefined();
    });
  });

  describe('HTTP Method Decorators (docs/api/decorators.md)', () => {
    it('should support all HTTP methods', () => {
      // From docs: HTTP Method Decorators
      @Controller('/users')
      class UserController extends BaseController {
        @Get('/') // GET /users
        findAll() {
          return []; 
        }

        @Get('/:id') // GET /users/123
        findOne(@Param('id') _id: string) {
          return {}; 
        }

        @Get('/:userId/posts') // GET /users/123/posts
        getUserPosts(@Param('userId') _userId: string) {
          return []; 
        }

        @Post('/') // POST /users
        create(@Body() _body: unknown) {
          return {}; 
        }

        @Put('/:id') // PUT /users/123
        update(@Param('id') _id: string, @Body() _body: unknown) {
          return {}; 
        }

        @Delete('/:id') // DELETE /users/123
        remove(@Param('id') _id: string) {
          return {}; 
        }

        @Patch('/:id') // PATCH /users/123
        partialUpdate(@Param('id') _id: string, @Body() _body: unknown) {
          return {}; 
        }
      }

      expect(UserController).toBeDefined();
    });

    /**
     * @source docs:api/decorators.md#all-catch-all-routes
     */
    it('should route every verb to the @All() handler', async () => {
      // From docs: @All() — catch-all routes
      @Controller('/gateway')
      class GatewayController extends BaseController {
        @All('/proxy/:id')
        async proxy(@Param('id') id: string, @Req() req: OneBunRequest) {
          // req.method is whatever the client sent: GET, POST, PROPFIND, QUERY, ...
          return { id, method: req.method };
        }
      }

      @Module({ controllers: [GatewayController] })
      class GatewayModule {}

      const app = new OneBunApplication(GatewayModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();

      try {
        for (const method of ['GET', 'POST', 'PROPFIND', 'QUERY']) {
          const response = await fetch(`http://localhost:${app.getPort()}/gateway/proxy/9`, { method });
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ success: true, result: { id: '9', method } });
        }
      } finally {
        await app.stop();
      }
    });

    /**
     * @source docs:api/decorators.md#all-catch-all-routes
     */
    it('should give a concrete verb decorator priority over @All() on the same path', async () => {
      // From docs: @All() precedence example
      @Controller('/webhooks')
      class WebhookController extends BaseController {
        @All('/github')
        async fallback() {
          return { handled: 'all' };
        }

        @Get('/github')
        async health() {
          return { handled: 'get' };
        }
      }

      @Module({ controllers: [WebhookController] })
      class WebhookModule {}

      const app = new OneBunApplication(WebhookModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();

      try {
        const base = `http://localhost:${app.getPort()}/webhooks/github`;
        const get = await fetch(base, { method: 'GET' });
        expect(await get.json()).toEqual({ success: true, result: { handled: 'get' } });

        const put = await fetch(base, { method: 'PUT' });
        expect(await put.json()).toEqual({ success: true, result: { handled: 'all' } });
      } finally {
        await app.stop();
      }
    });
  });

  describe('Parameter Decorators (docs/api/decorators.md)', () => {
    it('should support @Param decorator', () => {
      // From docs: @Param() example
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/:id')
        findOne(
          @Param('id') id: string, // No validation
        ) {
          return { id };
        }
      }

      expect(ApiController).toBeDefined();
    });

    it('should support @Query decorator', () => {
      // From docs: @Query() example
      @Controller('/api')
      class ApiController extends BaseController {
        // GET /users?page=1&limit=10
        @Get('/users')
        findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
          return { page, limit };
        }
      }

      expect(ApiController).toBeDefined();
    });

    it('should support @Header decorator', () => {
      // From docs: @Header() example
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/protected')
        protected(
          @Header('Authorization') auth: string,
          @Header('X-Request-ID') requestId?: string,
        ) {
          return { auth: !!auth, requestId };
        }
      }

      expect(ApiController).toBeDefined();
    });

    it('should support @Req decorator', () => {
      // From docs: @Req() example
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/raw')
        handleRaw(@Req() request: Request) {
          const url = new URL(request.url);

          return { path: url.pathname };
        }
      }

      expect(ApiController).toBeDefined();
    });
  });

  describe('@Service() decorator (docs/api/decorators.md)', () => {
    it('should define service with auto-generated tag', () => {
      // From docs: @Service() example
      @Service()
      class UserService extends BaseService {
        async findAll(): Promise<unknown[]> {
          this.logger.info('Finding all users');

          return [];
        }
      }

      expect(UserService).toBeDefined();
    });
  });

  describe('@UseMiddleware() decorator (docs/api/decorators.md)', () => {
    it('should apply middleware to route handler', () => {
      // From docs: @UseMiddleware() example
      const authMiddleware = async (
        req: OneBunRequest,
        next: () => Promise<OneBunResponse>,
      ) => {
        const token = req.headers.get('Authorization');
        if (!token) {
          return new Response('Unauthorized', { status: 401 });
        }

        return await next();
      };

      const logMiddleware = async (
        _req: OneBunRequest,
        next: () => Promise<OneBunResponse>,
      ) => {
        // eslint-disable-next-line no-console
        console.log('Request logged');

        return await next();
      };

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/protected')
        @UseMiddleware(authMiddleware)
        protectedRoute() {
          return { message: 'Secret data' };
        }

        @Post('/action')
        @UseMiddleware(logMiddleware, authMiddleware) // Multiple middleware
        action() {
          return { message: 'Action performed' };
        }
      }

      expect(UserController).toBeDefined();
    });

    it('should apply middleware to all routes when used as class decorator (docs/api/decorators.md)', () => {
      // From docs: @UseMiddleware() class-level example
      const authMiddleware = async (
        req: OneBunRequest,
        next: () => Promise<OneBunResponse>,
      ) => {
        const token = req.headers.get('Authorization');
        if (!token) {
          return new Response('Unauthorized', { status: 401 });
        }

        return await next();
      };

      const auditLogMiddleware = async (
        _req: OneBunRequest,
        next: () => Promise<OneBunResponse>,
      ) => await next();

      @Controller('/admin')
      @UseMiddleware(authMiddleware) // Applied to ALL routes in this controller
      class AdminController extends BaseController {
        @Get('/dashboard')
        getDashboard() {
          return this.success({ stats: {} });
        }

        @Put('/settings')
        @UseMiddleware(auditLogMiddleware) // Additional middleware for this route
        updateSettings() {
          return this.success({ updated: true });
        }
      }

      expect(AdminController).toBeDefined();

      // Verify controller-level middleware is stored
      const ctrlMiddleware = getControllerMiddleware(AdminController);
      expect(ctrlMiddleware).toHaveLength(1);
      expect(ctrlMiddleware[0]).toBe(authMiddleware);

      // Verify route-level middleware is stored on the method
      const metadata = getControllerMetadata(AdminController);
      expect(metadata).toBeDefined();

      const settingsRoute = metadata!.routes.find((r) => r.path === '/settings');
      expect(settingsRoute?.middleware).toHaveLength(1);
      expect(settingsRoute!.middleware![0]).toBe(auditLogMiddleware);

      // The dashboard route should have no route-level middleware (only controller-level)
      const dashboardRoute = metadata!.routes.find((r) => r.path === '/dashboard');
      expect(dashboardRoute?.middleware?.length ?? 0).toBe(0);
    });
  });
});

describe('Controllers API Documentation Examples', () => {
  describe('BaseController (docs/api/controllers.md)', () => {
    it('should extend BaseController for built-in features', () => {
      @Service()
      class UserService extends BaseService {
        findAll() {
          return [];
        }
      }

      // From docs: Usage example
      @Controller('/users')
      class UserController extends BaseController {
        constructor(private userService: UserService) {
          super(); // Always call super()
        }

        @Get('/')
        async findAll(): Promise<Response> {
          const users = this.userService.findAll();

          return this.success(users);
        }
      }

      expect(UserController).toBeDefined();
    });

    /**
     * @source docs:api/controllers.md#basecontroller
     * Controllers have this.config and this.logger available immediately after super()
     */
    it('should have config and logger available in controller constructor after super()', async () => {
      const constructorSaw: Record<string, unknown> = {};

      @Service()
      class UserService extends BaseService {
        label(): string {
          return 'users';
        }
      }

      // From docs: Controller with constructor access to config and logger
      @Controller('/users')
      class UserController extends BaseController {
        private readonly bootLabel: string;

        constructor(private userService: UserService) {
          super();
          // config and logger are available immediately after super()
          // e.g. this.config.get('api.prefix'), this.logger.info('...')
          this.logger.info('UserController constructed');
          this.bootLabel = this.userService.label();
          constructorSaw.logger = typeof this.logger.info;
          constructorSaw.configInitialized = this.config.isInitialized;
          constructorSaw.configKeys = Object.keys(this.config.values).length > 0;
          constructorSaw.injected = this.bootLabel;
        }

        @Get('/boot')
        boot() {
          return { bootLabel: this.bootLabel };
        }
      }

      @Module({ controllers: [UserController], providers: [UserService] })
      class UserModule {}

      const app = new OneBunApplication(UserModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
        envSchema: { server: { port: Env.number({ default: 3000, env: 'DOCS_CTOR_PORT' }) } },
      });
      await app.start();

      try {
        // Not "the class was declared": the framework set the ambient init context BEFORE
        // `new UserController(...)`, so the logger logged, the config was already loaded
        // (a NotInitializedConfig would have thrown on .values) and the injected service
        // answered — all inside the constructor body, right after super().
        // The config VALUES are not asserted: TypedEnv keys its instances process-wide,
        // so whichever suite in this file starts an app first owns the schema.
        expect(constructorSaw).toEqual({
          logger: 'function',
          configInitialized: true,
          configKeys: true,
          injected: 'users',
        });

        // And what the constructor computed survives onto the live instance.
        const response = await fetch(`${app.getHttpUrl()}/users/boot`);
        expect(response.status).toBe(HttpStatusCode.OK);
        expect(await response.json()).toEqual({ success: true, result: { bootLabel: 'users' } });
      } finally {
        await app.stop();
      }
    });
  });

  describe('Response Methods (docs/api/controllers.md)', () => {
    it('should have success() method', async () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Get('/')
        async test(): Promise<Response> {
          // From docs: success() examples
          return this.success({ name: 'John', age: 30 });
        }
      }

      expect(TestController).toBeDefined();
    });

    it('should have error() method', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Get('/:id')
        async findOne(): Promise<Response> {
          // From docs: error() examples
          return this.error('User not found', 404, 404);
        }
      }

      expect(TestController).toBeDefined();
    });

    it('should have json() method', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Get('/')
        async test(): Promise<Response> {
          return this.json({ data: 'test' });
        }
      }

      expect(TestController).toBeDefined();
    });

    /**
     * @source docs:api/controllers.md#text
     */
    it('should have text() method', async () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Get('/health')
        async health(): Promise<Response> {
          // From docs: text() example
          return this.text('OK');
        }

        @Get('/version')
        async version(): Promise<Response> {
          return this.text('1.0.0', 200);
        }
      }

      const controller = new TestController();

      // "Create plain text response": the body is the string verbatim — no { success, result }
      // envelope, no JSON quoting — with text/plain and a 200 default.
      const health = await controller.health();
      expect(health.status).toBe(HttpStatusCode.OK);
      expect(health.headers.get('content-type')).toBe('text/plain');
      expect(await health.text()).toBe('OK');

      const version = await controller.version();
      expect(version.status).toBe(HttpStatusCode.OK);
      expect(version.headers.get('content-type')).toBe('text/plain');
      expect(await version.text()).toBe('1.0.0');
    });
  });

  describe('Request Helpers (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#isjson
     */
    it('should let a JSON content type through isJson() and turn every other one away', async () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/')
        async create(@Req() req: Request): Promise<Response> {
          // From docs: isJson() example
          if (!this.isJson(req)) {
            return this.error('Content-Type must be application/json', 400, 400);
          }

          return this.success({ received: true });
        }
      }

      const controller = new TestController();
      const post = async (contentType?: string): Promise<Response> => await controller.create(
        new Request('http://localhost/test', {
          method: 'POST',
          // No body for the "no content-type" case: a string body makes Bun set text/plain itself
          body: contentType === undefined ? undefined : '{"a":1}',
          headers: new Headers(contentType === undefined ? [] : [['content-type', contentType]]),
        }),
      );

      // "Check if request has JSON content type" — the documented content type passes, and so
      // does the same type carrying parameters, because the check is a substring one
      const json = await post('application/json');
      expect(json.status).toBe(HttpStatusCode.OK);
      expect(await json.json()).toEqual({ success: true, result: { received: true } });
      expect((await post('application/json; charset=utf-8')).status).toBe(HttpStatusCode.OK);

      // Everything else is rejected — the guard is what produces the documented 400
      const plain = await post('text/plain');
      expect(plain.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await plain.json()).toEqual({
        success: false,
        error: 'Content-Type must be application/json',
        code: 400,
        details: {},
      });
      expect((await post('application/x-www-form-urlencoded')).status).toBe(HttpStatusCode.BAD_REQUEST);

      // ...including a request that carries no Content-Type at all
      expect((await post()).status).toBe(HttpStatusCode.BAD_REQUEST);
    });

    /**
     * @source docs:api/controllers.md#parsejson
     */
    it('should parse the request body with parseJson() when @Body is not used', async () => {
      interface CreateUserDto {
        name: string;
        email: string;
      }

      const seen: CreateUserDto[] = [];

      @Controller('/test')
      class TestController extends BaseController {
        @Post('/')
        async create(@Req() req: Request): Promise<Response> {
          // From docs: parseJson() example
          const body = await this.parseJson<CreateUserDto>(req);
          seen.push(body);

          return this.success(body);
        }
      }

      const controller = new TestController();
      const payload = { name: 'John', email: 'john@example.com' };

      // "Parse JSON from request body (when not using @Body decorator)" — the handler gets the
      // decoded object, not a string, and it is the request's own body
      const jsonHeaders = new Headers([['content-type', 'application/json']]);
      const response = await controller.create(new Request('http://localhost/test', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: jsonHeaders,
      }));

      expect(seen).toEqual([payload]);
      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: payload });

      // A malformed body is not swallowed into `undefined` — the promise rejects
      await expect(controller.create(new Request('http://localhost/test', {
        method: 'POST',
        body: 'not json',
        headers: jsonHeaders,
      }))).rejects.toThrow();
      expect(seen).toEqual([payload]);
    });
  });

  describe('Accessing Logger (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#accessing-logger
     */
    it('should have access to logger', async () => {
      interface LogEntry {
        level: string;
        message: string;
        args: unknown[];
      }
      interface RecordingLogger {
        trace(message: string, ...args: unknown[]): void;
        debug(message: string, ...args: unknown[]): void;
        info(message: string, ...args: unknown[]): void;
        warn(message: string, ...args: unknown[]): void;
        error(message: string, ...args: unknown[]): void;
        fatal(message: string, ...args: unknown[]): void;
        child(context: Record<string, unknown>): RecordingLogger;
      }

      const entries: LogEntry[] = [];
      const childContexts: Record<string, unknown>[] = [];
      const record = (level: string) => (message: string, ...args: unknown[]): void => {
        entries.push({ level, message, args });
      };
      const recorder: RecordingLogger = {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        fatal: record('fatal'),
        child(context: Record<string, unknown>): RecordingLogger {
          childContexts.push(context);

          return recorder;
        },
      };

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        async findAll(): Promise<Response> {
          // From docs: Accessing Logger example
          // Log levels: trace, debug, info, warn, error, fatal
          this.logger.info('Finding all users');
          this.logger.debug('Request received', { timestamp: 1699999999999 });
          this.logger.trace('trace level');
          this.logger.warn('warn level');
          this.logger.error('error level');
          this.logger.fatal('fatal level');

          return this.success([]);
        }
      }

      const { createMockConfig } = await import('./testing/test-utils');
      const controller = new UserController();
      controller.initializeController(recorder, createMockConfig());

      // The logger installed on the controller is a child scoped to the controller class.
      expect(childContexts).toEqual([{ className: 'UserController' }]);

      entries.length = 0;
      const response = await controller.findAll();
      expect(response.status).toBe(HttpStatusCode.OK);

      // Every documented level reaches the logger, with the message and the metadata
      // object exactly as the handler passed them.
      expect(entries).toEqual([
        { level: 'info', message: 'Finding all users', args: [] },
        { level: 'debug', message: 'Request received', args: [{ timestamp: 1699999999999 }] },
        { level: 'trace', message: 'trace level', args: [] },
        { level: 'warn', message: 'warn level', args: [] },
        { level: 'error', message: 'error level', args: [] },
        { level: 'fatal', message: 'fatal level', args: [] },
      ]);
    });
  });

  describe('Accessing Configuration (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#accessing-configuration
     */
    it('should have access to config', async () => {
      @Controller('/users')
      class UserController extends BaseController {
        @Get('/info')
        async info() {
          // From docs: Accessing Configuration example
          const port = this.config.get('server.port');    // number
          const appName = this.config.get('app.name');    // string

          return {
            port,
            appName,
            configAvailable: this.config.isInitialized,
          };
        }
      }

      const { createMockConfig, createMockSyncLogger } = await import('./testing/test-utils');
      const controller = new UserController();
      // A started application cannot pin the VALUES here: TypedEnv keys its instances
      // process-wide, so whichever suite in this file boots first owns the schema. The
      // config is injected the same way the framework injects it, and the handler is
      // then run for real.
      controller.initializeController(createMockSyncLogger(), createMockConfig({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'server.port': 3000,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'app.name': 'docs-example-app',
      }));

      // Each documented path is read through this.config and reaches the response, typed
      // as the schema declares it (3000 as a number, not '3000'), alongside isInitialized.
      expect(await controller.info()).toEqual({
        port: 3000,
        appName: 'docs-example-app',
        configAvailable: true,
      });

      // And the documented failure mode: without an envSchema the config is not
      // initialized, and reading it says so instead of returning undefined.
      const unconfigured = new UserController();
      unconfigured.initializeController(createMockSyncLogger(), createMockConfig({}, { isInitialized: false }));
      await expect(unconfigured.info()).rejects.toThrow('Configuration not initialized');
    });
  });

  describe('HTTP Status Codes (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#http-status-codes
     */
    it('should use HttpStatusCode enum', () => {
      @Controller('/users')
      class UserController extends BaseController {
        @Get('/:id')
        async findOne(@Param('id') _id: string): Promise<Response> {
          // From docs: HTTP Status Codes example
          const user = null; // Simulated not found
          if (!user) {
            return this.error('Not found', HttpStatusCode.NOT_FOUND, HttpStatusCode.NOT_FOUND);
          }

          return this.success(user, HttpStatusCode.OK);
        }

        @Post('/')
        async create(@Body() _body: unknown): Promise<Response> {
          return this.success({ id: '123' }, HttpStatusCode.CREATED);
        }
      }

      expect(UserController).toBeDefined();
      expect(HttpStatusCode.OK).toBe(200);
      expect(HttpStatusCode.CREATED).toBe(201);
      expect(HttpStatusCode.NOT_FOUND).toBe(404);
    });

    /**
     * @source docs:api/controllers.md#http-status-codes
     */
    it('should have all documented status codes', () => {
      // From docs: Available Status Codes
      expect(HttpStatusCode.OK).toBe(200);
      expect(HttpStatusCode.CREATED).toBe(201);
      expect(HttpStatusCode.NO_CONTENT).toBe(204);
      expect(HttpStatusCode.BAD_REQUEST).toBe(400);
      expect(HttpStatusCode.UNAUTHORIZED).toBe(401);
      expect(HttpStatusCode.FORBIDDEN).toBe(403);
      expect(HttpStatusCode.NOT_FOUND).toBe(404);
      expect(HttpStatusCode.CONFLICT).toBe(409);
      expect(HttpStatusCode.INTERNAL_SERVER_ERROR).toBe(500);
    });
  });
});

describe('Middleware API Documentation Examples (docs/api/controllers.md)', () => {
  describe('BaseMiddleware (docs/api/controllers.md#basemiddleware)', () => {
    it('should define a middleware class extending BaseMiddleware', () => {
      // From docs: BaseMiddleware example
      class RequestLogMiddleware extends BaseMiddleware {
        async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          this.logger.info(`${req.method} ${new URL(req.url).pathname}`);
          const response = await next();
          response.headers.set('X-Request-Duration', String(Date.now()));

          return response;
        }
      }

      expect(RequestLogMiddleware.prototype).toBeInstanceOf(BaseMiddleware);
      // eslint-disable-next-line jest/unbound-method
      expect(RequestLogMiddleware.prototype.use).toBeInstanceOf(Function);
    });
  });

  describe('Route-Level Middleware (docs/api/controllers.md#route-level-middleware)', () => {
    it('should apply middleware to individual routes', () => {
      // From docs: Route-Level Middleware example
      class AuthMiddleware extends BaseMiddleware {
        async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          const token = req.headers.get('Authorization');
          if (!token) {
            return new Response('Unauthorized', { status: 401 });
          }

          return await next();
        }
      }

      @Controller('/api')
      class ApiController extends BaseController {
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

      const metadata = getControllerMetadata(ApiController);
      expect(metadata).toBeDefined();

      const publicRoute = metadata!.routes.find((r) => r.path === '/public');
      expect(publicRoute?.middleware?.length ?? 0).toBe(0);

      const protectedRoute = metadata!.routes.find((r) => r.path === '/protected');
      expect(protectedRoute?.middleware).toHaveLength(1);
      expect(protectedRoute!.middleware![0]).toBe(AuthMiddleware);
    });
  });

  describe('Controller-Level Middleware (docs/api/controllers.md#controller-level-middleware)', () => {
    it('should apply middleware to all routes via class decorator', () => {
      // From docs: Controller-Level Middleware example
      class AuthMiddleware extends BaseMiddleware {
        async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          const token = req.headers.get('Authorization');
          if (!token) {
            return new Response('Unauthorized', { status: 401 });
          }

          return await next();
        }
      }

      @Controller('/admin')
      @UseMiddleware(AuthMiddleware)
      class AdminController extends BaseController {
        @Get('/dashboard')
        getDashboard() {
          return { stats: { users: 100 } };
        }

        @Put('/settings')
        updateSettings() {
          return { updated: true };
        }
      }

      // Controller-level middleware is stored separately
      const ctrlMiddleware = getControllerMiddleware(AdminController);
      expect(ctrlMiddleware).toHaveLength(1);
      expect(ctrlMiddleware[0]).toBe(AuthMiddleware);
    });

    it('should combine controller-level and route-level middleware', () => {
      // From docs: Combined controller + route middleware example
      class AuthMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next();
        }
      }

      class AuditLogMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next();
        }
      }

      @Controller('/admin')
      @UseMiddleware(AuthMiddleware) // Runs first on all routes
      class AdminController extends BaseController {
        @Get('/dashboard')
        getDashboard() {
          return { stats: {} };
        }

        @Put('/settings')
        @UseMiddleware(AuditLogMiddleware) // Runs second, only on this route
        updateSettings() {
          return { updated: true };
        }
      }

      // Controller-level middleware
      const ctrlMiddleware = getControllerMiddleware(AdminController);
      expect(ctrlMiddleware).toHaveLength(1);
      expect(ctrlMiddleware[0]).toBe(AuthMiddleware);

      // Route-level middleware only on /settings
      const metadata = getControllerMetadata(AdminController);
      const settingsRoute = metadata!.routes.find((r) => r.path === '/settings');
      expect(settingsRoute?.middleware).toHaveLength(1);
      expect(settingsRoute!.middleware![0]).toBe(AuditLogMiddleware);

      const dashboardRoute = metadata!.routes.find((r) => r.path === '/dashboard');
      expect(dashboardRoute?.middleware?.length ?? 0).toBe(0);
    });
  });

  describe('Application-Wide Middleware (docs/api/controllers.md#application-wide-middleware)', () => {
    it('should accept middleware classes in ApplicationOptions', () => {
      // From docs: Application-Wide Middleware example
      class RequestIdMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          const response = await next();
          response.headers.set('X-Request-ID', crypto.randomUUID());

          return response;
        }
      }

      class ExampleCorsMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          const response = await next();
          response.headers.set('Access-Control-Allow-Origin', '*');

          return response;
        }
      }

      // Verify that middleware option is accepted by OneBunApplication
      // (We don't start the app, just verify the type/constructor accepts it)
      @Module({
        controllers: [],
        providers: [],
      })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        middleware: [RequestIdMiddleware, ExampleCorsMiddleware],
      });

      expect(app).toBeDefined();
    });
  });

  describe('Middleware Execution Order (docs/api/controllers.md#middleware-execution-order)', () => {
    it('should support all four middleware levels together', () => {
      // From docs: Combining All Levels example
      class RequestIdMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next(); 
        }
      }

      class TimingMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next(); 
        }
      }

      class JwtAuthMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next(); 
        }
      }

      class JsonOnlyMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next(); 
        }
      }

      @Controller('/admin')
      @UseMiddleware(JwtAuthMiddleware)
      class AdminController extends BaseController {
        @Get('/stats')
        getStats() {
          return { stats: {} };
        }

        @Post('/users')
        @UseMiddleware(JsonOnlyMiddleware)
        createUser() {
          return { created: true };
        }
      }

      // Verify controller middleware
      const ctrlMiddleware = getControllerMiddleware(AdminController);
      expect(ctrlMiddleware).toHaveLength(1);
      expect(ctrlMiddleware[0]).toBe(JwtAuthMiddleware);

      // Verify route-level middleware on /users only
      const metadata = getControllerMetadata(AdminController);
      const statsRoute = metadata!.routes.find((r) => r.path === '/stats');
      expect(statsRoute?.middleware?.length ?? 0).toBe(0);

      const usersRoute = metadata!.routes.find((r) => r.path === '/users');
      expect(usersRoute?.middleware).toHaveLength(1);
      expect(usersRoute!.middleware![0]).toBe(JsonOnlyMiddleware);

      // Global middleware would be set via ApplicationOptions.middleware
      @Module({
        controllers: [AdminController],
        providers: [],
      })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        middleware: [RequestIdMiddleware, TimingMiddleware],
      });

      expect(app).toBeDefined();
    });
  });

  describe('Real-World Middleware Examples (docs/api/controllers.md#real-world-examples)', () => {
    it('should define custom authentication middleware', () => {
      // From docs: Custom Authentication Middleware example
      class JwtAuthMiddleware extends BaseMiddleware {
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
              // eslint-disable-next-line @typescript-eslint/naming-convention
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Validate the token (your logic here)
          this.logger.debug(`Validating JWT token: ${authHeader.slice(7).substring(0, 8)}...`);

          return await next();
        }
      }

      expect(JwtAuthMiddleware.prototype).toBeInstanceOf(BaseMiddleware);
    });

    it('should define request validation middleware', () => {
      // From docs: Request Validation Middleware example
      class JsonOnlyMiddleware extends BaseMiddleware {
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
                // eslint-disable-next-line @typescript-eslint/naming-convention
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }

          return await next();
        }
      }

      expect(JsonOnlyMiddleware.prototype).toBeInstanceOf(BaseMiddleware);
    });

    it('should define timing/logging middleware', () => {
      // From docs: Timing / Logging Middleware example
      class TimingMiddleware extends BaseMiddleware {
        async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          const start = performance.now();
          const response = await next();
          const duration = (performance.now() - start).toFixed(2);
          response.headers.set('X-Response-Time', `${duration}ms`);
          this.logger.info(`${req.method} ${new URL(req.url).pathname} — ${duration}ms`);

          return response;
        }
      }

      expect(TimingMiddleware.prototype).toBeInstanceOf(BaseMiddleware);
    });
  });

  describe('Module-Level Middleware (docs/api/controllers.md#module-level-middleware)', () => {
    it('should define module-level middleware via OnModuleConfigure interface', () => {
      // From docs: Module-Level Middleware example
      class TenantMiddleware extends BaseMiddleware {
        async use(req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          const tenantId = req.headers.get('X-Tenant-ID');
          if (!tenantId) {
            return new Response('Missing X-Tenant-ID', { status: 400 });
          }

          return await next();
        }
      }

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        getUsers() {
          return [];
        }
      }

      @Module({
        controllers: [UserController],
      })
      class UserModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [TenantMiddleware];
        }
      }

      // Verify the module class has configureMiddleware
      const instance = new UserModule();
      const middleware = instance.configureMiddleware();
      expect(middleware).toHaveLength(1);
      expect(middleware[0]).toBe(TenantMiddleware);
    });

    it('should inherit module middleware in child modules', () => {
      // From docs: Module middleware inheritance example
      class RequestIdMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next();
        }
      }

      class TenantMiddleware extends BaseMiddleware {
        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
          return await next();
        }
      }

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        getUsers() {
          return [];
        }
      }

      @Module({
        controllers: [UserController],
      })
      class UserModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [TenantMiddleware];
        }
      }

      @Controller('/health')
      class HealthController extends BaseController {
        @Get('/')
        health() {
          return { ok: true };
        }
      }

      @Module({
        imports: [UserModule],
        controllers: [HealthController],
      })
      class AppModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [RequestIdMiddleware];
        }
      }

      // Verify both modules have configureMiddleware
      const appInstance = new AppModule();
      expect(appInstance.configureMiddleware()).toHaveLength(1);
      expect(appInstance.configureMiddleware()[0]).toBe(RequestIdMiddleware);

      const userInstance = new UserModule();
      expect(userInstance.configureMiddleware()).toHaveLength(1);
      expect(userInstance.configureMiddleware()[0]).toBe(TenantMiddleware);
    });
  });
});

describe('Services API Documentation Examples', () => {
  describe('BaseService (docs/api/services.md)', () => {
    it('should create basic service', () => {
      // From docs: Basic Service example
      @Service()
      class CounterService extends BaseService {
        private count = 0;

        increment(): number {
          this.count++;
          this.logger.debug('Counter incremented', { count: this.count });

          return this.count;
        }

        decrement(): number {
          this.count--;

          return this.count;
        }

        getValue(): number {
          return this.count;
        }
      }

      expect(CounterService).toBeDefined();
    });

    it('should create service with dependencies', () => {
      // From docs: Service with Dependencies example
      @Service()
      class UserRepository extends BaseService {}

      @Service()
      class UserService extends BaseService {
        // Dependencies are auto-injected via constructor
        // Logger and config are available immediately after super()
        constructor(private repository: UserRepository) {
          super();
        }
      }

      expect(UserService).toBeDefined();
    });

    /**
     * @source docs:api/services.md#baseservice
     * Services have this.config and this.logger available immediately after super()
     */
    it('should have config and logger available in service constructor after super()', async () => {
      const effectLib = await import('effect');
      const loggerMod = await import('@onebun/logger');
      const { createMockConfig, createMockLogger } = await import('./testing');

      const infoCalls: Array<{ message: string; args: unknown[] }> = [];
      const base = createMockLogger();
      // Recording, not silent: `this.logger` read inside the constructor must be the
      // application's logger, not something the service invented for itself.
      const recording: typeof base = {
        ...base,
        info(message: string, ...args: unknown[]) {
          infoCalls.push({ message, args });

          return base.info(message, ...args);
        },
        child: () => recording,
      };

      // From docs: "Available after super() in constructor" — the constructor body reads
      // both, so a framework that stopped setting the ambient init context would throw
      // here rather than quietly hand back an undefined.
      @Service()
      class ConfiguredService extends BaseService {
        readonly connectionUrl: string;
        readonly maxConnections: number;

        constructor() {
          super();
          this.connectionUrl = this.config.get('database.url') as string;
          this.maxConnections = this.config.get('database.maxConnections') as number;
          this.logger.info('Service constructed', { url: this.connectionUrl });
        }
      }

      @Module({ providers: [ConfiguredService] })
      class ConfiguredModule {}

      const config = createMockConfig({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'database.url': 'postgres://localhost/app',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'database.maxConnections': 20,
      });
      const module = new OneBunModule(
        ConfiguredModule,
        effectLib.Layer.succeed(loggerMod.LoggerService, recording),
        config,
        undefined,
        undefined,
        createGlobalScope(),
      );

      const service = module.getServiceByClass(ConfiguredService) as ConfiguredService;

      // The values the constructor captured are the ones the framework injected...
      expect(service).toBeInstanceOf(ConfiguredService);
      expect(service.connectionUrl).toBe('postgres://localhost/app');
      expect(service.maxConnections).toBe(20);
      // ...and the logger it used in the constructor body was the application's.
      expect(infoCalls).toEqual([
        { message: 'Service constructed', args: [{ url: 'postgres://localhost/app' }] },
      ]);
      // From docs: `get isInitialized(): boolean` reports the injection happened.
      expect((service as unknown as { isInitialized: boolean }).isInitialized).toBe(true);
    });
  });

  describe('getServiceTag (docs/api/services.md)', () => {
    /**
     * @source docs:api/services.md#service-tags-advanced
     */
    it('should get service tag from class', async () => {
      const effectLib = await import('effect');
      const { createMockConfig } = await import('./testing');

      // From docs: "Create custom tag" + `@Service(UserServiceTag)`
      interface DocsUser { id: string }

       
      const UserServiceTag = effectLib.Context.GenericTag<UserService>('UserService');

      @Service(UserServiceTag)
      class UserService extends BaseService {
        async findAll(): Promise<DocsUser[]> {
          return [{ id: 'u-1' }];
        }
      }

      // The explicit tag is the tag the framework registers the service under — not a
      // look-alike minted from the class name.
      expect(getServiceTag(UserService)).toBe(UserServiceTag);

      // And without one, `@Service()` mints a tag keyed by the class name.
      @Service()
      class PlainService extends BaseService {}

      expect(getServiceTag(PlainService).key).toBe('PlainService');

      // A class that never got the decorator has no tag at all.
      class Undecorated extends BaseService {}
      expect(() => getServiceTag(Undecorated)).toThrow(/does not have @Service decorator/);

      @Module({ providers: [UserService] })
      class UserModule {}

      const module = new OneBunModule(
        UserModule,
        makeMockLoggerLayer(),
        createMockConfig({}),
        undefined,
        undefined,
        createGlobalScope(),
      );
      const instance = module.getServiceByClass(UserService) as UserService;

      // The module's instance registry is keyed by that very tag.
      expect(
        module.getAllServiceInstances().get(
          UserServiceTag as unknown as import('effect').Context.Tag<unknown, unknown>,
        ),
      ).toBe(instance);

      // From docs: "Use in Effect-based code" — the documented program, run for real.
      const program = effectLib.pipe(
        UserServiceTag,
        effectLib.Effect.flatMap((userService) => effectLib.Effect.promise(() => userService.findAll())),
      );

      const users = await effectLib.Effect.runPromise(
        effectLib.Effect.provide(program, effectLib.Context.make(UserServiceTag, instance)),
      );
      expect(users).toEqual([{ id: 'u-1' }]);
    });
  });

  describe('BaseService Methods (docs/api/services.md)', () => {
    /**
     * @source docs:api/services.md#class-definition
     */
    it('should run an effect and surface its value through runEffect()', async () => {
      const effectLib = await import('effect');

      // From docs: "Run an effect with error handling" — the documented Effect → Promise bridge,
      // exposed through a public method because the helper itself is protected.
      @Service()
      class DataService extends BaseService {
        async fetchData(id: string): Promise<{ id: string }> {
          return await this.runEffect(effectLib.pipe(
            effectLib.Effect.promise(async () => ({ id })),
            effectLib.Effect.map((data) => ({ ...data })),
          ) as never);
        }

        async fail(error: unknown): Promise<never> {
          return await this.runEffect(effectLib.Effect.fail(error) as never);
        }
      }

      const service = new DataService();

      // The success channel of the effect is what the promise resolves with
      expect(await service.fetchData('d-1')).toEqual({ id: 'd-1' });

      // ...and a failed effect rejects rather than resolving with undefined, with an Error
      // (runEffect routes every failure through formatError) that still names the cause.
      await expect(service.fail(new Error('fetch exploded'))).rejects.toThrow('fetch exploded');
      const thrown = await service.fail('plain string failure').catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(Error);
      expect(String((thrown as Error).message)).toContain('plain string failure');
    });

    /**
     * @source docs:api/services.md#class-definition
     */
    it('should normalise any thrown value into an Error through formatError()', () => {
      // From docs: "Format an error for consistent handling"
      @Service()
      class FailingService extends BaseService {
        normalise(error: unknown): Error {
          return this.formatError(error);
        }
      }

      const service = new FailingService();

      // An Error is passed through untouched — same object, so `instanceof` checks on custom
      // error subclasses in caller code keep working
      const original = new TypeError('bad type');
      expect(service.normalise(original)).toBe(original);

      // Everything else becomes an Error carrying the stringified value
      const fromString = service.normalise('boom');
      expect(fromString).toBeInstanceOf(Error);
      expect(fromString.message).toBe('boom');
      expect(service.normalise(42).message).toBe('42');
      expect(service.normalise(undefined).message).toBe('undefined');
      expect(service.normalise({ code: 'E_FAIL' }).message).toBe('[object Object]');
    });
  });

  describe('Service Logger (docs/api/services.md)', () => {
    /**
     * @source docs:api/services.md#log-levels
     */
    it('should support all log levels', async () => {
      interface LogEntry {
        level: string;
        message: string;
        args: unknown[];
      }
      interface RecordingSyncLogger {
        trace(message: string, ...args: unknown[]): void;
        debug(message: string, ...args: unknown[]): void;
        info(message: string, ...args: unknown[]): void;
        warn(message: string, ...args: unknown[]): void;
        error(message: string, ...args: unknown[]): void;
        fatal(message: string, ...args: unknown[]): void;
        child(context: Record<string, unknown>): RecordingSyncLogger;
      }

      const entries: LogEntry[] = [];
      const childContexts: Record<string, unknown>[] = [];
      const record = (level: string) => (message: string, ...args: unknown[]): void => {
        entries.push({ level, message, args });
      };
      const recorder: RecordingSyncLogger = {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        fatal: record('fatal'),
        child(context: Record<string, unknown>): RecordingSyncLogger {
          childContexts.push(context);

          return recorder;
        },
      };

      @Service()
      class EmailService extends BaseService {
        async send() {
          // From docs: Log Levels
          this.logger.trace('Very detailed info');  // Level 0
          this.logger.debug('Debug information');   // Level 1
          this.logger.info('General information');  // Level 2
          this.logger.warn('Warning message');      // Level 3
          this.logger.error('Error occurred');      // Level 4
          this.logger.fatal('Fatal error');         // Level 5
        }
      }

      const { createMockConfig } = await import('./testing');
      const service = new EmailService();
      service.initializeService(recorder, createMockConfig());

      // The logger the service gets is a child scoped to the service class.
      expect(childContexts).toEqual([{ className: 'EmailService' }]);

      entries.length = 0;
      await service.send();

      // Every documented level exists on this.logger AND reaches the logger the framework
      // installed, in order, with the exact message the caller passed.
      expect(entries).toEqual([
        { level: 'trace', message: 'Very detailed info', args: [] },
        { level: 'debug', message: 'Debug information', args: [] },
        { level: 'info', message: 'General information', args: [] },
        { level: 'warn', message: 'Warning message', args: [] },
        { level: 'error', message: 'Error occurred', args: [] },
        { level: 'fatal', message: 'Fatal error', args: [] },
      ]);
    });
  });
});

describe('Lifecycle Hooks API Documentation Examples (docs/api/services.md)', () => {
  describe('OnModuleInit Interface', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     */
    it('should call onModuleInit once on every provider, awaited, after construction', async () => {
      const effectLib = await import('effect');

      // From docs: OnModuleInit example
      @Service()
      class DatabaseService extends BaseService implements OnModuleInit {
        private connection: unknown = null;
        initCalls = 0;

        async onModuleInit(): Promise<void> {
          // Called after service instantiation and DI
          await new Promise((resolve) => setTimeout(resolve, 5));
          this.connection = { connected: true };
          this.initCalls++;
          this.logger.info('Database connected');
        }

        isConnected(): boolean {
          return this.connection !== null;
        }
      }

      // Nothing injects it — from docs: "All services listed in `providers` are instantiated
      // eagerly ... `onModuleInit` is called for every service that implements the interface,
      // even if the service is not injected into any controller or other service."
      @Module({ providers: [DatabaseService] })
      class AppModule {}

      const module = new OneBunModule(
        AppModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
      );
      const service = module.getServiceByClass(DatabaseService) as DatabaseService;

      // Constructed, but the hook has not run: an unconnected service is what the constructor
      // alone leaves behind
      expect(service).toBeInstanceOf(DatabaseService);
      expect(service.isConnected()).toBe(false);
      expect(service.initCalls).toBe(0);

      await effectLib.Effect.runPromise(module.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // Module init is what invokes it — exactly once, and awaited, so the connection the hook
      // opens is already there for the first caller
      expect(service.isConnected()).toBe(true);
      expect(service.initCalls).toBe(1);
    });
  });

  describe('OnApplicationInit Interface', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     */
    it('should call onApplicationInit after module init and before the HTTP server listens', async () => {
      const phases: string[] = [];
      let portDuringHook = -1;
      let appRef: OneBunApplication | undefined;

      // From docs: OnApplicationInit example
      @Service()
      class CacheService extends BaseService implements OnModuleInit, OnApplicationInit {
        warmed = false;

        async onModuleInit(): Promise<void> {
          phases.push('onModuleInit');
        }

        async onApplicationInit(): Promise<void> {
          // Called after all modules initialized, before HTTP server starts
          this.logger.info('Warming up cache');
          await new Promise((resolve) => setTimeout(resolve, 5));
          portDuringHook = appRef!.getPort();
          this.warmed = true;
          phases.push('onApplicationInit');
        }
      }

      @Controller('/cache')
      class CacheController extends BaseController {
        constructor(private readonly cache: CacheService) {
          super();
        }

        @Get('/state')
        async state() {
          phases.push('request');

          return { warmed: this.cache.warmed };
        }
      }

      registerDependencies(CacheController, [CacheService]);

      @Module({ providers: [CacheService], controllers: [CacheController] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });
      appRef = app;

      try {
        await app.start();

        // The hook ran while the server was still unbound: `getPort()` inside it still reported
        // the configured 0, and only after start() does it report the OS-assigned port.
        expect(portDuringHook).toBe(0);
        expect(app.getPort()).toBeGreaterThan(0);

        // start() awaited the hook, so the warm-up is finished before anything can be served
        expect(app.getService(CacheService).warmed).toBe(true);

        const response = await fetch(`${app.getHttpUrl()}/cache/state`);
        expect(response.status).toBe(HttpStatusCode.OK);
        expect(await response.json()).toEqual({ success: true, result: { warmed: true } });

        // "after all modules initialized, before HTTP server starts", in that order
        expect(phases).toEqual(['onModuleInit', 'onApplicationInit', 'request']);
      } finally {
        await app.stop();
      }
    });
  });

  describe('OnModuleDestroy Interface', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     */
    it('should call onModuleDestroy during shutdown and await it', async () => {
      const phases: string[] = [];

      // From docs: OnModuleDestroy example (the pool of the "Usage" snippet, closed on shutdown)
      @Service()
      class ConnectionService extends BaseService implements OnModuleInit, OnModuleDestroy {
        pool: { open: boolean } | null = null;

        async onModuleInit(): Promise<void> {
          this.pool = { open: true };
        }

        async onModuleDestroy(): Promise<void> {
          // Called during shutdown, after HTTP server stops
          this.logger.info('Closing connections');
          await new Promise((resolve) => setTimeout(resolve, 5));
          this.pool!.open = false;
          phases.push('onModuleDestroy');
        }
      }

      @Module({ providers: [ConnectionService] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      await app.start();
      const service = app.getService(ConnectionService);

      // A running application has not destroyed anything yet
      expect(service.pool).toEqual({ open: true });
      expect(phases).toEqual([]);

      await app.stop();

      // stop() is what calls it — once — and it waits for the returned promise, so the pool is
      // already closed by the time stop() resolves
      expect(phases).toEqual(['onModuleDestroy']);
      expect(service.pool).toEqual({ open: false });
    });
  });

  describe('BeforeApplicationDestroy Interface', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     */
    it('should call beforeApplicationDestroy first, with the shutdown signal', async () => {
      const order: string[] = [];

      // From docs: BeforeApplicationDestroy example
      @Service()
      class GracefulService extends BaseService implements BeforeApplicationDestroy, OnModuleDestroy {
        beforeApplicationDestroy(signal?: string): void {
          // First destroy hook — after the drain, after the HTTP listener is closed
          this.logger.info(`Shutdown initiated by signal: ${signal || 'unknown'}`);
          order.push(`beforeApplicationDestroy:${signal || 'unknown'}`);
        }

        async onModuleDestroy(): Promise<void> {
          order.push('onModuleDestroy');
        }
      }

      @Module({ providers: [GracefulService] })
      class AppModule {}

      const options: Partial<ApplicationOptions> = {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      };

      const signalled = new OneBunApplication(AppModule, options);
      await signalled.start();
      expect(order).toEqual([]);

      await signalled.stop({ signal: 'SIGTERM' });

      // It receives the signal that triggered the shutdown, and it is the FIRST destroy hook
      expect(order).toEqual(['beforeApplicationDestroy:SIGTERM', 'onModuleDestroy']);

      // ...and a signal-less stop still runs it — with `signal` undefined, which is why the
      // documented example keeps the `|| 'unknown'` fallback
      order.length = 0;
      const unsignalled = new OneBunApplication(AppModule, options);
      await unsignalled.start();
      await unsignalled.stop();

      expect(order).toEqual(['beforeApplicationDestroy:unknown', 'onModuleDestroy']);
    });
  });

  describe('OnApplicationDestroy Interface', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     */
    it('should call onApplicationDestroy last, with the shutdown signal, and await it', async () => {
      const order: string[] = [];
      let finalCleanupFinished = false;

      // From docs: OnApplicationDestroy example
      @Service()
      class CleanupService extends BaseService
        implements BeforeApplicationDestroy, OnModuleDestroy, OnApplicationDestroy {
        beforeApplicationDestroy(): void {
          order.push('beforeApplicationDestroy');
        }

        async onModuleDestroy(): Promise<void> {
          order.push('onModuleDestroy');
        }

        async onApplicationDestroy(signal?: string): Promise<void> {
          // Called at the very end of shutdown
          this.logger.info(`Final cleanup, signal: ${signal || 'unknown'}`);
          order.push(`onApplicationDestroy:${signal || 'unknown'}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          finalCleanupFinished = true;
        }
      }

      @Module({ providers: [CleanupService] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      await app.start();
      expect(order).toEqual([]);

      await app.stop({ signal: 'SIGINT' });

      // "At the very end of shutdown": after every other destroy hook, carrying the signal,
      // and awaited — the last cleanup has finished by the time stop() resolves
      expect(order).toEqual(['beforeApplicationDestroy', 'onModuleDestroy', 'onApplicationDestroy:SIGINT']);
      expect(finalCleanupFinished).toBe(true);
    });
  });

  describe('Multiple Lifecycle Hooks', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     */
    it('should run all five hooks of one service in the documented lifecycle order', async () => {
      const order: string[] = [];

      // From docs: Complete lifecycle example
      @Service()
      class FullLifecycleService extends BaseService
        implements OnModuleInit, OnApplicationInit, OnModuleDestroy, BeforeApplicationDestroy, OnApplicationDestroy {

        async onModuleInit(): Promise<void> {
          this.logger.info('Service initialized');
          order.push('onModuleInit');
        }

        async onApplicationInit(): Promise<void> {
          this.logger.info('Application initialized');
          order.push('onApplicationInit');
        }

        beforeApplicationDestroy(signal?: string): void {
          this.logger.info(`Shutdown starting: ${signal}`);
          order.push(`beforeApplicationDestroy:${signal}`);
        }

        async onModuleDestroy(): Promise<void> {
          this.logger.info('Module destroying');
          order.push('onModuleDestroy');
        }

        async onApplicationDestroy(signal?: string): Promise<void> {
          this.logger.info(`Application destroyed: ${signal}`);
          order.push(`onApplicationDestroy:${signal}`);
        }
      }

      @Module({ providers: [FullLifecycleService] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      await app.start();

      // Startup steps 5-6 of the documented Lifecycle Order, and nothing from the shutdown half
      expect(order).toEqual(['onModuleInit', 'onApplicationInit']);

      await app.stop({ signal: 'SIGTERM' });

      // Shutdown hooks 4, 6 and 8 — every hook of one service, each exactly once, in order
      expect(order).toEqual([
        'onModuleInit',
        'onApplicationInit',
        'beforeApplicationDestroy:SIGTERM',
        'onModuleDestroy',
        'onApplicationDestroy:SIGTERM',
      ]);
    });
  });

  describe('Controller Lifecycle Hooks', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks (controllers support the same hooks)
     */
    it('should call onModuleInit and onModuleDestroy on a controller, in that order', async () => {
      // From docs: Controller lifecycle hooks example. The promise of the section is that the
      // framework CALLS these hooks — asserting that the methods exist proves nothing, since the
      // class body declares them and no framework change can remove them.
      const moduleMod = await import('./module/module');
      const testUtils = await import('./testing/test-utils');
      const effectLib = await import('effect');

      const calls: string[] = [];

      @Controller('/api')
      class ApiController extends BaseController implements OnModuleInit, OnModuleDestroy {
        async onModuleInit(): Promise<void> {
          calls.push('init');
          this.logger.info('Controller initialized');
        }

        async onModuleDestroy(): Promise<void> {
          calls.push('destroy');
          this.logger.info('Controller destroying');
        }

        @Get('/test')
        test(): Response {
          return this.success({ message: 'test' });
        }
      }

      @Module({ controllers: [ApiController] })
      class ApiModule {}

      const mod = new moduleMod.OneBunModule(ApiModule, testUtils.makeMockLoggerLayer());

      await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);
      expect(calls).toEqual(['init']);

      await mod.callOnModuleDestroy();
      expect(calls).toEqual(['init', 'destroy']);
    });
  });

  describe('Lifecycle Helper Functions', () => {
    /**
     * Tests for lifecycle helper functions
     */
    it('should detect hasOnModuleInit correctly', () => {
      const withHook = { onModuleInit: () => Promise.resolve() };
      const withoutHook = { someOtherMethod: () => 'nothing' };

      expect(hasOnModuleInit(withHook)).toBe(true);
      expect(hasOnModuleInit(withoutHook)).toBe(false);
      expect(hasOnModuleInit(null)).toBe(false);
      expect(hasOnModuleInit(undefined)).toBe(false);
    });

    it('should detect hasOnApplicationInit correctly', () => {
      const withHook = { onApplicationInit: () => Promise.resolve() };
      const withoutHook = {};

      expect(hasOnApplicationInit(withHook)).toBe(true);
      expect(hasOnApplicationInit(withoutHook)).toBe(false);
    });

    it('should detect hasOnModuleDestroy correctly', () => {
      const withHook = { onModuleDestroy: () => Promise.resolve() };
      const withoutHook = {};

      expect(hasOnModuleDestroy(withHook)).toBe(true);
      expect(hasOnModuleDestroy(withoutHook)).toBe(false);
    });

    it('should detect hasBeforeApplicationDestroy correctly', () => {
      const withHook = { beforeApplicationDestroy: () => undefined };
      const withoutHook = {};

      expect(hasBeforeApplicationDestroy(withHook)).toBe(true);
      expect(hasBeforeApplicationDestroy(withoutHook)).toBe(false);
    });

    it('should detect hasOnApplicationDestroy correctly', () => {
      const withHook = { onApplicationDestroy: () => Promise.resolve() };
      const withoutHook = {};

      expect(hasOnApplicationDestroy(withHook)).toBe(true);
      expect(hasOnApplicationDestroy(withoutHook)).toBe(false);
    });

    it('should call lifecycle hooks safely', async () => {
      const results: string[] = [];
      
      const service = {
        async onModuleInit() {
          results.push('init'); 
        },
        async onApplicationInit() {
          results.push('appInit'); 
        },
        beforeApplicationDestroy(signal?: string) {
          results.push(`before:${signal}`); 
        },
        async onModuleDestroy() {
          results.push('destroy'); 
        },
        async onApplicationDestroy(signal?: string) {
          results.push(`appDestroy:${signal}`); 
        },
      };

      await callOnModuleInit(service);
      await callOnApplicationInit(service);
      await callBeforeApplicationDestroy(service, 'SIGTERM');
      await callOnModuleDestroy(service);
      await callOnApplicationDestroy(service, 'SIGTERM');

      expect(results).toEqual(['init', 'appInit', 'before:SIGTERM', 'destroy', 'appDestroy:SIGTERM']);
    });

    it('should not throw when calling hooks on objects without them', async () => {
      const emptyObj = {};

      // These should not throw
      await callOnModuleInit(emptyObj);
      await callOnApplicationInit(emptyObj);
      await callBeforeApplicationDestroy(emptyObj, 'SIGTERM');
      await callOnModuleDestroy(emptyObj);
      await callOnApplicationDestroy(emptyObj, 'SIGTERM');
    });
  });

  describe('Standalone Service Pattern (docs/api/services.md)', () => {
    /**
     * @source docs:api/services.md#lifecycle-hooks
     * Standalone services (not injected anywhere) still have their
     * onModuleInit called. This is useful for background workers,
     * cron jobs, event listeners, etc.
     */
    it('should call onModuleInit for standalone services not injected anywhere', async () => {
      const moduleMod = await import('./module/module');
      const testUtils = await import('./testing/test-utils');
      const effectLib = await import('effect');

      let schedulerStarted = false;

      // From docs: Standalone service pattern
      @Service()
      class TaskSchedulerService extends BaseService implements OnModuleInit {
        async onModuleInit(): Promise<void> {
          // Main work happens here — no need to be injected anywhere
          schedulerStarted = true;
          this.logger.info('Task scheduler started');
        }
      }

      @Module({
        providers: [TaskSchedulerService],
        // No controllers use this service — it works on its own
      })
      class SchedulerModule {}

      const mod = new moduleMod.OneBunModule(SchedulerModule, testUtils.makeMockLoggerLayer());
      await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // Scheduler was started even though nothing injected it
      expect(schedulerStarted).toBe(true);
    });

    /**
     * @source docs:api/services.md#lifecycle-hooks
     * onModuleInit is called sequentially in dependency order:
     * dependencies complete their init before dependents start theirs.
     */
    it('should call onModuleInit in dependency order so dependencies are fully initialized', async () => {
      const moduleMod = await import('./module/module');
      const testUtils = await import('./testing/test-utils');
      const effectLib = await import('effect');
      const decorators = await import('./decorators/decorators');

      const initOrder: string[] = [];

      @Service()
      class DatabaseService extends BaseService implements OnModuleInit {
        private ready = false;

        async onModuleInit(): Promise<void> {
          this.ready = true;
          initOrder.push('database');
        }

        isReady(): boolean {
          return this.ready;
        }
      }

      @Service()
      class CacheService extends BaseService implements OnModuleInit {
        private db: DatabaseService;

        constructor(db: DatabaseService) {
          super();
          this.db = db;
        }

        async onModuleInit(): Promise<void> {
          // At this point, DatabaseService.onModuleInit has already completed
          initOrder.push(`cache:db-ready=${this.db.isReady()}`);
        }
      }

      decorators.registerDependencies(CacheService, [DatabaseService]);

      @Module({
        providers: [DatabaseService, CacheService],
      })
      class AppModule {}

      const mod = new moduleMod.OneBunModule(AppModule, testUtils.makeMockLoggerLayer());
      await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // Database initialized first, then cache saw database was ready
      expect(initOrder).toEqual(['database', 'cache:db-ready=true']);
    });

    /**
     * @source docs:api/services.md#lifecycle-hooks
     * onModuleInit is called for services in ALL modules across the entire
     * import tree, not just the root module. Deeply nested modules are
     * initialized in depth-first order.
     */
    it('should call onModuleInit for services across the entire module import tree', async () => {
      const moduleMod = await import('./module/module');
      const testUtils = await import('./testing/test-utils');
      const effectLib = await import('effect');

      const initLog: string[] = [];

      @Service()
      class AuthService extends BaseService implements OnModuleInit {
        async onModuleInit(): Promise<void> {
          initLog.push('auth');
        }
      }

      @Module({
        providers: [AuthService],
      })
      class AuthModule {}

      @Service()
      class UserService extends BaseService implements OnModuleInit {
        async onModuleInit(): Promise<void> {
          initLog.push('user');
        }
      }

      @Module({
        imports: [AuthModule],
        providers: [UserService],
      })
      class UserModule {}

      @Service()
      class AppService extends BaseService implements OnModuleInit {
        async onModuleInit(): Promise<void> {
          initLog.push('app');
        }
      }

      @Module({
        imports: [UserModule],
        providers: [AppService],
      })
      class AppModule {}

      const mod = new moduleMod.OneBunModule(AppModule, testUtils.makeMockLoggerLayer());
      await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // All three modules' services should have onModuleInit called
      expect(initLog).toContain('auth');
      expect(initLog).toContain('user');
      expect(initLog).toContain('app');
      expect(initLog.length).toBe(3);
    });
  });
});

describe('getService API Documentation Examples (docs/api/core.md)', () => {
  /**
   * @source docs:api/core.md#accessing-services-outside-of-requests
   */
  it('should hand out the running application\'s own instance through getService()', async () => {
    // From docs: a service used from a background task, outside the request context
    @Service()
    class UserService extends BaseService {
      backgroundRuns = 0;

      async sendScheduledEmails(): Promise<number> {
        this.backgroundRuns++;

        return this.backgroundRuns;
      }
    }

    @Controller('/users')
    class UsersController extends BaseController {
      constructor(private readonly userService: UserService) {
        super();
      }

      @Get('/state')
      async state() {
        return { runs: this.userService.backgroundRuns };
      }
    }

    registerDependencies(UsersController, [UserService]);

    @Module({ providers: [UserService], controllers: [UsersController] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    // The documented order is `await app.start()` first — before that there is no container
    // to take an instance from, and the call says so instead of inventing one
    expect(() => app.getService(UserService)).toThrow(/Application not started/);

    try {
      await app.start();

      const userService = app.getService(UserService);

      // From docs: "Use the service" — the returned object is live, not a stub
      expect(await userService.sendScheduledEmails()).toBe(1);
      expect(await userService.sendScheduledEmails()).toBe(2);

      // ...and it is the container's single instance: the same object on every call, and the
      // very one injected into the controller, so a request sees what the background task did
      expect(app.getService(UserService)).toBe(userService);

      const response = await fetch(`${app.getHttpUrl()}/users/state`);
      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: { runs: 2 } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/core.md#accessing-services-outside-of-requests
   */
  it('should get service instance by class', async () => {
    @Service()
    class TaskService extends BaseService {
      performTask(): string {
        return 'task completed';
      }
    }

    @Module({
      providers: [TaskService],
      controllers: [],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      loggerLayer: makeMockLoggerLayer(),
    });

    await app.start();

    // From docs: getService usage example
    const taskService = app.getService(TaskService);
    expect(taskService).toBeDefined();
    expect(taskService.performTask()).toBe('task completed');

    await app.stop();
  });

  /**
   * @source docs:api/core.md#accessing-services-outside-of-requests
   */
  it('should throw error for non-existent service', async () => {
    @Service()
    class NonExistentService extends BaseService {}

    @Module({
      controllers: [],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      loggerLayer: makeMockLoggerLayer(),
    });

    await app.start();

    // getService throws when service is not found
    expect(() => app.getService(NonExistentService)).toThrow();

    await app.stop();
  });
});

describe('Validation API Documentation Examples', () => {
  describe('validate function (docs/api/validation.md)', () => {
    /**
     * @source docs:api/validation.md#basic-usage
     */
    it('should validate data against schema', () => {
      // From docs: validate() requires arktype schema, not plain object
      // arktype `type()` returns a callable schema
      const userSchema = type({
        name: 'string',
        age: 'number',
      });

      const result = validate(userSchema, { name: 'John', age: 30 });

      // Result should have success property
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    });

    /**
     * @source docs:api/validation.md#basic-usage
     */
    it('should return errors for invalid data', () => {
      const userSchema = type({
        name: 'string',
        age: 'number',
      });

      const result = validate(userSchema, { name: 'John', age: 'not a number' });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('validateOrThrow function (docs/api/validation.md)', () => {
    /**
     * @source docs:api/validation.md#validateorthrow
     */
    it('should throw on invalid data', () => {
      const schema = type({
        name: 'string',
        age: 'number > 0',
      });

      // Valid data should not throw
      expect(() => {
        validateOrThrow(schema, { name: 'John', age: 30 });
      }).not.toThrow();

      // Invalid data should throw
      expect(() => {
        validateOrThrow(schema, { name: 'John', age: -5 });
      }).toThrow();
    });
  });

  describe('single ArkType copy requirement (docs/api/validation.md)', () => {
    const arkKindKey = ' arkKind';

    /**
     * `ArkErrors` as a SECOND physical arktype copy produces it: same ` arkKind: 'errors'` brand
     * `@ark/schema` discriminates on, different class object, so not instanceof core's type.errors.
     */
    class ForeignArkErrors extends Array<{ message: string }> {
      get summary(): string {
        return this.map((issue) => issue.message).join('\n');
      }
    }

    const makeForeignSchema = (branded: boolean): ValidationSchema => {
      const schema = (data: unknown): unknown => {
        if (typeof (data as { age?: unknown })?.age === 'number') {
          return data;
        }
        const errors = new ForeignArkErrors();
        errors.push({ message: 'age must be a number (was a string)' });
        Object.assign(errors, { byPath: {}, count: 1 });
        if (branded) {
          Object.assign(errors, { [arkKindKey]: 'errors' });
        }

        return errors;
      };
      Object.assign(schema, { [arkKindKey]: 'root' });

      return schema as unknown as ValidationSchema;
    };

    /**
     * @source docs:api/validation.md#detecting-duplicates
     */
    it('reports a healthy single-copy install', () => {
      expect(hasDuplicateArkTypeCopies()).toBe(false);
    });

    /**
     * @source docs:api/validation.md#error-messages
     */
    it('identifies ArkErrors by brand, so it works across copies', () => {
      const schema = type({ name: 'string', age: 'number' });

      expect(isArkErrors(schema({ name: 'John', age: 'thirty' }))).toBe(true);
      expect(isArkErrors(schema({ name: 'John', age: 30 }))).toBe(false);
      expect(isArkErrors(makeForeignSchema(true)({ age: 'thirty' }))).toBe(true);
    });

    /**
     * @source docs:api/validation.md#single-arktype-copy-requirement
     */
    it('rejects invalid data validated against a foreign copy instead of failing open', () => {
      const foreignSchema = makeForeignSchema(true);

      const result = validate(foreignSchema, { name: 'John', age: 'thirty' });

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['age must be a number (was a string)']);
    });

    /**
     * @source docs:api/validation.md#what-onebun-does-when-it-finds-one
     */
    it('throws DuplicateArkTypeError rather than returning ArkType internals as the payload', () => {
      const foreignSchema = makeForeignSchema(false);

      try {
        validate(foreignSchema, { name: 'John', age: 'thirty' });
        expect('unreachable').toBe('threw');
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateArkTypeError);
        const err = error as DuplicateArkTypeError;
        expect(err.message).toContain('Duplicate arktype installation detected');
        expect(err.registries).toContain('$ark');
      }
    });
  });

  describe('JSON Schema conversion (docs/api/validation.md)', () => {
    /**
     * @source docs:api/validation.md#types-json-schema-cannot-express
     */
    it('marks a partial conversion with the codes responsible', () => {
      // From docs: `schema[JSON_SCHEMA_PARTIAL]` is `{ codes: ['date'] }`
       
      const { getJsonSchema, JSON_SCHEMA_PARTIAL } = require('./validation/json-schema');
      const schema = getJsonSchema(type({ when: 'Date', name: 'string' }));

      expect(schema[JSON_SCHEMA_PARTIAL]).toEqual({ codes: ['date'] });
      // …and everything ArkType could build is still there
      expect(schema.properties.name).toEqual({ type: 'string' });
    });

    /**
     * @source docs:api/validation.md#types-json-schema-cannot-express
     */
    it('suppresses the marker for codes a caller handles', () => {
      // From docs: properties.when is { type: 'string', format: 'date-time' }, no marker
       
      const { getJsonSchema, JSON_SCHEMA_PARTIAL } = require('./validation/json-schema');
      const withDates = getJsonSchema(type({ when: 'Date', name: 'string' }), {
        fallback: { date: () => ({ type: 'string', format: 'date-time' }) },
      });

      expect(withDates.properties.when).toEqual({ type: 'string', format: 'date-time' });
      expect(withDates[JSON_SCHEMA_PARTIAL]).toBeUndefined();
    });

    /**
     * @source docs:api/validation.md#types-json-schema-cannot-express
     */
    it('throws from the strict helper where the lenient one degrades', () => {
      // From docs: the table contrasting toJsonSchema and getJsonSchema
       
      const { toJsonSchema: strict } = require('./validation/json-schema');

      expect(() => strict(type({ when: 'Date' }))).toThrow();
    });
  });

  describe('Schema Types (docs/api/validation.md)', () => {
    /**
     * @source docs:api/validation.md#primitives
     */
    it('should define primitive schemas', () => {
      // From docs: Primitives — every keyword the section lists, each accepting its own
      // runtime type and rejecting a neighbouring one. A schema that stopped discriminating
      // (or a keyword that disappeared) fails here instead of merely being "defined".
      const stringSchema = type('string');
      const numberSchema = type('number');
      const booleanSchema = type('boolean');

      expect(validate(stringSchema, 'hello')).toEqual({ success: true, data: 'hello' });
      expect(validate(numberSchema, 42)).toEqual({ success: true, data: 42 });
      expect(validate(booleanSchema, false)).toEqual({ success: true, data: false });

      const rejectedString = validate(stringSchema, 42);
      expect(rejectedString.success).toBe(false);
      expect(rejectedString.errors).toEqual(['must be a string (was a number)']);
      expect(validate(numberSchema, '42').success).toBe(false);
      expect(validate(booleanSchema, 'true').success).toBe(false);

      // The remaining keywords the section documents
      const bigintSchema = type('bigint');
      expect(validate(bigintSchema, 10n).success).toBe(true);
      expect(validate(bigintSchema, 10).success).toBe(false);

      const symbolValue = Symbol('docs');
      const symbolSchema = type('symbol');
      expect(validate(symbolSchema, symbolValue)).toEqual({ success: true, data: symbolValue });
      expect(validate(symbolSchema, 'docs').success).toBe(false);

      const nullSchema = type('null');
      expect(validate(nullSchema, null)).toEqual({ success: true, data: null });
      expect(validate(nullSchema, undefined).success).toBe(false);

      const undefinedSchema = type('undefined');
      expect(validate(undefinedSchema, undefined)).toEqual({ success: true, data: undefined });
      expect(validate(undefinedSchema, null).success).toBe(false);
    });

    /**
     * @source docs:api/validation.md#string-constraints
     */
    it('should define string constraints', () => {
      // From docs: String Constraints
      const emailSchema = type('string.email');
      const uuidSchema = type('string.uuid');

      expect(emailSchema).toBeDefined();
      expect(uuidSchema).toBeDefined();

      // Validate email
      const emailResult = validate(emailSchema, 'test@example.com');
      expect(emailResult.success).toBe(true);
    });

    /**
     * @source docs:api/validation.md#number-constraints
     */
    it('should define number constraints', () => {
      // From docs: Number Constraints
      const positiveSchema = type('number > 0');
      const rangeSchema = type('0 <= number <= 100');

      expect(positiveSchema).toBeDefined();
      expect(rangeSchema).toBeDefined();

      // Validate positive number
      const positiveResult = validate(positiveSchema, 10);
      expect(positiveResult.success).toBe(true);
    });

    /**
     * @source docs:api/validation.md#arrays
     */
    it('should define array schemas', () => {
      // From docs: Arrays
      const stringArraySchema = type('string[]');

      expect(stringArraySchema).toBeDefined();

      const result = validate(stringArraySchema, ['a', 'b', 'c']);
      expect(result.success).toBe(true);
    });

    /**
     * @source docs:api/validation.md#objects
     */
    it('should define object schemas', () => {
      // From docs: Objects
      /* eslint-disable @typescript-eslint/naming-convention */
      const userSchema = type({
        name: 'string',
        email: 'string.email',
        'age?': 'number > 0', // Optional field
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      expect(userSchema).toBeDefined();

      const result = validate(userSchema, {
        name: 'John',
        email: 'john@example.com',
      });
      expect(result.success).toBe(true);
    });

    /**
     * @source docs:api/validation.md#using-in-controllers
     */
    it('should infer TypeScript type from schema', () => {
      // From docs: Type inference
      const userSchema = type({
        name: 'string',
        email: 'string.email',
        age: 'number > 0',
      });
      // Use userSchema to verify type inference
      expect(userSchema).toBeDefined();

      type User = typeof userSchema.infer;

      // TypeScript should infer: { name: string; email: string; age: number }
      const user: User = { name: 'John', email: 'john@example.com', age: 30 };

      expect(user.name).toBe('John');
      expect(user.email).toBe('john@example.com');
      expect(user.age).toBe(30);
    });
  });

  describe('Common Patterns (docs/api/validation.md)', () => {
    /**
     * @source docs:api/validation.md#createupdate-dtos
     */
    it('should define create/update DTOs', () => {
      // From docs: Create/Update DTOs pattern — reproduced verbatim, constraints included
      const createUserSchema = type({
        name: 'string',
        email: 'string.email',
        password: 'string >= 8',
        role: '"admin" | "user"',
      });

      /* eslint-disable @typescript-eslint/naming-convention */
      const updateUserSchema = type({
        'name?': 'string',
        'email?': 'string.email',
        'password?': 'string >= 8',
        'role?': '"admin" | "user"',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      type CreateUserDto = typeof createUserSchema.infer;
      type UpdateUserDto = typeof updateUserSchema.infer;

      const created: CreateUserDto = {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'correcthorse',
        role: 'admin',
      };

      // "Create DTO — all fields required"
      expect(validate(createUserSchema, created)).toEqual({ success: true, data: created });

      const missingRole = validate(createUserSchema, {
        name: 'Alice',
        email: 'alice@example.com',
        password: 'correcthorse',
      });
      expect(missingRole.success).toBe(false);
      expect(missingRole.errors).toEqual(['role must be "admin" or "user" (was missing)']);

      // ...and the constraints inside those fields are enforced, not decorative
      expect(validate(createUserSchema, { ...created, password: 'short' }).success).toBe(false);
      expect(validate(createUserSchema, { ...created, role: 'root' }).success).toBe(false);
      expect(validate(createUserSchema, { ...created, email: 'not-an-email' }).success).toBe(false);

      // "Update DTO — all fields optional": an empty patch is valid, a partial one keeps
      // only what was sent, and an invalid field is still rejected.
      expect(validate(updateUserSchema, {})).toEqual({ success: true, data: {} });

      const patch: UpdateUserDto = { name: 'Alice Cooper' };
      expect(validate(updateUserSchema, patch)).toEqual({ success: true, data: { name: 'Alice Cooper' } });
      expect(validate(updateUserSchema, { email: 'nope' }).success).toBe(false);
      expect(validate(updateUserSchema, { password: 'short' }).success).toBe(false);
    });

    /**
     * @source docs:api/validation.md#pagination
     */
    it('should define pagination schema', () => {
      // From docs: Pagination Schema
      /* eslint-disable @typescript-eslint/naming-convention */
      const paginationSchema = type({
        'page?': 'number > 0',
        'limit?': 'number > 0',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      expect(paginationSchema).toBeDefined();

      const result = validate(paginationSchema, { page: 1, limit: 10 });
      expect(result.success).toBe(true);
    });
  });
});

describe('Error Classes Examples', () => {
  describe('NotFoundError (docs/api/requests.md)', () => {
    it('should create NotFoundError', () => {
      // From docs: Error Classes example
      // NotFoundError(error: string, details?: Record<string, unknown>)
      const error = new NotFoundError('User not found', { userId: '123' });

      expect(error).toBeInstanceOf(OneBunBaseError);
      expect(error.message).toContain('User not found');
    });
  });

  describe('InternalServerError', () => {
    it('should create InternalServerError', () => {
      const error = new InternalServerError('Something went wrong');

      expect(error).toBeInstanceOf(OneBunBaseError);
      expect(error.message).toBe('Something went wrong');
    });
  });
});

describe('HttpStatusCode (docs/api/requests.md)', () => {
  it('should have correct status codes', () => {
    // From docs: Available Status Codes
    expect(HttpStatusCode.OK).toBe(200);
    expect(HttpStatusCode.CREATED).toBe(201);
    expect(HttpStatusCode.BAD_REQUEST).toBe(400);
    expect(HttpStatusCode.UNAUTHORIZED).toBe(401);
    expect(HttpStatusCode.FORBIDDEN).toBe(403);
    expect(HttpStatusCode.NOT_FOUND).toBe(404);
    expect(HttpStatusCode.CONFLICT).toBe(409);
    expect(HttpStatusCode.UNPROCESSABLE_ENTITY).toBe(422);
    expect(HttpStatusCode.INTERNAL_SERVER_ERROR).toBe(500);
  });
});

describe('Env Helper (docs/api/envs.md)', () => {
  describe('Environment Variable Types', () => {
    it('should create string configuration', () => {
      const config = Env.string({ default: 'localhost' });
      expect(config.type).toBe('string');
    });

    it('should create number configuration', () => {
      const config = Env.number({ default: 3000 });
      expect(config.type).toBe('number');
    });

    it('should create boolean configuration', () => {
      const config = Env.boolean({ default: false });
      expect(config.type).toBe('boolean');
    });

    it('should create array configuration', () => {
      const config = Env.array({ default: ['a', 'b'] });
      expect(config.type).toBe('array');
    });
  });

  describe('Built-in Validators', () => {
    it('should have port validator', () => {
      const validator = Env.port();
      expect(typeof validator).toBe('function');
    });

    it('should have url validator', () => {
      const validator = Env.url();
      expect(typeof validator).toBe('function');
    });

    it('should have email validator', () => {
      const validator = Env.email();
      expect(typeof validator).toBe('function');
    });

    it('should have oneOf validator', () => {
      const validator = Env.oneOf(['a', 'b', 'c']);
      expect(typeof validator).toBe('function');
    });

    it('should have regex validator', () => {
      const validator = Env.regex(/^[a-z]+$/);
      expect(typeof validator).toBe('function');
    });
  });
});

describe('Service Definition and Client (docs/api/requests.md)', () => {
  /**
   * @source docs:api/requests.md#service-client-inter-service-communication
   */
  it('should reflect the callee module\'s endpoints, keyed by controller class name', () => {
    // From docs: createServiceDefinition takes the MODULE CLASS and reads the endpoints out of
    // the decorator metadata. There is no literal form — the docs used to show one, and it threw.
    @Controller('/users')
    class UsersController extends BaseController {
      @Get('/')
      findAll() {
        return [];
      }

      @Get('/:id')
      findById(@Param('id') id: string) {
        return { id };
      }

      @Post('/')
      create(@Body() data: unknown) {
        return data;
      }
    }

    @Module({
      controllers: [UsersController],
    })
    class UsersModule {}

    const UsersServiceDefinition = createServiceDefinition(UsersModule);

    // Keyed by the controller CLASS name — not by a lowercase alias, which is how the docs
    // used to spell it and why `client.users.findAll()` threw from the proxy.
    expect([...UsersServiceDefinition._controllers.keys()]).toEqual(['UsersController']);
    expect([...UsersServiceDefinition._controllers.get('UsersController')!.methods.keys()].sort())
      .toEqual(['create', 'findAll', 'findById']);

    const findById = UsersServiceDefinition._endpoints.find(e => e.method === 'findById');
    expect(findById?.path).toBe('/users/:id');
    expect(findById?.httpMethod).toBe(HttpMethod.GET);

    // A literal is rejected outright, so the corrected recipe is the only one that works.
    expect(() => createServiceDefinition({ name: 'users' } as never))
      .toThrow(/not decorated with @Module/);
  });

  /**
   * @source docs:api/requests.md#service-client-inter-service-communication
   */
  it('should call the reflected endpoint, passing handler arguments positionally', async () => {
    const seen: string[] = [];

    const server = Bun.serve({
      port: 0,
      fetch(request) {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);

        return Response.json({ success: true, result: { id: '123' } });
      },
    });

    @Controller('/users')
    class UsersController extends BaseController {
      @Get('/:id')
      findById(@Param('id') id: string) {
        return { id };
      }
    }

    @Module({ controllers: [UsersController] })
    class UsersModule {}

    try {
      // The option is `url` and it is REQUIRED; ServiceClientOptions omits `baseUrl` outright.
      const usersClient = createServiceClient(createServiceDefinition(UsersModule), {
        url: `http://127.0.0.1:${server.port}`,
      });

      // Positional, not `{ id: '123' }`: buildRequestParams walks the handler's @Param metadata
      // by index and consumes args[i], so a wrapper object lands in the URL verbatim.
      await usersClient.UsersController.findById('123');

      expect(seen).toEqual(['GET /users/123']);
    } finally {
      server.stop(true);
    }
  });
});

describe('OneBunApplication (docs/api/core.md)', () => {
  /**
   * @source docs:api/core.md#onebunapplication
   */
  it('should bootstrap the module it was constructed with and answer through its methods', async () => {
    const effectLib = await import('effect');
    const loggerLib = await import('@onebun/logger');
    const envsLib = await import('@onebun/envs');

    // TypedEnv caches one config per key, and every application in this process asks for
    // 'default' — without clearing, this app would be handed the schema of whichever test ran
    // first and `app.name` would silently be undefined.
    envsLib.TypedEnv.clear();

    // A recording logger layer instead of the silent mock: `getLogger()` is documented to hand
    // back "the logger instance", which is only checkable if writes to it are visible.
    const logged: Array<{ level: string; message: string; context: Record<string, unknown> }> = [];
    const recordingLogger = (context: Record<string, unknown>): import('@onebun/logger').Logger => {
      const record = (level: string) => (message: string) =>
        effectLib.Effect.sync(() => {
          logged.push({ level, message, context });
        });

      return {
        trace: record('trace'),
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
        fatal: record('fatal'),
        child: (extra: Record<string, unknown>) => recordingLogger({ ...context, ...extra }),
      };
    };

    @Service()
    class GreeterService extends BaseService {
      greet(): string {
        return 'Hello';
      }
    }

    @Controller('/api')
    class AppController extends BaseController {
      constructor(private readonly greeter: GreeterService) {
        super();
      }

      @Get('/hello')
      hello() {
        return { message: this.greeter.greet() };
      }
    }

    registerDependencies(AppController, [GreeterService]);

    @Module({
      controllers: [AppController],
      providers: [GreeterService],
    })
    class AppModule {}

    // From docs: OneBunApplication constructor. `port: 0` stands in for the documented 3000 so
    // the suite can run on a busy machine; getPort() reports what the OS handed out.
    const app = new OneBunApplication(AppModule, {
      loggerLayer: effectLib.Layer.succeed(loggerLib.LoggerService, recordingLogger({})),
      port: 0,
      host: '127.0.0.1',
      basePath: '/api/v1',
      envSchema: {
        app: { name: Env.string({ default: 'docs-core-app', env: 'ONEBUN_DOCS_CORE_APP_NAME' }) },
      },
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    const httpUrl = 'http://127.0.0.1:';

    try {
      // start(): the module's controllers are mounted and served, under `basePath`
      await app.start();

      expect(app.getPort()).toBeGreaterThan(0);
      expect(app.getHttpUrl()).toBe(`${httpUrl}${app.getPort()}`);

      const response = await fetch(`${app.getHttpUrl()}/api/v1/api/hello`);
      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: { message: 'Hello' } });
      expect((await fetch(`${app.getHttpUrl()}/api/hello`)).status).toBe(HttpStatusCode.NOT_FOUND);

      // getConfig() / getConfigValue(): the configuration built from `envSchema`, by path
      expect(app.getConfig().get('app.name')).toBe('docs-core-app');
      expect(app.getConfigValue<string>('app.name')).toBe('docs-core-app');

      // getLogger(context): writes reach the configured logger layer, under the given context
      app.getLogger({ className: 'AppBootstrap' }).info('Application started');
      expect(logged).toContainEqual({
        level: 'info',
        message: 'Application started',
        context: { className: 'AppBootstrap' },
      });

      // getLayer(): the root module layer, carrying the application's own service instances
      const greeterTag = getServiceTag(GreeterService) as unknown as
        import('effect').Context.Tag<GreeterService, GreeterService>;
      const fromLayer = await effectLib.Effect.runPromise(effectLib.Effect.provide(
        greeterTag,
        app.getLayer() as unknown as import('effect').Layer.Layer<GreeterService, never, never>,
      ));
      expect(fromLayer).toBe(app.getService(GreeterService));

      // stop(): the listener is gone afterwards
      const url = app.getHttpUrl();
      await app.stop();
      expect(await fetch(`${url}/api/v1/api/hello`).then(() => 'served', () => 'refused')).toBe('refused');
    } finally {
      // stop() is idempotent — a second call awaits the first shutdown instead of repeating it
      await app.stop();
      envsLib.TypedEnv.clear();
    }
  });

  /**
   * @source docs:api/core.md#applicationoptions
   */
  it('should accept full application options', async () => {
    @Controller('/hello')
    class HelloController extends BaseController {
      @Get('/')
      async hello() {
        return { message: 'Hello' };
      }
    }

    @Module({ controllers: [HelloController] })
    class AppModule {}

    // From docs: ApplicationOptions. `routePrefix` is prepended first, `basePath` after it,
    // so every route of every controller is mounted under `/myservice/api/v1`.
    // `metrics`/`tracing` are pinned by their own sections (#metrics-options, #tracing-options);
    // they are off here because prom-client's registry is process-global.
    const app = new OneBunApplication(AppModule, {
      name: 'my-app',
      port: 0,
      host: '127.0.0.1',
      basePath: '/api/v1',
      routePrefix: 'myservice',
      development: true,
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      // `port: 0` asks the OS for a free port; the documented accessors report the real one
      expect(app.getPort()).toBeGreaterThan(0);
      expect(app.getHttpUrl()).toBe(`http://127.0.0.1:${app.getPort()}`);

      const prefixed = await fetch(`${app.getHttpUrl()}/myservice/api/v1/hello`);
      expect(prefixed.status).toBe(HttpStatusCode.OK);
      expect(await prefixed.json()).toEqual({ success: true, result: { message: 'Hello' } });

      // ...and nowhere else: dropping either prefix leaves no route
      expect((await fetch(`${app.getHttpUrl()}/hello`)).status).toBe(HttpStatusCode.NOT_FOUND);
      expect((await fetch(`${app.getHttpUrl()}/myservice/hello`)).status).toBe(HttpStatusCode.NOT_FOUND);

      // `name` is the title of the generated OpenAPI document
      const spec = app.getOpenApiSpec();
      expect((spec?.info as { title?: string } | undefined)?.title).toBe('my-app');
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/guards.md#on-a-base-controller
   * @source docs:api/controllers.md#extending-a-base-controller
   */
  it('should inherit a class-level guard from a base controller', async () => {
    let guardRan = false;

    class DenyingBaseGuard implements HttpGuard {
      canActivate(): boolean {
        guardRan = true;

        return false;
      }
    }

    // From docs: a class-level guard is inherited; the base need not be a @Controller
    @UseGuards(DenyingBaseGuard)
    class ProtectedControllerBase extends BaseController {}

    @Controller('/admin')
    class AdminController extends ProtectedControllerBase {
      @Get('/stats')
      stats() {
        return { ok: true };
      }
    }

    @Module({ controllers: [AdminController] })
    class AdminModule {}

    const app = new OneBunApplication(AdminModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const response = await fetch(`${app.getHttpUrl()}/admin/stats`);

      expect(response.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(guardRan).toBe(true);

      // From docs: routes declared on the base are NOT mounted under the subclass
      const inherited = await fetch(`${app.getHttpUrl()}/admin/nothing-here`);
      expect(inherited.status).toBe(HttpStatusCode.NOT_FOUND);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/guards.md#class-based-guard
   */
  it('should give a class-based guard this.config inside canActivate', async () => {
    let configType: string | undefined;

    // From docs: "BaseService provides this.config automatically"
    @Service()
    class ApiKeyGuard extends BaseService implements HttpGuard {
      canActivate(ctx: HttpExecutionContext): boolean {
        const key = ctx.getRequest().headers.get('x-api-key');
        configType = typeof this.config;

        return key === this.config.get('auth.apiKey');
      }
    }

    @UseGuards(ApiKeyGuard)
    @Controller('/keyed')
    class KeyedController extends BaseController {
      @Get('/')
      get() {
        return { ok: true };
      }
    }

    @Module({ controllers: [KeyedController], providers: [ApiKeyGuard] })
    class GuardModule {}

    const app = new OneBunApplication(GuardModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      gracefulShutdown: false,
      envSchema: { auth: { apiKey: Env.string({ default: 'docs-key', env: 'DOCS_API_KEY' }) } },
    });

    try {
      await app.start();

      const denied = await fetch(`${app.getHttpUrl()}/keyed/`);

      expect(denied.status).toBe(HttpStatusCode.FORBIDDEN);
      // The whole point of the documented example: `this.config` resolves inside
      // canActivate. Before the fix it was `undefined` and the line above it threw a
      // TypeError at request time. Asserted as the type rather than a config VALUE,
      // because the env layer is shared with the other suites in this file — the
      // allow/deny cycle over an injected value is covered in http-guards.test.ts.
      expect(configType).toBe('object');
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:migration-nestjs.md#provider-patterns
   */
  it('should throw naming the module when a NestJS-style object provider is used', () => {
    @Service()
    class UserService extends BaseService {
      findAll(): string[] {
        return [];
      }
    }

    // From docs: an object entry throws an error naming the module and the entry
    @Module({
      providers: [
        { provide: UserService, useValue: { findAll: () => [] } } as unknown as typeof UserService,
      ],
    })
    class UserModule {}

    expect(() => new OneBunModule(UserModule, makeMockLoggerLayer()))
      .toThrow(/UserModule.*object provider/s);
  });

  /**
   * @source docs:api/decorators.md#module
   */
  it('should throw when a module is listed in exports instead of a service', () => {
    @Service()
    class UserService extends BaseService {
      findAll(): string[] {
        return [];
      }
    }

    @Module({ providers: [UserService], exports: [UserService] })
    class CoreModule {}

    // From docs: exports accepts services only — re-exporting a module throws
    @Module({ imports: [CoreModule], exports: [CoreModule] })
    class ReExportingModule {}

    @Module({ imports: [ReExportingModule] })
    class AppModule {}

    expect(() => new OneBunModule(AppModule, makeMockLoggerLayer()))
      .toThrow(/exports the module CoreModule/);
  });

  /**
   * @source docs:api/core.md#global-modules
   */
  it('should reach an importer regardless of its position in the imports array', () => {
    @Service()
    class SharedService extends BaseService {
      value(): string {
        return 'shared';
      }
    }

    @Global()
    @Module({ providers: [SharedService], exports: [SharedService] })
    class CoreModule {}

    @Module({ imports: [CoreModule] })
    class FeatureModule {}

    @Service()
    class Consumer extends BaseService {
      constructor(public shared: SharedService) {
        super();
      }
    }

    // From docs: "Import order does not matter" — FeatureModule initializes CoreModule
    // first, so the second entry hits the already-processed path.
    @Module({ imports: [FeatureModule, CoreModule], providers: [Consumer] })
    class AppModule {}

    const module = new OneBunModule(
      AppModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
    );

    expect(module.getServiceByClass(Consumer)?.shared.value()).toBe('shared');
  });

  /**
   * @source docs:api/core.md#global-modules
   */
  it('should report a @Global()-decorated module through isGlobalModule', () => {
    @Service()
    class DatabaseService extends BaseService {
      query(_sql: string): string {
        return 'rows';
      }
    }

    @Global()
    @Module({ providers: [DatabaseService], exports: [DatabaseService] })
    class DatabaseModule {}

    @Module({ providers: [] })
    class PlainModule {}

    // From docs: Global Module Utilities
    expect(isGlobalModule(DatabaseModule)).toBe(true);
    expect(isGlobalModule(PlainModule)).toBe(false);
  });

  /**
   * @source docs:api/core.md#global-modules
   */
  it('should give each application its own instance of a @Global() service', () => {
    let constructed = 0;

    @Service()
    class ScopedDatabaseService extends BaseService {
      readonly id = ++constructed;
    }

    @Global()
    @Module({ providers: [ScopedDatabaseService], exports: [ScopedDatabaseService] })
    class ScopedDatabaseModule {}

    @Module({ imports: [ScopedDatabaseModule] })
    class AppModule {}

    // From docs: "A @Global() module contributes exactly one instance per application"
    const first = new OneBunModule(
      AppModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
    );
    const second = new OneBunModule(
      AppModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
    );

    expect(first.getServiceByClass(ScopedDatabaseService))
      .not.toBe(second.getServiceByClass(ScopedDatabaseService));
    expect(constructed).toBe(2);
  });

  /**
   * @source docs:api/core.md#metrics-options
   */
  it('should accept metrics configuration', async () => {
    @Controller('/ping')
    class PingController extends BaseController {
      @Get('/')
      async ping() {
        return { ok: true };
      }
    }

    @Module({ controllers: [PingController] })
    class AppModule {}

    // From docs: MetricsOptions. `path` moves the endpoint, `prefix` renames every metric,
    // `collectHttpMetrics` decides whether requests are counted at all.
    // The prefix is unique to this test on purpose: prom-client's registry is process-global,
    // so re-registering `onebun_http_requests_total` would throw and the app would silently
    // start without metrics. `defaultLabels` is left out for the same reason — it rewrites
    // the labels of every metric in the process, including other suites'.
    const app = new OneBunApplication(AppModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      tracing: { enabled: false },
      gracefulShutdown: false,
      metrics: {
        enabled: true,
        path: '/docs-metrics',
        prefix: 'docsexamples_',
        collectHttpMetrics: true,
        collectSystemMetrics: false,
        collectGcMetrics: false,
        systemMetricsInterval: 5000,
        httpDurationBuckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      },
    });

    try {
      await app.start();

      expect((await fetch(`${app.getHttpUrl()}/ping`)).status).toBe(HttpStatusCode.OK);

      const metrics = await fetch(`${app.getHttpUrl()}/docs-metrics`);
      expect(metrics.status).toBe(HttpStatusCode.OK);
      expect(metrics.headers.get('content-type')).toContain('text/plain');

      const body = await metrics.text();
      // the served request was counted, under the configured prefix
      expect(body).toContain('docsexamples_http_requests_total');
      expect(body).toMatch(/docsexamples_http_requests_total\{[^}]*route="\/ping"[^}]*\} 1/);
      expect(body).toContain('docsexamples_http_request_duration_seconds_bucket');

      // the endpoint really moved — the default path is not served
      expect((await fetch(`${app.getHttpUrl()}/metrics`)).status).toBe(HttpStatusCode.NOT_FOUND);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/core.md#tracing-options
   */
  it('should accept tracing configuration', async () => {
    const { getCurrentTraceContext } = await import('@onebun/core');

    const seenTraceIds: Array<string | null> = [];

    @Controller('/traced')
    class TracedController extends BaseController {
      @Get('/')
      async traced() {
        // getCurrentTraceContext() is the per-request AsyncLocalStorage slot the
        // framework fills from the trace service
        const traceContext = getCurrentTraceContext();
        seenTraceIds.push(traceContext?.traceId ?? null);

        return { traceId: traceContext?.traceId ?? null };
      }
    }

    @Module({ controllers: [TracedController] })
    class AppModule {}

    // From docs: TracingOptions. Observable in-process: with `traceHttpRequests` on, an
    // incoming W3C `traceparent` is adopted as the request's trace context.
    // `samplingRate`, `defaultAttributes` and `exportOptions` only surface in exported
    // spans — there is no collector in this process, so they are pinned at the type level
    // below rather than faked.
    /* eslint-disable @typescript-eslint/naming-convention */
    const tracingOptions: ApplicationOptions['tracing'] = {
      enabled: true,
      serviceName: 'my-service',
      serviceVersion: '1.0.0',
      samplingRate: 1.0,
      traceHttpRequests: true,
      traceDatabaseQueries: true,
      defaultAttributes: { 'deployment.environment': 'production' },
      exportOptions: {
        headers: { Authorization: 'Bearer token' },
        timeout: 30000,
        batchSize: 100,
        batchTimeout: 5000,
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    // No assertion on the literal above: reading `tracingOptions.exportOptions.batchSize` back is a
    // tautology — the test wrote it. The `ApplicationOptions['tracing']` annotation is what pins
    // those fields, and it does so at compile time. What follows asserts the runtime promise.

    const traced = new OneBunApplication(AppModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      gracefulShutdown: false,
      tracing: tracingOptions,
    });

    const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';

    try {
      await traced.start();

      const response = await fetch(`${traced.getHttpUrl()}/traced`, {
        headers: { traceparent: `00-${incomingTraceId}-00f067aa0ba902b7-01` },
      });

      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: { traceId: incomingTraceId } });
      expect(seenTraceIds).toEqual([incomingTraceId]);
    } finally {
      await traced.stop();
    }

    // ...and with HTTP tracing turned off the same request carries no trace context

    const untraced = new OneBunApplication(AppModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      gracefulShutdown: false,
      tracing: { enabled: true, traceHttpRequests: false },
    });

    try {
      await untraced.start();

      const response = await fetch(`${untraced.getHttpUrl()}/traced`, {
        headers: { traceparent: `00-${incomingTraceId}-00f067aa0ba902b7-01` },
      });

      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: { traceId: null } });
      expect(seenTraceIds).toEqual([incomingTraceId, null]);
    } finally {
      await untraced.stop();
    }
  });

  /**
   * @source docs:api/core.md#staticapplicationoptions
   */
  it('should accept static file serving configuration (SPA on same host)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'onebun-docs-static-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!DOCTYPE html><html><body>SPA</body></html>', 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'app.js'), 'export const marker = "static-asset";', 'utf8');

      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/state')
        async state() {
          return { from: 'api' };
        }
      }

      @Module({ controllers: [ApiController] })
      class AppModule {}

      // From docs: Static files (SPA on same host) — "GET /api/* handled by framework;
      // GET /, /dashboard, etc. serve dist/ or index.html"
      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
        static: { root: tmpDir, fallbackFile: 'index.html' },
      });

      try {
        await app.start();

        // API routes still win over the static root
        const api = await fetch(`${app.getHttpUrl()}/api/state`);
        expect(api.status).toBe(HttpStatusCode.OK);
        expect(await api.json()).toEqual({ success: true, result: { from: 'api' } });

        // An existing file under the static root is served as-is
        const asset = await fetch(`${app.getHttpUrl()}/app.js`);
        expect(asset.status).toBe(HttpStatusCode.OK);
        expect(await asset.text()).toContain('static-asset');

        // A client-side route has no file behind it, so fallbackFile answers with 200
        const clientRoute = await fetch(`${app.getHttpUrl()}/dashboard`);
        expect(clientRoute.status).toBe(HttpStatusCode.OK);
        expect(await clientRoute.text()).toContain('SPA');
      } finally {
        await app.stop();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /**
   * @source docs:api/core.md#staticapplicationoptions
   */
  it('should serve static files only under the configured pathPrefix', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'onebun-docs-static-prefix-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'logo.png'), 'not-really-a-png', 'utf8');

      @Module({ controllers: [] })
      class AppModule {}

      // From docs: "Only GET /assets/* are served from ./public; e.g. /assets/logo.png -> public/logo.png"
      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
        static: { root: tmpDir, pathPrefix: '/assets' },
      });

      try {
        await app.start();

        const prefixed = await fetch(`${app.getHttpUrl()}/assets/logo.png`);
        expect(prefixed.status).toBe(HttpStatusCode.OK);
        expect(await prefixed.text()).toBe('not-really-a-png');

        // outside the prefix nothing is served, even though the file exists in the root
        expect((await fetch(`${app.getHttpUrl()}/logo.png`)).status).toBe(HttpStatusCode.NOT_FOUND);
        // and without fallbackFile a miss inside the prefix stays a miss
        expect((await fetch(`${app.getHttpUrl()}/assets/missing.png`)).status).toBe(HttpStatusCode.NOT_FOUND);
      } finally {
        await app.stop();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('OneBunApplication multi-service mode (docs/api/core.md)', () => {
  /**
   * @source docs:api/core.md#multiserviceapplicationoptions
   */
  it('should define multi-service configuration type', () => {
    // From docs: MultiServiceApplicationOptions
    @Module({
      controllers: [],
    })
    class UsersModule {}

    @Module({
      controllers: [],
    })
    class OrdersModule {}

    // This is just type checking, actual startup requires environment
    const config = {
      services: {
        users: {
          module: UsersModule,
          port: 3001,
          routePrefix: true,
        },
        orders: {
          module: OrdersModule,
          port: 3002,
          routePrefix: true,
        },
      },
      enabledServices: ['users', 'orders'],
    };

    expect(config.services.users.module).toBe(UsersModule);
    expect(config.services.orders.module).toBe(OrdersModule);
  });

  /**
   * @source docs:api/core.md#usage-example-1
   */
  it('should run every configured service on its own port behind its own route prefix', async () => {
    const envsLib = await import('@onebun/envs');

    // Every application in the process asks TypedEnv for the 'default' config; clear it so this
    // test's schema is the one that gets built.
    envsLib.TypedEnv.clear();

    @Controller('/profile')
    class UsersController extends BaseController {
      @Get('/')
      async profile() {
        return { service: 'users' };
      }
    }

    @Controller('/basket')
    class OrdersController extends BaseController {
      @Get('/')
      async basket() {
        return { service: 'orders' };
      }
    }

    @Module({ controllers: [UsersController] })
    class UsersModule {}

    @Module({ controllers: [OrdersController] })
    class OrdersModule {}

    // From docs: OneBunApplication multi-service usage example
    // Note: routePrefix is boolean (true = use service name as prefix).
    // The documented 3001/3002 become `port: 0` so the suite can run on a busy machine — the
    // point under test is that each service gets a port of its own, not which number it is.
    const multiApp = new OneBunApplication({
      services: {
        users: {
          module: UsersModule,
          port: 0,
          routePrefix: true, // Uses 'users' as route prefix
        },
        orders: {
          module: OrdersModule,
          port: 0,
          routePrefix: true, // Uses 'orders' as route prefix
          envOverrides: {
            DB_NAME: { value: 'orders_db' },
          },
        },
      },
      host: '127.0.0.1',
      enabledServices: ['users', 'orders'],
      // `metrics`/`tracing` are pinned by their own sections (#metrics-options, #tracing-options);
      // they are off here because prom-client's registry is process-global and two children
      // would re-register the same default metrics.
      metrics: { enabled: false },
      tracing: { enabled: false },
      logger: { minLevel: 'fatal' },
    });

    try {
      await multiApp.start();

      // Both services run in this process, each reachable at its own URL
      expect(multiApp.getRunningServices().sort()).toEqual(['orders', 'users']);
      expect(multiApp.isServiceRunning('users')).toBe(true);

      const usersUrl = multiApp.getServiceUrl('users');
      const ordersUrl = multiApp.getServiceUrl('orders');
      expect(usersUrl).not.toBe(ordersUrl);

      // `routePrefix: true` mounts each service's routes under its own service name
      const users = await fetch(`${usersUrl}/users/profile`);
      expect(users.status).toBe(HttpStatusCode.OK);
      expect(await users.json()).toEqual({ success: true, result: { service: 'users' } });

      const orders = await fetch(`${ordersUrl}/orders/basket`);
      expect(orders.status).toBe(HttpStatusCode.OK);
      expect(await orders.json()).toEqual({ success: true, result: { service: 'orders' } });

      // ...and only there: the unprefixed path is not mounted, and neither service answers for
      // the other one's routes
      expect((await fetch(`${usersUrl}/profile`)).status).toBe(HttpStatusCode.NOT_FOUND);
      expect((await fetch(`${usersUrl}/orders/basket`)).status).toBe(HttpStatusCode.NOT_FOUND);

      // getApplication() hands back the child application behind a service name
      const usersApp = multiApp.getApplication('users');
      expect(usersApp).toBeInstanceOf(OneBunApplication);
      expect(usersApp!.getHttpUrl()).toBe(usersUrl);

      // The parent is not a server itself — the single-service accessors say so rather than
      // answering for an arbitrary child
      expect(() => multiApp.getHttpUrl()).toThrow(/only available in single-service mode/);
    } finally {
      await multiApp.stop();
      envsLib.TypedEnv.clear();
    }

    // stop() took both services down
    expect(multiApp.getRunningServices()).toEqual([]);
  });
});

// ============================================================================
// docs/examples Tests
// ============================================================================

describe('Basic App Example (docs/examples/basic-app.md)', () => {
  /**
   * @source docs:examples/basic-app.md#srcconfigts
   */
  it('should define environment schema', async () => {
    const { getConfig } = await import('./');

    // The value shape `envSchema` describes, spelled out so getConfig() can be given it
    // explicitly — the schema literal below stays exactly as the page prints it.
    interface AppConfigShape {
      server: { port: number; host: string };
      app: { name: string; debug: boolean };
    }

    // From docs: src/config.ts
    const envSchema = {
      server: {
        port: Env.number({ default: 3000, env: 'PORT' }),
        host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
      },
      app: {
        name: Env.string({ default: 'basic-app', env: 'APP_NAME' }),
        debug: Env.boolean({ default: false, env: 'DEBUG' }),
      },
    };

    // Each declaration carries the type, the default and the variable name the page
    // documents — the `.env` section of the same page relies on exactly these names.
    expect(envSchema.server.port).toMatchObject({ type: 'number', default: 3000, env: 'PORT' });
    expect(envSchema.server.host).toMatchObject({ type: 'string', default: '0.0.0.0', env: 'HOST' });
    expect(envSchema.app.name).toMatchObject({ type: 'string', default: 'basic-app', env: 'APP_NAME' });
    expect(envSchema.app.debug).toMatchObject({ type: 'boolean', default: false, env: 'DEBUG' });

    // The schema resolves: each documented variable feeds its path, parsed to the declared
    // type (3000 as a number, 'true' as a boolean) rather than left as a string.
    const config = getConfig<AppConfigShape>(envSchema, {
      loadDotEnv: false,
      valueOverrides: {
         
        PORT: '8081',
         
        HOST: '127.0.0.1',
         
        APP_NAME: 'from-env',
         
        DEBUG: 'true',
      },
    });

    expect(config.isInitialized).toBe(true);
    expect(config.get('server.port')).toBe(8081);
    expect(config.get('server.host')).toBe('127.0.0.1');
    expect(config.get('app.name')).toBe('from-env');
    expect(config.get('app.debug')).toBe(true);

    // ...and the documented defaults apply when the variable is absent. Declared against
    // names nothing in this process can set, so the assertion does not depend on the
    // ambient environment the suite happens to run in.
    const defaults = getConfig<AppConfigShape>({
      server: {
        port: Env.number({ default: 3000, env: 'ONEBUN_DOCS_BASIC_APP_PORT' }),
        host: Env.string({ default: '0.0.0.0', env: 'ONEBUN_DOCS_BASIC_APP_HOST' }),
      },
      app: {
        name: Env.string({ default: 'basic-app', env: 'ONEBUN_DOCS_BASIC_APP_NAME' }),
        debug: Env.boolean({ default: false, env: 'ONEBUN_DOCS_BASIC_APP_DEBUG' }),
      },
    }, { loadDotEnv: false });

    expect(defaults.get('server.port')).toBe(3000);
    expect(defaults.get('server.host')).toBe('0.0.0.0');
    expect(defaults.get('app.name')).toBe('basic-app');
    expect(defaults.get('app.debug')).toBe(false);
  });

  /**
   * @source docs:examples/basic-app.md#srchelloservicets
   */
  it('should define HelloService', async () => {
    const effectLib = await import('effect');
    const loggerMod = await import('@onebun/logger');
    const { createMockLogger } = await import('./testing');

    const infoCalls: Array<{ message: string; args: unknown[] }> = [];
    const base = createMockLogger();
    const recording: typeof base = {
      ...base,
      info(message: string, ...args: unknown[]) {
        infoCalls.push({ message, args });

        return base.info(message, ...args);
      },
      child: () => recording,
    };

    // From docs: src/hello.service.ts
    @Service()
    class HelloService extends BaseService {
      private greetCount = 0;

      greet(name: string): string {
        this.greetCount++;
        this.logger.info('Generating greeting', {
          name,
          greetCount: this.greetCount,
        });

        return `Hello, ${name}! You are visitor #${this.greetCount}`;
      }

      sayHello(): string {
        return 'Hello from OneBun!';
      }

      getStats(): { greetCount: number; uptime: number } {
        return {
          greetCount: this.greetCount,
          uptime: process.uptime(),
        };
      }
    }

    @Module({ providers: [HelloService] })
    class HelloModule {}

    const module = new OneBunModule(
      HelloModule,
      effectLib.Layer.succeed(loggerMod.LoggerService, recording),
      undefined,
      undefined,
      undefined,
      createGlobalScope(),
    );
    const hello = module.getServiceByClass(HelloService) as HelloService;

    expect(hello).toBeInstanceOf(HelloService);

    // The exact strings the page's "Testing the API" section shows
    expect(hello.sayHello()).toBe('Hello from OneBun!');
    expect(hello.greet('World')).toBe('Hello, World! You are visitor #1');
    expect(hello.greet('Alice')).toBe('Hello, Alice! You are visitor #2');

    // greetCount is per-instance state that survives across calls; uptime is live
    const stats = hello.getStats();
    expect(stats.greetCount).toBe(2);
    expect(typeof stats.uptime).toBe('number');
    expect(stats.uptime).toBeGreaterThan(0);

    // sayHello() does not touch the counter
    hello.sayHello();
    expect(hello.getStats().greetCount).toBe(2);

    // this.logger is the application's logger, and greet() logs what the page shows
    expect(infoCalls).toEqual([
      { message: 'Generating greeting', args: [{ name: 'World', greetCount: 1 }] },
      { message: 'Generating greeting', args: [{ name: 'Alice', greetCount: 2 }] },
    ]);
  });

  /**
   * @source docs:examples/basic-app.md#srchellocontrollerts
   */
  it('should define HelloController', async () => {
    @Service()
    class HelloService extends BaseService {
      private greetCount = 0;

      sayHello(): string {
        return 'Hello from OneBun!';
      }

      greet(name: string): string {
        this.greetCount++;

        return `Hello, ${name}! You are visitor #${this.greetCount}`;
      }

      getStats(): { greetCount: number; uptime: number } {
        return { greetCount: this.greetCount, uptime: process.uptime() };
      }
    }

    // From docs: src/hello.controller.ts — handlers return plain objects, the framework
    // wraps them in the { success, result } envelope the page's responses show.
    @Controller('/api')
    class HelloController extends BaseController {
      constructor(private helloService: HelloService) {
        super();
      }

      @Get('/hello')
      async hello() {
        this.logger.info('Hello endpoint called');
        const message = this.helloService.sayHello();

        return { message };
      }

      @Get('/hello/:name')
      async greet(@Param('name') name: string) {
        this.logger.info('Greet endpoint called', { name });
        const greeting = this.helloService.greet(name);

        return { greeting };
      }

      @Get('/stats')
      async stats() {
        return this.helloService.getStats();
      }

      @Get('/health')
      async health() {
        return {
          status: 'healthy',
          timestamp: new Date().toISOString(),
        };
      }
    }

    @Module({ controllers: [HelloController], providers: [HelloService] })
    class BasicAppModule {}

    const app = new OneBunApplication(BasicAppModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const baseUrl = app.getHttpUrl();

      // From docs "Testing the API": GET /api/hello
      const hello = await fetch(`${baseUrl}/api/hello`);
      expect(hello.status).toBe(HttpStatusCode.OK);
      expect(await hello.json()).toEqual({
        success: true,
        result: { message: 'Hello from OneBun!' },
      });

      // GET /api/hello/World then /api/hello/Alice — @Param('name') feeds the service,
      // and the visitor counter is the same instance across requests
      const world = await fetch(`${baseUrl}/api/hello/World`);
      expect(await world.json()).toEqual({
        success: true,
        result: { greeting: 'Hello, World! You are visitor #1' },
      });

      const alice = await fetch(`${baseUrl}/api/hello/Alice`);
      expect(await alice.json()).toEqual({
        success: true,
        result: { greeting: 'Hello, Alice! You are visitor #2' },
      });

      // GET /api/stats — the static route wins over `/hello/:name`, and reports the count
      const stats = await fetch(`${baseUrl}/api/stats`);
      const statsBody = await stats.json() as { success: boolean; result: { greetCount: number; uptime: number } };
      expect(statsBody.success).toBe(true);
      expect(statsBody.result.greetCount).toBe(2);
      expect(typeof statsBody.result.uptime).toBe('number');

      // GET /api/health
      const health = await fetch(`${baseUrl}/api/health`);
      expect(health.status).toBe(HttpStatusCode.OK);
      const healthBody = await health.json() as { success: boolean; result: { status: string; timestamp: string } };
      expect(healthBody).toMatchObject({ success: true, result: { status: 'healthy' } });
      expect(Number.isNaN(Date.parse(healthBody.result.timestamp))).toBe(false);

      // Nothing is mounted outside the '/api' prefix the @Controller declares
      expect((await fetch(`${baseUrl}/hello`)).status).toBe(HttpStatusCode.NOT_FOUND);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:examples/basic-app.md#srcappmodulets
   */
  it('should define AppModule', async () => {
    const effectLib = await import('effect');
    const { getModuleMetadata } = await import('./');
    const { createMockConfig } = await import('./testing');

    @Service()
    class HelloService extends BaseService {
      sayHello(): string {
        return 'Hello from OneBun!';
      }
    }

    @Controller('/api')
    class HelloController extends BaseController {
      constructor(private helloService: HelloService) {
        super();
      }

      @Get('/hello')
      async hello() {
        return { message: this.helloService.sayHello() };
      }
    }

    // From docs: src/app.module.ts
    @Module({
      controllers: [HelloController],
      providers: [HelloService],
    })
    class AppModule {}

    // The decorator records exactly what the page declares...
    const metadata = getModuleMetadata(AppModule);
    expect(metadata!.controllers).toEqual([HelloController]);
    expect(metadata!.providers).toEqual([HelloService]);

    // ...and that declaration is what wires the app: the module builds the provider,
    // builds the controller, and hands the provider to the controller's constructor.
    const module = new OneBunModule(
      AppModule,
      makeMockLoggerLayer(),
      createMockConfig({}),
      undefined,
      undefined,
      createGlobalScope(),
    );
    await effectLib.Effect.runPromise(
      module.setup() as import('effect').Effect.Effect<unknown, never, never>,
    );

    const service = module.getServiceByClass(HelloService) as HelloService;
    expect(service).toBeInstanceOf(HelloService);

    const controller = module.getControllerInstance(HelloController) as unknown as {
      helloService: HelloService;
      hello(): Promise<{ message: string }>;
    };
    expect(controller).toBeInstanceOf(HelloController);
    // The very instance the module provides, not a second one built on the side
    expect(controller.helloService).toBe(service);
    expect(await controller.hello()).toEqual({ message: 'Hello from OneBun!' });
  });
});

// ============================================================================
// Architecture & Getting Started Tests
// ============================================================================

describe('Architecture Documentation (docs/architecture.md)', () => {
  describe('DI Resolution Flow (docs/architecture.md)', () => {
    /**
     * @source docs:architecture.md#di-resolution-flow
     */
    it('should demonstrate DI resolution flow', async () => {
      const effectLib = await import('effect');

      const created: string[] = [];
      let loggerInServiceCtor: string | undefined;
      let configInServiceCtor: string | undefined;

      // From docs: DI Resolution Flow example
      // 1. Service is decorated
      @Service()
      class CacheService extends BaseService {
        constructor() {
          super();
          created.push('CacheService');
        }

        get(_key: string) {
          return null;
        }
      }

      @Module({ providers: [CacheService], exports: [CacheService] })
      class CacheModule {}

      @Service()
      class UserService extends BaseService {
        constructor(public readonly cacheService: CacheService) {
          super();
          created.push('UserService');
          // docs step (c): "config and logger available in constructor after super()"
          loggerInServiceCtor = typeof this.logger?.info;
          configInServiceCtor = typeof this.config?.get;
        }
      }

      // 2. Module declares dependencies
      @Controller('/users')
      class UserController extends BaseController {
        constructor(public readonly userService: UserService) {
          super();
          created.push('UserController');
        }
      }

      @Module({
        imports: [CacheModule], // provides CacheService
        providers: [UserService],
        controllers: [UserController],
      })
      class UserModule {}

      const module = new OneBunModule(
        UserModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
      );
      module.getLayer();
      await effectLib.Effect.runPromise(module.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // 3. At startup the framework walks the documented order: (a) CacheService from the
      // imported module, (c) UserService with it injected, (e) UserController last
      expect(created).toEqual(['CacheService', 'UserService', 'UserController']);

      // (b) the ambient init context is in place before the constructor body runs
      expect(loggerInServiceCtor).toBe('function');
      expect(configInServiceCtor).toBe('function');

      // and the wiring is by identity, not by a fresh instance per injection site
      const cache = module.getServiceByClass(CacheService) as CacheService;
      const users = module.getServiceByClass(UserService) as UserService;
      const controller = module.getControllerInstance(UserController) as unknown as UserController;

      expect(cache).toBeInstanceOf(CacheService);
      expect(users.cacheService).toBe(cache);
      expect(controller.userService).toBe(users);
    });

    /**
     * @source docs:architecture.md#automatic-di-recommended
     */
    it('should demonstrate automatic DI without @Inject', async () => {
      // From docs: Automatic DI example
      // TypeScript's emitDecoratorMetadata provides type info automatically
      @Service()
      class UserService extends BaseService {
        findAll(): string[] {
          return ['ada'];
        }
      }

      @Service()
      class CacheService extends BaseService {
        private readonly store = new Map<string, string>();

        set(key: string, value: string): void {
          this.store.set(key, value);
        }

        get(key: string): string | undefined {
          return this.store.get(key);
        }
      }

      // No @Inject needed - automatic DI works via emitDecoratorMetadata
      // @Inject is only needed for: token-based injection (which named registration),
      // or overriding the type inferred from design:paramtypes
      @Controller('/users')
      class UserController extends BaseController {
        constructor(
          private userService: UserService,
          private cache: CacheService,
        ) {
          super();
        }

        @Get('/')
        async list() {
          this.cache.set('last', 'list');

          // both parameters really are the registered instances: the handler calls through
          // them, so a controller built with undefined arguments would 500 here
          return { users: this.userService.findAll(), cached: this.cache.get('last') };
        }
      }

      @Module({ controllers: [UserController], providers: [UserService, CacheService] })
      class UserModule {}

      const app = new OneBunApplication(UserModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();

        const response = await fetch(`${app.getHttpUrl()}/users`);

        expect(response.status).toBe(HttpStatusCode.OK);
        expect(await response.json()).toEqual({
          success: true,
          result: { users: ['ada'], cached: 'list' },
        });
      } finally {
        await app.stop();
      }
    });

    /**
     * An abstract-class-typed parameter is the case that needs NO @Inject: DI matches a
     * registered subclass by inheritance. @Inject(AbstractClass) does not even typecheck.
     *
     * @source docs:architecture.md#explicit-injection-edge-cases
     */
    it('should resolve an abstract-class-typed parameter without @Inject', async () => {
      abstract class AbstractPaymentGateway extends BaseService {
        abstract charge(): string;
      }

      @Service()
      class StripeGateway extends AbstractPaymentGateway {
        charge(): string {
          return 'stripe';
        }
      }

      @Controller('/billing')
      class BillingController extends BaseController {
        // no @Inject — the declared type is the ABSTRACT base
        constructor(private gateway: AbstractPaymentGateway) {
          super();
        }

        @Get('/charge')
        async charge() {
          return { via: this.gateway.charge(), ctor: this.gateway.constructor.name };
        }
      }

      @Module({ controllers: [BillingController], providers: [StripeGateway] })
      class BillingModule {}

      const app = new OneBunApplication(BillingModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();

      try {
        const response = await fetch(`http://localhost:${app.getPort()}/billing/charge`);
        expect(await response.json()).toEqual({
          success: true,
          result: { via: 'stripe', ctor: 'StripeGateway' },
        });
      } finally {
        await app.stop();
      }
    });

    /**
     * @source docs:architecture.md#explicit-injection-edge-cases
     */
    it('should reject a { provide, useClass } object provider at startup', async () => {
      abstract class AbstractPaymentGateway extends BaseService {
        abstract charge(): string;
      }

      @Service()
      class StripeGateway extends AbstractPaymentGateway {
        charge(): string {
          return 'stripe';
        }
      }

      @Module({
        // There is no binding form: OneBun takes classes, not object providers
        providers: [{ provide: AbstractPaymentGateway, useClass: StripeGateway }],
      })
      class BadModule {}

      const app = new OneBunApplication(BadModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });

      await expect(app.start()).rejects.toThrow(/OneBun supports class-based providers only/);
    });
  });

  describe('Module System (docs/architecture.md)', () => {
    /**
     * @source docs:architecture.md#service-exportimport
     */
    it('should demonstrate module export/import pattern', async () => {
      const effectLib = await import('effect');

      // From docs: Module Assembly
      @Service()
      class SharedService extends BaseService {
        value(): string {
          return 'shared';
        }
      }

      // Module that exports services
      @Module({
        providers: [SharedService],
        exports: [SharedService],
      })
      class SharedModule {}

      // Module that imports services
      @Controller('/api')
      class ApiController extends BaseController {
        constructor(public readonly shared: SharedService) {
          super();
        }
      }

      @Module({
        imports: [SharedModule],
        controllers: [ApiController],
      })
      class ApiModule {}

      const module = new OneBunModule(
        ApiModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
      );
      module.getLayer();
      await effectLib.Effect.runPromise(module.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // the exported service crosses the module boundary as the same singleton
      const shared = module.getServiceByClass(SharedService) as SharedService;
      const controller = module.getControllerInstance(ApiController) as unknown as ApiController;

      expect(shared).toBeInstanceOf(SharedService);
      expect(controller.shared).toBe(shared);
      expect(controller.shared.value()).toBe('shared');

      // From docs: exports are what makes it reachable — drop them and the same wiring fails
      @Service()
      class PrivateService extends BaseService {
        value(): string {
          return 'private';
        }
      }

      @Module({ providers: [PrivateService] })
      class PrivateModule {}

      @Controller('/private')
      class PrivateConsumerController extends BaseController {
        constructor(public readonly hidden: PrivateService) {
          super();
        }
      }

      @Module({
        imports: [PrivateModule],
        controllers: [PrivateConsumerController],
      })
      class ConsumerModule {}

      const broken = new OneBunModule(
        ConsumerModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
      );
      broken.getLayer();

      await expect(
        effectLib.Effect.runPromise(broken.setup() as import('effect').Effect.Effect<unknown, never, never>),
      ).rejects.toThrow(/PrivateService exists in PrivateModule but is not exported/);
    });

    /**
     * Exports are only required for cross-module injection.
     * Within a module, any provider can be injected into controllers without being in exports.
     */
    it('should allow controller to inject same-module provider without exports', async () => {
      const effectLib = await import('effect');
      const moduleMod = await import('./module/module');
      const testUtils = await import('./testing/test-utils');
      const decorators = await import('./decorators/decorators');

      @Service()
      class InternalService extends BaseService {
        getData(): string {
          return 'internal';
        }
      }

      @Controller('/local')
      class LocalController extends BaseController {
        constructor(@decorators.Inject(InternalService) private readonly internal: InternalService) {
          super();
        }
        getData(): string {
          return this.internal.getData();
        }
      }

      @Module({
        providers: [InternalService],
        controllers: [LocalController],
        // No exports - InternalService is only used inside this module
      })
      class LocalModule {}

      const mod = new moduleMod.OneBunModule(LocalModule, testUtils.makeMockLoggerLayer());
      mod.getLayer();
      await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);

      const controller = mod.getControllerInstance(LocalController) as LocalController;
      expect(controller).toBeDefined();
      expect(controller.getData()).toBe('internal');
    });

    /**
     * The documented Shutdown Phase: the HTTP listener is refused/drained/closed BEFORE the
     * first destroy hook, then the three hooks run in order.
     *
     * @source docs:architecture.md#module-lifecycle
     */
    it('should close the HTTP listener before any destroy hook, then run hooks in order', async () => {
      const order: string[] = [];
      let probeUrl = '';
      let fromInsideHook: number | string = 0;

      @Service()
      class ShutdownOrderService extends BaseService
        implements BeforeApplicationDestroy, OnModuleDestroy, OnApplicationDestroy {
        async beforeApplicationDestroy(signal?: string): Promise<void> {
          order.push(`beforeApplicationDestroy:${String(signal)}`);
          fromInsideHook = await fetch(probeUrl).then(
            response => response.status,
            () => 'connection-error',
          );
        }

        async onModuleDestroy(): Promise<void> {
          order.push('onModuleDestroy');
        }

        async onApplicationDestroy(signal?: string): Promise<void> {
          order.push(`onApplicationDestroy:${String(signal)}`);
        }
      }

      @Controller('/lifecycle')
      class LifecycleController extends BaseController {
        @Get('/ping')
        async ping() {
          return { ok: true };
        }
      }

      @Module({ controllers: [LifecycleController], providers: [ShutdownOrderService] })
      class LifecycleModule {}

      const app = new OneBunApplication(LifecycleModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();
      probeUrl = `http://localhost:${app.getPort()}/lifecycle/ping`;

      expect((await fetch(probeUrl)).status).toBe(200);

      await app.stop({ signal: 'SIGTERM' });

      // Phases 1-3 already happened: the listener no longer serves by the time hooks run
      expect([503, 'connection-error']).toContain(fromInsideHook);
      expect(order).toEqual([
        'beforeApplicationDestroy:SIGTERM',
        'onModuleDestroy',
        'onApplicationDestroy:SIGTERM',
      ]);
    });
  });
});

describe('Getting Started Documentation (docs/getting-started.md)', () => {
  describe('Environment Schema (docs/getting-started.md)', () => {
    /**
     * @source docs:getting-started.md#step-3-create-environment-schema
     */
    it('should define type-safe environment schema', () => {
      // From docs: src/config.ts
      const envSchema = {
        server: {
          port: Env.number({ default: 3000, env: 'PORT' }),
          host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
        },
        app: {
          name: Env.string({ default: 'my-onebun-app', env: 'APP_NAME' }),
          debug: Env.boolean({ default: true, env: 'DEBUG' }),
        },
        database: {
          url: Env.string({ env: 'DATABASE_URL', sensitive: true }),
        },
      };

      expect(envSchema.server.port.type).toBe('number');
      expect(envSchema.server.host.type).toBe('string');
      expect(envSchema.app.debug.type).toBe('boolean');
      expect(envSchema.database.url.sensitive).toBe(true);
    });
  });

  describe('Service Creation (docs/getting-started.md)', () => {
    /**
     * @source docs:getting-started.md#step-4-create-a-service
     */
    it('should create service with logger access', async () => {
      const effectLib = await import('effect');
      const loggerMod = await import('@onebun/logger');
      const { createMockLogger } = await import('./testing');

      const infoCalls: Array<{ message: string; args: unknown[] }> = [];
      const base = createMockLogger();
      // A recording logger instead of the silent mock: `this.logger` inside the service must
      // be the logger the framework was built with, not a stand-in the service made itself.
      const recording: typeof base = {
        ...base,
        info(message: string, ...args: unknown[]) {
          infoCalls.push({ message, args });

          return base.info(message, ...args);
        },
        child: () => recording,
      };

      // From docs: src/hello.service.ts
      @Service()
      class HelloService extends BaseService {
        private greetCount = 0;

        greet(name: string): string {
          this.greetCount++;
          this.logger.info('Generating greeting', { name, count: this.greetCount });

          return `Hello, ${name}! You are visitor #${this.greetCount}`;
        }

        getCount(): number {
          return this.greetCount;
        }
      }

      // From docs: "@Service() registers the class for DI"
      @Module({ providers: [HelloService] })
      class HelloModule {}

      const module = new OneBunModule(
        HelloModule,
        effectLib.Layer.succeed(loggerMod.LoggerService, recording),
        undefined,
        undefined,
        undefined,
        createGlobalScope(),
      );
      const hello = module.getServiceByClass(HelloService) as HelloService;

      expect(hello).toBeInstanceOf(HelloService);
      expect(hello.greet('Alice')).toBe('Hello, Alice! You are visitor #1');
      expect(hello.greet('Bob')).toBe('Hello, Bob! You are visitor #2');
      expect(hello.getCount()).toBe(2);

      // From docs: "BaseService provides this.logger" — it reaches the application logger
      const greetLogs = infoCalls.filter((call) => call.message === 'Generating greeting');
      expect(greetLogs).toHaveLength(2);
      expect(greetLogs[0]?.args[0]).toEqual({ name: 'Alice', count: 1 });
      expect(greetLogs[1]?.args[0]).toEqual({ name: 'Bob', count: 2 });
    });
  });

  describe('Validation Schema (docs/getting-started.md)', () => {
    /**
     * @source docs:getting-started.md#step-5-create-validation-schema
     */
    it('should create schema with exported type', () => {
      // From docs: src/hello.schema.ts
      /* eslint-disable @typescript-eslint/naming-convention */
      const greetBodySchema = type({
        name: 'string',
        'message?': 'string',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      type GreetBody = typeof greetBodySchema.infer;

      expect(greetBodySchema).toBeDefined();

      const valid: GreetBody = { name: 'Alice' };

      expect(valid.name).toBe('Alice');
    });
  });

  describe('Controller Creation (docs/getting-started.md)', () => {
    /**
     * @source docs:getting-started.md#step-6-create-a-controller
     */
    it('should create controller with imported schema and named type', async () => {
      // From docs: src/hello.schema.ts (imported in controller)
      /* eslint-disable @typescript-eslint/naming-convention */
      const greetBodySchema = type({
        name: 'string',
        'message?': 'string',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      type GreetBody = typeof greetBodySchema.infer;

      @Service()
      class HelloService extends BaseService {
        private greetCount = 0;

        greet(name: string) {
          this.greetCount++;

          return `Hello, ${name}! You are visitor #${this.greetCount}`;
        }

        getCount() {
          return this.greetCount;
        }
      }

      // From docs: src/hello.controller.ts
      @Controller('/api/hello')
      class HelloController extends BaseController {
        constructor(private helloService: HelloService) {
          super();
        }

        @Get('/')
        async hello() {
          return { message: 'Hello from OneBun!' };
        }

        // From docs: "Route declaration order does not matter — Bun's router resolves by
        // specificity (static > parametric > wildcard)", so the parametric route is
        // deliberately declared BEFORE the static one here.
        @Get('/:name')
        async greetByPath(@Param('name') name: string) {
          const greeting = this.helloService.greet(name);

          return { greeting };
        }

        @Get('/stats')
        async stats() {
          return { totalGreets: this.helloService.getCount() };
        }

        @Post('/greet')
        async greetWithBody(@Body(greetBodySchema) body: GreetBody) {
          const greeting = this.helloService.greet(body.name);

          return { greeting, customMessage: body.message };
        }
      }

      @Module({ controllers: [HelloController], providers: [HelloService] })
      class AppModule {}

      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();

        // From docs: Expected Responses
        const hello = await fetch(`${app.getHttpUrl()}/api/hello`);
        expect(hello.status).toBe(HttpStatusCode.OK);
        expect(await hello.json()).toEqual({
          success: true,
          result: { message: 'Hello from OneBun!' },
        });

        // @Param('name') extracts the path segment
        const byPath = await fetch(`${app.getHttpUrl()}/api/hello/World`);
        expect(await byPath.json()).toEqual({
          success: true,
          result: { greeting: 'Hello, World! You are visitor #1' },
        });

        // the static route wins over `/:name` despite being declared after it
        const stats = await fetch(`${app.getHttpUrl()}/api/hello/stats`);
        expect(await stats.json()).toEqual({ success: true, result: { totalGreets: 1 } });

        // @Body(schema) validates and injects
        const greeted = await fetch(`${app.getHttpUrl()}/api/hello/greet`, {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alice', message: 'Welcome!' }),
        });
        expect(await greeted.json()).toEqual({
          success: true,
          result: { greeting: 'Hello, Alice! You are visitor #2', customMessage: 'Welcome!' },
        });

        // ...and refuses a body the schema rejects, before the handler runs
        const rejected = await fetch(`${app.getHttpUrl()}/api/hello/greet`, {
          method: 'POST',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'no name' }),
        });
        expect(rejected.status).toBe(HttpStatusCode.BAD_REQUEST);
        expect(await rejected.json()).toMatchObject({ success: false });

        // the rejected request never reached the service
        const statsAfter = await fetch(`${app.getHttpUrl()}/api/hello/stats`);
        expect(await statsAfter.json()).toEqual({ success: true, result: { totalGreets: 2 } });
      } finally {
        await app.stop();
      }
    });
  });

  describe('Module Definition (docs/getting-started.md)', () => {
    /**
     * @source docs:getting-started.md#step-7-create-the-module
     */
    it('should create module with controllers and providers', async () => {
      const effectLib = await import('effect');

      @Service()
      class HelloService extends BaseService {
        greet(): string {
          return 'Hello from OneBun!';
        }
      }

      @Controller('/api/hello')
      class HelloController extends BaseController {
        constructor(public readonly helloService: HelloService) {
          super();
        }

        @Get('/')
        async hello() {
          return { message: this.helloService.greet() };
        }
      }

      // From docs: src/app.module.ts
      @Module({
        controllers: [HelloController],
        providers: [HelloService],
      })
      class AppModule {}

      const module = new OneBunModule(
        AppModule, makeMockLoggerLayer(), undefined, undefined, undefined, createGlobalScope(),
      );
      module.getLayer();
      await effectLib.Effect.runPromise(module.setup() as import('effect').Effect.Effect<unknown, never, never>);

      // From docs: `controllers` are the classes the module mounts, `providers` the services
      // it instantiates — and a provider is injectable into the module's own controllers
      // without being listed in `exports`.
      expect(module.getControllers()).toContain(HelloController);
      expect(module.getServiceByClass(HelloService)).toBeInstanceOf(HelloService);

      const controller = module.getControllerInstance(HelloController) as unknown as HelloController;

      expect(controller).toBeInstanceOf(HelloController);
      expect(controller.helloService).toBe(module.getServiceByClass(HelloService) as HelloService);
      expect(await controller.hello()).toEqual({ message: 'Hello from OneBun!' });
    });
  });

  describe('Application Entry Point (docs/getting-started.md)', () => {
    /**
     * @source docs:getting-started.md#step-8-create-entry-point
     */
    it('should start the entry-point application with env config, metrics and tracing live', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const envsLib = await import('@onebun/envs');
      const { getCurrentTraceContext } = await import('@onebun/core');

      const seenTraceIds: Array<string | null> = [];

      @Controller('/hello')
      class HelloController extends BaseController {
        @Get('/')
        async hello() {
          seenTraceIds.push(getCurrentTraceContext()?.traceId ?? null);

          return { name: this.config.get('app.name') };
        }
      }

      @Module({ controllers: [HelloController] })
      class AppModule {}

      // From docs (Step 3): src/config.ts
      const envSchema = {
        server: {
          port: Env.number({ default: 3000, env: 'PORT' }),
          host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
        },
        app: {
          name: Env.string({ default: 'my-onebun-app', env: 'APP_NAME' }),
          debug: Env.boolean({ default: true, env: 'DEBUG' }),
        },
      };

      // A .env of this test's own, so `loadDotEnv` is checked against a known file instead of
      // whatever the repository's .env happens to hold.
      const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'onebun-docs-env-'));
      const envFilePath = path.join(tmpDir, '.env');
      fs.writeFileSync(envFilePath, 'APP_NAME=entrypoint-app\nDEBUG=false\n', 'utf8');

      // Every application in the process asks TypedEnv for the 'default' config; clear it so
      // this schema and this .env are the ones that get loaded.
      envsLib.TypedEnv.clear();

      // From docs: src/index.ts. `port: 0` replaces the commented-out 3000 so the suite can run
      // anywhere, and metrics carry a prefix unique to this test because prom-client's registry
      // is process-global.
      const app = new OneBunApplication(AppModule, {
        port: 0,
        host: '127.0.0.1',
        development: true,
        envSchema,
        envOptions: {
          loadDotEnv: true,
          envFilePath,
        },
        loggerLayer: makeMockLoggerLayer(),
        gracefulShutdown: false,
        metrics: {
          enabled: true,
          path: '/metrics',
          prefix: 'gettingstarted_',
          collectHttpMetrics: true,
          collectSystemMetrics: false,
        },
        tracing: {
          enabled: true,
          serviceName: 'my-onebun-app',
        },
      });

      try {
        await app.start();

        // envSchema + envOptions: the values the .env file supplies win over the schema defaults,
        // and are reachable both from the application and from a controller's `this.config`
        expect(app.getConfigValue<string>('app.name')).toBe('entrypoint-app');
        expect(app.getConfig().get('app.debug')).toBe(false);

        // "port and host can be omitted — they'll use PORT/HOST env vars or defaults": a real
        // environment variable outranks both the .env file and the schema default, and the
        // default stands in when nothing sets the variable. (Bun preloads the repository's own
        // .env into process.env, so which branch applies depends on where this runs.)
        const envPort = process.env.PORT;
        expect(app.getConfigValue<number>('server.port')).toBe(envPort === undefined ? 3000 : Number(envPort));

        const response = await fetch(`${app.getHttpUrl()}/hello`);
        expect(response.status).toBe(HttpStatusCode.OK);
        expect(await response.json()).toEqual({ success: true, result: { name: 'entrypoint-app' } });

        // tracing.enabled: the request ran inside a trace context
        expect(seenTraceIds).toHaveLength(1);
        expect(seenTraceIds[0]).toMatch(/^[0-9a-f]{32}$/);

        // metrics.enabled + path: the documented endpoint serves the served request's counter
        const metrics = await fetch(`${app.getHttpUrl()}/metrics`);
        expect(metrics.status).toBe(HttpStatusCode.OK);
        expect(await metrics.text()).toMatch(
          /gettingstarted_http_requests_total\{[^}]*route="\/hello"[^}]*\} 1/,
        );

        // ...and the documented bootstrap continuation has a real logger to log through
        const logger = app.getLogger({ className: 'AppBootstrap' });
        expect(logger.child({ extra: true })).not.toBeUndefined();
      } finally {
        await app.stop();
        envsLib.TypedEnv.clear();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// ============================================================================
// WebSocket Gateway Documentation Tests
// ============================================================================

/**
 * Drive a gateway through the real WebSocket pipeline, with a fake socket instead of a port.
 *
 * Everything between the socket and the handler body is production code: `WsHandler` routing,
 * pattern matching, guard execution, parameter injection, room bookkeeping and response
 * encoding. Only the transport is faked. A gateway whose handlers stopped being reachable
 * therefore fails these tests — unlike `expect(Gateway).toBeDefined()`, which the decorator
 * alone satisfies even when nothing behind it works.
 */
async function createWsGatewayHarness(gatewayClass: Function, instance: BaseWebSocketGateway) {
  const { WsHandler: wsHandlerClass } = await import('./websocket/ws-handler');
  const { InMemoryWsStorage: inMemoryStorageClass } = await import('./websocket/ws-storage-memory');
  const { createNativeMessage, parseNativeMessage } = await import('./websocket/ws-socketio-protocol');
  const { createMockConfig, createMockSyncLogger } = await import('./testing/test-utils');

  // A no-op for a gateway built by module DI; a hand-built one needs `this.logger` to exist
  // before a handler that logs can run at all.
  instance._initializeBase(createMockSyncLogger(), createMockConfig());

  const storage = new inMemoryStorageClass();
  const wsHandler = new wsHandlerClass(createMockSyncLogger());
  wsHandler.setStorage(storage);
  wsHandler.registerGateway(gatewayClass, instance);

  const sent: string[] = [];
  const published: { topic: string; message: string }[] = [];
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  const peerIds: string[] = [];

  const server = {
    publish(topic: string, message: string) {
      published.push({ topic, message });

      return message.length;
    },
  } as unknown as import('bun').Server<WsClientData>;

  const makeSocket = (data: WsClientData, out: string[]): ServerWebSocket<WsClientData> => {
    const fake = {
      data,
      send(message: string) {
        out.push(message);

        return message.length;
      },
      close: () => undefined,
      subscribe(topic: string) {
        subscribed.push(topic);
      },
      unsubscribe(topic: string) {
        unsubscribed.push(topic);
      },
    };

    return fake as unknown as ServerWebSocket<WsClientData>;
  };

  const client: WsClientData = {
    id: `client-${crypto.randomUUID()}`,
    rooms: [],
    connectedAt: Date.now(),
    auth: null,
    metadata: {},
    protocol: 'native',
  };
  const socket = makeSocket(client, sent);

  wsHandler.initializeGateways(server);

  // Bun declares these callbacks as returning void, but each one returns the handler's
  // promise; awaiting it is what makes the assertions deterministic instead of racing the
  // pipeline.
  const bunHandlers = wsHandler.createWebSocketHandlers() as unknown as {
    open: (ws: ServerWebSocket<WsClientData>) => Promise<void>;
    message: (ws: ServerWebSocket<WsClientData>, message: string) => Promise<void>;
    close: (ws: ServerWebSocket<WsClientData>, code: number, reason: string) => Promise<void>;
  };

  return {
    client,
    socket,
    server,
    storage,
    sent,
    published,
    subscribed,
    unsubscribed,
    /** Every frame the server pushed to this client, decoded. */
    frames: () => sent.map((raw) => parseNativeMessage(raw)),
    /** A second connected client, optionally already inside `room`, to watch fan-out. */
    async addPeer(room?: string) {
      const peerSent: string[] = [];
      const peer: WsClientData = {
        id: `peer-${crypto.randomUUID()}`,
        rooms: room ? [room] : [],
        connectedAt: Date.now(),
        auth: null,
        metadata: {},
        protocol: 'native',
      };

      await storage.addClient(peer);
      if (room) {
        await storage.addClientToRoom(peer.id, room);
      }
      instance._registerSocket(peer.id, makeSocket(peer, peerSent));
      peerIds.push(peer.id);

      return { id: peer.id, frames: () => peerSent.map((raw) => parseNativeMessage(raw)) };
    },
    /**
     * Run the gateway's own `authenticate` hook the way the upgrade does, and adopt the
     * identity it produced onto this connection — so guards read what the hook attached
     * rather than what a test hand-wrote.
     */
    async authenticateAs(token?: string) {
      const path = getGatewayMetadata(gatewayClass)?.path ?? '/';
      const url = `http://localhost${path}${token === undefined ? '' : `?token=${token}`}`;
      const upgraded: WsClientData[] = [];
      const upgradeServer = {
        upgrade(_request: Request, options: { data: WsClientData }) {
          upgraded.push(options.data);

          return true;
        },
      } as unknown as import('bun').Server<WsClientData>;

      const response = await wsHandler.handleUpgrade(new Request(url), upgradeServer);
      if (upgraded[0]) {
        client.auth = upgraded[0].auth;
        client.metadata = upgraded[0].metadata;
      }

      return { response, upgraded: upgraded[0] };
    },
    async connect() {
      await bunHandlers.open(socket);
    },
    async send(event: string, data?: unknown, ack?: number) {
      await bunHandlers.message(socket, createNativeMessage(event, data, ack));
    },
    /** Room fan-out is fire-and-forget inside the gateway; let it land before asserting. */
    async flush() {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    },
    async disconnect() {
      await bunHandlers.close(socket, 1000, 'test over');
      // The socket registry is process-wide, so a leftover fake socket would keep receiving
      // the broadcasts of every later test.
      for (const id of peerIds) {
        instance._unregisterSocket(id);
      }
    },
  };
}

describe('WebSocket Gateway API Documentation (docs/api/websocket.md)', () => {
  describe('@WebSocketGateway decorator', () => {
    /**
     * @source docs:api/websocket.md#websocketgateway-decorator
     */
    it('should define gateway with path and namespace', async () => {
      // From docs: WebSocketGateway Decorator example
      @WebSocketGateway({ path: '/ws', namespace: 'chat' })
      class ChatGateway extends BaseWebSocketGateway {
        @OnMessage('chat:message')
        handleMessage(@MessageData() data: unknown) {
          return { event: 'chat:echo', data };
        }
      }

      @WebSocketGateway()
      class DefaultPathGateway extends BaseWebSocketGateway {}

      const metadata = getGatewayMetadata(ChatGateway);

      expect(metadata?.path).toBe('/ws');
      expect(metadata?.namespace).toBe('chat');
      // The handler declared in the class body is registered against the gateway, not lost.
      expect(metadata?.handlers.map((handler) => handler.pattern)).toEqual(['chat:message']);

      // Documented defaults from the options table: path '/', no namespace.
      expect(getGatewayMetadata(DefaultPathGateway)?.path).toBe('/');
      expect(getGatewayMetadata(DefaultPathGateway)?.namespace).toBeUndefined();

      // And the decorated class really is a gateway the framework can drive: a message on the
      // declared pattern reaches the handler and its answer reaches the client.
      const harness = await createWsGatewayHarness(ChatGateway, new ChatGateway());
      await harness.send('chat:message', { text: 'hi' }, 1);

      expect(harness.frames()).toEqual([{ event: 'chat:echo', data: { text: 'hi' }, ack: 1 }]);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#authentication
     */
    it('should carry the authenticate hook and its three outcomes', async () => {
      // From docs: the authenticate hook decides who the client is, during the upgrade.
      @WebSocketGateway({
        path: '/ws',
        authenticate({ token }) {
          if (!token) {
            return null;
          }
          if (token !== 'valid') {
            return false;
          }

          return { userId: 'u-1', permissions: ['admin'] };
        },
      })
      class ChatGateway extends BaseWebSocketGateway {}

      const metadata = getGatewayMetadata(ChatGateway);

      expect(typeof metadata?.authenticate).toBe('function');

      // The three documented outcomes: anonymous, refused, authenticated with an identity.
      const request = new Request('http://localhost/ws');
      expect(await metadata?.authenticate?.({ request })).toBeNull();
      expect(await metadata?.authenticate?.({ token: 'nope', request })).toBe(false);
      expect(await metadata?.authenticate?.({ token: 'valid', request }))
        .toEqual({ userId: 'u-1', permissions: ['admin'] });
    });
  });

  describe('Event Decorators', () => {
    /**
     * @source docs:api/websocket.md#onconnect
     */
    it('should handle @OnConnect decorator', async () => {
      const connected: string[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnConnect()
        handleConnect(@Client() client: WsClientData) {
          this.logger.info(`Client ${client.id} connected`);
          connected.push(client.id);

          return { event: 'welcome', data: { message: 'Welcome!' } };
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());

      // Nothing fires before a client is there.
      expect(connected).toEqual([]);

      await harness.connect();

      // The handler ran for the connecting client, and what it returned was delivered to it.
      expect(connected).toEqual([harness.client.id]);
      expect(harness.frames()).toEqual([{ event: 'welcome', data: { message: 'Welcome!' } }]);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#ondisconnect
     */
    it('should handle @OnDisconnect decorator', async () => {
      const disconnected: string[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnDisconnect()
        handleDisconnect(@Client() client: WsClientData) {
          this.logger.info(`Client ${client.id} disconnected`);
          disconnected.push(client.id);
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();

      // Connecting is not disconnecting — the handler must not have run yet.
      expect(disconnected).toEqual([]);
      // Asserted BEFORE the close, otherwise the null check below is satisfied just as well by a
      // storage that never stored the client at all.
      expect(await harness.storage.getClient(harness.client.id)).not.toBeNull();

      await harness.disconnect();

      expect(disconnected).toEqual([harness.client.id]);
      // The client is gone from storage once the close has been handled.
      expect(await harness.storage.getClient(harness.client.id)).toBeNull();
    });

    /**
     * @source docs:api/websocket.md#onjoinroom
     */
    it('should handle @OnJoinRoom decorator with pattern', async () => {
      const joins: { room: string; roomId: string; clientId: string }[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnJoinRoom('room:{roomId}')
        handleJoinRoom(
          @Client() client: WsClientData,
          @RoomName() room: string,
          @PatternParams() params: { roomId: string },
        ) {
          joins.push({ room, roomId: params.roomId, clientId: client.id });
          this.emitToRoom(room, 'user:joined', { userId: client.id });

          return { event: 'joined', data: { roomId: params.roomId } };
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      const watcher = await harness.addPeer('room:42');

      await harness.send('join', 'room:42', 5);
      await harness.flush();

      // The handler ran with the room it was given and the parameter the pattern extracted.
      expect(joins).toEqual([{ room: 'room:42', roomId: '42', clientId: harness.client.id }]);
      // The framework joined the client for real: Bun pub/sub subscription plus storage.
      expect(harness.subscribed).toContain('room:42');
      expect(await harness.storage.getClientsInRoom('room:42')).toContain(harness.client.id);
      // What the handler returned came back to the joiner, and its emitToRoom reached the room.
      expect(harness.frames()).toContainEqual({ event: 'joined', data: { roomId: '42' }, ack: 5 });
      expect(watcher.frames()).toEqual([{ event: 'user:joined', data: { userId: harness.client.id } }]);

      // The pattern is a filter, not decoration: a room it does not match leaves it alone.
      await harness.send('join', 'lobby');
      await harness.flush();

      expect(joins).toHaveLength(1);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#onleaveroom
     */
    it('should handle @OnLeaveRoom decorator with wildcard', async () => {
      const leaves: string[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnLeaveRoom('room:*')
        handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
          leaves.push(room);
          this.emitToRoom(room, 'user:left', { userId: client.id });
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      const staying = await harness.addPeer('room:7');

      await harness.send('join', 'room:7');
      await harness.send('leave', 'room:7');
      await harness.flush();

      // The wildcard matched, so the handler ran with the room that was left.
      expect(leaves).toEqual(['room:7']);
      // The framework really removed the leaver: unsubscribed, and out of the room in storage.
      expect(harness.unsubscribed).toContain('room:7');
      expect(await harness.storage.getClientsInRoom('room:7')).not.toContain(harness.client.id);
      // The members still in the room hear about it; the leaver is already out, so it does not.
      expect(staying.frames()).toContainEqual({ event: 'user:left', data: { userId: harness.client.id } });
      expect(harness.frames()).not.toContainEqual({ event: 'user:left', data: { userId: harness.client.id } });

      // `room:*` is one segment under `room:` — a room outside it must not reach the handler.
      await harness.send('leave', 'lobby');
      await harness.flush();

      expect(leaves).toEqual(['room:7']);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#onmessage
     */
    it('should handle @OnMessage decorator', async () => {
      const handled: { clientId: string; text: string }[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('chat:message')
        handleMessage(@Client() client: WsClientData, @MessageData() data: { text: string }) {
          handled.push({ clientId: client.id, text: data.text });
          this.broadcast('chat:message', { userId: client.id, text: data.text });
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      const other = await harness.addPeer();

      await harness.send('chat:message', { text: 'Hello' });
      await harness.flush();

      // The declared event reached the handler, with the sender and the payload injected.
      expect(handled).toEqual([{ clientId: harness.client.id, text: 'Hello' }]);
      // `broadcast` from the doc example reaches every connected client, sender included.
      const broadcast = { event: 'chat:message', data: { userId: harness.client.id, text: 'Hello' } };
      expect(harness.frames()).toContainEqual(broadcast);
      expect(other.frames()).toEqual([broadcast]);

      // An event the pattern does not name is not this handler's business.
      await harness.send('chat:typing', { text: 'Hello' });

      expect(handled).toHaveLength(1);

      await harness.disconnect();
    });
  });

  describe('Pattern Syntax', () => {
    /**
     * @source docs:api/websocket.md#pattern-syntax
     */
    it('should match exact patterns', () => {
      const match = matchPattern('chat:message', 'chat:message');
      expect(match.matched).toBe(true);
    });

    it('should match wildcard patterns', () => {
      const match = matchPattern('chat:*', 'chat:general');
      expect(match.matched).toBe(true);
    });

    it('should match named parameter patterns', () => {
      const match = matchPattern('chat:{roomId}', 'chat:general');
      expect(match.matched).toBe(true);
      expect(match.params?.roomId).toBe('general');
    });

    it('should match combined patterns', () => {
      const match = matchPattern('user:{id}:*', 'user:123:action');
      expect(match.matched).toBe(true);
      expect(match.params?.id).toBe('123');
    });
  });

  describe('Parameter Decorators', () => {
    /**
     * @source docs:api/websocket.md#client
     */
    it('should use @Client() decorator', async () => {
      const injected: WsClientData[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('ping')
        handlePing(@Client() client: WsClientData) {
          injected.push(client);

          return { event: 'pong', data: { id: client.id, protocol: client.protocol } };
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      harness.client.metadata.tier = 'vip';
      await harness.connect();
      await harness.send('ping', {});

      // Not a copy and not a stand-in: the connection's own client data object.
      expect(injected[0]).toBe(harness.client);
      // The documented WsClientData shape, carrying what the connection knows.
      expect(injected[0]?.metadata.tier).toBe('vip');
      expect(injected[0]?.rooms).toEqual([]);
      expect(harness.frames()).toEqual([
        { event: 'pong', data: { id: harness.client.id, protocol: 'native' } },
      ]);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#socket
     */
    it('should use @Socket() decorator', async () => {
      const injected: ServerWebSocket<WsClientData>[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('raw')
        handleRaw(@Socket() socket: ServerWebSocket<WsClientData>) {
          injected.push(socket);
          socket.send('raw message');
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      await harness.send('raw', {});

      // The raw socket itself, so writing to it bypasses the framing the gateway would add.
      expect(injected[0]).toBe(harness.socket);
      expect(injected[0]?.data.id).toBe(harness.client.id);
      expect(harness.sent).toEqual(['raw message']);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#messagedataproperty-string
     */
    it('should use @MessageData() decorator with property', async () => {
      const seen: Record<string, unknown> = {};

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        // Full data
        @OnMessage('chat:full')
        handleFull(@MessageData() data: { text: string }) {
          seen.full = data;

          return { event: 'chat:full:ok', data };
        }

        // Specific property
        @OnMessage('chat:text')
        handleText(@MessageData('text') text: string) {
          seen.text = text;

          return { event: 'chat:text:ok', data: { text } };
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      await harness.send('chat:full', { text: 'Hello', roomId: 'general' });
      await harness.send('chat:text', { text: 'Hello', roomId: 'general' });

      // No argument: the whole message payload. With one: only that property, unwrapped.
      expect(seen.full).toEqual({ text: 'Hello', roomId: 'general' });
      expect(seen.text).toBe('Hello');
      expect(harness.frames()).toEqual([
        { event: 'chat:full:ok', data: { text: 'Hello', roomId: 'general' } },
        { event: 'chat:text:ok', data: { text: 'Hello' } },
      ]);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#roomname
     */
    it('should use @RoomName() decorator', async () => {
      const rooms: string[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnJoinRoom()
        handleJoin(@RoomName() room: string) {
          rooms.push(room);

          return { event: 'joined', data: { room } };
        }

        @OnLeaveRoom()
        handleLeave(@RoomName() room: string) {
          rooms.push(`left:${room}`);
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      await harness.send('join', 'lobby', 3);
      await harness.send('leave', 'lobby');

      // The room being joined or left, injected into both kinds of handler.
      expect(rooms).toEqual(['lobby', 'left:lobby']);
      expect(harness.frames()).toEqual([{ event: 'joined', data: { room: 'lobby' }, ack: 3 }]);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#patternparams
     */
    it('should use @PatternParams() decorator', async () => {
      const captured: Record<string, string>[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('chat:{roomId}:message')
        handleMessage(@PatternParams() params: { roomId: string }) {
          captured.push(params);

          return { event: 'chat:routed', data: { roomId: params.roomId } };
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      await harness.send('chat:general:message', { text: 'hi' });
      await harness.send('chat:vip:message', { text: 'hi' });

      // The named segment of the event that reached the handler, per message.
      expect(captured).toEqual([{ roomId: 'general' }, { roomId: 'vip' }]);
      expect(harness.frames()).toEqual([
        { event: 'chat:routed', data: { roomId: 'general' } },
        { event: 'chat:routed', data: { roomId: 'vip' } },
      ]);

      await harness.disconnect();
    });

    /**
     * @source docs:api/websocket.md#wsserver
     */
    it('should use @WsServer() decorator', async () => {
      const injected: WsServerType[] = [];

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('broadcast')
        handleBroadcast(@WsServer() server: WsServerType) {
          injected.push(server);
          server.publish('all', 'Hello everyone!');
        }
      }

      const harness = await createWsGatewayHarness(TestGateway, new TestGateway());
      await harness.connect();
      await harness.send('broadcast', {});

      // A real server reference, not a placeholder: it wraps the running server and
      // publishing through it reaches Bun's pub/sub.
      expect(injected).toHaveLength(1);
      expect(injected[0]?.server).toBe(harness.server);
      expect(harness.published).toEqual([{ topic: 'all', message: 'Hello everyone!' }]);

      await harness.disconnect();
    });
  });

  describe('Guards', () => {
    /**
     * @source docs:api/websocket.md#guards
     */
    it('should use WsAuthGuard', async () => {
      const reached: (string | undefined)[] = [];

      @WebSocketGateway({
        path: '/ws',
        // From docs: the guard checks an identity, it does not establish one — this hook does.
        authenticate: ({ token }) => (token === 'good' ? { userId: 'u-1' } : null),
      })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(WsAuthGuard)
        @OnMessage('protected:*')
        handleProtected(@Client() client: WsClientData) {
          reached.push(client.auth?.userId);

          return { event: 'protected:ok', data: { userId: client.auth?.userId } };
        }
      }

      // Anonymous client: `authenticate` returned null, so the guard denies it.
      const anonymous = await createWsGatewayHarness(TestGateway, new TestGateway());
      await anonymous.authenticateAs();
      await anonymous.connect();
      await anonymous.send('protected:read', {}, 9);

      expect(reached).toEqual([]);
      expect(anonymous.frames()).toEqual([{
        event: 'error',
        data: { code: 'FORBIDDEN', event: 'protected:read', message: 'Guard denied this message' },
        ack: 9,
      }]);

      // A client the hook authenticated reaches the same handler.
      const member = await createWsGatewayHarness(TestGateway, new TestGateway());
      await member.authenticateAs('good');
      await member.connect();
      await member.send('protected:read', {});

      expect(member.client.auth?.authenticated).toBe(true);
      expect(reached).toEqual(['u-1']);
      expect(member.frames()).toEqual([{ event: 'protected:ok', data: { userId: 'u-1' } }]);

      await anonymous.disconnect();
      await member.disconnect();
    });

    /**
     * @source docs:api/websocket.md#guards
     */
    it('should use WsPermissionGuard', async () => {
      const reached: string[] = [];

      @WebSocketGateway({
        path: '/ws',
        // The permission list the guard reads comes from the authenticate hook.
        authenticate: ({ token }) => ({ userId: 'u-1', permissions: token ? token.split(',') : [] }),
      })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(new WsPermissionGuard('admin'))
        @OnMessage('admin:*')
        handleAdmin(@Client() client: WsClientData) {
          reached.push(`admin:${client.auth?.userId}`);

          return { event: 'admin:ok', data: { admin: true } };
        }

        // A list means ALL of them, not any.
        @UseWsGuards(new WsPermissionGuard(['admin', 'ops']))
        @OnMessage('super:*')
        handleSuper() {
          reached.push('super');

          return { event: 'super:ok', data: {} };
        }
      }

      // Authenticated, but without the permission: still denied.
      const plain = await createWsGatewayHarness(TestGateway, new TestGateway());
      await plain.authenticateAs('user');
      await plain.connect();
      await plain.send('admin:purge', {});

      expect(plain.client.auth?.permissions).toEqual(['user']);
      expect(reached).toEqual([]);
      expect(plain.frames()[0]?.event).toBe('error');

      // Holds `admin`: through the single-permission guard, blocked by the one that also
      // requires `ops`.
      const admin = await createWsGatewayHarness(TestGateway, new TestGateway());
      await admin.authenticateAs('admin');
      await admin.connect();
      await admin.send('admin:purge', {});
      await admin.send('super:purge', {});

      expect(reached).toEqual(['admin:u-1']);
      expect(admin.frames()).toEqual([
        { event: 'admin:ok', data: { admin: true } },
        {
          event: 'error',
          data: { code: 'FORBIDDEN', event: 'super:purge', message: 'Guard denied this message' },
        },
      ]);

      // Holds both: the composite guard passes too.
      const owner = await createWsGatewayHarness(TestGateway, new TestGateway());
      await owner.authenticateAs('admin,ops');
      await owner.connect();
      await owner.send('super:purge', {});

      expect(reached).toEqual(['admin:u-1', 'super']);
      expect(owner.frames()).toEqual([{ event: 'super:ok', data: {} }]);

      await plain.disconnect();
      await admin.disconnect();
      await owner.disconnect();
    });

    /**
     * @source docs:api/websocket.md#guards
     */
    it('should use WsAnyPermissionGuard', async () => {
      const reached: string[] = [];

      @WebSocketGateway({
        path: '/ws',
        authenticate: ({ token }) => ({ userId: 'u-1', permissions: token ? token.split(',') : [] }),
      })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(new WsAnyPermissionGuard(['admin', 'moderator']))
        @OnMessage('manage:*')
        handleManage(@Client() client: WsClientData) {
          reached.push(client.auth?.permissions?.join(',') ?? '');

          return { event: 'manage:ok', data: {} };
        }
      }

      // Any ONE of the listed permissions is enough — this client has neither.
      const guest = await createWsGatewayHarness(TestGateway, new TestGateway());
      await guest.authenticateAs('guest');
      await guest.connect();
      await guest.send('manage:users', {});

      expect(reached).toEqual([]);
      expect(guest.frames()[0]?.event).toBe('error');

      // Holds only the second one of the pair, and that is enough.
      const moderator = await createWsGatewayHarness(TestGateway, new TestGateway());
      await moderator.authenticateAs('guest,moderator');
      await moderator.connect();
      await moderator.send('manage:users', {});

      expect(reached).toEqual(['guest,moderator']);
      expect(moderator.frames()).toEqual([{ event: 'manage:ok', data: {} }]);

      await guest.disconnect();
      await moderator.disconnect();
    });

    /**
     * @source docs:api/websocket.md#guards
     */
    it('should create custom guard', async () => {
      const reached: string[] = [];
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const CustomGuard = createGuard((ctx: WsExecutionContext) => {
        return ctx.getClient().metadata.customCheck === true;
      });

      @WebSocketGateway({
        path: '/ws',
        // `metadata` from the authenticate hook is what the custom check reads.
        authenticate: ({ token }) => ({ metadata: { customCheck: token === 'yes' } }),
      })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(CustomGuard)
        @OnMessage('custom:*')
        handleCustom(@Client() client: WsClientData) {
          reached.push(client.id);

          return { event: 'custom:ok', data: {} };
        }
      }

      // The function decides, and its `false` stops the handler from running at all.
      const blocked = await createWsGatewayHarness(TestGateway, new TestGateway());
      await blocked.authenticateAs('no');
      await blocked.connect();
      await blocked.send('custom:thing', {}, 4);

      expect(blocked.client.metadata.customCheck).toBe(false);
      expect(reached).toEqual([]);
      expect(blocked.frames()).toEqual([{
        event: 'error',
        data: { code: 'FORBIDDEN', event: 'custom:thing', message: 'Guard denied this message' },
        ack: 4,
      }]);

      const allowed = await createWsGatewayHarness(TestGateway, new TestGateway());
      await allowed.authenticateAs('yes');
      await allowed.connect();
      await allowed.send('custom:thing', {});

      expect(reached).toEqual([allowed.client.id]);
      expect(allowed.frames()).toEqual([{ event: 'custom:ok', data: {} }]);

      await blocked.disconnect();
      await allowed.disconnect();
    });
  });

  describe('Storage Adapters', () => {
    /**
     * @source docs:api/websocket.md#storage-adapters
     */
    it('should track clients and room membership in the in-memory storage', async () => {
      // From docs: "Default is in-memory."
      const storage = createInMemoryWsStorage();
      const makeClient = (id: string): WsClientData => ({
        id,
        rooms: [],
        connectedAt: Date.now(),
        auth: null,
        metadata: {},
        protocol: 'native',
      });

      await storage.addClient(makeClient('c-1'));
      await storage.addClient(makeClient('c-2'));

      // What went in comes back out, keyed by client id, and an unknown id is null rather than
      // an invented record
      expect((await storage.getClient('c-1'))?.id).toBe('c-1');
      expect(await storage.getClient('c-404')).toBeNull();
      expect(await storage.getClientCount()).toBe(2);

      // Room membership is queryable from both ends
      await storage.addClientToRoom('c-1', 'room:lobby');
      await storage.addClientToRoom('c-2', 'room:lobby');
      await storage.addClientToRoom('c-1', 'room:vip');

      expect((await storage.getClientsInRoom('room:lobby')).sort()).toEqual(['c-1', 'c-2']);
      expect((await storage.getRoomsForClient('c-1')).sort()).toEqual(['room:lobby', 'room:vip']);

      // Leaving one room keeps the other
      await storage.removeClientFromRoom('c-1', 'room:vip');
      expect(await storage.getRoomsForClient('c-1')).toEqual(['room:lobby']);

      // Removing the client takes it out of storage and out of its rooms
      await storage.removeClient('c-1');
      expect(await storage.getClient('c-1')).toBeNull();
      expect(await storage.getClientCount()).toBe(1);
      expect(await storage.getClientsInRoom('room:lobby')).toEqual(['c-2']);

      // ...and this is the storage the WebSocket pipeline itself writes through: a connection
      // driven through the handler lands in the adapter it was given.
      @WebSocketGateway({ path: '/storage' })
      class StorageGateway extends BaseWebSocketGateway {
        @OnJoinRoom()
        async join(@Client() client: WsClientData, @RoomName() room: string) {
          await this.joinRoom(client.id, room);

          return { event: 'room:joined', data: { room } };
        }
      }

      const harness = await createWsGatewayHarness(StorageGateway, new StorageGateway());
      await harness.connect();
      expect((await harness.storage.getClient(harness.client.id))?.id).toBe(harness.client.id);

      await harness.send('join', 'room:from-handler');
      expect(await harness.storage.getClientsInRoom('room:from-handler')).toEqual([harness.client.id]);

      await harness.disconnect();
      expect(await harness.storage.getClient(harness.client.id)).toBeNull();
    });

    /**
     * @source docs:api/websocket.md#storage-adapters
     */
    it('should point the shared Redis connection at the configured url, lazily', () => {
      // The provider is process-global, so put back whatever this process already had.
      const saved = SharedRedisProvider.getOptions();

      try {
        // From docs: the Redis adapter is configured with `{ url, prefix }`
        const options = { url: 'redis://ws-docs-host:6379', keyPrefix: 'ws:' };
        SharedRedisProvider.configure(options);

        // configure() records the target...
        expect(SharedRedisProvider.isConfigured()).toBe(true);
        expect(SharedRedisProvider.getOptions()).toEqual(options);

        // ...and every client built from it inherits that target, while a caller that names its
        // own url overrides it. The url is only observable on the built client (a live
        // connection needs a Redis server, which the integration suites provide and this one
        // cannot), so it is read off the instance.
        const optionsOf = (client: unknown): { url: string; keyPrefix?: string } =>
          (client as { options: { url: string; keyPrefix?: string } }).options;

        const shared = SharedRedisProvider.createClient();
        expect(optionsOf(shared).url).toBe('redis://ws-docs-host:6379');
        expect(optionsOf(shared).keyPrefix).toBe('ws:');
        expect(optionsOf(SharedRedisProvider.createClient({ url: 'redis://other:6379' })).url)
          .toBe('redis://other:6379');

        // Configuring opens nothing: the connection is lazy, so a freshly built client is not
        // connected until something asks it to be. (A real connection needs a Redis server and
        // is covered by the integration suites, not here.)
        expect(shared.isConnected()).toBe(false);
      } finally {
        if (saved) {
          SharedRedisProvider.configure(saved);
        }
      }
    });
  });

  describe('WebSocket Client', () => {
    /**
     * @source docs:api/websocket.md#typed-client-native
     */
    it('should exchange messages with the gateway through the typed client', async () => {
      @WebSocketGateway({ path: '/chat' })
      class ChatGateway extends BaseWebSocketGateway {
        @OnConnect()
        greet(@Client() client: WsClientData) {
          return { event: 'welcome', data: { clientId: client.id } };
        }

        @OnMessage('chat:message')
        handleMessage(@Client() _client: WsClientData, @MessageData() data: { text: string }) {
          return { event: 'received', data };
        }
      }

      @Module({ controllers: [ChatGateway] })
      class ChatModule {}

      const definition = createWsServiceDefinition(ChatModule);

      // The definition is what makes the client typed: one entry per gateway, carrying the path
      // clients connect to and the events the gateway handles
      expect([...definition._gateways.keys()]).toEqual(['ChatGateway']);
      expect(definition._gateways.get('ChatGateway')?.path).toBe('/chat');
      expect([...(definition._gateways.get('ChatGateway')?.events.keys() ?? [])]).toContain('chat:message');

      const app = new OneBunApplication(ChatModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();

        // From docs: Typed client (native) — connect to the gateway path
        const client = createWsClient(definition, {
          url: `ws://127.0.0.1:${app.getPort()}/chat`,
          protocol: 'native',
          auth: { token: 'xxx' },
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectAttempts: 10,
          timeout: 2000,
        });

        interface GatewayProxy {
          emit<T = unknown>(event: string, data?: unknown): Promise<T>;
          on(event: string, listener: (data: unknown) => void): void;
        }

        const welcomes: unknown[] = [];
        const chat = (client as unknown as Record<string, GatewayProxy>).ChatGateway;
        chat.on('welcome', (data) => welcomes.push(data));

        await client.connect();
        expect(client.isConnected()).toBe(true);

        // `client.ChatGateway.emit(...)` is request/response: the payload the handler returned
        // comes back to this caller
        expect(await chat.emit<{ text: string }>('chat:message', { text: 'Hello' })).toEqual({ text: 'Hello' });

        // ...and `client.ChatGateway.on(...)` receives what the gateway pushed on connect
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(welcomes).toHaveLength(1);
        expect(welcomes[0]).toHaveProperty('clientId');

        client.disconnect();
        expect(client.isConnected()).toBe(false);
      } finally {
        await app.stop();
      }
    });

    it('should create client with protocol native (default)', () => {
      @WebSocketGateway({ path: '/ws' })
      class WsGateway extends BaseWebSocketGateway {}

      @Module({ controllers: [WsGateway] })
      class AppModule {}

      const definition = createWsServiceDefinition(AppModule);
      const client = createWsClient(definition, {
        url: 'ws://localhost:3000/ws',
        protocol: 'native',
      });
      expect(client).toBeDefined();
    });

    it('should create client with protocol socketio', () => {
      @WebSocketGateway({ path: '/ws' })
      class WsGateway extends BaseWebSocketGateway {}

      @Module({ controllers: [WsGateway] })
      class AppModule {}

      const definition = createWsServiceDefinition(AppModule);
      const client = createWsClient(definition, {
        url: 'ws://localhost:3000/socket.io',
        protocol: 'socketio',
      });
      expect(client).toBeDefined();
    });

    /**
     * @source docs:api/websocket.md#standalone-client-no-definition
     */
    it('should talk to the same gateway from a standalone client with no definition', async () => {
      @WebSocketGateway({ path: '/chat' })
      class StandaloneChatGateway extends BaseWebSocketGateway {
        private typing: string[] = [];

        @OnConnect()
        greet() {
          return { event: 'welcome', data: { message: 'Welcome!' } };
        }

        @OnMessage('chat:message')
        handleMessage(@MessageData() data: { text: string }) {
          return { event: 'received', data };
        }

        @OnMessage('typing')
        handleTyping(@Client() client: WsClientData) {
          this.typing.push(client.id);
        }

        @OnMessage('typing:seen')
        reportTyping() {
          return { event: 'typing:seen', data: { count: this.typing.length } };
        }
      }

      @Module({ controllers: [StandaloneChatGateway] })
      class ChatModule {}

      const app = new OneBunApplication(ChatModule, {
        port: 0,
        host: '127.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        tracing: { enabled: false },
        gracefulShutdown: false,
      });

      try {
        await app.start();

        // From docs: no createWsServiceDefinition, no dependency on the backend module
        const client = createNativeWsClient({
          url: `ws://127.0.0.1:${app.getPort()}/chat`,
          protocol: 'native',
          auth: { token: 'xxx' },
          timeout: 2000,
        });

        const lifecycle: string[] = [];
        const welcomes: unknown[] = [];
        client.on('connect', () => lifecycle.push('connect'));
        client.on('disconnect', () => lifecycle.push('disconnect'));
        client.on('welcome', (data) => welcomes.push(data));

        await client.connect();
        await new Promise((resolve) => setTimeout(resolve, 20));

        // Lifecycle events and server events arrive through the same `on`
        expect(lifecycle).toEqual(['connect']);
        expect(welcomes).toEqual([{ message: 'Welcome!' }]);

        // "Same message format and API (emit, send, on, off)": emit awaits the reply...
        expect(await client.emit<{ text: string }>('chat:message', { text: 'Hello' })).toEqual({ text: 'Hello' });

        // ...and send is fire-and-forget, but still reaches the gateway
        client.send('typing', {});
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(await client.emit<{ count: number }>('typing:seen', {})).toEqual({ count: 1 });

        // "but no gateway proxies": the standalone client exposes the flat API only
        expect('StandaloneChatGateway' in (client as unknown as Record<string, unknown>)).toBe(false);

        client.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(client.isConnected()).toBe(false);
        expect(lifecycle).toEqual(['connect', 'disconnect']);
      } finally {
        await app.stop();
      }
    });
  });

  describe('Application Configuration', () => {
    /**
     * @source docs:api/websocket.md#application-options
     */
    it('should accept WebSocket configuration', async () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {}

      @Module({ controllers: [TestGateway] })
      class AppModule {}

      // From docs: Application Options example (native + optional Socket.IO)
      const websocket = {
        enabled: true,
        storage: {
          type: 'memory' as const,
        },
        socketio: {
          enabled: true,
          path: '/socket.io',
          pingInterval: 25000,
          pingTimeout: 20000,
        },
        maxPayload: 1048576,
      };
      const app = new OneBunApplication(AppModule, {
        port: 3000,
        websocket,
        loggerLayer: makeMockLoggerLayer(),
      });

      // The block survives onto the application; on start() it is what the WebSocket handler
      // is built from (application.ts: `new WsHandler(this.logger, this.options.websocket)`).
      expect((app as unknown as { options: { websocket?: typeof websocket } }).options.websocket)
        .toEqual(websocket);

      // What those options actually do, driven through the same handler the application builds
      // — no port is bound here, so the effects are asserted rather than assumed.
      const { WsHandler: wsHandlerClass } = await import('./websocket/ws-handler');
      const { createMockSyncLogger } = await import('./testing/test-utils');
      const upgraded: WsClientData[] = [];
      const server = {
        upgrade(_request: Request, options: { data: WsClientData }) {
          upgraded.push(options.data);

          return true;
        },
      } as unknown as import('bun').Server<WsClientData>;

      const handler = new wsHandlerClass(createMockSyncLogger(), websocket);
      handler.registerGateway(TestGateway, new TestGateway());

      expect(handler.hasGateways()).toBe(true);

      // socketio.enabled + socketio.path: that path is a WebSocket endpoint of its own, and the
      // client it produces speaks Socket.IO. The gateway's own path stays native.
      expect(await handler.handleUpgrade(new Request('http://localhost:3000/socket.io/?EIO=4'), server))
        .toBeUndefined();
      expect(upgraded.at(-1)?.protocol).toBe('socketio');
      expect(await handler.handleUpgrade(new Request('http://localhost:3000/ws'), server)).toBeUndefined();
      expect(upgraded.at(-1)?.protocol).toBe('native');

      // maxPayload and the heartbeat settings are what the Socket.IO handshake announces.
      const sent: string[] = [];
      const socketioClient = upgraded[0];
      const socket = {
        data: socketioClient,
        send(message: string) {
          sent.push(message);

          return message.length;
        },
        close: () => undefined,
        subscribe: () => undefined,
        unsubscribe: () => undefined,
      } as unknown as ServerWebSocket<WsClientData>;
      const bunHandlers = handler.createWebSocketHandlers() as unknown as {
        open: (ws: ServerWebSocket<WsClientData>) => Promise<void>;
        close: (ws: ServerWebSocket<WsClientData>, code: number, reason: string) => Promise<void>;
      };
      await bunHandlers.open(socket);

      expect(sent[0]?.startsWith('0')).toBe(true);
      expect(JSON.parse(sent[0]?.slice(1) ?? '{}')).toMatchObject({
        pingInterval: 25000,
        pingTimeout: 20000,
        maxPayload: 1048576,
      });

      // Closing unregisters the fake socket from the process-wide registry, and cleanup stops
      // the Socket.IO heartbeat interval this connection started.
      await bunHandlers.close(socket, 1000, 'test over');
      await handler.cleanup();

      // With Socket.IO left off — the default — that path is not an endpoint at all.
      const nativeOnly = new wsHandlerClass(createMockSyncLogger(), { socketio: { enabled: false } });
      nativeOnly.registerGateway(TestGateway, new TestGateway());
      const refused = await nativeOnly.handleUpgrade(
        new Request('http://localhost:3000/socket.io/?EIO=4'),
        server,
      );

      expect(refused?.status).toBe(404);
    });
  });
});

describe('WebSocket Gateway DI (docs/api/websocket.md#basewebsocketgateway)', () => {
  /**
   * @source docs:api/websocket.md#basewebsocketgateway
   * Gateways receive this.logger and this.config just like controllers.
   */
  it('should inject logger and config into WebSocket gateway via module DI', async () => {
    const effectLib = await import('effect');
    const moduleMod = await import('./module/module');
    const testUtils = await import('./testing/test-utils');

    @WebSocketGateway({ path: '/ws' })
    class TestGateway extends BaseWebSocketGateway {
      @OnConnect()
      handleConnect(@Client() client: WsClientData) {
        this.logger.info(`Client ${client.id} connected`);

        return { event: 'welcome', data: { id: client.id } };
      }

      getLoggerForTest() {
        return this.logger;
      }

      getConfigForTest() {
        return this.config;
      }
    }

    @Module({ controllers: [TestGateway] })
    class TestModule {}

    const mod = new moduleMod.OneBunModule(TestModule, testUtils.makeMockLoggerLayer());
    mod.getLayer();
    await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);

    const gateway = mod.getControllerInstance(TestGateway) as unknown as TestGateway;
    expect(gateway).toBeDefined();
    expect(gateway.getLoggerForTest()).toBeDefined();
    expect(typeof gateway.getLoggerForTest().info).toBe('function');
    expect(typeof gateway.getLoggerForTest().warn).toBe('function');
    expect(typeof gateway.getLoggerForTest().error).toBe('function');
    expect(gateway.getConfigForTest()).toBeDefined();
    expect(typeof gateway.getConfigForTest().get).toBe('function');
  });

  /**
   * @source docs:api/websocket.md#basewebsocketgateway
   * Gateways have this.config and this.logger available immediately after super()
   */
  it('should have config and logger available in WS gateway constructor after super()', async () => {
    const effectLib = await import('effect');
    const moduleMod = await import('./module/module');
    const testUtils = await import('./testing/test-utils');

    // From docs: Gateway with constructor access to config and logger
    @WebSocketGateway({ path: '/ws' })
    class ChatGateway extends BaseWebSocketGateway {
      readonly configInConstructor: unknown;
      readonly loggerInConstructor: unknown;

      constructor() {
        super();
        // config and logger are available immediately after super()
        this.configInConstructor = this.config;
        this.loggerInConstructor = this.logger;
      }

      @OnMessage('chat:message')
      handleMessage(@Client() client: WsClientData, @MessageData() data: unknown) {
        this.broadcast('chat:message', { userId: client.id, data });
      }
    }

    @Module({ controllers: [ChatGateway] })
    class ChatModule {}

    const mod = new moduleMod.OneBunModule(ChatModule, testUtils.makeMockLoggerLayer());
    mod.getLayer();
    await effectLib.Effect.runPromise(mod.setup() as import('effect').Effect.Effect<unknown, never, never>);

    const gateway = mod.getControllerInstance(ChatGateway) as unknown as ChatGateway;

    // Both were read INSIDE the constructor, right after super() — the framework sets the
    // ambient init context before construction, so a gateway that only got them afterwards
    // would leave these undefined.
    expect(typeof (gateway.configInConstructor as { get?: unknown } | undefined)?.get).toBe('function');
    expect(typeof (gateway.loggerInConstructor as { info?: unknown } | undefined)?.info).toBe('function');
    expect(typeof (gateway.loggerInConstructor as { child?: unknown } | undefined)?.child).toBe('function');

    // And what DI produced is a working gateway: the documented handler's broadcast reaches
    // the connected clients.
    const harness = await createWsGatewayHarness(ChatGateway, gateway);
    await harness.connect();
    const other = await harness.addPeer();
    await harness.send('chat:message', { text: 'hi' });
    await harness.flush();

    expect(other.frames()).toEqual([
      { event: 'chat:message', data: { userId: harness.client.id, data: { text: 'hi' } } },
    ]);

    await harness.disconnect();
  });
});

// ============================================================================
// SSE (Server-Sent Events) Documentation Tests
// ============================================================================

describe('SSE (Server-Sent Events) API Documentation (docs/api/controllers.md)', () => {
  describe('SseEvent Type (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#sseevent-type
     */
    it('should define SseEvent interface', () => {
      // From docs: SseEvent interface
      const event: SseEvent = {
        event: 'update',
        data: { count: 1 },
        id: '123',
        retry: 5000,
      };

      expect(event.event).toBe('update');
      expect(event.data).toEqual({ count: 1 });
      expect(event.id).toBe('123');
      expect(event.retry).toBe(5000);
    });

    it('should allow minimal SseEvent with only data', () => {
      const event: SseEvent = {
        data: { message: 'Hello' },
      };

      expect(event.data).toEqual({ message: 'Hello' });
      expect(event.event).toBeUndefined();
    });
  });

  describe('@Sse() Decorator (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#sse-decorator
     */
    it('should mark method as SSE endpoint', async () => {
      // Test @Sse decorator independently (without @Controller wrapping)
      class TestClass {
        @Sse()
        async *stream(): SseGenerator {
          yield { event: 'start', data: { timestamp: 1699999999999 } };
        }

        // Same shape, no decorator — the mark must be the decorator's doing, not the shape's.
        async *unmarked(): SseGenerator {
          yield { event: 'start', data: { timestamp: 1699999999999 } };
        }
      }

      // A bare @Sse() records an empty options record: no explicit heartbeat, no explicit
      // timeout, so the framework's documented defaults (30s / 600s) apply.
      expect(getSseMetadata(TestClass.prototype, 'stream')).toEqual({});
      expect(getSseMetadata(TestClass.prototype, 'unmarked')).toBeUndefined();
      expect(DEFAULT_SSE_HEARTBEAT_MS).toBe(30_000);
      expect(DEFAULT_SSE_TIMEOUT).toBe(600);

      // And what the mark buys: the async generator's yields become SSE frames.
      const body = await new Response(createSseStream(new TestClass().stream())).text();
      expect(body).toBe('event: start\ndata: {"timestamp":1699999999999}\n\n');
    });

    /**
     * @source docs:api/controllers.md#sse-decorator
     */
    it('should support heartbeat option', () => {
      // Test @Sse decorator with options independently
      class TestClass {
        @Sse({ heartbeat: 15000 })
        async *live(): SseGenerator {
          yield { event: 'connected', data: { clientId: 'test' } };
        }
      }

      expect(TestClass).toBeDefined();

      // Verify heartbeat option is set
      const metadata = getSseMetadata(TestClass.prototype, 'live');
      expect(metadata).toBeDefined();
      expect(metadata?.heartbeat).toBe(15000);
    });

    /**
     * @source docs:api/controllers.md#sse-decorator
     */
    it('should work with @Controller decorator', async () => {
      // From docs: @Sse() decorator example with full controller
      @Controller('/events')
      class EventsController extends BaseController {
        @Get('/stream')
        @Sse()
        async *stream(): SseGenerator {
          yield { event: 'start', data: { timestamp: 1699999999999 } };
        }

        @Get('/live')
        @Sse({ heartbeat: 15000 })
        async *live(): SseGenerator {
          yield { event: 'connected', data: { clientId: 'client-1' } };
        }
      }

      // The mark survives the class wrapping @Controller() performs.
      expect(getSseMetadata(EventsController.prototype, 'stream')).toEqual({});
      expect(getSseMetadata(EventsController.prototype, 'live')).toEqual({ heartbeat: 15000 });

      @Module({ controllers: [EventsController] })
      class EventsModule {}

      const app = new OneBunApplication(EventsModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();

      try {
        // An @Sse() route answers as an event stream, not as the JSON envelope: the
        // generator's yields arrive already formatted on the wire.
        const stream = await fetch(`${app.getHttpUrl()}/events/stream`);
        expect(stream.status).toBe(HttpStatusCode.OK);
        expect(stream.headers.get('content-type')).toBe('text/event-stream');
        expect(stream.headers.get('cache-control')).toBe('no-cache');
        expect(await stream.text()).toBe('event: start\ndata: {"timestamp":1699999999999}\n\n');

        const live = await fetch(`${app.getHttpUrl()}/events/live`);
        expect(live.headers.get('content-type')).toBe('text/event-stream');
        expect(await live.text()).toBe('event: connected\ndata: {"clientId":"client-1"}\n\n');
      } finally {
        await app.stop();
      }
    });
  });

  describe('formatSseEvent Function', () => {
    /**
     * @source docs:api/controllers.md#sse-wire-format
     */
    it('should format event with all fields', () => {
      const event: SseEvent = {
        event: 'update',
        data: { count: 1 },
        id: '123',
        retry: 5000,
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toContain('event: update\n');
      expect(formatted).toContain('id: 123\n');
      expect(formatted).toContain('retry: 5000\n');
      expect(formatted).toContain('data: {"count":1}\n');
      expect(formatted).toEndWith('\n\n');
    });

    it('should format event with only data', () => {
      const event: SseEvent = {
        data: { message: 'Hello' },
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toBe('data: {"message":"Hello"}\n\n');
      expect(formatted).not.toContain('event:');
      expect(formatted).not.toContain('id:');
    });

    it('should format raw data as default event', () => {
      const rawData = { count: 42 };

      const formatted = formatSseEvent(rawData);

      expect(formatted).toBe('data: {"count":42}\n\n');
    });

    it('should handle multi-line data', () => {
      const event: SseEvent = {
        data: 'line1\nline2\nline3',
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toContain('data: line1\n');
      expect(formatted).toContain('data: line2\n');
      expect(formatted).toContain('data: line3\n');
    });

    it('should handle string data', () => {
      const event: SseEvent = {
        event: 'message',
        data: 'Simple string message',
      };

      const formatted = formatSseEvent(event);

      expect(formatted).toContain('event: message\n');
      expect(formatted).toContain('data: Simple string message\n');
    });
  });

  describe('createSseStream Function', () => {
    /**
     * @source docs:api/controllers.md#sse-method
     */
    it('should create ReadableStream from async generator', async () => {
      async function* testGenerator(): SseGenerator {
        yield { event: 'start', data: { count: 0 } };
        yield { event: 'tick', data: { count: 1 } };
        yield { event: 'end', data: { count: 2 } };
      }

      const stream = createSseStream(testGenerator());

      expect(stream).toBeInstanceOf(ReadableStream);

      // Read all chunks from stream
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(decoder.decode(value));
      }

      const output = chunks.join('');
      expect(output).toContain('event: start\n');
      expect(output).toContain('event: tick\n');
      expect(output).toContain('event: end\n');
    });

    it('should handle heartbeat option', async () => {
      // Use a very short heartbeat for testing
      const heartbeatInterval = 50;

      async function* slowGenerator(): SseGenerator {
        await Bun.sleep(150);
        yield { data: 'done' };
      }

      const stream = createSseStream(slowGenerator(), { heartbeat: heartbeatInterval });
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];

      // Read chunks with timeout
      const startTime = Date.now();
      while (Date.now() - startTime < 300) {
        const result = await Promise.race([
          reader.read(),
          Bun.sleep(50).then(() => ({ done: false, value: undefined, timeout: true })),
        ]);

        if ('timeout' in result) {
          continue;
        }
        if (result.done) {
          break;
        }
        if (result.value) {
          chunks.push(decoder.decode(result.value));
        }
      }

      const output = chunks.join('');

      // Should have heartbeat comments
      expect(output).toContain(': heartbeat\n\n');
      // Should have the actual event (string data is not wrapped in extra quotes)
      expect(output).toContain('data: done');
    });

    it('should call iterator.return() on cancel, triggering generator finally block', async () => {
      let finallyCalled = false;

      async function* testGenerator(): SseGenerator {
        try {
          yield { event: 'start', data: { count: 0 } };
          // Simulate a long-running generator
          yield { event: 'tick', data: { count: 1 } };
          yield { event: 'tick', data: { count: 2 } };
        } finally {
          finallyCalled = true;
        }
      }

      const stream = createSseStream(testGenerator());
      const reader = stream.getReader();

      // Read first chunk
      const first = await reader.read();
      expect(first.done).toBe(false);

      // Cancel the stream (simulates client disconnect)
      await reader.cancel();

      // The generator's finally block should have been triggered
      // Give a tick for the async return to settle
      await Bun.sleep(10);
      expect(finallyCalled).toBe(true);
    });

    it('should fire onAbort callback on cancel', async () => {
      let abortCalled = false;

      async function* testGenerator(): SseGenerator {
        yield { event: 'start', data: { count: 0 } };
        yield { event: 'tick', data: { count: 1 } };
      }

      const stream = createSseStream(testGenerator(), {
        onAbort() {
          abortCalled = true; 
        },
      });
      const reader = stream.getReader();

      // Read first chunk
      await reader.read();

      // Cancel the stream
      await reader.cancel();

      expect(abortCalled).toBe(true);
    });

    it('should abort upstream fetch via try/finally when client disconnects (SSE proxy pattern)', async () => {
      let upstreamAborted = false;
      const ac = new AbortController();

      async function* proxyGenerator(): SseGenerator {
        try {
          ac.signal.addEventListener('abort', () => {
            upstreamAborted = true;
          });
          yield { event: 'proxied', data: { from: 'upstream' } };
          // Simulate waiting for more upstream data
          yield { event: 'proxied', data: { from: 'upstream-2' } };
        } finally {
          // This is the idiomatic pattern: abort the upstream connection in finally
          ac.abort();
        }
      }

      const stream = createSseStream(proxyGenerator());
      const reader = stream.getReader();

      // Read first event
      await reader.read();

      // Client disconnects
      await reader.cancel();

      await Bun.sleep(10);
      expect(upstreamAborted).toBe(true);
    });
  });

  describe('Controller.sse() Method', () => {
    /**
     * @source docs:api/controllers.md#sse-method
     */
    it('should have sse() method on BaseController', () => {
      const controller = new BaseController();

      // Access protected method via type assertion
      expect(typeof (controller as unknown as { sse: Function }).sse).toBe('function');
    });

    /**
     * @source docs:api/controllers.md#sse-method
     */
    it('should define controller using sse() method', async () => {
      // From docs: Using sse() method example
      @Controller('/events')
      class EventsController extends BaseController {
        @Get('/manual')
        events(): Response {
          return this.sse(async function* () {
            yield { event: 'start', data: { timestamp: 1699999999999 } };
            yield { event: 'progress', data: { percent: 20 } };
            yield { event: 'complete', data: { success: true } };
          }());
        }
      }

      const response = new EventsController().events();

      // sse() builds the SSE Response itself — status, the three SSE headers, and a body
      // that is the generator's events already in wire format, in order.
      expect(response.status).toBe(HttpStatusCode.OK);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('connection')).toBe('keep-alive');
      expect(await response.text()).toBe(
        'event: start\ndata: {"timestamp":1699999999999}\n\n' +
        'event: progress\ndata: {"percent":20}\n\n' +
        'event: complete\ndata: {"success":true}\n\n',
      );
    });

    it('should accept factory function with AbortSignal for SSE proxy pattern', async () => {
      let signalAborted = false;

      @Controller('/events')
      class ProxyController extends BaseController {
        @Get('/proxy')
        proxy(): Response {
          return this.sse((signal) => this.proxyUpstream(signal));
        }

        private async *proxyUpstream(signal: AbortSignal): SseGenerator {
          signal.addEventListener('abort', () => {
            signalAborted = true; 
          });
          yield { event: 'proxied', data: { from: 'upstream' } };
          yield { event: 'proxied', data: { from: 'upstream-2' } };
        }
      }

      const controller = new ProxyController();
      // Access protected method via type assertion
      const sseMethod = (controller as unknown as {
        sse: (source: (signal: AbortSignal) => AsyncIterable<unknown>, options?: unknown) => Response;
      }).sse.bind(controller);

      const response = sseMethod((signal) => (async function* () {
        signal.addEventListener('abort', () => {
          signalAborted = true; 
        });
        yield { event: 'proxied', data: { from: 'upstream' } };
      })());

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      const reader = response.body!.getReader();

      // Read first event
      await reader.read();

      // Client disconnects
      await reader.cancel();

      await Bun.sleep(10);
      expect(signalAborted).toBe(true);
    });

    it('should support onAbort callback with sse() helper', async () => {
      let abortCalled = false;

      const controller = new BaseController();
      const sseMethod = (controller as unknown as {
        sse: (source: AsyncIterable<unknown>, options?: { onAbort?: () => void }) => Response;
      }).sse.bind(controller);

      const response = sseMethod(
        (async function* () {
          yield { event: 'tick', data: { count: 0 } };
        })(),
        {
          onAbort() {
            abortCalled = true; 
          }, 
        },
      );

      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();

      expect(abortCalled).toBe(true);
    });
  });

  describe('Complete SSE Controller Example (docs/api/controllers.md)', () => {
    /**
     * @source docs:api/controllers.md#server-sent-events-sse
     */
    it('should define complete SSE controller', async () => {
      // From docs: Complete SSE Controller example
      @Service()
      class DataService extends BaseService {
        async waitForUpdate(): Promise<unknown> {
          return { updated: true };
        }
      }

      @Service()
      class NotificationService extends BaseService {
        async poll(): Promise<unknown> {
          return { type: 'notification', message: 'New message' };
        }
      }

      @Controller('/events')
      class EventsController extends BaseController {
        constructor(
          private dataService: DataService,
          private notificationService: NotificationService,
        ) {
          super();
        }

        // Simple SSE endpoint
        @Get('/stream')
        @Sse()
        async *stream(): SseGenerator {
          for (let i = 0; i < 3; i++) {
            yield { event: 'tick', data: { count: i } };
          }
        }

        // SSE with heartbeat
        @Get('/live')
        @Sse({ heartbeat: 15000 })
        async *live(): SseGenerator {
          yield { event: 'connected', data: await this.dataService.waitForUpdate() };
        }

        // SSE with event IDs for reconnection
        @Get('/notifications')
        @Sse({ heartbeat: 30000 })
        async *notifications(): SseGenerator {
          let eventId = 0;
          const notification = await this.notificationService.poll();
          eventId++;
          yield {
            event: 'notification',
            data: notification,
            id: String(eventId),
            retry: 5000,
          };
        }

        // Using sse() method
        @Get('/manual')
        events(): Response {
          return this.sse(async function* () {
            yield { event: 'start', data: { timestamp: 1699999999999 } };
            yield { event: 'complete', data: { success: true } };
          }());
        }
      }

      @Module({ controllers: [EventsController], providers: [DataService, NotificationService] })
      class EventsModule {}

      const app = new OneBunApplication(EventsModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();

      try {
        const base = app.getHttpUrl();

        // Every yield of the generator reaches the client as one SSE frame, in order.
        const stream = await fetch(`${base}/events/stream`);
        expect(stream.headers.get('content-type')).toBe('text/event-stream');
        expect(await stream.text()).toBe(
          'event: tick\ndata: {"count":0}\n\n' +
          'event: tick\ndata: {"count":1}\n\n' +
          'event: tick\ndata: {"count":2}\n\n',
        );

        // The constructor-injected services are real instances, not placeholders: their
        // return values are what the stream carries.
        const live = await fetch(`${base}/events/live`);
        expect(await live.text()).toBe('event: connected\ndata: {"updated":true}\n\n');

        // id/retry travel in the documented wire order: event, id, retry, data.
        const notifications = await fetch(`${base}/events/notifications`);
        expect(await notifications.text()).toBe(
          'event: notification\nid: 1\nretry: 5000\n' +
          'data: {"type":"notification","message":"New message"}\n\n',
        );

        // The sse() helper answers with the same content type as the decorator.
        const manual = await fetch(`${base}/events/manual`);
        expect(manual.headers.get('content-type')).toBe('text/event-stream');
        expect(await manual.text()).toBe(
          'event: start\ndata: {"timestamp":1699999999999}\n\n' +
          'event: complete\ndata: {"success":true}\n\n',
        );
      } finally {
        await app.stop();
      }
    });
  });
});

// ============================================================================
// Server & SSE Default Constants
// ============================================================================

describe('Server & SSE Default Constants (docs/api/core.md, docs/api/controllers.md)', () => {
  it('should export DEFAULT_IDLE_TIMEOUT as 120 seconds', () => {
    expect(DEFAULT_IDLE_TIMEOUT).toBe(120);
  });

  it('should export DEFAULT_SSE_HEARTBEAT_MS as 30000 milliseconds', () => {
    expect(DEFAULT_SSE_HEARTBEAT_MS).toBe(30_000);
  });

  it('should export DEFAULT_SSE_TIMEOUT as 600 seconds (10 minutes)', () => {
    expect(DEFAULT_SSE_TIMEOUT).toBe(600);
  });
});

// ============================================================================
// Per-request timeout via route decorators (docs/api/decorators.md)
// ============================================================================

describe('Per-request timeout via route decorators (docs/api/decorators.md)', () => {
  it('should store timeout in route metadata when specified via @Get options', () => {
    @Controller('/tasks')
    class TaskController extends BaseController {
      @Get('/process', { timeout: 300 })
      async process() {
        return new Response('OK');
      }
    }

    const metadata = getControllerMetadata(TaskController);
    expect(metadata).toBeDefined();
    const route = metadata!.routes.find((r) => r.handler === 'process');
    expect(route).toBeDefined();
    expect(route!.timeout).toBe(300);
  });

  it('should store timeout: 0 (disable) in route metadata', () => {
    @Controller('/export')
    class ExportController extends BaseController {
      @Get('/all', { timeout: 0 })
      async exportAll() {
        return new Response('OK');
      }
    }

    const metadata = getControllerMetadata(ExportController);
    expect(metadata).toBeDefined();
    const route = metadata!.routes.find((r) => r.handler === 'exportAll');
    expect(route).toBeDefined();
    expect(route!.timeout).toBe(0);
  });

  it('should not include timeout in metadata when not specified', () => {
    @Controller('/simple')
    class SimpleController extends BaseController {
      @Get('/hello')
      async hello() {
        return new Response('OK');
      }
    }

    const metadata = getControllerMetadata(SimpleController);
    expect(metadata).toBeDefined();
    const route = metadata!.routes.find((r) => r.handler === 'hello');
    expect(route).toBeDefined();
    expect(route!.timeout).toBeUndefined();
  });

  it('should support timeout on @Post, @Put, @Delete, @Patch', () => {
    @Controller('/api')
    class CrudController extends BaseController {
      @Post('/create', { timeout: 60 })
      async create() {
        return new Response('OK'); 
      }

      @Put('/update', { timeout: 120 })
      async update() {
        return new Response('OK'); 
      }

      @Delete('/remove', { timeout: 30 })
      async remove() {
        return new Response('OK'); 
      }

      @Patch('/patch', { timeout: 45 })
      async patch() {
        return new Response('OK'); 
      }
    }

    const metadata = getControllerMetadata(CrudController);
    expect(metadata).toBeDefined();

    expect(metadata!.routes.find((r) => r.handler === 'create')!.timeout).toBe(60);
    expect(metadata!.routes.find((r) => r.handler === 'update')!.timeout).toBe(120);
    expect(metadata!.routes.find((r) => r.handler === 'remove')!.timeout).toBe(30);
    expect(metadata!.routes.find((r) => r.handler === 'patch')!.timeout).toBe(45);
  });

  it('should store timeout in SSE decorator options', () => {
    @Controller('/events')
    class SseTimeoutController extends BaseController {
      @Get('/stream')
      @Sse({ timeout: 3600, heartbeat: 10000 })
      async *stream(): SseGenerator {
        yield { event: 'tick', data: { count: 0 } };
      }
    }

    const sseOptions = getSseMetadata(
      SseTimeoutController.prototype,
      'stream',
    );
    expect(sseOptions).toBeDefined();
    expect(sseOptions!.timeout).toBe(3600);
    expect(sseOptions!.heartbeat).toBe(10000);
  });

  it('should support timeout: 0 in @Sse to disable timeout', () => {
    @Controller('/events')
    class InfiniteSseController extends BaseController {
      @Get('/infinite')
      @Sse({ timeout: 0 })
      async *infinite(): SseGenerator {
        yield { event: 'start', data: {} };
      }
    }

    const sseOptions = getSseMetadata(
      InfiniteSseController.prototype,
      'infinite',
    );
    expect(sseOptions).toBeDefined();
    expect(sseOptions!.timeout).toBe(0);
  });
});

// ============================================================================
// Cookie, Headers, @Req with OneBunRequest
// ============================================================================

describe('@Cookie Decorator (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#cookie
   */
  it('should define @Cookie decorator with optional parameter', () => {
    // From docs: @Cookie('session_id') - optional
    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/me')
      async getMe(@Cookie('session_id') sessionId?: string) {
        return { sessionId };
      }
    }

    expect(ApiController).toBeDefined();
    const metadata = getControllerMetadata(ApiController);
    expect(metadata).toBeDefined();
    expect(metadata!.routes.length).toBe(1);
    expect(metadata!.routes[0].params!.length).toBe(1);
    expect(metadata!.routes[0].params![0].type).toBe(ParamType.COOKIE);
    expect(metadata!.routes[0].params![0].name).toBe('session_id');
    expect(metadata!.routes[0].params![0].isRequired).toBe(false);
  });

  /**
   * @source docs:api/decorators.md#cookie
   */
  it('should define @Cookie decorator with required option', () => {
    // From docs: @Cookie('session_id', { required: true }) - required
    @Controller('/api')
    class AuthController extends BaseController {
      @Get('/protected')
      async protectedRoute(@Cookie('session_id', { required: true }) sessionId: string) {
        return { sessionId };
      }
    }

    expect(AuthController).toBeDefined();
    const metadata = getControllerMetadata(AuthController);
    expect(metadata!.routes[0].params![0].isRequired).toBe(true);
  });

  /**
   * @source docs:api/decorators.md#cookie
   */
  it('should define @Cookie decorator with validation schema', async () => {
    // From docs: `@Cookie('theme', type('"light" | "dark"')) theme?: string` — optional
    // with validation
    const themeSchema = type('"light" | "dark"');

    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/prefs')
      async prefs(@Cookie('theme', themeSchema) theme?: string) {
        return { theme: theme ?? 'unset' };
      }
    }

    const metadata = getControllerMetadata(ApiController);
    expect(metadata!.routes[0].params![0].type).toBe(ParamType.COOKIE);
    expect(metadata!.routes[0].params![0].name).toBe('theme');
    expect(metadata!.routes[0].params![0].schema).toBe(themeSchema);

    @Module({ controllers: [ApiController] })
    class CookieSchemaModule {}

    const app = new OneBunApplication(CookieSchemaModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const baseUrl = app.getHttpUrl();

      // A value the schema accepts reaches the handler
      const accepted = await fetch(`${baseUrl}/api/prefs`, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { Cookie: 'theme=dark' },
      });
      expect(accepted.status).toBe(HttpStatusCode.OK);
      expect(await accepted.json()).toEqual({ success: true, result: { theme: 'dark' } });

      // ...a value it rejects is refused with 400 before the handler runs
      const rejected = await fetch(`${baseUrl}/api/prefs`, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { Cookie: 'theme=neon' },
      });
      expect(rejected.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await rejected.json()).toMatchObject({
        success: false,
        code: HttpStatusCode.BAD_REQUEST,
      });

      // ...and "Optional by default" means an absent cookie is not an error: the schema
      // only runs on a value that is actually there.
      const absent = await fetch(`${baseUrl}/api/prefs`);
      expect(absent.status).toBe(HttpStatusCode.OK);
      expect(await absent.json()).toEqual({ success: true, result: { theme: 'unset' } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/decorators.md#parameter-decorators
   */
  it('should combine @Cookie with other parameter decorators', () => {
    // From docs: combining @Cookie, @Param, @Header, @Query
    @Controller('/api')
    class CombinedController extends BaseController {
      @Get('/users/:id')
      async getUser(
        @Param('id') id: string,
        @Query('fields') fields?: string,
        @Header('Authorization') auth?: string,
        @Cookie('session') session?: string,
      ) {
        return {
          id, fields, auth, session, 
        };
      }
    }

    expect(CombinedController).toBeDefined();
    const metadata = getControllerMetadata(CombinedController);
    expect(metadata!.routes[0].params!.length).toBe(4);
  });
});

describe('@Req() with OneBunRequest (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#req
   */
  it('should define @Req() handler with OneBunRequest type', () => {
    // From docs: @Req() with OneBunRequest type
    // OneBunRequest extends Request with .cookies (CookieMap) and .params
    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/raw')
      async handleRaw(@Req() req: OneBunRequest) {
        const url = new URL(req.url);

        // req.cookies is CookieMap, req.params is available from routes API
        return { url: url.pathname };
      }
    }

    expect(ApiController).toBeDefined();
    const metadata = getControllerMetadata(ApiController);
    expect(metadata!.routes[0].params![0].type).toBe(ParamType.REQUEST);
  });

  /**
   * @source docs:api/decorators.md#req
   */
  it('should define handler accessing cookies via req.cookies', async () => {
    // From docs: reading cookies through @Req() — the section promises the injected
    // request carries `.cookies` (a CookieMap) and `.params` (Bun's route params).
    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/users/:id')
      async session(@Req() req: OneBunRequest) {
        // Access cookies via CookieMap
        const session = req.cookies.get('session');

        return {
          session: session ?? null,
          id: (req.params as Record<string, string>).id,
          method: req.method,
          path: new URL(req.url).pathname,
        };
      }
    }

    @Module({ controllers: [ApiController] })
    class ReqCookiesModule {}

    const app = new OneBunApplication(ReqCookiesModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const baseUrl = app.getHttpUrl();

      const response = await fetch(`${baseUrl}/api/users/42`, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { Cookie: 'session=abc123; theme=dark' },
      });
      expect(response.status).toBe(HttpStatusCode.OK);
      // req.cookies picks the named cookie out of the header, and req.params carries the
      // route segment — both on the object @Req() injected.
      expect(await response.json()).toEqual({
        success: true,
        result: {
          session: 'abc123',
          id: '42',
          method: 'GET',
          path: '/api/users/42',
        },
      });

      // A request without the cookie reaches the handler with an absent entry, not a throw
      const noCookie = await fetch(`${baseUrl}/api/users/7`);
      expect(await noCookie.json()).toMatchObject({
        success: true,
        result: { session: null, id: '7' },
      });
    } finally {
      await app.stop();
    }
  });
});

describe('OneBunRequest and OneBunResponse Types (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#req
   */
  it('should use OneBunRequest as type alias for BunRequest', () => {
    // OneBunRequest is an alias for BunRequest
    // It extends standard Request with .cookies and .params
    const _check: OneBunRequest extends Request ? true : false = true;
    expect(_check).toBe(true);
  });

  /**
   * Re-pointed from the page root: `OneBunResponse` is documented on this page only in
   * the @UseMiddleware section, as what `next()` resolves to and what a middleware
   * returns to short-circuit the chain. That is the promise asserted here.
   *
   * @source docs:api/decorators.md#usemiddleware
   */
  it('should use OneBunResponse as type alias for Response', async () => {
    let handlerRuns = 0;

    // From docs: the AuthMiddleware example, typed exactly as the page types it
    class AuthMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        const token = req.headers.get('Authorization');
        if (!token) {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          return new Response('Unauthorized', { status: 401, headers: { 'X-Denied-By': 'AuthMiddleware' } });
        }

        const response = await next();
        response.headers.set('X-Checked', 'yes');

        return response;
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      @Get('/protected')
      @UseMiddleware(AuthMiddleware)
      async protectedRoute() {
        handlerRuns++;

        return { message: 'Secret data' };
      }
    }

    @Module({ controllers: [UserController] })
    class ProtectedModule {}

    const app = new OneBunApplication(ProtectedModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const baseUrl = app.getHttpUrl();

      // "Return an OneBunResponse directly to short-circuit the chain": the Response the
      // middleware built is delivered verbatim — status, body and headers — and the
      // handler never runs.
      const denied = await fetch(`${baseUrl}/users/protected`);
      expect(denied.status).toBe(401);
      expect(await denied.text()).toBe('Unauthorized');
      expect(denied.headers.get('X-Denied-By')).toBe('AuthMiddleware');
      expect(handlerRuns).toBe(0);

      // "next() ... returns OneBunResponse": an ordinary Response the middleware can read
      // and mutate before it reaches the client.
      const allowed = await fetch(`${baseUrl}/users/protected`, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { Authorization: 'Bearer token' },
      });
      expect(allowed.status).toBe(HttpStatusCode.OK);
      expect(allowed.headers.get('X-Checked')).toBe('yes');
      expect(await allowed.json()).toEqual({ success: true, result: { message: 'Secret data' } });
      expect(handlerRuns).toBe(1);
    } finally {
      await app.stop();
    }
  });
});

describe('Custom Response Headers (docs/api/controllers.md)', () => {
  /**
   * @source docs:api/controllers.md#custom-response-headers
   */
  it('should define handler returning Response with custom headers', async () => {
    // From docs: returning Response with custom headers
    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/download')
      async download() {
        return new Response(JSON.stringify({ data: 'file content' }), {
          status: 200,
          headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'X-Custom-Header': 'custom-value',
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Cache-Control': 'no-store',
          },
        });
      }
    }

    @Module({ controllers: [ApiController] })
    class DownloadModule {}

    const app = new OneBunApplication(DownloadModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const response = await fetch(`${app.getHttpUrl()}/api/download`);

      // The point of the section: returning a Response is how custom headers get out,
      // and the framework forwards every one of them untouched.
      expect(response.status).toBe(HttpStatusCode.OK);
      expect(response.headers.get('x-custom-header')).toBe('custom-value');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('application/json');
      // A hand-built Response also keeps its own body — no { success, result } envelope.
      expect(await response.json()).toEqual({ data: 'file content' });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#setting-cookies-via-set-cookie-header
   */
  it('should define handler returning Response with Set-Cookie header', async () => {
    // From docs: setting cookies via Set-Cookie header
    @Controller('/api')
    class AuthController extends BaseController {
      @Post('/login')
      async login(@Body() _body: unknown) {
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

    @Module({ controllers: [AuthController] })
    class AuthModule {}

    const app = new OneBunApplication(AuthModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const response = await fetch(`${app.getHttpUrl()}/api/login`, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'ada' }),
      });

      // The documented promise: append()-ed Set-Cookie headers survive as SEPARATE
      // headers — a Headers→object round-trip anywhere in the pipeline would have
      // collapsed these two into one and dropped the first.
      expect(response.headers.getSetCookie()).toEqual([
        'session=abc123; Path=/; HttpOnly',
        'theme=dark; Path=/',
      ]);
      expect(await response.json()).toEqual({ loggedIn: true });
    } finally {
      await app.stop();
    }
  });
});

describe('Working with Cookies (docs/api/controllers.md)', () => {
  /**
   * @source docs:api/controllers.md#reading-cookies-via-cookie-decorator
   */
  it('should define handler reading cookies via @Cookie decorator', async () => {
    // From docs: reading cookies via @Cookie('name')
    @Controller('/api')
    class PrefsController extends BaseController {
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

    // Each @Cookie() registers a cookie-typed parameter under the name it was given.
    const params = [...getControllerMetadata(PrefsController)!.routes[0].params ?? []]
      .sort((a, b) => a.index - b.index)
      .map((p) => ({ type: p.type, name: p.name, index: p.index }));
    expect(params).toEqual([
      { type: ParamType.COOKIE, name: 'theme', index: 0 },
      { type: ParamType.COOKIE, name: 'lang', index: 1 },
    ]);

    @Module({ controllers: [PrefsController] })
    class PrefsModule {}

    const app = new OneBunApplication(PrefsModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const sent = await fetch(`${app.getHttpUrl()}/api/preferences`, {
        headers: { cookie: 'theme=dark; lang=fr' },
      });
      // The request's cookie values arrive as the handler's arguments, by name.
      expect(await sent.json()).toEqual({ success: true, result: { theme: 'dark', lang: 'fr' } });

      // "Optional by default": a missing cookie is undefined, so the ?? defaults apply
      // — it is not a 400 and not the string 'undefined'.
      const missing = await fetch(`${app.getHttpUrl()}/api/preferences`);
      expect(missing.status).toBe(HttpStatusCode.OK);
      expect(await missing.json()).toEqual({ success: true, result: { theme: 'light', lang: 'en' } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#reading-cookies-via-reqcookies
   */
  it('should define handler reading cookies via req.cookies', async () => {
    // From docs: reading cookies through @Req() with req.cookies.get()
    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/session')
      async session(@Req() req: OneBunRequest) {
        const session = req.cookies.get('session');

        return { session };
      }
    }

    @Module({ controllers: [ApiController] })
    class SessionModule {}

    const app = new OneBunApplication(SessionModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const response = await fetch(`${app.getHttpUrl()}/api/session`, {
        headers: { cookie: 'session=sess-42; other=ignored' },
      });

      // The injected request carries a populated CookieMap, keyed by cookie name.
      expect(await response.json()).toEqual({ success: true, result: { session: 'sess-42' } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#setting-cookies-via-reqcookies
   */
  it('should define handler setting cookies via req.cookies', async () => {
    // From docs: setting cookies using req.cookies.set()
    @Controller('/api')
    class AuthController extends BaseController {
      @Post('/login')
      async login(@Req() req: OneBunRequest, @Body() _body: unknown) {
        // Set cookie via CookieMap
        req.cookies.set('session', 'new-session-id', {
          httpOnly: true,
          path: '/',
          maxAge: 3600,
        });

        return { loggedIn: true };
      }
    }

    @Module({ controllers: [AuthController] })
    class LoginModule {}

    const app = new OneBunApplication(LoginModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const response = await fetch(`${app.getHttpUrl()}/api/login`, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'ada' }),
      });

      // Writing into req.cookies is what emits Set-Cookie on the way out, with the
      // attributes the handler asked for — the handler never touches the Response.
      const setCookies = response.headers.getSetCookie();
      expect(setCookies).toHaveLength(1);
      expect(setCookies[0]).toStartWith('session=new-session-id;');
      expect(setCookies[0]).toContain('Path=/');
      expect(setCookies[0]).toContain('Max-Age=3600');
      expect(setCookies[0]).toContain('HttpOnly');
      expect(await response.json()).toEqual({ success: true, result: { loggedIn: true } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#deleting-cookies
   */
  it('should define handler deleting cookies via req.cookies', async () => {
    // From docs: deleting cookies using req.cookies.delete()
    @Controller('/api')
    class AuthController extends BaseController {
      @Post('/logout')
      async logout(@Req() req: OneBunRequest) {
        req.cookies.delete('session');

        return { loggedOut: true };
      }
    }

    @Module({ controllers: [AuthController] })
    class LogoutModule {}

    const app = new OneBunApplication(LogoutModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const response = await fetch(`${app.getHttpUrl()}/api/logout`, {
        method: 'POST',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'content-type': 'application/json', cookie: 'session=sess-42' },
        body: JSON.stringify({}),
      });

      // delete() is an expiry instruction on the wire: the client is told to drop the
      // cookie, by an empty value with an expiry in the past.
      const setCookies = response.headers.getSetCookie();
      expect(setCookies).toHaveLength(1);
      expect(setCookies[0]).toStartWith('session=;');
      expect(setCookies[0]).toContain('Expires=');
      expect(setCookies[0]).toContain('1970');
      expect(await response.json()).toEqual({ success: true, result: { loggedOut: true } });
    } finally {
      await app.stop();
    }
  });
});

// ============================================================================
// File Upload Documentation Tests
// ============================================================================

describe('File Upload API Documentation (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#uploadedfile
   */
  describe('Single File Upload (docs/api/decorators.md#uploadedfile)', () => {
    it('should define controller with @UploadedFile decorator', () => {
      @Controller('/api/files')
      class FileController extends BaseController {
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

      expect(FileController).toBeDefined();
      const metadata = getControllerMetadata(FileController);
      expect(metadata).toBeDefined();
      expect(metadata!.routes).toHaveLength(1);

      const route = metadata!.routes[0];
      expect(route.params).toBeDefined();
      expect(route.params!.length).toBe(1);
      expect(route.params![0].type).toBe(ParamType.FILE);
      expect(route.params![0].name).toBe('avatar');
      expect(route.params![0].isRequired).toBe(true);
      expect(route.params![0].fileOptions).toBeDefined();
      expect(route.params![0].fileOptions!.maxSize).toBe(5 * 1024 * 1024);
      expect(route.params![0].fileOptions!.mimeTypes).toEqual([MimeType.ANY_IMAGE]);
    });
  });

  /**
   * @source docs:api/decorators.md#uploadedfiles
   */
  describe('Multiple File Upload (docs/api/decorators.md#uploadedfiles)', () => {
    it('should define controller with @UploadedFiles decorator', () => {
      @Controller('/api/files')
      class FileController extends BaseController {
        @Post('/documents')
        async uploadDocs(
          @UploadedFiles('docs', { maxCount: 10 }) files: OneBunFile[],
        ): Promise<Response> {
          for (const file of files) {
            await file.writeTo(`./uploads/${file.name}`);
          }

          return this.success({ count: files.length });
        }
      }

      expect(FileController).toBeDefined();
      const metadata = getControllerMetadata(FileController);
      expect(metadata).toBeDefined();

      const route = metadata!.routes[0];
      expect(route.params).toBeDefined();
      expect(route.params![0].type).toBe(ParamType.FILES);
      expect(route.params![0].name).toBe('docs');
      expect(route.params![0].fileOptions!.maxCount).toBe(10);
    });

    it('should support @UploadedFiles without field name (all files)', () => {
      @Controller('/api/files')
      class FileController extends BaseController {
        @Post('/batch')
        async uploadBatch(
          @UploadedFiles(undefined, { maxCount: 20 }) files: OneBunFile[],
        ): Promise<Response> {
          return this.success({ count: files.length });
        }
      }

      expect(FileController).toBeDefined();
      const metadata = getControllerMetadata(FileController);
      const route = metadata!.routes[0];
      expect(route.params![0].type).toBe(ParamType.FILES);
      expect(route.params![0].name).toBe('');
    });
  });

  /**
   * @source docs:api/decorators.md#formfield
   */
  describe('Form Field (docs/api/decorators.md#formfield)', () => {
    it('should define controller with @FormField decorator', () => {
      @Controller('/api/files')
      class FileController extends BaseController {
        @Post('/profile')
        async createProfile(
          @UploadedFile('avatar', { mimeTypes: [MimeType.ANY_IMAGE] }) avatar: OneBunFile,
          @FormField('name', { required: true }) name: string,
          @FormField('email') email: string,
        ): Promise<Response> {
          await avatar.writeTo(`./uploads/${avatar.name}`);

          return this.success({ name, email, avatar: avatar.name });
        }
      }

      expect(FileController).toBeDefined();
      const metadata = getControllerMetadata(FileController);
      const route = metadata!.routes[0];
      expect(route.params).toBeDefined();
      expect(route.params!.length).toBe(3);

      // @UploadedFile
      const fileParam = route.params!.find((p) => p.type === ParamType.FILE);
      expect(fileParam).toBeDefined();
      expect(fileParam!.name).toBe('avatar');

      // @FormField (required)
      const nameParam = route.params!.find((p) => p.name === 'name');
      expect(nameParam).toBeDefined();
      expect(nameParam!.type).toBe(ParamType.FORM_FIELD);
      expect(nameParam!.isRequired).toBe(true);

      // @FormField (optional)
      const emailParam = route.params!.find((p) => p.name === 'email');
      expect(emailParam).toBeDefined();
      expect(emailParam!.type).toBe(ParamType.FORM_FIELD);
      expect(emailParam!.isRequired).toBe(false);
    });
  });

  /**
   * @source docs:api/decorators.md#onebunfile
   */
  describe('OneBunFile Class (docs/api/decorators.md#onebunfile)', () => {
    it('should create OneBunFile from File and support all methods', async () => {
      const content = 'test file content';
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const oneBunFile = new OneBunFile(file);

      expect(oneBunFile.name).toBe('test.txt');
      expect(oneBunFile.size).toBe(content.length);
      expect(oneBunFile.type).toStartWith('text/plain');

      const base64 = await oneBunFile.toBase64();
      expect(base64).toBe(btoa(content));

      const buffer = await oneBunFile.toBuffer();
      expect(buffer.toString()).toBe(content);

      const blob = oneBunFile.toBlob();
      expect(blob.size).toBe(content.length);
    });

    it('should create OneBunFile from base64', async () => {
      const content = 'base64 content';
      const base64 = btoa(content);
      const file = OneBunFile.fromBase64(base64, 'decoded.txt', 'text/plain');

      expect(file.name).toBe('decoded.txt');
      expect(file.type).toStartWith('text/plain');

      const roundTripped = await file.toBase64();
      expect(roundTripped).toBe(base64);
    });
  });

  /**
   * @source docs:api/decorators.md#mimetype-enum
   */
  describe('MimeType Enum (docs/api/decorators.md#mimetype-enum)', () => {
    it('should provide common MIME type constants', () => {
      // Wildcards
      expect(String(MimeType.ANY)).toBe('*/*');
      expect(String(MimeType.ANY_IMAGE)).toBe('image/*');
      expect(String(MimeType.ANY_VIDEO)).toBe('video/*');
      expect(String(MimeType.ANY_AUDIO)).toBe('audio/*');

      // Specific types
      expect(String(MimeType.PNG)).toBe('image/png');
      expect(String(MimeType.PDF)).toBe('application/pdf');
      expect(String(MimeType.MP4)).toBe('video/mp4');

      // Wildcard matching
      expect(matchMimeType('image/png', MimeType.ANY_IMAGE)).toBe(true);
      expect(matchMimeType('video/mp4', MimeType.ANY_IMAGE)).toBe(false);
    });
  });

  /**
   * @source docs:api/decorators.md#json-base64-upload-format
   */
  describe('JSON Base64 Upload (docs/api/decorators.md#json-base64-upload-format)', () => {
    it('should parse full JSON base64 format', () => {
      const base64 = btoa('png image data');
      const file = OneBunFile.fromBase64(base64, 'photo.png', 'image/png');

      expect(file.name).toBe('photo.png');
      expect(file.type).toBe('image/png');
    });

    it('should parse data URI format', () => {
      const base64 = btoa('svg data');
      const dataUri = `data:image/svg+xml;base64,${base64}`;
      const file = OneBunFile.fromBase64(dataUri, 'icon.svg');

      expect(file.type).toBe('image/svg+xml');
      expect(file.name).toBe('icon.svg');
    });
  });
});

describe('File Upload API Documentation (docs/api/controllers.md)', () => {
  /**
   * @source docs:api/controllers.md#single-file-upload
   */
  it('should define single file upload controller', async () => {
    // The doc writes to ./uploads; the test writes outside the repo, same call.
    const uploadDir = `/tmp/onebun-docs-single-${crypto.randomUUID()}`;

    @Controller('/api/files')
    class FileController extends BaseController {
      @Post('/avatar')
      async uploadAvatar(
        @UploadedFile('avatar', {
          maxSize: 5 * 1024 * 1024,
          mimeTypes: [MimeType.ANY_IMAGE],
        }) file: OneBunFile,
      ) {
        await file.writeTo(`${uploadDir}/${file.name}`);
        const base64 = await file.toBase64();
        const buffer = await file.toBuffer();

        return {
          filename: file.name,
          size: file.size,
          type: file.type,
          base64,
          text: buffer.toString('utf8'),
        };
      }
    }

    @Module({ controllers: [FileController] })
    class UploadModule {}

    const app = new OneBunApplication(UploadModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const form = new FormData();
      form.append('avatar', new File(['fake-png-bytes'], 'photo.png', { type: 'image/png' }));

      const response = await fetch(`${app.getHttpUrl()}/api/files/avatar`, {
        method: 'POST',
        body: form,
      });

      // The multipart part named 'avatar' reaches the handler as a OneBunFile carrying
      // the real bytes — name, size, type, and both conversions the section advertises.
      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({
        success: true,
        result: {
          filename: 'photo.png',
          size: 14,
          type: 'image/png',
          base64: btoa('fake-png-bytes'),
          text: 'fake-png-bytes',
        },
      });

      // writeTo() actually put those bytes on disk.
      expect(await Bun.file(`${uploadDir}/photo.png`).text()).toBe('fake-png-bytes');

      // And the mimeTypes option is a constraint, not decoration: a non-image is refused
      // before the handler body runs.
      const wrongType = new FormData();
      wrongType.append('avatar', new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));
      const rejected = await fetch(`${app.getHttpUrl()}/api/files/avatar`, {
        method: 'POST',
        body: wrongType,
      });

      expect(rejected.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await rejected.json()).toMatchObject({
        success: false,
        code: HttpStatusCode.BAD_REQUEST,
        error: expect.stringContaining('invalid MIME type'),
      });
      expect(await Bun.file(`${uploadDir}/doc.pdf`).exists()).toBe(false);
    } finally {
      await app.stop();
      const { rm } = await import('node:fs/promises');
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  /**
   * @source docs:api/controllers.md#multiple-file-upload
   */
  it('should define multiple file upload controller', async () => {
    const uploadDir = `/tmp/onebun-docs-multiple-${crypto.randomUUID()}`;

    @Controller('/api/files')
    class FileController extends BaseController {
      @Post('/documents')
      async uploadDocuments(
        @UploadedFiles('docs', {
          maxCount: 10,
          maxSize: 10 * 1024 * 1024,
          mimeTypes: [MimeType.PDF, MimeType.DOCX],
        }) files: OneBunFile[],
      ) {
        for (const file of files) {
          await file.writeTo(`${uploadDir}/${file.name}`);
        }

        return { uploaded: files.length };
      }
    }

    @Module({ controllers: [FileController] })
    class DocumentsModule {}

    const app = new OneBunApplication(DocumentsModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    const pdf = (name: string, body: string): File =>
      new File([body], name, { type: 'application/pdf' });

    try {
      const form = new FormData();
      form.append('docs', pdf('first.pdf', 'first-body'));
      form.append('docs', pdf('second.pdf', 'second-body'));

      const response = await fetch(`${app.getHttpUrl()}/api/files/documents`, {
        method: 'POST',
        body: form,
      });

      // Every part sharing the field name arrives, as an array, in order.
      expect(await response.json()).toEqual({ success: true, result: { uploaded: 2 } });
      expect(await Bun.file(`${uploadDir}/first.pdf`).text()).toBe('first-body');
      expect(await Bun.file(`${uploadDir}/second.pdf`).text()).toBe('second-body');

      // maxCount is enforced: the 11th part fails the request instead of being dropped.
      const tooMany = new FormData();
      for (let i = 0; i < 11; i++) {
        tooMany.append('docs', pdf(`over-${i}.pdf`, 'body'));
      }
      const rejected = await fetch(`${app.getHttpUrl()}/api/files/documents`, {
        method: 'POST',
        body: tooMany,
      });

      expect(rejected.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await rejected.json()).toMatchObject({
        success: false,
        code: HttpStatusCode.BAD_REQUEST,
        error: expect.stringContaining('Too many files'),
      });
      expect(await Bun.file(`${uploadDir}/over-0.pdf`).exists()).toBe(false);
    } finally {
      await app.stop();
      const { rm } = await import('node:fs/promises');
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  /**
   * @source docs:api/controllers.md#file-with-form-fields
   */
  it('should define file with form fields controller', async () => {
    const uploadDir = `/tmp/onebun-docs-profile-${crypto.randomUUID()}`;

    @Controller('/api/files')
    class FileController extends BaseController {
      @Post('/profile')
      async createProfile(
        @UploadedFile('avatar', { mimeTypes: [MimeType.ANY_IMAGE] }) avatar: OneBunFile,
        @FormField('name', { required: true }) name: string,
        @FormField('email') email: string,
      ) {
        await avatar.writeTo(`${uploadDir}/${avatar.name}`);

        return { name, email, avatar: avatar.name };
      }
    }

    @Module({ controllers: [FileController] })
    class ProfileModule {}

    const app = new OneBunApplication(ProfileModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();

    try {
      const form = new FormData();
      form.append('avatar', new File(['png'], 'photo.png', { type: 'image/png' }));
      form.append('name', 'Ada');
      form.append('email', 'ada@example.com');

      const response = await fetch(`${app.getHttpUrl()}/api/files/profile`, {
        method: 'POST',
        body: form,
      });

      // One multipart body, two kinds of part: the file lands on @UploadedFile, the plain
      // text parts land on their @FormField parameters, by name.
      expect(await response.json()).toEqual({
        success: true,
        result: { name: 'Ada', email: 'ada@example.com', avatar: 'photo.png' },
      });
      expect(await Bun.file(`${uploadDir}/photo.png`).text()).toBe('png');

      // `required: true` is enforced by the framework, not by the handler.
      const missingName = new FormData();
      missingName.append('avatar', new File(['png'], 'photo.png', { type: 'image/png' }));
      missingName.append('email', 'ada@example.com');
      const rejected = await fetch(`${app.getHttpUrl()}/api/files/profile`, {
        method: 'POST',
        body: missingName,
      });

      expect(rejected.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await rejected.json()).toMatchObject({
        success: false,
        code: HttpStatusCode.BAD_REQUEST,
        error: expect.stringContaining('name'),
      });
    } finally {
      await app.stop();
      const { rm } = await import('node:fs/promises');
      await rm(uploadDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// docs/api/interceptors.md examples
// ============================================================================

describe('docs/api/interceptors.md', () => {
  it('createInterceptor — function-based interceptor returns a class constructor', () => {
    const timingInterceptor = createInterceptor(async (_ctx, next) => {
      const response = await next();

      return response;
    });

    expect(typeof timingInterceptor).toBe('function');
    const instance = new timingInterceptor();
    expect(typeof instance.intercept).toBe('function');
  });

  it('class-based interceptor implements Interceptor', () => {
    class AddHeaderInterceptor extends BaseInterceptor {
      async intercept(
        _context: ExecutionContext,
        next: () => Promise<unknown>,
      ): Promise<unknown> {
        const response = await next() as Response;

        return new Response(await response.text(), {
          status: response.status,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          headers: { ...Object.fromEntries(response.headers.entries()), 'x-custom': 'true' },
        });
      }
    }

    expect(typeof AddHeaderInterceptor).toBe('function');
    expect(new AddHeaderInterceptor()).toBeInstanceOf(BaseInterceptor);
  });

  it('UseInterceptors can be applied to class or method', () => {
    @UseInterceptors(LoggingInterceptor)
    @Controller('/api')
    class InterceptedController extends BaseController {
      @Get('/data')
      @UseInterceptors(new TimeoutInterceptor(5000))
      async getData() {
        return { value: 42 };
      }
    }

    expect(InterceptedController).toBeDefined();
  });

  it('LoggingInterceptor is a class', () => {
    expect(typeof LoggingInterceptor).toBe('function');
    expect(new LoggingInterceptor()).toBeInstanceOf(BaseInterceptor);
  });

  it('TimeoutInterceptor accepts timeout in constructor', () => {
    const interceptor = new TimeoutInterceptor(3000);
    expect(interceptor).toBeInstanceOf(BaseInterceptor);
  });
});

// ============================================================================
// docs/api/guards.md examples
// ============================================================================

describe('docs/api/guards.md', () => {
  it('createHttpGuard — function-based guard returns a class constructor', () => {
    const apiKeyGuardClass = createHttpGuard((ctx) => {
      return ctx.getRequest().headers.get('x-api-key') !== null;
    });

    expect(apiKeyGuardClass).toBeDefined();
    // createHttpGuard returns a constructor — instantiate to get the guard instance
    const instance = new apiKeyGuardClass();
    expect(typeof instance.canActivate).toBe('function');
  });

  it('AuthGuard blocks request without Bearer token', async () => {
    const guard = new AuthGuard();
    const req = new Request('http://localhost/') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');

    expect(await guard.canActivate(ctx)).toBe(false);
  });

  it('AuthGuard allows request with Bearer token', async () => {
    const guard = new AuthGuard();
    const req = new Request('http://localhost/', {
      headers: { authorization: 'Bearer my-token' },
    }) as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('RolesGuard checks x-user-roles header', async () => {
    const guard = new RolesGuard(['admin']);
    const h = new Headers();
    h.set('x-user-roles', 'admin,user');
    const req = new Request('http://localhost/', { headers: h }) as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('RolesGuard rejects when role not present', async () => {
    const guard = new RolesGuard(['admin']);
    const h = new Headers();
    h.set('x-user-roles', 'user');
    const req = new Request('http://localhost/', { headers: h }) as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');

    expect(await guard.canActivate(ctx)).toBe(false);
  });

  it('RolesGuard with custom role extractor', async () => {
    const guard = new RolesGuard(
      ['admin'],
      (ctx) => {
        const raw = ctx.getRequest().headers.get('x-custom-roles');

        return raw ? raw.split(':') : [];
      },
    );
    const h = new Headers();
    h.set('x-custom-roles', 'admin:editor');
    const req = new Request('http://localhost/', { headers: h }) as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');

    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('@UseGuards applies metadata to controller', () => {
    @UseGuards(AuthGuard)
    @Controller('/protected')
    class ProtectedController extends BaseController {
      @Get('/')
      index() {
        return { message: 'authenticated' };
      }
    }

    expect(ProtectedController).toBeDefined();
  });

  /**
   * @source docs:api/guards.md#one-decorator-three-transports
   */
  it('a Guard narrows the universal ExecutionContext per transport', () => {
    class TenantActiveGuard implements Guard {
      canActivate(ctx: ExecutionContext): boolean {
        let tenantId: string | undefined;

        if (isHttpContext(ctx)) {
          tenantId = ctx.getRequest().headers.get('x-tenant-id') ?? undefined;
        } else if (isQueueContext(ctx)) {
          tenantId = ctx.getMetadata().headers?.['x-tenant-id'];
        } else if (isWsContext(ctx)) {
          tenantId = ctx.getClient().metadata.tenantId as string | undefined;
        }

        // No branch matched, or no tenant on the one that did: deny.
        return tenantId !== undefined && tenantId === 'acme';
      }
    }

    const guard = new TenantActiveGuard();

    const httpHeaders = new Headers();
    httpHeaders.set('x-tenant-id', 'acme');
    const httpReq = new Request('http://localhost/', { headers: httpHeaders }) as unknown as OneBunRequest;
    expect(guard.canActivate(new HttpExecutionContextImpl(httpReq, 'h', 'C'))).toBe(true);

    const message = {
      id: 'm1',
      pattern: 'orders.created',
      params: {},
      data: {},
      timestamp: 0,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      metadata: { headers: { 'x-tenant-id': 'acme' } },
      ack: async () => undefined,
      nack: async () => undefined,
    };
    const queueCtx = new MessageExecutionContextImpl(
      message,
      'orders.created',
      () => undefined,
      class Consumer {},
    );
    expect(guard.canActivate(queueCtx)).toBe(true);
  });

  /**
   * @source docs:api/guards.md#one-decorator-three-transports
   */
  it('AuthGuard denies a queue context instead of reading a request that is not there', () => {
    const message = {
      id: 'm2',
      pattern: 'orders.created',
      params: {},
      data: {},
      timestamp: 0,
      metadata: { authorization: 'Bearer token' },
      ack: async () => undefined,
      nack: async () => undefined,
    };
    const queueCtx = new MessageExecutionContextImpl(
      message,
      'orders.created',
      () => undefined,
      class Consumer {},
    );

    expect(new AuthGuard().canActivate(queueCtx)).toBe(false);
  });
});

// ============================================================================
// docs/api/exception-filters.md examples
// ============================================================================

describe('docs/api/exception-filters.md', () => {
  it('createExceptionFilter — function-based filter', async () => {
    const filter = createExceptionFilter((error, _ctx) => {
      if (error instanceof Error) {
        return new Response(JSON.stringify({ caught: error.message }), { status: 200 });
      }
      throw error;
    });

    expect(filter).toBeDefined();
    const req = new Request('http://localhost/') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');
    const res = await filter.catch(new Error('boom'), ctx);
    const body = await res.json() as { caught: string };

    expect(body.caught).toBe('boom');
  });

  it('class-based filter — re-throws unknown errors', async () => {
    class TypedFilter implements ExceptionFilter {
      catch(error: unknown, _ctx: HttpExecutionContext): Response {
        if (error instanceof RangeError) {
          return Response.json({ success: false, error: 'range' });
        }
        throw error;
      }
    }

    const filter = new TypedFilter();
    const req = new Request('http://localhost/') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');

    const res = await filter.catch(new RangeError('out of range'), ctx);
    const body = await res.json() as { success: boolean; error: string };

    expect(body.success).toBe(false);
    expect(body.error).toBe('range');
  });

  it('defaultExceptionFilter handles OneBunBaseError subclass', async () => {
    const req = new Request('http://localhost/') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');
    const res = await defaultExceptionFilter.catch(new NotFoundError('not found'), ctx);
    const body = await res.json() as { success: boolean };

    expect(body.success).toBe(false);
  });

  it('async filter resolves correctly', async () => {
    const asyncFilter = createExceptionFilter(async (error, _ctx) => {
      await Promise.resolve(); // simulate async work

      return new Response(JSON.stringify({ async: true, msg: String(error) }));
    });

    const req = new Request('http://localhost/') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');
    const res = await asyncFilter.catch(new Error('err'), ctx);
    const body = await res.json() as { async: boolean };

    expect(body.async).toBe(true);
  });

  it('HttpException — carries statusCode', () => {
    const ex = new HttpException(400, 'Bad request');

    expect(ex).toBeInstanceOf(Error);
    expect(ex.statusCode).toBe(400);
    expect(ex.message).toBe('Bad request');
  });

  it('defaultExceptionFilter returns real HTTP status for HttpException', async () => {
    const req = new Request('http://localhost/') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(req, 'handler', 'Controller');
    const res = await defaultExceptionFilter.catch(
      new HttpException(404, 'Not found'),
      ctx,
    );

    expect(res.status).toBe(404);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Not found');
  });

  it('@UseFilters applies metadata to controller', () => {
    const filter = createExceptionFilter((err, _ctx) => {
      throw err;
    });

    @UseFilters(filter)
    @Controller('/filtered')
    class FilteredController extends BaseController {
      @Get('/')
      index() {
        return {};
      }
    }

    expect(FilteredController).toBeDefined();
  });
});

// ============================================================================
// docs/api/security.md examples
// ============================================================================

describe('docs/api/security.md', () => {
  it('CorsMiddleware — default wildcard origin', async () => {
    const mw = new CorsMiddleware();
    const req = new Request('http://localhost/', {
      headers: { origin: 'https://example.com' },
    }) as unknown as OneBunRequest;

    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('CorsMiddleware — preflight returns 204', async () => {
    const mw = new CorsMiddleware();
    const req = new Request('http://localhost/', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        // Required on every real preflight by the Fetch spec, and required by the middleware:
        // without it an OPTIONS is API discovery and is passed through to the application.
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'access-control-request-method': 'GET',
      },
    }) as unknown as OneBunRequest;

    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.status).toBe(204);
  });

  it('CorsMiddleware.configure() factory', async () => {
    const configuredClass = CorsMiddleware.configure({ origin: 'https://trusted.com' });
    const mw = new configuredClass();
    const req = new Request('http://localhost/', {
      headers: { origin: 'https://trusted.com' },
    }) as unknown as OneBunRequest;

    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://trusted.com');
  });

  it('RateLimitMiddleware — allows below max', async () => {
    const store = new MemoryRateLimitStore();
    const mw = new RateLimitMiddleware({ max: 5, windowMs: 60_000, store });
    const h1 = new Headers();
    h1.set('x-forwarded-for', '1.2.3.4');
    const req = new Request('http://localhost/', { headers: h1 }) as unknown as OneBunRequest;

    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.status).toBe(200);
  });

  it('RateLimitMiddleware — returns 429 when over limit', async () => {
    const store = new MemoryRateLimitStore();
    const mw = new RateLimitMiddleware({ max: 1, windowMs: 60_000, store });
    const h2 = new Headers();
    h2.set('x-forwarded-for', '9.9.9.9');
    const req = new Request('http://localhost/', { headers: h2 }) as unknown as OneBunRequest;
    await mw.use(req, async () => new Response('ok'));
    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.status).toBe(429);
  });

  /**
   * @source docs:api/security.md#client-identification-and-trustproxy
   */
  it('getClientAddress — transport peer wins over a header by default', () => {
    const req = new Request('http://localhost/', {
      headers: new Headers([['x-forwarded-for', '203.0.113.9']]),
    });
    const binding = createClientAddressBinding(
      { requestIP: () => ({ address: '198.51.100.4' }) },
      false,
    );
    bindClientAddress(req, binding);

    expect(getClientAddress(req)).toBe('198.51.100.4');
    expect(getPeerAddress(req)).toBe('198.51.100.4');
  });

  /**
   * @source docs:api/security.md#client-identification-and-trustproxy
   */
  it('getClientAddress — forwarded client wins when trustProxy is on', () => {
    const req = new Request('http://localhost/', {
      headers: new Headers([['x-forwarded-for', '203.0.113.9, 10.0.0.1']]),
    });
    const binding = createClientAddressBinding(
      { requestIP: () => ({ address: '198.51.100.4' }) },
      true,
    );
    bindClientAddress(req, binding);

    expect(getClientAddress(req)).toBe('203.0.113.9');
    expect(getPeerAddress(req)).toBe('198.51.100.4');
  });

  /**
   * @source docs:api/security.md#reading-the-client-address-yourself
   */
  it('RateLimitMiddleware — keyGenerator falling back to getClientAddress', async () => {
    const store = new MemoryRateLimitStore();
    const configuredClass = RateLimitMiddleware.configure({
      max: 1,
      windowMs: 60_000,
      store,
      keyGenerator: (req) => req.headers.get('x-api-key') ?? getClientAddress(req) ?? 'unknown',
    });
    const mw = new configuredClass();

    const keyed = new Request('http://localhost/', {
      headers: new Headers([['x-api-key', 'key-a']]),
    }) as unknown as OneBunRequest;
    const other = new Request('http://localhost/', {
      headers: new Headers([['x-api-key', 'key-b']]),
    }) as unknown as OneBunRequest;

    expect((await mw.use(keyed, async () => new Response('ok'))).status).toBe(200);
    expect((await mw.use(keyed, async () => new Response('ok'))).status).toBe(429);
    // A different API key is a different bucket.
    expect((await mw.use(other, async () => new Response('ok'))).status).toBe(200);
  });

  it('SecurityHeadersMiddleware — sets X-Frame-Options', async () => {
    const mw = new SecurityHeadersMiddleware();
    const req = new Request('http://localhost/') as unknown as OneBunRequest;

    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('SecurityHeadersMiddleware — disabled header is absent', async () => {
    const mw = new SecurityHeadersMiddleware({ strictTransportSecurity: false });
    const req = new Request('http://localhost/') as unknown as OneBunRequest;

    const res = await mw.use(req, async () => new Response('ok'));

    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  });
});

// ============================================================================
// docs/api/queue.md — Type-safe queue adapter configuration
// ============================================================================
describe('docs/api/queue.md — type-safe adapter options', () => {
  // Minimal custom adapter for type-checking purposes
  interface CustomAdapterOptions {
    servers: string;
    streams?: Array<{ name: string; subjects: string[] }>;
  }

  class CustomAdapter implements QueueAdapter {
    static connectCount = 0;
    static published: Array<{ pattern: string; data: unknown }> = [];

    readonly name = 'custom';
    readonly type = 'jetstream' as const;
    private connected = false;
    constructor(private opts: CustomAdapterOptions) {}
    async connect() {
      CustomAdapter.connectCount++;
      this.connected = true;
    }
    async disconnect() {
      this.connected = false;
    }
    isConnected() {
      return this.connected;
    }
    async publish(pattern: string, data: unknown) {
      CustomAdapter.published.push({ pattern, data });

      return 'custom-id';
    }
    async publishBatch() {
      return []; 
    }
    async subscribe() {
      return {
        async unsubscribe() { /* noop */ },
        pause() { /* noop */ },
        resume() { /* noop */ },
        pattern: '',
        isActive: true,
      };
    }
    supports() {
      return false; 
    }
    on() { /* noop */ }
    off() { /* noop */ }
  }

  it('QueueApplicationOptions infers options type from adapter constructor', () => {
    // When adapter is a specific class, options should be typed as its constructor argument
    const queueOpts: QueueApplicationOptions<typeof CustomAdapter> = {
      adapter: CustomAdapter,
      options: {
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
      },
    };

    expect(queueOpts.adapter).toBe(CustomAdapter);
    expect(queueOpts.options?.servers).toBe('nats://localhost:4222');
  });

  it('QueueApplicationOptions works with string adapter type (backward compatibility)', () => {
    const queueOpts: QueueApplicationOptions = {
      adapter: 'memory',
      enabled: true,
    };

    expect(queueOpts.adapter).toBe('memory');
  });

  it('QueueAdapterConstructor is compatible with custom adapter classes', () => {
    // Verify that a custom adapter class satisfies QueueAdapterConstructor
    const ctor: QueueAdapterConstructor<CustomAdapterOptions> = CustomAdapter;
    const instance = new ctor({ servers: 'nats://localhost:4222' });

    expect(instance.name).toBe('custom');
    expect(instance.type).toBe('jetstream');
  });

  it('OneBunApplication accepts typed adapter options without type assertion', () => {
    // This is the main desired usage — no `as SomeOptions` needed
    @Module({ controllers: [] })
    class TestModule {}

    const app = new OneBunApplication(TestModule, {
      loggerLayer: makeMockLoggerLayer(),
      queue: {
        adapter: CustomAdapter,
        options: {
          servers: 'nats://localhost:4222',
          streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
        },
      },
    });

    expect(app).toBeDefined();
  });

  /**
   * @source docs:api/queue.md#queueapplicationoptions
   */
  it('a producer-only app enables the queue from the adapter config alone and publishes through it', async () => {
    // The documented producer-only configuration: an adapter is configured, no controller
    // carries a queue decorator, and `enabled` is not set. Asserted on observable behaviour
    // — the adapter is connected and the payload reaches it — not on the app merely booting.
    @Module({ controllers: [] })
    class ProducerOnlyDocsModule {}

    CustomAdapter.connectCount = 0;
    CustomAdapter.published = [];

    const app = new OneBunApplication(ProducerOnlyDocsModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer(),
      queue: {
        adapter: CustomAdapter,
        options: {
          servers: 'nats://localhost:4222',
          streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
        },
      },
    });

    await app.start();

    const queueService = app.getQueueService();
    expect(queueService).not.toBeNull();
    expect(CustomAdapter.connectCount).toBe(1);

    await queueService!.publish('events.created', { id: 'e-1' });

    expect(CustomAdapter.published).toHaveLength(1);
    expect(CustomAdapter.published[0].pattern).toBe('events.created');
    expect(CustomAdapter.published[0].data).toEqual({ id: 'e-1' });

    await app.stop();
  });
});

/**
 * @source docs:api/services.md#dependency-resolution-errors
 */
describe('Dependency Resolution Errors (docs/api/services.md)', () => {
  const mockLoggerLayer = makeMockLoggerLayer();

  it('should throw DependencyResolutionError for missing required dependency', () => {
    @Service()
    class CacheService extends BaseService {}

    @Service()
    class UserService extends BaseService {}

    registerDependencies(UserService, [CacheService]);

    @Module({
      providers: [UserService], // CacheService NOT provided
    })
    class UserModule {}

    expect(() => new OneBunModule(UserModule, mockLoggerLayer)).toThrow(DependencyResolutionError);
  });

  it('should throw CircularDependencyError for circular dependencies', () => {
    @Service()
    class ServiceA extends BaseService {}

    @Service()
    class ServiceB extends BaseService {}

    registerDependencies(ServiceA, [ServiceB]);
    registerDependencies(ServiceB, [ServiceA]);

    @Module({
      providers: [ServiceA, ServiceB],
    })
    class CircularModule {}

    expect(() => new OneBunModule(CircularModule, mockLoggerLayer)).toThrow(CircularDependencyError);
  });
});

/**
 * @source docs:api/decorators.md#optional
 */
describe('@Optional() decorator (docs/api/decorators.md)', () => {
  const mockLoggerLayer = makeMockLoggerLayer();

  it('should allow optional dependency to be undefined', () => {
    // From docs: the NotificationService example — a required dependency plus an
    // @Optional() one it degrades gracefully without.
    @Service()
    class EmailService extends BaseService {
      readonly sent: string[] = [];

      send(userId: string, message: string): void {
        this.sent.push(`${userId}:${message}`);
      }
    }

    @Service()
    class NotificationService extends BaseService {
      constructor(readonly emailService?: EmailService) {
        super();
      }

      notify(userId: string, message: string): string {
        if (this.emailService) {
          this.emailService.send(userId, message);

          return 'emailed';
        }

        this.logger.warn('EmailService not available, skipping email notification');

        return 'skipped';
      }
    }

    registerDependencies(NotificationService, [EmailService]);
    Optional()(NotificationService, undefined, 0);

    @Module({
      providers: [NotificationService], // EmailService NOT provided
    })
    class NotifModule {}

    // "When the dependency cannot be resolved, `undefined` is injected instead of throwing
    // DependencyResolutionError" — and the service is still built and usable.
    const mod = new OneBunModule(NotifModule, mockLoggerLayer);
    const withoutEmail = mod.getServiceByClass(NotificationService) as NotificationService;

    expect(withoutEmail).toBeInstanceOf(NotificationService);
    expect(withoutEmail.emailService).toBeUndefined();
    expect(withoutEmail.notify('u-1', 'hi')).toBe('skipped');

    // ...while the same parameter still receives the real service once it IS provided:
    // @Optional() relaxes resolution, it does not disable injection.
    @Module({
      providers: [NotificationService, EmailService],
    })
    class FullNotifModule {}

    const full = new OneBunModule(FullNotifModule, mockLoggerLayer);
    const withEmail = full.getServiceByClass(NotificationService) as NotificationService;

    expect(withEmail.emailService).toBeInstanceOf(EmailService);
    expect(withEmail.notify('u-2', 'hello')).toBe('emailed');
    expect(withEmail.emailService!.sent).toEqual(['u-2:hello']);
  });
});

/**
 * @source docs:api/core.md#service-identity
 */
describe('Service identity (docs/api/core.md)', () => {
  const appOptions = { port: 0, metrics: { enabled: false }, gracefulShutdown: false } as const;
  const FIRST_WIDGET = Symbol('first-widget');
  const SECOND_WIDGET = Symbol('second-widget');

  it('refuses getService(Class) and getLayer() when one class has two instances', async () => {
    @Service()
    class Widget extends BaseService {}

    @Module({ providers: [Widget], exports: [Widget] })
    class FirstModule {}

    @Module({ providers: [Widget], exports: [Widget] })
    class SecondModule {}

    @Module({ imports: [FirstModule, SecondModule] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      // From docs: "there is no correct answer, so app.getService(...) throws rather than
      // choosing" and "a Context has exactly one slot per key".
      expect(() => app.getService(Widget)).toThrow(/instances of Widget/);
      expect(() => app.getLayer()).toThrow(/one slot per service class/);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/core.md#service-identity
   */
  it('builds the layer once the caller names which instance takes the slot', async () => {
    // From docs: "getLayer() accepts [ServiceClass, token] pairs, the layer counterpart of
    // getService(Class, token)" — the refusal above is a question, not a dead end.
    @Service()
    class Widget extends BaseService {
      marker = 'unset';
    }

    const first = registerModule(class FirstBase {}, { id: 'first' }, FIRST_WIDGET, [Widget]);
    const second = registerModule(class SecondBase {}, { id: 'second' }, SECOND_WIDGET, [Widget]);

    @Module({ imports: [second] })
    class FeatureModule {}

    @Module({ imports: [first, FeatureModule] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      app.getService(Widget, FIRST_WIDGET).marker = 'first';
      app.getService(Widget, SECOND_WIDGET).marker = 'second';

      const provided = Effect.runSync(
        Effect.provide(
          getServiceTag(Widget),
          app.getLayer([[Widget, SECOND_WIDGET]]) as unknown as Layer.Layer<never, never, never>,
        ) as unknown as Effect.Effect<{ marker: string }, never, never>,
      );

      // Not "whichever was merged last": the selection decides.
      expect(provided.marker).toBe('second');
      // And an unnamed ambiguity is still refused.
      expect(() => app.getLayer()).toThrow(/one slot per service class/);
    } finally {
      await app.stop();
      resetRegistrations();
    }
  });

  it('leaves an ordinary application answering both', async () => {
    @Service()
    class Gadget extends BaseService {}

    @Module({ providers: [Gadget] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      expect(app.getService(Gadget)).toBeInstanceOf(Gadget);
      expect(app.getLayer()).toBeDefined();
    } finally {
      await app.stop();
    }
  });
});
