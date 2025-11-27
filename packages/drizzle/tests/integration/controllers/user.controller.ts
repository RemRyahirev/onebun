/**
 * User controller for integration tests - HTTP endpoints for user management
 */
import {
  ApiResponse,
  BaseController,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  type,
} from '@onebun/core';
import { createInsertSchema, createSelectSchema } from '@onebun/drizzle';

import { users, type InsertUser } from '../schema/users';
import { UserService } from '../services/user.service';

// Create validation schemas from Drizzle table
const insertUserSchema = createInsertSchema(users);
const selectUserSchema = createSelectSchema(users);

/**
 * User controller - HTTP endpoints for user management
 */
@Controller('/api/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  // eslint-disable-next-line no-magic-numbers
  @ApiResponse(200, { schema: selectUserSchema.array() })
  async getAllUsers(): Promise<Response> {
    this.logger.info('Getting all users');
    const usersList = await this.userService.getAllUsers();

    return this.success({ users: usersList, count: usersList.length });
  }

  @Get('/count')
  async getUserCount(): Promise<Response> {
    this.logger.info('Getting user count');
    const count = await this.userService.getUserCount();

    return this.success({ count });
  }

  @Get('/:id')
  // eslint-disable-next-line no-magic-numbers
  @ApiResponse(200, { schema: selectUserSchema })
  async getUserById(@Param('id', type('string')) id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('Invalid user ID', 400);
    }

    this.logger.info('Getting user by id', { id: userId });
    const user = await this.userService.getUserById(userId);
    
    if (!user) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('User not found', 404);
    }

    return this.success({ user });
  }

  @Post('/')
  // eslint-disable-next-line no-magic-numbers
  @ApiResponse(201, { schema: selectUserSchema })
  async createUser(@Body(insertUserSchema) userData: InsertUser): Promise<Response> {
    this.logger.info('Creating user', { name: userData.name, email: userData.email });
    // Convert InsertUser to the format expected by service (exclude auto-generated fields)
    const user = await this.userService.createUser({
      name: userData.name,
      email: userData.email,
      age: userData.age ?? undefined,
    });

    // eslint-disable-next-line no-magic-numbers
    return this.success({ user }, 201);
  }

  @Put('/:id')
  // eslint-disable-next-line no-magic-numbers
  @ApiResponse(200, { schema: selectUserSchema })
  async updateUser(
    @Param('id', type('string')) id: string,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    @Body(type({ 'name?': 'string', 'email?': 'string', 'age?': 'number' })) body: { name?: string; email?: string; age?: number },
  ): Promise<Response> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('Invalid user ID', 400);
    }

    if (!body || Object.keys(body).length === 0) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('No data provided for update', 400);
    }

    this.logger.info('Updating user', { id: userId, data: body });
    const user = await this.userService.updateUser(userId, body);

    if (!user) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('User not found', 404);
    }

    return this.success({ user });
  }

  @Delete('/:id')
  // eslint-disable-next-line no-magic-numbers
  @ApiResponse(200, { schema: type({ message: 'string' }) })
  async deleteUser(@Param('id', type('string')) id: string): Promise<Response> {
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('Invalid user ID', 400);
    }

    this.logger.info('Deleting user', { id: userId });
    const deleted = await this.userService.deleteUser(userId);

    if (!deleted) {
      // eslint-disable-next-line no-magic-numbers
      return this.error('User not found', 404);
    }

    return this.success({ message: 'User deleted successfully' });
  }
}
