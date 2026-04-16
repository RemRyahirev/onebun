import { type } from '@onebun/core';

/**
 * User entity schema
 */
/* eslint-disable @typescript-eslint/naming-convention */
export const userSchema = type({
  id: 'string',
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',
  role: '"admin" | "user" | "guest"',
  createdAt: 'string',
  updatedAt: 'string',
});

export type User = typeof userSchema.infer;

/**
 * Create user DTO schema
 */
export const createUserSchema = type({
  'name': 'string >= 2',
  'email': 'string.email',
  'age?': 'number > 0',
  'role?': '"admin" | "user" | "guest"',
});
/* eslint-enable @typescript-eslint/naming-convention */

export type CreateUserDto = typeof createUserSchema.infer;

/**
 * Update user DTO schema (partial of CreateUserDto)
 */
export const updateUserSchema = createUserSchema.partial();

export type UpdateUserDto = typeof updateUserSchema.infer;

/**
 * User list response schema
 */
export const userListSchema = type({
  users: userSchema.array(),
  total: 'number',
  page: 'number',
  limit: 'number',
});

export type UserListResponse = typeof userListSchema.infer;
