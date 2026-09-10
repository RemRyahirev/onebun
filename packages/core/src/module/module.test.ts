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

import type {
  MiddlewareClass,
  OneBunRequest,
  OneBunResponse,
  OnModuleConfigure,
} from '../types';


import { LoggerService } from '@onebun/logger';

import {
  Controller as CtrlDeco,
  Middleware,
  Module,
} from '../decorators/decorators';
import { CircularDependencyError, DependencyResolutionError } from '../errors/dependency-errors';
import { createMockLogger, makeMockLoggerLayer } from '../testing/test-utils';
import { BaseWebSocketGateway } from '../websocket/ws-base-gateway';
import { WebSocketGateway } from '../websocket/ws-decorators';


import { Controller as CtrlBase } from './controller';
import { BaseMiddleware } from './middleware';
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

    test('should throw CircularDependencyError for A -> B -> C -> A cycle', () => {
      const { registerDependencies } = require('../decorators/decorators');

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

      // Register circular dependencies: A -> C -> B -> A
      registerDependencies(CircularServiceA, [CircularServiceC]);
      registerDependencies(CircularServiceB, [CircularServiceA]);
      registerDependencies(CircularServiceC, [CircularServiceB]);

      @Module({
        providers: [CircularServiceA, CircularServiceB, CircularServiceC],
      })
      class CircularModule {}

      expect(() => new OneBunModule(CircularModule, mockLoggerLayer)).toThrow(
        CircularDependencyError,
      );

      try {
        new OneBunModule(CircularModule, mockLoggerLayer);
      } catch (error) {
        expect(error).toBeInstanceOf(CircularDependencyError);
        const cde = error as CircularDependencyError;
        expect(cde.moduleName).toBe('CircularModule');
        expect(cde.message).toContain('Circular dependency detected');
        expect(cde.message).toContain('Dependency chain');
        expect(cde.unresolvedServices.length).toBeGreaterThan(0);

        const hasServiceInfo =
          cde.message.includes('CircularServiceA') ||
          cde.message.includes('CircularServiceB') ||
          cde.message.includes('CircularServiceC');
        expect(hasServiceInfo).toBe(true);
      }
    });

    test('should throw CircularDependencyError for direct A <-> B cycle', () => {
      const { registerDependencies } = require('../decorators/decorators');

      @Service()
      class DirectA {
        getValue() {
          return 'A';
        }
      }

      @Service()
      class DirectB {
        getValue() {
          return 'B';
        }
      }

      registerDependencies(DirectA, [DirectB]);
      registerDependencies(DirectB, [DirectA]);

      @Module({
        providers: [DirectA, DirectB],
      })
      class DirectCycleModule {}

      expect(() => new OneBunModule(DirectCycleModule, mockLoggerLayer)).toThrow(
        CircularDependencyError,
      );
    });

    test('should throw CircularDependencyError for self-dependency A -> A', () => {
      const { registerDependencies } = require('../decorators/decorators');

      @Service()
      class SelfDepService {
        getValue() {
          return 'self';
        }
      }

      registerDependencies(SelfDepService, [SelfDepService]);

      @Module({
        providers: [SelfDepService],
      })
      class SelfDepModule {}

      expect(() => new OneBunModule(SelfDepModule, mockLoggerLayer)).toThrow(
        CircularDependencyError,
      );
    });
  });

  describe('Fail-fast dependency resolution', () => {
    test('should throw DependencyResolutionError for unresolved required service dependency', () => {
      const { registerDependencies } = require('../decorators/decorators');

      @Service()
      class MissingDep {
        getValue() {
          return 'missing';
        }
      }

      @Service()
      class NeedsDep {
        getValue() {
          return 'needs';
        }
      }

      // NeedsDep depends on MissingDep, but MissingDep is NOT in providers
      registerDependencies(NeedsDep, [MissingDep]);

      @Module({
        providers: [NeedsDep],
      })
      class FailFastModule {}

      expect(() => new OneBunModule(FailFastModule, mockLoggerLayer)).toThrow(
        DependencyResolutionError,
      );

      try {
        new OneBunModule(FailFastModule, mockLoggerLayer);
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyResolutionError);
        const dre = error as DependencyResolutionError;
        expect(dre.targetName).toBe('NeedsDep');
        expect(dre.dependencyName).toBe('MissingDep');
        expect(dre.targetType).toBe('service');
        expect(dre.message).toContain('MissingDep');
        expect(dre.message).toContain('NeedsDep');
      }
    });

    test('should throw DependencyResolutionError with suggestion when dep exists in another module', () => {
      const { registerDependencies } = require('../decorators/decorators');

      @Service()
      class SharedService {
        getValue() {
          return 'shared';
        }
      }

      @Module({
        providers: [SharedService],
        exports: [SharedService],
      })
      class SharedModule {}

      @Service()
      class ConsumerService {
        getValue() {
          return 'consumer';
        }
      }

      registerDependencies(ConsumerService, [SharedService]);

      @Module({
        providers: [ConsumerService],
        // SharedModule is NOT imported!
      })
      class ConsumerModule {}

      try {
        new OneBunModule(ConsumerModule, mockLoggerLayer);
      } catch (error) {
        expect(error).toBeInstanceOf(DependencyResolutionError);
        const dre = error as DependencyResolutionError;
        expect(dre.message).toContain('SharedModule');
        expect(dre.message).toContain('imports');
      }
    });

    test('should allow @Optional() dependency to resolve as undefined', () => {
      const { registerDependencies, Optional } = require('../decorators/decorators');

      @Service()
      class OptionalDep {
        getValue() {
          return 'optional';
        }
      }

      @Service()
      class WithOptional {
        getValue() {
          return 'with-optional';
        }
      }

      // WithOptional depends on OptionalDep, but it is marked as @Optional
      registerDependencies(WithOptional, [OptionalDep]);

      // Mark parameter 0 as optional
      Optional()(WithOptional, undefined, 0);

      @Module({
        providers: [WithOptional],
      })
      class OptionalModule {}

      // Should NOT throw — optional dependency is allowed to be undefined
      const mod = new OneBunModule(OptionalModule, mockLoggerLayer);
      expect(mod).toBeInstanceOf(OneBunModule);
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

  describe('Per-application GlobalScope', () => {
    const { Global, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry, createGlobalScope, resolveScopedModuleOptions } = require('./module');

    beforeEach(() => {
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    test('two scopes importing one @Global() module each construct their own instance', () => {
      let constructed = 0;

      @Service()
      class ScopedDb {
        readonly id = ++constructed;
      }

      @Global()
      @Module({ providers: [ScopedDb], exports: [ScopedDb] })
      class ScopedDbModule {}

      @Module({ imports: [ScopedDbModule] })
      class RootModule {}

      const scopeA = createGlobalScope();
      const scopeB = createGlobalScope();

      const moduleA = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, scopeA);
      const moduleB = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, scopeB);

      const instA = moduleA.getServiceByClass(ScopedDb as any);
      const instB = moduleB.getServiceByClass(ScopedDb as any);

      // Identity, not registry contents: the registry getter returns a copy, so reading it
      // could never tell these two apart.
      expect(instA).toBeDefined();
      expect(instB).toBeDefined();
      expect(instA).not.toBe(instB);

      // The provider constructor really ran twice — the processedModules short-circuit did
      // not fire for the second scope, which is the whole defect.
      expect(constructed).toBe(2);
      expect(scopeA.processedModules.has(ScopedDbModule)).toBe(true);
      expect(scopeB.processedModules.has(ScopedDbModule)).toBe(true);
    });

    test('a @Global() module is still constructed once WITHIN one scope', () => {
      let constructed = 0;

      @Service()
      class OnceService {
        readonly id = ++constructed;
      }

      @Global()
      @Module({ providers: [OnceService], exports: [OnceService] })
      class OnceModule {}

      @Module({ imports: [OnceModule] })
      class ChildA {}

      @Module({ imports: [OnceModule] })
      class ChildB {}

      @Module({ imports: [OnceModule, ChildA, ChildB] })
      class RootModule {}

      new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(constructed).toBe(1);
    });

    test('an object provider throws instead of being silently discarded', () => {
      @Service()
      class RealService {
        value(): string {
          return 'real';
        }
      }

      @Module({ providers: [{ provide: RealService, useValue: { value: () => 'fake' } } as any] })
      class ObjectProviderModule {}

      // Previously the entry was dropped by the `typeof p === 'function'` filters and the
      // failure surfaced later as an unrelated unresolved dependency.
      expect(() => new OneBunModule(ObjectProviderModule, mockLoggerLayer))
        .toThrow(/declares an object provider/);

      try {
        new OneBunModule(ObjectProviderModule, mockLoggerLayer);
      } catch (error) {
        expect((error as Error).name).toBe('OneBunInvalidProviderError');
        expect((error as Error).message).toContain('ObjectProviderModule');
        expect((error as Error).message).toContain('RealService');
      }
    });

    test('a stub that EXTENDS the real service still resolves via the instanceof fallback', () => {
      @Service()
      class RealDb {
        query(): string {
          return 'real';
        }
      }

      class StubDb extends RealDb {
        override query(): string {
          return 'stub';
        }
      }

      @Service()
      class Consumer {
        constructor(public db: RealDb) {}
      }

      @Module({ providers: [Consumer] })
      class RootModule {}

      // Seed the stub into the scope the way a @Global() module would, under a tag the
      // consumer does not ask for; resolution has to fall through to the instanceof check.
      const scope = createGlobalScope();
      scope.services.set(Context.GenericTag<unknown>('stub-db'), new StubDb());

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, scope);
      const consumer = module.getServiceByClass(Consumer as any) as Consumer;

      expect(consumer.db).toBeInstanceOf(StubDb);
      expect(consumer.db.query()).toBe('stub');
    });

    test('a @Global() service is destroyed and app-initialized exactly ONCE in a deep tree', async () => {
      let appInits = 0;
      let destroys = 0;

      @Service()
      class HookService {
        async onApplicationInit(): Promise<void> {
          appInits++;
        }

        async onModuleDestroy(): Promise<void> {
          destroys++;
        }
      }

      @Global()
      @Module({ providers: [HookService], exports: [HookService] })
      class HookModule {}

      @Module({ imports: [HookModule] })
      class LevelOne {}

      @Module({ imports: [LevelOne] })
      class LevelTwo {}

      @Module({ imports: [LevelTwo] })
      class LevelThree {}

      @Module({ imports: [HookModule, LevelThree] })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      await module.callOnApplicationInit();
      await module.callOnModuleDestroy();

      // A @Global() instance sits in the serviceInstances map of every module that can see
      // it, so an undeduplicated recursion fired these once per module (5 in this tree).
      expect(appInits).toBe(1);
      expect(destroys).toBe(1);
    });

    test('dynamic-module options are snapshotted per scope, not shared through the class', () => {
      let currentOptions: unknown = { db: 'a' };

      @Service()
      class OptionsReader {
        value(): string {
          return 'x';
        }
      }

      class DynamicModule {
        static getOptions(): unknown {
          return currentOptions;
        }
      }
      Module({ providers: [OptionsReader], exports: [OptionsReader] })(DynamicModule);

      @Module({ imports: [DynamicModule] })
      class RootModule {}

      const scopeA = createGlobalScope();
      new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, scopeA);

      // The second forRoot() overwrites the class slot for the whole process...
      currentOptions = { db: 'b' };
      const scopeB = createGlobalScope();
      new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, scopeB);

      // ...but each scope kept the value its own import saw.
      expect(resolveScopedModuleOptions(scopeA, DynamicModule)).toEqual({ db: 'a' });
      expect(resolveScopedModuleOptions(scopeB, DynamicModule)).toEqual({ db: 'b' });
      expect(resolveScopedModuleOptions(undefined, DynamicModule)).toBeUndefined();
    });

    test('an override in the scope reaches an imported module and suppresses the real provider', () => {
      let realConstructed = 0;

      @Service()
      class Dep {
        constructor() {
          realConstructed++;
        }

        who(): string {
          return 'REAL';
        }
      }

      @Service()
      class Consumer {
        constructor(private dep: Dep) {}

        saw(): string {
          return this.dep.who();
        }
      }

      @Module({ providers: [Dep, Consumer], exports: [Dep, Consumer] })
      class InnerModule {}

      @Module({ imports: [InnerModule] })
      class RootModule {}

      const scope = createGlobalScope();
      const { getServiceTag } = require('./service');
      scope.overrides.set(getServiceTag(Dep), { who: () => 'MOCK' });

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, scope);
      const consumer = module.getServiceByClass(Consumer as any) as Consumer;

      expect(consumer.saw()).toBe('MOCK');
      // The real provider is not built at all — constructing it would run its own
      // dependencies for an instance nothing receives.
      expect(realConstructed).toBe(0);
    });
  });

  describe('Import order independence (FB-6)', () => {
    const { Global, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry, createGlobalScope } = require('./module');

    beforeEach(() => {
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    /**
     * Builds the reported shape. `@Global()` is LOAD-BEARING and the original report omits
     * it: without it both orders boot, so the reported reproduction pasted verbatim would
     * pass and close this as unreproducible.
     */
    const buildTree = () => {
      let constructed = 0;

      @Service()
      class Svc {
        constructor() {
          constructed++;
        }

        value(): string {
          return 'ok';
        }
      }

      @Global()
      @Module({ providers: [Svc], exports: [Svc] })
      class CoreModule {}

      @Module({ imports: [CoreModule] })
      class FeatureModule {}

      @Service()
      class Consumer {
        constructor(public svc: Svc) {}
      }

      return {
        Svc,
        CoreModule,
        FeatureModule,
        Consumer,
        count: () => constructed,
      };
    };

    test('a module listed AFTER a sibling that already initialized it still contributes', () => {
      const {
        Svc, CoreModule, FeatureModule, Consumer, count, 
      } = buildTree();

      @Module({ imports: [FeatureModule, CoreModule], providers: [Consumer] })
      class FeatureFirst {}

      // FeatureModule initializes CoreModule as its own child, so by the time the second
      // import is reached CoreModule is already processed and the loop skips it. This threw
      // `Could not resolve dependency Svc` while `[CoreModule, FeatureModule]` booted.
      const module = new OneBunModule(FeatureFirst, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      const consumer = module.getServiceByClass(Consumer as any) as { svc: unknown };

      expect(consumer.svc).toBeInstanceOf(Svc);
      expect(count()).toBe(1);
    });

    test('the working order still works and still constructs once', () => {
      const {
        Svc, CoreModule, FeatureModule, Consumer, count, 
      } = buildTree();

      @Module({ imports: [CoreModule, FeatureModule], providers: [Consumer] })
      class CoreFirst {}

      const module = new OneBunModule(CoreFirst, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      const consumer = module.getServiceByClass(Consumer as any) as { svc: unknown };

      expect(consumer.svc).toBeInstanceOf(Svc);
      expect(count()).toBe(1);
    });

    test('a @Global() module reaches a grandparent that does not import it at all', () => {
      const {
        Svc, FeatureModule, Consumer, count, 
      } = buildTree();

      @Module({ imports: [FeatureModule], providers: [Consumer] })
      class FeatureOnly {}

      // The stronger form of the same defect: the global was registered by a descendant
      // AFTER this module's first pass over the scope, and nothing read it again.
      const module = new OneBunModule(FeatureOnly, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      const consumer = module.getServiceByClass(Consumer as any) as { svc: unknown };

      expect(consumer.svc).toBeInstanceOf(Svc);
      expect(count()).toBe(1);
    });

    test('the module is still constructed ONCE, not re-constructed per importer', () => {
      const {
        CoreModule, FeatureModule, Consumer, count, 
      } = buildTree();

      @Module({ imports: [FeatureModule, CoreModule], providers: [Consumer] })
      class FeatureFirst {}

      new OneBunModule(FeatureFirst, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      // The fix seeds from the scope; it does not drop the already-processed short-circuit.
      expect(count()).toBe(1);
    });

    test('re-seeding an already-initialized global module is logged with a count', () => {
      const { CoreModule, FeatureModule, Consumer } = buildTree();

      @Module({ imports: [FeatureModule, CoreModule], providers: [Consumer] })
      class FeatureFirst {}

      const messages: string[] = [];
      // `createMockLogger().child()` returns the ORIGINAL mock, so spreading it and
      // overriding `debug` loses the override the moment OneBunModule calls `.child()`.
      // This one returns itself.
      const capturing: any = {
        ...createMockLogger(),
        debug(message: string) {
          messages.push(message);

          return Effect.succeed(undefined);
        },
      };
      capturing.child = () => capturing;
      const capturingLayer = Layer.succeed(LoggerService, capturing);

      new OneBunModule(FeatureFirst, capturingLayer as any, undefined, undefined, undefined, createGlobalScope());

      // The silence is what made this cost a month of debugging, so an already-initialized
      // global import must say so, naming both modules.
      const reseedLine = messages.find(m => m.includes('re-seeded') && m.includes('CoreModule'));
      expect(reseedLine).toBeDefined();

      // The count is deliberately NOT asserted non-zero any more. The pre-pass (WI-232)
      // constructs global modules before the import loop runs, so by the time the loop
      // reaches CoreModule its services are already in this module — a re-seed of 0 is the
      // correct outcome, not a lost registration. The line that now carries the information
      // is the pre-registration one below.
      const preRegisteredLine = messages.find(
        m => m.includes('Pre-registered global module CoreModule'),
      );
      expect(preRegisteredLine).toBeDefined();
      expect(preRegisteredLine).toContain('FeatureFirst');
    });

    test('exporting a MODULE throws instead of silently contributing nothing', () => {
      @Service()
      class Svc {
        value(): string {
          return 'ok';
        }
      }

      @Module({ providers: [Svc], exports: [Svc] })
      class CoreModule {}

      // The NestJS re-export idiom, which the original report's own reproduction uses.
      @Module({ imports: [CoreModule], exports: [CoreModule] })
      class ReExportingModule {}

      @Module({ imports: [ReExportingModule] })
      class RootModule {}

      expect(() => new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope()))
        .toThrow(/exports the module CoreModule/);

      try {
        new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      } catch (error) {
        expect((error as Error).name).toBe('OneBunInvalidExportError');
        expect((error as Error).message).toContain('ReExportingModule');
      }
    });

    test('the reported shape boots end to end through a real application', async () => {
      const { OneBunApplication } = require('../application/application');
      const { Get } = require('../decorators/decorators');

      let constructed = 0;

      @Service()
      class Svc {
        constructor() {
          constructed++;
        }

        value(): string {
          return 'ok';
        }
      }

      @Global()
      @Module({ providers: [Svc], exports: [Svc] })
      class CoreModule {}

      @Module({ imports: [CoreModule] })
      class FeatureModule {}

      // Declared here rather than built by the helper so TypeScript emits a real
      // `design:paramtypes` for `svc`. With an `any` annotation it emits `Object`, the tag
      // lookup misses, and the instanceof fallback hands back whatever service happens to be
      // first in the map — the test would pass without resolution ever working.
      @CtrlDeco('/probe')
      class ProbeController extends CtrlBase {
        constructor(private svc: Svc) {
          super();
        }

        @Get('/')
        value() {
          return { value: this.svc.value() };
        }
      }

      const count = (): number => constructed;

      @Module({ imports: [FeatureModule, CoreModule], controllers: [ProbeController] })
      class AppModule {}

      // The reporter's failure was at boot, through the container — not reproducible from a
      // hand-wired controller, which is exactly why their integration suite stayed green.
      const app = new OneBunApplication(AppModule, {
        port: 0,
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
      });

      try {
        await app.start();

        // Not just "it booted": the controller has to have RECEIVED the global service,
        // which is the thing that used to throw here.
        const injected = (app as any).rootModule.getControllerInstance(ProbeController);
        expect(injected.svc).toBeInstanceOf(Svc);

        const response = await fetch(`http://127.0.0.1:${app.getPort()}/probe`);
        const body = await response.json() as { result: { value: string } };
        expect(body.result.value).toBe('ok');
        expect(count()).toBe(1);
      } finally {
        await app.stop();
      }
    });

    /**
     * The half FB-6 could NOT reach. Note what makes it different from the cases above: the
     * consumer's subtree does not import the global module AT ALL, so nothing in that
     * subtree ever triggers the post-loop re-seed — the subtree is built to completion
     * during the root's import loop, before the root has even looked at its second entry.
     *
     * A fixture where the intermediate module imports the global one passes WITHOUT the
     * pre-pass, because FB-6's re-seed already covers it. That version of this test was
     * written first and verified vacuous.
     */
    const buildDetachedTree = (depth: number) => {
      let constructed = 0;

      @Service()
      class Svc {
        constructor() {
          constructed++;
        }

        value(): string {
          return 'ok';
        }
      }

      @Global()
      @Module({ providers: [Svc], exports: [Svc] })
      class CoreModule {}

      @Service()
      class Consumer {
        constructor(public svc: Svc) {}
      }

      // Leaf needs the global service but imports nothing.
      @Module({ providers: [Consumer] })
      class Leaf {}

      let current: Function = Leaf;
      for (let i = 0; i < depth; i++) {
        const inner = current;

        @Module({ imports: [inner] })
        class Wrapper {}
        current = Wrapper;
      }

      return {
        Svc, CoreModule, Consumer, Feature: current, count: () => constructed,
      };
    };

    const findConsumer = (module: OneBunModule, Consumer: Function): { svc: unknown } | undefined => {
      const search = (candidate: any): any => {
        const own = candidate.getServiceByClass(Consumer as never);
        if (own) {
          return own;
        }
        for (const child of candidate.childModules ?? []) {
          const found = search(child);
          if (found) {
            return found;
          }
        }

        return undefined;
      };

      return search(module as any);
    };

    test('a consumer in a detached subtree sees a later sibling registration (depth 1)', () => {
      const {
        Svc, CoreModule, Consumer, Feature, count,
      } = buildDetachedTree(1);

      @Module({ imports: [Feature, CoreModule] })
      class FeatureFirst {}

      const module = new OneBunModule(FeatureFirst, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(findConsumer(module, Consumer)?.svc).toBeInstanceOf(Svc);
      expect(count()).toBe(1);
    });

    test('the same, at depth 3', () => {
      const {
        Svc, CoreModule, Consumer, Feature, count,
      } = buildDetachedTree(3);

      @Module({ imports: [Feature, CoreModule] })
      class FeatureFirst {}

      const module = new OneBunModule(FeatureFirst, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(findConsumer(module, Consumer)?.svc).toBeInstanceOf(Svc);
      expect(count()).toBe(1);
    });

    test('the working order still works at depth 3', () => {
      const {
        Svc, CoreModule, Consumer, Feature, count,
      } = buildDetachedTree(3);

      @Module({ imports: [CoreModule, Feature] })
      class CoreFirst {}

      const module = new OneBunModule(CoreFirst, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(findConsumer(module, Consumer)?.svc).toBeInstanceOf(Svc);
      expect(count()).toBe(1);
    });

    test('the pre-pass constructs nothing by walking, and still builds a global module ONCE', () => {
      let constructed = 0;

      @Service()
      class Counted {
        constructor() {
          constructed++;
        }
      }

      @Global()
      @Module({ providers: [Counted], exports: [Counted] })
      class CountedGlobal {}

      @Service()
      class Plain {
        constructor() {
          constructed++;
        }
      }

      @Module({ providers: [Plain] })
      class PlainModule {}

      @Module({ imports: [PlainModule, CountedGlobal] })
      class Mid {}

      @Module({ imports: [Mid, CountedGlobal] })
      class RootModule {}

      new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      // CountedGlobal is reachable twice and appears in two imports arrays; it must still be
      // constructed exactly once, and PlainModule exactly once.
      expect(constructed).toBe(2);
    });

    test('a cyclic import graph does not hang or double-register', () => {
      let constructed = 0;

      @Service()
      class Shared {
        constructor() {
          constructed++;
        }
      }

      @Global()
      @Module({ providers: [Shared], exports: [Shared] })
      class SharedGlobal {}

      // A imports B, B imports A, and both import the global module.
      const ModuleA = class {};
      const ModuleB = class {};
      Object.defineProperty(ModuleA, 'name', { value: 'ModuleA' });
      Object.defineProperty(ModuleB, 'name', { value: 'ModuleB' });
      Module({ imports: [SharedGlobal, ModuleB] })(ModuleA as never);
      Module({ imports: [SharedGlobal] })(ModuleB as never);

      @Module({ imports: [ModuleA as never] })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(module).toBeInstanceOf(OneBunModule);
      expect(constructed).toBe(1);
    });

    test('exporting a SERVICE is untouched', () => {
      @Service()
      class Svc {
        value(): string {
          return 'ok';
        }
      }

      @Module({ providers: [Svc], exports: [Svc] })
      class CoreModule {}

      @Service()
      class Consumer {
        constructor(public svc: Svc) {}
      }

      @Module({ imports: [CoreModule], providers: [Consumer] })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      const consumer = module.getServiceByClass(Consumer as any) as { svc: unknown };

      expect(consumer.svc).toBeInstanceOf(Svc);
    });
  });

  describe('Controller DI with @Inject decorator', () => {
    const {
      Inject: InjectDecorator, getConstructorParamTypes, Controller: ControllerDecorator, clearGlobalModules,
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
        constructor(@InjectDecorator(SimpleService) private svc: SimpleService) {
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

  describe('Controller with ambient init context (config/logger in constructor)', () => {
    const { Module: ModuleDecorator, Controller: ControllerDecorator, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry: clearRegistry, OneBunModule: ModuleClass } = require('./module');
    const { Controller: BaseController } = require('./controller');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    /**
     * Test that this.config and this.logger are available in the controller constructor
     * when the controller is created through the DI system (via ambient init context).
     */
    test('should have this.config and this.logger available in controller constructor via DI', async () => {
      let configInConstructor: unknown = undefined;
      let loggerInConstructor: unknown = undefined;

      @ControllerDecorator('/test')
      class TestCtrl extends BaseController {
        constructor() {
          super();
          configInConstructor = this.config;
          loggerInConstructor = this.logger;
        }
      }

      @ModuleDecorator({
        controllers: [TestCtrl],
      })
      class TestModule {}

      // Initialize module and run setup — this triggers DI and controller creation
      const module = new ModuleClass(TestModule, mockLoggerLayer);
      module.getLayer();
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // config and logger should have been available in the constructor
      expect(configInConstructor).toBeDefined();
      expect(loggerInConstructor).toBeDefined();
    });

    /**
     * Test that this.config and this.logger are available in the controller constructor
     * when the controller has injected service dependencies.
     */
    test('should have this.config and this.logger in constructor of controller with dependencies', async () => {
      let configAvailable = false;
      let loggerAvailable = false;

      @Service()
      class SomeService {
        getValue() {
          return 42;
        }
      }

      @ControllerDecorator('/test')
      class TestCtrl extends BaseController {
        constructor(private svc: SomeService) {
          super();
          configAvailable = this.config !== undefined;
          loggerAvailable = this.logger !== undefined;
        }
      }

      @ModuleDecorator({
        providers: [SomeService],
        controllers: [TestCtrl],
      })
      class TestModule {}

      const module = new ModuleClass(TestModule, mockLoggerLayer);
      module.getLayer();
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      expect(configAvailable).toBe(true);
      expect(loggerAvailable).toBe(true);
    });
  });

  describe('WebSocket gateway with ambient init context (config/logger in constructor)', () => {
    const { Module: ModuleDecorator, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry: clearRegistry, OneBunModule: ModuleClass } = require('./module');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    /**
     * Test that this.config and this.logger are available in the WS gateway constructor
     * when the gateway is created through the DI system (via ambient init context).
     */
    test('should have this.config and this.logger available in WS gateway constructor via DI', async () => {
      let configInConstructor: unknown = undefined;
      let loggerInConstructor: unknown = undefined;

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        constructor() {
          super();
          configInConstructor = this.config;
          loggerInConstructor = this.logger;
        }
      }

      @ModuleDecorator({
        controllers: [TestGateway],
      })
      class TestModule {}

      // Initialize module and run setup — this triggers DI and gateway creation
      const module = new ModuleClass(TestModule, mockLoggerLayer);
      module.getLayer();
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // config and logger should have been available in the constructor
      expect(configInConstructor).toBeDefined();
      expect(loggerInConstructor).toBeDefined();
    });

    /**
     * Test that this.config and this.logger are available in the WS gateway constructor
     * when the gateway has injected service dependencies.
     */
    test('should have this.config and this.logger in constructor of WS gateway with dependencies', async () => {
      let configAvailable = false;
      let loggerAvailable = false;

      @Service()
      class WsAuthService {
        verify() {
          return true;
        }
      }

      @WebSocketGateway({ path: '/ws' })
      class TestGateway extends BaseWebSocketGateway {
        constructor(private auth: WsAuthService) {
          super();
          configAvailable = this.config !== undefined;
          loggerAvailable = this.logger !== undefined;
        }
      }

      @ModuleDecorator({
        providers: [WsAuthService],
        controllers: [TestGateway],
      })
      class TestModule {}

      const module = new ModuleClass(TestModule, mockLoggerLayer);
      module.getLayer();
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      expect(configAvailable).toBe(true);
      expect(loggerAvailable).toBe(true);
    });
  });

  describe('Middleware with ambient init context (config/logger in constructor)', () => {
    const { Module: ModuleDecorator, Controller: ControllerDecorator, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry: clearRegistry, OneBunModule: ModuleInstance } = require('./module');
    const { Controller: BaseController } = require('./controller');

    beforeEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearRegistry();
    });

    /**
     * Test that this.config and this.logger are available in the middleware constructor
     * when the middleware is created through the DI system (via ambient init context).
     */
    test('should have this.config and this.logger available in middleware constructor via DI', () => {
      let configInConstructor: unknown = undefined;
      let loggerInConstructor: unknown = undefined;

      class TestMiddleware extends BaseMiddleware {
        constructor() {
          super();
          configInConstructor = this.config;
          loggerInConstructor = this.logger;
        }

        async use(req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
          return await next();
        }
      }

      @ControllerDecorator('/test')
      class TestCtrl extends BaseController {}

      @ModuleDecorator({
        controllers: [TestCtrl],
      })
      class TestModule {}

      // Initialize module and resolve middleware (as the framework does)
      const module = new ModuleInstance(TestModule, mockLoggerLayer);
      module.resolveMiddleware([TestMiddleware]);

      // config and logger should have been available in the constructor
      expect(configInConstructor).toBeDefined();
      expect(loggerInConstructor).toBeDefined();
    });
  });

  describe('Middleware with service injection', () => {
    test('should resolve middleware with injected service and use it in use()', async () => {
      @Service()
      class HelperService {
        getValue(): string {
          return 'injected';
        }
      }

      @Middleware()
      class MiddlewareWithService extends BaseMiddleware {
        constructor(private readonly helper: HelperService) {
          super();
        }

        async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>): Promise<OneBunResponse> {
          const res = await next();
          res.headers.set('X-Injected-Value', this.helper.getValue());

          return res;
        }
      }

      @CtrlDeco('/test')
      class TestCtrl extends CtrlBase {}

      @Module({
        controllers: [TestCtrl],
        providers: [HelperService],
      })
      class TestModule {}

      const module = new OneBunModule(TestModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      const resolved = module.resolveMiddleware([MiddlewareWithService]);
      expect(resolved).toHaveLength(1);

      const mockReq = Object.assign(new Request('http://localhost/'), {
        params: {},
        cookies: new Map(),
      }) as unknown as OneBunRequest;
      const next = async (): Promise<OneBunResponse> => new Response('ok');
      const response = await resolved[0](mockReq, next);

      expect(response.headers.get('X-Injected-Value')).toBe('injected');
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

    test('should call onModuleInit for services and controllers in deeply nested module tree', async () => {
      const initLog: string[] = [];

      @Service()
      class GrandchildService {
        async onModuleInit(): Promise<void> {
          initLog.push('grandchild-service');
        }
      }

      @CtrlDeco('/grandchild')
      class GrandchildController extends CtrlBase {
        async onModuleInit(): Promise<void> {
          initLog.push('grandchild-controller');
        }
      }

      @Module({
        providers: [GrandchildService],
        controllers: [GrandchildController],
      })
      class GrandchildModule {}

      @Service()
      class ChildService {
        async onModuleInit(): Promise<void> {
          initLog.push('child-service');
        }
      }

      @CtrlDeco('/child')
      class ChildController extends CtrlBase {
        async onModuleInit(): Promise<void> {
          initLog.push('child-controller');
        }
      }

      @Module({
        imports: [GrandchildModule],
        providers: [ChildService],
        controllers: [ChildController],
      })
      class ChildModule {}

      @Service()
      class RootService {
        async onModuleInit(): Promise<void> {
          initLog.push('root-service');
        }
      }

      @CtrlDeco('/root')
      class RootController extends CtrlBase {
        async onModuleInit(): Promise<void> {
          initLog.push('root-controller');
        }
      }

      @Module({
        imports: [ChildModule],
        providers: [RootService],
        controllers: [RootController],
      })
      class RootModule {}

      const module = new ModuleClass(RootModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // All services and controllers across all levels must have onModuleInit called
      expect(initLog).toContain('grandchild-service');
      expect(initLog).toContain('grandchild-controller');
      expect(initLog).toContain('child-service');
      expect(initLog).toContain('child-controller');
      expect(initLog).toContain('root-service');
      expect(initLog).toContain('root-controller');
      expect(initLog.length).toBe(6);
    });
  });

  describe('Module DI scoping (exports only for cross-module)', () => {
    const {
      Controller: ControllerDecorator,
      Get,
      Inject: InjectDecorator,
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
        constructor(@InjectDecorator(CounterService) private readonly counterService: CounterService) {
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
        constructor(@InjectDecorator(ChildService) private readonly childService: ChildService) {
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
        constructor(@InjectDecorator(SharedService) private readonly sharedService: SharedService) {
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

  describe('Module-level middleware (OnModuleConfigure)', () => {
    class Mw1 extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
        return await next(); 
      }
    }

    class Mw2 extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
        return await next(); 
      }
    }

    class Mw3 extends BaseMiddleware {
      async use(_req: OneBunRequest, next: () => Promise<OneBunResponse>) {
        return await next(); 
      }
    }

    test('should collect middleware from module implementing OnModuleConfigure', async () => {
      @CtrlDeco('/test')
      class TestController extends CtrlBase {}

      @Module({ controllers: [TestController] })
      class TestModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [Mw1, Mw2];
        }
      }

      const module = new OneBunModule(TestModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      const middleware = module.getModuleMiddleware(TestController);
      expect(middleware).toHaveLength(2);
      // Resolved middleware are bound use() functions
      expect(typeof middleware[0]).toBe('function');
      expect(typeof middleware[1]).toBe('function');
    });

    test('should return empty middleware for modules without OnModuleConfigure', async () => {
      @CtrlDeco('/test')
      class TestController extends CtrlBase {}

      @Module({ controllers: [TestController] })
      class PlainModule {}

      const module = new OneBunModule(PlainModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      const middleware = module.getModuleMiddleware(TestController);
      expect(middleware).toHaveLength(0);
    });

    test('should accumulate middleware from parent to child modules', async () => {
      @CtrlDeco('/child')
      class ChildController extends CtrlBase {}

      @Module({ controllers: [ChildController] })
      class ChildModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [Mw2];
        }
      }

      @CtrlDeco('/root')
      class RootController extends CtrlBase {}

      @Module({ imports: [ChildModule], controllers: [RootController] })
      class RootModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [Mw1];
        }
      }

      const module = new OneBunModule(RootModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // ChildController should have accumulated: [Mw1 (root), Mw2 (child)]
      const childMw = module.getModuleMiddleware(ChildController);
      expect(childMw).toHaveLength(2);
      expect(typeof childMw[0]).toBe('function');
      expect(typeof childMw[1]).toBe('function');

      // RootController should have only root middleware: [Mw1]
      const rootMw = module.getModuleMiddleware(RootController);
      expect(rootMw).toHaveLength(1);
      expect(typeof rootMw[0]).toBe('function');
    });

    test('should handle deeply nested module middleware', async () => {
      @CtrlDeco('/deep')
      class DeepController extends CtrlBase {}

      @Module({ controllers: [DeepController] })
      class DeepModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [Mw3];
        }
      }

      @Module({ imports: [DeepModule] })
      class MiddleModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [Mw2];
        }
      }

      @Module({ imports: [MiddleModule] })
      class TopModule implements OnModuleConfigure {
        configureMiddleware(): MiddlewareClass[] {
          return [Mw1];
        }
      }

      const module = new OneBunModule(TopModule, mockLoggerLayer);
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // DeepController should get: [Mw1 (top), Mw2 (middle), Mw3 (deep)]
      const middleware = module.getModuleMiddleware(DeepController);
      expect(middleware).toHaveLength(3);
      expect(typeof middleware[0]).toBe('function');
      expect(typeof middleware[1]).toBe('function');
      expect(typeof middleware[2]).toBe('function');
    });
  });

  describe('one instance per application (WI-233)', () => {
    const { Global, clearGlobalModules } = require('../decorators/decorators');
    const { clearGlobalServicesRegistry, createGlobalScope } = require('./module');

    beforeEach(() => {
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    afterEach(() => {
      clearGlobalModules();
      clearGlobalServicesRegistry();
    });

    const buildFixture = (makeGlobal: boolean) => {
      let constructed = 0;
      let inits = 0;
      let destroys = 0;

      @Service()
      class Shared {
        constructor() {
          constructed++;
        }

        async onModuleInit(): Promise<void> {
          inits++;
        }

        async onModuleDestroy(): Promise<void> {
          destroys++;
        }
      }

      @Module({ providers: [Shared], exports: [Shared] })
      class SharedModule {}
      if (makeGlobal) {
        Global()(SharedModule);
      }

      @Service()
      class Consumer {
        constructor(public shared: Shared) {}
      }

      return {
        Shared,
        SharedModule,
        Consumer,
        count: () => constructed,
        inits: () => inits,
        destroys: () => destroys,
      };
    };

    test('three importers of one module share ONE instance', async () => {
      const {
        Shared, SharedModule, Consumer, count, inits,
      } = buildFixture(false);

      @Module({ imports: [SharedModule], providers: [Consumer], exports: [Consumer] })
      class One {}

      @Module({ imports: [SharedModule], providers: [Consumer], exports: [Consumer] })
      class Two {}

      @Module({ imports: [SharedModule, One, Two], providers: [Consumer] })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      await Effect.runPromise(module.setup() as Effect.Effect<unknown, never, never>);

      // Pre-fix: one instance per importer — for CacheService that was 3 stores, for
      // DrizzleService 3 connection pools, and no state in common.
      expect(count()).toBe(1);
      expect(module.getServiceByClass(Shared as never)).toBeInstanceOf(Shared);

      await module.callOnApplicationInit();
      expect(inits()).toBeLessThanOrEqual(1);
    });

    test('lifecycle hooks fire once, not once per importer', async () => {
      const {
        SharedModule, Consumer, destroys,
      } = buildFixture(false);

      @Module({ imports: [SharedModule], providers: [Consumer], exports: [Consumer] })
      class One {}

      @Module({ imports: [SharedModule], providers: [Consumer], exports: [Consumer] })
      class Two {}

      @Module({ imports: [One, Two] })
      class RootModule {}

      const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      await module.callOnModuleDestroy();

      expect(destroys()).toBe(1);
    });

    test('visibility still differs between global and non-global, instance count does not', () => {
      for (const makeGlobal of [true, false]) {
        clearGlobalModules();
        clearGlobalServicesRegistry();

        const {
          Shared, SharedModule, Consumer, count,
        } = buildFixture(makeGlobal);

        // A module that does NOT import it.
        @Module({ providers: [Consumer] })
        class Detached {}

        @Module({ imports: [SharedModule, Detached] })
        class RootModule {}

        if (makeGlobal) {
          const module = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
          const detached = (module as any).childModules.find((c: any) => c.getServiceByClass(Consumer as never));

          expect(detached.getServiceByClass(Consumer as never).shared).toBeInstanceOf(Shared);
        } else {
          expect(() => new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope()))
            .toThrow(/Could not resolve dependency/);
        }

        // Either way: never more than one instance.
        expect(count()).toBeLessThanOrEqual(1);
      }
    });

    test('two applications each build their own instance', () => {
      const { SharedModule, count } = buildFixture(false);

      @Module({ imports: [SharedModule] })
      class RootModule {}

      const a = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());
      const b = new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      // Sharing is per APPLICATION, not per process — WI-187 must not regress.
      expect(a).not.toBe(b);
      expect(count()).toBe(2);
    });

    test('a sibling reaching the module first does not produce a second copy', () => {
      const { SharedModule, count } = buildFixture(false);

      // The shape that produced 5 instances when the publish happened in the importer
      // rather than in the module itself: a descendant of import #1 reaches the same
      // module as import #2.
      @Module({ imports: [SharedModule] })
      class Deep {}

      @Module({ imports: [Deep] })
      class Branch {}

      @Module({ imports: [Branch, SharedModule] })
      class RootModule {}

      new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(count()).toBe(1);
    });

    test('a cyclic graph still yields one instance', () => {
      const { SharedModule, count } = buildFixture(false);

      const ModuleA = class {};
      const ModuleB = class {};
      Object.defineProperty(ModuleA, 'name', { value: 'CycleA' });
      Object.defineProperty(ModuleB, 'name', { value: 'CycleB' });
      Module({ imports: [SharedModule, ModuleB] })(ModuleA as never);
      Module({ imports: [SharedModule] })(ModuleB as never);

      @Module({ imports: [ModuleA as never] })
      class RootModule {}

      new OneBunModule(RootModule, mockLoggerLayer, undefined, undefined, undefined, createGlobalScope());

      expect(count()).toBe(1);
    });
  });
  // Interceptors are resolved once per REGISTRATION SITE — per route on HTTP, per handler on
  // WebSocket, per subscription on the queue — so the shared resolver is where "one instance per
  // application" has to hold. Every transport reaches it through this method.
  describe('resolveInterceptors shares one instance per class', () => {
    test('returns the same bound function for repeated registration sites', () => {
      let constructed = 0;

      class SharedInterceptor {
        constructor() {
          constructed += 1;
        }

        async intercept(_ctx: any, next: () => any): Promise<any> {
          return await next();
        }
      }

      @Module({})
      class InterceptorModule {}

      const module = new OneBunModule(InterceptorModule, mockLoggerLayer);

      const [first] = (module as any).resolveInterceptors([SharedInterceptor]);
      const [second] = (module as any).resolveInterceptors([SharedInterceptor]);

      expect(constructed).toBe(1);
      expect(second).toBe(first);
    });

    test('passes an instance through without caching it', () => {
      const first = { intercept: async (_ctx: any, next: () => any) => await next() };
      const second = { intercept: async (_ctx: any, next: () => any) => await next() };

      @Module({})
      class InstanceInterceptorModule {}

      const module = new OneBunModule(InstanceInterceptorModule, mockLoggerLayer);

      const [boundFirst] = (module as any).resolveInterceptors([first]);
      const [boundSecond] = (module as any).resolveInterceptors([second]);

      expect(boundFirst).not.toBe(boundSecond);
    });
  });
});
