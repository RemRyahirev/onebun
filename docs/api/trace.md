---
description: "Distributed tracing with @Span decorator. TraceService, W3C trace context, span attributes, OpenTelemetry-compatible export."
---

# Tracing API

Package: `@onebun/trace`

## Overview

OneBun provides OpenTelemetry-compatible distributed tracing with:
- Automatic HTTP request tracing
- Context propagation between services
- Custom span creation
- Integration with logging

## Enabling Tracing

### In Application

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    serviceVersion: '1.0.0',
    samplingRate: 1.0,  // 100% of requests
    traceHttpRequests: true,
    traceDatabaseQueries: true,
    defaultAttributes: {
      'service.name': 'my-service',
      'deployment.environment': process.env.NODE_ENV,
    },
  },
});
```

### Configuration Options

```typescript
interface TracingOptions {
  /** Enable/disable tracing (default: true) */
  enabled?: boolean;

  /** Service name for traces (default: 'onebun-service') */
  serviceName?: string;

  /** Service version (default: '1.0.0') */
  serviceVersion?: string;

  /** Sampling rate 0.0-1.0 (default: 1.0) */
  samplingRate?: number;

  /** Auto-trace HTTP requests (default: true) */
  traceHttpRequests?: boolean;

  /** Auto-trace database queries (default: true) */
  traceDatabaseQueries?: boolean;

  /** Default span attributes */
  defaultAttributes?: Record<string, string | number | boolean>;

  /** Export configuration */
  exportOptions?: {
    endpoint?: string;
    headers?: Record<string, string>;
    timeout?: number;
    batchSize?: number;
    batchTimeout?: number;
  };
}
```

## @Span() Decorator

Create trace spans for methods.

```typescript
import { Service, BaseService } from '@onebun/core';
import { Span, SpanAttribute } from '@onebun/trace';

@Service()
export class UserService extends BaseService {
  @Span('find-user-by-id')
  async findById(
    @SpanAttribute('user.id') id: string,
  ): Promise<User | null> {
    // This method execution is traced, id is auto-recorded as span attribute
    return this.repository.findById(id);
  }

  @Span()  // Uses method name as span name
  async processUser(user: User): Promise<void> {
    await this.validate(user);
    await this.save(user);
  }

  @Span('user-search')
  async search(
    @SpanAttribute('search.query') query: string,
  ): Promise<User[]> {
    const normalized = await this.normalizeQuery(query);
    // Add dynamic attributes via this.span
    this.span?.setAttribute('search.resultCount', normalized.length);
    return this.repository.search(normalized);
  }

  @Span('normalize-query')
  private async normalizeQuery(query: string): Promise<string> {
    return query.toLowerCase().trim();
  }
}
```

## @SpanAttribute() Decorator

Automatically records method arguments as span attributes. Works with `@Traced()`, `@Span()`, and auto-traced methods.

<!-- typecheck: skip -->
```typescript
@Traced('order.create')
async createOrder(
  @SpanAttribute('order.customerId') customerId: string,
  @SpanAttribute('order.total') total: number,
  @SpanAttribute('order.items') items: OrderItem[],  // objects → JSON.stringify
): Promise<Order> { ... }
```

Values are recorded as:
- `string`, `number`, `boolean` → recorded as-is
- Objects/arrays → `JSON.stringify`
- `undefined`/`null` → skipped

## this.span

`BaseService` and `BaseController` provide a `this.span` getter for imperative access to the active OpenTelemetry span. The API is fully synchronous.

```typescript
@Service()
export class OrderService extends BaseService {
  @Traced()
  async processOrder(orderId: string): Promise<Order> {
    const order = await this.repository.findById(orderId);

    // Set attributes dynamically
    this.span?.setAttribute('order.status', order.status);
    this.span?.setAttribute('order.total', order.total);

    // Add events
    this.span?.addEvent('validation.started');
    await this.validate(order);
    this.span?.addEvent('validation.completed');

    // Record exceptions without throwing
    if (order.hasWarnings) {
      this.span?.addEvent('order.warnings', {
        count: order.warnings.length,
      });
    }

    return order;
  }
}
```

Returns `undefined` when no span is active (outside `@Traced` context).

The getter reads the *innermost* open span, which is what [Span Nesting](#span-nesting) makes
meaningful: inside `@Traced` it is that method's span, and in a plain method called during a request
with an exporter configured it is the HTTP span. Anything you write through it lands on the span that
is exported.

## Trace Context

### Automatic HTTP Context

Trace context is automatically extracted from and propagated via HTTP headers:

```
traceparent: 00-abc123def456789-span123-01
tracestate: onebun=true
x-trace-id: abc123def456789
x-span-id: span123
```

### Accessing Current Context

`getCurrentTraceContext()` answers with the trace the calling code is running in, or `null` when
it is not running in one:

```typescript
import { BaseService, getCurrentTraceContext, Service } from '@onebun/core';

@Service()
export class MyService extends BaseService {
  async doSomething(): Promise<void> {
    const context = getCurrentTraceContext();

    if (context) {
      this.logger.info('Current trace', {
        traceId: context.traceId,
        spanId: context.spanId,
      });
    }
  }
}
```

It resolves from the OpenTelemetry active span first and from the request scope second, so it
answers the same way inside an HTTP request, inside a `@Traced` or `@Span` method, and inside a
queue handler, a scheduled job or a WebSocket callback — which have no request scope at all. It
is also what the framework's own logger and its outgoing `traceparent` header use, so the three
can never name different spans.

::: warning It used to read a process global
This section showed `(globalThis as any).__onebunTraceService` and called
`traceService.getCurrentTraceContext()` — a method that does not exist; the trace service spells
it `getCurrentContext()`, and that one reads a fiber-local value which a fresh
`Effect.runPromise` cannot see anyway. Anything copied from the old snippet returned `undefined`
or `null` every time. The global is also written once per application and never cleared, so in a
process running several the last one constructed wins it.
:::

### Context Propagation

A call made while handling a request carries that request's trace:

```typescript
import { createHttpClient } from '@onebun/core';

const client = createHttpClient({
  baseUrl: 'http://other-service:3000',
});

// Sends `traceparent`, plus `X-Trace-Id` and `X-Span-Id`
const response = await client.get('/api/data');
```

Three headers go out, and they are the whole of what is propagated:

| Header | Value |
| --- | --- |
| `traceparent` | `00-<trace-id>-<parent-id>-<flags>`, W3C Trace Context. The only one a collector, a service mesh or a non-OneBun peer understands. |
| `X-Trace-Id` | The trace id, for anything already reading it. |
| `X-Span-Id` | The parent span id. Sent **with** `X-Trace-Id`, never without: a lone trace id joins nothing, because the receiver needs both. |

The parent id is the innermost open span — a call made inside a `@Traced` method hangs off that
method, not off the request. `traceFlags` carries this request's sampling decision, so a downstream
service inherits it instead of being told everything is sampled.

Nothing is sent when there is no trace to join — startup code, or any handler running with
tracing disabled — and nothing is sent when the ids are not well-formed. A cron tick, a queue
handler and a WebSocket frame each open a span of their own, so a call made from one of them does
carry a header, naming that unit of work as the parent. A malformed `traceparent` can get a request
rejected outright, so no header is the safer failure.

Suppress it with `tracing: false`, on the client or on one call:

<!-- typecheck: skip -->
```typescript
const client = createHttpClient({ baseUrl: '…', tracing: false });   // never propagate
await client.get('/api/data', { tracing: false });                   // just this call
```

The receiving side honours it: the callee starts its HTTP span as a child of the span named in the
header, so the two services share one trace in the backend as well as one trace id in the logs.

::: tip What the callee's log lines say
`getCurrentTraceContext()` on the receiving side reports the **callee's own** span: the caller's
`traceId` continued, a fresh `spanId`, and the caller's span as `parentSpanId`. So a log line joins
to the span that emitted it, and one hop up is readable without opening the trace.

It used to report the inbound span id verbatim, which stamped every line from the callee with a
span living in the calling service — click it in a backend and you land in the caller.
:::

Outside an application — a standalone `createHttpClient()` with no `OneBunApplication` in the
process — there is no ambient context to read, and nothing is propagated. Register your own source
if you need one:

<!-- typecheck: skip -->
```typescript
import { setTraceContextProvider } from '@onebun/requests';

setTraceContextProvider(() => ({ traceId, spanId, traceFlags: 1 }));
```

The provider returns an `OutgoingTraceContext` — `{ traceId, spanId, traceFlags? }` — or `null`.
`@onebun/requests` has no `@onebun/*` and no OpenTelemetry dependencies (core depends on requests,
not the reverse), so three plain fields are what crosses the seam; `formatTraceparent` renders them.
A provider that throws, or that answers with ids the W3C format cannot express, drops the headers
rather than sending something malformed.

## Manual Span Creation

::: warning `__onebunTraceService` is one slot for the whole process
The snippets below reach the trace service through `globalThis.__onebunTraceService`. It is
written once per application and never cleared, so in a process running several applications —
multi-service mode — the **last one constructed** wins it, and a service belonging to any other
application would be recording spans through a sibling's trace service.

Prefer `@Span` / `@Traced`, which record on the right application's provider automatically, and
`getCurrentTraceContext()` for reading ids. Use the global only in a single-application process,
and knowing that it is one.
:::

```typescript
@Service()
export class OrderService extends BaseService {
  private traceService: any;

  constructor() {
    super();
    this.traceService = (globalThis as any).__onebunTraceService;
  }

  async processOrder(orderId: string): Promise<Order> {
    if (!this.traceService) {
      return this.doProcess(orderId);
    }

    // Start a span manually
    const span = await Effect.runPromise(
      this.traceService.startSpan('process-order', {
        orderId,
        operation: 'processOrder',
      })
    );

    try {
      // Add events during processing
      await Effect.runPromise(
        this.traceService.addEvent('validation-started')
      );

      await this.validateOrder(orderId);

      await Effect.runPromise(
        this.traceService.addEvent('validation-completed')
      );

      // Process the order
      const order = await this.doProcess(orderId);

      // Add attributes
      await Effect.runPromise(
        this.traceService.setAttributes({
          'order.status': order.status,
          'order.total': order.total,
        })
      );

      return order;
    } catch (error) {
      // Record error in span
      await Effect.runPromise(
        this.traceService.addEvent('error', {
          errorType: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      );
      throw error;
    } finally {
      // End the span
      await Effect.runPromise(
        this.traceService.endSpan(span)
      );
    }
  }
}
```

## Trace-Log Integration

Logs automatically include trace context:

```json
{
  "level": "info",
  "message": "Processing order",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "context": {
    "orderId": "abc-123"
  },
  "trace": {
    "traceId": "abc123def456789",
    "spanId": "span456",
    "parentSpanId": "span123"
  }
}
```

## Exporting Traces

OneBun exports traces via OTLP HTTP using a custom `fetch()`-based exporter (guaranteed Bun compatibility). When `exportOptions.endpoint` is configured, a `BasicTracerProvider` with `BatchSpanProcessor` is automatically registered.

`samplingRate` decides what is exported: it is wired into the provider's sampler, parent-based, so
a trace is sampled once at its root and its children follow that decision rather than each rolling
the dice and leaving the trace full of holes. Every request still gets a trace id for log
correlation, whether or not its span is exported.

Because the decision is made at the root and inherited, `samplingRate: 0.1` now means one request in
ten with all of its spans — not one span in ten. Re-check the number against your ingest volume if
you set it while spans were still arriving flat.

### Span Nesting

Spans nest. A request arrives as one trace: the HTTP span is the root, and every `@Traced` method,
`@Span()` method and auto-traced method called while handling it is a child. `trace.getActiveSpan()`
— and so `this.span` on a `BaseService` or `BaseController` — resolves to the innermost open span.

`OneBunContextManager`, an OpenTelemetry `ContextManager` over `AsyncLocalStorage`, is installed by
`installContextManager()` when tracing starts. It is a process-global slot, and the same rule applies
as for the tracer provider: if a manager is already registered — your own OpenTelemetry SDK, or
another library — OneBun leaves it alone and uses it. Shutdown removes only a manager OneBun
installed, and only once the last application using it stops.

The HTTP span is promoted into the request's scope by `activateSpanInCurrentScope`, rather than the
request body being nested inside another callback: the span is created several statements after the
scope is entered, and wrapping the whole request to make it active would cost a closure on a hot
path for nothing.

::: warning Background work is deliberately re-rooted
An `AsyncLocalStorage` context follows the async call graph, and that graph is not causality. A
`setTimeout` armed during a request keeps the request's context; so does a socket callback registered
at upgrade, and a queue handler reached from a publish that happened mid-request. Left alone, a cron
job would appear as a child of a request that finished days ago, and would keep appearing under it
for the life of the process — a trace that grows without bound and names the wrong cause.

So three boundaries start a fresh trace on purpose: **scheduled jobs** (`@Cron`, `@Interval`,
`@Timeout`), **queue message delivery** in every adapter, and **WebSocket callbacks** (`open`,
`message`, `close`, `drain`). Each request is re-rooted too, because Bun reuses a keep-alive
connection's async context and the second request would otherwise be filed under the first.

Fresh trace, not *no* trace. Each of those boundaries opens a span of its own — `queue <pattern>`,
`cron <name>`, `interval <name>`, `timeout <name>`, `ws open`, `ws message`, `ws close` — for the
same reason an HTTP request gets one: a log line can only name a span that exists. Re-rooting alone
left background handlers with none, so every line they wrote carried no trace id at all and there
was no way to follow a request into the work it queued.

Two frames deliberately get no span: the raw `message` callback, because every Engine.IO heartbeat
arrives through it, and `drain`. The frames that reach your handlers get theirs one level in.

Each kind has its own switch, alongside `traceHttpRequests`: `tracing.traceQueueMessages`,
`tracing.traceScheduledJobs` and `tracing.traceWebSocketEvents`, all `true` by default. A busy
consumer and a once-a-day cron are different decisions, so they are different keys. Setting one to
`false` returns those handlers to logging without a trace id; `@Traced` methods inside them still
get their own spans.

`inRootTraceScope(fn)` from `@onebun/core` is what re-roots, and `inEntrySpan(name, fn, tracer)`
is re-rooting plus the span. Both are exported so your own background work can do the same:

<!-- typecheck: skip -->
```typescript
setInterval(() => {
  void inRootTraceScope(async () => {
    await this.reconcile();   // its own trace, not a child of whatever armed the timer
  });
}, 60_000);
```

A queue message is the exception, and it does not need doing by hand: `publish()` stamps the
publisher's trace onto `metadata`, and the delivery starts its span as a child of it. So a message
and the work that sent it are one trace across the re-root. For any other background work you
schedule yourself, carry the ids and pass them as `inEntrySpan`'s `parent` — a deliberate
reference, not an accident of scheduling.
:::

An inbound `traceparent` continues the caller's trace: the request's HTTP span is started as a child
of the span the header names, marked as a remote parent, so two services produce one trace and not
two. A malformed or all-zero inbound context starts a fresh root instead — a span parented to
garbage belongs to a trace that can never be assembled.

One case still produces a root span, by design: with no `exportOptions.endpoint`,
`startHttpTraceSync` takes a lightweight path that generates trace ids for log correlation without
creating an OpenTelemetry span, so there is no HTTP span for methods to hang off. Configure an
endpoint and the nesting appears.

A `TraceSpan` also carries the OpenTelemetry span it was started from under the `OTEL_SPAN` symbol
key. Ending depends on that field rather than on what happens to be active, so a span is finished the
way it was started even if something re-rooted the context in between. Treat the field as internal:
it is a symbol so that logging a span cannot serialize the exporter's credentials along with it.

### OTLP Exporter

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    serviceVersion: '1.0.0',
    exportOptions: {
      endpoint: 'http://localhost:4318',  // OTel Collector OTLP HTTP
      headers: {
        'Authorization': 'Bearer token',
      },
      timeout: 10000,    // request timeout (default: 10000ms)
      batchSize: 100,     // spans per batch — see below, OneBun adds no default
      batchTimeout: 5000, // max wait before flush (default: 5000ms)
      retryAttempts: 3,   // retries after the first attempt (default: 3)
      retryDelay: 200,    // ms before the first retry, doubling (default: 200ms)
      retryBudget: 10000, // ceiling on one batch's total export time (default: 10000ms)
    },
  },
});
```

Traces are batched and sent to `{endpoint}/v1/traces` in OTLP JSON format.

`batchSize` and `batchTimeout` are forwarded to `BatchSpanProcessor` with **no OneBun default**, so
omitting them leaves the SDK's own: `batchSize` becomes `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` or **512**,
not 100. `batchTimeout` is forwarded the same way and the SDK's default is also 5000ms, so that
number holds either way. `timeout` really does default to 10000ms, in the exporter.

### Export Retry

`BatchSpanProcessor` removes a batch from its buffer before handing it to the exporter, so a batch
the exporter gives up on is gone — there is no queue it returns to. A collector redeploy or a
network blip would otherwise take every span in flight with it, silently.

So a failed export is retried:

- **Retried:** a transport failure (connection refused, DNS, TLS, the client-side timeout), and the
  statuses that mean "try again" — 408, 429, 500, 502, 503, 504. A `Retry-After` header from the
  collector overrides the backoff.
- **Not retried:** every other status. A 400 means the collector rejected the payload itself and
  will reject it identically; a 401 or 403 does not become authorized by waiting. Retrying those
  turns one lost batch into four and blocks the batches behind it.
- **Bounded:** `retryBudget` caps the total wall time one batch may spend being exported, waits
  included, and retries never overlap — the exporter holds the one batch it is retrying. This is
  also what keeps a dead collector from holding shutdown open, since the final flush is an ordinary
  export under the same budget. Overflow beyond that is dropped by `BatchSpanProcessor`'s own
  `maxQueueSize`, unchanged.

Set `retryAttempts: 0` for at-most-once delivery.

A batch that is finally abandoned is reported — `OneBunApplication` logs a warning naming the span
count and the attempt count. The failure itself is an `OtlpExportError` carrying `spanCount` and
`attempts`, so the size of the hole is available and not only the fact of one. Supply
`exportOptions.onExportFailure` to route it somewhere else:

<!-- typecheck: skip -->
```typescript
onExportFailure: (error, spanCount, attempts) => {
  metrics.counter('otlp_spans_dropped_total').inc(spanCount);
  logger.error(`OTLP gave up after ${attempts}: ${error.message}`);
},
```

::: tip What shutdown does to the process-global registration
OpenTelemetry keeps **one** tracer provider per process, and it refuses a duplicate
registration. So in a process running several applications, only the first one to start
actually installs its provider; the others create theirs and are quietly refused.

Shutdown accounts for that:

- **An application that did not install the global leaves it alone.** If you registered your
  own OpenTelemetry SDK before starting the app, stopping the app does not touch it. It used to:
  the teardown called `trace.disable()` unconditionally, which unregisters the global whoever
  put it there.
- **When the owner stops and another OneBun application is still running, the global is handed
  over to it.** Tracing keeps working for the survivors instead of going silently dark.
- **Only when the last one stops is the registration removed.** Leaving a shut-down provider
  installed would accept spans and drop them without a word.

The failure this replaces was quiet and total: one `app.stop()` left every other application in
the process resolving a non-recording tracer, so every subsequent span carried an all-zero trace
id, correlated with nothing and was never exported.

The registration is no longer what decides where an application's spans go. Every span the
framework creates comes from the application's OWN provider, so a guest application uses its own
endpoint and its own `service.name` even though the global slot belongs to the first starter —
see [Several applications in one process](#several-applications-in-one-process).
:::

### Several applications in one process

Multi-service mode runs several applications in one process and gives each its own
`serviceName`. That name reaches the backend:

<!-- typecheck: skip -->
```typescript
// Each service exports under its own identity, to its own endpoint if it has one.
const app = new MultiServiceApplication({
  services: {
    users: { module: UsersModule },
    orders: { module: OrdersModule },
  },
  tracing: { exportOptions: { endpoint: 'http://collector:4318/v1/traces' } },
});
```

Every span the framework creates is created from the owning application's provider: the HTTP
request span, the spans from `TraceService`, and the `@Traced` / `@Span` / auto-trace spans
reached from a request, a WebSocket callback, a queue message or a scheduled job. Which
application owns a piece of work travels in the OpenTelemetry context, alongside the parent
span, and is re-established at every boundary where work enters an application.

**What still resolves through the process-global provider**, because nothing can tell it which
application is asking:

- code that calls `trace.getTracer()` itself rather than using `@Traced` or `TraceService`;
- third-party instrumentation with its own tracer;
- a framework span created outside every entry boundary — during `start()` before the first
  request, for instance.

Those go to the first-registered provider, which is the behaviour that predates this and is
unchanged. `appTracer()` is the accessor the framework's own decorators use — it answers with
the owning application's tracer when there is one and falls back to the global otherwise — and
`runWithAppTracer(tracer, fn)` is what establishes ownership at a boundary. Both are exported
for code that needs to state ownership itself; neither is needed for ordinary use. In a single-application process it is that application's own provider, so nothing is
lost; in a multi-application process it is the first starter's.

::: tip Observing one application's spans
A processor registered on the process-global provider sees none of an application's spans, since
they come from its own. Pass `tracing.spanProcessors` to attach one to a specific application —
appended to whatever `exportOptions` produces:

```typescript
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

const options = {
  tracing: {
    serviceName: 'orders',
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  },
};
```

An application with a processor and no OTLP endpoint records real spans rather than taking the
lightweight path: the question is whether anything will see the span, not how it is shipped.
:::

<llm-only>

**Technical details for AI agents — the global tracer provider slot:**
- `initTracerProvider(options)` in `packages/trace/src/provider.ts` builds the `BasicTracerProvider`, registers it, and returns `{ provider, shutdown }`. `TraceServiceImpl` holds that result and calls `shutdown()` from `OneBunApplication.stop()`
- Ownership is recorded from the RETURN VALUE of `trace.setGlobalTracerProvider(provider)`, which is `false` when something already holds the slot. A successful registration means the slot was empty and is now ours, regardless of what the module remembered — an earlier draft also required the remembered owner to be `null`, which left a provider installed but unowned after any external `trace.disable()`, so its own shutdown declined to release it
- `installedTracerProvider()` is exported and re-derives ownership from reality: `trace.getTracerProvider()` returns a `ProxyTracerProvider` wrapper, so identity is read through its public `getDelegate()`. Shutdown releases the global only when the remembered owner AND the installed delegate are both this provider
- Teardown has three cases and only the last disables anything: not the owner -> touch nothing; owner with another live provider -> `trace.disable()` immediately followed by `setGlobalTracerProvider(successor)`, because a duplicate registration would be refused; owner with nothing left -> `trace.disable()`
- `shutdown()` is idempotent via a `shutdownStarted` flag, and removes the provider from the live set BEFORE flushing so a concurrent shutdown cannot elect a provider that is on its way down. `releaseGlobal` runs in a `finally`, because a failed flush is still a dead provider
- `enabled: false` builds no provider, and its tracer comes from a detached `new ProxyTracerProvider()` — NOT from `trace.getTracer()`. The global fallback made a switched-off service borrow whichever enabled sibling had installed the slot and record spans under that sibling's `service.name`; measured in one process, the same disabled service answered with a valid trace id after an enabled sibling was constructed and with the all-zero one when alone. A delegate-less `ProxyTracerProvider` resolves to the API's no-op tracer and cannot reach the global

</llm-only>

::: tip A failed flush no longer cancels the rest of the teardown
The flush runs after the queue adapter disconnects and before `onModuleDestroy`. If the collector
is unreachable while spans are still buffered — the usual case when it goes down with the pod —
the last batch export fails and the flush rejects.

Every step of the shutdown sequence is individually guarded, so that rejection is logged as
`Shutdown step "flushing traces" failed` and the teardown continues: `onModuleDestroy` and
`onApplicationDestroy` hooks run, the shared Redis lease is released, and the logger flushes. A
summary line names every phase that failed, so the tail of the log shows the whole picture rather
than whichever failure happened to be last. `app.stop()` resolves either way.

This used to abandon everything after the flush, with a single `Shutdown sequence failed` line as
the only trace — precisely the work graceful shutdown exists to do, skipped by the step most
likely to fail.

The shutdown order is: drain in-flight HTTP → `beforeApplicationDestroy` → WebSocket cleanup →
queue service → queue adapter → **trace flush** → `onModuleDestroy` → shared Redis release →
`onApplicationDestroy` → log flush.
:::

### SigNoz / OTel Collector Integration

```yaml
# docker-compose.yml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318"    # OTLP HTTP
    volumes:
      - ./otel-config.yaml:/etc/otel/config.yaml
```

### Jaeger Integration

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # UI
      - "4318:4318"    # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

### Custom Exporter

For advanced use cases, you can use the `OtlpFetchSpanExporter` directly:

```typescript
import { OtlpFetchSpanExporter } from '@onebun/trace';

const exporter = new OtlpFetchSpanExporter({
  endpoint: 'http://localhost:4318',
  headers: { 'X-Custom': 'value' },
  timeout: 5000,
});
```

## Auto-Tracing

Automatically trace all async methods on services and controllers without adding `@Traced()` to each method.

### Global Auto-Trace

```typescript
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'my-service',
    traceAll: true,  // ← all async methods auto-traced
    exportOptions: { endpoint: 'http://localhost:4318' },
  },
});
```

### Filtering

<!-- typecheck: skip -->
```typescript
tracing: {
  traceAll: true,
  traceFilter: {
    asyncOnly: true,             // default: only async methods
    excludeMethods: ['helper'],  // skip specific methods
    includeClasses: ['*Service', '*Repository'],  // only these
    excludeClasses: ['HealthController'],          // skip these
  },
}
```

### Class-Level Control

<!-- typecheck: skip -->
```typescript
import { TraceAll, NoTrace, Traced } from '@onebun/trace';

// Opt-out when traceAll is true
@Service()
@NoTrace()
class InternalService extends BaseService {
  async helper() { ... }   // NOT traced

  @Traced()
  async critical() { ... } // traced (method override)
}

// @TraceAll() never opts a class in — see the warning below
@Service()
@TraceAll()
class ImportantService extends BaseService {
  async findAll() { ... }  // NOT traced while traceAll is false
}
```

::: warning `@TraceAll()` cannot opt a class in
`@TraceAll()` has no effect today. The application hands auto-trace options to the module graph only when `traceAll: true`, and a class is inspected for `@TraceAll()` / `@NoTrace()` only when the module received those options — so with `traceAll: false` nothing is ever inspected, and with `traceAll: true` the class would have been traced anyway. To trace a subset, use `traceAll: true` narrowed by `traceFilter.includeClasses` / `excludeClasses`, or put `@Traced()` on the individual methods, which wraps at class-definition time and needs no wiring at all. `@NoTrace()` works as documented, because it only ever has to take effect while `traceAll` is true.
:::

### Priority

Method-level decorators always win over class-level. Class-level narrows the global setting but cannot widen it: `@NoTrace` takes a class out of `traceAll: true`, while `@TraceAll` cannot bring one into `traceAll: false`.

| Global | Class | Method | Result |
|--------|-------|--------|--------|
| `traceAll: true` | — | — | auto-traced |
| `traceAll: true` | `@NoTrace` | — | NOT traced |
| `traceAll: true` | `@NoTrace` | `@Traced` | traced |
| `traceAll: false` | `@TraceAll` | — | NOT traced (`@TraceAll` is never read) |
| `traceAll: false` | `@TraceAll` | `@Traced` | traced |
| any | — | `@Traced` | traced |

### Excluded Methods

These are never auto-traced (framework internals):
- Lifecycle hooks: `onModuleInit`, `onModuleDestroy`, etc.
- Base class methods: `success`, `error`, `json`, `text`, `sse`, etc.
- Constructor

## Sampling

Control what percentage of requests are traced:

<!-- typecheck: skip -->
```typescript
tracing: {
  // Sample 10% of requests in production
  samplingRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
}
```

## Best Practices

### 1. Meaningful Span Names

<!-- typecheck: skip -->
```typescript
// Good: descriptive, includes operation type
@Span('user-create')
@Span('order-process-payment')
@Span('cache-lookup')

// Bad: too generic
@Span('process')
@Span('do-thing')
```

### 2. Add Relevant Attributes

<!-- typecheck: skip -->
```typescript
@Span('user-find-by-id')
async findById(id: string): Promise<User | null> {
  // Add context that helps with debugging
  const traceService = (globalThis as any).__onebunTraceService;
  if (traceService) {
    await Effect.runPromise(
      traceService.setAttributes({
        'user.id': id,
        'db.system': 'postgresql',
        'db.operation': 'SELECT',
      })
    );
  }

  return this.repository.findById(id);
}
```

### 3. Trace Error Boundaries

<!-- typecheck: skip -->
```typescript
@Span('process-order')
async processOrder(orderId: string): Promise<Order> {
  try {
    return await this.doProcess(orderId);
  } catch (error) {
    // Trace service will record the error
    this.logger.error('Order processing failed', error);
    throw error;
  }
}
```

### 4. Don't Over-Trace

<!-- typecheck: skip -->
```typescript
// Good: trace business-significant operations
@Span('place-order')
async placeOrder(data: OrderData): Promise<Order> {}

// Avoid: tracing every tiny utility function
// @Span('format-date')  // Too granular
formatDate(date: Date): string {}
```

## Complete Example

```typescript
import { Module, Controller, BaseController, Service, BaseService, Get, Post, Param, Body, HttpException } from '@onebun/core';
import { Span } from '@onebun/trace';

// Service with comprehensive tracing
@Service()
export class OrderService extends BaseService {
  private traceService: any;

  constructor(
    private paymentService: PaymentService,
    private inventoryService: InventoryService,
  ) {
    super();
    this.traceService = (globalThis as any).__onebunTraceService;
  }

  @Span('order-create')
  async createOrder(data: CreateOrderDto): Promise<Order> {
    this.logger.info('Creating order', { customerId: data.customerId });

    // Validate items
    await this.validateItems(data.items);

    // Create order record
    const order = await this.repository.create(data);

    // Add trace attributes
    await this.addTraceAttributes({
      'order.id': order.id,
      'order.item_count': order.items.length,
      'order.total': order.total,
    });

    return order;
  }

  @Span('order-process-payment')
  async processPayment(orderId: string): Promise<PaymentResult> {
    const order = await this.repository.findById(orderId);

    // Nested traced call
    const result = await this.paymentService.charge({
      orderId,
      amount: order.total,
      currency: 'USD',
    });

    await this.addTraceEvent('payment-completed', {
      transactionId: result.transactionId,
      status: result.status,
    });

    return result;
  }

  @Span('order-validate-items')
  private async validateItems(items: OrderItem[]): Promise<void> {
    for (const item of items) {
      const available = await this.inventoryService.checkStock(item.productId);
      if (available < item.quantity) {
        await this.addTraceEvent('validation-failed', {
          productId: item.productId,
          requested: item.quantity,
          available,
        });
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }
    }

    await this.addTraceEvent('validation-passed', {
      itemCount: items.length,
    });
  }

  private async addTraceAttributes(attributes: Record<string, unknown>): Promise<void> {
    if (this.traceService) {
      await Effect.runPromise(
        this.traceService.setAttributes(attributes)
      );
    }
  }

  private async addTraceEvent(name: string, attributes?: Record<string, unknown>): Promise<void> {
    if (this.traceService) {
      await Effect.runPromise(
        this.traceService.addEvent(name, attributes)
      );
    }
  }
}

// Controller
@Controller('/orders')
export class OrderController extends BaseController {
  constructor(private orderService: OrderService) {
    super();
  }

  @Post('/')
  async create(@Body() body: CreateOrderDto) {
    const order = await this.orderService.createOrder(body);
    return this.success(order, 201);
  }

  @Post('/:id/pay')
  async pay(@Param('id') id: string) {
    return await this.orderService.processPayment(id);
  }
}

// Application with tracing
const app = new OneBunApplication(AppModule, {
  tracing: {
    enabled: true,
    serviceName: 'order-service',
    serviceVersion: '1.0.0',
    samplingRate: 1.0,
    defaultAttributes: {
      'service.name': 'order-service',
      'deployment.environment': process.env.NODE_ENV || 'development',
    },
    exportOptions: {
      endpoint: process.env.OTLP_ENDPOINT || 'http://jaeger:4318/v1/traces',
    },
  },
});
```
