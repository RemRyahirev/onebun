import {
  describe,
  expect,
  test,
  mock,
  beforeEach,
  afterEach,
} from 'bun:test';

import {
  Controller,
  Get,
  Module,
  Param,
  Post,
  Body,
  Query,
} from '../decorators/decorators';
import { HttpMethod } from '../types';

import { createServiceClient, getServiceUrl } from './service-client';
import { createServiceDefinition } from './service-definition';

// Test controller with various parameter types
@Controller('/users')
class UsersController {
  @Get('/')
  getAll() {
    return [];
  }

  @Get('/:id')
  getById(@Param('id') _id: string) {
    return {};
  }

  @Post('/')
  create(@Body() _body: unknown) {
    return {};
  }

  @Get('/search')
  search(@Query('q') _query: string) {
    return [];
  }
}

@Module({
  controllers: [UsersController],
})
class UsersModule {}

// Create definition for tests
const usersDefinition = createServiceDefinition(UsersModule);

describe('createServiceClient', () => {
  describe('client creation', () => {
    test('should create client with required options', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      expect(client).toBeDefined();
    });

    test('should create client with all options', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
        timeout: 5000,
        retries: { max: 3, delay: 100, backoff: 'exponential' },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        headers: { 'X-Custom': 'value' },
        serviceName: 'users',
      });

      expect(client).toBeDefined();
    });
  });

  describe('controller access', () => {
    test('should provide access to controller by name', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      // Access the UsersController
      const usersController = client['UsersController'];
      expect(usersController).toBeDefined();
    });

    test('should throw for non-existent controller', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      expect(() => client['NonExistentController']).toThrow(
        'Controller "NonExistentController" not found',
      );
    });
  });

  describe('method access', () => {
    test('should provide access to controller methods', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      const usersController = client['UsersController'];
      expect(typeof usersController.getAll).toBe('function');
      expect(typeof usersController.getById).toBe('function');
      expect(typeof usersController.create).toBe('function');
    });

    test('should throw for non-existent method', () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      const usersController = client['UsersController'];
      expect(() => usersController['nonExistentMethod']).toThrow(
        'Method "nonExistentMethod" not found',
      );
    });
  });

  describe('request building', () => {
    // Mock fetch for request testing
    let originalFetch: typeof fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, result: {} }), {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('should build correct URL for path params', async () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      await client['UsersController'].getById('123');

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('/users/123');
    });

    test('should use correct HTTP method', async () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      await client['UsersController'].create({ name: 'Test' });

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].method).toBe(HttpMethod.POST);
    });

    test('should send body for POST requests', async () => {
      const client = createServiceClient(usersDefinition, {
        url: 'http://localhost:3001',
      });

      const body = { name: 'Test User' };
      await client['UsersController'].create(body);

      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBe(JSON.stringify(body));
    });
  });
});

describe('getServiceUrl', () => {
  test('should call getServiceUrl on app instance', () => {
    const mockApp = {
      getServiceUrl: mock((name: string | number | symbol) => `http://${String(name)}:3000`),
    };

    const url = getServiceUrl(mockApp, 'users');

    expect(mockApp.getServiceUrl).toHaveBeenCalledWith('users');
    expect(url).toBe('http://users:3000');
  });
});
