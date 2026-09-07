/**
 * Documentation Examples Tests — decorators page
 *
 * Pins the sections of `docs/api/decorators.md` that `packages/core/src/docs-examples.test.ts`
 * leaves uncovered. Every test names the section it pins with an `@source` anchor.
 *
 * @source docs:api/decorators.md
 */

import { trace as otelTrace } from '@opentelemetry/api';
import {
  describe,
  expect,
  it,
} from 'bun:test';
import { Context, Layer } from 'effect';

import type { OneBunRequest, OneBunResponse } from '@onebun/core';
import {
  ApiResponse,
  BaseController,
  BaseMiddleware,
  BaseService,
  Body,
  Controller,
  Delete,
  Get,
  getConstructorParamTypes,
  getControllerMetadata,
  getModuleMetadata,
  getServiceMetadata,
  getServiceTag,
  Global,
  Header,
  HttpException,
  HttpMethod,
  Inject,
  isGlobalModule,
  Module,
  OneBunApplication,
  OneBunModule,
  Param,
  ParamType,
  Post,
  Put,
  Query,
  registerDependencies,
  registerModule,
  removeFromGlobalModules,
  resetRegistrations,
  selectRegistration,
  Service,
  type,
  UseMiddleware,
} from '@onebun/core';
import { LoggerService } from '@onebun/logger';
import { Span } from '@onebun/trace';

// `createGlobalScope` is not part of the published surface — it is the per-application DI
// scope the framework creates during `start()`. Used here so the module-level tests do not
// write into the process-default scope shared with every other test file.
import { createGlobalScope } from '../module/module';
import {
  createMockConfig,
  createMockLogger,
  makeMockLoggerLayer,
} from '../testing';

const okStatus = 200;
const createdStatus = 201;
const badRequestStatus = 400;
const unauthorizedStatus = 401;
const notFoundStatus = 404;
const serverErrorStatus = 500;

/**
 * An application bound to an ephemeral port, silent, with nothing but the HTTP server on.
 */
function createApp(moduleClass: new (...args: unknown[]) => object): OneBunApplication {
  return new OneBunApplication(moduleClass, {
    port: 0,
    host: '127.0.0.1',
    loggerLayer: makeMockLoggerLayer(),
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
  });
}

/**
 * A module built outside an application, with a recording logger and a fixed config.
 */
function createModule(
  moduleClass: Function,
  config: Record<string, unknown> = {},
  logger = makeMockLoggerLayer(),
): OneBunModule {
  return new OneBunModule(
    moduleClass,
    logger,
    createMockConfig(config),
    undefined,
    undefined,
    createGlobalScope(),
  );
}

describe('Decorator Quick Reference (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#decorator-quick-reference
   */
  it('registers controllers and providers, and carries an exported service into an importing module', async () => {
    // From docs: `providers` are auto-available in this module, `exports` is what an
    // importing module gets.
    @Service()
    class GreetingService extends BaseService {
      greet(name: string): string {
        return `hello ${name}`;
      }
    }

    @Module({
      providers: [GreetingService],
      exports: [GreetingService],
    })
    class GreetingModule {}

    @Controller('/greet')
    class GreetController extends BaseController {
      constructor(private greeting: GreetingService) {
        super();
      }

      @Get('/:name')
      hello(@Param('name') name: string): { message: string } {
        return { message: this.greeting.greet(name) };
      }
    }

    @Module({
      imports: [GreetingModule],
      controllers: [GreetController],
    })
    class AppModule {}

    const app = createApp(AppModule);

    try {
      await app.start();

      // The controller was registered AND the service it never provided itself was
      // resolved across the module boundary the export opened.
      const response = await fetch(`${app.getHttpUrl()}/greet/ann`);
      expect(response.status).toBe(okStatus);
      expect(await response.json()).toEqual({ success: true, result: { message: 'hello ann' } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/decorators.md#decorator-quick-reference
   */
  it('hands a @Service() the application logger and config through BaseService', () => {
    const infoCalls: Array<{ message: string; args: unknown[] }> = [];
    const base = createMockLogger();
    // Recording rather than silent: `this.logger` has to be the application's logger, not
    // something the service invented for itself.
    const recording: typeof base = {
      ...base,
      info(message: string, ...args: unknown[]) {
        infoCalls.push({ message, args });

        return base.info(message, ...args);
      },
      child: () => recording,
    };

    // From docs: "this.logger and this.config available from BaseService".
    @Service()
    class UserService extends BaseService {
      describeSelf(): string {
        this.logger.info('describing');

        return this.config.get('app.name') as string;
      }
    }

    @Module({ providers: [UserService] })
    class UserModule {}

    const module = createModule(
      UserModule,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      { 'app.name': 'onebun' },
      Layer.succeed(LoggerService, recording),
    );
    const service = module.getServiceByClass(UserService) as UserService;

    expect(service.describeSelf()).toBe('onebun');
    expect(infoCalls).toEqual([{ message: 'describing', args: [] }]);
  });
});

describe('@Global() (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#global
   */
  it('reaches a module that never imported it, and stops reaching once revoked', async () => {
    // From docs: the DatabaseModule example.
    @Service()
    class DatabaseService extends BaseService {
      query(): string {
        return 'row-1';
      }
    }

    @Global()
    @Module({
      providers: [DatabaseService],
      exports: [DatabaseService],
    })
    class DatabaseModule {}

    @Service()
    class UserService extends BaseService {
      constructor(private db: DatabaseService) {
        super();
      }

      findAll(): string[] {
        return [this.db.query()];
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      constructor(private users: UserService) {
        super();
      }

      @Get('/')
      findAll(): { users: string[] } {
        return { users: this.users.findAll() };
      }
    }

    // From docs: "UserService can inject DatabaseService" without importing DatabaseModule.
    @Module({
      controllers: [UserController],
      providers: [UserService],
    })
    class UserModule {}

    @Module({ imports: [DatabaseModule, UserModule] })
    class AppModule {}

    expect(isGlobalModule(DatabaseModule)).toBe(true);
    expect(isGlobalModule(UserModule)).toBe(false);

    const app = createApp(AppModule);

    try {
      await app.start();
      const response = await fetch(`${app.getHttpUrl()}/users`);
      expect(response.status).toBe(okStatus);
      expect(await response.json()).toEqual({ success: true, result: { users: ['row-1'] } });
    } finally {
      await app.stop();
    }

    // From docs, "Related Functions": removeFromGlobalModules() takes the module back out of
    // the registry, and the ambient reach goes with it — UserModule still does not import it.
    removeFromGlobalModules(DatabaseModule);
    expect(isGlobalModule(DatabaseModule)).toBe(false);

    const withoutGlobal = createApp(AppModule);
    let bootError: Error | undefined;
    try {
      await withoutGlobal.start();
    } catch (error) {
      bootError = error as Error;
    } finally {
      await withoutGlobal.stop();
    }

    expect(bootError?.message).toContain('DatabaseService');
  });
});

describe('@Controller() (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#controller
   */
  it('prefixes every route with the base path, leading slash optional', async () => {
    // From docs: @Controller('/api/users') — "All routes will be prefixed with /api/users".
    @Controller('/api/users')
    class UserController extends BaseController {
      @Get('/')
      findAll(): { from: string } {
        return { from: 'users' };
      }
    }

    // From docs' note: "@Controller('api/users') and @Controller('/api/users') are equivalent".
    @Controller('api/orders')
    class OrderController extends BaseController {
      @Get('/')
      findAll(): { from: string } {
        return { from: 'orders' };
      }
    }

    expect(getControllerMetadata(UserController)?.path).toBe('/api/users');
    expect(getControllerMetadata(OrderController)?.path).toBe('/api/orders');

    @Module({ controllers: [UserController, OrderController] })
    class ApiModule {}

    const app = createApp(ApiModule);

    try {
      await app.start();

      const users = await fetch(`${app.getHttpUrl()}/api/users`);
      expect(await users.json()).toEqual({ success: true, result: { from: 'users' } });

      const orders = await fetch(`${app.getHttpUrl()}/api/orders`);
      expect(await orders.json()).toEqual({ success: true, result: { from: 'orders' } });

      // The prefix is not optional at request time: the bare path is not the route.
      const unprefixed = await fetch(`${app.getHttpUrl()}/users`);
      expect(unprefixed.status).toBe(notFoundStatus);
    } finally {
      await app.stop();
    }
  });
});

describe('HTTP method decorators (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#get-post-put-delete-patch-options-head-all
   */
  it('routes each verb and path-parameter shape to its own handler', async () => {
    // From docs: the "Path Parameters" controller, verbatim in shape.
    @Controller('/users')
    class UserController extends BaseController {
      @Get('/')
      async findAll(): Promise<{ hit: string }> {
        return { hit: 'findAll' };
      }

      @Get('/:id')
      async findOne(@Param('id') id: string): Promise<{ hit: string; id: string }> {
        return { hit: 'findOne', id };
      }

      @Get('/:userId/posts')
      async getUserPosts(@Param('userId') userId: string): Promise<{ hit: string; userId: string }> {
        return { hit: 'getUserPosts', userId };
      }

      @Post('/')
      async create(@Body() body: unknown): Promise<{ hit: string; body: unknown }> {
        return { hit: 'create', body };
      }

      @Put('/:id')
      async update(
        @Param('id') id: string,
        @Body() body: unknown,
      ): Promise<{ hit: string; id: string; body: unknown }> {
        return { hit: 'update', id, body };
      }

      @Delete('/:id')
      async remove(@Param('id') id: string): Promise<{ hit: string; id: string }> {
        return { hit: 'remove', id };
      }
    }

    @Module({ controllers: [UserController] })
    class UserModule {}

    const app = createApp(UserModule);

    try {
      await app.start();
      const base = app.getHttpUrl();

      const jsonHeaders = new Headers([['content-type', 'application/json']]);

      expect(await (await fetch(`${base}/users`)).json())
        .toEqual({ success: true, result: { hit: 'findAll' } });
      expect(await (await fetch(`${base}/users/123`)).json())
        .toEqual({ success: true, result: { hit: 'findOne', id: '123' } });
      expect(await (await fetch(`${base}/users/123/posts`)).json())
        .toEqual({ success: true, result: { hit: 'getUserPosts', userId: '123' } });

      const created = await fetch(`${base}/users`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'ann' }),
      });
      expect(await created.json())
        .toEqual({ success: true, result: { hit: 'create', body: { name: 'ann' } } });

      const updated = await fetch(`${base}/users/7`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'bob' }),
      });
      expect(await updated.json())
        .toEqual({ success: true, result: { hit: 'update', id: '7', body: { name: 'bob' } } });

      const removed = await fetch(`${base}/users/7`, { method: 'DELETE' });
      expect(await removed.json())
        .toEqual({ success: true, result: { hit: 'remove', id: '7' } });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/decorators.md#get-post-put-delete-patch-options-head-all
   */
  it('records the per-route timeout from RouteOptions, and nothing when it is not given', () => {
    // From docs: "Per-request timeout" — override the global idleTimeout per route.
    @Controller('/tasks')
    class TaskController extends BaseController {
      @Post('/process', { timeout: 300 }) // 5 minutes for this endpoint
      async processTask(@Body() _body: unknown): Promise<void> {
        // long-running task...
      }

      @Get('/export', { timeout: 0 }) // no timeout
      async exportAll(): Promise<void> {
        // very long export...
      }

      @Get('/status')
      async status(): Promise<void> {
        // inherits the application-wide idleTimeout
      }
    }

    const routes = getControllerMetadata(TaskController)?.routes ?? [];

    expect(routes.map((route) => ({
      method: route.method,
      path: route.path,
      timeout: route.timeout,
    }))).toEqual([
      { method: HttpMethod.POST, path: '/process', timeout: 300 },
      { method: HttpMethod.GET, path: '/export', timeout: 0 },
      { method: HttpMethod.GET, path: '/status', timeout: undefined },
    ]);
    // `timeout: 0` means "disable", so it has to survive as 0 rather than be dropped as falsy.
    expect(Object.hasOwn(routes[1], 'timeout')).toBe(true);
    expect(Object.hasOwn(routes[2], 'timeout')).toBe(false);
  });
});

describe('@Service() (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#service
   */
  it('mints a tag from the class name, or registers the explicit one it was given', async () => {
    // From docs: "Service with auto-generated tag".
    @Service()
    class UserService extends BaseService {
      async findAll(): Promise<string[]> {
        return ['ann'];
      }
    }

    // From docs: "With custom Effect.js tag".
    const customServiceTag = Context.GenericTag<CustomService>('CustomService');

    @Service(customServiceTag)
    class CustomService extends BaseService {
      label(): string {
        return 'custom';
      }
    }

    expect(getServiceTag(UserService).key).toBe('UserService');
    expect(getServiceMetadata(CustomService)?.tag).toBe(
      customServiceTag as unknown as Context.Tag<unknown, unknown>,
    );

    @Module({ providers: [UserService, CustomService] })
    class ServicesModule {}

    const module = createModule(ServicesModule);
    const custom = module.getServiceByClass(CustomService) as CustomService;
    const user = module.getServiceByClass(UserService) as UserService;

    // Both registration styles produce a usable instance, and the explicit tag is the key
    // the framework filed it under — not a look-alike minted from the class name.
    expect(custom.label()).toBe('custom');
    expect(await user.findAll()).toEqual(['ann']);
    expect(module.getAllServiceInstances().get(
      customServiceTag as unknown as Context.Tag<unknown, unknown>,
    )).toBe(custom);
    expect(module.getAllServiceInstances().get(
      getServiceTag(UserService) as unknown as Context.Tag<unknown, unknown>,
    )).toBe(user);
  });
});

describe('@Inject() (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#inject
   */
  it('injects a controller\'s concrete-class dependencies with no annotation at all', async () => {
    // From docs: "Automatic injection (works in most cases) - no @Inject needed".
    @Service()
    class UserService extends BaseService {
      list(): string[] {
        return ['ann'];
      }
    }

    @Service()
    class CacheService extends BaseService {
      read(): string {
        return 'cached';
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      constructor(
        private userService: UserService,
        private cacheService: CacheService,
      ) {
        super();
      }

      @Get('/')
      findAll(): { users: string[]; cache: string } {
        return { users: this.userService.list(), cache: this.cacheService.read() };
      }
    }

    @Module({
      controllers: [UserController],
      providers: [UserService, CacheService],
    })
    class UserModule {}

    const app = createApp(UserModule);

    try {
      await app.start();
      const response = await fetch(`${app.getHttpUrl()}/users`);

      // Both parameters arrived, in the right order: a swap would show up here as
      // `cache: 'ann'`, and a miss as a 500.
      expect(await response.json()).toEqual({
        success: true,
        result: { users: ['ann'], cache: 'cached' },
      });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/decorators.md#inject
   */
  it('names the implementation for a parameter typed as an interface', () => {
    // From docs, "When to use @Inject": interface injection. TypeScript erases the
    // interface, so `design:paramtypes` says `Object` and automatic resolution has nothing
    // to go on — the annotation is the only thing that picks the right provider.
    interface Notifier {
      notify(): string;
    }

    @Service()
    class SmsNotifier extends BaseService {
      notify(): string {
        return 'sms';
      }
    }

    @Service()
    class EmailNotifier extends BaseService implements Notifier {
      notify(): string {
        return 'email';
      }
    }

    @Service()
    class AlertService extends BaseService {
      constructor(@Inject(EmailNotifier) private notifier: Notifier) {
        super();
      }

      raise(): string {
        return `alert via ${this.notifier.notify()}`;
      }
    }

    expect(getConstructorParamTypes(AlertService)).toEqual([EmailNotifier]);

    @Module({ providers: [SmsNotifier, EmailNotifier, AlertService] })
    class AlertModule {}

    const module = createModule(AlertModule);
    const alerts = module.getServiceByClass(AlertService) as AlertService;

    // The named implementation, not the other one registered alongside it.
    expect(alerts.raise()).toBe('alert via email');
  });

  /**
   * @source docs:api/decorators.md#inject
   */
  it('picks WHICH named registration a parameter gets in a module that selected two', async () => {
    const mainDb = Symbol('MAIN_DB');
    const analyticsDb = Symbol('ANALYTICS_DB');

    interface StorageOptions {
      url: string;
      as?: symbol;
    }

    @Service()
    class StorageService extends BaseService {
      get url(): string {
        return this.registrationOptions<StorageOptions>()?.url ?? '(unconfigured)';
      }
    }

    // A dynamic module in the shape `DrizzleModule.forRoot()/forFeature()` has: one
    // registration per configuration, selected by token.
    class StorageModule {
      static forRoot(options: StorageOptions): Function {
        return registerModule(StorageModule, options, options.as, [StorageService]);
      }

      static forFeature(token: symbol): Function {
        return selectRegistration(StorageModule, token, [StorageService]);
      }
    }

    @Service()
    class ClockService extends BaseService {
      readonly id = 'clock';
    }

    // From docs: the module that legitimately holds BOTH names each one; the un-annotated
    // parameter still resolves by type.
    @Service()
    class Reconciler extends BaseService {
      constructor(
        @Inject(mainDb) public main: StorageService,
        @Inject(analyticsDb) public analytics: StorageService,
        public clock: ClockService,
      ) {
        super();
      }
    }

    @Module({
      imports: [
        StorageModule.forFeature(mainDb),
        StorageModule.forFeature(analyticsDb),
      ],
      providers: [ClockService, Reconciler],
      exports: [Reconciler],
    })
    class ReconcileModule {}

    @Module({
      imports: [
        StorageModule.forRoot({ url: 'main://db', as: mainDb }),
        StorageModule.forRoot({ url: 'analytics://db', as: analyticsDb }),
        ReconcileModule,
      ],
    })
    class AppModule {}

    const app = createApp(AppModule);

    try {
      await app.start();
      const reconciler = app.getService(Reconciler);

      // Two instances of ONE service class, each reading its own configuration. Falling
      // back to the single tag slot would hand both parameters the same one.
      expect(reconciler.main.url).toBe('main://db');
      expect(reconciler.analytics.url).toBe('analytics://db');
      expect(reconciler.clock.id).toBe('clock');
    } finally {
      await app.stop();
      resetRegistrations();
    }
  });
});

describe('@ApiResponse() (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#apiresponse
   */
  it('validates the response body against the schema it declares for the status', async () => {
    // From docs: the @ApiResponse() example, including its "Response will be validated
    // against userResponseSchema" comment.
    const userResponseSchema = type({
      id: 'string',
      name: 'string',
      email: 'string.email',
    });

    @Controller('/users')
    class UserController extends BaseController {
      @Get('/:id')
      @ApiResponse(okStatus, {
        schema: userResponseSchema,
        description: 'User found successfully',
      })
      @ApiResponse(notFoundStatus, {
        description: 'User not found',
      })
      async findOne(@Param('id') id: string): Promise<unknown> {
        return { id, name: 'John', email: 'john@example.com' };
      }

      @Get('/:id/broken')
      @ApiResponse(okStatus, { schema: userResponseSchema })
      async broken(@Param('id') id: string): Promise<unknown> {
        // `email` is missing, so the declared schema rejects it.
        return { id, name: 'John' };
      }
    }

    @Module({ controllers: [UserController] })
    class UserModule {}

    const app = createApp(UserModule);

    try {
      await app.start();

      const ok = await fetch(`${app.getHttpUrl()}/users/u-1`);
      expect(ok.status).toBe(okStatus);
      expect(await ok.json()).toEqual({
        success: true,
        result: { id: 'u-1', name: 'John', email: 'john@example.com' },
      });

      // The declaration is not documentation only: a body that does not match never
      // reaches the client.
      const broken = await fetch(`${app.getHttpUrl()}/users/u-1/broken`);
      expect(broken.status).toBe(serverErrorStatus);
      const body = await broken.json() as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain('Response validation failed');
    } finally {
      await app.stop();
    }
  });
});

describe('@Span() (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#span
   */
  it('opens a span around the decorated method and returns its value unchanged', async () => {
    const started: string[] = [];
    const fakeSpan = {
      setAttribute: () => undefined,
      setStatus: () => undefined,
      end: () => undefined,
    };

    // Process-global, so it is restored in `finally`. Substituting on the api object is
    // what @onebun/trace's own tests do; `mock.module` would leak to every other file.
    const originalGetTracer = otelTrace.getTracer.bind(otelTrace);
    otelTrace.getTracer = (() => ({
      startActiveSpan(name: string, cb: (span: unknown) => unknown) {
        started.push(name);

        return cb(fakeSpan);
      },
      startSpan: () => fakeSpan,
    })) as unknown as typeof otelTrace.getTracer;

    try {
      // From docs: the @Span() example.
      @Service()
      class UserService extends BaseService {
        @Span('user-find-by-id')
        async findById(id: string): Promise<{ id: string } | null> {
          return { id };
        }

        @Span() // Uses the method name as span name
        async processUser(user: { id: string }): Promise<string> {
          return `processed ${user.id}`;
        }
      }

      const service = new UserService();

      expect(await service.findById('u-1')).toEqual({ id: 'u-1' });
      expect(await service.processUser({ id: 'u-2' })).toBe('processed u-2');

      // The explicit name is used verbatim; the default is `Class.method` — the page's
      // "Span name: processUser" comment is short by the class prefix.
      expect(started).toEqual(['user-find-by-id', 'UserService.processUser']);
    } finally {
      otelTrace.getTracer = originalGetTracer;
    }
  });
});

describe('Utility functions (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#getcontrollermetadata
   */
  it('returns the controller path and one entry per route from getControllerMetadata()', () => {
    const noteSchema = type({ id: 'string' });

    class AuditMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        return await next();
      }
    }

    @Controller('/api/notes')
    class NoteController extends BaseController {
      @Get('/:id')
      @UseMiddleware(AuditMiddleware)
      @ApiResponse(okStatus, { schema: noteSchema, description: 'The note' })
      findOne(@Param('id') id: string, @Query('full') full?: string): unknown {
        return { id, full };
      }

      @Post('/')
      create(@Body() body: unknown): unknown {
        return body;
      }
    }

    class Undecorated {}

    const metadata = getControllerMetadata(NoteController);

    expect(metadata?.path).toBe('/api/notes');
    expect(metadata?.routes.map((route) => ({
      path: route.path,
      method: route.method,
      handler: route.handler,
    }))).toEqual([
      { path: '/:id', method: HttpMethod.GET, handler: 'findOne' },
      { path: '/', method: HttpMethod.POST, handler: 'create' },
    ]);

    const [findOne, create] = metadata!.routes;
    expect([...(findOne.params ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((param) => ({ type: param.type, name: param.name, isRequired: param.isRequired })))
      .toEqual([
        { type: ParamType.PATH, name: 'id', isRequired: true },
        { type: ParamType.QUERY, name: 'full', isRequired: false },
      ]);
    // The documented `middleware?: Function[]` is the list `@UseMiddleware` put on the route,
    // not a slot that is always empty: the pair below separates "recorded correctly" from
    // "recorded nothing", which an `[]` on a route with no middleware cannot do alone.
    expect(findOne.middleware).toEqual([AuditMiddleware]);
    expect(create.middleware).toEqual([]);
    expect(findOne.responseSchemas?.map((schema) => ({
      statusCode: schema.statusCode,
      description: schema.description,
    }))).toEqual([{ statusCode: okStatus, description: 'The note' }]);

    expect(getControllerMetadata(Undecorated)).toBeUndefined();
  });

  /**
   * @source docs:api/decorators.md#getmodulemetadata
   */
  it('returns imports, controllers, providers and exports from getModuleMetadata()', () => {
    @Service()
    class FeatureService extends BaseService {}

    @Controller('/feature')
    class FeatureController extends BaseController {}

    @Module({ providers: [FeatureService] })
    class SharedModule {}

    @Module({
      imports: [SharedModule],
      controllers: [FeatureController],
      providers: [FeatureService],
      exports: [FeatureService],
    })
    class FeatureModule {}

    class Undecorated {}

    expect(getModuleMetadata(FeatureModule)).toEqual({
      imports: [SharedModule],
      controllers: [FeatureController],
      providers: [FeatureService],
      exports: [FeatureService],
    });
    expect(getModuleMetadata(Undecorated)).toBeUndefined();
  });

  /**
   * @source docs:api/decorators.md#getservicemetadata
   */
  it('returns the tag and the implementation class from getServiceMetadata()', () => {
    @Service()
    class ReportService extends BaseService {}

    class Undecorated {}

    const metadata = getServiceMetadata(ReportService);

    expect(metadata?.impl).toBe(ReportService as unknown as new () => unknown);
    expect(metadata?.tag.key).toBe('ReportService');
    expect(getServiceMetadata(Undecorated)).toBeUndefined();
  });

  /**
   * @source docs:api/decorators.md#getservicetag
   */
  it('returns the Effect tag a service is registered under from getServiceTag()', () => {
    @Service()
    class AuditService extends BaseService {
      record(): string {
        return 'recorded';
      }
    }

    class Undecorated {}

    @Module({ providers: [AuditService] })
    class AuditModule {}

    const module = createModule(AuditModule);
    const instance = module.getServiceByClass(AuditService) as AuditService;
    const tag = getServiceTag(AuditService);

    // The tag is the key the module's instance registry uses, so it is a working handle on
    // the live instance and not just a name.
    expect(tag.key).toBe('AuditService');
    expect(module.getAllServiceInstances().get(tag as unknown as Context.Tag<unknown, unknown>))
      .toBe(instance);
    expect(instance.record()).toBe('recorded');

    expect(() => getServiceTag(Undecorated)).toThrow(/does not have @Service decorator/);
  });

  /**
   * @source docs:api/decorators.md#registerdependencies
   */
  it('resolves a dependency registered manually with registerDependencies()', () => {
    // An interface-typed parameter erases to `Object`, so automatic detection cannot pick
    // the provider — registerDependencies() is the documented fallback.
    interface Clock {
      now(): number;
    }

    @Service()
    class DecoyService extends BaseService {
      readonly label = 'decoy';
    }

    @Service()
    class FixedClock extends BaseService implements Clock {
      now(): number {
        return 42;
      }
    }

    @Service()
    class Scheduler extends BaseService {
      constructor(private clock: Clock) {
        super();
      }

      nextTick(): number {
        return this.clock.now() + 1;
      }
    }

    registerDependencies(Scheduler, [FixedClock]);
    expect(getConstructorParamTypes(Scheduler)).toEqual([FixedClock]);

    @Module({ providers: [DecoyService, FixedClock, Scheduler] })
    class SchedulerModule {}

    const module = createModule(SchedulerModule);
    const scheduler = module.getServiceByClass(Scheduler) as Scheduler;

    // The registered class is what arrived — not the decoy that also satisfies `Object`.
    expect(scheduler.nextTick()).toBe(43);
  });
});

describe('Complete Example (docs/api/decorators.md)', () => {
  /**
   * @source docs:api/decorators.md#complete-example
   */
  it('runs the assembled module end to end', async () => {
    const createUserSchema = type({
      name: 'string',
      email: 'string.email',
    });
    type CreateUserBody = typeof createUserSchema.infer;

    const userSchema = type({
      id: 'string',
      name: 'string',
      email: 'string.email',
    });
    type User = typeof userSchema.infer;

    @Service()
    class UserService extends BaseService {
      private users = new Map<string, User>();

      @Span('find-all-users')
      async findAll(): Promise<User[]> {
        return Array.from(this.users.values());
      }

      @Span('find-user-by-id')
      async findById(id: string): Promise<User | null> {
        return this.users.get(id) || null;
      }

      async create(data: CreateUserBody): Promise<User> {
        const user = { id: crypto.randomUUID(), ...data };
        this.users.set(user.id, user);
        this.logger.info('User created', { userId: user.id });

        return user;
      }
    }

    class AuthMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        const token = req.headers.get('Authorization');
        if (!token?.startsWith('Bearer ')) {
          return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
            status: unauthorizedStatus,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return await next();
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      constructor(private userService: UserService) {
        super();
      }

      @Get('/')
      @ApiResponse(okStatus, { schema: userSchema.array() })
      async findAll(
        @Query('limit') _limit?: string,
        @Query('offset') _offset?: string,
      ): Promise<User[]> {
        return await this.userService.findAll();
      }

      @Get('/:id')
      @ApiResponse(okStatus, { schema: userSchema })
      @ApiResponse(notFoundStatus, { description: 'User not found' })
      async findOne(@Param('id') id: string): Promise<User> {
        const user = await this.userService.findById(id);
        if (!user) {
          throw new HttpException(notFoundStatus, 'User not found');
        }

        return user;
      }

      @Post('/')
      @UseMiddleware(AuthMiddleware)
      @ApiResponse(createdStatus, { schema: userSchema })
      async create(
        @Body(createUserSchema) body: CreateUserBody,
        @Header('X-Request-ID') requestId?: string,
      ): Promise<User> {
        this.logger.info('Creating user', { requestId });

        return await this.userService.create(body);
      }
    }

    @Module({
      controllers: [UserController],
      providers: [UserService],
      exports: [UserService],
    })
    class UserModule {}

    const app = createApp(UserModule);

    try {
      await app.start();
      const base = app.getHttpUrl();

      // @UseMiddleware(AuthMiddleware) guards the POST only.
      const denied = await fetch(`${base}/users`, {
        method: 'POST',
        headers: new Headers([['content-type', 'application/json']]),
        body: JSON.stringify({ name: 'Ann', email: 'ann@example.com' }),
      });
      expect(denied.status).toBe(unauthorizedStatus);
      expect(await denied.json()).toEqual({ success: false, message: 'Unauthorized' });

      // @ApiResponse(201, ...) is the status the created user comes back with.
      const created = await fetch(`${base}/users`, {
        method: 'POST',
        headers: new Headers([
          ['content-type', 'application/json'],
          ['authorization', 'Bearer token'],
          ['x-request-id', 'req-1'],
        ]),
        body: JSON.stringify({ name: 'Ann', email: 'ann@example.com' }),
      });
      expect(created.status).toBe(createdStatus);
      const createdBody = await created.json() as { success: boolean; result: User };
      expect(createdBody.success).toBe(true);
      expect(createdBody.result.name).toBe('Ann');
      expect(createdBody.result.email).toBe('ann@example.com');

      // The service kept it, and @Span() around findAll did not swallow the value.
      const listed = await fetch(`${base}/users?limit=10`);
      expect(await listed.json()).toEqual({ success: true, result: [createdBody.result] });

      const found = await fetch(`${base}/users/${createdBody.result.id}`);
      expect(await found.json()).toEqual({ success: true, result: createdBody.result });

      // HttpException(404) from the handler becomes the documented 404.
      const missing = await fetch(`${base}/users/nope`);
      expect(missing.status).toBe(notFoundStatus);
      expect(await missing.json()).toMatchObject({ success: false, error: 'User not found' });

      // @Body(createUserSchema) rejects a body the schema does not accept.
      const invalid = await fetch(`${base}/users`, {
        method: 'POST',
        headers: new Headers([
          ['content-type', 'application/json'],
          ['authorization', 'Bearer token'],
        ]),
        body: JSON.stringify({ name: 'Bob', email: 'not-an-email' }),
      });
      expect(invalid.status).toBe(badRequestStatus);
      expect(await invalid.json() as { error: string })
        .toMatchObject({ success: false, code: badRequestStatus });
    } finally {
      await app.stop();
    }
  });
});
