import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type { RateLimitStore } from '../security/rate-limit-middleware';
import type { ApplicationOptions } from '../types';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

// ============================================================================
// Fixtures
// ============================================================================

@Controller('/probe')
class ProbeController extends BaseController {
  @Get('/ping')
  ping() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

// ============================================================================
// Harness
// ============================================================================

const WINDOW_MS = 60_000;
const MAX = 3;
const BURST = 10;
const SPOOFED = '203.0.113.77';

function createApp(options?: Partial<ApplicationOptions>): OneBunApplication {
  return new OneBunApplication(ProbeModule, {
    port: 0,
    metrics: { enabled: false },
    gracefulShutdown: false,
    docs: { enabled: false },
    ...options,
    loggerLayer: makeMockLoggerLayer(),
  });
}

/**
 * A real store that also records the key the middleware derived — the only way to see
 * what the DEFAULT key generator produced without reaching into module internals.
 */
class RecordingStore implements RateLimitStore {
  readonly keys: string[] = [];
  private readonly counts = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    this.keys.push(key);
    const now = Date.now();
    const entry = this.counts.get(key);
    if (!entry || entry.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.counts.set(key, fresh);

      return fresh;
    }
    entry.count += 1;

    return { count: entry.count, resetAt: entry.resetAt };
  }
}

/** Wrap the live trace service so the `remoteAddr` handed to each span is visible. */
function recordSpanRemoteAddrs(app: OneBunApplication): string[] {
  const recorded: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = (app as any).traceService;
  if (!svc) {
    throw new Error('trace service not initialised — cannot observe remoteAddr');
  }
  const original = svc.startHttpTraceSync.bind(svc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc.startHttpTraceSync = (data: any) => {
    recorded.push(String(data?.remoteAddr));

    return original(data);
  };

  return recorded;
}

/** Header names are built as tuples, not object keys, to stay within naming rules. */
function xff(value: string): Headers {
  return new Headers([['x-forwarded-for', value]]);
}

async function statuses(
  base: string,
  count: number,
  headerFor?: (i: number) => Headers,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = await fetch(base, headerFor ? { headers: headerFor(i) } : undefined);
    await res.text();
    out.push(res.status);
  }

  return out;
}

// ============================================================================
// Tests
// ============================================================================

describe('client address identification over a real server', () => {
  let app: OneBunApplication | null = null;

  afterEach(async () => {
    if (app) {
      await app.stop();
      app = null;
    }
  });

  test('a rotating x-forwarded-for does not escape the limit by default', async () => {
    app = createApp({ rateLimit: { windowMs: WINDOW_MS, max: MAX } });
    await app.start();
    const base = `http://127.0.0.1:${app.getPort()}/probe/ping`;

    const codes = await statuses(base, BURST, (i) => xff(`203.0.113.${i}`));

    // Every request arrives from the same loopback peer, so rotating the header must
    // not mint a fresh bucket. Before the fix all ten returned 200.
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, MAX)).toEqual([200, 200, 200]);
    expect(codes.slice(MAX)).toEqual(Array(BURST - MAX).fill(429));
  });

  test('a spoofed x-forwarded-for shares the bucket with unheadered requests', async () => {
    app = createApp({ rateLimit: { windowMs: WINDOW_MS, max: MAX } });
    await app.start();
    const base = `http://127.0.0.1:${app.getPort()}/probe/ping`;

    // Spend the whole window with no header at all...
    const plain = await statuses(base, MAX);
    // ...then try to buy more requests by claiming to be someone else.
    const spoofed = await statuses(base, 1, () => xff(SPOOFED));

    expect(plain).toEqual([200, 200, 200]);
    expect(spoofed).toEqual([429]);
  });

  test('with trustProxy on, the forwarded client is the bucket', async () => {
    app = createApp({ trustProxy: true, rateLimit: { windowMs: WINDOW_MS, max: MAX } });
    await app.start();
    const base = `http://127.0.0.1:${app.getPort()}/probe/ping`;

    // One forwarded client burns its own window...
    const clientA = await statuses(base, MAX + 1, () => xff('203.0.113.1'));
    // ...and a different forwarded client is unaffected by it.
    const clientB = await statuses(base, 1, () => xff('203.0.113.2'));

    expect(clientA).toEqual([200, 200, 200, 429]);
    expect(clientB).toEqual([200]);
  });

  test('trace remoteAddr matches the rate-limit key with trustProxy off', async () => {
    const store = new RecordingStore();
    app = createApp({ rateLimit: { windowMs: WINDOW_MS, max: MAX, store } });
    await app.start();
    const spans = recordSpanRemoteAddrs(app);
    const base = `http://127.0.0.1:${app.getPort()}/probe/ping`;

    await statuses(base, 1, () => xff(SPOOFED));

    // One answer to "who called": the span and the limiter agree, and neither of them
    // is the header the caller sent.
    expect(store.keys).toHaveLength(1);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toBe(store.keys[0]!);
    expect(store.keys[0]).not.toBe(SPOOFED);
    expect(store.keys[0]).not.toBe('unknown');
  });

  test('trace remoteAddr matches the rate-limit key with trustProxy on', async () => {
    const store = new RecordingStore();
    app = createApp({
      trustProxy: true,
      rateLimit: { windowMs: WINDOW_MS, max: MAX, store },
    });
    await app.start();
    const spans = recordSpanRemoteAddrs(app);
    const base = `http://127.0.0.1:${app.getPort()}/probe/ping`;

    await statuses(base, 1, () => xff(SPOOFED));

    expect(store.keys).toEqual([SPOOFED]);
    expect(spans).toEqual([SPOOFED]);
  });
});
