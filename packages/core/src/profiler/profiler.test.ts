/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
import {
  describe,
  test,
  expect,
  beforeEach,
} from 'bun:test';

import {
  DefaultProfiler,
  getProfiler,
  setProfiler,
  runProfileScope,
  type Profiler,
  type ProfileReport,
} from './profiler';


describe('DefaultProfiler', () => {
  let profiler: DefaultProfiler;

  beforeEach(() => {
    profiler = new DefaultProfiler();
  });

  test('start creates a mark with startNs and endNs=0', () => {
    const mark = profiler.start('di', 'UserService');
    expect(mark.category).toBe('di');
    expect(mark.label).toBe('UserService');
    expect(mark.startNs).toBeGreaterThan(0);
    expect(mark.endNs).toBe(0);
  });

  test('end sets endNs on the mark', () => {
    const mark = profiler.start('middleware', 'AuthMiddleware');
    profiler.end(mark);
    expect(mark.endNs).toBeGreaterThan(0);
    expect(mark.endNs).toBeGreaterThanOrEqual(mark.startNs);
  });

  test('start preserves metadata', () => {
    const mark = profiler.start('di', 'UserService', { dependencyCount: 3 });
    expect(mark.metadata).toEqual({ dependencyCount: 3 });
  });

  test('flush returns report with all marks and resets state', () => {
    const mark1 = profiler.start('di', 'ServiceA');
    profiler.end(mark1);
    const mark2 = profiler.start('di', 'ServiceB');
    profiler.end(mark2);

    const report = profiler.flush({ route: 'bootstrap' });

    expect(report.route).toBe('bootstrap');
    expect(report.marks).toHaveLength(2);
    expect(report.marks[0].label).toBe('ServiceA');
    expect(report.marks[1].label).toBe('ServiceB');
    expect(report.marks[0].durationNs).toBeGreaterThanOrEqual(0);
    expect(report.totalNs).toBeGreaterThanOrEqual(0);

    // Second flush returns empty
    const report2 = profiler.flush();
    expect(report2.marks).toHaveLength(0);
    expect(report2.totalNs).toBe(0);
  });

  test('flush includes method and requestId in report', () => {
    const mark = profiler.start('handler', 'test');
    profiler.end(mark);

    const report = profiler.flush({ method: 'GET', route: '/api/test', requestId: 'abc-123' });
    expect(report.method).toBe('GET');
    expect(report.route).toBe('/api/test');
    expect(report.requestId).toBe('abc-123');
  });
});

describe('AsyncLocalStorage isolation via runProfileScope', () => {
  test('marks inside runProfileScope are isolated from bootstrap marks', () => {
    const profiler = new DefaultProfiler();
    setProfiler(profiler);

    // Bootstrap mark (no ALS scope)
    const bootstrapMark = profiler.start('bootstrap', 'config');
    profiler.end(bootstrapMark);

    const bootstrapReport = profiler.flush({ route: 'bootstrap' });
    expect(bootstrapReport.marks).toHaveLength(1);
    expect(bootstrapReport.marks[0].label).toBe('config');

    // Request scope (with ALS)
    runProfileScope(() => {
      const reqMark = profiler.start('middleware', 'Auth');
      profiler.end(reqMark);

      const reqReport = profiler.flush({ route: 'GET /test', method: 'GET' });
      expect(reqReport.marks).toHaveLength(1);
      expect(reqReport.marks[0].label).toBe('Auth');
    });

    setProfiler(null);
  });

  test('concurrent request scopes do not interfere', async () => {
    const profiler = new DefaultProfiler();
    setProfiler(profiler);

    const reports: ProfileReport[] = [];

    await Promise.all([
      runProfileScope(async () => {
        const m1 = profiler.start('handler', 'request-1');
        // Simulate some async work
        await new Promise((resolve) => {
          setTimeout(resolve, 1); 
        });
        profiler.end(m1);
        reports.push(profiler.flush({ route: '/route-1' }));
      }),
      runProfileScope(async () => {
        const m2 = profiler.start('handler', 'request-2');
        await new Promise((resolve) => {
          setTimeout(resolve, 1); 
        });
        profiler.end(m2);
        reports.push(profiler.flush({ route: '/route-2' }));
      }),
    ]);

    expect(reports).toHaveLength(2);

    const r1 = reports.find((r) => r.route === '/route-1')!;
    const r2 = reports.find((r) => r.route === '/route-2')!;

    expect(r1.marks).toHaveLength(1);
    expect(r1.marks[0].label).toBe('request-1');
    expect(r2.marks).toHaveLength(1);
    expect(r2.marks[0].label).toBe('request-2');

    setProfiler(null);
  });
});

describe('getProfiler / setProfiler', () => {
  test('setProfiler replaces the active profiler', () => {
    const custom: Profiler = {
      start: () => ({
        category: '', label: '', startNs: 0, endNs: 0, 
      }),
      end() {},
      flush: () => ({ totalNs: 0, marks: [] }),
    };

    const original = getProfiler();
    setProfiler(custom);
    expect(getProfiler()).toBe(custom);

    // Restore
    setProfiler(original);
  });

  test('setProfiler(null) clears the profiler', () => {
    const original = getProfiler();
    setProfiler(null);
    expect(getProfiler()).toBeNull();

    // Restore
    setProfiler(original);
  });
});

describe('ProfileReport format', () => {
  test('durationNs is computed correctly', () => {
    const profiler = new DefaultProfiler();
    const mark = profiler.start('handler', 'test');

    // Simulate passage of time by overriding endNs
    (mark as any).startNs = 1000;
    mark.endNs = 5000;

    // Manually end to set endNs properly for the last mark
    profiler.end(mark);

    const report = profiler.flush();
    // durationNs = endNs - startNs, but since we manually set startNs/endNs,
    // the mark's durationNs should reflect that
    expect(report.marks[0].durationNs).toBe(report.marks[0].endNs - 1000);
  });
});
