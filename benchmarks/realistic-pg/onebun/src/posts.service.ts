import { BaseService, Service } from '@onebun/core';
import { CacheService } from '@onebun/cache';
import { DrizzleService, eq } from '@onebun/drizzle';

import { comments, posts, users } from './schema';

import type { CreatePostBody } from './schemas';

@Service()
export class PostsService extends BaseService {
  private readonly cacheTtl: number;

  constructor(
    private db: DrizzleService,
    private cache: CacheService,
  ) {
    super();
    this.cacheTtl = this.config.get('cache.ttl');
  }

  async findAll(page: number, limit: number) {
    const cacheKey = `posts:list:${page}:${limit}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) return cached;

    const offset = (page - 1) * limit;
    const result = await this.db
      .select({
        id: posts.id,
        title: posts.title,
        body: posts.body,
        published: posts.published,
        createdAt: posts.createdAt,
        authorName: users.name,
        authorEmail: users.email,
      })
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.published, true))
      .limit(limit)
      .offset(offset);

    await this.cache.set(cacheKey, result, { ttl: this.cacheTtl });
    return result;
  }

  async findById(id: number) {
    const [post] = await this.db
      .select({
        id: posts.id,
        title: posts.title,
        body: posts.body,
        published: posts.published,
        createdAt: posts.createdAt,
        authorName: users.name,
        authorEmail: users.email,
      })
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id))
      .where(eq(posts.id, id))
      .limit(1);

    if (!post) return null;

    const postComments = await this.db
      .select({
        id: comments.id,
        body: comments.body,
        authorName: users.name,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.postId, id));

    return { ...post, comments: postComments };
  }

  async create(data: CreatePostBody) {
    const [created] = await this.db
      .insert(posts)
      .values({
        title: data.title,
        body: data.body,
        authorId: data.authorId,
        published: true,
        createdAt: new Date().toISOString(),
      })
      .returning();

    return created;
  }
}
