import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Post } from './entities';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
  ) {}

  async findAll(page: number, limit: number) {
    const offset = (page - 1) * limit;
    return this.postRepo.find({
      where: { published: true },
      relations: ['author'],
      select: {
        id: true,
        title: true,
        body: true,
        published: true,
        createdAt: true,
        author: { name: true, email: true },
      },
      skip: offset,
      take: limit,
    });
  }

  async findById(id: number) {
    const post = await this.postRepo.findOne({
      where: { id },
      relations: ['author', 'comments', 'comments.author'],
      select: {
        id: true,
        title: true,
        body: true,
        published: true,
        createdAt: true,
        author: { name: true, email: true },
        comments: {
          id: true,
          body: true,
          createdAt: true,
          author: { name: true },
        },
      },
    });
    return post ?? null;
  }

  async create(data: { title: string; body: string; authorId: number }) {
    const post = this.postRepo.create({
      title: data.title,
      body: data.body,
      authorId: data.authorId,
      published: true,
      createdAt: new Date().toISOString(),
    });
    return this.postRepo.save(post);
  }
}
