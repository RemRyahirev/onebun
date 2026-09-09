/**
 * Each application's spans go to ITS collector, under ITS service name.
 *
 * OpenTelemetry keeps one tracer provider per process and refuses a duplicate registration, so
 * in a process running several applications only the first installs its own. Every later
 * application built a provider — with its own OTLP endpoint and its own `service.name` resource
 * — and then never used it: the framework resolved every tracer through the process-global
 * slot. Measured before the fix, with two applications named `users` and `orders`: each own
 * provider reported its own name, the global reported `users` for both.
 *
 * That is the framework's own multi-service mode, where the orchestrator sets
 * `tracing.serviceName` per service, so it is not an exotic configuration. The consequences
 * were silent: one service on the backend's map instead of two, per-service dashboards
 * attributing the guest's work to the host, and a query for the guest returning nothing — while
 * the spans did arrive and the traces were complete.
 *
 * These cases assert against two SEPARATE collector stubs, because "went to the right place" is
 * the claim, and only a real endpoint can answer it.
 */

import { context as otelContext, trace as otelTrace } from '@opentelemetry/api';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect } from 'effect';

import { appTracer } from '../src/app-tracer';
import {
  makeTraceService,
  runWithAppTracer,
  TraceService,
  type TraceServiceImpl,
} from '../src/index';

/** One OTLP collector, remembering the service names of everything posted to it. */
interface Collector {
  url: string;
  serviceNames(): string[];
  stop(): Promise<void>;
}

/**
 * A stub that speaks just enough OTLP/HTTP-JSON to answer "which service sent this".
 *
 * The exporter posts `{ resourceSpans: [{ resource: { attributes: [...] }, ... }] }`, so the
 * service name is a resource attribute rather than a span field — which is the whole point:
 * the resource is built per provider, and the bug was that a guest's provider never ran.
 */
async function startCollector(): Promise<Collector> {
  const seen: string[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.json() as {
        resourceSpans?: Array<{
          resource?: { attributes?: Array<{ key: string; value?: { stringValue?: string } }> };
        }>;
      };

      for (const resourceSpan of body.resourceSpans ?? []) {
        const name = resourceSpan.resource?.attributes
          ?.find(attribute => attribute.key === 'service.name')?.value?.stringValue;

        if (name !== undefined) {
          seen.push(name);
        }
      }

      return new Response('{}', { status: 200 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/v1/traces`,
    serviceNames: () => [...seen],
    async stop() {
      await server.stop(true);
    },
  };
}

/**
 * Wait for ANY batch to land, then let the assertion say which collector got it.
 *
 * Deliberately not "wait for the collector I expect": under the regression these tests exist
 * for, the batch goes to the OTHER collector, so a poll on the expected one could never hold
 * and the case would fail as a five-second timeout instead of as `['users'] !== ['orders']`.
 * Poll only for the part that is genuinely asynchronous — that a POST happened at all.
 */
async function anyBatchLands(label: string, ms: number, holds: () => boolean): Promise<void> {
  const deadline = Date.now() + ms;

  while (!holds()) {
    if (Date.now() > deadline) {
      throw new Error(`${label} did not hold within ${ms}ms`);
    }
    await Bun.sleep(10);
  }
}

function makeService(serviceName: string, endpoint: string): TraceServiceImpl {
  return Effect.runSync(Effect.provide(
    TraceService,
    makeTraceService({
      enabled: true,
      serviceName,
      exportOptions: { endpoint, batchSize: 1, batchTimeout: 10 },
    }),
  )) as unknown as TraceServiceImpl;
}

let usersCollector: Collector;
let ordersCollector: Collector;

beforeEach(async () => {
  // A provider left registered by another file would make the first registration a no-op and
  // change which application is the "guest" here.
  otelTrace.disable();
  otelContext.disable();
  usersCollector = await startCollector();
  ordersCollector = await startCollector();
});

afterEach(async () => {
  await usersCollector.stop();
  await ordersCollector.stop();
  otelTrace.disable();
  otelContext.disable();
});

describe('two applications in one process', () => {
  it('each send their spans to their own collector, and neither receives the other', async () => {
    // `users` starts first, so it is the one that wins the process-global slot. `orders` is the
    // guest, and the guest is where every symptom of this defect appeared.
    const users = makeService('users', usersCollector.url);
    const orders = makeService('orders', ordersCollector.url);

    users.getTracer().startSpan('users-work').end();
    orders.getTracer().startSpan('orders-work').end();

    await users.shutdown();
    await orders.shutdown();

    await anyBatchLands('both collectors to receive a batch', 5000, () =>
      usersCollector.serviceNames().length + ordersCollector.serviceNames().length >= 2);

    expect(usersCollector.serviceNames()).toEqual(['users']);
    expect(ordersCollector.serviceNames()).toEqual(['orders']);
  });

  it('label a guest application spans with ITS service name, not the host one', async () => {
    const users = makeService('users', usersCollector.url);
    const orders = makeService('orders', ordersCollector.url);

    // Only the guest emits. Before the fix this span was created by the FIRST application's
    // provider, so it arrived at the users collector carrying `service.name: users`.
    orders.getTracer().startSpan('guest-work').end();

    await orders.shutdown();
    await anyBatchLands('a collector to receive the guest batch', 5000, () =>
      usersCollector.serviceNames().length + ordersCollector.serviceNames().length > 0);

    expect(ordersCollector.serviceNames()).toEqual(['orders']);
    expect(usersCollector.serviceNames()).toEqual([]);

    await users.shutdown();
  });

  it('route a decorator span to whichever application the work is running under', async () => {
    // `@Traced`, `@Span` and auto-trace are installed on a PROTOTYPE at class-decoration time,
    // once for every application in the process, so they cannot capture an owner — they ask at
    // call time, which is what `appTracer()` answers. The framework establishes the owner at
    // each boundary where work enters an application; here that boundary is stated directly.
    const users = makeService('users', usersCollector.url);
    const orders = makeService('orders', ordersCollector.url);

    runWithAppTracer(orders.getTracer(), () => {
      appTracer().startSpan('decorated-work').end();
    });

    await orders.shutdown();
    await anyBatchLands('a collector to receive the decorated batch', 5000, () =>
      usersCollector.serviceNames().length + ordersCollector.serviceNames().length > 0);

    expect(ordersCollector.serviceNames()).toEqual(['orders']);
    expect(usersCollector.serviceNames()).toEqual([]);

    await users.shutdown();
  });

  it('fall back to the installed provider outside any application boundary', async () => {
    // The documented residue: user code calling `trace.getTracer()` itself, or a framework span
    // created outside every boundary, still resolves through the process-global slot — which is
    // byte-for-byte what happened before this change, so it is unfixed rather than regressed.
    const users = makeService('users', usersCollector.url);
    const orders = makeService('orders', ordersCollector.url);

    appTracer().startSpan('unowned-work').end();

    await users.shutdown();
    await anyBatchLands('a collector to receive the unowned batch', 5000, () =>
      usersCollector.serviceNames().length + ordersCollector.serviceNames().length > 0);

    expect(usersCollector.serviceNames()).toEqual(['users']);
    expect(ordersCollector.serviceNames()).toEqual([]);

    await orders.shutdown();
  });
});
