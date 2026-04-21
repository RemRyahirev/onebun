import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Cache } from 'cache-manager';
import { Repository } from 'typeorm';

import { Post } from './entities';

const CACHE_TTL = 30;

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly postRepo: Repository<Post>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async findAll(page: number, limit: number) {
    const cacheKey = `posts:list:${page}:${limit}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * limit;
    const result = await this.postRepo.find({
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

    await this.cacheManager.set(cacheKey, result, CACHE_TTL);
    return result;
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
