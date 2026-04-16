import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { TestingModule, type CompiledTestingModule } from '@onebun/core/testing';

import { UserController } from './users.controller';
import { UserRepository } from './users.repository';
import { UserService } from './users.service';

describe('CRUD API — Users', () => {
  let app: CompiledTestingModule;

  beforeEach(async () => {
    app = await TestingModule
      .create({
        controllers: [UserController],
        providers: [UserService, UserRepository],
      })
      .compile();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // POST /api/users — Create
  // =========================================================================

  describe('POST /api/users', () => {
    test('creates a user with required fields only', async () => {
      const res = await app.inject('POST', '/api/users', {
        body: { name: 'Alice', email: 'alice@example.com' },
      });

      expect(res.status).toBe(201);
      const json = await res.json() as {
        success: boolean;
        result: { id: string; name: string; email: string; role: string };
      };
      expect(json.success).toBe(true);
      expect(json.result.name).toBe('Alice');
      expect(json.result.email).toBe('alice@example.com');
      expect(json.result.role).toBe('user');
      expect(json.result.id).toBeDefined();
    });

    test('creates a user with all optional fields', async () => {
      const res = await app.inject('POST', '/api/users', {
        body: { name: 'Bob', email: 'bob@example.com', age: 25, role: 'admin' },
      });

      expect(res.status).toBe(201);
      const json = await res.json() as {
        success: boolean;
        result: { age: number; role: string };
      };
      expect(json.result.age).toBe(25);
      expect(json.result.role).toBe('admin');
    });

    test('returns 400 for invalid body (missing email)', async () => {
      const res = await app.inject('POST', '/api/users', {
        body: { name: 'NoEmail' },
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 for short name', async () => {
      const res = await app.inject('POST', '/api/users', {
        body: { name: 'A', email: 'a@example.com' },
      });

      expect(res.status).toBe(400);
    });

    test('returns 409 for duplicate email', async () => {
      await app.inject('POST', '/api/users', {
        body: { name: 'First', email: 'dup@example.com' },
      });

      const res = await app.inject('POST', '/api/users', {
        body: { name: 'Second', email: 'dup@example.com' },
      });

      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // GET /api/users — List
  // =========================================================================

  describe('GET /api/users', () => {
    test('returns empty list initially', async () => {
      const res = await app.inject('GET', '/api/users');

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { users: unknown[]; total: number; page: number; limit: number };
      };
      expect(json.result.users).toEqual([]);
      expect(json.result.total).toBe(0);
      expect(json.result.page).toBe(1);
      expect(json.result.limit).toBe(10);
    });

    test('returns created users', async () => {
      await app.inject('POST', '/api/users', {
        body: { name: 'Alice', email: 'alice@example.com' },
      });
      await app.inject('POST', '/api/users', {
        body: { name: 'Bob', email: 'bob@example.com' },
      });

      const res = await app.inject('GET', '/api/users');
      const json = await res.json() as {
        result: { users: unknown[]; total: number };
      };

      expect(json.result.total).toBe(2);
      expect(json.result.users).toHaveLength(2);
    });

    test('supports pagination', async () => {
      for (let i = 1; i <= 3; i++) {
        await app.inject('POST', '/api/users', {
          body: { name: `User${i}`, email: `user${i}@example.com` },
        });
      }

      const res = await app.inject('GET', '/api/users', {
        query: { page: '2', limit: '2' },
      });
      const json = await res.json() as {
        result: { users: unknown[]; total: number; page: number; limit: number };
      };

      expect(json.result.total).toBe(3);
      expect(json.result.users).toHaveLength(1);
      expect(json.result.page).toBe(2);
      expect(json.result.limit).toBe(2);
    });

    test('returns 400 for invalid page', async () => {
      const res = await app.inject('GET', '/api/users', {
        query: { page: '0' },
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid limit', async () => {
      const res = await app.inject('GET', '/api/users', {
        query: { limit: '101' },
      });

      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // GET /api/users/:id — Read
  // =========================================================================

  describe('GET /api/users/:id', () => {
    test('returns a user by id', async () => {
      const createRes = await app.inject('POST', '/api/users', {
        body: { name: 'Alice', email: 'alice@example.com' },
      });
      const { result: created } = await createRes.json() as {
        result: { id: string };
      };

      const res = await app.inject('GET', `/api/users/${created.id}`);

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { id: string; name: string };
      };
      expect(json.result.id).toBe(created.id);
      expect(json.result.name).toBe('Alice');
    });

    test('returns 404 for non-existent user', async () => {
      const res = await app.inject('GET', '/api/users/non-existent-id');

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // PUT /api/users/:id — Update
  // =========================================================================

  describe('PUT /api/users/:id', () => {
    test('updates user fields', async () => {
      const createRes = await app.inject('POST', '/api/users', {
        body: { name: 'Alice', email: 'alice@example.com' },
      });
      const { result: created } = await createRes.json() as {
        result: { id: string };
      };

      const res = await app.inject('PUT', `/api/users/${created.id}`, {
        body: { name: 'Alice Updated' },
      });

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { name: string; email: string };
      };
      expect(json.result.name).toBe('Alice Updated');
      expect(json.result.email).toBe('alice@example.com');
    });

    test('returns 404 for non-existent user', async () => {
      const res = await app.inject('PUT', '/api/users/non-existent-id', {
        body: { name: 'Ghost' },
      });

      expect(res.status).toBe(404);
    });

    test('returns 409 when updating to existing email', async () => {
      await app.inject('POST', '/api/users', {
        body: { name: 'Alice', email: 'alice@example.com' },
      });
      const createRes = await app.inject('POST', '/api/users', {
        body: { name: 'Bob', email: 'bob@example.com' },
      });
      const { result: bob } = await createRes.json() as {
        result: { id: string };
      };

      const res = await app.inject('PUT', `/api/users/${bob.id}`, {
        body: { email: 'alice@example.com' },
      });

      expect(res.status).toBe(409);
    });
  });

  // =========================================================================
  // DELETE /api/users/:id — Delete
  // =========================================================================

  describe('DELETE /api/users/:id', () => {
    test('deletes a user', async () => {
      const createRes = await app.inject('POST', '/api/users', {
        body: { name: 'Alice', email: 'alice@example.com' },
      });
      const { result: created } = await createRes.json() as {
        result: { id: string };
      };

      const res = await app.inject('DELETE', `/api/users/${created.id}`);

      expect(res.status).toBe(200);
      const json = await res.json() as {
        result: { deleted: boolean; id: string };
      };
      expect(json.result.deleted).toBe(true);

      // Verify deletion
      const getRes = await app.inject('GET', `/api/users/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    test('returns 404 for non-existent user', async () => {
      const res = await app.inject('DELETE', '/api/users/non-existent-id');

      expect(res.status).toBe(404);
    });
  });
});
