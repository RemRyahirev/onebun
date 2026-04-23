import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { TypedEnv } from '@onebun/envs';

import {
  Controller,
  Get,
  Module,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';

import { OneBunApplication } from './application';

// Test modules
@Module({
  controllers: [],
  providers: [],
})
class TestModuleA {}

@Module({
  controllers: [],
  providers: [],
})
class TestModuleB {}

@Module({
  controllers: [],
  providers: [],
})
class TestModuleC {}

describe('OneBunApplication multi-service mode', () => {
  beforeEach(() => {
    TypedEnv.clear();
    // Clean up ENV filters
    delete process.env.ONEBUN_SERVICES;
    delete process.env.ONEBUN_EXCLUDE_SERVICES;
  });

  describe('constructor', () => {
    test('should create instance with services config', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
      });

      expect(app).toBeDefined();
      expect(app.getRunningServices()).toHaveLength(0); // Not started yet
    });

    test('should detect multi-service mode from object argument', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      // Multi-service methods should work
      expect(app.getRunningServices()).toEqual([]);

      // Single-service methods should throw
      expect(() => app.getPort()).toThrow('only available in single-service mode');
    });

    test('should detect single-service mode from class argument', () => {
      const app = new OneBunApplication(TestModuleA);

      // Single-service methods should not throw type errors
      expect(() => app.getPort()).not.toThrow();

      // Multi-service methods should throw
      expect(() => app.getRunningServices()).toThrow('only available in multi-service mode');
    });
  });

  describe('getServiceUrl', () => {
    test('should throw when service not running and no external URL', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(() => app.getServiceUrl('serviceA')).toThrow(
        'Service "serviceA" not available',
      );
    });

    test('should return external URL when configured', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
        externalServiceUrls: {
          serviceA: 'http://external-service:3001',
        },
      });

      expect(app.getServiceUrl('serviceA')).toBe('http://external-service:3001');
    });
  });

  describe('getApplication', () => {
    test('should return undefined when service not running', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.getApplication('serviceA')).toBeUndefined();
    });
  });

  describe('isServiceRunning', () => {
    test('should return false when service not started', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.isServiceRunning('serviceA')).toBe(false);
    });
  });

  describe('getRunningServices', () => {
    test('should return empty array before start', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.getRunningServices()).toEqual([]);
    });
  });

  describe('getLogger', () => {
    test('should return logger instance in multi-service mode', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      const logger = app.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    test('should return logger instance in single-service mode', () => {
      const app = new OneBunApplication(TestModuleA);

      const logger = app.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });
  });

  describe('mode guards', () => {
    test('should throw when calling single-service methods in multi-service mode', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(() => app.getConfig()).toThrow('only available in single-service mode');
      expect(() => app.getPort()).toThrow('only available in single-service mode');
      expect(() => app.getHttpUrl()).toThrow('only available in single-service mode');
      expect(() => app.getServer()).toThrow('only available in single-service mode');
      expect(() => app.getService(TestModuleA)).toThrow('only available in single-service mode');
      expect(() => app.getQueueService()).toThrow('only available in single-service mode');
      expect(() => app.getOpenApiSpec()).toThrow('only available in single-service mode');
    });

    test('should throw when calling multi-service methods in single-service mode', () => {
      const app = new OneBunApplication(TestModuleA);

      expect(() => app.getRunningServices()).toThrow('only available in multi-service mode');
      expect(() => app.getServiceUrl('any')).toThrow('only available in multi-service mode');
      expect(() => app.getApplication('any')).toThrow('only available in multi-service mode');
      expect(() => app.isServiceRunning('any')).toThrow('only available in multi-service mode');
    });
  });

  describe('options merging', () => {
    test('should merge app-level and service-level options', () => {
      // Test that options are properly structured
      const app = new OneBunApplication({
        services: {
          serviceA: {
            module: TestModuleA,
            port: 3001,
            host: 'localhost',
            envOverrides: {
              DB_NAME: { value: 'service_a_db' },
            },
          },
        },
        host: '0.0.0.0',
        envOverrides: {
          COMMON_VAR: { value: 'common_value' },
        },
      });

      expect(app).toBeDefined();
    });

    test('should support multiple services with different configs', () => {
      const app = new OneBunApplication({
        services: {
          users: {
            module: TestModuleA,
            port: 3001,
            envOverrides: {
              DB_NAME: { fromEnv: 'USERS_DB_NAME' },
            },
          },
          orders: {
            module: TestModuleB,
            port: 3002,
            envOverrides: {
              DB_NAME: { value: 'orders_db' },
            },
          },
          payments: {
            module: TestModuleC,
            port: 3003,
          },
        },
      });

      expect(app).toBeDefined();
    });
  });

  describe('queue option', () => {
    test('should accept queue option and pass it to child applications', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
        queue: {
          enabled: true,
          adapter: 'memory',
        },
      });
      expect(app).toBeDefined();
    });
  });

  describe('filtering configuration', () => {
    test('should accept enabledServices option', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
        enabledServices: ['serviceA'],
      });

      expect(app).toBeDefined();
    });

    test('should accept excludedServices option', () => {
      const app = new OneBunApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
        excludedServices: ['serviceB'],
      });

      expect(app).toBeDefined();
    });
  });

  describe('integration: start/stop with filtering', () => {
    // Minimal controller for integration tests
    @Controller('/health')
    class HealthController extends BaseController {
      @Get('/')
      health() {
        return { ok: true };
      }
    }

    @Module({ controllers: [HealthController] })
    class IntegrationModuleA {}

    @Module({ controllers: [HealthController] })
    class IntegrationModuleB {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let app: OneBunApplication<any, any>;

    afterEach(async () => {
      await app?.stop();
      TypedEnv.clear();
      delete process.env.ONEBUN_SERVICES;
      delete process.env.ONEBUN_EXCLUDE_SERVICES;
    });

    test('should start all services by default', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcA', 'svcB']);
      expect(app.isServiceRunning('svcA')).toBe(true);
      expect(app.isServiceRunning('svcB')).toBe(true);
    });

    test('should filter services via enabledServices option', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
        enabledServices: ['svcA'],
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcA']);
      expect(app.isServiceRunning('svcA')).toBe(true);
      expect(app.isServiceRunning('svcB')).toBe(false);
    });

    test('should filter services via excludedServices option', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
        excludedServices: ['svcB'],
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcA']);
      expect(app.isServiceRunning('svcB')).toBe(false);
    });

    test('should filter services via ONEBUN_SERVICES env', async () => {
      process.env.ONEBUN_SERVICES = 'svcB';

      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcB']);
      expect(app.isServiceRunning('svcA')).toBe(false);
    });

    test('should exclude services via ONEBUN_EXCLUDE_SERVICES env', async () => {
      process.env.ONEBUN_EXCLUDE_SERVICES = 'svcA';

      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();

      expect(app.getRunningServices()).toEqual(['svcB']);
    });

    test('should provide service URLs via getServiceUrl after start', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
        },
      });

      await app.start();

      const url = app.getServiceUrl('svcA');
      expect(url).toMatch(/^http:\/\//);
    });

    test('should provide child app via getApplication after start', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
        },
      });

      await app.start();

      const child = app.getApplication('svcA');
      expect(child).toBeDefined();
      expect(child!.getPort()).toBeGreaterThan(0);
    });

    test('should stop all services cleanly', async () => {
      app = new OneBunApplication({
        services: {
          svcA: { module: IntegrationModuleA, port: 0 },
          svcB: { module: IntegrationModuleB, port: 0 },
        },
      });

      await app.start();
      expect(app.getRunningServices()).toHaveLength(2);

      await app.stop();
      expect(app.getRunningServices()).toEqual([]);
    });
  });
});
