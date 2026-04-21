#!/usr/bin/env bun

/**
 * Seeds the SQLite database with test data for the realistic benchmark.
 * Creates: 100 users, 500 posts, 2000 comments.
 *
 * Usage: bun run benchmarks/realistic/shared/seed.ts [output-path]
 * Default output: benchmarks/realistic/shared/bench.db
 */

import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

import { users, posts, comments } from './schema';

const SCRIPT_DIR = import.meta.dir;
const DB_PATH = process.argv[2] || join(SCRIPT_DIR, 'bench.db');

const USER_COUNT = 100;
const POST_COUNT = 500;
const COMMENT_COUNT = 2000;

// Remove existing database
if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
}

const sqlite = new Database(DB_PATH);
sqlite.run('PRAGMA journal_mode = WAL');
sqlite.run('PRAGMA synchronous = NORMAL');

// Create tables
sqlite.run(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    bio TEXT,
    created_at TEXT NOT NULL
  )
`);

sqlite.run(`
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )
`);

sqlite.run(`
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  )
`);

sqlite.run('CREATE INDEX idx_posts_author ON posts(author_id)');
sqlite.run('CREATE INDEX idx_comments_post ON comments(post_id)');
sqlite.run('CREATE INDEX idx_comments_author ON comments(author_id)');

const db = drizzle(sqlite);

// Seed users
const now = new Date().toISOString();
const userValues = Array.from({ length: USER_COUNT }, (_, i) => ({
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  bio: `Bio for user ${i + 1}. Software engineer with ${i + 1} years of experience.`,
  createdAt: now,
}));

db.insert(users).values(userValues).run();

// Seed posts
const postValues = Array.from({ length: POST_COUNT }, (_, i) => ({
  title: `Post Title ${i + 1}: A Comprehensive Guide`,
  body: `This is the body of post ${i + 1}. It contains detailed information about the topic at hand. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
  authorId: (i % USER_COUNT) + 1,
  published: true,
  createdAt: now,
}));

// Insert in batches of 100 to avoid SQLite limits
for (let i = 0; i < postValues.length; i += 100) {
  db.insert(posts).values(postValues.slice(i, i + 100)).run();
}

// Seed comments
const commentValues = Array.from({ length: COMMENT_COUNT }, (_, i) => ({
  body: `Comment ${i + 1}: Great post! I really enjoyed reading this. Here are my thoughts on the matter.`,
  postId: (i % POST_COUNT) + 1,
  authorId: (i % USER_COUNT) + 1,
  createdAt: now,
}));

for (let i = 0; i < commentValues.length; i += 100) {
  db.insert(comments).values(commentValues.slice(i, i + 100)).run();
}

// Checkpoint WAL to consolidate data into main .db file for safe copying
sqlite.run('PRAGMA wal_checkpoint(TRUNCATE)');
sqlite.close();

/* eslint-disable no-console */
console.log(`Database seeded at: ${DB_PATH}`);
console.log(`  Users: ${USER_COUNT}`);
console.log(`  Posts: ${POST_COUNT}`);
console.log(`  Comments: ${COMMENT_COUNT}`);
