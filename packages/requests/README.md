# @onebun/requests

Unified HTTP client service for OneBun framework with comprehensive error handling, retries, authentication, tracing, and metrics.

## Features

- **Dual API**: Promise-based interface by default with optional Effect-based interface
- **Typed Generics**: Enhanced type safety for request/response data and query parameters
- **Request/Response interceptors** with chainable configuration
- **Comprehensive error handling** with typed error objects
- **Automatic retries** with configurable backoff strategies
- **Built-in authentication** support (Bearer, API Key, Basic, Custom)
- **Request/response tracing** integration
- **Metrics collection** for monitoring
- **Timeout management** with request-level overrides
- **Query parameter handling** with automatic encoding
- **JSON request/response** handling with automatic parsing

## Installation

```bash
bun add @onebun/requests
```

## Quick Start

### Basic Usage with Promise API (Default)

```typescript
import { createHttpClient } from '@onebun/requests';

// Create a client
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 5000
});

// Simple GET request
const users = await client.get<User[]>('/users');

// POST request with data
const newUser = await client.post<User, CreateUserData>('/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
```

## Enhanced Typed Generics

### GET Requests with Query Parameters

```typescript
interface UserQuery {
  name?: string;
  email?: string;
  active?: boolean;
}

// Method 1: Typed query parameters (recommended)
const users = await client.get<User[], UserQuery>('/users', {
  name: 'John',
  active: true
});

// Method 2: Query + config separately  
const users = await client.get<User[], UserQuery>('/users', queryParams, {
  timeout: 10000
});

// Method 3: Traditional config-only approach (still supported)
const users = await client.get<User[]>('/users', {
  query: { name: 'John' },
  timeout: 10000
});
```

### POST/PUT/PATCH Requests with Typed Data

```typescript
interface CreatePostData {
  title: string;
  body: string;
  userId: number;
}

interface UpdateUserData {
  name?: string;
  email?: string;
}

// POST with typed data
const post = await client.post<Post, CreatePostData>('/posts', {
  title: 'My Post',
  body: 'Post content',
  userId: 1
});

// PUT with typed data
const user = await client.put<User, UpdateUserData>('/users/1', {
  name: 'Updated Name'
});

// PATCH with typed data
const user = await client.patch<User, Partial<UpdateUserData>>('/users/1', {
  email: 'new@example.com'
});
```

### DELETE Requests with Query Parameters

```typescript
interface DeleteQuery {
  force?: boolean;
  reason?: string;
}

// DELETE with typed query parameters
await client.delete<void, DeleteQuery>('/posts/1', {
  force: true,
  reason: 'spam'
});
```

## Dual API Support

### Promise API (Default - Recommended)

```typescript
// Simple and familiar async/await syntax
const client = createHttpClient({ baseUrl: 'https://api.example.com' });

try {
  const users = await client.get<User[]>('/users');
  const newPost = await client.post<Post, CreatePostData>('/posts', postData);
  console.log('Success:', users, newPost);
} catch (error) {
  console.error('Request failed:', error.message);
}
```

### Effect API (For advanced functional programming)

```typescript
import { Effect, pipe } from 'effect';

// Composable and functional approach
const program = pipe(
  client.getEffect<User[]>('/users'),
  Effect.flatMap(response => 
    response.success 
      ? Effect.succeed(response.data!)
      : Effect.fail(response.error!)
  ),
  Effect.tap(users => Effect.sync(() => console.log('Users:', users))),
  Effect.catchAll(error => 
    Effect.sync(() => console.error('Failed:', error.message))
  )
);

await Effect.runPromise(program);
```

## Service Integration

### Dependency Injection

```typescript
import { createRequestsService } from '@onebun/requests';

@Service()
export class UserService extends BaseService {
  constructor(
    private requests: RequestsService,
    logger?: Logger
  ) {
    super(logger);
  }

  async getUser(id: number): Promise<User> {
    // Using typed generics with service
    return this.requests.get<User>(`/users/${id}`);
  }

  async searchUsers(query: UserQuery): Promise<User[]> {
    // Using typed query parameters
    return this.requests.get<User[], UserQuery>('/users', query);
  }

  async createUser(userData: CreateUserData): Promise<User> {
    // Using typed data interface
    return this.requests.post<User, CreateUserData>('/users', userData);
  }
}
```

### Utility Functions

```typescript
import { requests } from '@onebun/requests';

// Direct utility usage with typed generics
const users = await requests.get<User[], UserQuery>('/users', { active: true });
const post = await requests.post<Post, CreatePostData>('/posts', postData);
const updatedUser = await requests.put<User, UpdateUserData>('/users/1', updateData);
```

## Configuration

### Client Configuration

```typescript
const client = createHttpClient({
  baseUrl: 'https://api.example.com',
  timeout: 10000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
  auth: {
    type: 'bearer',
    token: 'your-bearer-token'
  },
  retries: {
    max: 3,
    delay: 1000,
    backoff: 'exponential',
    retryOn: [408, 429, 500, 502, 503, 504]
  }
});
```

### Authentication Types

```typescript
// Bearer Token
const bearerClient = createHttpClient({
  auth: {
    type: 'bearer',
    token: 'your-token'
  }
});

// API Key
const apiKeyClient = createHttpClient({
  auth: {
    type: 'apikey',
    key: 'X-API-Key',
    value: 'your-api-key'
  }
});

// Basic Auth
const basicClient = createHttpClient({
  auth: {
    type: 'basic',
    username: 'user',
    password: 'pass'
  }
});
```

## Advanced Usage Patterns

### Complex Query Parameters

```typescript
interface SearchQuery {
  q?: string;
  filters?: {
    category?: string;
    tags?: string[];
    dateRange?: {
      from: string;
      to: string;
    };
  };
  pagination?: {
    page: number;
    limit: number;
  };
}

const results = await client.get<SearchResult[], SearchQuery>('/search', {
  q: 'test',
  filters: {
    category: 'tech',
    tags: ['javascript', 'typescript'],
    dateRange: {
      from: '2024-01-01',
      to: '2024-12-31'
    }
  },
  pagination: {
    page: 1,
    limit: 20
  }
});
```

### Request Configuration Override

```typescript
// Override config when using typed parameters
const users = await client.get<User[], UserQuery>(
  '/users',
  { active: true },     // typed query
  {                     // config override
    timeout: 30000,
    headers: { 'X-Custom': 'value' },
    query: { additional: 'param' }  // merged with typed query
  }
);
```

## Error Handling

### Promise API Error Handling

```typescript
try {
  const user = await client.get<User>('/users/1');
  console.log('User:', user);
} catch (error: RequestError) {
  console.error('Request failed:', {
    code: error.code,
    message: error.message,
    statusCode: error.statusCode,
    traceId: error.traceId
  });
}
```

### Effect API Error Handling

```typescript
const program = pipe(
  client.getEffect<User>('/users/1'),
  Effect.flatMap(response => 
    response.success 
      ? Effect.succeed(response.data!)
      : Effect.fail(response.error!)
  ),
  Effect.catchAll(error => {
    console.error('Request failed:', error);
    return Effect.succeed(null);
  })
);
```

## Migration Guide

### From Basic to Typed Generics

```typescript
// Before: Basic usage
const users = await client.get('/users');
const newPost = await client.post('/posts', postData);

// After: With typed generics
const users = await client.get<User[]>('/users');
const newPost = await client.post<Post, CreatePostData>('/posts', postData);

// After: With typed query parameters
const users = await client.get<User[], UserQuery>('/users', { active: true });
```

### Benefits of Typed Generics

1. **Type Safety**: Compile-time validation of request/response data
2. **IntelliSense**: Better IDE support with autocompletion
3. **Documentation**: Self-documenting API interfaces
4. **Refactoring**: Safer code changes with type checking
5. **Error Prevention**: Catch data structure mismatches early

## Best Practices

1. **Define clear interfaces** for your request/response data
2. **Use typed generics** for better development experience
3. **Handle errors appropriately** with try-catch or Effect error handling
4. **Configure retries** for resilient applications
5. **Use authentication** for secure API access
6. **Enable tracing and metrics** for monitoring

## API Reference

### HttpClient Methods

All methods support both Promise and Effect APIs:

#### GET Requests
- `get<T, Q>(url, query?, config?)` - Promise API
- `getEffect<T, Q>(url, query?, config?)` - Effect API

#### POST Requests  
- `post<T, D>(url, data?, config?)` - Promise API
- `postEffect<T, D>(url, data?, config?)` - Effect API

#### PUT Requests
- `put<T, D>(url, data?, config?)` - Promise API  
- `putEffect<T, D>(url, data?, config?)` - Effect API

#### PATCH Requests
- `patch<T, D>(url, data?, config?)` - Promise API
- `patchEffect<T, D>(url, data?, config?)` - Effect API

#### DELETE Requests
- `delete<T, Q>(url, query?, config?)` - Promise API
- `deleteEffect<T, Q>(url, query?, config?)` - Effect API

### Type Parameters

- `T` - Response data type
- `D` - Request data type (for POST/PUT/PATCH)
- `Q` - Query parameters type (for GET/DELETE/HEAD/OPTIONS)

Where:
- `Q extends Record<string, any>` - Query parameters must be an object
- `D` - Data can be any type (object, string, number, etc.)

## License

MIT License - see LICENSE file for details. 