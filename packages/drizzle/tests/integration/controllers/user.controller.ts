/**
 * User controller for integration tests - HTTP endpoints for user management
 */
import {
  BaseController,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@onebun/core';

import { UserService } from '../services/user.service';

/**
 * User controller - HTTP endpoints for user management
 */
@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  async getAllUsers(): Promise<Response> {
    this.logger.info('Getting all users');
    const users = await this.userService.getAllUsers();

    return this.success({ users, count: users.length });
  }

  @Get('/count')
  async getUserCount(): Promise<Response> {
    this.logger.info('Getting user count');
    const count = await this.userService.getUserCount();

    return this.success({ count });
  }

  @Get('/:id')
  async getUserById(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      return this.error('Invalid user ID', 400);
    }

    this.logger.info('Getting user by id', { id: userId });
    const user = await this.userService.getUserById(userId);
    
    if (!user) {
      return this.error('User not found', 404);
    }

    return this.success({ user });
  }

  @Post('/')
  async createUser(@Body() body?: { name?: string; email?: string; age?: number }): Promise<Response> {
    if (!body?.name || !body?.email) {
      return this.error('Name and email are required', 400);
    }

    this.logger.info('Creating user', { name: body.name, email: body.email });
    const user = await this.userService.createUser({
      name: body.name,
      email: body.email,
      age: body.age,
    });

    return this.success({ user }, 201);
  }

  @Put('/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() body?: { name?: string; email?: string; age?: number },
  ): Promise<Response> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      return this.error('Invalid user ID', 400);
    }

    if (!body || Object.keys(body).length === 0) {
      return this.error('No data provided for update', 400);
    }

    this.logger.info('Updating user', { id: userId, data: body });
    const user = await this.userService.updateUser(userId, body);

    if (!user) {
      return this.error('User not found', 404);
    }

    return this.success({ user });
  }

  @Delete('/:id')
  async deleteUser(@Param('id') id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      return this.error('Invalid user ID', 400);
    }

    this.logger.info('Deleting user', { id: userId });
    const deleted = await this.userService.deleteUser(userId);

    if (!deleted) {
      return this.error('User not found', 404);
    }

    return this.success({ message: 'User deleted successfully' });
  }
}
