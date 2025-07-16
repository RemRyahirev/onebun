import { Effect, pipe } from 'effect';

import type {
  User,
  Post,
  UserQuery,
  PostQuery,
  CreatePostData,
  UpdateUserData,
} from './types';

import { 
  Service,
  BaseService,
  createHttpClient,
  ErrorResponse,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  NotFoundError,
  OneBunBaseError,
  SuccessResponse,
} from '@onebun/core';

@Service()
export class ExternalApiService extends BaseService {
  private readonly TIMEOUT_MS = 5000;
  private readonly client = createHttpClient({
    baseUrl: 'https://jsonplaceholder.typicode.com',
    timeout: this.TIMEOUT_MS,
    retries: {
      max: 2,
      delay: 1000,
      backoff: 'exponential',
      // TODO: make as default
      retryOn: [
        HttpStatusCode.REQUEST_TIMEOUT,
        HttpStatusCode.TOO_MANY_REQUESTS,
        HttpStatusCode.INTERNAL_SERVER_ERROR,
        HttpStatusCode.BAD_GATEWAY,
        HttpStatusCode.SERVICE_UNAVAILABLE,
        HttpStatusCode.GATEWAY_TIMEOUT,
      ],
    },
    // TODO: make as default
    tracing: true,
    // TODO: make as default
    metrics: true,
    // TODO: make as default
    headers: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Accept: 'application/json',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
    },
  });

  /**
   * Get all users using Promise API (default)
   */
  async getAllUsers(query: UserQuery = {}): Promise<User[]> {
    this.logger.info('Fetching users with @onebun/requests (Promise API)');

    try {
      const response = await this.client.get<User[], UserQuery>('/users', query);

      if (isErrorResponse(response)) {
        throw response;
      }

      this.logger.info(`Fetched ${response.result.length} users`);

      return response.result;
    } catch (error: unknown) {
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
  async getAllUsersNew(query: UserQuery = {}): Promise<User[]> {
    this.logger.info('Fetching users with @onebun/requests (req API)');

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
            code: HttpStatusCode.SERVICE_UNAVAILABLE,
          },
        },
      },
    );

    this.logger.info(`Fetched ${result.length} users`);

    return result;
  }

  /**
   * Get all users using reqRaw API (returns full response)
   */
  async getAllUsersRaw(query: UserQuery = {}): Promise<User[]> {
    this.logger.info('Fetching users with @onebun/requests (reqRaw API)');

    const response = await this.client.reqRaw<User[], UserQuery>(
      'GET',
      '/users',
      query,
    );

    if (isErrorResponse(response)) {
      throw OneBunBaseError.fromErrorResponse(response).withContext('Failed to fetch users', { query });
    }

    this.logger.info(`Fetched ${response.result.length} users`);

    return response.result;
  }

  /**
   * Get all users using reqEffect API (returns Effect)
   */
  getAllUsersEffect(query: UserQuery = {}): Effect.Effect<User[], ErrorResponse> {
    this.logger.info('Fetching users with @onebun/requests (reqEffect API)');

    return pipe(
      this.client.reqEffect<User[], UserQuery>(
        'GET',
        '/users',
        query,
      ),
      Effect.map((response: SuccessResponse<User[]>) => {
        this.logger.info(`Fetched ${response.result.length} users`);

        return response.result;
      }),
    );
  }

  /**
   * Get user by ID using new req API (throws on error, returns data directly)
   */
  async getUserById(id: number): Promise<User> {
    this.logger.info(`Getting user ${id} with @onebun/requests (req API)`);

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
            code: HttpStatusCode.NOT_FOUND,
          },
        },
      },
    );

    this.logger.info(`Fetched user: ${user.name}`);

    return user;
  }

  /**
   * Get user by ID using traditional API (for comparison)
   */
  async getUserByIdOld(id: number): Promise<User> {
    this.logger.info(`Getting user ${id} with @onebun/requests (traditional API)`);

    try {
      const response = await this.client.get<User>(`/users/${id}`);

      if (isErrorResponse(response)) {
        throw response;
      }

      if (response.result) {
        this.logger.info(`Fetched user: ${response.result.name}`);

        return response.result;
      }

      throw new NotFoundError('User not found', { id });
    } catch (error: unknown) {
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
    this.logger.info(`Getting posts for user ${userId} with req API`);

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
            code: HttpStatusCode.SERVICE_UNAVAILABLE,
          },
        },
      },
    );

    this.logger.info(`Fetched ${posts.length} posts`);

    return posts;
  }

  /**
   * Create a new post using new req API
   */
  async createPost(postData: CreatePostData): Promise<Post> {
    this.logger.info('Creating post with req API');

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
            code: HttpStatusCode.INTERNAL_SERVER_ERROR,
          },
        },
      },
    );

    this.logger.info(`Created post ${post.id}: ${post.title}`);

    return post;
  }

  /**
   * Update user using new req API
   */
  async updateUser(id: number, userData: UpdateUserData): Promise<User> {
    this.logger.info(`Updating user ${id} with req API`);

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
            code: HttpStatusCode.INTERNAL_SERVER_ERROR,
          },
        },
      },
    );

    this.logger.info(`Updated user ${user.id}: ${user.name}`);

    return user;
  }

  /**
   * Demonstrate comprehensive error handling with Promise API (default)
   */
  async demonstrateErrorHandling(): Promise<void> {
    this.logger.info('Demonstrating @onebun/requests error handling (Promise API)');

    try {
      await this.client.get('/nonexistent-endpoint');
    } catch (error: unknown) {
      this.logger.info('@onebun/requests error handling demonstration:');

      if (error && typeof error === 'object') {
        if ('code' in error) {
          this.logger.info(`- Error code: ${error.code}`);
        }
        if ('message' in error) {
          this.logger.info(`- Message: ${error.message}`);
        }
        if ('statusCode' in error) {
          this.logger.info(`- Status: ${error.statusCode || 'N/A'}`);
        }
        if ('traceId' in error) {
          this.logger.info(`- Trace ID: ${error.traceId || 'N/A'}`);
        }
        if ('timestamp' in error && error.timestamp) {
          this.logger.info(`- Timestamp: ${new Date(error.timestamp as number).toISOString()}`);
        }
        if ('cause' in error && error.cause && typeof error.cause === 'object' && 'message' in error.cause) {
          this.logger.info(`- Caused by: ${error.cause.message}`);
        }
      }

      this.logger.info('Error handling demonstration completed');
    }
  }

  /**
   * Demonstrate comprehensive error handling with Effect API
   */
  demonstrateErrorHandlingEffect(): Effect.Effect<void> {
    this.logger.info('Demonstrating @onebun/requests error handling (Effect API)');

    return pipe(
      this.client.getEffect('/nonexistent-endpoint'),
      Effect.catchAll((error: ErrorResponse) => {
        this.logger.info('@onebun/requests error handling demonstration:');
        this.logger.info(`- Error code: ${error.code}`);
        this.logger.info(`- Message: ${error.message}`);
        this.logger.info(`- Status: ${error.code || 'N/A'}`);
        this.logger.info(`- Trace ID: ${error.traceId || 'N/A'}`);
        this.logger.info(`- Timestamp: ${new Date().toISOString()}`);

        if (error.originalError) {
          this.logger.info(`- Caused by: ${error.originalError.message}`);
        }

        this.logger.info('Error handling demonstration completed');

        return Effect.succeed(undefined);
      }),
      Effect.map(() => undefined),
    );
  }

  /**
   * Demonstrate different authentication methods available in \@onebun/requests
   */
  async demonstrateAuthentication(): Promise<void> {
    this.logger.info('@onebun/requests Authentication Examples:');

    // Bearer Token Example
    createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: {
        type: 'bearer',
        token: 'your-bearer-token',
      },
    });

    // API Key Example
    createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: {
        type: 'apikey',
        key: 'X-API-Key',
        value: 'your-api-key',
      },
    });

    // Basic Auth Example
    createHttpClient({
      baseUrl: 'https://api.example.com',
      auth: {
        type: 'basic',
        username: 'user',
        password: 'pass',
      },
    });

    this.logger.info('Authentication clients created - ready for use');
    this.logger.info('- Bearer token auth configured');
    this.logger.info('- API key auth configured');
    this.logger.info('- Basic auth configured');
  }

  /**
   * Demonstrate retry functionality using Promise API (default)
   */
  async demonstrateRetries(): Promise<void> {
    this.logger.info('Demonstrating @onebun/requests retry functionality (Promise API)');

    const RETRY_TIMEOUT_MS = 2000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    const RETRY_FACTOR = 2;
    const RETRY_STATUS_CODES = [
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      HttpStatusCode.BAD_GATEWAY,
      HttpStatusCode.SERVICE_UNAVAILABLE,
      HttpStatusCode.GATEWAY_TIMEOUT,
    ];

    const retryClient = createHttpClient({
      baseUrl: 'https://httpstat.us', // Service for testing HTTP status codes
      timeout: RETRY_TIMEOUT_MS,
      retries: {
        max: MAX_RETRIES,
        delay: RETRY_DELAY_MS,
        backoff: 'exponential',
        factor: RETRY_FACTOR,
        retryOn: RETRY_STATUS_CODES,
      },
    });

    try {
      this.logger.info('Attempting request to endpoint that returns 500 (will retry)...');
      await retryClient.get('/500');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.info(`Request failed after retries: ${errorMessage}`);
      this.logger.info('Retry functionality demonstrated');
    }
  }

  /**
   * Demonstrate retry functionality using Effect API
   */
  demonstrateRetriesEffect(): Effect.Effect<void> {
    this.logger.info('Demonstrating @onebun/requests retry functionality (Effect API)');

    const RETRY_TIMEOUT_MS = 2000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    const RETRY_FACTOR = 2;
    const RETRY_STATUS_CODES = [
      HttpStatusCode.INTERNAL_SERVER_ERROR,
      HttpStatusCode.BAD_GATEWAY,
      HttpStatusCode.SERVICE_UNAVAILABLE,
      HttpStatusCode.GATEWAY_TIMEOUT,
    ];

    const retryClient = createHttpClient({
      baseUrl: 'https://httpstat.us', // Service for testing HTTP status codes
      timeout: RETRY_TIMEOUT_MS,
      retries: {
        max: MAX_RETRIES,
        delay: RETRY_DELAY_MS,
        backoff: 'exponential',
        factor: RETRY_FACTOR,
        retryOn: RETRY_STATUS_CODES,
      },
    });

    return pipe(
      Effect.sync(() => this.logger.info('Attempting request to endpoint that returns 500 (will retry)...')),
      Effect.flatMap(() => retryClient.getEffect('/500')),
      Effect.catchAll((error: ErrorResponse) => {
        this.logger.info(`Request failed after retries: ${error.message}`);
        this.logger.info('Retry functionality demonstrated');

        return Effect.succeed(undefined);
      }),
      Effect.map(() => undefined),
    );
  }
}
