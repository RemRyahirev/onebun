/* eslint-disable
   @typescript-eslint/no-empty-function,
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   jest/unbound-method */
import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';

import type { MetricsService } from './metrics.service';

import { MetricsMiddleware } from './middleware';

describe('MetricsMiddleware', () => {
  let mockMetricsService: MetricsService;
  let middleware: MetricsMiddleware;

  beforeEach(() => {
    mockMetricsService = {
      recordHttpRequest: mock(() => {}),
      getMetrics: mock(() => Promise.resolve('# metrics data')),
      getContentType: mock(() => 'text/plain'),
      createCounter: mock(() => ({ inc: mock() })),
      createGauge: mock(() => ({ set: mock() })),
      createHistogram: mock(() => ({ observe: mock() })),
      createSummary: mock(() => ({ observe: mock() })),
      getMetric: mock(() => undefined),
      clearMetrics: mock(() => {}),
      getRegistry: mock(() => ({})),
      startSystemMetricsCollection: mock(() => {}),
      stopSystemMetricsCollection: mock(() => {}),
    } as any;

    middleware = new MetricsMiddleware(mockMetricsService);
  });

  describe('createHttpMetricsMiddleware', () => {
    test('should create middleware function that records HTTP metrics', async () => {
      const middlewareFunc = middleware.createHttpMetricsMiddleware();
      
      // Create mock request and response
      const mockRequest = new Request('http://localhost:3000/api/test', {
        method: 'GET',
      });
      
      const mockResponse = new Response('OK', { status: 200 });
      
      // Call middleware to get the response handler
      const responseHandler = await middlewareFunc(mockRequest, {
        controller: 'TestController',
        action: 'testAction',
        route: '/api/test',
      });
      
      expect(typeof responseHandler).toBe('function');
      
      // Simulate calling the response handler
      const startTime = Date.now() - 100; // 100ms ago
      responseHandler(mockResponse, startTime);
      
      // Verify metrics were recorded
      expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          route: '/api/test',
          statusCode: 200,
          controller: 'TestController',
          action: 'testAction',
          duration: expect.any(Number),
        }),
      );
    });

    test('should use pathname when route is not provided', async () => {
      const middlewareFunc = middleware.createHttpMetricsMiddleware();
      
      const mockRequest = new Request('http://localhost:3000/api/users/123', {
        method: 'POST',
      });
      
      const mockResponse = new Response('Created', { status: 201 });
      
      const responseHandler = await middlewareFunc(mockRequest, {});
      
      const startTime = Date.now() - 50;
      responseHandler(mockResponse, startTime);
      
      expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          route: '/api/users/123',
          statusCode: 201,
          controller: undefined,
          action: undefined,
        }),
      );
    });

    test('should handle different HTTP methods and status codes', async () => {
      const middlewareFunc = middleware.createHttpMetricsMiddleware();
      
      const testCases = [
        { method: 'PUT', status: 204 },
        { method: 'DELETE', status: 404 },
        { method: 'PATCH', status: 500 },
      ];

      for (const { method, status } of testCases) {
        const mockRequest = new Request('http://localhost:3000/test', {
          method,
        });
        
        const mockResponse = new Response('', { status });
        
        const responseHandler = await middlewareFunc(mockRequest, {
          route: '/test',
        });
        
        responseHandler(mockResponse, Date.now() - 10);
        
        expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            method,
            statusCode: status,
            route: '/test',
          }),
        );
      }
    });

    test('should calculate duration correctly', async () => {
      const middlewareFunc = middleware.createHttpMetricsMiddleware();
      
      const mockRequest = new Request('http://localhost:3000/test');
      const mockResponse = new Response('OK', { status: 200 });
      
      const responseHandler = await middlewareFunc(mockRequest, {});
      
      const startTime = Date.now() - 1000; // 1 second ago
      responseHandler(mockResponse, startTime);
      
      const call = (mockMetricsService.recordHttpRequest as any).mock.calls[0][0];
      expect(call.duration).toBeGreaterThan(0.9); // Should be around 1 second
      expect(call.duration).toBeLessThan(1.1);
    });
  });

  describe('wrapControllerMethod', () => {
    test('should wrap synchronous method and record metrics', async () => {
      const originalMethod = mock(() => 'result');
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'TestController',
        'testMethod',
        '/test-route',
      );
      
      const result = await wrappedMethod();
      
      expect(result).toBe('result');
      expect(originalMethod).toHaveBeenCalled();
    });

    test('should wrap asynchronous method and record metrics', async () => {
      const originalMethod = mock(async () => 'async result');
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'TestController',
        'asyncMethod',
        '/async-route',
      );
      
      const result = await wrappedMethod();
      
      expect(result).toBe('async result');
      expect(originalMethod).toHaveBeenCalled();
    });

    test('should handle method arguments correctly', async () => {
      const originalMethod = mock((a: number, b: string) => `${a}-${b}`);
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'TestController',
        'methodWithArgs',
        '/method-with-args',
      );
      
      const result = await wrappedMethod(42, 'test');
      
      expect(result).toBe('42-test');
      expect(originalMethod).toHaveBeenCalledWith(42, 'test');
    });

    test('should handle method that throws error', async () => {
      const originalMethod = mock(() => {
        throw new Error('Test error');
      });
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'TestController',
        'errorMethod',
        '/error-route',
      );
      
      await expect(wrappedMethod()).rejects.toThrow('Test error');
      expect(originalMethod).toHaveBeenCalled();
    });

    test('should handle async method that rejects', async () => {
      const originalMethod = mock(async () => {
        throw new Error('Async error');
      });
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'TestController',
        'asyncErrorMethod',
        '/async-error-route',
      );
      
      await expect(wrappedMethod()).rejects.toThrow('Async error');
      expect(originalMethod).toHaveBeenCalled();
    });
  });

  describe('Class instantiation', () => {
    test('should create MetricsMiddleware instance', () => {
      expect(middleware).toBeInstanceOf(MetricsMiddleware);
      expect(middleware).toBeDefined();
    });

    test('should have access to metrics service', () => {
      // Check that the middleware has access to the metrics service
      const middlewareWithService = new MetricsMiddleware(mockMetricsService);
      expect(middlewareWithService).toBeInstanceOf(MetricsMiddleware);
    });
  });

  describe('MetricsMiddleware integration', () => {
    test('should work with real-world request/response cycle', async () => {
      const middlewareFunc = middleware.createHttpMetricsMiddleware();
      
      // Simulate a real request cycle
      const request = new Request('http://api.example.com/users/profile', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer token123',
          'Content-Type': 'application/json',
        },
      });
      
      const context = {
        controller: 'UserController',
        action: 'getProfile',
        route: '/users/profile',
      };
      
      const responseHandler = await middlewareFunc(request, context);
      
      // Simulate processing time
      const startTime = Date.now() - 150; // 150ms processing time
      
      const response = new Response(JSON.stringify({ id: 1, name: 'John' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      responseHandler(response, startTime);
      
      // Verify the metrics were recorded with correct data
      expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith({
        method: 'GET',
        route: '/users/profile',
        statusCode: 200,
        duration: expect.any(Number),
        controller: 'UserController',
        action: 'getProfile',
      });
      
      const recordedData = (mockMetricsService.recordHttpRequest as any).mock.calls[0][0];
      expect(recordedData.duration).toBeGreaterThan(0.1); // At least 100ms
      expect(recordedData.duration).toBeLessThan(0.3); // Less than 300ms
    });
  });

  describe('wrapControllerMethod - extract status from Response', () => {
    test('should extract status code from Response result', async () => {
      const originalMethod = mock(async () => new Response('OK', { status: 201 }));
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'TestController',
        'createMethod',
        '/create',
      );
      
      const result = await wrappedMethod();
      
      expect(result).toBeInstanceOf(Response);
      expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 201,
          controller: 'TestController',
          action: 'createMethod',
          route: '/create',
        }),
      );
    });

    test('should record 500 status on error', async () => {
      const originalMethod = mock(async () => {
        throw new Error('Server error');
      });
      
      const wrappedMethod = middleware.wrapControllerMethod(
        originalMethod,
        'ErrorController',
        'failMethod',
        '/fail',
      );
      
      await expect(wrappedMethod()).rejects.toThrow('Server error');
      expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          controller: 'ErrorController',
          action: 'failMethod',
        }),
      );
    });
  });
});

describe('WithMetrics decorator', () => {
  const { WithMetrics } = require('./middleware');

  beforeEach(() => {
    // Reset the global metrics service
    (globalThis as any).__onebunMetricsService = {
      recordHttpRequest: mock(() => {}),
    };
  });

  test('should be a decorator factory function', () => {
    expect(typeof WithMetrics).toBe('function');
    expect(typeof WithMetrics()).toBe('function');
  });

  test('should decorate synchronous method', () => {
    const decorator = WithMetrics('/test-route');
    const originalMethod = mock(() => 'sync result');
    const descriptor = {
      value: originalMethod,
    };

    const result = decorator({}, 'testMethod', descriptor);

    expect(result).toBe(descriptor);
    expect(typeof descriptor.value).toBe('function');
    expect(descriptor.value).not.toBe(originalMethod);
  });

  test('should wrap method and call original', () => {
    const decorator = WithMetrics('/decorated');
    const originalMethod = mock(() => 'decorated result');
    const descriptor = {
      value: originalMethod,
    };

    decorator({ constructor: { name: 'TestController' } }, 'decoratedMethod', descriptor);
    
    // Call the wrapped method
    const result = descriptor.value();
    
    expect(result).toBe('decorated result');
    expect(originalMethod).toHaveBeenCalled();
  });

  test('should handle async method success', async () => {
    const decorator = WithMetrics('/async-decorated');
    const originalMethod = mock(async () => 'async decorated result');
    const descriptor = {
      value: originalMethod,
    };

    decorator({ constructor: { name: 'AsyncController' } }, 'asyncMethod', descriptor);
    
    const result = await descriptor.value();
    
    expect(result).toBe('async decorated result');
    expect(originalMethod).toHaveBeenCalled();
    expect((globalThis as any).__onebunMetricsService.recordHttpRequest).toHaveBeenCalled();
  });

  test('should handle async method error', async () => {
    const decorator = WithMetrics('/async-error');
    const originalMethod = mock(async () => {
      throw new Error('Async decorated error');
    });
    const descriptor = {
      value: originalMethod,
    };

    decorator({ constructor: { name: 'ErrorController' } }, 'errorMethod', descriptor);
    
    await expect(descriptor.value()).rejects.toThrow('Async decorated error');
    expect((globalThis as any).__onebunMetricsService.recordHttpRequest).toHaveBeenCalled();
  });

  test('should handle sync method error', () => {
    const decorator = WithMetrics('/sync-error');
    const originalMethod = mock(() => {
      throw new Error('Sync decorated error');
    });
    const descriptor = {
      value: originalMethod,
    };

    decorator({ constructor: { name: 'SyncErrorController' } }, 'syncErrorMethod', descriptor);
    
    expect(() => descriptor.value()).toThrow('Sync decorated error');
    expect((globalThis as any).__onebunMetricsService.recordHttpRequest).toHaveBeenCalled();
  });

  test('should use method name as route when not provided', () => {
    const decorator = WithMetrics();
    const originalMethod = mock(() => 'default route');
    const descriptor = {
      value: originalMethod,
    };

    decorator({ constructor: { name: 'DefaultController' } }, 'myAction', descriptor);
    
    descriptor.value();
    
    expect((globalThis as any).__onebunMetricsService.recordHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        route: '/myAction',
      }),
    );
  });

  test('should not record metrics when global service is not available', () => {
    delete (globalThis as any).__onebunMetricsService;
    
    const decorator = WithMetrics('/no-service');
    const originalMethod = mock(() => 'no service result');
    const descriptor = {
      value: originalMethod,
    };

    decorator({ constructor: { name: 'NoServiceController' } }, 'noService', descriptor);
    
    // Should not throw
    expect(() => descriptor.value()).not.toThrow();
    expect(originalMethod).toHaveBeenCalled();
  });
});

describe('recordHttpMetrics Effect', () => {
  const { recordHttpMetrics } = require('./middleware');

  test('should create an Effect', () => {
    const effect = recordHttpMetrics({
      method: 'GET',
      route: '/test',
      statusCode: 200,
      duration: 0.1,
    });
    
    expect(effect).toBeDefined();
    expect(typeof effect).toBe('object');
  });
});
