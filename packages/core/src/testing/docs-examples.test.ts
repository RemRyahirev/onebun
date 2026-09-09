/**
 * Documentation Examples Tests for @onebun/core testing utilities
 *
 * @source docs:testing.md
 */

import {
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import { Effect } from 'effect';

import type { CompiledTestingModule } from './testing-module';

import {
  Controller,
  Get,
  Module,
  Param,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';

import { createTestController, createTestService } from './service-helpers';
import {
  createMockConfig,
  createMockLogger,
  useFakeTimers,
} from './test-utils';
import { TestingModule } from './testing-module';

// ============================================================================
// Test fixtures
// ============================================================================

@Service()
class UserService extends BaseService {
  findById(id: string): { id: string; name: string } {
    return { id, name: `User ${id}` };
  }
}

@Service()
class ServiceWithConfig extends BaseService {
  getDbUrl(): unknown {
    return this.config.get('database.url');
  }
}

@Service()
class ServiceWithDeps extends BaseService {
  constructor(private readonly repo: { find: () => string }) {
    super();
  }

  getData(): string {
    return this.repo.find();
  }
}

@Controller('/users')
class UserController extends BaseController {
  constructor(private readonly userService: UserService) {
    super();
  }

  @Get('/:id')
  getUser(@Param('id') id: string) {
    return this.userService.findById(id);
  }
}

/**
 * Controller that touches everything `createTestController` is documented to wire up:
 * an injected dependency, `this.logger` and `this.config`.
 */
@Controller('/audit')
class AuditController extends BaseController {
  constructor(private readonly userService: UserService) {
    super();
  }

  @Get('/:id')
  audit(@Param('id') id: string): string {
    const user = this.userService.findById(id);
    this.logger.info('audited user', { id });

    return `${String(this.config.get('audit.prefix'))}:${user.name}`;
  }
}

// ============================================================================
// createTestService — docs/testing.md
// ============================================================================

describe('docs/testing.md — createTestService', () => {
  /**
   * @source docs:testing.md#createtestservice
   */
  it('basic usage — creates service with mock logger and config', () => {
    const { instance, logger, config } = createTestService(UserService);

    const result = instance.findById('123');

    expect(result).toEqual({ id: '123', name: 'User 123' });
    expect(logger).toBeDefined();
    expect(config).toBeDefined();
    expect(config.isInitialized).toBe(true);
  });

  /**
   * @source docs:testing.md#with-config-and-dependencies
   */
  it('with config — config.get returns provided values', () => {
    const { instance } = createTestService(ServiceWithConfig, {
      /* eslint-disable @typescript-eslint/naming-convention */
      config: { 'database.url': 'postgres://localhost/test' },
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    expect(instance.getDbUrl()).toBe('postgres://localhost/test');
  });

  /**
   * @source docs:testing.md#with-config-and-dependencies
   */
  it('with deps — passes constructor dependencies', () => {
    const mockRepo = { find: () => 'mock-data' };
    const { instance } = createTestService(ServiceWithDeps, {
      deps: [mockRepo],
    });

    expect(instance.getData()).toBe('mock-data');
  });
});

// ============================================================================
// createTestController — docs/testing.md
// ============================================================================

describe('docs/testing.md — createTestController', () => {
  /**
   * @source docs:testing.md#createtestcontroller
   */
  it('basic usage — deps become constructor arguments, so the handler runs against the mock', () => {
    const findById = mock((id: string) => ({ id, name: 'Mock' }));
    const mockUserService = { findById };
    const { instance } = createTestController(UserController, {
      deps: [mockUserService],
    });

    expect(instance).toBeInstanceOf(UserController);
    // The real UserService would answer `User 42`; the injected dependency answers `Mock`.
    expect(instance.getUser('42')).toEqual({ id: '42', name: 'Mock' });
    expect(findById.mock.calls).toEqual([['42']]);
  });

  /**
   * `createTestController` has the same API as `createTestService` but calls
   * `initializeController()`, so `this.logger` / `this.config` work inside the controller
   * and the returned `logger` is the very one the controller writes to.
   *
   * @source docs:testing.md#createtestcontroller
   */
  it('basic usage — initializeController wires the returned mock logger and config into the controller', () => {
    const mockUserService = { findById: (id: string) => ({ id, name: `Mock ${id}` }) };
    const { instance, logger, config } = createTestController(AuditController, {
      /* eslint-disable @typescript-eslint/naming-convention */
      config: { 'audit.prefix': 'AUDIT' },
      /* eslint-enable @typescript-eslint/naming-convention */
      deps: [mockUserService],
    });

    // `this.config` inside the controller is the mock config built from `options.config`.
    expect(instance.audit('7')).toBe('AUDIT:Mock 7');
    expect(config.get('audit.prefix')).toBe('AUDIT');
    expect(config.isInitialized).toBe(true);

    // `this.logger` inside the controller is the returned logger — a bun mock, per the docs.
    expect((logger.info as ReturnType<typeof mock>).mock.calls).toEqual([
      ['audited user', { id: '7' }],
    ]);
    expect((logger.error as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    expect(logger.child({ context: 'x' })).toBe(logger);
  });
});

// ============================================================================
// TestingModule — docs/testing.md
// ============================================================================

describe('docs/testing.md — TestingModule', () => {
  /**
   * @source docs:testing.md#basic-usage
   */
  it('basic compile / inject / close flow', async () => {
    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({
          controllers: [UserController],
          providers: [UserService],
        })
        .compile();

      const response = await module.inject('GET', '/users/42');

      expect(response.status).toBe(200);

      const body = await response.json() as { result: { id: string; name: string } };
      expect(body.result.id).toBe('42');
      expect(body.result.name).toBe('User 42');
    } finally {
      await module?.close();
    }
  });

  /**
   * @source docs:testing.md#overrideproviderserviceclass
   */
  it('overrideProvider — replaces service with mock value', async () => {
    const mockUser = { id: '1', name: 'MockUser' };
    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({ controllers: [UserController], providers: [UserService] })
        .overrideProvider(UserService).useValue({ findById: () => mockUser })
        .compile();

      const response = await module.inject('GET', '/users/1');

      expect(response.status).toBe(200);

      const body = await response.json() as { result: { id: string; name: string } };
      expect(body.result.name).toBe('MockUser');
    } finally {
      await module?.close();
    }
  });

  /**
   * @source docs:testing.md#overrideproviderserviceclass
   */
  it('overrideProvider — replaces service with another class', async () => {
    @Service()
    class MockUserService extends BaseService {
      findById(id: string) {
        return { id, name: 'ClassMockUser' };
      }
    }

    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({ controllers: [UserController], providers: [UserService] })
        .overrideProvider(UserService).useClass(MockUserService)
        .compile();

      const response = await module.inject('GET', '/users/1');

      expect(response.status).toBe(200);

      const body = await response.json() as { result: { id: string; name: string } };
      expect(body.result.name).toBe('ClassMockUser');
    } finally {
      await module?.close();
    }
  });

  /**
   * @source docs:testing.md#overrideproviderserviceclass
   */
  it('overrideProvider — reaches a service, and an imported module that provides the class', async () => {
    @Service()
    class ImportedDep extends BaseService {
      who(): string {
        return 'REAL';
      }
    }

    @Service()
    class ImportedConsumer extends BaseService {
      constructor(private dep: ImportedDep) {
        super();
      }

      saw(): string {
        return this.dep.who();
      }
    }

    @Module({ providers: [ImportedDep, ImportedConsumer], exports: [ImportedDep, ImportedConsumer] })
    class ImportedModule {}

    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({ imports: [ImportedModule] })
        .overrideProvider(ImportedDep).useValue({ who: () => 'MOCK' })
        .compile();

      // From docs: the override reaches services and imported modules, not only controllers.
      expect(module.get(ImportedConsumer).saw()).toBe('MOCK');
    } finally {
      await module?.close();
    }
  });

  /**
   * @source docs:testing.md#setoptionsoptions
   */
  it('setOptions — applies basePath to routes', async () => {
    let module: CompiledTestingModule | undefined;

    try {
      module = await TestingModule
        .create({ controllers: [UserController], providers: [UserService] })
        .setOptions({ basePath: '/api' })
        .compile();

      const response = await module.inject('GET', '/api/users/1');

      expect(response.status).toBe(200);
    } finally {
      await module?.close();
    }
  });
});

// ============================================================================
// useFakeTimers — docs/testing.md
// ============================================================================

describe('docs/testing.md — useFakeTimers', () => {
  /**
   * @source docs:testing.md#usefaketimers
   */
  it('basic usage — advance time and trigger setTimeout', () => {
    const timers = useFakeTimers();

    try {
      let called = false;
      setTimeout(() => {
        called = true;
      }, 1000);

      timers.advanceTime(999);
      expect(called).toBe(false);

      timers.advanceTime(1);
      expect(called).toBe(true);
    } finally {
      timers.restore();
    }
  });
});

// ============================================================================
// createMockLogger — docs/testing.md
// ============================================================================

describe('docs/testing.md — createMockLogger', () => {
  /**
   * @source docs:testing.md#createmocklogger
   */
  it('basic usage — every method is a silent Effect succeeding with undefined, child() returns itself', () => {
    const logger = createMockLogger();

    // From docs: "All methods return Effect.succeed(undefined), child() returns itself".
    expect(Effect.runSync(logger.trace('t'))).toBeUndefined();
    expect(Effect.runSync(logger.debug('d'))).toBeUndefined();
    expect(Effect.runSync(logger.info('hello', { a: 1 }))).toBeUndefined();
    expect(Effect.runSync(logger.warn('w'))).toBeUndefined();
    expect(Effect.runSync(logger.error('boom'))).toBeUndefined();
    expect(Effect.runSync(logger.fatal('f'))).toBeUndefined();
    expect(logger.child({ context: 'test' })).toBe(logger);
  });
});

// ============================================================================
// createMockConfig — docs/testing.md
// ============================================================================

describe('docs/testing.md — createMockConfig', () => {
  /**
   * @source docs:testing.md#createmockconfig
   */
  it('basic usage — returns values from provided map', () => {
    const config = createMockConfig({
      /* eslint-disable @typescript-eslint/naming-convention */
      'server.port': 3000,
      'server.host': '0.0.0.0',
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    expect(config.get('server.port')).toBe(3000);
    expect(config.get('server.host')).toBe('0.0.0.0');
    expect(config.isInitialized).toBe(true);
  });
});
