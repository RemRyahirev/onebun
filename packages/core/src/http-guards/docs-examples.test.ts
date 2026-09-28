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
  BearerPresenceGuard,
  BaseController,
  BaseService,
  Controller,
  createHttpGuard,
  Delete,
  Get,
  getRequestContext,
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
  Service,
  updateRequestContext,
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
    params: {},
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
// docs:api/guards.md#production-authentication — the verifying guard and the extractor.
// Defined ahead of every controller: the Applying Guards examples use them too.
// ============================================================================

interface DocsVerifiedUser {
  id: string;
  roles: string[];
}

// The augmentation the page documents as `user?: AuthenticatedUser`. An application writes
// `declare module '@onebun/core'`; inside the package the module path is the same interface. The
// member gets its own name because an augmentation in a test file is global to the typecheck
// program, and `request-context.test.ts` already declares `user` with a different shape.
declare module '../request-context' {
  interface RequestContext {
    guardsDocsUser?: DocsVerifiedUser;
  }
}

/**
 * Stands in for the page's `TokenService`: the only place the verdict can come from, so a 200 from
 * the guarded routes proves the guard received it through constructor injection.
 */
@Service()
class DocsTokenService extends BaseService {
  private readonly issued = new Map<string, DocsVerifiedUser>([
    ['admin-token', { id: 'u-admin', roles: ['admin'] }],
    ['viewer-token', { id: 'u-viewer', roles: ['viewer'] }],
  ]);

  async verify(token: string): Promise<DocsVerifiedUser | null> {
    // Asynchronous like a real verification, so the guard's await is exercised.
    await Promise.resolve();

    return this.issued.get(token) ?? null;
  }
}

@Service()
class VerifiedTokenGuard implements HttpGuard {
  constructor(private readonly tokens: DocsTokenService) {}

  async canActivate(ctx: HttpExecutionContext): Promise<boolean> {
    const header = ctx.getRequest().headers.get('authorization');
    if (!header?.startsWith('Bearer ')) {
      return false;
    }

    const user = await this.tokens.verify(header.slice('Bearer '.length));
    if (!user) {
      throw new HttpException(HttpStatusCode.UNAUTHORIZED, 'Invalid or expired token');
    }

    updateRequestContext({ guardsDocsUser: user });

    return true;
  }
}

const rolesOfVerifiedUser = (): string[] => getRequestContext()?.guardsDocsUser?.roles ?? [];

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

@UseGuards(BearerPresenceGuard)
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

  @UseGuards(VerifiedTokenGuard, new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/:id')
  remove(@Param('id') id: string) {
    handlerHits.push('resources:remove');

    return { removed: id };
  }
}

// ============================================================================
// docs:api/guards.md#combining-controller-route-guards
// ============================================================================

/**
 * Records its turn, then decides exactly as the page's `VerifiedTokenGuard` does. It wraps the guard
 * rather than extending it so that its own constructor, which DI reads, is the one it declares.
 */
@Service()
class TracingVerifiedTokenGuard implements HttpGuard {
  constructor(private readonly tokens: DocsTokenService) {}

  async canActivate(ctx: HttpExecutionContext): Promise<boolean> {
    guardTrace.push('controller:auth');

    return await new VerifiedTokenGuard(this.tokens).canActivate(ctx);
  }
}

/** A subclass of the exported guard, a pattern the page invites: it inherits the two-argument constructor. */
class TracingRolesGuard extends RolesGuard {
  override canActivate(ctx: ExecutionContext): boolean {
    guardTrace.push('route:roles');

    return super.canActivate(ctx);
  }
}

@UseGuards(TracingVerifiedTokenGuard)
@Controller('/admin-combined')
class AdminCombinedController extends BaseController {
  @Get('/stats')
  getStats() {
    handlerHits.push('admin:getStats');

    return { visits: 1 };
  }

  @UseGuards(new TracingRolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/user/:id')
  deleteUser(@Param('id') id: string) {
    handlerHits.push('admin:deleteUser');

    return { deleted: id };
  }
}

// ============================================================================
// docs:api/guards.md#on-an-overriding-method
// ============================================================================

/** Records its turn, then decides exactly as the page's `VerifiedTokenGuard` does. */
@Service()
class BaseMethodVerifiedTokenGuard implements HttpGuard {
  constructor(private readonly tokens: DocsTokenService) {}

  async canActivate(ctx: HttpExecutionContext): Promise<boolean> {
    guardTrace.push('base-method:auth');

    return await new VerifiedTokenGuard(this.tokens).canActivate(ctx);
  }
}

class OverrideRolesGuard extends RolesGuard {
  override canActivate(ctx: ExecutionContext): boolean {
    guardTrace.push('override:roles');

    return super.canActivate(ctx);
  }
}

class AccountHandlers extends BaseController {
  @UseGuards(BaseMethodVerifiedTokenGuard)
  remove(id: string) {
    handlerHits.push('account-handlers:remove');

    return { removed: id };
  }
}

@Controller('/accounts')
class AdminAccountController extends AccountHandlers {
  @UseGuards(new OverrideRolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/:id')
  override remove(@Param('id') id: string) {
    handlerHits.push('accounts:remove');

    return { removed: id };
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

// ============================================================================
// docs:api/guards.md#rolesguard
// ============================================================================

// The extractor the danger box warns about: it reads a request header, so the caller decides.
const rolesFromHeader = (ctx: HttpExecutionContext): string[] => (
  ctx.getRequest().headers.get('x-user-roles')?.split(',') ?? []
);

@Controller('/roles')
class RolesController extends BaseController {
  @UseGuards(new RolesGuard(['admin'], rolesFromHeader))
  @Get('/header-extractor')
  headerExtractor() {
    handlerHits.push('roles:headerExtractor');

    return { reached: true };
  }

  // The class instead of an instance: the framework constructs it with no arguments per request.
  @UseGuards(RolesGuard)
  @Get('/class-form')
  classForm() {
    handlerHits.push('roles:classForm');

    return { reached: true };
  }
}

// ============================================================================
// docs:api/guards.md#production-authentication
// ============================================================================

@UseGuards(VerifiedTokenGuard)
@Controller('/prod-auth')
class ProductionAuthController extends BaseController {
  @Get('/me')
  me() {
    handlerHits.push('prod-auth:me');

    return getRequestContext()?.guardsDocsUser ?? null;
  }

  @UseGuards(new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Delete('/users/:id')
  deleteUser(@Param('id') id: string) {
    handlerHits.push('prod-auth:deleteUser');

    return { deleted: id };
  }
}

// The same extractor with NO verifying guard in front: nothing wrote an identity, so it must deny.
@Controller('/prod-auth-unverified')
class UnverifiedRolesController extends BaseController {
  @UseGuards(new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Get('/area')
  area() {
    handlerHits.push('prod-auth-unverified:area');

    return { reached: true };
  }
}

// The single-route form: both guards in ONE list, verifying guard first.
@Controller('/prod-auth-single')
class SingleListAuthController extends BaseController {
  @UseGuards(VerifiedTokenGuard, new RolesGuard(['admin'], rolesOfVerifiedUser))
  @Get('/area')
  area() {
    handlerHits.push('prod-auth-single:area');

    return { reached: true };
  }
}

@Module({
  providers: [DocsTokenService],
  controllers: [
    QuickReferenceController,
    InterfaceController,
    FunctionGuardController,
    AsyncGuardController,
    ProtectedController,
    ResourceController,
    AdminCombinedController,
    AdminAccountController,
    GuardResponseController,
    RolesController,
    ProductionAuthController,
    UnverifiedRolesController,
    SingleListAuthController,
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
    it('should require a verified token AND the verified admin role, and only on the decorated route', async () => {
      const anonymous = await call('/resources/7', { method: 'DELETE' });

      expect(anonymous.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(anonymous.hits).toEqual([]);

      // Verified, but not an admin: the first guard passes, RolesGuard does not — they are ANDed.
      const viewer = await call('/resources/7', {
        method: 'DELETE',
        headers: { authorization: 'Bearer viewer-token' },
      });

      expect(viewer.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(viewer.hits).toEqual([]);

      // A header claiming the role changes nothing: the extractor reads the verified identity.
      const claimsAdmin = await call('/resources/7', {
        method: 'DELETE',
        headers: headersOf(['authorization', 'Bearer viewer-token'], ['x-user-roles', 'admin']),
      });

      expect(claimsAdmin.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(claimsAdmin.hits).toEqual([]);

      const admin = await call('/resources/7', {
        method: 'DELETE',
        headers: { authorization: 'Bearer admin-token' },
      });

      expect(admin.status).toBe(HttpStatusCode.OK);
      expect(admin.body).toEqual({ success: true, result: { removed: '7' } });
      expect(admin.hits).toEqual(['resources:remove']);

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
      const viewer = { authorization: 'Bearer viewer-token' };

      // /stats carries only the controller guard.
      const stats = await call('/admin-combined/stats', { headers: viewer });

      expect(stats.status).toBe(HttpStatusCode.OK);
      expect(stats.body).toEqual({ success: true, result: { visits: 1 } });
      expect(stats.trace).toEqual(['controller:auth']);

      // Anonymous DELETE: the CONTROLLER guard denies and short-circuits, so the route
      // guard never runs — which is only possible if the controller guard runs first.
      const anonymous = await call('/admin-combined/user/7', { method: 'DELETE' });

      expect(anonymous.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(anonymous.trace).toEqual(['controller:auth']);
      expect(anonymous.hits).toEqual([]);

      // Verified but no admin role: the controller guard passes, then the route guard denies.
      const notAdmin = await call('/admin-combined/user/7', { method: 'DELETE', headers: viewer });

      expect(notAdmin.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(notAdmin.trace).toEqual(['controller:auth', 'route:roles']);
      expect(notAdmin.hits).toEqual([]);

      const admin = await call('/admin-combined/user/7', {
        method: 'DELETE',
        headers: { authorization: 'Bearer admin-token' },
      });

      expect(admin.status).toBe(HttpStatusCode.OK);
      expect(admin.body).toEqual({ success: true, result: { deleted: '7' } });
      expect(admin.trace).toEqual(['controller:auth', 'route:roles']);
      expect(admin.hits).toEqual(['admin:deleteUser']);
    });
  });

  describe('On an overriding method', () => {
    /**
     * @source docs:api/guards.md#on-an-overriding-method
     */
    it('should guard the override with the base method guard first, then its own', async () => {
      // Anonymous: the guard inherited from the base method denies and short-circuits, so the
      // override's own guard never runs — which is only possible if the base guard runs first.
      const anonymous = await call('/accounts/7', { method: 'DELETE' });

      expect(anonymous.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(anonymous.trace).toEqual(['base-method:auth']);
      expect(anonymous.hits).toEqual([]);

      // Verified but no admin role: the inherited guard passes, then the override's guard denies.
      const viewer = { authorization: 'Bearer viewer-token' };
      const tokenOnly = await call('/accounts/7', { method: 'DELETE', headers: viewer });

      expect(tokenOnly.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(tokenOnly.trace).toEqual(['base-method:auth', 'override:roles']);
      expect(tokenOnly.hits).toEqual([]);

      const both = await call('/accounts/7', {
        method: 'DELETE',
        headers: { authorization: 'Bearer admin-token' },
      });

      expect(both.status).toBe(HttpStatusCode.OK);
      expect(both.body).toEqual({ success: true, result: { removed: '7' } });
      expect(both.trace).toEqual(['base-method:auth', 'override:roles']);
      // The override is the handler; the base method body is not called.
      expect(both.hits).toEqual(['accounts:remove']);
    });
  });

  describe('BearerPresenceGuard', () => {
    /**
     * @source docs:api/guards.md#authguard
     */
    it('should accept only a header that starts with "Bearer ", without validating the token', () => {
      const guard = new BearerPresenceGuard();

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
      expect(new BearerPresenceGuard().canActivate(queueCtx)).toBe(false);
      expect(new BearerPresenceGuard().canActivate(wsCtx)).toBe(false);
      // RolesGuard denies there even with an extractor that would admit: the check comes first.
      expect(new RolesGuard(['admin'], () => ['admin']).canActivate(queueCtx)).toBe(false);
      expect(new RolesGuard(['admin'], () => ['admin']).canActivate(wsCtx)).toBe(false);
    });
  });

  describe('RolesGuard', () => {
    /**
     * @source docs:api/guards.md#rolesguard
     */
    it('should require ALL listed roles in what the extractor returns, and read nothing else', () => {
      let roles: string[] = [];
      const guard = new RolesGuard(['admin', 'moderator'], () => roles);
      // The header the page warns about is on every request here; the guard never looks at it.
      const ctx = makeHttpContext([['x-user-roles', 'admin, moderator']]);

      roles = ['admin', 'moderator', 'viewer'];
      expect(guard.canActivate(ctx)).toBe(true);

      roles = ['admin'];
      expect(guard.canActivate(ctx)).toBe(false);

      roles = [];
      expect(guard.canActivate(ctx)).toBe(false);
    });

    /**
     * @source docs:api/guards.md#rolesguard
     */
    it('should deny on the verified-identity extractor when no identity was recorded', () => {
      // Outside any request context — nothing recorded a user — the page's extractor returns [].
      expect(rolesOfVerifiedUser()).toEqual([]);
      expect(new RolesGuard(['admin'], rolesOfVerifiedUser).canActivate(makeHttpContext())).toBe(false);
    });

    /**
     * @source docs:api/guards.md#rolesguard
     */
    it('should refuse to be built without an extractor, and answer 500 when passed as a class', async () => {
      // @ts-expect-error — the extractor is required; this line has to stay a compile error
      expect(() => new RolesGuard(['admin'])).toThrow(TypeError);
      // @ts-expect-error — and it has to be a function
      expect(() => new RolesGuard(['admin'], 'x-user-roles')).toThrow(/requires a rolesExtractor/);

      const classForm = await call('/roles/class-form');

      expect(classForm.status).toBe(500);
      expect(classForm.hits).toEqual([]);
    });

    /**
     * Pins the hazard in "::: danger An extractor that reads a request header trusts the caller":
     * it asserts a BYPASS, not a protection. The route has nothing in front of RolesGuard.
     *
     * @source docs:api/guards.md#rolesguard
     */
    it('should let a caller who merely SENDS x-user-roles through a RolesGuard whose extractor reads it', async () => {
      const forged = await call('/roles/header-extractor', {
        headers: headersOf(['x-user-roles', 'admin']),
      });

      expect(forged.status).toBe(HttpStatusCode.OK);
      expect(forged.body).toEqual({ success: true, result: { reached: true } });
      expect(forged.hits).toEqual(['roles:headerExtractor']);

      // BearerPresenceGuard accepts any Bearer string, so putting it in front changes nothing
      // about who gets in.
      expect(new BearerPresenceGuard().canActivate(makeHttpContext([['authorization', 'Bearer anything']]))).toBe(true);

      // Sending nothing is still refused — the guard does compare, it just compares a claim.
      const anonymous = await call('/roles/header-extractor');

      expect(anonymous.status).toBe(HttpStatusCode.FORBIDDEN);
      expect(anonymous.hits).toEqual([]);
    });

    /**
     * @source docs:api/guards.md#rolesguard
     */
    it('should read roles off the token payload when the extractor decodes it', () => {
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

      // "Decoding a payload is not verifying it": the signature segment is never checked, so this
      // unsigned, caller-written payload passes. That is why the page puts a verifying guard in front.
      expect(guard.canActivate(makeHttpContext([['authorization', jwtWith(['admin', 'ops'])]]))).toBe(true);
      expect(guard.canActivate(makeHttpContext([['authorization', jwtWith(['viewer'])]]))).toBe(false);
      expect(guard.canActivate(makeHttpContext())).toBe(false);

      // Only the payload counts: a header claiming the role is ignored.
      const contradicting = makeHttpContext([
        ['authorization', jwtWith(['viewer'])],
        ['x-user-roles', 'admin'],
      ]);

      expect(guard.canActivate(contradicting)).toBe(false);
    });
  });

  describe('Built-in Guards', () => {
    /**
     * The rename ships without aliases: the old names are gone from the public barrel, so an
     * import of either is a compile error rather than a silent pass-through. `WsAuthGuard` keeps
     * its name because it requires the flag only the gateway's `authenticate` hook sets.
     *
     * @source docs:api/guards.md#built-in-guards
     */
    it('should export the starter guards under the names that say what they check', async () => {
      const core = await import('@onebun/core') as Record<string, unknown>;

      expect(typeof core.BearerPresenceGuard).toBe('function');
      expect(typeof core.MessageAuthorizationPresenceGuard).toBe('function');
      expect(typeof core.WsAuthGuard).toBe('function');
      expect(core.AuthGuard).toBeUndefined();
      expect(core.MessageAuthGuard).toBeUndefined();
    });
  });

  describe('Production Authentication', () => {
    const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

    /**
     * @source docs:api/guards.md#production-authentication
     */
    it('should deny a missing Bearer header with 403 and an unverifiable token with 401', async () => {
      const anonymous = await call('/prod-auth/me');

      expect(anonymous.status).toBe(403);
      expect(anonymous.hits).toEqual([]);

      // The token is PRESENT — BearerPresenceGuard would have passed it. The verifying guard
      // throws, and the filters turn that into the page's 401.
      const forged = await call('/prod-auth/me', { headers: bearer('forged-token') });

      expect(forged.status).toBe(401);
      expect(forged.body.error).toBe('Invalid or expired token');
      expect(forged.hits).toEqual([]);
    });

    /**
     * @source docs:api/guards.md#production-authentication
     */
    it('should hand the verified identity to the handler through the request context', async () => {
      const viewer = await call('/prod-auth/me', { headers: bearer('viewer-token') });

      expect(viewer.status).toBe(200);
      expect(viewer.body).toEqual({ success: true, result: { id: 'u-viewer', roles: ['viewer'] } });
      expect(viewer.hits).toEqual(['prod-auth:me']);
    });

    /**
     * @source docs:api/guards.md#production-authentication
     */
    it('should let RolesGuard decide on the verified roles and ignore x-user-roles', async () => {
      const viewer = await call('/prod-auth/users/7', { method: 'DELETE', headers: bearer('viewer-token') });

      expect(viewer.status).toBe(403);
      expect(viewer.hits).toEqual([]);

      // The header claims admin. The extractor reads the verified identity, so the claim changes
      // nothing.
      const claimsAdmin = await call('/prod-auth/users/7', {
        method: 'DELETE',
        headers: { ...bearer('viewer-token'), ...headersOf(['x-user-roles', 'admin']) },
      });

      expect(claimsAdmin.status).toBe(403);
      expect(claimsAdmin.hits).toEqual([]);

      const admin = await call('/prod-auth/users/7', { method: 'DELETE', headers: bearer('admin-token') });

      expect(admin.status).toBe(200);
      expect(admin.body).toEqual({ success: true, result: { deleted: '7' } });
      expect(admin.hits).toEqual(['prod-auth:deleteUser']);
    });

    /**
     * @source docs:api/guards.md#production-authentication
     */
    it('should run one @UseGuards list left to right, so the verifying guard can precede RolesGuard', async () => {
      const viewer = await call('/prod-auth-single/area', { headers: bearer('viewer-token') });

      expect(viewer.status).toBe(403);
      expect(viewer.hits).toEqual([]);

      const admin = await call('/prod-auth-single/area', { headers: bearer('admin-token') });

      expect(admin.status).toBe(200);
      expect(admin.hits).toEqual(['prod-auth-single:area']);
    });

    /**
     * @source docs:api/guards.md#production-authentication
     */
    it('should deny on the verified-identity extractor when no verifying guard ran', async () => {
      const unverified = await call('/prod-auth-unverified/area', {
        headers: { ...bearer('admin-token'), ...headersOf(['x-user-roles', 'admin']) },
      });

      expect(unverified.status).toBe(403);
      expect(unverified.hits).toEqual([]);
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
