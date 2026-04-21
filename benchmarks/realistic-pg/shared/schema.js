"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.comments = exports.posts = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    name: (0, pg_core_1.text)('name').notNull(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    bio: (0, pg_core_1.text)('bio'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
});
exports.posts = (0, pg_core_1.pgTable)('posts', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    title: (0, pg_core_1.text)('title').notNull(),
    body: (0, pg_core_1.text)('body').notNull(),
    authorId: (0, pg_core_1.integer)('author_id').notNull().references(() => exports.users.id),
    published: (0, pg_core_1.boolean)('published').notNull().default(true),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
});
exports.comments = (0, pg_core_1.pgTable)('comments', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    body: (0, pg_core_1.text)('body').notNull(),
    postId: (0, pg_core_1.integer)('post_id').notNull().references(() => exports.posts.id),
    authorId: (0, pg_core_1.integer)('author_id').notNull().references(() => exports.users.id),
    createdAt: (0, pg_core_1.timestamp)('created_at', { mode: 'string' }).notNull().defaultNow(),
});
