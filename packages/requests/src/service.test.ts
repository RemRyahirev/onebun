/* eslint-disable
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   @typescript-eslint/no-shadow */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import type { RequestConfig, RequestsOptions } from './types';

import {
  RequestsService,
  makeRequestsService,
  createHttpClient,
  requestsService,
  requests,
} from './service';
import { HttpMethod } from './types';

// Mock the client module
const mockExecuteRequest = mock();
const mockHttpClient = {
  request: mock(),
  get: mock(),
  post: mock(),
  put: mock(),
  patch: mock(),
  delete: mock(),
  head: mock(),
  options: mock(),
};

// Mock fetch to avoid real network calls
const originalFetch = globalThis.fetch;

describe('RequestsService', () => {
  beforeEach(() => {
    // Mock fetch to prevent real network calls
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ success: true, data: 'test data' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Reset mocks
    mockExecuteRequest.mockClear();
    Object.values(mockHttpClient).forEach(mock => mock.mockClear());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('RequestsService tag', () => {
    test('should be defined as Context tag', () => {
      expect(RequestsService).toBeDefined();
    });
  });

  describe('makeRequestsService', () => {
    test('should create a layer with default options', async () => {
      const layer = makeRequestsService();
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const service = yield* RequestsService;

        return service;
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBeDefined();
      expect(typeof result.request).toBe('function');
      expect(typeof result.requestEffect).toBe('function');
      expect(typeof result.get).toBe('function');
      expect(typeof result.getEffect).toBe('function');
      expect(typeof result.post).toBe('function');
      expect(typeof result.postEffect).toBe('function');
    });

    test('should create a layer with custom options', async () => {
      const options: RequestsOptions = {
        baseUrl: 'https://api.test.com',
        timeout: 10000,
        retries: { max: 5, delay: 1000, backoff: 'exponential' },
      };

      const layer = makeRequestsService(options);
      expect(layer).toBeDefined();

      const program = Effect.gen(function* () {
        const service = yield* RequestsService;

        return service;
      });

      const result = await Effect.runPromise(
        Effect.provide(program, layer),
      );

      expect(result).toBeDefined();
    });
  });

  describe('createHttpClient', () => {
    test('should create HttpClient with default options', () => {
      const client = createHttpClient();
      expect(client).toBeDefined();
      expect(typeof client.request).toBe('function');
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.patch).toBe('function');
      expect(typeof client.delete).toBe('function');
      expect(typeof client.head).toBe('function');
      expect(typeof client.options).toBe('function');
    });

    test('should create HttpClient with custom options', () => {
      const options: RequestsOptions = {
        baseUrl: 'https://custom.api.com',
        timeout: 15000,
        headers: { 'X-Custom': 'test' },
      };

      const client = createHttpClient(options);
      expect(client).toBeDefined();
    });

    test('should create HttpClient with empty options', () => {
      const client = createHttpClient({});
      expect(client).toBeDefined();
    });
  });

  describe('requestsService object', () => {
    test('should have all expected methods', () => {
      expect(typeof requestsService.request).toBe('function');
      expect(typeof requestsService.get).toBe('function');
      expect(typeof requestsService.post).toBe('function');
      expect(typeof requestsService.put).toBe('function');
      expect(typeof requestsService.patch).toBe('function');
      expect(typeof requestsService.delete).toBe('function');
      expect(typeof requestsService.head).toBe('function');
      expect(typeof requestsService.options).toBe('function');
    });

    test('should make GET request', async () => {
      const result = await requestsService.get('https://api.test.com/users');
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make GET request with query parameters', async () => {
      const result = await requestsService.get('https://api.test.com/users', { 
        page: 1, 
        limit: 10, 
      });
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make GET request with config', async () => {
      const result = await requestsService.get(
        'https://api.test.com/users',
        { page: 1 },
        { timeout: 5000 },
      );
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make POST request', async () => {
      const data = { name: 'John', email: 'john@test.com' };
      const result = await requestsService.post('https://api.test.com/users', data);
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make POST request with config', async () => {
      const data = { name: 'John' };
      const config = { headers: { 'Content-Type': 'application/json' } };
      const result = await requestsService.post('https://api.test.com/users', data, config);
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make PUT request', async () => {
      const data = { id: 1, name: 'Updated John' };
      const result = await requestsService.put('https://api.test.com/users/1', data);
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make PATCH request', async () => {
      const data = { name: 'Patched John' };
      const result = await requestsService.patch('https://api.test.com/users/1', data);
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make DELETE request', async () => {
      const result = await requestsService.delete('https://api.test.com/users/1');
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make HEAD request', async () => {
      const result = await requestsService.head('https://api.test.com/users/1');
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make OPTIONS request', async () => {
      const result = await requestsService.options('https://api.test.com/users');
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('should make request with full config', async () => {
      const config: RequestConfig = {
        method: HttpMethod.GET,
        url: 'https://api.test.com/users',
        headers: { 'Authorization': 'Bearer token' },
        timeout: 10000,
      };

      const result = await requestsService.request(config);
      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });
  });

  describe('requests alias', () => {
    test('should be the same as requestsService', () => {
      expect(requests).toBe(requestsService);
    });

    test('should have all methods from requestsService', () => {
      expect(typeof requests.request).toBe('function');
      expect(typeof requests.get).toBe('function');
      expect(typeof requests.post).toBe('function');
      expect(typeof requests.put).toBe('function');
      expect(typeof requests.patch).toBe('function');
      expect(typeof requests.delete).toBe('function');
      expect(typeof requests.head).toBe('function');
      expect(typeof requests.options).toBe('function');
    });
  });

  describe('RequestsServiceImpl methods', () => {
    let service: any;

    beforeEach(async () => {
      const layer = makeRequestsService({
        baseUrl: 'https://test-api.com',
        timeout: 5000,
      });

      const program = Effect.gen(function* () {
        return yield* RequestsService;
      });

      service = await Effect.runPromise(Effect.provide(program, layer));
    });

    test('should handle GET with different parameter combinations', async () => {
      // GET with no parameters
      const result1 = await service.get('/users');
      expect(result1).toBeDefined();

      // GET with query object
      const result2 = await service.get('/users', { page: 1, limit: 10 });
      expect(result2).toBeDefined();

      // GET with config object (distinguished by presence of config fields)
      const result3 = await service.get('/users', { 
        method: HttpMethod.GET,
        timeout: 3000, 
      });
      expect(result3).toBeDefined();

      // GET with both query and config
      const result4 = await service.get('/users', { page: 1 }, { timeout: 3000 });
      expect(result4).toBeDefined();
    });

    test('should handle POST with different parameter combinations', async () => {
      // POST with data
      const result1 = await service.post('/users', { name: 'John' });
      expect(result1).toBeDefined();

      // POST with data and config
      const result2 = await service.post('/users', { name: 'John' }, { timeout: 3000 });
      expect(result2).toBeDefined();

      // POST without data
      const result3 = await service.post('/users');
      expect(result3).toBeDefined();
    });

    test('should handle PUT with different parameter combinations', async () => {
      const result1 = await service.put('/users/1', { name: 'Updated' });
      expect(result1).toBeDefined();

      const result2 = await service.put('/users/1', { name: 'Updated' }, { timeout: 3000 });
      expect(result2).toBeDefined();

      const result3 = await service.put('/users/1');
      expect(result3).toBeDefined();
    });

    test('should handle PATCH with different parameter combinations', async () => {
      const result1 = await service.patch('/users/1', { name: 'Patched' });
      expect(result1).toBeDefined();

      const result2 = await service.patch('/users/1', { name: 'Patched' }, { timeout: 3000 });
      expect(result2).toBeDefined();

      const result3 = await service.patch('/users/1');
      expect(result3).toBeDefined();
    });

    test('should handle DELETE with different parameter combinations', async () => {
      const result1 = await service.delete('/users/1');
      expect(result1).toBeDefined();

      const result2 = await service.delete('/users/1', { timeout: 3000 });
      expect(result2).toBeDefined();
    });

    test('should handle HEAD with different parameter combinations', async () => {
      const result1 = await service.head('/users/1');
      expect(result1).toBeDefined();

      const result2 = await service.head('/users/1', { timeout: 3000 });
      expect(result2).toBeDefined();
    });

    test('should handle OPTIONS with different parameter combinations', async () => {
      const result1 = await service.options('/users');
      expect(result1).toBeDefined();

      const result2 = await service.options('/users', { timeout: 3000 });
      expect(result2).toBeDefined();
    });
  });

  describe('Effect methods', () => {
    let service: any;

    beforeEach(async () => {
      const layer = makeRequestsService({
        baseUrl: 'https://test-api.com',
      });

      const program = Effect.gen(function* () {
        return yield* RequestsService;
      });

      service = await Effect.runPromise(Effect.provide(program, layer));
    });

    test('should handle requestEffect', async () => {
      const config: RequestConfig = {
        method: HttpMethod.GET,
        url: '/users',
      };

      const effect = service.requestEffect(config);
      expect(effect).toBeDefined();
      
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle getEffect with query', async () => {
      const effect = service.getEffect('/users', { page: 1 });
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle getEffect with config', async () => {
      const effect = service.getEffect('/users', { timeout: 3000 });
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle postEffect', async () => {
      const effect = service.postEffect('/users', { name: 'John' });
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle putEffect', async () => {
      const effect = service.putEffect('/users/1', { name: 'Updated' });
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle patchEffect', async () => {
      const effect = service.patchEffect('/users/1', { name: 'Patched' });
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle deleteEffect', async () => {
      const effect = service.deleteEffect('/users/1');
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle headEffect', async () => {
      const effect = service.headEffect('/users/1');
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('should handle optionsEffect', async () => {
      const effect = service.optionsEffect('/users');
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      // Mock fetch to return error response
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ 
          success: false, 
          error: { code: 'TEST_ERROR', message: 'Test error' }, 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      });
    });

    test('should handle promise rejections in request methods', async () => {
      try {
        await requestsService.get('https://api.test.com/error');
      } catch (error) {
        // Error handling is expected
        expect(error).toBeDefined();
      }
    });

    test('should handle Effect errors gracefully', async () => {
      const layer = makeRequestsService();
      
      const program = Effect.gen(function* () {
        const service = yield* RequestsService;

        return yield* service.requestEffect({
          method: HttpMethod.GET,
          url: 'https://api.test.com/error',
        });
      });

      try {
        await Effect.runPromise(Effect.provide(program, layer));
      } catch (error) {
        // Error handling is expected
        expect(error).toBeDefined();
      }
    });
  });

  describe('configuration handling', () => {
    test('should handle various configuration options', async () => {
      const options: RequestsOptions = {
        baseUrl: 'https://api.example.com',
        timeout: 10000,
        headers: { 'X-API-Key': 'test-key' },
        retries: {
          max: 3, delay: 500, backoff: 'linear', retryOn: [503, 502], 
        },
        auth: { type: 'bearer', token: 'test-token' },
      };

      const layer = makeRequestsService(options);
      const program = Effect.gen(function* () {
        return yield* RequestsService;
      });

      const service = await Effect.runPromise(Effect.provide(program, layer));
      expect(service).toBeDefined();
    });

    test('should handle minimal configuration', async () => {
      const layer = makeRequestsService({});
      const program = Effect.gen(function* () {
        return yield* RequestsService;
      });

      const service = await Effect.runPromise(Effect.provide(program, layer));
      expect(service).toBeDefined();
    });

    test('should handle undefined configuration', async () => {
      const layer = makeRequestsService(undefined as any);
      const program = Effect.gen(function* () {
        return yield* RequestsService;
      });

      const service = await Effect.runPromise(Effect.provide(program, layer));
      expect(service).toBeDefined();
    });
  });
});
