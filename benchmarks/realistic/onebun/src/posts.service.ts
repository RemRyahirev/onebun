import { BaseService, Service } from '@onebun/core';
import { DrizzleService, eq } from '@onebun/drizzle';

import { comments, posts, users } from './schema';

import type { CreatePostBody } from './schemas';

@Service()
export class PostsService extends BaseService {
  constructor(private db: DrizzleService) {
    super();
  }

  async findAll(page: number, limit: number) {
    const offset = (page - 1) * limit;
    return this.db
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
