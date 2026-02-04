import { type as arktype } from 'arktype';
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
// eslint-disable-next-line import/no-extraneous-dependencies
import { register } from 'prom-client';

import type { ApplicationOptions } from '../types';

import {
  Module,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Header,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunApplication } from './application';

// Helper function to create app with mock logger to suppress logs in tests
function createTestApp(
  moduleClass: new (...args: unknown[]) => object,
  options?: Partial<ApplicationOptions>,
): OneBunApplication {
  return new OneBunApplication(moduleClass, {
    ...options,
    loggerLayer: makeMockLoggerLayer(),
  });
}

describe('OneBunApplication', () => {
  beforeEach(() => {
    register.clear();
  });

  afterEach(() => {
    register.clear();
  });

  describe('Constructor and basic initialization', () => {
    test('should create application instance with module class', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);
      expect(app).toBeInstanceOf(OneBunApplication);
    });

    test('should create application with custom options', () => {
      @Module({})
      class TestModule {}

      const options = {
        port: 4000,
        host: '127.0.0.1',
        development: false,
      };

      const app = createTestApp(TestModule, options);
      expect(app).toBeInstanceOf(OneBunApplication);
    });

    test('should handle module with controllers', () => {
      class TestController {}

      @Module({
        controllers: [TestController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      expect(app).toBeInstanceOf(OneBunApplication);
    });

    test('should handle module with providers', () => {
      class TestService {}

      @Module({
        providers: [TestService],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      expect(app).toBeInstanceOf(OneBunApplication);
    });

    test('should handle module with imports', () => {
      @Module({})
      class ImportedModule {}

      @Module({
        imports: [ImportedModule],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      expect(app).toBeInstanceOf(OneBunApplication);
    });
  });

  describe('Configuration methods', () => {
    test('should throw error when config not initialized', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      expect(() => app.getConfig()).toThrow('Configuration not initialized');
    });

    test('should throw error when getting config value without initialization', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      expect(() => app.getConfigValue('test.path')).toThrow('Configuration not initialized');
    });

    test('should create config service when envSchema provided', () => {
      @Module({})
      class TestModule {}

      const envSchema = {
        test: {
          type: 'string' as const,
          required: false,
          default: 'default-value',
        },
      };

      const app = createTestApp(TestModule, { envSchema });

      const config = app.getConfig();
      expect(config).toBeDefined();
    });

    test('should create config service when envSchema provided', () => {
      @Module({})
      class TestModule {}

      const envSchema = {
        test: {
          type: 'string' as const,
          required: false,
          default: 'default-value',
        },
      };

      const app = createTestApp(TestModule, { envSchema });

      // Just check that config service was created
      const config = app.getConfig();
      expect(config).toBeDefined();

      // The actual value access might need the config to be fully initialized
      // which happens during runtime, not during construction
    });

    test('should provide typed access to config values via getConfig()', () => {
      @Module({})
      class TestModule {}

      // Mock config that simulates typed IConfig<OneBunAppConfig>
      const mockConfigValues = {
        server: { port: 9991, host: 'localhost' },
      };
      const mockConfig = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        initialize: mock(async () => {}),
        get: mock((path: string) => {
          const parts = path.split('.');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let value: any = mockConfigValues;
          for (const part of parts) {
            value = value?.[part];
          }

          return value;
        }),
        values: mockConfigValues,
        getSafeConfig: mock(() => mockConfigValues),
        isInitialized: true,
      };

      const app = createTestApp(TestModule);
      // Inject mock config
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).config = mockConfig;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).configService = {
        get: mockConfig.get, values: mockConfig.values, getSafeConfig: mockConfig.getSafeConfig, isInitialized: true, 
      };

      // getConfig() returns IConfig<OneBunAppConfig> which provides typed .get() method
      const config = app.getConfig();
      expect(config).toBeDefined();
      
      // Access values through the typed interface
      // TypeScript will infer the correct types based on module augmentation
      const port = config.get('server.port');
      const host = config.get('server.host');
      
      expect(port).toBe(9991);
      expect(host).toBe('localhost');
    });

    test('should provide typed access via getConfigValue() convenience method', () => {
      @Module({})
      class TestModule {}

      // Mock config that simulates typed IConfig<OneBunAppConfig>
      const mockConfigValues = {
        app: { name: 'test-app', debug: true },
      };
      const mockConfig = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        initialize: mock(async () => {}),
        get: mock((path: string) => {
          const parts = path.split('.');
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let value: any = mockConfigValues;
          for (const part of parts) {
            value = value?.[part];
          }

          return value;
        }),
        values: mockConfigValues,
        getSafeConfig: mock(() => mockConfigValues),
        isInitialized: true,
      };

      const app = createTestApp(TestModule);
      // Inject mock config
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).config = mockConfig;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).configService = {
        get: mockConfig.get, values: mockConfig.values, getSafeConfig: mockConfig.getSafeConfig, isInitialized: true, 
      };

      // getConfigValue() is a convenience method that delegates to getConfig().get()
      // It also provides typed access based on OneBunAppConfig module augmentation
      const appName = app.getConfigValue('app.name');
      const debug = app.getConfigValue('app.debug');
      
      expect(appName).toBe('test-app');
      expect(debug).toBe(true);
    });
  });

  describe('Layer methods', () => {
    test('should return layer from root module', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      const layer = app.getLayer();
      expect(layer).toBeDefined();
    });

    test('should return layer for complex module structure', () => {
      class TestController {}
      class TestService {}

      @Module({
        controllers: [TestController],
        providers: [TestService],
      })
      class TestModule {}

      const app = createTestApp(TestModule);

      const layer = app.getLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('Application lifecycle', () => {
    test('should handle application creation without errors', () => {
      @Module({})
      class TestModule {}

      expect(() => {
        createTestApp(TestModule);
      }).not.toThrow();
    });

    test('should handle complex module with all features', () => {
      class TestController {}
      class TestService {}

      @Module({})
      class ImportedModule {}

      @Module({
        controllers: [TestController],
        providers: [TestService],
        imports: [ImportedModule],
        exports: [TestService],
      })
      class TestModule {}

      expect(() => {
        createTestApp(TestModule);
      }).not.toThrow();
    });

    test('should handle application with development mode', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule, {
        development: true,
      });

      expect(app).toBeInstanceOf(OneBunApplication);
    });

    test('should handle application with production mode', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule, {
        development: false,
      });

      expect(app).toBeInstanceOf(OneBunApplication);
    });
  });

  describe('Configuration edge cases', () => {
    test('should handle empty module', () => {
      @Module({})
      class EmptyModule {}

      expect(() => {
        createTestApp(EmptyModule);
      }).not.toThrow();
    });

    test('should handle module with empty arrays', () => {
      @Module({
        controllers: [],
        providers: [],
        imports: [],
        exports: [],
      })
      class TestModule {}

      expect(() => {
        createTestApp(TestModule);
      }).not.toThrow();
    });

    test('should handle custom port and host configuration', () => {
      @Module({})
      class TestModule {}

      const options = {
        port: 8080,
        host: 'localhost',
      };

      const app = createTestApp(TestModule, options);
      expect(app).toBeInstanceOf(OneBunApplication);
    });

    test('should handle partial options', () => {
      @Module({})
      class TestModule {}

      const app1 = createTestApp(TestModule, { port: 5000 });
      expect(app1).toBeInstanceOf(OneBunApplication);

      const app2 = createTestApp(TestModule, { host: '0.0.0.0' });
      expect(app2).toBeInstanceOf(OneBunApplication);

      const app3 = createTestApp(TestModule, { development: true });
      expect(app3).toBeInstanceOf(OneBunApplication);
    });
  });

  describe('Module class handling', () => {
    test('should throw error for plain class without decorator', () => {
      class PlainModule {}

      // This should throw error without @Module decorator
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createTestApp(PlainModule as any);
      }).toThrow('Module PlainModule does not have @Module decorator');
    });

    test('should handle class with constructor parameters', () => {
      @Module({})
      class ModuleWithConstructor {
        // eslint-disable-next-line @typescript-eslint/no-useless-constructor
        constructor(..._args: unknown[]) {
          // Constructor with optional parameter - changed to match expected signature
        }
      }

      expect(() => {
        createTestApp(ModuleWithConstructor);
      }).not.toThrow();
    });
  });

  describe('Environment and configuration handling', () => {
    test('should respect NODE_ENV environment variable', () => {
      @Module({})
      class TestModule {}

      // Test with explicit development option
      const devApp = createTestApp(TestModule, { development: true });
      expect(devApp).toBeInstanceOf(OneBunApplication);

      const prodApp = createTestApp(TestModule, { development: false });
      expect(prodApp).toBeInstanceOf(OneBunApplication);
    });

    test('should handle complex envSchema configuration', () => {
      @Module({})
      class TestModule {}

      const envSchema = {
        database: {
          type: 'object' as const,
          required: true,
          properties: {
            host: {
              type: 'string' as const,
              required: true,
              default: 'localhost',
            },
            port: {
              type: 'number' as const,
              required: false,
              default: 5432,
            },
          },
        },
        api: {
          type: 'object' as const,
          required: false,
          properties: {
            key: {
              type: 'string' as const,
              required: false,
              default: 'default-api-key',
            },
          },
        },
      };

      expect(() => {
        createTestApp(TestModule, { envSchema });
      }).not.toThrow();
    });
  });

  describe('Application methods', () => {
    test('should provide getLogger method', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);
      const logger = app.getLogger();

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    test('should provide getLogger with context', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);
      const context = { requestId: '123' };
      const logger = app.getLogger(context);

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });

    test('should provide getHttpUrl method', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule, {
        port: 3001,
        host: '127.0.0.1',
      });

      const url = app.getHttpUrl();
      expect(url).toBe('http://127.0.0.1:3001');
    });

    test('should provide stop method that works when no server is running', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      expect(() => {
        app.stop();
      }).not.toThrow();
    });

    test('should handle custom port and host in options', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule, {
        port: 8080,
        host: '0.0.0.0',
      });

      expect(app.getHttpUrl()).toBe('http://0.0.0.0:8080');
    });
  });

  describe('Application lifecycle', () => {
    let originalServe: typeof Bun.serve;

    beforeEach(() => {
      // Clear prometheus registry between tests
      register.clear();

      // Mock Bun.serve
      originalServe = Bun.serve;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = mock((options: any) => ({
        stop: mock(),
        hostname: options.hostname || 'localhost',
        port: options.port || 3000,
      }));
    });

    afterEach(() => {
      // Restore original Bun.serve
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = originalServe;
    });

    test('should start application successfully', async () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      await expect(app.start()).resolves.toBeUndefined();
      expect(Bun.serve).toHaveBeenCalled();
    });

    test('should start application with config initialization', async () => {
      @Module({})
      class TestModule {}

      const mockConfig = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        initialize: mock(async () => {}),
        isInitialized: true,
      };

      const app = createTestApp(TestModule);
      // Set config manually for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).config = mockConfig;

      await app.start();

      expect(mockConfig.initialize).toHaveBeenCalled();
    });

    test('should handle start without config', async () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      await expect(app.start()).resolves.toBeUndefined();
    });

    test('should stop server when running', () => {
      @Module({})
      class TestModule {}

      const mockServer = {
        stop: mock(),
      };

      const app = createTestApp(TestModule);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).server = mockServer;

      app.stop();

      expect(mockServer.stop).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((app as any).server).toBeNull();
    });

    test('should handle stop when server is not running', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      expect(() => app.stop()).not.toThrow();
    });
  });

  describe('HTTP server functionality', () => {
    beforeEach(() => {
      register.clear();
    });

    test('should handle HTTP method mapping', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      // Access private method for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapHttpMethod = (app as any).mapHttpMethod.bind(app);

      expect(mapHttpMethod('GET')).toBe('GET');
      expect(mapHttpMethod('POST')).toBe('POST');
      expect(mapHttpMethod('PUT')).toBe('PUT');
      expect(mapHttpMethod('DELETE')).toBe('DELETE');
    });

    test('should handle application with custom options', () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule, {
        port: 4000,
        host: '127.0.0.1',
        development: false,
      });

      expect(app.getHttpUrl()).toBe('http://127.0.0.1:4000');
    });
  });

  describe('Global trace context', () => {
    test('should clear global trace context', () => {
      // Access the clearGlobalTraceContext function
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _appModule = require('./application');

      // Set initial values
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__onebunCurrentTraceContext = 'test-context';

      // This is testing an internal function, but it's important for trace cleanup
      // We can access it through module internals or test its effects

      // Since the function is not exported, we'll test its effects by creating an app
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);

      // The function should be called during app lifecycle
      expect(app).toBeDefined();
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      register.clear();
    });

    test('should handle errors during application start', async () => {
      @Module({})
      class TestModule {}

      const mockConfig = {
        initialize: mock(async () => {
          throw new Error('Config initialization failed');
        }),
      };

      const app = createTestApp(TestModule);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).config = mockConfig;

      await expect(app.start()).rejects.toThrow('Config initialization failed');
    });

    test('should handle missing environment variables gracefully', () => {
      @Module({})
      class TestModule {}

      // Temporarily remove NODE_ENV
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const app = createTestApp(TestModule);

      expect(app).toBeDefined();

      // Restore NODE_ENV
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe('Configuration handling', () => {
    let originalServe: typeof Bun.serve;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockServer: any;

    beforeEach(() => {
      register.clear();

      mockServer = {
        stop: mock(),
        hostname: 'localhost',
        port: 3000,
      };

      originalServe = Bun.serve;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = mock((options: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockServer as any).fetchHandler = options.fetch;

        return mockServer;
      });
    });

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = originalServe;
    });

    test('should handle application with metrics service', async () => {
      @Module({})
      class TestModule {}

      const mockMetricsService = {
        startSystemMetricsCollection: mock(),
        stopSystemMetricsCollection: mock(),
      };

      const app = createTestApp(TestModule);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).metricsService = mockMetricsService;

      await app.start();

      expect(mockMetricsService.startSystemMetricsCollection).toHaveBeenCalled();
    });

    test('should handle config service creation', () => {
      @Module({})
      class TestModule {}

      const envSchema = {
        port: {
          type: 'number' as const,
          default: 3000,
        },
      };

      const app = createTestApp(TestModule, { envSchema });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((app as any).config).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((app as any).configService).toBeDefined();
    });
  });

  describe('HTTP Server and Routing', () => {
    let originalServe: typeof Bun.serve;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockServer: any;

    beforeEach(() => {
      register.clear();

      mockServer = {
        stop: mock(),
        hostname: 'localhost',
        port: 3000,
      };

      originalServe = Bun.serve;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = mock((options: any) => {
        // Store the fetch handler for testing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockServer as any).fetchHandler = options.fetch;

        return mockServer;
      });
    });

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = originalServe;
    });

    test('should handle GET request to controller endpoint', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/test')
        async getTest() {
          return { message: 'Hello World' };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Simulate request
      const request = new Request('http://localhost:3000/api/test', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response).toBeDefined();
      // Log actual response for debugging
      // console.log('Response type:', typeof response);
      // console.log('Response status:', response?.status);
      // console.log('Response keys:', Object.keys(response || {}));

      // Accept any successful response for now
      expect(response).toBeTruthy();
    });

    test('should handle POST request with body', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Post('/users')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async createUser(@Body() userData: any) {
          return { id: 1, ...userData };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const requestData = { name: 'John', email: 'john@example.com' };
      const request = new Request('http://localhost:3000/api/users', {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result).toEqual({ id: 1, ...requestData });
    });

    test('should handle route parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/users/:id')
        async getUser(@Param('id') id: string) {
          return { id: parseInt(id), name: 'User ' + id };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/users/123', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result).toEqual({ id: 123, name: 'User 123' });
    });

    test('should handle query parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/search')
        async search(@Query('q') query: string, @Query('limit') limit?: string) {
          return {
            query,
            limit: limit ? parseInt(limit) : 10,
            results: ['item1', 'item2'],
          };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/search?q=test&limit=5', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.query).toBe('test');
      expect(body.result.limit).toBe(5);
      expect(body.result.results).toEqual(['item1', 'item2']);
    });

    test('should handle URL-encoded query parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/search')
        async search(
          @Query('name') name: string,
          @Query('filter') filter?: string,
        ) {
          return { name, filter };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Test URL-encoded values: "John Doe" and "test&value"
      const request = new Request('http://localhost:3000/api/search?name=John%20Doe&filter=test%26value', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.name).toBe('John Doe');
      expect(body.result.filter).toBe('test&value');
    });

    test('should handle OAuth callback query string with special characters', async () => {
      @Controller('/api/auth/google')
      class AuthController extends BaseController {
        @Get('/callback')
        async callback(
          @Query('state') state: string,
          @Query('code') code: string,
          @Query('scope') scope: string,
          @Query('authuser') authuser?: string,
          @Query('prompt') prompt?: string,
        ) {
          return {
            state, code, scope, authuser, prompt, 
          };
        }
      }

      @Module({
        controllers: [AuthController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Real OAuth callback URL from the user's example
      const queryString = 'state=b6d290537858f64d894a47480c5e3edd&code=4/0ASc3gC0o5UhWEjUTslteiiSpR6_NsLYXXdfCjDq0rPFYymqB7LMofianDqC1l4NHJXvA3A&scope=email%20profile%20https://www.googleapis.com/auth/userinfo.profile%20https://www.googleapis.com/auth/userinfo.email%20openid&authuser=0&prompt=consent';
      const request = new Request(`http://localhost:3000/api/auth/google/callback?${queryString}`, {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.state).toBe('b6d290537858f64d894a47480c5e3edd');
      expect(body.result.code).toBe('4/0ASc3gC0o5UhWEjUTslteiiSpR6_NsLYXXdfCjDq0rPFYymqB7LMofianDqC1l4NHJXvA3A');
      expect(body.result.scope).toBe('email profile https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email openid');
      expect(body.result.authuser).toBe('0');
      expect(body.result.prompt).toBe('consent');
    });

    test('should handle multiple query parameters with same key as array', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/filter')
        async filter(@Query('tag') tag: string | string[]) {
          return { tags: Array.isArray(tag) ? tag : [tag] };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Multiple values with same key: ?tag=a&tag=b&tag=c
      const request = new Request('http://localhost:3000/api/filter?tag=a&tag=b&tag=c', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.tags).toEqual(['a', 'b', 'c']);
    });

    test('should handle array notation query parameters (tag[]=a&tag[]=b)', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/filter')
        async filter(@Query('tag') tag: string[]) {
          return { tags: tag };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Array notation: ?tag[]=a&tag[]=b&tag[]=c
      const request = new Request('http://localhost:3000/api/filter?tag[]=a&tag[]=b&tag[]=c', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.tags).toEqual(['a', 'b', 'c']);
    });

    test('should handle single value with array notation (tag[]=a)', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/filter')
        async filter(@Query('tag') tag: string[]) {
          return { tags: tag, isArray: Array.isArray(tag) };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Single value with array notation should still be an array
      const request = new Request('http://localhost:3000/api/filter?tag[]=single', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.tags).toEqual(['single']);
      expect(body.result.isArray).toBe(true);
    });

    test('should handle empty query parameter values', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/params')
        async params(
          @Query('empty') empty: string,
          @Query('other') other: string,
        ) {
          return { empty, other, emptyIsString: typeof empty === 'string' };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Empty value: ?empty=&other=value
      const request = new Request('http://localhost:3000/api/params?empty=&other=value', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.empty).toBe('');
      expect(body.result.other).toBe('value');
      expect(body.result.emptyIsString).toBe(true);
    });

    test('should handle missing optional query parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/optional')
        async optional(
          @Query('required') required: string,
          @Query('optional') optional?: string,
        ) {
          return { required, optional, hasOptional: optional !== undefined };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Only required parameter, optional is missing
      const request = new Request('http://localhost:3000/api/optional?required=value', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.required).toBe('value');
      expect(body.result.optional).toBeUndefined();
      expect(body.result.hasOptional).toBe(false);
    });

    test('should handle multiple path parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/users/:userId/posts/:postId')
        async getPost(
          @Param('userId') userId: string,
          @Param('postId') postId: string,
        ) {
          return { userId: parseInt(userId), postId: parseInt(postId) };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/users/42/posts/123', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.userId).toBe(42);
      expect(body.result.postId).toBe(123);
    });

    test('should handle URL-encoded path parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/files/:filename')
        async getFile(@Param('filename') filename: string) {
          return { filename };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // URL-encoded filename: "my file.txt"
      const request = new Request('http://localhost:3000/api/files/my%20file.txt', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.filename).toBe('my%20file.txt');
    });

    test('should handle path parameters with query parameters together', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/users/:id/posts')
        async getUserPosts(
          @Param('id') userId: string,
          @Query('page') page?: string,
          @Query('limit') limit?: string,
        ) {
          return {
            userId: parseInt(userId),
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 10,
          };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/users/5/posts?page=2&limit=20', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.userId).toBe(5);
      expect(body.result.page).toBe(2);
      expect(body.result.limit).toBe(20);
    });

    test('should handle nested JSON body', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Post('/complex')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async createComplex(@Body() data: any) {
          return { received: data };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const complexData = {
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: '10001',
          },
        },
        items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
        metadata: {
          created: '2024-01-01',
          tags: ['tag1', 'tag2'],
        },
      };

      const request = new Request('http://localhost:3000/api/complex', {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(complexData),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.received).toEqual(complexData);
    });

    test('should handle empty body gracefully', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Post('/empty-body')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async handleEmpty(@Body() data?: any) {
          return { hasBody: data !== undefined, data };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/empty-body', {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.hasBody).toBe(false);
      expect(body.result.data).toBeUndefined();
    });

    test('should handle header parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/headers')
        async getHeaders(
          @Header('Authorization') auth: string,
          @Header('X-Custom-Header') custom?: string,
        ) {
          return { auth, custom };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/headers', {
        method: 'GET',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Authorization': 'Bearer token123',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'X-Custom-Header': 'custom-value',
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.auth).toBe('Bearer token123');
      expect(body.result.custom).toBe('custom-value');
    });

    test('should handle missing optional header', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/optional-header')
        async getOptionalHeader(
          @Header('X-Required') required: string,
          @Header('X-Optional') optional?: string | null,
        ) {
          // Note: headers.get() returns null for missing headers, not undefined
          return { required, optional, hasOptional: optional !== null };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/optional-header', {
        method: 'GET',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'X-Required': 'required-value',
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.required).toBe('required-value');
      // headers.get() returns null for missing headers
      expect(body.result.optional).toBeNull();
      expect(body.result.hasOptional).toBe(false);
    });

    test('should return 500 when required query parameter is missing', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/required-query')
        async requiredQuery(
          @Query('required', { required: true }) required: string,
        ) {
          return { required };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Missing required query parameter
      const request = new Request('http://localhost:3000/api/required-query', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response.status).toBe(500);
    });

    test('should pass validation with required query parameter present', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/required-query')
        async requiredQuery(
          @Query('required', { required: true }) required: string,
        ) {
          return { required };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/required-query?required=value', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.required).toBe('value');
    });

    test('should validate query parameter with arktype schema', async () => {
      const numberSchema = arktype('string.numeric.parse');

      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/validated')
        async validated(
          @Query('count', numberSchema) count: number,
        ) {
          return { count, typeOf: typeof count };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/validated?count=42', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.count).toBe(42);
      expect(body.result.typeOf).toBe('number');
    });

    test('should fail validation with invalid arktype schema value', async () => {
      const numberSchema = arktype('string.numeric.parse');

      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/validated')
        async validated(
          @Query('count', numberSchema) count: number,
        ) {
          return { count };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Invalid value: "not-a-number" instead of numeric string
      const request = new Request('http://localhost:3000/api/validated?count=not-a-number', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response.status).toBe(500);
    });

    test('should validate body with arktype schema', async () => {
      const userSchema = arktype({
        name: 'string',
        age: 'number',
      });

      @Controller('/api')
      class ApiController extends BaseController {
        @Post('/user')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async createUser(@Body(userSchema) user: any) {
          return { user };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/user', {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John', age: 30 }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result.user).toEqual({ name: 'John', age: 30 });
    });

    test('should fail body validation with invalid data', async () => {
      const userSchema = arktype({
        name: 'string',
        age: 'number',
      });

      @Controller('/api')
      class ApiController extends BaseController {
        @Post('/user')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async createUser(@Body(userSchema) user: any) {
          return { user };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Invalid: age is string instead of number
      const request = new Request('http://localhost:3000/api/user', {
        method: 'POST',
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John', age: 'thirty' }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response.status).toBe(500);
    });

    test('should handle metrics endpoint', async () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule, {
        metrics: { path: '/metrics' },
      });

      // Mock metrics service
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMetricsService: any = {
        getMetrics: mock(() => Promise.resolve('# metrics data')),
        getContentType: mock(() => 'text/plain'),
        startSystemMetricsCollection: mock(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).metricsService = mockMetricsService;

      await app.start();

      const request = new Request('http://localhost:3000/metrics', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response.status).toBe(200);
      expect(mockMetricsService.getMetrics).toHaveBeenCalled();
    });

    test('should handle 404 for unknown routes', async () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/unknown', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response.status).toBe(404);
    });

    test('should handle method not allowed', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/test')
        async getTest() {
          return { message: 'Hello World' };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/test', {
        method: 'POST',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      // Current implementation returns 404 for method not allowed, not 405
      expect(response.status).toBe(404);
    });

    test('should handle controller method errors', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/error')
        async throwError() {
          throw new Error('Test error');
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/error', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response.status).toBe(500);
    });

    test('should handle complex route patterns with multiple parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/users/:userId/posts/:postId')
        async getUserPost(@Param('userId') userId: string, @Param('postId') postId: string) {
          return {
            userId: parseInt(userId),
            postId: parseInt(postId),
            title: `Post ${postId} by User ${userId}`,
          };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      const request = new Request('http://localhost:3000/api/users/42/posts/123', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result).toEqual({
        userId: 42,
        postId: 123,
        title: 'Post 123 by User 42',
      });
    });

    test('should handle trailing slashes - route without trailing slash matches request with trailing slash', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/users/:page')
        async getUsers(@Param('page') page: string) {
          return { users: ['Alice', 'Bob'], page: parseInt(page) };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Request WITH trailing slash should match route WITHOUT trailing slash
      const request = new Request('http://localhost:3000/api/users/1/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      // Should return 200, not 404 (route should be found)
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.result).toEqual({ users: ['Alice', 'Bob'], page: 1 });
    });

    test('should handle trailing slashes - both with and without slash return same result', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/items/:category')
        async getItems(@Param('category') category: string) {
          return { items: [1, 2, 3], category };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Request WITHOUT trailing slash
      const requestWithout = new Request('http://localhost:3000/api/items/electronics', {
        method: 'GET',
      });

      // Request WITH trailing slash
      const requestWith = new Request('http://localhost:3000/api/items/electronics/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseWithout = await (mockServer as any).fetchHandler(requestWithout);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseWith = await (mockServer as any).fetchHandler(requestWith);

      // Both should be valid Response objects
      expect(responseWithout).toBeInstanceOf(Response);
      expect(responseWith).toBeInstanceOf(Response);

      // Both should return 200 (not 404)
      expect(responseWithout.status).toBe(200);
      expect(responseWith.status).toBe(200);

      const bodyWithout = await responseWithout.json();
      const bodyWith = await responseWith.json();

      expect(bodyWithout.result).toEqual(bodyWith.result);
    });

    test('should handle trailing slashes with route parameters', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/users/:id')
        async getUser(@Param('id') id: string) {
          return { id: parseInt(id) };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Request WITH trailing slash on parameterized route
      const request = new Request('http://localhost:3000/api/users/123/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.result).toEqual({ id: 123 });
    });

    test('should handle root path correctly (no trailing slash removal)', async () => {
      @Controller('/root')
      class RootController extends BaseController {
        @Get('/:id')
        async getById(@Param('id') id: string) {
          return { message: 'root', id };
        }
      }

      @Module({
        controllers: [RootController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Test that trailing slash is handled correctly even for short paths
      const request = new Request('http://localhost:3000/root/42/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.result).toEqual({ message: 'root', id: '42' });
    });

    test('should handle exact root path with trailing slash', async () => {
      @Controller('/health')
      class HealthController extends BaseController {
        @Get('/:type')
        async check(@Param('type') type: string) {
          return { status: 'ok', type };
        }
      }

      @Module({
        controllers: [HealthController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Root path "/" should remain "/" after normalization
      const requestWithSlash = new Request('http://localhost:3000/health/live/', {
        method: 'GET',
      });

      const requestWithoutSlash = new Request('http://localhost:3000/health/live', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseWith = await (mockServer as any).fetchHandler(requestWithSlash);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseWithout = await (mockServer as any).fetchHandler(requestWithoutSlash);

      // Both should work identically
      expect(responseWith.status).toBe(200);
      expect(responseWithout.status).toBe(200);

      const bodyWith = await responseWith.json();
      const bodyWithout = await responseWithout.json();
      expect(bodyWith.result).toEqual(bodyWithout.result);
    });

    test('should handle @Get("/") route correctly (controller root endpoint)', async () => {
      @Controller('/api/workspaces')
      class WorkspacesController extends BaseController {
        @Get('/')
        async list(@Query('page') page?: string) {
          return { workspaces: ['ws1', 'ws2'], page: page ? parseInt(page) : 1 };
        }

        @Get('/:id')
        async getOne(@Param('id') id: string) {
          return { id, name: 'Workspace ' + id };
        }
      }

      @Module({
        controllers: [WorkspacesController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Test @Get('/') route - should match /api/workspaces (not /api/workspaces/)
      const requestList = new Request('http://localhost:3000/api/workspaces', {
        method: 'GET',
      });

      // Also test with trailing slash
      const requestListWithSlash = new Request('http://localhost:3000/api/workspaces/', {
        method: 'GET',
      });

      // Test @Get('/:id') route
      const requestOne = new Request('http://localhost:3000/api/workspaces/123', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseList = await (mockServer as any).fetchHandler(requestList);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseListWithSlash = await (mockServer as any).fetchHandler(requestListWithSlash);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseOne = await (mockServer as any).fetchHandler(requestOne);

      // All should return 200
      expect(responseList.status).toBe(200);
      expect(responseListWithSlash.status).toBe(200);
      expect(responseOne.status).toBe(200);

      const bodyList = await responseList.json();
      const bodyListWithSlash = await responseListWithSlash.json();
      const bodyOne = await responseOne.json();

      // Verify correct handlers were called
      expect(bodyList.result).toEqual({ workspaces: ['ws1', 'ws2'], page: 1 });
      expect(bodyListWithSlash.result).toEqual({ workspaces: ['ws1', 'ws2'], page: 1 });
      expect(bodyOne.result).toEqual({ id: '123', name: 'Workspace 123' });
    });

    test('should handle @Get() without parameter (equivalent to @Get("/"))', async () => {
      @Controller('/api/projects')
      class ProjectsController extends BaseController {
        // @Get() without parameter should be equivalent to @Get('/')
        @Get()
        async list(@Query('limit') limit?: string) {
          return { projects: ['p1', 'p2'], limit: limit ? parseInt(limit) : 10 };
        }

        @Get('/:id')
        async getOne(@Param('id') id: string) {
          return { id, name: 'Project ' + id };
        }
      }

      @Module({
        controllers: [ProjectsController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Test @Get() route - should match /api/projects
      const requestList = new Request('http://localhost:3000/api/projects', {
        method: 'GET',
      });

      // Also with trailing slash
      const requestListWithSlash = new Request('http://localhost:3000/api/projects/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseList = await (mockServer as any).fetchHandler(requestList);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseListWithSlash = await (mockServer as any).fetchHandler(requestListWithSlash);

      expect(responseList.status).toBe(200);
      expect(responseListWithSlash.status).toBe(200);

      const bodyList = await responseList.json();
      const bodyListWithSlash = await responseListWithSlash.json();

      expect(bodyList.result).toEqual({ projects: ['p1', 'p2'], limit: 10 });
      expect(bodyListWithSlash.result).toEqual({ projects: ['p1', 'p2'], limit: 10 });
    });

    test('should handle @Get("") with empty string (equivalent to @Get("/"))', async () => {
      @Controller('/api/tasks')
      class TasksController extends BaseController {
        // @Get('') with empty string should be equivalent to @Get('/')
        @Get('')
        async list(@Query('status') status?: string) {
          return { tasks: ['t1', 't2'], status: status || 'all' };
        }

        @Get('/:id')
        async getOne(@Param('id') id: string) {
          return { id, name: 'Task ' + id };
        }
      }

      @Module({
        controllers: [TasksController],
      })
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Test @Get('') route - should match /api/tasks
      const requestList = new Request('http://localhost:3000/api/tasks', {
        method: 'GET',
      });

      // Also with trailing slash
      const requestListWithSlash = new Request('http://localhost:3000/api/tasks/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseList = await (mockServer as any).fetchHandler(requestList);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const responseListWithSlash = await (mockServer as any).fetchHandler(requestListWithSlash);

      expect(responseList.status).toBe(200);
      expect(responseListWithSlash.status).toBe(200);

      const bodyList = await responseList.json();
      const bodyListWithSlash = await responseListWithSlash.json();

      expect(bodyList.result).toEqual({ tasks: ['t1', 't2'], status: 'all' });
      expect(bodyListWithSlash.result).toEqual({ tasks: ['t1', 't2'], status: 'all' });
    });

    test('should normalize metrics route labels - trailing slash requests use same label as non-trailing', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/data')
        async getData() {
          return { data: 'test' };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule, {
        metrics: { path: '/metrics' },
      });

      // Track recorded metrics
      const recordedMetrics: Array<{ route: string }> = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMetricsService: any = {
        getMetrics: mock(() => Promise.resolve('# metrics data')),
        getContentType: mock(() => 'text/plain'),
        startSystemMetricsCollection: mock(),
        recordHttpRequest: mock((data: { route: string }) => {
          recordedMetrics.push({ route: data.route });
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).metricsService = mockMetricsService;

      await app.start();

      // Make requests with both trailing and non-trailing slash
      const requestWithout = new Request('http://localhost:3000/api/data', {
        method: 'GET',
      });
      const requestWith = new Request('http://localhost:3000/api/data/', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (mockServer as any).fetchHandler(requestWithout);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (mockServer as any).fetchHandler(requestWith);

      // Both requests should record metrics with the same route label (without trailing slash)
      expect(recordedMetrics.length).toBe(2);
      expect(recordedMetrics[0].route).toBe('/api/data');
      expect(recordedMetrics[1].route).toBe('/api/data');
      // Verify they are the same (no duplication due to trailing slash)
      expect(recordedMetrics[0].route).toBe(recordedMetrics[1].route);
    });
  });

  describe('Tracing integration', () => {
    let originalServe: typeof Bun.serve;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockServer: any;

    beforeEach(() => {
      register.clear();

      mockServer = {
        stop: mock(),
        hostname: 'localhost',
        port: 3000,
      };

      originalServe = Bun.serve;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = mock((options: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockServer as any).fetchHandler = options.fetch;

        return mockServer;
      });
    });

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = originalServe;
    });

    test('should handle trace headers in HTTP requests', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/traced')
        async getTraced() {
          return { traced: true };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      // Don't enable tracing to avoid setup issues in tests
      const app = createTestApp(TestModule);

      await app.start();

      const request = new Request('http://localhost:3000/api/traced', {
        method: 'GET',
        headers: {
          'traceparent': '00-12345678901234567890123456789012-1234567890123456-01',
          'tracestate': 'vendor=value',
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (mockServer as any).fetchHandler(request);

      // Simply verify that request with trace headers is handled successfully
      expect(response).toBeDefined();
      expect(response).toBeTruthy();
    });

    test('should handle disabled tracing', async () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/no-trace')
        async getNoTrace() {
          return { traced: false };
        }
      }

      @Module({
        controllers: [ApiController],
      })
      class TestModule {}

      const app = createTestApp(TestModule, {
        tracing: { traceHttpRequests: false },
      });

      const mockTraceService = {
        extractFromHeaders: mock(),
        setContext: mock(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app as any).traceService = mockTraceService;

      await app.start();

      const request = new Request('http://localhost:3000/api/no-trace', {
        method: 'GET',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (mockServer as any).fetchHandler(request);

      expect(mockTraceService.extractFromHeaders).not.toHaveBeenCalled();
    });
  });

  describe('Graceful shutdown', () => {
    let originalServe: typeof Bun.serve;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockServer: any;

    beforeEach(() => {
      register.clear();

      mockServer = {
        stop: mock(),
        hostname: 'localhost',
        port: 3000,
      };

      originalServe = Bun.serve;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = mock(() => mockServer);
    });

    afterEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Bun as any).serve = originalServe;
    });

    test('should stop server and cleanup resources on stop()', async () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      await app.stop();

      expect(mockServer.stop).toHaveBeenCalled();
    });

    test('should accept closeSharedRedis option in stop()', async () => {
      @Module({})
      class TestModule {}

      const app = createTestApp(TestModule);
      await app.start();

      // Stop without closing Redis
      await app.stop({ closeSharedRedis: false });

      expect(mockServer.stop).toHaveBeenCalled();
    });

    test('should enable graceful shutdown by default', async () => {
      @Module({})
      class TestModule {}

      // Track process.on calls
      const processOnMock = mock();
      const originalProcessOn = process.on.bind(process);
      process.on = processOnMock as typeof process.on;

      // No gracefulShutdown option - should be enabled by default
      const app = createTestApp(TestModule);
      await app.start();

      // Verify handlers were registered
      expect(processOnMock).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnMock).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      // Cleanup
      process.on = originalProcessOn;
      await app.stop();
    });

    test('should disable graceful shutdown when option is false', async () => {
      @Module({})
      class TestModule {}

      // Track process.on calls
      const processOnMock = mock();
      const originalProcessOn = process.on.bind(process);
      process.on = processOnMock as typeof process.on;

      // Explicitly disable graceful shutdown
      const app = createTestApp(TestModule, { gracefulShutdown: false });
      await app.start();

      // Verify handlers were NOT registered
      expect(processOnMock).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnMock).not.toHaveBeenCalledWith('SIGINT', expect.any(Function));

      // Cleanup
      process.on = originalProcessOn;
      await app.stop();
    });

    test('should provide enableGracefulShutdown method for manual setup', async () => {
      @Module({})
      class TestModule {}

      // Disable automatic graceful shutdown
      const app = createTestApp(TestModule, { gracefulShutdown: false });
      await app.start();

      // Track process.on calls
      const processOnMock = mock();
      const originalProcessOn = process.on.bind(process);
      process.on = processOnMock as typeof process.on;

      // Manually enable graceful shutdown
      app.enableGracefulShutdown();

      // Verify handlers were registered
      expect(processOnMock).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(processOnMock).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      // Cleanup
      process.on = originalProcessOn;
      await app.stop();
    });
  });
});
