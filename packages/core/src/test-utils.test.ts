import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test,
} from 'bun:test';

import { FakeTimers, useFakeTimers } from './test-utils';

describe('FakeTimers', () => {
  let advanceTime: (ms: number) => void;
  let restore: () => void;
  let getTimerCount: () => number;
  let clearAllTimers: () => void;

  beforeEach(() => {
    const fakeTimers = useFakeTimers();
    advanceTime = fakeTimers.advanceTime;
    restore = fakeTimers.restore;
    getTimerCount = fakeTimers.getTimerCount;
    clearAllTimers = fakeTimers.clearAllTimers;
  });

  afterEach(() => {
    restore();
  });

  it('should mock setTimeout and trigger callbacks', () => {
    let called = false;
    
    setTimeout(() => {
      called = true;
    }, 100);

    expect(called).toBe(false);
    expect(getTimerCount()).toBe(1);

    advanceTime(50);
    expect(called).toBe(false);

    advanceTime(60); // Total 110ms
    expect(called).toBe(true);
    expect(getTimerCount()).toBe(0);
  });

  it('should mock setInterval and trigger callbacks repeatedly', () => {
    let count = 0;
    
    const intervalId = setInterval(() => {
      count++;
    }, 50);

    expect(count).toBe(0);
    expect(getTimerCount()).toBe(1);

    advanceTime(60); // First trigger
    expect(count).toBe(1);
    expect(getTimerCount()).toBe(1);

    advanceTime(50); // Second trigger
    expect(count).toBe(2);
    expect(getTimerCount()).toBe(1);

    advanceTime(50); // Third trigger
    expect(count).toBe(3);
    expect(getTimerCount()).toBe(1);

    clearInterval(intervalId);
    expect(getTimerCount()).toBe(0);
  });

  it('should mock Date.now', () => {
    const startTime = Date.now();

    advanceTime(1000);
    expect(Date.now()).toBe(startTime + 1000);

    advanceTime(2000);
    expect(Date.now()).toBe(startTime + 3000);
  });

  it('should handle mixed timers correctly', () => {
    let timeoutCalled = false;
    let intervalCount = 0;

    setTimeout(() => {
      timeoutCalled = true;
    }, 100);

    const intervalId = setInterval(() => {
      intervalCount++;
    }, 30);

    expect(getTimerCount()).toBe(2);

    advanceTime(35); // First interval trigger
    expect(timeoutCalled).toBe(false);
    expect(intervalCount).toBe(1);

    advanceTime(35); // Second interval trigger
    expect(timeoutCalled).toBe(false);
    expect(intervalCount).toBe(2);

    advanceTime(35); // Timeout trigger + third interval trigger
    expect(timeoutCalled).toBe(true);
    expect(intervalCount).toBe(3);

    clearInterval(intervalId);
    expect(getTimerCount()).toBe(0);
  });

  test('should handle runAllTimers method', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    const callbacks: string[] = [];

    setTimeout(() => callbacks.push('timeout1'), 100);
    setTimeout(() => callbacks.push('timeout2'), 50);
    setTimeout(() => callbacks.push('timeout3'), 200);

    expect(callbacks).toHaveLength(0);

    fakeTimers.runAllTimers();

    expect(callbacks).toEqual(['timeout2', 'timeout1', 'timeout3']);
    expect(fakeTimers.getTimerCount()).toBe(0);

    fakeTimers.disable();
  });

  test('should handle runAllTimers with no timers', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    expect(() => fakeTimers.runAllTimers()).not.toThrow();

    fakeTimers.disable();
  });

  test('should handle runAllTimers with intervals (should not run)', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    const callbacks: string[] = [];

    setInterval(() => callbacks.push('interval'), 100);
    setTimeout(() => callbacks.push('timeout'), 50);

    fakeTimers.runAllTimers();

    // Only timeout should run, not interval
    expect(callbacks).toEqual(['timeout']);
    expect(fakeTimers.getTimerCount()).toBe(1); // interval still pending

    fakeTimers.disable();
  });

  test('should throw error when runAllTimers called but not enabled', () => {
    const fakeTimers = new FakeTimers();

    expect(() => fakeTimers.runAllTimers()).toThrow('FakeTimers not enabled. Call enable() first.');
  });

  test('should prevent infinite loops in runAllTimers', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    // Create just enough timeouts to trigger the max iterations check
    // (runAllTimers has max 1000 iterations)
    // We create 1001 to exceed the limit, but we can test with fewer
    for (let i = 0; i < 150; i++) {
      setTimeout(() => {}, i);
    }
    // Add one more that creates new timers to cause infinite loop
    setTimeout(() => {
      for (let i = 0; i < 1000; i++) {
        setTimeout(() => {}, 1);
      }
    }, 100);

    expect(() => fakeTimers.runAllTimers()).toThrow('runAllTimers: Maximum iterations reached. Possible infinite loop detected.');

    fakeTimers.disable();
  });

  test('should handle now() method', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    const initialTime = fakeTimers.now();
    expect(typeof initialTime).toBe('number');
    expect(initialTime).toBeGreaterThan(0);

    fakeTimers.advanceTimersByTime(1000);
    expect(fakeTimers.now()).toBe(initialTime + 1000);

    fakeTimers.disable();
  });

  test('should handle clearAllTimers method', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    setTimeout(() => {}, 100);
    setInterval(() => {}, 50);

    expect(fakeTimers.getTimerCount()).toBe(2);

    fakeTimers.clearAllTimers();
    expect(fakeTimers.getTimerCount()).toBe(0);

    fakeTimers.disable();
  });

  test('should handle timer callback errors gracefully', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    const originalConsoleError = console.error;
    const consoleErrors: any[] = [];
    console.error = (...args: any[]) => consoleErrors.push(args);

    setTimeout(() => {
      throw new Error('Timer error');
    }, 100);

    setTimeout(() => {
      // This should still run despite the error above
    }, 200);

    fakeTimers.advanceTimersByTime(300);

    expect(consoleErrors).toHaveLength(1);
    expect(consoleErrors[0][0]).toBe('Error in timer callback:');

    console.error = originalConsoleError;
    fakeTimers.disable();
  });

  test('should handle negative time advancement', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    expect(() => fakeTimers.advanceTimersByTime(-100)).toThrow('Cannot advance time backwards');

    fakeTimers.disable();
  });

  test('should handle disable when not enabled', () => {
    const fakeTimers = new FakeTimers();

    // Should not throw
    expect(() => fakeTimers.disable()).not.toThrow();
  });

  test('should throw when enable called twice', () => {
    const fakeTimers = new FakeTimers();
    fakeTimers.enable();

    expect(() => fakeTimers.enable()).toThrow('FakeTimers already enabled');

    fakeTimers.disable();
  });

  test('should handle useFakeTimers convenience function', () => {
    // Test that the global instance is already working (called in beforeEach)
    const callbacks: string[] = [];
    setTimeout(() => callbacks.push('test'), 100);

    expect(getTimerCount()).toBe(1);

    advanceTime(100);
    expect(callbacks).toEqual(['test']);

    setTimeout(() => callbacks.push('test2'), 50);
    setTimeout(() => callbacks.push('test3'), 100);

    // Use the existing advanceTime to run remaining timers
    advanceTime(100);
    expect(callbacks).toEqual(['test', 'test2', 'test3']);
  });

  test('should provide getTimerCount method', () => {
    const callback = () => {};

    expect(getTimerCount()).toBe(0);

    setTimeout(callback, 100);
    setTimeout(callback, 200);
    setInterval(callback, 300);

    expect(getTimerCount()).toBe(3);

    advanceTime(100);
    expect(getTimerCount()).toBe(2); // setTimeout with 100ms should be executed

    advanceTime(100);
    expect(getTimerCount()).toBe(1); // setTimeout with 200ms executed, but interval still pending
  });

  test('should handle clearAllTimers method directly', () => {
    const callback = () => {};

    setTimeout(callback, 100);
    setInterval(callback, 200);

    expect(getTimerCount()).toBe(2);

    // Use the existing clearAllTimers from beforeEach setup
    clearAllTimers();
    expect(getTimerCount()).toBe(0);
  });

  test('should test useFakeTimers function interface', () => {
    // Test that all timer methods are available and working
    expect(typeof advanceTime).toBe('function');
    expect(typeof restore).toBe('function');
    expect(typeof getTimerCount).toBe('function');
    expect(typeof clearAllTimers).toBe('function');
    
    // Test that methods work correctly
    expect(getTimerCount()).toBe(0); // Should start with 0 timers
    
    setTimeout(() => {}, 100);
    expect(getTimerCount()).toBe(1); // Should have 1 timer
    
    clearAllTimers();
    expect(getTimerCount()).toBe(0); // Should clear all timers
  });

  test('should cover additional FakeTimers functionality', () => {
    // Test coverage for various FakeTimers methods to improve percentage
    let callCount = 0;
    const callback = () => {
      callCount++; 
    };
    
    // Test setTimeout with minimal delay
    setTimeout(callback, 1);
    advanceTime(1);
    expect(callCount).toBe(1);
    
    // Reset for next test
    callCount = 0;
    clearAllTimers();
    
    // Test multiple timers with same delay
    setTimeout(callback, 50);
    setTimeout(callback, 50);
    setTimeout(callback, 100);
    
    expect(getTimerCount()).toBe(3);
    
    advanceTime(50);
    expect(callCount).toBe(2);
    expect(getTimerCount()).toBe(1);
    
    advanceTime(50);
    expect(callCount).toBe(3);
    expect(getTimerCount()).toBe(0);
  });
});
