import {
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

import { Controller } from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';

import { createTestController, createTestService } from './service-helpers';

// ============================================================================
// Test fixtures
// ============================================================================

@Service()
class TestService extends BaseService {
  getValue(): string {
    return 'service-value';
  }
}

@Service()
class ServiceWithDeps extends BaseService {
  constructor(private readonly dep: { name: string }) {
    super();
  }

  getDep(): string {
    return this.dep.name;
  }
}

@Controller('/test')
class TestController extends BaseController {
  handle(): string {
    return 'controller-value';
  }
}

@Controller('/test-deps')
class ControllerWithDeps extends BaseController {
  constructor(private readonly dep: { name: string }) {
    super();
  }

  getDep(): string {
    return this.dep.name;
  }
}

// ============================================================================
// createTestService
// ============================================================================

describe('createTestService', () => {
  test('creates service instance with mock logger and config', () => {
    const { instance, logger, config } = createTestService(TestService);

    expect(instance).toBeInstanceOf(TestService);
    expect(instance.getValue()).toBe('service-value');
    expect(logger).toBeDefined();
    expect(config).toBeDefined();
    expect(config.isInitialized).toBe(true);
  });

  test('config.get returns provided config values', () => {
    const { config } = createTestService(TestService, {
      /* eslint-disable @typescript-eslint/naming-convention */
      config: { 'app.name': 'my-app', 'server.port': 3000 },
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    expect(config.get('app.name')).toBe('my-app');
    expect(config.get('server.port')).toBe(3000);
  });

  test('passes constructor dependencies', () => {
    const { instance } = createTestService(ServiceWithDeps, {
      deps: [{ name: 'test-dep' }],
    });

    expect(instance.getDep()).toBe('test-dep');
  });

  test('logger methods are mock functions with .mock.calls', () => {
    const { logger } = createTestService(TestService);

    // initializeService calls logger.child() and then debug() internally,
    // so we track calls made after initialization
    const debugCallsBefore = (logger.debug as ReturnType<typeof mock>).mock.calls.length;

    logger.info('test message');
    logger.warn('warning');
    logger.debug('debug');

    expect((logger.info as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.warn as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.debug as ReturnType<typeof mock>).mock.calls.length - debugCallsBefore).toBe(1);
    expect((logger.error as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    expect((logger.trace as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    expect((logger.fatal as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
  });

  test('initializes service via initializeService', () => {
    const { instance } = createTestService(TestService);

    // After initializeService, the service should have logger and config set
    // We verify this indirectly — the service was created and initialized without errors
    expect(instance).toBeInstanceOf(TestService);
  });
});

// ============================================================================
// createTestController
// ============================================================================

describe('createTestController', () => {
  test('creates controller instance with mock logger and config', () => {
    const { instance, logger, config } = createTestController(TestController);

    expect(instance).toBeInstanceOf(TestController);
    expect(instance.handle()).toBe('controller-value');
    expect(logger).toBeDefined();
    expect(config).toBeDefined();
    expect(config.isInitialized).toBe(true);
  });

  test('config.get returns provided config values', () => {
    const { config } = createTestController(TestController, {
      /* eslint-disable @typescript-eslint/naming-convention */
      config: { 'app.name': 'my-app', 'server.port': 3000 },
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    expect(config.get('app.name')).toBe('my-app');
    expect(config.get('server.port')).toBe(3000);
  });

  test('passes constructor dependencies', () => {
    const { instance } = createTestController(ControllerWithDeps, {
      deps: [{ name: 'test-dep' }],
    });

    expect(instance.getDep()).toBe('test-dep');
  });

  test('logger methods are mock functions with .mock.calls', () => {
    const { logger } = createTestController(TestController);

    logger.info('test message');
    logger.error('error');

    expect((logger.info as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.error as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((logger.warn as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
  });

  test('initializes controller via initializeController', () => {
    const { instance } = createTestController(TestController);

    expect(instance).toBeInstanceOf(TestController);
  });
});
