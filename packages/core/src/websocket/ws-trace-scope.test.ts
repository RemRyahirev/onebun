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
 * must not see it.
 *
 * "Must not see it" is not the same as "must see nothing", and the two cases below are that
 * distinction. A handler constructed without an owning tracer gets no span at all. Given one, it
 * gets a span of its OWN — that is what puts a trace id on its log lines — and the invariant being
 * defended is that the span is a fresh root rather than a child of the upgrade.
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
import type {
  Context,
  ContextManager,
  Span,
  Tracer,
} from '@opentelemetry/api';
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

/**
 * A tracer that mints a distinguishable id per span.
 *
 * Same reasoning as `TestContextManager` above: `@onebun/trace` is not a dependency of core, and
 * the OpenTelemetry API's own tracer without a registered provider hands back all-zero ids, which
 * makes "a new trace" and "no trace" indistinguishable — the exact thing under test.
 */
class CountingTracer {
  private next = 1;

  startSpan(): never {
    throw new Error('startSpan is not used by the boundary under test');
  }

  startActiveSpan(name: string, ...rest: unknown[]): unknown {
    const fn = rest[rest.length - 1] as (span: Span) => unknown;
    const traceId = String(this.next).padStart(32, '0');
    const spanId = String(this.next).padStart(16, '0');

    this.next += 1;

    const span = {
      spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
      end: () => undefined,
      setStatus: () => undefined,
    } as unknown as Span;

    return otelContext.with(otelTrace.setSpan(otelContext.active(), span), () => fn(span));
  }
}

let seenInsideHandler: unknown = 'never-called';
let seenTraceId: string | undefined;

@WebSocketGateway({ path: '/ws' })
class ProbeGateway extends BaseWebSocketGateway {
  @OnMessage('ping')
  handlePing(): void {
    seenInsideHandler = otelTrace.getActiveSpan();
    seenTraceId = otelTrace.getActiveSpan()?.spanContext().traceId;
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
    seenTraceId = undefined;
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

  it('opens a span of its own, in a new trace, when it knows which application owns it', async () => {
    otelContext.setGlobalContextManager(new TestContextManager());

    const tracer = new CountingTracer() as unknown as Tracer;
    const handler = new WsHandler(createMockSyncLogger(), {}, tracer);

    handler.registerGateway(ProbeGateway, new ProbeGateway());

    const callbacks = handler.createWebSocketHandlers();
    let upgradeTraceId: string | undefined;

    await tracer.startActiveSpan('HTTP GET /ws', async (upgrade) => {
      upgradeTraceId = upgrade.spanContext().traceId;

      callbacks.message(fakeSocket(), JSON.stringify({ event: 'ping', data: {} }));
      await Promise.resolve();

      upgrade.end();
    });

    // A span, so the handler's log lines have something to name — before this the handler ran
    // with none and every line it wrote carried no trace id at all.
    expect(seenInsideHandler).toBeDefined();

    // And a NEW trace: the frame does not belong to the request that opened the socket.
    expect(seenTraceId).toBeDefined();
    expect(seenTraceId).not.toBe(upgradeTraceId);
  });
});
