/**
 * Reading a response body under `maxResponseBytes`: the client undoes the content coding itself
 * and counts the decoded bytes as they arrive.
 *
 * `fetch` cannot do it. Left to decompress by itself, Bun inflates a whole compressed chunk before
 * the reader sees any of it: measured on Bun 1.4.2, a 128 MiB gzip of zeros (130 KB on the wire)
 * handed a reader that stopped after 1 MiB a 130 MB first chunk, and the process grew by 139 MB.
 * Fetched with `decompress: false` and decoded through `DecompressionStream`, the same body grew
 * it by 4 MB. So a capped request asks for the raw bytes, and this module decodes them.
 *
 * The same reader backs a `responseType: 'stream'` result ({@link bodyStream}), capped or not: the
 * stream counts what it hands out, and reports each wait on the upstream so that the client can
 * bound it.
 *
 * Mechanism only: every failure is a {@link BodyReadFailure}, and the client decides what it is
 * reported as — whether the attempt's signal fired first included.
 */
import {
  Effect,
  Exit,
  pipe,
} from 'effect';

/**
 * The content codings the client decodes, lower-cased, and the `DecompressionStream` format for
 * each. `br` is `'brotli'` there: `new DecompressionStream('br')` throws.
 */
const DECODER_FORMATS: ReadonlyMap<string, Bun.CompressionFormat> = new Map<string, Bun.CompressionFormat>([
  ['gzip', 'gzip'],
  ['x-gzip', 'gzip'],
  ['deflate', 'deflate'],
  ['br', 'brotli'],
  ['zstd', 'zstd'],
]);

/** What a capped request offers in `Accept-Encoding`, in the order Bun's own `fetch` offers them. */
const OFFERED_CODINGS: readonly string[] = ['gzip', 'deflate', 'br', 'zstd'];

/** Whether this runtime's `DecompressionStream` knows `format`. */
const canDecode = (format: Bun.CompressionFormat): boolean => {
  try {
    new DecompressionStream(format);

    return true;
  } catch {
    return false;
  }
};

let offeredAcceptEncoding: string | undefined;

/**
 * The `Accept-Encoding` a capped request sends when its caller set none.
 *
 * `fetch` offers `gzip, deflate, br, zstd` by itself, and offers nothing once it is told not to
 * decompress — the server would then answer uncompressed, and a request that set a cap would cost
 * more bandwidth than one that did not. So a capped request offers the same set, narrowed to what
 * this runtime can decode: all four on Bun 1.4.
 *
 * @internal
 */
export const cappedAcceptEncoding = (): string => {
  offeredAcceptEncoding ??= OFFERED_CODINGS
    .filter((coding) => {
      const format = DECODER_FORMATS.get(coding);

      return format !== undefined && canDecode(format);
    })
    .join(', ') || 'identity';

  return offeredAcceptEncoding;
};

/**
 * The content codings a response's body carries, lower-cased, in the order they were applied
 * (RFC 9110 §8.4), `identity` left out. Empty for a body sent as it is.
 *
 * @internal
 */
export const contentCodings = (headers: Headers): string[] =>
  (headers.get('content-encoding') ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '' && token !== 'identity');

/**
 * The decoder format for each of `codings`, in the order they are undone — the reverse of the
 * order they were applied — or the first coding the client has no decoder for.
 */
const decodingPlan = (codings: string[]): { formats: Bun.CompressionFormat[] } | { unsupported: string } => {
  const formats: Bun.CompressionFormat[] = [];

  for (const coding of [...codings].reverse()) {
    const format = DECODER_FORMATS.get(coding);

    if (format === undefined) {
      return { unsupported: coding };
    }

    formats.push(format);
  }

  return { formats };
};

/**
 * Why a capped body could not be read.
 *
 * @internal
 */
export type BodyReadFailure =
  /**
   * The body is larger than the cap. `received` is how many decoded bytes had been counted when
   * the reading stopped; for a body refused on its `Content-Length` alone it is `0`, and
   * `contentLength` holds the declared size.
   */
  | { reason: 'too-large'; received: number; contentLength?: number }
  /** A content coding the client cannot decode. Nothing was read. */
  | { reason: 'unsupported-encoding'; encoding: string }
  /**
   * The body arrived, but the decoder rejected it: corrupt, cut short, or followed by bytes after
   * the end of the compressed stream. `DecompressionStream` rejects such trailing bytes, which
   * `fetch` drops for every coding but `zstd`.
   */
  | { reason: 'decode'; error: unknown }
  /** Reading the body off the connection failed — the attempt's signal firing included. */
  | { reason: 'read'; error: unknown };

/** Every `BodyReadFailure` reason, for telling one apart from anything else a promise rejected with. */
const BODY_READ_FAILURE_REASONS: readonly string[] = ['too-large', 'unsupported-encoding', 'decode', 'read'];

/**
 * `error` as a {@link BodyReadFailure}: itself when it already is one — what a {@link BodyReader}
 * rejects with — and a `read` failure otherwise.
 */
const toBodyReadFailure = (error: unknown): BodyReadFailure =>
  typeof error === 'object' &&
  error !== null &&
  BODY_READ_FAILURE_REASONS.includes(String((error as { reason?: unknown }).reason))
    ? error as BodyReadFailure
    : { reason: 'read', error };

/** One `read()` of a body reader. */
type ChunkRead = { done: true; value?: Uint8Array } | { done: false; value: Uint8Array };

/**
 * What the client needs of a stream's reader, rejecting with whatever the stream failed with:
 * `fetch`'s and a decoder's are typed apart (`stream/web` and Bun's globals).
 */
interface ChunkReader {
  read(): Promise<ChunkRead>;
  cancel(reason?: unknown): Promise<void>;
}

/**
 * A response body opened for reading: as it came off the connection, or decoded by the client.
 *
 * `read()` rejects with a {@link BodyReadFailure} — `read`, `decode` or `unsupported-encoding` —
 * and never with `too-large`: counting is up to whoever reads it. `cancel()` lets the connection
 * go, so the upstream's stream sees `cancel()`.
 *
 * @internal
 */
export interface BodyReader {
  read(): Promise<ChunkRead>;
  cancel(reason?: unknown): Promise<void>;
}

/** A body with nothing in it. */
const EMPTY_READER: BodyReader = {
  read: () => Promise.resolve({ done: true }),
  cancel: () => Promise.resolve(),
};

/** Every rejection of a promise nobody awaits is expected; this is where it goes. */
const ignoreRejection = (): undefined => undefined;

/** Fail without reading, and let the connection go: the body is cancelled, not drained. */
const refuse = (response: Response, failure: BodyReadFailure): Effect.Effect<never, BodyReadFailure> =>
  pipe(
    Effect.sync(() => {
      response.body?.cancel().catch(ignoreRejection);
    }),
    Effect.flatMap(() => Effect.fail(failure)),
  );

/** The `Content-Length` a response declares, or `undefined` when it declares none or a malformed one. */
const declaredLength = (headers: Headers): number | undefined => {
  const value = headers.get('content-length')?.trim();

  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
};

/** The zlib wrapper's compression method: deflate. */
const ZLIB_METHOD_DEFLATE = 8;
/** The largest window a zlib header may declare, as `log2(window) - 8`. */
const ZLIB_MAX_WINDOW_INFO = 7;
/** A zlib header's two bytes, read as a big-endian number, are a multiple of this. */
const ZLIB_HEADER_CHECK = 31;
const LOW_NIBBLE = 0x0f;
const NIBBLE_BITS = 4;
const BYTE_BITS = 8;

/**
 * Whether `bytes` open with a zlib header (RFC 1950 §2.2).
 *
 * `Content-Encoding: deflate` means zlib-wrapped deflate, which is what `DecompressionStream`'s
 * `'deflate'` expects. Some servers send raw deflate under that name, and Bun's own `fetch`
 * decodes both, so the client tells them apart the way browsers do, by the first two bytes.
 */
const opensWithZlibHeader = (bytes: Uint8Array): boolean => {
  const [cmf, flg] = bytes;

  if ((cmf & LOW_NIBBLE) !== ZLIB_METHOD_DEFLATE || cmf >> NIBBLE_BITS > ZLIB_MAX_WINDOW_INFO) {
    return false;
  }

  return flg === undefined || ((cmf << BYTE_BITS) | flg) % ZLIB_HEADER_CHECK === 0;
};

/** One `Uint8Array` holding `chunks`, which total `length` bytes. */
const concatChunks = (chunks: Uint8Array[], length: number): Uint8Array => {
  if (chunks.length === 1) {
    return chunks[0];
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

/**
 * Read chunks until the stream ends, failing with `too-large` on the first chunk that takes the
 * count past `limit`.
 *
 * The check is `!(received <= limit)` rather than `received > limit`: a `NaN` limit then refuses
 * every byte instead of letting every body through.
 */
const collectChunks = (
  reader: BodyReader,
  limit: number,
  chunks: Uint8Array[] = [],
  received: number = 0,
): Effect.Effect<Uint8Array, BodyReadFailure> => pipe(
  Effect.tryPromise({ try: () => reader.read(), catch: toBodyReadFailure }),
  Effect.flatMap((result): Effect.Effect<Uint8Array, BodyReadFailure> => {
    if (result.done) {
      return Effect.succeed(concatChunks(chunks, received));
    }

    const total = received + result.value.byteLength;

    if (!(total <= limit)) {
      return Effect.fail({ reason: 'too-large', received: total });
    }

    chunks.push(result.value);

    return collectChunks(reader, limit, chunks, total);
  }),
);

/** `source` as a {@link BodyReader}: the body as it came off the connection. */
const rawReader = (source: ChunkReader): BodyReader => ({
  read: () => source.read().then(
    (result): ChunkRead => result,
    (error: unknown) => Promise.reject<ChunkRead>({ reason: 'read', error } satisfies BodyReadFailure),
  ),
  cancel: (reason) => source.cancel(reason),
});

/** The first chunk that holds any bytes, or `undefined` when the body ends without one. */
const firstNonEmptyChunk = (source: ChunkReader): Promise<Uint8Array | undefined> =>
  source.read().then(
    (result): Promise<Uint8Array | undefined> | Uint8Array | undefined => {
      if (result.done) {
        return undefined;
      }

      return result.value.byteLength === 0 ? firstNonEmptyChunk(source) : result.value;
    },
    (error: unknown) => Promise.reject<Uint8Array | undefined>({ reason: 'read', error } satisfies BodyReadFailure),
  );

/** `read`, except that its first call resolves with `first`. */
const startingWith = (first: Uint8Array, read: () => Promise<ChunkRead>): () => Promise<ChunkRead> => {
  let pending: Uint8Array | undefined = first;

  return () => {
    if (pending === undefined) {
      return read();
    }

    const value = pending;
    pending = undefined;

    return Promise.resolve({ done: false as const, value });
  };
};

/** Where a failure in the decoding pipeline came from. */
interface SourceState {
  failed: boolean;
  error: unknown;
}

/**
 * The raw body as a stream that starts with `first`, recording whether reading the connection
 * failed.
 *
 * A failure of the source reaches the decoded end of `pipeThrough` looking like any other, so
 * without this record a reset connection would be reported as a corrupt body.
 */
const trackedSource = (first: Uint8Array, source: ChunkReader, state: SourceState): ReadableStream<Uint8Array> => {
  const read = startingWith(first, () => source.read());

  return new ReadableStream<Uint8Array>(
    {
      pull: (controller) => read().then(
        (result) => {
          if (result.done) {
            controller.close();
          } else {
            controller.enqueue(result.value);
          }
        },
        (error: unknown) => {
          state.failed = true;
          state.error = error;
          controller.error(error);
        },
      ),
      cancel: (reason) => source.cancel(reason),
    },
    { highWaterMark: 0 },
  );
};

/**
 * `source` decoded through `formats`, in order, as a {@link BodyReader}.
 *
 * Nothing is read until the first `read()`: when the first decoder to run is `deflate`, the first
 * chunk decides between the zlib-wrapped form and the raw one, and a stream built on this reader
 * must not wait for that chunk before it is handed over. A body that ends without a single byte
 * is empty whatever its `Content-Encoding` claims, as it is for `fetch`.
 */
const decodingReader = (
  source: ChunkReader,
  formats: Bun.CompressionFormat[],
  encoding: string,
): BodyReader => {
  const state: SourceState = { failed: false, error: undefined };
  let opened: Promise<BodyReader> | undefined;

  const open = (): Promise<BodyReader> => firstNonEmptyChunk(source).then((first): BodyReader | Promise<BodyReader> => {
    if (first === undefined) {
      return EMPTY_READER;
    }

    let decoded: ChunkReader;
    try {
      decoded = formats.reduce<ReadableStream<Uint8Array>>(
        (stream, format, index) => stream.pipeThrough(new DecompressionStream(
          index === 0 && format === 'deflate' && !opensWithZlibHeader(first) ? 'deflate-raw' : format,
        )),
        trackedSource(first, source, state),
      ).getReader();
    } catch {
      // A decoder this runtime's `DecompressionStream` does not have, on a Bun older than 1.4
      source.cancel().catch(ignoreRejection);

      return Promise.reject<BodyReader>({ reason: 'unsupported-encoding', encoding } satisfies BodyReadFailure);
    }

    return {
      read: () => decoded.read().then(
        (result): ChunkRead => result,
        (error: unknown) => Promise.reject<ChunkRead>(
          state.failed
            ? { reason: 'read', error: state.error } satisfies BodyReadFailure
            : { reason: 'decode', error } satisfies BodyReadFailure,
        ),
      ),
      cancel: (reason) => decoded.cancel(reason),
    };
  });

  return {
    read() {
      opened ??= open();

      return opened.then((reader) => reader.read());
    },
    cancel(reason) {
      opened?.then((reader) => reader.cancel(reason)).catch(ignoreRejection);

      return source.cancel(reason);
    },
  };
};

/**
 * Open `response`'s body for reading.
 *
 * Without a `limit` it is handed over as `fetch` delivers it, decompressed by `fetch`. With one —
 * the response must then have been fetched with `decompress: false` — a content coding the client
 * cannot decode fails `unsupported-encoding`, and a body sent as it is whose `Content-Length`
 * exceeds the limit fails `too-large`, both before anything is read and with the body cancelled. A
 * compressed body's `Content-Length` is the compressed size and says nothing about the decoded
 * one, so it is counted instead, by whoever reads the body. Any other body is decoded by the client.
 *
 * @internal
 */
export const openBodyReader = (response: Response, limit?: number): Effect.Effect<BodyReader, BodyReadFailure> =>
  Effect.suspend(() => {
    if (limit === undefined) {
      return Effect.sync(() => (response.body === null ? EMPTY_READER : rawReader(response.body.getReader())));
    }

    const codings = contentCodings(response.headers);
    const plan = decodingPlan(codings);

    if ('unsupported' in plan) {
      return refuse(response, { reason: 'unsupported-encoding', encoding: plan.unsupported });
    }

    const contentLength = codings.length === 0 ? declaredLength(response.headers) : undefined;

    // An empty body fits any limit, so `Content-Length: 0` is read — and found empty — like one
    // that declares nothing
    if (contentLength !== undefined && contentLength > 0 && !(contentLength <= limit)) {
      return refuse(response, { reason: 'too-large', received: 0, contentLength });
    }

    const body = response.body;

    if (body === null) {
      return Effect.succeed(EMPTY_READER);
    }

    return Effect.sync(() => (plan.formats.length === 0
      ? rawReader(body.getReader())
      : decodingReader(body.getReader(), plan.formats, codings.join(', '))));
  });

/**
 * Read `response`'s body, decoded, failing as soon as it is larger than `limit` bytes.
 *
 * {@link openBodyReader} refuses what it can before reading. Whatever ends the read short after
 * that — the cap, a failure, an interruption of the fiber — cancels the body, so the connection
 * closes and the upstream's stream sees `cancel()`.
 *
 * The response must have been fetched with `decompress: false`.
 *
 * @internal
 */
export const readCappedBody = (response: Response, limit: number): Effect.Effect<Uint8Array, BodyReadFailure> =>
  Effect.acquireUseRelease(
    openBodyReader(response, limit),
    (reader) => collectChunks(reader, limit),
    (reader, exit) => (Exit.isSuccess(exit)
      ? Effect.void
      : Effect.sync(() => {
        reader.cancel().catch(ignoreRejection);
      })),
  );

/**
 * What a {@link bodyStream} reports to the request it belongs to.
 *
 * @internal
 */
export interface BodyStreamHooks {
  /** A read of the body is about to wait on the upstream. */
  waiting(): void;
  /** That wait is over: a chunk or the end arrived, the read failed, or the stream was cancelled. */
  settled(): void;
  /** What the stream errors with when reading the body fails with `failure`. */
  errorFor(failure: BodyReadFailure): unknown;
}

/**
 * `reader` as the `ReadableStream` a caller reads, counting the bytes it hands out.
 *
 * Pulled on demand only (`highWaterMark: 0`): nothing is read from the upstream until the caller
 * reads, so {@link BodyStreamHooks.waiting} marks exactly the time the caller spends waiting on the
 * upstream, never the time it takes over a chunk it already has.
 *
 * Once the count passes `limit`, the stream errors with what {@link BodyStreamHooks.errorFor}
 * makes of a `too-large` failure, and the body is cancelled. A failed read errors it the same way.
 * Cancelling the stream cancels the body. Empty chunks are skipped.
 *
 * @internal
 */
export const bodyStream = (
  reader: BodyReader,
  limit: number | undefined,
  hooks: BodyStreamHooks,
): ReadableStream<Uint8Array> => {
  let received = 0;
  // Set once the caller cancels: a read still pending then settles into a stream that is closed
  let cancelled = false;

  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, failure: BodyReadFailure): void => {
    hooks.settled();
    reader.cancel().catch(ignoreRejection);
    if (!cancelled) {
      controller.error(hooks.errorFor(failure));
    }
  };

  const pullChunk = (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => reader.read().then(
    (result): Promise<void> | undefined => {
      if (cancelled) {
        return undefined;
      }

      if (result.done) {
        hooks.settled();
        controller.close();

        return undefined;
      }

      if (result.value.byteLength === 0) {
        return pullChunk(controller);
      }

      received += result.value.byteLength;

      if (limit !== undefined && !(received <= limit)) {
        fail(controller, { reason: 'too-large', received });

        return undefined;
      }

      hooks.settled();
      controller.enqueue(result.value);

      return undefined;
    },
    (error: unknown) => fail(controller, toBodyReadFailure(error)),
  );

  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        hooks.waiting();

        return pullChunk(controller);
      },
      cancel(reason) {
        cancelled = true;
        hooks.settled();

        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
};
