/**
 * WebSocket callbacks discard the ambient trace context.
 *
 * Once an OpenTelemetry context manager is installed, context follows the async call graph. A
 * socket callback registered during the upgrade would keep the upgrade request's context, so a
 * connection open for an hour would file every message it ever receives under the one request that
 * opened it — a trace that keeps growing, attributed to a request that finished long ago.
 *
 * Asserted at the boundary rather than through a live socket on purpose: what is guaranteed is that
 * `createWebSocketHandlers()` drops whatever context it is called in, not a claim about how Bun
 * happens to invoke those callbacks today. Drive them from inside an active span and the handler
 * must see none.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import {
  context as otelContext,
  ROOT_CONTEXT,
  trace as otelTrace,
} from '@opentelemetry/api';
import {
  describe,
  it,
  expect,
  afterEach,
} from 'bun:test';

import type { WsClientData } from './ws.types';
import type { Context, ContextManager } from '@opentelemetry/api';
import type { ServerWebSocket } from 'bun';


import { createMockSyncLogger } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { OnMessage, WebSocketGateway } from './ws-decorators';
import { WsHandler } from './ws-handler';

/**
 * A minimal `AsyncLocalStorage` context manager.
 *
 * Deliberately not OneBun's own (`@onebun/trace` is not a dependency of core, and a test that
 * reached for the implementation under test would prove only that it agrees with itself).
 */
class TestContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    activeContext: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(activeContext, () => fn.apply(thisArg as ThisParameterType<F>, args));
  }

  bind<T>(_activeContext: Context, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  // No `storage.disable()`: tearing down an AsyncLocalStorage under code that is inside it
  // breaks async continuation process-wide, and every later async test simply hangs.
  disable(): this {
    return this;
  }
}

let seenInsideHandler: unknown = 'never-called';

@WebSocketGateway({ path: '/ws' })
class ProbeGateway extends BaseWebSocketGateway {
  @OnMessage('ping')
  handlePing(): void {
    seenInsideHandler = otelTrace.getActiveSpan();
  }
}

/** Just enough socket for `handleMessage` → `routeMessage` → the handler. */
function fakeSocket(): ServerWebSocket<WsClientData> {
  return {
    data: {
      id: 'client-1',
      protocol: 'native',
      rooms: new Set<string>(),
      connectedAt: new Date(),
    },
    send: () => 1,
    close: () => undefined,
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    publish: () => 1,
  } as unknown as ServerWebSocket<WsClientData>;
}

describe('WebSocket callbacks re-root the trace context', () => {
  afterEach(() => {
    otelContext.disable();
    seenInsideHandler = 'never-called';
  });

  it('runs a message handler outside the span that was active when it was invoked', async () => {
    otelContext.setGlobalContextManager(new TestContextManager());

    const handler = new WsHandler(createMockSyncLogger());
    handler.registerGateway(ProbeGateway, new ProbeGateway());
    const callbacks = handler.createWebSocketHandlers();

    let seenAtCallSite: unknown = null;

    await otelTrace.getTracer('probe').startActiveSpan('HTTP GET /ws', async (upgrade) => {
      // Control: a span really is active here, so an `undefined` inside the handler is the
      // re-rooting doing its job rather than the context manager being absent.
      seenAtCallSite = otelTrace.getActiveSpan();

      callbacks.message(fakeSocket(), JSON.stringify({ event: 'ping', data: {} }));
      await Promise.resolve();

      upgrade.end();
    });

    expect(seenAtCallSite).toBeDefined();
    expect(seenInsideHandler).toBeUndefined();
  });
});
