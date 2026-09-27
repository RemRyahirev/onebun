/**
 * The upstream's headers on a success.
 *
 * The client collected them for every response but only the error envelope carried them, in
 * `details.headers`; a success had no way to reach an `etag`, a `location` or a rate-limit header.
 * They are now on `SuccessResponse.headers`, as a non-enumerable property, so that a controller
 * returning the envelope as it is does not serialize them into its own body.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect } from 'effect';

import { HttpClient } from './client.js';
import { createSuccessResponse } from './types.js';

const BODY = { value: 1 };
const BODY_LENGTH = String(new TextEncoder().encode(JSON.stringify(BODY)).length);

/* eslint-disable @typescript-eslint/naming-convention */
describe('SuccessResponse.headers', () => {
  let server: ReturnType<typeof Bun.serve>;
  let client: HttpClient;
  let attempts: number;

  beforeEach(() => {
    attempts = 0;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;

        switch (path) {
          case '/probe':
            return Response.json(BODY, { headers: { 'X-Probe': 'present' } });
          case '/repeated': {
            const headers = new Headers();
            headers.append('set-cookie', 'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT');
            headers.append('set-cookie', 'b=2');
            headers.append('x-multi', 'one');
            headers.append('x-multi', 'two');
            headers.append('__proto__', 'kept');

            return Response.json(BODY, { headers });
          }
          case '/flaky':
            attempts += 1;

            return attempts === 1
              ? Response.json({ busy: true }, { status: 503, headers: { 'x-attempt': '1' } })
              : Response.json(BODY, { headers: { 'x-attempt': String(attempts) } });
          case '/moved':
            return new Response(null, { status: 302, headers: { location: '/landed', 'x-hop': 'first' } });
          case '/landed':
            return Response.json(BODY, { headers: { 'x-hop': 'final' } });
          case '/created':
            return new Response(null, { status: 204, headers: { location: '/items/7' } });
          case '/cached':
            return new Response(null, { status: 304, headers: { etag: '"v1"' } });
          case '/missing': {
            const headers = new Headers({ 'content-type': 'application/json' });
            headers.append('set-cookie', 'a=1');
            headers.append('set-cookie', 'b=2');

            return new Response(JSON.stringify({ reason: 'gone' }), { status: 404, headers });
          }
          default:
            // Answers HEAD too: Bun drops the body and keeps `content-length` and the etag
            return Response.json(BODY, { headers: { etag: '"v7"' } });
        }
      },
    });
    client = new HttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, retries: { max: 0 } });
  });

  afterEach(() => {
    server.stop(true);
  });

  it('carries the upstream headers on a reqRaw success, names lower-cased', async () => {
    // 0.8.1: `{ success, result, statusCode, retryCount }` — no headers key at all
    const response = await client.reqRaw<typeof BODY>('GET', '/probe');

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.statusCode).toBe(200);
      expect(response.result).toEqual(BODY);
      expect(response.headers?.['x-probe']).toBe('present');
      expect(response.headers?.['content-type']).toContain('application/json');
    }
  });

  it('gives a HEAD answer the etag and content-length the fixture sent', async () => {
    const head = await client.head('/x');
    const get = await client.get('/x');

    expect(head.success).toBe(true);
    if (head.success) {
      expect(head.result).toBeUndefined();
      expect(head.headers?.etag).toBe('"v7"');
      expect(head.headers?.['content-length']).toBe(BODY_LENGTH);
    }
    expect(get.success && get.headers?.['content-length']).toBe(BODY_LENGTH);
  });

  it('keeps the headers of a 204 and a 304, whose result is undefined', async () => {
    const created = await client.post('/created', { name: 'x' });
    const cached = await client.get('/cached', undefined, { headers: { 'If-None-Match': '"v1"' } });

    expect(created).toMatchObject({ success: true, statusCode: 204 });
    expect(created.success && created.headers?.location).toBe('/items/7');
    expect(cached).toMatchObject({ success: true, statusCode: 304 });
    expect(cached.success && cached.headers?.etag).toBe('"v1"');
  });

  it('joins a repeated header as Headers.get does, set-cookie included', async () => {
    const response = await client.get('/repeated');

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.headers?.['x-multi']).toBe('one, two');
      // Assigned one by one, only `b=2` survived
      expect(response.headers?.['set-cookie']).toBe('a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT, b=2');
      // An own property, not the prototype setter
      expect(Object.getOwnPropertyDescriptor(response.headers, '__proto__')?.value).toBe('kept');
      expect(Object.getPrototypeOf(response.headers)).toBe(Object.prototype);
    }
  });

  it('leaves an error\'s details.headers as it was, because the default exception filter serializes it', async () => {
    // `details.headers` is enumerable, and an error `req()` throws that a controller does not catch
    // reaches the caller's body through the default exception filter. Joining every set-cookie
    // there, as a success's headers are joined, would forward all of the upstream's cookies instead of one.
    const outcome = await Effect.runPromise(Effect.either(client.getEffect('/missing')));

    expect(outcome._tag).toBe('Left');
    if (outcome._tag === 'Left') {
      expect(outcome.left.details?.headers).toMatchObject({ 'set-cookie': 'b=2' });
    }
  });

  it('keeps the headers of the attempt that succeeded through a retry', async () => {
    // The retry count is added by copying the envelope, and a spread drops a non-enumerable property
    const retrying = new HttpClient({
      baseUrl: `http://127.0.0.1:${server.port}`,
      retries: { max: 1, delay: 1, retryOn: [503] },
    });

    const response = await retrying.get('/flaky');

    expect(response).toMatchObject({ success: true, statusCode: 200, retryCount: 1 });
    expect(response.success && response.headers?.['x-attempt']).toBe('2');
  });

  it('carries the final hop\'s headers after a redirect', async () => {
    const response = await client.get('/moved');

    expect(response.success).toBe(true);
    if (response.success) {
      expect(response.headers?.['x-hop']).toBe('final');
      expect(response.headers?.location).toBeUndefined();
    }
  });

  it('carries them on the Effect form too', async () => {
    const response = await Effect.runPromise(client.reqEffect('GET', '/probe'));

    expect(response.headers?.['x-probe']).toBe('present');
  });

  it('is not enumerable, so no serialization of the envelope carries it', async () => {
    const response = await client.get('/probe');

    expect('headers' in response).toBe(true);
    expect(Object.keys(response)).toEqual(['success', 'result', 'traceId', 'statusCode', 'retryCount']);
    expect(JSON.stringify(response)).not.toContain('x-probe');
    expect(JSON.stringify({ nested: response })).not.toContain('x-probe');
    expect({ ...response }).not.toHaveProperty('headers');
    expect(structuredClone(response)).not.toHaveProperty('headers');
    // The envelope's enumerable shape is what it was: existing equality checks keep passing
    expect(response).toEqual({
      success: true,
      result: BODY,
      statusCode: 200,
      retryCount: 0,
    });
    // Bun's own inspector lists non-enumerable properties: console.log and a snapshot show them
    expect(Bun.inspect(response)).toContain('x-probe');
  });

  it('is absent from an envelope the framework builds around a handler\'s value', () => {
    const wrapped = createSuccessResponse({ value: 1 });

    expect('headers' in wrapped).toBe(false);
    expect(JSON.stringify(wrapped)).toBe('{"success":true,"result":{"value":1}}');
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
