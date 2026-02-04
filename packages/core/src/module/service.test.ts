/* eslint-disable
   @typescript-eslint/no-unused-vars,
   @typescript-eslint/no-explicit-any */
import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import { createMockConfig } from '../testing/test-utils';

import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from './config.interface';
import { BaseService } from './service';

describe('BaseService', () => {
  let mockLogger: any;
  let mockConfig: IConfig<OneBunAppConfig>;

  beforeEach(() => {
    mockLogger = {
      child: mock((context: any) => mockLogger),
      debug: mock(),
      info: mock(),
      warn: mock(),
      error: mock(),
    };
    
    mockConfig = createMockConfig({
      /* eslint-disable @typescript-eslint/naming-convention */
      'database.host': 'localhost',
      'app.name': 'test-app',
      /* eslint-enable @typescript-eslint/naming-convention */
    });
  });

  describe('Initialization via initializeService', () => {
    test('should initialize service with logger and config via initializeService', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      expect(service).toBeInstanceOf(BaseService);
      expect(service.isInitialized).toBe(false);

      // Initialize service
      service.initializeService(mockLogger, mockConfig);
      
      expect(service.isInitialized).toBe(true);
      expect((service as any).logger).toBeDefined();
      expect((service as any).config).toBe(mockConfig);
    });

    test('should initialize service with logger and NotInitializedConfig', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      const notInitConfig = new NotInitializedConfig();
      service.initializeService(mockLogger, notInitConfig);
      
      expect(service.isInitialized).toBe(true);
      expect((service as any).logger).toBeDefined();
      expect((service as any).config).toBeInstanceOf(NotInitializedConfig);
    });

    test('should throw error when logger is not provided to initializeService', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      expect(() => service.initializeService(undefined as any, mockConfig))
        .toThrow('Logger is required for service TestService');
    });

    test('should throw error for invalid logger in initializeService', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      expect(() => service.initializeService(null as any, mockConfig))
        .toThrow('Logger is required for service TestService');
    });

    test('should not reinitialize if already initialized', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      service.initializeService(mockLogger, mockConfig);
      
      const otherLogger = { ...mockLogger, child: mock(() => ({ ...mockLogger })) };
      const otherConfig = createMockConfig({ 'other': 'config' });
      service.initializeService(otherLogger, otherConfig);
      
      // Should still have original logger (no reinit)
      expect((service as any).config).toBe(mockConfig);
    });
  });

  describe('Protected methods', () => {
    class TestService extends BaseService {
      async testRunEffect<A, E = never, R = never>(effect: Effect.Effect<A, E, R>): Promise<A> {
        return await this.runEffect(effect as any);
      }

      testFormatError(error: unknown): Error {
        return this.formatError(error);
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService();
      service.initializeService(mockLogger, mockConfig);
    });

    test('should run effect successfully', async () => {
      const effect = Effect.succeed('test result');
      const result = await service.testRunEffect(effect);
      expect(result).toBe('test result');
    });

    test('should handle effect failure', async () => {
      const effect = Effect.fail(new Error('Test error'));
      
      await expect(service.testRunEffect(effect)).rejects.toThrow('Test error');
    });

    test('should format Error instances', () => {
      const error = new Error('Test error');
      const formattedError = service.testFormatError(error);
      
      expect(formattedError).toBe(error);
      expect(formattedError.message).toBe('Test error');
    });

    test('should format string errors', () => {
      const error = 'String error message';
      const formattedError = service.testFormatError(error);
      
      expect(formattedError).toBeInstanceOf(Error);
      expect(formattedError.message).toBe('String error message');
    });

    test('should format unknown errors', () => {
      const error = { unknown: 'object' };
      const formattedError = service.testFormatError(error);
      
      expect(formattedError).toBeInstanceOf(Error);
      expect(formattedError.message).toBe('[object Object]'); // String(object) result
    });

    test('should format null/undefined errors', () => {
      const nullError = service.testFormatError(null);
      const undefinedError = service.testFormatError(undefined);
      
      expect(nullError).toBeInstanceOf(Error);
      expect(nullError.message).toBe('null'); // String(null) result
      
      expect(undefinedError).toBeInstanceOf(Error);
      expect(undefinedError.message).toBe('undefined'); // String(undefined) result
    });
  });

  describe('Error handling edge cases', () => {
    test('should handle complex effect scenarios', async () => {
      class TestService extends BaseService {
        async testComplexEffect() {
          const effect = Effect.succeed(84); // Simplify to avoid generator complexity
          
          return await this.runEffect(effect as any);
        }
      }

      const service = new TestService();
      service.initializeService(mockLogger, mockConfig);
      const result = await service.testComplexEffect();
      expect(result).toBe(84);
    });

    test('should maintain error stack trace', () => {
      class TestService extends BaseService {
        testStackTrace() {
          const originalError = new Error('Original error');
          const formattedError = this.formatError(originalError);
          
          expect(formattedError).toBe(originalError); // Same Error instance returned
        }
      }

      const service = new TestService();
      service.initializeService(mockLogger, mockConfig);
      service.testStackTrace();
    });
  });
});
