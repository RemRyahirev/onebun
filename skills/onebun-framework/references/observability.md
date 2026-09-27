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

## Span Nesting and Context

OneBun installs its own `ContextManager` (`OneBunContextManager`, `AsyncLocalStorage`-backed) when tracing
starts, so spans nest: the HTTP span is the root of a request and every `@Traced`/`@Span`/auto-traced method
called while handling it is a child, sharing one trace id. `trace.getActiveSpan()` — and therefore `this.span`
on `BaseService` / `BaseController` — resolves to the innermost open span.

- **Ownership.** The context manager is a process-global slot, treated like the tracer provider: if one is
  already registered (a user's own SDK, another library), OneBun uses it and does not take the slot. Shutdown
  removes only a manager OneBun installed, refcounted so the first application to stop does not strip context
  from its siblings. Ownership is re-derived by probing the global, never remembered — `context.disable()` is a
  process-global wipe anyone can call.
- **Background work is re-rooted on purpose.** Context follows the async graph, which is not causality: a
  timer armed during a request keeps that request's context, and so do WebSocket callbacks registered at
  upgrade and queue handlers reached from a mid-request publish. Three boundaries call
  `inRootTraceScope()` from `@onebun/core` and start a fresh trace — scheduled jobs (`@Cron`/`@Interval`/
  `@Timeout`), queue message delivery in every adapter, WebSocket `open`/`message`/`close`/`drain`. Each
  request re-roots too, because Bun reuses a keep-alive connection's async context. Use `inRootTraceScope()`
  for your own background work; to link a job back to its cause, carry the trace ids in the message.
- **An inbound `traceparent` continues the caller's trace.** The HTTP span is started as a child of the span
  the header names, marked `isRemote`, so two services share one trace in the backend. A malformed or
  all-zero inbound context starts a fresh root — `Tracer.startSpan` discards a parent that fails
  `isSpanContextValid`, which is why there is no second copy of that check in OneBun.
- **Still flat with no `exportOptions.endpoint`**: the request takes the lightweight path and no HTTP span
  exists for methods to hang off.
- **A log line names the span it was written from.** `getCurrentTraceContext()` resolves from the
  OpenTelemetry active span first and the request scope second — the same order the outgoing `traceparent`
  uses, so logs, spans and propagated headers can never name different spans. Consequences worth knowing:
  a line logged inside a `@Traced`/`@Span` method carries THAT method's `spanId`, not the request's; a
  callee's lines carry the callee's span rather than the caller's; and queue handlers, `@Cron` jobs and
  WebSocket callbacks — which have no request scope at all — carry a trace id whenever a span is open,
  which is whenever the handler is traced.
  Two defects used to sit here. The request scope was filled with a context minted separately from the span,
  so every HTTP log line named a trace that existed nowhere (measured: span on `4074598c…`, logs on
  `38b97f3e…`). And the fallback meant to cover the non-HTTP contexts guarded on `getCurrentTraceContext`, a
  method the trace service does not have — it is `getCurrentContext` — so it never fired.
- **Sampling reads differently now.** The sampler is `ParentBased`, so the decision is made once at the root
  and inherited: `samplingRate: 0.1` means one request in ten with all of its spans, not one span in ten.

## Outgoing Trace Propagation

A call made through `@onebun/requests` while handling a request carries that request's trace. Three headers:
`traceparent` (W3C, the only one a collector or non-OneBun peer understands), plus `X-Trace-Id` and
`X-Span-Id` **together** — a lone trace id joins nothing, because the receiver's `extractFromHeadersSync`
needs both or a `traceparent`.

- The parent id is the innermost open span, so a call from inside a `@Traced` method hangs off that method
  rather than off the request. `traceFlags` carries the request's sampling decision.
- Nothing is sent outside a request scope (startup, cron, queue handler), or when the ids are unusable —
  a malformed `traceparent` can get the request rejected outright, so no header is the safer failure.
- Suppress with `tracing: false` on the client or on one call.
- `@onebun/requests` has no `@onebun/*` dependencies (core depends on it, not the reverse), so the seam is
  `setTraceContextProvider()`, which `OneBunApplication` registers at construction. Outside an application,
  register your own or nothing propagates. It used to be `globalThis.__onebunCurrentTraceContext`, which
  nothing ever assigned — so every outgoing call went out untraced, silently, and one global cell would
  have been the wrong shape anyway with concurrent requests.
- `client.get(url, { tracing: false })` reaches the config arm of the overload, and so do `delete`, `head`
  and `options` — the four share one resolver (`resolveQueryOverload` in `client.ts`, also used by the
  `RequestsService` layer). Up to 0.8.1 the other three kept an inline four-name list, so
  `delete(url, { tracing: false })` sent `?tracing=false` with the trace headers still attached. The markers
  are `method`/`headers`/`timeout`/`auth`/`tracing`/`metrics`/`maxResponseBytes`; `retries`, `query` and
  `redirect` are deliberately excluded (`get('/login', { redirect: '/home' })` is query data, even though
  `redirect` is also the redirect-policy config key), so a config holding only those takes the
  three-argument form: `get(url, undefined, { redirect: 'error' })`. A third argument always makes the second the query, `undefined`
  included: `get(url, undefined, config)` applies `config` (up to 0.8.1 it was dropped).
- **HEAD, 204 and 304 answers are not parsed**: `result` is `undefined` and `statusCode` says which arrived,
  whatever the `content-type`. A 304 resolves as a success. Up to 0.8.1 `client.head()` failed with
  `RESPONSE_PARSE_ERROR` against every JSON endpoint (Bun keeps `application/json` on the HEAD answer).
- **Success headers**: `SuccessResponse.headers` is the upstream's response headers (final hop after
  redirects), names lower-cased, a repeated header joined with `, ` as `Headers.get()` does — `set-cookie`
  too, so it cannot be split back reliably. Read `head.headers?.etag`, `created.headers?.location`. It is
  **non-enumerable**: `JSON.stringify`, `Object.keys`, a spread and `structuredClone` skip it, so a controller
  returning the client envelope verbatim does NOT forward upstream `set-cookie`/`server` in its body (either
  dispatch arm). The flip side: `{ ...response }` loses it — read it before copying, and never spread it back
  in to "keep" it (that makes it serializable again). `toEqual` ignores it; assert the header directly.
  `Bun.inspect`, `console.log` and `toMatchSnapshot` DO show it (`set-cookie`, `date`): log or snapshot
  `{ ...response }` or the fields you need. `RequestsService` returns `result` only (no headers);
  `HttpClient` and the service client carry them. Up to 0.8.2 a success had no headers at all.
- **An `HTTP_ERROR`'s `details.headers` is a different record**: enumerable, and a repeated `set-cookie` keeps
  only its last value. The error object keeps it, `details.url` and the upstream body; the default exception
  filter leaves those out of the caller's body when a client error escapes a controller (`withoutTransportDetails`,
  docs/api/requests.md#uncaught-client-errors), and `exposeErrorDetails` sends them. A copy of the record
  (`{ ...e.details }`) is not the client's and is sent whole.
- **`timeout` covers the body, not just the headers.** A body that stalls past it fails `TIMEOUT_ERROR`,
  `code: 0`, `getTransportFailureKind(e) === 'timeout'`, with the status that arrived in
  `details.statusCode` and `details.phase: 'body'`. So a stalled 5xx follows `retryOnTimeout` (off by
  default), not `retryOn`; a 5xx that arrives whole, even with an unparsable body, still follows `retryOn`.
  Up to 0.8.1 it was `RESPONSE_READ_ERROR`/`RESPONSE_PARSE_ERROR` with the status as `code`. Detect a slow
  upstream by the transport kind, never by those names.
- **Interrupting a `*Effect` call aborts the fetch** (`Effect.timeout`, `Effect.race`, `Fiber.interrupt`),
  in either phase; the upstream sees the close at once. Up to 0.8.1 the fetch ran on until the client's own
  `timeout`. The interrupted Effect reports the interruption, not an `ErrorResponse`.
- **Redirects are followed by the client, not by `fetch`** (`redirect: 'manual'` per hop): 301/302/303/307/308,
  up to 20, `Location` resolved against the URL that answered. Methods change as in `fetch` (301/302 POST and
  303 non-HEAD become a body-less GET without `Content-Type`; 307/308 keep method and body bytes). One
  `timeout`, one abort signal and one metrics record cover the whole chain. A **same-origin** hop (scheme +
  host + port) keeps every header. Under `onebun` auth WITH an `audience` it is re-signed over its own
  method/URL/body (fresh ts + nonce), so it verifies at the target; WITHOUT an audience (or `audience: ''`)
  it carries the original signature and the callee rejects it with `signature-mismatch` (re-signing hands
  the redirecting server a fresh signature for a path of its choosing; the audience confines it to that
  callee). A hop to **any other origin** carries only `User-Agent`, `Accept`, `Accept-Encoding`,
  `traceparent`, `X-Trace-Id`, `X-Span-Id`, plus `Content-Type` while a body goes along; `127.0.0.1` and
  `localhost` are different origins, and a dropped header never comes back later in the chain. So no auth
  (bearer, basic, apikey header, custom, onebun) and no header from `RequestsOptions.headers`/`config.headers`
  reaches another origin — if it needs credentials, give it its own client. Up to 0.8.1 `fetch` followed and
  stripped only `Authorization`/`Cookie`/`Proxy-Authorization`: the apikey header, custom auth headers, the
  HMAC signature and caller headers leaked. A loop (21st redirect), a missing `Location` or a non-http(s) one
  fails `REDIRECT_ERROR` with `code` = that 3xx and `details.reason`
  `'too-many-redirects' | 'missing-location' | 'invalid-location'`; it is never retried, whatever `retryOn`
  says (0.8.1: `FETCH_ERROR` replayed by `retryOnNetworkError` — Bun's own cap is 127 hops, so a loop cost
  508 requests — or `HTTP_ERROR` 3xx). No signature is ever made for another origin, nor for a hop back on
  the first origin after one.
- **Redirect policy** `redirect: 'follow' | 'error' | 'manual'` (type `RedirectPolicy`) on `RequestsOptions`
  and per request (`config.redirect` wins; `undefined` = not set; default `'follow'`). Applies only to
  301/302/303/307/308 — a 300 or 304 is treated the same under every policy. `'error'`: `REDIRECT_ERROR`,
  `code` = the 3xx, `details { reason: 'refused-by-policy', status, location?, url, redirects: 0 }`, the
  `Location` never contacted (a POST 307 is not re-sent anywhere), never retried. `'manual'`: resolves a
  success with `statusCode` = the 3xx and `headers.location` exactly as sent (relative stays relative), the
  3xx body read as usual (under `maxResponseBytes` too; an empty body with `Content-Type: application/json`
  resolves `result: undefined` so the `Location` survives — a 200/300 like that is still
  `RESPONSE_PARSE_ERROR`), metrics record the 3xx with `success: true`; `req()` returns the 3xx body.
  `RequestsService` returns `result` alone, so under `'manual'` it yields only the 3xx body — no status, no
  `Location`: read redirects through `HttpClient` (or the service client, which returns the envelope).
  `RequestsService` fails a refused redirect with a `OneBunBaseError` (`code` 500 as for every non-mapped
  status, the 3xx in `details.status`). Up to 0.8.2 every redirect was followed.
- **`maxResponseBytes` caps the DECODED body while it is read** (client option, or per request; the request's
  wins, `Infinity` is the same as unset — that request takes `fetch`'s path). Off by default — an uncapped
  request keeps `fetch`'s path exactly. Set, the request goes out with `decompress: false` and
  `Accept-Encoding: gzip, deflate, br, zstd` (unless the caller set one), and the client undoes
  gzip/x-gzip/deflate (zlib or raw)/br/zstd itself through `DecompressionStream`, counting decoded bytes chunk
  by chunk — Bun's own decompression inflates a whole chunk first (a 130 KB gzip bomb became one 130 MB
  chunk, +139 MB RSS), so a cap on top of `fetch` bounds nothing. Past the cap:
  `RESPONSE_TOO_LARGE`, `code` = the status that arrived, `details: { limit, received, statusCode,
  contentLength? }` (`contentLength` + `received: 0` when an uncompressed body's `Content-Length` was refused
  before reading), no body in it, connection closed and the upstream stream cancelled. Error statuses are read
  under the same cap (a fitting 500 is still `HTTP_ERROR` with `details.details`). An unknown coding or a
  corrupt body: `RESPONSE_DECODE_ERROR`, `details.reason` `'unsupported-encoding' | 'corrupt-body'`,
  `details.encoding`. `corrupt-body` includes bytes after the end of the compressed stream, which `fetch`
  drops (all codings but zstd) and `DecompressionStream` rejects. Both are never retried, whatever `retryOn`
  lists — a 5xx included, so a broken gzip 503 that `retryOn: [503]` replays uncapped (as
  `RESPONSE_READ_ERROR`) is sent once capped; a connection closing mid-body stays `RESPONSE_READ_ERROR` and
  follows `retryOn`. A body-phase timeout under a cap is still `TIMEOUT_ERROR`/`phase: 'body'`. When the client
  decoded the body, both a success's `headers` and an `HTTP_ERROR`'s `details.headers` omit
  `content-encoding`/`content-length`. Costs ~20% throughput on small gzip JSON, which is why
  there is no default cap before 1.0. A `NaN` cap refuses every non-empty body.
- `FETCH_ERROR` (`'network'`) is not proof the request never arrived: a reset after sending (`ECONNRESET`)
  lands there too, and `retryOnNetworkError` replays it for every method in `retries.methods`.
- **The receiving side honours it**: the callee starts its HTTP span as a child of the span the header
  names, so the two services share one trace in the backend as well as one trace id in the logs. The one
  remaining gap is the callee's log `spanId` — see the Span Nesting section.
- **The outgoing metric records the real upstream status.** `onebun_http_requests_total` used to label every
  success `status_code="200"` (`result.success ? HttpStatusCode.OK : result.code`), so 201, 202 and 204 were
  all reported as 200 and an alert on non-200 responses never fired. `SuccessResponse.statusCode` now carries
  what the upstream returned, and the label is derived from it.

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
- Each application builds its OWN provider and creates every framework span from it — the HTTP request span,
  `TraceService` spans, and `@Traced`/`@Span`/auto-trace spans reached from a request, a WebSocket callback, a
  queue message or a scheduled job. The provider is ALSO registered globally via
  `trace.setGlobalTracerProvider()`, but that registration is best-effort: OpenTelemetry keeps one per process
  and refuses a duplicate, so only the first application to start wins it
- **In a process running several applications** — multi-service mode, where the orchestrator gives each
  service its own `serviceName` — the framework's own spans still carry the right `service.name` and go to the
  right endpoint. Which application owns a piece of work travels in the OpenTelemetry context alongside the
  parent span, established at each boundary where work enters an application. What still resolves through the
  global slot: `trace.getTracer()` called by user code, third-party instrumentation, and framework spans
  created outside every boundary (during `start()`, for instance). Those go to the first starter's provider
- `tracing.spanProcessors` attaches a processor to THIS application's provider, appended to whatever
  `exportOptions` produces. A processor on the process-global provider sees none of an application's spans.
  An application with a processor and no OTLP endpoint records real spans rather than taking the lightweight
  path — the question is whether anything will see the span, not how it is shipped. `app.stop()` shuts the
  processors down with the provider; a FAILED `start()` does not — its rollback calls
  `traceService.shutdown({ spanProcessors: 'flush' })` (`TraceShutdownOptions`), which flushes them, shuts down
  only the exporter built from `exportOptions` and hands back the global slot, so the next attempt built from
  the same options still records into them. A `stop()` after that failed start still shuts them down: a plain
  `shutdown()` after a `'flush'` one shuts down exactly what the flush left running
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
  `shutdownLoggerLayer(layer)` closes only the transport of that `makeLoggerFromOptions()` layer (a separate
  function, so `shutdownLogger` keeps its zero-argument signature and still works point-free). A failed
  `app.start()` uses it for the logger the application built, so a `loggerLayer` passed in options (built once,
  shared across retry attempts) and a multi-service sibling's logger keep exporting; `app.stop()` — including a
  `stop()` after a failed start — still closes them all. A `loggerLayer` you built with OTLP holds the process
  open via its flush timer until one of those runs.
- **Delivery failures are inspected.** `flush()` never looked at the response, so a 503, a 404 and a success
  were indistinguishable and a misconfigured endpoint swallowed every line. Now: transport failures and
  408/429/500/502/503/504 put the batch back at the head of the buffer for the next flush; any other status
  discards it (a 400 will be refused identically); `otlpMaxBufferedRecords` (default 1000) caps what is held,
  dropping oldest first; every loss goes to `otlpOnExportFailure`, which defaults to stderr — it cannot go
  through the logger, which would feed the transport that just failed.

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