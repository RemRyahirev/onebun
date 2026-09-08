# Observability — Tracing & OTLP Export

## Trace Decorators

Four names, **two** decorators — they are not all aliases of one implementation:

| Name | Implementation | On success | On throw |
|---|---|---|---|
| `@Traced()` / `@Trace()` | `trace()` | status `OK` | status `ERROR` + `recordException(err)`, rethrow |
| `@Span()` / `@Spanned()` | `span()` | status stays `UNSET` | status `ERROR` only, rethrow |

`Traced === Trace` and `Span === Spanned`, but `Traced === Span` is **false** at runtime.

**Default to `@Traced()`.** `@Span()` is the "lighter" variant and never calls `recordException()`, so the
span carries no `exception.type` / `exception.message` / `exception.stacktrace` event — in Jaeger/SigNoz the
span goes red with no error detail attached, and it never reports `OK` on the happy path either. Use `@Span()`
only for hot internal methods where you deliberately do not want the exception event.

<!-- typecheck: skip -->
```typescript
import { Traced, Span } from '@onebun/trace';

@Service()
class MyService extends BaseService {
  @Traced('custom-operation-name')  // records exceptions — use this by default
  async findAll(): Promise<Item[]> { ... }

  @Span()  // 'MyService.processItem'; NO exception event, no OK status
  async processItem(id: string): Promise<void> { ... }
}
```

Key points:
- Decorators return Promises (NOT Effects) — `await service.method()` works normally
- Uses `@opentelemetry/api` `tracer.startActiveSpan()` under the hood
- Both rethrow the error; only `@Traced()`/`@Trace()` record it as a span exception event
- Both apply `@SpanAttribute()` argument attributes
- Span is ended in `finally` block (always ends, even on error)

## Auto-Tracing (traceAll)

Zero-boilerplate tracing — all async methods on services/controllers are auto-wrapped:

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    traceAll: true,
    traceFilter: {
      asyncOnly: true,                              // default
      includeClasses: ['*Service', '*Repository'],  // glob
      excludeClasses: ['HealthController'],
      excludeMethods: ['helperMethod'],
    },
    exportOptions: { endpoint: 'http://localhost:4318' },
  },
});
```

Class/method-level decorators for granular control:
- `@NoTrace()` — opt-out class or method
- `@Traced()` / `@Spanned()` — manual trace (overrides `@NoTrace` on class)
- `@TraceAll()` is **inert**. The application wires auto-tracing only when `tracing.traceAll: true` is already
  set (`OneBunModule.create` receives `undefined` otherwise, and every `shouldAutoTrace` call is behind that
  guard), so the decorator can never opt a class in — and with `traceAll: true` it changes nothing. To trace a
  subset, use `traceAll: true` plus `traceFilter.includeClasses`.

Priority: method > class > global config — in the opt-out direction only; class-level opt-in does not work.

Built-in exclusions (never auto-traced) — this is the complete `EXCLUDED_METHODS` set, there is no "etc.":
- `constructor`
- BaseService internals: `initializeService`, `runEffect`, `formatError`
- BaseController internals: `initializeController`, `isJson`, `parseJson`, `success`, `error`, `json`, `text`, `sse`
- Lifecycle hooks: `onModuleInit`, `onApplicationInit`, `onModuleDestroy`, `beforeApplicationDestroy`, `onApplicationDestroy`, `onQueueReady`
- Middleware: `use`, `configureMiddleware`
- WebSocket gateway: `_initializeBase`, `afterInit`, `handleConnection`, `handleDisconnect`
- The `span` getter on BaseService/BaseController

`getService` is deliberately absent and does not belong here: it is `OneBunApplication.getService()`, and
auto-trace only wraps service and controller instances, never the application object.

## OTLP Trace Export

Configured via `tracing.exportOptions.endpoint` in `ApplicationOptions`:

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    serviceVersion: '1.0.0',
    exportOptions: {
      endpoint: 'http://localhost:4318',  // OTel Collector OTLP HTTP
      headers: { 'Authorization': 'Bearer token' },
      batchSize: 100,       // NO OneBun default — omitted means 512, see below
      batchTimeout: 5000,   // effective default: 5000ms
      timeout: 10000,       // default: 10000ms
      retryAttempts: 3,     // retries after the first attempt (default: 3; 0 = at-most-once)
      retryDelay: 200,      // ms before the first retry, doubling, capped at 5000 (default: 200)
      retryBudget: 10000,   // ceiling on one batch's total export time (default: 10000ms)
    },
  },
});
```

Implementation details:
- Uses `BasicTracerProvider` from `@opentelemetry/sdk-trace-base` (NOT `sdk-trace-node`)
- Custom `OtlpFetchSpanExporter` using native `fetch()` for Bun compatibility
- `BatchSpanProcessor` handles batching; `OtlpFetchSpanExporter` handles retry. The processor splices a batch
  out of its buffer before calling the exporter, so a batch the exporter gives up on is gone — which is why
  the retry lives in the exporter and not above it.
  - Retried: transport failures (connection refused, DNS, TLS, the client-side timeout) and 408/429/500/502/
    503/504. `Retry-After` from the collector overrides the backoff.
  - Not retried: any other status. A 400 is rejected identically every time; a 401/403 does not become
    authorized by waiting.
  - `retryAttempts` (default 3), `retryDelay` (default 200ms, doubling, capped at 5000ms), `retryBudget`
    (default 10000ms) — the budget caps one batch's total export time including waits, and the processor's
    `exportTimeoutMillis` is derived from it so the two cannot disagree. `retryAttempts: 0` restores
    at-most-once delivery.
  - A batch that is finally abandoned raises `OtlpExportError` (carrying `spanCount` and `attempts`) and is
    reported through `exportOptions.onExportFailure`; `OneBunApplication` defaults that to a logger warning.
  - Retries never overlap — the exporter holds the one batch it is retrying — so a dead collector cannot
    accumulate in-flight copies. Overflow past that is dropped by the processor's own `maxQueueSize`.
  - The final flush in `app.stop()` is an ordinary export under the same budget, and each shutdown phase is
    guarded, so a collector that is down at shutdown no longer aborts the rest of the sequence.
  - A local OTel Collector agent (app → `localhost:4318` → backend) owning a durable retry queue is still the
    stronger setup for a remote/SaaS backend; the in-process retry covers a blip, not an outage.
- `batchSize` has **no framework default**: `initTracerProvider` forwards it as `maxExportBatchSize` with no
  fallback, so when you omit it the effective value is the SDK's own — `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` or
  **512**, not 100. Set it explicitly if 512 matters. (`batchTimeout` is forwarded the same way, but the SDK's
  own default is also 5000ms, so that number holds; `timeout` really does default to 10000ms in the exporter.)
- Provider registered globally via `trace.setGlobalTracerProvider()`
- On `app.stop()`, provider is shut down (flushes pending spans), then `trace.disable()` clears the global —
  not reached if that flush rejects

## OTLP Log Transport

Send logs to OTel Collector alongside console output:

```typescript
const app = new OneBunApplication(AppModule, {
  loggerOptions: {
    format: 'json',
    otlpEndpoint: 'http://localhost:4318',
    otlpHeaders: { 'Authorization': 'Bearer token' },
    otlpBatchSize: 100,       // default: 100
    otlpBatchTimeout: 5000,   // default: 5000ms
  },
  tracing: {
    serviceName: 'my-service',     // auto-used as OTLP resource attribute
    serviceVersion: '1.0.0',
  },
});
```

Key points:
- Uses native `fetch()` — no OTel SDK deps in `@onebun/logger`
- Logs sent to `{endpoint}/v1/logs` in OTLP JSON format
- `CompositeTransport` dispatches to both Console and OTLP
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT` enable OTLP logging **on their own**, with
  no `loggerOptions` at all: `OneBunApplication` always builds through `makeLoggerFromOptions()`. Priority is
  `loggerOptions.otlpEndpoint` > `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` > `OTEL_EXPORTER_OTLP_ENDPOINT`;
  `resolveOtlpLogEndpoint(options?)` is that resolution exported as a function.
  (Before this was fixed, the env path was inert — the app exported zero logs however the env was set, and the
  workaround was `loggerOptions: {}`. That workaround is now unnecessary, not wrong.)
- `service.name` / `service.version` land on **whichever** path enabled OTLP. Sources in order:
  `loggerOptions.otlpResourceAttributes` if you set it, else `tracing.serviceName` / `tracing.serviceVersion`,
  else `OTEL_SERVICE_NAME`, else `onebun-service` / `1.0.0` — the same fallbacks `initTracerProvider` uses, so
  logs and spans from an unconfigured service land under one name rather than two.
- `shutdownLogger()` flushes **every** transport built in the process, not only the most recent one. A
  multi-service application builds one logger per child; a single active-transport slot used to drop all but
  the last, leaving their flush timers rescheduling forever with nobody holding a reference.

LogLevel → OTLP severity mapping:
| LogLevel | OTLP SeverityNumber |
|---|---|
| Trace (10) | 1 |
| Debug (20) | 5 |
| Info (30) | 9 |
| Warning (40) | 13 |
| Error (50) | 17 |
| Fatal (60) | 21 |

## Full Observability Setup (Traces + Logs → SigNoz)

```typescript
const app = new OneBunApplication(AppModule, {
  envSchema,
  tracing: {
    enabled: true,
    serviceName: 'my-backend',
    serviceVersion: '1.0.0',
    traceHttpRequests: true,
    exportOptions: {
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
    },
  },
  loggerOptions: {
    format: process.env.LOG_FORMAT as 'json' | 'pretty' || 'pretty',
    defaultContext: { service: 'my-backend' },
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  },
  metrics: {
    enabled: true,
    path: '/metrics',
    prefix: 'myapp_',
    collectHttpMetrics: true,
  },
});
```

Note the asymmetry above: traces fall back to `'http://localhost:4318'`, logs do not. With
`OTEL_EXPORTER_OTLP_ENDPOINT` unset, `otlpEndpoint` is `undefined` and you get traces but no OTLP logs — give
the log endpoint the same `|| 'http://localhost:4318'` fallback if you want them to move together.

The `otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT` line is now redundant: drop `loggerOptions` entirely
and the same variable enables OTLP logging with the service attributes filled in from `tracing`. Keep it only
when the log endpoint differs from the trace endpoint.

Architecture:
```
Backend (Bun)
  ├── Traces (OTLP HTTP) ──→ OTel Collector (:4318) ──→ SigNoz/Jaeger
  ├── Logs (OTLP HTTP) ────→ OTel Collector (:4318) ──→ SigNoz/Loki
  └── Metrics (/metrics) ──→ OTel Collector (scrape) ──→ SigNoz/Prometheus
```

## Shutdown Order

`app.stop()`, single-app mode (multi-service mode just delegates to the orchestrator's `stopAll()`):

1. Drain in-flight HTTP requests, then close the listener — the socket deliberately stays open answering 503
   while draining, so a load balancer stops routing here and the deadline stays enforceable
2. `beforeApplicationDestroy(signal)` hooks
3. WebSocket cleanup
4. Queue service stop
5. Queue adapter disconnect
6. **Trace service shutdown** — flushes pending spans
7. `onModuleDestroy()` hooks
8. Shared Redis **release** — drops one refcounted lease; the client is disconnected only when the last
   consumer lets go. Not a `disconnect()`: an outright disconnect meant the first application to stop in
   multi-service mode tore the client out from under its still-running siblings
9. `onApplicationDestroy(signal)` hooks
10. DI scope disposal (after every destroy hook, so hooks can still read service instances), then the final
    "application stopped" log line
11. **Logger shutdown** — flushes pending OTLP log batches (LAST)

The trace flush is step 6, not step 2 — spans emitted from `beforeApplicationDestroy` and from the
queue/WebSocket teardown are still captured. Anything traced from `onModuleDestroy` onward is not: put
span-producing cleanup in `beforeApplicationDestroy`, not in the later hooks.

Every step is individually guarded, so one that rejects does not cancel the rest. A failing step-6 flush
against an unreachable collector is logged as `Shutdown step "flushing traces" failed` and steps 7–11 still
run, `shutdownLogger()` among them. A summary line names every phase that failed. `app.stop()` resolves
either way — it never throws.

This changed: the sequence used to be a chain of bare awaits, so the first rejection abandoned everything
after it and the only trace was one `Shutdown sequence failed` line. The step most likely to reject is the
one whose collector is going down with the pod, which made it the common case rather than an edge one.