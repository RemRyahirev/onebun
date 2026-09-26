/**
 * The client-side timeout covers the whole response, body included, and interrupting the Effect
 * that runs a request aborts it.
 *
 * `fetch` resolves at the headers; the body is read afterwards under the same signal. A timeout
 * that fired there used to be reported as `RESPONSE_READ_ERROR`/`RESPONSE_PARSE_ERROR` with the
 * status as its code, so a 500 whose body stalled was replayed by `retryOn` as a server 500. And
 * an interrupted Effect abandoned its `fetch` without aborting it: the server held the connection
 * until the client's own timeout.
 *
 * Every case runs against a real Bun.serve fixture, because both defects live in how the runtime
 * streams a body and closes a connection — a stubbed `fetch` has neither.
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
  Either,
} from 'effect';

import { createHttpClient } from './client.js';
import {
  type ErrorResponse,
  getTransportFailureKind,
  isErrorResponse,
  TRANSPORT_FAILURE_CODE,
} from './types.js';

interface Fixture {
  baseUrl: string;
  /** Requests received, per path. */
  arrivals: Map<string, number>;
  /** `performance.now()` of every `cancel()` a stalled body stream received. */
  cancels: number[];
  /** `performance.now()` of every `abort` a request's own signal fired on the server. */
  aborts: number[];
  stop(): void;
}

const encoder = new TextEncoder();

/** A response that sends its status, its content type and one chunk of body, then stalls. */
function stalledResponse(status: number, isJson: boolean, cancels: number[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(isJson ? '{"partial":' : 'partial'));
      },
      cancel() {
        cancels.push(performance.now());
      },
    }),
    {
      status,
      headers: new Headers([['content-type', isJson ? 'application/json' : 'text/plain']]),
    },
  );
}

/**
 * Routes:
 * - `/stall/<status>/<text|json>` stalls after the first chunk; the stream's `cancel()` is recorded
 * - `/malformed-500` sends a COMPLETE 500 whose JSON body is cut short
 * - `/never` never answers; the request signal's `abort` is recorded
 */
function startFixture(): Fixture {
  const arrivals = new Map<string, number>();
  const cancels: number[] = [];
  const aborts: number[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      arrivals.set(path, (arrivals.get(path) ?? 0) + 1);

      if (path.startsWith('/stall/')) {
        const [, , status, type] = path.split('/');

        return stalledResponse(Number(status), type === 'json', cancels);
      }

      if (path === '/malformed-500') {
        return new Response('{"partial":', {
          status: 500,
          headers: new Headers([['content-type', 'application/json']]),
        });
      }

      if (path === '/never') {
        req.signal.addEventListener('abort', () => aborts.push(performance.now()));

        return new Promise<Response>(() => undefined);
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    baseUrl: server.url.origin,
    arrivals,
    cancels,
    aborts,
    stop: () => server.stop(true),
  };
}

/** Wait until `condition` holds or `withinMs` passes; the caller asserts on what it observed. */
async function waitUntil(condition: () => boolean, withinMs: number): Promise<void> {
  const deadline = performance.now() + withinMs;
  while (!condition() && performance.now() < deadline) {
    await Bun.sleep(5);
  }
}

async function failureOf(effect: Effect.Effect<unknown, ErrorResponse>): Promise<ErrorResponse> {
  const outcome = await Effect.runPromise(Effect.either(effect));
  if (Either.isRight(outcome)) {
    throw new Error(`expected a failure, got ${JSON.stringify(outcome.right)}`);
  }

  return outcome.left;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const g = globalThis as unknown as { __onebunLoggerService?: unknown };
let originalLogger: unknown;
let fixture: Fixture;

beforeEach(() => {
  fixture = startFixture();
  originalLogger = g.__onebunLoggerService;
  // Keeps the retry warnings out of the test output
  g.__onebunLoggerService = { warn: () => undefined };
});

afterEach(() => {
  g.__onebunLoggerService = originalLogger;
  fixture.stop();
});

describe('a timeout while the body is being read', () => {
  it('fails a stalled 200 text body with TIMEOUT_ERROR, code 0, and the status that arrived', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 200 });

    const failure = await failureOf(client.reqEffect('GET', '/stall/200/text'));

    // 0.8.1: { error: 'RESPONSE_READ_ERROR', code: 200 }
    expect(failure.error).toBe('TIMEOUT_ERROR');
    expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
    expect(failure.details?.statusCode).toBe(200);
    expect(failure.details?.phase).toBe('body');
    expect(getTransportFailureKind(failure)).toBe('timeout');
    expect(fixture.arrivals.get('/stall/200/text')).toBe(1);
  });

  it('classifies a stalled JSON body the same way, not as RESPONSE_PARSE_ERROR', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 100 });

    const failure = await failureOf(client.getEffect('/stall/200/json'));

    expect(failure.error).toBe('TIMEOUT_ERROR');
    expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
    expect(failure.details?.statusCode).toBe(200);
    expect(failure.details?.phase).toBe('body');
  });

  it('does not replay a stalled 500 under the default retry config', async () => {
    // Default retries: 500 is in retryOn and GET is retryable, but the response never completed
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 100 });

    const failure = await failureOf(client.getEffect('/stall/500/json'));

    // 0.8.1: RESPONSE_PARSE_ERROR with code 500, replayed by retryOn — 4 requests
    expect(fixture.arrivals.get('/stall/500/json')).toBe(1);
    expect(failure.retryCount).toBe(0);
    expect(failure.error).toBe('TIMEOUT_ERROR');
    expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
    expect(failure.details?.statusCode).toBe(500);
    expect(failure.details?.phase).toBe('body');
  });

  it('replays a stalled 500 max+1 times when retryOnTimeout is set', async () => {
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      timeout: 100,
      retries: { max: 2, delay: 1, retryOnTimeout: true },
    });

    const failure = await failureOf(client.getEffect('/stall/500/json'));

    expect(fixture.arrivals.get('/stall/500/json')).toBe(3);
    expect(failure.retryCount).toBe(2);
    expect(failure.error).toBe('TIMEOUT_ERROR');
  });

  it('still replays a complete 500 with a malformed body by retryOn', async () => {
    // The control: a 500 that arrived whole is a server answer, whatever its body
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      timeout: 1000,
      retries: { max: 2, delay: 1 },
    });

    const failure = await failureOf(client.getEffect('/malformed-500'));

    expect(fixture.arrivals.get('/malformed-500')).toBe(3);
    expect(failure.error).toBe('RESPONSE_PARSE_ERROR');
    expect(failure.code).toBe(500);
    expect(getTransportFailureKind(failure)).toBeUndefined();
  });

  it('cancels the upstream body stream once the timeout fires', async () => {
    const timeoutMs = 150;
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: timeoutMs });
    const startedAt = performance.now();

    await failureOf(client.getEffect('/stall/200/text'));
    await waitUntil(() => fixture.cancels.length > 0, 500);

    expect(fixture.cancels.length).toBe(1);
    // Timers may fire a little early on a loaded machine; the cancel belongs to the timeout
    expect(fixture.cancels[0]! - startedAt).toBeGreaterThanOrEqual(timeoutMs - 20);
  });

  it('rejects the Promise API with the same TIMEOUT_ERROR', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 100 });

    const rejection = await client.get('/stall/200/text').then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejection).toBeInstanceOf(Error);
    expect(String(rejection)).toContain('TIMEOUT_ERROR');
  });
});

describe('interrupting the Effect aborts the request', () => {
  it('aborts a pending fetch when Effect.timeout interrupts reqEffect', async () => {
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      timeout: 1500,
      retries: { max: 0 },
    });
    const startedAt = performance.now();

    const outcome = await Effect.runPromise(
      Effect.either(Effect.timeout(client.reqEffect('GET', '/never'), '100 millis')),
    );
    await waitUntil(() => fixture.aborts.length > 0, 300);

    expect(Either.isLeft(outcome) && Cause.isTimeoutException(outcome.left)).toBe(true);
    // 0.8.1: the server saw the abort only at the client's own 1500 ms timeout
    expect(fixture.aborts.length).toBe(1);
    expect(fixture.aborts[0]! - startedAt).toBeLessThan(300);
  });

  it('cancels the body stream when the interruption lands mid-body', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 1500 });
    const startedAt = performance.now();

    const outcome = await Effect.runPromise(
      Effect.either(Effect.timeout(client.getEffect('/stall/200/text'), '100 millis')),
    );
    await waitUntil(() => fixture.cancels.length > 0, 300);

    expect(Either.isLeft(outcome) && Cause.isTimeoutException(outcome.left)).toBe(true);
    expect(fixture.cancels.length).toBe(1);
    expect(fixture.cancels[0]! - startedAt).toBeLessThan(300);
  });

  it('leaves a request that finishes first alone', async () => {
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      timeout: 1000,
      retries: { max: 0 },
    });

    const outcome = await Effect.runPromise(
      Effect.either(Effect.timeout(client.getEffect('/malformed-500'), '1 second')),
    );

    // The request's own failure comes back, not an interruption
    expect(Either.isLeft(outcome) && isErrorResponse(outcome.left)).toBe(true);
    expect(fixture.arrivals.get('/malformed-500')).toBe(1);
  });
});
