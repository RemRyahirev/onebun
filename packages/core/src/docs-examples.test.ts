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
 * - docs/examples/basic-app.md
 * - docs/examples/crud-api.md
 */

import { type } from 'arktype';
import {
  describe,
  it,
  expect,
} from 'bun:test';

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
} from './';

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
        constructor(private repository: UserRepository) {
          super(); // Must call super()
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

    const app = new OneBunApplication(AppModule, { metrics: metricsOptions });
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

    const app = new OneBunApplication(AppModule, { tracing: tracingOptions });
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
     * @source docs/architecture.md#explicit-injection
     */
    it('should demonstrate explicit injection pattern', () => {
      // From docs: Explicit Injection example
      @Service()
      class UserService extends BaseService {}

      @Service()
      class CacheService extends BaseService {}

      // For complex cases, use @Inject() - here we just verify pattern works
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
