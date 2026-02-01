import {
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { TypedEnv } from '@onebun/envs';

import { Module } from '../decorators/decorators';

import { MultiServiceApplication } from './multi-service-application';

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

describe('MultiServiceApplication', () => {
  beforeEach(() => {
    TypedEnv.clear();
    // Clean up ENV filters
    delete process.env.ONEBUN_SERVICES;
    delete process.env.ONEBUN_EXCLUDE_SERVICES;
  });

  describe('constructor', () => {
    test('should create instance with services config', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
      });

      expect(app).toBeDefined();
      expect(app.getRunningServices()).toHaveLength(0); // Not started yet
    });
  });

  describe('getServiceUrl', () => {
    test('should throw when service not running and no external URL', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(() => app.getServiceUrl('serviceA')).toThrow(
        'Service "serviceA" not available',
      );
    });

    test('should return external URL when configured', () => {
      const app = new MultiServiceApplication({
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

  describe('getService', () => {
    test('should return undefined when service not running', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.getService('serviceA')).toBeUndefined();
    });
  });

  describe('isServiceRunning', () => {
    test('should return false when service not started', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.isServiceRunning('serviceA')).toBe(false);
    });
  });

  describe('getRunningServices', () => {
    test('should return empty array before start', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      expect(app.getRunningServices()).toEqual([]);
    });
  });

  describe('getLogger', () => {
    test('should return logger instance', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
        },
      });

      const logger = app.getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });

  describe('options merging', () => {
    test('should merge app-level and service-level options', () => {
      // Test that options are properly structured
      const app = new MultiServiceApplication({
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
      const app = new MultiServiceApplication({
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

  describe('filtering configuration', () => {
    test('should accept enabledServices option', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
        enabledServices: ['serviceA'],
      });

      expect(app).toBeDefined();
    });

    test('should accept excludedServices option', () => {
      const app = new MultiServiceApplication({
        services: {
          serviceA: { module: TestModuleA, port: 3001 },
          serviceB: { module: TestModuleB, port: 3002 },
        },
        excludedServices: ['serviceB'],
      });

      expect(app).toBeDefined();
    });
  });
});
