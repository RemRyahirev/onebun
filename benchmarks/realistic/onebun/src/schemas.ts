import { type } from '@onebun/core';

export const createPostSchema = type({
  title: 'string >= 3',
  body: 'string >= 10',
  authorId: 'number > 0',
});

export type CreatePostBody = typeof createPostSchema.infer;

export const createUserSchema = type({
  name: 'string >= 1',
  email: 'string.email',
});

export type CreateUserBody = typeof createUserSchema.infer;
