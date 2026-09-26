/**
 * The client follows redirects itself, and a hop to another origin carries only a safelist of
 * headers.
 *
 * `fetch` followed every 3xx on its own and, on a hop to another origin, stripped only
 * `Authorization`, `Cookie` and `Proxy-Authorization`. Measured on 0.8.1: an `apikey` header,
 * `custom` auth headers, `X-OneBun-Signature` and a credential passed through
 * `RequestsOptions.headers` all reached the other origin, and a POST answered 307 re-sent its body
 * there together with the key.
 *
 * Every case runs against real Bun.serve fixtures on 127.0.0.1. `localhost` reaches the same
 * sockets, so `http://localhost:<port>` is another origin on the same server — the second run of
 * each leak case — and `http://localhost:<other port>` is another origin on another server.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import { createHttpClient } from './client.js';
import { setTraceContextProvider } from './trace-context.js';
import {
  type AuthConfig,
  type ErrorResponse,
  getTransportFailureKind,
  type RequestConfig,
  type RequestMetricsData,
  type RequestsOptions,
  TRANSPORT_FAILURE_CODE,
} from './types.js';

interface Arrival {
  method: string;
  /** Path and query. */
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface Fixture {
  port: number;
  /** `http://127.0.0.1:<port>` */
  origin: string;
  arrivals: Arrival[];
  stop(): void;
}

const HOP_DELAY_MS = 150;

/**
 * Routes:
 * - `/redirect/<status>?to=<url>` answers `<status>` with `Location: <url>`
 * - `/no-location` answers 302 without a `Location`
 * - `/loop` answers 302 to itself, forever
 * - `/chain/<n>` answers 302 to `/chain/<n-1>`, and `/chain/0` answers 201
 * - `/slow/<n>` is `/chain/<n>` with every answer delayed by {@link HOP_DELAY_MS}
 * - `/unavailable` answers 503
 * - anything else answers 200 with JSON naming the path
 */
function startFixture(): Fixture {
  const arrivals: Arrival[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((value, name) => {
        headers[name] = value;
      });
      arrivals.push({
        method: req.method, path: url.pathname + url.search, headers, body: await req.text(), 
      });

      const [, route, arg] = url.pathname.split('/');

      if (route === 'redirect') {
        // No `to`, no header: an EMPTY Location is a redirect to the same URL, not a missing one
        const to = url.searchParams.get('to');

        return new Response(null, { status: Number(arg), headers: to === null ? {} : { location: to } });
      }

      if (route === 'no-location') {
        return new Response(null, { status: 302 });
      }

      if (route === 'loop') {
        return new Response(null, { status: 302, headers: { location: '/loop' } });
      }

      if (route === 'chain' || route === 'slow') {
        if (route === 'slow') {
          await Bun.sleep(HOP_DELAY_MS);
        }
        const left = Number(arg);

        return left > 0
          ? new Response(null, { status: 302, headers: { location: `/${route}/${left - 1}` } })
          : Response.json({ done: true }, { status: 201 });
      }

      if (route === 'unavailable') {
        return Response.json({ path: url.pathname }, { status: 503 });
      }

      return Response.json({ path: url.pathname });
    },
  });

  return {
    port: server.port!,
    origin: `http://127.0.0.1:${server.port}`,
    arrivals,
    stop: () => server.stop(true),
  };
}

/** Run a call and hand back its failure, or fail the test if it succeeded. */
async function failureOf(effect: Effect.Effect<unknown, ErrorResponse>): Promise<ErrorResponse> {
  const outcome = await Effect.runPromise(Effect.either(effect));
  if (outcome._tag === 'Right') {
    throw new Error(`expected a failure, got ${JSON.stringify(outcome.right)}`);
  }

  return outcome.left;
}

/** Every header name the leak cases put on the original request, lower-cased. */
const CREDENTIAL_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-upstream-token',
  'x-onebun-signature',
  'x-user-secret',
];

/** Sent on every leak case alongside its own credential: `fetch` strips these two itself. */
const BROWSER_STYLE_CREDENTIALS = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  Cookie: 'sid=COOKIE-SECRET',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'Proxy-Authorization': 'Basic PROXY-SECRET',
};

interface CredentialCase {
  name: string;
  auth?: AuthConfig;
  optionsHeaders?: Record<string, string>;
  configHeaders?: Record<string, string>;
  /** The header that carries this case's credential on the original request. */
  carriedBy: string;
}

const CREDENTIAL_CASES: CredentialCase[] = [
  { name: 'bearer auth', auth: { type: 'bearer', token: 'BEARER-SECRET' }, carriedBy: 'authorization' },
  { name: 'basic auth', auth: { type: 'basic', username: 'user', password: 'pass' }, carriedBy: 'authorization' },
  {
    name: 'apikey auth in a header',
    auth: { type: 'apikey', key: 'X-Api-Key', value: 'APIKEY-SECRET' },
    carriedBy: 'x-api-key',
  },
  {
    name: 'custom auth headers',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    auth: { type: 'custom', headers: { 'X-Upstream-Token': 'CUSTOM-SECRET' } },
    carriedBy: 'x-upstream-token',
  },
  {
    name: 'onebun auth',
    auth: {
      type: 'onebun', serviceId: 'svc-a', secretKey: 'k'.repeat(40), audience: 'svc-b', 
    },
    carriedBy: 'x-onebun-signature',
  },
  {
    name: 'a credential in RequestsOptions.headers',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    optionsHeaders: { 'X-User-Secret': 'OPTIONS-SECRET' },
    carriedBy: 'x-user-secret',
  },
  {
    name: 'a credential in config.headers',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    configHeaders: { 'X-User-Secret': 'CONFIG-SECRET' },
    carriedBy: 'x-user-secret',
  },
];

function clientFor(fixture: Fixture, credential: CredentialCase, options: RequestsOptions = {}) {
  return createHttpClient({
    baseUrl: fixture.origin,
    retries: { max: 0 },
    headers: { ...BROWSER_STYLE_CREDENTIALS, ...credential.optionsHeaders },
    ...(credential.auth ? { auth: credential.auth } : {}),
    ...options,
  });
}

function configFor(credential: CredentialCase): Partial<RequestConfig> | undefined {
  return credential.configHeaders ? { headers: credential.configHeaders } : undefined;
}

describe('redirects', () => {
  let a: Fixture;
  let b: Fixture;

  beforeEach(() => {
    a = startFixture();
    b = startFixture();
  });

  afterEach(() => {
    setTraceContextProvider(null);
    a.stop();
    b.stop();
  });

  describe('a hop to another origin carries no credential', () => {
    const targets: { name: string; url: (fx: { a: Fixture; b: Fixture }) => string; arrivals: () => Arrival[] }[] = [
      { name: 'another port', url: ({ b: other }) => `http://localhost:${other.port}/x`, arrivals: () => b.arrivals },
      {
        name: 'the same port under another host name',
        url: ({ a: self }) => `http://localhost:${self.port}/x`,
        arrivals: () => a.arrivals,
      },
    ];

    for (const credential of CREDENTIAL_CASES) {
      for (const target of targets) {
        it(`${credential.name}: 302 to ${target.name}`, async () => {
          const client = clientFor(a, credential);

          const response = await client.get('/redirect/302', { to: target.url({ a, b }) }, configFor(credential));

          expect(response.success).toBe(true);
          // Not vacuous: the original request did carry the credential.
          const original = a.arrivals[0];
          expect(original.path.startsWith('/redirect/302')).toBe(true);
          expect(original.headers[credential.carriedBy]).toBeDefined();
          expect(original.headers.cookie).toBe('sid=COOKIE-SECRET');

          const arrived = target.arrivals().find((arrival) => arrival.path === '/x');
          expect(arrived).toBeDefined();
          expect(Object.keys(arrived!.headers).filter((name) => CREDENTIAL_HEADERS.includes(name))).toEqual([]);
        });
      }
    }

    it('should keep what a hop dropped when the chain comes back to the first origin', async () => {
      const client = clientFor(a, CREDENTIAL_CASES[2]);
      const back = `${a.origin}/final`;

      await client.get('/redirect/302', { to: `http://localhost:${b.port}/redirect/307?to=${encodeURIComponent(back)}` });

      const final = a.arrivals.find((arrival) => arrival.path === '/final');
      expect(final).toBeDefined();
      expect(final!.headers['x-api-key']).toBeUndefined();
      expect(final!.headers.cookie).toBeUndefined();
    });

    it('should send the safelisted headers: user-agent, accept and the trace headers', async () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const spanId = '00f067aa0ba902b7';
      setTraceContextProvider(() => ({ traceId, spanId, traceFlags: 1 }));
      const client = clientFor(a, CREDENTIAL_CASES[0], { userAgent: 'svc-a/1.0' });

      await client.get('/redirect/302', { to: `http://localhost:${b.port}/x` });

      expect(a.arrivals[0].headers.authorization).toBe('Bearer BEARER-SECRET');
      const arrived = b.arrivals[0];
      expect(arrived.headers.traceparent).toBe(`00-${traceId}-${spanId}-01`);
      expect(arrived.headers['x-trace-id']).toBe(traceId);
      expect(arrived.headers['x-span-id']).toBe(spanId);
      expect(arrived.headers['user-agent']).toBe('svc-a/1.0');
      expect(arrived.headers.accept).toBe('application/json');
      // A GET has no body, so its default content-type does not go along
      expect(arrived.headers['content-type']).toBeUndefined();
      expect(arrived.headers.authorization).toBeUndefined();
    });

    it('should re-send the body of a 307 POST with its content-type, and without the key', async () => {
      const client = clientFor(a, CREDENTIAL_CASES[2]);

      await client.post(`/redirect/307?to=${encodeURIComponent(`http://localhost:${b.port}/x`)}`, { secret: 1 });

      expect(b.arrivals).toHaveLength(1);
      expect(b.arrivals[0].method).toBe('POST');
      expect(b.arrivals[0].body).toBe('{"secret":1}');
      expect(b.arrivals[0].headers['content-type']).toBe('application/json');
      expect(b.arrivals[0].headers['x-api-key']).toBeUndefined();
    });
  });

  describe('a hop to the same origin', () => {
    for (const credential of CREDENTIAL_CASES) {
      it(`${credential.name}: delivers every original header`, async () => {
        setTraceContextProvider(() => ({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' }));
        const client = clientFor(a, credential);

        await client.get('/redirect/302', { to: `${a.origin}/y` }, configFor(credential));

        expect(a.arrivals.map((arrival) => arrival.path.split('?')[0])).toEqual(['/redirect/302', '/y']);
        // X-OneBun-Signature included: it goes along as it was, not re-signed
        expect(a.arrivals[1].headers).toEqual(a.arrivals[0].headers);
      });
    }

    it('should resolve a relative Location against the URL that answered', async () => {
      const client = createHttpClient({ baseUrl: a.origin });

      await client.get('/redirect/302', { to: '../sibling?q=1' });

      expect(a.arrivals[1].path).toBe('/sibling?q=1');
    });
  });

  describe('method and body', () => {
    const post = async (status: number, method: 'POST' | 'PUT' | 'HEAD' = 'POST') => {
      const client = createHttpClient({ baseUrl: a.origin, retries: { max: 0 } });

      await client.request({
        method: method as RequestConfig['method'],
        url: `/redirect/${status}`,
        query: { to: `${a.origin}/target` },
        data: { n: 1 },
      });

      return a.arrivals[1];
    };

    for (const status of [301, 302]) {
      it(`${status}: a POST arrives as a GET with no body and no content-type`, async () => {
        const arrived = await post(status);

        expect(arrived.method).toBe('GET');
        expect(arrived.body).toBe('');
        expect(arrived.headers['content-type']).toBeUndefined();
      });

      it(`${status}: a PUT keeps its method and body`, async () => {
        const arrived = await post(status, 'PUT');

        expect(arrived.method).toBe('PUT');
        expect(arrived.body).toBe('{"n":1}');
      });
    }

    it('303: a POST or a PUT arrives as a GET with no body and no content-type', async () => {
      for (const method of ['POST', 'PUT'] as const) {
        a.arrivals.length = 0;
        const arrived = await post(303, method);

        expect(arrived.method).toBe('GET');
        expect(arrived.body).toBe('');
        expect(arrived.headers['content-type']).toBeUndefined();
      }
    });

    it('303: a HEAD stays a HEAD', async () => {
      const arrived = await post(303, 'HEAD');

      expect(arrived.method).toBe('HEAD');
    });

    for (const status of [307, 308]) {
      it(`${status}: a POST arrives as a POST with identical body bytes`, async () => {
        const arrived = await post(status);

        expect(arrived.method).toBe('POST');
        expect(arrived.body).toBe('{"n":1}');
        expect(arrived.headers['content-type']).toBe('application/json');
      });
    }
  });

  describe('REDIRECT_ERROR', () => {
    it('should fail the response that would be the 21st redirect, after 21 requests', async () => {
      const client = createHttpClient({ baseUrl: a.origin });

      const failure = await failureOf(client.getEffect('/loop'));

      expect(failure.error).toBe('REDIRECT_ERROR');
      expect(failure.code).toBe(302);
      expect(failure.details).toMatchObject({
        reason: 'too-many-redirects', redirects: 20, status: 302, location: '/loop', 
      });
      // A GET is retryable by default; a redirect loop is not retried.
      expect(failure.retryCount).toBe(0);
      expect(a.arrivals).toHaveLength(21);
    });

    it('should follow exactly 20 redirects', async () => {
      const client = createHttpClient({ baseUrl: a.origin });

      const response = await client.get('/chain/20');

      expect(response.success && response.statusCode).toBe(201);
      expect(a.arrivals).toHaveLength(21);
    });

    it('should not retry it even when retryOn lists the 3xx', async () => {
      const client = createHttpClient({ baseUrl: a.origin, retries: { max: 2, delay: 1, retryOn: [302] } });

      const failure = await failureOf(client.getEffect('/no-location'));

      expect(failure.error).toBe('REDIRECT_ERROR');
      expect(failure.details?.reason).toBe('missing-location');
      expect(a.arrivals).toHaveLength(1);
    });

    it('should refuse a Location that is not an http(s) URL', async () => {
      const client = createHttpClient({ baseUrl: a.origin });

      for (const to of ['ftp://127.0.0.1/file', 'http://[::1']) {
        a.arrivals.length = 0;
        const failure = await failureOf(client.getEffect('/redirect/307', { to }));

        expect(failure.error).toBe('REDIRECT_ERROR');
        expect(failure.code).toBe(307);
        expect(failure.details).toMatchObject({ reason: 'invalid-location', location: to });
        expect(a.arrivals).toHaveLength(1);
      }
    });
  });

  it('should bound the whole chain by one timeout', async () => {
    // Every hop answers well inside the timeout; the three together do not.
    const client = createHttpClient({ baseUrl: a.origin, timeout: 400 });

    const failure = await failureOf(client.getEffect('/slow/2'));

    expect(failure.error).toBe('TIMEOUT_ERROR');
    expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
    expect(getTransportFailureKind(failure)).toBe('timeout');
    expect(a.arrivals.map((arrival) => arrival.path)).toEqual(['/slow/2', '/slow/1', '/slow/0']);
  });

  it('should replay the whole chain from the original URL on a retry', async () => {
    const records: RequestMetricsData[] = [];
    const client = createHttpClient({
      baseUrl: a.origin,
      retries: { max: 1, delay: 1 },
      metricsSink: (data) => records.push(data),
    });

    const failure = await failureOf(client.getEffect('/redirect/307', { to: '/unavailable' }));

    expect(failure.code).toBe(503);
    expect(failure.retryCount).toBe(1);
    expect(a.arrivals.map((arrival) => arrival.path)).toEqual([
      '/redirect/307?to=%2Funavailable',
      '/unavailable',
      '/redirect/307?to=%2Funavailable',
      '/unavailable',
    ]);
    // One record per attempt, never per hop
    expect(records.map((record) => record.statusCode)).toEqual([503, 503]);
  });

  it('should not follow a 3xx that is not a redirect', async () => {
    const client = createHttpClient({ baseUrl: a.origin });

    const outcome = await Effect.runPromise(Effect.either(client.getEffect('/redirect/300', { to: '/elsewhere' })));

    // Resolved or failed with the 300 itself — whichever, `Location` was not followed
    const status = outcome._tag === 'Left' ? outcome.left.code : outcome.right.success && outcome.right.statusCode;
    expect(status).toBe(300);
    expect(a.arrivals).toHaveLength(1);
  });

  it('should record metrics once per call, with the final status', async () => {
    const records: RequestMetricsData[] = [];
    const client = createHttpClient({ baseUrl: a.origin, metricsSink: (data) => records.push(data) });

    await client.get('/chain/2');

    expect(a.arrivals).toHaveLength(3);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      statusCode: 201, success: true, url: `${a.origin}/chain/2`, retryCount: 0, 
    });
  });
});
