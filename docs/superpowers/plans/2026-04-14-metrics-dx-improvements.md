# Metrics DX Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve metrics developer experience by renaming decorators to match documented names (`@Timed`, `@Counted`, `@Gauged`), adding `this.metrics` getter to BaseService/Controller, and fixing all documentation.

**Architecture:** Rename decorator functions in `@onebun/metrics`, add backward-compatible re-exports with `@deprecated` JSDoc, add protected `metrics` getter to base classes using the same `globalThis` pattern as existing code, update all docs and tests.

**Tech Stack:** TypeScript, Bun.js, `@onebun/metrics`, `@onebun/core`

---

### Task 1: Rename decorator functions in `@onebun/metrics`

**Files:**
- Modify: `packages/metrics/src/decorators.ts`
- Modify: `packages/metrics/src/index.ts`

- [ ] **Step 1: Rename `MeasureTime` → `Timed` in `packages/metrics/src/decorators.ts`**

Change the function name at line 16 and update the JSDoc:

```typescript
/**
 * Decorator for measuring method execution time.
 * Records duration in a histogram metric.
 * Default metric name: `{ClassName}_{methodName}_duration`
 */
export function Timed(metricName?: string, labels?: string[]): MethodDecorator {
```

- [ ] **Step 2: Rename `CountCalls` → `Counted` in `packages/metrics/src/decorators.ts`**

Change the function name at line 60:

```typescript
/**
 * Decorator for counting method calls.
 * Increments a counter metric on each call.
 * Default metric name: `{ClassName}_{methodName}_calls_total`
 */
export function Counted(metricName?: string, labels?: string[]): MethodDecorator {
```

- [ ] **Step 3: Rename `MeasureGauge` → `Gauged` in `packages/metrics/src/decorators.ts`**

Change the function name at line 83:

```typescript
/**
 * Decorator for measuring gauge values.
 * Updates a gauge metric after method execution.
 */
export function Gauged(
  metricName: string,
  getValue: () => number,
  labels?: string[],
): MethodDecorator {
```

- [ ] **Step 4: Add deprecated re-exports for backward compatibility in `packages/metrics/src/decorators.ts`**

Add at the end of the file (before the Effect-based section):

```typescript
/**
 * @deprecated Use `Timed` instead. Will be removed in 1.0.
 */
export const MeasureTime = Timed;

/**
 * @deprecated Use `Counted` instead. Will be removed in 1.0.
 */
export const CountCalls = Counted;

/**
 * @deprecated Use `Gauged` instead. Will be removed in 1.0.
 */
export const MeasureGauge = Gauged;
```

- [ ] **Step 5: Update exports in `packages/metrics/src/index.ts`**

Replace the decorator exports:

```typescript
// Decorators
export {
  Counted,
  Gauged,
  InjectMetric,
  MeasureTime,
  CountCalls,
  MeasureGauge,
  Timed,
  measureExecutionTime,
  WithMetrics,
} from './decorators';
```

- [ ] **Step 6: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/metrics/src/decorators.ts packages/metrics/src/index.ts
git commit -m "refactor(metrics): rename decorators to Timed, Counted, Gauged with deprecated aliases"
```

---

### Task 2: Update decorator tests

**Files:**
- Modify: `packages/metrics/src/decorators.test.ts`
- Modify: `packages/metrics/src/docs-examples.test.ts`

- [ ] **Step 1: Update imports in `packages/metrics/src/decorators.test.ts`**

At line 21-26, change imports:

```typescript
import {
  Timed,
  Counted,
  Gauged,
  InjectMetric,
  WithMetrics,
  measureExecutionTime,
} from './decorators';
```

- [ ] **Step 2: Replace all `@MeasureTime` usages with `@Timed` in `packages/metrics/src/decorators.test.ts`**

Find-and-replace `@MeasureTime` → `@Timed` and `MeasureTime` (as identifier, not import) → `Timed` in test descriptions.

- [ ] **Step 3: Replace all `@CountCalls` usages with `@Counted` in `packages/metrics/src/decorators.test.ts`**

Find-and-replace `@CountCalls` → `@Counted` and update test descriptions.

- [ ] **Step 4: Replace `@MeasureGauge` usages with `@Gauged` in `packages/metrics/src/decorators.test.ts`**

Find-and-replace `@MeasureGauge` → `@Gauged` and update test descriptions.

- [ ] **Step 5: Update `packages/metrics/src/docs-examples.test.ts`**

Update imports at line 20:

```typescript
import {
  Timed,
  Counted,
  MetricsMiddleware,
  createMetricsService,
} from './';
```

Update test descriptions and decorator usages:
- Line 33: `'should have @Timed decorator available'`
- Line 35: `expect(Timed).toBeDefined();`
- Line 39: `'should have @Counted decorator available'`
- Line 41: `expect(Counted).toBeDefined();`
- Line 48: `@Timed('heavy_operation_duration')`
- Line 49: `@Counted('heavy_operation_calls')`

- [ ] **Step 6: Run tests**

Run: `bun test packages/metrics/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/metrics/src/decorators.test.ts packages/metrics/src/docs-examples.test.ts
git commit -m "test(metrics): update tests to use renamed Timed/Counted/Gauged decorators"
```

---

### Task 3: Add `this.metrics` getter to BaseService and Controller

**Files:**
- Modify: `packages/core/src/module/service.ts`
- Modify: `packages/core/src/module/controller.ts`

- [ ] **Step 1: Add metrics getter to `packages/core/src/module/service.ts`**

After the `span` getter (line 188), add:

```typescript
  /**
   * Get the global MetricsService instance.
   * Returns undefined when metrics are not enabled.
   *
   * Usage:
   * - `this.metrics?.createCounter({ name, help })`
   * - `this.metrics?.createHistogram({ name, help, buckets })`
   * - `this.metrics?.getMetric<Counter>(name)`
   */
  protected get metrics(): import('@onebun/metrics').MetricsService | undefined {
    if (typeof globalThis !== 'undefined') {
      return (globalThis as Record<string, unknown>).__onebunMetricsService as
        import('@onebun/metrics').MetricsService | undefined;
    }

    return undefined;
  }
```

Note: use inline `import()` type to avoid adding a top-level import that would make `@onebun/core` depend on `@onebun/metrics` at runtime.

- [ ] **Step 2: Add same metrics getter to `packages/core/src/module/controller.ts`**

After the `span` getter (line 146), add the same getter as above.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/module/service.ts packages/core/src/module/controller.ts
git commit -m "feat(core): add this.metrics getter to BaseService and Controller"
```

---

### Task 4: Add tests for `this.metrics` getter

**Files:**
- Modify: `packages/core/src/module/service.test.ts` (or create if needed)

- [ ] **Step 1: Find existing service/controller tests**

Run: `find packages/core/src -name '*.test.ts' | grep -E 'service|controller'`

- [ ] **Step 2: Add test for metrics getter**

In the appropriate test file, add a describe block:

```typescript
describe('metrics getter', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__onebunMetricsService;
  });

  test('returns undefined when metrics not enabled', () => {
    @Service()
    class TestService extends BaseService {}

    // ... instantiate via module system or directly
    // expect service.metrics to be undefined
  });

  test('returns MetricsService when available', () => {
    const mockMetrics = { createCounter: () => {} };
    (globalThis as Record<string, unknown>).__onebunMetricsService = mockMetrics;

    @Service()
    class TestService extends BaseService {
      getMetrics() {
        return this.metrics;
      }
    }

    // ... instantiate and verify
    // expect service.getMetrics() to equal mockMetrics
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test packages/core/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/
git commit -m "test(core): add tests for this.metrics getter"
```

---

### Task 5: Update `docs/api/metrics.md`

**Files:**
- Modify: `docs/api/metrics.md`

- [ ] **Step 1: Update frontmatter description**

```markdown
---
description: "Prometheus-compatible metrics. @Timed, @Counted, @Gauged decorators. HTTP, system, GC metrics. Custom counters, gauges, histograms."
---
```

- [ ] **Step 2: Replace "Accessing MetricsService" section (lines 112-127)**

Replace the `globalThis` pattern with `this.metrics`:

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class OrderService extends BaseService {
  async processOrder(orderId: string): Promise<void> {
    // this.metrics is available in any BaseService or Controller
    const counter = this.metrics?.createCounter({
      name: 'orders_created_total',
      help: 'Total number of orders created',
    });

    counter?.inc();
  }
}
```

- [ ] **Step 3: Update `@Timed()` section (lines 193-208)**

Fix the import name:

```typescript
### @Timed()

Automatically time method execution.

\`\`\`typescript
import { Timed } from '@onebun/metrics';

@Service()
export class OrderService extends BaseService {
  @Timed('order_processing_duration_seconds')
  async processOrder(orderId: string): Promise<Order> {
    // Method execution time is automatically recorded as a histogram
    return this.doProcess(orderId);
  }
}
\`\`\`
```

- [ ] **Step 4: Update `@Counted()` section (lines 210-225)**

Fix the import name:

```typescript
### @Counted()

Automatically count method calls.

\`\`\`typescript
import { Counted } from '@onebun/metrics';

@Service()
export class EmailService extends BaseService {
  @Counted('emails_sent_total')
  async sendEmail(to: string, subject: string): Promise<void> {
    // Counter incremented on each call
    await this.smtp.send({ to, subject });
  }
}
\`\`\`
```

- [ ] **Step 5: Add `@Gauged()` section after `@Counted()`**

```typescript
### @Gauged()

Update a gauge metric after method execution.

\`\`\`typescript
import { Gauged } from '@onebun/metrics';

@Service()
export class QueueService extends BaseService {
  @Gauged('queue_depth', () => this.queue.length)
  async processNext(): Promise<void> {
    const item = this.queue.shift();
    await this.handle(item);
    // Gauge is automatically updated with queue.length after execution
  }
}
\`\`\`
```

- [ ] **Step 6: Update "Service Metrics Pattern" (lines 228-294) — replace `globalThis` with `this.metrics`**

```typescript
@Service()
export class PaymentService extends BaseService {
  private paymentsCounter?: Counter<string>;
  private processingHistogram?: Histogram<string>;
  private queueGauge?: Gauge<string>;

  constructor() {
    super();
    this.registerMetrics();
  }

  private registerMetrics(): void {
    if (!this.metrics) return;

    this.paymentsCounter = this.metrics.createCounter({
      name: 'payments_processed_total',
      help: 'Total number of payments processed',
      labelNames: ['status', 'method'],
    });

    this.processingHistogram = this.metrics.createHistogram({
      name: 'payment_processing_seconds',
      help: 'Payment processing duration',
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    this.queueGauge = this.metrics.createGauge({
      name: 'payment_queue_size',
      help: 'Current payment queue size',
    });
  }
  // ... rest unchanged
}
```

- [ ] **Step 7: Update "Complete Example" (lines 363-450) — replace `globalThis` with `this.metrics`**

Same pattern: remove `private metricsService` field, replace `this.metricsService` → `this.metrics`.

- [ ] **Step 8: Commit**

```bash
git add docs/api/metrics.md
git commit -m "docs(metrics): update API docs with this.metrics, @Timed/@Counted/@Gauged"
```

---

### Task 6: Update other documentation files

**Files:**
- Modify: `docs/features.md`
- Modify: `docs/ai-docs.md`
- Modify: `docs/getting-started.md`
- Modify: `docs/migration-nestjs.md`

These files already use `@Timed`/`@Counted` so only minor fixes needed.

- [ ] **Step 1: `docs/migration-nestjs.md` — verify decorator names at lines 94-95**

Already correct (`@Timed()`, `@Counted()`). No changes needed.

- [ ] **Step 2: `docs/features.md` — verify at line 254**

Already correct (`@Timed(), @Counted()`). Add `@Gauged` mention.

Change line 254 from:
```
- Decorator-based: @Timed(), @Counted()
```
to:
```
- Decorator-based: @Timed(), @Counted(), @Gauged()
```

Also update the llm-only section (line 84) and the human-visible features list (line 66) to include `@Gauged`.

- [ ] **Step 3: `docs/ai-docs.md` — add `@Gauged` at line 80**

Change from:
```
@Timed/@Counted decorators
```
to:
```
@Timed/@Counted/@Gauged decorators
```

- [ ] **Step 4: `docs/getting-started.md` — add `@Gauged` at lines 29 and 424**

Update both mentions to include `@Gauged`.

- [ ] **Step 5: Commit**

```bash
git add docs/features.md docs/ai-docs.md docs/getting-started.md docs/migration-nestjs.md
git commit -m "docs: add @Gauged decorator references across documentation"
```

---

### Task 7: Update docs-examples tests to match new documentation

**Files:**
- Modify: `packages/metrics/src/docs-examples.test.ts`

- [ ] **Step 1: Add test for `@Gauged` decorator availability**

After the `@Counted` test, add:

```typescript
it('should have @Gauged decorator available', () => {
  expect(Gauged).toBeDefined();
  expect(typeof Gauged).toBe('function');
});
```

Update the import to include `Gauged`.

- [ ] **Step 2: Add test for `this.metrics` access pattern**

```typescript
describe('this.metrics access pattern (docs/api/metrics.md)', () => {
  let metricsService: MetricsServiceInterface;

  beforeEach(() => {
    metricsService = getMetricsService();
    metricsService.clear();
    (globalThis as Record<string, unknown>).__onebunMetricsService = metricsService;
  });

  afterEach(() => {
    metricsService.clear();
    delete (globalThis as Record<string, unknown>).__onebunMetricsService;
  });

  it('should access metrics via this.metrics getter', () => {
    // From docs: this.metrics is available in BaseService/Controller
    const service = (globalThis as Record<string, unknown>).__onebunMetricsService;
    expect(service).toBeDefined();
    expect(typeof (service as MetricsServiceInterface).createCounter).toBe('function');
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `bun test packages/metrics/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/metrics/src/docs-examples.test.ts
git commit -m "test(metrics): add docs-examples tests for @Gauged and this.metrics pattern"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full verification suite**

```bash
bun run typecheck && bun run lint && bun test && bun run publish:check
```

Expected: All PASS

- [ ] **Step 2: Verify no stale references remain**

```bash
grep -rn 'globalThis.*__onebunMetricsService' docs/
grep -rn '@MeasureTime\|@CountCalls\|@MeasureGauge' docs/
```

Expected: No matches in docs (only in source code as deprecated aliases)

- [ ] **Step 3: Commit any remaining fixes**

If any issues found, fix and commit.
