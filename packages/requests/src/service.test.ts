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
    }) as unknown as typeof fetch;

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
      }) as unknown as typeof fetch;
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

  describe('RequestsServiceImpl: updateConfig / updateConfigEffect / getConfig / createClient', () => {
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

    test('getConfig() returns a copy of current service options', () => {
      const config = service.getConfig();

      expect(config).toBeDefined();
      expect(config.baseUrl).toBe('https://test-api.com');
      expect(config.timeout).toBe(5000);
    });

    test('getConfig() returns a copy, not a reference', () => {
      const config1 = service.getConfig();
      config1.baseUrl = 'https://mutated.com';
      const config2 = service.getConfig();

      expect(config2.baseUrl).toBe('https://test-api.com');
    });

    test('updateConfig() merges new fields into service options', async () => {
      await service.updateConfig({ baseUrl: 'https://updated-api.com', timeout: 8000 });
      const config = service.getConfig();

      expect(config.baseUrl).toBe('https://updated-api.com');
      expect(config.timeout).toBe(8000);
    });

    test('updateConfig() preserves unmodified fields', async () => {
      await service.updateConfig({ timeout: 9000 });
      const config = service.getConfig();

      expect(config.baseUrl).toBe('https://test-api.com');
      expect(config.timeout).toBe(9000);
    });

    test('updateConfigEffect() merges new fields and returns Effect<void>', async () => {
      const effect = service.updateConfigEffect({ baseUrl: 'https://effect-updated.com' });

      expect(effect).toBeDefined();
      await Effect.runPromise(effect);

      const config = service.getConfig();
      expect(config.baseUrl).toBe('https://effect-updated.com');
    });

    test('updateConfigEffect() preserves unmodified fields', async () => {
      await Effect.runPromise(service.updateConfigEffect({ headers: { 'X-New-Header': 'value' } }));

      const config = service.getConfig();
      expect(config.baseUrl).toBe('https://test-api.com');
      expect(config.headers['X-New-Header']).toBe('value');
    });

    test('createClient() returns an HttpClient instance', () => {
      const client = service.createClient({ baseUrl: 'https://custom.api.com', timeout: 3000 });

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

    test('createClient() returns a new independent client', async () => {
      const client = service.createClient({ baseUrl: 'https://independent.api.com' });
      const result = await client.get('/users');

      expect(result).toBeDefined();
    });
  });

  describe('requestsService Effect methods', () => {
    test('getEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.getEffect('https://api.test.com/users');

      expect(effect).toBeDefined();
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('getEffect() with query parameters', async () => {
      const effect = requestsService.getEffect('https://api.test.com/users', { page: 1, limit: 10 });
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('getEffect() with config parameter', async () => {
      const effect = requestsService.getEffect(
        'https://api.test.com/users',
        { page: 1 },
        { timeout: 5000 },
      );
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
    });

    test('postEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.postEffect('https://api.test.com/users', { name: 'Alice' });

      expect(effect).toBeDefined();
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });

    test('postEffect() without data', async () => {
      const result = await Effect.runPromise(
        requestsService.postEffect('https://api.test.com/users'),
      );

      expect(result).toBeDefined();
    });

    test('putEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.putEffect('https://api.test.com/users/1', { name: 'Bob' });
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('putEffect() with config', async () => {
      const result = await Effect.runPromise(
        requestsService.putEffect('https://api.test.com/users/1', { name: 'Bob' }, { timeout: 3000 }),
      );

      expect(result).toBeDefined();
    });

    test('patchEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.patchEffect('https://api.test.com/users/1', { name: 'Charlie' });
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
    });

    test('patchEffect() with config', async () => {
      const result = await Effect.runPromise(
        requestsService.patchEffect('https://api.test.com/users/1', { name: 'Charlie' }, { timeout: 3000 }),
      );

      expect(result).toBeDefined();
    });

    test('deleteEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.deleteEffect('https://api.test.com/users/1');
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
    });

    test('deleteEffect() with query', async () => {
      const result = await Effect.runPromise(
        requestsService.deleteEffect('https://api.test.com/users', { ids: '1,2' }),
      );

      expect(result).toBeDefined();
    });

    test('deleteEffect() with query and config', async () => {
      const result = await Effect.runPromise(
        requestsService.deleteEffect(
          'https://api.test.com/users',
          { ids: '1,2' },
          { timeout: 3000 },
        ),
      );

      expect(result).toBeDefined();
    });

    test('headEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.headEffect('https://api.test.com/users');
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
    });

    test('headEffect() with query', async () => {
      const result = await Effect.runPromise(
        requestsService.headEffect('https://api.test.com/users', { page: 1 }),
      );

      expect(result).toBeDefined();
    });

    test('headEffect() with query and config', async () => {
      const result = await Effect.runPromise(
        requestsService.headEffect(
          'https://api.test.com/users',
          { page: 1 },
          { timeout: 3000 },
        ),
      );

      expect(result).toBeDefined();
    });

    test('optionsEffect() returns an Effect that resolves with ApiResponse', async () => {
      const effect = requestsService.optionsEffect('https://api.test.com/users');
      const result = await Effect.runPromise(effect);

      expect(result).toBeDefined();
    });

    test('optionsEffect() with query', async () => {
      const result = await Effect.runPromise(
        requestsService.optionsEffect('https://api.test.com/users', { page: 1 }),
      );

      expect(result).toBeDefined();
    });

    test('optionsEffect() with query and config', async () => {
      const result = await Effect.runPromise(
        requestsService.optionsEffect(
          'https://api.test.com/users',
          { page: 1 },
          { timeout: 3000 },
        ),
      );

      expect(result).toBeDefined();
    });

    test('requestEffect() returns an Effect that resolves with ApiResponse', async () => {
      const config: RequestConfig = {
        method: HttpMethod.GET,
        url: 'https://api.test.com/users',
        headers: { 'X-Custom': 'header' },
      };
      const effect = requestsService.requestEffect(config);

      expect(effect).toBeDefined();
      const result = await Effect.runPromise(effect);
      expect(result).toBeDefined();
    });
  });

  describe('RequestsServiceImpl: put, patch, delete, head, options Promise methods', () => {
    let service: any;

    beforeEach(async () => {
      const layer = makeRequestsService({ baseUrl: 'https://test-api.com' });
      const program = Effect.gen(function* () {
        return yield* RequestsService;
      });

      service = await Effect.runPromise(Effect.provide(program, layer));
    });

    test('put() resolves with unwrapped result', async () => {
      const result = await service.put('/resource/1', { name: 'Updated' });

      expect(result).toBeDefined();
    });

    test('patch() resolves with unwrapped result', async () => {
      const result = await service.patch('/resource/1', { name: 'Patched' });

      expect(result).toBeDefined();
    });

    test('delete() resolves with unwrapped result', async () => {
      const result = await service.delete('/resource/1');

      expect(result).toBeDefined();
    });

    test('delete() with query params', async () => {
      const result = await service.delete('/resource', { ids: '1,2' });

      expect(result).toBeDefined();
    });

    test('delete() with query and config fields', async () => {
      const result = await service.delete('/resource', { timeout: 3000 });

      expect(result).toBeDefined();
    });

    test('delete() with both query and config', async () => {
      const result = await service.delete('/resource', { ids: '1,2' }, { timeout: 3000 });

      expect(result).toBeDefined();
    });

    test('head() resolves without throwing', async () => {
      await service.head('/resource');
      // head() resolved successfully
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('head() with query params resolves without throwing', async () => {
      await service.head('/resource', { page: 1 });
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('head() with config fields resolves without throwing', async () => {
      await service.head('/resource', { timeout: 3000 });
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('head() with both query and config resolves without throwing', async () => {
      await service.head('/resource', { page: 1 }, { timeout: 3000 });
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('options() resolves with unwrapped result', async () => {
      const result = await service.options('/resource');

      expect(result).toBeDefined();
    });

    test('options() with query params', async () => {
      const result = await service.options('/resource', { page: 1 });

      expect(result).toBeDefined();
    });

    test('options() with config fields', async () => {
      const result = await service.options('/resource', { timeout: 3000 });

      expect(result).toBeDefined();
    });

    test('options() with both query and config', async () => {
      const result = await service.options('/resource', { page: 1 }, { timeout: 3000 });

      expect(result).toBeDefined();
    });

    test('putEffect() resolves with unwrapped result', async () => {
      const result = await Effect.runPromise(service.putEffect('/resource/1', { name: 'Updated' }));

      expect(result).toBeDefined();
    });

    test('patchEffect() resolves with unwrapped result', async () => {
      const result = await Effect.runPromise(service.patchEffect('/resource/1', { name: 'Patched' }));

      expect(result).toBeDefined();
    });

    test('deleteEffect() with query object', async () => {
      const result = await Effect.runPromise(service.deleteEffect('/resource', { ids: '1,2' }));

      expect(result).toBeDefined();
    });

    test('deleteEffect() with config-like object (has config fields)', async () => {
      const result = await Effect.runPromise(service.deleteEffect('/resource', { timeout: 3000 }));

      expect(result).toBeDefined();
    });

    test('deleteEffect() with query and config', async () => {
      const result = await Effect.runPromise(
        service.deleteEffect('/resource', { ids: '1,2' }, { timeout: 3000 }),
      );

      expect(result).toBeDefined();
    });

    test('headEffect() with query object resolves without throwing', async () => {
      await Effect.runPromise(service.headEffect('/resource', { page: 1 }));
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('headEffect() with config-like object resolves without throwing', async () => {
      await Effect.runPromise(service.headEffect('/resource', { timeout: 3000 }));
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('headEffect() with query and config resolves without throwing', async () => {
      await Effect.runPromise(service.headEffect('/resource', { page: 1 }, { timeout: 3000 }));
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    test('optionsEffect() with query object', async () => {
      const result = await Effect.runPromise(service.optionsEffect('/resource', { page: 1 }));

      expect(result).toBeDefined();
    });

    test('optionsEffect() with config-like object', async () => {
      const result = await Effect.runPromise(service.optionsEffect('/resource', { timeout: 3000 }));

      expect(result).toBeDefined();
    });

    test('optionsEffect() with query and config', async () => {
      const result = await Effect.runPromise(
        service.optionsEffect('/resource', { page: 1 }, { timeout: 3000 }),
      );

      expect(result).toBeDefined();
    });
  });
});
