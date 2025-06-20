import { BaseController, Controller, Get, Post, Body, Param } from '@onebun/core';
import { Effect, pipe } from 'effect';
import { ExternalApiService, User, Post as BlogPost } from './external-api.service';

@Controller('api')
export class ApiController extends BaseController {
  constructor(private api: ExternalApiService, logger?: any, config?: any) {
    super(logger, config);
  }

  /**
   * Get all users using @onebun/requests package
   */
  @Get('users')
  async getUsers(): Promise<Response> {

    this.logger.info('Getting users', this.api.getAllUsers);

    const users = await Effect.runPromise(
      pipe(
        this.api.getAllUsers(),
        Effect.tap((users) => 
          Effect.sync(() => console.log(`Fetched ${users.length} users using @onebun/requests`))
        )
      )
    );
    return this.success(users);
  }

  /**
   * Get user by ID using @onebun/requests package with error handling
   */
  @Get('users/:id')
  async getUserById(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    
    const result = await Effect.runPromise(
      pipe(
        this.api.getUserById(userId),
        Effect.map((user) => user),
        Effect.catchAll((error) => 
          Effect.succeed({ error: `Failed to fetch user: ${error.message}` })
        )
      )
    );
    
    if ('error' in result) {
      return this.error(result.error, 404);
    }
    
    return this.success(result);
  }

  /**
   * Get posts by user ID using @onebun/requests
   */
  @Get('users/:id/posts')
  async getUserPosts(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    
    const posts = await Effect.runPromise(
      pipe(
        this.api.getPostsByUserId(userId),
        Effect.tap((posts) => 
          Effect.sync(() => console.log(`Fetched ${posts.length} posts for user ${userId} using @onebun/requests`))
        )
      )
    );
    
    return this.success(posts);
  }

  /**
   * Create a new post using @onebun/requests
   */
  @Post('posts')
  async createPost(@Body() post: Omit<BlogPost, 'id'>): Promise<Response> {
    const result = await Effect.runPromise(
      pipe(
        this.api.createPost(post),
        Effect.map((newPost) => newPost),
        Effect.catchAll((error) => 
          Effect.succeed({ error: `Failed to create post: ${error.message}` })
        )
      )
    );
    
    if ('error' in result) {
      return this.error(result.error, 400);
    }
    
    return this.success(result, 201);
  }

  /**
   * Demonstrate comprehensive error handling with @onebun/requests
   */
  @Get('demo/error-handling')
  async demonstrateErrorHandling(): Promise<Response> {
    await Effect.runPromise(this.api.demonstrateErrorHandling());
    return this.success({ message: 'Error handling demonstration completed - check console logs' });
  }

  /**
   * Demonstrate authentication methods available in @onebun/requests
   */
  @Get('demo/authentication')
  async demonstrateAuthentication(): Promise<Response> {
    await Effect.runPromise(this.api.demonstrateAuthentication());
    return this.success({ message: 'Authentication methods demonstration completed - check console logs' });
  }

  /**
   * Demonstrate retry functionality in @onebun/requests
   */
  @Get('demo/retries')
  async demonstrateRetries(): Promise<Response> {
    await Effect.runPromise(this.api.demonstrateRetries());
    return this.success({ message: 'Retry functionality demonstration completed - check console logs' });
  }

  /**
   * Health check endpoint that shows @onebun/requests integration
   */
  @Get('health')
  async healthCheck(): Promise<Response> {
    return this.success({
      status: 'OK',
      requests: '@onebun/requests package integrated and working',
      timestamp: Date.now()
    });
  }
} 