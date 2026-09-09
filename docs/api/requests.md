---
description: HTTP client with createHttpClient(). Retries, timeouts, error handling. Promise and Effect API. Authentication helpers.
---

# HTTP Client API

Package: `@onebun/requests`

## Overview

OneBun provides a unified HTTP client with:
- Multiple authentication schemes
- Automatic retries with configurable strategies
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

// With custom headers — an object carrying `headers`, `timeout`, `auth` or `method`
// is read as per-request config instead of as query
const response = await client.get('/users', {
  headers: { 'X-Custom-Header': 'value' },
});

// Both at once: query second, config third
const response = await client.get('/users', { page: 1, limit: 10 }, { timeout: 5000 });
```

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
| `retryOnNetworkError` | `true` | Connection refused / DNS / TLS — the request never arrived |
| `retryOnTimeout` | `false` | The client-side timeout fired |

**POST and PATCH are not retried unless you ask for it.** Replaying them creates a second
order, a second charge, a second message. The default list is the idempotent set of
RFC 9110 §9.2.2, the same shape `axios-retry` and `got` use.

A **client-side timeout is not retried either**, for any method: the request may well have
reached the server and been processed, so re-sending it duplicates the effect just as a POST
replay would. A transport failure carries `code: 0` (`TRANSPORT_FAILURE_CODE`) and the error
name `TIMEOUT_ERROR`, `ABORT_ERROR` or `FETCH_ERROR` — it is never reported as a server 500,
so `retryOn` stays a pure list of status codes.

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

    // Retry when the request never reached the server
    retryOnNetworkError: true,

    // Retry when the client-side timeout fired
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

## Request Configuration

Every per-request config argument is a `Partial<RequestConfig>` — `method` and `url` come from the
method you call and the path you pass, so only these fields are yours to set:

<!-- typecheck: skip -->
```typescript
{
  /** Request timeout in milliseconds */
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

::: warning `get`, `delete`, `head` and `options` drop the third argument when the second is `undefined`
`client.get('/x', undefined, { headers: { … } })` sends a bare `GET /x` with no headers, because
these methods only look at the third argument once the second one is present. Either pass the
query record, or move the config into the second argument — an object carrying `headers`,
`timeout`, `auth` or `method` is recognised as config. `post`, `put` and `patch` are not affected.
:::

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
  /** HTTP status, or `0` (`TRANSPORT_FAILURE_CODE`) when the request never arrived */
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
