import type {
  UserQuery,
  CreatePostData,
  UpdateUserData,
  User,
  Post as PostEntity,
} from './types';

import {
  BaseController,
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpStatusCode,
} from '@onebun/core';

import { ExternalApiService } from './external-api.service';

@Controller('api')
export class ApiController extends BaseController {
  constructor(private api: ExternalApiService) {
    super();
  }

  /**
   * Get all users using \@onebun/requests package (Traditional API)
   */
  @Get('users/traditional')
  async getUsersTraditional(@Query() query: UserQuery = {}): Promise<Response> {
    this.logger.info('Getting users with traditional API');

    try {
      const users = await this.api.getAllUsers(query);
      this.logger.info(`Fetched ${users.length} users using @onebun/requests (Traditional API)`);

      return this.success(users);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return this.error(`Failed to fetch users: ${errorMessage}`, HttpStatusCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get all users using new req API (simplified pattern)
   */
  @Get('users')
  async getUsers(@Query() query: UserQuery = {}): Promise<User[]> {
    this.logger.info('Getting users with new req API');
    const users = await this.api.getAllUsersNew(query);
    this.logger.info(`Fetched ${users.length} users using new req API`);

    return users;
  }

  /**
   * Get all users using reqRaw API (demonstrates raw response handling)
   */
  @Get('users/raw')
  async getUsersRaw(@Query() query: UserQuery = {}): Promise<User[]> {
    this.logger.info('Getting users with reqRaw API');
    const users = await this.api.getAllUsersRaw(query);
    this.logger.info(`Fetched ${users.length} users using reqRaw API`);

    return users;
  }

  /**
   * Get user by ID using new req API (simplified pattern)
   */
  @Get('users/:id')
  async getUserById(@Param('id') id: string): Promise<User> {
    const userId = parseInt(id, 10);
    const user = await this.api.getUserById(userId);

    return user;
  }

  /**
   * Get user by ID using traditional API (for comparison)
   */
  @Get('users/:id/traditional')
  async getUserByIdTraditional(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);

    try {
      const user = await this.api.getUserByIdOld(userId);

      return this.success(user);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const traceId = error && typeof error === 'object' && 'traceId' in error ? error.traceId : 'N/A';

      return this.error(`Failed to fetch user: ${errorMessage} | traceId: ${traceId}`, HttpStatusCode.NOT_FOUND);
    }
  }

  /**
   * Update user using new req API (simplified pattern)
   */
  @Put('users/:id')
  async updateUser(@Param('id') id: string, @Body() userData: UpdateUserData): Promise<User> {
    const userId = parseInt(id, 10);
    const user = await this.api.updateUser(userId, userData);

    return user;
  }

  /**
   * Get posts by user ID using new req API (simplified pattern)
   */
  @Get('users/:id/posts')
  async getUserPosts(@Param('id') id: string): Promise<PostEntity[]> {
    const userId = parseInt(id, 10);
    const posts = await this.api.getPostsByUserId(userId);
    this.logger.info(`Fetched ${posts.length} posts for user ${userId} using new req API`);

    return posts;
  }

  /**
   * Create a new post using new req API (simplified pattern)
   */
  @Post('posts')
  async createPost(@Body() postData: CreatePostData): Promise<PostEntity> {
    const newPost = await this.api.createPost(postData);

    return newPost;
  }

  /**
   * Demonstrate comprehensive error handling with \@onebun/requests (Promise API)
   */
  @Get('demo/error-handling')
  async demonstrateErrorHandling(): Promise<Response> {
    try {
      await this.api.demonstrateErrorHandling();

      return this.success({ message: 'Error handling demonstration completed - check console logs' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return this.error(`Error handling demo failed: ${errorMessage}`, HttpStatusCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Demonstrate authentication methods available in \@onebun/requests (Promise API)
   */
  @Get('demo/authentication')
  async demonstrateAuthentication(): Promise<Response> {
    try {
      await this.api.demonstrateAuthentication();

      return this.success({ message: 'Authentication methods demonstration completed - check console logs' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return this.error(`Authentication demo failed: ${errorMessage}`, HttpStatusCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Demonstrate retry functionality in \@onebun/requests (Promise API)
   */
  @Get('demo/retries')
  async demonstrateRetries(): Promise<Response> {
    try {
      await this.api.demonstrateRetries();

      return this.success({ message: 'Retry functionality demonstration completed - check console logs' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return this.error(`Retry demo failed: ${errorMessage}`, HttpStatusCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Health check endpoint that shows \@onebun/requests integration
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
        'Automatic retries and authentication',
      ],
      timestamp: Date.now(),
    });
  }


  /**
   * Demonstrate error handling with Effect API
   */
  @Get('effect/demo/error-handling')
  async demonstrateErrorHandlingEffect(): Promise<Response> {
    const { Effect: effectLib } = await import('effect');

    try {
      await effectLib.runPromise(this.api.demonstrateErrorHandlingEffect());

      return this.success({ message: 'Error handling demonstration (Effect API) completed - check console logs' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return this.error(`Error handling demo failed: ${errorMessage}`, HttpStatusCode.INTERNAL_SERVER_ERROR);
    }
  }
}
