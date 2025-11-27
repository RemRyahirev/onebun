/* eslint-disable @typescript-eslint/naming-convention */
import {
  describe,
  it,
  expect,
} from 'bun:test';
import { Effect } from 'effect';

import type { RequestConfig } from './types.js';

import { applyAuth, validateOneBunAuth } from './auth.js';
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

  it('applies onebun auth and sets headers', async () => {
    const eff = applyAuth(
      {
        type: 'onebun', serviceId: 'svc', secretKey: 'secret', algorithm: 'hmac-sha256', 
      },
      baseConfig,
    );
    const res = await Effect.runPromise(eff);
    // presence of headers
    expect(res.headers?.['X-OneBun-Service-Id']).toBe('svc');
    expect(res.headers?.['X-OneBun-Timestamp']).toBeDefined();
    expect(res.headers?.['X-OneBun-Nonce']).toBeDefined();
    expect(res.headers?.['X-OneBun-Algorithm']).toBe('hmac-sha256');
    expect(res.headers?.['X-OneBun-Signature']).toBeDefined();
  });
});

describe('auth.validateOneBunAuth', () => {
  it('validates correct headers within age', async () => {
    // First, create headers via applyAuth
    const applied = await Effect.runPromise(
      applyAuth(
        {
          type: 'onebun', serviceId: 'svc', secretKey: 'secret', algorithm: 'hmac-sha256', 
        },
        baseConfig,
      ),
    );

    // Convert to lowercase keys as validator expects
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(applied.headers || {})) {
      headers[k.toLowerCase()] = String(v);
    }
    // supply method/url for payload recreation
    headers['x-onebun-method'] = baseConfig.method;
    headers['x-onebun-url'] = baseConfig.url;

    const res = await Effect.runPromise(validateOneBunAuth(headers, 'secret'));
    expect(res.serviceId).toBe('svc');
    expect(res.valid).toBe(true);
  });

  it('rejects when signature mismatched', async () => {
    const applied = await Effect.runPromise(
      applyAuth(
        {
          type: 'onebun', serviceId: 'svc', secretKey: 'secret', algorithm: 'hmac-sha256', 
        },
        baseConfig,
      ),
    );
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(applied.headers || {})) {
      headers[k.toLowerCase()] = String(v);
    }
    headers['x-onebun-method'] = baseConfig.method;
    headers['x-onebun-url'] = baseConfig.url;
    // Tamper signature
    headers['x-onebun-signature'] = 'deadbeef';
    const res = await Effect.runPromise(validateOneBunAuth(headers, 'secret'));
    expect(res.valid).toBe(false);
  });

  it('rejects when timestamp is too old', async () => {
    const applied = await Effect.runPromise(
      applyAuth(
        {
          type: 'onebun', serviceId: 'svc', secretKey: 'secret', algorithm: 'hmac-sha256', 
        },
        baseConfig,
      ),
    );
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(applied.headers || {})) {
      headers[k.toLowerCase()] = String(v);
    }
    headers['x-onebun-method'] = baseConfig.method;
    headers['x-onebun-url'] = baseConfig.url;
    // Set timestamp to a very old value
    headers['x-onebun-timestamp'] = String(Date.now() - 10 * 60 * 1000);
    const res = await Effect.runPromise(validateOneBunAuth(headers, 'secret', 1000));
    expect(res.valid).toBe(false);
  });
});
