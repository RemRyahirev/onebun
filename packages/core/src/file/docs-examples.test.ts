/**
 * Documentation Examples Tests for the docs/examples pages.
 *
 * Pins the sections of the example pages that no `@source`-tagged test named:
 * the entry point of the basic app, the whole CRUD walkthrough, and the
 * multi-service page (config, orchestration, lifecycle, shutdown, service URLs).
 *
 * @source docs:examples/basic-app.md
 * @source docs:examples/crud-api.md
 * @source docs:examples/multi-service.md
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';
import {
  Cause,
  Layer,
  Runtime,
} from 'effect';

import type {
  BeforeApplicationDestroy,
  InferConfigType,
  OnModuleDestroy,
  OnModuleInit,
} from '@onebun/core';
import {
  ApiResponse,
  BaseController,
  BaseService,
  Body,
  Controller,
  createHttpClient,
  Env,
  Get,
  getConfig,
  getCurrentTraceContext,
  HttpException,
  HttpStatusCode,
  isErrorResponse,
  Module,
  OneBunApplication,
  Post,
  Query,
  Service,
  type,
} from '@onebun/core';
import { TypedEnv } from '@onebun/envs';
import type { Logger } from '@onebun/logger';
import { LoggerService } from '@onebun/logger';
import { Span } from '@onebun/trace';

import { createMockLogger } from '../testing';

interface LogRecord {
  level: string;
  message: string;
  args: unknown[];
}

interface RecordingLogger {
  layer: Layer.Layer<Logger, never, never>;
  records: LogRecord[];
  childContexts: Array<Record<string, unknown>>;
}

/**
 * A logger layer that keeps every line the application and its services write, so the
 * documented log statements can be checked instead of merely tolerated.
 */
function createRecordingLoggerLayer(): RecordingLogger {
  const records: LogRecord[] = [];
  const childContexts: Array<Record<string, unknown>> = [];
  const base = createMockLogger();

  const logger: Logger = {
    trace(message: string, ...args: unknown[]) {
      records.push({ level: 'trace', message, args });

      return base.trace(message, ...args);
    },
    debug(message: string, ...args: unknown[]) {
      records.push({ level: 'debug', message, args });

      return base.debug(message, ...args);
    },
    info(message: string, ...args: unknown[]) {
      records.push({ level: 'info', message, args });

      return base.info(message, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      records.push({ level: 'warn', message, args });

      return base.warn(message, ...args);
    },
    error(message: string, ...args: unknown[]) {
      records.push({ level: 'error', message, args });

      return base.error(message, ...args);
    },
    fatal(message: string, ...args: unknown[]) {
      records.push({ level: 'fatal', message, args });

      return base.fatal(message, ...args);
    },
    child(context: Record<string, unknown>) {
      childContexts.push(context);

      return logger;
    },
  };

  return { layer: Layer.succeed(LoggerService, logger), records, childContexts };
}

interface StubService {
  baseUrl: string;
  paths: string[];
  stop(): void;
}

/**
 * A service "running in another process": answers raw JSON, records the paths it was asked for.
 */
function startUsersStub(users: Record<string, { id: string; name: string; email: string }>): StubService {
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url);
      paths.push(url.pathname);
      const id = url.pathname.replace(/^\/users\//, '');
      const user = users[id];

      if (!user) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: HttpStatusCode.NOT_FOUND,
          headers: new Headers([['content-type', 'application/json']]),
        });
      }

      return new Response(JSON.stringify(user), {
        status: HttpStatusCode.OK,
        headers: new Headers([['content-type', 'application/json']]),
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    paths,
    stop: () => server.stop(true),
  };
}

const jsonHeaders = new Headers([['content-type', 'application/json']]);

// ============================================================================
// docs/examples/basic-app.md
// ============================================================================

describe('Basic Application Example (docs/examples/basic-app.md)', () => {
  /**
   * @source docs:examples/basic-app.md#srcindexts
   */
  it('should start the documented entry point with env config, the metrics path and a bootstrap logger', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const seenTraceIds: Array<string | null> = [];

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
        seenTraceIds.push(getCurrentTraceContext()?.traceId ?? null);

        return { message: this.helloService.sayHello(), app: this.config.get('app.name') };
      }
    }

    @Module({ controllers: [HelloController], providers: [HelloService] })
    class AppModule {}

    // From docs: src/config.ts, referenced by src/index.ts as `envSchema`
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

    // `envOptions.loadDotEnv` is checked against a .env of this test's own rather than
    // whatever file the repository happens to carry.
    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'onebun-docs-basic-app-'));
    const envFilePath = path.join(tmpDir, '.env');
    fs.writeFileSync(envFilePath, 'APP_NAME=basic-app-from-dotenv\nDEBUG=true\n', 'utf8');

    // Every application in the process asks TypedEnv for the same config; clear it so this
    // schema and this .env are the ones that get loaded.
    TypedEnv.clear();

    const recording = createRecordingLoggerLayer();

    // From docs: src/index.ts. `port: 0` replaces the documented 3000 so the suite can run on a
    // busy machine, and the metrics prefix is unique because prom-client's registry is global.
    const app = new OneBunApplication(AppModule, {
      port: 0,
      host: '127.0.0.1',
      development: true,
      envSchema,
      envOptions: {
        loadDotEnv: true,
        envFilePath,
      },
      loggerLayer: recording.layer,
      gracefulShutdown: false,
      metrics: {
        enabled: true,
        path: '/metrics',
        prefix: 'docsbasicapp_',
        collectHttpMetrics: true,
        collectSystemMetrics: false,
      },
      tracing: {
        enabled: true,
        serviceName: 'basic-app',
      },
    });

    try {
      await app.start();

      // The documented `envSchema` + `envOptions` pair really loads the .env: the file's value
      // wins over the schema default, and reaches a controller through `this.config`.
      expect(app.getConfigValue<string>('app.name')).toBe('basic-app-from-dotenv');
      expect(app.getConfigValue<boolean>('app.debug')).toBe(true);

      // From docs "Testing the API": curl http://localhost:3000/api/hello
      const hello = await fetch(`${app.getHttpUrl()}/api/hello`);
      expect(hello.status).toBe(HttpStatusCode.OK);
      expect(await hello.json()).toEqual({
        success: true,
        result: { message: 'Hello from OneBun!', app: 'basic-app-from-dotenv' },
      });

      // tracing.enabled: the handler ran inside a trace context
      expect(seenTraceIds).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/)]);

      // metrics.enabled + metrics.path: the documented endpoint serves the request just made
      const metrics = await fetch(`${app.getHttpUrl()}/metrics`);
      expect(metrics.status).toBe(HttpStatusCode.OK);
      expect(await metrics.text()).toMatch(
        /docsbasicapp_http_requests_total\{[^}]*route="\/api\/hello"[^}]*\} 1/,
      );

      // ...and the documented `.then()` continuation has a live logger: getLogger({ className })
      // derives a child that carries the context and actually emits.
      const logger = app.getLogger({ className: 'Bootstrap' });
      logger.info('Basic app started successfully!');

      expect(recording.childContexts).toContainEqual({ className: 'Bootstrap' });
      expect(recording.records).toContainEqual({
        level: 'info',
        message: 'Basic app started successfully!',
        args: [],
      });
    } finally {
      await app.stop();
      TypedEnv.clear();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// docs/examples/crud-api.md
// ============================================================================

// From docs: src/users/schemas/user.schema.ts — shared by the CRUD tests below
/* eslint-disable @typescript-eslint/naming-convention */
const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
  role: '"admin" | "user" | "guest"',
  createdAt: 'string',
  updatedAt: 'string',
});

type User = typeof userSchema.infer;

const createUserSchema = type({
  name: 'string >= 2',
  email: 'string.email',
  'age?': 'number > 0',
  'role?': '"admin" | "user" | "guest"',
});
/* eslint-enable @typescript-eslint/naming-convention */

type CreateUserDto = typeof createUserSchema.infer;

const updateUserSchema = createUserSchema.partial();

const userListSchema = type({
  users: userSchema.array(),
  total: 'number',
  page: 'number',
  limit: 'number',
});

const sampleUser: User = {
  id: 'u-1',
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
  role: 'user',
  createdAt: '2024-01-15T10:30:00.000Z',
  updatedAt: '2024-01-15T10:30:00.000Z',
};

/** From docs: the repository layer the service talks to (Controller → Service → Repository). */
@Service()
class UserRepository extends BaseService {
  private readonly store = new Map<string, User>();
  createCalls = 0;

  async findAll({ page, limit }: { page: number; limit: number }): Promise<{ users: User[]; total: number }> {
    const users = Array.from(this.store.values());

    return { users: users.slice((page - 1) * limit, page * limit), total: users.length };
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.store.values()).find((user) => user.email === email);
  }

  async create(data: CreateUserDto): Promise<User> {
    this.createCalls++;
    const now = '2024-01-15T10:30:00.000Z';
    const user: User = {
      id: `u-${this.store.size + 1}`,
      name: data.name,
      email: data.email,
      ...(data.age === undefined ? {} : { age: data.age }),
      role: data.role ?? 'user',
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(user.id, user);

    return user;
  }
}

// From docs: src/users/users.service.ts (excerpt — create method)
@Service()
class UserService extends BaseService {
  constructor(private userRepository: UserRepository) {
    super();
  }

  async findAll(page = 1, limit = 10): Promise<{ users: User[]; total: number; page: number; limit: number }> {
    const { users, total } = await this.userRepository.findAll({ page, limit });

    return {
      users, total, page, limit, 
    };
  }

  @Span('user-create')
  async create(data: CreateUserDto): Promise<User> {
    this.logger.info('Creating user', { email: data.email });

    // Check for duplicate email
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) {
      this.logger.warn('Duplicate email', { email: data.email });
      throw new Error('Email already exists');
    }

    const user = await this.userRepository.create(data);
    this.logger.info('User created', { userId: user.id, email: user.email });

    return user;
  }
}

// From docs: src/users/users.controller.ts (excerpt)
@Controller('/api/users')
class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  @ApiResponse(200, { schema: userListSchema, description: 'List of users' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    if (pageNum < 1) {
      throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Page must be >= 1');
    }
    if (limitNum < 1 || limitNum > 100) {
      throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Limit must be between 1 and 100');
    }

    return await this.userService.findAll(pageNum, limitNum);
  }

  @Post('/')
  @ApiResponse(201, { schema: userSchema, description: 'User created' })
  @ApiResponse(400, { description: 'Validation error' })
  @ApiResponse(409, { description: 'Email already exists' })
  async create(@Body(createUserSchema) body: CreateUserDto) {
    try {
      const user = await this.userService.create(body);

      return this.success(user, HttpStatusCode.CREATED);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new HttpException(HttpStatusCode.CONFLICT, 'Email already exists');
      }
      throw error;
    }
  }
}

// From docs: src/users/users.module.ts
@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository],
  exports: [UserService],
})
class UserModule {}

describe('CRUD API Example (docs/examples/crud-api.md)', () => {
  /**
   * @source docs:examples/crud-api.md#configuration
   */
  it('should resolve the documented typed config from ENV and defaults', async () => {
    // From docs: src/config.ts
    const envSchema = {
      server: {
        port: Env.number({ default: 3000 }),
        host: Env.string({ default: '0.0.0.0' }),
      },
      app: {
        name: Env.string({ default: 'crud-api' }),
      },
    };

    type AppConfig = InferConfigType<typeof envSchema>;

    // `InferConfigType` maps every declaration to the value it parses to — a plain object of
    // number/string, not the EnvVariableConfig it was written as. The annotation is a compile-time
    // witness enforced by `bun run typecheck`; the runtime half is asserted below against the
    // object the schema actually parses to.
    const documentedShape: AppConfig = { server: { port: 3000, host: '0.0.0.0' }, app: { name: 'crud-api' } };

    // No `env:` is given, so each variable name is the uppercased path: server.port ← SERVER_PORT.
    const config = getConfig<AppConfig>(envSchema, {
      loadDotEnv: false,
      valueOverrides: {
         
        SERVER_PORT: '4321',
         
        SERVER_HOST: '127.0.0.1',
         
        APP_NAME: 'crud-api-from-env',
      },
    });

    expect(config.get('server.port')).toBe(4321);
    expect(config.get('server.host')).toBe('127.0.0.1');
    expect(config.get('app.name')).toBe('crud-api-from-env');

    // ...and the documented defaults stand in when nothing sets the variable. Declared against
    // names nothing in this process can set, so the ambient environment cannot decide the result.
    const defaults = getConfig<AppConfig>({
      server: {
        port: Env.number({ default: 3000, env: 'ONEBUN_DOCS_CRUD_PORT' }),
        host: Env.string({ default: '0.0.0.0', env: 'ONEBUN_DOCS_CRUD_HOST' }),
      },
      app: {
        name: Env.string({ default: 'crud-api', env: 'ONEBUN_DOCS_CRUD_APP_NAME' }),
      },
    }, { loadDotEnv: false });

    expect(defaults.get('server.port')).toBe(3000);
    expect(defaults.get('app.name')).toBe('crud-api');

    // ...and the whole config is the parsed shape the annotation above declares: number/string
    // leaves under the documented nesting, with no declaration objects and no extra keys.
    expect(defaults.values).toEqual(documentedShape);

    // "This enables typed access to this.config.get() everywhere": the same schema handed to the
    // application is what a controller reads through `this.config`.
    @Controller('/config')
    class ConfigController extends BaseController {
      @Get('/')
      async read() {
        return { name: this.config.get('app.name') };
      }
    }

    @Module({ controllers: [ConfigController] })
    class ConfigModule {}

    TypedEnv.clear();
    const app = new OneBunApplication(ConfigModule, {
      port: 0,
      host: '127.0.0.1',
      envSchema,
      envOptions: {
        loadDotEnv: false,
         
        valueOverrides: { APP_NAME: 'crud-api-in-controller' },
      },
      loggerLayer: createRecordingLoggerLayer().layer,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const response = await fetch(`${app.getHttpUrl()}/config`);

      expect(await response.json()).toEqual({ success: true, result: { name: 'crud-api-in-controller' } });
    } finally {
      await app.stop();
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:examples/crud-api.md#validation-with-arktype
   */
  it('should accept and reject values as the documented schemas declare', async () => {
    const { validate } = await import('@onebun/core');

    // userSchema: the full entity round-trips unchanged
    expect(validate(userSchema, sampleUser)).toEqual({ success: true, data: sampleUser });

    // 'string.email' is a real constraint, not documentation
    expect(validate(userSchema, { ...sampleUser, email: 'not-an-email' }).success).toBe(false);

    // role is the documented literal union
    expect(validate(userSchema, { ...sampleUser, role: 'root' }).success).toBe(false);

    // 'age?' is optional, but when present must satisfy 'number > 0'
    const withoutAge = { ...sampleUser };
    delete withoutAge.age;
    expect(validate(userSchema, withoutAge)).toEqual({ success: true, data: withoutAge });
    expect(validate(userSchema, { ...sampleUser, age: 0 }).success).toBe(false);

    // createUserSchema: 'string >= 2' rejects a one-character name, and id/createdAt are not asked for
    expect(validate(createUserSchema, { name: 'J', email: 'john@example.com' }).success).toBe(false);
    expect(validate(createUserSchema, { name: 'Jo', email: 'john@example.com' })).toEqual({
      success: true,
      data: { name: 'Jo', email: 'john@example.com' },
    });

    // updateUserSchema = createUserSchema.partial(): every field optional...
    expect(validate(updateUserSchema, {})).toEqual({ success: true, data: {} });
    expect(validate(updateUserSchema, { name: 'John Smith' })).toEqual({
      success: true,
      data: { name: 'John Smith' },
    });

    // ...but the constraints of the fields that ARE present survive the .partial()
    expect(validate(updateUserSchema, { name: 'J' }).success).toBe(false);
    expect(validate(updateUserSchema, { email: 'nope' }).success).toBe(false);

    // userListSchema wraps the entity schema, so a bad member fails the whole page
    const page = {
      users: [sampleUser], total: 1, page: 1, limit: 10, 
    };
    expect(validate(userListSchema, page)).toEqual({ success: true, data: page });
    expect(validate(userListSchema, { ...page, users: [{ ...sampleUser, role: 'root' }] }).success).toBe(false);
    expect(validate(userListSchema, { users: [sampleUser], total: 1, page: 1 }).success).toBe(false);
  });

  /**
   * @source docs:examples/crud-api.md#service-layer
   */
  it('should create through the repository, refuse a duplicate email and log both outcomes', async () => {
    @Module({ providers: [UserService, UserRepository] })
    class ServiceLayerModule {}

    const recording = createRecordingLoggerLayer();
    const app = new OneBunApplication(ServiceLayerModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: recording.layer,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      const service = app.getService(UserService);
      const repository = app.getService(UserRepository);

      // The @Span('user-create') wrapper returns what the method returns
      const created = await service.create({ name: 'John Doe', email: 'john@example.com', age: 30 });

      expect(created).toMatchObject({
        name: 'John Doe', email: 'john@example.com', age: 30, role: 'user', 
      });
      expect(repository.createCalls).toBe(1);

      // The duplicate check runs before the repository is asked to insert
      await expect(
        service.create({ name: 'John Twin', email: 'john@example.com' }),
      ).rejects.toThrow('Email already exists');
      expect(repository.createCalls).toBe(1);

      // ...and the structured logs the page shows are really written
      expect(recording.records).toContainEqual({
        level: 'info',
        message: 'Creating user',
        args: [{ email: 'john@example.com' }],
      });
      expect(recording.records).toContainEqual({
        level: 'info',
        message: 'User created',
        args: [{ userId: created.id, email: 'john@example.com' }],
      });
      expect(recording.records).toContainEqual({
        level: 'warn',
        message: 'Duplicate email',
        args: [{ email: 'john@example.com' }],
      });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:examples/crud-api.md#controller
   */
  it('should serve the documented CRUD routes with validation, 201 and 409', async () => {
    @Module({ controllers: [UserController], providers: [UserService, UserRepository] })
    class ControllerModule {}

    const app = new OneBunApplication(ControllerModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: createRecordingLoggerLayer().layer,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const baseUrl = app.getHttpUrl();
      const repository = app.getService(UserRepository);

      // From docs "API Testing": POST /api/users
      const created = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'John Doe', email: 'john@example.com', age: 30 }),
      });

      // this.success(user, HttpStatusCode.CREATED) — the 201 the @ApiResponse documents
      expect(created.status).toBe(HttpStatusCode.CREATED);
      const createdBody = await created.json() as { success: boolean; result: User };
      expect(createdBody.success).toBe(true);
      expect(createdBody.result).toMatchObject({ name: 'John Doe', email: 'john@example.com', role: 'user' });

      // @Body(createUserSchema) rejects before the handler runs: a one-character name is 400
      // and never reaches the repository
      const invalid = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'J', email: 'john2@example.com' }),
      });
      expect(invalid.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await invalid.json()).toMatchObject({ success: false });
      expect(repository.createCalls).toBe(1);

      // The duplicate is turned into the documented 409
      const duplicate = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'John Twin', email: 'john@example.com' }),
      });
      expect(duplicate.status).toBe(HttpStatusCode.CONFLICT);
      expect(await duplicate.json()).toMatchObject({ success: false, error: 'Email already exists' });

      // GET /api/users?page=1&limit=5 — the paging arguments reach the service
      const list = await fetch(`${baseUrl}/api/users?page=1&limit=5`);
      expect(list.status).toBe(HttpStatusCode.OK);
      expect(await list.json()).toEqual({
        success: true,
        result: {
          users: [createdBody.result], total: 1, page: 1, limit: 5, 
        },
      });

      // ...and defaults apply when they are omitted
      expect(await (await fetch(`${baseUrl}/api/users`)).json()).toEqual({
        success: true,
        result: {
          users: [createdBody.result], total: 1, page: 1, limit: 10, 
        },
      });

      // The documented guards answer 400 with their own messages
      const badPage = await fetch(`${baseUrl}/api/users?page=0`);
      expect(badPage.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await badPage.json()).toMatchObject({ success: false, error: 'Page must be >= 1' });

      const badLimit = await fetch(`${baseUrl}/api/users?limit=101`);
      expect(badLimit.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await badLimit.json()).toMatchObject({
        success: false,
        error: 'Limit must be between 1 and 100',
      });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:examples/crud-api.md#modules-and-entry-point
   */
  it('should mount the imported module and share its exported service', async () => {
    // From docs: src/app.module.ts — AppModule declares no controllers of its own, it imports
    // UserModule; the extra controller here consumes UserModule's `exports: [UserService]`.
    @Controller('/api/stats')
    class StatsController extends BaseController {
      constructor(private userService: UserService) {
        super();
      }

      @Get('/')
      async stats() {
        const { total } = await this.userService.findAll(1, 100);

        return { total };
      }
    }

    @Module({
      imports: [UserModule],
      controllers: [StatsController],
    })
    class AppModule {}

    // From docs: src/index.ts
    const app = new OneBunApplication(AppModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: createRecordingLoggerLayer().layer,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      // `app.getHttpUrl()` — what the documented bootstrap logs — is the address that answers, and
      // `getPort()` reports the port `port: 0` was actually bound to, not the 0 that was asked for:
      // an address built from it reaches this app's own routes. (The URL itself is exercised by
      // every fetch below, which goes through `app.getHttpUrl()`.)
      const emptyStats = await fetch(`http://127.0.0.1:${app.getPort()}/api/stats`);

      expect(await emptyStats.json()).toEqual({ success: true, result: { total: 0 } });

      // imports: [UserModule] mounts the imported module's controllers
      const created = await fetch(`${app.getHttpUrl()}/api/users`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'John Doe', email: 'john@example.com' }),
      });
      expect(created.status).toBe(HttpStatusCode.CREATED);

      // exports: [UserService] — the importing module's own controller gets the SAME instance,
      // so it sees the user that was just created through UserModule's controller
      const stats = await fetch(`${app.getHttpUrl()}/api/stats`);
      expect(await stats.json()).toEqual({ success: true, result: { total: 1 } });
    } finally {
      await app.stop();
    }
  });
});

// ============================================================================
// docs/examples/multi-service.md
// ============================================================================

interface Order {
  id: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  total: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
}

describe('Multi-Service Example (docs/examples/multi-service.md)', () => {
  /**
   * @source docs:examples/multi-service.md#configuration
   */
  it('should bind per-service ports to their ENV names and mask the sensitive URLs', async () => {
    // From docs: src/config.ts
    const envSchema = {
      app: {
        name: Env.string({ default: 'multi-service' }),
        environment: Env.string({ default: 'development' }),
      },
      users: {
        port: Env.number({ default: 3001, env: 'USERS_PORT' }),
        database: {
          url: Env.string({ env: 'USERS_DATABASE_URL', sensitive: true }),
        },
      },
      orders: {
        port: Env.number({ default: 3002, env: 'ORDERS_PORT' }),
        database: {
          url: Env.string({ env: 'ORDERS_DATABASE_URL', sensitive: true }),
        },
      },
      usersServiceUrl: Env.string({ default: 'http://localhost:3001', env: 'USERS_SERVICE_URL' }),
    };

    type AppConfig = InferConfigType<typeof envSchema>;

    // The documented defaults, with nothing set
    const defaults = getConfig<AppConfig>(envSchema, { loadDotEnv: false });
    expect(defaults.get('users.port')).toBe(3001);
    expect(defaults.get('orders.port')).toBe(3002);
    expect(defaults.get('usersServiceUrl')).toBe('http://localhost:3001');
    expect(defaults.get('app.name')).toBe('multi-service');

    // ...and the `env:` names from the page's .env section, each feeding its own path
    const configured = getConfig<AppConfig>({ ...envSchema }, {
      loadDotEnv: false,
      valueOverrides: {
         
        USERS_PORT: '3101',
         
        ORDERS_PORT: '3102',
         
        USERS_DATABASE_URL: 'postgres://localhost:5432/users_db',
         
        ORDERS_DATABASE_URL: 'postgres://localhost:5432/orders_db',
         
        USERS_SERVICE_URL: 'http://users-service:3001',
      },
    });

    expect(configured.get('users.port')).toBe(3101);
    expect(configured.get('orders.port')).toBe(3102);
    expect(configured.get('usersServiceUrl')).toBe('http://users-service:3001');

    // `sensitive: true` is not decoration: the value is wrapped so it prints as *** while the
    // real URL stays reachable, and getSafeConfig() masks it for logging.
    expect(String(configured.get('users.database.url'))).toBe('***');
    expect(JSON.stringify({ url: configured.get('orders.database.url') })).toBe('{"url":"***"}');
    expect(configured.values.users.database.url).toBe('postgres://localhost:5432/users_db');
    expect(configured.getSafeConfig().orders.database.url).toBe('***');

    // ...while a non-sensitive neighbour is untouched by the mask
    expect(configured.getSafeConfig().usersServiceUrl).toBe('http://users-service:3001');
  });

  /**
   * @source docs:examples/multi-service.md#application-entry-point
   */
  it('should run each service on its configured port, behind its own prefix and metrics prefix', async () => {
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
    class UserModuleForEntryPoint {}

    @Module({ controllers: [OrdersController] })
    class OrderModuleForEntryPoint {}

    const envSchema = {
      users: { port: Env.number({ default: 3001, env: 'USERS_PORT' }) },
      orders: { port: Env.number({ default: 3002, env: 'ORDERS_PORT' }) },
    };

    type AppConfig = InferConfigType<typeof envSchema>;

    // From docs: src/index.ts — `getConfig` supplies the ports the services map uses.
    // The documented 3001/3002 become 0 so the suite can run on a busy machine; what is under
    // test is that the value config.get() returns is the port each service is started with.
    const config = getConfig<AppConfig>(envSchema, {
      loadDotEnv: false,
       
      valueOverrides: { USERS_PORT: '0', ORDERS_PORT: '0' },
    });

    expect(config.get('users.port')).toBe(0);
    expect(config.get('orders.port')).toBe(0);

    TypedEnv.clear();

    const app = new OneBunApplication({
      services: {
        users: {
          module: UserModuleForEntryPoint,
          port: config.get('users.port'),
          routePrefix: true,
          metrics: { prefix: 'docsmsusers_' },
        },
        orders: {
          module: OrderModuleForEntryPoint,
          port: config.get('orders.port'),
          routePrefix: true,
          metrics: { prefix: 'docsmsorders_' },
        },
      },
      host: '127.0.0.1',
      envSchema,
      envOptions: { loadDotEnv: false },
      externalServiceUrls: {
        users: 'http://users-service:3001',
      },
      // Enabled because the page's per-service `metrics.prefix` is only observable when metrics
      // are on; system metrics stay off since prom-client's registry is process-global.
      metrics: { enabled: true, collectHttpMetrics: true, collectSystemMetrics: false },
      tracing: { enabled: false },
      logger: { minLevel: 'fatal' },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      // Both services run in this one process, each on its own port
      expect(app.getRunningServices().sort()).toEqual(['orders', 'users']);
      const usersUrl = app.getServiceUrl('users');
      const ordersUrl = app.getServiceUrl('orders');
      expect(usersUrl).not.toBe(ordersUrl);

      // A locally running service answers at its LOCAL url even though externalServiceUrls
      // names it — the external entry is the fallback, not an override
      expect(usersUrl).toBe(`http://127.0.0.1:${app.getApplication('users')!.getPort()}`);
      expect(usersUrl).not.toBe('http://users-service:3001');

      // routePrefix: true mounts each service under its own name
      const users = await fetch(`${usersUrl}/users/profile`);
      expect(users.status).toBe(HttpStatusCode.OK);
      expect(await users.json()).toEqual({ success: true, result: { service: 'users' } });

      const orders = await fetch(`${ordersUrl}/orders/basket`);
      expect(await orders.json()).toEqual({ success: true, result: { service: 'orders' } });

      // "metrics.prefix is not affected and is honoured as written" — each service's counters
      // carry the prefix it was configured with
      const metrics = await fetch(`${usersUrl}/metrics`);
      expect(metrics.status).toBe(HttpStatusCode.OK);
      const metricsText = await metrics.text();
      expect(metricsText).toMatch(
        /docsmsusers_http_requests_total\{[^}]*route="\/users\/profile"[^}]*\} 1/,
      );
      expect(metricsText).toMatch(
        /docsmsorders_http_requests_total\{[^}]*route="\/orders\/basket"[^}]*\} 1/,
      );
    } finally {
      await app.stop();
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:examples/multi-service.md#inter-service-communication
   */
  it('should verify the user through the users service before creating an order', async () => {
    const usersStub = startUsersStub({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'u-1': { id: 'u-1', name: 'Ada', email: 'ada@example.com' },
    });

    interface UpstreamUser {
      id: string;
      name: string;
      email: string;
    }

    // From docs: src/orders/orders.service.ts (excerpt)
    @Service()
    class OrderService extends BaseService {
      private orders = new Map<string, Order>();
      private readonly usersClient;

      constructor() {
        super();
        this.usersClient = createHttpClient({
          baseUrl: this.config.get('usersServiceUrl') as string,
        });
      }

      @Span('order-create')
      async create(data: {
        userId: string;
        items: Array<{ productId: string; quantity: number; price: number }>;
      }): Promise<Order> {
        // Verify user exists by calling Users service
        const userResponse = await this.usersClient.get<UpstreamUser>(`/users/${data.userId}`);

        if (isErrorResponse(userResponse)) {
          this.logger.warn('User not found', { userId: data.userId });
          throw new Error('User not found');
        }

        const user = userResponse.result;
        this.logger.info('User verified', { userId: user.id, name: user.name });

        const total = data.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
        const order: Order = {
          id: crypto.randomUUID(),
          userId: data.userId,
          items: data.items.map(({ productId, quantity }) => ({ productId, quantity })),
          total,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        this.orders.set(order.id, order);

        return order;
      }
    }

    @Module({ providers: [OrderService] })
    class OrderModuleForCommunication {}

    const recording = createRecordingLoggerLayer();

    TypedEnv.clear();
    const app = new OneBunApplication(OrderModuleForCommunication, {
      port: 0,
      host: '127.0.0.1',
      envSchema: {
        usersServiceUrl: Env.string({ default: 'http://localhost:3001', env: 'USERS_SERVICE_URL' }),
      },
      envOptions: {
        loadDotEnv: false,
         
        valueOverrides: { USERS_SERVICE_URL: usersStub.baseUrl },
      },
      loggerLayer: recording.layer,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const service = app.getService(OrderService);

      const order = await service.create({
        userId: 'u-1',
        items: [
          { productId: 'prod-1', quantity: 2, price: 29.99 },
          { productId: 'prod-2', quantity: 1, price: 49.99 },
        ],
      });

      // The client built from `this.config.get('usersServiceUrl')` really called the users service
      expect(usersStub.paths).toEqual(['/users/u-1']);

      // `userResponse.result` is the upstream user — the page logs its id and name
      expect(recording.records).toContainEqual({
        level: 'info',
        message: 'User verified',
        args: [{ userId: 'u-1', name: 'Ada' }],
      });

      // ...and the order the excerpt goes on to build
      expect(order).toMatchObject({
        userId: 'u-1',
        status: 'pending',
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 },
        ],
      });
      expect(order.total).toBeCloseTo(109.97, 5);

      // An unknown user aborts the creation — but NOT through the branch the page shows. The
      // Promise API rejects on an HTTP failure instead of returning an ErrorResponse (see
      // docs/api/requests.md#reading-the-errorresponse), so `isErrorResponse(userResponse)` is
      // never reached: the awaited call throws first, and the documented warning is not written.
      const failure = await service.create({ userId: 'u-404', items: [] })
        .then(() => null, (error: unknown) => error);

      expect(usersStub.paths).toEqual(['/users/u-1', '/users/u-404']);
      expect(Runtime.isFiberFailure(failure)).toBe(true);

      const squashed = Runtime.isFiberFailure(failure)
        ? Cause.squash(failure[Runtime.FiberFailureCauseId])
        : failure;

      expect(isErrorResponse(squashed)).toBe(true);
      expect(isErrorResponse(squashed) ? squashed.code : undefined).toBe(HttpStatusCode.NOT_FOUND);
      expect(recording.records).not.toContainEqual({
        level: 'warn',
        message: 'User not found',
        args: [{ userId: 'u-404' }],
      });
    } finally {
      await app.stop();
      TypedEnv.clear();
      usersStub.stop();
    }
  });

  /**
   * @source docs:examples/multi-service.md#implementing-lifecycle-hooks
   */
  it('should run the lifecycle hooks in the documented order and let the service clear its timer', async () => {
    const calls: string[] = [];

    // From docs: the OrderService that implements the three hooks
    @Service()
    class OrderLifecycleService extends BaseService
      implements OnModuleInit, OnModuleDestroy, BeforeApplicationDestroy {

      private cleanupInterval: ReturnType<typeof setInterval> | null = null;

      async onModuleInit(): Promise<void> {
        calls.push('onModuleInit');
        this.cleanupInterval = setInterval(() => {
          this.cleanupExpiredOrders();
        }, 60000);
      }

      async beforeApplicationDestroy(signal?: string): Promise<void> {
        calls.push(`beforeApplicationDestroy:${String(signal)}`);
      }

      async onModuleDestroy(): Promise<void> {
        calls.push('onModuleDestroy');

        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = null;
        }
      }

      hasCleanupTimer(): boolean {
        return this.cleanupInterval !== null;
      }

      private cleanupExpiredOrders(): void {
        calls.push('cleanupExpiredOrders');
      }
    }

    @Module({ providers: [OrderLifecycleService] })
    class LifecycleModule {}

    const app = new OneBunApplication(LifecycleModule, {
      port: 0,
      host: '127.0.0.1',
      loggerLayer: createRecordingLoggerLayer().layer,
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });

    await app.start();
    const service = app.getService(OrderLifecycleService);

    // "Called after DI resolution — set up resources": the hook ran and the timer is live
    expect(calls).toEqual(['onModuleInit']);
    expect(service.hasCleanupTimer()).toBe(true);

    await app.stop();

    // beforeApplicationDestroy runs first, onModuleDestroy after — the order the reference table
    // gives — and the destroy hook really cleared the interval
    expect(calls).toEqual(['onModuleInit', 'beforeApplicationDestroy:undefined', 'onModuleDestroy']);
    expect(service.hasCleanupTimer()).toBe(false);
  });

  /**
   * @source docs:examples/multi-service.md#programmatic-shutdown
   */
  it('should stop every service on app.stop() and free their ports', async () => {
    const destroyed: string[] = [];

    @Service()
    class UsersShutdownService extends BaseService implements OnModuleDestroy, BeforeApplicationDestroy {
      async beforeApplicationDestroy(signal?: string): Promise<void> {
        destroyed.push(`users:before:${String(signal)}`);
      }

      async onModuleDestroy(): Promise<void> {
        destroyed.push('users:destroy');
      }
    }

    @Service()
    class OrdersShutdownService extends BaseService implements OnModuleDestroy {
      async onModuleDestroy(): Promise<void> {
        destroyed.push('orders:destroy');
      }
    }

    @Controller('/ping')
    class UsersPingController extends BaseController {
      @Get('/')
      async ping() {
        return { service: 'users' };
      }
    }

    @Module({ controllers: [UsersPingController], providers: [UsersShutdownService] })
    class UserModuleForShutdown {}

    @Module({ providers: [OrdersShutdownService] })
    class OrderModuleForShutdown {}

    TypedEnv.clear();

    // From docs: the programmatic-shutdown snippet (ports 3001/3002 → 0 for the suite)
    const app = new OneBunApplication({
      services: {
        users: { module: UserModuleForShutdown, port: 0 },
        orders: { module: OrderModuleForShutdown, port: 0 },
      },
      host: '127.0.0.1',
      envSchema: { app: { name: Env.string({ default: 'multi-service' }) } },
      envOptions: { loadDotEnv: false },
      metrics: { enabled: false },
      tracing: { enabled: false },
      logger: { minLevel: 'fatal' },
      gracefulShutdown: false,
    });

    try {
      await app.start();
      const usersUrl = app.getServiceUrl('users');
      expect((await fetch(`${usersUrl}/ping`)).status).toBe(HttpStatusCode.OK);

      // Programmatic stop — all services shut down gracefully
      await app.stop();

      expect(app.getRunningServices()).toEqual([]);
      expect(app.isServiceRunning('users')).toBe(false);
      expect(app.isServiceRunning('orders')).toBe(false);

      // Every service really tore down: the hooks ran on both, and the parent forwards no signal
      expect(destroyed.sort()).toEqual([
        'orders:destroy',
        'users:before:undefined',
        'users:destroy',
      ]);

      // ...and the listener is gone, not merely marked stopped
      await expect(fetch(`${usersUrl}/ping`)).rejects.toThrow();
    } finally {
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:examples/multi-service.md#built-in-options
   */
  it('should start only the services enabledServices/excludedServices leave standing', async () => {
    @Controller('/ping')
    class PingController extends BaseController {
      @Get('/')
      async ping() {
        return { ok: true };
      }
    }

    @Module({ controllers: [PingController] })
    class UsersOptionModule {}

    @Module({ controllers: [PingController] })
    class OrdersOptionModule {}

    @Module({ controllers: [PingController] })
    class PaymentsOptionModule {}

    const services = {
      users: { module: UsersOptionModule, port: 0 },
      orders: { module: OrdersOptionModule, port: 0 },
      payments: { module: PaymentsOptionModule, port: 0 },
    };

    TypedEnv.clear();

    // enabledServices: "if set, only these services run"
    const enabledOnly = new OneBunApplication({
      services,
      host: '127.0.0.1',
      enabledServices: ['users'],
      metrics: { enabled: false },
      tracing: { enabled: false },
      logger: { minLevel: 'fatal' },
      gracefulShutdown: false,
    });

    try {
      await enabledOnly.start();
      expect(enabledOnly.getRunningServices()).toEqual(['users']);
      expect(enabledOnly.isServiceRunning('orders')).toBe(false);

      // The service that did start is a real server; the ones filtered out have no URL at all
      expect((await fetch(`${enabledOnly.getServiceUrl('users')}/ping`)).status).toBe(HttpStatusCode.OK);
      expect(() => enabledOnly.getServiceUrl('payments')).toThrow(/not available/);
    } finally {
      await enabledOnly.stop();
      TypedEnv.clear();
    }

    // excludedServices: "list of service names to exclude from starting"
    const excluded = new OneBunApplication({
      services,
      host: '127.0.0.1',
      excludedServices: ['payments'],
      metrics: { enabled: false },
      tracing: { enabled: false },
      logger: { minLevel: 'fatal' },
      gracefulShutdown: false,
    });

    try {
      await excluded.start();
      expect(excluded.getRunningServices().sort()).toEqual(['orders', 'users']);
      expect(excluded.isServiceRunning('payments')).toBe(false);
    } finally {
      await excluded.stop();
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:examples/multi-service.md#inter-service-communication-1
   */
  it('should hand out the external URL for a service running elsewhere and the local one otherwise', async () => {
    const usersStub = startUsersStub({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'u-7': { id: 'u-7', name: 'Grace', email: 'grace@example.com' },
    });

    @Controller('/basket')
    class OrdersController extends BaseController {
      @Get('/')
      async basket() {
        return { service: 'orders' };
      }
    }

    @Module({ controllers: [OrdersController] })
    class OrderModuleForUrls {}

    @Module({})
    class UserModuleForUrls {}

    TypedEnv.clear();

    // "When a service runs in a separate process, use externalServiceUrls to configure URLs"
    const app = new OneBunApplication({
      services: {
        users: { module: UserModuleForUrls, port: 0 },
        orders: { module: OrderModuleForUrls, port: 0 },
      },
      host: '127.0.0.1',
      enabledServices: ['orders'],
      externalServiceUrls: { users: usersStub.baseUrl },
      metrics: { enabled: false },
      tracing: { enabled: false },
      logger: { minLevel: 'fatal' },
      gracefulShutdown: false,
    });

    try {
      await app.start();

      // getServiceUrl returns externalServiceUrls.users for the service that is not local...
      expect(app.getRunningServices()).toEqual(['orders']);
      expect(app.getServiceUrl('users')).toBe(usersStub.baseUrl);

      // ...and the local URL for the one that is
      expect(app.getServiceUrl('orders')).toBe(`http://127.0.0.1:${app.getApplication('orders')!.getPort()}`);
      expect((await fetch(`${app.getServiceUrl('orders')}/basket`)).status).toBe(HttpStatusCode.OK);

      // From docs: the client built on that URL reaches the remote service
      const usersClient = createHttpClient({ baseUrl: app.getServiceUrl('users') });
      const user = await usersClient.get<{ id: string; name: string }>('/users/u-7');

      expect(isErrorResponse(user)).toBe(false);
      expect(usersStub.paths).toEqual(['/users/u-7']);
      expect(user).toMatchObject({
        success: true,
        result: { id: 'u-7', name: 'Grace' },
      });
    } finally {
      await app.stop();
      TypedEnv.clear();
      usersStub.stop();
    }
  });
});
