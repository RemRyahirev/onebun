#!/usr/bin/env bun

/**
 * Seeds the SQLite database with test data for the realistic benchmark.
 * Creates: 100 users, 500 posts, 2000 comments.
 *
 * Usage: bun run benchmarks/realistic/shared/seed.ts [output-path]
 * Default output: benchmarks/realistic/shared/bench.db
 *
 * Uses raw bun:sqlite to avoid drizzle-orm dependency (shared/ is not a workspace).
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

const SCRIPT_DIR = import.meta.dir;
const DB_PATH = process.argv[2] || join(SCRIPT_DIR, 'bench.db');

const USER_COUNT = 100;
const POST_COUNT = 500;
const COMMENT_COUNT = 2000;

// Remove existing database
if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA synchronous = NORMAL');

// Create tables
db.run(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    bio TEXT,
    created_at TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    author_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  )
`);

db.run('CREATE INDEX idx_posts_author ON posts(author_id)');
db.run('CREATE INDEX idx_comments_post ON comments(post_id)');
db.run('CREATE INDEX idx_comments_author ON comments(author_id)');

const now = new Date().toISOString();

// Seed users
const insertUser = db.prepare('INSERT INTO users (name, email, bio, created_at) VALUES (?, ?, ?, ?)');
const insertUsers = db.transaction(() => {
  for (let i = 0; i < USER_COUNT; i++) {
    insertUser.run(
      `User ${i + 1}`,
      `user${i + 1}@example.com`,
      `Bio for user ${i + 1}. Software engineer with ${i + 1} years of experience.`,
      now,
    );
  }
});
insertUsers();

// Seed posts
const insertPost = db.prepare(
  'INSERT INTO posts (title, body, author_id, published, created_at) VALUES (?, ?, ?, ?, ?)',
);
const insertPosts = db.transaction(() => {
  for (let i = 0; i < POST_COUNT; i++) {
    insertPost.run(
      `Post Title ${i + 1}: A Comprehensive Guide`,
      `This is the body of post ${i + 1}. It contains detailed information about the topic at hand. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
      (i % USER_COUNT) + 1,
      1,
      now,
    );
  }
});
insertPosts();

// Seed comments
const insertComment = db.prepare(
  'INSERT INTO comments (body, post_id, author_id, created_at) VALUES (?, ?, ?, ?)',
);
const insertComments = db.transaction(() => {
  for (let i = 0; i < COMMENT_COUNT; i++) {
    insertComment.run(
      `Comment ${i + 1}: Great post! I really enjoyed reading this. Here are my thoughts on the matter.`,
      (i % POST_COUNT) + 1,
      (i % USER_COUNT) + 1,
      now,
    );
  }
});
insertComments();

// Checkpoint WAL to consolidate data into main .db file for safe copying
db.run('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

/* eslint-disable no-console */
console.log(`Database seeded at: ${DB_PATH}`);
console.log(`  Users: ${USER_COUNT}`);
console.log(`  Posts: ${POST_COUNT}`);
console.log(`  Comments: ${COMMENT_COUNT}`);
