import {
  describe,
  expect,
  it,
} from 'bun:test';

import type { OneBunRequest } from '../types';

import { CorsMiddleware } from './cors-middleware';
import { MemoryRateLimitStore, RateLimitMiddleware } from './rate-limit-middleware';
import { SecurityHeadersMiddleware } from './security-headers-middleware';

// ============================================================================
// Helpers
// ============================================================================

function makeReq(
  method = 'GET',
  url = 'http://localhost/test',
  headers: [string, string][] = [],
): OneBunRequest {
  const h = new Headers();
  for (const [k, v] of headers) {
    h.set(k, v);
  }

  return new Request(url, { method, headers: h }) as unknown as OneBunRequest;
}

function makeNext(status = 200, body = 'ok', extraHeaders: [string, string][] = []) {
  return async (): Promise<Response> => {
    const h = new Headers();
    h.set('Content-Type', 'text/plain');
    for (const [k, v] of extraHeaders) {
      h.set(k, v);
    }

    return new Response(body, { status, headers: h });
  };
}

// Instantiate middleware without DI (logger/config not needed for these tests)
function makeCors(options = {}): CorsMiddleware {
  return new CorsMiddleware(options);
}

function makeRateLimit(options = {}): RateLimitMiddleware {
  return new RateLimitMiddleware(options);
}

function makeSecurityHeaders(options = {}): SecurityHeadersMiddleware {
  return new SecurityHeadersMiddleware(options);
}

// ============================================================================
// CorsMiddleware
// ============================================================================

describe('CorsMiddleware', () => {
  it('sets wildcard origin header by default', async () => {
    const mw = makeCors();
    const res = await mw.use(makeReq('GET', 'http://localhost/', [['origin', 'https://example.com']]), makeNext());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('responds with 204 to OPTIONS preflight', async () => {
    const mw = makeCors();
    const res = await mw.use(
      makeReq('OPTIONS', 'http://localhost/', [['origin', 'https://example.com']]),
      makeNext(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Max-Age')).toBeDefined();
  });

  it('reflects allowed origin when exact string is configured', async () => {
    const mw = makeCors({ origin: 'https://allowed.example.com', credentials: true });
    const res = await mw.use(
      makeReq('GET', 'http://localhost/', [['origin', 'https://allowed.example.com']]),
      makeNext(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example.com');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does not set allow-origin for disallowed origin', async () => {
    const mw = makeCors({ origin: 'https://allowed.example.com' });
    const res = await mw.use(
      makeReq('GET', 'http://localhost/', [['origin', 'https://other.example.com']]),
      makeNext(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('accepts origin matching RegExp', async () => {
    const mw = makeCors({ origin: /\.example\.com$/ });
    const res = await mw.use(
      makeReq('GET', 'http://localhost/', [['origin', 'https://sub.example.com']]),
      makeNext(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://sub.example.com');
  });

  it('accepts origin matching function predicate', async () => {
    const mw = makeCors({ origin: (o: string) => o.startsWith('https://trusted') });
    const res = await mw.use(
      makeReq('GET', 'http://localhost/', [['origin', 'https://trusted.io']]),
      makeNext(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://trusted.io');
  });

  it('exposes configured headers', async () => {
    const mw = makeCors({ exposedHeaders: ['X-Custom-Header'] });
    const res = await mw.use(
      makeReq('GET', 'http://localhost/', [['origin', 'https://example.com']]),
      makeNext(),
    );
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe('X-Custom-Header');
  });

  it('forwards OPTIONS to next() when preflightContinue is true', async () => {
    const mw = makeCors({ preflightContinue: true });
    const res = await mw.use(
      makeReq('OPTIONS', 'http://localhost/', [['origin', 'https://example.com']]),
      makeNext(200),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('configure() factory creates working middleware class', async () => {
    const configuredClass = CorsMiddleware.configure({ origin: 'https://configured.example.com' });
    const mw = new configuredClass();
    const res = await mw.use(
      makeReq('GET', 'http://localhost/', [['origin', 'https://configured.example.com']]),
      makeNext(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://configured.example.com');
  });
});

// ============================================================================
// SecurityHeadersMiddleware
// ============================================================================

describe('SecurityHeadersMiddleware', () => {
  it('sets default security headers', async () => {
    const mw = makeSecurityHeaders();
    const res = await mw.use(makeReq(), makeNext());
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=15552000; includeSubDomains');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
  });

  it('allows overriding individual headers', async () => {
    const mw = makeSecurityHeaders({ xFrameOptions: 'DENY', xXssProtection: '1; mode=block' });
    const res = await mw.use(makeReq(), makeNext());
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    // Other defaults still present
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('omits disabled headers', async () => {
    const mw = makeSecurityHeaders({ strictTransportSecurity: false, contentSecurityPolicy: false });
    const res = await mw.use(makeReq(), makeNext());
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });

  it('configure() factory creates working middleware class', async () => {
    const configuredClass = SecurityHeadersMiddleware.configure({ xFrameOptions: 'DENY' });
    const mw = new configuredClass();
    const res = await mw.use(makeReq(), makeNext());
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});

// ============================================================================
// RateLimitMiddleware
// ============================================================================

describe('RateLimitMiddleware', () => {
  it('allows requests below the limit', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({ max: 5, windowMs: 60_000, store });
    const req = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '10.0.0.1']]);
    const res = await mw.use(req, makeNext());
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('5');
    expect(res.headers.get('RateLimit-Remaining')).toBe('4');
  });

  it('blocks requests that exceed the limit with 429', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({ max: 2, windowMs: 60_000, store });
    const req = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '10.0.0.2']]);

    await mw.use(req, makeNext()); // 1st
    await mw.use(req, makeNext()); // 2nd
    const res = await mw.use(req, makeNext()); // 3rd — over limit

    expect(res.status).toBe(429);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Too Many Requests');
  });

  it('returns 429 with custom message', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({
      max: 1, windowMs: 60_000, store, message: 'Slow down!', 
    });
    const req = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '10.0.0.3']]);
    await mw.use(req, makeNext());
    const res = await mw.use(req, makeNext());
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Slow down!');
  });

  it('tracks keys independently', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({ max: 1, windowMs: 60_000, store });
    const reqA = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '1.1.1.1']]);
    const reqB = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '2.2.2.2']]);

    await mw.use(reqA, makeNext()); // A: 1st
    const resA2 = await mw.use(reqA, makeNext()); // A: 2nd — over limit
    const resB1 = await mw.use(reqB, makeNext()); // B: 1st — OK

    expect(resA2.status).toBe(429);
    expect(resB1.status).toBe(200);
  });

  it('uses custom key generator', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({
      max: 1,
      windowMs: 60_000,
      store,
      keyGenerator: (req: OneBunRequest) => req.headers.get('x-api-key') ?? 'anon',
    });
    const req = makeReq('GET', 'http://localhost/', [['x-api-key', 'secret-key']]);
    await mw.use(req, makeNext());
    const res = await mw.use(req, makeNext());
    expect(res.status).toBe(429);
  });

  it('adds legacy X-RateLimit-* headers when configured', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({
      max: 10, windowMs: 60_000, store, legacyHeaders: true, 
    });
    const req = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '10.0.0.9']]);
    const res = await mw.use(req, makeNext());
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  it('configure() factory creates working middleware class', async () => {
    const configuredClass = RateLimitMiddleware.configure({ max: 5, windowMs: 60_000 });
    const mw = new configuredClass();
    const req = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '10.0.0.10']]);
    const res = await mw.use(req, makeNext());
    expect(res.status).toBe(200);
    expect(res.headers.get('RateLimit-Limit')).toBe('5');
  });

  it('MemoryRateLimitStore.clear() resets counters', async () => {
    const store = new MemoryRateLimitStore();
    const mw = makeRateLimit({ max: 1, windowMs: 60_000, store });
    const req = makeReq('GET', 'http://localhost/', [['x-forwarded-for', '10.0.0.11']]);
    await mw.use(req, makeNext());
    const blocked = await mw.use(req, makeNext());
    expect(blocked.status).toBe(429);
    store.clear();
    const allowed = await mw.use(req, makeNext());
    expect(allowed.status).toBe(200);
  });
});
