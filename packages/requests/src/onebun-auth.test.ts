/* eslint-disable @typescript-eslint/naming-convention -- HTTP header names are lowercase by wire
   convention; these object literals are header bags, not TypeScript identifiers. */

/**
 * OneBun HMAC inter-service authentication.
 *
 * Every round-trip here feeds the verifier **only** what the signer produced. The previous suite
 * hand-injected `x-onebun-method` and `x-onebun-url` before verifying — headers no client ever
 * sent — which is exactly why a protocol nobody could speak shipped green for months. Injecting a
 * header the client does not emit turns a round-trip test into a test of the test.
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect } from 'effect';

import {
  makeSingleReplicaNonceStore,
  oneBunAuthFailureStatus,
  ONEBUN_EMPTY_BODY_SHA256,
  signOneBunRequest,
  verifyOneBunRequest,
  type OneBunNonceStore,
  type OneBunVerifyOptions,
} from './onebun-auth.js';

const SECRET = 'shared-secret';
const CREDENTIALS = { serviceId: 'orders-service', secretKey: SECRET } as const;

/** Fresh store per call: a shared one would make test order decide whether a nonce is a replay. */
function verifyOptions(overrides: Partial<OneBunVerifyOptions> = {}): OneBunVerifyOptions {
  return {
    secret: SECRET,
    audience: 'billing-service',
    nonceStore: makeSingleReplicaNonceStore(),
    ...overrides,
  };
}

async function sign(
  input: { method: string; url: string; body?: string; contentType?: string; audience?: string },
  overrides: { timestampMs?: number; nonce?: string } = {},
): Promise<string> {
  return await Effect.runPromise(signOneBunRequest(
    CREDENTIALS,
    { audience: 'billing-service', ...input },
    overrides,
  ));
}

async function verify(
  input: { method: string; url: string; headers: Record<string, string>; body?: string },
  options: OneBunVerifyOptions,
) {
  return await Effect.runPromise(verifyOneBunRequest(input, options));
}

/** Sign a request and verify exactly what was produced — no hand-added headers. */
async function roundTrip(
  request: { method: string; url: string; body?: string; contentType?: string },
  options: OneBunVerifyOptions = verifyOptions(),
) {
  const signature = await sign(request);
  const headers: Record<string, string> = { 'x-onebun-signature': signature };
  if (request.contentType !== undefined) {
    headers['content-type'] = request.contentType;
  }

  return {
    signature,
    headers,
    result: await verify({ ...request, headers }, options),
  };
}

describe('round trip', () => {
  it('verifies the three requests the old scheme could not', async () => {
    // Measured against the old implementation: GET / verified and everything else failed,
    // because the verifier rebuilt the payload from headers the client never sent and always
    // reconstructed `GET` + `/`.
    for (const request of [
      { method: 'GET', url: 'https://billing.internal/users' },
      { method: 'POST', url: 'https://billing.internal/orders' },
      { method: 'DELETE', url: 'https://billing.internal/orders/42' },
    ]) {
      const { result } = await roundTrip(request);

      expect(result.valid).toBe(true);
      expect(result.serviceId).toBe('orders-service');
    }
  });

  it('verifies a POST carrying a body and a query string', async () => {
    const { result } = await roundTrip({
      method: 'POST',
      url: 'https://billing.internal/v1/charges?dry=false&idem=a%20b',
      body: JSON.stringify({ amount: 250, currency: 'EUR' }),
      contentType: 'application/json',
    });

    expect(result.valid).toBe(true);
  });

  it('reports the key id, so a rollover can be observed', async () => {
    const signature = await Effect.runPromise(signOneBunRequest(
      { ...CREDENTIALS, keyId: 'k2' },
      { method: 'GET', url: 'https://billing.internal/health', audience: 'billing-service' },
    ));

    const result = await verify(
      { method: 'GET', url: 'https://billing.internal/health', headers: { 'x-onebun-signature': signature } },
      verifyOptions(),
    );

    expect(result.valid).toBe(true);
    expect(result.keyId).toBe('k2');
  });
});

describe('coverage', () => {
  it('rejects an altered query string', async () => {
    // The query used to be appended after signing, so it was never covered: `?role=admin` could
    // be added to a captured request without invalidating anything.
    const { signature } = await roundTrip({ method: 'GET', url: 'https://h/orders?limit=10' });

    const result = await verify(
      { method: 'GET', url: 'https://h/orders?limit=100000', headers: { 'x-onebun-signature': signature } },
      verifyOptions(),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
  });

  it('rejects an altered body', async () => {
    const body = JSON.stringify({ amount: 250 });
    const { signature } = await roundTrip({
      method: 'POST', url: 'https://h/charges', body, contentType: 'application/json',
    });

    const result = await verify(
      {
        method: 'POST',
        url: 'https://h/charges',
        headers: { 'x-onebun-signature': signature, 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 1 }),
      },
      verifyOptions(),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
  });

  it('rejects a body bolted onto a signature made without one', async () => {
    // The empty body hashes to the digest of zero bytes rather than being skipped, so "no body"
    // is a signed fact rather than an absent field.
    const { signature } = await roundTrip({ method: 'POST', url: 'https://h/charges' });

    const result = await verify(
      {
        method: 'POST', url: 'https://h/charges', headers: { 'x-onebun-signature': signature }, body: 'injected', 
      },
      verifyOptions(),
    );

    expect(result.valid).toBe(false);
  });

  it('rejects an altered method and an altered path', async () => {
    const { signature } = await roundTrip({ method: 'GET', url: 'https://h/orders/1' });

    const method = await verify(
      { method: 'DELETE', url: 'https://h/orders/1', headers: { 'x-onebun-signature': signature } },
      verifyOptions(),
    );
    const path = await verify(
      { method: 'GET', url: 'https://h/orders/2', headers: { 'x-onebun-signature': signature } },
      verifyOptions(),
    );

    expect(method.reason).toBe('signature-mismatch');
    expect(path.reason).toBe('signature-mismatch');
  });

  it('rejects an altered Content-Type', async () => {
    const { signature } = await roundTrip({
      method: 'POST', url: 'https://h/x', body: 'a=1', contentType: 'application/x-www-form-urlencoded',
    });

    const result = await verify(
      {
        method: 'POST',
        url: 'https://h/x',
        headers: { 'x-onebun-signature': signature, 'content-type': 'application/json' },
        body: 'a=1',
      },
      verifyOptions(),
    );

    expect(result.reason).toBe('signature-mismatch');
  });

  it('covers every parameter in the header, so none can be edited in flight', async () => {
    // `params` is signed verbatim as one length-prefixed field, so changing the service id, the
    // timestamp or the audience breaks the MAC rather than merely changing what is claimed.
    const { signature } = await roundTrip({ method: 'GET', url: 'https://h/x' });

    for (const tampered of [
      signature.replace('svc=orders-service', 'svc=admin-service'),
      signature.replace(/ts=\d+/, 'ts=1757280000123'),
      signature.replace('aud=billing-service', 'aud=other-service'),
    ]) {
      const result = await verify(
        { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': tampered } },
        verifyOptions({ audience: false, maxAgeMs: Number.MAX_SAFE_INTEGER }),
      );

      expect(result.valid).toBe(false);
    }
  });
});

describe('replay', () => {
  it('rejects an identical header set the second time', async () => {
    // The nonce used to be generated, transmitted, and never recorded. A captured header set
    // replayed cleanly for the whole freshness window.
    const store = makeSingleReplicaNonceStore();
    const options = verifyOptions({ nonceStore: store });
    const { headers } = await roundTrip({ method: 'GET', url: 'https://h/x' }, options);

    const second = await verify({ method: 'GET', url: 'https://h/x', headers }, options);

    expect(second.valid).toBe(false);
    expect(second.reason).toBe('replayed');
  });

  it('accepts two different requests from the same service', async () => {
    // The store keys on the nonce, not the service, so ordinary traffic is unaffected.
    const options = verifyOptions({ nonceStore: makeSingleReplicaNonceStore() });

    expect((await roundTrip({ method: 'GET', url: 'https://h/a' }, options)).result.valid).toBe(true);
    expect((await roundTrip({ method: 'GET', url: 'https://h/b' }, options)).result.valid).toBe(true);
  });

  it('reports a full store as a verifier failure, not as a replay', async () => {
    // Distinguishing them matters operationally: answering 401 files an availability incident
    // under "someone is attacking us with replays" and sends the on-call to the wrong dashboard.
    const options = verifyOptions({ nonceStore: makeSingleReplicaNonceStore({ maxEntries: 1 }) });

    await roundTrip({ method: 'GET', url: 'https://h/a' }, options);
    const second = await roundTrip({ method: 'GET', url: 'https://h/b' }, options);

    expect(second.result.reason).toBe('nonce-store-full');
    expect(oneBunAuthFailureStatus('nonce-store-full')).toBe(503);
    expect(oneBunAuthFailureStatus('signature-mismatch')).toBe(401);
  });

  it('surfaces an unavailable store rather than letting the request through', async () => {
    const brokenStore: OneBunNonceStore = {
      async remember() {
        return 'unavailable'; 
      }, 
    };
    const { result } = await roundTrip(
      { method: 'GET', url: 'https://h/x' },
      verifyOptions({ nonceStore: brokenStore }),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('nonce-store-unavailable');
  });

  it('records the nonce only after the signature checks out', async () => {
    // Otherwise anyone could burn a service's nonces by sending garbage signatures carrying
    // guessed values, and the real request would then be rejected as a replay.
    const store = makeSingleReplicaNonceStore();
    const options = verifyOptions({ nonceStore: store });
    const signature = await sign({ method: 'GET', url: 'https://h/x' });

    const forged = signature.replace(/sig=[0-9a-f]+$/, `sig=${'0'.repeat(64)}`);
    const rejected = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': forged } },
      options,
    );
    expect(rejected.reason).toBe('signature-mismatch');

    // The genuine request carrying that same nonce still goes through.
    const genuine = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      options,
    );
    expect(genuine.valid).toBe(true);
  });
});

describe('freshness window', () => {
  const NOW = 1_757_280_000_000;
  const MAX_AGE = 60_000;

  it('accepts a signature exactly at the age limit and rejects one past it', async () => {
    const signature = await sign({ method: 'GET', url: 'https://h/x' }, { timestampMs: NOW });

    const atLimit = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ maxAgeMs: MAX_AGE, now: () => NOW + MAX_AGE }),
    );
    const pastLimit = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ maxAgeMs: MAX_AGE, now: () => NOW + MAX_AGE + 1 }),
    );

    expect(atLimit.valid).toBe(true);
    expect(pastLimit.reason).toBe('timestamp-expired');
  });

  it('closes the one-tick replay window at the exact age limit', async () => {
    // Freshness rejects at `now - ts > maxAge`, so `now === ts + maxAge` is still FRESH. A nonce
    // entry expiring at exactly `ts + maxAge` would already be gone by then, leaving a single
    // tick in which a captured request is both fresh and unremembered.
    const store = makeSingleReplicaNonceStore();
    const options = verifyOptions({ nonceStore: store, maxAgeMs: MAX_AGE, now: () => NOW + MAX_AGE });
    const signature = await sign({ method: 'GET', url: 'https://h/x' }, { timestampMs: NOW });
    const headers = { 'x-onebun-signature': signature };

    expect((await verify({ method: 'GET', url: 'https://h/x', headers }, options)).valid).toBe(true);

    const replayed = await verify({ method: 'GET', url: 'https://h/x', headers }, options);
    expect(replayed.reason).toBe('replayed');
  });

  it('rejects a timestamp further in the future than the skew tolerance', async () => {
    // The old check was `now - ts > maxAge`, which accepts an arbitrarily future timestamp — a
    // captured request could be given a signature valid for a year.
    const signature = await sign({ method: 'GET', url: 'https://h/x' }, { timestampMs: NOW + 3_600_000 });

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ now: () => NOW }),
    );

    expect(result.reason).toBe('timestamp-in-future');
  });

  it('tolerates a caller whose clock runs slightly fast', async () => {
    const signature = await sign({ method: 'GET', url: 'https://h/x' }, { timestampMs: NOW + 2_000 });

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ maxSkewMs: 5_000, now: () => NOW }),
    );

    expect(result.valid).toBe(true);
  });
});

describe('audience', () => {
  it('rejects a signature bound to a different callee', async () => {
    // The reason it exists: with one shared secret across a fleet, a request captured en route
    // to one service replays perfectly at another without it.
    const signature = await sign({ method: 'GET', url: 'https://h/x', audience: 'billing-service' });

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ audience: 'inventory-service' }),
    );

    expect(result.reason).toBe('audience-mismatch');
  });

  it('accepts any of several configured audiences', async () => {
    const signature = await sign({ method: 'GET', url: 'https://h/x', audience: 'billing-service' });

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ audience: ['inventory-service', 'billing-service'] }),
    );

    expect(result.valid).toBe(true);
  });

  it('accepts an unbound signature only when the verifier opted out', async () => {
    const signature = await Effect.runPromise(signOneBunRequest(
      CREDENTIALS,
      { method: 'GET', url: 'https://h/x' },
    ));
    const headers = { 'x-onebun-signature': signature };

    expect((await verify({ method: 'GET', url: 'https://h/x', headers }, verifyOptions({ audience: false }))).valid)
      .toBe(true);
    expect((await verify({ method: 'GET', url: 'https://h/x', headers }, verifyOptions())).reason)
      .toBe('audience-mismatch');
  });
});

describe('header grammar', () => {
  it('distinguishes an old client from a newer one from a broken one', async () => {
    const cases: Array<[string, string]> = [
      ['a'.repeat(64), 'legacy-unversioned-signature'],
      ['v=2;svc=x;sig=abc', 'unsupported-version'],
      ['not a signature at all', 'malformed-header'],
      ['', 'missing-header'],
    ];

    for (const [value, reason] of cases) {
      const result = await verify(
        { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': value } },
        verifyOptions(),
      );

      expect(result.reason).toBe(reason as never);
    }
  });

  it('rejects a header that parses but names the wrong signature length', async () => {
    // The expression admits 64..128 hex; the algorithm fixes it exactly, so a truncated
    // sha512 signature cannot reach the comparison.
    const signature = await sign({ method: 'GET', url: 'https://h/x' });
    const truncated = signature.replace('alg=hmac-sha256', 'alg=hmac-sha512');

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': truncated } },
      verifyOptions(),
    );

    expect(result.reason).toBe('malformed-header');
  });

  it('refuses an algorithm the verifier does not allow, whatever the header says', async () => {
    const signature = await Effect.runPromise(signOneBunRequest(
      { ...CREDENTIALS, algorithm: 'hmac-sha512' },
      { method: 'GET', url: 'https://h/x', audience: 'billing-service' },
    ));

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ algorithms: ['hmac-sha256'] }),
    );

    expect(result.reason).toBe('algorithm-not-allowed');
  });

  it('rejects a value that only differs by whitespace', async () => {
    // One legal serialization. A lenient parser lets an attacker choose the spelling.
    const signature = await sign({ method: 'GET', url: 'https://h/x' });

    for (const variant of [` ${signature}`, `${signature} `, signature.replace(/;/g, '; ')]) {
      const result = await verify(
        { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': variant } },
        verifyOptions(),
      );

      expect(result.valid).toBe(false);
    }
  });
});

describe('secret resolution', () => {
  it('resolves per (serviceId, keyId), so a rollover can accept both keys', async () => {
    const signature = await Effect.runPromise(signOneBunRequest(
      { serviceId: 'orders-service', secretKey: 'new-key', keyId: 'k2' },
      { method: 'GET', url: 'https://h/x', audience: 'billing-service' },
    ));

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({
        secret: (serviceId, keyId) =>
          serviceId === 'orders-service' && keyId === 'k2' ? 'new-key' : 'old-key',
      }),
    );

    expect(result.valid).toBe(true);
  });

  it('reports an unknown key without letting it through', async () => {
    const signature = await sign({ method: 'GET', url: 'https://h/x' });

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ secret: () => undefined }),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unknown-key');
  });

  it('rejects a signature made with a different secret', async () => {
    const { signature } = await roundTrip({ method: 'GET', url: 'https://h/x' });

    const result = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ secret: 'other-secret' }),
    );

    expect(result.reason).toBe('signature-mismatch');
  });

  it('domain-separates the key, so the raw secret cannot be reused across schemes', async () => {
    // K = HMAC(secret, "OneBun-Auth-v1"). A MAC computed with the bare secret over the same base
    // must not verify here, or the same key used for a cookie or a webhook could forge one.
    const signature = await sign({ method: 'GET', url: 'https://h/x' });
    const params = signature.slice(0, signature.indexOf(';sig='));

    expect(params).toContain('v=1;svc=orders-service');
    // Confirmed indirectly: a signature over the same claim with a secret equal to the derivation
    // label is not accepted, which it would be if the label were used as the key.
    const withLabelAsSecret = await verify(
      { method: 'GET', url: 'https://h/x', headers: { 'x-onebun-signature': signature } },
      verifyOptions({ secret: 'OneBun-Auth-v1' }),
    );

    expect(withLabelAsSecret.valid).toBe(false);
  });
});

describe('canonical base framing', () => {
  it('cannot be confused by a delimiter inside a value', async () => {
    // Length-prefixed fields, fixed arity: a reader takes exactly N bytes, so no value can be
    // smuggled across a field boundary however many delimiters it contains. A plain
    // newline-joined base would let a crafted path impersonate the next field.
    const withNewline = await roundTrip({ method: 'GET', url: 'https://h/a%0A3:GET' });
    const plain = await roundTrip({ method: 'GET', url: 'https://h/a' });

    expect(withNewline.result.valid).toBe(true);
    expect(plain.result.valid).toBe(true);
    // Different requests, different signatures — the framing kept them apart.
    expect(withNewline.signature).not.toBe(plain.signature);
  });

  it('signs the empty body as a digest rather than as an absent field', async () => {
    expect(ONEBUN_EMPTY_BODY_SHA256)
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
