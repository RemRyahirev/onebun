/**
 * Documentation Examples Tests for @onebun/core
 *
 * This file tests code examples from:
 * - packages/core/README.md
 * - docs/api/core.md
 * - docs/api/controllers.md
 * - docs/api/decorators.md
 * - docs/api/services.md
 * - docs/api/validation.md
 * - docs/api/websocket.md
 * - docs/examples/basic-app.md
 * - docs/examples/crud-api.md
 * - docs/examples/websocket-chat.md
 */

import { type } from 'arktype';
import {
  describe,
  it,
  expect,
} from 'bun:test';

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
import type { SseEvent, SseGenerator } from './types';
import type { ServerWebSocket } from 'bun';


/**
 * @source docs/index.md#minimal-working-example
 */
describe('Minimal Working Example (docs/index.md)', () => {
  it('should define complete counter application in single block', () => {
    // From docs/README.md: Minimal Working Example
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
        _req: Request,
        next: () => Promise<Response>,
      ): Promise<Response> {
        // eslint-disable-next-line no-console
        console.log('Request received');

        return next();
      }

      function authMiddleware(
        req: Request,
        next: () => Promise<Response>,
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
        req: Request,
        next: () => Promise<Response>,
      ) => {
        const token = req.headers.get('Authorization');
        if (!token) {
          return new Response('Unauthorized', { status: 401 });
        }

        return await next();
      };

      const logMiddleware = async (
        _req: Request,
        next: () => Promise<Response>,
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
     * @source docs/api/controllers.md#text
     */
    it('should have text() method', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Get('/health')
        async health(): Promise<Response> {
          // From docs: text() example
          return this.text('OK');
        }
      }

      expect(TestController).toBeDefined();
    });
  });

  describe('Request Helpers (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#isjson
     */
    it('should have isJson() method', () => {
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

      expect(TestController).toBeDefined();
      // Verify isJson method exists on prototype
      const controller = new TestController();
      expect(typeof controller['isJson']).toBe('function');
    });

    /**
     * @source docs/api/controllers.md#parsejson
     */
    it('should have parseJson() method', () => {
      interface CreateUserDto {
        name: string;
        email: string;
      }

      @Controller('/test')
      class TestController extends BaseController {
        @Post('/')
        async create(@Req() req: Request): Promise<Response> {
          // From docs: parseJson() example
          const body = await this.parseJson<CreateUserDto>(req);

          return this.success(body);
        }
      }

      expect(TestController).toBeDefined();
      // Verify parseJson method exists on prototype
      const controller = new TestController();
      expect(typeof controller['parseJson']).toBe('function');
    });
  });

  describe('Accessing Services (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#via-getservice-legacy
     */
    it('should have getService() method', () => {
      @Service()
      class UserService extends BaseService {
        findAll() {
          return [];
        }
      }

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        async findAll(): Promise<Response> {
          // From docs: getService() example
          const userService = this.getService(UserService);
          const users = userService.findAll();

          return this.success(users);
        }
      }

      expect(UserController).toBeDefined();
      // Verify getService method exists on prototype
      const controller = new UserController();
      expect(typeof controller['getService']).toBe('function');
    });
  });

  describe('Accessing Logger (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#accessing-logger
     */
    it('should have access to logger', () => {
      @Controller('/users')
      class UserController extends BaseController {
        @Get('/')
        async findAll(): Promise<Response> {
          // From docs: Accessing Logger example
          // Log levels: trace, debug, info, warn, error, fatal
          this.logger.info('Finding all users');
          this.logger.debug('Request received', { timestamp: Date.now() });

          return this.success([]);
        }
      }

      expect(UserController).toBeDefined();
    });
  });

  describe('Accessing Configuration (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#accessing-configuration
     */
    it('should have access to config', () => {
      @Controller('/users')
      class UserController extends BaseController {
        @Get('/info')
        async info(): Promise<Response> {
          // From docs: Accessing Configuration example
          // Note: config is typed as unknown, needs casting
          const configAvailable = this.config !== null;

          return this.success({ configAvailable });
        }
      }

      expect(UserController).toBeDefined();
    });
  });

  describe('HTTP Status Codes (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#http-status-codes
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
     * @source docs/api/controllers.md#available-status-codes
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
        // Logger and config are auto-injected via initializeService()
        constructor(private repository: UserRepository) {
          super();
        }
      }

      expect(UserService).toBeDefined();
    });
  });

  describe('getServiceTag (docs/api/services.md)', () => {
    /**
     * @source docs/api/services.md#service-tags-advanced
     */
    it('should get service tag from class', () => {
      @Service()
      class MyService extends BaseService {}

      const tag = getServiceTag(MyService);
      expect(tag).toBeDefined();
    });
  });

  describe('BaseService Methods (docs/api/services.md)', () => {
    /**
     * @source docs/api/services.md#class-definition
     */
    it('should have runEffect method', () => {
      // From docs: BaseService has runEffect method for Effect.js integration
      // Note: Cannot instantiate service without OneBunApplication context
      // Check prototype instead
      expect(typeof BaseService.prototype['runEffect']).toBe('function');
    });

    /**
     * @source docs/api/services.md#class-definition
     */
    it('should have formatError method', () => {
      // From docs: BaseService has formatError method
      // Note: Cannot instantiate service without OneBunApplication context
      // Check prototype instead
      expect(typeof BaseService.prototype['formatError']).toBe('function');
    });
  });

  describe('Service Logger (docs/api/services.md)', () => {
    /**
     * @source docs/api/services.md#log-levels
     */
    it('should support all log levels', () => {
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

      expect(EmailService).toBeDefined();
    });
  });
});

describe('Lifecycle Hooks API Documentation Examples (docs/api/services.md)', () => {
  describe('OnModuleInit Interface', () => {
    /**
     * @source docs/api/services.md#lifecycle-hooks
     */
    it('should implement OnModuleInit interface', () => {
      // From docs: OnModuleInit example
      @Service()
      class DatabaseService extends BaseService implements OnModuleInit {
        private connection: unknown = null;

        async onModuleInit(): Promise<void> {
          // Called after service instantiation and DI
          this.connection = { connected: true };
          this.logger.info('Database connected');
        }

        isConnected(): boolean {
          return this.connection !== null;
        }
      }

      expect(DatabaseService).toBeDefined();
      // Verify method exists
      const service = new DatabaseService();
      expect(typeof service.onModuleInit).toBe('function');
    });
  });

  describe('OnApplicationInit Interface', () => {
    /**
     * @source docs/api/services.md#lifecycle-hooks
     */
    it('should implement OnApplicationInit interface', () => {
      // From docs: OnApplicationInit example
      @Service()
      class CacheService extends BaseService implements OnApplicationInit {
        async onApplicationInit(): Promise<void> {
          // Called after all modules initialized, before HTTP server starts
          this.logger.info('Warming up cache');
        }
      }

      expect(CacheService).toBeDefined();
      const service = new CacheService();
      expect(typeof service.onApplicationInit).toBe('function');
    });
  });

  describe('OnModuleDestroy Interface', () => {
    /**
     * @source docs/api/services.md#lifecycle-hooks
     */
    it('should implement OnModuleDestroy interface', () => {
      // From docs: OnModuleDestroy example
      @Service()
      class ConnectionService extends BaseService implements OnModuleDestroy {
        async onModuleDestroy(): Promise<void> {
          // Called during shutdown, after HTTP server stops
          this.logger.info('Closing connections');
        }
      }

      expect(ConnectionService).toBeDefined();
      const service = new ConnectionService();
      expect(typeof service.onModuleDestroy).toBe('function');
    });
  });

  describe('BeforeApplicationDestroy Interface', () => {
    /**
     * @source docs/api/services.md#lifecycle-hooks
     */
    it('should implement BeforeApplicationDestroy interface', () => {
      // From docs: BeforeApplicationDestroy example
      @Service()
      class GracefulService extends BaseService implements BeforeApplicationDestroy {
        beforeApplicationDestroy(signal?: string): void {
          // Called at the very start of shutdown
          this.logger.info(`Shutdown initiated by signal: ${signal || 'unknown'}`);
        }
      }

      expect(GracefulService).toBeDefined();
      const service = new GracefulService();
      expect(typeof service.beforeApplicationDestroy).toBe('function');
    });
  });

  describe('OnApplicationDestroy Interface', () => {
    /**
     * @source docs/api/services.md#lifecycle-hooks
     */
    it('should implement OnApplicationDestroy interface', () => {
      // From docs: OnApplicationDestroy example
      @Service()
      class CleanupService extends BaseService implements OnApplicationDestroy {
        async onApplicationDestroy(signal?: string): Promise<void> {
          // Called at the very end of shutdown
          this.logger.info(`Final cleanup, signal: ${signal || 'unknown'}`);
        }
      }

      expect(CleanupService).toBeDefined();
      const service = new CleanupService();
      expect(typeof service.onApplicationDestroy).toBe('function');
    });
  });

  describe('Multiple Lifecycle Hooks', () => {
    /**
     * @source docs/api/services.md#lifecycle-hooks
     */
    it('should implement multiple lifecycle interfaces', () => {
      // From docs: Complete lifecycle example
      @Service()
      class FullLifecycleService extends BaseService 
        implements OnModuleInit, OnApplicationInit, OnModuleDestroy, BeforeApplicationDestroy, OnApplicationDestroy {
        
        async onModuleInit(): Promise<void> {
          this.logger.info('Service initialized');
        }

        async onApplicationInit(): Promise<void> {
          this.logger.info('Application initialized');
        }

        beforeApplicationDestroy(signal?: string): void {
          this.logger.info(`Shutdown starting: ${signal}`);
        }

        async onModuleDestroy(): Promise<void> {
          this.logger.info('Module destroying');
        }

        async onApplicationDestroy(signal?: string): Promise<void> {
          this.logger.info(`Application destroyed: ${signal}`);
        }
      }

      expect(FullLifecycleService).toBeDefined();
      const service = new FullLifecycleService();
      expect(typeof service.onModuleInit).toBe('function');
      expect(typeof service.onApplicationInit).toBe('function');
      expect(typeof service.beforeApplicationDestroy).toBe('function');
      expect(typeof service.onModuleDestroy).toBe('function');
      expect(typeof service.onApplicationDestroy).toBe('function');
    });
  });

  describe('Controller Lifecycle Hooks', () => {
    /**
     * @source docs/api/controllers.md#lifecycle-hooks
     */
    it('should implement lifecycle hooks in controllers', () => {
      // From docs: Controller lifecycle hooks example
      @Controller('/api')
      class ApiController extends BaseController implements OnModuleInit, OnModuleDestroy {
        async onModuleInit(): Promise<void> {
          this.logger.info('Controller initialized');
        }

        async onModuleDestroy(): Promise<void> {
          this.logger.info('Controller destroying');
        }

        @Get('/test')
        test(): Response {
          return this.success({ message: 'test' });
        }
      }

      expect(ApiController).toBeDefined();
      const controller = new ApiController();
      expect(typeof controller.onModuleInit).toBe('function');
      expect(typeof controller.onModuleDestroy).toBe('function');
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
     * @source docs/api/services.md#lifecycle-hooks
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
     * @source docs/api/services.md#lifecycle-hooks
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
  });
});

describe('getService API Documentation Examples (docs/api/core.md)', () => {
  /**
   * @source docs/api/core.md#accessing-services-outside-of-requests
   */
  it('should have getService method on OneBunApplication', () => {
    @Module({ controllers: [] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, {
      loggerLayer: makeMockLoggerLayer(),
    });

    expect(typeof app.getService).toBe('function');
  });

  /**
   * @source docs/api/core.md#accessing-services-outside-of-requests
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
   * @source docs/api/core.md#accessing-services-outside-of-requests
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
     * @source docs/api/validation.md#basic-usage
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
     * @source docs/api/validation.md#basic-usage
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
     * @source docs/api/validation.md#validateorthrow
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

  describe('Schema Types (docs/api/validation.md)', () => {
    /**
     * @source docs/api/validation.md#primitives
     */
    it('should define primitive schemas', () => {
      // From docs: Primitives
      const stringSchema = type('string');
      const numberSchema = type('number');
      const booleanSchema = type('boolean');

      expect(stringSchema).toBeDefined();
      expect(numberSchema).toBeDefined();
      expect(booleanSchema).toBeDefined();
    });

    /**
     * @source docs/api/validation.md#string-constraints
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
     * @source docs/api/validation.md#number-constraints
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
     * @source docs/api/validation.md#arrays
     */
    it('should define array schemas', () => {
      // From docs: Arrays
      const stringArraySchema = type('string[]');

      expect(stringArraySchema).toBeDefined();

      const result = validate(stringArraySchema, ['a', 'b', 'c']);
      expect(result.success).toBe(true);
    });

    /**
     * @source docs/api/validation.md#objects
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
     * @source docs/api/validation.md#using-in-controllers
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
     * @source docs/api/validation.md#create-update-dtos-pattern
     */
    it('should define create/update DTOs', () => {
      // From docs: Create/Update DTOs pattern
      const createUserSchema = type({
        name: 'string',
        email: 'string.email',
        password: 'string',
      });

      /* eslint-disable @typescript-eslint/naming-convention */
      const updateUserSchema = type({
        'name?': 'string',
        'email?': 'string.email',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      expect(createUserSchema).toBeDefined();
      expect(updateUserSchema).toBeDefined();
    });

    /**
     * @source docs/api/validation.md#pagination-schema
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
  it('should create service definition from module class', () => {
    // From docs: createServiceDefinition expects a module class decorated with @Module
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

    expect(UsersServiceDefinition).toBeDefined();
    expect(UsersServiceDefinition._endpoints).toBeDefined();
    expect(UsersServiceDefinition._controllers).toBeDefined();
  });

  it('should create service client from definition', () => {
    @Controller('/users')
    class UsersController extends BaseController {
      @Get('/')
      findAll() {
        return [];
      }
    }

    @Module({
      controllers: [UsersController],
    })
    class UsersModule {}

    const usersDefinition = createServiceDefinition(UsersModule);

    // From docs: Create typed client
    // Note: option is 'url', not 'baseUrl'
    const usersClient = createServiceClient(usersDefinition, {
      url: 'http://users-service:3001',
    });

    expect(usersClient).toBeDefined();
  });
});

describe('OneBunApplication (docs/api/core.md)', () => {
  /**
   * @source docs/api/core.md#onebunapplication
   */
  it('should create application instance', () => {
    @Controller('/api')
    class AppController extends BaseController {
      @Get('/hello')
      hello() {
        return { message: 'Hello' };
      }
    }

    @Module({
      controllers: [AppController],
    })
    class AppModule {}

    // From docs: OneBunApplication constructor
    const app = new OneBunApplication(AppModule, {
      loggerLayer: makeMockLoggerLayer(),
      port: 3000,
      basePath: '/api/v1',
    });

    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
    expect(typeof app.stop).toBe('function');
    expect(typeof app.getConfig).toBe('function');
    expect(typeof app.getLogger).toBe('function');
    expect(typeof app.getHttpUrl).toBe('function');
    expect(typeof app.getLayer).toBe('function');
  });

  /**
   * @source docs/api/core.md#applicationoptions
   */
  it('should accept full application options', () => {
    @Module({ controllers: [] })
    class AppModule {}

    // From docs: ApplicationOptions interface
    const options = {
      name: 'my-app',
      port: 3000,
      host: '0.0.0.0',
      basePath: '/api/v1',
      routePrefix: 'myservice',
      development: true,
      loggerLayer: makeMockLoggerLayer(),
      metrics: {
        enabled: true,
        path: '/metrics',
        prefix: 'myapp_',
        collectHttpMetrics: true,
        collectSystemMetrics: true,
        collectGcMetrics: true,
      },
      tracing: {
        enabled: true,
        serviceName: 'my-service',
        samplingRate: 1.0,
      },
    };

    const app = new OneBunApplication(AppModule, options);
    expect(app).toBeDefined();
  });

  /**
   * @source docs/api/core.md#metrics-options
   */
  it('should accept metrics configuration', () => {
    @Module({ controllers: [] })
    class AppModule {}

    // From docs: MetricsOptions interface
    const metricsOptions = {
      enabled: true,
      path: '/metrics',
      defaultLabels: { service: 'my-service', environment: 'development' },
      collectHttpMetrics: true,
      collectSystemMetrics: true,
      collectGcMetrics: true,
      systemMetricsInterval: 5000,
      prefix: 'onebun_',
      httpDurationBuckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    };

    const app = new OneBunApplication(AppModule, { metrics: metricsOptions, loggerLayer: makeMockLoggerLayer() });
    expect(app).toBeDefined();
  });

  /**
   * @source docs/api/core.md#tracing-options
   */
  it('should accept tracing configuration', () => {
    @Module({ controllers: [] })
    class AppModule {}

    // From docs: TracingOptions interface
    /* eslint-disable @typescript-eslint/naming-convention */
    const tracingOptions = {
      enabled: true,
      serviceName: 'my-service',
      serviceVersion: '1.0.0',
      samplingRate: 1.0,
      traceHttpRequests: true,
      traceDatabaseQueries: true,
      defaultAttributes: { 'deployment.environment': 'production' },
      exportOptions: {
        endpoint: 'http://localhost:4318/v1/traces',
        headers: { Authorization: 'Bearer token' },
        timeout: 30000,
        batchSize: 100,
        batchTimeout: 5000,
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    const app = new OneBunApplication(AppModule, { tracing: tracingOptions, loggerLayer: makeMockLoggerLayer() });
    expect(app).toBeDefined();
  });
});

describe('MultiServiceApplication (docs/api/core.md)', () => {
  /**
   * @source docs/api/core.md#multiserviceapplication
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
   * @source docs/api/core.md#usage-example-1
   */
  it('should create MultiServiceApplication with service config', () => {
    @Module({ controllers: [] })
    class UsersModule {}

    @Module({ controllers: [] })
    class OrdersModule {}

    // From docs: MultiServiceApplication usage example
    // Note: routePrefix is boolean (true = use service name as prefix)
    const multiApp = new MultiServiceApplication({
      services: {
        users: {
          module: UsersModule,
          port: 3001,
          routePrefix: true, // Uses 'users' as route prefix
        },
        orders: {
          module: OrdersModule,
          port: 3002,
          routePrefix: true, // Uses 'orders' as route prefix
          envOverrides: {
            DB_NAME: { value: 'orders_db' },
          },
        },
      },
      enabledServices: ['users', 'orders'],
    });

    expect(multiApp).toBeDefined();
    expect(typeof multiApp.start).toBe('function');
    expect(typeof multiApp.stop).toBe('function');
    expect(typeof multiApp.getRunningServices).toBe('function');
  });
});

// ============================================================================
// docs/examples Tests
// ============================================================================

describe('Basic App Example (docs/examples/basic-app.md)', () => {
  /**
   * @source docs/examples/basic-app.md#srcconfigts
   */
  it('should define environment schema', () => {
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

    expect(envSchema.server.port).toBeDefined();
    expect(envSchema.server.host).toBeDefined();
    expect(envSchema.app.name).toBeDefined();
    expect(envSchema.app.debug).toBeDefined();
  });

  /**
   * @source docs/examples/basic-app.md#srchelloservicets
   */
  it('should define HelloService', () => {
    // From docs: src/hello.service.ts
    @Service()
    class HelloService extends BaseService {
      private greetCount = 0;

      greet(name: string): string {
        this.greetCount++;

        return `Hello, ${name}! You are visitor #${this.greetCount}`;
      }

      sayHello(): string {
        return 'Hello from OneBun!';
      }

      getStats(): { greetCount: number } {
        return { greetCount: this.greetCount };
      }
    }

    expect(HelloService).toBeDefined();
  });

  /**
   * @source docs/examples/basic-app.md#srchellocontrollerts
   */
  it('should define HelloController', () => {
    @Service()
    class HelloService extends BaseService {
      sayHello(): string {
        return 'Hello!';
      }

      greet(name: string): string {
        return `Hello, ${name}!`;
      }

      getStats() {
        return { greetCount: 0 };
      }
    }

    // From docs: src/hello.controller.ts
    @Controller('/api')
    class HelloController extends BaseController {
      constructor(private helloService: HelloService) {
        super();
      }

      @Get('/hello')
      async hello(): Promise<Response> {
        const message = this.helloService.sayHello();

        return this.success({ message });
      }

      @Get('/hello/:name')
      async greet(@Param('name') name: string): Promise<Response> {
        const greeting = this.helloService.greet(name);

        return this.success({ greeting });
      }

      @Get('/stats')
      async stats(): Promise<Response> {
        const stats = this.helloService.getStats();

        return this.success(stats);
      }

      @Get('/health')
      async health(): Promise<Response> {
        return this.success({
          status: 'healthy',
          timestamp: new Date().toISOString(),
        });
      }
    }

    expect(HelloController).toBeDefined();
  });

  /**
   * @source docs/examples/basic-app.md#srcappmodulets
   */
  it('should define AppModule', () => {
    @Service()
    class HelloService extends BaseService {}

    @Controller('/api')
    class HelloController extends BaseController {
      constructor(private helloService: HelloService) {
        super();
      }
    }

    // From docs: src/app.module.ts
    @Module({
      controllers: [HelloController],
      providers: [HelloService],
    })
    class AppModule {}

    expect(AppModule).toBeDefined();
  });
});

describe('CRUD API Example (docs/examples/crud-api.md)', () => {
  /**
   * @source docs/examples/crud-api.md#srcusersschemasuserschemats
   */
  it('should define user schemas with validation', () => {
    // From docs: src/users/schemas/user.schema.ts
    /* eslint-disable @typescript-eslint/naming-convention */
    const createUserSchema = type({
      name: 'string',
      email: 'string.email',
      'age?': 'number >= 0',
    });

    const updateUserSchema = type({
      'name?': 'string',
      'email?': 'string.email',
      'age?': 'number >= 0',
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    expect(createUserSchema).toBeDefined();
    expect(updateUserSchema).toBeDefined();

    // Validate
    const result = validate(createUserSchema, {
      name: 'John',
      email: 'john@example.com',
    });
    expect(result.success).toBe(true);
  });

  /**
   * @source docs/examples/crud-api.md#srcusersusersservicets
   */
  it('should define UsersService', () => {
    // From docs: src/users/users.service.ts
    @Service()
    class UsersRepository extends BaseService {
      private users: Array<{ id: string; name: string; email: string }> = [];

      findAll() {
        return this.users;
      }

      findById(id: string) {
        return this.users.find((u) => u.id === id) || null;
      }

      create(data: { name: string; email: string }) {
        const user = { id: Date.now().toString(), ...data };
        this.users.push(user);

        return user;
      }

      update(id: string, data: Partial<{ name: string; email: string }>) {
        const index = this.users.findIndex((u) => u.id === id);
        if (index === -1) {
          return null;
        }
        this.users[index] = { ...this.users[index], ...data };

        return this.users[index];
      }

      delete(id: string): boolean {
        const index = this.users.findIndex((u) => u.id === id);
        if (index === -1) {
          return false;
        }
        this.users.splice(index, 1);

        return true;
      }
    }

    @Service()
    class UsersService extends BaseService {
      constructor(private repository: UsersRepository) {
        super();
      }

      async findAll() {
        return this.repository.findAll();
      }

      async findById(id: string) {
        return this.repository.findById(id);
      }

      async create(data: { name: string; email: string }) {
        return this.repository.create(data);
      }
    }

    expect(UsersService).toBeDefined();
  });

  /**
   * @source docs/examples/crud-api.md#srcusersuserscontrollerts
   */
  it('should define UsersController with CRUD endpoints', () => {
    @Service()
    class UsersService extends BaseService {
      findAll() {
        return [];
      }

      findById(id: string) {
        return { id };
      }

      create(data: unknown) {
        return { id: '1', ...data as object };
      }

      update(id: string, data: unknown) {
        return { id, ...data as object };
      }

      delete(_id: string) {
        return true;
      }
    }

    // From docs: src/users/users.controller.ts
    @Controller('/api/users')
    class UsersController extends BaseController {
      constructor(private usersService: UsersService) {
        super();
      }

      @Get('/')
      async findAll(): Promise<Response> {
        const users = await this.usersService.findAll();

        return this.success(users);
      }

      @Get('/:id')
      async findOne(@Param('id') id: string): Promise<Response> {
        const user = await this.usersService.findById(id);
        if (!user) {
          return this.error('User not found', 404, 404);
        }

        return this.success(user);
      }

      @Post('/')
      async create(@Body() body: unknown): Promise<Response> {
        const user = await this.usersService.create(body);

        return this.success(user, 201);
      }

      @Put('/:id')
      async update(
        @Param('id') id: string,
        @Body() body: unknown,
      ): Promise<Response> {
        const user = await this.usersService.update(id, body);
        if (!user) {
          return this.error('User not found', 404, 404);
        }

        return this.success(user);
      }

      @Delete('/:id')
      async remove(@Param('id') id: string): Promise<Response> {
        const deleted = await this.usersService.delete(id);
        if (!deleted) {
          return this.error('User not found', 404, 404);
        }

        return this.success({ deleted: true });
      }
    }

    expect(UsersController).toBeDefined();
  });

  /**
   * @source docs/examples/crud-api.md#srcusersusersmodulets
   */
  it('should define UsersModule', () => {
    @Service()
    class UsersRepository extends BaseService {}

    @Service()
    class UsersService extends BaseService {}

    @Controller('/api/users')
    class UsersController extends BaseController {}

    // From docs: src/users/users.module.ts
    @Module({
      controllers: [UsersController],
      providers: [UsersService, UsersRepository],
      exports: [UsersService],
    })
    class UsersModule {}

    expect(UsersModule).toBeDefined();
  });
});

describe('Multi-Service Example (docs/examples/multi-service.md)', () => {
  /**
   * @source docs/examples/multi-service.md#srcusersusersmodulets
   */
  it('should define Users service module', () => {
    @Service()
    class UsersService extends BaseService {
      findById(id: string) {
        return { id, name: 'John' };
      }
    }

    @Controller('/users')
    class UsersController extends BaseController {
      constructor(private usersService: UsersService) {
        super();
      }

      @Get('/:id')
      async findOne(@Param('id') id: string): Promise<Response> {
        const user = this.usersService.findById(id);

        return this.success(user);
      }
    }

    @Module({
      controllers: [UsersController],
      providers: [UsersService],
      exports: [UsersService],
    })
    class UsersModule {}

    expect(UsersModule).toBeDefined();
  });

  /**
   * @source docs/examples/multi-service.md#srcordersordersmodulets
   */
  it('should define Orders service module', () => {
    @Service()
    class OrdersService extends BaseService {
      create(data: unknown) {
        return { id: '1', ...data as object };
      }
    }

    @Controller('/orders')
    class OrdersController extends BaseController {
      constructor(private ordersService: OrdersService) {
        super();
      }

      @Post('/')
      async create(@Body() body: unknown): Promise<Response> {
        const order = this.ordersService.create(body);

        return this.success(order, 201);
      }
    }

    @Module({
      controllers: [OrdersController],
      providers: [OrdersService],
    })
    class OrdersModule {}

    expect(OrdersModule).toBeDefined();
  });

  /**
   * @source docs/examples/multi-service.md#srcindexts
   */
  it('should define MultiServiceApplication configuration', () => {
    @Module({ controllers: [] })
    class UsersModule {}

    @Module({ controllers: [] })
    class OrdersModule {}

    // From docs: src/index.ts
    // Note: routePrefix is boolean (true = use service name as prefix)
    const multiApp = new MultiServiceApplication({
      services: {
        users: {
          module: UsersModule,
          port: 3001,
          routePrefix: true, // Uses 'users' as route prefix
        },
        orders: {
          module: OrdersModule,
          port: 3002,
          routePrefix: true, // Uses 'orders' as route prefix
        },
      },
      enabledServices: ['users', 'orders'],
    });

    expect(multiApp).toBeDefined();
    expect(typeof multiApp.start).toBe('function');
    expect(typeof multiApp.stop).toBe('function');
  });
});

// ============================================================================
// Architecture & Getting Started Tests
// ============================================================================

describe('Architecture Documentation (docs/architecture.md)', () => {
  describe('DI Resolution Flow (docs/architecture.md)', () => {
    /**
     * @source docs/architecture.md#di-resolution-flow
     */
    it('should demonstrate DI resolution flow', () => {
      // From docs: DI Resolution Flow example
      // 1. Service is decorated
      @Service()
      class CacheService extends BaseService {
        get(_key: string) {
          return null;
        }
      }

      @Service()
      class UserService extends BaseService {
        constructor(private cacheService: CacheService) {
          super();
        }
      }

      // 2. Module declares dependencies
      @Controller('/users')
      class UserController extends BaseController {
        constructor(private userService: UserService) {
          super();
        }
      }

      @Module({
        providers: [CacheService, UserService],
        controllers: [UserController],
      })
      class UserModule {}

      expect(UserModule).toBeDefined();
    });

    /**
     * @source docs/architecture.md#automatic-injection
     */
    it('should demonstrate automatic DI without @Inject', () => {
      // From docs: Automatic DI example
      // TypeScript's emitDecoratorMetadata provides type info automatically
      @Service()
      class UserService extends BaseService {}

      @Service()
      class CacheService extends BaseService {}

      // No @Inject needed - automatic DI works via emitDecoratorMetadata
      // @Inject is only needed for: interfaces, abstract classes, token-based injection
      @Controller('/users')
      class UserController extends BaseController {
        constructor(
          private userService: UserService,
          private cache: CacheService,
        ) {
          super();
        }
      }

      expect(UserController).toBeDefined();
    });
  });

  describe('Module System (docs/architecture.md)', () => {
    /**
     * @source docs/architecture.md#module-assembly
     */
    it('should demonstrate module export/import pattern', () => {
      // From docs: Module Assembly
      @Service()
      class SharedService extends BaseService {}

      // Module that exports services
      @Module({
        providers: [SharedService],
        exports: [SharedService],
      })
      class SharedModule {}

      // Module that imports services
      @Controller('/api')
      class ApiController extends BaseController {}

      @Module({
        imports: [SharedModule],
        controllers: [ApiController],
      })
      class ApiModule {}

      expect(SharedModule).toBeDefined();
      expect(ApiModule).toBeDefined();
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
  });
});

describe('Getting Started Documentation (docs/getting-started.md)', () => {
  describe('Environment Schema (docs/getting-started.md)', () => {
    /**
     * @source docs/getting-started.md#step-3-create-environment-schema
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
     * @source docs/getting-started.md#step-4-create-a-service
     */
    it('should create service with logger access', () => {
      // From docs: src/hello.service.ts
      @Service()
      class HelloService extends BaseService {
        private greetCount = 0;

        greet(name: string): string {
          this.greetCount++;

          return `Hello, ${name}! You are visitor #${this.greetCount}`;
        }

        getCount(): number {
          return this.greetCount;
        }
      }

      expect(HelloService).toBeDefined();
    });
  });

  describe('Controller Creation (docs/getting-started.md)', () => {
    /**
     * @source docs/getting-started.md#step-5-create-a-controller
     */
    it('should create controller with validation schema', () => {
      // From docs: Validation schema
      /* eslint-disable @typescript-eslint/naming-convention */
      const greetBodySchema = type({
        name: 'string',
        'message?': 'string',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      @Service()
      class HelloService extends BaseService {
        greet(name: string) {
          return `Hello, ${name}!`;
        }
      }

      // From docs: src/hello.controller.ts
      @Controller('/api/hello')
      class HelloController extends BaseController {
        constructor(private helloService: HelloService) {
          super();
        }

        @Get('/')
        async hello(): Promise<Response> {
          return this.success({ message: 'Hello, World!' });
        }

        @Get('/:name')
        async greet(@Param('name') name: string): Promise<Response> {
          const greeting = this.helloService.greet(name);

          return this.success({ greeting });
        }

        @Post('/greet')
        async greetPost(@Body() body: typeof greetBodySchema.infer): Promise<Response> {
          const greeting = this.helloService.greet(body.name);

          return this.success({ greeting, customMessage: body.message });
        }
      }

      expect(HelloController).toBeDefined();
      expect(greetBodySchema).toBeDefined();
    });
  });

  describe('Module Definition (docs/getting-started.md)', () => {
    /**
     * @source docs/getting-started.md#step-6-create-the-module
     */
    it('should create module with controllers and providers', () => {
      @Service()
      class HelloService extends BaseService {}

      @Controller('/api/hello')
      class HelloController extends BaseController {}

      // From docs: src/app.module.ts
      @Module({
        controllers: [HelloController],
        providers: [HelloService],
      })
      class AppModule {}

      expect(AppModule).toBeDefined();
    });
  });

  describe('Application Entry Point (docs/getting-started.md)', () => {
    /**
     * @source docs/getting-started.md#step-7-create-entry-point
     */
    it('should create OneBunApplication with all options', () => {
      @Module({ controllers: [] })
      class AppModule {}

      const envSchema = {
        server: {
          port: Env.number({ default: 3000, env: 'PORT' }),
          host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
        },
      };

      // From docs: src/index.ts
      const app = new OneBunApplication(AppModule, {
        envSchema,
        envOptions: {
          loadDotEnv: true,
          envFilePath: '.env',
        },
        loggerLayer: makeMockLoggerLayer(),
        metrics: {
          enabled: true,
          path: '/metrics',
        },
        tracing: {
          enabled: true,
          serviceName: 'my-onebun-app',
        },
      });

      expect(app).toBeDefined();
      expect(typeof app.start).toBe('function');
      expect(typeof app.stop).toBe('function');
      expect(typeof app.getConfig).toBe('function');
      expect(typeof app.getLogger).toBe('function');
    });
  });
});

// ============================================================================
// WebSocket Gateway Documentation Tests
// ============================================================================

describe('WebSocket Gateway API Documentation (docs/api/websocket.md)', () => {
  describe('@WebSocketGateway decorator', () => {
    /**
     * @source docs/api/websocket.md#websocketgateway-decorator
     */
    it('should define gateway with path and namespace', () => {
      // From docs: WebSocketGateway Decorator example
      @WebSocketGateway({ path: '/ws', namespace: 'chat' })
      class ChatGateway extends BaseWebSocketGateway {
        // handlers...
      }

      expect(ChatGateway).toBeDefined();
    });
  });

  describe('Event Decorators', () => {
    /**
     * @source docs/api/websocket.md#onconnect
     */
    it('should handle @OnConnect decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnConnect()
        handleConnect(@Client() client: WsClientData) {
          // eslint-disable-next-line no-console
          console.log(`Client ${client.id} connected`);

          return { event: 'welcome', data: { message: 'Welcome!' } };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#ondisconnect
     */
    it('should handle @OnDisconnect decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnDisconnect()
        handleDisconnect(@Client() client: WsClientData) {
          // eslint-disable-next-line no-console
          console.log(`Client ${client.id} disconnected`);
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#onjoinroom
     */
    it('should handle @OnJoinRoom decorator with pattern', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnJoinRoom('room:{roomId}')
        handleJoinRoom(
          @Client() client: WsClientData,
          @RoomName() room: string,
          @PatternParams() params: { roomId: string },
        ) {
          this.emitToRoom(room, 'user:joined', { userId: client.id });

          return { event: 'joined', data: { roomId: params.roomId } };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#onleaveroom
     */
    it('should handle @OnLeaveRoom decorator with wildcard', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnLeaveRoom('room:*')
        handleLeaveRoom(@Client() client: WsClientData, @RoomName() room: string) {
          this.emitToRoom(room, 'user:left', { userId: client.id });
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#onmessage
     */
    it('should handle @OnMessage decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('chat:message')
        handleMessage(@Client() client: WsClientData, @MessageData() data: { text: string }) {
          this.broadcast('chat:message', { userId: client.id, text: data.text });
        }
      }

      expect(TestGateway).toBeDefined();
    });
  });

  describe('Pattern Syntax', () => {
    /**
     * @source docs/api/websocket.md#pattern-syntax
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
     * @source docs/api/websocket.md#client
     */
    it('should use @Client() decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('ping')
        handlePing(@Client() client: WsClientData) {
          // eslint-disable-next-line no-console
          console.log(`Ping from ${client.id}`);
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#socket
     */
    it('should use @Socket() decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('raw')
        handleRaw(@Socket() socket: ServerWebSocket<WsClientData>) {
          socket.send('raw message');
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#messagedata
     */
    it('should use @MessageData() decorator with property', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        // Full data
        @OnMessage('chat:full')
        handleFull(@MessageData() data: { text: string }) {
          return data;
        }

        // Specific property
        @OnMessage('chat:text')
        handleText(@MessageData('text') text: string) {
          return text;
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#roomname
     */
    it('should use @RoomName() decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnJoinRoom()
        handleJoin(@RoomName() room: string) {
          return { room };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#patternparams
     */
    it('should use @PatternParams() decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('chat:{roomId}:message')
        handleMessage(@PatternParams() params: { roomId: string }) {
          return { roomId: params.roomId };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#wsserver
     */
    it('should use @WsServer() decorator', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @OnMessage('broadcast')
        handleBroadcast(@WsServer() server: WsServerType) {
          server.publish('all', 'Hello everyone!');
        }
      }

      expect(TestGateway).toBeDefined();
    });
  });

  describe('Guards', () => {
    /**
     * @source docs/api/websocket.md#built-in-guards
     */
    it('should use WsAuthGuard', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(WsAuthGuard)
        @OnMessage('protected:*')
        handleProtected(@Client() client: WsClientData) {
          return { userId: client.auth?.userId };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#built-in-guards
     */
    it('should use WsPermissionGuard', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(new WsPermissionGuard('admin'))
        @OnMessage('admin:*')
        handleAdmin(@Client() client: WsClientData) {
          return { admin: true, userId: client.id };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#built-in-guards
     */
    it('should use WsAnyPermissionGuard', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(new WsAnyPermissionGuard(['admin', 'moderator']))
        @OnMessage('manage:*')
        handleManage(@Client() client: WsClientData) {
          return { clientId: client.id };
        }
      }

      expect(TestGateway).toBeDefined();
    });

    /**
     * @source docs/api/websocket.md#custom-guards
     */
    it('should create custom guard', () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const CustomGuard = createGuard((ctx: WsExecutionContext) => {
        return ctx.getClient().metadata.customCheck === true;
      });

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        @UseWsGuards(CustomGuard)
        @OnMessage('custom:*')
        handleCustom(@Client() client: WsClientData) {
          return { clientId: client.id };
        }
      }

      expect(TestGateway).toBeDefined();
      expect(CustomGuard).toBeDefined();
    });
  });

  describe('Storage Adapters', () => {
    /**
     * @source docs/api/websocket.md#in-memory-storage-default
     */
    it('should create in-memory storage', () => {
      const storage = createInMemoryWsStorage();
      expect(storage).toBeDefined();
      expect(typeof storage.addClient).toBe('function');
      expect(typeof storage.removeClient).toBe('function');
      expect(typeof storage.getClient).toBe('function');
    });

    /**
     * @source docs/api/websocket.md#redis-storage
     */
    it('should configure SharedRedisProvider', () => {
      // From docs: Redis Storage example
      // Note: This just tests the API, not actual connection
      expect(typeof SharedRedisProvider.configure).toBe('function');
      expect(typeof SharedRedisProvider.getClient).toBe('function');
    });
  });

  describe('WebSocket Client', () => {
    /**
     * @source docs/api/websocket.md#creating-a-client
     */
    it('should create typed client from definition', () => {
      @WebSocketGateway({ path: '/chat' })
      class ChatGateway extends BaseWebSocketGateway {
        @OnMessage('chat:message')
        handleMessage(@Client() _client: WsClientData, @MessageData() data: { text: string }) {
          return { event: 'received', data };
        }
      }

      @Module({ controllers: [ChatGateway] })
      class ChatModule {}

      const definition = createWsServiceDefinition(ChatModule);
      expect(definition).toBeDefined();
      expect(definition._gateways).toBeDefined();

      // Client creation (without actual connection)
      const client = createWsClient(definition, {
        url: 'ws://localhost:3000',
        auth: { token: 'xxx' },
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 10,
      });

      expect(client).toBeDefined();
      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');
      expect(typeof client.on).toBe('function');
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
     * @source docs/api/websocket.md#standalone-client-no-definition
     */
    it('should create standalone client without definition', () => {
      const client = createNativeWsClient({
        url: 'ws://localhost:3000/chat',
        protocol: 'native',
        auth: { token: 'xxx' },
      });
      expect(client).toBeDefined();
      expect(typeof client.connect).toBe('function');
      expect(typeof client.emit).toBe('function');
      expect(typeof client.send).toBe('function');
      expect(typeof client.on).toBe('function');
    });
  });

  describe('Application Configuration', () => {
    /**
     * @source docs/api/websocket.md#application-options
     */
    it('should accept WebSocket configuration', () => {
      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {}

      @Module({ controllers: [TestGateway] })
      class AppModule {}

      // From docs: Application Options example (native + optional Socket.IO)
      const app = new OneBunApplication(AppModule, {
        port: 3000,
        websocket: {
          enabled: true,
          storage: {
            type: 'memory',
          },
          socketio: {
            enabled: true,
            path: '/socket.io',
            pingInterval: 25000,
            pingTimeout: 20000,
          },
          maxPayload: 1048576,
        },
        loggerLayer: makeMockLoggerLayer(),
      });

      expect(app).toBeDefined();
    });
  });
});

describe('WebSocket Chat Example (docs/examples/websocket-chat.md)', () => {
  describe('Chat Gateway', () => {
    /**
     * @source docs/examples/websocket-chat.md#chat-gateway
     */
    it('should define ChatGateway with all handlers', () => {
      interface ChatMessage {
        text: string;
      }

      // Simplified ChatService for testing
      @Service()
      class ChatService extends BaseService {
        async getMessageHistory(_roomId: string): Promise<unknown[]> {
          return [];
        }

        async saveMessage(data: { roomId: string; userId: string; text: string; timestamp: number }) {
          return { id: 'msg_1', ...data };
        }
      }

      // From docs: Chat Gateway example
      @WebSocketGateway({ path: '/chat' })
      class ChatGateway extends BaseWebSocketGateway {
        constructor(private chatService: ChatService) {
          super();
        }

        @OnConnect()
        async handleConnect(@Client() client: WsClientData) {
          // eslint-disable-next-line no-console
          console.log(`Client ${client.id} connected`);

          return {
            event: 'welcome',
            data: {
              message: 'Welcome to the chat!',
              clientId: client.id,
              timestamp: Date.now(),
            },
          };
        }

        @OnDisconnect()
        async handleDisconnect(@Client() client: WsClientData) {
          // eslint-disable-next-line no-console
          console.log(`Client ${client.id} disconnected`);

          for (const room of client.rooms) {
            this.emitToRoom(room, 'user:left', {
              userId: client.id,
              room,
            });
          }
        }

        @OnJoinRoom('room:{roomId}')
        async handleJoinRoom(
          @Client() client: WsClientData,
          @RoomName() room: string,
          @PatternParams() params: { roomId: string },
        ) {
          // eslint-disable-next-line no-console
          console.log(`Client ${client.id} joining room ${params.roomId}`);

          await this.joinRoom(client.id, room);

          this.emitToRoom(room, 'user:joined', {
            userId: client.id,
            room,
          }, [client.id]);

          const history = await this.chatService.getMessageHistory(params.roomId);

          return {
            event: 'room:joined',
            data: {
              room: params.roomId,
              history,
            },
          };
        }

        @OnLeaveRoom('room:{roomId}')
        async handleLeaveRoom(
          @Client() client: WsClientData,
          @RoomName() room: string,
        ) {
          await this.leaveRoom(client.id, room);

          this.emitToRoom(room, 'user:left', {
            userId: client.id,
            room,
          });
        }

        @OnMessage('chat:{roomId}:message')
        async handleMessage(
          @Client() client: WsClientData,
          @MessageData() data: ChatMessage,
          @PatternParams() params: { roomId: string },
        ) {
          if (!client.rooms.includes(`room:${params.roomId}`)) {
            return {
              event: 'error',
              data: { message: 'Not in room' },
            };
          }

          const message = await this.chatService.saveMessage({
            roomId: params.roomId,
            userId: client.id,
            text: data.text,
            timestamp: Date.now(),
          });

          this.emitToRoom(`room:${params.roomId}`, 'chat:message', message);

          return {
            event: 'chat:message:ack',
            data: { messageId: message.id },
          };
        }

        @OnMessage('typing:{roomId}')
        handleTyping(
          @Client() client: WsClientData,
          @PatternParams() params: { roomId: string },
        ) {
          this.emitToRoom(
            `room:${params.roomId}`,
            'typing',
            { userId: client.id },
            [client.id],
          );
        }
      }

      expect(ChatGateway).toBeDefined();
      expect(ChatService).toBeDefined();
    });
  });

  describe('Chat Service', () => {
    /**
     * @source docs/examples/websocket-chat.md#chat-service
     */
    it('should define ChatService', () => {
      interface Message {
        id: string;
        roomId: string;
        userId: string;
        text: string;
        timestamp: number;
      }

      // From docs: Chat Service example
      @Service()
      class ChatService extends BaseService {
        private messages: Map<string, Message[]> = new Map();
        private messageIdCounter = 0;

        async saveMessage(data: Omit<Message, 'id'>): Promise<Message> {
          const message: Message = {
            id: `msg_${++this.messageIdCounter}`,
            ...data,
          };

          const roomMessages = this.messages.get(data.roomId) || [];
          roomMessages.push(message);
          this.messages.set(data.roomId, roomMessages);

          return message;
        }

        async getMessageHistory(roomId: string, limit = 50): Promise<Message[]> {
          const roomMessages = this.messages.get(roomId) || [];

          return roomMessages.slice(-limit);
        }

        async clearRoom(roomId: string): Promise<void> {
          this.messages.delete(roomId);
        }
      }

      expect(ChatService).toBeDefined();
    });
  });

  describe('Auth Guard', () => {
    /**
     * @source docs/examples/websocket-chat.md#auth-guard
     */
    it('should define custom ChatAuthGuard', () => {
      // From docs: Auth Guard example
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const ChatAuthGuard = createGuard((context: WsExecutionContext) => {
        const client = context.getClient();

        if (!client.auth?.authenticated) {
          return false;
        }

        return true;
      });

      expect(ChatAuthGuard).toBeDefined();
      // createGuard returns a class, not an instance
      const guardInstance = new ChatAuthGuard();
      expect(typeof guardInstance.canActivate).toBe('function');
    });
  });

  describe('Module Setup', () => {
    /**
     * @source docs/examples/websocket-chat.md#module-setup
     */
    it('should define ChatModule', () => {
      @Service()
      class ChatService extends BaseService {}

      @WebSocketGateway({ path: '/chat' })
      class ChatGateway extends BaseWebSocketGateway {
        constructor(private chatService: ChatService) {
          super();
        }
      }

      // From docs: Module Setup example - Gateways go in controllers
      @Module({
        controllers: [ChatGateway],
        providers: [ChatService],
      })
      class ChatModule {}

      expect(ChatModule).toBeDefined();
    });
  });

  describe('Application Entry', () => {
    /**
     * @source docs/examples/websocket-chat.md#application-entry
     */
    it('should create chat application', () => {
      @Service()
      class ChatService extends BaseService {}

      @WebSocketGateway({ path: '/chat' })
      class ChatGateway extends BaseWebSocketGateway {
        constructor(private chatService: ChatService) {
          super();
        }
      }

      @Module({
        controllers: [ChatGateway],
        providers: [ChatService],
      })
      class ChatModule {}

      // From docs: Application Entry example
      const app = new OneBunApplication(ChatModule, {
        port: 3000,
        websocket: {
          socketio: {
            pingInterval: 25000,
            pingTimeout: 20000,
          },
        },
        loggerLayer: makeMockLoggerLayer(),
      });

      expect(app).toBeDefined();
    });
  });

  describe('Client Implementation', () => {
    /**
     * @source docs/examples/websocket-chat.md#typed-client
     */
    it('should create typed chat client', () => {
      @Service()
      class ChatService extends BaseService {}

      @WebSocketGateway({ path: '/chat' })
      class ChatGateway extends BaseWebSocketGateway {
        constructor(private chatService: ChatService) {
          super();
        }

        @OnMessage('chat:message')
        handleMessage(@MessageData() data: { text: string }) {
          return { event: 'received', data };
        }
      }

      @Module({
        controllers: [ChatGateway],
        providers: [ChatService],
      })
      class ChatModule {}

      // From docs: Typed Client (native) example
      const definition = createWsServiceDefinition(ChatModule);
      const client = createWsClient(definition, {
        url: 'ws://localhost:3000/chat',
        protocol: 'native',
        auth: {
          token: 'user-jwt-token',
        },
        reconnect: true,
        reconnectInterval: 2000,
        maxReconnectAttempts: 5,
      });

      // Lifecycle events
      expect(typeof client.on).toBe('function');

      // Connect/disconnect
      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');

      // Gateway access
      expect(client.ChatGateway).toBeDefined();
    });
  });
});

// ============================================================================
// SSE (Server-Sent Events) Documentation Tests
// ============================================================================

import { Sse, getSseMetadata } from './decorators/decorators';
import { formatSseEvent, createSseStream } from './module/controller';

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Query,
  Body,
  Header,
  Req,
  Module,
  Service,
  BaseService,
  BaseController,
  UseMiddleware,
  getServiceTag,
  HttpStatusCode,
  NotFoundError,
  InternalServerError,
  OneBunBaseError,
  Env,
  validate,
  validateOrThrow,
  MultiServiceApplication,
  OneBunApplication,
  createServiceDefinition,
  createServiceClient,
  WebSocketGateway,
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
  WsAuthGuard,
  WsPermissionGuard,
  WsAnyPermissionGuard,
  createGuard,
  createInMemoryWsStorage,
  SharedRedisProvider,
  createWsServiceDefinition,
  createWsClient,
  createNativeWsClient,
  matchPattern,
  makeMockLoggerLayer,
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
} from './';


describe('SSE (Server-Sent Events) API Documentation (docs/api/controllers.md)', () => {
  describe('SseEvent Type (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#sseevent-type
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
     * @source docs/api/controllers.md#sse-decorator
     */
    it('should mark method as SSE endpoint', () => {
      // Test @Sse decorator independently (without @Controller wrapping)
      class TestClass {
        @Sse()
        async *stream(): SseGenerator {
          yield { event: 'start', data: { timestamp: Date.now() } };
        }
      }

      expect(TestClass).toBeDefined();

      // Verify SSE metadata is set on the prototype
      const metadata = getSseMetadata(TestClass.prototype, 'stream');
      expect(metadata).toBeDefined();
    });

    /**
     * @source docs/api/controllers.md#sse-with-heartbeat
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
     * @source docs/api/controllers.md#sse-decorator-with-controller
     */
    it('should work with @Controller decorator', () => {
      // From docs: @Sse() decorator example with full controller
      @Controller('/events')
      class EventsController extends BaseController {
        @Get('/stream')
        @Sse()
        async *stream(): SseGenerator {
          yield { event: 'start', data: { timestamp: Date.now() } };
        }

        @Get('/live')
        @Sse({ heartbeat: 15000 })
        async *live(): SseGenerator {
          yield { event: 'connected', data: { clientId: 'test' } };
        }
      }

      expect(EventsController).toBeDefined();
    });
  });

  describe('formatSseEvent Function', () => {
    /**
     * @source docs/api/controllers.md#sse-wire-format
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
     * @source docs/api/controllers.md#sse-method
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
  });

  describe('Controller.sse() Method', () => {
    /**
     * @source docs/api/controllers.md#sse-method
     */
    it('should have sse() method on BaseController', () => {
      const controller = new BaseController();

      // Access protected method via type assertion
      expect(typeof (controller as unknown as { sse: Function }).sse).toBe('function');
    });

    /**
     * @source docs/api/controllers.md#sse-method-example
     */
    it('should define controller using sse() method', () => {
      // From docs: Using sse() method example
      @Controller('/events')
      class EventsController extends BaseController {
        @Get('/manual')
        events(): Response {
          return this.sse(async function* () {
            yield { event: 'start', data: { timestamp: Date.now() } };
            yield { event: 'complete', data: { success: true } };
          }());
        }
      }

      expect(EventsController).toBeDefined();
    });
  });

  describe('Complete SSE Controller Example (docs/api/controllers.md)', () => {
    /**
     * @source docs/api/controllers.md#server-sent-events-sse
     */
    it('should define complete SSE controller', () => {
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
          for (let i = 0; i < 10; i++) {
            yield { event: 'tick', data: { count: i, timestamp: Date.now() } };
          }
        }

        // SSE with heartbeat
        @Get('/live')
        @Sse({ heartbeat: 15000 })
        async *live(): SseGenerator {
          yield { event: 'connected', data: { clientId: crypto.randomUUID() } };
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
            yield { event: 'start', data: { timestamp: Date.now() } };
            yield { event: 'complete', data: { success: true } };
          }());
        }
      }

      expect(EventsController).toBeDefined();
      expect(DataService).toBeDefined();
      expect(NotificationService).toBeDefined();
    });
  });
});
