/**
 * Documentation Examples Tests for @onebun/requests
 *
 * This file tests code examples from:
 * - packages/requests/README.md
 * - docs/api/requests.md
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  createHttpClient,
  isErrorResponse,
  HttpStatusCode,
} from './';

describe('Requests README Examples', () => {
  describe('Basic Usage with Promise API (README)', () => {
    it('should create a client with basic options', () => {
      // From README: Create a client
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        timeout: 5000,
      });

      expect(client).toBeDefined();
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.patch).toBe('function');
      expect(typeof client.delete).toBe('function');
    });
  });

  describe('Client Configuration (README)', () => {
    it('should create client with full configuration', () => {
      // From README: Client Configuration
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        timeout: 10000,
        /* eslint-disable @typescript-eslint/naming-convention */
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        /* eslint-enable @typescript-eslint/naming-convention */
        auth: {
          type: 'bearer',
          token: 'your-bearer-token',
        },
        retries: {
          max: 3,
          delay: 1000,
          backoff: 'exponential',
          retryOn: [408, 429, 500, 502, 503, 504],
        },
      });

      expect(client).toBeDefined();
    });
  });

  describe('Authentication Types (README)', () => {
    it('should create client with Bearer Token auth', () => {
      // From README: Bearer Token
      const bearerClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'bearer',
          token: 'your-token',
        },
      });

      expect(bearerClient).toBeDefined();
    });

    it('should create client with API Key auth', () => {
      // From README: API Key
      const apiKeyClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'apikey',
          key: 'X-API-Key',
          value: 'your-api-key',
        },
      });

      expect(apiKeyClient).toBeDefined();
    });

    it('should create client with Basic Auth', () => {
      // From README: Basic Auth
      const basicClient = createHttpClient({
        baseUrl: 'https://api.example.com',
        auth: {
          type: 'basic',
          username: 'user',
          password: 'pass',
        },
      });

      expect(basicClient).toBeDefined();
    });
  });

  describe('Dual API Support (README)', () => {
    it('should have both Promise and Effect APIs', () => {
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // Promise API
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.patch).toBe('function');
      expect(typeof client.delete).toBe('function');

      // Effect API
      expect(typeof client.getEffect).toBe('function');
      expect(typeof client.postEffect).toBe('function');
      expect(typeof client.putEffect).toBe('function');
      expect(typeof client.patchEffect).toBe('function');
      expect(typeof client.deleteEffect).toBe('function');
    });
  });
});

describe('Requests API Documentation Examples', () => {
  describe('Basic Requests (docs/api/requests.md)', () => {
    it('should support GET with query parameters', () => {
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // From docs: With query parameters
      // Note: This is just verifying the API signature exists
      // Actual request would need a real server
      expect(typeof client.get).toBe('function');
    });

    it('should support POST with body', () => {
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // From docs: POST with body
      expect(typeof client.post).toBe('function');
    });
  });

  describe('HTTP Status Codes (docs/api/requests.md)', () => {
    it('should export HttpStatusCode enum', () => {
      // From docs: HTTP Status Codes
      expect(HttpStatusCode.OK).toBe(200);
      expect(HttpStatusCode.CREATED).toBe(201);
      expect(HttpStatusCode.NO_CONTENT).toBe(204);
      expect(HttpStatusCode.BAD_REQUEST).toBe(400);
      expect(HttpStatusCode.UNAUTHORIZED).toBe(401);
      expect(HttpStatusCode.FORBIDDEN).toBe(403);
      expect(HttpStatusCode.NOT_FOUND).toBe(404);
      expect(HttpStatusCode.CONFLICT).toBe(409);
      expect(HttpStatusCode.UNPROCESSABLE_ENTITY).toBe(422);
      expect(HttpStatusCode.INTERNAL_SERVER_ERROR).toBe(500);
      expect(HttpStatusCode.BAD_GATEWAY).toBe(502);
      expect(HttpStatusCode.SERVICE_UNAVAILABLE).toBe(503);
    });
  });

  describe('isErrorResponse helper (docs/api/requests.md)', () => {
    it('should detect error response', () => {
      // From docs: Response Types
      // isErrorResponse checks: success === false, 'error' exists, 'code' exists and is number
      const errorResponse = {
        success: false as const,
        error: 'NOT_FOUND',
        code: 404,
        details: { message: 'Not found' },
      };

      const successResponse = {
        success: true as const,
        result: { id: '123', name: 'Test' },
      };

      expect(isErrorResponse(errorResponse)).toBe(true);
      expect(isErrorResponse(successResponse)).toBe(false);
    });

    it('should not detect incomplete error response', () => {
      // Missing 'error' field - not a valid ErrorResponse
      const incompleteError = {
        success: false as const,
        code: 404,
        message: 'Not found',
      };

      expect(isErrorResponse(incompleteError)).toBe(false);
    });
  });

  describe('Enhanced Typed Generics (README)', () => {
    it('should support typed query parameters interface', () => {
      // From README: Enhanced Typed Generics - GET Requests
      interface UserQuery {
        name?: string;
        email?: string;
        active?: boolean;
      }

      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // Method 1: Typed query parameters (recommended)
      // This just verifies the API exists
      /* eslint-disable jest/unbound-method */
      expect(typeof client.get<unknown, UserQuery>).toBe('function');
      /* eslint-enable jest/unbound-method */
    });

    it('should support typed request data interface', () => {
      // From README: POST/PUT/PATCH Requests with Typed Data
      interface CreatePostData {
        title: string;
        body: string;
        userId: number;
      }

      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
      });

      // This just verifies the API exists
      /* eslint-disable jest/unbound-method */
      expect(typeof client.post<unknown, CreatePostData>).toBe('function');
      expect(typeof client.put<unknown, CreatePostData>).toBe('function');
      expect(typeof client.patch<unknown, CreatePostData>).toBe('function');
      /* eslint-enable jest/unbound-method */
    });
  });

  describe('Retry Configuration (docs/api/requests.md)', () => {
    /**
     * @source docs/api/requests.md#retry-configuration
     */
    it('should accept retry configuration', () => {
      // From docs: Retry Configuration
      // Note: actual API uses 'backoff' not 'strategy'
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        retries: {
          // Number of retry attempts
          max: 3,

          // Backoff strategy: 'fixed', 'linear', 'exponential'
          backoff: 'exponential',

          // Base delay in milliseconds
          delay: 1000,

          // HTTP status codes to retry
          retryOn: [408, 429, 500, 502, 503, 504],
        },
      });

      expect(client).toBeDefined();
    });

    /**
     * @source docs/api/requests.md#retry-strategies
     */
    it('should accept fixed delay strategy', () => {
      // From docs: Retry Strategies - Fixed delay
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        retries: { max: 3, backoff: 'fixed', delay: 1000 },
      });

      expect(client).toBeDefined();
    });

    /**
     * @source docs/api/requests.md#retry-strategies
     */
    it('should accept linear backoff strategy', () => {
      // From docs: Retry Strategies - Linear backoff
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        retries: { max: 3, backoff: 'linear', delay: 1000 },
      });

      expect(client).toBeDefined();
    });

    /**
     * @source docs/api/requests.md#retry-strategies
     */
    it('should accept exponential backoff strategy', () => {
      // From docs: Retry Strategies - Exponential backoff
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        retries: {
          max: 3, backoff: 'exponential', delay: 1000, factor: 2, 
        },
      });

      expect(client).toBeDefined();
    });
  });
});

describe('Request Client API Methods', () => {
  const client = createHttpClient({
    baseUrl: 'https://api.example.com',
    timeout: 5000,
  });

  describe('GET Requests', () => {
    it('should have get method', () => {
      expect(typeof client.get).toBe('function');
    });

    it('should have getEffect method', () => {
      expect(typeof client.getEffect).toBe('function');
    });
  });

  describe('POST Requests', () => {
    it('should have post method', () => {
      expect(typeof client.post).toBe('function');
    });

    it('should have postEffect method', () => {
      expect(typeof client.postEffect).toBe('function');
    });
  });

  describe('PUT Requests', () => {
    it('should have put method', () => {
      expect(typeof client.put).toBe('function');
    });

    it('should have putEffect method', () => {
      expect(typeof client.putEffect).toBe('function');
    });
  });

  describe('PATCH Requests', () => {
    it('should have patch method', () => {
      expect(typeof client.patch).toBe('function');
    });

    it('should have patchEffect method', () => {
      expect(typeof client.patchEffect).toBe('function');
    });
  });

  describe('DELETE Requests', () => {
    it('should have delete method', () => {
      expect(typeof client.delete).toBe('function');
    });

    it('should have deleteEffect method', () => {
      expect(typeof client.deleteEffect).toBe('function');
    });
  });
});
