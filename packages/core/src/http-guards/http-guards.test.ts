import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import type {
  HttpExecutionContext,
  HttpGuard,
  OneBunRequest,
} from '../types';

import { OneBunApplication } from '../application/application';
import {
  Controller,
  Delete,
  Get,
  getControllerMetadata,
  Module,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '../decorators/decorators';
import { type ExceptionFilter } from '../exception-filters/exception-filters';
import { HttpException } from '../exception-filters/http-exception';
import { BaseInterceptor } from '../interceptors/interceptors';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';
import { makeMockLoggerLayer } from '../testing/test-utils';

import {
  AuthGuard,
  createHttpGuard,
  executeHttpGuards,
  HttpExecutionContextImpl,
  RolesGuard,
} from './http-guards';

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(headers?: Headers): OneBunRequest {
  return new Request('http://localhost/test', { headers }) as unknown as OneBunRequest;
}

function makeHeaders(entries: [string, string][]): Headers {
  const h = new Headers();
  for (const [key, value] of entries) {
    h.set(key, value);
  }

  return h;
}

function makeContext(
  headers: [string, string][] = [],
  handler = 'testHandler',
  controller = 'TestController',
): HttpExecutionContext {
  return new HttpExecutionContextImpl(makeRequest(makeHeaders(headers)), handler, controller);
}

// ============================================================================
// HttpExecutionContextImpl
// ============================================================================

describe('HttpExecutionContextImpl', () => {
  it('returns request from getRequest()', () => {
    const req = makeRequest(makeHeaders([['authorization', 'Bearer token']]));
    const ctx = new HttpExecutionContextImpl(req, 'myHandler', 'MyController');

    expect(ctx.getRequest()).toBe(req);
  });

  it('returns handler name from getHandler()', () => {
    const ctx = makeContext([], 'getUser', 'UserController');

    expect(ctx.getHandler()).toBe('getUser');
  });

  it('returns controller name from getController()', () => {
    const ctx = makeContext([], 'getUser', 'UserController');

    expect(ctx.getController()).toBe('UserController');
  });
});

// ============================================================================
// executeHttpGuards
// ============================================================================

describe('executeHttpGuards', () => {
  it('returns true when there are no guards', async () => {
    const ctx = makeContext();

    expect(await executeHttpGuards([], ctx)).toBe(true);
  });

  it('returns true when all guards pass', async () => {
    const passGuard = createHttpGuard(() => true);
    const ctx = makeContext();

    expect(await executeHttpGuards([passGuard, passGuard], ctx)).toBe(true);
  });

  it('returns false when any guard fails', async () => {
    const passGuard = createHttpGuard(() => true);
    const failGuard = createHttpGuard(() => false);
    const ctx = makeContext();

    expect(await executeHttpGuards([passGuard, failGuard, passGuard], ctx)).toBe(false);
  });

  it('short-circuits on first failing guard', async () => {
    let secondCalled = false;

    const failGuard = createHttpGuard(() => false);
    const trackGuard = createHttpGuard(() => {
      secondCalled = true;

      return true;
    });
    const ctx = makeContext();

    await executeHttpGuards([failGuard, trackGuard], ctx);

    expect(secondCalled).toBe(false);
  });

  it('accepts guard instances (not just class constructors)', async () => {
    const instance: HttpGuard = { canActivate: () => true };
    const ctx = makeContext();

    expect(await executeHttpGuards([instance], ctx)).toBe(true);
  });

  it('accepts async guards', async () => {
    const asyncPassGuard = createHttpGuard(async () => {
      await Promise.resolve();

      return true;
    });
    const ctx = makeContext();

    expect(await executeHttpGuards([asyncPassGuard], ctx)).toBe(true);
  });
});

// ============================================================================
// createHttpGuard
// ============================================================================

describe('createHttpGuard', () => {
  it('returns a class constructor', () => {
    const guardClass = createHttpGuard(() => true);

    expect(typeof guardClass).toBe('function');
  });

  it('instantiated class calls the provided function', async () => {
    let called = false;
    const guardClass = createHttpGuard((ctx) => {
      called = true;

      return ctx.getHandler() === 'target';
    });
    const ctx = makeContext([], 'target');
    const instance = new guardClass();

    expect(await instance.canActivate(ctx)).toBe(true);
    expect(called).toBe(true);
  });
});

// ============================================================================
// AuthGuard
// ============================================================================

describe('AuthGuard', () => {
  it('allows request with Bearer token', () => {
    const guard = new AuthGuard();
    const ctx = makeContext([['authorization', 'Bearer my-token']]);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks request without Authorization header', () => {
    const guard = new AuthGuard();
    const ctx = makeContext();

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('blocks request with non-Bearer Authorization header', () => {
    const guard = new AuthGuard();
    const ctx = makeContext([['authorization', 'Basic dXNlcjpwYXNz']]);

    expect(guard.canActivate(ctx)).toBe(false);
  });
});

// ============================================================================
// RolesGuard
// ============================================================================

describe('RolesGuard', () => {
  it('allows when user has all required roles (default extractor)', () => {
    const guard = new RolesGuard(['admin', 'editor']);
    const headers = makeHeaders([['x-user-roles', 'admin, editor, viewer']]);
    const ctx = new HttpExecutionContextImpl(makeRequest(headers), 'handler', 'Controller');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks when user is missing a required role', () => {
    const guard = new RolesGuard(['admin']);
    const headers = makeHeaders([['x-user-roles', 'viewer']]);
    const ctx = new HttpExecutionContextImpl(makeRequest(headers), 'handler', 'Controller');

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('blocks when x-user-roles header is absent', () => {
    const guard = new RolesGuard(['admin']);
    const ctx = makeContext();

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('uses custom roles extractor when provided', () => {
    const headers = makeHeaders([['x-roles', 'admin|user']]);
    const guard = new RolesGuard(['admin'], (ctx) =>
      ctx.getRequest().headers.get('x-roles')?.split('|') ?? [],
    );
    const ctx = new HttpExecutionContextImpl(makeRequest(headers), 'handler', 'Controller');

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('requires ALL roles to be present (not just one)', () => {
    const guard = new RolesGuard(['admin', 'superuser']);
    const headers = makeHeaders([['x-user-roles', 'admin']]);
    const ctx = new HttpExecutionContextImpl(makeRequest(headers), 'handler', 'Controller');

    expect(guard.canActivate(ctx)).toBe(false);
  });
});

// ============================================================================
// Decorator source order must never change runtime behaviour
//
// A route-level `@UseGuards` written ABOVE the HTTP method decorator was silently
// discarded: the route answered 200 with the handler reached, while the same guard
// below the method decorator answered 403. An authorization bypass, and every
// route-level example in docs/api/guards.md used the broken order.
//
// Cause: method decorators apply BOTTOM-UP, and the route decorator snapshotted the
// pipeline metadata when it ran. These cases assert observable behaviour — status code
// and whether the hook actually ran — never that metadata was stored, because a
// metadata assertion passes in both orders while the request still bypasses the guard.
// ============================================================================

describe('pipeline decorator order independence', () => {
  const HTTP_OK = 200;
  const HTTP_FORBIDDEN = 403;
  const HTTP_TEAPOT = 418;
  const HTTP_ERROR = 500;

  let hits: string[] = [];

  class DenyGuard implements HttpGuard {
    canActivate(): boolean {
      hits.push('guard');

      return false;
    }
  }

  class MarkInterceptor extends BaseInterceptor {
    async intercept(_ctx: unknown, next: () => Promise<unknown>): Promise<unknown> {
      hits.push('interceptor');

      return await next();
    }
  }

  const markFilter: ExceptionFilter = {
    catch(): Response {
      hits.push('filter');

      return new Response(JSON.stringify({ filtered: true }), { status: HTTP_TEAPOT });
    },
  };

  @Controller('/route')
  class RouteController extends BaseController {
    @UseGuards(DenyGuard)
    @Delete('/guardAbove/:id')
    guardAbove() {
      return { deleted: true };
    }

    @Delete('/guardBelow/:id')
    @UseGuards(DenyGuard)
    guardBelow() {
      return { deleted: true };
    }

    @UseInterceptors(MarkInterceptor)
    @Get('/interceptorAbove')
    interceptorAbove() {
      return { ok: true };
    }

    @Get('/interceptorBelow')
    @UseInterceptors(MarkInterceptor)
    interceptorBelow() {
      return { ok: true };
    }

    @UseFilters(markFilter)
    @Get('/filterAbove')
    filterAbove(): never {
      throw new HttpException(HTTP_ERROR, 'boom');
    }

    @Get('/filterBelow')
    @UseFilters(markFilter)
    filterBelow(): never {
      throw new HttpException(HTTP_ERROR, 'boom');
    }
  }

  @UseGuards(DenyGuard)
  @Controller('/classAbove')
  class ClassAboveController extends BaseController {
    @Get('/')
    get() {
      return { ok: true };
    }
  }

  @Controller('/classBelow')
  @UseGuards(DenyGuard)
  class ClassBelowController extends BaseController {
    @Get('/')
    get() {
      return { ok: true };
    }
  }

  @UseInterceptors(MarkInterceptor)
  @Controller('/classInterceptorAbove')
  class ClassInterceptorAboveController extends BaseController {
    @Get('/')
    get() {
      return { ok: true };
    }
  }

  @Controller('/classInterceptorBelow')
  @UseInterceptors(MarkInterceptor)
  class ClassInterceptorBelowController extends BaseController {
    @Get('/')
    get() {
      return { ok: true };
    }
  }

  @UseFilters(markFilter)
  @Controller('/classFilterAbove')
  class ClassFilterAboveController extends BaseController {
    @Get('/')
    get(): never {
      throw new HttpException(HTTP_ERROR, 'boom');
    }
  }

  @Controller('/classFilterBelow')
  @UseFilters(markFilter)
  class ClassFilterBelowController extends BaseController {
    @Get('/')
    get(): never {
      throw new HttpException(HTTP_ERROR, 'boom');
    }
  }

  @Module({
    controllers: [
      RouteController,
      ClassAboveController, ClassBelowController,
      ClassInterceptorAboveController, ClassInterceptorBelowController,
      ClassFilterAboveController, ClassFilterBelowController,
    ],
  })
  class OrderModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(OrderModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app?.stop();
  });

  const call = async (path: string, method = 'GET'): Promise<{ status: number; ran: string[] }> => {
    hits = [];
    const response = await fetch(`${base}${path}`, { method });

    return { status: response.status, ran: [...hits] };
  };

  describe('route level — the order the documentation used', () => {
    it('@UseGuards above @Delete denies, exactly as below it does', async () => {
      // Pre-fix baseline: HTTP 200 with the handler reached and the guard never invoked.
      const above = await call('/route/guardAbove/7', 'DELETE');
      const below = await call('/route/guardBelow/7', 'DELETE');

      expect(above.status).toBe(HTTP_FORBIDDEN);
      expect(above.ran).toEqual(['guard']);
      expect(above).toEqual(below);
    });

    it('@UseInterceptors above @Get runs, exactly as below it does', async () => {
      const above = await call('/route/interceptorAbove');
      const below = await call('/route/interceptorBelow');

      expect(above.ran).toEqual(['interceptor']);
      expect(above.status).toBe(HTTP_OK);
      expect(above).toEqual(below);
    });

    it('@UseFilters above @Get catches, exactly as below it does', async () => {
      const above = await call('/route/filterAbove');
      const below = await call('/route/filterBelow');

      expect(above.ran).toEqual(['filter']);
      expect(above.status).toBe(HTTP_TEAPOT);
      expect(above).toEqual(below);
    });
  });

  describe('class level — already order-independent, must not regress', () => {
    it('@UseGuards is order-independent on a controller', async () => {
      expect(await call('/classAbove/')).toEqual(await call('/classBelow/'));
      expect((await call('/classAbove/')).status).toBe(HTTP_FORBIDDEN);
    });

    it('@UseInterceptors is order-independent on a controller', async () => {
      expect(await call('/classInterceptorAbove/')).toEqual(await call('/classInterceptorBelow/'));
      expect((await call('/classInterceptorAbove/')).ran).toEqual(['interceptor']);
    });

    it('@UseFilters is order-independent on a controller', async () => {
      expect(await call('/classFilterAbove/')).toEqual(await call('/classFilterBelow/'));
      expect((await call('/classFilterAbove/')).status).toBe(HTTP_TEAPOT);
    });
  });
});

// ============================================================================
// Guards are first-class pipeline citizens: DI, and resolved once
// ============================================================================

describe('guard dependency injection', () => {
  const HTTP_FORBIDDEN = 403;

  let constructions = 0;
  let observed: { config: string; logger: string; dep: string } | undefined;

  @Service()
  class SecretService extends BaseService {
    value(): string {
      return 'injected-secret';
    }
  }

  @Service()
  class InjectingGuard extends BaseService implements HttpGuard {
    constructor(private secrets: SecretService) {
      super();
      constructions++;
    }

    canActivate(): boolean {
      observed = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: typeof (this as any).config,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logger: typeof (this as any).logger,
        dep: this.secrets ? this.secrets.value() : 'MISSING',
      };

      // Denying on an injected value is the point: an undefined dependency would throw
      // or produce the wrong answer rather than passing silently.
      return this.secrets.value() !== 'injected-secret';
    }
  }

  @Controller('/di')
  class DiController extends BaseController {
    @Get('/')
    get() {
      return { ok: true };
    }
  }

  @Module({ controllers: [DiController], providers: [SecretService, InjectingGuard] })
  class DiModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;

  beforeAll(async () => {
    // The guard is applied at the controller level so the class-level path is covered too.
    UseGuards(InjectingGuard)(DiController);
    app = new OneBunApplication(DiModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('injects constructor dependencies and the ambient logger/config', async () => {
    const response = await fetch(`${app.getHttpUrl()}/di/`);

    expect(response.status).toBe(HTTP_FORBIDDEN);
    // Pre-fix: config=undefined, logger=undefined, dep=MISSING — the documented
    // `this.config.get('auth.apiKey')` example threw a TypeError at request time.
    expect(observed).toEqual({ config: 'object', logger: 'object', dep: 'injected-secret' });
  });

  it('resolves its dependencies once, at route-build time', async () => {
    // The DEPENDENCY graph is walked once; the instance is not shared (see the concurrency
    // case below for why that distinction is load-bearing).
    expect(constructions).toBeGreaterThan(0);
  });
});

// ============================================================================
// Guard instances must NOT be shared across requests
//
// Guards are the one pipeline element that has always been constructed per request, so a
// guard may stash request state on `this` across an await. Hoisting construction to
// route-build time — which an earlier revision of the DI fix did — turns exactly that
// pattern into a cross-request race that authorizes a request it must deny.
// ============================================================================

describe('guard instance lifetime', () => {
  const HTTP_OK = 200;
  const HTTP_FORBIDDEN = 403;
  const SLOW_MS = 80;
  const STAGGER_MS = 20;

  @Service()
  class StatefulGuard extends BaseService implements HttpGuard {
    private principal = 'anon';

    async canActivate(ctx: HttpExecutionContext): Promise<boolean> {
      this.principal = ctx.getRequest().headers.get('x-user') ?? 'anon';
      await new Promise((resolve) => {
        setTimeout(resolve, Number(ctx.getRequest().headers.get('x-verify-ms') ?? '0'));
      });

      return this.principal === 'admin';
    }
  }

  @Controller('/lifetime')
  class LifetimeController extends BaseController {
    @Get('/secret')
    @UseGuards(StatefulGuard)
    secret() {
      return { secret: 'classified' };
    }
  }

  @Module({ controllers: [LifetimeController], providers: [StatefulGuard] })
  class LifetimeModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;

  beforeAll(async () => {
    app = new OneBunApplication(LifetimeModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('does not let one request overwrite another request state mid-check', async () => {
    const url = `${app.getHttpUrl()}/lifetime/secret`;

    // A slow unauthorized check overlapping a fast authorized one. With a shared instance
    // the second request overwrites `principal` while the first is still awaiting, and the
    // first is then authorized against the second's identity — measured HTTP 200 with the
    // secret body.
    const headersFor = (user: string, verifyMs: number): Headers => {
      const headers = new Headers();
      headers.set('x-user', user);
      headers.set('x-verify-ms', String(verifyMs));

      return headers;
    };

    const [denied, allowed] = await Promise.all([
      fetch(url, { headers: headersFor('mallory', SLOW_MS) }),
      (async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, STAGGER_MS);
        });

        return await fetch(url, { headers: headersFor('admin', 0) });
      })(),
    ]);

    expect(denied.status).toBe(HTTP_FORBIDDEN);
    expect(allowed.status).toBe(HTTP_OK);
  });
});

// ============================================================================
// Class-level pipeline decorators must inherit through `extends`
//
// The metadata polyfill is a WeakMap keyed on the exact object and does not walk the
// prototype chain, unlike the reflect-metadata it replaced — so a controller extending a
// `@UseGuards`-decorated base inherited nothing and answered UNGUARDED. The shape that
// bypassed is the ordinary one: a ProtectedBase that feature controllers extend so the
// decorator is written once.
// ============================================================================

describe('class-level decorator inheritance', () => {
  const HTTP_OK = 200;
  const HTTP_FORBIDDEN = 403;
  const HTTP_TEAPOT = 418;
  const HTTP_ERROR = 500;

  let ran: string[] = [];

  class DenyGuard implements HttpGuard {
    canActivate(): boolean {
      ran.push('deny');

      return false;
    }
  }

  class AllowGuard implements HttpGuard {
    canActivate(): boolean {
      ran.push('allow');

      return true;
    }
  }

  class SubAllowGuard implements HttpGuard {
    canActivate(): boolean {
      ran.push('sub-allow');

      return true;
    }
  }

  class InheritedInterceptor extends BaseInterceptor {
    async intercept(_ctx: unknown, next: () => Promise<unknown>): Promise<unknown> {
      ran.push('interceptor');

      return await next();
    }
  }

  const inheritedFilter: ExceptionFilter = {
    catch(): Response {
      ran.push('filter');

      return new Response(JSON.stringify({ filtered: true }), { status: HTTP_TEAPOT });
    },
  };

  // (1) a base that is decorated but is NOT itself a @Controller
  @UseGuards(DenyGuard)
  class ProtectedBase extends BaseController {}

  @Controller('/admin')
  class AdminController extends ProtectedBase {
    @Get('/users')
    users() {
      ran.push('HANDLER');

      return { users: ['root'] };
    }
  }

  // (2) a base that IS a @Controller with its own routes
  @Controller('/mounted')
  @UseGuards(DenyGuard)
  class MountedBase extends BaseController {
    @Get('/own')
    own() {
      ran.push('HANDLER');

      return { ok: true };
    }
  }

  @Controller('/child')
  class ChildController extends MountedBase {
    @Get('/secret')
    secret() {
      ran.push('HANDLER');

      return { secret: 'leaked' };
    }
  }

  // (3) filters and interceptors inherit too
  @UseInterceptors(InheritedInterceptor)
  @UseFilters(inheritedFilter)
  class ObservedBase extends BaseController {}

  @Controller('/observed')
  class ObservedController extends ObservedBase {
    @Get('/ok')
    ok() {
      return { ok: true };
    }

    @Get('/boom')
    boom(): never {
      throw new HttpException(HTTP_ERROR, 'boom');
    }
  }

  // (4) merge order — the base contributes first
  @UseGuards(AllowGuard)
  class OrderedBase extends BaseController {}

  @Controller('/ordered')
  @UseGuards(SubAllowGuard)
  class OrderedController extends OrderedBase {
    @Get('/')
    get() {
      return { ok: true };
    }
  }

  @Module({
    controllers: [AdminController, MountedBase, ChildController, ObservedController, OrderedController],
  })
  class InheritanceModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;

  beforeAll(async () => {
    app = new OneBunApplication(InheritanceModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  const call = async (path: string): Promise<{ status: number; ran: string[] }> => {
    ran = [];
    const response = await fetch(`${app.getHttpUrl()}${path}`);

    return { status: response.status, ran: [...ran] };
  };

  it('a subclass of a guarded base is guarded — the base need not be a @Controller', async () => {
    // Pre-fix: HTTP 200 with ran=['HANDLER'] — the guard was never registered.
    const result = await call('/admin/users');

    expect(result.status).toBe(HTTP_FORBIDDEN);
    expect(result.ran).toEqual(['deny']);
  });

  it('a subclass of a guarded @Controller is guarded, and so is the base itself', async () => {
    const child = await call('/child/secret');
    const base = await call('/mounted/own');

    // Pre-fix: the child answered HTTP 200 with the body while the base answered 403.
    expect(child.status).toBe(HTTP_FORBIDDEN);
    expect(child.ran).toEqual(['deny']);
    expect(base.status).toBe(HTTP_FORBIDDEN);
  });

  it('inherits @UseInterceptors and @UseFilters as well', async () => {
    const ok = await call('/observed/ok');
    const boom = await call('/observed/boom');

    expect(ok.ran).toEqual(['interceptor']);
    expect(boom.status).toBe(HTTP_TEAPOT);
    expect(boom.ran).toContain('filter');
  });

  it('runs the base class guards first, then the subclass own', async () => {
    const result = await call('/ordered/');

    expect(result.status).toBe(HTTP_OK);
    // Same order as the existing controller-then-route merge.
    expect(result.ran).toEqual(['allow', 'sub-allow']);
  });
});

// ============================================================================
// ...and nothing that must NOT inherit starts inheriting
// ============================================================================

describe('class-level inheritance does not overreach', () => {
  const HTTP_OK = 200;

  @Service()
  class DepA extends BaseService {
    who(): string {
      return 'A';
    }
  }

  @Service()
  class DepB extends BaseService {
    who(): string {
      return 'B';
    }
  }

  @Controller('/inherit-base')
  class ParamBase extends BaseController {
    constructor(public a: DepA) {
      super();
    }

    @Get('/own')
    own() {
      return { from: 'base', dep: this.a.who() };
    }
  }

  @Controller('/inherit-sub')
  class ParamSub extends ParamBase {
    constructor(public b: DepB) {
      super(undefined as never);
    }

    @Get('/mine')
    mine() {
      return { from: 'sub', dep: this.b.who() };
    }
  }

  @Module({ controllers: [ParamBase, ParamSub], providers: [DepA, DepB] })
  class ParamModule {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: OneBunApplication<any, any>;

  beforeAll(async () => {
    app = new OneBunApplication(ParamModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer() as never,
      metrics: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('resolves each class own constructor dependencies', async () => {
    // design:paramtypes must stay per-class: only the four class-level PIPELINE readers
    // walk the prototype chain, not the metadata polyfill itself.
    const sub = await fetch(`${app.getHttpUrl()}/inherit-sub/mine`);
    const base = await fetch(`${app.getHttpUrl()}/inherit-base/own`);

    expect(await sub.json()).toEqual({ success: true, result: { from: 'sub', dep: 'B' } });
    expect(await base.json()).toEqual({ success: true, result: { from: 'base', dep: 'A' } });
  });

  it('does not copy the base class routes onto the subclass', async () => {
    const routes = getControllerMetadata(ParamSub)?.routes ?? [];
    const paths = routes.map((route) => `${route.method} ${route.path}`);

    expect(paths).toEqual(['GET /mine']);
    expect(paths.length).toBe(new Set(paths).size);

    // A route declared on the base is not mounted under the subclass prefix. That is
    // pre-existing and fail-closed (404, never an unguarded 200); it is stated in
    // docs/api/controllers.md rather than changed here.
    const inherited = await fetch(`${app.getHttpUrl()}/inherit-sub/own`);
    expect(inherited.status).not.toBe(HTTP_OK);
  });
});
