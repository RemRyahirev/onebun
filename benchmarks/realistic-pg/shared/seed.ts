#!/usr/bin/env bun

/**
 * Seeds the PostgreSQL database with test data for the realistic-pg benchmark.
 * Creates: 100 users, 500 posts, 2000 comments.
 *
 * Requires DATABASE_URL env var (e.g. postgres://bench:bench@localhost:5499/bench)
 *
 * Uses Bun.sql (built-in) to avoid drizzle-orm/pg dependency (shared/ is not a workspace).
 */

import { SQL } from 'bun';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const USER_COUNT = 100;
const POST_COUNT = 500;
const COMMENT_COUNT = 2000;

const sql = new SQL(DATABASE_URL);

// Create tables
await sql.unsafe(`
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

const now = new Date().toISOString();

// Seed users
for (let i = 0; i < USER_COUNT; i++) {
  await sql`INSERT INTO users (name, email, bio, created_at) VALUES (
    ${`User ${i + 1}`},
    ${`user${i + 1}@example.com`},
    ${`Bio for user ${i + 1}. Software engineer with ${i + 1} years of experience.`},
    ${now}
  )`;
}

// Seed posts
for (let i = 0; i < POST_COUNT; i++) {
  await sql`INSERT INTO posts (title, body, author_id, published, created_at) VALUES (
    ${`Post Title ${i + 1}: A Comprehensive Guide`},
    ${`This is the body of post ${i + 1}. It contains detailed information about the topic at hand. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`},
    ${(i % USER_COUNT) + 1},
    ${true},
    ${now}
  )`;
}

// Seed comments
for (let i = 0; i < COMMENT_COUNT; i++) {
  await sql`INSERT INTO comments (body, post_id, author_id, created_at) VALUES (
    ${`Comment ${i + 1}: Great post! I really enjoyed reading this. Here are my thoughts on the matter.`},
    ${(i % POST_COUNT) + 1},
    ${(i % USER_COUNT) + 1},
    ${now}
  )`;
}

await sql.close();

/* eslint-disable no-console */
console.log(`PostgreSQL database seeded at: ${DATABASE_URL}`);
console.log(`  Users: ${USER_COUNT}`);
console.log(`  Posts: ${POST_COUNT}`);
console.log(`  Comments: ${COMMENT_COUNT}`);
