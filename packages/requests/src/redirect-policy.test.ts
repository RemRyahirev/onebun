/**
 * The `redirect` policy — `'follow'` (the default), `'error'` and `'manual'`, on the client and on
 * one request — and the re-signing of a same-origin hop under `onebun` auth with an audience.
 *
 * Built on the client's own redirect loop, whose following rules are in `redirect.test.ts`. Every
 * case runs against real Bun.serve fixtures on 127.0.0.1.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import {
  Cause,
  Effect,
  pipe,
  Runtime,
} from 'effect';

import { createHttpClient } from './client.js';
import {
  makeSingleReplicaNonceStore,
  type OneBunAuthResult,
  type OneBunVerifyOptions,
  verifyOneBunRequest,
} from './onebun-auth.js';
import { makeRequestsService, RequestsService } from './service.js';
import {
  type ErrorResponse,
  HttpMethod,
  type OneBunAuthConfig,
  type OneBunBaseError,
  type RequestMetricsData,
} from './types.js';

interface Arrival {
  method: string;
  /** Path and query. */
  path: string;
  body: string;
  signature: string | null;
  /** What `verifyOneBunRequest` made of the request, on a fixture that verifies. */
  verified?: OneBunAuthResult;
}

interface Fixture {
  port: number;
  /** `http://127.0.0.1:<port>` */
  origin: string;
  arrivals: Arrival[];
  stop(): void;
}

const MOVED_BODY = '<a href="/home?from=moved">moved</a>';

/**
 * Routes:
 * - `/redirect/<status>?to=<url>` answers `<status>` with `Location: <url>`, and with no `Location`
 *   when `to` is absent
 * - `/moved/<status>` answers `<status>` with `Location: /home?from=moved` and an HTML body
 * - `/empty-json/<status>` answers `<status>` with `Location: /home`, `Content-Type: application/json`
 *   and no body
 * - `/multiple-choices` answers 300 with a `Location` and a JSON body
 * - `/not-modified` answers 304
 * - anything else answers 200 with JSON naming the path
 *
 * With `verify`, every request is checked by `verifyOneBunRequest` before it is answered.
 */
function startFixture(verify?: OneBunVerifyOptions): Fixture {
  const arrivals: Arrival[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      const arrival: Arrival = {
        method: req.method,
        path: url.pathname + url.search,
        body,
        signature: req.headers.get('x-onebun-signature'),
      };
      if (verify) {
        arrival.verified = await Effect.runPromise(verifyOneBunRequest({
          method: req.method, url: req.url, headers: req.headers, body,
        }, verify));
      }
      arrivals.push(arrival);

      const [, route, arg] = url.pathname.split('/');

      switch (route) {
        case 'redirect': {
          const to = url.searchParams.get('to');

          return new Response(null, { status: Number(arg), headers: to === null ? {} : { location: to } });
        }
        case 'moved':
          return new Response(MOVED_BODY, {
            status: Number(arg),
            headers: new Headers([['location', '/home?from=moved'], ['content-type', 'text/html']]),
          });
        case 'empty-json':
          // `Content-Type` promises JSON, and there is no body
          return new Response(null, {
            status: Number(arg),
            headers: new Headers([['location', '/home'], ['content-type', 'application/json']]),
          });
        case 'multiple-choices':
          return Response.json({ choices: ['/a', '/b'] }, { status: 300, headers: { location: '/a' } });
        case 'not-modified':
          return new Response(null, { status: 304 });
        default:
          return Response.json({ path: url.pathname });
      }
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
async function failureOf<E>(effect: Effect.Effect<unknown, E>): Promise<E> {
  const outcome = await Effect.runPromise(Effect.either(effect));
  if (outcome._tag === 'Right') {
    throw new Error(`expected a failure, got ${JSON.stringify(outcome.right)}`);
  }

  return outcome.left;
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

describe('redirect policy', () => {
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

  describe("'error'", () => {
    it('fails a POST answered 307 with REDIRECT_ERROR without contacting the Location, sent once', async () => {
      // Retries allowed for POST and for 307, so the single arrival is the policy's doing
      const client = createHttpClient({
        baseUrl: a.origin,
        redirect: 'error',
        retries: {
          max: 3, delay: 1, methods: ['POST'], retryOn: [307],
        },
      });
      const target = `${b.origin}/target`;
      const url = `/redirect/307?to=${encodeURIComponent(target)}`;

      const failure = await failureOf(client.postEffect(url, { n: 1 }));

      expect(failure.error).toBe('REDIRECT_ERROR');
      expect(failure.code).toBe(307);
      expect(failure.details).toEqual({
        reason: 'refused-by-policy',
        status: 307,
        location: target,
        url: `${a.origin}${url}`,
        redirects: 0,
      });
      expect(failure.retryCount).toBe(0);
      expect(a.arrivals).toHaveLength(1);
      expect(b.arrivals).toHaveLength(0);

      // The Promise API rejects, with the same failure inside
      const rejection: unknown = await client.post(url, { n: 1 }).then(() => undefined, (error: unknown) => error);
      expect(Runtime.isFiberFailure(rejection)).toBe(true);
      if (Runtime.isFiberFailure(rejection)) {
        expect(Cause.squash(rejection[Runtime.FiberFailureCauseId])).toMatchObject({
          error: 'REDIRECT_ERROR', code: 307, retryCount: 0,
        });
      }
      expect(b.arrivals).toHaveLength(0);
    });

    it('refuses every redirect status, one without a Location included', async () => {
      const client = createHttpClient({ baseUrl: a.origin, redirect: 'error' });

      for (const status of REDIRECT_STATUSES) {
        const failure = await failureOf(client.getEffect(`/moved/${status}`));

        expect([failure.error, failure.code, failure.details?.reason, failure.details?.location])
          .toEqual(['REDIRECT_ERROR', status, 'refused-by-policy', '/home?from=moved']);
      }

      const bare = await failureOf(client.getEffect('/redirect/302'));
      expect(bare.details?.reason).toBe('refused-by-policy');
      expect(bare.details && 'location' in bare.details).toBe(false);
      // Nothing but the six refused requests
      expect(a.arrivals.map((arrival) => arrival.path.split('/')[1])).toEqual([
        'moved', 'moved', 'moved', 'moved', 'moved', 'redirect',
      ]);
    });

    it('leaves a 3xx that is not a redirect as it is under every policy', async () => {
      const outcomes: unknown[] = [];

      for (const redirect of ['follow', 'error', 'manual'] as const) {
        const client = createHttpClient({ baseUrl: a.origin, redirect });

        const notModified = await client.get('/not-modified');
        const choices = await Effect.runPromise(Effect.either(client.getEffect('/multiple-choices')));

        expect(notModified.success && notModified.statusCode).toBe(304);
        outcomes.push(choices._tag === 'Right'
          ? ['resolved', choices.right.success && choices.right.statusCode]
          : ['failed', choices.left.error, choices.left.code]);
      }

      // A 300 is an answer whatever the policy, and its Location is never followed
      expect(outcomes).toEqual([outcomes[0], outcomes[0], outcomes[0]]);
      expect(a.arrivals.filter((arrival) => arrival.path === '/a')).toHaveLength(0);
    });

    it('records one metric, with the redirect status', async () => {
      const records: RequestMetricsData[] = [];
      const client = createHttpClient({
        baseUrl: a.origin, redirect: 'error', metricsSink: (data) => records.push(data),
      });

      await failureOf(client.getEffect('/moved/308'));

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ statusCode: 308, success: false, retryCount: 0 });
    });
  });

  describe("'manual'", () => {
    it('resolves a 302 with its status and Location, and does not follow it', async () => {
      const client = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });

      const response = await client.get('/redirect/302', { to: '/home?x=1' });

      expect(response.success).toBe(true);
      expect(response.success && response.statusCode).toBe(302);
      // As the server sent it: a relative Location stays relative
      expect(response.success && response.headers?.location).toBe('/home?x=1');
      // No Content-Type and no body, as `Response.redirect()` answers
      expect(response.success && response.result).toBe('');
      expect(a.arrivals).toHaveLength(1);
    });

    it('resolves every redirect status with its body, and sends a POST once', async () => {
      const records: RequestMetricsData[] = [];
      const client = createHttpClient({
        baseUrl: a.origin,
        redirect: 'manual',
        retries: { methods: ['POST'], retryOn: REDIRECT_STATUSES },
        metricsSink: (data) => records.push(data),
      });

      for (const status of REDIRECT_STATUSES) {
        const response = await client.post(`/moved/${status}`, { n: 1 });

        expect(response.success && [response.statusCode, response.result, response.headers?.location, response.retryCount])
          .toEqual([status, MOVED_BODY, '/home?from=moved', 0]);
      }

      expect(a.arrivals.map((arrival) => `${arrival.method} ${arrival.path}`)).toEqual(
        REDIRECT_STATUSES.map((status) => `POST /moved/${status}`),
      );
      expect(records.map((record) => [record.statusCode, record.success])).toEqual(
        REDIRECT_STATUSES.map((status) => [status, true]),
      );
    });

    it('resolves a redirect that has no Location, headers.location unset', async () => {
      const client = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });

      const response = await client.get('/redirect/303');

      expect(response.success && response.statusCode).toBe(303);
      expect(response.success && response.headers?.location).toBeUndefined();
    });

    it('reads the body of the 3xx as any other, under maxResponseBytes too', async () => {
      const client = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });

      const tooLarge = await failureOf(client.getEffect('/moved/301', undefined, { maxResponseBytes: 8 }));

      expect([tooLarge.error, tooLarge.code, tooLarge.details?.limit]).toEqual(['RESPONSE_TOO_LARGE', 301, 8]);
    });

    it('resolves a redirect typed as JSON with an empty body, keeping its Location', async () => {
      const client = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });

      const redirects = await Promise.all(REDIRECT_STATUSES.map((status) => client.get(`/empty-json/${status}`)));

      expect(redirects.map((response) => response.success && [response.statusCode, response.result, response.headers?.location]))
        .toEqual(REDIRECT_STATUSES.map((status) => [status, undefined, '/home']));
    });

    it('still fails an empty JSON body on any status that is not a handed-back redirect', async () => {
      const manual = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });

      const ok = await failureOf(manual.getEffect('/empty-json/200'));
      const multipleChoices = await failureOf(manual.getEffect('/empty-json/300'));

      expect([ok.error, ok.code]).toEqual(['RESPONSE_PARSE_ERROR', 200]);
      expect([multipleChoices.error, multipleChoices.code]).toEqual(['RESPONSE_PARSE_ERROR', 300]);
    });

    it('does not contact another origin a POST 307 points at', async () => {
      const client = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });
      const target = `${b.origin}/target`;

      const response = await client.post(`/redirect/307?to=${encodeURIComponent(target)}`, { n: 1 });

      expect(response.success && response.headers?.location).toBe(target);
      expect(b.arrivals).toHaveLength(0);
    });
  });

  describe('client and request', () => {
    it('lets a per-request error override a client that follows', async () => {
      for (const options of [{}, { redirect: 'follow' as const }]) {
        a.arrivals.length = 0;
        const client = createHttpClient({ baseUrl: a.origin, ...options });

        const failure = await failureOf(client.getEffect('/redirect/302', { to: '/home' }, { redirect: 'error' }));

        expect(failure.error).toBe('REDIRECT_ERROR');
        expect(failure.details?.reason).toBe('refused-by-policy');
        expect(a.arrivals).toHaveLength(1);
      }
    });

    it('lets a per-request follow or manual override the client', async () => {
      const refusing = createHttpClient({ baseUrl: a.origin, redirect: 'error' });
      const manual = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });

      const followed = await refusing.get('/redirect/302', { to: '/home' }, { redirect: 'follow' });
      const handedBack = await refusing.get('/redirect/302', { to: '/home' }, { redirect: 'manual' });
      const followedToo = await manual.get('/redirect/302', { to: '/home' }, { redirect: 'follow' });

      expect(followed.success && followed.statusCode).toBe(200);
      expect(handedBack.success && handedBack.statusCode).toBe(302);
      expect(followedToo.success && followedToo.statusCode).toBe(200);
    });

    it('reads an undefined policy as "not set": the client\'s, else follow', async () => {
      const manual = createHttpClient({ baseUrl: a.origin, redirect: 'manual' });
      const unset = createHttpClient({ baseUrl: a.origin, redirect: undefined });

      const kept = await manual.get('/moved/302', undefined, { redirect: undefined });
      const followed = await unset.get('/moved/302');

      expect(kept.success && kept.statusCode).toBe(302);
      expect(followed.success && followed.statusCode).toBe(200);
    });

    it('takes the policy through the config argument of every method', async () => {
      const client = createHttpClient({ baseUrl: a.origin });
      const manual = { redirect: 'manual' as const };

      const responses = [
        await client.get('/moved/302', undefined, manual),
        await client.delete('/moved/302', undefined, manual),
        await client.head('/moved/302', undefined, manual),
        await client.options('/moved/302', undefined, manual),
        await client.post('/moved/307', { n: 1 }, manual),
        await client.put('/moved/307', { n: 1 }, manual),
        await client.patch('/moved/307', { n: 1 }, manual),
        await client.request({ method: HttpMethod.GET, url: '/moved/302', redirect: 'manual' }),
        await client.reqRaw('GET', '/moved/302', undefined, manual),
      ];

      expect(responses.map((response) => response.success && response.statusCode))
        .toEqual([302, 302, 302, 302, 307, 307, 307, 302, 302]);
      expect(await client.req<string>('GET', '/moved/302', undefined, manual)).toBe(MOVED_BODY);
      expect(a.arrivals).toHaveLength(10);
    });

    it('applies through the RequestsService layer', async () => {
      const run = <T>(program: Effect.Effect<T, OneBunBaseError, RequestsService>) =>
        Effect.runPromise(Effect.either(pipe(
          program,
          Effect.provide(makeRequestsService({ baseUrl: a.origin, redirect: 'manual' })),
        )));

      const handedBack = await run(Effect.flatMap(RequestsService, (service) => service.getEffect('/moved/302')));
      const refused = await run(
        Effect.flatMap(RequestsService, (service) => service.getEffect('/moved/302', undefined, { redirect: 'error' })),
      );

      expect(handedBack._tag === 'Right' && handedBack.right).toBe(MOVED_BODY);
      expect(refused._tag === 'Left' && [refused.left.error, refused.left.details.status, refused.left.details.reason])
        .toEqual(['REDIRECT_ERROR', 302, 'refused-by-policy']);
    });
  });

  describe('redirect is not a config marker', () => {
    it('sends a redirect key in the second argument as query data', async () => {
      const client = createHttpClient({ baseUrl: a.origin });

      await client.get('/login', { redirect: '/home' });
      await client.delete('/login', { redirect: 'error' });
      await client.head('/login', { redirect: 'manual' });
      await client.options('/login', { redirect: 'follow' });

      expect(a.arrivals.map((arrival) => `${arrival.method} ${arrival.path}`)).toEqual([
        'GET /login?redirect=%2Fhome',
        'DELETE /login?redirect=error',
        'HEAD /login?redirect=manual',
        'OPTIONS /login?redirect=follow',
      ]);
    });

    it('never takes the policy from the query', async () => {
      const refusing = createHttpClient({ baseUrl: a.origin, redirect: 'error' });
      const following = createHttpClient({ baseUrl: a.origin });

      const failure = await failureOf(refusing.getEffect('/redirect/302', { to: '/home', redirect: 'follow' }));
      const followed = await following.get('/redirect/302', { to: '/home', redirect: 'error' });

      expect(failure.error).toBe('REDIRECT_ERROR');
      expect(followed.success && followed.statusCode).toBe(200);
      expect(a.arrivals.map((arrival) => arrival.path)).toEqual([
        '/redirect/302?to=%2Fhome&redirect=follow',
        '/redirect/302?to=%2Fhome&redirect=error',
        '/home',
      ]);
    });
  });
});

describe('onebun auth over a same-origin redirect', () => {
  const secret = 's'.repeat(40);
  const signed = (audience?: string): OneBunAuthConfig => ({
    type: 'onebun', serviceId: 'svc-a', secretKey: secret, ...(audience === undefined ? {} : { audience }),
  });
  let fixtures: Fixture[] = [];
  const start = (verify?: OneBunVerifyOptions) => {
    const fixture = startFixture(verify);
    fixtures.push(fixture);

    return fixture;
  };

  afterEach(() => {
    fixtures.forEach((fixture) => fixture.stop());
    fixtures = [];
  });

  const results = (fixture: Fixture) =>
    fixture.arrivals.map((arrival) => [arrival.method, arrival.path, arrival.verified?.valid, arrival.verified?.reason]);

  it('re-signs the hop when the auth names an audience, so a POST 307 verifies at the target', async () => {
    // A nonce store too: the hop's signature is a fresh one, not a replay of the first
    const a = start({ secret, audience: 'svc-b', nonceStore: makeSingleReplicaNonceStore() });
    const client = createHttpClient({ baseUrl: a.origin, retries: { max: 0 }, auth: signed('svc-b') });

    const response = await client.post('/redirect/307?to=%2Fnew', { a: 1 });

    expect(response.success && response.statusCode).toBe(200);
    expect(results(a)).toEqual([
      ['POST', '/redirect/307?to=%2Fnew', true, undefined],
      ['POST', '/new', true, undefined],
    ]);
    expect(a.arrivals[1].body).toBe('{"a":1}');
    expect(a.arrivals[1].signature).not.toBe(a.arrivals[0].signature);
  });

  it('re-signs every hop of a same-origin chain, one that turns into a GET included', async () => {
    const a = start({ secret, audience: 'svc-b', nonceStore: makeSingleReplicaNonceStore() });
    const client = createHttpClient({ baseUrl: a.origin, retries: { max: 0 } });
    const second = `/redirect/302?to=${encodeURIComponent('/final?q=1')}`;

    // The auth of one request re-signs as the client's would
    await client.post(`/redirect/303?to=${encodeURIComponent(second)}`, { a: 1 }, { auth: signed('svc-b') });

    expect(results(a)).toEqual([
      ['POST', `/redirect/303?to=${encodeURIComponent(second)}`, true, undefined],
      ['GET', second, true, undefined],
      ['GET', '/final?q=1', true, undefined],
    ]);
  });

  it('keeps the original signature without an audience, and the target rejects it', async () => {
    for (const audience of [undefined, '']) {
      const a = start({ secret, audience: false, nonceStore: false });
      const client = createHttpClient({ baseUrl: a.origin, retries: { max: 0 }, auth: signed(audience) });

      await client.post('/redirect/307?to=%2Fnew', { a: 1 });

      expect(results(a)).toEqual([
        ['POST', '/redirect/307?to=%2Fnew', true, undefined],
        ['POST', '/new', false, 'signature-mismatch'],
      ]);
      expect(a.arrivals[1].signature).toBe(a.arrivals[0].signature);
    }
  });

  it('never signs a request to another origin, nor one back on the first after it', async () => {
    const a = start({ secret, audience: 'svc-b', nonceStore: false });
    const b = start();
    const client = createHttpClient({ baseUrl: a.origin, retries: { max: 0 }, auth: signed('svc-b') });
    const back = `${b.origin}/redirect/307?to=${encodeURIComponent(`${a.origin}/final`)}`;

    await client.post(`/redirect/307?to=${encodeURIComponent(back)}`, { a: 1 });

    expect(b.arrivals.map((arrival) => arrival.signature)).toEqual([null]);
    expect(a.arrivals.map((arrival) => [arrival.path.split('?')[0], arrival.signature === null])).toEqual([
      ['/redirect/307', false],
      ['/final', true],
    ]);
  });

  it('signs nothing under the error and manual policies', async () => {
    const a = start({ secret, audience: 'svc-b', nonceStore: false });
    const client = createHttpClient({ baseUrl: a.origin, retries: { max: 0 }, auth: signed('svc-b') });

    const failure: ErrorResponse = await failureOf(
      client.postEffect('/redirect/307?to=%2Fnew', { a: 1 }, { redirect: 'error' }),
    );
    const handedBack = await client.post('/redirect/307?to=%2Fnew', { a: 1 }, { redirect: 'manual' });

    expect(failure.error).toBe('REDIRECT_ERROR');
    expect(handedBack.success && handedBack.statusCode).toBe(307);
    expect(results(a).map(([, path]) => path)).toEqual(['/redirect/307?to=%2Fnew', '/redirect/307?to=%2Fnew']);
  });
});
