/**
 * `maxResponseBytes` bounds a response body by its DECODED size, counted while it is read, for a
 * success and an error status alike.
 *
 * The body used to be read whole with `response.text()`, whatever its size, and an error status's
 * body was copied whole into `details.details`. A cap cannot be put on top of that: Bun's own
 * decompression inflates a whole compressed chunk before a reader sees it, so a 130 KB gzip of
 * zeros reached a reader that wanted 1 MiB as one 130 MB chunk. A capped request is therefore
 * fetched raw and decoded by the client.
 *
 * Every case runs against a real server, because what is under test is how the runtime streams,
 * decompresses and cancels a body — a stubbed `fetch` does none of it.
 */
import {
  brotliCompressSync,
  deflateSync,
  gzipSync,
} from 'node:zlib';

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
  type ApiResponse,
  type ErrorResponse,
  getTransportFailureKind,
  OneBunBaseError,
  type SuccessResponse,
  TRANSPORT_FAILURE_CODE,
} from './types.js';

const MIB = 1024 * 1024;
const encoder = new TextEncoder();

/** A body whose bytes differ from its UTF-8 misreading: multi-byte characters, and enough to compress. */
const ORIGINAL_TEXT = 'Grüße, 世界 — ☃ '.repeat(500);
const ORIGINAL_BYTES = encoder.encode(ORIGINAL_TEXT);

/**
 * 128 MiB of zeros as gzip: 128 members of one 1 MiB member each, which `gzip` decodes back to back.
 * About 130 KB on the wire, built without ever holding the 128 MiB.
 */
function gzipBomb(): Uint8Array {
  const member = gzipSync(new Uint8Array(MIB));
  const bomb = new Uint8Array(member.byteLength * 128);
  for (let i = 0; i < 128; i++) {
    bomb.set(member, i * member.byteLength);
  }

  return bomb;
}

const BOMB = gzipBomb();

/**
 * A stream that hands `bytes` out 1 KiB per pull, pausing between pulls, and records its
 * `cancel()`. With `stallAtEnd` it then stays open without sending anything more.
 */
function throttled(bytes: Uint8Array, onCancel: () => void, stallAtEnd = false): ReadableStream<Uint8Array> {
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= bytes.byteLength) {
        if (stallAtEnd) {
          return await new Promise<void>(() => undefined);
        }

        controller.close();

        return;
      }

      controller.enqueue(bytes.subarray(offset, offset + 1024));
      offset += 1024;
      await Bun.sleep(1);
    },
    cancel() {
      onCancel();
    },
  });
}

/** `ORIGINAL_BYTES` under each content coding the client decodes, plus the forms servers really send. */
const ENCODED: Record<string, { encoding: string; body: Uint8Array }> = {
  gzip: { encoding: 'gzip', body: gzipSync(ORIGINAL_BYTES) },
  deflate: { encoding: 'deflate', body: deflateSync(ORIGINAL_BYTES) },
  br: { encoding: 'br', body: brotliCompressSync(ORIGINAL_BYTES) },
  zstd: { encoding: 'zstd', body: Bun.zstdCompressSync(ORIGINAL_BYTES) },
  // Raw deflate under `deflate`, which Bun's own fetch accepts too
  rawDeflate: { encoding: 'deflate', body: Bun.deflateSync(ORIGINAL_BYTES) },
  // Two codings, applied in the order listed: deflate first, then gzip
  chained: { encoding: 'deflate, gzip', body: gzipSync(deflateSync(ORIGINAL_BYTES)) },
};

/** What some servers append after the end of a compressed body. */
const TRAILING_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

interface Fixture {
  baseUrl: string;
  /** Requests received, per path. */
  arrivals: Map<string, number>;
  /** The `Accept-Encoding` each request arrived with, per path; `null` when it had none. */
  acceptEncoding: Map<string, string | null>;
  /** Paths whose body stream the client cancelled. */
  cancelled: string[];
  stop(): void;
}

/**
 * Routes:
 * - `/plain` answers `ORIGINAL_TEXT` uncompressed, `/gzip-native` gzip-compressed
 * - `/encoded/<name>` answers `ENCODED[name]`; `/moved` redirects to `/encoded/gzip`
 * - `/bomb` streams the 128 MiB gzip bomb 1 KiB at a time
 * - `/stall-gzip` sends a gzip header, then stalls
 * - `/x-foo`, `/corrupt-gzip`, `/empty-gzip` answer an unknown coding, a broken body, an empty one
 * - `/trailing-gzip` answers a 503 whose gzip body is followed by five bytes past its end
 * - `/json-500/<bytes>` answers a 500 whose JSON body is about that many bytes
 * - `/gzip-500` answers a 500 whose JSON body is gzip-compressed
 */
function startFixture(): Fixture {
  const arrivals = new Map<string, number>();
  const acceptEncoding = new Map<string, string | null>();
  const cancelled: string[] = [];

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      arrivals.set(path, (arrivals.get(path) ?? 0) + 1);
      acceptEncoding.set(path, req.headers.get('accept-encoding'));
      const onCancel = () => cancelled.push(path);
      const text = (body: string | Uint8Array | ReadableStream<Uint8Array>, encoding: string) => new Response(body, {
        headers: new Headers([['content-type', 'text/plain'], ['content-encoding', encoding]]),
      });

      if (path === '/plain') {
        return new Response(ORIGINAL_TEXT, { headers: new Headers([['content-type', 'text/plain']]) });
      }

      if (path === '/gzip-native') {
        return text(ENCODED.gzip.body, 'gzip');
      }

      if (path.startsWith('/encoded/')) {
        const { encoding, body } = ENCODED[path.slice('/encoded/'.length)];

        return text(body, encoding);
      }

      if (path === '/moved') {
        return new Response(null, { status: 302, headers: new Headers([['location', '/encoded/gzip']]) });
      }

      if (path === '/bomb') {
        return text(throttled(BOMB, onCancel), 'gzip');
      }

      if (path === '/stall-gzip') {
        return text(throttled(ENCODED.gzip.body.subarray(0, 10), onCancel, true), 'gzip');
      }

      if (path === '/x-foo') {
        return text('abc', 'x-foo');
      }

      if (path === '/corrupt-gzip') {
        return text(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 'gzip');
      }

      if (path === '/empty-gzip') {
        return text(new Uint8Array(0), 'gzip');
      }

      if (path === '/trailing-gzip') {
        const body = new Uint8Array(ENCODED.gzip.body.byteLength + TRAILING_BYTES.byteLength);
        body.set(ENCODED.gzip.body);
        body.set(TRAILING_BYTES, ENCODED.gzip.body.byteLength);

        return new Response(body, {
          status: 503,
          headers: new Headers([['content-type', 'text/plain'], ['content-encoding', 'gzip']]),
        });
      }

      if (path === '/gzip-500') {
        return new Response(gzipSync(JSON.stringify({ error: 'db down' })), {
          status: 500,
          headers: new Headers([['content-type', 'application/json'], ['content-encoding', 'gzip']]),
        });
      }

      if (path.startsWith('/json-500/')) {
        const size = Number(path.slice('/json-500/'.length));

        return new Response(JSON.stringify({ trace: 'x'.repeat(size) }), {
          status: 500,
          headers: new Headers([['content-type', 'application/json']]),
        });
      }

      return new Response('not found', { status: 404 });
    },
  });

  return {
    baseUrl: server.url.origin,
    arrivals,
    acceptEncoding,
    cancelled,
    stop: () => server.stop(true),
  };
}

/**
 * A server that declares `Content-Length: contentLength` and then produces the body 64 KiB per
 * `pull()`, one every 20 ms, for as long as the connection stays open.
 *
 * Raw TCP, because `Bun.serve` replaces the `Content-Length` of a streamed body with chunked
 * framing, and a static body has no pull to count.
 */
function startLengthServer(contentLength: number): {
  baseUrl: string;
  pulls(): number;
  closed(): boolean;
  stop(): void;
} {
  let pulls = 0;
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
        const pull = () => {
          if (closed) {
            return;
          }
          pulls++;
          socket.write(new Uint8Array(64 * 1024));
          setTimeout(pull, 20);
        };
        pull();
      },
      close() {
        closed = true;
      },
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${listener.port}`,
    pulls: () => pulls,
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

describe('without maxResponseBytes', () => {
  it('leaves the request to fetch: its own Accept-Encoding, its own decompression, the wire headers', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const response = successOf(await client.get('/gzip-native'));

    expect(fixture.acceptEncoding.get('/gzip-native')).toBe('gzip, deflate, br, zstd');
    expect(response.result).toBe(ORIGINAL_TEXT);
    // fetch keeps both on a body it decompressed
    expect(response.headers?.['content-encoding']).toBe('gzip');
    expect(response.headers?.['content-length']).toBe(String(ENCODED.gzip.body.byteLength));
  });
});

describe('with maxResponseBytes', () => {
  it('offers the codings it decodes, unless the caller chose an Accept-Encoding', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB });

    await client.get('/plain');
    // eslint-disable-next-line @typescript-eslint/naming-convention
    await client.get('/encoded/gzip', undefined, { headers: { 'accept-encoding': 'gzip' } });

    // `decompress: false` alone would send none, and the server would answer uncompressed
    expect(fixture.acceptEncoding.get('/plain')).toBe('gzip, deflate, br, zstd');
    expect(fixture.acceptEncoding.get('/encoded/gzip')).toBe('gzip');
  });

  it('stops a 128 MiB gzip bomb at the cap, in bounded memory, and cancels the upstream stream', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB });

    Bun.gc(true);
    const rssBefore = process.memoryUsage().rss;
    const failure = await failureOf(client.getEffect('/bomb'));
    const rssGrowth = process.memoryUsage().rss - rssBefore;

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
    expect(failure.code).toBe(200);
    expect(failure.details?.limit).toBe(MIB);
    expect(failure.details?.statusCode).toBe(200);
    expect(failure.details?.received).toBeGreaterThan(MIB);
    expect(failure.details?.received).toBeLessThan(2 * MIB);
    // Bun's own decompression grew the process by 139 MB for the same read
    expect(rssGrowth).toBeLessThan(32 * MIB);
    await waitUntil(() => fixture.cancelled.includes('/bomb'), 1000);
    expect(fixture.cancelled).toContain('/bomb');
  });

  it('refuses a body whose Content-Length exceeds the cap before reading it', async () => {
    const server = startLengthServer(10 * MIB);

    try {
      const client = createHttpClient({ baseUrl: server.baseUrl, maxResponseBytes: MIB });

      const failure = await failureOf(client.getEffect('/download'));
      await waitUntil(() => server.closed(), 1000);

      expect(failure.error).toBe('RESPONSE_TOO_LARGE');
      expect(failure.details).toEqual({
        limit: MIB, received: 0, statusCode: 200, contentLength: 10 * MIB,
      });
      expect(server.closed()).toBe(true);
      expect(server.pulls()).toBeLessThanOrEqual(1);
    } finally {
      server.stop();
    }
  });

  it('bounds an error status the same way, and keeps its body out of the error', async () => {
    const limit = 16 * 1024;
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: limit });

    const failure = await failureOf(client.getEffect('/json-500/262144'));

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
    expect(failure.code).toBe(500);
    expect(failure.details?.statusCode).toBe(500);
    expect(failure.details?.limit).toBe(limit);
    expect(JSON.stringify(failure).length).toBeLessThanOrEqual(limit);
    expect(JSON.stringify(failure)).not.toContain('xxxx');

    // The error `req()` throws, which the default exception filter would serialize
    const thrown = await client.req('GET', '/json-500/262144').catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(OneBunBaseError);
    const serialized = JSON.stringify((thrown as OneBunBaseError).toErrorResponse());
    expect(serialized).toContain('RESPONSE_TOO_LARGE');
    expect(serialized.length).toBeLessThanOrEqual(limit);
  });

  it('reads an error status under the cap into details.details as before', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB, retries: { max: 0 } });

    const failure = await failureOf(client.getEffect('/json-500/10'));

    expect(failure.error).toBe('HTTP_ERROR');
    expect(failure.code).toBe(500);
    expect(failure.details?.details).toEqual({ trace: 'x'.repeat(10) });
  });

  it('leaves content-encoding and content-length out of an HTTP_ERROR\'s details.headers once it decoded the body', async () => {
    const capped = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB, retries: { max: 0 } });
    const uncapped = createHttpClient({ baseUrl: fixture.baseUrl, retries: { max: 0 } });

    const decoded = await failureOf(capped.getEffect('/gzip-500'));
    const native = await failureOf(uncapped.getEffect('/gzip-500'));

    expect(decoded.error).toBe('HTTP_ERROR');
    expect(decoded.details?.details).toEqual({ error: 'db down' });
    // The same two a success leaves out: they describe the compressed bytes, not details.details
    expect(decoded.details?.headers).toHaveProperty('content-type', 'application/json');
    expect(decoded.details?.headers).not.toHaveProperty('content-encoding');
    expect(decoded.details?.headers).not.toHaveProperty('content-length');
    expect(native.details?.details).toEqual({ error: 'db down' });
    expect(native.details?.headers).toHaveProperty('content-encoding', 'gzip');
    expect(native.details?.headers).toHaveProperty('content-length');
  });

  it('fails a compressed body followed by trailing bytes, which fetch drops, and does not replay the 503', async () => {
    const capped = createHttpClient({
      baseUrl: fixture.baseUrl,
      maxResponseBytes: MIB,
      retries: { max: 3, retryOn: [503], delay: 1 },
    });
    const uncapped = createHttpClient({ baseUrl: fixture.baseUrl, retries: { max: 0 } });

    const decoded = await failureOf(capped.getEffect('/trailing-gzip'));
    const arrivalsCapped = fixture.arrivals.get('/trailing-gzip');
    const native = await failureOf(uncapped.getEffect('/trailing-gzip'));

    // `DecompressionStream` rejects bytes past the end of the compressed stream
    expect(decoded.error).toBe('RESPONSE_DECODE_ERROR');
    expect(decoded.code).toBe(503);
    expect(decoded.details?.reason).toBe('corrupt-body');
    expect(decoded.retryCount).toBe(0);
    expect(arrivalsCapped).toBe(1);
    // `fetch` drops them, so the same 503 is an HTTP_ERROR with the whole text
    expect(native.error).toBe('HTTP_ERROR');
    expect(native.details?.details).toBe(ORIGINAL_TEXT);
  });

  it('never retries RESPONSE_TOO_LARGE, whatever retryOn lists', async () => {
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      maxResponseBytes: 1024,
      retries: { max: 3, retryOn: [500], delay: 1 },
    });

    const failure = await failureOf(client.getEffect('/json-500/4096'));

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
    expect(failure.retryCount).toBe(0);
    expect(fixture.arrivals.get('/json-500/4096')).toBe(1);
  });

  it.each(['gzip', 'deflate', 'br', 'zstd', 'rawDeflate', 'chained'])(
    'decodes a %s body under the cap to the original bytes',
    async (name) => {
      const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB });

      const response = successOf(await client.get(`/encoded/${name}`));

      expect(response.result).toBe(ORIGINAL_TEXT);
      expect(response.statusCode).toBe(200);
      // They describe the compressed bytes, and the client decoded them itself
      expect(response.headers?.['content-encoding']).toBeUndefined();
      expect(response.headers?.['content-length']).toBeUndefined();
      expect(response.headers?.['content-type']).toBe('text/plain');
    },
  );

  it('decodes the final body of a redirect chain, and leaves a HEAD answer\'s headers as they arrived', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB });

    const moved = successOf(await client.get('/moved'));
    const head = successOf(await client.head('/encoded/gzip'));

    expect(moved.result).toBe(ORIGINAL_TEXT);
    expect(fixture.acceptEncoding.get('/encoded/gzip')).toBe('gzip, deflate, br, zstd');
    // Nothing was decoded, so nothing is left out
    expect(head.result).toBeUndefined();
    expect(head.headers?.['content-encoding']).toBe('gzip');
  });

  it('counts the decoded size, not the compressed one', async () => {
    // The gzip body is far below the cap on the wire, and above it once decoded
    const cap = ORIGINAL_BYTES.byteLength - 1;
    expect(ENCODED.gzip.body.byteLength).toBeLessThan(cap);
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: cap });

    const failure = await failureOf(client.getEffect('/encoded/gzip'));

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
    expect(failure.details?.received).toBe(ORIGINAL_BYTES.byteLength);
  });

  it('fails a content coding it cannot decode with RESPONSE_DECODE_ERROR, sent once', async () => {
    const client = createHttpClient({
      baseUrl: fixture.baseUrl,
      maxResponseBytes: MIB,
      // `code` is the 200 that arrived: listing it proves the name, not the code, stops the retry
      retries: { max: 3, retryOn: [200], delay: 1 },
    });

    const failure = await failureOf(client.getEffect('/x-foo'));

    expect(failure.error).toBe('RESPONSE_DECODE_ERROR');
    expect(failure.code).toBe(200);
    expect(failure.details).toEqual({ reason: 'unsupported-encoding', encoding: 'x-foo', statusCode: 200 });
    expect(fixture.arrivals.get('/x-foo')).toBe(1);
  });

  it('fails a body the decoder rejects with RESPONSE_DECODE_ERROR', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB });

    const failure = await failureOf(client.getEffect('/corrupt-gzip'));

    expect(failure.error).toBe('RESPONSE_DECODE_ERROR');
    expect(failure.details?.reason).toBe('corrupt-body');
    expect(failure.details?.encoding).toBe('gzip');
    expect(fixture.arrivals.get('/corrupt-gzip')).toBe(1);
  });

  it('reads an empty body as empty whatever its Content-Encoding says, as fetch does', async () => {
    const capped = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB });
    const uncapped = createHttpClient({ baseUrl: fixture.baseUrl });

    const response = await capped.get('/empty-gzip');

    expect(response.success && response.result).toBe('');
    expect((await uncapped.get('/empty-gzip')).success).toBe(true);
  });

  it('still reports a body that stalls past the timeout as a TIMEOUT_ERROR of the body phase', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB, timeout: 100 });

    const failure = await failureOf(client.getEffect('/stall-gzip'));

    expect(failure.error).toBe('TIMEOUT_ERROR');
    expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
    expect(failure.details?.phase).toBe('body');
    expect(failure.details?.statusCode).toBe(200);
    expect(getTransportFailureKind(failure)).toBe('timeout');
  });

  it('cancels the upstream stream when the Effect reading a capped body is interrupted', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB, timeout: 10_000 });

    const outcome = await Effect.runPromise(
      Effect.either(Effect.timeout(client.getEffect('/stall-gzip'), '100 millis')),
    );

    expect(Either.isLeft(outcome) && Cause.isTimeoutException(outcome.left)).toBe(true);
    await waitUntil(() => fixture.cancelled.includes('/stall-gzip'), 1000);
    expect(fixture.cancelled).toContain('/stall-gzip');
  });
});

describe('which cap a request runs under', () => {
  it('takes the request\'s own cap over the client\'s, and Infinity lifts the client\'s', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: 16 });

    const refused = await failureOf(client.getEffect('/plain'));
    const lifted = await client.get('/plain', undefined, { maxResponseBytes: Number.POSITIVE_INFINITY });
    const tighter = await failureOf(
      createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: MIB })
        .getEffect('/plain', undefined, { maxResponseBytes: 16 }),
    );

    expect(refused.details?.limit).toBe(16);
    expect(lifted.success && lifted.result).toBe(ORIGINAL_TEXT);
    expect(tighter.details?.limit).toBe(16);
  });

  it('reads a request that lifts the cap with Infinity as without one, decompressed by fetch', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: 16 });
    const unlimited = { maxResponseBytes: Number.POSITIVE_INFINITY };

    const gzip = successOf(await client.get('/gzip-native', undefined, unlimited));
    const unknown = successOf(await client.get('/x-foo', undefined, unlimited));

    expect(gzip.result).toBe(ORIGINAL_TEXT);
    // Only fetch's own decompression keeps both: the client's decoder leaves them out
    expect(gzip.headers?.['content-encoding']).toBe('gzip');
    expect(gzip.headers?.['content-length']).toBe(String(ENCODED.gzip.body.byteLength));
    // The client's decoder fails this with RESPONSE_DECODE_ERROR; fetch hands it over as it is
    expect(unknown.result).toBe('abc');
  });

  it('reads a two-argument { maxResponseBytes } as config, not as query data', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl });

    const failure = await failureOf(client.getEffect('/plain', { maxResponseBytes: 16 }));

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
  });

  it('refuses every byte under a NaN cap rather than letting every body through', async () => {
    const client = createHttpClient({ baseUrl: fixture.baseUrl, maxResponseBytes: Number.NaN });

    const failure = await failureOf(client.getEffect('/encoded/gzip'));

    expect(failure.error).toBe('RESPONSE_TOO_LARGE');
  });
});
