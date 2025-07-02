import { Service, BaseService } from '@onebun/core';
import { createHttpClient, ErrorResponse, InternalServerError, isErrorResponse, NotFoundError, OneBunBaseError, SuccessResponse } from '@onebun/requests';
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
      // TODO: make as default
      retryOn: [408, 429, 500, 502, 503, 504]
    },
    // TODO: make as default
    tracing: true,
    // TODO: make as default
    metrics: true,
    // TODO: make as default
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

      if (isErrorResponse(response)) {
        throw response;
      }

      console.log(`✅ Fetched ${response.result.length} users`);
      return response.result;
    } catch (error: any) {
      this.logger.error('Failed to fetch users', { error });

      if (isErrorResponse(error)) {
        throw OneBunBaseError.fromErrorResponse(error).withContext('Failed to fetch users');
      }

      throw new InternalServerError('Failed to fetch users', { error });
    }
  }

  /**
   * Get all users using new req API (throws on error, returns data directly)
   */
  async getAllUsers_NEW(query: UserQuery = {}): Promise<User[]> {
    console.log('🚀 Fetching users with @onebun/requests (req API)');

    const result = await this.client.req<User[], UserQuery>(
      'GET',
      '/users',
      query,
      {
        errors: {
          wrong: {
            error: 'USERS_UNAVAILABLE',
            message: 'Failed to fetch users from external API',
            details: { query },
            code: 503
          },
        },
      }
    );

    console.log(`✅ Fetched ${result.length} users`);
    return result;
  }

  /**
   * Get all users using reqRaw API (returns full response)
   */
  async getAllUsersRaw(query: UserQuery = {}): Promise<User[]> {
    console.log('🚀 Fetching users with @onebun/requests (reqRaw API)');

    const response = await this.client.reqRaw<User[], UserQuery>(
      'GET',
      '/users',
      query
    );

    if (isErrorResponse(response)) {
      throw OneBunBaseError.fromErrorResponse(response).withContext('Failed to fetch users', { query });
    }

    console.log(`✅ Fetched ${response.result.length} users`);
    return response.result;
  }

  /**
   * Get all users using reqEffect API (returns Effect)
   */
  getAllUsersEffect(query: UserQuery = {}): Effect.Effect<User[], ErrorResponse> {
    console.log('🚀 Fetching users with @onebun/requests (reqEffect API)');

    return pipe(
      this.client.reqEffect<User[], UserQuery>(
        'GET',
        '/users',
        query
      ),
      Effect.map((response: SuccessResponse<User[]>) => {
        console.log(`✅ Fetched ${response.result.length} users`);
        return response.result;
      })
    );
  }

  /**
   * Get user by ID using new req API (throws on error, returns data directly)
   */
  async getUserById(id: number): Promise<User> {
    this.logger.info(`🚀 Getting user ${id} with @onebun/requests (req API)`);

    const user = await this.client.req<User>(
      'GET',
      `/users/${id}`,
      undefined,
      {
        errors: {
          wrong: {
            error: 'USER_NOT_FOUND',
            message: `User with ID ${id} does not exist`,
            details: { userId: id },
            code: 404
          }
        }
      }
    );

    console.log(`✅ Fetched user: ${user.name}`);
    return user;
  }

  /**
   * Get user by ID using traditional API (for comparison)
   */
  async getUserByIdOld(id: number): Promise<User> {
    this.logger.info(`🚀 Getting user ${id} with @onebun/requests (traditional API)`);

    try {
      const response = await this.client.get<User>(`/users/${id}`);

      if (isErrorResponse(response)) {
        throw response;
      }

      if (response.result) {
        console.log(`✅ Fetched user: ${response.result.name}`);
        return response.result;
      }

      throw new NotFoundError('User not found', { id });
    } catch (error: any) {
      this.logger.error('Failed to fetch user', { error, id });

      if (isErrorResponse(error)) {
        throw OneBunBaseError.fromErrorResponse(error).withContext('Failed to fetch user', { id });
      }

      throw new InternalServerError('Failed to fetch user', { error, id });
    }
  }

  /**
   * Get posts by user ID using new req API
   */
  async getPostsByUserId(userId: number): Promise<Post[]> {
    console.log(`🚀 Getting posts for user ${userId} with req API`);

    const query: PostQuery = { userId: userId.toString() };
    const posts = await this.client.req<Post[], PostQuery>(
      'GET',
      '/posts',
      query,
      {
        errors: {
          wrong: {
            error: 'POSTS_UNAVAILABLE',
            message: `Failed to fetch posts for user ${userId}`,
            details: { userId, query },
            code: 503
          }
        }
      }
    );

    console.log(`✅ Fetched ${posts.length} posts`);
    return posts;
  }

  /**
   * Create a new post using new req API
   */
  async createPost(postData: CreatePostData): Promise<Post> {
    console.log('🚀 Creating post with req API');

    const post = await this.client.req<Post, CreatePostData>(
      'POST',
      '/posts',
      postData,
      {
        errors: {
          wrong: {
            error: 'POST_CREATION_FAILED',
            message: 'Failed to create new post',
            details: { postData },
            code: 500
          }
        }
      }
    );

    console.log(`✅ Created post ${post.id}: ${post.title}`);
    return post;
  }

  /**
   * Update user using new req API
   */
  async updateUser(id: number, userData: UpdateUserData): Promise<User> {
    console.log(`🚀 Updating user ${id} with req API`);

    const user = await this.client.req<User, UpdateUserData>(
      'PUT',
      `/users/${id}`,
      userData,
      {
        errors: {
          wrong: {
            error: 'USER_UPDATE_FAILED',
            message: `Failed to update user ${id}`,
            details: { userId: id, userData },
            code: 500
          }
        }
      }
    );

    console.log(`✅ Updated user ${user.id}: ${user.name}`);
    return user;
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
      Effect.catchAll((error: ErrorResponse) => {
        console.log('💥 @onebun/requests error handling demonstration:');
        console.log(`- Error code: ${error.code}`);
        console.log(`- Message: ${error.message}`);
        console.log(`- Status: ${error.code || 'N/A'}`);
        console.log(`- Trace ID: ${error.traceId || 'N/A'}`);
        console.log(`- Timestamp: ${new Date().toISOString()}`);

        if (error.originalError) {
          console.log(`- Caused by: ${error.originalError.message}`);
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
      Effect.catchAll((error: ErrorResponse) => {
        console.log(`💥 Request failed after retries: ${error.message}`);
        console.log('✅ Retry functionality demonstrated');
        return Effect.succeed(undefined);
      }),
      Effect.map(() => undefined)
    );
  }
}
