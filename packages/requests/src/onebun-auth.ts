/**
 * OneBun inter-service HMAC authentication, version 1.
 *
 * ## What this replaces, and why the wire format had to change
 *
 * The previous scheme signed `[method, url, timestamp, nonce, serviceId]` and verified a payload
 * rebuilt from `x-onebun-method` and `x-onebun-url` — two headers no client ever sent. The
 * verifier therefore always reconstructed `GET` + `/`, so only a literal `GET /` could validate;
 * every request worth protecting failed. It also signed neither the query string nor the body,
 * compared signatures with `===`, and generated a nonce it never recorded, so a captured header
 * set replayed cleanly for the whole freshness window.
 *
 * Fixing any one of those changes what goes on the wire, so they are fixed together and the
 * format carries an explicit `v=1` — an old caller against a new callee fails loudly with
 * `legacy-unversioned-signature` rather than mysteriously.
 *
 * ## Wire format
 *
 * One self-describing header replaces the previous five:
 *
 * ```
 * X-OneBun-Signature: v=1;svc=<id>;kid=<id>;alg=<alg>;aud=<id>;ts=<ms>;nonce=<32 hex>;sig=<hex>
 * ```
 *
 * There is exactly one legal serialization. The verifier matches the whole value against one
 * anchored expression — no lenient parsing, no whitespace tolerance, no reordering, no optional
 * elements. A parser that accepts more than one spelling of the same claim is a parser that lets
 * an attacker choose the spelling.
 *
 * ## Signature base
 *
 * Fields are length-prefixed and the arity is fixed at seven:
 *
 * ```
 * f(s)  = <utf8 byte length> ":" s
 * base  = "OneBun-Auth-v1" LF f(params) LF f(method) LF f(path) LF f(query) LF f(contentType) LF f(bodyHash)
 * ```
 *
 * The length prefix is what makes the encoding injective, not an escaping rule and not the
 * grammar: a reader takes decimal digits up to `:` and then exactly that many UTF-8 bytes, so no
 * value can be smuggled across a field boundary however many delimiters it contains.
 * Newline-joining alone would not do this — a service id containing a newline could impersonate a
 * whole field.
 *
 * `params` is the wire text up to but excluding `;sig=`, taken **verbatim** rather than
 * re-serialized from the parsed claim. That removes the entire class of bugs where signer and
 * verifier serialize the same claim differently, and makes every parameter — version, service,
 * key id, algorithm, audience, timestamp, nonce — tamper-evident in one field. Feeding
 * attacker-controlled bytes back into the base is safe twice over: the anchored grammar has
 * already run, and the length prefix means even a future loosening of that grammar cannot merge
 * `params` into `method`.
 *
 * @see docs:api/requests.md
 */

import { timingSafeEqual } from 'node:crypto';

import { Effect } from 'effect';

// ============================================================================
// Constants
// ============================================================================

/** Domain separator. Appears both as the first base line and as the key-derivation label. */
const SCHEME_LABEL = 'OneBun-Auth-v1';

/** Freshness window. One minute, not the previous five — the shorter it is, the less a capture is worth. */
const DEFAULT_MAX_AGE_MS = 60_000;

/** Tolerance for a caller whose clock runs fast. Deliberately much tighter than the freshness window. */
const DEFAULT_MAX_SKEW_MS = 5_000;

/** Entries a single-replica nonce store holds before it starts refusing. */
const DEFAULT_MAX_NONCE_ENTRIES = 100_000;

/** Bytes of randomness in a nonce. */
const NONCE_BYTES = 16;

const SHA256_HEX_LENGTH = 64;
const SHA512_HEX_LENGTH = 128;

/** Answered when the caller failed to authenticate. */
const HTTP_UNAUTHORIZED = 401;

/** Answered when the VERIFIER could not decide — its store is full or unreachable. */
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * The one legal spelling of the header value.
 *
 * Anchored at both ends, fixed element order, no optional whitespace. `aud` may be empty — that is
 * the explicitly-unbound case — and every other element is mandatory.
 */
const HEADER_PATTERN =
  /^v=1;svc=([A-Za-z0-9_.:-]{1,64});kid=([A-Za-z0-9_.:-]{1,64});alg=(hmac-sha256|hmac-sha512);aud=([A-Za-z0-9_.:-]{0,64});ts=([1-9][0-9]{0,14});nonce=([0-9a-f]{32});sig=([0-9a-f]{64,128})$/;

/** A signature from the old scheme: bare hex, no parameters. Diagnosed separately from a bad version. */
const LEGACY_SIGNATURE_PATTERN = /^[0-9a-f]{64}$|^[0-9a-f]{128}$/;

/** A value that names a version this build does not implement. */
const VERSIONED_PREFIX_PATTERN = /^v=[0-9]+;/;

/** Printable ASCII, the only bytes a conforming peer can put in a Content-Type. */
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7E]*$/;

/** SHA-256 of the empty input. The body digest of a request with no body — never a sentinel token. */
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// ============================================================================
// Types
// ============================================================================

export type OneBunAlgorithm = 'hmac-sha256' | 'hmac-sha512';

/**
 * Why a request did not authenticate.
 *
 * For logs and metrics, **not** for the response body: `unknown-key` versus `signature-mismatch`
 * tells an attacker which service ids and key ids exist. A caller should be told only that it
 * failed.
 *
 * @see docs:api/requests.md
 */
export type OneBunAuthFailureReason =
  | 'missing-header'
  | 'malformed-header'
  | 'unsupported-version'
  | 'legacy-unversioned-signature'
  | 'algorithm-not-allowed'
  | 'audience-mismatch'
  | 'timestamp-expired'
  | 'timestamp-in-future'
  | 'unknown-key'
  | 'signature-mismatch'
  | 'replayed'
  | 'nonce-store-full'
  | 'nonce-store-unavailable';

/**
 * Outcome of verification.
 *
 * `serviceId` is present whenever the header parsed, so a failure can be attributed in logs — but
 * it is only trustworthy when `valid` is true, because until the MAC checks out it is a claim.
 *
 * @see docs:api/requests.md
 */
export interface OneBunAuthResult {
  valid: boolean;
  serviceId?: string;
  keyId?: string;
  reason?: OneBunAuthFailureReason;
}

/** What `remember` reports back. `duplicate` is an attack; `full` and `unavailable` are operations. */
export type OneBunNonceOutcome = 'stored' | 'duplicate' | 'full' | 'unavailable';

/**
 * What a nonce store must do.
 *
 * `remember` is a compare-and-set: it stores the key if absent and reports which happened. The
 * four outcomes are distinct on purpose — conflating them turns an outage into a reported attack.
 *
 * `nowMs` is passed in rather than read by the store. The verifier is the only place that decides
 * what time it is, so a store cannot disagree with the freshness check that just ran — and a
 * store that fetched its own clock would be untestable against an injected one. A Redis
 * implementation wants the same value anyway, to compute `PX` as `expiresAtMs - nowMs`.
 *
 * @see docs:api/requests.md
 */
export interface OneBunNonceStore {
  remember(key: string, expiresAtMs: number, nowMs: number): Promise<OneBunNonceOutcome>;
}

/** Resolves the shared secret for a (serviceId, keyId) pair. Return `undefined` for unknown. */
export type OneBunSecretResolver = (serviceId: string, keyId: string) => string | undefined;

/**
 * Verifier configuration.
 *
 * `audience` and `nonceStore` are REQUIRED, and `false` is a legal value for each. That is
 * deliberate: both defend against attacks that a default would silently leave open, so the choice
 * to go without has to be written down in the caller's own code rather than inherited.
 *
 * @see docs:api/requests.md
 */
export interface OneBunVerifyOptions {
  /** A shared secret, or a resolver when different callers hold different keys. */
  secret: string | OneBunSecretResolver;
  /**
   * Which audience value this verifier accepts, or `false` to accept any.
   *
   * NEVER derive this from the request. `Bun.serve` builds `request.url` from the `Host` header,
   * so a host-derived expectation compares the signed value against an attacker-chosen one and
   * checks nothing. With `false`, a request captured en route to one service can be replayed at
   * another that shares the secret.
   */
  audience: string | readonly string[] | false;
  /** Replay defence, or `false` to accept replays within the freshness window. */
  nonceStore: OneBunNonceStore | false;
  /** Algorithms this verifier accepts. The wire can never widen this. */
  algorithms?: readonly OneBunAlgorithm[];
  /** How old a signature may be. Default 60s. */
  maxAgeMs?: number;
  /** How far ahead a caller's clock may run. Default 5s. */
  maxSkewMs?: number;
  /** Injectable clock, so the window boundaries are testable without waiting. */
  now?: () => number;
}

/**
 * The request being verified.
 *
 * The body arrives as bytes the CALLER has already read. This library deliberately does not read
 * it: the MAC cannot be checked without hashing the body, so whoever reads it is choosing to hash
 * unauthenticated input, and that decision — with its size cap — belongs to the code that owns the
 * server, not to a signing helper.
 *
 * @see docs:api/requests.md
 */
export interface OneBunVerifyInput {
  method: string;
  /** The absolute request URL. Path and query are taken from it with the same parser the signer used. */
  url: string;
  headers: Record<string, string> | Headers;
  body?: Uint8Array | string;
}

/** What the signer needs beyond the credentials. */
export interface OneBunSignInput {
  method: string;
  /** The absolute URL the request will be sent to, with its query already final. */
  url: string;
  contentType?: string;
  body?: Uint8Array | string;
  /** Which callee this signature is for. Omit only when the verifier runs with `audience: false`. */
  audience?: string;
}

/** Test seams. Not part of normal use; both are generated when absent. */
export interface OneBunSignOverrides {
  timestampMs?: number;
  nonce?: string;
}

// ============================================================================
// Canonical base
// ============================================================================

const encoder = new TextEncoder();

/** `<utf8 byte length>:<value>` — the framing that makes the base injective. */
function field(value: string): string {
  return `${encoder.encode(value).length}:${value}`;
}

/**
 * Split an absolute URL into the two parts that get signed.
 *
 * Both ends run this same function on the same string, so there is no canonical form for them to
 * disagree about: the signer signs what it is about to send, and the verifier reads what arrived.
 * The query is signed RAW — not sorted, not re-encoded — because any normalisation is a second
 * grammar that the two sides can implement differently.
 */
function splitUrl(url: string): { path: string; query: string } {
  const parsed = new URL(url);

  return { path: parsed.pathname, query: parsed.search.slice(1) };
}

/** Lowercase hex of a byte array. */
function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

   
  return Array.from(view).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 of the body, on every request and every method.
 *
 * Pinned to SHA-256 even under `hmac-sha512`: the digest is an input to the MAC, not a security
 * boundary of its own, and one algorithm means one answer to "what is the empty-body hash".
 * A missing body hashes to the digest of zero bytes rather than being skipped, so a body cannot be
 * bolted onto a signature made for a request that had none.
 */
async function hashBody(body: Uint8Array | string | undefined): Promise<string> {
  if (body === undefined) {
    return EMPTY_BODY_SHA256;
  }

  const bytes = typeof body === 'string' ? encoder.encode(body) : body;

  if (bytes.length === 0) {
    return EMPTY_BODY_SHA256;
  }

  return toHex(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
}

/** Assemble the seven-field base. `params` is the wire text up to, but excluding, `;sig=`. */
function buildBase(
  params: string,
  method: string,
  path: string,
  query: string,
  contentType: string,
  bodyHash: string,
): string {
  return [
    SCHEME_LABEL,
    field(params),
    field(method),
    field(path),
    field(query),
    field(contentType),
    field(bodyHash),
  ].join('\n');
}

/**
 * Normalise a Content-Type for signing.
 *
 * Trim-only. Lowercasing would be a normalisation the two sides could disagree about, and the
 * value is compared byte for byte rather than parsed, so there is nothing to gain by folding case.
 * A value outside printable ASCII cannot have come from a conforming peer and is signed as empty
 * rather than passed through.
 */
function normalizeContentType(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }

  const trimmed = value.replace(/^[ \t]+|[ \t]+$/g, '');

  return PRINTABLE_ASCII_PATTERN.test(trimmed) ? trimmed : '';
}

// ============================================================================
// MAC
// ============================================================================

/**
 * Derive the MAC key from the shared secret.
 *
 * `K = HMAC(secret, "OneBun-Auth-v1")` domain-separates this scheme, so the same secret used for
 * anything else — a cookie MAC, a webhook signature — cannot produce a value that verifies here.
 * Two lines, and it removes a whole category of cross-protocol confusion.
 */
async function deriveKey(secret: string, algorithm: OneBunAlgorithm): Promise<CryptoKey> {
  const hash = algorithm === 'hmac-sha256' ? 'SHA-256' : 'SHA-512';
  const raw = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const derived = await crypto.subtle.sign(
    'HMAC',
    raw,
    encoder.encode(SCHEME_LABEL) as unknown as ArrayBuffer,
  );

  return await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash }, false, ['sign']);
}

async function macHex(secret: string, algorithm: OneBunAlgorithm, base: string): Promise<string> {
  const key = await deriveKey(secret, algorithm);

  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(base) as unknown as ArrayBuffer));
}

/**
 * Compare two hex signatures without leaking where they first differ.
 *
 * `timingSafeEqual` throws on a length mismatch, so the length is checked first — and a length
 * mismatch is not a secret, since the expected length is fixed by the algorithm the header names.
 */
function signaturesMatch(received: string, expected: string): boolean {
  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(encoder.encode(received), encoder.encode(expected));
}

/** 16 random bytes, hex. */
function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);

  return toHex(bytes);
}

// ============================================================================
// Nonce store
// ============================================================================

/**
 * A bounded, process-local nonce store.
 *
 * **Single replica only.** Behind N replicas a captured request is accepted up to once per
 * replica per freshness window, because each process has its own set. A library that does not own
 * the deployment cannot fix that; what it can do is refuse to hide it, which is why the option is
 * required and this function is named for its limit rather than for its storage.
 *
 * When full it answers `'full'` rather than evicting. LRU eviction would hand an attacker a
 * bypass: flood the store, push out the entry for the request being replayed, replay it. A visible
 * outage is a better failure than a silent bypass.
 *
 * @see docs:api/requests.md
 */
export function makeSingleReplicaNonceStore(
  options: { maxEntries?: number } = {},
): OneBunNonceStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_NONCE_ENTRIES;
  const seen = new Map<string, number>();

  return {
    async remember(key: string, expiresAtMs: number, nowMs: number): Promise<OneBunNonceOutcome> {
      // Sweep on write. Cheap because under a fixed window entries expire in insertion order, so
      // the loop stops at the first live one.
      for (const [entry, expiresAt] of seen) {
        if (expiresAt > nowMs) {
          break;
        }
        seen.delete(entry);
      }

      const existing = seen.get(key);
      if (existing !== undefined && existing > nowMs) {
        return 'duplicate';
      }

      if (seen.size >= maxEntries) {
        return 'full';
      }

      seen.set(key, expiresAtMs);

      return 'stored';
    },
  };
}

// ============================================================================
// Signing
// ============================================================================

/**
 * Produce the `X-OneBun-Signature` value for a request.
 *
 * Sign what is FINAL: the URL with its query already built, the Content-Type that will be sent,
 * and the exact body bytes. Signing a request config before the client finishes assembling it is
 * how the previous scheme came to cover neither the query nor the body.
 *
 * @see docs:api/requests.md
 */
export const signOneBunRequest = (
  credentials: {
    serviceId: string;
    secretKey: string;
    keyId?: string;
    algorithm?: OneBunAlgorithm;
  },
  input: OneBunSignInput,
  overrides: OneBunSignOverrides = {},
): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    async try() {
      const algorithm = credentials.algorithm ?? 'hmac-sha256';
      const keyId = credentials.keyId ?? 'default';
      const timestamp = overrides.timestampMs ?? Date.now();
      const nonce = overrides.nonce ?? generateNonce();
      const { path, query } = splitUrl(input.url);

      const params = `v=1;svc=${credentials.serviceId};kid=${keyId};alg=${algorithm}`
        + `;aud=${input.audience ?? ''};ts=${timestamp};nonce=${nonce}`;

      const base = buildBase(
        params,
        input.method.toUpperCase(),
        path,
        query,
        normalizeContentType(input.contentType),
        await hashBody(input.body),
      );

      return `${params};sig=${await macHex(credentials.secretKey, algorithm, base)}`;
    },
    catch: (error) => new Error(`Failed to sign OneBun auth header: ${error}`),
  });

// ============================================================================
// Verification
// ============================================================================

function readHeader(headers: Record<string, string> | Headers, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }

  return undefined;
}

function fail(
  reason: OneBunAuthFailureReason,
  serviceId?: string,
  keyId?: string,
): OneBunAuthResult {
  return {
    valid: false, reason, serviceId, keyId, 
  };
}

/**
 * Diagnose a header value that does not parse.
 *
 * Three outcomes rather than one, because they mean different things to an operator: an old
 * client, a newer client, and a broken or hostile one.
 */
function diagnoseUnparsable(value: string): OneBunAuthFailureReason {
  if (LEGACY_SIGNATURE_PATTERN.test(value)) {
    return 'legacy-unversioned-signature';
  }

  return VERSIONED_PREFIX_PATTERN.test(value) ? 'unsupported-version' : 'malformed-header';
}

/** Hex length the named algorithm must produce. */
function expectedHexLength(algorithm: OneBunAlgorithm): number {
  return algorithm === 'hmac-sha256' ? SHA256_HEX_LENGTH : SHA512_HEX_LENGTH;
}

/**
 * Verify a OneBun-signed request.
 *
 * The order of the checks is load-bearing, not tidiness. Everything decided before the MAC is
 * decided on public, attacker-supplied data, so returning early there leaks nothing. The nonce is
 * recorded LAST, after the signature is known good: recording it earlier would let anyone burn
 * another service's nonces by sending garbage signatures with guessed values.
 *
 * `unknown-key` still computes one MAC against a placeholder before returning, so how long the
 * answer takes does not tell an attacker which service ids and key ids are configured.
 *
 * @see docs:api/requests.md
 */
export const verifyOneBunRequest = (
  input: OneBunVerifyInput,
  options: OneBunVerifyOptions,
): Effect.Effect<OneBunAuthResult, Error> =>
  Effect.tryPromise({
    async try(): Promise<OneBunAuthResult> {
      const raw = readHeader(input.headers, 'x-onebun-signature');

      if (raw === undefined || raw.length === 0) {
        return fail('missing-header');
      }

      const parsed = raw.match(HEADER_PATTERN);
      if (parsed === null) {
        return fail(diagnoseUnparsable(raw));
      }

      const [, serviceId, keyId, algorithmText, audience, timestampText, nonce, signature] = parsed;
      const algorithm = algorithmText as OneBunAlgorithm;

      // The expression admits 64..128 hex; the algorithm fixes it exactly. Checked before the
      // value reaches anything else, so a truncated signature cannot get as far as the compare.
      if (signature.length !== expectedHexLength(algorithm)) {
        return fail('malformed-header', serviceId, keyId);
      }

      const allowed = options.algorithms ?? (['hmac-sha256', 'hmac-sha512'] as const);
      if (!allowed.includes(algorithm)) {
        return fail('algorithm-not-allowed', serviceId, keyId);
      }

      if (options.audience !== false) {
        const accepted = typeof options.audience === 'string' ? [options.audience] : options.audience;
        if (!accepted.includes(audience)) {
          return fail('audience-mismatch', serviceId, keyId);
        }
      }

      const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
      const maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
      const now = (options.now ?? Date.now)();
      const timestamp = Number(timestampText);

      if (now - timestamp > maxAgeMs) {
        return fail('timestamp-expired', serviceId, keyId);
      }
      if (timestamp - now > maxSkewMs) {
        return fail('timestamp-in-future', serviceId, keyId);
      }

      const secret = typeof options.secret === 'string'
        ? options.secret
        : options.secret(serviceId, keyId);

      const { path, query } = splitUrl(input.url);
      const base = buildBase(
        raw.slice(0, raw.indexOf(';sig=')),
        input.method.toUpperCase(),
        path,
        query,
        normalizeContentType(readHeader(input.headers, 'content-type')),
        await hashBody(input.body),
      );

      if (secret === undefined) {
        // One MAC against a placeholder, discarded. Without it an unknown service id answers
        // measurably faster than a known one with a bad signature, which enumerates both.
        await macHex('unknown-key-placeholder', algorithm, base);

        return fail('unknown-key', serviceId, keyId);
      }

      if (!signaturesMatch(signature, await macHex(secret, algorithm, base))) {
        return fail('signature-mismatch', serviceId, keyId);
      }

      if (options.nonceStore !== false) {
        // `+ 1` so the entry outlives the freshness window by one tick. Freshness rejects at
        // `now - ts > maxAgeMs`, so `now === ts + maxAgeMs` is still FRESH; an entry expiring at
        // exactly `ts + maxAgeMs` would already be gone, and that one tick is a replay window.
        const outcome = await options.nonceStore.remember(
          `${serviceId}\n${keyId}\n${nonce}`,
          timestamp + maxAgeMs + 1,
          now,
        );

        if (outcome === 'duplicate') {
          return fail('replayed', serviceId, keyId);
        }
        if (outcome === 'full') {
          return fail('nonce-store-full', serviceId, keyId);
        }
        if (outcome === 'unavailable') {
          return fail('nonce-store-unavailable', serviceId, keyId);
        }
      }

      return { valid: true, serviceId, keyId };
    },
    catch: (error) => new Error(`Failed to verify OneBun auth header: ${error}`),
  });

/**
 * Map a failure to the status an operator should serve.
 *
 * A store that is full or unreachable is the verifier's problem, not the caller's — answering 401
 * files an availability incident under "someone is attacking us with replays" and sends the
 * on-call to the wrong dashboard.
 *
 * @see docs:api/requests.md
 */
export function oneBunAuthFailureStatus(
  reason: OneBunAuthFailureReason,
): typeof HTTP_UNAUTHORIZED | typeof HTTP_SERVICE_UNAVAILABLE {
  const verifierSideFailures: readonly OneBunAuthFailureReason[] = [
    'nonce-store-full',
    'nonce-store-unavailable',
  ];

  return verifierSideFailures.includes(reason) ? HTTP_SERVICE_UNAVAILABLE : HTTP_UNAUTHORIZED;
}

/** SHA-256 of the empty input, exported so the empty-body case is checkable without recomputing it. */
export const ONEBUN_EMPTY_BODY_SHA256 = EMPTY_BODY_SHA256;
