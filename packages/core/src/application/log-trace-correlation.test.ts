/**
 * A log line names the span it was written from.
 *
 * That is the entire point of putting a trace id in a log entry: paste it into the tracing
 * backend and land on the trace. Two independent defects meant it did not hold.
 *
 * **HTTP lines named a trace that did not exist.** The request scope was filled with a context
 * from `generateTraceContextSync()`, minted separately from the span that `startHttpTraceSync()`
 * started. Measured on one request with exactly one span: the span was on trace `4074598c…` and
 * every log line said `38b97f3e…`. The outgoing `traceparent` header meanwhile used the span, so
 * this service's logs and the service it called disagreed about which trace they were in.
 *
 * **Non-HTTP lines named nothing at all.** A queue handler, a scheduled job and a WebSocket
 * callback never enter the request scope, and the fallback meant to cover them — a
 * `globalThis.__onebunTraceService` branch in the logger — could not fire: it guarded on a method
 * the trace service does not have, and would have read a fiber-local value from a fresh fiber
 * even spelled correctly.
 *
 * Both are one question now: `getCurrentTraceContext()` resolves from the OpenTelemetry active
 * span first, which is what the outgoing header already did.
 */

import { trace as otelTrace } from '@opentelemetry/api';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect } from 'effect';

import {
  type LogEntry,
  LogLevel,
  makeLogger,
  type LogTransport,
} from '@onebun/logger';
import { Traced } from '@onebun/trace';

import {
  BaseController,
  Controller,
  Cron,
  Get,
  Module,
  OneBunApplication,
  resetRegistrations,
  Subscribe,
  type Message,
} from '../index';
import { requestContextStore } from '../request-context';

const ID_PLACEHOLDER = 'unset';

/** A caller's W3C ids, for the request that continues someone else's trace. */
const CALLER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const CALLER_SPAN_ID = '00f067aa0ba902b7';

/** The trace ids each context observed, filled by the handlers below. */
interface Observed {
  fromSpan: string;
  fromLogger: string;
  fromStore: string;
}

function observed(): Observed {
  return { fromSpan: ID_PLACEHOLDER, fromLogger: ID_PLACEHOLDER, fromStore: ID_PLACEHOLDER };
}

const httpSeen = observed();
const queueSeen = observed();
const cronSeen = observed();

/** Log entries the application actually wrote, with whatever trace they carried. */
const entries: LogEntry[] = [];

function capturingTransport(): LogTransport {
  return {
    log: (_formatted: string, entry: LogEntry) => Effect.sync(() => {
      entries.push(entry);
    }),
  };
}

/** The trace id of the most recent entry carrying the given message. */
function loggedTraceId(message: string): string {
  const entry = [...entries].reverse().find(candidate => candidate.message === message);

  if (!entry) {
    const seen = entries.map(e => e.message).join(', ') || '(none)';

    throw new Error(`No log entry "${message}". Logged: ${seen}`);
  }

  return entry.trace?.traceId ?? '(no trace on the entry)';
}

function activeTraceId(): string {
  return otelTrace.getActiveSpan()?.spanContext().traceId ?? '(no active span)';
}

@Controller('/correlate')
class CorrelateController extends BaseController {
  @Get('/http')
  async http(): Promise<{ ok: boolean }> {
    httpSeen.fromSpan = activeTraceId();
    this.logger.info('from-http');
    httpSeen.fromLogger = loggedTraceId('from-http');
    httpSeen.fromStore = requestContextStore.getStore()?.traceContext?.traceId ?? '(no store)';

    return { ok: true };
  }

  @Subscribe('correlate.queue')
  @Traced('queue.work')
  async onMessage(_message: Message): Promise<void> {
    queueSeen.fromSpan = activeTraceId();
    this.logger.info('from-queue');
    queueSeen.fromLogger = loggedTraceId('from-queue');
  }

  @Cron('* * * * * *', { pattern: 'correlate.cron' })
  @Traced('cron.work')
  tick(): { at: number } {
    cronSeen.fromSpan = activeTraceId();
    this.logger.info('from-cron');
    cronSeen.fromLogger = loggedTraceId('from-cron');

    return { at: 1 };
  }
}

@Module({ controllers: [CorrelateController] })
class CorrelateModule {}

async function startApp(): Promise<OneBunApplication> {
  const app = new OneBunApplication(CorrelateModule, {
    port: 0,
    metrics: { enabled: false },
    gracefulShutdown: false,
    // The real logger, with a transport that keeps what it was given. Not a mock logger: what
    // is under test is the trace context the framework resolves for a log line, and a mock
    // records nothing to inspect.
    loggerLayer: makeLogger({ minLevel: LogLevel.Debug, transport: capturingTransport() }),
    tracing: {
      enabled: true,
      serviceName: 'correlate',
      exportOptions: { endpoint: 'http://127.0.0.1:9/unused' },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  await app.start();

  return app;
}

afterEach(() => {
  entries.length = 0;
  resetRegistrations();
  otelTrace.disable();
});

describe('a log line names the span it was written from', () => {
  it('inside an HTTP request', async () => {
    const app = await startApp();

    try {
      await fetch(`${app.getHttpUrl()}/correlate/http`);
    } finally {
      await app.stop();
    }

    // The defect: these were two unrelated ids, so a trace id copied out of the logs found
    // nothing in the backend.
    expect(httpSeen.fromLogger).toBe(httpSeen.fromSpan);
    expect(httpSeen.fromSpan).not.toBe('(no active span)');

    // And at the source: the request scope holds the SPAN's context. It used to hold a second
    // context minted beside the span by `generateTraceContextSync()`, which is what made the
    // two disagree. Asserted separately because the active-span precedence above would mask
    // it — this is the half that decides what answers once no span is open.
    expect(httpSeen.fromStore).toBe(httpSeen.fromSpan);
  });

  it('inside a request that continues a caller trace', async () => {
    // The callee's own span, in the caller's trace, with the caller recorded as the parent.
    // This used to log the INBOUND span id verbatim, so every line from a called service named
    // a span living in the calling one: click it in a backend and you land in the caller.
    const app = await startApp();

    try {
      await fetch(`${app.getHttpUrl()}/correlate/http`, {
        headers: { traceparent: `00-${CALLER_TRACE_ID}-${CALLER_SPAN_ID}-01` },
      });
    } finally {
      await app.stop();
    }

    const entry = [...entries].reverse().find(candidate => candidate.message === 'from-http');

    expect(entry?.trace?.traceId).toBe(CALLER_TRACE_ID);
    expect(entry?.trace?.spanId).not.toBe(CALLER_SPAN_ID);
    expect(entry?.trace?.parentSpanId).toBe(CALLER_SPAN_ID);
  });

  it('inside a queue handler', async () => {
    const app = await startApp();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (app as any).queueService.publish('correlate.queue', { n: 1 });
      await Bun.sleep(200);
    } finally {
      await app.stop();
    }

    // A queue handler never enters the request scope, so before this it logged with no trace
    // id whatever — the fallback meant to cover it could not fire.
    expect(queueSeen.fromLogger).toBe(queueSeen.fromSpan);
    expect(queueSeen.fromSpan).not.toBe('(no active span)');
  });

  it('inside a scheduled job', async () => {
    const app = await startApp();

    try {
      await Bun.sleep(1500);
    } finally {
      await app.stop();
    }

    expect(cronSeen.fromLogger).toBe(cronSeen.fromSpan);
    expect(cronSeen.fromSpan).not.toBe('(no active span)');
  });
});
