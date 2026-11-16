/**
 * A request body that is bytes — a `Uint8Array`, an `ArrayBuffer` or a `Blob` — goes out as those
 * bytes: on the first attempt, on every retry, on every redirect hop that keeps the body, and in
 * the signature. A body the client cannot send as it is fails `REQUEST_CONFIG_ERROR` before
 * anything is sent.
 *
 * Every case runs against a real Bun.serve fixture on 127.0.0.1 that records the bytes it got.
 */
import { PassThrough, Readable } from 'node:stream';

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect, pipe } from 'effect';

import { createHttpClient } from './client.js';
import { makeSingleReplicaNonceStore, verifyOneBunRequest } from './onebun-auth.js';
import { makeRequestsService, RequestsService } from './service.js';
import {
  type ErrorResponse,
  getTransportFailureKind,
  HttpMethod,
  InternalServerError,
  type RequestMetricsData,
  type RequestsOptions,
  TRANSPORT_FAILURE_CODE,
} from './types.js';

interface Arrival {
  method: string;
  /** Path and query. */
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
  /** Whether the `X-OneBun-Signature` it carried verified; `undefined` when it carried none. */
  signatureValid?: boolean;
}

interface Fixture {
  origin: string;
  arrivals: Arrival[];
  stop(): void;
}

/** Not valid UTF-8, and `JSON.stringify` makes `{"0":0,"1":127,"2":128,"3":255}` of it. */
const BYTES = new Uint8Array([0, 127, 128, 255]);
const SECRET = 'k'.repeat(40);
const AUDIENCE = 'storage';

/**
 * Routes:
 * - `/redirect/<status>?to=<url>` answers `<status>` with `Location: <url>`
 * - `/flaky/<n>` answers 503 to its first `n` arrivals, then 200
 * - anything else answers 200
 *
 * A request that carries `X-OneBun-Signature` is verified against the bytes that arrived.
 */
function startFixture(): Fixture {
  const arrivals: Arrival[] = [];
  const nonceStore = makeSingleReplicaNonceStore();

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((value, name) => {
        headers[name] = value;
      });
      const body = new Uint8Array(await req.arrayBuffer());
      const signatureValid = headers['x-onebun-signature'] === undefined
        ? undefined
        : (await Effect.runPromise(verifyOneBunRequest(
          {
            method: req.method, url: req.url, headers, body: body.length === 0 ? undefined : body,
          },
          { secret: SECRET, audience: AUDIENCE, nonceStore },
        ))).valid;
      arrivals.push({
        method: req.method, path: url.pathname + url.search, headers, body, signatureValid,
      });

      const redirect = url.pathname.match(/^\/redirect\/(\d+)$/);
      if (redirect) {
        return new Response(null, {
          status: Number(redirect[1]),
          headers: { location: url.searchParams.get('to') ?? '/' },
        });
      }

      const flaky = url.pathname.match(/^\/flaky\/(\d+)$/);
      if (flaky) {
        const seen = arrivals.filter((arrival) => arrival.path === url.pathname).length;

        return seen <= Number(flaky[1])
          ? Response.json({ ok: false }, { status: 503 })
          : Response.json({ ok: true });
      }

      return Response.json({ ok: true });
    },
  });

  return {
    origin: `http://127.0.0.1:${server.port}`,
    arrivals,
    stop: () => server.stop(true),
  };
}

/** The `ErrorResponse` an Effect failed with. */
async function failureOf<A>(effect: Effect.Effect<A, ErrorResponse>): Promise<ErrorResponse> {
  const outcome = await Effect.runPromise(Effect.either(effect));

  if (outcome._tag === 'Right') {
    throw new Error('expected the request to fail');
  }

  return outcome.left;
}

/** A `Blob` that counts how often its content is read through the `Blob` API. */
class CountingBlob extends Blob {
  reads = 0;

  override arrayBuffer(): Promise<ArrayBuffer> {
    this.reads += 1;

    return super.arrayBuffer();
  }

  override text(): Promise<string> {
    this.reads += 1;

    return super.text();
  }

  override stream(): ReturnType<Blob['stream']> {
    this.reads += 1;

    return super.stream();
  }
}

describe('Binary request bodies', () => {
  let fixture: Fixture;
  const clientFor = (options: RequestsOptions = {}) =>
    createHttpClient({ baseUrl: fixture.origin, retries: { max: 0 }, ...options });

  beforeEach(() => {
    fixture = startFixture();
  });

  afterEach(() => {
    fixture.stop();
  });

  describe('the bytes on the wire', () => {
    it('should send a Uint8Array as its bytes, labelled application/octet-stream', async () => {
      const response = await clientFor().put('/upload', BYTES);

      expect(response.success).toBe(true);
      expect(fixture.arrivals).toHaveLength(1);
      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-length']).toBe('4');
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
    });

    it('should send an ArrayBuffer as its bytes', async () => {
      await clientFor().post('/upload', BYTES.slice().buffer);

      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
    });

    it('should send a Blob as its bytes, labelled with its own type', async () => {
      await clientFor().patch('/upload', new Blob([BYTES], { type: 'image/png' }));

      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-type']).toBe('image/png');
    });

    it('should label a Blob without a type application/octet-stream', async () => {
      await clientFor().put('/upload', new Blob([BYTES]));

      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
    });

    it('should send a file from Bun.file byte for byte', async () => {
      const file = Bun.file(import.meta.path);

      await clientFor().put('/upload', file);

      expect(fixture.arrivals[0].body).toEqual(new Uint8Array(await file.arrayBuffer()));
      expect(fixture.arrivals[0].headers['content-type']).toBe(file.type || 'application/octet-stream');
    });

    it('should send only the bytes a view covers, not its whole buffer', async () => {
      const view = new Uint8Array([9, ...BYTES, 9]).subarray(1, 5);

      await clientFor().put('/upload', view);

      expect(fixture.arrivals[0].body).toEqual(BYTES);
    });

    it('should send a Buffer as its bytes', async () => {
      await clientFor().put('/upload', Buffer.from(BYTES));

      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
    });

    it('should send an empty Uint8Array, ArrayBuffer and Blob as an empty body', async () => {
      const client = clientFor();

      await client.put('/empty', new Uint8Array(0));
      await client.put('/empty', new ArrayBuffer(0));
      await client.put('/empty', new Blob([]));

      expect(fixture.arrivals).toHaveLength(3);
      for (const arrival of fixture.arrivals) {
        expect(arrival.body).toHaveLength(0);
        expect(arrival.headers['content-length']).toBe('0');
        expect(arrival.headers['content-type']).toBe('application/octet-stream');
      }
    });

    it('should send the bytes through the Effect API, as reported (reqEffect with a lower-case content-type)', async () => {
      const client = createHttpClient({ retries: { max: 0 } });

      await Effect.runPromise(client.reqEffect('PUT', `${fixture.origin}/part`, BYTES, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'content-type': 'application/octet-stream' },
      }));

      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
    });

    it('should send the bytes through req() and reqRaw()', async () => {
      const client = clientFor();

      await client.req('PUT', '/req', BYTES);
      await client.reqRaw('POST', '/reqRaw', BYTES.slice().buffer);

      expect(fixture.arrivals.map((arrival) => arrival.body)).toEqual([BYTES, BYTES]);
    });

    it('should send the bytes through RequestsService', async () => {
      await Effect.runPromise(pipe(
        RequestsService,
        Effect.flatMap((service) => service.putEffect('/service', new Blob([BYTES]))),
        Effect.provide(makeRequestsService({ baseUrl: fixture.origin, retries: { max: 0 } })),
      ));

      expect(fixture.arrivals[0].body).toEqual(BYTES);
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
    });
  });

  describe('Content-Type', () => {
    it('should keep the request\'s own Content-Type, in any letter case, and send it alone', async () => {
      const client = clientFor();

      // eslint-disable-next-line @typescript-eslint/naming-convention
      await client.put('/upload', BYTES, { headers: { 'Content-Type': 'image/png' } });
      await client.put('/upload', new Blob([BYTES], { type: 'image/gif' }), {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'content-type': 'image/webp' },
      });

      expect(fixture.arrivals[0].headers['content-type']).toBe('image/png');
      expect(fixture.arrivals[1].headers['content-type']).toBe('image/webp');
    });

    it('should keep a Content-Type set in the client\'s headers', async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const client = clientFor({ headers: { 'content-type': 'application/x-custom' } });

      await client.put('/upload', BYTES);

      expect(fixture.arrivals[0].headers['content-type']).toBe('application/x-custom');
    });

    it('should send the request\'s content-type alone over the client\'s, whatever the case of each', async () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const client = clientFor({ headers: { 'Content-Type': 'application/json' } });

      // eslint-disable-next-line @typescript-eslint/naming-convention
      await client.put('/upload', BYTES, { headers: { 'content-type': 'application/octet-stream' } });
      // eslint-disable-next-line @typescript-eslint/naming-convention
      await client.post('/json', { a: 1 }, { headers: { 'CONTENT-TYPE': 'application/vnd.api+json' } });

      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
      expect(fixture.arrivals[1].headers['content-type']).toBe('application/vnd.api+json');
    });

    it('should sign the content-type that goes out when the client and the request both name one', async () => {
      const client = clientFor({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'Content-Type': 'application/json' },
        auth: {
          type: 'onebun', serviceId: 'importer', secretKey: SECRET, audience: AUDIENCE,
        },
      });

      // eslint-disable-next-line @typescript-eslint/naming-convention
      await client.put('/part', BYTES, { headers: { 'content-type': 'application/octet-stream' } });

      expect(fixture.arrivals[0].headers['content-type']).toBe('application/octet-stream');
      expect(fixture.arrivals[0].signatureValid).toBe(true);
      expect(fixture.arrivals[0].body).toEqual(BYTES);
    });

    it('should send a caller\'s lower-case content-type alone with a JSON body too', async () => {
      await clientFor().post('/json', { a: 1 }, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'content-type': 'application/vnd.api+json' },
      });

      expect(fixture.arrivals[0].headers['content-type']).toBe('application/vnd.api+json');
    });
  });

  describe('strings and JSON', () => {
    it('should send a JSON value serialized and a string as it is, both labelled application/json', async () => {
      const client = clientFor();

      await client.post('/json', { name: 'John', tags: [1, 2] });
      await client.post('/text', 'raw text');

      expect(new TextDecoder().decode(fixture.arrivals[0].body)).toBe('{"name":"John","tags":[1,2]}');
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/json');
      expect(new TextDecoder().decode(fixture.arrivals[1].body)).toBe('raw text');
      expect(fixture.arrivals[1].headers['content-type']).toBe('application/json');
    });

    it('should send a value with a toJSON of its own through JSON.stringify, whatever else it is', async () => {
      class Page {
        readonly items = [1, 2];

        async *[Symbol.asyncIterator]() {
          yield* this.items;
        }

        toJSON() {
          return { items: this.items };
        }
      }
      const form = new FormData();
      form.append('a', '1');
      const client = clientFor();

      await client.put('/search', new URLSearchParams({ a: '1', b: '2' }));
      await client.put('/form', form);
      await client.put('/page', new Page());

      expect(fixture.arrivals.map((arrival) => new TextDecoder().decode(arrival.body))).toEqual([
        '{"a":"1","b":"2"}',
        '{"a":"1"}',
        '{"items":[1,2]}',
      ]);
      expect(fixture.arrivals.every((arrival) => arrival.headers['content-type'] === 'application/json')).toBe(true);
    });

    it('should send a data class that is async-iterable but not a stream as JSON of its fields', async () => {
      class Cursor {
        readonly items = [1];

        async *[Symbol.asyncIterator]() {
          yield* this.items;
        }
      }

      await clientFor().put('/cursor', new Cursor());

      expect(new TextDecoder().decode(fixture.arrivals[0].body)).toBe('{"items":[1]}');
      expect(fixture.arrivals[0].headers['content-type']).toBe('application/json');
    });

    it('should send no body for an empty string, as it does for any falsy value', async () => {
      await clientFor().post('/empty', '');

      expect(fixture.arrivals[0].body).toHaveLength(0);
    });

    it('should send no body for a GET, whatever data it was given', async () => {
      await clientFor().request({ method: HttpMethod.GET, url: '/get', data: BYTES });

      expect(fixture.arrivals[0].method).toBe('GET');
      expect(fixture.arrivals[0].body).toHaveLength(0);
    });
  });

  describe('the same bytes on every attempt', () => {
    it('should re-send the same bytes on a retry', async () => {
      const client = clientFor({ retries: { max: 2, delay: 1, retryOn: [503] } });

      const response = await client.put('/flaky/1', BYTES);

      expect(response.success).toBe(true);
      expect(fixture.arrivals).toHaveLength(2);
      expect(fixture.arrivals.map((arrival) => arrival.body)).toEqual([BYTES, BYTES]);
      expect(fixture.arrivals[1].headers['content-type']).toBe('application/octet-stream');
    });

    it('should read a Blob once, before the first attempt, and re-send those bytes on a retry', async () => {
      const blob = new CountingBlob([BYTES], { type: 'image/png' });
      const client = clientFor({ retries: { max: 2, delay: 1, retryOn: [503] } });

      await client.put('/flaky/2', blob);

      expect(fixture.arrivals).toHaveLength(3);
      expect(fixture.arrivals.map((arrival) => arrival.body)).toEqual([BYTES, BYTES, BYTES]);
      expect(fixture.arrivals.map((arrival) => arrival.headers['content-type']))
        .toEqual(['image/png', 'image/png', 'image/png']);
      expect(blob.reads).toBe(1);
    });

    for (const status of [307, 308]) {
      it(`should replay the same bytes and Content-Type on a ${status}`, async () => {
        await clientFor().post(`/redirect/${status}?to=%2Flanding`, new Blob([BYTES], { type: 'image/png' }));

        expect(fixture.arrivals.map((arrival) => arrival.path)).toEqual([`/redirect/${status}?to=%2Flanding`, '/landing']);
        expect(fixture.arrivals[1].method).toBe('POST');
        expect(fixture.arrivals[1].body).toEqual(BYTES);
        expect(fixture.arrivals[1].headers['content-type']).toBe('image/png');
      });
    }

    it('should drop the bytes and their Content-Type on a 303, as for any body', async () => {
      await clientFor().put('/redirect/303?to=%2Flanding', BYTES);

      expect(fixture.arrivals[1].method).toBe('GET');
      expect(fixture.arrivals[1].body).toHaveLength(0);
      expect(fixture.arrivals[1].headers['content-type']).toBeUndefined();
    });
  });

  describe('signed requests', () => {
    const signed = (options: RequestsOptions = {}) => clientFor({
      auth: {
        type: 'onebun', serviceId: 'importer', secretKey: SECRET, audience: AUDIENCE,
      },
      ...options,
    });

    it('should sign the bytes it sends, for each binary type', async () => {
      const client = signed();

      await client.put('/part', BYTES);
      await client.put('/part', BYTES.slice().buffer);
      await client.put('/part', new Blob([BYTES], { type: 'image/png' }));
      await client.put('/part', new Uint8Array(0));

      expect(fixture.arrivals.map((arrival) => arrival.signatureValid)).toEqual([true, true, true, true]);
      expect(fixture.arrivals.map((arrival) => arrival.body)).toEqual([BYTES, BYTES, BYTES, new Uint8Array(0)]);
    });

    it('should sign the bytes again on a retry and on a replayed 307', async () => {
      const client = signed({ retries: { max: 1, delay: 1, retryOn: [503] } });

      await client.put('/flaky/1', BYTES);
      await client.put('/redirect/307?to=%2Fpart', new Blob([BYTES]));

      expect(fixture.arrivals.map((arrival) => [arrival.path, arrival.signatureValid])).toEqual([
        ['/flaky/1', true],
        ['/flaky/1', true],
        ['/redirect/307?to=%2Fpart', true],
        ['/part', true],
      ]);
      expect(fixture.arrivals.every((arrival) => arrival.body.length === BYTES.length)).toBe(true);
    });
  });

  describe('bodies that are refused', () => {
    const refusalOf = async (data: unknown, options: RequestsOptions = {}) => {
      const metrics: RequestMetricsData[] = [];
      const client = clientFor({
        retries: { max: 3, delay: 1, retryOn: [500] },
        metricsSink: (record) => metrics.push(record),
        ...options,
      });
      const failure = await failureOf(client.putEffect('/upload', data));

      return { failure, metrics };
    };

    it('should refuse a ReadableStream before anything is sent, without reading it', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(BYTES);
          controller.close();
        },
      });

      const { failure, metrics } = await refusalOf(stream);

      expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
      expect(failure.code).toBe(500);
      expect(failure.details?.option).toBe('data');
      expect(failure.details?.reason).toBe('unsupported-body');
      expect(failure.details?.type).toBe('ReadableStream');
      expect(fixture.arrivals).toHaveLength(0);
      expect(metrics).toHaveLength(0);
      expect(stream.locked).toBe(false);
    });

    it('should refuse a ReadableStream under signing as well', async () => {
      const { failure } = await refusalOf(new ReadableStream(), {
        auth: {
          type: 'onebun', serviceId: 'importer', secretKey: SECRET, audience: AUDIENCE,
        },
      });

      expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
      expect(fixture.arrivals).toHaveLength(0);
    });

    it('should reject the Promise API with the failure as its OneBunBaseError class, sending nothing', async () => {
      const rejection = clientFor().req('PUT', '/upload', new ReadableStream());

      await expect(rejection).rejects.toBeInstanceOf(InternalServerError);
      await expect(rejection).rejects.toMatchObject({
        error: 'REQUEST_CONFIG_ERROR',
        code: 500,
        details: { option: 'data', reason: 'unsupported-body', type: 'ReadableStream' },
      });
      expect(fixture.arrivals).toHaveLength(0);
    });

    const unsupported: Array<[string, () => unknown, string]> = [
      ['an async generator', () => (async function* chunks() {
        yield BYTES;
      })(), 'AsyncGenerator'],
      ['a Node.js stream', () => Readable.from([BYTES]), 'Readable'],
      ['a Node.js PassThrough', () => new PassThrough(), 'PassThrough'],
      ['an Int16Array', () => new Int16Array([1, 2]), 'Int16Array'],
      ['a DataView', () => new DataView(new ArrayBuffer(2)), 'DataView'],
      ['a SharedArrayBuffer', () => new SharedArrayBuffer(2), 'SharedArrayBuffer'],
    ];

    for (const [name, make, type] of unsupported) {
      it(`should refuse ${name} before anything is sent`, async () => {
        const { failure } = await refusalOf(make());

        expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
        expect(failure.details?.reason).toBe('unsupported-body');
        expect(failure.details?.type).toBe(type);
        expect(fixture.arrivals).toHaveLength(0);
      });
    }

    it('should fail TIMEOUT_ERROR when a Blob is not read within the timeout, sending nothing', async () => {
      class StalledBlob extends Blob {
        override arrayBuffer(): Promise<ArrayBuffer> {
          return new Promise(() => undefined);
        }
      }

      const { failure, metrics } = await refusalOf(new StalledBlob([BYTES]), { timeout: 50, retries: { retryOnTimeout: true } });

      expect(failure.error).toBe('TIMEOUT_ERROR');
      expect(failure.code).toBe(TRANSPORT_FAILURE_CODE);
      expect(getTransportFailureKind(failure)).toBe('timeout');
      expect(failure.details?.phase).toBe('request-body');
      expect(fixture.arrivals).toHaveLength(0);
      expect(metrics).toHaveLength(0);
    });

    it('should refuse a Blob whose read fails, before anything is sent', async () => {
      const { failure } = await refusalOf(Bun.file(`${import.meta.dir}/no-such-file-${Date.now()}.bin`));

      expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
      expect(failure.details?.option).toBe('data');
      expect(failure.details?.reason).toBe('unreadable-body');
      expect(failure.details?.details).toBeInstanceOf(Error);
      expect(fixture.arrivals).toHaveLength(0);
    });

    it('should refuse a value JSON.stringify throws on, before anything is sent', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const bigint = await refusalOf({ size: 1n });
      const cycle = await refusalOf(circular);

      for (const { failure } of [bigint, cycle]) {
        expect(failure.error).toBe('REQUEST_CONFIG_ERROR');
        expect(failure.details?.option).toBe('data');
        expect(failure.details?.reason).toBe('unserializable-body');
        expect(failure.details?.details).toBeInstanceOf(TypeError);
      }
      expect(fixture.arrivals).toHaveLength(0);
    });
  });
});
