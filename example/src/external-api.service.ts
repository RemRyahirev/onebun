import { Service, BaseService } from '@onebun/core';
import { createHttpClient, RequestResponse, RequestError } from '@onebun/requests';
import { Effect, pipe } from 'effect';

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  address: {
    street: string;
    suite: string;
    city: string;
    zipcode: string;
    geo: {
      lat: string;
      lng: string;
    };
  };
  phone: string;
  website: string;
  company: {
    name: string;
    catchPhrase: string;
    bs: string;
  };
}

export interface Post {
  userId: number;
  id: number;
  title: string;
  body: string;
}

@Service()
export class ExternalApiService extends BaseService {
  private readonly client = createHttpClient({
    baseUrl: 'https://jsonplaceholder.typicode.com',
    timeout: 5000,
    retries: { 
      max: 2, 
      delay: 1000, 
      backoff: 'exponential',
      retryOn: [408, 429, 500, 502, 503, 504]
    },
    tracing: true,
    metrics: true,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  /**
   * Get all users using @onebun/requests
   */
  getAllUsers(): Effect.Effect<User[]> {
    console.log('🚀 Fetching users with @onebun/requests');
    
    return pipe(
      this.client.get<User[]>('/users'),
      Effect.map((response: RequestResponse<User[]>) => {
        if (response.success && response.data) {
          console.log(`✅ Fetched ${response.data.length} users in ${response.duration}ms`);
          return response.data;
        }
        return [];
      }),
      Effect.catchAll((error: RequestError) => {
        console.error(`❌ Failed to fetch users: ${error.message}`, {
          code: error.code,
          statusCode: error.statusCode,
          traceId: error.traceId
        });
        return Effect.succeed([]);
      })
    );
  }

  /**
   * Get user by ID with proper error handling
   */
  getUserById(id: number): Effect.Effect<User, RequestError> {
    this.logger.info(`🚀 Getting user ${id} with @onebun/requests`);
    
    return pipe(
      this.client.get<User>(`/users/${id}`),
      Effect.flatMap((response: RequestResponse<User>) => {
        if (response.success && response.data) {
          console.log(`✅ Fetched user: ${response.data.name} in ${response.duration}ms`);
          return Effect.succeed(response.data);
        }
        
        return Effect.fail({
          code: 'USER_NOT_FOUND',
          message: `User with ID ${id} not found`,
          statusCode: response.statusCode,
          traceId: response.traceId,
          timestamp: Date.now()
        } as RequestError);
      })
    );
  }

  /**
   * Get posts by user ID using query parameters
   */
  getPostsByUserId(userId: number): Effect.Effect<Post[]> {
    console.log(`🚀 Getting posts for user ${userId} with @onebun/requests query params`);
    
    return pipe(
      this.client.get<Post[]>('/posts', {
        query: { userId: userId.toString() }
      }),
      Effect.map((response: RequestResponse<Post[]>) => {
        if (response.success && response.data) {
          console.log(`✅ Fetched ${response.data.length} posts in ${response.duration}ms`);
          return response.data;
        }
        return [];
      }),
      Effect.catchAll((error: RequestError) => {
        console.error(`❌ Failed to fetch posts for user ${userId}:`, {
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
          traceId: error.traceId
        });
        return Effect.succeed([]);
      })
    );
  }

  /**
   * Create a new post using POST request
   */
  createPost(post: Omit<Post, 'id'>): Effect.Effect<Post, RequestError> {
    console.log('🚀 Creating post with @onebun/requests POST');
    
    return pipe(
      this.client.post<Post>('/posts', post),
      Effect.flatMap((response: RequestResponse<Post>) => {
        if (response.success && response.data) {
          console.log(`✅ Created post ${response.data.id}: ${response.data.title} in ${response.duration}ms`);
          return Effect.succeed(response.data);
        }
        
        return Effect.fail({
          code: 'POST_CREATION_FAILED',
          message: 'Failed to create post',
          statusCode: response.statusCode,
          details: response.error,
          traceId: response.traceId,
          timestamp: Date.now()
        } as RequestError);
      })
    );
  }

  /**
   * Demonstrate comprehensive error handling with @onebun/requests
   */
  demonstrateErrorHandling(): Effect.Effect<void> {
    console.log('🚀 Demonstrating @onebun/requests error handling');
    
    return pipe(
      this.client.get('/nonexistent-endpoint'),
      Effect.catchAll((error: RequestError) => {
        console.log('💥 @onebun/requests error handling demonstration:');
        console.log(`- Error code: ${error.code}`);
        console.log(`- Message: ${error.message}`);
        console.log(`- Status: ${error.statusCode || 'N/A'}`);
        console.log(`- Trace ID: ${error.traceId || 'N/A'}`);
        console.log(`- Timestamp: ${new Date(error.timestamp).toISOString()}`);
        
        if (error.cause) {
          console.log(`- Caused by: ${error.cause.message}`);
        }
        
        console.log('✅ Error handling demonstration completed');
        return Effect.succeed(undefined);
      }),
      Effect.map(() => undefined)
    );
  }

  /**
   * Demonstrate different authentication methods available in @onebun/requests
   */
  demonstrateAuthentication(): Effect.Effect<void> {
    return Effect.sync(() => {
      console.log('🔐 @onebun/requests Authentication Examples:');
      
      // Bearer Token Example
      const bearerClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'bearer',
          token: 'your-bearer-token'
        }
      });
      console.log('  ✓ Bearer Token client configured');

      // API Key Header Example
      const apiKeyClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'apikey',
          key: 'X-API-Key',
          value: 'your-api-key',
          location: 'header'
        }
      });
      console.log('  ✓ API Key (header) client configured');

      // API Key Query Example
      const apiKeyQueryClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'apikey',
          key: 'api_key',
          value: 'your-api-key',
          location: 'query'
        }
      });
      console.log('  ✓ API Key (query) client configured');

      // Basic Auth Example
      const basicAuthClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'basic',
          username: 'user',
          password: 'password'
        }
      });
      console.log('  ✓ Basic Auth client configured');

      // OneBun Service Auth Example
      const onebunAuthClient = createHttpClient({
        baseUrl: 'https://internal-api.example.com',
        auth: {
          type: 'onebun',
          serviceId: 'my-service',
          secretKey: 'service-secret-key',
          algorithm: 'hmac-sha256'
        }
      });
      console.log('  ✓ OneBun service auth client configured');

      // Custom Auth Example
      const customAuthClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'custom',
          headers: {
            'X-Custom-Auth': 'custom-value'
          },
          interceptor: (config) => {
            // Add dynamic auth headers
            config.headers = {
              ...config.headers,
              'X-Timestamp': Date.now().toString()
            };
            return config;
          }
        }
      });
      console.log('  ✓ Custom auth client configured');

      console.log('✅ Authentication demonstration completed');
    });
  }

  /**
   * Demonstrate retry functionality
   */
  demonstrateRetries(): Effect.Effect<void> {
    console.log('🔄 Demonstrating @onebun/requests retry functionality');
    
    const retryClient = createHttpClient({
      baseUrl: 'https://httpbin.org',
      retries: {
        max: 3,
        delay: 500,
        backoff: 'exponential',
        factor: 2,
        retryOn: [500, 502, 503, 504],
        onRetry: (error, attempt) => {
          console.log(`🔄 Retry attempt ${attempt} for error: ${error.message}`);
        }
      }
    });

    return pipe(
      retryClient.get('/status/500'), // This will return 500 and trigger retries
      Effect.catchAll((error: RequestError) => {
        console.log(`💥 Final error after retries: ${error.message}`);
        console.log('✅ Retry demonstration completed');
        return Effect.succeed(undefined);
      }),
      Effect.map(() => undefined)
    );
  }
} 