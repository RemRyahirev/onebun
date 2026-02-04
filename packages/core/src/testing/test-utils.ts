/**
 * Test utilities for OneBun framework
 * Provides fake timers and other testing helpers
 */

import { Effect, Layer } from 'effect';

import type { IConfig, OneBunAppConfig } from '../module/config.interface';

import type { Logger, SyncLogger } from '@onebun/logger';
import { LoggerService } from '@onebun/logger';

export interface TimerHandle {
  id: number;
  callback: () => void;
  delay: number;
  interval: boolean;
  nextRun: number;
}

/**
 * Fake timers implementation for testing
 * Allows controlling time and timer execution in tests
 */
export class FakeTimers {
  private currentTime: number = Date.now();
  private timers: TimerHandle[] = [];
  private nextTimerId = 1;
  private isEnabled = false;

  // Store original functions
  private readonly originalSetTimeout = globalThis.setTimeout;
  private readonly originalSetInterval = globalThis.setInterval;
  private readonly originalClearTimeout = globalThis.clearTimeout;
  private readonly originalClearInterval = globalThis.clearInterval;
  private readonly originalDateNow = Date.now;

  /**
   * Enable fake timers
   * Replaces global setTimeout, setInterval, clearTimeout, clearInterval, and Date.now
   */
  enable(): void {
    if (this.isEnabled) {
      throw new Error('FakeTimers already enabled');
    }

    this.isEnabled = true;
    this.currentTime = Date.now();
    this.timers = [];
    this.nextTimerId = 1;

    // Mock Date.now
    Date.now = () => this.currentTime;

    // Mock setTimeout
    (globalThis as Record<string, unknown>).setTimeout = (callback: () => void, delay: number = 0) => {
      const id = this.nextTimerId++;
      this.timers.push({
        id,
        callback,
        delay,
        interval: false,
        nextRun: this.currentTime + Math.max(0, delay),
      });

      return id as unknown as NodeJS.Timeout;
    };

    // Mock setInterval
    (globalThis as Record<string, unknown>).setInterval = (callback: () => void, delay: number = 0) => {
      const id = this.nextTimerId++;
      this.timers.push({
        id,
        callback,
        delay: Math.max(1, delay), // Ensure minimum 1ms for intervals
        interval: true,
        nextRun: this.currentTime + Math.max(1, delay),
      });

      return id as unknown as NodeJS.Timeout;
    };

    // Mock clearTimeout/clearInterval
    const clearTimer = (id: NodeJS.Timeout | string | number | undefined) => {
      const timerId = typeof id === 'number' ? id : Number(id);
      this.timers = this.timers.filter(timer => timer.id !== timerId);
    };

    (globalThis as Record<string, unknown>).clearTimeout = clearTimer;
    (globalThis as Record<string, unknown>).clearInterval = clearTimer;
  }

  /**
   * Disable fake timers and restore original functions
   */
  disable(): void {
    if (!this.isEnabled) {
      return;
    }

    this.isEnabled = false;

    // Restore original functions
    Date.now = this.originalDateNow;
    globalThis.setTimeout = this.originalSetTimeout;
    globalThis.setInterval = this.originalSetInterval;
    globalThis.clearTimeout = this.originalClearTimeout;
    globalThis.clearInterval = this.originalClearInterval;

    // Clear all timers
    this.timers = [];
  }

  /**
   * Advance time by specified milliseconds and execute any timers that should fire
   * @param ms - Number of milliseconds to advance
   */
  advanceTimersByTime(ms: number): void {
    if (!this.isEnabled) {
      throw new Error('FakeTimers not enabled. Call enable() first.');
    }

    if (ms < 0) {
      throw new Error('Cannot advance time backwards');
    }

    const targetTime = this.currentTime + ms;

    while (this.currentTime < targetTime && this.timers.length > 0) {
      // Find timers that should fire before or at target time
      const readyTimers = this.timers
        .filter(timer => timer.nextRun <= targetTime)
        .sort((a, b) => a.nextRun - b.nextRun);

      if (readyTimers.length === 0) {
        // No more timers to execute, jump to target time
        this.currentTime = targetTime;
        break;
      }

      // Move to the time of the next timer
      const nextTimer = readyTimers[0];
      this.currentTime = nextTimer.nextRun;

      // Execute all timers that should fire at this time
      const timersToExecute = readyTimers.filter(timer => timer.nextRun === this.currentTime);

      for (const timer of timersToExecute) {
        try {
          timer.callback();
        } catch (error) {
          // Don't let timer errors break the fake timer system
          // eslint-disable-next-line no-console
          console.error('Error in timer callback:', error);
        }

        if (timer.interval) {
          // Reschedule interval timer
          timer.nextRun = this.currentTime + timer.delay;
        } else {
          // Remove one-time timer
          this.timers = this.timers.filter(t => t.id !== timer.id);
        }
      }
    }

    // Ensure we reach the target time
    if (this.currentTime < targetTime) {
      this.currentTime = targetTime;
    }
  }

  /**
   * Run all pending timers immediately
   */
  runAllTimers(): void {
    if (!this.isEnabled) {
      throw new Error('FakeTimers not enabled. Call enable() first.');
    }

    let maxIterations = 1000; // Prevent infinite loops
    let iterations = 0;

    while (this.timers.length > 0 && iterations < maxIterations) {
      const nextTimer = this.timers
        .filter(timer => !timer.interval) // Only run timeouts, not intervals
        .sort((a, b) => a.nextRun - b.nextRun)[0];

      if (!nextTimer) {
        break;
      }

      this.advanceTimersByTime(nextTimer.nextRun - this.currentTime);
      iterations++;
    }

    if (iterations >= maxIterations) {
      throw new Error('runAllTimers: Maximum iterations reached. Possible infinite loop detected.');
    }
  }

  /**
   * Get current fake time
   */
  now(): number {
    return this.currentTime;
  }

  /**
   * Get number of pending timers
   */
  getTimerCount(): number {
    return this.timers.length;
  }

  /**
   * Clear all pending timers without executing them
   */
  clearAllTimers(): void {
    this.timers = [];
  }
}

/**
 * Global instance of FakeTimers
 * Use this in tests for consistent timer mocking
 */
export const fakeTimers = new FakeTimers();

/**
 * Convenience function to use fake timers in test setup
 * 
 * @example
 * ```typescript
 * import { useFakeTimers } from '@onebun/core';
 * 
 * describe('My tests', () => {
 *   const { advanceTime, restore } = useFakeTimers();
 * 
 *   afterEach(() => {
 *     restore();
 *   });
 * 
 *   it('should work with timers', () => {
 *     // Your test code
 *     advanceTime(1000);
 *   });
 * });
 * ```
 */
export function useFakeTimers(): {
  advanceTime: (ms: number) => void;
  runAllTimers: () => void;
  now: () => number;
  getTimerCount: () => number;
  clearAllTimers: () => void;
  restore: () => void;
} {
  fakeTimers.enable();

  return {
    /**
     * Advance time by specified milliseconds
     */
    advanceTime: (ms: number) => fakeTimers.advanceTimersByTime(ms),
    
    /**
     * Run all pending timers
     */
    runAllTimers: () => fakeTimers.runAllTimers(),
    
    /**
     * Get current fake time
     */
    now: () => fakeTimers.now(),
    
    /**
     * Get number of pending timers
     */
    getTimerCount: () => fakeTimers.getTimerCount(),
    
    /**
     * Clear all timers without executing
     */
    clearAllTimers: () => fakeTimers.clearAllTimers(),
    
    /**
     * Restore real timers
     */
    restore: () => fakeTimers.disable(),
  };
}

/**
 * Create a silent mock logger that doesn't output anything
 * Useful for tests to avoid cluttering the output
 */
export function createMockLogger(): Logger {
  const noOp = Effect.succeed(undefined);
  
  const mockLogger: Logger = {
    trace: () => noOp,
    debug: () => noOp,
    info: () => noOp,
    warn: () => noOp,
    error: () => noOp,
    fatal: () => noOp,
    child: () => mockLogger,
  };
  
  return mockLogger;
}

/**
 * Create a silent mock sync logger that doesn't output anything
 * Useful for tests to avoid cluttering the output
 */
export function createMockSyncLogger(): SyncLogger {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noOp = () => {};
  
  const mockSyncLogger: SyncLogger = {
    trace: noOp,
    debug: noOp,
    info: noOp,
    warn: noOp,
    error: noOp,
    fatal: noOp,
    child: () => mockSyncLogger,
  };
  
  return mockSyncLogger;
}

/**
 * Create a mock logger layer for testing
 * Returns an Effect Layer that provides a silent logger
 */
export function makeMockLoggerLayer(): Layer.Layer<Logger, never, never> {
  return Layer.succeed(LoggerService, createMockLogger());
}

/**
 * Create a mock config for testing.
 * Returns an IConfig-compatible object with customizable values.
 * 
 * @param values - Optional object with config values that get() will return
 * @param options - Optional configuration options
 * @returns An IConfig-compatible mock object
 * 
 * @example
 * ```typescript
 * const mockConfig = createMockConfig({ 
 *   'server.port': 3000,
 *   'server.host': '0.0.0.0'
 * });
 * controller.initializeController(mockLogger, mockConfig);
 * ```
 */
export function createMockConfig(
  values: Record<string, unknown> = {},
  options?: { isInitialized?: boolean },
): IConfig<OneBunAppConfig> {
  const isInitialized = options?.isInitialized ?? true;
  
  return {
    get(path: string): unknown {
      if (!isInitialized) {
        throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
      }

      return values[path];
    },
    get values(): OneBunAppConfig {
      if (!isInitialized) {
        throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
      }

      return values as unknown as OneBunAppConfig;
    },
    getSafeConfig(): OneBunAppConfig {
      if (!isInitialized) {
        throw new Error('Configuration not initialized. Provide envSchema in ApplicationOptions.');
      }

      return values as unknown as OneBunAppConfig;
    },
    get isInitialized(): boolean {
      return isInitialized;
    },
    async initialize(): Promise<void> {
      // No-op for mock
    },
  };
}
