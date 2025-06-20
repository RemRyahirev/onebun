# @onebun/requests

Unified HTTP client module for OneBun framework with built-in tracing, metrics, error handling, and retries.

## Features

- **Unified Request/Response Format**: Standardized request and response structures
- **Built-in Error Handling**: Chainable error propagation with context
- **Multiple Authentication Schemes**: API keys, Basic auth, Bearer tokens, custom headers
- **Automatic Retries**: Configurable retry strategies with exponential backoff
- **Distributed Tracing**: Automatic trace context propagation
- **Metrics Collection**: Request count and latency metrics
- **Type Safety**: Full TypeScript support with strict typing
- **Effect.js Integration**: Built on Effect.js for functional programming patterns

## Installation

```bash
bun add @onebun/requests
```

## Basic Usage

### Simple GET Request

```typescript
import { RequestsService, makeRequestsService } from '@onebun/requests';
import { Effect, pipe } from 'effect';

const program = pipe(
  RequestsService,
  Effect.flatMap((requestsService) =>
    pipe(
      requestsService.get('https://api.example.com/users'),
      Effect.tap((response) => {
        if (response.success) {
          return Effect.sync(() => console.log('Users:', response.data));
        } else {
          return Effect.sync(() => console.error('Error:', response.error));
        }
      })
    )
  )
);

Effect.runPromise(program.pipe(
  Effect.provide(makeRequestsService())
));
```

### Creating Client Instance

```typescript
import { createHttpClient } from '@onebun/requests';

const apiClient = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 5000,
  auth: {
    type: 'bearer',
    token: 'your-api-token'
  },
  retries: {
    max: 3,
    delay: 1000,
    backoff: 'exponential'
  }
});

const response = await Effect.runPromise(apiClient.get('/users'));
```

## Configuration

### RequestsOptions

```typescript
interface RequestsOptions {
  // Base URL for all requests
  baseUrl?: string;
  
  // Request timeout in milliseconds (default: 10000)
  timeout?: number;
  
  // Default headers
  headers?: Record<string, string>;
  
  // Authentication configuration
  auth?: AuthConfig;
  
  // Retry configuration
  retries?: RetryConfig;
  
  // Enable/disable tracing (default: true)
  tracing?: boolean;
  
  // Enable/disable metrics (default: true)
  metrics?: boolean;
}
```

### Authentication Options

```typescript
// Bearer token
auth: {
  type: 'bearer',
  token: 'your-token'
}

// API Key in header
auth: {
  type: 'apikey',
  key: 'x-api-key',
  value: 'your-api-key'
}

// API Key in query
auth: {
  type: 'apikey',
  key: 'api_key',
  value: 'your-api-key',
  location: 'query'
}

// Basic auth
auth: {
  type: 'basic',
  username: 'user',
  password: 'pass'
}

// Custom headers
auth: {
  type: 'custom',
  headers: {
    'Authorization': 'Custom token',
    'X-API-Version': 'v1'
  }
}
```

### Retry Configuration

```typescript
retries: {
  max: 3,                    // Maximum retry attempts
  delay: 1000,              // Initial delay in ms
  backoff: 'exponential',   // 'linear' | 'exponential' | 'fixed'
  factor: 2,                // Backoff factor for exponential
  retryOn: [408, 429, 500, 502, 503, 504] // HTTP status codes to retry on
}
```

## Response Format

All requests return a standardized response format:

```typescript
interface RequestResponse<T = any> {
  success: boolean;
  data?: T;
  error?: RequestError;
  statusCode: number;
  headers: Record<string, string>;
  duration: number;
  traceId?: string;
}
```

## Error Handling

Errors are wrapped in a structured format with chainable context:

```typescript
interface RequestError {
  code: string;
  message: string;
  details?: any;
  cause?: RequestError;  // Chained errors
  statusCode?: number;
  traceId?: string;
}
```

## Integration with OneBun Framework

The requests module automatically integrates with other OneBun modules:

- **Logging**: All requests are logged with trace context
- **Metrics**: Request count and latency metrics
- **Tracing**: Automatic trace propagation
- **Configuration**: Environment-based configuration

## Advanced Usage

### Custom Request Configuration

```typescript
const response = pipe(
  RequestsService,
  Effect.flatMap((requestsService) =>
    requestsService.request({
      method: 'POST',
      url: '/users',
      data: { name: 'John', email: 'john@example.com' },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      retries: { max: 1 }
    })
  )
);
```

### Error Chain Handling

```typescript
const program = pipe(
  RequestsService,
  Effect.flatMap((requestsService) =>
    pipe(
      requestsService.get('/api/data'),
      Effect.tap((response) => {
        if (!response.success && response.error) {
          return Effect.sync(() => {
            // Walk through error chain
            let currentError = response.error;
            while (currentError) {
              console.log(`Error: ${currentError.message}`);
              currentError = currentError.cause;
            }
          });
        }
        return Effect.succeed(undefined);
      })
    )
  )
);
```

### Custom Authentication

```typescript
const client = createHttpClient({
  auth: {
    type: 'custom',
    interceptor: (request) => {
      // Custom auth logic
      const signature = generateSignature(request);
      return {
        ...request,
        headers: {
          ...request.headers,
          'X-Signature': signature,
          'X-Timestamp': Date.now().toString()
        }
      };
    }
  }
});
``` 