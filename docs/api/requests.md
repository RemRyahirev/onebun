---
description: HTTP client with createHttpClient(). Retries, timeouts, error handling. Promise and Effect API. Authentication helpers.
---

# HTTP Client API

Package: `@onebun/requests`

## Overview

OneBun provides a unified HTTP client with:
- Multiple authentication schemes
- Automatic retries with configurable strategies
- Redirects followed without taking credentials to another origin — or refused, or handed back
- An optional cap on the decoded size of a response body
- Request bodies as JSON, as text or as raw bytes
- Binary response bodies as bytes, and response bodies streamed as they arrive
- Integrated tracing and metrics
- Standardized error handling

## Creating HTTP Client

```typescript
import { createHttpClient } from '@onebun/core';

const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 10000,  // 10 seconds
  headers: {
    'Accept': 'application/json',
    'X-Client-Name': 'orders-service',
  },
});
```

Every request of the client carries these headers. Leave `Content-Type` out of them: each body
gets the right one by default (see [Sending bytes](#request-bytes)), and a client-wide
`Content-Type` would label every body, binary ones included, with that one type.

## Basic Requests

### GET

```typescript
// Simple GET
const response = await client.get('/users');

// With query parameters — the second argument *is* the query record
const response = await client.get('/users', { page: 1, limit: 10 });
// GET /users?page=1&limit=10

// With custom headers — an object carrying `method`, `headers`, `timeout`, `auth`, `tracing`,
// `metrics`, `maxResponseBytes`, `responseType` or `connectAddress` is read as per-request config
// instead of as query
const response = await client.get('/users', {
  headers: { 'X-Custom-Header': 'value' },
});

// Both at once: query second, config third
const response = await client.get('/users', { page: 1, limit: 10 }, { timeout: 5000 });

// Config with no query — a third argument makes the second one the query, even `undefined`
const response = await client.get('/users', undefined, { retries: { max: 0 } });
```

`delete`, `head` and `options` take the same three arguments and resolve them by the same rule.
With two arguments, only the nine names above make the object config: every other key is query
data, so `client.get('/login', { redirect: '/home' })` sends `GET /login?redirect=%2Fhome`.
`retries`, `query` and `redirect` are deliberately not on the list, so a config that sets only
those takes the three-argument form, as in the last call above.

::: warning A record someone else wrote goes second of three
One of the nine names makes the whole record config, every other key included, and `url`,
`method` and `connectAddress` are config keys. So never pass a record whose keys you did not
choose — one built from an incoming request's query string, say — as the second of two arguments.
`{ q: 'shoes', tracing: 'x', url: '/admin' }` would call another path (another host, on a client
without `baseUrl`), and `{ q: 'shoes', connectAddress: '10.0.0.5' }` would pick the address the
request connects to; `q` is dropped either way. `client.get('/search', query, {})` keeps the record
query data whatever it holds. A third argument that is `undefined` does not count: it is the
two-argument form.
:::

::: warning Do not wrap the query in a key
`client.get('/users', { params: { page: 1 } })` — and `{ query: { page: 1 } }` just the same —
hands the wrapper object itself to the query builder, producing
`GET /users?params=%5Bobject+Object%5D`. Pass the query record directly. The same applies to
`delete`, `head` and `options`, which share the GET argument shape.
:::

### POST

```typescript
// JSON body — the second argument *is* the payload
const response = await client.post('/users', { name: 'John', email: 'john@example.com' });

// With options — per-request config is the third argument
const response = await client.post('/users', userData, {
  headers: { 'X-Request-ID': requestId },
  timeout: 30000,
});
```

`post`, `put` and `patch` take the payload positionally and never read config out of it. Wrapping
it — `client.post('/users', { body: userData, timeout: 30000 })` — sends
`{"body":{...},"timeout":30000}` as the request body and applies no timeout.

### PUT, PATCH, DELETE

```typescript
// PUT
const response = await client.put('/users/123', { name: 'Updated Name' });

// PATCH
const response = await client.patch('/users/123', { name: 'Partial Update' });

// DELETE
const response = await client.delete('/users/123');
```

### Sending bytes {#request-bytes}

A `Uint8Array`, an `ArrayBuffer` or a `Blob` passed as the payload is sent as its bytes, exactly
as they are. Any other value goes through `JSON.stringify`, and a string is sent as it is.

```typescript
import { createHttpClient } from '@onebun/core';

const storage = createHttpClient({ baseUrl: 'https://storage.example.com' });

// A Uint8Array (a Buffer is one) or an ArrayBuffer: application/octet-stream
const part = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
await storage.put('/uploads/42/parts/1', part);

// A Blob, a file from Bun.file() included: labelled with its own type, image/png here
await storage.put('/avatars/42.png', Bun.file('./avatar.png'));

// A Content-Type of your own is the one sent
await storage.put('/uploads/42/parts/2', part, {
  headers: { 'Content-Type': 'application/vnd.example.chunk' },
});
```

The `Content-Type` a request gets, unless the request's `headers` or the client's `headers` name
one:

| The payload | `Content-Type` |
| --- | --- |
| a string, or any value sent as JSON | `application/json` |
| a `Uint8Array` or an `ArrayBuffer` | `application/octet-stream` |
| a `Blob` | the `Blob`'s `type`, or `application/octet-stream` when it has none |

Exactly one `Content-Type` is sent, and header names are matched in any letter case: the
request's, else the client's, else the default above. A request's `content-type` replaces a
client's `Content-Type` rather than going out beside it, and under `onebun` auth the signature
covers the one that is sent. A binary payload is never labelled `application/json` unless you or
the client's `headers` set that.

**Every attempt sends the same bytes.** A retry, and a `307` or `308` redirect that repeats the
request, send what the first attempt sent, and under [`onebun` auth](#onebun-hmac-inter-service)
each signature covers those bytes. A JSON value is serialized once per call. A `Blob` is read once,
before the first attempt, so a file that changes while a retry waits does not change what the
retry sends. A `Uint8Array` or an `ArrayBuffer` is sent without a copy, so it is the one exception:
leave it unchanged until the call settles, because a change made while a retry waits goes out with
the retry, signed. An empty `Uint8Array`, `ArrayBuffer` or `Blob` is sent as an empty body.

**`timeout` bounds the read of a `Blob` as well.** The read happens before the first attempt; one
that takes longer than `timeout` — a file on a stalled mount, a FIFO nobody writes to — fails with
`TIMEOUT_ERROR`, `code: 0`, `details.phase: 'request-body'`, before anything is sent, and is not
retried.

A body goes out only with `POST`, `PUT` and `PATCH`, as for JSON.

#### Bodies that are refused {#request-body-refused}

Exactly these payloads fail with `REQUEST_CONFIG_ERROR` before anything is sent, instead of going
out as what `JSON.stringify` makes of them — `{}`, `{"0":1,"1":2}`, or a stream's internal state:

| `details.reason` | The payload |
| --- | --- |
| `unsupported-body` | a stream — a `ReadableStream`, a Node.js `Readable` (every Node.js readable stream is one), an async generator object; a typed array other than a `Uint8Array`; a `DataView`; a `SharedArrayBuffer`. `details.type` names it |
| `unserializable-body` | a value `JSON.stringify` throws on, such as a `BigInt` or an object that contains itself. `details.details` is the error |
| `unreadable-body` | a `Blob` whose read fails, such as a `Bun.file()` whose file is missing. `details.details` is the error |

Nothing else is refused. A value with a `toJSON` method is a JSON value whatever else it is:
`URLSearchParams` and `FormData`, which Bun gives a `toJSON` that yields an object of their entries,
go through `JSON.stringify`. So does every other object, as its fields — a data class that also
has an async iterator, such as a cursor or a page, included: only the streams above are refused for
being read as they arrive. A value `JSON.stringify` has no representation for still goes out as
`{}` — a `Map` or a `Set`, say. Convert those yourself: `Object.fromEntries(map)`, `[...set]`.

```typescript
import { Effect } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(
  storage.putEffect('/uploads/42/parts/3', Bun.file('./part.bin').stream()),
));

if (outcome._tag === 'Left' && outcome.left.error === 'REQUEST_CONFIG_ERROR') {
  outcome.left.code;             // 500
  outcome.left.details?.option;  // 'data'
  outcome.left.details?.reason;  // 'unsupported-body'
  outcome.left.details?.type;    // 'ReadableStream'
}
```

A stream can be read only once, so a retry or a repeated redirect would have nothing left to send,
and a signature has to cover the bytes before they go out. Send the `Blob` the stream came from, or
read the stream into a `Uint8Array` first. To send another typed array's bytes, wrap them:
`new Uint8Array(view.buffer, view.byteOffset, view.byteLength)`.

The refusal is never retried and records no metrics: no request was made.

<llm-only>

- `data` is read off the config `auth` produced, so a `custom` auth interceptor that replaces it
  replaces what is sent; the body is worked out once per call, after auth and after the
  `connectAddress` check, and before the first attempt.
- A `Blob` is read whole into memory, once. Send a large file in parts — `file.slice(start, end)`
  is a `Blob` that reads only its range.
- A `Blob` read that outlives `timeout` is abandoned, not cancelled: `Blob` reads take no signal, so
  the read itself may go on in the background after the call has failed.
- `FormData` and `URLSearchParams` are sent as JSON, labelled `application/json`, never as a form:
  a `FormData` file entry becomes `{}`. To send a form body, serialize it yourself —
  `new URLSearchParams(...).toString()` with your own `Content-Type`.
- A Node.js `Buffer` is a `Uint8Array`, so it is sent as its bytes, not as the JSON `Buffer#toJSON`
  produces (`{"type":"Buffer","data":[…]}`).
- With `GET`, `DELETE`, `HEAD` and `OPTIONS` the payload is not sent, and not checked either: a
  stream passed there is not refused. A falsy payload — `''`, `0`, `false`, `null` — sends no body.
- A value `JSON.stringify` turns into nothing, such as a function, sends no body.
- On a `307`/`308` to another origin the body goes along with its `Content-Type` and nothing else
  (see [Credentials stay with their origin](#redirect-headers)). A `301`/`302` answering a `POST`,
  and a `303`, drop the body and its `Content-Type`.
- `REQUEST_CONFIG_ERROR` has `code: 500`, so `req()` and the `RequestsService` Effect API turn it
  into an `InternalServerError`. `details.url` and `details.details` are transport details, left
  out of the body the default exception filter sends. The `TIMEOUT_ERROR` of a `Blob` read carries
  only `details.transport` and `details.phase`.
- `RequestsService`'s `post`, `put` and `patch` send a payload by the same rules.

</llm-only>

## Authentication

### Bearer Token

```typescript
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  auth: {
    type: 'bearer',
    token: 'your-jwt-token',
  },
});
```

### API Key

```typescript
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  auth: {
    type: 'apikey',      // all lowercase — 'apiKey' is not a member of the union
    key: 'X-API-Key',    // the HEADER NAME
    value: 'your-api-key', // the secret
    location: 'header',  // 'header' (default) or 'query'
  },
});
```

::: danger Get the spelling right or the request goes out unauthenticated
`key` is the header name and `value` is the secret — the reverse of what the names suggest at a glance.
And the discriminant is lowercase `'apikey'`: `'apiKey'` matches no member of `AuthConfig`, so
`applyAuth` falls through its `default:` branch and sends the request with **no** auth header at all.
No error, no warning — the call simply arrives unauthenticated and comes back 401.
:::

### Basic Auth

```typescript
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  auth: {
    type: 'basic',
    username: 'user',
    password: 'pass',
  },
});
```

### OneBun HMAC (Inter-service)

Signs each outgoing request so the callee can tell which service sent it.

```typescript
const client = createHttpClient({
  baseUrl: 'https://billing.internal',
  auth: {
    type: 'onebun',
    serviceId: 'orders-service',
    secretKey: 'shared-secret',
    audience: 'billing-service',
  },
});
```

The client attaches one header:

```
X-OneBun-Signature: v=1;svc=orders-service;kid=default;alg=hmac-sha256;aud=billing-service;ts=…;nonce=…;sig=…
```

#### What the signature covers {#hmac-coverage}

| Covered | Not covered |
|---------|-------------|
| Method | Scheme, host and port — bind `audience` instead |
| Path | Every header except `Content-Type` |
| Query string, exactly as sent | The response |
| `Content-Type` | Request ordering |
| Every byte of the body | Confidentiality |
| The whole parameter line: `svc`, `kid`, `alg`, `aud`, `ts`, `nonce` | |

Because only `Content-Type` is covered, **a verified request tells you who called, and nothing
else.** Derive authorization from the verified `serviceId` alone — not from a second
`Authorization` header, not from `X-Forwarded-For`, not from anything else that arrived unsigned
alongside it.

This scheme authenticates the caller; it does not encrypt. Run it over a transport that provides
confidentiality and response integrity — mTLS, or a service mesh — because an attacker who cannot
forge a single request byte can still rewrite every reply.

#### Verifying on the callee {#hmac-verify}

<!-- typecheck: skip -->
```typescript
import {
  makeSingleReplicaNonceStore,
  oneBunAuthFailureStatus,
  verifyOneBunRequest,
} from '@onebun/requests';

const nonceStore = makeSingleReplicaNonceStore();

const result = await Effect.runPromise(verifyOneBunRequest(
  { method: req.method, url: req.url, headers: req.headers, body: await req.text() },
  { secret: 'shared-secret', audience: 'billing-service', nonceStore },
));

if (!result.valid) {
  // `result.reason` is for YOUR logs. Never put it in the response body: `unknown-key` versus
  // `signature-mismatch` tells an attacker which service ids and key ids exist.
  logger.warn('inter-service auth failed', { reason: result.reason, serviceId: result.serviceId });

  return new Response('Unauthorized', { status: oneBunAuthFailureStatus(result.reason!) });
}
```

`audience` and `nonceStore` are **required**, and `false` is a legal value for each. Both defend
against attacks a default would silently leave open, so going without has to be written down in
your code rather than inherited.

::: warning The body is yours to read, deliberately
`verifyOneBunRequest` takes body bytes you have already read. It cannot check the MAC without
hashing the body, so whoever reads it is choosing to hash unauthenticated input — and that
decision, with its size cap, belongs to the code that owns the server. Cap the read before you
make it.
:::

::: danger One shared secret across a fleet means every service can impersonate every other
The scheme authenticates *a holder of the secret*. If `billing`, `orders` and `inventory` all hold
the same `secretKey`, any one of them can sign a request claiming `svc=` any of the others, and
`audience` does not help — the caller chooses that too.

Use a secret per (caller, callee) pair and resolve it on the verifier:

```typescript
{ secret: (serviceId, keyId) => secretsFor(serviceId)[keyId] }
```
:::

::: warning `makeSingleReplicaNonceStore` is single-replica, as its name says
Behind N replicas a captured request is accepted up to once per replica per freshness window,
because each process keeps its own set. A library that does not own your deployment cannot fix
that. Supply your own `OneBunNonceStore` backed by shared storage when you run more than one
replica — the interface is one method.

When full it refuses rather than evicting. Evicting would hand an attacker a bypass: flood the
store, push out the entry for the request being replayed, replay it.
:::

#### Rotating a secret {#hmac-rotation}

`keyId` travels in the signature, so a verifier can accept the old and the new key at once:

<!-- typecheck: skip -->
```typescript
// Callers move to keyId: 'k2' one at a time; the callee already accepts both.
{ secret: (serviceId, keyId) => keyId === 'k2' ? NEW_SECRET : OLD_SECRET }
```

#### API reference {#hmac-api}

| Symbol | What it is |
|--------|------------|
| `OneBunAuthConfig` | The `auth: { type: 'onebun', … }` shape: `serviceId`, `secretKey`, and the optional `algorithm`, `keyId` and `audience` |
| `signOneBunRequest` | Produces the header value. The client calls it per attempt; call it yourself only when you are not using `createHttpClient` |
| `verifyOneBunRequest` | Verifies a request on the callee |
| `OneBunVerifyInput` | What the verifier needs: `method`, `url`, `headers`, and the body bytes you already read |
| `OneBunVerifyOptions` | `secret`, `audience`, `nonceStore`, plus optional `algorithms`, `maxAgeMs`, `maxSkewMs` and an injectable `now` |
| `OneBunAuthResult` | `{ valid, serviceId?, keyId?, reason? }` |
| `OneBunAuthFailureReason` | The closed set of failure causes, for logs and metrics only |
| `OneBunNonceStore` | One method: `remember(key, expiresAtMs, nowMs)`. The verifier passes its own clock in, so a store cannot disagree with the freshness check that just ran |
| `makeSingleReplicaNonceStore` | The in-process implementation |
| `oneBunAuthFailureStatus` | Maps a reason to 401 or 503 — a full or unreachable store is your outage, not the caller's fault |
| `isSigningAuth` | Whether a scheme signs the request (`onebun`) rather than shaping it (`bearer`, `apikey`, `basic`, `custom`). Drives pipeline order: shaping runs before the URL is built, signing after |

#### HMAC scheme versions {#hmac-v1-migration}

The wire format is version 1 (since 0.6.0), and every signature header carries `v=1`. It is the
only format the client produces and the only one the verifier accepts, so the caller and the
callee must both speak it. Any other value fails with a named reason: an `X-OneBun-Signature`
that holds a bare hex digest, the unversioned format, fails with
`reason: 'legacy-unversioned-signature'`, one that names another version (`v=<n>;…`) fails with
`'unsupported-version'`, and anything else with `'malformed-header'`. The single
`X-OneBun-Signature` header is the whole protocol: `X-OneBun-Service-Id`, `X-OneBun-Timestamp`,
`X-OneBun-Nonce` and `X-OneBun-Algorithm` are neither sent nor read.

There is no `validateOneBunAuth`. Verify with `verifyOneBunRequest`, which takes the request
rather than a header set, because the method, path, query and body it checks are not in a header
set. It compares signatures in constant time. With a `nonceStore` it records each nonce it
accepts, so a captured request is refused when it is replayed; with `nonceStore: false` it
records nothing, and a replay inside the freshness window is accepted.

## Retry Configuration

### Defaults

With no `retries` at all, a client uses:

| Field | Default | Meaning |
| --- | --- | --- |
| `max` | `3` | Retries **after** the first attempt — up to 4 requests in total |
| `delay` | `300` | Base delay in milliseconds |
| `backoff` | `'exponential'` | Waits 300ms, 600ms, 1200ms |
| `factor` | `2` | Multiplier for exponential backoff |
| `retryOn` | `[408, 429, 500, 502, 503, 504]` | Status codes a **server returned** |
| `methods` | `['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']` | Methods allowed to be replayed |
| `retryOnNetworkError` | `true` | Refused / DNS / TLS / reset — no response arrived |
| `retryOnTimeout` | `false` | The client-side timeout fired, before the headers or during the body |

**POST and PATCH are not retried unless you ask for it.** Replaying them creates a second
order, a second charge, a second message. The default list is the idempotent set of
RFC 9110 §9.2.2, the same shape `axios-retry` and `got` use.

A **client-side timeout is not retried either**, for any method: the request may well have
reached the server and been processed, so re-sending it duplicates the effect just as a POST
replay would. A transport failure carries `code: 0` (`TRANSPORT_FAILURE_CODE`) and the error
name `TIMEOUT_ERROR`, `ABORT_ERROR` or `FETCH_ERROR` — it is never reported as a server 500,
so `retryOn` stays a pure list of status codes.

The timeout covers the body too, so a `500` whose body stalls until the timeout is a
`TIMEOUT_ERROR`: `retryOnTimeout` decides whether it is replayed, and `retryOn` never sees it.
A `500` that arrives whole is a server answer and follows `retryOn`, even when its body does not
parse. See [Timeouts and interruption](#timeouts-and-interruption). The exception is a request under
[`maxResponseBytes`](#max-response-bytes): a `5xx` whose body is over the limit
([`RESPONSE_TOO_LARGE`](#response-too-large)) or cannot be decoded
([`RESPONSE_DECODE_ERROR`](#response-decode-error)) is never replayed.

A network failure is not always a request the server never saw. A refused connection or a failed
DNS lookup is; a connection **reset after the request was sent** is reported the same way
(`FETCH_ERROR`), and that request may have been processed. `retryOnNetworkError` replays both for
the methods in `methods`, which is safe for the idempotent defaults and one more reason to keep
POST and PATCH out unless the endpoint dedupes.

### Overriding

A partial config is merged **field-wise** onto the defaults, so overriding one field keeps
every other one:

```typescript
// max becomes 5; delay stays 300, retryOn still includes 429, POST is still not retried
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  retries: { max: 5 },
});
```

The full shape:

```typescript
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  retries: {
    // Number of retry attempts after the first one
    max: 3,

    // Backoff strategy: 'fixed', 'linear', 'exponential'
    backoff: 'exponential',

    // Base delay in milliseconds
    delay: 300,

    // Multiplier for exponential backoff (default: 2)
    factor: 2,

    // HTTP status codes to retry
    retryOn: [408, 429, 500, 502, 503, 504],

    // Methods allowed to be replayed
    methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],

    // Retry when the connection failed before a response arrived
    retryOnNetworkError: true,

    // Retry when the client-side timeout fired, before the headers or during the body
    retryOnTimeout: false,

    // Callback on retry
    onRetry: (error, attempt) => {
      logger.warn(`Retry attempt ${attempt}`, error);
    },
  },
});
```

### Retrying a non-idempotent method

Only opt POST or PATCH in when the endpoint is safe to call twice — because it is guarded by
an idempotency key, or because a duplicate is harmless:

```typescript
// This endpoint dedupes on Idempotency-Key, so a replay is safe
const response = await client.post('/charges', payload, {
  headers: { 'Idempotency-Key': chargeId },
  retries: { methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'POST'] },
});
```

Per-request `retries` merge onto the client's config, which merges onto the defaults.

### Observing retries

Every retry emits a framework-level warning naming the method, URL, attempt number and the
code that triggered it — independently of `onRetry`. After the fact, both success and error
responses carry `retryCount`, the number of retries that were spent:

```typescript
const response = await client.get('/reports');

if (response.retryCount && response.retryCount > 0) {
  logger.warn('Upstream needed retries', { retryCount: response.retryCount });
}
```

### Retry Strategies

<!-- typecheck: skip -->
```typescript
// Fixed delay
// Retries after: 1000ms, 1000ms, 1000ms
retries: { max: 3, backoff: 'fixed', delay: 1000 }

// Linear backoff
// Retries after: 1000ms, 2000ms, 3000ms
retries: { max: 3, backoff: 'linear', delay: 1000 }

// Exponential backoff
// Retries after: 1000ms, 2000ms, 4000ms, 8000ms...
retries: { max: 3, backoff: 'exponential', delay: 1000, factor: 2 }
```

## Error Handling

### A failed request rejects

The Promise methods run the underlying Effect with `Effect.runPromise`, and a failure — a 4xx/5xx
the server returned, a timeout, a refused connection — is an Effect *failure*. So `await` on a
failed request **throws**; it never resolves with an `ErrorResponse`:

```typescript
import { isErrorResponse } from '@onebun/core';

const response = await client.get<User>('/users/123');

// The declared type is the `ApiResponse<T>` union, so TypeScript asks you to narrow it before
// reading `result`. The branch itself never runs — a failed request has already thrown.
if (isErrorResponse(response)) {
  throw new Error(response.error);
}

const user = response.result;
```

The failure names itself in `error`, not `message`: `ErrorResponse` has no `message` field — see
[Response Format](#response-format).

### Reading the ErrorResponse

The Effect API puts the failure in the error channel, which is where the `ErrorResponse` is
actually reachable:

```typescript
import { Effect, isErrorResponse } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(client.getEffect<User>('/users/123')));

if (outcome._tag === 'Left') {
  outcome.left.error;       // 'HTTP_ERROR'
  outcome.left.code;        // 404
  outcome.left.details;     // { url, method, duration, headers, details }
  outcome.left.retryCount;  // retries spent before giving up
} else if (!isErrorResponse(outcome.right)) {
  const user = outcome.right.result;
}
```

Staying on the Promise API, the same `ErrorResponse` can be dug out of the rejection — it travels
inside Effect's `FiberFailure`, so it is not on `error.message` and `instanceof` tells you nothing:

```typescript
import { Cause, Runtime } from 'effect';
import { isErrorResponse } from '@onebun/core';

try {
  const response = await client.get<User>('/users/123');
  // ... use response
} catch (error) {
  if (Runtime.isFiberFailure(error)) {
    const failure = Cause.squash(error[Runtime.FiberFailureCauseId]);

    if (isErrorResponse(failure)) {
      // failure.code === 404, failure.error === 'HTTP_ERROR'
    }
  }
}
```

### Mapping upstream failures to framework errors

```typescript
import { Effect, isErrorResponse, NotFoundError, InternalServerError } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  async findById(id: string): Promise<User> {
    const outcome = await Effect.runPromise(
      Effect.either(this.client.getEffect<User>(`/users/${id}`)),
    );

    if (outcome._tag === 'Left') {
      if (outcome.left.code === 404) {
        throw new NotFoundError('User', { id });
      }
      throw new InternalServerError(outcome.left.error, outcome.left.details);
    }

    // Narrows the success channel, which is typed as the `ApiResponse<T>` union
    if (isErrorResponse(outcome.right)) {
      throw new InternalServerError(outcome.right.error);
    }

    return outcome.right.result;
  }
}
```

### An uncaught client error and your caller {#uncaught-client-errors}

A client error that a controller does not catch is answered by the
[default exception filter](./exception-filters.md#default-filter-behaviour). `client.req()` throws a
`OneBunBaseError`, the `RequestsService` Effect API fails with one, and an error you build from a
failure's `details`, as in the example above, carries the client's record as its own. The filter sends a
`OneBunBaseError` whole, `details` included, **except the transport details of an error the client
produced**: what the upstream answered with and where the request went. The upstream sent those to
your application, not to its caller.

| Error | Left out of the caller's body |
|-------|-------------------------------|
| `HTTP_ERROR` | `details.headers` (the upstream's `set-cookie` among them), `details.url` with its query, `details.details` (the upstream's body) |
| `REDIRECT_ERROR` | `details.url`, `details.location` |
| `REQUEST_CONFIG_ERROR` | `details.url`; for a [refused body](#request-body-refused), also `details.details`, the error a serialization or a `Blob` read threw (an `ENOENT` names the file's path) |
| `TIMEOUT_ERROR`, `ABORT_ERROR`, `FETCH_ERROR` | `details.details`, the raw error: Bun's connection error names the request URL |
| `RESPONSE_PARSE_ERROR`, `RESPONSE_READ_ERROR`, `RESPONSE_DECODE_ERROR` | `details.details`: the upstream's body, or the raw error |

The rest of the body is sent: the status, `error`, `code`, `details.method`,
`details.duration`, `details.transport`, and every field of an error you wrote yourself. The error
object keeps everything: only the body the filter serializes leaves the transport details out.

```typescript
import { Controller, Get, Param } from '@onebun/core';
import { createHttpClient } from '@onebun/requests';

const billing = createHttpClient({ baseUrl: 'http://billing.internal:8080' });

@Controller('/invoices')
export class InvoicesController {
  @Get('/:id')
  async findOne(@Param('id') id: string) {
    // Billing answers 404 with its own cookies: the caller gets a 500 REQUEST_FAILED
    return await billing.req('GET', `/invoices/${id}`);
  }
}
```

The caller of `GET /invoices/42` reads the failure's name, status, method and duration, and none of
billing's headers, its body or `http://billing.internal:8080/invoices/42`:

```json
{
  "success": false,
  "error": "REQUEST_FAILED",
  "code": 500,
  "details": {
    "originalError": {
      "_id": "FiberFailure",
      "cause": {
        "_id": "Cause",
        "_tag": "Fail",
        "failure": {
          "success": false,
          "error": "HTTP_ERROR",
          "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
          "code": 404,
          "details": { "duration": 12, "method": "GET" },
          "retryCount": 0
        }
      }
    }
  }
}
```

**`exposeErrorDetails` sends them.** With the application option on, the filter sends such an error
whole, as it sends the stack of an unhandled one: the upstream's `set-cookie`, the URL and its
query, the upstream's body. Turn it on knowingly, in a development configuration you can read.

```typescript
import { OneBunApplication } from '@onebun/core';

const app = new OneBunApplication(AppModule, { exposeErrorDetails: true });
```

**A copy of the client's record is yours.** The filter recognises the record the client built,
wherever it sits: an error whose `details` IS that record keeps the transport details out. A spread
makes a new record, and the filter sends it whole, the upstream's headers and URL included. Pick the
fields your caller should read instead:

```typescript
import { Effect } from '@onebun/core';
import { BadGatewayError } from '@onebun/requests';

const outcome = await Effect.runPromise(Effect.either(billing.getEffect(`/invoices/${id}`)));

if (outcome._tag === 'Left') {
  // Not `{ ...outcome.left.details, invoiceId: id }`: that copy is sent whole
  throw new BadGatewayError('BILLING_UNAVAILABLE', { invoiceId: id, upstreamStatus: outcome.left.code });
}
```

**A failure you return is not an error.** Filters see only what a handler throws. A handler that
returns the client's failure (`return outcome.left`) sends it as its result, inside
`{ success: true, result }`, and sends it whole: the upstream's headers, its body and the URL
included. Throw it, or map it as above.

**A filter of your own** that serializes a `OneBunBaseError` itself leaves the transport details out
with the same replacer the default filter uses:

```typescript
import { createExceptionFilter, OneBunBaseError, withoutTransportDetails } from '@onebun/core';

export const envelopeFilter = createExceptionFilter((error) => {
  if (!(error instanceof OneBunBaseError)) {
    return undefined; // not ours: the next filter out answers
  }

  return new Response(JSON.stringify(error.toErrorResponse(), withoutTransportDetails), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

<llm-only>

- The client registers each error record it builds, with the keys that hold transport details, in a
  `WeakMap` kept on `globalThis` under `Symbol.for('onebun:requests-transport-details')`. Nothing is
  added to the record: it reads, compares (`toEqual`), prints and snapshots as any plain record
  does. Two copies of `@onebun/requests` in one process share the registry.
- `withoutTransportDetails` is a `JSON.stringify` replacer. `JSON.stringify` hands it every value
  after `toJSON`, so it finds the client's record at any depth: under `details.originalError`, where
  `req()` puts the `FiberFailure` whose `toJSON` keeps a reference to the failure, and as the
  `details` of an error built from `outcome.left.details` or by `OneBunBaseError.fromErrorResponse`.
- It drops only the registered keys of a registered record, and returns every other value as it got
  it. An error you write yourself with `details: { headers, url }` is sent whole: those are yours.
- A copy is not registered: `{ ...details }`, `Object.assign({}, details)`, `structuredClone`, a
  JSON round trip. Code that rebuilds a client failure into another error must pass the record by
  reference, or pick fields.
- An upstream OneBun service's own error envelope (`{ success: false, error, code, details }` parsed
  from its body) is not a transport detail: it is propagated as the error, `details` and all.
  `RESPONSE_PARSE_ERROR` with `details: 'Response text is empty'` is the client's own text
  and is not withheld either.
- Rejections of the Promise API (`client.get()`, `RequestsService.get()`, the service client) are a
  `FiberFailure`, which is not a `OneBunBaseError`: the default filter answers it as any unhandled
  error, `'Internal Server Error'` and empty `details`. Under `exposeErrorDetails` its message, the
  failure's JSON, goes out whole like any unhandled error's message.
- The application does not log a `OneBunBaseError` before the filter runs, so with the flag off the
  transport details reach neither the body nor the log. Catch the error and log what you need.
- Where the transport details sit: `req()`'s `REQUEST_FAILED` carries the upstream's last
  `set-cookie`, its other headers, its body and the full request URL under
  `details.originalError.cause.failure.details`, and an error built from a failure's `details`
  (the `RequestsService` Effect API, `fromErrorResponse`, the mapping example above) carries them
  at the top of `details`. The replacer leaves them out in both places.

</llm-only>

### Timeouts and interruption

`timeout` bounds the whole response, **body included**. `fetch` resolves as soon as the status
line and headers arrive, and the body is read afterwards under the same deadline. Whichever part
it catches, the call fails with `TIMEOUT_ERROR` and `code: 0`. When the headers had already
arrived, `details.phase` is `'body'` and `details.statusCode` is the status they carried:

```typescript
import { Effect } from '@onebun/core';
import { getTransportFailureKind } from '@onebun/requests';

const outcome = await Effect.runPromise(
  Effect.either(client.getEffect('/reports/export', { timeout: 5000 })),
);

if (outcome._tag === 'Left' && getTransportFailureKind(outcome.left) === 'timeout') {
  outcome.left.error;               // 'TIMEOUT_ERROR'
  outcome.left.code;                // 0
  outcome.left.details?.phase;      // 'body' once the headers had arrived
  outcome.left.details?.statusCode; // the status that arrived, e.g. 200 or 500
}
```

The upstream sees the connection close when the timeout fires, in either phase.

A request whose payload is a `Blob` reads it first, under the same `timeout` (see
[Sending bytes](#request-bytes)). A read that outlives it fails with `TIMEOUT_ERROR`, `code: 0` and
`details.phase: 'request-body'`. Unlike the two phases above, nothing was sent: the upstream never
saw the request, and the error is not retried.

A streamed response is the exception: under `responseType: 'stream'`, `timeout` bounds each wait
on the upstream rather than the whole response (see [Streaming a response](#response-stream)).

A `500` whose body stalls is therefore a timeout, not a `500`: the status arrived, the response did
not, and `retryOnTimeout` — off by default — decides whether it is replayed.

<llm-only>

`details.phase` tells the three timeouts apart: none — before the headers, the request may have
been processed; `'body'` — the headers had arrived; `'request-body'` — the `Blob` payload was still
being read and nothing went out.

A timeout during the body read is never a `RESPONSE_READ_ERROR` or a `RESPONSE_PARSE_ERROR`, and
its `code` is `0`, not the status: a stalled 200 does not look like a malformed body, and a stalled
500 is not replayed by `retryOn`, only by `retryOnTimeout`. To detect a slow upstream, match
`getTransportFailureKind(e) === 'timeout'`, not an error name or a status; `details.statusCode`
keeps the status.

</llm-only>

**Interrupting the Effect aborts the request.** `Effect.timeout`, `Effect.race` or
`Fiber.interrupt` around any `*Effect` method cancels the `fetch` itself — before the headers or
in the middle of the body — so the upstream sees the connection close at once, not at the
client's own `timeout`:

```typescript
import { Effect } from '@onebun/core';

// Aborted after 2 s, although the client's own timeout is 10 s
const outcome = await Effect.runPromise(
  Effect.either(Effect.timeout(client.getEffect('/reports'), '2 seconds')),
);
```

The interrupted Effect reports the interruption (here a `TimeoutException`), not an
`ErrorResponse`. The Promise methods run to completion or to their own `timeout`.

## Redirects

The client follows `301`, `302`, `303`, `307` and `308` itself, up to **20** in one call, and
resolves with the final response — `statusCode` is the final hop's. A relative `Location` is
resolved against the URL that answered it. The method changes the way `fetch` changes it:

| Answer | Next request |
| --- | --- |
| `301` or `302` to a `POST` | `GET`, without the body and without `Content-Type` |
| `303` to anything but `GET` or `HEAD` | `GET`, without the body and without `Content-Type` |
| `307` or `308` | the same method with the same body bytes |

Any other method answered `301` or `302` keeps its method and body.

The chain is one request as far as the options go. `timeout` bounds all of its hops together, not
each one. Interrupting the Effect aborts whichever hop is in flight. A retry replays the chain from
the original URL. The metrics sink gets one record for the chain, not one per hop, with the
original URL and the final status.

That is the default `'follow'` policy. To refuse redirects, or to handle them yourself, see
[Redirect policy](#redirect-policy).

### Credentials stay with their origin {#redirect-headers}

A hop to the **same origin** — same scheme, host and port — carries every header of the original
request. Only an `onebun` signature may change: see [Signed requests](#redirect-signing). A hop
to **any other origin** carries only these:

- `User-Agent`, `Accept` and `Accept-Encoding`
- `traceparent`, `X-Trace-Id` and `X-Span-Id`
- `Content-Type`, while the hop still sends a body (`307`, `308`)

Every other header is dropped. That covers `Authorization` (bearer and basic), the `apikey` header,
`custom` auth headers, `X-OneBun-Signature`, `Cookie` and `Proxy-Authorization`. It also covers
every header set through `RequestsOptions.headers` or `config.headers`, credential or not, such as
`Accept-Language` or `X-Request-Id`. `127.0.0.1` and `localhost` are different origins, and so
are two ports of one host. A header a hop dropped stays dropped, even when the chain comes back
to the first origin.

```typescript
import { createHttpClient } from '@onebun/core';

const api = createHttpClient({
  baseUrl: 'https://api.example.com',
  auth: { type: 'apikey', key: 'X-Api-Key', value: apiKey },
});

// /v1/files/42 answers 302 to https://cdn.example.net/files/42. The CDN request carries
// User-Agent, Accept and the trace headers, never X-Api-Key.
const file = await api.get('/v1/files/42');
```

If the other origin needs credentials, call it with a client of its own.

An `apikey` with `location: 'query'` is part of the URL, so whether it reaches the next hop depends
on whether the redirecting server's `Location` repeats it.

### Signed requests {#redirect-signing}

`onebun` auth signs the method, URL and body of a request. A redirect to the same origin changes
at least the URL, so the original signature does not verify there. When the auth names an
`audience`, the client signs each same-origin hop afresh, over the method, URL and body that hop
sends:

```typescript
import { createHttpClient } from '@onebun/core';

const billing = createHttpClient({
  baseUrl: 'http://billing:3000',
  auth: {
    type: 'onebun',
    serviceId: 'orders-service',
    secretKey: process.env.BILLING_SECRET ?? '',
    audience: 'billing',
  },
});

// /v1/invoices answers 307 to /v2/invoices. The second request carries a signature over
// POST /v2/invoices and the same body, with a fresh timestamp and nonce, so billing verifies
// it as it verified the first.
await billing.post('/v1/invoices', { orderId: 42 });
```

Without an `audience` a same-origin hop carries the original signature unchanged, and the callee
rejects it with `signature-mismatch`. Set an `audience`, or call the final URL directly. A hop to
another origin carries no signature at all, re-signed or not, and neither does any hop after it,
even one that comes back to the first origin.

Following a redirect gives whoever sent it a fresh signature for a method, path and body of its
choosing on that origin. An `audience` makes that signature valid only at the callee it names, which
is why a hop is re-signed only when there is one.

### Redirect policy {#redirect-policy}

`redirect` decides what a `301`, `302`, `303`, `307` or `308` leads to. Set it on the client, or
on one request:

- `'follow'` — the default: follow it, as described above.
- `'error'` — fail with [`REDIRECT_ERROR`](#redirect-error), `details.reason: 'refused-by-policy'`.
  The `Location` is not contacted, and the error is never retried.
- `'manual'` — resolve with the redirect itself: a success whose `statusCode` is the `3xx` and
  whose `headers.location` is the `Location`, exactly as the server sent it.

The option's type is `RedirectPolicy`, exported by `@onebun/requests`.

```typescript
import { createHttpClient } from '@onebun/core';

const client = createHttpClient({ baseUrl: 'https://api.example.com', redirect: 'error' });

// Hand this one redirect back instead of failing on it
const login = await client.post('/login', { user: 'ada' }, { redirect: 'manual' });

if (login.success && login.statusCode === 302) {
  login.headers?.location; // e.g. '/dashboard', relative as the server sent it
}

// get, delete, head and options take the policy in their third argument
const report = await client.get('/reports/latest', undefined, { redirect: 'follow' });
```

A request's own `redirect` wins over the client's. `redirect` is not one of the config markers, so
`client.get('/login', { redirect: '/home' })` sends `GET /login?redirect=%2Fhome`. Pass the
policy in the third argument, as in the last call above.

Under `'manual'` the body of the `3xx` is read like any other body, under
[`maxResponseBytes`](#max-response-bytes) too, and becomes `result`. An empty one that says
`Content-Type: application/json` resolves with `result: undefined` instead of failing, so the
`Location` is still there to read. A `Location` that is relative stays relative: resolve it
against the URL you called, for example with `new URL(location, 'https://api.example.com/login')`.

`RequestsService` methods return `result` alone, so under `'manual'` they resolve with the body of
the `3xx`, and its status and `Location` are out of reach. Read a redirect through `HttpClient`, as
above.

### REDIRECT_ERROR {#redirect-error}

A redirect the client cannot follow, or may not, fails with `REDIRECT_ERROR`, and `code` is the
`3xx` that was not followed. It is never retried, whatever `retryOn` lists: asking again gets the
same redirect.

```typescript
import { Effect } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(client.getEffect('/files/42')));

if (outcome._tag === 'Left' && outcome.left.error === 'REDIRECT_ERROR') {
  outcome.left.code;               // the 3xx that was not followed, e.g. 302
  outcome.left.details?.reason;    // 'too-many-redirects' | 'missing-location' | 'invalid-location'
                                   // | 'refused-by-policy' | 'other-host'
  outcome.left.details?.location;  // the Location header, when there was one
  outcome.left.details?.redirects; // how many redirects this call had followed
}
```

- `too-many-redirects` — the answer that would have been the 21st redirect
- `missing-location` — a `301`, `302`, `303`, `307` or `308` without a `Location`
- `invalid-location` — a `Location` that is not a URL, or not an `http:` or `https:` one
- `refused-by-policy` — any of the five under `redirect: 'error'`, with or without a `Location`;
  `redirects` is `0`
- `other-host` — under [`connectAddress`](#connect-address), a `Location` on another host

Any other `3xx` is an answer, not a redirect, and its `Location` is not followed, under every
policy — a `304`, for one, resolves as a success (see
[Responses without a body](#responses-without-a-body)).

<llm-only>

The client follows redirects itself: each hop is a `fetch` with `redirect: 'manual'`, so the
header safelist of [Credentials stay with their origin](#redirect-headers) applies to every hop,
a `307` that re-sends a `POST` body to another origin included. The service client gets the same
through `RequestsOptions`. A redirect target on another origin receives no credential and
typically answers 401: call that origin with its own client.

A redirect loop, a `Location` that is not an http(s) URL and a redirect status without a
`Location` are all `REDIRECT_ERROR`, never a `FETCH_ERROR` or an `HTTP_ERROR`, so neither
`retryOnNetworkError` nor `retryOn` replays them. A loop costs 21 requests, once.

Redirect policy:

- `redirect` exists since 0.8.2. Its default, `'follow'`, follows every redirect.
- A same-origin hop under `onebun` auth verifies only when the auth names an `audience`. Without
  one it carries the original signature and fails with `signature-mismatch`.
- `redirect` is deliberately not a config marker of the two-argument `get`/`delete`/`head`/
  `options` form: `?redirect=` is a common query parameter (a login flow's return path), and
  making it a marker would silently turn that query into config.
- `'error'` refuses before the `Location` is parsed, so a missing or unusable `Location` is
  `refused-by-policy` too. `details.url` is the URL that answered. The metrics record carries the
  `3xx` with `success: false`.
- `'manual'` hands back only the five statuses the client would follow. A `300` or a `304` is
  treated the same under every policy. The metrics record carries the `3xx` with `success: true`,
  and `req()` returns the body of the `3xx`.
- Under `'manual'` a `3xx` with `Content-Type: application/json` and an empty body resolves with
  `result: undefined`: some gateways answer a redirect that way, and a `RESPONSE_PARSE_ERROR`
  would carry no headers, so the `Location` would be lost. Only a handed-back redirect is exempt: a
  `200` or a `300` with the same headers still fails with `RESPONSE_PARSE_ERROR`, and so does a
  `3xx` whose non-empty body is not the JSON it claims. A server that answers with
  `Response.redirect()` sends no `Content-Type`, and `result` is `''`.
- `RequestsService` takes `redirect` from its options like any other `RequestsOptions` field, and
  per request through the config argument. Its methods return `result` alone, so under `'manual'`
  a handed-back redirect resolves with the body of the `3xx` (`''` or `undefined` when there is
  none), and its status and `Location` cannot be read there. Use `HttpClient`, or the service
  client, which returns the `HttpClient` envelope, to read `statusCode` and `headers.location`.
  `RequestsService` fails a refused redirect with a `OneBunBaseError` whose `error` is
  `REDIRECT_ERROR`, with the `3xx` in `details.status`. The service client takes the policy from
  its options.

</llm-only>

## Limiting the response size {#max-response-bytes}

Without a limit the client reads a body whole, however large it is. `maxResponseBytes` sets one,
in bytes of **decoded** body — on the client for all of its requests, or on one request:

```typescript
import { createHttpClient } from '@onebun/core';

const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  maxResponseBytes: 1024 * 1024, // 1 MiB
});

// Tighter for one call
const status = await client.get('/status', undefined, { maxResponseBytes: 4096 });

// No limit for one call
const archive = await client.get('/exports/latest', undefined, {
  maxResponseBytes: Number.POSITIVE_INFINITY,
});
```

A request's own `maxResponseBytes` wins over the client's. `Infinity` means no limit: that
request is read exactly as one without the option, and `fetch` decompresses it. The option is
config in the two-argument form too: `client.get('/status', { maxResponseBytes: 4096 })`.

The limit is checked while the body is read, never after:

- **Decoded bytes are counted.** A limited request takes the body as it came off the wire and
  undoes `gzip`, `deflate`, `br` and `zstd` itself, counting what comes out. A small compressed
  body that inflates far past the limit, such as a gzip bomb, is stopped at the chunk that crosses
  the limit. It is never inflated whole.
- **A declared size over the limit is refused before reading.** This applies to a body sent
  uncompressed whose `Content-Length` exceeds the limit. A compressed body's `Content-Length` is
  its compressed size, so that body is counted instead.
- **Error statuses are read under the same limit.** A `500` whose body fits is an `HTTP_ERROR`
  with that body in `details.details`, as without a limit. A `500` whose body does not fit fails
  `RESPONSE_TOO_LARGE`.
- **Reading stops at once.** The connection is closed and the upstream sees its response stream
  cancelled.

A limited request sends `Accept-Encoding: gzip, deflate, br, zstd`, the same value `fetch` sends
by itself. An `Accept-Encoding` header you set is sent instead. When the client decoded the body,
neither a success's `headers` nor an `HTTP_ERROR`'s `details.headers` has `content-encoding` or
`content-length`: those describe the compressed bytes, not `result` or `details.details`.

### RESPONSE_TOO_LARGE {#response-too-large}

A body larger than the limit fails with `RESPONSE_TOO_LARGE`. Its `code` is the status that
arrived:

```typescript
import { Effect } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(client.getEffect('/exports/latest')));

if (outcome._tag === 'Left' && outcome.left.error === 'RESPONSE_TOO_LARGE') {
  outcome.left.code;                   // the status that arrived, e.g. 200 or 500
  outcome.left.details?.limit;         // the limit, e.g. 1048576
  outcome.left.details?.received;      // decoded bytes counted when reading stopped
  outcome.left.details?.statusCode;    // the status again
  outcome.left.details?.contentLength; // the declared size, when refused before reading
}
```

The error carries no part of the body. It is never retried, whatever `retryOn` lists: asking
again gets the same body.

### RESPONSE_DECODE_ERROR {#response-decode-error}

A limited request whose body the client cannot decode fails with `RESPONSE_DECODE_ERROR`. `code`
is the status that arrived, and `details.reason` says why:

- `'unsupported-encoding'` — a `Content-Encoding` other than `gzip`, `x-gzip`, `deflate`, `br`,
  `zstd` or `identity`. `details.encoding` names it, and nothing is read.
- `'corrupt-body'` — the decoder rejected the bytes: they were corrupt, the compressed data
  stopped short of its end, or bytes followed its end. `fetch` drops such trailing bytes; the
  client does not.
  `details.encoding` is the `Content-Encoding` header.

```typescript
import { Effect } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(client.getEffect('/legacy/feed')));

if (outcome._tag === 'Left' && outcome.left.error === 'RESPONSE_DECODE_ERROR') {
  outcome.left.details?.reason;   // 'unsupported-encoding' | 'corrupt-body'
  outcome.left.details?.encoding; // e.g. 'x-foo'
}
```

It is never retried either, whatever `retryOn` lists. A request without a limit is decoded by
`fetch`, which hands a body in an unknown coding over as it is.

<llm-only>

- `maxResponseBytes` exists since 0.8.2. Without it a body is read whole, however large, and an
  error status's body is copied whole into `details.details`: a 64 MiB `502` ends up inside the
  error, and so inside whatever logs or serializes it.
- Why the client decodes instead of `fetch`: Bun's automatic decompression inflates a whole
  compressed chunk before a reader sees any of it. Measured on Bun 1.4.2, a 128 MiB gzip of zeros
  (130 KB on the wire) reached a reader that wanted 1 MiB as one 130 MB first chunk, and the
  process grew by 139 MB. With `decompress: false` and `DecompressionStream`, it grew by about
  4 MB. No limit placed on top of `fetch`'s own decompression bounds memory.
- Why there is no default limit: decoding in the client costs throughput (about 20% on a 29 KB
  gzip JSON body, measured through the client on Bun 1.4.2) and changes what the request sends.
  A request without `maxResponseBytes` keeps `fetch`'s path exactly: its own `Accept-Encoding`,
  its own decompression, and `content-encoding`/`content-length` in `headers`. A default limit
  would be a breaking change and is left for 1.0.
- `code` is the status that arrived, as for `RESPONSE_PARSE_ERROR` and `REDIRECT_ERROR`, and
  `getTransportFailureKind()` is `undefined` for both errors. They are excluded from retries by
  name, so `retryOn: [500]` does not replay a `RESPONSE_TOO_LARGE` on a `500`, and `retryOn: [200]`
  does not replay one on a `200`.
- One retry difference with and without a limit: a `503` whose compressed body is broken while its
  framing is complete. Without a limit `fetch`'s decompression fails it as `RESPONSE_READ_ERROR`
  (`RESPONSE_PARSE_ERROR` for a JSON body) with `code: 503`, which `retryOn: [503]` replays. With
  one it is `corrupt-body` and is sent once. A connection that closes mid-body is
  `RESPONSE_READ_ERROR` in both cases and follows `retryOn`.
- `corrupt-body` also covers bytes after the end of the compressed stream. `DecompressionStream`
  rejects them for every coding, and Bun's `fetch` drops them for all but `zstd`. So a server that
  pads its gzip body fails under a limit and succeeds without one. Two whole gzip or zstd members
  back to back are decoded by both.
- `details.received` is the count after the chunk that crossed the limit, so it exceeds `limit` by
  at most one decoded chunk. It is `0` when the body was refused on its `Content-Length`.
- A timeout while a limited body is read is still `TIMEOUT_ERROR` with `code: 0` and
  `details.phase: 'body'`. A decode failure that happens because the signal fired is reported as
  that timeout or abort, not as `corrupt-body`. Interrupting the Effect cancels the upstream
  stream as it does without a limit.
- `deflate` accepts both the zlib-wrapped form (RFC 1950) and raw deflate, told apart by the first
  two bytes, as Bun's `fetch` accepts both. A chain such as `Content-Encoding: deflate, gzip` is
  undone in reverse order; Bun's `fetch` hands such a body over undecoded. An empty body is empty
  whatever its `Content-Encoding` says.
- The offered `Accept-Encoding` is narrowed to the codings this runtime's `DecompressionStream`
  decodes: all four on Bun 1.4.
- A `NaN` limit refuses every non-empty body rather than letting every body through. `Infinity`,
  on the client or on one request, is the same as no limit: `fetch`'s `Accept-Encoding`, its
  decompression, the wire headers. A request that lifts a client's limit this way pays nothing for
  the client's decoder, and a body in an unknown coding comes back as it is.
- The decoded bytes are turned into text as UTF-8, as `response.text()` does.
- `RequestsService` and the service client take it from their options like any other
  `RequestsOptions` field.

</llm-only>

## Response types {#response-types}

A success's `result` is the body parsed as JSON when the response says `application/json`, and
text otherwise. `responseType` asks for something else, per request:

| `responseType` | `result` | The call resolves |
| --- | --- | --- |
| `'auto'` (the default) | parsed JSON, or text | once the whole body has arrived |
| `'bytes'` | a `Uint8Array` of the body, byte for byte | once the whole body has arrived |
| `'stream'` | a `ReadableStream<Uint8Array>` of the body | as soon as the headers arrive |

The option's type is `ResponseType`, exported by `@onebun/requests`. Name the type of `result` as
the call's type argument, as in the examples below.

`responseType` changes only what a success resolves with:

- An error status's body is read as under `'auto'`, so an `HTTP_ERROR` carries the same
  `details.details` whichever mode was asked for.
- An answer to `HEAD`, a `204` and a `304` resolve with `result: undefined` in every mode (see
  [Responses without a body](#responses-without-a-body)).
- [`maxResponseBytes`](#max-response-bytes) applies in every mode, with the body decoded and
  counted by the client.
- `responseType` is one of the config markers, so `client.get('/events', { responseType: 'stream' })`
  is config, not query data.

### Binary bodies {#response-bytes}

Decoding a body as text replaces every byte sequence that is not valid UTF-8 with `U+FFFD`, so an
image, a font, a PDF or a protobuf message comes back corrupted under `'auto'`. `'bytes'` hands
the body over as it is:

```typescript
import { createHttpClient } from '@onebun/core';

const cdn = createHttpClient({ baseUrl: 'https://cdn.example.com' });

const font = await cdn.get<Uint8Array>('/fonts/inter.woff2', undefined, { responseType: 'bytes' });

if (font.success) {
  font.result;                    // Uint8Array
  font.headers?.['content-type']; // 'font/woff2'
}
```

The content coding is undone first, so `result` holds the resource itself, not its `gzip` or `br`
transfer form. A JSON body is not parsed either: `result` is its bytes.

### Streaming a response {#response-stream}

`'stream'` resolves as soon as the status line and headers arrive, with the body as a
`ReadableStream<Uint8Array>` that you read as it comes. Use it for a server-sent event stream, a
long export, or a download you pass on:

```typescript
import { createHttpClient } from '@onebun/core';

const api = createHttpClient({ baseUrl: 'https://api.example.com', timeout: 30_000 });

const feed = await api.get<ReadableStream<Uint8Array>>('/events', undefined, {
  responseType: 'stream',
  headers: { Accept: 'text/event-stream' },
});

if (feed.success) {
  const decoder = new TextDecoder();

  for await (const chunk of feed.result) {
    handleEvents(decoder.decode(chunk, { stream: true }));
  }
}
```

**`timeout` bounds each wait, not the whole response.** A stream may rightly go on for hours, so
under `'stream'` `timeout` bounds:

- the wait for the headers, as for any request, across the whole redirect chain;
- then every read's wait for the next chunk. A read that waits longer errors the stream with
  `TIMEOUT_ERROR`, and the connection is closed.

A stream whose chunks keep coming lives as long as they do, and one that stalls is cut off
`timeout` after its last chunk. Only the time spent waiting on the upstream counts; the time your
code takes between two reads does not. Keep `timeout` above the longest silence the upstream
allows itself, such as its heartbeat interval.

**A failed read rejects with an `ErrorResponse`**, the same record the Effect API fails with:

- `TIMEOUT_ERROR`, `code: 0`, `details.phase: 'body'` — a read waited longer than `timeout`
- `RESPONSE_TOO_LARGE` — under `maxResponseBytes`, at the chunk that takes the count past the
  limit; that chunk is not handed out
- `RESPONSE_DECODE_ERROR` — under `maxResponseBytes`, a body the decoder rejects
- `RESPONSE_READ_ERROR` — the connection broke off mid-body

```typescript
import { getTransportFailureKind, isErrorResponse } from '@onebun/requests';

async function readFeed(feed: ReadableStream<Uint8Array>): Promise<void> {
  try {
    for await (const chunk of feed) {
      handleChunk(chunk);
    }
  } catch (error) {
    if (isErrorResponse(error) && getTransportFailureKind(error) === 'timeout') {
      // The upstream went quiet for longer than `timeout`: reconnect
    }
  }
}
```

Up to the headers, a streamed request is an ordinary one. An error status fails the call with
`HTTP_ERROR` and is retried as `retryOn` says. A body refused before reading under
`maxResponseBytes` fails the call too. Once the stream is handed over, nothing is retried: the
call has resolved, and a failure errors the stream. The metrics record the time to the headers.

**Read the stream to its end, or cancel it.** The connection stays open for as long as the
stream does. `cancel()` on the stream or its reader, or a `break` out of a `for await` loop, closes
the connection, and the upstream sees its stream cancelled.

To pass a body on, return it in a `Response`; the framework sends it
[as it arrives](./controllers.md#custom-response-headers), and when the caller disconnects the
upstream stream is cancelled:

```typescript
import { BaseController, Controller, Get, Param, createHttpClient, isErrorResponse } from '@onebun/core';

@Controller('/files')
export class FilesController extends BaseController {
  private readonly storage = createHttpClient({ baseUrl: 'https://storage.example.com' });

  @Get('/:id')
  async download(@Param('id') id: string): Promise<Response> {
    const file = await this.storage.get<ReadableStream<Uint8Array>>(`/objects/${id}`, undefined, {
      responseType: 'stream',
    });

    if (isErrorResponse(file)) {
      throw new Error(file.error);
    }

    return new Response(file.result, {
      headers: { 'Content-Type': file.headers?.['content-type'] ?? 'application/octet-stream' },
    });
  }
}
```

Pass on `content-type`, never `content-encoding` or `content-length`: `fetch` has already undone
the coding, and those two describe the compressed bytes.

<llm-only>

- `responseType` exists since 0.8.2. Under `'auto'`, the default, a body goes through
  `response.text()` or JSON parsing: a binary body comes back with its non-UTF-8 bytes replaced by
  `U+FFFD` (bytes `[0, 255, 128, 65]` become `"\u0000��A"`), and nothing resolves before
  the whole body has arrived, so a server-sent event stream never resolves at all. Use `'bytes'`
  or `'stream'` for those.
- `responseType` is one of the config markers of the two-argument `get`/`delete`/`head`/`options`
  form, as `maxResponseBytes` is: sent as `?responseType=stream`, it would leave a caller waiting
  for a stream with a string that arrives only once the whole body has. A query that really has a
  `responseType` parameter takes the three-argument form, `get(url, { responseType }, config)`.
  In the two-argument form the whole record is config, so its other keys are not query data
  either: `get('/search', { q: 'cats', responseType: 'json' })` sends `GET /search`, not
  `GET /search?q=cats&responseType=json`. A value other than `'bytes'` or `'stream'` reads as
  `'auto'`.
- Under `'stream'` `timeout` takes what it takes in the other modes, up to 2^53 - 1 ms. The
  countdown is kept in stretches of at most 2^31 - 1 ms, the longest delay `setTimeout` keeps,
  each re-armed for the rest; a single `setTimeout` past that fires after 1 ms, and would have
  failed every streamed call under such a `timeout` at the headers.
- In `'bytes'` and `'stream'` a 2xx JSON body shaped like `{ success: false, error, code }` is
  handed over as it is. Under `'auto'` such a body fails the call with the upstream's error.
- Stream timing: the countdown restarts at every read that has to wait on the upstream, and stops
  when that read gets a chunk, when the stream ends, errors or is cancelled, and whenever nobody is
  reading. The stream is pulled on demand (`highWaterMark: 0`), so nothing is read ahead of the
  caller: time the caller spends on a chunk never counts. A stream that nobody reads or cancels
  keeps its connection open indefinitely.
- A stream's error record is the one a body read of the other modes produces: `TIMEOUT_ERROR` with
  `code: 0`, `details.phase: 'body'`, `details.statusCode` and `getTransportFailureKind()`
  `'timeout'`; `RESPONSE_TOO_LARGE` with `details.limit`, `details.received` and
  `details.statusCode`. It is a plain object, not an `Error`: `isErrorResponse(error)` narrows it.
- Under `'stream'` a timeout during an error status's body read is still `TIMEOUT_ERROR`: that
  body is read within the `timeout` left from the wait for the headers, as it is in every mode.
- Without `maxResponseBytes`, `fetch` decompresses a streamed body itself and keeps
  `content-encoding` and `content-length` in `headers`. With it, the client decodes it, and leaves
  both out. Either way the stream carries decoded bytes.
- Interrupting the `*Effect` call aborts the request while it waits for the headers, as for any
  request. After it has resolved, only the stream controls the connection.
- `RequestsService` methods return `result` alone, so under `'stream'` they resolve with the
  stream itself, and under `'bytes'` with the `Uint8Array`. `req()` returns them too.

</llm-only>

## Connecting to a validated address {#connect-address}

A request to a host name makes `fetch` look the name up. An application that checks where a URL
points before calling it — to refuse private and internal addresses when it fetches a URL a user
supplied, say — checks one lookup, and then `fetch` makes a second one. The two can answer
differently: that is DNS rebinding, and the check guarded nothing. `connectAddress` closes the gap.
Pass the IP address you validated, and the request connects to that address without a lookup:

```typescript
import { lookup } from 'node:dns/promises';

import { createHttpClient } from '@onebun/core';

const client = createHttpClient({ timeout: 5000 });

export async function fetchPreview(url: string) {
  const { address } = await lookup(new URL(url).hostname);

  // Your own policy: private ranges, loopback, link-local, metadata endpoints...
  if (!isAllowedAddress(address)) {
    throw new Error(`${url} resolves to an address this service may not call`);
  }

  return await client.get(url, undefined, { connectAddress: address });
}
```

Only the connection changes. The server sees the request it would see without `connectAddress`:

- **`Host`** is the URL's host, with its port when that is not the scheme's default
  (`a.example.com:8443`). A `Host` header you set yourself is sent as it is.
- **Over HTTPS, the TLS SNI is the URL's host name, and the certificate is verified against that
  name**, not against the address. A server at the address that cannot show a certificate for the
  name fails the request with `FETCH_ERROR` (`ERR_TLS_CERT_ALTNAME_INVALID` in `details.details`).
- **Signing, metrics, retry logs and error details** use the URL with its host name. Only a
  transport failure's `details.details` — the raw error of `fetch` — names the address it
  connected to.
- **Retries** connect to the same address.

The framework checks only that the value is an IP address. Which addresses are allowed is your
application's policy, and so is the lookup.

### Redirects under connectAddress {#connect-address-redirects}

A redirect to the **same host name**, on any port and either scheme, connects to the same address.
A redirect to **another host** fails with [`REDIRECT_ERROR`](#redirect-error),
`details.reason: 'other-host'`, before that host is contacted. The address was validated for one
host name, and another host is one nobody has checked — an IP literal in the `Location` included.
To follow such a redirect, take it with `redirect: 'manual'`, validate its host and call it with a
`connectAddress` of its own.

### Values that are refused {#connect-address-refused}

`connectAddress` is an IPv4 address in four decimal parts, or an IPv6 address without brackets and
without a zone — what `isIP` from `node:net` accepts, and what `dns.lookup` returns. Anything else
fails with `REQUEST_CONFIG_ERROR` before anything is sent:

```typescript
import { Effect } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(
  client.getEffect('https://a.example.com/x', undefined, { connectAddress: 'a.example.com' }),
));

if (outcome._tag === 'Left' && outcome.left.error === 'REQUEST_CONFIG_ERROR') {
  outcome.left.code;             // 500
  outcome.left.details?.option;  // 'connectAddress'
  outcome.left.details?.reason;  // 'not-an-ip' | 'not-an-http-url'
  outcome.left.details?.value;   // 'a.example.com'
}
```

- `not-an-ip` — a host name, `'[::1]'`, `'fe80::1%eth0'`, `'010.0.0.1'`, `'127.1'`, an empty string,
  `null`: only `undefined` means "no `connectAddress`"
- `not-an-http-url` — the URL is not an `http:` or `https:` one, or is not absolute

It is never retried and no metrics are recorded: no request was made. `connectAddress` is one of
the config markers, so `client.get(url, { connectAddress })` is config, not query data.

### Proxies {#connect-address-proxy}

`fetch` reads `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` from the environment, and it sees the
URL with the address in it:

- **`HTTPS_PROXY`**: the proxy receives `CONNECT <address>:<port>`, the IP literal, never the host
  name. Nothing is looked up, but the traffic goes through the proxy, and the SNI inside the tunnel
  is the host name.
- **`HTTP_PROXY`**, for an `http:` URL: the request line names the address
  (`GET http://<address>:<port>/path`) and `Host` the name. Where the proxy connects is up to the
  proxy.
- **`NO_PROXY` is matched against the address**, not the host name. An entry naming the host does
  not exempt the request; an entry naming the address does.

<llm-only>

- `connectAddress` exists since 0.8.2. For every hop the client calls
  `fetch('https://<ip>/…', { headers: { Host: name }, tls: { serverName: name } })`.
- Per request only; `RequestsOptions` has no `connectAddress`. A lookup answer is valid for the
  call it was made for, and a client-wide address would outlive it. The service client has no
  per-call config, so it cannot pin an address; use `HttpClient` for such a call.
- `connectAddress` is one of the config markers of the two-argument `get`/`delete`/`head`/`options`
  form, as `maxResponseBytes` and `responseType` are: sent as `?connectAddress=203.0.113.7`, the
  request would go wherever DNS points, which fails open. In the two-argument form the whole record
  is config, so its other keys are not query data either. A query that really has a
  `connectAddress` parameter takes the three-argument form.
- `isIP` accepts an IPv6 zone (`fe80::1%eth0`), but a URL cannot hold one, and the `URL` hostname
  setter ignores a value it cannot hold without an error, so the request would have gone to the
  host name. The client parses the address as a URL host first and refuses what does not parse.
  `isIP` refuses the IPv4 forms a URL would read differently: `010.0.0.1` would be `8.0.0.1`.
- An IPv6 address is sent in its canonical form: `2001:DB8:0:0:0:0:0:1` becomes `[2001:db8::1]`,
  `::ffff:127.0.0.1` becomes `[::ffff:7f00:1]`.
- `fetch` pools TLS connections per `serverName` (measured on Bun 1.4.2): a connection opened for
  one host name is never reused for another at the same address.
- A URL whose host is itself an IP literal: `tls.serverName` is that IP, so `fetch` sends no SNI
  and verifies the certificate against the URL's IP, whichever address it connects to.
- `REQUEST_CONFIG_ERROR` has `code: 500`, so `OneBunBaseError.fromErrorResponse`, `req()` and the
  `RequestsService` Effect API turn it into an `InternalServerError`. `details.url` is a transport
  detail, left out of the body the default exception filter sends.
- A `custom` auth interceptor that sets `connectAddress` is checked the same way: the value is
  read from the config auth produced. An interceptor may set `connectAddress` or replace the
  caller's, but not remove it: a config it returns without one — rebuilt as
  `{ method, url, headers }` instead of spreading the config it got, or with
  `connectAddress: undefined` — keeps the caller's, so the request never falls back to the lookup.
  Any other per-request key such a config leaves out (`maxResponseBytes`, `timeout`, ...) falls
  back to the client's setting, so spread the config you are given.

</llm-only>

## Request Configuration

Every per-request config argument is a `Partial<RequestConfig>` — `method` and `url` come from the
method you call and the path you pass, so only these fields are yours to set:

<!-- typecheck: skip -->
```typescript
{
  /** Request timeout in milliseconds — covers the body as well as the headers */
  timeout?: number;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Query parameters — `query`, not `params` */
  query?: Record<string, unknown>;

  /** Request body for POST, PUT, PATCH — `data`, not `body`: JSON, a string, or bytes */
  data?: unknown;

  /** Override retry config for this request; merges field-wise onto the defaults */
  retries?: Partial<RetryConfig>;

  /** Override auth for this request */
  auth?: AuthConfig;

  /** Set to `false` to skip the trace headers / the metrics for this one request */
  tracing?: boolean;
  metrics?: boolean;

  /** The largest body this request accepts, in decoded bytes; `Infinity` lifts the client's */
  maxResponseBytes?: number;

  /** What a redirect leads to: 'follow' (the default), 'error' or 'manual' */
  redirect?: 'follow' | 'error' | 'manual';

  /** What a success's `result` is: parsed JSON or text, a Uint8Array, or a ReadableStream */
  responseType?: 'auto' | 'bytes' | 'stream';

  /** The IP address to connect to instead of looking the URL's host name up */
  connectAddress?: string;
}
```

`query` and `data` are what the client reads off a config object, but the way to set them is
positional — `client.get(url, query, config)` and `client.post(url, data, config)`.

The third argument is always the config, whatever the second one holds:
`client.get('/x', undefined, { headers: { … } })` sends the headers. That holds for all seven
methods — `get`, `delete`, `head`, `options`, `post`, `put` and `patch`.

## HTTP Status Codes

```typescript
import { HttpStatusCode } from '@onebun/core';

HttpStatusCode.OK                    // 200
HttpStatusCode.CREATED               // 201
HttpStatusCode.NO_CONTENT            // 204
HttpStatusCode.BAD_REQUEST           // 400
HttpStatusCode.UNAUTHORIZED          // 401
HttpStatusCode.FORBIDDEN             // 403
HttpStatusCode.NOT_FOUND             // 404
HttpStatusCode.CONFLICT              // 409
HttpStatusCode.UNPROCESSABLE_ENTITY  // 422
HttpStatusCode.INTERNAL_SERVER_ERROR // 500
HttpStatusCode.BAD_GATEWAY           // 502
HttpStatusCode.SERVICE_UNAVAILABLE   // 503
```

## Using in Services

```typescript
import { Effect, Service, BaseService, createHttpClient, isErrorResponse } from '@onebun/core';

@Service()
export class ExternalApiService extends BaseService {
  private readonly client;

  constructor() {
    super();
    this.client = createHttpClient({
      baseUrl: this.config.get('external.apiUrl'),
      auth: {
        type: 'bearer',
        token: this.config.get('external.apiToken'),
      },
      retries: {
        max: 3,
        backoff: 'exponential',
        delay: 1000,
      },
    });
  }

  async fetchData(id: string): Promise<ExternalData> {
    this.logger.debug('Fetching external data', { id });

    const outcome = await Effect.runPromise(
      Effect.either(this.client.getEffect<ExternalData>(`/data/${id}`)),
    );

    if (outcome._tag === 'Left') {
      this.logger.error('External API error', {
        id,
        code: outcome.left.code,
        error: outcome.left.error,
      });
      throw new Error(`External API error: ${outcome.left.error}`);
    }

    if (isErrorResponse(outcome.right)) {
      throw new Error(outcome.right.error);
    }

    return outcome.right.result;
  }

  async createResource(data: CreateResourceDto): Promise<Resource> {
    // A failure throws — the caller's exception filter turns it into the error response
    const response = await this.client.post<Resource>('/resources', data);

    if (isErrorResponse(response)) {
      throw new Error(response.error);
    }

    return response.result;
  }
}
```

## Service Client (Inter-service Communication)

`createServiceClient()` calls another OneBun service over HTTP by controller and method name. It is
exported from `@onebun/core` and uses this package's HTTP client as its transport. The routes come
from the callee's module; the types do not: arguments and results are untyped. See
[What the client checks](#service-client-typing).

`createServiceDefinition()` takes the **module class** of the service being called and reflects its
endpoints out of the decorator metadata already on its controllers. There is no literal to
hand-maintain, and no way for the definition to drift from the routes it describes:

```typescript
import { createServiceDefinition, createServiceClient } from '@onebun/core';

import { UsersModule } from './users/users.module';

// Reflected from @Controller/@Get/@Post metadata — nothing to keep in step by hand
export const UsersServiceDefinition = createServiceDefinition(UsersModule);
```

The client is configured with `url` (required), not `baseUrl` — `ServiceClientOptions` deliberately
omits `baseUrl` so the two cannot be confused:

```typescript
// In a service, use this.config.get() for the address and secrets
const usersClient = createServiceClient(UsersServiceDefinition, {
  url: this.config.get('services.usersUrl'),
  serviceName: 'orders-service',
  auth: {
    type: 'onebun',
    serviceId: 'orders-service',
    secretKey: this.config.get('services.secretKey'),
  },
});
```

Controllers are reached by their **class name**. The arguments are the handler's `@Param`, `@Query`
and `@Body` values, passed **positionally** in the order the handler declares those parameters; a
`@Header` or any other parameter the callee reads from its own request takes no argument (see
[Arguments](#service-client-arguments)):

```typescript
// Each call resolves `any`: the response envelope, not the handler's value (see below)
const all = await usersClient.UsersController.findAll();
const found = await usersClient.UsersController.findById('123');
const created = await usersClient.UsersController.create({ name: 'John' });
```

<llm-only>

Three mistakes this section exists to prevent:

- `createServiceDefinition({ name, controllers: {...} })` — an object literal is rejected; the function
  signature is `createServiceDefinition(moduleClass)` and it throws
  `"<X> is not decorated with @Module"` for anything else.
- `{ baseUrl }` instead of `{ url }` — `ServiceClientOptions extends Omit<RequestsOptions, 'baseUrl'>`,
  so `baseUrl` is an excess property AND `url` is missing: two errors, and at runtime the underlying
  client would have `baseUrl: undefined`.
- `client.users.findById({ id: '123' })` — the proxy keys controllers by `controller.name`
  (`UsersController`), and the call takes one positional argument per `@Param`, `@Query` and `@Body`
  parameter, so a wrapper object is stringified into the URL rather than destructured.

</llm-only>

### What the client checks {#service-client-typing}

The client routes by name and checks the names. It does not check types.

| | At compile time | At run time |
|---|---|---|
| Controller name | not checked: `createServiceClient()` returns `Record<string, ControllerClient>` | reading a name the definition lacks throws, and the error lists the controllers there are |
| Method name | not checked: every name of a `ControllerClient` is a method | reading a name the controller lacks throws |
| Path parameter values | not checked | each value is percent-encoded, so it stays in its segment. `null`, `undefined`, `''`, `.` and `..`, which no encoding can send, are refused before anything is sent, see [Path parameter values](#service-client-path-values) |
| Arguments | not checked: every method is `(...args: any[]) => Promise<any>` | one per `@Param`, `@Query` and `@Body` parameter, see [Arguments](#service-client-arguments). Not checked, except that a path parameter left out (`undefined`) or `null` is refused like the other values that cannot be sent in a path. A missing `@Query` or `@Body` argument is not sent, and extra arguments are dropped |
| Query and body values | not checked | a `@Query` array arrives as an array, and the `@Body` value of a `POST`, `PUT` or `PATCH` is sent as JSON, so a string, `0`, `false`, `''` and `null` arrive as passed. A body `JSON.stringify` throws on is refused before anything is sent, see [Query and body values](#service-client-query-body) |
| Result | `any` | not checked against the handler's return type |

The promise resolves the HTTP client's success envelope, and its `result` is the server's own
`{ success, result }` body. The value the handler returned is therefore at `response.result.result`.
A 4xx or 5xx response rejects the promise instead, as described in
[A failed request rejects](#a-failed-request-rejects).

```typescript
interface User {
  id: string;
  name: string;
}

const response = await usersClient.UsersController.findById('123');
// { success: true, result: { success: true, result: { id: '123', name: 'Ada' } }, statusCode: 200, retryCount: 0 }

// The annotation is an assertion: nothing compares it with what the handler returns
const user: User = response.result.result;
```

Keep the expected types next to the call, as above: the client has no way to derive them from the
callee's handlers.

<llm-only>

- There are no typed service clients in OneBun. `ServiceClient<TDef>` and `ControllerClient` are
  string-indexed, and `ServiceDefinition['_controllers']` is `Map<string, ControllerDefinition>`,
  so even `ServiceClient<typeof definition>` accepts every controller name. Do not describe the
  client as type-safe, and do not claim a misspelled method or a wrong argument fails to compile.
- The client is neither typed nor type-safe: the names come from the module at run time, and
  nothing supplies argument or result types.
- `usersClient.users.findById(...)` (a lowercase key) compiles and then throws
  `Controller "users" not found in service definition`. The key is the controller class name.
- `const user = await client.UsersController.findById(id)` compiles and gives the envelope, not the
  entity: read `.result.result`. A 409 or 401 from the callee rejects; the status and details are
  inside the rejection (see "Reading the ErrorResponse").
- The service client, like everything else exported from `@onebun/core`, cannot currently be bundled
  for a browser.

</llm-only>

### Arguments {#service-client-arguments}

A call takes one argument per `@Param`, `@Query` and `@Body` parameter of the handler, in the order
the handler declares them. Those are the only values the client sends. Every other decorated
parameter reads the callee's own request: `@Header`, `@Cookie`, `@Req`, `@Res`, a
[custom extractor](/api/decorators#createhttpparamdecorator), a file or a form field. None of them
takes an argument, wherever it is declared:

```typescript
import {
  BaseController,
  Controller,
  createServiceClient,
  createServiceDefinition,
  Get,
  Header,
  Module,
  Param,
  Query,
} from '@onebun/core';

@Controller('/users')
class UsersController extends BaseController {
  @Get('/:id')
  findById(
    @Header('x-tenant') tenant: string | null,
    @Param('id') id: string,
    @Query('fields') fields?: string,
  ) {
    return { id, tenant, fields };
  }
}

@Module({ controllers: [UsersController] })
class UsersModule {}

const usersClient = createServiceClient(createServiceDefinition(UsersModule), {
  url: 'http://users:3001',
});

// Sends GET /users/123?fields=name. The header takes no argument, and none is sent
await usersClient.UsersController.findById('123', 'name');
```

A missing `@Query` or `@Body` argument is not sent, and extra arguments are dropped. A path value is
sent as its text, percent-encoded: `findById(42)` requests `/users/42`. A parameter with no
decorator is not in the route metadata, so it takes no argument either.

#### Upgrading from 0.8 {#service-client-arguments-upgrade}

Through 0.8 every decorated parameter took an argument, and the client dropped the ones it does not
send. A parameter such as `@Header` declared before a `@Param`, `@Query` or `@Body` therefore
shifted it. The handler above had to be called as `findById(undefined, '123', 'name')`. The natural
`findById('123')` was refused, because `id` read `undefined`, and with a `@Query` or a `@Body` in
that place the request went out without the value. From 0.9, remove the placeholder:

```typescript
// Before: a placeholder in the header's place
await usersClient.UsersController.findById(undefined, '123', 'name');

// After
await usersClient.UsersController.findById('123', 'name');
```

A call that keeps the placeholder does not always fail. The placeholder is now read as the value of
the first `@Param`, `@Query` or `@Body` parameter, each real value as the value of the parameter
after its own, and the last one is dropped as an extra argument. When that first parameter is a
`@Param`, an `undefined` or `null` placeholder is refused with a `TypeError` and nothing is sent.
Any other placeholder, such as a tenant id, is sent as the path value, so the call reaches a
different resource with no error: `findById('acme', '123', 'name')` requests `/users/acme?fields=123`.
When the first parameter is a `@Query` or a `@Body`, the request is sent with the wrong values and no
error: `undefined` sends no value, and any other placeholder is sent as the value. Typecheck cannot
find these calls.

A real value passed in the place of a header, such as an `Authorization` token or a tenant id, was
never sent through 0.8. From 0.9 it is sent as the first path, query or body value, so it can end up
in a URL and in the access logs of the callee and of every proxy in between. Send such a value
through the client's `headers` or `auth` option instead, or let the callee derive it with its own
middleware or guard.

The calls that change are the calls to endpoints with such a parameter declared before a `@Param`,
`@Query` or `@Body`. This lists those endpoints from the callee's module:

```typescript
import { createServiceDefinition, ParamType } from '@onebun/core';

import { UsersModule } from './users/users.module';

const sent = new Set<ParamType>([ParamType.PATH, ParamType.QUERY, ParamType.BODY]);

const changed = createServiceDefinition(UsersModule)._endpoints
  .filter(({ params = [] }) => {
    const lastSent = Math.max(-1, ...params.filter((param) => sent.has(param.type)).map((param) => param.index));

    return params.some((param) => !sent.has(param.type) && param.index < lastSent);
  })
  .map(({ controller, method }) => `${controller}.${method}`);
// ['UsersController.findById']
```

An endpoint without such parameters, or with them only after its last `@Param`, `@Query` and
`@Body`, is called exactly as before.

<llm-only>

- The arguments of a service client call are the handler's `@Param`, `@Query` and `@Body` values in
  declaration order, and nothing else. Never pass a placeholder for a `@Header`, `@Cookie`, `@Req`,
  `@Res`, custom-extractor (`createHttpParamDecorator`), file or form-field parameter: the call
  would read it as the first `@Param`/`@Query`/`@Body` value.
- Through 0.8 every decorated parameter took an argument, so code written for 0.8 against a handler
  that declares such a parameter first may pass `undefined` in its place. Remove it when moving to
  0.9. A leftover placeholder fails loudly only when the first `@Param`/`@Query`/`@Body` parameter
  is a path parameter and the placeholder is `undefined` or `null` (`TypeError`, nothing sent);
  otherwise every value lands one parameter later and the request goes out with no error. A real
  value in that place (a token, a tenant id), which 0.8 silently dropped, is now sent in the path,
  the query string or the body.
- Server-only values reach the callee by other means: a header through the client's `headers`
  option or `auth`, a user or tenant through the callee's own middleware or guard.

</llm-only>

### Path parameter values {#service-client-path-values}

A path parameter value fills exactly one segment of the route. The client converts it to text and
percent-encodes it with `encodeURIComponent`, and the router decodes the segment exactly once, so the
handler's `@Param` receives the value as it was passed: `/`, `\`, `?`, `#`, `%` and whitespace
included. Pass the raw value, and do not encode it yourself.

```typescript
// Sent as GET /users/team%2Falice; the handler's @Param('id') receives 'team/alice'
const member = await usersClient.UsersController.findById('team/alice');

// Sent as GET /users/100%25; the handler receives '100%'
const discount = await usersClient.UsersController.findById('100%');
```

Nothing in a value can move the request to a different route. `'../admin/secret'` as a user id is
sent as `GET /users/..%2Fadmin%2Fsecret` and reaches `findById` with exactly that text; it never
reads `GET /admin/secret` with this client's credentials. Text that only looks encoded is data too:
`'%2e%2e'` is sent as `%252e%252e` and the handler receives `'%2e%2e'`.

A value that no encoding can send as one segment is refused: the call rejects with a `TypeError`
naming the controller, the method and the parameter, and no request is made.

| Refused value | Why |
|---|---|
| `null`, `undefined` | there is no value; it would be sent as the text `null` / `undefined` |
| `''` | an empty segment: the request would reach the sibling route (`GET /users/`) |
| `.`, `..` | dot segments: `.` would reach the sibling route and `..` would climb one level. `encodeURIComponent` leaves `.` alone, and a URL parser reads `%2E` as a dot as well, so every spelling of them is resolved as a dot segment |
| a string with an unpaired UTF-16 surrogate, such as `'\uD800'` | it has no percent-encoding: `encodeURIComponent` throws on it, and a URL parser would replace it with U+FFFD |

Send such a value as a `@Query` parameter or in the `@Body`.

#### Values the caller has already encoded {#service-client-path-values-upgrade}

The client encodes every value, so a value the caller has already percent-encoded is encoded a
second time, and the handler receives the encoded text. Pass the raw value, without
`encodeURIComponent`:

```typescript
// Before: encoded by the caller. From 0.9 this sends GET /users/team%252Falice,
// and the handler receives 'team%2Falice'
await usersClient.UsersController.findById(encodeURIComponent('team/alice'));

// After: the raw value. Sent as GET /users/team%2Falice; the handler receives 'team/alice'
await usersClient.UsersController.findById('team/alice');
```

Values 0.8.2 refused and 0.9 sends as data: anything containing `/`, `\`, `?` or `#`, the `%2e`
spellings of a dot (`%2e`, `%2e%2e`, `.%2E`, `%2E.`), and dots with a tab, a newline or trailing
whitespace (`'.\t.'`, `'.. '`). A `TypeError` from a service client call now means one of the values
in the table above.

The request path changes as well, even for values the handler receives exactly as before.
`encodeURIComponent` also escapes characters that 0.8 sent as they were, among them `@`, `:`, `$`,
`&`, `=`, `+`, `,` and `;`: `'user@example.com'` went out as `/users/user@example.com` and now goes
out as `/users/user%40example.com`. `@Param('id')` receives `'user@example.com'` either way. Only
code on the callee that reads the raw path from the request URL, such as a middleware, a log line or
a proxy rule, sees the encoded form.

<llm-only>

- Pass path arguments raw: `findById(input)`. Never wrap them in `encodeURIComponent` — the client
  encodes every path value, so a caller-encoded `'a%2Fb'` reaches the handler as `'a%2Fb'`, not
  `'a/b'`. Code written for 0.8 that encodes path arguments must drop the call when it moves to 0.9;
  typecheck cannot catch it, because both spellings are strings.
- On the callee, read a path value through `@Param`, which decodes it. The raw request path carries
  the encoded text: `'user@example.com'` appears as `user%40example.com` in
  `new URL(req.url).pathname`.
- Query values are encoded by the client as well (`URLSearchParams`), and bodies are sent as JSON,
  so no service client argument needs caller-side encoding or `JSON.stringify` (see
  [Query and body values](#service-client-query-body)).
- A `TypeError` from a service client call means the arguments, not the network: nothing was sent,
  and retries do not apply. The causes are `null`/`undefined` (typically an omitted positional
  argument or an id read from a missing field), `''`, `.`, `..`, and an unpaired surrogate in a path
  value, and a `@Body` value of a `POST`, `PUT` or `PATCH` that `JSON.stringify` throws on (a BigInt,
  a cyclic object).
- Each `:name` in the route is replaced by the `@Param('name')` argument with exactly that name, so
  `/:idx/:id` gets both values regardless of declaration order. A `:name` with no matching `@Param`
  stays in the URL literally.
- The HMAC signature (`auth: { type: 'onebun' }`) covers the encoded path, which is what both ends
  read from the URL, so encoding does not break signing.

</llm-only>

### Query and body values {#service-client-query-body}

The handler receives each `@Query` and `@Body` value as it was passed, arrays and falsy values
included. A `@Query` array is sent as one `name[]` key per element, which the callee's query parser
reads back as an array, even with a single element. The `@Body` value of a `POST`, `PUT` or `PATCH`
is always sent as JSON, with `Content-Type: application/json`:

```typescript
import {
  BaseController,
  Body,
  Controller,
  createServiceClient,
  createServiceDefinition,
  Get,
  Module,
  Param,
  Put,
  Query,
} from '@onebun/core';

@Controller('/posts')
class PostsController extends BaseController {
  @Get('/')
  findByTags(@Query('tags') tags?: string[]) {
    return { tags };
  }

  @Put('/:id/title')
  rename(@Param('id') id: string, @Body() title: string) {
    return { id, title };
  }

  @Put('/:id/pinned')
  setPinned(@Param('id') id: string, @Body() pinned: boolean) {
    return { id, pinned };
  }
}

@Module({ controllers: [PostsController] })
class PostsModule {}

const postsClient = createServiceClient(createServiceDefinition(PostsModule), {
  url: 'http://posts:3002',
});

// Sent as GET /posts/?tags%5B%5D=news&tags%5B%5D=tech; the handler receives ['news', 'tech']
await postsClient.PostsController.findByTags(['news', 'tech']);

// Sent as GET /posts/?tags%5B%5D=news; the handler receives ['news'], still an array
await postsClient.PostsController.findByTags(['news']);

// The body is "Hello"; the handler receives 'Hello'
await postsClient.PostsController.rename('42', 'Hello');

// The body is false; the handler receives false
await postsClient.PostsController.setPinned('42', false);
```

| Argument | Sent as | The handler receives |
|---|---|---|
| `@Query` `'news'`, `42`, `true` | one key: `tags=news`, `tags=42`, `tags=true` | the text: `'news'`, `'42'`, `'true'` |
| `@Query` `['news', 'tech']` | `tags[]=news&tags[]=tech`, encoded as `tags%5B%5D=...` | `['news', 'tech']` |
| `@Query` `['news']` | `tags[]=news` | `['news']` |
| `@Query` `[]`, `null`, `undefined` | nothing | `undefined` |
| `@Body` `'Hello'` | `"Hello"` | `'Hello'` |
| `@Body` `0`, `false`, `''`, `null` | `0`, `false`, `""`, `null` | the same value |
| `@Body` a plain object, an array, a number | its JSON | an equal value |
| `@Body` `undefined` | no body | `undefined` |
| `@Body` a BigInt, a cyclic object | nothing: the call rejects with a `TypeError` naming the controller and the method | |
| `@Body` any value, on a `GET`, `DELETE`, `HEAD` or `OPTIONS` endpoint | no body | `undefined` |

The elements of a query array are sent as text, and its `null` and `undefined` elements are left
out. Any other query value is sent as `String(value)`, so an object goes out as `[object Object]`:
send structured data in the `@Body`. A `@Body` value that `JSON.stringify` has no text for, such as
a function, sends no body, as `undefined` does. The HTTP client sends a body only with `POST`, `PUT`
and `PATCH`, so a `@Body` of a `GET` or `DELETE` handler is not sent. It is not serialized either: a
BigInt there does not fail the call.

#### Upgrading from 0.8 {#service-client-query-body-upgrade}

Through 0.8 the client handed both values to the HTTP client as they were. That client joins an
array into one key, `tags=news%2Ctech`, so the handler received `'news,tech'`. It also sends a string
body as bare text, which the callee cannot parse as JSON, so `@Body()` received `undefined`, and it
skips a falsy body, so `0`, `false`, `''` and `null` sent no body and `@Body()` received `undefined`
as well.

A handler that split the joined text receives an array from 0.9. Callers on 0.8 keep sending the
text until they are upgraded, so accept both until then:

```typescript
import { BaseController, Controller, Get, Query } from '@onebun/core';

@Controller('/posts')
class PostsController extends BaseController {
  // Before: @Query('tags') tags?: string, split with tags.split(',')
  @Get('/')
  findByTags(@Query('tags') tags?: string | string[]) {
    // An array from a 0.9 caller, the joined text from a caller still on 0.8
    const list = Array.isArray(tags) ? tags : (tags?.split(',') ?? []);

    return { tags: list };
  }
}
```

A `@Query('tags', schema)` whose schema accepts only a string, such as `type('string')`, answers the
array with a 400. Widen it to `type('string[]')`, or `type('string | string[]')` while 0.8 callers
remain.

A caller that serialized the body itself now sends it serialized twice, and the handler receives the
JSON text as a string. Pass the value:

```typescript
// Before: serialized by the caller. From 0.9 the body is "{\"name\":\"Ada\"}",
// and @Body() receives the string '{"name":"Ada"}'
await usersClient.UsersController.create(JSON.stringify({ name: 'Ada' }));

// After: the value. The body is {"name":"Ada"}, and @Body() receives the object
await usersClient.UsersController.create({ name: 'Ada' });
```

A handler that relied on `undefined` for a falsy body now receives the value itself: `false`, `0`,
`''` or `null`. Code on the callee that reads the raw request instead of `@Param`, `@Query` and
`@Body` sees the new wire format: the query keys of an array end in `[]`
(`url.searchParams.getAll('tags[]')`), and a string body arrives in quotes (`await req.text()` gives
`"Hello"`).

Calls that pass a single query value, and a body that is an object, an array, a non-zero number or
`true`, go out exactly as before. A BigInt or cyclic body of a `POST`, `PUT` or `PATCH`, which
through 0.8 rejected with an Effect `FiberFailure` around the error of `JSON.stringify`, now rejects
with a `TypeError` whose message names the call, and whose `cause` is that error. With the other
methods the body is not sent, so it is not serialized either, and such a value still does not fail
the call.

A `custom` auth interceptor (`auth: { type: 'custom', interceptor }`) on a service client sees the
request as it will be sent. `config.data` is the JSON text of the body, a string such as
`'{"name":"Ada"}'`, not the `@Body` value, and `undefined` when no body is sent, which includes every
`GET` and `DELETE`. The call's query is already in `config.url`, not in `config.query`. A signature
over the body covers `config.data` as it is: `JSON.stringify(config.data)` would serialize it a
second time. An interceptor that changes the body parses the text and stringifies the result:

```typescript
import { createServiceClient } from '@onebun/core';

const usersClient = createServiceClient(usersDefinition, {
  url: 'http://users:3001',
  auth: {
    type: 'custom',
    interceptor: (config) => {
      // Before: { ...config, data: { ...config.data, tenantId: 'acme' } }. From 0.9 config.data
      // is a string, so that spread would send its characters as keys "0", "1", ...
      if (typeof config.data !== 'string') {
        return config;
      }
      const data = JSON.stringify({ ...JSON.parse(config.data), tenantId: 'acme' });
      const digest = new Bun.CryptoHasher('sha256').update(data).digest('hex');

      return { ...config, data, headers: { ...config.headers, 'x-body-sha256': digest } };
    },
  },
});
```

<llm-only>

- Pass query arrays as arrays: `findByTags(['a', 'b'])`, never `['a', 'b'].join(',')` — the handler
  receives exactly the argument, and a joined string arrives as one string. A one-element array
  arrives as a one-element array, an empty array as `undefined`.
- Pass the body as a value, never `JSON.stringify(value)`: the client serializes it, so a
  pre-serialized body arrives as a string. Strings, `0`, `false`, `''` and `null` are valid bodies
  and arrive unchanged; only `undefined` sends none.
- Type a handler's array query as `string[]` (or `string | string[]` while callers on 0.8 remain):
  from a service client call it is an array. Plain HTTP clients that send `?tags=a` without `[]`
  still produce a string, so a public endpoint should keep accepting both.
- The service client builds the query string itself and hands the HTTP client a finished URL with
  no `query` record. An API key in query mode is still appended after it; a `custom` auth
  interceptor sees the query in `config.url`, not in `config.query`.
- A `custom` auth interceptor on a service client sees `config.data` as the JSON text that will be
  sent (a string), not the `@Body` value, and `undefined` when no body is sent (`GET`, `DELETE`,
  `HEAD`, `OPTIONS`, or an `undefined` body). Sign that string as it is; to change the body,
  `JSON.parse` it, change it and `JSON.stringify` it again. Never spread `config.data` or
  `JSON.stringify` it a second time.
- `@Body` values are serialized only for `POST`, `PUT` and `PATCH`, the methods that send a body; on
  other methods the value is dropped unchecked, so a BigInt there does not reject.
- The HMAC signature (`auth: { type: 'onebun' }`) covers the query string and the exact JSON bytes
  that are sent.

</llm-only>

### The client as a value {#service-client-as-value}

The client and each `client.<Controller>` are ordinary values. An `async` factory can build and
return the client, a promise can resolve to it, and `JSON.stringify`, `String` and string templates
accept it. `in` tells whether the service definition has a controller, or a controller has a method:

```typescript
import { createServiceClient, createServiceDefinition } from '@onebun/core';

import { UsersModule } from './users/users.module';

const UsersServiceDefinition = createServiceDefinition(UsersModule);

// An async factory resolves to the client itself
async function connectUsers(url: string) {
  return createServiceClient(UsersServiceDefinition, { url });
}

const usersClient = await connectUsers('http://users:3001');
const user = await usersClient.UsersController.findById('123');

const hasUsers = 'UsersController' in usersClient; // true
const hasFindById = 'findById' in usersClient.UsersController; // true
const hasOrders = 'OrdersController' in usersClient; // false
```

Reading a controller or method that the definition does not have throws, at the line that
reads it. A missing controller gives
`Controller "OrdersController" not found in service definition. Available controllers: UsersController`,
which lists the controllers there are. A missing method gives
`Method "remove" not found in controller "UsersController"`.

<llm-only>

- The names JavaScript reads on its own read as `undefined` at both levels: `then`, `toJSON` and
  every symbol key. So `await Promise.resolve(client)` and an `async` function returning the client
  resolve to the client rather than rejecting with `Controller "then" not found`, and
  `JSON.stringify(client)` does not throw on `toJSON`. The `Object.prototype` members (`toString`,
  `valueOf`, `constructor`, ...) read as they do on a plain object.
- `'Name' in client` is the check that does not throw. Reading `client.Name` to probe for a
  controller throws when it is missing.
- A handler that is itself named `then` or `toJSON` wins over the rule above, as an own property
  of a plain object would. Its controller client then becomes a thenable, so do not name a handler
  `then`.
- The client has no own enumerable keys: `Object.keys(client)` is `[]` and `JSON.stringify(client)`
  is `'{}'`. List controllers with `[...definition._controllers.keys()]`.

</llm-only>

## Response Format

All responses follow the standard format:

### Success Response

```typescript
interface SuccessResponse<T> {
  success: true;
  result: T;
  traceId?: string;
  /** Retries spent before this response was produced; `0` means one request */
  retryCount?: number;
  /** The HTTP status the upstream returned: 200, 201, 204, 304, ... (a 3xx under 'manual') */
  statusCode?: number;
  /** The headers the upstream answered with, names lower-cased. Not enumerable */
  headers?: Record<string, string>;
}
```

`result` is what [`responseType`](#response-types) asks for: parsed JSON or text by default, a
`Uint8Array` under `'bytes'`, a `ReadableStream<Uint8Array>` under `'stream'`.

`headers` holds the upstream's response headers on every success the client produced: an `etag`,
a `location`, a rate-limit header. Names are lower-cased. A header sent more than once is joined
with `, `, as `Headers.get()` joins it, and `set-cookie` is joined the same way. After a redirect,
they are the final hop's headers; under [`redirect: 'manual'`](#redirect-policy), the redirect's
own, `location` included. An error's `details.headers` is collected differently: there, a
`set-cookie` sent more than once keeps only its last value. Under
[`maxResponseBytes`](#max-response-bytes), both leave out `content-encoding` and `content-length`
when the client decoded the body.

```typescript
const head = await client.head('/files/report.pdf');

if (head.success) {
  head.headers?.etag;               // '"v7"'
  head.headers?.['content-length']; // '52431'
}

const created = await client.post('/files', { name: 'report.pdf' });

if (created.success) {
  const location = created.headers?.location; // '/files/42'
}
```

`headers` is **not enumerable**. `JSON.stringify`, `Object.keys`, a spread (`{ ...response }`) and
`structuredClone` skip it. `response.headers` and `'headers' in response` work as usual. Because of
this, a controller that returns the envelope as it is does not send the upstream's `set-cookie`,
`server` or any other header on to its own caller. That holds on every route. To pass a header on,
set it on a `Response` you return (see
[Custom Response Headers](./controllers.md#custom-response-headers)). A success the framework
builds around a handler's return value has no `headers`.

Bun's own inspector does list a non-enumerable property. `console.log(response)`, `Bun.inspect`
and a `toMatchSnapshot()` snapshot all show `headers`, with the upstream's `set-cookie` and `date`.
To log or snapshot an envelope, use `{ ...response }` or the fields you need.

<llm-only>

- `headers` is attached with `Object.defineProperty(..., { enumerable: false })`. Reading it is
  ordinary; copying the envelope is not: `{ ...response, extra }`, `Object.assign({}, response)`,
  `structuredClone` and a JSON round trip all lose it. Take `response.headers` out before copying.
- It is deliberately invisible to serialization. Do not "fix" that by spreading it back in
  (`{ ...response, headers: response.headers }`): the result is enumerable, and a controller
  returning it sends the upstream's `set-cookie` to its caller in the body.
- `toEqual`/`toStrictEqual` ignore it, so an assertion on the envelope's shape does not see it;
  assert `response.headers?.['x-name']` directly.
- `Bun.inspect`, `console.log` and bun:test's `toMatchSnapshot` DO show it, `set-cookie` and `date`
  included (`node:util`'s `inspect` does not). A snapshot of a raw envelope therefore changes on
  every run, because `date` changes. A snapshot or a log of the envelope should use
  `{ ...response }` or pick the fields it needs.
- `content-length` and `content-encoding` describe the bytes on the wire. `fetch` decompresses the
  body, so for a gzip answer `result` is the decoded body while `content-length` is the compressed
  size. Under `maxResponseBytes` the client decodes the body itself and leaves both out of
  `headers` whenever it undid a coding, and out of an `HTTP_ERROR`'s `details.headers` too (see
  [Limiting the response size](#max-response-bytes)).
- `set-cookie` values are joined with `, `, and a cookie's own `Expires=Wed, 21 Oct ...` contains a
  comma, so the joined string cannot be split back reliably.
- `RequestsService` methods return `result` alone, so they have no headers. Use `HttpClient` (or the
  service client, which returns the `HttpClient` envelope) when a header matters.
- An `HTTP_ERROR`'s `details.headers` is NOT the same record: it is enumerable, and there a repeated
  `set-cookie` keeps only its last value. The default exception filter leaves it out of the body it
  sends a controller's caller, with the request URL and the upstream's body (see
  [An uncaught client error and your caller](#uncaught-client-errors)). `exposeErrorDetails`, and a
  filter of your own that serializes the error without `withoutTransportDetails`, send it whole.
- A success carries `headers` since 0.8.2.

</llm-only>

### Responses without a body

An answer to `HEAD`, and every `204 No Content` and `304 Not Modified`, has no content by
definition, so the client does not read a body for them: `result` is `undefined` and `statusCode`
says which one arrived. The `content-type` does not matter — `Response.json()` keeps
`application/json` on its answer to `HEAD`, and a `204` may carry it too.

A `304` resolves as a success. A server sends one only in answer to a conditional request
(`If-None-Match`, `If-Modified-Since`), so it is the outcome you asked about — your copy is
current — and not a failure:

```typescript
const head = await client.head('/users/123');
// { success: true, result: undefined, statusCode: 200 }

const removed = await client.delete('/users/123');
// a 204 No Content: { success: true, result: undefined, statusCode: 204 }

const response = await client.get<User>('/users/123', undefined, {
  headers: { 'If-None-Match': etag },
});
if (response.success && response.statusCode === 304) {
  // keep the copy you already have
}
```

### Error Response

```typescript
interface ErrorResponse<E extends string = string, R extends string = string>
  extends OneBunError<E, R> {
  success: false;
  retryCount?: number;
}

interface OneBunError<E extends string = string, R extends string = string> {
  /** Machine-readable error name, e.g. 'HTTP_ERROR' or 'TIMEOUT_ERROR' */
  error: E;
  /** HTTP status, or `0` (`TRANSPORT_FAILURE_CODE`) for a timeout, an abort or a network failure */
  code: number;
  traceId?: string;
  /** Request context: url, method, duration, response headers, raw body */
  details?: Record<string, unknown>;
  originalError?: OneBunError<R>;
}
```

There is no `message` field. `error` carries the machine-readable name and `details` the context.
The context is for your application: when a client error escapes a controller, the default
exception filter leaves its transport details out of the caller's body (see
[An uncaught client error and your caller](#uncaught-client-errors)).

## Complete Example

```typescript
import {
  Effect,
  Service,
  BaseService,
  createHttpClient,
  isErrorResponse,
  NotFoundError,
} from '@onebun/core';
import { Span } from '@onebun/trace';

interface User {
  id: string;
  name: string;
  email: string;
}

interface CreateUserDto {
  name: string;
  email: string;
}

@Service()
export class UserApiService extends BaseService {
  private readonly client;

  constructor() {
    super();
    // Config is available after super() — use it to initialize the HTTP client
    this.client = createHttpClient({
      baseUrl: this.config.get('services.usersUrl'),
      timeout: 10000,
      auth: {
        type: 'onebun',
        serviceId: 'my-service',
        secretKey: this.config.get('services.secretKey'),
      },
      retries: {
        max: 3,
        backoff: 'exponential',
        delay: 1000,
        factor: 2,
        retryOn: [408, 429, 500, 502, 503, 504],
      },
    });
  }

  @Span('fetch-users')
  async findAll(page = 1, limit = 10): Promise<User[]> {
    this.logger.debug('Fetching users', { page, limit });

    // A failure throws, so this line only continues on success
    const response = await this.client.get<User[]>('/users', { page, limit });

    if (isErrorResponse(response)) {
      throw new Error(response.error);
    }

    this.logger.info('Users fetched', { count: response.result.length });
    return response.result;
  }

  @Span('fetch-user-by-id')
  async findById(id: string): Promise<User> {
    // Effect.either to inspect the status code the upstream returned
    const outcome = await Effect.runPromise(
      Effect.either(this.client.getEffect<User>(`/users/${id}`)),
    );

    if (outcome._tag === 'Left') {
      if (outcome.left.code === 404) {
        throw new NotFoundError('User', { id });
      }
      throw new Error(outcome.left.error);
    }

    if (isErrorResponse(outcome.right)) {
      throw new Error(outcome.right.error);
    }

    return outcome.right.result;
  }

  @Span('create-user')
  async create(data: CreateUserDto): Promise<User> {
    this.logger.info('Creating user', { email: data.email });

    const response = await this.client.post<User>('/users', data);

    if (isErrorResponse(response)) {
      throw new Error(response.error);
    }

    this.logger.info('User created', { userId: response.result.id });
    return response.result;
  }

  @Span('update-user')
  async update(id: string, data: Partial<CreateUserDto>): Promise<User> {
    const outcome = await Effect.runPromise(
      Effect.either(this.client.patchEffect<User>(`/users/${id}`, data)),
    );

    if (outcome._tag === 'Left') {
      if (outcome.left.code === 404) {
        throw new NotFoundError('User', { id });
      }
      throw new Error(outcome.left.error);
    }

    if (isErrorResponse(outcome.right)) {
      throw new Error(outcome.right.error);
    }

    return outcome.right.result;
  }

  @Span('delete-user')
  async delete(id: string): Promise<void> {
    const outcome = await Effect.runPromise(
      Effect.either(this.client.deleteEffect(`/users/${id}`)),
    );

    if (outcome._tag === 'Left') {
      if (outcome.left.code === 404) {
        throw new NotFoundError('User', { id });
      }
      throw new Error(outcome.left.error);
    }

    this.logger.info('User deleted', { userId: id });
  }
}
```
