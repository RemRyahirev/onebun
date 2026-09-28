/**
 * `connectAddress` — a request that connects to an IP address the caller validated, while the
 * `Host` header, the TLS SNI and the certificate check keep the URL's host name.
 *
 * Three layers:
 * - a spy in place of `fetch`, for what the client hands it: an IP-literal URL, `Host` and
 *   `tls.serverName`, and nothing at all for a value it refuses;
 * - plain-HTTP `Bun.serve` fixtures on 127.0.0.1, for redirects and retries;
 * - a TLS fixture with a certificate made for this run, reached from a fresh process that trusts
 *   the run's CA through `NODE_EXTRA_CA_CERTS`, for SNI and certificate verification.
 *
 * Nothing here relies on how `.test` names resolve: every host name the requests use is one the
 * fixture's address is dialled for, and the spy proves the URL `fetch` got names no host at all.
 */
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import { createHttpClient } from './client.js';
import { runPinnedRequest } from './connect-address-fixtures/fixture-protocol.js';
import { makeTestCertificates } from './connect-address-fixtures/test-certificates.js';
import { makeSingleReplicaNonceStore, verifyOneBunRequest } from './onebun-auth.js';
import { makeRequestsService, RequestsService } from './service.js';
import {
  type ErrorResponse,
  type OneBunBaseError,
  type RequestMetricsData,
} from './types.js';

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  tls: { serverName?: string } | undefined;
  method: string | undefined;
  body: unknown;
}

const originalFetch = globalThis.fetch;

/** `fetch` replaced by a recorder that answers each call with `answer(call)`. */
function spyOnFetch(answer: (call: FetchCall, index: number) => Response = () => Response.json({ ok: true })) {
  const calls: FetchCall[] = [];
  const spy = (input: string | URL | Request, init?: RequestInit & { tls?: { serverName?: string } }) => {
    const call: FetchCall = {
      url: String(input),
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      tls: init?.tls,
      method: init?.method,
      body: init?.body,
    };
    calls.push(call);

    return Promise.resolve(answer(call, calls.length - 1));
  };
  globalThis.fetch = spy as unknown as typeof fetch;

  return calls;
}

/** The value of `name` in `headers`, in any letter case, and how many keys spell it. */
function headerOf(headers: Record<string, string>, name: string): { value: string | undefined; keys: number } {
  const keys = Object.keys(headers).filter((key) => key.toLowerCase() === name);

  return { value: keys.length === 1 ? headers[keys[0]] : undefined, keys: keys.length };
}

const failureOf = async (effect: Effect.Effect<unknown, ErrorResponse>): Promise<ErrorResponse> => {
  const outcome = await Effect.runPromise(Effect.either(effect));
  if (outcome._tag === 'Right') {
    throw new Error(`expected a failure, got ${JSON.stringify(outcome.right)}`);
  }

  return outcome.left;
};

describe('connectAddress — what fetch is given', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('dials the IP literal, with Host = the URL host:port and tls.serverName = the URL host name', async () => {
    const calls = spyOnFetch();
    const client = createHttpClient();

    const response = await client.get('https://a.test:8443/v1/items?page=2', undefined, { connectAddress: '127.0.0.1' });

    expect(response.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://127.0.0.1:8443/v1/items?page=2');
    expect(headerOf(calls[0].headers, 'host')).toEqual({ value: 'a.test:8443', keys: 1 });
    expect(calls[0].tls).toEqual({ serverName: 'a.test' });
  });

  it('leaves the port out of Host when it is the scheme default, as fetch does', async () => {
    const calls = spyOnFetch();

    await createHttpClient().get('https://A.Test/x', undefined, { connectAddress: '10.1.2.3' });

    expect(calls[0].url).toBe('https://10.1.2.3/x');
    expect(headerOf(calls[0].headers, 'host').value).toBe('a.test');
    expect(calls[0].tls).toEqual({ serverName: 'a.test' });
  });

  it('puts an IPv6 address in brackets, in its canonical form', async () => {
    const calls = spyOnFetch();
    const client = createHttpClient({ baseUrl: 'https://a.test:8443' });

    await client.get('/x', undefined, { connectAddress: '::1' });
    await client.get('/x', undefined, { connectAddress: '2001:DB8:0:0:0:0:0:1' });
    await client.get('/x', undefined, { connectAddress: '::ffff:127.0.0.1' });

    expect(calls.map((call) => call.url)).toEqual([
      'https://[::1]:8443/x',
      'https://[2001:db8::1]:8443/x',
      'https://[::ffff:7f00:1]:8443/x',
    ]);
    expect(calls.map((call) => call.tls?.serverName)).toEqual(['a.test', 'a.test', 'a.test']);
  });

  it('passes no tls option over plain HTTP', async () => {
    const calls = spyOnFetch();

    await createHttpClient().get('http://a.test:8080/x', undefined, { connectAddress: '127.0.0.1' });

    expect(calls[0].url).toBe('http://127.0.0.1:8080/x');
    expect(headerOf(calls[0].headers, 'host').value).toBe('a.test:8080');
    expect(calls[0].tls).toBeUndefined();
  });

  it('sends a Host header the caller set as it is, once', async () => {
    const calls = spyOnFetch();

    await createHttpClient().get('https://a.test/x', undefined, {
      connectAddress: '127.0.0.1',
      headers: { host: 'tenant.a.test' },
    });

    expect(headerOf(calls[0].headers, 'host')).toEqual({ value: 'tenant.a.test', keys: 1 });
    expect(calls[0].tls).toEqual({ serverName: 'a.test' });
  });

  it('changes nothing without connectAddress', async () => {
    const calls = spyOnFetch();

    await createHttpClient().get('https://a.test:8443/x');

    expect(calls[0].url).toBe('https://a.test:8443/x');
    expect(headerOf(calls[0].headers, 'host').keys).toBe(0);
    expect(calls[0].tls).toBeUndefined();
  });

  it('is config in the two-argument form, not query data', async () => {
    const calls = spyOnFetch();
    const client = createHttpClient({ baseUrl: 'https://a.test' });

    await client.get('/x', { connectAddress: '127.0.0.1' });
    await client.delete('/x', { connectAddress: '127.0.0.1' });
    await client.head('/x', { connectAddress: '127.0.0.1' });
    await client.options('/x', { connectAddress: '127.0.0.1' });

    expect(calls.map((call) => call.url)).toEqual([
      'https://127.0.0.1/x',
      'https://127.0.0.1/x',
      'https://127.0.0.1/x',
      'https://127.0.0.1/x',
    ]);
  });

  it('reaches fetch through the other methods and the RequestsService layer too', async () => {
    const calls = spyOnFetch();
    const client = createHttpClient({ baseUrl: 'https://a.test' });

    await client.post('/x', { a: 1 }, { connectAddress: '127.0.0.1' });
    await Effect.runPromise(Effect.provide(
      Effect.flatMap(RequestsService, (service) =>
        service.getEffect('/y', undefined, { connectAddress: '127.0.0.2' })),
      makeRequestsService({ baseUrl: 'https://a.test' }),
    ) as Effect.Effect<unknown, OneBunBaseError>);

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['POST', 'https://127.0.0.1/x'],
      ['GET', 'https://127.0.0.2/y'],
    ]);
  });

  it('signs as without it, and records and reports the URL with its host name', async () => {
    const calls = spyOnFetch(() => new Response('nope', { status: 404 }));
    const metrics: RequestMetricsData[] = [];
    const secretKey = 'connect-address-secret';
    const client = createHttpClient({
      baseUrl: 'https://a.test:8443',
      auth: {
        type: 'onebun', serviceId: 'caller', secretKey, audience: 'callee',
      },
      metricsSink: (data) => metrics.push(data),
    });

    const failure = await failureOf(client.postEffect('/v1/orders', { id: 7 }, { connectAddress: '127.0.0.1' }));

    expect(calls[0].url).toBe('https://127.0.0.1:8443/v1/orders');
    const verified = await Effect.runPromise(verifyOneBunRequest({
      method: 'POST',
      url: 'https://a.test:8443/v1/orders',
      headers: new Headers(calls[0].headers),
      body: String(calls[0].body),
    }, {
      secret: secretKey,
      audience: 'callee',
      nonceStore: makeSingleReplicaNonceStore(),
    }));
    expect(verified).toMatchObject({ valid: true, serviceId: 'caller' });
    expect(metrics.map((data) => data.url)).toEqual(['https://a.test:8443/v1/orders']);
    expect(failure.error).toBe('HTTP_ERROR');
    expect(failure.details?.url).toBe('https://a.test:8443/v1/orders');
  });

  it('connects every retry to the same address', async () => {
    const calls = spyOnFetch((_, index) => (index === 0
      ? new Response('busy', { status: 503 })
      : Response.json({ ok: true })));
    const client = createHttpClient({ retries: { max: 1, delay: 0 } });

    const response = await client.get('https://a.test/x', undefined, { connectAddress: '127.0.0.1' });

    expect(response.success && response.retryCount).toBe(1);
    expect(calls.map((call) => [call.url, headerOf(call.headers, 'host').value, call.tls?.serverName])).toEqual([
      ['https://127.0.0.1/x', 'a.test', 'a.test'],
      ['https://127.0.0.1/x', 'a.test', 'a.test'],
    ]);
  });

  it('works Host and tls.serverName out afresh for each hop of a same-host redirect', async () => {
    const calls = spyOnFetch((_, index) => (index === 0
      ? new Response(null, { status: 301, headers: { location: 'https://a.test:8443/secure' } })
      : Response.json({ ok: true })));

    const response = await createHttpClient().get('http://a.test/start', undefined, { connectAddress: '127.0.0.1' });

    expect(response.success).toBe(true);
    expect(calls.map((call) => [call.url, headerOf(call.headers, 'host').value, call.tls?.serverName])).toEqual([
      ['http://127.0.0.1/start', 'a.test', undefined],
      ['https://127.0.0.1:8443/secure', 'a.test:8443', 'a.test'],
    ]);
  });

  describe('a value that is not an IP address rejects before fetch', () => {
    const refused: [string, unknown][] = [
      ['a word', 'not-an-ip'],
      ['a host name', 'a.test'],
      ['an empty string', ''],
      ['null', null],
      ['a number', 2130706433],
      ['an IPv6 address in brackets', '[::1]'],
      ['an IPv6 address with a zone, which a URL cannot name', 'fe80::1%eth0'],
      ['an IPv4 part with a leading zero, which a URL reads as octal', '010.0.0.1'],
      ['a shortened IPv4 address', '127.1'],
      ['padding', ' 127.0.0.1'],
    ];

    for (const [label, value] of refused) {
      it(label, async () => {
        const calls = spyOnFetch();
        const metrics: RequestMetricsData[] = [];
        const retried: unknown[] = [];
        const client = createHttpClient({
          metricsSink: (data) => metrics.push(data),
          retries: {
            max: 3,
            delay: 0,
            onRetry(error) {
              retried.push(error);
            },
          },
        });

        const failure = await failureOf(client.getEffect('https://a.test/x', undefined, {
          connectAddress: value as string,
        }));

        expect(calls).toHaveLength(0);
        expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
        expect(failure.code).toBe(500);
        expect(failure.details).toMatchObject({ option: 'connectAddress', reason: 'not-an-ip', value });
        expect(metrics).toHaveLength(0);
        expect(retried).toHaveLength(0);
      });
    }
  });

  it('rejects a URL that is not http(s) before fetch', async () => {
    const calls = spyOnFetch();
    const client = createHttpClient();

    const relative = await failureOf(client.getEffect('/no-base-url', undefined, { connectAddress: '127.0.0.1' }));
    const file = await failureOf(client.getEffect('file:///etc/hosts', undefined, { connectAddress: '127.0.0.1' }));

    expect(calls).toHaveLength(0);
    expect([relative.details?.reason, file.details?.reason]).toEqual(['not-an-http-url', 'not-an-http-url']);
    expect([relative.error, file.error]).toEqual(['REQUEST_CONFIG_ERROR', 'REQUEST_CONFIG_ERROR']);
  });

  it('checks a connectAddress a custom auth interceptor set', async () => {
    const calls = spyOnFetch();
    const client = createHttpClient({
      auth: { type: 'custom', interceptor: (request) => ({ ...request, connectAddress: 'a.test' }) },
    });

    const failure = await failureOf(client.getEffect('https://a.test/x'));

    expect(calls).toHaveLength(0);
    expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
  });

  it('keeps the caller\'s connectAddress when a custom auth interceptor returns a config without one', async () => {
    const calls = spyOnFetch();
    const rebuilt = createHttpClient({
      auth: {
        type: 'custom',
        interceptor: (request) => ({ method: request.method, url: request.url, headers: { ...request.headers, signature: '1' } }),
      },
    });
    const cleared = createHttpClient({
      auth: { type: 'custom', interceptor: (request) => ({ ...request, connectAddress: undefined }) },
    });
    const replaced = createHttpClient({
      auth: { type: 'custom', interceptor: (request) => ({ ...request, connectAddress: '127.0.0.2' }) },
    });

    await rebuilt.get('https://a.test/x', undefined, { connectAddress: '127.0.0.1' });
    await cleared.get('https://a.test/x', undefined, { connectAddress: '127.0.0.1' });
    await replaced.get('https://a.test/x', undefined, { connectAddress: '127.0.0.1' });

    expect(calls.map((call) => call.url)).toEqual([
      'https://127.0.0.1/x',
      'https://127.0.0.1/x',
      'https://127.0.0.2/x',
    ]);
    expect(calls.map((call) => call.tls?.serverName)).toEqual(['a.test', 'a.test', 'a.test']);
    expect(headerOf(calls[0].headers, 'signature').value).toBe('1');
  });
});

interface Arrival {
  host: string | null;
  path: string;
}

interface Fixture {
  port: number;
  arrivals: Arrival[];
  stop(): void;
}

/**
 * On 127.0.0.1. `/redirect?to=<url>` answers 302 with `Location: <url>`; `/flaky` answers 503 the
 * first time and 200 after; anything else answers 200 with the `Host` it got.
 */
function startFixture(): Fixture {
  const arrivals: Arrival[] = [];
  let flakyCalls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      arrivals.push({ host: req.headers.get('host'), path: url.pathname });

      if (url.pathname === '/redirect') {
        return new Response(null, { status: 302, headers: { location: url.searchParams.get('to') ?? '' } });
      }

      if (url.pathname === '/flaky') {
        flakyCalls += 1;

        return flakyCalls === 1 ? new Response('busy', { status: 503 }) : Response.json({ host: req.headers.get('host') });
      }

      return Response.json({ host: req.headers.get('host') });
    },
  });

  return { port: server.port ?? 0, arrivals, stop: () => server.stop(true) };
}

describe('connectAddress — redirects and retries against a real server', () => {
  let a: Fixture;
  let b: Fixture;

  beforeEach(() => {
    a = startFixture();
    b = startFixture();
  });

  afterEach(() => {
    a.stop();
    b.stop();
  });

  it('reaches the server with the host name in Host', async () => {
    const response = await createHttpClient().get(`http://a.test:${a.port}/hello`, undefined, {
      connectAddress: '127.0.0.1',
    });

    expect(response.success && response.result).toEqual({ host: `a.test:${a.port}` });
    expect(a.arrivals).toEqual([{ host: `a.test:${a.port}`, path: '/hello' }]);
  });

  for (const [label, target] of [
    ['a host name', (port: number) => `http://localhost:${port}/x`],
    ['an IP literal, which needs no lookup but was not validated', (port: number) => `http://127.0.0.1:${port}/x`],
    ['a subdomain of the same host', (port: number) => `http://api.a.test:${port}/x`],
  ] as const) {
    it(`refuses a redirect to another host — ${label} — with REDIRECT_ERROR, before contacting it`, async () => {
      const location = target(b.port);
      const client = createHttpClient({ retries: { max: 3, delay: 0 } });

      const failure = await failureOf(client.getEffect(
        `http://a.test:${a.port}/redirect?to=${encodeURIComponent(location)}`,
        undefined,
        { connectAddress: '127.0.0.1' },
      ));

      expect(failure.error).toBe('REDIRECT_ERROR');
      expect(failure.code).toBe(302);
      expect(failure.details).toMatchObject({ reason: 'other-host', location, redirects: 0 });
      expect(a.arrivals).toHaveLength(1);
      expect(b.arrivals).toHaveLength(0);
    });
  }

  it('follows a redirect to the same host, on another port, to the same address', async () => {
    const location = `http://a.test:${b.port}/moved`;

    const response = await createHttpClient().get(
      `http://a.test:${a.port}/redirect?to=${encodeURIComponent(location)}`,
      undefined,
      { connectAddress: '127.0.0.1' },
    );

    expect(response.success && response.result).toEqual({ host: `a.test:${b.port}` });
    expect(b.arrivals).toEqual([{ host: `a.test:${b.port}`, path: '/moved' }]);
  });

  it('still follows a redirect to another host without connectAddress', async () => {
    const location = `http://127.0.0.1:${b.port}/x`;

    const response = await createHttpClient().get(
      `http://127.0.0.1:${a.port}/redirect?to=${encodeURIComponent(location)}`,
    );

    expect(response.success).toBe(true);
    expect(b.arrivals).toHaveLength(1);
  });

  it('connects a retry to the same address', async () => {
    const response = await createHttpClient({ retries: { max: 1, delay: 0 } }).get(
      `http://a.test:${a.port}/flaky`,
      undefined,
      { connectAddress: '127.0.0.1' },
    );

    expect(response.success && response.retryCount).toBe(1);
    expect(a.arrivals).toEqual([
      { host: `a.test:${a.port}`, path: '/flaky' },
      { host: `a.test:${a.port}`, path: '/flaky' },
    ]);
  });
});

interface TlsArrival {
  sni: string | false | null | undefined;
  host: string | undefined;
}

describe('connectAddress over TLS — a certificate for a.test, made for this run', () => {
  const tlsArrivals: TlsArrival[] = [];
  let server: tls.Server;
  let port: number;
  let dir: string;
  let caFile: string;

  beforeAll(async () => {
    const certificates = makeTestCertificates(['a.test']);
    dir = mkdtempSync(join(tmpdir(), 'onebun-connect-address-'));
    caFile = join(dir, 'ca.pem');
    writeFileSync(caFile, certificates.caPem);

    // A bare HTTP/1.1 responder over node:tls: it is the one server that tells what SNI it got
    server = tls.createServer({ cert: certificates.certPem, key: certificates.keyPem }, (socket) => {
      let head = '';
      socket.on('data', (chunk: Buffer) => {
        head += chunk.toString();
        if (!head.includes('\r\n\r\n')) {
          return;
        }
        const arrival: TlsArrival = {
          sni: socket.servername,
          host: head.match(/\r\nhost: ([^\r]*)/i)?.[1],
        };
        tlsArrivals.push(arrival);
        const body = JSON.stringify(arrival);
        socket.end(
          'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n' +
          `content-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
        );
      });
      socket.on('error', () => undefined);
    });
    server.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    tlsArrivals.length = 0;
  });

  it('returns 200, and the server sees SNI a.test and Host a.test:<port>', async () => {
    const run = await runPinnedRequest(`https://a.test:${port}/`, '127.0.0.1', { caFile, killAfterMs: 20_000 });

    expect(run.result, run.output).toEqual({
      success: true,
      statusCode: 200,
      result: { sni: 'a.test', host: `a.test:${port}` },
    });
    expect(tlsArrivals).toEqual([{ sni: 'a.test', host: `a.test:${port}` }]);
  });

  it('verifies the certificate against the URL host name, not the address', async () => {
    const run = await runPinnedRequest(`https://b.test:${port}/`, '127.0.0.1', { caFile, killAfterMs: 20_000 });

    expect(run.result, run.output).toEqual({
      success: false,
      error: 'FETCH_ERROR',
      causeCode: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    expect(tlsArrivals).toHaveLength(0);
  });
});
