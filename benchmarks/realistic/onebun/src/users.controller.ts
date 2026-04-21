import {
  BaseController,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@onebun/core';

import { UsersService } from './users.service';

import type { CreateUserBody } from './schemas';

@Controller('/api/users')
export class UsersController extends BaseController {
  constructor(private usersService: UsersService) {
    super();
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(parseInt(id));
  }

  @Post('/')
  async create(@Body() body: CreateUserBody) {
    return this.usersService.create(body);
  }
}
