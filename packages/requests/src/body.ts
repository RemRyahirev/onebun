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

/** One `read()` of a body reader. */
type ChunkRead = { done: true; value?: Uint8Array } | { done: false; value: Uint8Array };

/** What the client needs of a body reader: `fetch`'s and a decoder's are typed apart. */
interface ChunkReader {
  read(): Promise<ChunkRead>;
  cancel(reason?: unknown): Promise<void>;
}

const EMPTY_BODY = new Uint8Array(0);

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
  read: () => Promise<ChunkRead>,
  limit: number,
  readFailure: (error: unknown) => BodyReadFailure,
  chunks: Uint8Array[] = [],
  received: number = 0,
): Effect.Effect<Uint8Array, BodyReadFailure> => pipe(
  Effect.tryPromise({ try: () => read(), catch: readFailure }),
  Effect.flatMap((result): Effect.Effect<Uint8Array, BodyReadFailure> => {
    if (result.done) {
      return Effect.succeed(concatChunks(chunks, received));
    }

    const total = received + result.value.byteLength;

    if (!(total <= limit)) {
      return Effect.fail({ reason: 'too-large', received: total });
    }

    chunks.push(result.value);

    return collectChunks(read, limit, readFailure, chunks, total);
  }),
);

/** The first chunk that holds any bytes, or `undefined` when the body ends without one. */
const firstChunk = (source: ChunkReader): Effect.Effect<Uint8Array | undefined, BodyReadFailure> => pipe(
  Effect.tryPromise({
    try: () => source.read(),
    catch: (error): BodyReadFailure => ({ reason: 'read', error }),
  }),
  Effect.flatMap((result): Effect.Effect<Uint8Array | undefined, BodyReadFailure> => {
    if (result.done) {
      return Effect.succeed(undefined);
    }

    return result.value.byteLength === 0 ? firstChunk(source) : Effect.succeed(result.value);
  }),
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
 * Decode a body through `formats`, in order, and count what comes out.
 *
 * When the first decoder to run is `deflate`, the first chunk decides between the zlib-wrapped
 * form and the raw one.
 */
const collectDecoded = (
  first: Uint8Array,
  source: ChunkReader,
  formats: Bun.CompressionFormat[],
  encoding: string,
  limit: number,
): Effect.Effect<Uint8Array, BodyReadFailure> => {
  const state: SourceState = { failed: false, error: undefined };

  return pipe(
    Effect.try({
      try: () => formats.reduce<ReadableStream<Uint8Array>>(
        (stream, format, index) => stream.pipeThrough(new DecompressionStream(
          index === 0 && format === 'deflate' && !opensWithZlibHeader(first) ? 'deflate-raw' : format,
        )),
        trackedSource(first, source, state),
      ).getReader(),
      // A decoder this runtime's `DecompressionStream` does not have, on a Bun older than 1.4
      catch: (): BodyReadFailure => ({ reason: 'unsupported-encoding', encoding }),
    }),
    Effect.flatMap((decoded) => collectChunks(
      () => decoded.read(),
      limit,
      (error) => (state.failed ? { reason: 'read', error: state.error } : { reason: 'decode', error }),
    )),
  );
};

/**
 * Read `response`'s body, decoded, failing as soon as it is larger than `limit` bytes.
 *
 * Before anything is read, a content coding the client cannot decode fails `unsupported-encoding`,
 * and a body sent as it is whose `Content-Length` exceeds the limit fails `too-large`. A compressed
 * body's `Content-Length` is the compressed size and says nothing about the decoded one, so it is
 * counted instead.
 *
 * Whatever ends the read short — the cap, a failure, an interruption of the fiber — cancels the
 * body, so the connection closes and the upstream's stream sees `cancel()`. A body that ends
 * without a single byte is empty whatever its `Content-Encoding` claims, as it is for `fetch`.
 *
 * The response must have been fetched with `decompress: false`.
 *
 * @internal
 */
export const readCappedBody = (response: Response, limit: number): Effect.Effect<Uint8Array, BodyReadFailure> =>
  Effect.suspend(() => {
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
      return Effect.succeed(EMPTY_BODY);
    }

    return Effect.acquireUseRelease(
      Effect.sync(() => body.getReader()),
      (source) => pipe(
        firstChunk(source),
        Effect.flatMap((first) => {
          if (first === undefined) {
            return Effect.succeed(EMPTY_BODY);
          }

          if (plan.formats.length > 0) {
            return collectDecoded(first, source, plan.formats, codings.join(', '), limit);
          }

          return collectChunks(
            startingWith(first, () => source.read()),
            limit,
            (error): BodyReadFailure => ({ reason: 'read', error }),
          );
        }),
      ),
      (source, exit) => (Exit.isSuccess(exit)
        ? Effect.void
        : Effect.sync(() => {
          source.cancel().catch(ignoreRejection);
        })),
    );
  });
