/**
 * Documentation example tests for the application- and middleware-level sections of
 * `docs/api/controllers.md` and `docs/api/core.md`.
 *
 * The compile gate already proves these snippets typecheck. Every test here asserts what the
 * prose PROMISES instead: the status the request comes back with, the order the middleware
 * actually ran in, the instance the container actually injected.
 *
 * Imports go through the public specifier `@onebun/core` wherever the documentation tells the
 * reader to, so a symbol dropped from the barrel fails here instead of silently resolving
 * through a deep path.
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';
import * as effect from 'effect';

import type { Context } from 'effect';

import type {
  ApplicationOptions,
  MiddlewareClass,
  OnModuleConfigure,
  OneBunRequest,
  OneBunResponse,
} from '@onebun/core';
import {
  BaseController,
  BaseMiddleware,
  BaseService,
  Body,
  Controller,
  createHttpClient,
  Delete,
  Effect,
  Env,
  EnvValidationError,
  Get,
  getControllerMetadata,
  getServiceTag,
  Header,
  HttpException,
  HttpMethod,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  Layer,
  Middleware,
  Module,
  NotFoundError,
  OneBunApplication,
  OneBunBaseError,
  OneBunModule,
  Param,
  Post,
  Put,
  Query,
  Service,
  type,
  UseMiddleware,
  validate,
} from '@onebun/core';
import { makeMockLoggerLayer } from '@onebun/core/testing';
import * as envs from '@onebun/envs';
import { TypedEnv } from '@onebun/envs';
import { LoggerService, type Logger } from '@onebun/logger';
import * as requests from '@onebun/requests';


// ============================================================================
// Harness
// ============================================================================

interface LogRecord {
  level: string;
  message: string;
  context: Record<string, unknown>;
}

/**
 * A logger layer that keeps every write. The silent mock cannot answer "which class was
 * this logger scoped to", which is exactly what the BaseMiddleware section promises.
 */
function recordingLoggerLayer(sink: LogRecord[]): Layer.Layer<Logger> {
  const make = (context: Record<string, unknown>): Logger => {
    const record = (level: string) => (message: string) =>
      Effect.sync(() => {
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

/**
 * `port: 0` stands in for the documented 3000 so the suite survives a busy machine;
 * metrics are off because prom-client's registry is process-global.
 */
function appOptions(overrides: Partial<ApplicationOptions> = {}): Partial<ApplicationOptions> {
  return {
    port: 0,
    host: '127.0.0.1',
    loggerLayer: makeMockLoggerLayer(),
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
    ...overrides,
  };
}

const jsonHeaders = (): Headers => new Headers([['content-type', 'application/json']]);

// ============================================================================
// docs/api/controllers.md — Accessing Services
// ============================================================================

describe('Accessing services (docs/api/controllers.md)', () => {
  /**
   * @source docs:api/controllers.md#via-constructor-injection-recommended
   */
  it('should hand a controller the application-wide instances its constructor asks for', async () => {
    @Service()
    class MemoryCacheService extends BaseService {
      private readonly store = new Map<string, unknown>();

      async get<T>(key: string): Promise<T | undefined> {
        return this.store.get(key) as T | undefined;
      }

      async set(key: string, value: unknown): Promise<void> {
        this.store.set(key, value);
      }
    }

    @Service()
    class UserService extends BaseService {
      public calls = 0;

      async findAll(): Promise<{ id: string }[]> {
        this.calls += 1;

        return [{ id: 'u1' }];
      }
    }

    // From docs: "Use injected services directly" — cache first, service on a miss
    @Controller('/users')
    class UserController extends BaseController {
      constructor(
        private userService: UserService,
        private cacheService: MemoryCacheService,
      ) {
        super();
      }

      @Get('/')
      async findAll(): Promise<{ id: string }[]> {
        const cached = await this.cacheService.get<{ id: string }[]>('users');
        if (cached) {
          return cached;
        }

        const users = await this.userService.findAll();
        await this.cacheService.set('users', users);

        return users;
      }
    }

    @Module({ controllers: [UserController], providers: [UserService, MemoryCacheService] })
    class UserModule {}

    const app = new OneBunApplication(UserModule, appOptions());

    try {
      await app.start();

      const first = await fetch(`${app.getHttpUrl()}/users`);
      const second = await fetch(`${app.getHttpUrl()}/users`);

      expect(first.status).toBe(HttpStatusCode.OK);
      expect(await first.json()).toEqual({ success: true, result: [{ id: 'u1' }] });
      expect(await second.json()).toEqual({ success: true, result: [{ id: 'u1' }] });

      // Both parameters were injected, and both are the application's own instances: the
      // second request was answered out of the cache the FIRST request wrote, and the
      // UserService the container holds is the one the controller called.
      expect(app.getService(UserService).calls).toBe(1);
      expect(await app.getService(MemoryCacheService).get<{ id: string }[]>('users'))
        .toEqual([{ id: 'u1' }]);
    } finally {
      await app.stop();
    }
  });
});

// ============================================================================
// docs/api/controllers.md — Middleware
// ============================================================================

describe('Middleware (docs/api/controllers.md)', () => {
  /**
   * @source docs:api/controllers.md#basemiddleware
   */
  it('should run BaseMiddleware around the handler with a logger scoped to its class name', async () => {
    const order: string[] = [];
    const logged: LogRecord[] = [];

    // From docs: BaseMiddleware — pre-processing, next(), post-processing
    @Middleware()
    class RequestLogMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        order.push(`before:${req.method} ${new URL(req.url).pathname}`);
        this.logger.info(`${req.method} ${new URL(req.url).pathname}`);

        const response = await next();

        order.push('after');
        response.headers.set('X-Request-Duration', '42');

        return response;
      }
    }

    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/ping')
      @UseMiddleware(RequestLogMiddleware)
      ping(): { pong: boolean } {
        order.push('handler');

        return { pong: true };
      }
    }

    @Module({ controllers: [ApiController] })
    class ApiModule {}

    const app = new OneBunApplication(ApiModule, appOptions({ loggerLayer: recordingLoggerLayer(logged) }));

    try {
      await app.start();

      const response = await fetch(`${app.getHttpUrl()}/api/ping`);

      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: { pong: true } });

      // The onion: pre-processing, then the handler, then post-processing on the way out.
      expect(order).toEqual(['before:GET /api/ping', 'handler', 'after']);

      // Post-processing really mutated the response the client received.
      expect(response.headers.get('X-Request-Duration')).toBe('42');

      // "this.logger is scoped to the class name automatically"
      expect(logged).toContainEqual({
        level: 'info',
        message: 'GET /api/ping',
        context: { className: 'RequestLogMiddleware' },
      });
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#middleware-with-dependency-injection
   */
  it('should inject services into middleware and let it short-circuit the chain', async () => {
    let handlerRuns = 0;
    const logged: LogRecord[] = [];

    @Service()
    class AuthService extends BaseService {
      verify(token: string | null, secret: string): boolean {
        return token === `Bearer ${secret}`;
      }
    }

    // From docs: constructor DI plus `this.config`, and a Response returned instead of next()
    @Middleware()
    class AuthMiddleware extends BaseMiddleware {
      constructor(private authService: AuthService) {
        super();
      }

      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        const token = req.headers.get('Authorization');
        const secret = this.config.get('auth.jwtSecret') as string;

        if (!this.authService.verify(token, secret)) {
          this.logger.warn('Authentication failed');

          return new Response(
            JSON.stringify({ success: false, error: 'Unauthorized', code: HttpStatusCode.UNAUTHORIZED }),
            { status: HttpStatusCode.UNAUTHORIZED, headers: jsonHeaders() },
          );
        }

        return await next();
      }
    }

    @Controller('/secure')
    @UseMiddleware(AuthMiddleware)
    class SecureController extends BaseController {
      @Get('/data')
      data(): { secret: boolean } {
        handlerRuns += 1;

        return { secret: true };
      }
    }

    @Module({ controllers: [SecureController], providers: [AuthService] })
    class SecureModule {}

    TypedEnv.clear();
    const app = new OneBunApplication(SecureModule, appOptions({
      loggerLayer: recordingLoggerLayer(logged),
      envSchema: {
        auth: { jwtSecret: Env.string({ default: 's3cret', env: 'DOCS_MW_DI_JWT_SECRET' }) },
      },
    }));

    try {
      await app.start();

      const denied = await fetch(`${app.getHttpUrl()}/secure/data`);
      expect(denied.status).toBe(HttpStatusCode.UNAUTHORIZED);
      expect(await denied.json()).toEqual({ success: false, error: 'Unauthorized', code: 401 });
      // The chain really stopped: the handler was never entered.
      expect(handlerRuns).toBe(0);
      expect(logged).toContainEqual({
        level: 'warn',
        message: 'Authentication failed',
        context: { className: 'AuthMiddleware' },
      });

      // The injected AuthService decided, using the secret read from `this.config`.
      const allowed = await fetch(`${app.getHttpUrl()}/secure/data`, {
        headers: new Headers([['authorization', 'Bearer s3cret']]),
      });
      expect(allowed.status).toBe(HttpStatusCode.OK);
      expect(await allowed.json()).toEqual({ success: true, result: { secret: true } });
      expect(handlerRuns).toBe(1);
    } finally {
      await app.stop();
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:api/controllers.md#route-level-middleware
   */
  it('should apply @UseMiddleware on a method to that route only', async () => {
    const seen: string[] = [];

    @Middleware()
    class MarkMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('mark');

        return await next();
      }
    }

    // From docs: Route-Level Middleware — class constructors, not instances
    @Controller('/api')
    class ApiController extends BaseController {
      @Get('/public')
      publicEndpoint(): { message: string } {
        return { message: 'Anyone can see this' };
      }

      @Post('/protected')
      @UseMiddleware(MarkMiddleware)
      protectedEndpoint(): { message: string } {
        return { message: 'Auth required' };
      }
    }

    @Module({ controllers: [ApiController] })
    class ApiModule {}

    const app = new OneBunApplication(ApiModule, appOptions());

    try {
      await app.start();

      const open = await fetch(`${app.getHttpUrl()}/api/public`);
      expect(await open.json()).toEqual({ success: true, result: { message: 'Anyone can see this' } });
      // The undecorated sibling route is untouched by the route middleware.
      expect(seen).toEqual([]);

      const guarded = await fetch(`${app.getHttpUrl()}/api/protected`, { method: 'POST' });
      expect(await guarded.json()).toEqual({ success: true, result: { message: 'Auth required' } });
      expect(seen).toEqual(['mark']);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#controller-level-middleware
   */
  it('should run controller middleware on every route, before route middleware', async () => {
    const seen: string[] = [];

    @Middleware()
    class AuthMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('auth');

        return await next();
      }
    }

    @Middleware()
    class AuditLogMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('audit');

        return await next();
      }
    }

    // From docs: "@UseMiddleware as a class decorator" + "the execution order is always
    // controller -> route"
    @Controller('/admin')
    @UseMiddleware(AuthMiddleware)
    class AdminController extends BaseController {
      @Get('/dashboard')
      getDashboard(): { stats: { users: number } } {
        seen.push('dashboard');

        return { stats: { users: 100 } };
      }

      @Put('/settings')
      @UseMiddleware(AuditLogMiddleware)
      updateSettings(): { updated: boolean } {
        seen.push('settings');

        return { updated: true };
      }
    }

    @Module({ controllers: [AdminController] })
    class AdminModule {}

    const app = new OneBunApplication(AdminModule, appOptions());

    try {
      await app.start();

      const dashboard = await fetch(`${app.getHttpUrl()}/admin/dashboard`);
      expect(dashboard.status).toBe(HttpStatusCode.OK);
      expect(await dashboard.json()).toEqual({ success: true, result: { stats: { users: 100 } } });
      // "AuthMiddleware runs before every handler in this controller"; nothing else did.
      expect(seen).toEqual(['auth', 'dashboard']);

      seen.length = 0;
      const settings = await fetch(`${app.getHttpUrl()}/admin/settings`, { method: 'PUT' });
      expect(await settings.json()).toEqual({ success: true, result: { updated: true } });
      // "AuthMiddleware, then AuditLogMiddleware" — controller entry first, then the route's.
      expect(seen).toEqual(['auth', 'audit', 'settings']);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#module-level-middleware
   */
  it('should inherit module middleware into child modules, root module first', async () => {
    const seen: string[] = [];

    @Middleware()
    class RequestIdMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('request-id');

        return await next();
      }
    }

    @Middleware()
    class TenantMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('tenant');

        return await next();
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      @Get('/')
      list(): { from: string } {
        return { from: 'users' };
      }
    }

    @Controller('/orders')
    class OrderController extends BaseController {
      @Get('/')
      list(): { from: string } {
        return { from: 'orders' };
      }
    }

    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      check(): { from: string } {
        return { from: 'health' };
      }
    }

    // From docs: OnModuleConfigure.configureMiddleware()
    @Module({ controllers: [UserController] })
    class UserModule implements OnModuleConfigure {
      configureMiddleware(): MiddlewareClass[] {
        return [TenantMiddleware];
      }
    }

    @Module({ controllers: [OrderController] })
    class OrderModule {}

    @Module({ imports: [UserModule, OrderModule], controllers: [HealthController] })
    class AppModule implements OnModuleConfigure {
      configureMiddleware(): MiddlewareClass[] {
        return [RequestIdMiddleware];
      }
    }

    const app = new OneBunApplication(AppModule, appOptions());

    try {
      await app.start();

      // From docs: "HealthController gets: [RequestIdMiddleware]"
      seen.length = 0;
      expect(await (await fetch(`${app.getHttpUrl()}/health/`)).json())
        .toEqual({ success: true, result: { from: 'health' } });
      expect(seen).toEqual(['request-id']);

      // "Controllers in UserModule get: [RequestIdMiddleware, TenantMiddleware]" — in that order
      seen.length = 0;
      expect(await (await fetch(`${app.getHttpUrl()}/users/`)).json())
        .toEqual({ success: true, result: { from: 'users' } });
      expect(seen).toEqual(['request-id', 'tenant']);

      // "Controllers in OrderModule get: [RequestIdMiddleware]" — a sibling's middleware
      // is NOT inherited sideways
      seen.length = 0;
      expect(await (await fetch(`${app.getHttpUrl()}/orders/`)).json())
        .toEqual({ success: true, result: { from: 'orders' } });
      expect(seen).toEqual(['request-id']);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#application-wide-middleware
   */
  it('should run ApplicationOptions.middleware on every route, before every other level', async () => {
    const seen: string[] = [];

    @Middleware()
    class RequestIdMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('request-id');
        const response = await next();
        response.headers.set('X-Request-Id', 'fixed-id');

        return response;
      }
    }

    @Middleware()
    class ControllerMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('controller');

        return await next();
      }
    }

    @Controller('/a')
    @UseMiddleware(ControllerMiddleware)
    class AController extends BaseController {
      @Get('/')
      hit(): { from: string } {
        return { from: 'a' };
      }
    }

    @Controller('/b')
    class BController extends BaseController {
      @Get('/')
      hit(): { from: string } {
        return { from: 'b' };
      }
    }

    @Module({ controllers: [AController, BController] })
    class AppModule {}

    // From docs: `middleware: [RequestIdMiddleware, CorsMiddleware]`
    const app = new OneBunApplication(AppModule, appOptions({ middleware: [RequestIdMiddleware] }));

    try {
      await app.start();

      seen.length = 0;
      const withController = await fetch(`${app.getHttpUrl()}/a/`);
      expect(await withController.json()).toEqual({ success: true, result: { from: 'a' } });
      expect(withController.headers.get('X-Request-Id')).toBe('fixed-id');
      // "runs before any module-level, controller-level or route-level middleware"
      expect(seen).toEqual(['request-id', 'controller']);

      // "every route in every controller" — including one with no middleware of its own
      seen.length = 0;
      const bare = await fetch(`${app.getHttpUrl()}/b/`);
      expect(await bare.json()).toEqual({ success: true, result: { from: 'b' } });
      expect(bare.headers.get('X-Request-Id')).toBe('fixed-id');
      expect(seen).toEqual(['request-id']);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#application-wide-middleware-with-onebunapplication-multi-service
   */
  it('should share application-level middleware across services and let a service override it', async () => {
    const seen: string[] = [];

    @Middleware()
    class RequestIdMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('request-id');

        return await next();
      }
    }

    @Middleware()
    class OrderSpecificMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('order-specific');

        return await next();
      }
    }

    @Controller('/ping')
    class UsersController extends BaseController {
      @Get('/')
      ping(): { from: string } {
        return { from: 'users' };
      }
    }

    @Controller('/ping')
    class OrdersController extends BaseController {
      @Get('/')
      ping(): { from: string } {
        return { from: 'orders' };
      }
    }

    @Module({ controllers: [UsersController] })
    class UsersModule {}

    @Module({ controllers: [OrdersController] })
    class OrdersModule {}

    TypedEnv.clear();
    // From docs: app-level middleware is shared; a service's own list "Overrides app-level middleware"
    const app = new OneBunApplication({
      services: {
        users: { module: UsersModule, port: 0 },
        orders: { module: OrdersModule, port: 0, middleware: [OrderSpecificMiddleware] },
      },
      middleware: [RequestIdMiddleware],
      host: '127.0.0.1',
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
      logger: { minLevel: 'fatal' },
    });

    try {
      await app.start();

      const usersUrl = app.getApplication('users')!.getHttpUrl();
      const ordersUrl = app.getApplication('orders')!.getHttpUrl();

      seen.length = 0;
      expect(await (await fetch(`${usersUrl}/ping/`)).json())
        .toEqual({ success: true, result: { from: 'users' } });
      expect(seen).toEqual(['request-id']);

      // Overrides, not merges: the shared list does not run for `orders`.
      seen.length = 0;
      expect(await (await fetch(`${ordersUrl}/ping/`)).json())
        .toEqual({ success: true, result: { from: 'orders' } });
      expect(seen).toEqual(['order-specific']);
    } finally {
      await app.stop();
      TypedEnv.clear();
    }
  });

  /**
   * @source docs:api/controllers.md#custom-authentication-middleware
   */
  it('should answer 401 from JwtAuthMiddleware when the Authorization header is missing', async () => {
    let handlerRuns = 0;

    // From docs: Custom Authentication Middleware
    class JwtAuthMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          this.logger.warn('Missing or invalid Authorization header');

          return new Response(
            JSON.stringify({
              success: false,
              error: 'Missing or invalid Authorization header',
              code: HttpStatusCode.UNAUTHORIZED,
            }),
            { status: HttpStatusCode.UNAUTHORIZED, headers: jsonHeaders() },
          );
        }

        return await next();
      }
    }

    @Controller('/jwt')
    @UseMiddleware(JwtAuthMiddleware)
    class JwtController extends BaseController {
      @Get('/me')
      me(): { ok: boolean } {
        handlerRuns += 1;

        return { ok: true };
      }
    }

    @Module({ controllers: [JwtController] })
    class JwtModule {}

    const app = new OneBunApplication(JwtModule, appOptions());

    try {
      await app.start();

      const missing = await fetch(`${app.getHttpUrl()}/jwt/me`);
      expect(missing.status).toBe(HttpStatusCode.UNAUTHORIZED);
      expect(await missing.json()).toEqual({
        success: false,
        error: 'Missing or invalid Authorization header',
        code: 401,
      });

      // A non-Bearer scheme is refused just the same
      const basic = await fetch(`${app.getHttpUrl()}/jwt/me`, {
        headers: new Headers([['authorization', 'Basic abc']]),
      });
      expect(basic.status).toBe(HttpStatusCode.UNAUTHORIZED);
      expect(handlerRuns).toBe(0);

      const bearer = await fetch(`${app.getHttpUrl()}/jwt/me`, {
        headers: new Headers([['authorization', 'Bearer token-value']]),
      });
      expect(bearer.status).toBe(HttpStatusCode.OK);
      expect(await bearer.json()).toEqual({ success: true, result: { ok: true } });
      expect(handlerRuns).toBe(1);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#request-validation-middleware
   */
  it('should answer 415 from JsonOnlyMiddleware for a non-JSON write, and let GET through', async () => {
    let handlerRuns = 0;

    // From docs: Request Validation Middleware
    class JsonOnlyMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          const contentType = req.headers.get('Content-Type');
          if (!contentType?.includes('application/json')) {
            this.logger.warn(`Invalid Content-Type: ${contentType}`);

            return new Response(
              JSON.stringify({
                success: false,
                code: 415,
                message: 'Content-Type must be application/json',
              }),
              { status: 415, headers: jsonHeaders() },
            );
          }
        }

        return await next();
      }
    }

    @Controller('/json')
    @UseMiddleware(JsonOnlyMiddleware)
    class JsonController extends BaseController {
      @Get('/')
      read(): { read: boolean } {
        handlerRuns += 1;

        return { read: true };
      }

      @Post('/')
      write(): { written: boolean } {
        handlerRuns += 1;

        return { written: true };
      }
    }

    @Module({ controllers: [JsonController] })
    class JsonModule {}

    const app = new OneBunApplication(JsonModule, appOptions());

    try {
      await app.start();

      const rejected = await fetch(`${app.getHttpUrl()}/json/`, {
        method: 'POST',
        headers: new Headers([['content-type', 'text/plain']]),
        body: 'plain',
      });
      expect(rejected.status).toBe(415);
      expect(await rejected.json()).toEqual({
        success: false,
        code: 415,
        message: 'Content-Type must be application/json',
      });
      expect(handlerRuns).toBe(0);

      // GET is exempt by the documented condition, even with no Content-Type at all
      const read = await fetch(`${app.getHttpUrl()}/json/`);
      expect(read.status).toBe(HttpStatusCode.OK);
      expect(await read.json()).toEqual({ success: true, result: { read: true } });

      const accepted = await fetch(`${app.getHttpUrl()}/json/`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(accepted.status).toBe(HttpStatusCode.OK);
      expect(await accepted.json()).toEqual({ success: true, result: { written: true } });
      expect(handlerRuns).toBe(2);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#timing-logging-middleware
   */
  it('should add X-Response-Time from TimingMiddleware after the handler returned', async () => {
    const logged: LogRecord[] = [];

    // From docs: Timing / Logging Middleware
    class TimingMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        const start = performance.now();
        const response = await next();
        const duration = (performance.now() - start).toFixed(2);
        response.headers.set('X-Response-Time', `${duration}ms`);
        this.logger.info(`${req.method} ${new URL(req.url).pathname} — ${duration}ms`);

        return response;
      }
    }

    @Controller('/timed')
    @UseMiddleware(TimingMiddleware)
    class TimedController extends BaseController {
      @Get('/work')
      work(): { done: boolean } {
        return { done: true };
      }
    }

    @Module({ controllers: [TimedController] })
    class TimedModule {}

    const app = new OneBunApplication(TimedModule, appOptions({ loggerLayer: recordingLoggerLayer(logged) }));

    try {
      await app.start();

      const response = await fetch(`${app.getHttpUrl()}/timed/work`);

      expect(response.status).toBe(HttpStatusCode.OK);
      expect(await response.json()).toEqual({ success: true, result: { done: true } });
      // Header written after next() resolved, so it reaches the client on the real response.
      expect(response.headers.get('X-Response-Time')).toMatch(/^\d+\.\d{2}ms$/);

      const line = logged.find((entry) => entry.context.className === 'TimingMiddleware');
      expect(line?.level).toBe('info');
      expect(line?.message).toMatch(/^GET \/timed\/work — \d+\.\d{2}ms$/);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/controllers.md#combining-all-levels
   */
  it('should execute global, controller and route middleware in the documented order', async () => {
    const seen: string[] = [];

    @Middleware()
    class RequestIdMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('RequestIdMiddleware');

        return await next();
      }
    }

    @Middleware()
    class TimingMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('TimingMiddleware');

        return await next();
      }
    }

    @Middleware()
    class JwtAuthMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('JwtAuthMiddleware');

        return await next();
      }
    }

    @Middleware()
    class JsonOnlyMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('JsonOnlyMiddleware');

        return await next();
      }
    }

    // From docs: Combining All Levels
    @Controller('/admin')
    @UseMiddleware(JwtAuthMiddleware)
    class AdminController extends BaseController {
      @Get('/stats')
      getStats(): { stats: boolean } {
        seen.push('getStats');

        return { stats: true };
      }

      @Post('/users')
      @UseMiddleware(JsonOnlyMiddleware)
      createUser(): { created: boolean } {
        seen.push('createUser');

        return { created: true };
      }
    }

    @Module({ controllers: [AdminController] })
    class AdminModule {}

    const app = new OneBunApplication(AdminModule, appOptions({
      middleware: [RequestIdMiddleware, TimingMiddleware],
    }));

    try {
      await app.start();

      seen.length = 0;
      const stats = await fetch(`${app.getHttpUrl()}/admin/stats`);
      expect(await stats.json()).toEqual({ success: true, result: { stats: true } });
      // From docs: "For GET /admin/stats, the execution order is: 1..4"
      expect(seen).toEqual([
        'RequestIdMiddleware',
        'TimingMiddleware',
        'JwtAuthMiddleware',
        'getStats',
      ]);

      seen.length = 0;
      const created = await fetch(`${app.getHttpUrl()}/admin/users`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(await created.json()).toEqual({ success: true, result: { created: true } });
      // From docs: "For POST /admin/users, the execution order is: 1..5"
      expect(seen).toEqual([
        'RequestIdMiddleware',
        'TimingMiddleware',
        'JwtAuthMiddleware',
        'JsonOnlyMiddleware',
        'createUser',
      ]);
    } finally {
      await app.stop();
    }
  });
});

// ============================================================================
// docs/api/controllers.md — Complete Controller Example
// ============================================================================

describe('Complete controller example (docs/api/controllers.md)', () => {
  /**
   * @source docs:api/controllers.md#complete-controller-example
   */
  it('should serve the documented CRUD controller end to end', async () => {
    const createUserSchema = type({ name: 'string', email: 'string' });
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const updateUserSchema = type({ 'name?': 'string' });
    type CreateUserBody = typeof createUserSchema.infer;
    type UpdateUserBody = typeof updateUserSchema.infer;

    interface User {
      id: string;
      name: string;
      email: string;
    }

    const authSeen: string[] = [];

    @Middleware()
    class AuthMiddleware extends BaseMiddleware {
      async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        authSeen.push(req.method);

        return await next();
      }
    }

    @Service()
    class UserService extends BaseService {
      private readonly users = new Map<string, User>([
        ['1', { id: '1', name: 'Ann', email: 'ann@example.com' }],
        ['2', { id: '2', name: 'Bob', email: 'bob@example.com' }],
      ]);

      async findAll(options: { page: number; limit: number }): Promise<{
        items: User[]; total: number; page: number; limit: number;
      }> {
        const items = [...this.users.values()].slice(0, options.limit);

        return {
          items, total: this.users.size, page: options.page, limit: options.limit,
        };
      }

      async search(query: string, field: string): Promise<{ query: string; field: string; found: number }> {
        const found = [...this.users.values()]
          .filter((user) => String(user[field as keyof User]).includes(query)).length;

        return { query, field, found };
      }

      async findById(id: string): Promise<User | undefined> {
        return this.users.get(id);
      }

      async create(body: CreateUserBody): Promise<User> {
        const user: User = { id: String(this.users.size + 1), ...body };
        this.users.set(user.id, user);

        return user;
      }

      async update(id: string, body: UpdateUserBody): Promise<User | undefined> {
        const existing = this.users.get(id);
        if (!existing) {
          return undefined;
        }
        const updated = { ...existing, ...body };
        this.users.set(id, updated);

        return updated;
      }

      async delete(id: string): Promise<boolean> {
        return this.users.delete(id);
      }
    }

    @Controller('/api/users')
    class UserController extends BaseController {
      constructor(private userService: UserService) {
        super();
      }

      @Get('/')
      async findAll(
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '10',
      ) {
        this.logger.info('Listing users', { page, limit });
        const users = await this.userService.findAll({
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
        });

        return {
          users: users.items,
          total: users.total,
          page: users.page,
          limit: users.limit,
        };
      }

      @Get('/search')
      async search(
        @Query('q') query: string,
        @Query('field') field: string = 'name',
      ) {
        if (!query) {
          throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Query parameter "q" is required');
        }

        return await this.userService.search(query, field);
      }

      @Get('/:id')
      async findOne(@Param('id') id: string) {
        const user = await this.userService.findById(id);
        if (!user) {
          throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
        }

        return user;
      }

      @Post('/')
      @UseMiddleware(AuthMiddleware)
      async create(
        @Body(createUserSchema) body: CreateUserBody,
        @Header('X-Request-ID') requestId?: string,
      ) {
        this.logger.info('Creating user', { email: body.email, requestId });
        const user = await this.userService.create(body);

        return this.success({ ...user, requestId }, HttpStatusCode.CREATED);
      }

      @Put('/:id')
      @UseMiddleware(AuthMiddleware)
      async update(
        @Param('id') id: string,
        @Body(updateUserSchema) body: UpdateUserBody,
      ) {
        const user = await this.userService.update(id, body);
        if (!user) {
          throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
        }

        return user;
      }

      @Delete('/:id')
      @UseMiddleware(AuthMiddleware)
      async remove(@Param('id') id: string) {
        const deleted = await this.userService.delete(id);
        if (!deleted) {
          throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
        }

        return { deleted: true };
      }
    }

    @Module({ controllers: [UserController], providers: [UserService] })
    class UserModule {}

    const app = new OneBunApplication(UserModule, appOptions());

    try {
      await app.start();
      const base = `${app.getHttpUrl()}/api/users`;

      // @Get('/') under @Controller('/api/users') answers on /api/users; @Query defaults
      // apply when the parameter is absent
      const listed = await fetch(base);
      expect(listed.status).toBe(HttpStatusCode.OK);
      expect(await listed.json()).toEqual({
        success: true,
        result: {
          users: [
            { id: '1', name: 'Ann', email: 'ann@example.com' },
            { id: '2', name: 'Bob', email: 'bob@example.com' },
          ],
          total: 2,
          page: 1,
          limit: 10,
        },
      });

      const paged = await fetch(`${base}?page=3&limit=1`);
      expect(await paged.json()).toEqual({
        success: true,
        result: {
          users: [{ id: '1', name: 'Ann', email: 'ann@example.com' }],
          total: 2,
          page: 3,
          limit: 1,
        },
      });

      // The static /search route wins over /:id, and the guard clause throws 400
      const missingQuery = await fetch(`${base}/search`);
      expect(missingQuery.status).toBe(HttpStatusCode.BAD_REQUEST);
      expect(await missingQuery.json()).toMatchObject({
        success: false,
        error: 'Query parameter "q" is required',
      });

      const searched = await fetch(`${base}/search?q=An`);
      expect(await searched.json()).toEqual({
        success: true,
        result: { query: 'An', field: 'name', found: 1 },
      });

      const found = await fetch(`${base}/1`);
      expect(await found.json()).toEqual({
        success: true,
        result: { id: '1', name: 'Ann', email: 'ann@example.com' },
      });

      const notFound = await fetch(`${base}/999`);
      expect(notFound.status).toBe(HttpStatusCode.NOT_FOUND);
      expect(await notFound.json()).toMatchObject({ success: false, error: 'User not found' });

      // @Body(schema) + @Header, answered with 201 via success(result, status)
      authSeen.length = 0;
      const created = await fetch(`${base}/`, {
        method: 'POST',
        headers: new Headers([
          ['content-type', 'application/json'],
          ['x-request-id', 'req-7'],
        ]),
        body: JSON.stringify({ name: 'Cid', email: 'cid@example.com' }),
      });
      expect(created.status).toBe(HttpStatusCode.CREATED);
      expect(await created.json()).toEqual({
        success: true,
        result: {
          id: '3', name: 'Cid', email: 'cid@example.com', requestId: 'req-7',
        },
      });
      // @UseMiddleware(AuthMiddleware) on the write routes only
      expect(authSeen).toEqual(['POST']);

      // A body the schema rejects never reaches the handler
      const invalid = await fetch(`${base}/`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: 'NoEmail' }),
      });
      expect(invalid.status).toBe(HttpStatusCode.BAD_REQUEST);

      const updated = await fetch(`${base}/2`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: 'Bobby' }),
      });
      expect(await updated.json()).toEqual({
        success: true,
        result: { id: '2', name: 'Bobby', email: 'bob@example.com' },
      });

      const removed = await fetch(`${base}/2`, { method: 'DELETE' });
      expect(await removed.json()).toEqual({ success: true, result: { deleted: true } });

      const removedTwice = await fetch(`${base}/2`, { method: 'DELETE' });
      expect(removedTwice.status).toBe(HttpStatusCode.NOT_FOUND);

      expect(authSeen).toEqual(['POST', 'POST', 'PUT', 'DELETE', 'DELETE']);
    } finally {
      await app.stop();
    }
  });
});

// ============================================================================
// docs/api/core.md — Quick Reference for AI
// ============================================================================

describe('OneBunApplication quick reference (docs/api/core.md)', () => {
  /**
   * @source docs:api/core.md#quick-reference-for-ai
   */
  it('should bootstrap from the minimal snippet and log through getLogger on both paths', async () => {
    const logged: LogRecord[] = [];

    @Controller('/hello')
    class HelloController extends BaseController {
      @Get('/')
      hello(): { message: string } {
        return { message: 'Hello' };
      }
    }

    @Module({ controllers: [HelloController] })
    class AppModule {}

    // From docs: `const app = new OneBunApplication(AppModule, { envSchema })`
    TypedEnv.clear();
    const envSchema = {
      app: { name: Env.string({ default: 'docs-core-quickref', env: 'DOCS_CORE_QUICKREF_NAME' }) },
    };
    const app = new OneBunApplication(AppModule, appOptions({
      envSchema,
      loggerLayer: recordingLoggerLayer(logged),
    }));

    try {
      // From docs: app.start().then(() => { ...getLogger... })
      await app.start()
        .then(() => {
          app.getLogger({ className: 'AppBootstrap' }).info('Application started');
        });

      expect((await fetch(`${app.getHttpUrl()}/hello/`)).status).toBe(HttpStatusCode.OK);
      expect(app.getConfigValue<string>('app.name')).toBe('docs-core-quickref');
      expect(logged).toContainEqual({
        level: 'info',
        message: 'Application started',
        context: { className: 'AppBootstrap' },
      });
    } finally {
      await app.stop();
      TypedEnv.clear();
    }

    // ...and the documented `.catch` really is reachable: a module that cannot be built
    // rejects start() rather than coming up half-configured.
    @Service()
    class SharedService extends BaseService {}

    @Module({ providers: [SharedService], exports: [SharedService] })
    class CoreModule {}

    @Module({ imports: [CoreModule], exports: [CoreModule] })
    class ReExportingModule {}

    @Module({ imports: [ReExportingModule] })
    class BrokenModule {}

    const failedLogs: LogRecord[] = [];
    const broken = new OneBunApplication(BrokenModule, appOptions({
      loggerLayer: recordingLoggerLayer(failedLogs),
    }));

    let caught: unknown;
    await broken.start().catch((error: unknown) => {
      caught = error;
      broken.getLogger({ className: 'AppBootstrap' })
        .error('Failed to start:', error instanceof Error ? error : new Error(String(error)));
    });

    expect(String((caught as Error | undefined)?.message)).toMatch(/exports the module CoreModule/);
    expect(failedLogs).toContainEqual({
      level: 'error',
      message: 'Failed to start:',
      context: { className: 'AppBootstrap' },
    });
  });

  /**
   * @source docs:api/core.md#quick-reference-for-ai
   */
  it('should resolve port and host as explicit option > env variable > default', () => {
    @Module({})
    class EmptyModule {}

    const originalPort = process.env.PORT;
    const originalHost = process.env.HOST;

    try {
      // 3. Default value (3000 / '0.0.0.0')
      delete process.env.PORT;
      delete process.env.HOST;
      expect(new OneBunApplication(EmptyModule, { loggerLayer: makeMockLoggerLayer() }).getHttpUrl())
        .toBe('http://0.0.0.0:3000');

      // 2. Environment variable (PORT / HOST)
      process.env.PORT = '4567';
      process.env.HOST = '127.0.0.1';
      expect(new OneBunApplication(EmptyModule, { loggerLayer: makeMockLoggerLayer() }).getHttpUrl())
        .toBe('http://127.0.0.1:4567');

      // 1. Explicit option passed to the constructor
      const explicit = new OneBunApplication(EmptyModule, {
        port: 5555,
        host: '10.0.0.1',
        loggerLayer: makeMockLoggerLayer(),
      });
      expect(explicit.getHttpUrl()).toBe('http://10.0.0.1:5555');
    } finally {
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
      if (originalHost === undefined) {
        delete process.env.HOST;
      } else {
        process.env.HOST = originalHost;
      }
    }
  });

  /**
   * @source docs:api/core.md#quick-reference-for-ai
   */
  it('should auto-order the security shorthands as cors → rateLimit → user → security', async () => {
    const seen: string[] = [];

    @Middleware()
    class MarkerMiddleware extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
        seen.push('user');
        const response = await next();
        // SecurityHeadersMiddleware sits INSIDE this one and stamps its headers on the way
        // out, so by the time next() resolves here the header must already be there.
        // Reading it now is what distinguishes "user → security" from "security → user":
        // both orders put the header on the client's response, only this order puts it on
        // the response the user middleware resumes with.
        seen.push(`user-sees-security:${response.headers.get('X-Frame-Options')}`);
        response.headers.set('X-User-Middleware', 'ran');

        return response;
      }
    }

    @Controller('/api')
    class PingController extends BaseController {
      @Get('/ping')
      ping(): { pong: boolean } {
        seen.push('handler');

        return { pong: true };
      }
    }

    @Module({ controllers: [PingController] })
    class PingModule {}

    // From docs: "CORS + rate limiting + security headers in one line each" +
    // "Auto-ordering: CorsMiddleware → RateLimitMiddleware → [user middleware] → SecurityHeadersMiddleware"
    const app = new OneBunApplication(PingModule, appOptions({
      cors: { origin: '*' },
      rateLimit: { max: 1, windowMs: 60_000 },
      security: { xFrameOptions: 'DENY' },
      middleware: [MarkerMiddleware],
    }));

    try {
      await app.start();

      const first = await fetch(`${app.getHttpUrl()}/api/ping`);
      expect(first.status).toBe(HttpStatusCode.OK);
      expect(await first.json()).toEqual({ success: true, result: { pong: true } });
      expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(first.headers.get('RateLimit-Limit')).toBe('1');
      expect(first.headers.get('X-User-Middleware')).toBe('ran');
      expect(first.headers.get('X-Frame-Options')).toBe('DENY');
      expect(seen).toEqual(['user', 'handler', 'user-sees-security:DENY']);

      // Second request trips the rate limiter. Where each auto-middleware sits is now visible:
      // CORS wraps the limiter, so its header survives; the user middleware, the handler and
      // the security headers are all INSIDE it and never ran.
      const blocked = await fetch(`${app.getHttpUrl()}/api/ping`);
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ success: false, error: 'Too Many Requests' });
      expect(blocked.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(blocked.headers.get('X-User-Middleware')).toBeNull();
      expect(blocked.headers.get('X-Frame-Options')).toBeNull();
      expect(seen).toEqual(['user', 'handler', 'user-sees-security:DENY']);
    } finally {
      await app.stop();
    }
  });

  /**
   * @source docs:api/core.md#quick-reference-for-ai
   */
  it('should serve API routes first and everything else from the static root', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'onebun-quickref-static-'));

    try {
      fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html><body>SPA-ROOT</body></html>', 'utf8');

      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/state')
        state(): { from: string } {
          return { from: 'api' };
        }
      }

      @Module({ controllers: [ApiController] })
      class AppModule {}

      // From docs: static: { root: './dist', fallbackFile: 'index.html' }
      const app = new OneBunApplication(AppModule, appOptions({
        static: { root: tmpDir, fallbackFile: 'index.html' },
      }));

      try {
        await app.start();

        const api = await fetch(`${app.getHttpUrl()}/api/state`);
        expect(api.status).toBe(HttpStatusCode.OK);
        expect(await api.json()).toEqual({ success: true, result: { from: 'api' } });

        // "all other GET requests serve from ./dist or index.html for SPA routing"
        const spa = await fetch(`${app.getHttpUrl()}/dashboard/deep/link`);
        expect(spa.status).toBe(HttpStatusCode.OK);
        expect(await spa.text()).toContain('SPA-ROOT');
      } finally {
        await app.stop();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// docs/api/core.md — OneBunModule
// ============================================================================

describe('OneBunModule (docs/api/core.md)', () => {
  /**
   * @source docs:api/core.md#onebunmodule
   */
  it('should expose controllers, service instances and exports through the documented methods', async () => {
    @Service()
    class DatabaseService extends BaseService {
      query(sql: string): string {
        return `ran:${sql}`;
      }
    }

    @Controller('/leaf')
    class LeafController extends BaseController {
      constructor(private db: DatabaseService) {
        super();
      }

      @Get('/')
      leaf(): { value: string } {
        return { value: this.db.query('select 1') };
      }
    }

    @Controller('/root')
    class RootController extends BaseController {
      @Get('/')
      root(): { value: string } {
        return { value: 'root' };
      }
    }

    @Module({ controllers: [LeafController], providers: [DatabaseService], exports: [DatabaseService] })
    class LeafModule {}

    @Module({ imports: [LeafModule], controllers: [RootController] })
    class RootModule {}

    // A controller that belongs to a completely separate module tree — never imported by
    // RootModule, so `created` must not be able to reach it.
    @Controller('/outsider')
    class OutsiderController extends BaseController {
      @Get('/')
      outsider(): { value: string } {
        return { value: 'outsider' };
      }
    }

    @Module({ controllers: [OutsiderController] })
    class OutsiderModule {}

    // From docs: `OneBunModule.create(moduleClass, loggerLayer?, config?)`
    const created = OneBunModule.create(RootModule, makeMockLoggerLayer()) as unknown as OneBunModule;

    // From docs: `setup(): Effect.Effect<unknown, never, void>`
    await Effect.runPromise(created.setup() as effect.Effect.Effect<unknown, never, never>);

    // getControllers() reaches into child modules, not just this module's own list
    expect(created.getControllers()).toEqual([RootController, LeafController]);

    // getControllerInstance() answers with the live instance the framework built —
    // DI included, so the injected service answers through it
    const leaf = created.getControllerInstance(LeafController) as LeafController;
    expect(leaf.leaf()).toEqual({ value: 'ran:select 1' });
    expect((created.getControllerInstance(RootController) as RootController).root()).toEqual({ value: 'root' });

    // The `| undefined` half of the signature: the search is scoped to this module and its
    // children. OutsiderController is live in its own tree and invisible from this one —
    // the pair fails if instances are ever pooled process-wide instead of per module tree.
    const outsider = OneBunModule.create(OutsiderModule, makeMockLoggerLayer()) as unknown as OneBunModule;
    await Effect.runPromise(outsider.setup() as effect.Effect.Effect<unknown, never, never>);
    expect((outsider.getControllerInstance(OutsiderController) as OutsiderController).outsider())
      .toEqual({ value: 'outsider' });
    expect(created.getControllerInstance(OutsiderController)).toBeUndefined();

    // getServiceInstance(tag) resolves by Effect tag, across the module tree
    const dbTag = getServiceTag(DatabaseService) as unknown as Context.Tag<DatabaseService, DatabaseService>;
    const dbInstance = created.getServiceInstance(dbTag);
    expect(dbInstance?.query('ping')).toBe('ran:ping');

    // getLayer() carries that same instance
    const fromLayer = await Effect.runPromise(Effect.provide(
      dbTag,
      created.getLayer() as unknown as Layer.Layer<DatabaseService, never, never>,
    ));
    expect(fromLayer).toBe(dbInstance!);

    // getExportedServices() lists exactly what `exports` names — the leaf module exports
    // DatabaseService, the root module exports nothing
    const leafModule = OneBunModule.create(LeafModule, makeMockLoggerLayer()) as unknown as OneBunModule;
    await Effect.runPromise(leafModule.setup() as effect.Effect.Effect<unknown, never, never>);
    const leafExports = leafModule.getExportedServices();
    expect([...leafExports.keys()].map((tag) => tag.key)).toEqual(['DatabaseService']);
    expect((leafExports.get(dbTag as unknown as Context.Tag<unknown, unknown>) as DatabaseService).query('x'))
      .toBe('ran:x');
    expect(created.getExportedServices().size).toBe(0);
  });
});

// ============================================================================
// docs/api/core.md — Re-exports
// ============================================================================

describe('Core re-exports (docs/api/core.md)', () => {
  /**
   * @source docs:api/core.md#re-exports
   */
  it('should re-export the documented symbols from their source packages', () => {
    // From @onebun/envs
    expect(Env).toBe(envs.Env);
    expect(EnvValidationError).toBe(envs.EnvValidationError);

    // From @onebun/requests
    expect(createHttpClient).toBe(requests.createHttpClient);
    expect(HttpStatusCode).toBe(requests.HttpStatusCode);
    expect(InternalServerError).toBe(requests.InternalServerError);
    expect(isErrorResponse).toBe(requests.isErrorResponse);
    expect(NotFoundError).toBe(requests.NotFoundError);
    expect(OneBunBaseError).toBe(requests.OneBunBaseError);

    // From effect
    expect(Effect).toBe(effect.Effect);
    expect(Layer).toBe(effect.Layer);
  });

  /**
   * @source docs:api/core.md#re-exports
   */
  it('should re-export working decorators, validation and error helpers', () => {
    // `export * from './decorators'` — the decorators imported from the barrel really
    // register metadata
    @Controller('/re-export')
    class ReExportController extends BaseController {
      @Get('/ping')
      ping(): { ok: boolean } {
        return { ok: true };
      }
    }

    const metadata = getControllerMetadata(ReExportController);
    expect(metadata?.path).toBe('/re-export');
    expect(metadata?.routes.map((route) => [route.method, route.path]))
      .toEqual([[HttpMethod.GET, '/ping']]);

    // `export * from './validation'`
    expect(validate(type({ name: 'string' }), { name: 'Ann' }))
      .toEqual({ success: true, data: { name: 'Ann' } });
    expect(validate(type({ name: 'string' }), { name: 7 }).success).toBe(false);

    // The @onebun/requests helpers behave, not merely exist
    expect(HttpStatusCode.NOT_FOUND).toBe(404);
    expect(isErrorResponse({ success: false, error: 'nope', code: 404 })).toBe(true);
    expect(isErrorResponse({ success: true, result: 1 })).toBe(false);

    // `export { Effect, Layer } from 'effect'`
    expect(Effect.runSync(Effect.succeed(7))).toBe(7);

    // `export { BaseService, Service, getServiceTag }`
    @Service()
    class ReExportedService extends BaseService {}

    expect(getServiceTag(ReExportedService).key).toBe('ReExportedService');
  });
});
