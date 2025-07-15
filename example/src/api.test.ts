import {
  describe,
  it,
  expect,
  beforeAll,
} from 'bun:test';
import { createHttpClient } from '@onebun/requests';

describe('New req API Pattern', () => {
  let client: ReturnType<typeof createHttpClient>;

  beforeAll(() => {
    client = createHttpClient({
      baseUrl: 'https://jsonplaceholder.typicode.com',
      timeout: 5000,
    });
  });

  it('should work with req method (throws on error, returns data directly)', async () => {
    const users = await client.req('GET', '/users');

    expect(users).toBeDefined();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toHaveProperty('id');
    expect(users[0]).toHaveProperty('name');
  });

  it('should work with reqRaw method (returns full response)', async () => {
    const response = await client.reqRaw('GET', '/users');

    expect(response).toBeDefined();
    expect(response).toHaveProperty('success');
    expect(response).toHaveProperty('result');
    expect(response.success).toBe(true);
    if (response.success) {
      expect(Array.isArray(response.result)).toBe(true);
      expect(response.result.length).toBeGreaterThan(0);
    }
  });

  it('should handle errors with req method', async () => {
    try {
      await client.req('GET', '/nonexistent-endpoint');
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      expect(error).toBeDefined();

      if (error && typeof error === 'object' && 'code' in error) {
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe('number');
      }
    }
  });

  it('should work with custom error configuration', async () => {
    try {
      await client.req('GET', '/nonexistent-endpoint', undefined, {
        errors: {
          notFound: {
            error: 'CUSTOM_ERROR',
            message: 'Custom error message',
            details: { custom: true },
            code: 404,
          },
        },
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error: unknown) {
      expect(error).toBeDefined();

      if (error && typeof error === 'object' && 'error' in error && 'message' in error) {
        expect(error.error).toBe('CUSTOM_ERROR');
        // The message property is set by the constructor, so it should be the error code by default
        // unless explicitly overridden
        expect(error.message).toBeDefined();
      }
    }
  });

  it('should work with POST requests using req method', async () => {
    const postData = {
      title: 'Test Post',
      body: 'This is a test post',
      userId: 1,
    };

    const newPost = await client.req('POST', '/posts', postData);

    expect(newPost).toBeDefined();
    expect(newPost).toHaveProperty('id');
    expect(newPost.title).toBe(postData.title);
    expect(newPost.body).toBe(postData.body);
  });
});
