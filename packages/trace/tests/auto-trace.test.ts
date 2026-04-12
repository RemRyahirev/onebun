/* eslint-disable @typescript-eslint/no-explicit-any, jest/unbound-method */
import {
  describe,
  test,
  expect,
} from 'bun:test';

import type { TraceFilterOptions } from '../src/auto-trace';

import {
  applyAutoTrace,
  shouldAutoTrace,
  TraceAll,
  NoTrace,
  ALREADY_TRACED,
  NO_TRACE,
  TRACE_ALL,
} from '../src/auto-trace';


// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

class TestService {
  async findAll() {
    return ['item1', 'item2'];
  }

  async create(data: string) {
    return { id: '1', data };
  }

  syncMethod() {
    return 'sync';
  }

  async throwingMethod(): Promise<never> {
    throw new Error('test error');
  }

  // Excluded lifecycle methods
  async onModuleInit() {
    return 'init';
  }

  async onApplicationInit() {
    return 'appInit';
  }

  async onModuleDestroy() {
    return 'destroy';
  }

  // Excluded base methods
  async initializeService() {
    return 'initService';
  }

  async success() {
    return 'success';
  }

  async error() {
    return 'error';
  }
}

class ServiceWithGetter {
  private _value = 42;

  get value() {
    return this._value;
  }

  set value(v: number) {
    this._value = v;
  }

  async normalMethod() {
    return 'normal';
  }
}

class ServiceWithAlreadyTraced {
  async alreadyTraced() {
    return 'already';
  }

  async notYetTraced() {
    return 'not yet';
  }
}

(ServiceWithAlreadyTraced.prototype.alreadyTraced as any)[ALREADY_TRACED] = true;

class ServiceWithNoTraceMethod {
  async traceable() {
    return 'traceable';
  }

  async noTrace() {
    return 'noTrace';
  }
}

(ServiceWithNoTraceMethod.prototype.noTrace as any)[NO_TRACE] = true;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auto-trace', () => {
  describe('applyAutoTrace', () => {
    describe('basics', () => {
      test('should wrap async methods on prototype', () => {
        const instance = new TestService();
        const originalFindAll = TestService.prototype.findAll;
        const originalCreate = TestService.prototype.create;

        applyAutoTrace(instance, 'TestService');

        expect(TestService.prototype.findAll).not.toBe(originalFindAll);
        expect(TestService.prototype.create).not.toBe(originalCreate);
        expect((TestService.prototype.findAll as any)[ALREADY_TRACED]).toBe(true);
        expect((TestService.prototype.create as any)[ALREADY_TRACED]).toBe(true);
      });

      test('should return correct result from wrapped async method', async () => {
        class SimpleService {
          async getData() {
            return { success: true };
          }
        }

        const instance = new SimpleService();
        applyAutoTrace(instance, 'SimpleService');

        const result = await instance.getData();
        expect(result).toEqual({ success: true });
      });

      test('should pass arguments through to wrapped method', async () => {
        class ArgService {
          async process(a: number, b: string) {
            return `${a}-${b}`;
          }
        }

        const instance = new ArgService();
        applyAutoTrace(instance, 'ArgService');

        const result = await instance.process(1, 'hello');
        expect(result).toBe('1-hello');
      });

      test('should propagate errors from wrapped method', async () => {
        class ErrorService {
          async fail() {
            throw new Error('test error');
          }
        }

        const instance = new ErrorService();
        applyAutoTrace(instance, 'ErrorService');

        await expect(instance.fail()).rejects.toThrow('test error');
      });

      test('should preserve `this` context in wrapped method', async () => {
        class ContextService {
          name = 'context';

          async getName() {
            return this.name;
          }
        }

        const instance = new ContextService();
        applyAutoTrace(instance, 'ContextService');

        const result = await instance.getName();
        expect(result).toBe('context');
      });
    });

    describe('asyncOnly filter (default: true)', () => {
      test('should NOT wrap sync methods by default (asyncOnly: true)', () => {
        class MixedService {
          syncMethod() {
            return 'sync';
          }

          async asyncMethod() {
            return 'async';
          }
        }

        const instance = new MixedService();
        const originalSync = MixedService.prototype.syncMethod;

        applyAutoTrace(instance, 'MixedService');

        expect(MixedService.prototype.syncMethod).toBe(originalSync);
        expect((MixedService.prototype.asyncMethod as any)[ALREADY_TRACED]).toBe(true);
      });

      test('should wrap sync methods when asyncOnly: false', () => {
        class MixedService2 {
          syncMethod() {
            return 'sync';
          }

          async asyncMethod() {
            return 'async';
          }
        }

        const instance = new MixedService2();
        const originalSync = MixedService2.prototype.syncMethod;

        applyAutoTrace(instance, 'MixedService2', { asyncOnly: false });

        expect(MixedService2.prototype.syncMethod).not.toBe(originalSync);
        expect((MixedService2.prototype.syncMethod as any)[ALREADY_TRACED]).toBe(true);
        expect((MixedService2.prototype.asyncMethod as any)[ALREADY_TRACED]).toBe(true);
      });
    });

    describe('excluded built-in methods', () => {
      test('should NOT wrap constructor and lifecycle methods', () => {
        const instance = new TestService();
        const originalOnModuleInit = TestService.prototype.onModuleInit;
        const originalOnApplicationInit = TestService.prototype.onApplicationInit;
        const originalOnModuleDestroy = TestService.prototype.onModuleDestroy;
        const originalInitializeService = TestService.prototype.initializeService;
        const originalSuccess = TestService.prototype.success;
        const originalError = TestService.prototype.error;

        applyAutoTrace(instance, 'TestService');

        expect(TestService.prototype.onModuleInit).toBe(originalOnModuleInit);
        expect(TestService.prototype.onApplicationInit).toBe(originalOnApplicationInit);
        expect(TestService.prototype.onModuleDestroy).toBe(originalOnModuleDestroy);
        expect(TestService.prototype.initializeService).toBe(originalInitializeService);
        expect(TestService.prototype.success).toBe(originalSuccess);
        expect(TestService.prototype.error).toBe(originalError);
      });
    });

    describe('getters and setters', () => {
      test('should NOT wrap getters/setters', () => {
        const instance = new ServiceWithGetter();
        applyAutoTrace(instance, 'ServiceWithGetter');

        // Getter/setter should still work normally
        expect(instance.value).toBe(42);
        instance.value = 100;
        expect(instance.value).toBe(100);

        // The async method should be wrapped
        expect((ServiceWithGetter.prototype.normalMethod as any)[ALREADY_TRACED]).toBe(true);
      });
    });

    describe('ALREADY_TRACED symbol', () => {
      test('should NOT wrap methods that already have ALREADY_TRACED', () => {
        const originalAlreadyTraced = ServiceWithAlreadyTraced.prototype.alreadyTraced;

        const instance = new ServiceWithAlreadyTraced();
        applyAutoTrace(instance, 'ServiceWithAlreadyTraced');

        // alreadyTraced should remain unchanged
        expect(ServiceWithAlreadyTraced.prototype.alreadyTraced).toBe(originalAlreadyTraced);
        // notYetTraced should be wrapped
        expect((ServiceWithAlreadyTraced.prototype.notYetTraced as any)[ALREADY_TRACED]).toBe(true);
      });

      test('should set ALREADY_TRACED on wrapped methods', () => {
        class FreshService {
          async doWork() {
            return 'work';
          }
        }

        const instance = new FreshService();
        expect((FreshService.prototype.doWork as any)[ALREADY_TRACED]).toBeUndefined();

        applyAutoTrace(instance, 'FreshService');

        expect((FreshService.prototype.doWork as any)[ALREADY_TRACED]).toBe(true);
      });
    });

    describe('NO_TRACE symbol on method', () => {
      test('should NOT wrap methods with NO_TRACE symbol', () => {
        const originalNoTrace = ServiceWithNoTraceMethod.prototype.noTrace;

        const instance = new ServiceWithNoTraceMethod();
        applyAutoTrace(instance, 'ServiceWithNoTraceMethod');

        expect(ServiceWithNoTraceMethod.prototype.noTrace).toBe(originalNoTrace);
        expect((ServiceWithNoTraceMethod.prototype.traceable as any)[ALREADY_TRACED]).toBe(true);
      });
    });

    describe('excludeMethods filter', () => {
      test('should respect excludeMethods option', () => {
        class FilterService {
          async included() {
            return 'included';
          }

          async excluded() {
            return 'excluded';
          }

          async alsoExcluded() {
            return 'alsoExcluded';
          }
        }

        const instance = new FilterService();
        const originalExcluded = FilterService.prototype.excluded;
        const originalAlsoExcluded = FilterService.prototype.alsoExcluded;

        applyAutoTrace(instance, 'FilterService', {
          excludeMethods: ['excluded', 'alsoExcluded'],
        });

        expect(FilterService.prototype.excluded).toBe(originalExcluded);
        expect(FilterService.prototype.alsoExcluded).toBe(originalAlsoExcluded);
        expect((FilterService.prototype.included as any)[ALREADY_TRACED]).toBe(true);
      });
    });

    describe('edge cases', () => {
      test('should handle null/undefined instance gracefully', () => {
        expect(() => applyAutoTrace(null, 'Null')).not.toThrow();
        expect(() => applyAutoTrace(undefined, 'Undefined')).not.toThrow();
      });

      test('should handle non-object instance gracefully', () => {
        expect(() => applyAutoTrace('string' as any, 'String')).not.toThrow();
        expect(() => applyAutoTrace(42 as any, 'Number')).not.toThrow();
      });

      test('should walk prototype chain and wrap inherited methods', () => {
        class BaseService {
          async baseMethod() {
            return 'base';
          }
        }

        class DerivedService extends BaseService {
          async derivedMethod() {
            return 'derived';
          }
        }

        const instance = new DerivedService();
        applyAutoTrace(instance, 'DerivedService');

        expect((DerivedService.prototype.derivedMethod as any)[ALREADY_TRACED]).toBe(true);
        expect((BaseService.prototype.baseMethod as any)[ALREADY_TRACED]).toBe(true);
      });
    });
  });

  describe('shouldAutoTrace', () => {
    describe('global traceAll flag', () => {
      test('should return true when traceAll is true and no decorators', () => {
        class PlainService {}

        const result = shouldAutoTrace(PlainService, 'PlainService', true);
        expect(result).toBe(true);
      });

      test('should return false when traceAll is false and no decorators', () => {
        class PlainService {}

        const result = shouldAutoTrace(PlainService, 'PlainService', false);
        expect(result).toBe(false);
      });
    });

    describe('@NoTrace on class', () => {
      test('should return false when class has @NoTrace even with traceAll: true', () => {
        @NoTrace()
        class NoTraceService {}

        const result = shouldAutoTrace(NoTraceService, 'NoTraceService', true);
        expect(result).toBe(false);
      });

      test('should return false when class has NO_TRACE symbol set manually', () => {
        class ManualNoTrace {}

        (ManualNoTrace as any)[NO_TRACE] = true;

        const result = shouldAutoTrace(ManualNoTrace, 'ManualNoTrace', true);
        expect(result).toBe(false);
      });
    });

    describe('@TraceAll on class', () => {
      test('should return true when class has @TraceAll even with traceAll: false', () => {
        @TraceAll()
        class TraceAllService {}

        const result = shouldAutoTrace(TraceAllService, 'TraceAllService', false);
        expect(result).toBe(true);
      });

      test('should return true when class has TRACE_ALL symbol set manually', () => {
        class ManualTraceAll {}

        (ManualTraceAll as any)[TRACE_ALL] = true;

        const result = shouldAutoTrace(ManualTraceAll, 'ManualTraceAll', false);
        expect(result).toBe(true);
      });
    });

    describe('class filter: includeClasses', () => {
      test('should include classes matching includeClasses pattern', () => {
        class UserService {}

        const filter: TraceFilterOptions = { includeClasses: ['*Service'] };
        const result = shouldAutoTrace(UserService, 'UserService', true, filter);
        expect(result).toBe(true);
      });

      test('should exclude classes not matching includeClasses pattern', () => {
        class UserController {}

        const filter: TraceFilterOptions = { includeClasses: ['*Service'] };
        const result = shouldAutoTrace(UserController, 'UserController', true, filter);
        expect(result).toBe(false);
      });

      test('should match prefix glob pattern', () => {
        class UserService {}

        const filter: TraceFilterOptions = { includeClasses: ['User*'] };
        const result = shouldAutoTrace(UserService, 'UserService', true, filter);
        expect(result).toBe(true);
      });

      test('should match wildcard-only pattern', () => {
        class AnythingAtAll {}

        const filter: TraceFilterOptions = { includeClasses: ['*'] };
        const result = shouldAutoTrace(AnythingAtAll, 'AnythingAtAll', true, filter);
        expect(result).toBe(true);
      });

      test('should match contains glob pattern (*mid*)', () => {
        class MyUserService {}

        const filter: TraceFilterOptions = { includeClasses: ['*User*'] };
        const result = shouldAutoTrace(MyUserService, 'MyUserService', true, filter);
        expect(result).toBe(true);
      });

      test('should match exact class name without globs', () => {
        class ExactMatch {}

        const filter: TraceFilterOptions = { includeClasses: ['ExactMatch'] };
        const result = shouldAutoTrace(ExactMatch, 'ExactMatch', true, filter);
        expect(result).toBe(true);
      });

      test('should not match different exact name', () => {
        class Different {}

        const filter: TraceFilterOptions = { includeClasses: ['ExactMatch'] };
        const result = shouldAutoTrace(Different, 'Different', true, filter);
        expect(result).toBe(false);
      });
    });

    describe('class filter: excludeClasses', () => {
      test('should exclude classes matching excludeClasses pattern', () => {
        class InternalService {}

        const filter: TraceFilterOptions = { excludeClasses: ['Internal*'] };
        const result = shouldAutoTrace(InternalService, 'InternalService', true, filter);
        expect(result).toBe(false);
      });

      test('should include classes not matching excludeClasses pattern', () => {
        class UserService {}

        const filter: TraceFilterOptions = { excludeClasses: ['Internal*'] };
        const result = shouldAutoTrace(UserService, 'UserService', true, filter);
        expect(result).toBe(true);
      });
    });

    describe('combined include + exclude', () => {
      test('should apply both include and exclude filters', () => {
        class UserService {}
        class InternalService {}
        class UserController {}

        const filter: TraceFilterOptions = {
          includeClasses: ['*Service'],
          excludeClasses: ['Internal*'],
        };

        expect(shouldAutoTrace(UserService, 'UserService', true, filter)).toBe(true);
        expect(shouldAutoTrace(InternalService, 'InternalService', true, filter)).toBe(false);
        expect(shouldAutoTrace(UserController, 'UserController', true, filter)).toBe(false);
      });
    });

    describe('@TraceAll with filters', () => {
      test('should respect includeClasses even with @TraceAll', () => {
        @TraceAll()
        class ExcludedByFilter {}

        const filter: TraceFilterOptions = { includeClasses: ['*Service'] };
        const result = shouldAutoTrace(ExcludedByFilter, 'ExcludedByFilter', false, filter);
        expect(result).toBe(false);
      });

      test('should respect excludeClasses even with @TraceAll', () => {
        @TraceAll()
        class InternalService {}

        const filter: TraceFilterOptions = { excludeClasses: ['Internal*'] };
        const result = shouldAutoTrace(InternalService, 'InternalService', false, filter);
        expect(result).toBe(false);
      });
    });
  });

  describe('priority hierarchy', () => {
    test('traceAll: true + @NoTrace on class → class NOT traced', () => {
      @NoTrace()
      class SkippedService {}

      expect(shouldAutoTrace(SkippedService, 'SkippedService', true)).toBe(false);
    });

    test('@TraceAll on class + @NoTrace on method → method NOT traced', () => {
      class HybridService {
        async normalMethod() {
          return 'normal';
        }

        async noTraceMethod() {
          return 'noTrace';
        }
      }

      (HybridService.prototype.noTraceMethod as any)[NO_TRACE] = true;

      const instance = new HybridService();
      const originalNoTrace = HybridService.prototype.noTraceMethod;

      applyAutoTrace(instance, 'HybridService');

      expect(HybridService.prototype.noTraceMethod).toBe(originalNoTrace);
      expect((HybridService.prototype.normalMethod as any)[ALREADY_TRACED]).toBe(true);
    });

    test('method with ALREADY_TRACED is not re-wrapped even with traceAll', () => {
      class PreTracedService {
        async manuallyTraced() {
          return 'manual';
        }

        async autoTraced() {
          return 'auto';
        }
      }

      (PreTracedService.prototype.manuallyTraced as any)[ALREADY_TRACED] = true;
      const originalManual = PreTracedService.prototype.manuallyTraced;

      const instance = new PreTracedService();
      applyAutoTrace(instance, 'PreTracedService');

      // manuallyTraced should remain the original (not re-wrapped)
      expect(PreTracedService.prototype.manuallyTraced).toBe(originalManual);
      // autoTraced should be wrapped
      expect((PreTracedService.prototype.autoTraced as any)[ALREADY_TRACED]).toBe(true);
    });
  });

  describe('TraceAll() decorator', () => {
    test('should set TRACE_ALL symbol on class constructor', () => {
      @TraceAll()
      class DecoratedService {}

      expect((DecoratedService as any)[TRACE_ALL]).toBe(true);
    });

    test('should not modify the class itself', () => {
      class OriginalService {
        value = 42;
      }

      const original = OriginalService;
      TraceAll()(OriginalService);

      expect(OriginalService).toBe(original);
      const instance = new OriginalService();
      expect(instance.value).toBe(42);
    });
  });

  describe('NoTrace() decorator', () => {
    test('should set NO_TRACE on constructor when used as class decorator', () => {
      @NoTrace()
      class NoTraceClass {}

      expect((NoTraceClass as any)[NO_TRACE]).toBe(true);
    });

    test('should set NO_TRACE on descriptor.value when used as method decorator', () => {
      class MethodDecoratorService {
        @NoTrace()
        async skippedMethod() {
          return 'skipped';
        }

        async normalMethod() {
          return 'normal';
        }
      }

      expect((MethodDecoratorService.prototype.skippedMethod as any)[NO_TRACE]).toBe(true);
      expect((MethodDecoratorService.prototype.normalMethod as any)[NO_TRACE]).toBeUndefined();
    });

    test('method with @NoTrace should not be wrapped by applyAutoTrace', () => {
      class DecoratorTestService {
        @NoTrace()
        async protectedMethod() {
          return 'protected';
        }

        async openMethod() {
          return 'open';
        }
      }

      const instance = new DecoratorTestService();
      const originalProtected = DecoratorTestService.prototype.protectedMethod;

      applyAutoTrace(instance, 'DecoratorTestService');

      expect(DecoratorTestService.prototype.protectedMethod).toBe(originalProtected);
      expect((DecoratorTestService.prototype.openMethod as any)[ALREADY_TRACED]).toBe(true);
    });
  });

  describe('symbols', () => {
    test('ALREADY_TRACED should be a well-known symbol', () => {
      expect(ALREADY_TRACED.description).toBe('onebun:traced');
      expect(typeof ALREADY_TRACED).toBe('symbol');
    });

    test('NO_TRACE should be a well-known symbol', () => {
      expect(NO_TRACE.description).toBe('onebun:noTrace');
      expect(typeof NO_TRACE).toBe('symbol');
    });

    test('TRACE_ALL should be a well-known symbol', () => {
      expect(TRACE_ALL.description).toBe('onebun:traceAll');
      expect(typeof TRACE_ALL).toBe('symbol');
    });
  });
});
