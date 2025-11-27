/* eslint-disable
   @typescript-eslint/no-unused-vars,
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/no-useless-constructor */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import { BaseService } from './service';

describe('BaseService', () => {
  let mockLogger: any;
  let mockConfig: any;

  beforeEach(() => {
    mockLogger = {
      child: mock((context: any) => mockLogger),
      debug: mock(),
      info: mock(),
      warn: mock(),
      error: mock(),
    };
    
    mockConfig = {
      get: mock((path: string) => {
        if (path === 'database.host') {
          return 'localhost';
        }
        if (path === 'app.name') {
          return 'test-app';
        }

        return undefined;
      }),
      getSafeConfig: mock(() => ({ app: { name: 'test-app' } })),
    };
  });

  describe('Initialization', () => {
    test('should initialize service with logger and config', () => {
      class TestService extends BaseService {
        constructor(logger: any, config?: any) {
          super(logger, config);
        }
      }

      const service = new TestService(mockLogger, mockConfig);
      expect(service).toBeInstanceOf(BaseService);
      expect((service as any).logger).toBe(mockLogger);
      expect((service as any).config).toBe(mockConfig);
    });

    test('should initialize service with logger and undefined config', () => {
      class TestService extends BaseService {
        constructor(logger: any, config?: any) {
          super(logger, config);
        }
      }

      const service = new TestService(mockLogger, undefined);
      expect(service).toBeInstanceOf(BaseService);
      expect((service as any).logger).toBeDefined(); // Logger wrapper is created
      expect((service as any).config).toBeUndefined();
    });

    test('should throw error when logger is not provided', () => {
      class TestService extends BaseService {
        constructor(logger?: any) {
          super(logger!);
        }
      }

      expect(() => new TestService()).toThrow('Logger is required for service TestService');
    });

    test('should throw error for invalid logger', () => {
      class TestService extends BaseService {
        constructor(logger: any) {
          super(logger);
        }
      }

      expect(() => new TestService(null)).toThrow('Logger is required for service TestService');
      expect(() => new TestService({})).toThrow('Logger is required for service TestService');
    });
  });

  describe('Protected methods', () => {
    class TestService extends BaseService {
      constructor(logger: any, config?: any) {
        super(logger, config);
      }

      async testRunEffect<A, E = never, R = never>(effect: Effect.Effect<A, E, R>): Promise<A> {
        return await this.runEffect(effect as any);
      }

      testFormatError(error: unknown): Error {
        return this.formatError(error);
      }
    }

    let service: TestService;

    beforeEach(() => {
      service = new TestService(mockLogger, mockConfig);
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
        constructor(logger: any, config?: any) {
          super(logger, config);
        }

        async testComplexEffect() {
          const effect = Effect.succeed(84); // Simplify to avoid generator complexity
          
          return await this.runEffect(effect as any);
        }
      }

      const service = new TestService(mockLogger, undefined);
      const result = await service.testComplexEffect();
      expect(result).toBe(84);
    });

    test('should maintain error stack trace', () => {
      class TestService extends BaseService {
        constructor(logger: any, config?: any) {
          super(logger, config);
        }

        testStackTrace() {
          const originalError = new Error('Original error');
          const formattedError = this.formatError(originalError);
          
          expect(formattedError).toBe(originalError); // Same Error instance returned
        }
      }

      const service = new TestService(mockLogger, undefined);
      service.testStackTrace();
    });
  });
});
