import { Service, BaseService } from '@onebun/core';
import { createHttpClient, RequestError } from '@onebun/requests';
import { Effect, pipe } from 'effect';
import type { User, Post, UserQuery, PostQuery, CreatePostData, UpdateUserData } from './types';


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
   * Get all users using Promise API (default)
   */
  async getAllUsers(query: UserQuery = {}): Promise<User[]> {
    console.log('🚀 Fetching users with @onebun/requests (Promise API)');
    
    try {
      const response = await this.client.get<User[], UserQuery>('/users', query);
      
      if (response.success && response.data) {
        console.log(`✅ Fetched ${response.data.length} users in ${response.duration}ms`);
        return response.data;
      }
      return [];
    } catch (error: any) {
      console.error(`❌ Failed to fetch users: ${error.message}`, {
        code: error.code,
        statusCode: error.statusCode,
        traceId: error.traceId
      });
      return [];
    }
  }

  /**
   * Get user by ID with Promise API (default)
   */
  async getUserById(id: number): Promise<User> {
    this.logger.info(`🚀 Getting user ${id} with @onebun/requests (Promise API)`);
    
    try {
      const response = await this.client.get<User>(`/users/${id}`);
      
      if (response.success && response.data) {
        console.log(`✅ Fetched user: ${response.data.name} in ${response.duration}ms`);
        return response.data;
      }
      
      throw {
        code: 'USER_NOT_FOUND',
        message: `User with ID ${id} not found`,
        statusCode: response.statusCode,
        traceId: response.traceId,
        timestamp: Date.now()
      } as RequestError;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get posts by user ID using typed query parameters (Promise API)
   */
  async getPostsByUserId(userId: number): Promise<Post[]> {
    console.log(`🚀 Getting posts for user ${userId} with typed query params (Promise API)`);
    
    try {
      // Using typed query interface
      const query: PostQuery = { userId: userId.toString() };
      const response = await this.client.get<Post[], PostQuery>('/posts', query);
      
      if (response.success && response.data) {
        console.log(`✅ Fetched ${response.data.length} posts in ${response.duration}ms`);
        return response.data;
      }
      return [];
    } catch (error: any) {
      console.error(`❌ Failed to fetch posts for user ${userId}:`, {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        traceId: error.traceId
      });
      return [];
    }
  }

  /**
   * Create a new post using typed data interface (Promise API)
   */
  async createPost(postData: CreatePostData): Promise<Post> {
    console.log('🚀 Creating post with typed data interface (Promise API)');
    
    try {
      // Using typed data interface  
      const response = await this.client.post<Post, CreatePostData>('/posts', postData);
      
      if (response.success && response.data) {
        console.log(`✅ Created post ${response.data.id}: ${response.data.title} in ${response.duration}ms`);
        return response.data;
      }
      
      throw {
        code: 'POST_CREATION_FAILED',
        message: 'Failed to create post',
        statusCode: response.statusCode,
        details: response.error,
        traceId: response.traceId,
        timestamp: Date.now()
      } as RequestError;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update user using typed data interface (Promise API)
   */
  async updateUser(id: number, userData: UpdateUserData): Promise<User> {
    console.log(`🚀 Updating user ${id} with typed data interface (Promise API)`);
    
    try {
      const response = await this.client.put<User, UpdateUserData>(`/users/${id}`, userData);
      
      if (response.success && response.data) {
        console.log(`✅ Updated user ${response.data.id}: ${response.data.name} in ${response.duration}ms`);
        return response.data;
      }
      
      throw {
        code: 'USER_UPDATE_FAILED',
        message: 'Failed to update user',
        statusCode: response.statusCode,
        traceId: response.traceId,
        timestamp: Date.now()
      } as RequestError;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Demonstrate comprehensive error handling with Promise API (default)
   */
  async demonstrateErrorHandling(): Promise<void> {
    console.log('🚀 Demonstrating @onebun/requests error handling (Promise API)');
    
    try {
      await this.client.get('/nonexistent-endpoint');
    } catch (error: any) {
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
    }
  }

  /**
   * Demonstrate comprehensive error handling with Effect API
   */
  demonstrateErrorHandlingEffect(): Effect.Effect<void> {
    console.log('🚀 Demonstrating @onebun/requests error handling (Effect API)');
    
    return pipe(
      this.client.getEffect('/nonexistent-endpoint'),
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
  async demonstrateAuthentication(): Promise<void> {
    console.log('🔐 @onebun/requests Authentication Examples:');
    
    // Bearer Token Example
    const bearerClient = createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: {
        type: 'bearer',
        token: 'your-bearer-token'
      }
    });
    
    // API Key Example
    const apiKeyClient = createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: {
        type: 'apikey',
        key: 'X-API-Key',
        value: 'your-api-key'
      }
    });
    
    // Basic Auth Example
    const basicAuthClient = createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: {
        type: 'basic',
        username: 'user',
        password: 'pass'
      }
    });
    
    console.log('✅ Authentication clients created - ready for use');
    console.log('- Bearer token auth configured');
    console.log('- API key auth configured');
    console.log('- Basic auth configured');
  }

  /**
   * Demonstrate retry functionality using Promise API (default)
   */
  async demonstrateRetries(): Promise<void> {
    console.log('🔄 Demonstrating @onebun/requests retry functionality (Promise API)');
    
    const retryClient = createHttpClient({
      baseUrl: 'https://httpstat.us', // Service for testing HTTP status codes
      timeout: 2000,
      retries: {
        max: 3,
        delay: 1000,
        backoff: 'exponential',
        factor: 2,
        retryOn: [500, 502, 503, 504]
      }
    });
    
    try {
      console.log('📡 Attempting request to endpoint that returns 500 (will retry)...');
      await retryClient.get('/500');
    } catch (error: any) {
      console.log(`💥 Request failed after retries: ${error.message}`);
      console.log('✅ Retry functionality demonstrated');
    }
  }

  /**
   * Demonstrate retry functionality using Effect API
   */
  demonstrateRetriesEffect(): Effect.Effect<void> {
    console.log('🔄 Demonstrating @onebun/requests retry functionality (Effect API)');
    
    const retryClient = createHttpClient({
      baseUrl: 'https://httpstat.us', // Service for testing HTTP status codes
      timeout: 2000,
      retries: {
        max: 3,
        delay: 1000,
        backoff: 'exponential',
        factor: 2,
        retryOn: [500, 502, 503, 504]
      }
    });
    
    return pipe(
      Effect.sync(() => console.log('📡 Attempting request to endpoint that returns 500 (will retry)...')),
      Effect.flatMap(() => retryClient.getEffect('/500')),
      Effect.catchAll((error: RequestError) => {
        console.log(`💥 Request failed after retries: ${error.message}`);
        console.log('✅ Retry functionality demonstrated');
        return Effect.succeed(undefined);
      }),
      Effect.map(() => undefined)
    );
  }
} 