/* eslint-disable @typescript-eslint/naming-convention */
import {
  describe,
  it,
  expect,
} from 'bun:test';
import { Effect } from 'effect';

import type { RequestConfig } from './types.js';

import { applyAuth, isSigningAuth } from './auth.js';
import { HttpMethod } from './types.js';

const baseConfig: RequestConfig = {
  method: HttpMethod.GET,
  url: '/path',
};

describe('auth.applyAuth', () => {
  it('applies bearer token to Authorization header', async () => {
    const eff = applyAuth({ type: 'bearer', token: 'tkn' }, baseConfig);
    const res = await Effect.runPromise(eff);
    expect(res.headers?.Authorization).toBe('Bearer tkn');
  });

  it('applies apikey to header by default', async () => {
    const eff = applyAuth({ type: 'apikey', key: 'X-Key', value: 'V' }, baseConfig);
    const res = await Effect.runPromise(eff);
    expect(res.headers?.['X-Key']).toBe('V');
  });

  it('applies apikey to query when location=query', async () => {
    const eff = applyAuth(
      {
        type: 'apikey', key: 'api_key', value: 'V', location: 'query', 
      },
      { ...baseConfig, query: { a: 1 } },
    );
    const res = await Effect.runPromise(eff);
    expect(res.query).toEqual({ a: 1, api_key: 'V' });
  });

  it('applies basic auth as base64 Authorization header', async () => {
    const eff = applyAuth({ type: 'basic', username: 'u', password: 'p' }, baseConfig);
    const res = await Effect.runPromise(eff);
    expect(res.headers?.Authorization?.startsWith('Basic ')).toBe(true);
  });

  it('applies custom headers and query and interceptor', async () => {
    const eff = applyAuth(
      {
        type: 'custom',
        headers: { H: '1' },
        query: { q: 'x' },
        interceptor: async (cfg) => ({ ...cfg, headers: { ...cfg.headers, I: '2' } }),
      },
      { ...baseConfig, headers: { K: '3' }, query: { z: 9 } },
    );
    const res = await Effect.runPromise(eff);
    expect(res.headers).toEqual({ K: '3', H: '1', I: '2' });
    expect(res.query).toEqual({ z: 9, q: 'x' });
  });

  it('applies custom auth with interceptor only', async () => {
    const eff = applyAuth(
      {
        type: 'custom',
        interceptor: async (cfg) => ({ ...cfg, headers: { ...cfg.headers, 'X-Custom': 'interceptor-value' } }),
      },
      baseConfig,
    );
    const res = await Effect.runPromise(eff);
    expect(res.headers).toEqual({ 'X-Custom': 'interceptor-value' });
  });

  it('applies custom auth without interceptor', async () => {
    const eff = applyAuth(
      {
        type: 'custom',
        headers: { 'X-Custom': 'header-value' },
        query: { customParam: 'query-value' },
      },
      baseConfig,
    );
    const res = await Effect.runPromise(eff);
    expect(res.headers).toEqual({ 'X-Custom': 'header-value' });
    expect(res.query).toEqual({ customParam: 'query-value' });
  });

  it('fails when custom interceptor throws', async () => {
    const eff = applyAuth(
      {
        type: 'custom',
        interceptor() {
          throw new Error('bad');
        },
      },
      baseConfig,
    );
    await expect(Effect.runPromise(eff)).rejects.toBeInstanceOf(Error);
  });

  it('leaves the config untouched — onebun signs later, over the assembled request', async () => {
    // `applyAuth` shapes the request; it does not sign it. The signature has to cover the final
    // URL, the Content-Type and the exact body bytes, none of which exist yet at this point.
    // Signing here is how the old implementation came to cover neither the query nor the body.
    const eff = applyAuth(
      {
        type: 'onebun', serviceId: 'svc', secretKey: 'secret', algorithm: 'hmac-sha256',
      },
      baseConfig,
    );
    const res = await Effect.runPromise(eff);

    expect(res.headers?.['X-OneBun-Signature']).toBeUndefined();
    expect(res).toEqual(baseConfig);
  });

  it('reports which schemes shape the request and which sign it', () => {
    // Shaping runs before the URL is built; signing after, over what is final.
    expect(isSigningAuth({ type: 'bearer', token: 't' })).toBe(false);
    expect(isSigningAuth({
      type: 'apikey', key: 'k', value: 'v', location: 'query',
    })).toBe(false);
    expect(isSigningAuth({ type: 'onebun', serviceId: 's', secretKey: 'k' })).toBe(true);
  });
});
