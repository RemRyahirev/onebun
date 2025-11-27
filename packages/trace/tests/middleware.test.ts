/* eslint-disable
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   @typescript-eslint/no-unused-vars,
   jest/unbound-method */
import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import type { TraceService } from '../src/trace.service';

import {
  TraceMiddleware,
  createTraceMiddleware,
  trace,
} from '../src/middleware';

describe('TraceMiddleware', () => {
  describe('Public API methods', () => {
    test('should have create method', () => {
      expect(typeof TraceMiddleware.create).toBe('function');
    });

    test('should create Effect when calling create', () => {
      const effect = TraceMiddleware.create();
      expect(effect).toBeDefined();
      expect(typeof effect).toBe('object');
    });
  });

  describe('Static method integration', () => {
    test('should have create method for middleware', () => {
      expect(typeof TraceMiddleware.create).toBe('function');
    });

    test('should create middleware Effect', () => {
      const middlewareEffect = TraceMiddleware.create();
      expect(middlewareEffect).toBeDefined();
      expect(typeof middlewareEffect).toBe('object');
    });
  });

  describe('TraceMiddleware functionality', () => {
    test('should have static create method', () => {
      expect(TraceMiddleware.create).toBeDefined();
      expect(typeof TraceMiddleware.create).toBe('function');
    });

    test('should create middleware that returns Effect', () => {
      const effect = TraceMiddleware.create();
      
      expect(effect).toBeDefined();
      expect(typeof effect).toBe('object');
      // The create method returns an Effect that can be composed
    });
  });

  describe('TraceMiddleware class', () => {
    test('should be a class with static create method', () => {
      expect(TraceMiddleware).toBeDefined();
      expect(typeof TraceMiddleware).toBe('function');
      expect(typeof TraceMiddleware.create).toBe('function');
    });

    test('should create middleware without throwing', () => {
      expect(() => TraceMiddleware.create()).not.toThrow();
    });
  });

  describe('Integration with Effect', () => {
    test('should be compatible with Effect system', () => {
      const middlewareEffect = TraceMiddleware.create();
      
      // Verify it's an Effect-compatible object
      expect(middlewareEffect).toBeDefined();
      expect(typeof middlewareEffect).toBe('object');
    });

    test('should create middleware for tracing', () => {
      // This test verifies the middleware can be created without errors
      expect(() => TraceMiddleware.create()).not.toThrow();
    });
  });

  describe('Private static methods via reflection', () => {
    // Access private methods through type assertion for testing
    const MiddlewareClass = TraceMiddleware as any;

    test('extractHeaders should extract trace headers', () => {
      const request = new Request('http://localhost:3000/test', {
        headers: {
          'traceparent': '00-12345678901234567890123456789012-1234567890123456-01',
          'tracestate': 'vendor1=value1,vendor2=value2',
          'x-trace-id': 'trace123',
          'x-span-id': 'span456',
          'other-header': 'ignored',
        },
      });

      const headers = MiddlewareClass.extractHeaders(request);

      expect(headers).toEqual({
        traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
        tracestate: 'vendor1=value1,vendor2=value2',
        'x-trace-id': 'trace123',
        'x-span-id': 'span456',
      });
    });

    test('extractHeaders should handle missing headers', () => {
      const request = new Request('http://localhost:3000/test');

      const headers = MiddlewareClass.extractHeaders(request);

      expect(headers).toEqual({
        traceparent: undefined,
        tracestate: undefined,
        'x-trace-id': undefined,
        'x-span-id': undefined,
      });
    });

    test('getRemoteAddress should extract from x-forwarded-for', () => {
      const mockRequest = {
        headers: {
          'x-forwarded-for': '192.168.1.100, 10.0.0.1',
        },
      };

      const remoteAddr = MiddlewareClass.getRemoteAddress(mockRequest);
      expect(remoteAddr).toBe('192.168.1.100, 10.0.0.1');
    });

    test('getRemoteAddress should extract from x-real-ip', () => {
      const mockRequest = {
        headers: {
          'x-real-ip': '203.0.113.195',
        },
      };

      const remoteAddr = MiddlewareClass.getRemoteAddress(mockRequest);
      expect(remoteAddr).toBe('203.0.113.195');
    });

    test('getRemoteAddress should extract from socket.remoteAddress', () => {
      const mockRequest = {
        headers: {},
        socket: {
          remoteAddress: '127.0.0.1',
        },
      };

      const remoteAddr = MiddlewareClass.getRemoteAddress(mockRequest);
      expect(remoteAddr).toBe('127.0.0.1');
    });

    test('getRemoteAddress should extract from connection.remoteAddress', () => {
      const mockRequest = {
        headers: {},
        connection: {
          remoteAddress: '10.0.0.5',
        },
      };

      const remoteAddr = MiddlewareClass.getRemoteAddress(mockRequest);
      expect(remoteAddr).toBe('10.0.0.5');
    });

    test('getRemoteAddress should return undefined for invalid request', () => {
      expect(MiddlewareClass.getRemoteAddress(null)).toBeUndefined();
      expect(MiddlewareClass.getRemoteAddress(undefined)).toBeUndefined();
      expect(MiddlewareClass.getRemoteAddress('string')).toBeUndefined();
      expect(MiddlewareClass.getRemoteAddress({})).toBeUndefined();
    });

    test('getRequestSize should extract from content-length header', () => {
      const mockRequest = {
        headers: {
          'content-length': '1024',
        },
      };

      const size = MiddlewareClass.getRequestSize(mockRequest);
      expect(size).toBe(1024);
    });

    test('getRequestSize should return undefined for missing content-length', () => {
      const mockRequest = {
        headers: {},
      };

      const size = MiddlewareClass.getRequestSize(mockRequest);
      expect(size).toBeUndefined();
    });

    test('getRequestSize should return undefined for invalid request', () => {
      expect(MiddlewareClass.getRequestSize(null)).toBeUndefined();
      expect(MiddlewareClass.getRequestSize({})).toBeUndefined();
      expect(MiddlewareClass.getRequestSize('string')).toBeUndefined();
    });

    test('getResponseSize should extract from content-length header', () => {
      const mockResponse = {
        headers: {
          'content-length': '2048',
        },
      };

      const size = MiddlewareClass.getResponseSize(mockResponse);
      expect(size).toBe(2048);
    });

    test('getResponseSize should calculate from body length for string', () => {
      const mockResponse = {
        body: 'Hello World!',
      };

      const size = MiddlewareClass.getResponseSize(mockResponse);
      expect(size).toBe(Buffer.byteLength('Hello World!'));
    });

    test('getResponseSize should calculate from Buffer length', () => {
      const testBuffer = Buffer.from('Test buffer content');
      const mockResponse = {
        body: testBuffer,
      };

      const size = MiddlewareClass.getResponseSize(mockResponse);
      expect(size).toBe(testBuffer.length);
    });

    test('getResponseSize should calculate from object JSON size', () => {
      const testObject = { test: 'data', number: 123 };
      const mockResponse = {
        body: testObject,
      };

      const size = MiddlewareClass.getResponseSize(mockResponse);
      expect(size).toBe(Buffer.byteLength(JSON.stringify(testObject)));
    });

    test('getResponseSize should return undefined for invalid response', () => {
      expect(MiddlewareClass.getResponseSize(null)).toBeUndefined();
      expect(MiddlewareClass.getResponseSize(undefined)).toBeUndefined();
      expect(MiddlewareClass.getResponseSize('string')).toBeUndefined();
      expect(MiddlewareClass.getResponseSize({})).toBeUndefined();
    });
  });

  describe('Exported functions', () => {
    test('createTraceMiddleware should return TraceMiddleware', () => {
      const middleware = createTraceMiddleware();
      
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe('object');
    });
  });

  describe('trace decorator', () => {
    test('should be a function', () => {
      expect(typeof trace).toBe('function');
    });

    test('should return a decorator function', () => {
      const decorator = trace('test-operation');
      expect(typeof decorator).toBe('function');
    });

    test('should work without operation name', () => {
      expect(() => trace()).not.toThrow();
    });

    test('should decorate method descriptor', () => {
      const decorator = trace('test-op');
      const originalMethod = mock(() => 'result');
      
      const mockDescriptor = {
        value: originalMethod,
      };

      // Call decorator
      decorator({}, 'testMethod', mockDescriptor);

      // Verify descriptor was modified
      expect(mockDescriptor.value).not.toBe(originalMethod);
      expect(typeof mockDescriptor.value).toBe('function');
    });
  });
});
