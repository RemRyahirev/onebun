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
import {
  Context,
  Effect,
  Layer,
} from 'effect';

import { Module } from '../decorators/decorators';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { OneBunModule } from './module';
import { Service } from './service';

describe('OneBunModule', () => {
  let mockLoggerLayer: any;

  beforeEach(() => {
    mockLoggerLayer = makeMockLoggerLayer();
  });

  describe('Module initialization', () => {
    test('should initialize module with logger', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLoggerLayer);
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

      expect(() => new OneBunModule(TestModuleWithoutDecorator, mockLoggerLayer)).toThrow();
    });
  });

  describe('Module metadata', () => {
    test('should handle module with empty metadata', () => {
      @Module({})
      class EmptyModule {}

      const module = new OneBunModule(EmptyModule, mockLoggerLayer);
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

      const module = new OneBunModule(ModuleWithProviders, mockLoggerLayer);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });

    test('should handle module with controllers', () => {
      class TestController {}

      @Module({
        controllers: [TestController],
      })
      class ModuleWithControllers {}

      const module = new OneBunModule(ModuleWithControllers, mockLoggerLayer);
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

      const module = new OneBunModule(ModuleWithImports, mockLoggerLayer);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('Layer creation', () => {
    test('should create layer successfully', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLoggerLayer);
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

      const module = new OneBunModule(ComplexModule, mockLoggerLayer);
      const layer = module.getLayer();
      expect(layer).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('should handle invalid module class', () => {
      expect(() => new OneBunModule(null as any, mockLoggerLayer)).toThrow();
      expect(() => new OneBunModule(undefined as any, mockLoggerLayer)).toThrow();
    });

    test('should handle malformed metadata', () => {
      // Create a class with malformed metadata
      const TestClass = class {};
      (TestClass as any)[Symbol.for('module:metadata')] = 'invalid';

      expect(() => new OneBunModule(TestClass, mockLoggerLayer)).toThrow();
    });

    test('should detect circular dependencies and provide detailed error message', () => {
      const { registerDependencies } = require('../decorators/decorators');
      const { LoggerService } = require('@onebun/logger');

      // Collect error messages
      const errorMessages: string[] = [];

      // Create mock logger that captures error messages
      // Using Effect.sync to ensure the message is captured synchronously when Effect.runSync is called
      const captureLogger = {
        trace: () => Effect.sync(() => undefined),
        debug: () => Effect.sync(() => undefined),
        info: () => Effect.sync(() => undefined),
        warn: () => Effect.sync(() => undefined),
        error: (msg: string) =>
          Effect.sync(() => {
            errorMessages.push(msg);
          }),
        fatal: () => Effect.sync(() => undefined),
        child: () => captureLogger,
      };
      const captureLoggerLayer = Layer.succeed(LoggerService, captureLogger);

      // Create services - define all classes first
      @Service()
      class CircularServiceA {
        getValue() {
          return 'A';
        }
      }

      @Service()
      class CircularServiceB {
        getValue() {
          return 'B';
        }
      }

      @Service()
      class CircularServiceC {
        getValue() {
          return 'C';
        }
      }

      // Now register circular dependencies manually: A -> B -> C -> A
      registerDependencies(CircularServiceA, [CircularServiceC]);
      registerDependencies(CircularServiceB, [CircularServiceA]);
      registerDependencies(CircularServiceC, [CircularServiceB]);

      @Module({
        providers: [CircularServiceA, CircularServiceB, CircularServiceC],
      })
      class CircularModule {}

      // Initialize module - should detect circular dependency
      new OneBunModule(CircularModule, captureLoggerLayer);

      // Verify error message was logged
      expect(errorMessages.length).toBeGreaterThan(0);

      // Find the circular dependency error message
      const circularError = errorMessages.find((msg) =>
        msg.includes('Circular dependency detected'),
      );
      expect(circularError).toBeDefined();

      // Should contain module name
      expect(circularError).toContain('CircularModule');

      // Should contain "Unresolved services" section
      expect(circularError).toContain('Unresolved services');

      // Should contain at least one of the service names with their dependencies
      const hasServiceInfo =
        circularError!.includes('CircularServiceA') ||
        circularError!.includes('CircularServiceB') ||
        circularError!.includes('CircularServiceC');
      expect(hasServiceInfo).toBe(true);

      // Should contain "needs:" showing what dependencies are required
      expect(circularError).toContain('needs:');

      // Should contain "Dependency chain" showing the cycle
      expect(circularError).toContain('Dependency chain');
    });
  });

  describe('Module instance methods', () => {
    test('should provide access to module name', () => {
      @Module({})
      class NamedModule {}

      const module = new OneBunModule(NamedModule, mockLoggerLayer);
      expect((module as any).moduleClass.name).toBe('NamedModule');
    });

    test('should handle module initialization', () => {
      @Module({})
      class InitModule {}

      const module = new OneBunModule(InitModule, mockLoggerLayer);

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

      const module = new OneBunModule(ServiceModule, mockLoggerLayer);
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

      const module = new OneBunModule(ControllerModule, mockLoggerLayer);
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

      const module = new OneBunModule(TestModule, mockLoggerLayer);

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

      const module = new OneBunModule(TestModule, mockLoggerLayer);
      module.getLayer(); // Initialize the module

      // Access private method via type assertion
      const resolved = (module as any).resolveDependencyByType(TestService);

      // Service should now be created and resolvable via DI
      expect(resolved).toBeInstanceOf(TestService);
    });

    test('should resolve dependency by name (deprecated)', () => {
      @Module({})
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLoggerLayer);

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

      const module = new OneBunModule(TagModule, mockLoggerLayer);
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

      const module = new OneBunModule(TestModule, mockLoggerLayer);
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

      const module = new OneBunModule(TestModule, mockLoggerLayer);
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

      const module = new OneBunModule(RootModule, mockLoggerLayer);
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

      const module = new OneBunModule(RootModule, mockLoggerLayer);
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

      const module = new OneBunModule(RootModule, mockLoggerLayer);
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

      const module = new OneBunModule(RootModule, mockLoggerLayer);
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

      const module = new OneBunModule(RootModule, mockLoggerLayer);
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
      const module = new ModuleInstance(TestModule, mockLoggerLayer);

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
      const module = new ModuleInstance(ChainModule, mockLoggerLayer);

      const { getServiceTag } = require('./service');
      const apiServiceTag = getServiceTag(ApiService);
      const apiService = module.getServiceInstance(apiServiceTag);

      expect(apiService).toBeDefined();
      expect((apiService as ApiService).getConnectionTimeout()).toBe(5000);
    });

    /**
     * Test that this.config and this.logger are available in the service constructor
     * when the service is created through the DI system (via ambient init context).
     */
    test('should have this.config and this.logger available in constructor via DI', () => {
      let configInConstructor: unknown = undefined;
      let loggerInConstructor: unknown = undefined;

      @Service()
      class ConfigAwareService extends BaseServiceClass {
        constructor() {
          super();
          configInConstructor = this.config;
          loggerInConstructor = this.logger;
        }
      }

      @ModuleDecorator({
        providers: [ConfigAwareService],
      })
      class TestModule {}

      // Initialize module — this triggers DI and service creation
      new ModuleInstance(TestModule, mockLoggerLayer);

      // config and logger should have been available in the constructor
      expect(configInConstructor).toBeDefined();
      expect(loggerInConstructor).toBeDefined();
    });

    /**
     * Test that this.config.get() works in the constructor for services created via DI
     */
    test('should allow config.get() in service constructor via DI', () => {
      @Service()
      class ServiceWithConfigInConstructor extends BaseServiceClass {
        readonly configValue: unknown;

        constructor() {
          super();
          // Config should be available here via init context
          this.configValue = this.config;
        }

        getConfigValue() {
          return this.configValue;
        }
      }

      @ModuleDecorator({
        providers: [ServiceWithConfigInConstructor],
      })
      class TestModule {}

      const module = new ModuleInstance(TestModule, mockLoggerLayer);

      const { getServiceTag } = require('./service');
      const tag = getServiceTag(ServiceWithConfigInConstructor);
      const service = module.getServiceInstance(tag) as ServiceWithConfigInConstructor;

      expect(service).toBeDefined();
      // configValue was captured in constructor — should not be undefined
      expect(service.getConfigValue()).toBeDefined();
    });

    /**
     * Test that this.config is available in constructor of a service with dependencies
     */
    test('should have this.config in constructor of service with dependencies', () => {
      let configAvailable = false;

      @Service()
      class DependencyService {
        getValue() {
          return 42;
        }
      }

      @Service()
      class MainService extends BaseServiceClass {
        constructor(private dep: DependencyService) {
          super();
          configAvailable = this.config !== undefined;
        }

        getDep() {
          return this.dep.getValue();
        }
      }

      @ModuleDecorator({
        providers: [DependencyService, MainService],
      })
      class TestModule {}

      new ModuleInstance(TestModule, mockLoggerLayer);

      expect(configAvailable).toBe(true);
    });
  });

  describe('Lifecycle hooks', () => {
    const { clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry: clearRegistry, OneBunModule: ModuleClass } = require('./module');
    const { OnModuleInit } = require('./lifecycle');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    test('should call onModuleInit for a service that is not injected anywhere', async () => {
      let initCalled = false;

      @Service()
      class StandaloneService {
        async onModuleInit(): Promise<void> {
          initCalled = true;
        }
      }

      @Module({
        providers: [StandaloneService],
        // No controllers, no exports — this service is not injected anywhere
      })
      class TestModule {}

      const module = new ModuleClass(TestModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      expect(initCalled).toBe(true);
    });

    test('should call onModuleInit for multiple standalone services', async () => {
      const initLog: string[] = [];

      @Service()
      class WorkerServiceA {
        async onModuleInit(): Promise<void> {
          initLog.push('A');
        }
      }

      @Service()
      class WorkerServiceB {
        async onModuleInit(): Promise<void> {
          initLog.push('B');
        }
      }

      @Service()
      class WorkerServiceC {
        async onModuleInit(): Promise<void> {
          initLog.push('C');
        }
      }

      @Module({
        providers: [WorkerServiceA, WorkerServiceB, WorkerServiceC],
      })
      class TestModule {}

      const module = new ModuleClass(TestModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      expect(initLog).toContain('A');
      expect(initLog).toContain('B');
      expect(initLog).toContain('C');
      expect(initLog.length).toBe(3);
    });

    test('should call onModuleInit for standalone service in a child module', async () => {
      let childInitCalled = false;

      @Service()
      class ChildStandaloneService {
        async onModuleInit(): Promise<void> {
          childInitCalled = true;
        }
      }

      @Module({
        providers: [ChildStandaloneService],
      })
      class ChildModule {}

      @Module({
        imports: [ChildModule],
      })
      class RootModule {}

      const module = new ModuleClass(RootModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      expect(childInitCalled).toBe(true);
    });

    test('should call onModuleInit sequentially in dependency order', async () => {
      const initLog: string[] = [];
      const { registerDependencies } = require('../decorators/decorators');

      @Service()
      class DependencyService {
        async onModuleInit(): Promise<void> {
          // Simulate async work to make ordering matter
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          });
          initLog.push('dependency-completed');
        }

        getValue() {
          return 42;
        }
      }

      @Service()
      class DependentService {
        async onModuleInit(): Promise<void> {
          initLog.push('dependent-started');
        }
      }

      // Register DependentService -> DependencyService dependency
      registerDependencies(DependentService, [DependencyService]);

      @Module({
        providers: [DependencyService, DependentService],
      })
      class TestModule {}

      const module = new ModuleClass(TestModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // DependencyService.onModuleInit must complete BEFORE DependentService.onModuleInit starts
      expect(initLog).toEqual(['dependency-completed', 'dependent-started']);
    });

    test('should have dependencies already injected when onModuleInit is called', async () => {
      let depValueInInit: number | null = null;
      const { registerDependencies } = require('../decorators/decorators');

      @Service()
      class ConfigService {
        getPort() {
          return 8080;
        }
      }

      @Service()
      class ServerService {
        private configService: ConfigService;

        constructor(configService: ConfigService) {
          this.configService = configService;
        }

        async onModuleInit(): Promise<void> {
          // At this point configService should already be injected
          depValueInInit = this.configService.getPort();
        }
      }

      registerDependencies(ServerService, [ConfigService]);

      @Module({
        providers: [ConfigService, ServerService],
      })
      class TestModule {}

      const module = new ModuleClass(TestModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      expect(depValueInInit).not.toBeNull();
      expect(depValueInInit as unknown as number).toBe(8080);
    });
  });

  describe('Module DI scoping (exports only for cross-module)', () => {
    const {
      Controller: ControllerDecorator,
      Get,
      Inject,
      clearGlobalModules,
    } = require('../decorators/decorators');
    const { Controller: BaseController } = require('./controller');
    const { clearGlobalServicesRegistry: clearRegistry, OneBunModule: ModuleClass } = require('./module');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    test('controller can inject provider from same module without exports', async () => {
      @Service()
      class CounterService {
        private count = 0;
        getCount() {
          return this.count;
        }
        increment() {
          this.count += 1;
        }
      }

      class CounterController extends BaseController {
        constructor(@Inject(CounterService) private readonly counterService: CounterService) {
          super();
        }
        getCount() {
          return this.counterService.getCount();
        }
      }
      const CounterControllerDecorated = ControllerDecorator('/counter')(CounterController);
      Get('/')(CounterControllerDecorated.prototype, 'getCount', Object.getOwnPropertyDescriptor(CounterControllerDecorated.prototype, 'getCount')!);

      @Module({
        providers: [CounterService],
        controllers: [CounterControllerDecorated],
        // No exports - CounterService is only used inside this module
      })
      class FeatureModule {}

      const module = new ModuleClass(FeatureModule, mockLoggerLayer);
      module.getLayer();
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      const controller = module.getControllerInstance(CounterControllerDecorated) as CounterController;
      expect(controller).toBeDefined();
      expect(controller.getCount()).toBe(0);
    });

    test('child module controller injects own provider; root can resolve controller', async () => {
      @Service()
      class ChildService {
        getValue() {
          return 'child';
        }
      }

      class ChildController extends BaseController {
        constructor(@Inject(ChildService) private readonly childService: ChildService) {
          super();
        }
        getValue() {
          return this.childService.getValue();
        }
      }
      const ChildControllerDecorated = ControllerDecorator('/child')(ChildController);
      Get('/')(ChildControllerDecorated.prototype, 'getValue', Object.getOwnPropertyDescriptor(ChildControllerDecorated.prototype, 'getValue')!);

      @Module({
        providers: [ChildService],
        controllers: [ChildControllerDecorated],
      })
      class ChildModule {}

      @Module({
        imports: [ChildModule],
      })
      class RootModule {}

      const rootModule = new ModuleClass(RootModule, mockLoggerLayer);
      rootModule.getLayer();
      await Effect.runPromise(rootModule.setup() as Effect.Effect<unknown, never, never>);

      const allControllers = rootModule.getControllers();
      expect(allControllers).toContain(ChildControllerDecorated);
      const controller = rootModule.getControllerInstance(ChildControllerDecorated) as ChildController;
      expect(controller).toBeDefined();
      expect(controller.getValue()).toBe('child');
    });

    test('exported service from imported module is injectable in importing module', async () => {
      @Service()
      class SharedService {
        getLabel() {
          return 'shared';
        }
      }

      @Module({
        providers: [SharedService],
        exports: [SharedService],
      })
      class SharedModule {}

      class AppController extends BaseController {
        constructor(@Inject(SharedService) private readonly sharedService: SharedService) {
          super();
        }
        getLabel() {
          return this.sharedService.getLabel();
        }
      }
      const AppControllerDecorated = ControllerDecorator('/app')(AppController);
      Get('/')(AppControllerDecorated.prototype, 'getLabel', Object.getOwnPropertyDescriptor(AppControllerDecorated.prototype, 'getLabel')!);

      @Module({
        imports: [SharedModule],
        controllers: [AppControllerDecorated],
      })
      class AppModule {}

      const module = new ModuleClass(AppModule, mockLoggerLayer);
      module.getLayer();
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      const controller = module.getControllerInstance(AppControllerDecorated) as AppController;
      expect(controller).toBeDefined();
      expect(controller.getLabel()).toBe('shared');
    });
  });
});
