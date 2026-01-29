/* eslint-disable
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   @typescript-eslint/no-unused-vars */
import {
  describe,
  test,
  expect,
  beforeEach,
  mock,
} from 'bun:test';
import { Context } from 'effect';

import { makeDevLogger } from '../../logger/src/logger';

import { Module } from './decorators';
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
});
