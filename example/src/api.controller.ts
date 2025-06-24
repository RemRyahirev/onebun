import { BaseController, Controller, Get, Post, Put, Body, Param, Query } from '@onebun/core';
import { ExternalApiService } from './external-api.service';
import type { UserQuery, CreatePostData, UpdateUserData, User } from './types';

@Controller('api')
export class ApiController extends BaseController {
  constructor(private api: ExternalApiService, logger?: any, config?: any) {
    super(logger, config);
  }

  /**
   * Get all users using @onebun/requests package (Promise API)
   */
  @Get('users')
  async getUsers(@Query() query: UserQuery = {}): Promise<Response> {
    this.logger.info('Getting users');

    try {
      const users = await this.api.getAllUsers(query);
      this.logger.info(`Fetched ${users.length} users using @onebun/requests (Promise API)`);
      return this.success(users);
    } catch (error: any) {
      return this.error(`Failed to fetch users: ${error.message}`, 500);
    }
  }

  /**
   * Get all users using @onebun/requests package (Promise API)
   */
  @Get('users')
  async getUsers_NEW(@Query() query: UserQuery = {}): Promise<User[]> {
    this.logger.info('Getting users');

    const users = await this.api.getAllUsers_NEW(query);

    this.logger.info(`Fetched ${users.length} users using @onebun/requests (Promise API)`);

    return users;
  }

  /**
   * Get user by ID using @onebun/requests package with error handling (Promise API)
   */
  @Get('users/:id')
  async getUserById(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    
    try {
      const user = await this.api.getUserById(userId);
      return this.success(user);
    } catch (error: any) {
      return this.error(`Failed to fetch user: ${error.message} | traceId: ${error.traceId}`, 404);
    }
  }

  /**
   * Update user with typed data interface
   */
  @Put('users/:id')
  async updateUser(@Param('id') id: string, @Body() userData: UpdateUserData): Promise<Response> {
    const userId = parseInt(id, 10);
    
    try {
      const user = await this.api.updateUser(userId, userData);
      return this.success(user);
    } catch (error: any) {
      return this.error(`Failed to update user: ${error.message}`, 400);
    }
  }

  /**
   * Get posts by user ID using @onebun/requests (Promise API)
   */
  @Get('users/:id/posts')
  async getUserPosts(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    
    try {
      const posts = await this.api.getPostsByUserId(userId);
      this.logger.info(`Fetched ${posts.length} posts for user ${userId} using @onebun/requests (Promise API)`);
      return this.success(posts);
    } catch (error: any) {
      return this.error(`Failed to fetch posts: ${error.message}`, 500);
    }
  }

  /**
   * Create a new post using typed data interface (Promise API)
   */
  @Post('posts')
  async createPost(@Body() postData: CreatePostData): Promise<Response> {
    try {
      const newPost = await this.api.createPost(postData);
      return this.success(newPost, 201);
    } catch (error: any) {
      return this.error(`Failed to create post: ${error.message}`, 400);
    }
  }

  /**
   * Demonstrate comprehensive error handling with @onebun/requests (Promise API)
   */
  @Get('demo/error-handling')
  async demonstrateErrorHandling(): Promise<Response> {
    try {
      await this.api.demonstrateErrorHandling();
      return this.success({ message: 'Error handling demonstration completed - check console logs' });
    } catch (error: any) {
      return this.error(`Error handling demo failed: ${error.message}`, 500);
    }
  }

  /**
   * Demonstrate authentication methods available in @onebun/requests (Promise API)
   */
  @Get('demo/authentication')
  async demonstrateAuthentication(): Promise<Response> {
    try {
      await this.api.demonstrateAuthentication();
      return this.success({ message: 'Authentication methods demonstration completed - check console logs' });
    } catch (error: any) {
      return this.error(`Authentication demo failed: ${error.message}`, 500);
    }
  }

  /**
   * Demonstrate retry functionality in @onebun/requests (Promise API)
   */
  @Get('demo/retries')
  async demonstrateRetries(): Promise<Response> {
    try {
      await this.api.demonstrateRetries();
      return this.success({ message: 'Retry functionality demonstration completed - check console logs' });
    } catch (error: any) {
      return this.error(`Retry demo failed: ${error.message}`, 500);
    }
  }

  /**
   * Health check endpoint that shows @onebun/requests integration
   */
  @Get('health')
  async healthCheck(): Promise<Response> {
    return this.success({
      status: 'OK',
      requests: '@onebun/requests package integrated and working with Promise API',
      features: [
        'Dual API support (Promise + Effect)',
        'Typed generics for data and query parameters',
        'Comprehensive error handling',
        'Automatic retries and authentication'
      ],
      timestamp: Date.now()
    });
  }


  /**
   * Demonstrate error handling with Effect API
   */
  @Get('effect/demo/error-handling')
  async demonstrateErrorHandlingEffect(): Promise<Response> {
    const { Effect } = await import('effect');
    
    try {
      await Effect.runPromise(this.api.demonstrateErrorHandlingEffect());
      return this.success({ message: 'Error handling demonstration (Effect API) completed - check console logs' });
    } catch (error: any) {
      return this.error(`Error handling demo failed: ${error.message}`, 500);
    }
  }
} 