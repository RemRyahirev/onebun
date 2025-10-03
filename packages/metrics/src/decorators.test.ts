import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { Effect } from 'effect';
import { register } from 'prom-client';

import { useFakeTimers } from '@onebun/core';

import {
  MeasureTime,
  CountCalls,
  MeasureGauge,
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

  describe('MeasureTime decorator', () => {
    test('should measure execution time for synchronous method', () => {
      class TestService {
        @MeasureTime()
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
        @MeasureTime()
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
        @MeasureTime()
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
        @MeasureTime()
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
        @MeasureTime('custom_metric')
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
        @MeasureTime()
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
        @MeasureTime()
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
        @MeasureTime()
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      expect(() => service.testMethod()).not.toThrow();
      expect(service.testMethod()).toBe(42);
    });
  });

  describe('CountCalls decorator', () => {
    test('should increment counter on method call', () => {
      class TestService {
        @CountCalls()
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
        @CountCalls('custom_counter')
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
        @CountCalls()
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
        @CountCalls()
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
        @CountCalls()
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
        @CountCalls('labeled_counter', ['method', 'service'])
        labeledMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.labeledMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('labeled_counter');
    });
  });

  describe('MeasureGauge decorator', () => {
    test('should update gauge after synchronous method execution', () => {
      let gaugeValue = 100;
      const getValue = () => gaugeValue;

      class TestService {
        @MeasureGauge('test_gauge', getValue)
        updateGaugeMethod(): void {
          gaugeValue = 200;
        }
      }

      const service = new TestService();
      service.updateGaugeMethod();

      expect(mockMetricsService.getMetric).toHaveBeenCalledWith('test_gauge');
    });

    test('should update gauge after asynchronous method execution', async () => {
      const timers = useFakeTimers();
      
      let gaugeValue = 100;
      const getValue = () => gaugeValue;

      class TestService {
        @MeasureGauge('test_gauge', getValue)
        async updateGaugeMethodAsync(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 10));
          gaugeValue = 200;
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

    test('should handle getValue function throwing error', () => {
      const getValue = () => {
        throw new Error('getValue error');
      };

      class TestService {
        @MeasureGauge('test_gauge', getValue)
        testMethod(): number {
          return 42;
        }
      }

      const service = new TestService();
      service.testMethod();

      expect(capturedWarns).toContain('Failed to update gauge test_gauge: Error: getValue error');
    });

    test('should handle missing metrics service gracefully', () => {
      delete (globalThis as any).__onebunMetricsService;
      const getValue = () => 100;

      class TestService {
        @MeasureGauge('test_gauge', getValue)
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
      const getValue = () => 100;

      class TestService {
        @MeasureGauge('test_gauge', getValue)
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
      expect(typeof measuredEffect).toBe('object');
    });
  });

  describe('helper functions error handling', () => {
    test('should handle missing global metrics service in various scenarios', () => {
      delete (globalThis as any).__onebunMetricsService;

      class TestService {
        @MeasureTime()
        @CountCalls()
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
        @MeasureTime()
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
