/**
 * `responseType: 'bytes' | 'stream'`.
 *
 * Every body used to be read with `response.text()`: a binary body came back with every byte
 * outside UTF-8 replaced by U+FFFD, and nothing resolved before the whole body had arrived, so a
 * server-sent event stream never resolved at all. `'bytes'` hands the body over as bytes, and
 * `'stream'` resolves at the headers with the body still to be read. In stream mode `timeout`
 * bounds each wait on the upstream rather than the whole response, so a flowing stream lives on
 * and a stalled one is cut off.
 *
 * Every case runs against a real server: what is under test is how the runtime streams, cancels
 * and times out a body, which a stubbed `fetch` does not do.
 */
import { gzipSync } from 'node:zlib';

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import {
  Effect,
  Either,
  pipe,
} from 'effect';

import { createHttpClient } from './client.js';
import { makeRequestsService, RequestsService } from './service.js';
import {
  type ApiResponse,
  type ErrorResponse,
  getTransportFailureKind,
  isErrorResponse,
  type RequestMetricsData,
  type SuccessResponse,
  TRANSPORT_FAILURE_CODE,
} from './types.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Every byte value once, in order: no UTF-8 decoding survives it unchanged. */
const EVERY_BYTE = Uint8Array.from({ length: 256 }, (_, index) => index);

/** A body that compresses, and whose bytes are not UTF-8 either. */
const BINARY = Uint8Array.from({ length: 64 * 1024 }, (_, index) => (index * 7) % 256);

const MIB = 1024 * 1024;

/** The two callbacks of a fixture's body stream that produce its chunks. */
interface BodySource {
  start?(controller: ReadableStreamDefaultController<Uint8Array>): void | Promise<void>;
  pull?(controller: ReadableStreamDefaultController<Uint8Array>): void | Promise<void>;
}

interface Fixture {
  baseUrl: string;
  /** Requests received, per path. */
  arrivals: Map<string, number>;
  /** The URL of every request received, query included. */
  urls: string[];
  /** Paths whose body stream the client cancelled. */
  cancelled: string[];
  stop(): void;
}

/**
 * Routes:
 * - `/every-byte` answers `EVERY_BYTE` as `application/octet-stream`; `/json` a JSON document
 * - `/gzip-binary` answers `BINARY` gzip-compressed
 * - `/stall` sends one event, then stays open without sending more
 * - `/flow` sends an event every 100 ms for as long as it is read
 * - `/pause` sends one event, and a second 20 ms later, then ends
 * - `/big` streams zeros 1 KiB at a time, without end
 * - `/not-found` answers 404 and `/unavailable` 503, each with a JSON body
 * - `/slow-headers` answers after 1 s; `/no-content` answers 204
 */
function startFixture(): Fixture {
  const arrivals = new Map<string, number>();
  const urls: string[] = [];
  const cancelled: string[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      arrivals.set(path, (arrivals.get(path) ?? 0) + 1);
      urls.push(req.url);
      const onCancel = () => {
        cancelled.push(path);
      };
      const eventStream = (source: BodySource) => new Response(
        new ReadableStream<Uint8Array>({ ...source, cancel: onCancel }),
        { headers: new Headers([['content-type', 'text/event-stream']]) },
      );

      switch (path) {
        case '/every-byte':
          return new Response(EVERY_BYTE, { headers: new Headers([['content-type', 'application/octet-stream']]) });
        case '/json':
          return Response.json({ id: 1, name: 'Ada' });
        case '/gzip-binary':
          return new Response(gzipSync(BINARY), {
            headers: new Headers([['content-type', 'application/octet-stream'], ['content-encoding', 'gzip']]),
          });
        case '/stall':
          return eventStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: 1\n\n'));
            },
          });
        case '/flow': {
          let sent = 0;

          return eventStream({
            async pull(controller) {
              if (sent > 0) {
                await Bun.sleep(100);
              }
              controller.enqueue(encoder.encode(`data: ${sent++}\n\n`));
            },
          });
        }
        case '/pause':
          return eventStream({
            async start(controller) {
              controller.enqueue(encoder.encode('data: 1\n\n'));
              await Bun.sleep(20);
              controller.enqueue(encoder.encode('data: 2\n\n'));
              controller.close();
            },
          });
        case '/big':
          return new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
              controller.enqueue(new Uint8Array(1024));
              await Bun.sleep(1);
            },
            cancel: onCancel,
          }), { headers: new Headers([['content-type', 'application/octet-stream']]) });
        case '/not-found':
          return Response.json({ reason: 'no such export' }, { status: 404 });
        case '/unavailable':
          return Response.json({ reason: 'maintenance' }, { status: 503 });
        case '/slow-headers':
          await Bun.sleep(1000);

          return new Response('late');
        case '/no-content':
          return new Response(null, { status: 204 });
        default:
          return new Response('unknown route', { status: 500 });
      }
    },
  });

  return {
    baseUrl: server.url.origin,
    arrivals,
    urls,
    cancelled,
    stop: () => server.stop(true),
  };
}

/**
 * A server that sends its status line and headers at once and holds the body back for `holdMs`.
 *
 * Raw TCP, because `Bun.serve` does not send the headers of a streamed body before its first chunk.
 */
function startHeldServer(holdMs: number, body: string): { baseUrl: string; stop(): void } {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const answered = new WeakSet<object>();
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket) {
        if (answered.has(socket)) {
          return;
        }
        answered.add(socket);
        socket.write(
          'HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n',
        );
        timers.push(setTimeout(() => {
          socket.write(`${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`);
          socket.end();
        }, holdMs));
      },
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${listener.port}`,
    stop() {
      timers.forEach(clearTimeout);
      listener.stop(true);
    },
  };
}

/**
 * A server that declares `Content-Length: contentLength` and then sends 64 KiB every 20 ms while
 * the connection stays open. Raw TCP, because `Bun.serve` sends a streamed body chunked.
 */
function startLengthServer(contentLength: number): { baseUrl: string; closed(): boolean; stop(): void } {
  let closed = false;
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket) {
        socket.write(
          'HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\n' +
          `content-length: ${contentLength}\r\n\r\n`,
        );
        const send = () => {
          if (!closed) {
            socket.write(new Uint8Array(64 * 1024));
            setTimeout(send, 20);
          }
        };
        send();
      },
      close() {
        closed = true;
      },
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${listener.port}`,
    closed: () => closed,
    stop: () => listener.stop(true),
  };
}

/** Wait until `condition` holds or `withinMs` passes; the caller asserts on what it observed. */
async function waitUntil(condition: () => boolean, withinMs: number): Promise<void> {
  const deadline = performance.now() + withinMs;
  while (!condition() && performance.now() < deadline) {
    await Bun.sleep(5);
  }
}

/** The success a call resolved with. A failed call has already rejected; this narrows the type. */
function successOf<T>(response: ApiResponse<T>): SuccessResponse<T> {
  if (!response.success) {
    throw new Error(`expected a success, got ${JSON.stringify(response)}`);
  }

  return response;
}

async function failureOf(effect: Effect.Effect<unknown, ErrorResponse>): Promise<ErrorResponse> {
  const outcome = await Effect.runPromise(Effect.either(effect));
  if (Either.isRight(outcome)) {
    throw new Error(`expected a failure, got ${JSON.stringify(outcome.right)}`);
  }

  return outcome.left;
}

/** The longest delay `setTimeout` keeps: a longer one fires after 1 ms. */
const MAX_TIMER_DELAY = 2 ** 31 - 1;

interface LongTimers {
  /** The delay of every timer still held, oldest first. */
  held(): number[];
  /** Every delay of `threshold` or more asked for, in order, whether held, fired or cleared. */
  requested(): number[];
  /** Run the oldest held timer, as if its delay had passed. */
  fire(): void;
  restore(): void;
}

/**
 * Hold every `setTimeout` of `threshold` ms or more instead of scheduling it, so a countdown of
 * weeks runs by hand; a shorter timer is scheduled as usual. Unlike a fake clock, it leaves the
 * delay as asked, so a test sees whether the code asked for more than the runtime keeps.
 */
function holdLongTimers(threshold: number): LongTimers {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const held = new Map<object, { delay: number; run: () => void }>();
  const requested: number[] = [];

  globalThis.setTimeout = ((handler: () => void, delay?: number) => {
    if (delay === undefined || delay < threshold) {
      return realSetTimeout(handler, delay);
    }
    requested.push(delay);
    const handle = {};
    held.set(handle, { delay, run: handler });

    return handle;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (!held.delete(handle as object)) {
      realClearTimeout(handle);
    }
  }) as typeof clearTimeout;

  return {
    held: () => [...held.values()].map((timer) => timer.delay),
    requested: () => [...requested],
    fire() {
      const [handle, timer] = [...held.entries()][0];
      held.delete(handle);
      timer.run();
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

/** What the next read of `reader` rejects with; fails the test when it resolves instead. */
async function readError(reader: { read(): Promise<unknown> }): Promise<unknown> {
  return await reader.read().then(
    (result) => {
      throw new Error(`expected the read to fail, got ${JSON.stringify(result)}`);
    },
    (error: unknown) => error,
  );
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

describe("responseType 'bytes'", () => {
  it('resolves a Uint8Array equal byte for byte to a body of every byte value, capped or not', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const bytes = successOf(await client.get<Uint8Array>('/every-byte', undefined, { responseType: 'bytes' }));
    const capped = successOf(
      await client.get<Uint8Array>('/every-byte', undefined, { responseType: 'bytes', maxResponseBytes: MIB }),
    );
    const text = successOf(await client.get<string>('/every-byte'));

    expect(bytes.result).toBeInstanceOf(Uint8Array);
    expect(bytes.result).toEqual(EVERY_BYTE);
    expect(capped.result).toEqual(EVERY_BYTE);
    expect(bytes.statusCode).toBe(200);
    expect(bytes.headers?.['content-type']).toBe('application/octet-stream');
    // 'auto', the default, still decodes it as UTF-8 text — which is what corrupts it
    expect(typeof text.result).toBe('string');
    expect(text.result).toContain('�');
  });

  it('hands a JSON body over as its bytes, unparsed', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const response = successOf(await client.get<Uint8Array>('/json', undefined, { responseType: 'bytes' }));

    expect(response.result).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(decoder.decode(response.result))).toEqual({ id: 1, name: 'Ada' });
  });

  it('undoes a content coding: fetch does without a cap, the client under one', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const native = successOf(await client.get<Uint8Array>('/gzip-binary', undefined, { responseType: 'bytes' }));
    const decoded = successOf(
      await client.get<Uint8Array>('/gzip-binary', undefined, { responseType: 'bytes', maxResponseBytes: MIB }),
    );

    expect(native.result).toEqual(BINARY);
    expect(native.headers?.['content-encoding']).toBe('gzip');
    expect(decoded.result).toEqual(BINARY);
    // They describe the compressed bytes, and the client decoded them itself
    expect(decoded.headers?.['content-encoding']).toBeUndefined();
    expect(decoded.headers?.['content-length']).toBeUndefined();
  });

  it('fails a body over maxResponseBytes with RESPONSE_TOO_LARGE, as under auto', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const failure = await failureOf(
      client.getEffect('/gzip-binary', undefined, { responseType: 'bytes', maxResponseBytes: 1024 }),
    );

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
    expect(failure.details?.limit).toBe(1024);
  });

  it('reads an error status as under auto: HTTP_ERROR with the parsed body', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const failure = await failureOf(client.getEffect('/not-found', undefined, { responseType: 'bytes' }));

    expect(failure.error).toBe('HTTP_ERROR');
    expect(failure.code).toBe(404);
    expect(failure.details?.details).toEqual({ reason: 'no such export' });
  });

  it('returns the bytes from req() and from RequestsService, which hand over result alone', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const fromReq = await client.req<Uint8Array>('GET', '/every-byte', undefined, { responseType: 'bytes' });
    const fromService = await Effect.runPromise(pipe(
      RequestsService,
      Effect.flatMap((service) => service.getEffect<Uint8Array>('/every-byte', undefined, { responseType: 'bytes' })),
      Effect.provide(makeRequestsService({ baseUrl: fixture.baseUrl })),
    ));

    expect(fromReq).toEqual(EVERY_BYTE);
    expect(fromService).toEqual(EVERY_BYTE);
  });

  it('resolves an answer without content with result undefined', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const noContent = successOf(await client.get('/no-content', undefined, { responseType: 'bytes' }));
    const head = successOf(await client.head('/every-byte', undefined, { responseType: 'bytes' }));

    expect(noContent.statusCode).toBe(204);
    expect(noContent.result).toBeUndefined();
    expect(head.result).toBeUndefined();
  });
});

describe("responseType 'stream'", () => {
  it('resolves at the headers while the body is still held back, and reads the body as it comes', async () => {
    const server = startHeldServer(500, 'late body');

    try {
      const client = createHttpClient({ baseUrl: server.baseUrl });

      const started = performance.now();
      const response = successOf(
        await client.get<ReadableStream<Uint8Array>>('/report', undefined, { responseType: 'stream' }),
      );
      const resolvedAfter = performance.now() - started;

      expect(resolvedAfter).toBeLessThan(200);
      expect(response.statusCode).toBe(200);
      expect(response.headers?.['content-type']).toBe('text/plain');
      expect(response.result).toBeInstanceOf(ReadableStream);
      expect(decoder.decode(await Bun.readableStreamToBytes(response.result))).toBe('late body');
      expect(performance.now() - started).toBeGreaterThanOrEqual(450);
    } finally {
      server.stop();
    }
  });

  it('errors a stream that stalls after its first chunk with TIMEOUT_ERROR after timeout, and cancels the upstream', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 300 });

    const response = successOf(
      await client.get<ReadableStream<Uint8Array>>('/stall', undefined, { responseType: 'stream' }),
    );
    const reader = response.result.getReader();
    const first = await reader.read();
    const waitStarted = performance.now();
    const error = await readError(reader);
    const waited = performance.now() - waitStarted;

    expect(decoder.decode(first.value)).toBe('data: 1\n\n');
    expect(waited).toBeGreaterThanOrEqual(280);
    expect(waited).toBeLessThan(1000);
    // The stream errors with the ErrorResponse a timed-out body read produces
    expect(isErrorResponse(error)).toBe(true);
    if (isErrorResponse(error)) {
      expect(error.error).toBe('TIMEOUT_ERROR');
      expect(error.code).toBe(TRANSPORT_FAILURE_CODE);
      expect(error.details?.phase).toBe('body');
      expect(error.details?.statusCode).toBe(200);
      expect(getTransportFailureKind(error)).toBe('timeout');
    }
    await waitUntil(() => fixture.cancelled.includes('/stall'), 1000);
    expect(fixture.cancelled).toContain('/stall');
  });

  it('reads a stream whose chunks keep coming every 100 ms for 1 s under timeout 300', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 300 });

    const response = successOf(
      await client.get<ReadableStream<Uint8Array>>('/flow', undefined, { responseType: 'stream' }),
    );
    const reader = response.result.getReader();
    const events: string[] = [];
    const started = performance.now();
    while (performance.now() - started < 1000) {
      const { value } = await reader.read();
      events.push(decoder.decode(value));
    }
    await reader.cancel();

    // A whole-response deadline would have cut it at 300 ms, after three events
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events[0]).toBe('data: 0\n\n');
    // Cancelling the stream lets the connection go
    await waitUntil(() => fixture.cancelled.includes('/flow'), 1000);
    expect(fixture.cancelled).toContain('/flow');
  });

  it('settles a read still pending when the caller cancels, and lets the connection go', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 5000 });

    const response = successOf(
      await client.get<ReadableStream<Uint8Array>>('/stall', undefined, { responseType: 'stream' }),
    );
    const reader = response.result.getReader();
    await reader.read();
    const pending = reader.read();
    await Bun.sleep(20);
    await reader.cancel();

    expect((await pending).done).toBe(true);
    await waitUntil(() => fixture.cancelled.includes('/stall'), 1000);
    expect(fixture.cancelled).toContain('/stall');
  });

  it('does not count the time the caller spends between reads', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 100 });

    const response = successOf(
      await client.get<ReadableStream<Uint8Array>>('/pause', undefined, { responseType: 'stream' }),
    );
    const reader = response.result.getReader();
    const first = await reader.read();
    // Longer than the timeout, spent by the caller rather than waiting on the upstream
    await Bun.sleep(300);
    const second = await reader.read();
    const end = await reader.read();

    expect(decoder.decode(first.value)).toBe('data: 1\n\n');
    expect(decoder.decode(second.value)).toBe('data: 2\n\n');
    expect(end.done).toBe(true);
  });

  it('errors with RESPONSE_TOO_LARGE once the count exceeds maxResponseBytes, and cancels the upstream', async () => {
    const limit = 10_000;
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: limit });

    const response = successOf(
      await client.get<ReadableStream<Uint8Array>>('/big', undefined, { responseType: 'stream' }),
    );
    const reader = response.result.getReader();
    let handedOut = 0;
    let error: unknown;
    while (error === undefined) {
      const outcome: unknown = await reader.read().then(
        (result) => {
          handedOut += result.value?.byteLength ?? 0;

          return undefined;
        },
        (failure: unknown) => failure,
      );
      error = outcome;
    }

    expect(isErrorResponse(error)).toBe(true);
    if (isErrorResponse(error)) {
      expect(error.error).toBe('RESPONSE_TOO_LARGE');
      expect(error.code).toBe(200);
      expect(error.details?.limit).toBe(limit);
      expect(error.details?.statusCode).toBe(200);
      expect(error.details?.received).toBeGreaterThan(limit);
    }
    // The chunk that crossed the limit is not handed out
    expect(handedOut).toBeLessThanOrEqual(limit);
    await waitUntil(() => fixture.cancelled.includes('/big'), 1000);
    expect(fixture.cancelled).toContain('/big');
  });

  it('refuses a declared Content-Length over maxResponseBytes before resolving', async () => {
    const server = startLengthServer(10 * MIB);

    try {
      const client = createHttpClient({ baseUrl: server.baseUrl, maxResponseBytes: MIB });

      const failure = await failureOf(client.getEffect('/download', undefined, { responseType: 'stream' }));
      await waitUntil(() => server.closed(), 1000);

      expect(failure.error).toBe('RESPONSE_TOO_LARGE');
      expect(failure.details).toEqual({
        limit: MIB, received: 0, statusCode: 200, contentLength: 10 * MIB,
      });
      expect(server.closed()).toBe(true);
    } finally {
      server.stop();
    }
  });

  it('streams a compressed body decoded: by fetch without a cap, by the client under one', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const native = successOf(
      await client.get<ReadableStream<Uint8Array>>('/gzip-binary', undefined, { responseType: 'stream' }),
    );
    const nativeBytes = await Bun.readableStreamToBytes(native.result);
    const decoded = successOf(await client.get<ReadableStream<Uint8Array>>('/gzip-binary', undefined, {
      responseType: 'stream',
      maxResponseBytes: MIB,
    }));
    const decodedBytes = await Bun.readableStreamToBytes(decoded.result);

    expect(nativeBytes).toEqual(BINARY);
    expect(native.headers?.['content-encoding']).toBe('gzip');
    expect(decodedBytes).toEqual(BINARY);
    expect(decoded.headers?.['content-encoding']).toBeUndefined();
    expect(decoded.headers?.['content-length']).toBeUndefined();
  });

  it('rejects a 404 with HTTP_ERROR, code 404 and the body in details.details', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const failure = await failureOf(client.getEffect('/not-found', undefined, { responseType: 'stream' }));

    expect(failure.error).toBe('HTTP_ERROR');
    expect(failure.code).toBe(404);
    expect(failure.details?.details).toEqual({ reason: 'no such export' });
    expect(failure.details?.headers).toHaveProperty('content-type');
  });

  it('retries an error status, which fails before a stream is handed over, and never a stream', async () => {
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      timeout: 100,
      retries: {
        max: 2, retryOn: [503], retryOnTimeout: true, delay: 1,
      },
    });

    const failure = await failureOf(client.getEffect('/unavailable', undefined, { responseType: 'stream' }));
    const stalled = successOf(
      await client.get<ReadableStream<Uint8Array>>('/stall', undefined, { responseType: 'stream' }),
    );
    const reader = stalled.result.getReader();
    await reader.read();
    const error = await readError(reader);

    expect(failure.error).toBe('HTTP_ERROR');
    expect(failure.retryCount).toBe(2);
    expect(fixture.arrivals.get('/unavailable')).toBe(3);
    // The timeout hit the stream after the call had resolved: retryOnTimeout cannot replay it
    expect(isErrorResponse(error) && error.error).toBe('TIMEOUT_ERROR');
    expect(fixture.arrivals.get('/stall')).toBe(1);
  });

  it('fails TIMEOUT_ERROR when the headers do not arrive within timeout', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout: 100 });

    const failure = await failureOf(client.getEffect('/slow-headers', undefined, { responseType: 'stream' }));

    expect(failure.error).toBe('TIMEOUT_ERROR');
    expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
    expect(failure.details?.phase).toBeUndefined();
  });

  it('reads a stream under a timeout past 2^31 - 1 ms, as auto does', async () => {
    // `AbortSignal.timeout`, which bounds 'auto', takes up to 2^53 - 1 ms. The stream's countdown
    // was one `setTimeout`, which fired after 1 ms past 2^31 - 1: the call failed at the headers.
    for (const timeout of [2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout });

      const streamed = successOf(
        await client.get<ReadableStream<Uint8Array>>('/pause', undefined, { responseType: 'stream' }),
      );
      const whole = successOf(await client.get<string>('/pause'));

      expect(decoder.decode(await Bun.readableStreamToBytes(streamed.result))).toBe('data: 1\n\ndata: 2\n\n');
      expect(whole.result).toBe('data: 1\n\ndata: 2\n\n');
    }
  });

  it('counts a timeout past 2^31 - 1 ms in stretches, and errors a stalled stream once all of it has passed', async () => {
    const timeout = MAX_TIMER_DELAY + 2 ** 30;
    const timers = holdLongTimers(2 ** 29);

    try {
      const client = createHttpClient({ baseUrl: fixture.baseUrl, timeout });
      const response = successOf(
        await client.get<ReadableStream<Uint8Array>>('/stall', undefined, { responseType: 'stream' }),
      );
      const reader = response.result.getReader();
      await reader.read();
      const pending = reader.read().then(() => 'read', (error: unknown) => error);
      await waitUntil(() => timers.held().length === 1, 1000);

      // The wait for the next chunk: the first stretch is the longest the runtime keeps
      expect(timers.held()).toEqual([MAX_TIMER_DELAY]);
      timers.fire();
      // ...and when it passes, the countdown goes on for the rest rather than erroring the stream
      expect(timers.held()).toEqual([timeout - MAX_TIMER_DELAY]);
      expect(await Promise.race([pending, Bun.sleep(20).then(() => 'waiting')])).toBe('waiting');

      timers.fire();
      const error = await pending;

      expect(isErrorResponse(error) && error.error).toBe('TIMEOUT_ERROR');
      expect(fixture.arrivals.get('/stall')).toBe(1);
      // No stretch asked for more than the runtime keeps: the headers' wait, the first read's, this one's
      expect(Math.max(...timers.requested())).toBe(MAX_TIMER_DELAY);
    } finally {
      timers.restore();
    }
  });

  it('reads a two-argument { responseType } as config, not as query data', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const response = successOf(await client.get<ReadableStream<Uint8Array>>('/every-byte', { responseType: 'stream' }));

    expect(await Bun.readableStreamToBytes(response.result)).toEqual(EVERY_BYTE);
    expect(fixture.urls.at(-1)).toBe(`${fixture.baseUrl}/every-byte`);

    // The whole record is config then, so its other keys are not sent either
    await client.get('/every-byte', { q: 'cats', responseType: 'json' });
    expect(fixture.urls.at(-1)).toBe(`${fixture.baseUrl}/every-byte`);

    // A query that really carries such a parameter takes the three-argument form
    await client.get('/every-byte', { q: 'cats', responseType: 'json' }, {});
    expect(fixture.urls.at(-1)).toBe(`${fixture.baseUrl}/every-byte?q=cats&responseType=json`);
  });

  it('records the time to the headers in the metrics', async () => {
    const server = startHeldServer(500, 'late body');
    const records: RequestMetricsData[] = [];

    try {
      const client = createHttpClient({ baseUrl: server.baseUrl, metricsSink: (data) => records.push(data) });

      const response = successOf(
        await client.get<ReadableStream<Uint8Array>>('/report', undefined, { responseType: 'stream' }),
      );
      await Bun.readableStreamToBytes(response.result);

      expect(records).toHaveLength(1);
      expect(records[0].statusCode).toBe(200);
      expect(records[0].duration).toBeLessThan(200);
    } finally {
      server.stop();
    }
  });

  it('resolves an answer without content with result undefined', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const noContent = successOf(await client.get('/no-content', undefined, { responseType: 'stream' }));
    const head = successOf(await client.head('/every-byte', undefined, { responseType: 'stream' }));

    expect(noContent.result).toBeUndefined();
    expect(head.result).toBeUndefined();
  });
});
