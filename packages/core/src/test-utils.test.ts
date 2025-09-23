import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { useFakeTimers } from './test-utils';

describe('FakeTimers', () => {
  let advanceTime: (ms: number) => void;
  let restore: () => void;
  let getTimerCount: () => number;

  beforeEach(() => {
    const fakeTimers = useFakeTimers();
    advanceTime = fakeTimers.advanceTime;
    restore = fakeTimers.restore;
    getTimerCount = fakeTimers.getTimerCount;
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
});
