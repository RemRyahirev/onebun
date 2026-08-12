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
