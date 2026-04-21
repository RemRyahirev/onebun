import {
  BaseController,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@onebun/core';

import { PostsService } from './posts.service';

import type { CreatePostBody } from './schemas';

@Controller('/api/posts')
export class PostsController extends BaseController {
  constructor(private postsService: PostsService) {
    super();
  }

  @Get('/')
  async findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    const p = page ? parseInt(page) : 1;
    const l = limit ? parseInt(limit) : 20;
    return this.postsService.findAll(p, l);
  }

  @Get('/:id')
  async findOne(@Param('id') id: string) {
    return this.postsService.findById(parseInt(id));
  }

  @Post('/')
  async create(@Body() body: CreatePostBody) {
    return this.postsService.create(body);
  }
}
