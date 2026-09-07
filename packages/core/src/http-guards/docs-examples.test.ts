/**
 * Documentation examples for docs/api/guards.md.
 *
 * Every symbol comes through the PUBLIC '@onebun/core' specifier, exactly as the page tells
 * the reader to import it: a guard export that falls out of the barrel has to break these
 * tests, not only the deep-path ones next door.
 *
 * @source docs:api/guards.md
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import type {
  ExecutionContext,
  Guard,
  HttpExecutionContext,
  HttpGuard,
  Message,
  OneBunRequest,
  WsClientData,
  WsHandlerMetadata,
} from '@onebun/core';
import {
  AuthGuard,
  BaseController,
  Controller,
  createHttpGuard,
  Delete,
  Get,
  HttpException,
  HttpExecutionContextImpl,
  HttpStatusCode,
  isHttpContext,
  isQueueContext,
  isWsContext,
  MessageExecutionContextImpl,
  Module,
  OneBunApplication,
  Param,
  RolesGuard,
  UseGuards,
  WsExecutionContextImpl,
  WsHandlerType,
} from '@onebun/core';
import { makeMockLoggerLayer } from '@onebun/core/testing';

// ============================================================================
// Shared fixtures
// ============================================================================

/**
 * Header bags are built from tuples rather than object literals: HTTP header names are
 * kebab-case and the repository's naming-convention rule rejects them as property keys.
 */
function headersOf(...entries: [string, string][]): Record<string, string> {
  return Object.fromEntries(entries);
}

function makeHttpContext(
  headers: [string, string][] = [],
  handler = 'fetchOne',
  controller = 'DocsController',
): HttpExecutionContext {
  const request = new Request(
    'http://localhost/docs/guards',
    { headers: headersOf(...headers) },
  ) as unknown as OneBunRequest;

  return new HttpExecutionContextImpl(request, handler, controller);
}

function makeQueueMessage(metadata: Message['metadata'] = {}): Message<{ orderId: string }> {
  return {
    id: 'msg-1',
    pattern: 'orders.created',
    data: { orderId: 'o-1' },
    timestamp: 0,
    metadata,
    ack: async (): Promise<void> => undefined,
    nack: async (): Promise<void> => undefined,
  };
}

function makeWsClient(overrides: Partial<WsClientData> = {}): WsClientData {
  return {
    id: 'ws-client-1',
    rooms: [],
    connectedAt: 0,
    auth: null,
    metadata: {},
    protocol: 'native',
    ...overrides,
  };
}

function makeWsHandler(): WsHandlerMetadata {
  return {
    type: WsHandlerType.MESSAGE,
    pattern: 'orders:*',
    handler: 'onOrders',
    params: [],
  };
}

// ============================================================================
// Recorders — every controller below writes into these so the assertions can
// prove the handler was (or was not) reached, not merely that a status matched.
// ============================================================================

interface RecordedContext {
  handler: string;
  controller: string;
  path: string;
  method: string;
}

let handlerHits: string[] = [];
let guardTrace: string[] = [];
let seenContext: RecordedContext | undefined;
let seenContextType: string | undefined;

function resetObservations(): void {
  seenContext = undefined;
  seenContextType = undefined;
}

// ============================================================================
// docs:api/guards.md#quick-reference-for-ai
// ============================================================================

const passPhraseGuard = createHttpGuard((ctx) => ctx.getRequest().headers.get('x-pass') === 'let-me-in');

@Controller('/qr')
class QuickReferenceController extends BaseController {
  @UseGuards(passPhraseGuard)
  @Get('/gate')
  gate() {
    handlerHits.push('qr:gate');

    return { entered: true };
  }
}

// ============================================================================
// docs:api/guards.md#interface
// ============================================================================

class ContextRecordingGuard implements HttpGuard {
  canActivate(ctx: HttpExecutionContext): boolean {
    const request = ctx.getRequest();

    seenContext = {
      handler: ctx.getHandler(),
      controller: ctx.getController(),
      path: new URL(request.url).pathname,
      method: request.method,
    };

    return true;
  }
}

class UniversalOpenGuard implements Guard {
  canActivate(ctx: ExecutionContext): boolean {
    seenContextType = ctx.type;

    return isHttpContext(ctx) && ctx.getRequest().headers.get('x-open') === 'yes';
  }
}

@Controller('/iface')
class InterfaceController extends BaseController {
  @UseGuards(ContextRecordingGuard, UniversalOpenGuard)
  @Get('/item/:id')
  fetchOne(@Param('id') id: string) {
    handlerHits.push('iface:fetchOne');

    return { id };
  }
}

// ============================================================================
// docs:api/guards.md#function-based-guard
// ============================================================================

const apiKeyGuard = createHttpGuard((ctx) => ctx.getRequest().headers.get('x-api-key') === process.env.API_KEY);

@Controller('/fnguard')
class FunctionGuardController extends BaseController {
  @UseGuards(apiKeyGuard)
  @Get('/data')
  data() {
    handlerHits.push('fnguard:data');

    return { data: 'secret' };
  }
}

// ============================================================================
// docs:api/guards.md#async-guard
// ============================================================================

async function verifyJwt(token: string): Promise<void> {
  await Promise.resolve();
  if (token !== 'good-token') {
    throw new Error('invalid signature');
  }
}

const jwtGuard = createHttpGuard(async (ctx) => {
  const token = ctx.getRequest().headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return false;
  }
  try {
    await verifyJwt(token);

    return true;
  } catch {
    return false;
  }
});

@Controller('/asyncguard')
class AsyncGuardController extends BaseController {
  @UseGuards(jwtGuard)
  @Get('/jwt')
  jwt() {
    handlerHits.push('asyncguard:jwt');

    return { verified: true };
  }
}

// ============================================================================
// docs:api/guards.md#on-a-controller-all-routes
// ============================================================================

@UseGuards(AuthGuard)
@Controller('/protected')
class ProtectedController extends BaseController {
  @Get('/')
  index() {
    handlerHits.push('protected:index');

    return { message: 'authenticated' };
  }

  @Get('/reports')
  reports() {
    handlerHits.push('protected:reports');

    return { message: 'reports' };
  }
}

// ============================================================================
// docs:api/guards.md#on-a-single-route
// ============================================================================

@Controller('/resources')
class ResourceController extends BaseController {
  @Get('/')
  list() {
    handlerHits.push('resources:list');

    return { items: [] };
  }

  @UseGuards(AuthGuard, new RolesGuard(['admin']))
  @Delete('/:id')
  remove(@Param('id') id: string) {
    handlerHits.push('resources:remove');

    return { removed: id };
  }
}

// ============================================================================
// docs:api/guards.md#combining-controller-route-guards
// ============================================================================

class TracingAuthGuard extends AuthGuard {
  override canActivate(ctx: ExecutionContext): boolean {
    guardTrace.push('controller:auth');

    return super.canActivate(ctx);
  }
}

class TracingRolesGuard extends RolesGuard {
  override canActivate(ctx: ExecutionContext): boolean {
    guardTrace.push('route:roles');

    return super.canActivate(ctx);
  }
}

@UseGuards(TracingAuthGuard)
@Controller('/admin-combined')
class AdminCombinedController extends BaseController {
  @Get('/stats')
  getStats() {
    handlerHits.push('admin:getStats');

    return { visits: 1 };
  }

  @UseGuards(new TracingRolesGuard(['admin']))
  @Delete('/user/:id')
  deleteUser(@Param('id') id: string) {
    handlerHits.push('admin:deleteUser');

    return { deleted: id };
  }
}

// ============================================================================
// docs:api/guards.md#guard-response
// ============================================================================

function isExpired(token: string): boolean {
  return token.includes('expired');
}

const denyEverythingGuard = createHttpGuard(() => false);

const tokenGuard = createHttpGuard((ctx) => {
  const token = ctx.getRequest().headers.get('authorization');
  if (!token) {
    return false;
  }
  if (isExpired(token)) {
    throw new HttpException(HttpStatusCode.UNAUTHORIZED, 'Token expired');
  }

  return true;
});

@Controller('/guard-response')
class GuardResponseController extends BaseController {
  @UseGuards(denyEverythingGuard)
  @Get('/plain')
  plain() {
    handlerHits.push('guard-response:plain');

    return { reached: true };
  }

  @UseGuards(tokenGuard)
  @Get('/token')
  token() {
    handlerHits.push('guard-response:token');

    return { reached: true };
  }
}

@Module({
  controllers: [
    QuickReferenceController,
    InterfaceController,
    FunctionGuardController,
    AsyncGuardController,
    ProtectedController,
    ResourceController,
    AdminCombinedController,
    GuardResponseController,
  ],
})
class GuardsDocsModule {}

// ============================================================================

describe('docs/api/guards.md', () => {
  let app: OneBunApplication;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(GuardsDocsModule, {
      port: 0,
      loggerLayer: makeMockLoggerLayer(),
      metrics: { enabled: false },
      tracing: { enabled: false },
      gracefulShutdown: false,
    });
    await app.start();
    base = app.getHttpUrl();
  });

  afterAll(async () => {
    await app?.stop();
  });

  const call = async (
    path: string,
    init: { method?: string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: Record<string, unknown>; hits: string[]; trace: string[] }> => {
    handlerHits = [];
    guardTrace = [];
    const response = await fetch(`${base}${path}`, { method: init.method ?? 'GET', headers: init.headers });
    const body = await response.json() as Record<string, unknown>;

    return {
      status: response.status, body, hits: [...handlerHits], trace: [...guardTrace],
    };
  };

  describe('Quick Reference for AI', () => {
    /**
     * @source docs:api/guards.md#quick-reference-for-ai
     */
    it('should build a working guard from createHttpGuard + UseGuards imported from @onebun/core', async () => {
      const denied = await call('/qr/gate');

      expect(denied.status).toBe(HttpStatusCode.FORBIDDEN);
      // The handler must not have run: a 403 produced *after* the handler would still be a bypass.
      expect(denied.hits).toEqual([]);

      const allowed = await call('/qr/gate', { headers: headersOf(['x-pass', 'let-me-in']) });

      expect(allowed.status).toBe(HttpStatusCode.OK);
      expect(allowed.body).toEqual({ success: true, result: { entered: true } });
      expect(allowed.hits).toEqual(['qr:gate']);
    });

    /**
     * @source docs:api/guards.md#quick-reference-for-ai
     */
    it('should discriminate ExecutionContext by `type` and expose the documented accessors per transport', () => {
      const consumerClass = class OrderConsumer {};
      const queueHandler = (): string => 'handled';

      const httpCtx = makeHttpContext([['x-tenant-id', 'acme']], 'getUser', 'UserController');
      const wsCtx = new WsExecutionContextImpl(
        makeWsClient({ metadata: { tenantId: 'acme' } }),
        {} as never,
        { orderId: 'o-9' },
        makeWsHandler(),
        { room: 'lobby' },
      );
      const queueCtx = new MessageExecutionContextImpl(
        makeQueueMessage({ serviceId: 'orders-service' }),
        'orders.created',
        queueHandler,
        consumerClass,
      );

      expect([httpCtx.type, wsCtx.type, queueCtx.type]).toEqual(['http', 'ws', 'queue']);

      expect([isHttpContext(httpCtx), isWsContext(httpCtx), isQueueContext(httpCtx)]).toEqual([true, false, false]);
      expect([isHttpContext(wsCtx), isWsContext(wsCtx), isQueueContext(wsCtx)]).toEqual([false, true, false]);
      expect([isHttpContext(queueCtx), isWsContext(queueCtx), isQueueContext(queueCtx)]).toEqual([false, false, true]);

      // isHttpContext → getRequest(), getHandler(), getController()
      expect(httpCtx.getRequest().headers.get('x-tenant-id')).toBe('acme');
      expect(httpCtx.getHandler()).toBe('getUser');
      expect(httpCtx.getController()).toBe('UserController');

      // isWsContext → getClient(), getData(), getHandler(), getPatternParams()
      expect(wsCtx.getClient().metadata.tenantId).toBe('acme');
      expect(wsCtx.getData<{ orderId: string }>()).toEqual({ orderId: 'o-9' });
      expect(wsCtx.getHandler().pattern).toBe('orders:*');
      expect(wsCtx.getPatternParams()).toEqual({ room: 'lobby' });

      // isQueueContext → getMessage(), getMetadata(), getPattern(), getHandler(), getClass()
      expect(queueCtx.getMessage<{ orderId: string }>().data).toEqual({ orderId: 'o-1' });
      expect(queueCtx.getMetadata().serviceId).toBe('orders-service');
      expect(queueCtx.getPattern()).toBe('orders.created');
      expect(queueCtx.getHandler()).toBe(queueHandler);
      expect(queueCtx.getClass()).toBe(consumerClass);
    });
  });

  describe('Interface', () => {
    /**
     * @source docs:api/guards.md#interface
     */
    it('should hand a guard the request, the handler method name and the controller class name', async () => {
      resetObservations();

      const allowed = await call('/iface/item/42', { headers: headersOf(['x-open', 'yes']) });

      expect(allowed.status).toBe(HttpStatusCode.OK);
      expect(allowed.body).toEqual({ success: true, result: { id: '42' } });
      // Documented HttpExecutionContext contract: the METHOD name and the CLASS name,
      // not the route path and not the controller prefix.
      expect(seenContext).toEqual({
        handler: 'fetchOne',
        controller: 'InterfaceController',
        path: '/iface/item/42',
        method: 'GET',
      });
      // A `Guard` written against the union sees the discriminant on an HTTP route.
      expect(seenContextType).toBe('http');
    });

    /**
     * @source docs:api/guards.md#interface
     */
    it('should let a Guard written against the union deny an HTTP route', async () => {
      resetObservations();

      const denied = await call('/iface/item/42');

      expect(denied.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(denied.hits).toEqual([]);
      // The HttpGuard ahead of it still ran — guards are sequential, not all-or-nothing.
      expect(seenContext?.handler).toBe('fetchOne');
    });
  });

  describe('Function-based guard', () => {
    /**
     * @source docs:api/guards.md#function-based-guard
     */
    it('should compare the x-api-key header against process.env.API_KEY on every request', async () => {
      const previous = process.env.API_KEY;
      process.env.API_KEY = 'docs-function-guard-key';

      try {
        const wrong = await call('/fnguard/data', { headers: headersOf(['x-api-key', 'nope']) });

        expect(wrong.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(wrong.hits).toEqual([]);

        const right = await call('/fnguard/data', { headers: headersOf(['x-api-key', 'docs-function-guard-key']) });

        expect(right.status).toBe(HttpStatusCode.OK);
        expect(right.body).toEqual({ success: true, result: { data: 'secret' } });
        expect(right.hits).toEqual(['fnguard:data']);

        // Read per request, not captured at decoration time: rotating the key locks the old one out.
        process.env.API_KEY = 'rotated-key';
        const rotated = await call('/fnguard/data', { headers: headersOf(['x-api-key', 'docs-function-guard-key']) });

        expect(rotated.status).toBe(HttpStatusCode.FORBIDDEN);
        expect(rotated.hits).toEqual([]);
      } finally {
        if (previous === undefined) {
          delete process.env.API_KEY;
        } else {
          process.env.API_KEY = previous;
        }
      }
    });
  });

  describe('Async guard', () => {
    /**
     * @source docs:api/guards.md#async-guard
     */
    it('should await a Promise<boolean> from canActivate instead of treating the promise as true', async () => {
      const missing = await call('/asyncguard/jwt');

      expect(missing.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(missing.hits).toEqual([]);

      // The load-bearing case: `verifyJwt` REJECTS, so the guard resolves to false. An
      // unawaited Promise object is truthy, so a framework that stopped awaiting would
      // answer 200 here and let an invalid token through.
      const invalid = await call('/asyncguard/jwt', { headers: { authorization: 'Bearer forged-token' } });

      expect(invalid.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(invalid.hits).toEqual([]);

      const valid = await call('/asyncguard/jwt', { headers: { authorization: 'Bearer good-token' } });

      expect(valid.status).toBe(HttpStatusCode.OK);
      expect(valid.body).toEqual({ success: true, result: { verified: true } });
      expect(valid.hits).toEqual(['asyncguard:jwt']);
    });
  });

  describe('On a controller (all routes)', () => {
    /**
     * @source docs:api/guards.md#on-a-controller-all-routes
     */
    it('should apply a class-level @UseGuards to every route on the controller', async () => {
      const deniedIndex = await call('/protected/');
      const deniedReports = await call('/protected/reports');

      expect([deniedIndex.status, deniedReports.status])
        .toEqual([HttpStatusCode.FORBIDDEN, HttpStatusCode.FORBIDDEN]);
      expect([...deniedIndex.hits, ...deniedReports.hits]).toEqual([]);

      const headers = { authorization: 'Bearer any-token' };
      const allowedIndex = await call('/protected/', { headers });
      const allowedReports = await call('/protected/reports', { headers });

      expect(allowedIndex.body).toEqual({ success: true, result: { message: 'authenticated' } });
      expect(allowedReports.body).toEqual({ success: true, result: { message: 'reports' } });
      expect([...allowedIndex.hits, ...allowedReports.hits]).toEqual(['protected:index', 'protected:reports']);
    });
  });

  describe('On a single route', () => {
    /**
     * @source docs:api/guards.md#on-a-single-route
     */
    it('should require the Bearer token AND the admin role, and only on the decorated route', async () => {
      const anonymous = await call('/resources/:id'.replace(':id', '7'), { method: 'DELETE' });

      expect(anonymous.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(anonymous.hits).toEqual([]);

      const tokenOnly = await call('/resources/7', {
        method: 'DELETE',
        headers: { authorization: 'Bearer any-token' },
      });

      // AuthGuard passes, RolesGuard does not: both are required, they are ANDed.
      expect(tokenOnly.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(tokenOnly.hits).toEqual([]);

      const roleOnly = await call('/resources/7', {
        method: 'DELETE',
        headers: headersOf(['x-user-roles', 'admin']),
      });

      expect(roleOnly.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(roleOnly.hits).toEqual([]);

      const both = await call('/resources/7', {
        method: 'DELETE',
        headers: headersOf(['authorization', 'Bearer any-token'], ['x-user-roles', 'admin']),
      });

      expect(both.status).toBe(HttpStatusCode.OK);
      expect(both.body).toEqual({ success: true, result: { removed: '7' } });
      expect(both.hits).toEqual(['resources:remove']);

      // Route-level guards stay on their route: the sibling GET is untouched.
      const sibling = await call('/resources/');

      expect(sibling.status).toBe(HttpStatusCode.OK);
      expect(sibling.hits).toEqual(['resources:list']);
    });
  });

  describe('Combining controller + route guards', () => {
    /**
     * @source docs:api/guards.md#combining-controller-route-guards
     */
    it('should merge the two lists and run the controller guards before the route guards', async () => {
      const token = { authorization: 'Bearer any-token' };

      // /stats carries only the controller guard.
      const stats = await call('/admin-combined/stats', { headers: token });

      expect(stats.status).toBe(HttpStatusCode.OK);
      expect(stats.body).toEqual({ success: true, result: { visits: 1 } });
      expect(stats.trace).toEqual(['controller:auth']);

      // Anonymous DELETE: the CONTROLLER guard denies and short-circuits, so the route
      // guard never runs — which is only possible if the controller guard runs first.
      const anonymous = await call('/admin-combined/user/7', { method: 'DELETE' });

      expect(anonymous.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(anonymous.trace).toEqual(['controller:auth']);
      expect(anonymous.hits).toEqual([]);

      // Token but no role: the controller guard passes, then the route guard denies.
      const tokenOnly = await call('/admin-combined/user/7', { method: 'DELETE', headers: token });

      expect(tokenOnly.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(tokenOnly.trace).toEqual(['controller:auth', 'route:roles']);
      expect(tokenOnly.hits).toEqual([]);

      const both = await call('/admin-combined/user/7', {
        method: 'DELETE',
        headers: { ...token, ...headersOf(['x-user-roles', 'admin']) },
      });

      expect(both.status).toBe(HttpStatusCode.OK);
      expect(both.body).toEqual({ success: true, result: { deleted: '7' } });
      expect(both.trace).toEqual(['controller:auth', 'route:roles']);
      expect(both.hits).toEqual(['admin:deleteUser']);
    });
  });

  describe('AuthGuard', () => {
    /**
     * @source docs:api/guards.md#authguard
     */
    it('should accept only a header that starts with "Bearer ", without validating the token', () => {
      const guard = new AuthGuard();

      expect(guard.canActivate(makeHttpContext([['authorization', 'Bearer real-looking-token']]))).toBe(true);
      // "Not a Token Validator": any garbage after the scheme is accepted.
      expect(guard.canActivate(makeHttpContext([['authorization', 'Bearer ....']]))).toBe(true);

      expect(guard.canActivate(makeHttpContext())).toBe(false);
      expect(guard.canActivate(makeHttpContext([['authorization', 'Basic dXNlcjpwYXNz']]))).toBe(false);
      // The scheme is matched case-sensitively, prefix included.
      expect(guard.canActivate(makeHttpContext([['authorization', 'bearer token']]))).toBe(false);
      expect(guard.canActivate(makeHttpContext([['authorization', 'Bearer']]))).toBe(false);
    });

    /**
     * @source docs:api/guards.md#authguard
     */
    it('should deny a non-HTTP context rather than read a request that is not there', () => {
      const queueCtx = new MessageExecutionContextImpl(
        makeQueueMessage({ authorization: 'Bearer any-token' }),
        'orders.created',
        () => undefined,
        class OrderConsumer {},
      );
      const wsCtx = new WsExecutionContextImpl(
        makeWsClient({ auth: { authenticated: true } }),
        {} as never,
        {},
        makeWsHandler(),
        {},
      );

      // Documented: HTTP-only guards DENY off-transport — they neither pass nor throw,
      // even when the message itself carries an authorization token.
      expect(new AuthGuard().canActivate(queueCtx)).toBe(false);
      expect(new AuthGuard().canActivate(wsCtx)).toBe(false);
      expect(new RolesGuard(['admin']).canActivate(queueCtx)).toBe(false);
      expect(new RolesGuard(['admin']).canActivate(wsCtx)).toBe(false);
    });
  });

  describe('RolesGuard', () => {
    /**
     * @source docs:api/guards.md#rolesguard
     */
    it('should read roles from a custom extractor instead of the x-user-roles header', () => {
      const parseJwtPayload = (header: string): { roles?: string[] } | undefined => {
        const segments = header.replace('Bearer ', '').split('.');
        if (segments.length !== 3) {
          return undefined;
        }

        return JSON.parse(Buffer.from(segments[1], 'base64url').toString()) as { roles?: string[] };
      };
      const jwtWith = (roles: string[]): string => {
        const payload = Buffer.from(JSON.stringify({ roles })).toString('base64url');

        return `Bearer header.${payload}.signature`;
      };

      const guard = new RolesGuard(
        ['admin'],
        (ctx) => {
          const payload = parseJwtPayload(ctx.getRequest().headers.get('authorization') ?? '');

          return payload?.roles ?? [];
        },
      );

      expect(guard.canActivate(makeHttpContext([['authorization', jwtWith(['admin', 'ops'])]]))).toBe(true);
      expect(guard.canActivate(makeHttpContext([['authorization', jwtWith(['viewer'])]]))).toBe(false);
      expect(guard.canActivate(makeHttpContext())).toBe(false);

      // The custom extractor REPLACES the default one: the header the default reads is ignored.
      const contradicting = makeHttpContext([
        ['authorization', jwtWith(['viewer'])],
        ['x-user-roles', 'admin'],
      ]);

      expect(guard.canActivate(contradicting)).toBe(false);
    });

    /**
     * @source docs:api/guards.md#rolesguard
     */
    it('should require ALL configured roles from the comma-separated x-user-roles header', () => {
      const guard = new RolesGuard(['admin', 'moderator']);

      expect(guard.canActivate(makeHttpContext([['x-user-roles', 'admin, moderator, viewer']]))).toBe(true);
      expect(guard.canActivate(makeHttpContext([['x-user-roles', 'admin']]))).toBe(false);
      expect(guard.canActivate(makeHttpContext([['x-user-roles', '']]))).toBe(false);
    });
  });

  describe('Guard Response', () => {
    /**
     * @source docs:api/guards.md#guard-response
     */
    it('should answer a plain `false` with 403 Forbidden and the documented error envelope', async () => {
      const denied = await call('/guard-response/plain');

      // The page prints the NUMBER — `"code": 403` and "HTTP 403" — so the number is what is
      // asserted. `HttpStatusCode.FORBIDDEN` is the very member the framework builds this
      // answer from, so comparing against it moves with the enum and can never catch it
      // drifting off the documented value.
      expect(denied.status).toBe(403);
      expect(denied.hits).toEqual([]);
      // Stable contract per the docs — asserted field by field, since `details` is a bag
      // exception filters populate and is only `{}` on this plain-denial path.
      expect(denied.body.success).toBe(false);
      expect(denied.body.error).toBe('Forbidden');
      expect(denied.body.code).toBe(403);
      expect(denied.body.details).toEqual({});
    });

    /**
     * @source docs:api/guards.md#guard-response
     */
    it('should let a throwing guard choose the status through the exception filters', async () => {
      const missing = await call('/guard-response/token');

      expect(missing.status).toBe(403);
      expect(missing.body.error).toBe('Forbidden');

      // `throw new HttpException(401, 'Token expired')` — not the flat 403 that `false` gives.
      // Literal numbers on purpose: the guard throws `HttpStatusCode.UNAUTHORIZED`, so an
      // assertion against that same member would hold whatever number it carried, and the
      // 401-vs-403 split is the entire subject of this section.
      const expired = await call('/guard-response/token', {
        headers: { authorization: 'Bearer expired-token' },
      });

      expect(expired.status).toBe(401);
      expect(expired.body.error).toBe('Token expired');
      expect(expired.body.code).toBe(401);
      expect(expired.hits).toEqual([]);

      const fresh = await call('/guard-response/token', {
        headers: { authorization: 'Bearer fresh-token' },
      });

      expect(fresh.status).toBe(HttpStatusCode.OK);
      expect(fresh.hits).toEqual(['guard-response:token']);
    });
  });
});
