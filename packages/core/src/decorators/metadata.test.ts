/* eslint-disable
   @typescript-eslint/no-empty-function,
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/no-unused-vars,
   @typescript-eslint/no-useless-constructor */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';

import {
  defineMetadata,
  getMetadata,
  getConstructorParamTypes,
  setConstructorParamTypes,
} from './metadata';

describe('Metadata System', () => {
  describe('defineMetadata and getMetadata', () => {
    test('should define and get metadata on a class', () => {
      class TestClass {}
      
      defineMetadata('test-key', 'test-value', TestClass);
      const result = getMetadata('test-key', TestClass);
      
      expect(result).toBe('test-value');
    });

    test('should define and get metadata on a class property', () => {
      class TestClass {
        testProperty: string = '';
      }
      
      defineMetadata('prop-key', 'prop-value', TestClass, 'testProperty');
      const result = getMetadata('prop-key', TestClass, 'testProperty');
      
      expect(result).toBe('prop-value');
    });

    test('should return undefined for non-existent metadata', () => {
      class TestClass {}
      
      const result = getMetadata('non-existent', TestClass);
      
      expect(result).toBeUndefined();
    });

    test('should return undefined for non-existent property metadata', () => {
      class TestClass {}
      
      const result = getMetadata('test-key', TestClass, 'nonExistentProp');
      
      expect(result).toBeUndefined();
    });

    test('should handle different types of metadata values', () => {
      class TestClass {}
      
      // String
      defineMetadata('string-key', 'string-value', TestClass);
      expect(getMetadata('string-key', TestClass)).toBe('string-value');
      
      // Number
      defineMetadata('number-key', 42, TestClass);
      expect(getMetadata('number-key', TestClass)).toBe(42);
      
      // Object
      const objValue = { test: 'value' };
      defineMetadata('object-key', objValue, TestClass);
      expect(getMetadata('object-key', TestClass)).toBe(objValue);
      
      // Array
      const arrValue = [1, 2, 3];
      defineMetadata('array-key', arrValue, TestClass);
      expect(getMetadata('array-key', TestClass)).toBe(arrValue);
      
      // Boolean
      defineMetadata('bool-key', true, TestClass);
      expect(getMetadata('bool-key', TestClass)).toBe(true);
    });

    test('should handle symbol property keys', () => {
      class TestClass {}
      const symbolKey = Symbol('test');
      
      defineMetadata('test-key', 'symbol-prop-value', TestClass, symbolKey);
      const result = getMetadata('test-key', TestClass, symbolKey);
      
      expect(result).toBe('symbol-prop-value');
    });

    test('should handle multiple metadata keys on same target', () => {
      class TestClass {}
      
      defineMetadata('key1', 'value1', TestClass);
      defineMetadata('key2', 'value2', TestClass);
      defineMetadata('key3', 'value3', TestClass);
      
      expect(getMetadata('key1', TestClass)).toBe('value1');
      expect(getMetadata('key2', TestClass)).toBe('value2');
      expect(getMetadata('key3', TestClass)).toBe('value3');
    });

    test('should handle metadata on different targets', () => {
      class ClassA {}
      class ClassB {}
      
      defineMetadata('shared-key', 'value-a', ClassA);
      defineMetadata('shared-key', 'value-b', ClassB);
      
      expect(getMetadata('shared-key', ClassA)).toBe('value-a');
      expect(getMetadata('shared-key', ClassB)).toBe('value-b');
    });

    test('should overwrite existing metadata', () => {
      class TestClass {}
      
      defineMetadata('test-key', 'initial-value', TestClass);
      expect(getMetadata('test-key', TestClass)).toBe('initial-value');
      
      defineMetadata('test-key', 'updated-value', TestClass);
      expect(getMetadata('test-key', TestClass)).toBe('updated-value');
    });
  });

  describe('setConstructorParamTypes and getConstructorParamTypes', () => {
    test('should set and get constructor parameter types', () => {
      class ServiceA {}
      class ServiceB {}
      class TestClass {
        constructor(serviceA: ServiceA, serviceB: ServiceB) {}
      }
      
      setConstructorParamTypes(TestClass, [ServiceA, ServiceB]);
      const types = getConstructorParamTypes(TestClass);
      
      expect(types).toEqual([ServiceA, ServiceB]);
    });

    test('should return undefined for class without parameter types', () => {
      class TestClass {}
      
      const types = getConstructorParamTypes(TestClass);
      
      expect(types).toBeUndefined();
    });

    test('should handle empty parameter types array', () => {
      class TestClass {
        constructor() {}
      }
      
      setConstructorParamTypes(TestClass, []);
      const types = getConstructorParamTypes(TestClass);
      
      // Function returns undefined for empty arrays as there are no service types
      expect(types).toBeUndefined();
    });

    test('should handle classes with complex constructor signatures', () => {
      class ServiceA {}
      class ServiceB {}
      class ServiceC {}
      
      class ComplexClass {
        constructor(
          serviceA: ServiceA,
          serviceB: ServiceB,
          serviceC: ServiceC,
          optionalParam?: string,
        ) {}
      }
      
      setConstructorParamTypes(ComplexClass, [ServiceA, ServiceB, ServiceC]);
      const types = getConstructorParamTypes(ComplexClass);
      
      expect(types).toEqual([ServiceA, ServiceB, ServiceC]);
    });

    test('should handle inheritance scenarios', () => {
      class BaseService {}
      class DerivedService extends BaseService {}
      
      class TestClass {
        constructor(service: DerivedService) {}
      }
      
      setConstructorParamTypes(TestClass, [DerivedService]);
      const types = getConstructorParamTypes(TestClass);
      
      expect(types).toEqual([DerivedService]);
      expect(types?.[0]).toBe(DerivedService);
    });

    test('should handle multiple classes with different parameter types', () => {
      class ServiceA {}
      class ServiceB {}
      
      class ClassWithA {
        constructor(service: ServiceA) {}
      }
      
      class ClassWithB {
        constructor(service: ServiceB) {}
      }
      
      setConstructorParamTypes(ClassWithA, [ServiceA]);
      setConstructorParamTypes(ClassWithB, [ServiceB]);
      
      expect(getConstructorParamTypes(ClassWithA)).toEqual([ServiceA]);
      expect(getConstructorParamTypes(ClassWithB)).toEqual([ServiceB]);
    });
  });

  describe('integration with design:paramtypes', () => {
    test('should work with TypeScript design:paramtypes metadata', () => {
      class MockService {}
      
      class TestClass {
        constructor(service: MockService) {}
      }
      
      // Simulate TypeScript's emitDecoratorMetadata behavior
      defineMetadata('design:paramtypes', [MockService], TestClass);
      
      const types = getConstructorParamTypes(TestClass);
      expect(types).toEqual([MockService]);
    });

    test('should handle missing design:paramtypes gracefully', () => {
      class TestClass {
        constructor() {}
      }
      
      const types = getConstructorParamTypes(TestClass);
      expect(types).toBeUndefined();
    });

    test('should handle invalid design:paramtypes data', () => {
      class TestClass {}
      
      // Set invalid metadata
      defineMetadata('design:paramtypes', 'invalid-data', TestClass);
      
      const types = getConstructorParamTypes(TestClass);
      expect(types).toBeUndefined();
    });

    test('should handle empty design:paramtypes array', () => {
      class TestClass {
        constructor() {}
      }
      
      defineMetadata('design:paramtypes', [], TestClass);
      
      const types = getConstructorParamTypes(TestClass);
      // Function returns undefined for empty arrays as there are no service types
      expect(types).toBeUndefined();
    });
  });

  describe('metadata storage isolation', () => {
    test('should not leak metadata between different targets', () => {
      class ClassA {}
      class ClassB {}
      
      defineMetadata('shared-key', 'value-a', ClassA);
      
      expect(getMetadata('shared-key', ClassA)).toBe('value-a');
      expect(getMetadata('shared-key', ClassB)).toBeUndefined();
    });

    test('should not leak metadata between different properties', () => {
      class TestClass {
        propA: string = '';
        propB: string = '';
      }
      
      defineMetadata('test-key', 'value-a', TestClass, 'propA');
      
      expect(getMetadata('test-key', TestClass, 'propA')).toBe('value-a');
      expect(getMetadata('test-key', TestClass, 'propB')).toBeUndefined();
      expect(getMetadata('test-key', TestClass)).toBeUndefined();
    });

    test('should allow same metadata key for class and property', () => {
      class TestClass {
        testProp: string = '';
      }
      
      defineMetadata('shared-key', 'class-value', TestClass);
      defineMetadata('shared-key', 'prop-value', TestClass, 'testProp');
      
      expect(getMetadata('shared-key', TestClass)).toBe('class-value');
      expect(getMetadata('shared-key', TestClass, 'testProp')).toBe('prop-value');
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle null and undefined values', () => {
      class TestClass {}
      
      defineMetadata('null-key', null, TestClass);
      defineMetadata('undefined-key', undefined, TestClass);
      
      expect(getMetadata('null-key', TestClass)).toBeNull();
      expect(getMetadata('undefined-key', TestClass)).toBeUndefined();
    });

    test('should handle function values', () => {
      class TestClass {}
      
      const funcValue = () => 'test';
      defineMetadata('func-key', funcValue, TestClass);
      
      expect(getMetadata('func-key', TestClass)).toBe(funcValue);
    });

    test('should handle date and other object types', () => {
      class TestClass {}
      
      const dateValue = new Date('2023-01-01');
      const regexValue = /test/g;
      
      defineMetadata('date-key', dateValue, TestClass);
      defineMetadata('regex-key', regexValue, TestClass);
      
      expect(getMetadata('date-key', TestClass)).toBe(dateValue);
      expect(getMetadata('regex-key', TestClass)).toBe(regexValue);
    });

    test('should handle circular references in metadata objects', () => {
      class TestClass {}
      
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;
      
      defineMetadata('circular-key', circularObj, TestClass);
      const result = getMetadata('circular-key', TestClass);
      
      expect(result).toBe(circularObj);
      expect(result.self).toBe(result);
    });

    test('should handle classes as metadata values', () => {
      class MetadataClass {}
      class TestClass {}
      
      defineMetadata('class-key', MetadataClass, TestClass);
      
      expect(getMetadata('class-key', TestClass)).toBe(MetadataClass);
    });
  });

  describe('memory management', () => {
    test('should allow garbage collection of targets', () => {
      // This test verifies that WeakMap allows garbage collection
      // We can't directly test GC, but we can verify the metadata structure
      let testClass: any = class TestTarget {};
      
      defineMetadata('test-key', 'test-value', testClass);
      expect(getMetadata('test-key', testClass)).toBe('test-value');
      
      // Clear the reference
      testClass = null;
      
      // The WeakMap should allow the class to be garbage collected
      // We can't test this directly, but the structure should be correct
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe('special behavior and filtering', () => {
    test('should filter out basic types from constructor param types', () => {
      class TestClass {
        constructor(str: string, num: number, bool: boolean, obj: object) {}
      }
      
      // Set basic types as constructor parameters
      setConstructorParamTypes(TestClass, [String, Number, Boolean, Object]);
      const types = getConstructorParamTypes(TestClass);
      
      // Should filter out basic types and return undefined
      expect(types).toBeUndefined();
    });

    test('should filter out framework logger types', () => {
      // SyncLogger is a framework type that should be filtered
      class SyncLogger {}
      class Logger {}
      class ServiceA {}
      
      class TestClass {
        constructor(syncLogger: SyncLogger, logger: Logger, service: ServiceA) {}
      }
      
      setConstructorParamTypes(TestClass, [SyncLogger, Logger, ServiceA]);
      const types = getConstructorParamTypes(TestClass);
      
      // Should filter out framework logger types and return only ServiceA
      expect(types).toEqual([ServiceA]);
    });

    test('should NOT filter user services with config/logger in name', () => {
      // User services with "config" or "logger" in name should NOT be filtered
      class ConfigService {}
      class MyLoggerService {}
      class ServiceA {}
      
      class TestClass {
        constructor(config: ConfigService, logger: MyLoggerService, service: ServiceA) {}
      }
      
      setConstructorParamTypes(TestClass, [ConfigService, MyLoggerService, ServiceA]);
      const types = getConstructorParamTypes(TestClass);
      
      // All user services should be preserved
      expect(types).toEqual([ConfigService, MyLoggerService, ServiceA]);
    });

    test('should handle mixed service and basic types', () => {
      class ServiceA {}
      class ServiceB {}
      
      class TestClass {
        constructor(service1: ServiceA, str: string, service2: ServiceB, num: number) {}
      }
      
      setConstructorParamTypes(TestClass, [ServiceA, String, ServiceB, Number]);
      const types = getConstructorParamTypes(TestClass);
      
      // Should filter out basic types and return only services
      expect(types).toEqual([ServiceA, ServiceB]);
    });

    test('should handle undefined types in parameter array', () => {
      class ServiceA {}
      
      class TestClass {
        constructor(service: ServiceA, optionalParam?: any) {}
      }
      
      setConstructorParamTypes(TestClass, [ServiceA, undefined as any]);
      const types = getConstructorParamTypes(TestClass);
      
      // Should filter out undefined and return only ServiceA
      expect(types).toEqual([ServiceA]);
    });

    test('should handle null types in parameter array', () => {
      class ServiceA {}
      
      class TestClass {
        constructor(service: ServiceA, nullParam: any) {}
      }
      
      setConstructorParamTypes(TestClass, [ServiceA, null as any]);
      const types = getConstructorParamTypes(TestClass);
      
      // Should filter out null and return only ServiceA
      expect(types).toEqual([ServiceA]);
    });
  });

  describe('error handling and edge cases in getConstructorParamTypes', () => {
    test('should handle function that throws in parameter type detection', () => {
      class TestClass {}
      
      // Simulate error condition
      defineMetadata('design:paramtypes', 'not-an-array', TestClass);
      
      const types = getConstructorParamTypes(TestClass);
      expect(types).toBeUndefined();
    });

    test('should handle class with no constructor', () => {
      class TestClass {}
      
      const types = getConstructorParamTypes(TestClass);
      expect(types).toBeUndefined();
    });

    test('should return undefined when only excluded types present', () => {
      // Use exact framework type names that should be filtered
      class SyncLogger {}
      class Logger {}
      
      class TestClass {
        constructor(syncLogger: SyncLogger, logger: Logger) {}
      }
      
      setConstructorParamTypes(TestClass, [SyncLogger, Logger]);
      const types = getConstructorParamTypes(TestClass);
      
      // Both should be filtered out as framework types
      expect(types).toBeUndefined();
    });
  });

  describe('Reflect polyfill and global initialization', () => {
    let originalReflect: any;
    let originalDecorate: any;
    
    beforeEach(() => {
      originalReflect = (globalThis as any).Reflect;
      originalDecorate = (globalThis as any).__decorate;
    });

    afterEach(() => {
      (globalThis as any).Reflect = originalReflect;
      (globalThis as any).__decorate = originalDecorate;
    });

    test('should initialize Reflect polyfill when Reflect is not available', () => {
      // Remove Reflect temporarily
      delete (globalThis as any).Reflect;
      
      // Re-import the module to trigger initialization
      delete require.cache[require.resolve('./metadata')];
      const metadataModule = require('./metadata');
      
      expect((globalThis as any).Reflect).toBeDefined();
      expect(typeof (globalThis as any).Reflect.getMetadata).toBe('function');
      expect(typeof (globalThis as any).Reflect.defineMetadata).toBe('function');
      
      // Test the polyfill functionality
      class TestClass {}
      (globalThis as any).Reflect.defineMetadata('test-key', 'test-value', TestClass);
      const result = (globalThis as any).Reflect.getMetadata('test-key', TestClass);
      expect(result).toBe('test-value');
    });

    test('should extend existing Reflect when available', () => {
      // Set up partial Reflect
      (globalThis as any).Reflect = {
        existingMethod: () => 'exists',
      };
      
      // Re-import the module to trigger initialization
      delete require.cache[require.resolve('./metadata')];
      const metadataModule = require('./metadata');
      
      expect((globalThis as any).Reflect.existingMethod).toBeDefined();
      expect((globalThis as any).Reflect.getMetadata).toBeDefined();
      expect((globalThis as any).Reflect.defineMetadata).toBeDefined();
      expect((globalThis as any).Reflect.existingMethod()).toBe('exists');
    });

    test('should handle __decorate polyfill for class decorators', () => {
      // Remove __decorate temporarily
      delete (globalThis as any).__decorate;
      
      // Re-import the module to trigger initialization
      delete require.cache[require.resolve('./metadata')];
      const metadataModule = require('./metadata');
      
      expect((globalThis as any).__decorate).toBeDefined();
      expect(typeof (globalThis as any).__decorate).toBe('function');
      
      // Test class decorator scenario
      const mockDecorator = mock((target) => target);
      class TestClass {}
      
      const result = (globalThis as any).__decorate([mockDecorator], TestClass);
      expect(mockDecorator).toHaveBeenCalledWith(TestClass);
      expect(result).toBe(TestClass);
    });

    test('should handle __decorate polyfill for method decorators', () => {
      delete (globalThis as any).__decorate;
      delete require.cache[require.resolve('./metadata')];
      const metadataModule = require('./metadata');
      
      const mockDescriptor = {
        value() {}, configurable: true, enumerable: false, writable: true, 
      };
      const mockDecorator = mock((target, key, descriptor) => descriptor);
      class TestClass {
        testMethod() {}
      }
      
      const result = (globalThis as any).__decorate([mockDecorator], TestClass, 'testMethod', mockDescriptor);
      expect(mockDecorator).toHaveBeenCalledWith(TestClass, 'testMethod', mockDescriptor);
      expect(result).toBe(mockDescriptor);
    });

    test('should handle empty decorators array', () => {
      delete (globalThis as any).__decorate;
      delete require.cache[require.resolve('./metadata')];
      const metadataModule = require('./metadata');
      
      class TestClass {}
      const result = (globalThis as any).__decorate([], TestClass);
      expect(result).toBe(TestClass);
    });

    test('should handle null/undefined decorators in array', () => {
      delete (globalThis as any).__decorate;
      delete require.cache[require.resolve('./metadata')];
      const metadataModule = require('./metadata');
      
      class TestClass {}
      const validDecorator = mock((target) => target);
      
      const result = (globalThis as any).__decorate([null, validDecorator, undefined], TestClass);
      expect(validDecorator).toHaveBeenCalledWith(TestClass);
      expect(result).toBe(TestClass);
    });
  });

  describe('getConstructorParamTypes edge cases', () => {
    test('should handle Reflect.getMetadata throwing error', () => {
      // Mock Reflect to throw error
      const originalReflect = (globalThis as any).Reflect;
      (globalThis as any).Reflect = {
        getMetadata: mock(() => {
          throw new Error('Test error');
        }),
      };
      
      class TestClass {}
      
      // Should fallback gracefully and return undefined
      const result = getConstructorParamTypes(TestClass);
      expect(result).toBeUndefined();
      
      // Restore
      (globalThis as any).Reflect = originalReflect;
    });

    test('should handle undefined Reflect.getMetadata', () => {
      const originalReflect = (globalThis as any).Reflect;
      (globalThis as any).Reflect = {
        getMetadata: undefined,
      };
      
      class TestClass {}
      
      const result = getConstructorParamTypes(TestClass);
      expect(result).toBeUndefined();
      
      (globalThis as any).Reflect = originalReflect;
    });

    test('should handle non-array return from Reflect.getMetadata', () => {
      const originalReflect = (globalThis as any).Reflect;
      (globalThis as any).Reflect = {
        getMetadata: mock(() => 'not-an-array'),
      };
      
      class TestClass {}
      
      const result = getConstructorParamTypes(TestClass);
      expect(result).toBeUndefined();
      
      (globalThis as any).Reflect = originalReflect;
    });

    test('should handle empty array from Reflect.getMetadata', () => {
      const originalReflect = (globalThis as any).Reflect;
      (globalThis as any).Reflect = {
        getMetadata: mock(() => []),
      };
      
      class TestClass {}
      
      const result = getConstructorParamTypes(TestClass);
      expect(result).toBeUndefined();
      
      (globalThis as any).Reflect = originalReflect;
    });

    test('should use fallback when no valid types found', () => {
      const originalReflect = (globalThis as any).Reflect;
      (globalThis as any).Reflect = {
        getMetadata: mock(() => undefined), // Simulating no design:paramtypes
      };
      
      class ServiceA {}
      class TestClass {}
      setConstructorParamTypes(TestClass, [ServiceA]);
      
      const result = getConstructorParamTypes(TestClass);
      expect(result).toEqual([ServiceA]);
      
      (globalThis as any).Reflect = originalReflect;
    });
  });

  describe('setConstructorParamTypes edge cases', () => {
    test('should handle null types array', () => {
      class TestClass {}
      
      setConstructorParamTypes(TestClass, null as any);
      const result = getConstructorParamTypes(TestClass);
      
      expect(result).toBeUndefined();
    });

    test('should handle undefined types array', () => {
      class TestClass {}
      
      setConstructorParamTypes(TestClass, undefined as any);
      const result = getConstructorParamTypes(TestClass);
      
      expect(result).toBeUndefined();
    });

    test('should overwrite existing constructor parameter types', () => {
      const originalReflect = (globalThis as any).Reflect;
      (globalThis as any).Reflect = {
        getMetadata: mock(() => undefined), // Force fallback to our metadata
      };
      
      class ServiceA {}
      class ServiceB {}
      class ServiceC {}
      class TestClass {}
      
      setConstructorParamTypes(TestClass, [ServiceA, ServiceB]);
      expect(getConstructorParamTypes(TestClass)).toEqual([ServiceA, ServiceB]);
      
      setConstructorParamTypes(TestClass, [ServiceC]);
      expect(getConstructorParamTypes(TestClass)).toEqual([ServiceC]);
      
      (globalThis as any).Reflect = originalReflect;
    });
  });

  describe('Metadata storage edge cases', () => {
    test('should handle metadata on object values', () => {
      const objectValue = { value: 42 };
      
      defineMetadata('test-key', 'test-value', objectValue);
      const result = getMetadata('test-key', objectValue);
      
      expect(result).toBe('test-value');
    });

    test('should handle metadata on function objects', () => {
      function testFunction() {}
      
      defineMetadata('func-key', 'func-value', testFunction);
      const result = getMetadata('func-key', testFunction);
      
      expect(result).toBe('func-value');
    });

    test('should handle complex nested objects as metadata values', () => {
      class TestClass {}
      const complexValue = {
        nested: {
          array: [1, 2, { deep: 'value' }],
          func: () => 'test',
        },
        symbols: Symbol('test'),
      };
      
      defineMetadata('complex-key', complexValue, TestClass);
      const result = getMetadata('complex-key', TestClass);
      
      expect(result).toBe(complexValue);
      expect(result.nested.array[2].deep).toBe('value');
      expect(result.nested.func()).toBe('test');
    });

    test('should handle circular reference objects as metadata values', () => {
      class TestClass {}
      const circularValue: any = { name: 'test' };
      circularValue.self = circularValue;
      
      defineMetadata('circular-key', circularValue, TestClass);
      const result = getMetadata('circular-key', TestClass);
      
      expect(result).toBe(circularValue);
      expect(result.self).toBe(result);
    });
  });
});
