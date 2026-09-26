---
description: HTTP client with createHttpClient(). Retries, timeouts, error handling. Promise and Effect API. Authentication helpers.
---

# HTTP Client API

Package: `@onebun/requests`

## Overview

OneBun provides a unified HTTP client with:
- Multiple authentication schemes
- Automatic retries with configurable strategies
- Redirects followed without taking credentials to another origin
- Integrated tracing and metrics
- Standardized error handling

## Creating HTTP Client

```typescript
import { createHttpClient } from '@onebun/core';

const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 10000,  // 10 seconds
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});
```

## Basic Requests

### GET

```typescript
// Simple GET
const response = await client.get('/users');

// With query parameters — the second argument *is* the query record
const response = await client.get('/users', { page: 1, limit: 10 });
// GET /users?page=1&limit=10

// With custom headers — an object carrying `method`, `headers`, `timeout`, `auth`,
// `tracing` or `metrics` is read as per-request config instead of as query
const response = await client.get('/users', {
  headers: { 'X-Custom-Header': 'value' },
});

// Both at once: query second, config third
const response = await client.get('/users', { page: 1, limit: 10 }, { timeout: 5000 });

// Config with no query — a third argument makes the second one the query, even `undefined`
const response = await client.get('/users', undefined, { retries: { max: 0 } });
```

`delete`, `head` and `options` take the same three arguments and resolve them by the same rule.
With two arguments, only the six names above make the object config: every other key is query
data, so `client.get('/login', { redirect: '/home' })` sends `GET /login?redirect=%2Fhome`.
`retries` and `query` are deliberately not on the list, so a config that sets only those takes the
three-argument form, as in the last call above.

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

`post`, `put` and `patch` take the payload positionally and never inspect it. Wrapping it —
`client.post('/users', { body: userData, timeout: 30000 })` — sends
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

#### Upgrading from the previous scheme {#hmac-v1-migration}

The previous implementation signed one payload and verified another, so **only a literal `GET /`
ever validated** — every POST and every path failed. It also covered neither the query string nor
the body, compared signatures with `===`, and never recorded the nonce it generated, so a captured
header set replayed for five minutes.

Fixing any one of those changes the wire format, so they changed together and the format now
carries `v=1`. A caller on the old version fails against a new callee with
`reason: 'legacy-unversioned-signature'` rather than mysteriously. The five `X-OneBun-*` headers
are replaced by the single `X-OneBun-Signature` above, and `validateOneBunAuth` is gone —
`verifyOneBunRequest` replaces it, and takes the request rather than a header set, because the
method, path, query and body it must check are not in a header set.

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
parse. See [Timeouts and interruption](#timeouts-and-interruption).

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

A `500` whose body stalls is therefore a timeout, not a `500`: the status arrived, the response did
not, and `retryOnTimeout` — off by default — decides whether it is replayed.

<llm-only>

Up to 0.8.1 a timeout during the body read was reported as `RESPONSE_READ_ERROR` (text body) or
`RESPONSE_PARSE_ERROR` (JSON body) with the status as `code`. A stalled 200 looked like a malformed
body, and a stalled 500 was replayed by `retryOn` as a server 500 regardless of
`retryOnTimeout: false`. Code that matched those names to detect a slow upstream should match
`getTransportFailureKind(e) === 'timeout'` instead; `details.statusCode` keeps the status.

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

### Credentials stay with their origin {#redirect-headers}

A hop to the **same origin** — same scheme, host and port — carries every header of the original
request. A hop to **any other origin** carries only these:

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

`onebun` auth signs the original method, URL and body. A same-origin hop carries the signature as
it was — it is not re-signed — so the callee rejects it for any other path with
`signature-mismatch`. Call the final URL directly. An `apikey` with `location: 'query'` is part of
the URL, so whether it reaches the next hop depends on whether the redirecting server's
`Location` repeats it.

### REDIRECT_ERROR {#redirect-error}

A redirect the client cannot follow fails with `REDIRECT_ERROR`, and `code` is the `3xx` that
could not be followed. It is never retried, whatever `retryOn` lists: asking again gets the same
redirect.

```typescript
import { Effect } from '@onebun/core';

const outcome = await Effect.runPromise(Effect.either(client.getEffect('/files/42')));

if (outcome._tag === 'Left' && outcome.left.error === 'REDIRECT_ERROR') {
  outcome.left.code;               // the 3xx that could not be followed, e.g. 302
  outcome.left.details?.reason;    // 'too-many-redirects' | 'missing-location' | 'invalid-location'
  outcome.left.details?.location;  // the Location header, when there was one
  outcome.left.details?.redirects; // how many redirects this call had followed
}
```

- `too-many-redirects` — the answer that would have been the 21st redirect
- `missing-location` — a `301`, `302`, `303`, `307` or `308` without a `Location`
- `invalid-location` — a `Location` that is not a URL, or not an `http:` or `https:` one

Any other `3xx` is an answer, not a redirect, and its `Location` is not followed — a `304`, for
one, resolves as a success (see [Responses without a body](#responses-without-a-body)).

<llm-only>

Up to 0.8.1 `fetch` followed redirects itself. On a hop to another origin it dropped only
`Authorization`, `Cookie` and `Proxy-Authorization`, so the `apikey` header, `custom` auth
headers, `X-OneBun-Signature` and every caller-set header reached the other origin, and a `POST`
answered `307` re-sent its body there together with the key. The service client inherited this
through `RequestsOptions`. Code that relied on a credential reaching a redirect target on another
origin now gets the target's 401: call that origin with its own client.

A redirect that cannot be followed failed under other names. A redirect loop, and a `Location`
that was not an http(s) URL, were a `FETCH_ERROR` (`'network'`), which `retryOnNetworkError`
replayed. Bun's `fetch`
follows up to 127 redirects, so under the default config a loop cost four attempts of 127 requests
each — 508 requests. A redirect status without a `Location` was an `HTTP_ERROR` with the 3xx as
`code`, which `retryOn` could replay. All three are now `REDIRECT_ERROR`, sent once — a loop costs
21 requests.

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

  /** Request body for POST, PUT, PATCH — `data`, not `body` */
  data?: unknown;

  /** Override retry config for this request; merges field-wise onto the defaults */
  retries?: Partial<RetryConfig>;

  /** Override auth for this request */
  auth?: AuthConfig;

  /** Set to `false` to skip the trace headers / the metrics for this one request */
  tracing?: boolean;
  metrics?: boolean;
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

For type-safe inter-service communication:

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

Controllers are reached by their **class name**, and handler arguments are passed **positionally**, in
the order the handler declares its `@Param`/`@Body`/`@Query` parameters:

```typescript
const users = await usersClient.UsersController.findAll();
const user = await usersClient.UsersController.findById('123');
const newUser = await usersClient.UsersController.create({ name: 'John' });
```

<llm-only>

Three mistakes this section exists to prevent, all of which typecheck-clean code used to make:

- `createServiceDefinition({ name, controllers: {...} })` — an object literal is rejected; the function
  signature is `createServiceDefinition(moduleClass)` and it throws
  `"<X> is not decorated with @Module"` for anything else.
- `{ baseUrl }` instead of `{ url }` — `ServiceClientOptions extends Omit<RequestsOptions, 'baseUrl'>`,
  so `baseUrl` is an excess property AND `url` is missing: two errors, and at runtime the underlying
  client would have `baseUrl: undefined`.
- `client.users.findById({ id: '123' })` — the proxy keys controllers by `controller.name`
  (`UsersController`), and `buildRequestParams` consumes `args[i]` positionally, so a wrapper object is
  stringified into the URL rather than destructured.

</llm-only>

### Path parameter values {#service-client-path-values}

A path parameter value fills exactly one segment of the route, and it is inserted **as is, without
encoding**. A value that would make the request reach a different route is refused: the call rejects
with a `TypeError` naming the controller, the method and the parameter, and no request is made. Sent,
such a value would carry this client's credentials to that other route — `'../admin/secret'` as a
user id used to read `GET /admin/secret`.

| Refused value | What it would have done |
|---|---|
| `null`, `undefined` | sent the text `null` / `undefined` as the id |
| contains `/`, `\`, `?` or `#` | ended the segment: the rest became more path, a query string or a fragment. A URL parser treats `\` like `/` |
| `''`, `.`, `..` | an empty segment or a dot segment: `''` and `.` reached the sibling route (`GET /users/`), `..` climbed one level |
| `%2e` for a dot: `%2e`, `%2e%2e`, `.%2E`, `%2E.` | the same as `.` and `..`: the URL parser reads `%2e` as a dot |
| one of the above with a tab or newline inside (`'.\t.'`) or whitespace at the end (`'.. '`) | the same again: the URL parser deletes tabs and newlines, and trims the end of the URL, before it looks for dot segments |

Every other value is sent unchanged, so a value that already routed correctly still does. To send a
value that contains `/`, `?`, `#` or `\`, percent-encode it: the router decodes the segment, and the
handler receives the original text.

```typescript
// Sent as GET /users/team%2Falice; the handler's @Param('id') receives 'team/alice'
const member = await usersClient.UsersController.findById(encodeURIComponent('team/alice'));

// Rejects with a TypeError and sends nothing:
// UsersController.findById: path parameter "id" contains "/", which ends a path segment, ...
await usersClient.UsersController.findById('team/alice');
```

`encodeURIComponent` leaves `.` alone, so `.` and `..` cannot be sent as a path segment at all. Pass
such a value as a `@Query` parameter or in the `@Body`.

<llm-only>

- Encode a path argument that comes from user input: `findById(encodeURIComponent(input))`. Do not
  encode it twice — the client does not encode on its own, and `%` followed by two hex digits is
  decoded exactly once by the router.
- A `TypeError` from a service client call means the arguments, not the network: nothing was sent,
  and retries do not apply. Typical causes are an omitted positional argument (`undefined`) and an
  id read from a missing field.
- Each `:name` in the route is replaced by the `@Param('name')` argument with exactly that name, so
  `/:idx/:id` gets both values regardless of declaration order. A `:name` with no matching `@Param`
  stays in the URL literally.

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
  /** The HTTP status the upstream returned: 200, 201, 204, 304, ... */
  statusCode?: number;
}
```

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
  /** HTTP status, or `0` (`TRANSPORT_FAILURE_CODE`) when no complete response arrived */
  code: number;
  traceId?: string;
  /** Request context: url, method, duration, response headers, raw body */
  details?: Record<string, unknown>;
  originalError?: OneBunError<R>;
}
```

There is no `message` field. `error` carries the machine-readable name and `details` the context.

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
      headers: {
        'Content-Type': 'application/json',
      },
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
