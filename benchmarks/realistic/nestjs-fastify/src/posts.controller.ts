import { Controller, Get, Post, Param, Query, Body, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { PostsService } from './posts.service';
import { CreatePostDto } from './dto';

@ApiTags('Posts')
@Controller('api/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'List posts with pagination' })
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = page ? parseInt(page) : 1;
    const l = limit ? parseInt(limit) : 20;
    return this.postsService.findAll(p, l);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by ID with comments' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  create(@Body() dto: CreatePostDto) {
    return this.postsService.create(dto);
  }
}
