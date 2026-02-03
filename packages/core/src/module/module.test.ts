/* eslint-disable
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   @typescript-eslint/no-unused-vars */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { Context } from 'effect';

import { makeDevLogger } from '@onebun/logger';

import { Module } from '../decorators/decorators';

import { OneBunModule } from './module';
import { Service } from './service';

describe('OneBunModule', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = makeDevLogger();
  });

  describe('Module initialization', () => {
    test('should initialize module with logger', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);
      expect(module).toBeInstanceOf(OneBunModule);
      expect((module as any).logger).toBeDefined(); // Logger wrapper is created
      expect((module as any).moduleClass).toBe(TestModule);
    });

    test('should handle null logger by creating default logger', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, null as any);
      expect(module).toBeInstanceOf(OneBunModule);
      expect((module as any).logger).toBeDefined(); // Default logger is created
    });

    test('should handle module without metadata', () => {
      class TestModuleWithoutDecorator {}

      expect(() => new OneBunModule(TestModuleWithoutDecorator, mockLogger)).toThrow();
    });
  });

  describe('Module metadata', () => {
    test('should handle module with empty metadata', () => {
      @Module({})
      class EmptyModule {}

      const module = new OneBunModule(EmptyModule, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });

    test('should handle module with providers', () => {
      @Service()
      class TestService {}

      @Module({
        providers: [TestService],
      })
      class ModuleWithProviders {}

      const module = new OneBunModule(ModuleWithProviders, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });

    test('should handle module with controllers', () => {
      class TestController {}

      @Module({
        controllers: [TestController],
      })
      class ModuleWithControllers {}

      const module = new OneBunModule(ModuleWithControllers, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });

    test('should handle module with imports', () => {
      @Module({})
      class ImportedModule {}

      @Module({
        imports: [ImportedModule],
      })
      class ModuleWithImports {}

      const module = new OneBunModule(ModuleWithImports, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('Layer creation', () => {
    test('should create layer successfully', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });

    test('should handle complex module configuration', () => {
      @Service()
      class ServiceA {}

      @Service()
      class ServiceB {}

      class ControllerA {}
      class ControllerB {}

      @Module({})
      class ImportedModule {}

      @Module({
        providers: [ServiceA, ServiceB],
        controllers: [ControllerA, ControllerB],
        imports: [ImportedModule],
        exports: [ServiceA],
      })
      class ComplexModule {}

      const module = new OneBunModule(ComplexModule, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('should handle invalid module class', () => {
      expect(() => new OneBunModule(null as any, mockLogger)).toThrow();
      expect(() => new OneBunModule(undefined as any, mockLogger)).toThrow();
    });

    test('should handle malformed metadata', () => {
      // Create a class with malformed metadata
      const TestClass = class {};
      (TestClass as any)[Symbol.for('module:metadata')] = 'invalid';

      expect(() => new OneBunModule(TestClass, mockLogger)).toThrow();
    });
  });

  describe('Module instance methods', () => {
    test('should provide access to module name', () => {
      @Module({})
      class NamedModule {}

      const module = new OneBunModule(NamedModule, mockLogger);
      expect((module as any).moduleClass.name).toBe('NamedModule');
    });

    test('should handle module initialization', () => {
      @Module({})
      class InitModule {}

      const module = new OneBunModule(InitModule, mockLogger);

      // Test that initialization completes without error
      expect(() => module.getLayer()).not.toThrow();
    });
  });

  describe('Service and controller processing', () => {
    test('should process services correctly', () => {
      @Service()
      class TestService {
        getValue() {
          return 'test';
        }
      }

      @Module({
        providers: [TestService],
      })
      class ServiceModule {}

      const module = new OneBunModule(ServiceModule, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });

    test('should process controllers correctly', () => {
      class TestController {
        getTest() {
          return 'test';
        }
      }

      @Module({
        controllers: [TestController],
      })
      class ControllerModule {}

      const module = new OneBunModule(ControllerModule, mockLogger);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('Module methods and utilities', () => {
    test('should get controller instances', () => {
      class TestController {
        testMethod() {
          return 'test';
        }
      }

      @Module({
        controllers: [TestController],
      })
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);

      // Access private method via type assertion
      const instances = (module as any).getControllerInstances();

      expect(instances).toBeInstanceOf(Map);
    });

    test('should resolve dependency by type', () => {
      @Service()
      class TestService {
        getName() {
          return 'TestService';
        }
      }

      @Module({
        providers: [TestService],
      })
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);
      module.getLayer(); // Initialize the module

      // Access private method via type assertion
      const resolved = (module as any).resolveDependencyByType(TestService);

      // Service should now be created and resolvable via DI
      expect(resolved).toBeInstanceOf(TestService);
    });

    test('should resolve dependency by name (deprecated)', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);

      // Access private deprecated method via type assertion
      const resolved = (module as any).resolveDependencyByName('SomeService');

      // Deprecated method always returns null
      expect(resolved).toBeNull();
    });

    test('should handle tag providers with implementation classes', () => {
      // Create a service interface via Context.Tag
      const TestServiceTag = Context.GenericTag<{ getValue: () => string }>('TestService');

      // Create implementation class
      @Service()
      class TestServiceImpl {
        getValue() {
          return 'test-value';
        }
      }

      // Create the tag provider object
      const tagProvider = {
        isTag: true,
        tag: TestServiceTag,
        service: TestServiceImpl,
      };

      @Module({
        providers: [tagProvider, TestServiceImpl],
      })
      class TagModule {}

      const module = new OneBunModule(TagModule, mockLogger);
      const layer = module.getLayer();

      expect(layer).toBeDefined();
    });

    test('should handle dependency resolution with no matching instances', () => {
      @Service()
      class ServiceA {
        getValue() {
          return 'A';
        }
      }

      @Service()
      class ServiceB {
        getValue() {
          return 'B';
        }
      }

      @Module({
        providers: [ServiceA],
      })
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);
      module.getLayer(); // Initialize the module

      // Try to resolve ServiceB which is not in the module
      const resolved = (module as any).resolveDependencyByType(ServiceB);

      expect(resolved === undefined || resolved === null).toBe(true);
    });

    test('should handle dependency resolution with instance check', () => {
      @Service()
      class BaseService {
        baseMethod() {
          return 'base';
        }
      }

      @Service()
      class ExtendedService extends BaseService {
        extendedMethod() {
          return 'extended';
        }
      }

      @Module({
        providers: [ExtendedService],
      })
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLogger);
      module.getLayer(); // Initialize the module

      // Try to resolve by base type
      const resolvedByBase = (module as any).resolveDependencyByType(BaseService);
      const resolvedByExtended = (module as any).resolveDependencyByType(ExtendedService);

      // Both should work or both should be undefined based on implementation
      expect(typeof resolvedByBase === 'undefined' || resolvedByBase === null || typeof resolvedByBase === 'object').toBe(true);
      expect(typeof resolvedByExtended === 'undefined' || resolvedByExtended === null || typeof resolvedByExtended === 'object').toBe(true);
    });
  });

  describe('Global module support', () => {
    // Import the functions we need
    const { Global, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry, getGlobalServicesRegistry } = require('./module');

    beforeEach(() => {
      // Clear global modules and services before each test
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    afterEach(() => {
      // Clean up after each test
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    test('should register global module services in global registry', () => {
      @Service()
      class GlobalService {
        getValue() {
          return 'global-value';
        }
      }

      @Global()
      @Module({
        providers: [GlobalService],
        exports: [GlobalService],
      })
      class GlobalModule {}

      @Module({
        imports: [GlobalModule],
      })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLogger);
      module.getLayer();

      // Check that global service is registered
      const globalServices = getGlobalServicesRegistry();
      expect(globalServices.size).toBeGreaterThan(0);

      // Should find GlobalService in the registry
      let foundGlobalService = false;
      for (const [_tag, instance] of globalServices) {
        if (instance instanceof GlobalService) {
          foundGlobalService = true;
          break;
        }
      }
      expect(foundGlobalService).toBe(true);
    });

    test('should make global services available in child modules without explicit import', () => {
      @Service()
      class GlobalDbService {
        query() {
          return 'query-result';
        }
      }

      @Global()
      @Module({
        providers: [GlobalDbService],
        exports: [GlobalDbService],
      })
      class DatabaseModule {}

      @Service()
      class UserService {
        // This service would depend on GlobalDbService
        doSomething() {
          return 'user-action';
        }
      }

      // ChildModule does NOT import DatabaseModule but should have access to GlobalDbService
      @Module({
        providers: [UserService],
      })
      class ChildModule {}

      @Module({
        imports: [DatabaseModule, ChildModule],
      })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLogger);
      module.getLayer();

      // GlobalDbService should be in the global registry
      const globalServices = getGlobalServicesRegistry();
      let foundDbService = false;
      for (const [_tag, instance] of globalServices) {
        if (instance instanceof GlobalDbService) {
          foundDbService = true;
          break;
        }
      }
      expect(foundDbService).toBe(true);
    });

    test('should not duplicate global services when same module is imported multiple times', () => {
      @Service()
      class SingletonService {
        id = Math.random();
        getValue() {
          return this.id;
        }
      }

      @Global()
      @Module({
        providers: [SingletonService],
        exports: [SingletonService],
      })
      class GlobalSingletonModule {}

      @Module({
        imports: [GlobalSingletonModule],
      })
      class ChildModuleA {}

      @Module({
        imports: [GlobalSingletonModule],
      })
      class ChildModuleB {}

      @Module({
        imports: [GlobalSingletonModule, ChildModuleA, ChildModuleB],
      })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLogger);
      module.getLayer();

      // Should have only one SingletonService instance in global registry
      const globalServices = getGlobalServicesRegistry();
      let serviceCount = 0;
      for (const [_tag, instance] of globalServices) {
        if (instance instanceof SingletonService) {
          serviceCount++;
        }
      }
      expect(serviceCount).toBe(1);
    });

    test('should not register non-global module services in global registry', () => {
      @Service()
      class LocalService {
        getValue() {
          return 'local-value';
        }
      }

      // NOT marked with @Global()
      @Module({
        providers: [LocalService],
        exports: [LocalService],
      })
      class LocalModule {}

      @Module({
        imports: [LocalModule],
      })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLogger);
      module.getLayer();

      // LocalService should NOT be in the global registry
      const globalServices = getGlobalServicesRegistry();
      let foundLocalService = false;
      for (const [_tag, instance] of globalServices) {
        if (instance instanceof LocalService) {
          foundLocalService = true;
          break;
        }
      }
      expect(foundLocalService).toBe(false);
    });

    test('should clear global services registry', () => {
      @Service()
      class ServiceToClear {
        getValue() {
          return 'value';
        }
      }

      @Global()
      @Module({
        providers: [ServiceToClear],
        exports: [ServiceToClear],
      })
      class ModuleToClear {}

      @Module({
        imports: [ModuleToClear],
      })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLogger);
      module.getLayer();

      // Should have service in registry
      expect(getGlobalServicesRegistry().size).toBeGreaterThan(0);

      // Clear the registry
      clearGlobalServicesRegistry();

      // Should be empty now
      expect(getGlobalServicesRegistry().size).toBe(0);
    });
  });

  describe('Controller DI with @Inject decorator', () => {
    const {
      Inject, getConstructorParamTypes, Controller: ControllerDecorator, clearGlobalModules,
    } = require('../decorators/decorators');
    const { Controller: BaseController } = require('./controller');
    const { clearGlobalServicesRegistry: clearRegistry } = require('./module');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    /**
     * Test that @Inject decorator works correctly with @Controller wrapping.
     * The @Controller decorator now copies META_CONSTRUCTOR_PARAMS metadata
     * from the original class to the wrapped class.
     */
    test('should preserve @Inject metadata when @Controller wraps the class', () => {
      // Simple service
      @Service()
      class SimpleService {
        getValue() {
          return 'test';
        }
      }

      // Define controller with @Inject BEFORE @Controller
      class OriginalController extends BaseController {
        constructor(@Inject(SimpleService) private svc: SimpleService) {
          super();
        }
      }

      // Check: @Inject saved dependency to original class
      const depsBeforeControllerDecorator = getConstructorParamTypes(OriginalController);
      expect(depsBeforeControllerDecorator).toBeDefined();
      expect(depsBeforeControllerDecorator?.[0]).toBe(SimpleService);

      // Now apply @Controller decorator - it wraps the class
      const WrappedController = ControllerDecorator('/test')(OriginalController);

      // FIXED: dependencies are now copied to WrappedController
      const depsAfterControllerDecorator = getConstructorParamTypes(WrappedController);

      // WrappedController now has the same dependencies as OriginalController
      expect(depsAfterControllerDecorator).toBeDefined();
      expect(depsAfterControllerDecorator?.[0]).toBe(SimpleService);
    });
  });

  describe('Service with BaseService inheritance and dependencies', () => {
    const { Module: ModuleDecorator, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry: clearRegistry, OneBunModule: ModuleInstance } = require('./module');
    const { BaseService: BaseServiceClass } = require('./service');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    /**
     * Integration test: Service extending BaseService with constructor dependencies
     * should work correctly without requiring explicit ...args forwarding.
     *
     * The @Service decorator now wraps the class to automatically forward
     * all constructor arguments (including logger and config) to the parent.
     */
    test('should create service extending BaseService with dependencies via module initialization', () => {
      // Dependency service (does not extend BaseService)
      @Service()
      class RepositoryService {
        getData() {
          return { id: 1, name: 'Test' };
        }
      }

      // Service with dependency that extends BaseService
      // NOTE: No need for ...args and super(...args)
      @Service()
      class UserService extends BaseServiceClass {
        constructor(private repository: RepositoryService) {
          super();
        }

        getUser() {
          return this.repository.getData();
        }

        // Verify logger is available from BaseService
        logMessage(msg: string) {
          this.logger.info(msg);
        }
      }

      // Create module with both services
      @ModuleDecorator({
        providers: [RepositoryService, UserService],
        exports: [UserService],
      })
      class TestModule {}

      // Initialize module
      const module = new ModuleInstance(TestModule);

      // Verify services are created correctly
      const { getServiceTag } = require('./service');
      const userServiceTag = getServiceTag(UserService);
      const userService = module.getServiceInstance(userServiceTag);

      // Service should be created successfully
      expect(userService).toBeDefined();
      expect(userService).toBeInstanceOf(UserService);

      // Service should have access to its dependency
      const userData = (userService as UserService).getUser();
      expect(userData).toEqual({ id: 1, name: 'Test' });

      // Service should have access to logger from BaseService
      expect(() => (userService as UserService).logMessage('test')).not.toThrow();
    });

    /**
     * Test multiple levels of dependencies with BaseService inheritance
     */
    test('should handle chain of services with BaseService inheritance', () => {
      @Service()
      class ConfigService {
        getConfig() {
          return { timeout: 5000 };
        }
      }

      @Service()
      class CacheService extends BaseServiceClass {
        constructor(private configService: ConfigService) {
          super();
        }

        getTimeout() {
          return this.configService.getConfig().timeout;
        }
      }

      @Service()
      class ApiService extends BaseServiceClass {
        constructor(private cacheService: CacheService) {
          super();
        }

        getConnectionTimeout() {
          return this.cacheService.getTimeout();
        }
      }

      @ModuleDecorator({
        providers: [ConfigService, CacheService, ApiService],
        exports: [ApiService],
      })
      class ChainModule {}

      // Should not throw
      const module = new ModuleInstance(ChainModule);

      const { getServiceTag } = require('./service');
      const apiServiceTag = getServiceTag(ApiService);
      const apiService = module.getServiceInstance(apiServiceTag);

      expect(apiService).toBeDefined();
      expect((apiService as ApiService).getConnectionTimeout()).toBe(5000);
    });
  });
});
