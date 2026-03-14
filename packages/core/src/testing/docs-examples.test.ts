/**
 * Documentation Examples Tests for @onebun/core testing utilities
 *
 * This file tests code examples from:
 * - docs/testing.md
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import type { CompiledTestingModule } from './testing-module';

import {
  Controller,
  Get,
  Param,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';

import { createTestController, createTestService } from './service-helpers';
import { createMockConfig, useFakeTimers } from './test-utils';
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

// ============================================================================
// createTestService — docs/testing.md
// ============================================================================

describe('docs/testing.md — createTestService', () => {
  /**
   * @source docs/testing.md#createtestservice
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
   * @source docs/testing.md#with-config-and-dependencies
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
   * @source docs/testing.md#with-config-and-dependencies
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
   * @source docs/testing.md#createtestcontroller
   */
  it('basic usage — creates controller with mock logger and config', () => {
    const mockUserService = { findById: (id: string) => ({ id, name: 'Mock' }) };
    const { instance, logger, config } = createTestController(UserController, {
      deps: [mockUserService],
    });

    expect(instance).toBeInstanceOf(UserController);
    expect(logger).toBeDefined();
    expect(config).toBeDefined();
  });
});

// ============================================================================
// TestingModule — docs/testing.md
// ============================================================================

describe('docs/testing.md — TestingModule', () => {
  /**
   * @source docs/testing.md#basic-usage-1
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
});

// ============================================================================
// useFakeTimers — docs/testing.md
// ============================================================================

describe('docs/testing.md — useFakeTimers', () => {
  /**
   * @source docs/testing.md#usefaketimers
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
// createMockConfig — docs/testing.md
// ============================================================================

describe('docs/testing.md — createMockConfig', () => {
  /**
   * @source docs/testing.md#createmockconfig
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
