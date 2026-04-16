import {
  describe,
  test,
  expect,
} from 'bun:test';

import {
  sqliteTable,
  integer,
  text,
} from '../src/sqlite';
import {
  createSelectSchema,
  createInsertSchema,
  createUpdateSchema,
} from '../src/validation/schemas';

// Minimal SQLite table for testing schema generation
const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

// Table with optional fields to test insert/update distinctions
const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body'),
});

describe('createSelectSchema', () => {
  test('should return a defined schema object', () => {
    const schema = createSelectSchema(users);
    expect(schema).toBeDefined();
  });

  test('should return an object with assert method (arktype Type)', () => {
    const schema = createSelectSchema(users);
    expect(typeof schema.assert).toBe('function');
  });

  test('should validate a valid select object', () => {
    const schema = createSelectSchema(users);
    const validUser = { id: 1, name: 'Alice', email: 'alice@example.com' };
    expect(() => schema.assert(validUser)).not.toThrow();
  });

  test('should reject an object missing required fields', () => {
    const schema = createSelectSchema(users);
    const invalid = { id: 1 };
    expect(() => schema.assert(invalid)).toThrow();
  });

  test('should work for different table schemas', () => {
    const schema = createSelectSchema(posts);
    expect(schema).toBeDefined();
    const validPost = { id: 1, title: 'Hello', body: null };
    expect(() => schema.assert(validPost)).not.toThrow();
  });
});

describe('createInsertSchema', () => {
  test('should return a defined schema object', () => {
    const schema = createInsertSchema(users);
    expect(schema).toBeDefined();
  });

  test('should return an object with assert method (arktype Type)', () => {
    const schema = createInsertSchema(users);
    expect(typeof schema.assert).toBe('function');
  });

  test('should validate a valid insert object (without auto-generated id)', () => {
    const schema = createInsertSchema(users);
    const validInsert = { name: 'Bob', email: 'bob@example.com' };
    expect(() => schema.assert(validInsert)).not.toThrow();
  });

  test('should reject an object missing required non-generated fields', () => {
    const schema = createInsertSchema(users);
    const invalid = { email: 'only@email.com' };
    expect(() => schema.assert(invalid)).toThrow();
  });

  test('should work for different table schemas', () => {
    const schema = createInsertSchema(posts);
    expect(schema).toBeDefined();
    const validInsert = { title: 'My Post' };
    expect(() => schema.assert(validInsert)).not.toThrow();
  });
});

describe('createUpdateSchema', () => {
  test('should return a defined schema object', () => {
    const schema = createUpdateSchema(users);
    expect(schema).toBeDefined();
  });

  test('should return an object with assert method (arktype Type)', () => {
    const schema = createUpdateSchema(users);
    expect(typeof schema.assert).toBe('function');
  });

  test('should validate an object with only some fields (partial update)', () => {
    const schema = createUpdateSchema(users);
    const partialUpdate = { name: 'Charlie' };
    expect(() => schema.assert(partialUpdate)).not.toThrow();
  });

  test('should validate an empty object (all fields optional in update)', () => {
    const schema = createUpdateSchema(users);
    expect(() => schema.assert({})).not.toThrow();
  });

  test('should work for different table schemas', () => {
    const schema = createUpdateSchema(posts);
    expect(schema).toBeDefined();
    const partialUpdate = { body: 'Updated body' };
    expect(() => schema.assert(partialUpdate)).not.toThrow();
  });
});
