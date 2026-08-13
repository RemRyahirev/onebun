/**
 * `@UseGuards` on WebSocket message handlers: honoured at all, given DI, and denying loudly.
 *
 * `@UseGuards` wrote `onebun:http_guards`, a key only HTTP route registration read, so on an
 * `@OnMessage` handler it was a SILENT no-op — the handler ran completely unguarded with no
 * type error, no warning and nothing in the logs. Separately, `executeGuards` built class
 * guards with a bare `new guard()` (ws-guards.ts), so a guard with a constructor dependency
 * threw on every message.
 *
 * Denial semantics asserted here: an `error` frame back to the client, and the socket STAYS
 * OPEN — one denied message must not tear down a connection multiplexing a dozen others.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from 'bun:test';
import { Effect, Layer } from 'effect';

import type { WsClientData } from './ws.types';

import { LoggerService, type Logger } from '@onebun/logger';

import { OneBunApplication } from '../application/application';
import { Module, UseGuards } from '../decorators/decorators';
import { attachGuardBinding } from '../http-guards/guard-binding';
import { BaseService, Service } from '../module/service';
import { createMockSyncLogger } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { createWsClient } from './ws-client';
import {
  WebSocketGateway,
  OnMessage,
  Client,
  MessageData,
  getWsHandlers,
} from './ws-decorators';
import { WsHandler } from './ws-handler';
import { createWsServiceDefinition } from './ws-service-definition';

const TEST_PORT = 19881;
const TEST_URL = `ws://localhost:${TEST_PORT}/guarded`;

const logLines: string[] = [];

function makeRecordingLoggerLayer(): Layer.Layer<Logger, never, never> {
  const record = (level: string) => (message: string): Effect.Effect<void> => {
    logLines.push(`${level} ${message}`);

    return Effect.succeed(undefined);
  };

  const logger: Logger = {
    trace: () => Effect.succeed(undefined),
    debug: () => Effect.succeed(undefined),
    info: () => Effect.succeed(undefined),
    warn: record('WARN'),
    error: record('ERROR'),
    fatal: record('FATAL'),
    child: () => logger,
  };

  return Layer.succeed(LoggerService, logger);
}

const ran: Record<string, number> = {};
/** How many times each guard's canActivate actually ran — zero proves it was skipped. */
const guardCalls: Record<string, number> = {};

class DenyGuard {
  canActivate(): boolean {
    return false;
  }
}

class ThrowingWsGuard {
  canActivate(): boolean {
    throw new Error('ws guard exploded');
  }
}

@Service()
class RoomPolicyService extends BaseService {
  isAllowed(client: WsClientData): boolean {
    return client.metadata.tier === 'vip';
  }
}

/** The shape that threw on every message before guards had DI on this transport. */
@Service()
class VipGuard {
  constructor(private readonly policy: RoomPolicyService) {}

  canActivate(ctx: { getClient(): WsClientData }): boolean {
    guardCalls.vip = (guardCalls.vip ?? 0) + 1;

    return this.policy.isAllowed(ctx.getClient());
  }
}

@WebSocketGateway({
  path: '/guarded',
  // `tier` rides in on the token so the DI'd guard has something to decide on.
  authenticate: ({ token }) => ({ userId: 'u1', metadata: { tier: token ?? 'free' } }),
})
class GuardedGateway extends BaseWebSocketGateway {
  @OnMessage('open')
  handleOpen(@MessageData() data: unknown) {
    ran.open = (ran.open ?? 0) + 1;

    return { event: 'open:ok', data };
  }

  @UseGuards(DenyGuard)
  @OnMessage('denied')
  handleDenied() {
    ran.denied = (ran.denied ?? 0) + 1;

    return { event: 'denied:ok', data: {} };
  }

  @UseGuards(VipGuard)
  @OnMessage('vip')
  handleVip(@Client() client: WsClientData) {
    ran.vip = (ran.vip ?? 0) + 1;

    return { event: 'vip:ok', data: { userId: client.auth?.userId } };
  }

  @UseGuards(ThrowingWsGuard)
  @OnMessage('boom')
  handleBoom() {
    ran.boom = (ran.boom ?? 0) + 1;

    return { event: 'boom:ok', data: {} };
  }
}

@Module({ controllers: [GuardedGateway], providers: [RoomPolicyService] })
class GuardedGatewayModule {}

describe('@UseGuards on WebSocket handlers (end to end)', () => {
  let app: OneBunApplication;
  let definition: ReturnType<typeof createWsServiceDefinition>;

  beforeAll(async () => {
    app = new OneBunApplication(GuardedGatewayModule, {
      port: TEST_PORT,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeRecordingLoggerLayer(),
    });
    await app.start();
    definition = createWsServiceDefinition(GuardedGatewayModule);
  });

  afterAll(async () => {
    await app.stop();
  });

  /** Connect, send one event, collect what came back. */
  const exchange = async (
    event: string,
    token?: string,
  ): Promise<{ events: Array<{ event: string; data: unknown }>; stillOpen: boolean }> => {
    const client = createWsClient(definition, {
      url: TEST_URL,
      timeout: 2000,
      ...(token ? { auth: { token } } : {}),
    });
    const events: Array<{ event: string; data: unknown }> = [];

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 20));

    for (const name of ['error', 'denied:ok', 'vip:ok', 'boom:ok', 'open:ok']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).GuardedGateway.on(name, (data: unknown) => {
        events.push({ event: name, data });
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).GuardedGateway.send(event, { ping: true });
    await new Promise((resolve) => setTimeout(resolve, 40));

    // The socket must survive a denial: an unguarded event still answers on the SAME client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).GuardedGateway.send('open', { after: event });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const stillOpen = events.some((e) => e.event === 'open:ok');
    client.disconnect();

    return { events, stillOpen };
  };

  it('runs an unguarded handler — positive control', async () => {
    const before = ran.open ?? 0;
    await exchange('open');

    expect(ran.open).toBeGreaterThan(before);
  });

  it('does not run a handler carrying @UseGuards(DenyGuard)', async () => {
    // Pre-fix this counter read 1: the guard was discarded and the handler ran unguarded.
    const { events } = await exchange('denied');

    expect(ran.denied).toBeUndefined();
    expect(events.some((e) => e.event === 'denied:ok')).toBe(false);
  });

  it('answers a denied message with an error frame and leaves the socket open', async () => {
    const { events, stillOpen } = await exchange('denied');

    const errorFrame = events.find((e) => e.event === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame?.data).toMatchObject({ code: 'FORBIDDEN', event: 'denied' });
    expect(stillOpen).toBe(true);
  });

  it('gives a guard with a constructor dependency real DI', async () => {
    // Pre-fix: `new VipGuard()` with no arguments, so `this.policy` was undefined and
    // canActivate threw a TypeError on every message.
    guardCalls.vip = 0;
    await exchange('vip', 'vip');

    // The guard must have RUN, not merely have been skipped — pre-fix `@UseGuards` was
    // discarded on this transport, so the handler ran with canActivate never called.
    expect(guardCalls.vip).toBe(1);
    expect(ran.vip).toBe(1);
  });

  it('denies through the same DI guard when the injected policy says no', async () => {
    const before = ran.vip ?? 0;
    await exchange('vip', 'free');

    expect(ran.vip ?? 0).toBe(before);
  });

  it('registering the same gateway twice does not stack its guards', () => {
    // Gateway metadata is a process-wide Map keyed by class and registerGateway writes the
    // RESOLVED guards back into it, so a second registration — multi-service mode, or a suite
    // that boots twice — would otherwise read its own output back as input and run the
    // gateway-level guards twice, the second time bound to the first application's DI scope.
    @WebSocketGateway({ path: '/twice' })
    @UseGuards(DenyGuard)
    class TwiceGateway extends BaseWebSocketGateway {
      @OnMessage('x')
      handle(): string {
        return 'x';
      }
    }

    const handler = new WsHandler(createMockSyncLogger());
    const instance = new TwiceGateway();
    // What a module attaches to every controller it builds. Resolution is what makes the
    // second pass dangerous: it replaces the class with an opaque façade the Set cannot
    // recognise as the same guard.
    attachGuardBinding(instance, {
      resolve: (guards) => guards.map((g) => (typeof g === 'function'
        ? { guardName: g.name, canActivate: () => false }
        : g)),
      logger: createMockSyncLogger(),
    });

    handler.registerGateway(TwiceGateway, instance);
    const afterFirst = getWsHandlers(TwiceGateway)[0].guards?.length;

    handler.registerGateway(TwiceGateway, instance);
    const afterSecond = getWsHandlers(TwiceGateway)[0].guards?.length;

    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(1);
  });

  it('treats a guard that throws as a denial and logs it', async () => {
    logLines.length = 0;
    const { stillOpen } = await exchange('boom');

    expect(ran.boom).toBeUndefined();
    const errorLine = logLines.find((line) => line.startsWith('ERROR') && line.includes('ThrowingWsGuard'));
    expect(errorLine).toBeDefined();
    expect(errorLine).toContain('ws guard exploded');
    expect(stillOpen).toBe(true);
  });
});
