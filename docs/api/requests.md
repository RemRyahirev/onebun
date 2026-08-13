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
  defaultHeaders: {
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

// With query parameters
const response = await client.get('/users', {
  params: { page: 1, limit: 10 },
});

// With custom headers
const response = await client.get('/users', {
  headers: { 'X-Custom-Header': 'value' },
});
```

### POST

```typescript
// JSON body
const response = await client.post('/users', {
  body: { name: 'John', email: 'john@example.com' },
});

// With options
const response = await client.post('/users', {
  body: userData,
  headers: { 'X-Request-ID': requestId },
  timeout: 30000,
});
```

### PUT, PATCH, DELETE

```typescript
// PUT
const response = await client.put('/users/123', {
  body: { name: 'Updated Name' },
});

// PATCH
const response = await client.patch('/users/123', {
  body: { name: 'Partial Update' },
});

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
    type: 'apiKey',
    key: 'your-api-key',
    header: 'X-API-Key',  // or 'Authorization'
  },
});
```

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

```typescript
const client = createHttpClient({
  baseUrl: 'https://internal-service.example.com',
  auth: {
    type: 'onebun',
    serviceId: 'my-service',
    secretKey: 'shared-secret',
  },
});
```

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

### Response Types

```typescript
import { isErrorResponse, type ApiResponse } from '@onebun/core';

const response = await client.get<User>('/users/123');

if (isErrorResponse(response)) {
  // response.success === false
  console.error(response.message);
  console.error(response.code);
} else {
  // response.success === true
  const user = response.result;
}
```

### Error Classes

```typescript
import { NotFoundError, InternalServerError, OneBunBaseError } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  async findById(id: string): Promise<User> {
    const response = await this.client.get<User>(`/users/${id}`);

    if (isErrorResponse(response)) {
      if (response.code === 404) {
        throw new NotFoundError('User', id);
      }
      throw new InternalServerError(response.message);
    }

    return response.result;
  }
}
```

### Custom Error Handling

```typescript
try {
  const response = await client.get('/users');
} catch (error) {
  if (error instanceof OneBunBaseError) {
    // Framework error
    console.error(error.toErrorResponse());
  } else if (error instanceof Error) {
    // Generic error (network, timeout, etc.)
    console.error('Request failed:', error.message);
  }
}
```

## Request Configuration

```typescript
interface RequestConfig {
  /** Request timeout in milliseconds */
  timeout?: number;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Query parameters */
  params?: Record<string, string | number | boolean>;

  /** Request body (for POST, PUT, PATCH) */
  body?: unknown;

  /** Override retry config for this request */
  retries?: RetryConfig;

  /** Override auth for this request */
  auth?: AuthConfig;

  /** Custom fetch options */
  fetchOptions?: RequestInit;
}
```

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
import { Service, BaseService, createHttpClient } from '@onebun/core';

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

    const response = await this.client.get<ExternalData>(`/data/${id}`);

    if (isErrorResponse(response)) {
      this.logger.error('External API error', {
        id,
        code: response.code,
        message: response.message,
      });
      throw new Error(`External API error: ${response.message}`);
    }

    return response.result;
  }

  async createResource(data: CreateResourceDto): Promise<Resource> {
    const response = await this.client.post<Resource>('/resources', {
      body: data,
    });

    if (isErrorResponse(response)) {
      throw new Error(response.message);
    }

    return response.result;
  }
}
```

## Service Client (Inter-service Communication)

For type-safe inter-service communication:

```typescript
import { createServiceDefinition, createServiceClient } from '@onebun/core';

// Define service API
export const UsersServiceDefinition = createServiceDefinition({
  name: 'users',
  controllers: {
    users: {
      findAll: { method: 'GET', path: '/users' },
      findById: { method: 'GET', path: '/users/:id' },
      create: { method: 'POST', path: '/users' },
      update: { method: 'PUT', path: '/users/:id' },
      delete: { method: 'DELETE', path: '/users/:id' },
    },
  },
});

// Create typed client
// In a service, use this.config.get() for secrets
const usersClient = createServiceClient(UsersServiceDefinition, {
  baseUrl: this.config.get('services.usersUrl'),
  auth: {
    type: 'onebun',
    serviceId: 'orders-service',
    secretKey: this.config.get('services.secretKey'),
  },
});

// Use with full type safety
const users = await usersClient.users.findAll();
const user = await usersClient.users.findById({ id: '123' });
const newUser = await usersClient.users.create({ body: { name: 'John' } });
```

## Response Format

All responses follow the standard format:

### Success Response

```typescript
interface SuccessResponse<T> {
  success: true;
  result: T;
}
```

### Error Response

```typescript
interface ErrorResponse {
  success: false;
  code: number;
  message: string;
  details?: unknown;
}
```

## Complete Example

```typescript
import {
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
      defaultHeaders: {
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

    const response = await this.client.get<User[]>('/users', {
      params: { page, limit },
    });

    if (isErrorResponse(response)) {
      this.logger.error('Failed to fetch users', {
        code: response.code,
        message: response.message,
      });
      throw new Error(response.message);
    }

    this.logger.info('Users fetched', { count: response.result.length });
    return response.result;
  }

  @Span('fetch-user-by-id')
  async findById(id: string): Promise<User> {
    const response = await this.client.get<User>(`/users/${id}`);

    if (isErrorResponse(response)) {
      if (response.code === 404) {
        throw new NotFoundError('User', id);
      }
      throw new Error(response.message);
    }

    return response.result;
  }

  @Span('create-user')
  async create(data: CreateUserDto): Promise<User> {
    this.logger.info('Creating user', { email: data.email });

    const response = await this.client.post<User>('/users', {
      body: data,
    });

    if (isErrorResponse(response)) {
      this.logger.error('Failed to create user', {
        code: response.code,
        message: response.message,
      });
      throw new Error(response.message);
    }

    this.logger.info('User created', { userId: response.result.id });
    return response.result;
  }

  @Span('update-user')
  async update(id: string, data: Partial<CreateUserDto>): Promise<User> {
    const response = await this.client.patch<User>(`/users/${id}`, {
      body: data,
    });

    if (isErrorResponse(response)) {
      if (response.code === 404) {
        throw new NotFoundError('User', id);
      }
      throw new Error(response.message);
    }

    return response.result;
  }

  @Span('delete-user')
  async delete(id: string): Promise<void> {
    const response = await this.client.delete(`/users/${id}`);

    if (isErrorResponse(response)) {
      if (response.code === 404) {
        throw new NotFoundError('User', id);
      }
      throw new Error(response.message);
    }

    this.logger.info('User deleted', { userId: id });
  }
}
```
