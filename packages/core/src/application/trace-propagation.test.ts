/**
 * Outgoing calls carry the caller's trace.
 *
 * `getTraceId` read `globalThis.__onebunCurrentTraceContext`, a global nothing in the framework
 * ever assigned — so it was permanently `undefined`, `buildHeaders` added nothing, and a
 * distributed trace ended at the first hop with no sign that anything was missing. Even when the
 * global was set by hand the only header sent was `X-Trace-Id`, which joins nothing: the receiving
 * OneBun service needs `traceparent`, or trace id and span id together, so a lone id fell through
 * and the callee started a fresh trace.
 *
 * These tests read what actually went out over the wire.
 */

import {
  describe,
  it,
  expect,
  afterAll,
  beforeAll,
} from 'bun:test';

import { createHttpClient } from '@onebun/requests';

import {
  Controller,
  Get,
  Module,
} from '../decorators';
import { getCurrentTraceContext } from '../request-context';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

/** `00-<32 hex>-<16 hex>-<2 hex>`, anchored — a header that "contains" a trace id is not enough. */
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

interface EchoedHeaders {
  traceparent: string | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'x-trace-id': string | null;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'x-span-id': string | null;
}

interface CallResult {
  seenByServer: EchoedHeaders;
  callerTraceId: string | null;
  callerSpanId: string | null;
}

let upstream: ReturnType<typeof Bun.serve>;
let upstreamUrl: string;

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    fetch: (request) => Response.json({
      traceparent: request.headers.get('traceparent'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-trace-id': request.headers.get('x-trace-id'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'x-span-id': request.headers.get('x-span-id'),
    }),
  });
  upstreamUrl = `http://localhost:${upstream.port}/echo`;
});

afterAll(() => {
  upstream.stop(true);
});

@Controller('/caller')
class CallerController {
  @Get('/propagated')
  async propagated(): Promise<CallResult> {
    const client = createHttpClient();
    const response = await client.get<EchoedHeaders>(upstreamUrl);
    const traceContext = getCurrentTraceContext();

    return {
      seenByServer: (response as { result: EchoedHeaders }).result,
      callerTraceId: traceContext?.traceId ?? null,
      callerSpanId: traceContext?.spanId ?? null,
    };
  }

  @Get('/suppressed')
  async suppressed(): Promise<CallResult> {
    const client = createHttpClient();
    const response = await client.get<EchoedHeaders>(upstreamUrl, { tracing: false });

    return {
      seenByServer: (response as { result: EchoedHeaders }).result,
      callerTraceId: null,
      callerSpanId: null,
    };
  }
}

@Module({ controllers: [CallerController] })
class CallerModule {}

/** The callee: a second OneBun service, reporting the trace it believes it is running in. */
@Controller('/callee')
class CalleeController {
  @Get('/seen')
  async seen(): Promise<{ traceId: string | null }> {
    return { traceId: getCurrentTraceContext()?.traceId ?? null };
  }
}

@Module({ controllers: [CalleeController] })
class CalleeModule {}

describe('outgoing trace context', () => {
  let app: OneBunApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = new OneBunApplication(CallerModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: { enabled: true, serviceName: 'caller' },
    });
    await app.start();
    baseUrl = `http://localhost:${app.getPort()}`;
  });

  afterAll(async () => {
    await app.stop();
  });

  async function call(path: string): Promise<CallResult> {
    const response = await fetch(`${baseUrl}${path}`);
    const body = (await response.json()) as { result: CallResult };

    return body.result;
  }

  it('sends a traceparent whose trace id is the one the request is running under', async () => {
    const { seenByServer, callerTraceId, callerSpanId } = await call('/caller/propagated');

    const match = seenByServer.traceparent?.match(TRACEPARENT_PATTERN);

    expect(match).not.toBeNull();
    expect(match![1]).toBe(callerTraceId!);
    // The parent id must be a span of this request, not a fresh one — the callee hangs off it.
    expect(match![2]).toBe(callerSpanId!);
  });

  it('sends the legacy pair together, never a lone x-trace-id', async () => {
    const { seenByServer, callerTraceId } = await call('/caller/propagated');

    // A lone `x-trace-id` is what used to be sent, and `extractFromHeadersSync` ignores it: the
    // callee needs both, or a `traceparent`. Sending the id alone looked like propagation and
    // achieved nothing.
    expect(seenByServer['x-trace-id']).toBe(callerTraceId!);
    expect(seenByServer['x-span-id']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('sends nothing when the request opts out with tracing: false', async () => {
    const { seenByServer } = await call('/caller/suppressed');

    expect(seenByServer.traceparent).toBeNull();
    expect(seenByServer['x-trace-id']).toBeNull();
    expect(seenByServer['x-span-id']).toBeNull();
  });

  it('round-trips between two OneBun services: the callee adopts the caller\'s trace', async () => {
    const callee = new OneBunApplication(CalleeModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: { enabled: true, serviceName: 'callee' },
    });
    await callee.start();

    @Controller('/hop')
    class HopController {
      @Get('/')
      async hop(): Promise<{ callerTraceId: string | null; calleeTraceId: string | null }> {
        const client = createHttpClient();
        const response = await client.get<{ result: { traceId: string | null } }>(
          `http://localhost:${callee.getPort()}/callee/seen`,
        );

        return {
          callerTraceId: getCurrentTraceContext()?.traceId ?? null,
          calleeTraceId: (response as { result: { result: { traceId: string | null } } })
            .result.result.traceId,
        };
      }
    }

    @Module({ controllers: [HopController] })
    class HopModule {}

    const caller = new OneBunApplication(HopModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
      tracing: { enabled: true, serviceName: 'hop-caller' },
    });
    await caller.start();

    try {
      const response = await fetch(`http://localhost:${caller.getPort()}/hop`);
      const body = (await response.json()) as {
        result: { callerTraceId: string | null; calleeTraceId: string | null };
      };

      // The point of the whole feature: one trace id across the hop, resolved by the callee's own
      // `extractFromHeadersSync` from the headers the caller emitted.
      expect(body.result.calleeTraceId).toBe(body.result.callerTraceId!);
      expect(body.result.callerTraceId).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      await caller.stop();
      await callee.stop();
    }
  });

  it('sends nothing, and does not throw, from outside any request scope', async () => {
    // Startup code, a queue handler, a cron tick: no request context, so no trace to join. The
    // failure to avoid is a malformed `traceparent` built from ids that do not exist.
    const client = createHttpClient();
    const response = await client.get<EchoedHeaders>(upstreamUrl);
    const seenByServer = (response as { result: EchoedHeaders }).result;

    expect(seenByServer.traceparent).toBeNull();
    expect(seenByServer['x-trace-id']).toBeNull();
  });
});
