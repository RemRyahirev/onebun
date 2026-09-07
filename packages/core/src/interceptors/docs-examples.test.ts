/**
 * Documentation examples for docs/api/interceptors.md.
 *
 * The compile gate already proves these snippets typecheck. What it cannot prove is that the
 * framework still DOES what the prose promises: that a function-based interceptor's header
 * reaches the wire, that `ApplicationOptions.interceptors` stops at HTTP, that the method form
 * of `@UseInterceptors` really is dropped on a `@Subscribe` handler. Every test below asserts
 * an observable outcome — a response header, a status, an ordered trace, a construction count.
 *
 * Imports go through the public `@onebun/core` specifier wherever the page tells the reader to,
 * so a symbol falling out of the barrel fails here rather than silently.
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import type {
  ExecutionContext,
  Interceptor,
  Message,
  MessageMetadata,
  OneBunRequest,
  WsClientData,
  WsHandlerMetadata,
} from '@onebun/core';
import {
  BaseController,
  BaseInterceptor,
  BaseService,
  BaseWebSocketGateway,
  Client,
  composeInterceptors,
  Controller,
  createInterceptor,
  createWsClient,
  createWsServiceDefinition,
  DependencyResolutionError,
  Get,
  HttpException,
  HttpExecutionContextImpl,
  isHttpContext,
  isQueueContext,
  isWsContext,
  LoggingInterceptor,
  MessageData,
  MessageExecutionContextImpl,
  Module,
  OnMessage,
  OneBunApplication,
  Service,
  Subscribe,
  UseInterceptors,
  WebSocketGateway,
  WsExecutionContextImpl,
  WsHandlerType,
} from '@onebun/core';
import { LoggerService, type Logger } from '@onebun/logger';

// ============================================================================
// Shared helpers
// ============================================================================

const HTTP_OK = 200;
const HTTP_TEAPOT = 418;
const HTTP_UNAVAILABLE = 503;
const SETTLE_MS = 40;

/** Records every line the framework and the built-in interceptors log. */
function makeRecordingLoggerLayer(sink: string[]): Layer.Layer<Logger> {
  const record = (level: string) => (message: string): Effect.Effect<void> => {
    sink.push(`${level} ${message}`);

    return Effect.succeed(undefined);
  };

  const logger: Logger = {
    trace: record('TRACE'),
    debug: record('DEBUG'),
    info: record('INFO'),
    warn: record('WARN'),
    error: record('ERROR'),
    fatal: record('FATAL'),
    child: () => logger,
  };

  return Layer.succeed(LoggerService, logger);
}

const sleep = async (ms: number): Promise<void> => await new Promise((resolve) => {
  setTimeout(resolve, ms);
});

// ============================================================================
// docs/api/interceptors.md — Interface
// ============================================================================

describe('docs/api/interceptors.md — Interface', () => {
  const makeMessage = (pattern: string, data: unknown): Message => ({
    id: 'msg-1',
    pattern,
    data,
    timestamp: 1_700_000_000_000,
    metadata: { serviceId: 'orders-service' } as MessageMetadata,
    ack: async () => undefined,
    nack: async () => undefined,
  });

  /**
   * @source docs:api/interceptors.md#interface
   */
  it('narrows an HTTP context and exposes getRequest, getHandler and getController', () => {
    const request = new Request('http://localhost/api/users?page=2') as unknown as OneBunRequest;
    const ctx: ExecutionContext = new HttpExecutionContextImpl(request, 'getUsers', 'UserController');

    expect(ctx.type).toBe('http');
    expect(isHttpContext(ctx)).toBe(true);
    expect(isWsContext(ctx)).toBe(false);
    expect(isQueueContext(ctx)).toBe(false);

    if (!isHttpContext(ctx)) {
      throw new Error('isHttpContext must narrow an HttpExecutionContext');
    }

    expect(ctx.getRequest()).toBe(request);
    expect(ctx.getHandler()).toBe('getUsers');
    expect(ctx.getController()).toBe('UserController');
  });

  /**
   * @source docs:api/interceptors.md#interface
   */
  it('narrows a queue context and exposes getMessage, getMetadata and getPattern', () => {
    const message = makeMessage('order.created', { orderId: 'o-7' });
    const handler = (): string => 'handled';
    class OrderConsumer {}
    const ctx: ExecutionContext = new MessageExecutionContextImpl(
      message,
      'order.created',
      handler,
      OrderConsumer as new (...args: unknown[]) => unknown,
    );

    expect(ctx.type).toBe('queue');
    expect(isQueueContext(ctx)).toBe(true);
    expect(isHttpContext(ctx)).toBe(false);

    if (!isQueueContext(ctx)) {
      throw new Error('isQueueContext must narrow a MessageExecutionContext');
    }

    expect(ctx.getMessage().data).toEqual({ orderId: 'o-7' });
    expect(ctx.getMetadata().serviceId).toBe('orders-service');
    expect(ctx.getPattern()).toBe('order.created');
    expect(ctx.getHandler()).toBe(handler);
  });

  /**
   * @source docs:api/interceptors.md#interface
   */
  it('narrows a WebSocket context and exposes getClient, getSocket, getData and getHandler', () => {
    const client: WsClientData = {
      id: 'c-1',
      rooms: ['lobby'],
      connectedAt: 1_700_000_000_000,
      auth: null,
      metadata: {},
      protocol: 'native',
    } as WsClientData;
    const socket = { readyState: 1 };
    const handlerMeta: WsHandlerMetadata = {
      type: WsHandlerType.MESSAGE,
      pattern: 'chat:send',
      handler: 'handleMessage',
      params: [],
    };
    const ctx: ExecutionContext = new WsExecutionContextImpl(
      client,
      socket as never,
      { text: 'hi' },
      handlerMeta,
      {},
    );

    expect(ctx.type).toBe('ws');
    expect(isWsContext(ctx)).toBe(true);
    expect(isQueueContext(ctx)).toBe(false);

    if (!isWsContext(ctx)) {
      throw new Error('isWsContext must narrow a WsExecutionContext');
    }

    expect(ctx.getClient()).toBe(client);
    expect(ctx.getSocket() as unknown).toBe(socket);
    expect(ctx.getData<{ text: string }>()).toEqual({ text: 'hi' });
    expect(ctx.getHandler().pattern).toBe('chat:send');
  });

  /**
   * The page promises `next()` reaches "the handler (or the next interceptor in the chain)".
   * That is a claim about the framework's composer, so drive `composeInterceptors` instead of
   * calling `intercept()` by hand — a hand-rolled call proves only that the test's own closure
   * runs, and stays green while the real chain is dead.
   *
   * @source docs:api/interceptors.md#interface
   */
  it('runs the handler through await next() and hands its result back out through the whole chain', async () => {
    const seen: string[] = [];

    class TraceInterceptor implements Interceptor {
      constructor(private readonly name: string) {}

      async intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
        seen.push(`${this.name}:before:${context.type}`);
        const result = await next();
        seen.push(`${this.name}:after`);

        return result;
      }
    }

    const request = new Request('http://localhost/api/data') as unknown as OneBunRequest;
    const ctx = new HttpExecutionContextImpl(request, 'getData', 'ApiController');
    const outer = new TraceInterceptor('outer');
    const inner = new TraceInterceptor('inner');
    const chain = composeInterceptors(
      [outer.intercept.bind(outer), inner.intercept.bind(inner)],
      ctx,
      async () => {
        seen.push('handler');

        return { items: [1, 2, 3] };
      },
    );
    const result = await chain();

    // First in the list wraps outermost; every next() steps one layer inwards until it reaches
    // the handler, and the handler's value travels back out through every layer untouched.
    expect(seen).toEqual([
      'outer:before:http',
      'inner:before:http',
      'handler',
      'inner:after',
      'outer:after',
    ]);
    expect(result).toEqual({ items: [1, 2, 3] });
  });
});

// ============================================================================
// docs/api/interceptors.md — Creating and applying interceptors on HTTP routes
// ============================================================================

describe('docs/api/interceptors.md — creating and applying interceptors (HTTP)', () => {
  // --- Function-based (docs: Function-based) -------------------------------
  const timingInterceptor = createInterceptor(async (ctx, next) => {
    const start = performance.now();
    const result = await next();
    const duration = Math.round(performance.now() - start);

    if (isHttpContext(ctx)) {
      const response = result as Response;
      response.headers.set('X-Response-Time', `${duration}ms`);
    }

    return result;
  });

  // --- Class-based (docs: Class-based) -------------------------------------
  let lifetimeConstructions = 0;

  class AddHeaderInterceptor implements Interceptor {
    async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
      const result = await next();

      if (isHttpContext(ctx)) {
        const response = result as Response;
        response.headers.set('X-Powered-By', 'OneBun');
      }

      return result;
    }
  }

  // Same class, instrumented: the page's lifetime claim is about construction, so the counter
  // has to sit in the constructor rather than in `intercept`.
  const lifetimeCalls: string[] = [];

  class LifetimeInterceptor implements Interceptor {
    private readonly instanceId: string;

    constructor() {
      lifetimeConstructions++;
      this.instanceId = `i${lifetimeConstructions}`;
    }

    async intercept(_ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
      lifetimeCalls.push(this.instanceId);

      return await next();
    }
  }

  // --- Short-circuiting (docs: Short-circuiting) ---------------------------
  let maintenanceMode = false;
  let maintenanceHandlerRuns = 0;

  const maintenanceInterceptor = createInterceptor(async (ctx, next) => {
    if (maintenanceMode) {
      if (isHttpContext(ctx)) {
        return new Response(
          JSON.stringify({ error: 'Service temporarily unavailable' }),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          { status: HTTP_UNAVAILABLE, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return { error: 'Service temporarily unavailable' };
    }

    return await next();
  });

  // --- Response transformation (docs: Response Transformation) -------------
  const wrapResponseInterceptor = createInterceptor(async (ctx, next) => {
    const result = await next();

    if (isHttpContext(ctx) && result instanceof Response) {
      const body = await result.json();

      return new Response(
        JSON.stringify({ success: true, data: body }),
        { status: result.status, headers: result.headers },
      );
    }

    return result;
  });

  // --- Errors crossing the interceptor boundary (docs: Quick Reference) ----
  const observed: string[] = [];

  const observingInterceptor = createInterceptor(async (_ctx, next) => {
    try {
      const result = await next();
      observed.push(`resolved ${(result as Response).status}`);

      return result;
    } catch (error) {
      observed.push(`caught ${(error as Error).message}`);
      throw error;
    }
  });

  const explodingInterceptor = createInterceptor(async () => {
    throw new HttpException(HTTP_TEAPOT, 'interceptor exploded');
  });

  @UseInterceptors(AddHeaderInterceptor)
  @Controller('/api')
  class ApiController extends BaseController {
    @UseInterceptors(timingInterceptor)
    @Get('/data')
    getData() {
      return { items: [1, 2, 3] };
    }

    @Get('/plain')
    plain() {
      return { ok: true };
    }
  }

  @UseInterceptors(LifetimeInterceptor)
  @Controller('/lifetime')
  class LifetimeController extends BaseController {
    @Get('/a')
    a() {
      return { route: 'a' };
    }

    @Get('/b')
    b() {
      return { route: 'b' };
    }
  }

  @Controller('/maintenance')
  class MaintenanceController extends BaseController {
    @UseInterceptors(maintenanceInterceptor)
    @Get('/status')
    status() {
      maintenanceHandlerRuns++;

      return { status: 'up' };
    }
  }

  @Controller('/wrap')
  class WrapController extends BaseController {
    @UseInterceptors(wrapResponseInterceptor)
    @Get('/payload')
    payload() {
      return { id: 'u-1' };
    }
  }

  @Controller('/errors')
  class ErrorController extends BaseController {
    @UseInterceptors(observingInterceptor)
    @Get('/handler-throws')
    handlerThrows(): never {
      throw new HttpException(HTTP_TEAPOT, 'handler exploded');
    }

    @UseInterceptors(explodingInterceptor)
    @Get('/interceptor-throws')
    interceptorThrows() {
      return { unreachable: true };
    }
  }

  @Module({
    controllers: [ApiController, LifetimeController, MaintenanceController, WrapController, ErrorController],
  })
  class HttpInterceptorModule {}

  let app: OneBunApplication;
  let base: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    app = new OneBunApplication(HttpInterceptorModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeRecordingLoggerLayer(logLines),
    });
    await app.start();
    base = `http://localhost:${app.getPort()}`;
  });

  afterAll(async () => {
    await app?.stop();
  });

  /**
   * @source docs:api/interceptors.md#function-based
   */
  it('createInterceptor stamps X-Response-Time on the response of the route it wraps', async () => {
    const response = await fetch(`${base}/api/data`);
    const body = await response.json() as { success: boolean; result: { items: number[] } };

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get('X-Response-Time')).toMatch(/^\d+ms$/);
    // The handler still ran and its payload still reached the client.
    expect(body.result.items).toEqual([1, 2, 3]);
  });

  /**
   * @source docs:api/interceptors.md#route-level
   */
  it('@UseInterceptors on a handler wraps that route only', async () => {
    const wrapped = await fetch(`${base}/api/data`);
    const sibling = await fetch(`${base}/api/plain`);

    expect(wrapped.headers.get('X-Response-Time')).toMatch(/^\d+ms$/);
    // Same controller, no route decorator — the timing interceptor must not leak onto it.
    expect(sibling.headers.get('X-Response-Time')).toBeNull();
    expect(sibling.status).toBe(HTTP_OK);
  });

  /**
   * @source docs:api/interceptors.md#class-based
   */
  it('a class implementing Interceptor sets X-Powered-By on the responses it wraps', async () => {
    const response = await fetch(`${base}/api/plain`);

    expect(response.headers.get('X-Powered-By')).toBe('OneBun');
  });

  /**
   * @source docs:api/interceptors.md#controller-level
   */
  it('@UseInterceptors on the controller wraps every route the controller declares', async () => {
    const withRouteInterceptor = await fetch(`${base}/api/data`);
    const withoutRouteInterceptor = await fetch(`${base}/api/plain`);

    expect(withRouteInterceptor.headers.get('X-Powered-By')).toBe('OneBun');
    expect(withoutRouteInterceptor.headers.get('X-Powered-By')).toBe('OneBun');
  });

  /**
   * @source docs:api/interceptors.md#class-based
   * @source docs:api/interceptors.md#quick-reference-for-ai
   */
  it('builds one interceptor instance per registration site and reuses it for every request', async () => {
    // Two routes on one controller — the class-level interceptor is a registration site per
    // route, so exactly two instances exist, both created before any request arrived.
    expect(lifetimeConstructions).toBe(2);

    const before = lifetimeCalls.length;
    await fetch(`${base}/lifetime/a`);
    await fetch(`${base}/lifetime/a`);
    await fetch(`${base}/lifetime/b`);
    await fetch(`${base}/lifetime/b`);
    const served = lifetimeCalls.slice(before);

    // Still two instances after four requests: per-request construction would show four ids.
    expect(lifetimeConstructions).toBe(2);
    expect(served.length).toBe(4);
    expect(new Set(served).size).toBe(2);
  });

  /**
   * @source docs:api/interceptors.md#short-circuiting
   */
  it('an interceptor that returns without calling next skips the handler entirely', async () => {
    maintenanceMode = true;
    const runsBefore = maintenanceHandlerRuns;
    const blocked = await fetch(`${base}/maintenance/status`);
    const blockedBody = await blocked.json() as { error: string };

    expect(blocked.status).toBe(HTTP_UNAVAILABLE);
    expect(blockedBody.error).toBe('Service temporarily unavailable');
    expect(maintenanceHandlerRuns).toBe(runsBefore);

    maintenanceMode = false;
    const allowed = await fetch(`${base}/maintenance/status`);
    const allowedBody = await allowed.json() as { success: boolean; result: { status: string } };

    expect(allowed.status).toBe(HTTP_OK);
    expect(allowedBody.result.status).toBe('up');
    expect(maintenanceHandlerRuns).toBe(runsBefore + 1);
  });

  /**
   * @source docs:api/interceptors.md#response-transformation
   */
  it('an interceptor rewrites the body returned by next() while keeping the status', async () => {
    const response = await fetch(`${base}/wrap/payload`);
    const body = await response.json() as { success: boolean; data: { success: boolean; result: { id: string } } };

    expect(response.status).toBe(HTTP_OK);
    // The framework envelope is what next() produced; the interceptor wrapped it once more.
    expect(body).toEqual({ success: true, data: { success: true, result: { id: 'u-1' } } });
  });

  /**
   * @source docs:api/interceptors.md#quick-reference-for-ai
   */
  it('hides handler errors from an interceptor try/catch but filters the interceptor own throw', async () => {
    observed.length = 0;
    const handlerFailure = await fetch(`${base}/errors/handler-throws`);

    // Filters sit INSIDE the interceptor chain: by the time next() returns, the throw has
    // already become a 418 Response, so the catch block never runs.
    expect(handlerFailure.status).toBe(HTTP_TEAPOT);
    expect(observed).toEqual([`resolved ${HTTP_TEAPOT}`]);

    const interceptorFailure = await fetch(`${base}/errors/interceptor-throws`);
    const body = await interceptorFailure.json() as { success: boolean; error: string };

    expect(interceptorFailure.status).toBe(HTTP_TEAPOT);
    expect(body.success).toBe(false);
    expect(body.error).toBe('interceptor exploded');
  });
});

// ============================================================================
// docs/api/interceptors.md — With DI
// ============================================================================

describe('docs/api/interceptors.md — With DI', () => {
  const auditLog: Array<{ handler: string; status: number }> = [];
  let undecoratedSawDependency: unknown = 'not-run';

  @Service()
  class AuditService extends BaseService {
    async log(handler: string, status: number): Promise<void> {
      auditLog.push({ handler, status });
    }
  }

  @Service()
  class AuditInterceptor extends BaseInterceptor {
    constructor(private auditService: AuditService) {
      super();
    }

    async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
      const result = await next();

      if (isHttpContext(ctx)) {
        await this.auditService.log(ctx.getHandler(), (result as Response).status);
        this.logger.info(`Audited ${ctx.getHandler()}`);
      }

      return result;
    }
  }

  /** No class decorator: TypeScript emits no `design:paramtypes`, so DI has nothing to read. */
  class UndecoratedInterceptor implements Interceptor {
    constructor(private auditService: AuditService) {}

    async intercept(_ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
      undecoratedSawDependency = this.auditService;

      return await next();
    }
  }

  @UseInterceptors(AuditInterceptor)
  @Controller('/audited')
  class AuditedController extends BaseController {
    @Get('/data')
    getData() {
      return { ok: true };
    }
  }

  @UseInterceptors(UndecoratedInterceptor)
  @Controller('/undecorated')
  class UndecoratedController extends BaseController {
    @Get('/data')
    getData() {
      return { ok: true };
    }
  }

  @Module({
    controllers: [AuditedController, UndecoratedController],
    providers: [AuditService],
  })
  class DiInterceptorModule {}

  let app: OneBunApplication;
  let base: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    app = new OneBunApplication(DiInterceptorModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeRecordingLoggerLayer(logLines),
    });
    await app.start();
    base = `http://localhost:${app.getPort()}`;
  });

  afterAll(async () => {
    await app?.stop();
  });

  /**
   * @source docs:api/interceptors.md#with-di
   */
  it('injects the constructor dependency of a @Service() interceptor and wires this.logger', async () => {
    auditLog.length = 0;
    logLines.length = 0;

    const response = await fetch(`${base}/audited/data`);

    expect(response.status).toBe(HTTP_OK);
    // The injected service actually recorded — an undefined dependency would have thrown a
    // TypeError inside intercept() and turned this into a 500.
    expect(auditLog).toEqual([{ handler: 'getData', status: HTTP_OK }]);
    // BaseInterceptor supplies this.logger; the line has to reach the configured logger layer.
    expect(logLines.some((line) => line === 'INFO Audited getData')).toBe(true);
  });

  /**
   * @source docs:api/interceptors.md#with-di
   */
  it('leaves constructor parameters undefined on an undecorated interceptor without failing startup', async () => {
    const response = await fetch(`${base}/undecorated/data`);

    // The documented silent failure mode: the app booted, the route answers, and the
    // dependency is simply missing. If DI ever started resolving undecorated classes this
    // would hold an AuditService instead.
    expect(response.status).toBe(HTTP_OK);
    expect(undecoratedSawDependency).toBeUndefined();
  });

  /**
   * @source docs:api/interceptors.md#with-di
   */
  it('fails app.start() with DependencyResolutionError when a decorated interceptor dependency is unregistered', async () => {
    class UnregisteredRepository {
      find(): string {
        return 'never registered as a provider';
      }
    }

    @Service()
    class UnresolvableInterceptor extends BaseInterceptor {
      constructor(private repository: UnregisteredRepository) {
        super();
      }

      async intercept(_ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
        this.repository.find();

        return await next();
      }
    }

    @UseInterceptors(UnresolvableInterceptor)
    @Controller('/broken')
    class BrokenController extends BaseController {
      @Get('/data')
      getData() {
        return { ok: true };
      }
    }

    @Module({ controllers: [BrokenController] })
    class BrokenModule {}

    const broken = new OneBunApplication(BrokenModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeRecordingLoggerLayer([]),
    });

    let caught: unknown;
    try {
      await broken.start();
    } catch (error) {
      caught = error;
    } finally {
      await broken.stop().catch(() => undefined);
    }

    expect(caught).toBeInstanceOf(DependencyResolutionError);
    expect((caught as Error).message).toContain('UnresolvableInterceptor');
    expect((caught as Error).message).toContain('UnregisteredRepository');
  });
});

// ============================================================================
// docs/api/interceptors.md — Global and Combined
// ============================================================================

describe('docs/api/interceptors.md — global and combined interceptors', () => {
  const trace: string[] = [];

  const makeOrderInterceptor = (name: string) => createInterceptor(async (_ctx, next) => {
    trace.push(`${name}:before`);
    const result = await next();
    trace.push(`${name}:after`);

    return result;
  });

  const globalInterceptor = makeOrderInterceptor('global');
  const controllerInterceptor = makeOrderInterceptor('controller');
  const routeInterceptor = makeOrderInterceptor('route');

  @UseInterceptors(controllerInterceptor)
  @Controller('/pipeline')
  class PipelineController extends BaseController {
    @UseInterceptors(routeInterceptor)
    @Get('/combined')
    combined() {
      trace.push('http-handler');

      return { ok: true };
    }

    @Get('/plain')
    plain() {
      trace.push('plain-handler');

      return { ok: true };
    }

    @Subscribe('pipeline.job')
    async job(_message: Message): Promise<void> {
      trace.push('queue-handler');
    }
  }

  @Module({ controllers: [PipelineController] })
  class PipelineModule {}

  let app: OneBunApplication;
  let base: string;

  beforeAll(async () => {
    app = new OneBunApplication(PipelineModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      queue: { enabled: true, adapter: 'memory' },
      interceptors: [globalInterceptor],
      loggerLayer: makeRecordingLoggerLayer([]),
    });
    await app.start();
    base = `http://localhost:${app.getPort()}`;
  });

  afterAll(async () => {
    await app?.stop();
  });

  /**
   * @source docs:api/interceptors.md#combined
   */
  it('wraps global outermost, then controller, then route, in onion order', async () => {
    trace.length = 0;
    const response = await fetch(`${base}/pipeline/combined`);

    expect(response.status).toBe(HTTP_OK);
    expect(trace).toEqual([
      'global:before',
      'controller:before',
      'route:before',
      'http-handler',
      'route:after',
      'controller:after',
      'global:after',
    ]);
  });

  /**
   * @source docs:api/interceptors.md#global
   */
  it('applies ApplicationOptions.interceptors to a route that carries no @UseInterceptors of its own', async () => {
    trace.length = 0;
    const response = await fetch(`${base}/pipeline/plain`);

    expect(response.status).toBe(HTTP_OK);
    expect(trace).toEqual([
      'global:before',
      'controller:before',
      'plain-handler',
      'controller:after',
      'global:after',
    ]);
  });

  /**
   * @source docs:api/interceptors.md#global
   * @source docs:api/interceptors.md#quick-reference-for-ai
   */
  it('never reaches a queue subscriber with the global list, while the class-level one still runs', async () => {
    trace.length = 0;
    const queue = app.getQueueService();
    if (!queue) {
      throw new Error('queue service must be enabled for this test');
    }

    await queue.publish('pipeline.job', { id: 'j-1' });
    await sleep(SETTLE_MS);

    // The global list is merged at HTTP route registration only: no 'global:*' entry here.
    expect(trace).toEqual(['controller:before', 'queue-handler', 'controller:after']);
  });
});

// ============================================================================
// docs/api/interceptors.md — Cross-transport usage, WS gateways, queue handlers
// ============================================================================

describe('docs/api/interceptors.md — one interceptor across HTTP, WebSocket and Queue', () => {
  const labels: string[] = [];
  const handlerRuns: string[] = [];
  /** Where the METHOD form of `@UseInterceptors` actually ran, by transport. */
  const methodFormRuns: string[] = [];
  const logLines: string[] = [];

  class MetricsInterceptor extends BaseInterceptor {
    async intercept(ctx: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
      let label: string;
      if (isHttpContext(ctx)) {
        const req = ctx.getRequest();
        label = `HTTP ${req.method} ${new URL(req.url).pathname}`;
      } else if (isWsContext(ctx)) {
        const handler = ctx.getHandler();
        label = `WS ${handler.pattern || handler.handler}`;
      } else {
        label = `Queue ${ctx.getPattern()}`;
      }

      labels.push(label);

      return await next();
    }
  }

  const methodFormInterceptor = createInterceptor(async (ctx, next) => {
    methodFormRuns.push(ctx.type);

    return await next();
  });

  @UseInterceptors(LoggingInterceptor, MetricsInterceptor)
  @Controller('/xt')
  class XtController extends BaseController {
    @Get('/data')
    getData() {
      handlerRuns.push('http');

      return { items: [1, 2, 3] };
    }

    // Positive control for the queue case below: the SAME interceptor, in the SAME method
    // form, does run on an HTTP route.
    @UseInterceptors(methodFormInterceptor)
    @Get('/method-form')
    methodForm() {
      handlerRuns.push('method-form');

      return { ok: true };
    }

    // The method form on a @Subscribe handler is written to the prototype while queue
    // registration reads the class — the page says it is silently dropped.
    @UseInterceptors(methodFormInterceptor)
    @Subscribe('xt.job')
    async job(_message: Message): Promise<void> {
      handlerRuns.push('queue');
    }
  }

  @UseInterceptors(LoggingInterceptor, MetricsInterceptor)
  @WebSocketGateway({ path: '/xt-ws' })
  class XtGateway extends BaseWebSocketGateway {
    @OnMessage('xt:ping')
    handlePing(@Client() _client: WsClientData, @MessageData() data: unknown) {
      handlerRuns.push('ws');

      return { event: 'xt:pong', data };
    }
  }

  @Module({ controllers: [XtController, XtGateway] })
  class CrossTransportModule {}

  type WsGatewayProxy = {
    send(event: string, data: unknown): void;
    on(event: string, handler: (data: unknown) => void): void;
  };

  let app: OneBunApplication;
  const wsReplies: Array<{ event: string; data: unknown }> = [];

  beforeAll(async () => {
    app = new OneBunApplication(CrossTransportModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      queue: { enabled: true, adapter: 'memory' },
      loggerLayer: makeRecordingLoggerLayer(logLines),
    });
    await app.start();

    const port = app.getPort();

    // HTTP
    await fetch(`http://localhost:${port}/xt/data`);
    await fetch(`http://localhost:${port}/xt/method-form`);

    // WebSocket
    const definition = createWsServiceDefinition(CrossTransportModule);
    const client = createWsClient(definition, { url: `ws://localhost:${port}/xt-ws`, timeout: 2000 });
    await client.connect();
    await sleep(SETTLE_MS / 2);
    const gateway = (client as unknown as Record<string, WsGatewayProxy>).XtGateway;
    gateway.on('xt:pong', (data: unknown) => {
      wsReplies.push({ event: 'xt:pong', data });
    });
    gateway.send('xt:ping', { text: 'hi' });
    await sleep(SETTLE_MS);
    client.disconnect();

    // Queue
    const queue = app.getQueueService();
    if (!queue) {
      throw new Error('queue service must be enabled for this test');
    }
    await queue.publish('xt.job', { id: 'j-1' });
    await sleep(SETTLE_MS);
  });

  afterAll(async () => {
    await app?.stop();
  });

  /**
   * @source docs:api/interceptors.md#cross-transport-usage
   */
  it('labels every transport from a single interceptor class via the type guards', () => {
    expect(handlerRuns).toEqual(['http', 'method-form', 'ws', 'queue']);
    expect(labels).toEqual([
      'HTTP GET /xt/data',
      'HTTP GET /xt/method-form',
      'WS xt:ping',
      'Queue xt.job',
    ]);
  });

  /**
   * @source docs:api/interceptors.md#websocket-gateway
   */
  it('wraps every @OnMessage handler in a gateway carrying a class-level @UseInterceptors', () => {
    expect(labels).toContain('WS xt:ping');
    // The handler still ran and its reply still reached the client through the chain.
    expect(wsReplies).toEqual([{ event: 'xt:pong', data: { text: 'hi' } }]);
  });

  /**
   * @source docs:api/interceptors.md#queue-handler
   */
  it('wraps @Subscribe handlers from the class level and drops the method form', () => {
    expect(labels).toContain('Queue xt.job');
    expect(handlerRuns.filter((entry) => entry === 'queue')).toEqual(['queue']);
    // Documented no-op. The SAME interceptor in the SAME method form ran on the HTTP route,
    // so the empty queue entry is the framework dropping it, not the interceptor never wiring.
    expect(methodFormRuns).toEqual(['http']);
  });

  /**
   * @source docs:api/interceptors.md#logginginterceptor
   */
  it('LoggingInterceptor logs transport-aware Incoming/Completed labels with timing', () => {
    const info = logLines.filter((line) => line.startsWith('INFO '));

    expect(info).toContain('INFO Incoming GET /xt/data');
    expect(info.some((line) => /^INFO Completed GET \/xt\/data 200 \d+ms$/.test(line))).toBe(true);

    expect(info).toContain('INFO Incoming WS xt:ping');
    expect(info.some((line) => /^INFO Completed WS xt:ping \d+ms$/.test(line))).toBe(true);

    expect(info).toContain('INFO Incoming Queue xt.job');
    expect(info.some((line) => /^INFO Completed Queue xt\.job \d+ms$/.test(line))).toBe(true);
  });
});
