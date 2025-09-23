import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';
import { Context } from 'effect';

import type { SyncLogger } from '@onebun/logger';

import { Controller } from './controller';
import { Module } from './decorators';

describe('Controller', () => {
  let mockLogger: SyncLogger;
  let mockConfig: unknown;

  beforeEach(() => {
    mockLogger = {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
      fatal: mock(() => {}),
      trace: mock(() => {}),
      child: mock(() => mockLogger),
    };

    mockConfig = {
      test: 'value',
      database: {
        host: 'localhost',
        port: 5432,
      },
    };
  });

  describe('Controller initialization', () => {
    test('should initialize controller with logger and config', () => {
      class TestController extends Controller {
        testMethod() {
          return 'test';
        }
      }

      const controller = new TestController();
      
      expect(() => {
        controller.initializeController(mockLogger, mockConfig);
      }).not.toThrow();

      expect(mockLogger.child).toHaveBeenCalledWith({ className: 'TestController' });
      expect(mockLogger.debug).toHaveBeenCalledWith('Controller TestController initialized');
    });

    test('should throw error when logger is not provided', () => {
      class TestController extends Controller {
        testMethod() {
          return 'test';
        }
      }

      const controller = new TestController();
      
      expect(() => {
        controller.initializeController(undefined as any, mockConfig);
      }).toThrow('Logger is required for controller TestController');
    });

    test('should handle null logger', () => {
      class TestController extends Controller {
        testMethod() {
          return 'test';
        }
      }

      const controller = new TestController();
      
      expect(() => {
        controller.initializeController(null as any, mockConfig);
      }).toThrow('Logger is required for controller TestController');
    });
  });

  describe('Controller service access', () => {
    test('should provide getService method', () => {
      class TestController extends Controller {
        testGetService() {
          // Create a mock service tag
          const ServiceTag = Context.GenericTag<{ value: string }>('TestService');

          return this.getService(ServiceTag);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      // The method should exist and be callable
      expect(typeof controller.testGetService).toBe('function');
    });

    test('should provide all necessary properties after initialization', () => {
      class TestController extends Controller {
        getLoggerInfo() {
          return {
            hasLogger: !!this.logger,
            hasConfig: !!this.config,
          };
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      const info = controller.getLoggerInfo();
      expect(info.hasLogger).toBe(true);
      expect(info.hasConfig).toBe(true);
    });
  });

  describe('Controller error handling', () => {
    test('should handle controller with custom class name', () => {
      class CustomNamedController extends Controller {
        testMethod() {
          return 'custom';
        }
      }

      const controller = new CustomNamedController();
      controller.initializeController(mockLogger, mockConfig);

      expect(mockLogger.child).toHaveBeenCalledWith({ className: 'CustomNamedController' });
      expect(mockLogger.debug).toHaveBeenCalledWith('Controller CustomNamedController initialized');
    });

    test('should work with different config types', () => {
      class TestController extends Controller {
        getConfigType() {
          return typeof this.config;
        }
      }

      const controller = new TestController();
      
      // Test with object config
      controller.initializeController(mockLogger, { test: 'value' });
      expect(controller.getConfigType()).toBe('object');
      
      // Test with string config
      const controller2 = new TestController();
      controller2.initializeController(mockLogger, 'string-config');
      expect(controller2.getConfigType()).toBe('string');

      // Test with null config
      const controller3 = new TestController();
      controller3.initializeController(mockLogger, null);
      expect(controller3.getConfigType()).toBe('object'); // null is typeof 'object'

      // Test with undefined config
      const controller4 = new TestController();
      controller4.initializeController(mockLogger, undefined);
      expect(controller4.getConfigType()).toBe('undefined');
    });
  });

  describe('Controller inheritance', () => {
    test('should work with inherited controllers', () => {
      class BaseController extends Controller {
        baseMethod() {
          return 'base';
        }
      }

      class ExtendedController extends BaseController {
        extendedMethod() {
          return 'extended';
        }
      }

      const controller = new ExtendedController();
      controller.initializeController(mockLogger, mockConfig);

      expect(mockLogger.child).toHaveBeenCalledWith({ className: 'ExtendedController' });
      expect(mockLogger.debug).toHaveBeenCalledWith('Controller ExtendedController initialized');
    });

    test('should handle complex inheritance chains', () => {
      class Level1Controller extends Controller {
        level1Method() {
          return 'level1';
        }
      }

      class Level2Controller extends Level1Controller {
        level2Method() {
          return 'level2';
        }
      }

      class Level3Controller extends Level2Controller {
        level3Method() {
          return 'level3';
        }
      }

      const controller = new Level3Controller();
      controller.initializeController(mockLogger, mockConfig);

      expect(mockLogger.child).toHaveBeenCalledWith({ className: 'Level3Controller' });
      expect(mockLogger.debug).toHaveBeenCalledWith('Controller Level3Controller initialized');
    });
  });

  describe('Controller edge cases', () => {
    test('should handle controller with no methods', () => {
      class EmptyController extends Controller {
        // No additional methods
      }

      const controller = new EmptyController();
      
      expect(() => {
        controller.initializeController(mockLogger, mockConfig);
      }).not.toThrow();

      expect(mockLogger.child).toHaveBeenCalledWith({ className: 'EmptyController' });
    });

    test('should handle re-initialization attempts', () => {
      class TestController extends Controller {
        testMethod() {
          return 'test';
        }
      }

      const controller = new TestController();
      
      // First initialization
      controller.initializeController(mockLogger, mockConfig);
      expect(mockLogger.debug).toHaveBeenCalledWith('Controller TestController initialized');

      // Second initialization (should work but replace values)
      const newMockLogger = {
        ...mockLogger,
        child: mock(() => newMockLogger),
        debug: mock(() => {}),
      };

      controller.initializeController(newMockLogger, { newConfig: true });
      expect(newMockLogger.debug).toHaveBeenCalledWith('Controller TestController initialized');
    });
  });

  describe('Service management', () => {
    test('should set and get service successfully', () => {
      class TestController extends Controller {
        testSetAndGetService() {
          const ServiceTag = Context.GenericTag<{ value: string }>('TestService');
          const mockService = { value: 'test-value' };

          this.setService(ServiceTag, mockService);

          return this.getService(ServiceTag);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      const result = controller.testSetAndGetService();
      expect(result).toEqual({ value: 'test-value' });
    });

    test('should throw error when service not found', () => {
      class TestController extends Controller {
        testGetMissingService() {
          const ServiceTag = Context.GenericTag<{ value: string }>('MissingService');

          return this.getService(ServiceTag);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      expect(() => controller.testGetMissingService()).toThrow('Service undefined not found');
    });

    test('should handle service lookup correctly', () => {
      class TestController extends Controller {
        testServiceLookup() {
          const ServiceTag = Context.GenericTag<string>('TestService');
          const mockService = 'test-service-value';

          // Set and immediately get the same service
          this.setService(ServiceTag, mockService);

          return this.getService(ServiceTag);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      const result = controller.testServiceLookup();
      expect(result).toBe('test-service-value');
    });
  });

  describe('HTTP utilities', () => {
    test('should check if request is JSON', () => {
      class TestController extends Controller {
        testIsJson(req: Request) {
          return this.isJson(req);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      // Test JSON content type
      const jsonRequest = new Request('http://test.com', {
        headers: { 'content-type': 'application/json' },
      });
      expect(controller.testIsJson(jsonRequest)).toBe(true);

      // Test non-JSON content type
      const textRequest = new Request('http://test.com', {
        headers: { 'content-type': 'text/plain' },
      });
      expect(controller.testIsJson(textRequest)).toBe(false);

      // Test no content type
      const noTypeRequest = new Request('http://test.com');
      expect(controller.testIsJson(noTypeRequest)).toBe(false);

      // Test JSON with charset
      const jsonCharsetRequest = new Request('http://test.com', {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
      expect(controller.testIsJson(jsonCharsetRequest)).toBe(true);
    });

    test('should parse JSON from request', async () => {
      class TestController extends Controller {
        async testParseJson<T>(req: Request) {
          return await this.parseJson<T>(req);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      const testData = { message: 'hello', number: 42 };
      const request = new Request('http://test.com', {
        method: 'POST',
        body: JSON.stringify(testData),
        headers: { 'content-type': 'application/json' },
      });

      const result = await controller.testParseJson(request);
      expect(result).toEqual(testData);
    });

    test('should create success response', () => {
      class TestController extends Controller {
        testSuccess<T>(result: T, status?: number) {
          return this.success(result, status);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      const testData = { id: 1, name: 'Test' };

      // Test with default status
      const defaultResponse = controller.testSuccess(testData);
      expect(defaultResponse.status).toBe(200);
      expect(defaultResponse.headers.get('Content-Type')).toBe('application/json');

      // Test with custom status
      const customResponse = controller.testSuccess(testData, 201);
      expect(customResponse.status).toBe(201);
    });

    test('should create error response', () => {
      class TestController extends Controller {
        testError(message: string, code?: number, status?: number) {
          return this.error(message, code, status);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      // Test with default values
      const defaultResponse = controller.testError('Something went wrong');
      expect(defaultResponse.status).toBe(500);
      expect(defaultResponse.headers.get('Content-Type')).toBe('application/json');

      // Test with custom values
      const customResponse = controller.testError('Bad request', 400, 400);
      expect(customResponse.status).toBe(400);
    });

    test('should create JSON response (legacy method)', () => {
      class TestController extends Controller {
        testJson<T>(data: T, status?: number) {
          return this.json(data, status);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      const testData = { legacy: true };
      const response = controller.testJson(testData, 201);
      
      expect(response.status).toBe(201);
      expect(response.headers.get('Content-Type')).toBe('application/json');
    });
  });

  describe('Response content validation', () => {
    test('should return correct JSON content for success response', async () => {
      class TestController extends Controller {
        testSuccessContent() {
          return this.success({ message: 'OK' });
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      const response = controller.testSuccessContent();
      const content = await response.json();

      expect(content).toEqual({
        success: true,
        result: { message: 'OK' },
      });
    });

    test('should return correct JSON content for error response', async () => {
      class TestController extends Controller {
        testErrorContent() {
          return this.error('Test error', 1001, 400);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      const response = controller.testErrorContent();
      const content = await response.json();

      expect(content).toEqual({
        success: false,
        code: 1001,
        message: 'Test error',
      });
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle empty response data', () => {
      class TestController extends Controller {
        testEmptySuccess() {
          return this.success(null);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      const response = controller.testEmptySuccess();
      expect(response.status).toBe(200);
    });

    test('should handle service lookup with class tag', () => {
      class TestController extends Controller {
        testGetServiceByClass() {
          class MockServiceClass {}
          
          // This will throw because the class is not registered
          expect(() => this.getService(MockServiceClass)).toThrow();
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);
      
      controller.testGetServiceByClass();
    });

    test('should handle malformed JSON parsing gracefully', async () => {
      class TestController extends Controller {
        async testMalformedJson() {
          const request = new Request('http://test.com', {
            method: 'POST',
            body: '{ invalid json',
            headers: { 'content-type': 'application/json' },
          });

          return await this.parseJson(request);
        }
      }

      const controller = new TestController();
      controller.initializeController(mockLogger, mockConfig);

      await expect(controller.testMalformedJson()).rejects.toThrow();
    });
  });
});
