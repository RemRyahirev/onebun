import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { TestingModule, type CompiledTestingModule } from '@onebun/core/testing';

import { UserController } from './users.controller';
import { UserService } from './users.service';

describe('Multi-Service — Users API', () => {
  let app: CompiledTestingModule;

  beforeEach(async () => {
    app = await TestingModule
      .create({
        controllers: [UserController],
        providers: [UserService],
      })
      .compile();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // GET /users/:id — Read
  // =========================================================================

  describe('GET /users/:id', () => {
    test('returns a seeded user by id', async () => {
      const res = await app.inject('GET', '/users/1');

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { id: string; name: string; email: string };
      };
      expect(json.result.name).toBe('Alice');
      expect(json.result.email).toBe('alice@example.com');
    });

    test('returns second seeded user', async () => {
      const res = await app.inject('GET', '/users/2');

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { id: string; name: string; email: string };
      };
      expect(json.result.name).toBe('Bob');
      expect(json.result.email).toBe('bob@example.com');
    });

    test('returns 404 for non-existent user', async () => {
      const res = await app.inject('GET', '/users/999');

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // POST /users — Create
  // =========================================================================

  describe('POST /users', () => {
    test('creates a user', async () => {
      const res = await app.inject('POST', '/users', {
        body: { name: 'Charlie', email: 'charlie@example.com' },
      });

      expect(res.status).toBe(201);
      const json = await res.json() as {
        success: boolean;
        result: { id: string; name: string; email: string };
      };
      expect(json.success).toBe(true);
      expect(json.result.name).toBe('Charlie');
      expect(json.result.email).toBe('charlie@example.com');
      expect(json.result.id).toBeDefined();
    });

    test('created user is retrievable by id', async () => {
      const createRes = await app.inject('POST', '/users', {
        body: { name: 'Charlie', email: 'charlie@example.com' },
      });
      const { result: created } = await createRes.json() as {
        result: { id: string };
      };

      const getRes = await app.inject('GET', `/users/${created.id}`);

      expect(getRes.status).toBe(200);
      const json = await getRes.json() as {
        result: { name: string; email: string };
      };
      expect(json.result.name).toBe('Charlie');
      expect(json.result.email).toBe('charlie@example.com');
    });

    test('returns 400 for invalid body (missing email)', async () => {
      const res = await app.inject('POST', '/users', {
        body: { name: 'NoEmail' },
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid email format', async () => {
      const res = await app.inject('POST', '/users', {
        body: { name: 'Bad', email: 'not-an-email' },
      });

      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // GET /users — List
  // =========================================================================

  describe('GET /users', () => {
    test('returns seeded users', async () => {
      const res = await app.inject('GET', '/users');

      expect(res.status).toBe(200);
      const json = await res.json() as {
        success: boolean;
        result: Array<{ id: string; name: string; email: string }>;
      };
      expect(json.success).toBe(true);
      expect(json.result).toHaveLength(2);

      const names = json.result.map(u => u.name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });
  });
});
