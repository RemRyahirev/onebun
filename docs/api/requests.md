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

```typescript
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  retries: {
    // Number of retry attempts
    max: 3,

    // Backoff strategy: 'fixed', 'linear', 'exponential'
    backoff: 'exponential',

    // Base delay in milliseconds
    delay: 1000,

    // Multiplier for exponential backoff (default: 2)
    factor: 2,

    // HTTP status codes to retry
    retryOn: [408, 429, 500, 502, 503, 504],

    // Callback on retry
    onRetry: (error, attempt) => {
      console.log(`Retry attempt ${attempt}:`, error);
    },
  },
});
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
  private client = createHttpClient({
    baseUrl: 'https://api.external-service.com',
    auth: {
      type: 'bearer',
      token: process.env.EXTERNAL_API_TOKEN!,
    },
    retries: {
      max: 3,
      backoff: 'exponential',
      delay: 1000,
    },
  });

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
const usersClient = createServiceClient(UsersServiceDefinition, {
  baseUrl: 'http://users-service:3001',
  auth: {
    type: 'onebun',
    serviceId: 'orders-service',
    secretKey: process.env.SERVICE_SECRET!,
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
  Span,
} from '@onebun/core';

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
  private client = createHttpClient({
    baseUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    timeout: 10000,
    defaultHeaders: {
      'Content-Type': 'application/json',
    },
    auth: {
      type: 'onebun',
      serviceId: 'my-service',
      secretKey: process.env.SERVICE_SECRET!,
    },
    retries: {
      max: 3,
      backoff: 'exponential',
      delay: 1000,
      factor: 2,
      retryOn: [408, 429, 500, 502, 503, 504],
    },
  });

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
