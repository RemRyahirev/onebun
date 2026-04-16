import {
  Controller,
  BaseController,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpStatusCode,
  HttpException,
  ApiResponse,
} from '@onebun/core';

import {
  createUserSchema,
  updateUserSchema,
  userSchema,
  userListSchema,
  type CreateUserDto,
  type UpdateUserDto,
} from './schemas/user.schema';
import { UserService } from './users.service';

@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  /**
   * GET /api/users
   * List all users with pagination
   */
  @Get('/')
  @ApiResponse(200, { schema: userListSchema, description: 'List of users' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    // Validate pagination params
    if (pageNum < 1) {
      throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Page must be >= 1');
    }
    if (limitNum < 1 || limitNum > 100) {
      throw new HttpException(HttpStatusCode.BAD_REQUEST, 'Limit must be between 1 and 100');
    }

    const result = await this.userService.findAll(pageNum, limitNum);

    return result;
  }

  /**
   * GET /api/users/:id
   * Get user by ID
   */
  @Get('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User found' })
  @ApiResponse(404, { description: 'User not found' })
  async findOne(@Param('id') id: string) {
    try {
      const user = await this.userService.findById(id);

      return user;
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
      }
      throw error;
    }
  }

  /**
   * POST /api/users
   * Create new user
   */
  @Post('/')
  @ApiResponse(201, { schema: userSchema, description: 'User created' })
  @ApiResponse(400, { description: 'Validation error' })
  @ApiResponse(409, { description: 'Email already exists' })
  async create(
    @Body(createUserSchema) body: CreateUserDto,
  ) {
    try {
      const user = await this.userService.create(body);

      return this.success(user, HttpStatusCode.CREATED);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new HttpException(HttpStatusCode.CONFLICT, 'Email already exists');
      }
      throw error;
    }
  }

  /**
   * PUT /api/users/:id
   * Update user
   */
  @Put('/:id')
  @ApiResponse(200, { schema: userSchema, description: 'User updated' })
  @ApiResponse(400, { description: 'Validation error' })
  @ApiResponse(404, { description: 'User not found' })
  @ApiResponse(409, { description: 'Email already exists' })
  async update(
    @Param('id') id: string,
    @Body(updateUserSchema) body: UpdateUserDto,
  ) {
    try {
      const user = await this.userService.update(id, body);

      return user;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('not found')) {
          throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
        }
        if (error.message.includes('already exists')) {
          throw new HttpException(HttpStatusCode.CONFLICT, 'Email already exists');
        }
      }
      throw error;
    }
  }

  /**
   * DELETE /api/users/:id
   * Delete user
   */
  @Delete('/:id')
  @ApiResponse(200, { description: 'User deleted' })
  @ApiResponse(404, { description: 'User not found' })
  async delete(@Param('id') id: string) {
    try {
      await this.userService.delete(id);

      return { deleted: true, id };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new HttpException(HttpStatusCode.NOT_FOUND, 'User not found');
      }
      throw error;
    }
  }
}
