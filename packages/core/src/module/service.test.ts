/* eslint-disable
   @typescript-eslint/no-unused-vars,
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
import { Effect } from 'effect';

import type { SyncLogger } from '@onebun/logger';

import { createTestService } from '../testing/service-helpers';
import { createMockConfig } from '../testing/test-utils';

import {
  NotInitializedConfig,
  type IConfig,
  type OneBunAppConfig,
} from './config.interface';
import { BaseService } from './service';

function createMockLogger(): SyncLogger {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noOp = () => {};
  const logger: SyncLogger = {
    trace: mock(noOp),
    debug: mock(noOp),
    info: mock(noOp),
    warn: mock(noOp),
    error: mock(noOp),
    fatal: mock(noOp),
    child: mock(() => logger),
  };

  return logger;
}

describe('BaseService', () => {
  describe('Initialization via initializeService', () => {
    test('should initialize service with logger and config via initializeService', () => {
      class TestService extends BaseService {}

      const { instance: service, config } = createTestService(TestService, {
        config: {
          'database.host': 'localhost',
          'app.name': 'test-app',
        },
      });

      expect(service).toBeInstanceOf(BaseService);
      expect(service.isInitialized).toBe(true);
      expect((service as any).logger).toBeDefined();
      expect((service as any).config).toBe(config);
    });

    test('should initialize service with logger and NotInitializedConfig', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      const mockLogger = createMockLogger();
      const notInitConfig = new NotInitializedConfig();
      service.initializeService(mockLogger, notInitConfig);

      expect(service.isInitialized).toBe(true);
      expect((service as any).logger).toBeDefined();
      expect((service as any).config).toBeInstanceOf(NotInitializedConfig);
    });

    test('should throw error when logger is not provided to initializeService', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      const mockConfig = createMockConfig({});
      expect(() => service.initializeService(undefined as any, mockConfig))
        .toThrow('Logger is required for service TestService');
    });

    test('should throw error for invalid logger in initializeService', () => {
      class TestService extends BaseService {}

      const service = new TestService();
      const mockConfig = createMockConfig({});
      expect(() => service.initializeService(null as any, mockConfig))
        .toThrow('Logger is required for service TestService');
    });

    test('should not reinitialize if already initialized', () => {
      class TestService extends BaseService {}

      const { instance: service, config } = createTestService(TestService, {
        config: {
          'database.host': 'localhost',
          'app.name': 'test-app',
        },
      });

      const otherLogger = createMockLogger();
      const otherConfig = createMockConfig({ 'other': 'config' });
      service.initializeService(otherLogger, otherConfig);

      // Should still have original config (no reinit)
      expect((service as any).config).toBe(config);
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
      const result = createTestService(TestService);
      service = result.instance;
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

  describe('Initialization via static init context (constructor)', () => {
    test('should initialize service via static init context in constructor', () => {
      class TestService extends BaseService {
        configAvailableInConstructor = false;
        loggerAvailableInConstructor = false;

        constructor() {
          super();
          this.configAvailableInConstructor = this.config !== undefined;
          this.loggerAvailableInConstructor = this.logger !== undefined;
        }
      }

      const mockLogger = createMockLogger();
      const mockConfig = createMockConfig({
        'database.host': 'localhost',
        'app.name': 'test-app',
      });

      // Set init context before construction (as the framework does)
      BaseService.setInitContext(mockLogger, mockConfig);
      let service: TestService;
      try {
        service = new TestService();
      } finally {
        BaseService.clearInitContext();
      }

      expect(service.isInitialized).toBe(true);
      expect(service.configAvailableInConstructor).toBe(true);
      expect(service.loggerAvailableInConstructor).toBe(true);
      expect((service as any).config).toBe(mockConfig);
    });

    test('should allow using config.get() in constructor when init context is set', () => {
      class TestService extends BaseService {
        readonly dbHost: string;

        constructor() {
          super();
          this.dbHost = this.config.get('database.host') as string;
        }
      }

      const mockLogger = createMockLogger();
      const mockConfig = createMockConfig({
        'database.host': 'localhost',
      });

      BaseService.setInitContext(mockLogger, mockConfig);
      let service: TestService;
      try {
        service = new TestService();
      } finally {
        BaseService.clearInitContext();
      }

      expect(service.dbHost).toBe('localhost');
    });

    test('should create child logger with correct className in constructor', () => {
      class MyCustomService extends BaseService {}

      const mockLogger = createMockLogger();
      const mockConfig = createMockConfig({});

      BaseService.setInitContext(mockLogger, mockConfig);
      try {
        new MyCustomService();
      } finally {
        BaseService.clearInitContext();
      }

      expect(mockLogger.child).toHaveBeenCalledWith({ className: 'MyCustomService' });
    });

    test('should not initialize if no init context is set', () => {
      // Ensure context is clear
      BaseService.clearInitContext();

      class TestService extends BaseService {}
      const service = new TestService();

      expect(service.isInitialized).toBe(false);
    });

    test('initializeService should be a no-op if already initialized via init context', () => {
      class TestService extends BaseService {}

      const mockLogger = createMockLogger();
      const mockConfig = createMockConfig({});

      BaseService.setInitContext(mockLogger, mockConfig);
      let service: TestService;
      try {
        service = new TestService();
      } finally {
        BaseService.clearInitContext();
      }

      expect(service.isInitialized).toBe(true);

      // Call initializeService again — should be a no-op
      const otherLogger = createMockLogger();
      const otherConfig = createMockConfig({ other: 'config' });
      service.initializeService(otherLogger, otherConfig);

      // Should still have original config (no reinit)
      expect((service as any).config).toBe(mockConfig);
    });

    test('clearInitContext should prevent subsequent constructors from picking up context', () => {
      const mockLogger = createMockLogger();
      const mockConfig = createMockConfig({});

      BaseService.setInitContext(mockLogger, mockConfig);
      BaseService.clearInitContext();

      class TestService extends BaseService {}
      const service = new TestService();

      expect(service.isInitialized).toBe(false);
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

      const { instance: service } = createTestService(TestService);
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

      const { instance: service } = createTestService(TestService);
      service.testStackTrace();
    });
  });
});
