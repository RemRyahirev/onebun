/**
 * Documentation Examples Tests for the built-in security middleware.
 *
 * Every test pins a promise the prose makes, not merely that a symbol exists: the
 * shorthand options really install the middleware, the chain really runs in the
 * documented order, and the documented headers/bodies really come back over a
 * real server bound on port 0.
 *
 * @source docs:api/security.md
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import type {
  ApplicationOptions,
  CorsOptions,
  OneBunRequest,
  OneBunResponse,
  RateLimitStore,
} from '@onebun/core';
import {
  BaseController,
  BaseMiddleware,
  Controller,
  CorsMiddleware,
  Get,
  MemoryRateLimitStore,
  Module,
  OneBunApplication,
  Options,
  Post,
  RateLimitMiddleware,
  RedisClient,
  RedisRateLimitStore,
  SharedRedisProvider,
} from '@onebun/core';
import { makeMockLoggerLayer, useFakeTimers } from '@onebun/core/testing';

// ============================================================================
// Fixtures
// ============================================================================

@Controller('/api')
class SecurityProbeController extends BaseController {
  @Get('/ping')
  ping() {
    return { ok: true };
  }

  /**
   * An `OPTIONS`-capable route. Without one on the path the preflight never enters the
   * middleware chain at all — the caveat the CORS section warns about.
   */
  @Options('/ping')
  preflight() {
    return { preflight: true };
  }

  /** Declares POST only — a browser preflight to this path has no route to match. */
  @Post('/submit')
  submit() {
    return { created: true };
  }
}

@Module({ controllers: [SecurityProbeController] })
class SecurityProbeModule {}

/** What the user middleware saw, so the position of the auto-added middleware is observable. */
const orderProbe = {
  invocations: 0,
  securityHeaderInsideChain: null as string | null,
  corsHeaderInsideChain: null as string | null,
};

/**
 * A plain application-wide middleware placed in `middleware:` — it sits between the
 * auto-prefixed CORS/RateLimit pair and the auto-suffixed SecurityHeaders.
 */
class OrderProbeMiddleware extends BaseMiddleware {
  async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
    orderProbe.invocations += 1;
    const response = await next();
    // Read BEFORE returning: whatever is already on the response was set by middleware
    // that runs deeper in the chain than this one.
    orderProbe.securityHeaderInsideChain = response.headers.get('X-Frame-Options');
    orderProbe.corsHeaderInsideChain = response.headers.get('Access-Control-Allow-Origin');

    return response;
  }
}

/** The full default header set the documentation tables promise. */
const DEFAULT_SECURITY_HEADERS: Array<[string, string]> = [
  ['Content-Security-Policy', "default-src 'self'"],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
  ['Referrer-Policy', 'no-referrer'],
  ['Strict-Transport-Security', 'max-age=15552000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-DNS-Prefetch-Control', 'off'],
  ['X-Download-Options', 'noopen'],
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  ['X-XSS-Protection', '0'],
];

// ============================================================================
// Harness
// ============================================================================

function createApp(options: Partial<ApplicationOptions> = {}): OneBunApplication {
  return new OneBunApplication(SecurityProbeModule, {
    port: 0,
    metrics: { enabled: false },
    gracefulShutdown: false,
    docs: { enabled: false },
    ...options,
    loggerLayer: makeMockLoggerLayer(),
  });
}

function originHeaders(origin: string): Headers {
  return new Headers([['origin', origin]]);
}

async function call(app: OneBunApplication, path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`http://127.0.0.1:${app.getPort()}${path}`, init);
}

/** A request that never passed through a OneBun server — for direct middleware calls. */
function unservedRequest(headers: Array<[string, string]> = []): OneBunRequest {
  return new Request('http://localhost/probe', { headers: new Headers(headers) }) as unknown as OneBunRequest;
}

async function okHandler(): Promise<OneBunResponse> {
  return new Response('ok', { status: 200 });
}

/**
 * A `RedisClient` whose two storage calls are answered from a Map, recording the traffic
 * so a store that keeps its window in-process instead of on the wire is visible.
 * Substituted on the instance — `mock.module` would swap the client for every suite in the run.
 */
function makeFakeRedisClient(): {
  client: RedisClient;
  /** `get:<key>` / `set:<key>`, in the order the store issued them. */
  calls: string[];
  /** Every `set` payload, as `[key, rawValue]`. */
  writes: Array<[string, string]>;
} {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const writes: Array<[string, string]> = [];
  const client = new RedisClient({ url: 'redis://127.0.0.1:6379' });
  client.get = async (key: string): Promise<string | null> => {
    calls.push(`get:${key}`);

    return store.get(key) ?? null;
  };
  client.set = async (key: string, value: string): Promise<void> => {
    calls.push(`set:${key}`);
    writes.push([key, value]);
    store.set(key, value);
  };

  return { client, calls, writes };
}

// ============================================================================
// Tests
// ============================================================================

describe('docs: api/security.md', () => {
  let app: OneBunApplication | null = null;

  afterEach(async () => {
    if (app) {
      await app.stop();
      app = null;
    }
    orderProbe.invocations = 0;
    orderProbe.securityHeaderInsideChain = null;
    orderProbe.corsHeaderInsideChain = null;
  });

  describe('quick reference', () => {
    /**
     * @source docs:api/security.md#quick-reference-for-ai
     */
    it('mounts CorsMiddleware.configure() passed through the middleware array', async () => {
      app = createApp({ middleware: [CorsMiddleware.configure({ origin: 'https://example.com' })] });
      await app.start();

      const allowed = await call(app, '/api/ping', { headers: originHeaders('https://example.com') });
      const foreign = await call(app, '/api/ping', { headers: originHeaders('https://other.test') });

      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(await allowed.json()).toEqual({ success: true, result: { ok: true } });
      expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
      await foreign.text();
    });

    /**
     * @source docs:api/security.md#quick-reference-for-ai
     */
    it('orders the chain CORS → RateLimit → user middleware → SecurityHeaders', async () => {
      app = createApp({
        cors: { origin: 'https://front.example.com' },
        rateLimit: { windowMs: 60_000, max: 1 },
        security: true,
        middleware: [OrderProbeMiddleware],
      });
      await app.start();

      const first = await call(app, '/api/ping', { headers: originHeaders('https://front.example.com') });
      await first.text();

      // SecurityHeaders is the innermost of the four: its header is already on the
      // response when the user middleware regains control.
      expect(orderProbe.invocations).toBe(1);
      expect(orderProbe.securityHeaderInsideChain).toBe('SAMEORIGIN');
      // CORS is the outermost: it has not attached its header yet at that point,
      // but the response that leaves the server carries it.
      expect(orderProbe.corsHeaderInsideChain).toBeNull();
      expect(first.headers.get('Access-Control-Allow-Origin')).toBe('https://front.example.com');

      const blocked = await call(app, '/api/ping', { headers: originHeaders('https://front.example.com') });
      await blocked.text();

      // RateLimit sits outside the user middleware — the rejected request never reaches it.
      expect(blocked.status).toBe(429);
      expect(orderProbe.invocations).toBe(1);
      // ...and inside CORS, so even the rejection is readable cross-origin.
      expect(blocked.headers.get('Access-Control-Allow-Origin')).toBe('https://front.example.com');
    });

    /**
     * @source docs:api/security.md#quick-reference-for-ai
     */
    it('answers a preflight only where an OPTIONS-capable route exists', async () => {
      app = createApp({ cors: { origin: 'https://front.example.com' } });
      await app.start();

      const headers = originHeaders('https://front.example.com');
      const onOptionsRoute = await call(app, '/api/ping', { method: 'OPTIONS', headers });
      const onPostOnlyRoute = await call(app, '/api/submit', { method: 'OPTIONS', headers });
      const posted = await call(app, '/api/submit', { method: 'POST', headers });
      const unmatched = await call(app, '/api/nothing-here', { method: 'GET', headers });

      expect(onOptionsRoute.status).toBe(204);
      expect(onOptionsRoute.headers.get('Access-Control-Allow-Origin')).toBe('https://front.example.com');
      expect(onOptionsRoute.headers.get('Access-Control-Allow-Methods')).toContain('POST');

      // A path that declares only @Post() has no OPTIONS route: the preflight falls
      // through to the bare 404 with no CORS headers, and the browser blocks the POST.
      expect(onPostOnlyRoute.status).toBe(404);
      expect(onPostOnlyRoute.headers.get('Access-Control-Allow-Origin')).toBeNull();

      // The matched route itself still gets the headers.
      expect(posted.headers.get('Access-Control-Allow-Origin')).toBe('https://front.example.com');

      expect(unmatched.status).toBe(404);
      expect(unmatched.headers.get('Access-Control-Allow-Origin')).toBeNull();

      await Promise.all([
        onOptionsRoute.text(),
        onPostOnlyRoute.text(),
        posted.text(),
        unmatched.text(),
      ]);
    });

    /**
     * @source docs:api/security.md#quick-reference-for-ai
     */
    it('sends Retry-After only on the 429 and only with legacyHeaders', async () => {
      const quiet = new RateLimitMiddleware({
        max: 1,
        windowMs: 60_000,
        store: new MemoryRateLimitStore(),
        keyGenerator: () => 'fixed-key',
      });
      const legacy = new RateLimitMiddleware({
        max: 1,
        windowMs: 60_000,
        store: new MemoryRateLimitStore(),
        legacyHeaders: true,
        keyGenerator: () => 'fixed-key',
      });

      const quietAllowed = await quiet.use(unservedRequest(), okHandler);
      const quietBlocked = await quiet.use(unservedRequest(), okHandler);
      const legacyAllowed = await legacy.use(unservedRequest(), okHandler);
      const legacyBlocked = await legacy.use(unservedRequest(), okHandler);

      expect(quietAllowed.status).toBe(200);
      expect(quietBlocked.status).toBe(429);
      expect(quietBlocked.headers.get('Retry-After')).toBeNull();

      // Never on a successful response, even with the legacy headers on.
      expect(legacyAllowed.status).toBe(200);
      expect(legacyAllowed.headers.get('Retry-After')).toBeNull();

      expect(legacyBlocked.status).toBe(429);
      expect(legacyBlocked.headers.get('Retry-After')).toBe(legacyBlocked.headers.get('RateLimit-Reset'));
      expect(Number(legacyBlocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    });
  });

  describe('quick setup', () => {
    /**
     * @source docs:api/security.md#quick-setup
     */
    it('turns on CORS, rate limiting and security headers from one options object', async () => {
      app = createApp({
        cors: { origin: 'https://my-frontend.example.com', credentials: true },
        rateLimit: { windowMs: 60_000, max: 100 },
        security: true,
      });
      await app.start();

      const response = await call(app, '/api/ping', {
        headers: originHeaders('https://my-frontend.example.com'),
      });

      expect(await response.json()).toEqual({ success: true, result: { ok: true } });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://my-frontend.example.com');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response.headers.get('RateLimit-Limit')).toBe('100');
      expect(response.headers.get('RateLimit-Remaining')).toBe('99');
      expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    });
  });

  describe('CorsMiddleware', () => {
    /**
     * @source docs:api/security.md#via-applicationoptionscors
     */
    it('applies every documented CorsOptions field to the served responses', async () => {
      app = createApp({
        cors: {
          origin: 'https://my-frontend.example.com',
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
          exposedHeaders: ['X-Request-Id'],
          maxAge: 3600,
        },
      });
      await app.start();

      const headers = originHeaders('https://my-frontend.example.com');
      const simple = await call(app, '/api/ping', { headers });
      const preflight = await call(app, '/api/ping', { method: 'OPTIONS', headers });
      const stranger = await call(app, '/api/ping', { headers: originHeaders('https://attacker.test') });

      expect(simple.headers.get('Access-Control-Allow-Origin')).toBe('https://my-frontend.example.com');
      expect(simple.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(simple.headers.get('Access-Control-Expose-Headers')).toBe('X-Request-Id');

      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE');
      expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-API-Key');
      expect(preflight.headers.get('Access-Control-Max-Age')).toBe('3600');

      // An origin outside the configured one gets no grant at all.
      expect(stranger.headers.get('Access-Control-Allow-Origin')).toBeNull();

      await Promise.all([simple.text(), preflight.text(), stranger.text()]);
    });

    /**
     * @source docs:api/security.md#via-applicationoptionscors
     */
    it('allows every origin with the defaults when cors is true', async () => {
      app = createApp({ cors: true });
      await app.start();

      const first = await call(app, '/api/ping', { headers: originHeaders('https://anything.test') });
      const second = await call(app, '/api/ping', { headers: originHeaders('https://somewhere-else.test') });

      expect(first.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(second.headers.get('Access-Control-Allow-Origin')).toBe('*');
      // Defaults mean no credentials grant.
      expect(first.headers.get('Access-Control-Allow-Credentials')).toBeNull();

      await Promise.all([first.text(), second.text()]);
    });

    /**
     * @source docs:api/security.md#via-middleware-array-manual-configuration
     */
    it('matches a RegExp origin configured through the middleware array', async () => {
      app = createApp({
        middleware: [
          CorsMiddleware.configure({
            origin: /\.example\.com$/,
          }),
        ],
      });
      await app.start();

      const subdomain = await call(app, '/api/ping', { headers: originHeaders('https://app.example.com') });
      const lookalike = await call(app, '/api/ping', { headers: originHeaders('https://example.com.attacker.test') });

      expect(subdomain.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
      expect(subdomain.headers.get('Vary')).toContain('Origin');
      // The `$` anchor is load-bearing: a suffix-lookalike must not be reflected.
      expect(lookalike.headers.get('Access-Control-Allow-Origin')).toBeNull();

      await Promise.all([subdomain.text(), lookalike.text()]);
    });

    /**
     * @source docs:api/security.md#origin-variants
     */
    it('accepts each documented origin shape and rejects the non-match', async () => {
      const variants: Array<{ shape: string; options: CorsOptions; allowed: string; denied: string }> = [
        {
          shape: 'exact string',
          options: { origin: 'https://example.com' },
          allowed: 'https://example.com',
          denied: 'https://example.com.attacker.test',
        },
        {
          shape: 'RegExp',
          options: { origin: /\.example\.com$/ },
          allowed: 'https://api.example.com',
          denied: 'https://example.org',
        },
        {
          shape: 'array of strings and RegExps',
          options: { origin: ['https://app1.com', 'https://app2.com', /\.dev$/] },
          allowed: 'https://tool.dev',
          denied: 'https://app3.com',
        },
        {
          shape: 'function predicate',
          options: { origin: (o: string) => o.startsWith('https://trusted') },
          allowed: 'https://trusted.example.com',
          denied: 'https://untrusted.example.com',
        },
      ];

      for (const variant of variants) {
        const middleware = new CorsMiddleware(variant.options);
        const allowed = await middleware.use(unservedRequest([['origin', variant.allowed]]), okHandler);
        const denied = await middleware.use(unservedRequest([['origin', variant.denied]]), okHandler);

        expect([variant.shape, allowed.headers.get('Access-Control-Allow-Origin')]).toEqual([
          variant.shape,
          variant.allowed,
        ]);
        expect([variant.shape, denied.headers.get('Access-Control-Allow-Origin')]).toEqual([variant.shape, null]);
      }

      // The default (`cors: true` / no `origin`) is the wildcard.
      const wildcard = new CorsMiddleware({});
      const response = await wildcard.use(unservedRequest([['origin', 'https://whoever.test']]), okHandler);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('RateLimitMiddleware', () => {
    /**
     * @source docs:api/security.md#via-applicationoptionsratelimit
     */
    it('serves the documented 429 body and RateLimit-* headers once the window is spent', async () => {
      app = createApp({ rateLimit: { windowMs: 15 * 60 * 1000, max: 2 } });
      await app.start();

      const first = await call(app, '/api/ping');
      const second = await call(app, '/api/ping');
      const third = await call(app, '/api/ping');

      expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
      expect(first.headers.get('RateLimit-Limit')).toBe('2');
      expect(first.headers.get('RateLimit-Remaining')).toBe('1');
      expect(second.headers.get('RateLimit-Remaining')).toBe('0');

      expect(await third.json()).toEqual({
        success: false,
        error: 'Too Many Requests',
        code: 429,
        details: {},
      });
      expect(third.headers.get('RateLimit-Limit')).toBe('2');
      expect(third.headers.get('RateLimit-Remaining')).toBe('0');
      expect(Number(third.headers.get('RateLimit-Reset'))).toBeGreaterThan(0);
      // legacyHeaders defaults to false.
      expect(third.headers.get('Retry-After')).toBeNull();

      await Promise.all([first.text(), second.text()]);
    });

    /**
     * @source docs:api/security.md#via-applicationoptionsratelimit
     */
    it('uses 100 requests per 60 seconds when rateLimit is true', async () => {
      app = createApp({ rateLimit: true });
      await app.start();

      const response = await call(app, '/api/ping');
      await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('RateLimit-Limit')).toBe('100');
      expect(response.headers.get('RateLimit-Remaining')).toBe('99');
      // A 60s window, so the reset is at most 60 seconds away.
      expect(Number(response.headers.get('RateLimit-Reset'))).toBeLessThanOrEqual(60);
    });

    /**
     * @source docs:api/security.md#custom-key-generator
     */
    it('buckets requests by the custom key generator', async () => {
      const configured = RateLimitMiddleware.configure({
        max: 1,
        windowMs: 60_000,
        keyGenerator: (req: OneBunRequest) => req.headers.get('x-api-key') ?? 'anon',
      });
      const middleware = new configured();

      const keyed = (value: string): OneBunRequest => unservedRequest([['x-api-key', value]]);
      const firstForA = await middleware.use(keyed('key-a'), okHandler);
      const secondForA = await middleware.use(keyed('key-a'), okHandler);
      const firstForB = await middleware.use(keyed('key-b'), okHandler);
      const firstAnon = await middleware.use(unservedRequest(), okHandler);
      const secondAnon = await middleware.use(unservedRequest(), okHandler);

      expect(firstForA.status).toBe(200);
      expect(secondForA.status).toBe(429);
      // A different key is a different bucket...
      expect(firstForB.status).toBe(200);
      // ...and every caller without the header shares the single 'anon' bucket.
      expect(firstAnon.status).toBe(200);
      expect(secondAnon.status).toBe(429);
    });

    /**
     * @source docs:api/security.md#redis-backed-multi-instance
     */
    it('shares one window across two RedisRateLimitStore instances on one client', async () => {
      const redis = makeFakeRedisClient();
      const keyGenerator = (req: OneBunRequest): string => req.headers.get('x-api-key') ?? 'anon';
      // Two *independent* stores, as two deployed instances would have: nothing is shared in
      // process, so the only way the window can be common is through the client they both use.
      const instanceA = new RateLimitMiddleware({
        max: 2, windowMs: 60_000, store: new RedisRateLimitStore(redis.client), keyGenerator,
      });
      const instanceB = new RateLimitMiddleware({
        max: 2, windowMs: 60_000, store: new RedisRateLimitStore(redis.client), keyGenerator,
      });

      const keyed = (value: string): OneBunRequest => unservedRequest([['x-api-key', value]]);
      // Fake time so the window's deadline is decidable: it must stay where the first request
      // put it, whichever instance extends it.
      const timers = useFakeTimers();

      try {
        const onA = await instanceA.use(keyed('tenant-1'), okHandler);
        timers.advanceTime(1_000);
        const onB = await instanceB.use(keyed('tenant-1'), okHandler);
        timers.advanceTime(1_000);
        const backOnA = await instanceA.use(keyed('tenant-1'), okHandler);
        const otherTenant = await instanceB.use(keyed('tenant-2'), okHandler);

        // Two requests spend the window no matter which instance served them.
        expect([onA.status, onB.status]).toEqual([200, 200]);
        // `max - count`, so instanceB already counted instanceA's request when it answered.
        expect(onB.headers.get('RateLimit-Remaining')).toBe('0');
        expect(backOnA.status).toBe(429);
        // 60s window opened 2s ago: the caller is told the shared deadline, not a fresh one.
        expect(backOnA.headers.get('RateLimit-Reset')).toBe('58');
        // A separate key still has its own window.
        expect(otherTenant.status).toBe(200);

        // Every increment is a read-then-write on the wire, under the store's `rl:` key.
        expect(redis.calls).toEqual([
          'get:rl:tenant-1', 'set:rl:tenant-1',
          'get:rl:tenant-1', 'set:rl:tenant-1',
          'get:rl:tenant-1', 'set:rl:tenant-1',
          'get:rl:tenant-2', 'set:rl:tenant-2',
        ]);
        // The count each instance persisted is the one it read plus its own request.
        const counts = redis.writes
          .filter(([key]) => key === 'rl:tenant-1')
          .map(([, value]) => (JSON.parse(value) as { count: number }).count);
        expect(counts).toEqual([1, 2, 3]);
      } finally {
        timers.restore();
      }
    });

    /**
     * @source docs:api/security.md#redis-backed-multi-instance
     */
    it('refuses to hand out a shared client before SharedRedisProvider.configure()', async () => {
      const previous = SharedRedisProvider.getOptions();
      await SharedRedisProvider.reset();

      try {
        expect(SharedRedisProvider.isConfigured()).toBe(false);
        // No auto-configuration and no REDIS_URL fallback.
        await expect(SharedRedisProvider.getClient()).rejects.toThrow('SharedRedisProvider not configured');

        SharedRedisProvider.configure({ url: 'redis://localhost:6379' });
        expect(SharedRedisProvider.isConfigured()).toBe(true);
      } finally {
        await SharedRedisProvider.reset();
        if (previous) {
          SharedRedisProvider.configure(previous);
        }
      }
    });

    /**
     * @source docs:api/security.md#implementing-a-custom-store
     */
    it('asks a custom RateLimitStore for the count and honours what it returns', async () => {
      /** Returns 1, then 101 — over the documented default `max` of 100. */
      class MyCustomStore implements RateLimitStore {
        readonly calls: Array<{ key: string; windowMs: number }> = [];
        private count = 0;

        async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
          this.calls.push({ key, windowMs });
          this.count += this.count === 0 ? 1 : 100;

          return { count: this.count, resetAt: Date.now() + windowMs };
        }
      }

      const store = new MyCustomStore();
      app = createApp({ middleware: [RateLimitMiddleware.configure({ store })] });
      await app.start();

      const allowed = await call(app, '/api/ping');
      const blocked = await call(app, '/api/ping');
      await allowed.text();
      await blocked.text();

      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('RateLimit-Limit')).toBe('100');
      expect(allowed.headers.get('RateLimit-Remaining')).toBe('99');
      // The store said 101 — past the default max — so the framework rejects the request.
      expect(blocked.status).toBe(429);

      // Called once per request, with the default window and the caller's address as key.
      expect(store.calls).toHaveLength(2);
      expect(store.calls.map((c) => c.windowMs)).toEqual([60_000, 60_000]);
      expect(store.calls[0]!.key).toBe(store.calls[1]!.key);
      expect(store.calls[0]!.key).not.toBe('unknown');
    });
  });

  describe('SecurityHeadersMiddleware', () => {
    /**
     * @source docs:api/security.md#via-applicationoptionssecurity
     */
    it('sets every documented default header when security is true', async () => {
      app = createApp({ security: true });
      await app.start();

      const response = await call(app, '/api/ping');
      await response.text();

      const actual = DEFAULT_SECURITY_HEADERS.map(([name]) => [name, response.headers.get(name)]);
      expect(actual).toEqual(DEFAULT_SECURITY_HEADERS);
    });

    /**
     * @source docs:api/security.md#via-applicationoptionssecurity
     */
    it('overrides one header and drops another set to false', async () => {
      app = createApp({
        security: {
          contentSecurityPolicy: "default-src 'self'; img-src *",
          strictTransportSecurity: false,
        },
      });
      await app.start();

      const response = await call(app, '/api/ping');
      await response.text();

      expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'; img-src *");
      expect(response.headers.get('Strict-Transport-Security')).toBeNull();
      // The untouched defaults survive the override.
      expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
  });
});
