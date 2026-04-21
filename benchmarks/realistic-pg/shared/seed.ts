#!/usr/bin/env bun

/**
 * Seeds the PostgreSQL database with test data for the realistic-pg benchmark.
 * Creates: 100 users, 500 posts, 2000 comments.
 *
 * Requires DATABASE_URL env var (e.g. postgres://bench:bench@localhost:5432/bench)
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';

import { users, posts, comments } from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const USER_COUNT = 100;
const POST_COUNT = 500;
const COMMENT_COUNT = 2000;

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// Create tables
await pool.query(`
  DROP TABLE IF EXISTS comments CASCADE;
  DROP TABLE IF EXISTS posts CASCADE;
  DROP TABLE IF EXISTS users CASCADE;

  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    bio TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    body TEXT NOT NULL,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_posts_author ON posts(author_id);
  CREATE INDEX idx_comments_post ON comments(post_id);
  CREATE INDEX idx_comments_author ON comments(author_id);
`);

// Seed users
const now = new Date().toISOString();
const userValues = Array.from({ length: USER_COUNT }, (_, i) => ({
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  bio: `Bio for user ${i + 1}. Software engineer with ${i + 1} years of experience.`,
  createdAt: now,
}));

await db.insert(users).values(userValues);

// Seed posts
const postValues = Array.from({ length: POST_COUNT }, (_, i) => ({
  title: `Post Title ${i + 1}: A Comprehensive Guide`,
  body: `This is the body of post ${i + 1}. It contains detailed information about the topic at hand. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  authorId: (i % USER_COUNT) + 1,
  published: true,
  createdAt: now,
}));

for (let i = 0; i < postValues.length; i += 100) {
  await db.insert(posts).values(postValues.slice(i, i + 100));
}

// Seed comments
const commentValues = Array.from({ length: COMMENT_COUNT }, (_, i) => ({
  body: `Comment ${i + 1}: Great post! I really enjoyed reading this. Here are my thoughts on the matter.`,
  postId: (i % POST_COUNT) + 1,
  authorId: (i % USER_COUNT) + 1,
  createdAt: now,
}));

for (let i = 0; i < commentValues.length; i += 100) {
  await db.insert(comments).values(commentValues.slice(i, i + 100));
}

await pool.end();

/* eslint-disable no-console */
console.log(`PostgreSQL database seeded at: ${DATABASE_URL}`);
console.log(`  Users: ${USER_COUNT}`);
console.log(`  Posts: ${POST_COUNT}`);
console.log(`  Comments: ${COMMENT_COUNT}`);
