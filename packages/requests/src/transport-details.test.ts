/**
 * `withoutTransportDetails`, and the error records the client registers for it.
 *
 * The records are built by the real client against real Bun.serve fixtures on 127.0.0.1, because
 * what matters is that every place the client builds an error record registers it — and that the
 * registration survives the copies the client makes of the envelope on the way out.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, Either } from 'effect';

import { createHttpClient, HttpClient } from './client.js';
import { markTransportDetails, withoutTransportDetails } from './transport-details.js';
import {
  type ErrorResponse,
  InternalServerError,
  OneBunBaseError,
} from './types.js';

const COOKIE = 'session=COOKIE-SECRET; Path=/; HttpOnly';

let server: ReturnType<typeof Bun.serve>;
let origin: string;
let client: HttpClient;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);

      switch (pathname) {
        case '/missing': {
          const headers = new Headers({
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Content-Type': 'application/json',
          });
          headers.append('Set-Cookie', COOKIE);

          return new Response(JSON.stringify({ message: 'BODY-SECRET' }), { status: 404, headers });
        }
        case '/moved':
          return new Response(null, { status: 302, headers: { location: 'http://internal.example/sso?ticket=LOC-SECRET' } });
        case '/not-json':
          // eslint-disable-next-line @typescript-eslint/naming-convention
          return new Response('<html>BODY-SECRET', { headers: { 'Content-Type': 'application/json' } });
        case '/empty-json':
          // eslint-disable-next-line @typescript-eslint/naming-convention
          return new Response('', { headers: { 'Content-Type': 'application/json' } });
        case '/corrupt-gzip':
          // eslint-disable-next-line @typescript-eslint/naming-convention
          return new Response('not gzip at all', { headers: { 'Content-Encoding': 'gzip', 'Content-Type': 'text/plain' } });
        case '/envelope':
          return Response.json(
            {
              success: false,
              error: 'REVISION_CONFLICT',
              code: 409,
              details: { expected: 1, actual: 2 },
            },
            { status: 409 },
          );
        default:
          return new Response('ok');
      }
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
  client = createHttpClient({ baseUrl: origin, retries: { max: 0 } });
});

afterAll(() => {
  server.stop(true);
});

/** The `ErrorResponse` a request fails with. */
async function failureOf(request: Effect.Effect<unknown, ErrorResponse>): Promise<ErrorResponse> {
  const outcome = await Effect.runPromise(Effect.either(request));
  if (Either.isRight(outcome)) {
    throw new Error('expected the request to fail');
  }

  return outcome.left;
}

/** `value` serialized for a caller, then parsed back. */
const forCaller = (value: unknown): unknown => JSON.parse(JSON.stringify(value, withoutTransportDetails));

describe('the error records the client registers', () => {
  it('HTTP_ERROR: leaves out headers, url and the upstream body; keeps the rest', async () => {
    const failure = await failureOf(client.getEffect('/missing', { token: 'URL-SECRET' }));

    expect(forCaller(failure)).toEqual({
      success: false,
      error: 'HTTP_ERROR',
      code: 404,
      details: { duration: expect.any(Number), method: 'GET' },
      retryCount: 0,
    });
  });

  it('HTTP_ERROR: the record itself still holds everything, and compares as it did', async () => {
    const failure = await failureOf(client.getEffect('/missing', { token: 'URL-SECRET' }));

    expect(failure.details).toEqual({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: expect.objectContaining({ 'set-cookie': COOKIE }),
      details: { message: 'BODY-SECRET' },
      duration: expect.any(Number),
      url: `${origin}/missing?token=URL-SECRET`,
      method: 'GET',
    });
    // Nothing is added to the record: an inspection or a snapshot shows what it always showed
    expect(Bun.inspect(failure.details)).not.toContain('Symbol');
    expect(Object.getOwnPropertySymbols(failure.details)).toEqual([]);
  });

  it('REDIRECT_ERROR: leaves out url and location; keeps reason, status and redirects', async () => {
    const failure = await failureOf(client.getEffect('/moved', { token: 'URL-SECRET' }, { redirect: 'error' }));

    expect(forCaller(failure)).toEqual({
      success: false,
      error: 'REDIRECT_ERROR',
      code: 302,
      details: { reason: 'refused-by-policy', status: 302, redirects: 0 },
      retryCount: 0,
    });
  });

  it('FETCH_ERROR: leaves out the raw error, which names the request URL; keeps the transport kind', async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response('') });
    const closedOrigin = `http://127.0.0.1:${closed.port}`;
    closed.stop(true);

    const failure = await failureOf(
      createHttpClient({ baseUrl: closedOrigin, retries: { max: 0 } }).getEffect('/p', { token: 'URL-SECRET' }),
    );

    expect(JSON.stringify(failure)).toContain('URL-SECRET');
    expect(forCaller(failure)).toEqual({
      success: false,
      error: 'FETCH_ERROR',
      code: 0,
      details: { transport: 'network' },
      retryCount: 0,
    });
  });

  it('RESPONSE_PARSE_ERROR: leaves out the upstream body', async () => {
    const failure = await failureOf(client.getEffect('/not-json'));

    expect(failure.details).toEqual({ details: '<html>BODY-SECRET' });
    expect(forCaller(failure)).toEqual({
      success: false,
      error: 'RESPONSE_PARSE_ERROR',
      code: 200,
      details: {},
      retryCount: 0,
    });
  });

  it('RESPONSE_PARSE_ERROR of an empty body: the client\'s own text is not a transport detail', async () => {
    const failure = await failureOf(client.getEffect('/empty-json'));

    expect(forCaller(failure)).toMatchObject({ details: { details: 'Response text is empty' } });
  });

  it('RESPONSE_DECODE_ERROR: leaves out the raw decoder error; keeps reason, encoding and status', async () => {
    const failure = await failureOf(client.getEffect('/corrupt-gzip', undefined, { maxResponseBytes: 1024 }));

    expect(failure.error).toBe('RESPONSE_DECODE_ERROR');
    expect(forCaller(failure)).toMatchObject({
      details: { reason: 'corrupt-body', encoding: 'gzip', statusCode: 200 },
    });
    expect((forCaller(failure) as ErrorResponse).details).not.toHaveProperty('details');
  });

  it('an upstream OneBun error envelope is propagated whole: it is the error, not a transport detail', async () => {
    const failure = await failureOf(client.getEffect('/envelope'));

    expect(forCaller(failure)).toMatchObject({
      error: 'REVISION_CONFLICT',
      code: 409,
      details: { expected: 1, actual: 2 },
    });
  });

  it('keeps the registration through a retry, which copies the envelope', async () => {
    let calls = 0;
    const flaky = Bun.serve({
      port: 0,
      fetch() {
        calls += 1;

        // eslint-disable-next-line @typescript-eslint/naming-convention
        return new Response('down', { status: 503, headers: { 'Set-Cookie': COOKIE } });
      },
    });

    try {
      const failure = await failureOf(
        createHttpClient({ baseUrl: `http://127.0.0.1:${flaky.port}`, retries: { max: 1, delay: 1, retryOn: [503] } })
          .getEffect('/p'),
      );

      expect(calls).toBe(2);
      expect(failure.retryCount).toBe(1);
      expect(JSON.stringify(failure, withoutTransportDetails)).not.toContain('COOKIE-SECRET');
    } finally {
      flaky.stop(true);
    }
  });
});

describe('withoutTransportDetails', () => {
  it('reaches the failure req() nests under details.originalError', async () => {
    const thrown = await client.req('GET', '/missing', { token: 'URL-SECRET' }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(InternalServerError);
    const whole = JSON.stringify((thrown as OneBunBaseError).toErrorResponse());
    const shown = JSON.stringify((thrown as OneBunBaseError).toErrorResponse(), withoutTransportDetails);

    expect(whole).toContain('COOKIE-SECRET');
    expect(whole).toContain('URL-SECRET');
    expect(shown).not.toContain('COOKIE-SECRET');
    expect(shown).not.toContain('URL-SECRET');
    expect(shown).not.toContain('BODY-SECRET');
    expect(shown).toContain('"error":"HTTP_ERROR"');
  });

  it('reaches the record as the details of an error built from it', async () => {
    const failure = await failureOf(client.getEffect('/missing'));
    const rebuilt = OneBunBaseError.fromErrorResponse(failure);

    expect(forCaller(rebuilt.toErrorResponse())).toEqual({
      success: false,
      error: 'HTTP_ERROR',
      code: 404,
      details: { duration: expect.any(Number), method: 'GET' },
    });
  });

  it('serializes a copy of the record whole: the copy is not the client\'s', async () => {
    const failure = await failureOf(client.getEffect('/missing'));

    expect(JSON.stringify({ ...failure.details }, withoutTransportDetails)).toContain('COOKIE-SECRET');
  });

  it('leaves every value the client did not register as it is', () => {
    const authored = new InternalServerError('UPSTREAM', {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'x-mine': '1' },
      url: '/documented',
      details: { nested: [1, 'two', null, { deep: true }] },
    }).toErrorResponse();

    expect(JSON.stringify(authored, withoutTransportDetails)).toBe(JSON.stringify(authored));
  });

  it('keeps a key named __proto__ as an own property of the shortened record', () => {
    const record = markTransportDetails(JSON.parse('{"__proto__":"kept","url":"http://internal"}') as Record<string, unknown>, ['url']);

    const shown = JSON.parse(JSON.stringify({ details: record }, withoutTransportDetails));

    expect(Object.getOwnPropertyDescriptor(shown.details, '__proto__')?.value).toBe('kept');
    expect(shown.details).not.toHaveProperty('url');
  });

  it('honours a record registered by another copy of the package, through the global registry', () => {
    // Two copies of @onebun/requests — the application's and the one @onebun/core resolved — must
    // agree: the client that built the error and the filter that serializes it can differ.
    const registry = (globalThis as unknown as Record<symbol, WeakMap<object, readonly string[]>>)[
      Symbol.for('onebun:requests-transport-details')
    ];
    const record = { url: 'http://internal/secret', method: 'GET' };
    registry.set(record, ['url']);

    expect(JSON.parse(JSON.stringify({ details: record }, withoutTransportDetails))).toEqual({ details: { method: 'GET' } });
  });
});
