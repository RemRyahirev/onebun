/**
 * An error envelope in a response body, `{ success: false, error, code, details }`: what the
 * client rejects with, and how the failure is retried.
 *
 * A OneBun service's default exception filter answers an escaped client failure of its own with
 * HTTP 500 and keeps the failure's `code` in the body: `0` when ITS upstream timed out or refused
 * the connection, a 3xx for a `REDIRECT_ERROR`. Read at face value, that body made the caller's
 * client reject with a `TransportError`: the caller took a failure two hops away for its own
 * network error, retried it under `retryOnNetworkError` and ignored `retryOn`. A third-party
 * server can send any `code` it likes. Real Bun.serve fixtures on 127.0.0.1, counting what arrives.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, Either } from 'effect';

import { createHttpClient } from './client.js';
import { isHttpClientFailure, withoutTransportDetails } from './transport-details.js';
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  type ErrorResponse,
  getTransportFailureKind,
  InternalServerError,
  OneBunBaseError,
  type RequestMetricsData,
  type RequestsOptions,
  TransportError,
} from './types.js';

/** What each path, `/<key>`, answers: its HTTP status and the envelope in its body. */
const ANSWERS: Record<string, { status: number; body: Record<string, unknown> }> = {
  // A OneBun service whose own upstream refused the connection, as its default filter relays it
  relayedNetwork: {
    status: 500,
    body: {
      success: false, error: 'FETCH_ERROR', code: 0, details: { transport: 'network' },
    },
  },
  // ...whose own upstream timed out
  relayedTimeout: {
    status: 500,
    body: {
      success: false, error: 'TIMEOUT_ERROR', code: 0, details: { transport: 'timeout' },
    },
  },
  // ...whose own upstream answered a redirect it would not follow
  relayedRedirect: {
    status: 500,
    body: {
      success: false, error: 'REDIRECT_ERROR', code: 302, details: { reason: 'refused-by-policy', status: 302, redirects: 0 },
    },
  },
  zeroUnder400: { status: 400, body: { success: false, error: 'INVALID_PARAM', code: 0 } },
  zeroUnder200: { status: 200, body: { success: false, error: 'USER_BANNED', code: 0 } },
  claimsTimeout: {
    status: 502,
    body: {
      success: false, error: 'UPSTREAM', code: 0, details: { transport: 'timeout' },
    },
  },
  // A OneBun service under `httpEnvelope`: HTTP 200, the status in the body
  envelopeMode: {
    status: 200,
    body: {
      success: false, error: 'REVISION_CONFLICT', code: 409, details: { expected: 1, actual: 2 },
    },
  },
  stringDetails: {
    status: 409,
    body: {
      success: false, error: 'CONFLICT', code: 409, details: 'raw text',
    },
  },
  withCause: {
    status: 500,
    body: {
      success: false,
      error: 'DB_FAILED',
      code: 500,
      details: { host: 'db.internal:5432' },
      originalError: { error: 'POOL_EXHAUSTED', code: 500, details: { pool: 'primary' } },
    },
  },
};

let server: ReturnType<typeof Bun.serve>;
let origin: string;
const hits: Record<string, number> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const { pathname } = new URL(request.url);
      hits[pathname] = (hits[pathname] ?? 0) + 1;
      const answer = ANSWERS[pathname.slice(1)];

      return answer === undefined
        ? new Response('not here', { status: 404 })
        : Response.json(answer.body, { status: answer.status });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

/** What `get(path)` rejects with, and how many requests reached the server. */
async function rejectionOf(
  path: string,
  retries: RequestsOptions['retries'] = { max: 0 },
): Promise<{ error: OneBunBaseError; requests: number }> {
  hits[path] = 0;
  const error = await createHttpClient({ baseUrl: origin, retries }).get(path).then(
    () => {
      throw new Error(`expected ${path} to reject`);
    },
    (rejection: unknown) => rejection,
  );

  expect(error).toBeInstanceOf(OneBunBaseError);

  return { error: error as OneBunBaseError, requests: hits[path] };
}

describe('a body code outside 400-599', () => {
  it.each(['/relayedNetwork', '/relayedTimeout'])(
    '%s is the 500 that arrived, not a transport failure of this request',
    async (path) => {
      const { error } = await rejectionOf(path);

      expect(error).toBeInstanceOf(InternalServerError);
      expect(error).not.toBeInstanceOf(TransportError);
      expect(error.code).toBe(500);
      expect(getTransportFailureKind(error)).toBeUndefined();
      // What the upstream reported stays readable
      expect(error.error).toBe(ANSWERS[path.slice(1)].body.error as string);
      expect(error.details).toEqual(ANSWERS[path.slice(1)].body.details as Record<string, unknown>);
    },
  );

  it('takes the status that arrived when that is an error status', async () => {
    const underBadRequest = await rejectionOf('/zeroUnder400');
    const claimingTimeout = await rejectionOf('/claimsTimeout');

    expect(underBadRequest.error).toBeInstanceOf(BadRequestError);
    expect(underBadRequest.error.code).toBe(400);
    expect(claimingTimeout.error).toBeInstanceOf(BadGatewayError);
    expect(claimingTimeout.error.code).toBe(502);
    expect(getTransportFailureKind(claimingTimeout.error)).toBeUndefined();
  });

  it('is a 500 under a status that is not an error status', async () => {
    const { error } = await rejectionOf('/zeroUnder200');

    expect(error).toBeInstanceOf(InternalServerError);
    expect(error.code).toBe(500);
  });

  it('is a 500 for a relayed REDIRECT_ERROR, not the 3xx of a redirect this request never saw', async () => {
    const { error } = await rejectionOf('/relayedRedirect');

    expect(error).toBeInstanceOf(InternalServerError);
    expect(error.code).toBe(500);
    expect(error.error).toBe('REDIRECT_ERROR');
  });

  it('fails the Effect API with the same code', async () => {
    const outcome = await Effect.runPromise(
      Effect.either(createHttpClient({ baseUrl: origin, retries: { max: 0 } }).getEffect('/relayedNetwork')),
    );

    expect(Either.isLeft(outcome)).toBe(true);
    const failure = (outcome as Either.Left<ErrorResponse, unknown>).left;
    expect(failure.code).toBe(500);
    expect(getTransportFailureKind(failure)).toBeUndefined();
  });

  it('is recorded in the metrics as the 500 that arrived, not as 0', async () => {
    const records: RequestMetricsData[] = [];
    const client = createHttpClient({
      baseUrl: origin,
      retries: { max: 0 },
      metrics: true,
      metricsSink: (data) => records.push(data),
    });

    await client.get('/relayedNetwork').catch(() => undefined);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ statusCode: 500, success: false });
  });

  it('keeps an error status in the body under HTTP 200, as httpEnvelope sends it', async () => {
    const { error } = await rejectionOf('/envelopeMode');

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe(409);
    expect(error.details).toEqual({ expected: 1, actual: 2 });
  });
});

describe('retrying an error body', () => {
  it.each(['/relayedNetwork', '/relayedTimeout', '/relayedRedirect'])(
    '%s follows retryOn, not retryOnNetworkError or retryOnTimeout',
    async (path) => {
      // 500 is in the default retryOn; the transport flags are set against the old reading
      const retried = await rejectionOf(path, {
        max: 2, delay: 1, retryOnNetworkError: false, retryOnTimeout: false,
      });
      const notListed = await rejectionOf(path, {
        max: 2, delay: 1, retryOn: [503], retryOnNetworkError: true, retryOnTimeout: true,
      });

      expect(retried.requests).toBe(3);
      expect(notListed.requests).toBe(1);
    },
  );
});

describe('the details an upstream sent in its error body', () => {
  it('are the rejection\'s to read, and serialize as {} for this application\'s caller', async () => {
    const { error } = await rejectionOf('/withCause');

    expect(error.details).toEqual({ host: 'db.internal:5432' });
    expect(error.originalError).toEqual({ error: 'POOL_EXHAUSTED', code: 500, details: { pool: 'primary' } });
    const shown = JSON.stringify(error.toErrorResponse(), withoutTransportDetails);

    expect(JSON.parse(shown)).toEqual({
      success: false,
      error: 'DB_FAILED',
      code: 500,
      details: {},
      originalError: {},
    });
    expect(shown).not.toContain('db.internal');
    expect(shown).not.toContain('primary');
    // Without the replacer — `exposeErrorDetails` — everything goes
    expect(JSON.stringify(error.toErrorResponse())).toContain('db.internal');
  });

  it('keep a body whose details is not a record under details.details, withheld the same way', async () => {
    const { error } = await rejectionOf('/stringDetails');

    expect(error.details).toEqual({ details: 'raw text' });
    expect(JSON.parse(JSON.stringify(error.toErrorResponse(), withoutTransportDetails)).details).toEqual({});
  });

  it('make the rejection an HTTP-client failure', async () => {
    const { error } = await rejectionOf('/envelopeMode');

    expect(isHttpClientFailure(error)).toBe(true);
  });
});
