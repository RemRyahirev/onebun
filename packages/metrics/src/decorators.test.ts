/* eslint-disable
   @typescript-eslint/no-empty-function,
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/no-unused-vars,
   jest/unbound-method,
   no-console */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { Effect, Layer } from 'effect';
import { register } from 'prom-client';

 
import { useFakeTimers } from '@onebun/core/testing';

import {
  Timed,
  Counted,
  Gauged,
  InjectMetric,
  WithMetrics,
  measureExecutionTime,
} from './decorators';
import { MetricsService, createMetricsService } from './metrics.service';
import { MetricType } from './types';

// Helper to capture console output
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

describe('Metrics Decorators', () => {
  let capturedLogs: string[] = [];
  let capturedWarns: string[] = [];
  let mockMetricsService: any;

  beforeEach(() => {
    // Clear prometheus registry to avoid duplicate metrics
    register.clear();
    
    capturedLogs = [];
    capturedWarns = [];
    
    console.log = (...args: any[]) => {
      capturedLogs.push(args.join(' '));
    };
    
    console.warn = (...args: any[]) => {
      capturedWarns.push(args.join(' '));
    };

    // Mock metrics service
    mockMetricsService = {
      getMetric: mock(() => ({
        observe: mock(() => {}),
        inc: mock(() => {}),
        set: mock(() => {}),
      })),
    };

    // Set global metrics service
    (globalThis as any).__onebunMetricsService = mockMetricsService;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    delete (globalThis as any).__onebunMetricsService;
    register.clear();
  });

  describe('Timed decorator', () => {
    test('should measure execution time for synchronous method', () => {
      class TestService {
        @Timed()
        syncMethod(value: number): number {
          return value * 2;
        }
      }

      const service = new TestService();
      const result = service.syncMethod(5);

      expect(result).toBe(10);
      expect(mockMetricsService.getMetric).toHaveBeenCalled();
    });

    test('should measure execution time for asynchronous method', async () => {
      const timers = useFakeTimers();
      
      class TestService {
        @Timed()
        async asyncMethod(value: number): Promise<number> {
          await new Promise(resolve => setTimeout(resolve, 10));

          return value * 2;
        }
      }

      const service = new TestService();
      const resultPromise = service.asyncMethod(5);
      
      // Advance timers to resolve the setTimeout
      timers.advanceTime(10);
      
      const result = await resultPromise;

      expect(result).toBe(10);
      expect(mockMetricsService.getMetric).toHaveBeenCalled();
      
      timers.restore();
    });

    test('should measure execution time even when method throws', () => {
      class TestService {
        @Timed()
        throwingMethod(): never {
          throw new Error('Test error');
        }
      }

      const service = new TestService();
      expect(() => service.throwingMethod()).toThrow('Test error');
      expect(mockMetricsService.getMetric).toHaveBeenCalled();
    });

    test('should measure execution time even when async method rejects', async () => {
      class TestService {
        @Timed()
        async rejectingMethod(): Promise<never> {
          throw new Error('Async error');
        }
      }

      const service = new TestService();
      await expect(service.rejectingMethod()).rejects.toThrow('Async error');
      expect(mockMetricsService.getMetric).toHaveBeenCalled();
    });

    test('should use custom metric name when provided', () => {
      class TestService {
        @Timed('custom_metric')
        customMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.customMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('custom_metric');
    });

    test('should generate default metric name from class and method', () => {
      class TestService {
        @Timed()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.testMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('TestService_testMethod_duration');
    });

    test('should handle missing metrics service gracefully', () => {
      delete (globalThis as any).__onebunMetricsService;

      class TestService {
        @Timed()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });

    test('should handle metric without observe method', () => {
      mockMetricsService.getMetric = mock(() => ({}));

      class TestService {
        @Timed()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });
  });

  describe('Counted decorator', () => {
    test('should increment counter on method call', () => {
      class TestService {
        @Counted()
        countedMethod(value: number): number {
          return value * 2;
        }
      }

      const service = new TestService();
      const result = service.countedMethod(5);

      expect(result).toBe(10);
      expect(mockMetricsService.getMetric).toHaveBeenCalled();
    });

    test('should use custom metric name when provided', () => {
      class TestService {
        @Counted('custom_counter')
        customMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.customMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('custom_counter');
    });

    test('should generate default counter name from class and method', () => {
      class TestService {
        @Counted()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.testMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('TestService_testMethod_calls_total');
    });

    test('should handle missing metrics service gracefully', () => {
      delete (globalThis as any).__onebunMetricsService;

      class TestService {
        @Counted()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });

    test('should handle metric without inc method', () => {
      mockMetricsService.getMetric = mock(() => ({}));

      class TestService {
        @Counted()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });

    test('should count calls with labels', () => {
      class TestService {
        @Counted('labeled_counter', ['method', 'service'])
        labeledMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.labeledMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('labeled_counter');
    });
  });

  describe('Gauged decorator', () => {
    test('should update gauge after synchronous method execution', () => {
      class TestService {
        value = 100;

        @Gauged('test_gauge', (self) => self.value)
        updateGaugeMethod(): void {
          this.value = 200;
        }
      }

      const service = new TestService();
      service.updateGaugeMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('test_gauge');
    });

    test('should update gauge after asynchronous method execution', async () => {
      const timers = useFakeTimers();

      class TestService {
        value = 100;

        @Gauged('test_gauge', (self) => self.value)
        async updateGaugeMethodAsync(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 10));
          this.value = 200;
        }
      }

      const service = new TestService();
      const resultPromise = service.updateGaugeMethodAsync();

      // Advance timers to resolve the setTimeout
      timers.advanceTime(10);

      await resultPromise;

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('test_gauge');

      timers.restore();
    });

    test('should receive class instance and read its state', () => {
      const mockGauge = { set: mock(() => {}) };
      mockMetricsService.getMetric = mock(() => mockGauge);

      class TestService {
        items: string[] = ['a', 'b', 'c'];

        @Gauged('queue_depth', (self) => self.items.length)
        processItem(): string | undefined {
          return this.items.shift();
        }
      }

      const service = new TestService();
      service.processItem();

      // After shift(), items.length is 2
      expect(mockGauge.set).toHaveBeenCalledWith({}, 2);
    });

    test('should support async getValue callback', async () => {
      const mockGauge = { set: mock(() => {}) };
      mockMetricsService.getMetric = mock(() => mockGauge);

      class TestService {
        @Gauged('async_gauge', async () => {
          await Promise.resolve();

          return 42;
        })
        doWork(): string {
          return 'done';
        }
      }

      const service = new TestService();
      service.doWork();

      // Wait for the async getValue to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockGauge.set).toHaveBeenCalledWith({}, 42);
    });

    test('should handle async getValue with instance access', async () => {
      const mockGauge = { set: mock(() => {}) };
      mockMetricsService.getMetric = mock(() => mockGauge);

      class TestService {
        count = 10;

        @Gauged('async_instance_gauge', async (self) => {
          await Promise.resolve();

          return self.count;
        })
        decrement(): void {
          this.count--;
        }
      }

      const service = new TestService();
      service.decrement();

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockGauge.set).toHaveBeenCalledWith({}, 9);
    });

    test('should handle async getValue rejection gracefully', async () => {
      const warnMock = mock(() => {});

      class TestService {
        logger = { warn: warnMock };

        @Gauged('failing_async_gauge', async () => {
          throw new Error('async error');
        })
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(service.testMethod()).toBe(42);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(warnMock).toHaveBeenCalledWith(
        'Failed to update gauge failing_async_gauge',
        { error: expect.any(Error) },
      );
    });

    test('should handle getValue function throwing error', () => {
      const warnMock = mock(() => {});
      const getValue = () => {
        throw new Error('getValue error');
      };

      class TestService {
        logger = { warn: warnMock };

        @Gauged('test_gauge', getValue)
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.testMethod();

      expect(warnMock).toHaveBeenCalledWith(
        'Failed to update gauge test_gauge',
        { error: expect.any(Error) },
      );
    });

    test('should handle missing metrics service gracefully', () => {
      delete (globalThis as any).__onebunMetricsService;

      class TestService {
        @Gauged('test_gauge', () => 100)
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });

    test('should handle metric without set method', () => {
      mockMetricsService.getMetric = mock(() => ({}));

      class TestService {
        @Gauged('test_gauge', () => 100)
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });
  });

  describe('InjectMetric decorator', () => {
    test('should log metric injection information', () => {
      class TestService {
        @InjectMetric({
          name: 'test_metric',
          help: 'Test metric',
          type: MetricType.COUNTER,
        })
        injectedCounter: any;
      }

      expect(capturedLogs).toContain('Metric test_metric will be injected into TestService.injectedCounter');
    });

    test('should handle complex metric configuration', () => {
      class TestService {
        @InjectMetric({
          name: 'complex_metric',
          help: 'Complex metric with labels',
          type: MetricType.HISTOGRAM,
          labelNames: ['method', 'status'],
          buckets: [0.1, 0.5, 1, 5],
        })
        complexMetric: any;
      }

      expect(capturedLogs).toContain('Metric complex_metric will be injected into TestService.complexMetric');
    });
  });

  describe('WithMetrics decorator', () => {
    test('should apply metrics to class with default options', () => {
      @WithMetrics()
      class TestService {
        getValue(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(service.getValue()).toBe(42);
      expect(capturedLogs).toContain('WithMetrics applied to TestService with prefix: none');
    });

    test('should apply metrics to class with custom prefix', () => {
      @WithMetrics({ prefix: 'custom_' })
      class TestService {
        getValue(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(service.getValue()).toBe(42);
      expect(capturedLogs).toContain('WithMetrics applied to TestService with prefix: custom_');
    });

    test('should preserve original class functionality', () => {
      @WithMetrics({ prefix: 'test_' })
      class TestService {
        private value = 100;

        constructor(initialValue?: number) {
          if (initialValue !== undefined) {
            this.value = initialValue;
          }
        }

        getValue(): number {
          return this.value;
        }

        setValue(newValue: number): void {
          this.value = newValue;
        }
      }

      const service = new TestService(200);
      expect(service.getValue()).toBe(200);
      
      service.setValue(300);
      expect(service.getValue()).toBe(300);
    });
  });

  describe('measureExecutionTime Effect function', () => {
    test('should be defined and exported', () => {
      expect(typeof measureExecutionTime).toBe('function');
      expect(measureExecutionTime).toBeDefined();
    });

    test('should create an Effect that requires MetricsService', () => {
      const testEffect = Effect.succeed(42);
      const measuredEffect = measureExecutionTime('test_metric', testEffect);

      expect(measuredEffect).toBeDefined();
      expect(Effect.isEffect(measuredEffect)).toBe(true);
    });
  });

  describe('WithMetrics class decorator (extended)', () => {
    test('should log initialization with no prefix option', () => {
      @WithMetrics({})
      class EmptyOptionsService {
        run(): string {
          return 'ok';
        }
      }

      const svc = new EmptyOptionsService();
      expect(svc.run()).toBe('ok');
      expect(capturedLogs).toContain('WithMetrics applied to EmptyOptionsService with prefix: none');
    });

    test('should support subclassing the decorated class', () => {
      @WithMetrics({ prefix: 'base_' })
      class BaseService {
        baseMethod(): number {
          return 1;
        }
      }

      class ChildService extends BaseService {
        childMethod(): number {
          return 2;
        }
      }

      const child = new ChildService();
      expect(child.baseMethod()).toBe(1);
      expect(child.childMethod()).toBe(2);
    });

    test('should call constructor logic before logging', () => {
      const order: string[] = [];

      @WithMetrics({ prefix: 'order_' })
      class OrderedService {
        constructor() {
          order.push('constructor');
        }
      }

      new OrderedService();
      // constructor runs first, then WithMetrics logs
      expect(order).toEqual(['constructor']);
      expect(capturedLogs.some(log => log.includes('WithMetrics applied to OrderedService'))).toBe(true);
    });
  });

  describe('measureExecutionTime Effect function (extended)', () => {
    test('should record duration on successful execution', async () => {
      const observeMock = mock(() => {});
      const mockHistogram = { observe: observeMock };
      const mockService: MetricsService = {
        getMetric: mock(() => mockHistogram) as MetricsService['getMetric'],
        getMetrics: async () => '',
        getContentType: () => '',
        recordHttpRequest() {},
        createCounter() {
          throw new Error('not needed'); 
        },
        createGauge() {
          throw new Error('not needed'); 
        },
        createHistogram() {
          throw new Error('not needed'); 
        },
        createSummary() {
          throw new Error('not needed'); 
        },
        clear() {},
        getRegistry() {
          throw new Error('not needed'); 
        },
        startSystemMetricsCollection() {},
        stopSystemMetricsCollection() {},
      };

      const serviceLayer = Layer.succeed(MetricsService, mockService);
      const innerEffect = Effect.succeed(42);
      const measured = measureExecutionTime('my_metric', innerEffect);

      const result = await Effect.runPromise(Effect.provide(measured, serviceLayer));

      expect(result).toBe(42);
      expect(mockService.getMetric).toHaveBeenCalledWith('my_metric');
      expect(observeMock).toHaveBeenCalledWith({}, expect.any(Number));
    });

    test('should record non-negative duration on successful execution', async () => {
      let recordedDuration: number | undefined;
      const mockService: MetricsService = {
        getMetric: mock(() => ({
          observe(_labels: object, duration: number) {
            recordedDuration = duration;
          },
        })) as MetricsService['getMetric'],
        getMetrics: async () => '',
        getContentType: () => '',
        recordHttpRequest() {},
        createCounter() {
          throw new Error('not needed'); 
        },
        createGauge() {
          throw new Error('not needed'); 
        },
        createHistogram() {
          throw new Error('not needed'); 
        },
        createSummary() {
          throw new Error('not needed'); 
        },
        clear() {},
        getRegistry() {
          throw new Error('not needed'); 
        },
        startSystemMetricsCollection() {},
        stopSystemMetricsCollection() {},
      };

      const serviceLayer = Layer.succeed(MetricsService, mockService);
      await Effect.runPromise(Effect.provide(measureExecutionTime('dur_metric', Effect.succeed('x')), serviceLayer));

      expect(recordedDuration).toBeGreaterThanOrEqual(0);
    });

    test('should record error duration on Effect failure and propagate the error', async () => {
      const observeMock = mock(() => {});
      const mockService: MetricsService = {
        getMetric: mock(() => ({ observe: observeMock })) as MetricsService['getMetric'],
        getMetrics: async () => '',
        getContentType: () => '',
        recordHttpRequest() {},
        createCounter() {
          throw new Error('not needed'); 
        },
        createGauge() {
          throw new Error('not needed'); 
        },
        createHistogram() {
          throw new Error('not needed'); 
        },
        createSummary() {
          throw new Error('not needed'); 
        },
        clear() {},
        getRegistry() {
          throw new Error('not needed'); 
        },
        startSystemMetricsCollection() {},
        stopSystemMetricsCollection() {},
      };

      const serviceLayer = Layer.succeed(MetricsService, mockService);
      const failingEffect = Effect.fail(new Error('something went wrong'));
      const measured = measureExecutionTime('err_metric', failingEffect);

      await expect(
        Effect.runPromise(Effect.provide(measured, serviceLayer)),
      ).rejects.toThrow('something went wrong');

      // With Effect.pipe + tapError, error duration IS correctly recorded
      expect(observeMock).toHaveBeenCalledWith({ status: 'error' }, expect.any(Number));
    });

    test('should propagate the original failure cause through Effect channel', async () => {
      const observeMock = mock(() => {});
      const mockService: MetricsService = {
        getMetric: mock(() => ({ observe: observeMock })) as MetricsService['getMetric'],
        getMetrics: async () => '',
        getContentType: () => '',
        recordHttpRequest() {},
        createCounter() {
          throw new Error('not needed'); 
        },
        createGauge() {
          throw new Error('not needed'); 
        },
        createHistogram() {
          throw new Error('not needed'); 
        },
        createSummary() {
          throw new Error('not needed'); 
        },
        clear() {},
        getRegistry() {
          throw new Error('not needed'); 
        },
        startSystemMetricsCollection() {},
        stopSystemMetricsCollection() {},
      };

      const serviceLayer = Layer.succeed(MetricsService, mockService);
      const measured = measureExecutionTime('rethrow_metric', Effect.fail(new Error('original error payload')));

      const caughtError = await Effect.runPromise(
        Effect.provide(measured, serviceLayer),
      ).catch(e => e);

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe('original error payload');
      // Error duration also recorded
      expect(observeMock).toHaveBeenCalledWith({ status: 'error' }, expect.any(Number));
    });

    test('should still succeed when getMetric returns undefined', async () => {
      const mockService: MetricsService = {
        getMetric: mock(() => undefined) as MetricsService['getMetric'],
        getMetrics: async () => '',
        getContentType: () => '',
        recordHttpRequest() {},
        createCounter() {
          throw new Error('not needed'); 
        },
        createGauge() {
          throw new Error('not needed'); 
        },
        createHistogram() {
          throw new Error('not needed'); 
        },
        createSummary() {
          throw new Error('not needed'); 
        },
        clear() {},
        getRegistry() {
          throw new Error('not needed'); 
        },
        startSystemMetricsCollection() {},
        stopSystemMetricsCollection() {},
      };

      const serviceLayer = Layer.succeed(MetricsService, mockService);
      const result = await Effect.runPromise(
        Effect.provide(measureExecutionTime('no_histogram', Effect.succeed('value')), serviceLayer),
      );

      expect(result).toBe('value');
    });

    test('should still fail when effect fails and getMetric returns undefined', async () => {
      const getMetricMock = mock(() => undefined);
      const mockService: MetricsService = {
        getMetric: getMetricMock,
        getMetrics: async () => '',
        getContentType: () => '',
        recordHttpRequest() {},
        createCounter() {
          throw new Error('not needed'); 
        },
        createGauge() {
          throw new Error('not needed'); 
        },
        createHistogram() {
          throw new Error('not needed'); 
        },
        createSummary() {
          throw new Error('not needed'); 
        },
        clear() {},
        getRegistry() {
          throw new Error('not needed'); 
        },
        startSystemMetricsCollection() {},
        stopSystemMetricsCollection() {},
      };

      const serviceLayer = Layer.succeed(MetricsService, mockService);

      await expect(
        Effect.runPromise(
          Effect.provide(measureExecutionTime('no_histogram_fail', Effect.fail(new Error('fail'))), serviceLayer),
        ),
      ).rejects.toThrow('fail');

      // tapError still calls getMetric even if it returns undefined
      expect(getMetricMock).toHaveBeenCalledWith('no_histogram_fail');
    });
  });

  describe('helper functions error handling', () => {
    test('should handle missing global metrics service in various scenarios', () => {
      delete (globalThis as any).__onebunMetricsService;

      class TestService {
        @Timed()
        @Counted()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });

    test('should handle globalThis being undefined', () => {
      const originalGlobalThis = globalThis;
      
      // Mock undefined globalThis
      Object.defineProperty(global, 'globalThis', {
        value: undefined,
        configurable: true,
      });

      class TestService {
        @Timed()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);

      // Restore globalThis
      Object.defineProperty(global, 'globalThis', {
        value: originalGlobalThis,
        configurable: true,
      });
    });
  });
});
