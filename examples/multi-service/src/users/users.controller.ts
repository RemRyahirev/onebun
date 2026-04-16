import {
  Controller,
  BaseController,
  Get,
  Post,
  Param,
  Body,
  HttpException,
  type,
} from '@onebun/core';

import { UserService } from './users.service';

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
});

type CreateUserBody = typeof createUserSchema.infer;

@Controller('/users')
export class UserController extends BaseController {
  constructor(private userService: UserService) {
    super();
  }

  @Get('/')
  async findAll() {
    const users = await this.userService.findAll();

    return users;
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    const user = await this.userService.findById(id);
    if (!user) {
      throw new HttpException(404, 'User not found');
    }

    return user;
  }

  @Post('/')
  async create(
    @Body(createUserSchema) body: CreateUserBody,
  ) {
    const user = await this.userService.create(body);

    return this.success(user, 201);
  }
}
