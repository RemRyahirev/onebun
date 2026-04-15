import { AsyncLocalStorage } from 'node:async_hooks';


/**
 * A single profiling mark representing a timed section of framework internals.
 */
export interface ProfileMark {
  readonly category: string;
  readonly label: string;
  readonly startNs: number;
  endNs: number;
  readonly metadata?: Record<string, string | number | boolean>;
}

/**
 * Aggregated profile report for a single request or bootstrap phase.
 */
export interface ProfileReport {
  readonly requestId?: string;
  readonly route?: string;
  readonly method?: string;
  readonly totalNs: number;
  readonly marks: ReadonlyArray<ProfileMark & { durationNs: number }>;
}

/**
 * Profiler interface — implement to provide custom profiling backends.
 */
export interface Profiler {
  /** Start a profiling mark. Returns a handle to pass to end(). */
  start(category: string, label: string, metadata?: Record<string, string | number | boolean>): ProfileMark;
  /** End a profiling mark (sets endNs). */
  end(mark: ProfileMark): void;
  /** Collect all marks into a report and reset state. */
  flush(meta?: { requestId?: string; route?: string; method?: string }): ProfileReport;
}

/**
 * Profiling options for ApplicationOptions.
 */
export interface ProfilingOptions {
  /** Enable profiling. Also enabled by ONEBUN_PROFILE=1 env var. */
  enabled?: boolean;
  /** Custom profiler implementation for external injection. */
  profiler?: Profiler;
  /** Expose diagnostic endpoint (e.g. '/_profile'). */
  endpoint?: string;
  /** Callback invoked after each request with the profile report. */
  onProfile?: (report: ProfileReport) => void;
  /** Log profile reports at debug level. */
  logReport?: boolean;
  /** Number of recent reports to keep for the diagnostic endpoint. @defaultValue 100 */
  maxReports?: number;
}

/**
 * Whether profiling is currently active.
 * Updated automatically by setProfiler(). Also initialized from env at module load.
 * JIT branch prediction makes `if (PROFILING_ENABLED)` essentially free when false.
 */
 
export let PROFILING_ENABLED: boolean =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__onebunProfiling === true ||
  process.env.ONEBUN_PROFILE === '1' ||
  process.env.ONEBUN_PROFILE === 'true';

let activeProfiler: Profiler | null = null;

/**
 * Get the active profiler instance. Returns null when profiling is disabled.
 */
export function getProfiler(): Profiler | null {
  return activeProfiler;
}

/**
 * Replace the active profiler with a custom implementation.
 * Automatically updates PROFILING_ENABLED.
 */
export function setProfiler(profiler: Profiler | null): void {
  activeProfiler = profiler;
  PROFILING_ENABLED = profiler !== null;
}

// -- Default Profiler Implementation --

const requestProfileStore = new AsyncLocalStorage<ProfileMark[]>();

/**
 * Run a callback within a per-request profiling scope.
 * Marks created inside the callback are isolated to this scope.
 */
export function runProfileScope<T>(fn: () => T): T {
  return requestProfileStore.run([], fn);
}

/**
 * Default profiler using AsyncLocalStorage for per-request isolation.
 * Falls back to a shared marks array for bootstrap profiling (outside request scope).
 */
export class DefaultProfiler implements Profiler {
  private bootstrapMarks: ProfileMark[] = [];

  start(
    category: string,
    label: string,
    metadata?: Record<string, string | number | boolean>,
  ): ProfileMark {
    const mark: ProfileMark = {
      category,
      label,
      startNs: Bun.nanoseconds(),
      endNs: 0,
      metadata,
    };
    const store = requestProfileStore.getStore();
    if (store) {
      store.push(mark);
    } else {
      this.bootstrapMarks.push(mark);
    }

    return mark;
  }

  end(mark: ProfileMark): void {
    mark.endNs = Bun.nanoseconds();
  }

  flush(meta?: { requestId?: string; route?: string; method?: string }): ProfileReport {
    const store = requestProfileStore.getStore();
    const rawMarks = store ?? this.bootstrapMarks;
    const marks = rawMarks.map((m) => ({
      ...m,
      durationNs: m.endNs - m.startNs,
    }));

    // Reset the source array
    if (store) {
      store.length = 0;
    } else {
      this.bootstrapMarks = [];
    }

    const totalNs = marks.length > 0
      ? marks[marks.length - 1].endNs - marks[0].startNs
      : 0;

    return { ...meta, totalNs, marks };
  }
}

// Auto-initialize default profiler when enabled via env
if (PROFILING_ENABLED && !activeProfiler) {
  activeProfiler = new DefaultProfiler();
}
