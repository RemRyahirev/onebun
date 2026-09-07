/**
 * Documentation examples for the two prose pages that carry runnable OneBun recipes but had
 * no test pinning them: the landing page's "Key Patterns" and the NestJS migration guide's
 * side-by-side ports.
 *
 * Every test here exercises the promise the surrounding prose makes — the envelope a handler
 * produces, the constructor dependency that gets injected, the status a denying guard returns —
 * so that a refactor which keeps the snippet compiling but stops honouring it goes red.
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import type {
  HttpExecutionContext,
  HttpGuard,
  MiddlewareClass,
  OnModuleConfigure,
  OneBunRequest,
  OneBunResponse,
} from '@onebun/core';
import {
  ApiResponse,
  BaseController,
  BaseMiddleware,
  BaseService,
  Body,
  Controller,
  createHttpGuard,
  Delete,
  Env,
  Get,
  getCurrentTraceContext,
  getJsonSchema,
  getModuleMetadata,
  HttpException,
  Middleware,
  Module,
  OneBunApplication,
  Param,
  Post,
  Put,
  Query,
  Service,
  type,
  UseGuards,
  UseMiddleware,
  validate,
} from '@onebun/core';
import { type CompiledTestingModule, TestingModule } from '@onebun/core/testing';
// Not part of the documented surface: the tests below own `envSchema`, and TypedEnv keys its
// instances process-wide, so a config built by whichever test ran first would be handed back.
import { TypedEnv } from '@onebun/envs';
import type { Logger } from '@onebun/logger';
import { LoggerService } from '@onebun/logger';

// ============================================================================
// Shared helpers
// ============================================================================

interface LogRecord {
  level: string;
  message: string;
  context: Record<string, unknown>;
}

/**
 * A logger layer that keeps what was written instead of dropping it. `makeMockLoggerLayer()`
 * is silent, which makes "BaseService gives you this.logger" unfalsifiable — a service that
 * never logged and a framework that stopped wiring the logger look identical through it.
 */
function makeRecordingLoggerLayer(sink: LogRecord[]): Layer.Layer<Logger> {
  const make = (context: Record<string, unknown>): Logger => {
    const record = (level: string) => (message: string) => Effect.sync(() => {
      sink.push({ level, message, context });
    });

    return {
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      fatal: record('fatal'),
      child: (extra: Record<string, unknown>) => make({ ...context, ...extra }),
    };
  };

  return Layer.succeed(LoggerService, make({}));
}

interface SuccessEnvelope<T> {
  success: boolean;
  result: T;
}

interface ErrorEnvelope {
  success: boolean;
  error: string;
  code: number;
}

// ============================================================================
// index.md — Key Patterns
// ============================================================================

@Controller('/patterns')
class ResponseFormatController extends BaseController {
  @Get('/data')
  async getData(@Query('id') id?: string) {
    // Success: return plain data (auto-wrapped)
    return { id: id ?? 'none', tags: ['a', 'b'] };
  }

  @Get('/error')
  async fail(@Query('id') _id?: string) {
    // Error: throw HttpException
    throw new HttpException(400, 'message');
  }
}

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

// No `registerDependencies()` call anywhere: the page claims the dependency is detected from
// the constructor signature, and calling it would supply the answer the test is checking for.
@Controller('/users')
class DiUserController extends BaseController {
  constructor(private counterService: CounterService) {
    super();
  }

  @Get('/count')
  async count() {
    return { value: this.counterService.getValue() };
  }

  @Post('/count')
  async bump(@Body() body?: { amount?: number }) {
    return { value: this.counterService.increment(body?.amount) };
  }
}

// src/user.schema.ts — schema + inferred type in one file
const indexCreateUserSchema = type({
  name: 'string',
  email: 'string.email',
  age: 'number > 0',
});

type IndexCreateUserDto = typeof indexCreateUserSchema.infer;

@Controller('/signup')
class ArkTypeController extends BaseController {
  @Post('/')
  async createUser(@Body(indexCreateUserSchema) user: IndexCreateUserDto) {
    // user is validated and typed
    return { greeting: `${user.name} <${user.email}> is ${user.age}` };
  }
}

describe('docs/index.md — Key Patterns', () => {
  /**
   * @source docs:index.md#response-format
   */
  it('wraps a plain return in { success, result } and an HttpException in { success, error, code }', async () => {
    const module = await TestingModule.create({ controllers: [ResponseFormatController] }).compile();

    try {
      const ok = await module.inject('GET', '/patterns/data', { query: { id: '42' } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({
        success: true,
        result: { id: '42', tags: ['a', 'b'] },
      });

      const failed = await module.inject('GET', '/patterns/error');
      expect(failed.status).toBe(400);

      const body = await failed.json() as ErrorEnvelope;
      expect(body.success).toBe(false);
      expect(body.error).toBe('message');
      expect(body.code).toBe(400);
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:index.md#dependency-injection
   */
  it('injects the constructor-declared service, and it is the one singleton the module holds', async () => {
    const module = await TestingModule.create({
      controllers: [DiUserController],
      providers: [CounterService],
    }).compile();

    try {
      // Reaching the handler at all proves the constructor got a real CounterService: an
      // undetected dependency arrives as `undefined` and the first call throws a 500.
      const bumped = await module.inject('POST', '/users/count', { body: { amount: 2 } });
      expect(bumped.status).toBe(200);
      expect(await bumped.json() as SuccessEnvelope<{ value: number }>).toEqual({
        success: true,
        result: { value: 2 },
      });

      await module.inject('POST', '/users/count', { body: {} });

      const read = await module.inject('GET', '/users/count');
      expect((await read.json() as SuccessEnvelope<{ value: number }>).result.value).toBe(3);

      // Same instance, not a fresh one per injection site
      expect(module.get(CounterService).getValue()).toBe(3);
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:index.md#validation-with-arktype
   */
  it('validates the request body against the schema the handler declares', async () => {
    const module = await TestingModule.create({ controllers: [ArkTypeController] }).compile();

    try {
      const accepted = await module.inject('POST', '/signup', {
        body: { name: 'Ada', email: 'ada@example.com', age: 36 },
      });
      expect(accepted.status).toBe(200);
      expect((await accepted.json() as SuccessEnvelope<{ greeting: string }>).result.greeting)
        .toBe('Ada <ada@example.com> is 36');

      // 'number > 0' — zero is not a positive number
      const zeroAge = await module.inject('POST', '/signup', {
        body: { name: 'Ada', email: 'ada@example.com', age: 0 },
      });
      expect(zeroAge.status).toBe(400);
      expect((await zeroAge.json() as ErrorEnvelope).error).toContain('age');

      // 'string.email' — a bare string is not enough
      const badEmail = await module.inject('POST', '/signup', {
        body: { name: 'Ada', email: 'not-an-email', age: 36 },
      });
      expect(badEmail.status).toBe(400);
      expect((await badEmail.json() as ErrorEnvelope).error).toContain('email');

      // A missing required field is rejected too, not defaulted
      const missing = await module.inject('POST', '/signup', { body: { name: 'Ada', age: 36 } });
      expect(missing.status).toBe(400);
    } finally {
      await module.close();
    }
  });
});

// ============================================================================
// migration-nestjs.md — Side-by-Side Examples
// ============================================================================

/* eslint-disable @typescript-eslint/naming-convention */
// src/users/user.schema.ts — schemas live in separate files
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

const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
});
/* eslint-enable @typescript-eslint/naming-convention */

type CreateUserBody = typeof createUserSchema.infer;
type UpdateUserBody = typeof updateUserSchema.infer;
type MigratedUser = typeof userSchema.infer;

// src/users/auth.guard.ts — function-based (simplest)
// eslint-disable-next-line @typescript-eslint/naming-convention
const AuthGuard = createHttpGuard(async (context) => {
  const req = context.getRequest();

  return !!req.headers.get('Authorization');
});

/**
 * The verdict of the class-based guard comes from an injected `@Service()`, because injection is
 * the only thing the class form adds over the function form above — and a guard with no
 * constructor parameters cannot demonstrate it: `executeHttpGuards` falls back to a bare
 * `new guard()` for any class handed to it, so a parameterless guard answers identically whether
 * or not the module resolved its dependencies.
 */
@Service()
class AuthPolicyService extends BaseService {
  /** Every credential the guard handed over, so it is visible which instance decided. */
  readonly checked: (string | null)[] = [];

  isAllowed(authorization: string | null): boolean {
    this.checked.push(authorization);

    return authorization !== null;
  }
}

// Or class-based with DI
@Service()
class HeaderAuthGuard implements HttpGuard {
  constructor(private policy: AuthPolicyService) {}

  async canActivate(context: HttpExecutionContext): Promise<boolean> {
    const req = context.getRequest();

    return this.policy.isAllowed(req.headers.get('Authorization'));
  }
}

@Service()
class MigrationUserService extends BaseService {
  /** What `@Query('page')` actually delivered, so the query wiring is checkable. */
  lastPage: string | undefined;

  private readonly users = new Map<string, MigratedUser>([
    ['u1', { id: 'u1', name: 'Ada', email: 'ada@example.com' }],
  ]);

  private nextId = 2;

  async findAll(page?: string): Promise<MigratedUser[]> {
    // this.logger and this.config are available automatically from BaseService
    this.logger.info('Finding all users');
    this.lastPage = page;

    return [...this.users.values()];
  }

  /** `this.config` read from the service itself — only meaningful when an envSchema is set. */
  pageSize(): number {
    return this.config.get('users.pageSize') as number;
  }

  async findOne(id: string): Promise<MigratedUser | undefined> {
    return this.users.get(id);
  }

  async create(body: CreateUserBody): Promise<MigratedUser> {
    const user: MigratedUser = { id: `u${this.nextId++}`, name: body.name, email: body.email };
    this.users.set(user.id, user);

    return user;
  }

  async update(id: string, body: UpdateUserBody): Promise<MigratedUser> {
    const current = this.users.get(id);
    if (!current) {
      throw new HttpException(404, 'User not found');
    }
    const updated: MigratedUser = { ...current, ...body };
    this.users.set(id, updated);

    return updated;
  }

  async remove(id: string): Promise<void> {
    this.users.delete(id);
  }
}

// src/users/user.controller.ts
@Controller('/users')
class MigrationUserController extends BaseController {
  constructor(private userService: MigrationUserService) {
    super();
  }

  @Get('/')
  @ApiResponse(200, { schema: userSchema.array() })
  async findAll(@Query('page') page?: string) {
    return await this.userService.findAll(page);
  }

  @Get('/:id')
  @ApiResponse(200, { schema: userSchema })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string) {
    const user = await this.userService.findOne(id);
    if (!user) {
      throw new HttpException(404, 'User not found');
    }

    return user;
  }

  @Post('/')
  @UseGuards(AuthGuard)
  @ApiResponse(201, { schema: userSchema })
  async create(@Body(createUserSchema) body: CreateUserBody) {
    return await this.userService.create(body);
  }

  @Put('/:id')
  @UseGuards(AuthGuard)
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: UpdateUserBody,
  ) {
    return await this.userService.update(id, body);
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string) {
    await this.userService.remove(id);

    return { deleted: true };
  }
}

// src/users/user.module.ts — identical in shape to the NestJS original
@Module({
  imports: [],
  controllers: [MigrationUserController],
  providers: [MigrationUserService],
  exports: [MigrationUserService],
})
class MigrationUserModule {}

@Controller('/guarded')
class GuardStyleController extends BaseController {
  @Get('/fn')
  @UseGuards(AuthGuard)
  async viaFunctionGuard() {
    return { reached: 'fn' };
  }

  @Get('/class')
  @UseGuards(HeaderAuthGuard)
  async viaClassGuard() {
    return { reached: 'class' };
  }
}

/**
 * The migration guide's `LoggerMiddleware`, plus one extra line: it also logs the status it
 * got back from `next()`. That is the "Key differences" bullet — `next()` returns the
 * response, there is no separate `res` — and it is otherwise unobservable.
 */
@Middleware()
class MigrationLoggerMiddleware extends BaseMiddleware {
  async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    this.logger.info(`${req.method} ${new URL(req.url).pathname}`);
    const response = await next();
    this.logger.info(`-> ${response.status}`);

    return response;
  }
}

@Controller('/mw')
@UseMiddleware(MigrationLoggerMiddleware)
class MiddlewareUseController extends BaseController {
  @Get('/ping')
  async ping() {
    return { pong: true };
  }
}

@Controller('/mod-a')
class ModuleMiddlewareControllerA extends BaseController {
  @Get('/ping')
  async ping() {
    return { from: 'a' };
  }
}

@Controller('/mod-b')
class ModuleMiddlewareControllerB extends BaseController {
  @Get('/ping')
  async ping() {
    return { from: 'b' };
  }
}

@Controller('/mod-outside')
class SiblingModuleController extends BaseController {
  @Get('/ping')
  async ping() {
    return { from: 'outside' };
  }
}

@Module({ controllers: [ModuleMiddlewareControllerA, ModuleMiddlewareControllerB] })
class ConfiguredMiddlewareModule implements OnModuleConfigure {
  configureMiddleware(): MiddlewareClass[] {
    return [MigrationLoggerMiddleware]; // applied to all controllers in this module
  }
}

@Module({ controllers: [SiblingModuleController] })
class PlainSiblingModule {}

@Controller('/orders')
class ResponsePatternController extends BaseController {
  @Get('/')
  async list(@Query('q') _q?: string) {
    // Return plain data -- auto-wrapped to: { success: true, result: data }
    return [{ id: 'o1' }, { id: 'o2' }];
  }

  @Get('/:id')
  async findOne(@Param('id') _id: string) {
    // Throw for errors -- produces: { success: false, error: 'Not found', code: 404 }
    throw new HttpException(404, 'Not found');
  }
}

@Service()
class BootstrapService extends BaseService {
  pageSize(): number {
    return this.config.get('users.pageSize') as number;
  }
}

/** The trace context each bootstrap request ran in — empty when `tracing.enabled` does nothing. */
const bootstrapTraceIds: (string | null)[] = [];

@Controller('/bootstrap')
class BootstrapController extends BaseController {
  constructor(private bootstrapService: BootstrapService) {
    super();
  }

  @Get('/page-size')
  async pageSize() {
    bootstrapTraceIds.push(getCurrentTraceContext()?.traceId ?? null);

    return { pageSize: this.bootstrapService.pageSize() };
  }
}

@Module({ controllers: [BootstrapController], providers: [BootstrapService] })
class BootstrapModule {}

describe('docs/migration-nestjs.md — Side-by-Side Examples', () => {
  /**
   * @source docs:migration-nestjs.md#crud-controller
   */
  it('serves the ported CRUD controller: query params, 404 envelope, guarded writes, @Body validation', async () => {
    const module = await TestingModule.create({
      controllers: [MigrationUserController],
      providers: [MigrationUserService],
    }).compile();

    try {
      // @Get('/') + @Query('page') + @ApiResponse(200, { schema: userSchema.array() })
      const list = await module.inject('GET', '/users', { query: { page: '2' } });
      expect(list.status).toBe(200);
      expect(await list.json() as SuccessEnvelope<MigratedUser[]>).toEqual({
        success: true,
        result: [{ id: 'u1', name: 'Ada', email: 'ada@example.com' }],
      });
      expect(module.get(MigrationUserService).lastPage).toBe('2');

      // @Get('/:id') — found, and the documented 404 envelope when it is not
      const found = await module.inject('GET', '/users/u1');
      expect(found.status).toBe(200);
      expect((await found.json() as SuccessEnvelope<MigratedUser>).result.name).toBe('Ada');

      const missing = await module.inject('GET', '/users/nope');
      expect(missing.status).toBe(404);
      const missingBody = await missing.json() as ErrorEnvelope;
      expect(missingBody.success).toBe(false);
      expect(missingBody.error).toBe('User not found');
      expect(missingBody.code).toBe(404);

      // @UseGuards(AuthGuard) — the write routes are closed without the header
      const unauthorized = await module.inject('POST', '/users', {
        body: { name: 'Grace', email: 'grace@example.com' },
      });
      expect(unauthorized.status).toBe(403);
      expect((await unauthorized.json() as ErrorEnvelope).error).toBe('Forbidden');

      // @Body(createUserSchema) rejects what the schema forbids, even when authorised
      const invalid = await module.inject('POST', '/users', {
        headers: { authorization: 'Bearer token' },
        body: { name: 'Grace', email: 'grace@example.com', age: -1 },
      });
      expect(invalid.status).toBe(400);
      expect((await invalid.json() as ErrorEnvelope).error).toContain('age');

      // @ApiResponse(201, ...) is the success status of the create route
      const created = await module.inject('POST', '/users', {
        headers: { authorization: 'Bearer token' },
        body: { name: 'Grace', email: 'grace@example.com', age: 45 },
      });
      expect(created.status).toBe(201);
      const createdBody = await created.json() as SuccessEnvelope<MigratedUser>;
      expect(createdBody.result).toEqual({ id: 'u2', name: 'Grace', email: 'grace@example.com' });

      // @Put('/:id') with a partial body
      const updated = await module.inject('PUT', '/users/u2', {
        headers: { authorization: 'Bearer token' },
        body: { name: 'Grace Hopper' },
      });
      expect(updated.status).toBe(200);
      expect((await updated.json() as SuccessEnvelope<MigratedUser>).result).toEqual({
        id: 'u2',
        name: 'Grace Hopper',
        email: 'grace@example.com',
      });

      // @Delete('/:id')
      const removed = await module.inject('DELETE', '/users/u2', {
        headers: { authorization: 'Bearer token' },
      });
      expect(removed.status).toBe(200);
      expect((await removed.json() as SuccessEnvelope<{ deleted: boolean }>).result).toEqual({ deleted: true });
      expect(await module.get(MigrationUserService).findOne('u2')).toBeUndefined();
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:migration-nestjs.md#service
   */
  it('hands a @Service() BaseService subclass a working this.logger and this.config with nothing injected', async () => {
    const logs: LogRecord[] = [];
    // Every application in the process asks TypedEnv for the 'default' config; clear it so this
    // one is built from the schema below rather than from whichever test ran first.
    TypedEnv.clear();
    process.env.ONEBUN_DOCS_MIGRATION_PAGE_SIZE = '7';

    const module = await TestingModule
      .create({ controllers: [MigrationUserController], providers: [MigrationUserService] })
      .setOptions({
        loggerLayer: makeRecordingLoggerLayer(logs),
        envSchema: {
          users: { pageSize: Env.number({ env: 'ONEBUN_DOCS_MIGRATION_PAGE_SIZE', default: 20 }) },
        },
      })
      .compile();

    try {
      await module.inject('GET', '/users');

      // this.logger — the service's own write reached the configured logger, tagged with the
      // service class name the framework attached for it.
      const written = logs.find(entry => entry.message === 'Finding all users');
      expect(written?.level).toBe('info');
      expect(written?.context.className).toBe('MigrationUserService');

      // this.config — read from inside the service, on the env schema the application was given
      expect(module.get(MigrationUserService).pageSize()).toBe(7);
    } finally {
      await module.close();
      delete process.env.ONEBUN_DOCS_MIGRATION_PAGE_SIZE;
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:migration-nestjs.md#module
   */
  it('records the imports/controllers/providers/exports of a @Module and mounts it through imports', async () => {
    expect(getModuleMetadata(MigrationUserModule)).toEqual({
      imports: [],
      controllers: [MigrationUserController],
      providers: [MigrationUserService],
      exports: [MigrationUserService],
    });

    const module = await TestingModule.create({ imports: [MigrationUserModule] }).compile();

    try {
      const list = await module.inject('GET', '/users');
      expect(list.status).toBe(200);
      expect((await list.json() as SuccessEnvelope<MigratedUser[]>).result).toEqual([
        { id: 'u1', name: 'Ada', email: 'ada@example.com' },
      ]);

      // The exported provider is resolvable from the compiled tree, not just constructed
      expect(await module.get(MigrationUserService).findOne('u1')).toEqual({
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com',
      });
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:migration-nestjs.md#guard
   */
  it('denies with 403 and admits on the header — for the function guard and the class guard alike', async () => {
    const module = await TestingModule
      .create({ controllers: [GuardStyleController], providers: [AuthPolicyService] })
      .compile();

    try {
      const fnDenied = await module.inject('GET', '/guarded/fn');
      expect(fnDenied.status).toBe(403);
      expect((await fnDenied.json() as ErrorEnvelope).code).toBe(403);

      const fnAllowed = await module.inject('GET', '/guarded/fn', {
        headers: { authorization: 'Bearer token' },
      });
      expect(fnAllowed.status).toBe(200);
      expect((await fnAllowed.json() as SuccessEnvelope<{ reached: string }>).result.reached).toBe('fn');

      const classDenied = await module.inject('GET', '/guarded/class');
      expect(classDenied.status).toBe(403);

      const classAllowed = await module.inject('GET', '/guarded/class', {
        headers: { authorization: 'Bearer token' },
      });
      expect(classAllowed.status).toBe(200);
      expect((await classAllowed.json() as SuccessEnvelope<{ reached: string }>).result.reached).toBe('class');

      // Both verdicts came out of the module's own AuthPolicyService — the section's claim that
      // `@Service()` is what makes constructor injection work. Without guard DI the parameter is
      // `undefined`, the first request dies on `this.policy.isAllowed` instead of denying, and
      // this singleton never sees a credential.
      expect(module.get(AuthPolicyService).checked).toEqual([null, 'Bearer token']);
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:migration-nestjs.md#middleware
   */
  it('runs the @Middleware() class before the handler and gives it the response back from next()', async () => {
    const logs: LogRecord[] = [];
    const module = await TestingModule
      .create({ controllers: [MiddlewareUseController] })
      .setOptions({ loggerLayer: makeRecordingLoggerLayer(logs) })
      .compile();

    try {
      const response = await module.inject('GET', '/mw/ping');
      expect(response.status).toBe(200);
      // The handler's response travelled back out through the middleware untouched
      expect(await response.json()).toEqual({ success: true, result: { pong: true } });

      const fromMiddleware = logs.filter(entry => entry.context.className === 'MigrationLoggerMiddleware');
      expect(fromMiddleware.map(entry => entry.message)).toEqual(['GET /mw/ping', '-> 200']);
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:migration-nestjs.md#application-bootstrap
   */
  it('boots the module from OneBunApplication options: dotenv config, metrics, tracing, getLogger()', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const logs: LogRecord[] = [];
    bootstrapTraceIds.length = 0;

    // `envOptions.loadDotEnv` is only a promise if the value comes from a .env and from nowhere
    // else — read from `process.env` instead, the option could be deleted and the test stay green.
    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'onebun-docs-migration-boot-'));
    const envFilePath = path.join(tmpDir, '.env');
    fs.writeFileSync(envFilePath, 'ONEBUN_DOCS_MIGRATION_BOOT_PAGE_SIZE=11\n', 'utf8');

    TypedEnv.clear();

    // `port: 0` stands in for the documented 3000 so the suite survives a busy machine, and the
    // metrics prefix is this file's own because prom-client's registry is process-global.
    // System metrics stay off: the application never calls stopSystemMetricsCollection(), so
    // enabling them leaks an interval into the rest of the run.
    const app = new OneBunApplication(BootstrapModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: makeRecordingLoggerLayer(logs),
      envSchema: {
        users: { pageSize: Env.number({ env: 'ONEBUN_DOCS_MIGRATION_BOOT_PAGE_SIZE', default: 20 }) },
      },
      envOptions: { loadDotEnv: true, envFilePath },
      metrics: {
        enabled: true,
        path: '/metrics',
        prefix: 'docsmignest_',
        collectHttpMetrics: true,
        collectSystemMetrics: false,
      },
      tracing: { enabled: true, serviceName: 'my-app' },
      gracefulShutdown: false,
    });

    let url = '';
    try {
      await app.start();
      url = app.getHttpUrl();

      expect(app.getPort()).toBeGreaterThan(0);

      // envSchema + envOptions: the .env value reached a service through this.config, beating
      // the schema default of 20.
      const response = await fetch(`${url}/bootstrap/page-size`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, result: { pageSize: 11 } });

      // tracing — the handler ran inside a trace context with no @onebun/trace import in this file.
      // The context is what is pinned, not the option values: tracing is on unless `enabled: false`,
      // and `serviceName` reaches no observable surface (@onebun/trace builds a default-named tracer
      // provider at import time and OpenTelemetry keeps that first registration), so it is passed as
      // the page prints it and asserted nowhere.
      expect(bootstrapTraceIds).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/)]);

      // metrics — the documented endpoint answers on this app's own port and counts the request just
      // made. The prefix is this file's own, so a matching series also proves these options reached
      // the metrics service instead of a default one.
      const metrics = await fetch(`${url}/metrics`);
      expect(metrics.status).toBe(200);
      expect(await metrics.text()).toMatch(
        /docsmignest_http_requests_total\{[^}]*route="\/bootstrap\/page-size"[^}]*\} 1/,
      );

      // The `.then()` body of the documented bootstrap
      const logger = app.getLogger({ className: 'AppBootstrap' });
      logger.info('Application started');
      expect(logs).toContainEqual({
        level: 'info',
        message: 'Application started',
        context: { className: 'AppBootstrap' },
      });

      await app.stop();
      expect(await fetch(`${url}/bootstrap/page-size`).then(() => 'served', () => 'refused')).toBe('refused');
    } finally {
      await app.stop();
      delete (globalThis as Record<string, unknown>).__onebunMetricsService;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      TypedEnv.clear();
    }
  });
});

describe('docs/migration-nestjs.md — What is Different', () => {
  /**
   * @source docs:migration-nestjs.md#arktype-instead-of-class-validator
   */
  it('turns one schema into runtime validation and the JSON Schema the OpenAPI document uses', async () => {
    // 2. Runtime validation
    expect(validate(createUserSchema, { name: 'Ada', email: 'ada@example.com', age: 36 })).toEqual({
      success: true,
      data: { name: 'Ada', email: 'ada@example.com', age: 36 },
    });

    const rejected = validate(createUserSchema, { name: 'Ada', email: 'ada@example.com', age: 0 });
    expect(rejected.success).toBe(false);
    // `ValidationResult` is an interface with optional members, not the discriminated union
    // docs/api/validation.md prints, so `errors` needs a guard even after `success === false`.
    expect((rejected.errors ?? []).join(' ')).toContain('age');

    // 3. OpenAPI 3.1 schema — generated from the same definition, no @ApiProperty()
    const jsonSchema = getJsonSchema(createUserSchema);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(jsonSchema.type).toBe('object');
    expect(properties.name).toEqual({ type: 'string' });
    expect(properties.email.format).toBe('email');
    expect(properties.age).toEqual({ type: 'number', exclusiveMinimum: 0 });
    // 'age?' is optional in the schema, so it must not be required in the document
    expect([...jsonSchema.required as string[]].sort()).toEqual(['email', 'name']);
  });

  /**
   * @source docs:migration-nestjs.md#response-pattern
   */
  it('auto-wraps a returned value and turns a thrown HttpException into the error envelope', async () => {
    const module = await TestingModule.create({ controllers: [ResponsePatternController] }).compile();

    try {
      const listed = await module.inject('GET', '/orders');
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({
        success: true,
        result: [{ id: 'o1' }, { id: 'o2' }],
      });

      const failed = await module.inject('GET', '/orders/o9');
      expect(failed.status).toBe(404);
      const body = await failed.json() as ErrorEnvelope;
      expect(body.success).toBe(false);
      expect(body.error).toBe('Not found');
      expect(body.code).toBe(404);
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:migration-nestjs.md#module-middleware-configuration
   */
  it('applies configureMiddleware() to every controller of the module and to no other module', async () => {
    const logs: LogRecord[] = [];
    const module = await TestingModule
      .create({ imports: [ConfiguredMiddlewareModule, PlainSiblingModule] })
      .setOptions({ loggerLayer: makeRecordingLoggerLayer(logs) })
      .compile();

    try {
      expect((await module.inject('GET', '/mod-a/ping')).status).toBe(200);
      expect((await module.inject('GET', '/mod-b/ping')).status).toBe(200);
      expect((await module.inject('GET', '/mod-outside/ping')).status).toBe(200);

      const seen = logs
        .filter(entry => entry.context.className === 'MigrationLoggerMiddleware')
        .map(entry => entry.message)
        .filter(message => message.startsWith('GET '));

      // Both controllers of the configuring module, and neither the sibling module's
      expect(seen).toEqual(['GET /mod-a/ping', 'GET /mod-b/ping']);
    } finally {
      await module.close();
    }
  });

  /**
   * @source docs:migration-nestjs.md#testing-approach
   */
  it('starts a real server on a random port, serves the overridden provider, and closes it', async () => {
    const mockService = {
      findAll: async () => [{ id: 'mock', name: 'Mock', email: 'mock@example.com' }],
      findOne: async () => undefined,
    };

    const module: CompiledTestingModule = await TestingModule
      .create({ controllers: [MigrationUserController], providers: [MigrationUserService] })
      .overrideProvider(MigrationUserService).useValue(mockService)
      .compile();

    const port = module.getPort();
    expect(port).toBeGreaterThan(0);

    try {
      const response = await module.inject('GET', '/users');
      expect(response.status).toBe(200);
      // The mock answered, not the real service — its seed row is 'Ada'
      expect((await response.json() as SuccessEnvelope<MigratedUser[]>).result).toEqual([
        { id: 'mock', name: 'Mock', email: 'mock@example.com' },
      ]);
    } finally {
      await module.close();
    }

    // close() releases the listener — the reason the docs insist on it in afterEach
    const afterClose = await fetch(`http://localhost:${port}/users`).then(() => 'served', () => 'refused');
    expect(afterClose).toBe('refused');
  });
});

describe('Quickstart (docs/index.md)', () => {
  // The README's example, verbatim from docs/index.md#quickstart. It is generated INTO the README
  // by scripts/generate-readme.ts, so this test is what stands between npm's front page and a
  // recipe that no longer runs.
  const quickstartUserSchema = type({ name: 'string', email: 'string.email' });
  type QuickstartUserBody = typeof quickstartUserSchema.infer;

  @Service()
  class QuickstartUserService extends BaseService {
    getAll() {
      return [{ id: 1, name: 'Alice' }];
    }
  }

  @Controller('/users')
  class QuickstartUserController extends BaseController {
    constructor(private users: QuickstartUserService) {
      super();
    }

    @Get('/')
    async list() {
      return this.users.getAll();
    }

    @Post('/')
    async create(@Body(quickstartUserSchema) body: QuickstartUserBody) {
      return this.success(body, 201);
    }
  }

  let module: CompiledTestingModule;

  afterEach(async () => {
    await module.close();
  });

  /**
   * @source docs:index.md#quickstart
   */
  it('serves the injected service, validates the body and answers 201 on create', async () => {
    module = await TestingModule
      .create({ controllers: [QuickstartUserController], providers: [QuickstartUserService] })
      .compile();

    // The constructor parameter is the only wiring: no @Inject, no token, no providers lookup.
    const list = await module.inject('GET', '/users');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ success: true, result: [{ id: 1, name: 'Alice' }] });

    // `this.success(body, 201)` is what makes it 201 rather than the default 200.
    const created = await module.inject('POST', '/users', {
      body: { name: 'Bob', email: 'bob@example.com' },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      success: true,
      result: { name: 'Bob', email: 'bob@example.com' },
    });

    // One schema, three jobs — this is the runtime one: `string.email` rejects before the handler.
    const rejected = await module.inject('POST', '/users', {
      body: { name: 'Bob', email: 'not-an-email' },
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ success: false, code: 400 });
  });
});
