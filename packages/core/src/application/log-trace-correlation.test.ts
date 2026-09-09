/**
 * A log line names the span it was written from.
 *
 * That is the entire point of putting a trace id in a log entry: paste it into the tracing
 * backend and land on the trace. Three independent defects meant it did not hold.
 *
 * **HTTP lines named a trace that did not exist.** The request scope was filled with a context
 * from `generateTraceContextSync()`, minted separately from the span that `startHttpTraceSync()`
 * started. Measured on one request with exactly one span: the span was on trace `4074598c…` and
 * every log line said `38b97f3e…`. The outgoing `traceparent` header meanwhile used the span, so
 * this service's logs and the service it called disagreed about which trace they were in.
 *
 * **A called service logged the CALLER's span id.** With an inbound `traceparent` the stored
 * context was the caller's verbatim, so a line written here named a span living in the calling
 * service. Continuing a trace means inheriting the trace id and parenting to the caller's span,
 * not adopting its identity.
 *
 * **Non-HTTP lines named nothing at all.** A queue handler, a scheduled job and a WebSocket
 * callback never enter the request scope, and nothing opened a span for them either — the
 * boundary helper re-rooted to a span-less root. Measured on a plain `@Subscribe` handler with
 * tracing enabled: `(no active span)`, `(no trace on the entry)`.
 *
 * Every handler below is deliberately UNDECORATED. An earlier version of this file put `@Traced`
 * on the queue and cron handlers, which opened a span by hand and so pinned the one case that
 * already worked — the defect was that the DEFAULT shape gets nothing.
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

import {
  BaseController,
  BaseWebSocketGateway,
  Controller,
  Cron,
  Get,
  Interval,
  Module,
  OnMessage,
  OneBunApplication,
  resetRegistrations,
  Subscribe,
  WebSocketGateway,
  type Message,
} from '../index';
import { requestContextStore } from '../request-context';

/** A caller's W3C ids, for the request that continues someone else's trace. */
const CALLER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const CALLER_SPAN_ID = '00f067aa0ba902b7';

/** A W3C trace id: 32 lowercase hex digits, and not the all-zero invalid one. */
const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;

const HTTP_OK = 200;
const POLL_INTERVAL_MS = 20;
const RUN_DEADLINE_MS = 4000;

/**
 * What one execution context observed.
 *
 * `ran` exists because everything else here is satisfiable by a handler that never executed.
 * Two fields initialised to the same placeholder make `expect(a).toBe(b)` pass on an unreachable
 * handler, which is how the previous version of this file stayed green while covering nothing.
 */
interface Observed {
  ran: number;
  fromSpan: string;
  fromLogger: string;
  fromStore: string;
}

function observed(): Observed {
  return {
    ran: 0, fromSpan: '', fromLogger: '', fromStore: '', 
  };
}

const httpSeen = observed();
const queueSeen = observed();
const cronSeen = observed();
const intervalSeen = observed();
const wsSeen = observed();

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

/** Record what one handler sees, from a log line the framework really wrote. */
function record(into: Observed, tag: string, logger: { info: (message: string) => void }): void {
  into.ran += 1;
  into.fromSpan = activeTraceId();
  logger.info(tag);
  into.fromLogger = loggedTraceId(tag);
  into.fromStore = requestContextStore.getStore()?.traceContext?.traceId ?? '(no store)';
}

/**
 * Wait until a handler has run, and FAIL if it never does.
 *
 * A fixed sleep turns a missed deadline into a pass: the assertions would then compare two
 * untouched fields. The cron case had roughly half a second of margin on a one-second schedule.
 */
async function waitForRun(seen: Observed, what: string): Promise<void> {
  const deadline = Bun.nanoseconds() + RUN_DEADLINE_MS * 1_000_000;

  while (seen.ran === 0) {
    if (Bun.nanoseconds() > deadline) {
      throw new Error(`${what} never ran within ${RUN_DEADLINE_MS}ms`);
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

/** Open a socket, send one frame the gateway handles, and wait for the handler. */
async function ping(app: OneBunApplication): Promise<void> {
  const socket = new WebSocket(`${app.getHttpUrl().replace('http', 'ws')}/ws`);

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      resolve();
    });
    socket.addEventListener('error', () => {
      reject(new Error('the socket never opened'));
    });
  });

  socket.send(JSON.stringify({ event: 'ping', data: {} }));
  await waitForRun(wsSeen, 'the WebSocket handler');
  socket.close();
}

/** The handler ran, and deliberately carries no trace — its kind of span is switched off. */
function expectUntraced(seen: Observed): void {
  expect(seen.ran).toBeGreaterThan(0);
  expect(seen.fromSpan).toBe('(no active span)');
  expect(seen.fromLogger).toBe('(no trace on the entry)');
}

/** Every assertion this file makes about one context, in one place. */
function expectCorrelated(seen: Observed): void {
  expect(seen.ran).toBeGreaterThan(0);
  expect(seen.fromSpan).toMatch(TRACE_ID);
  expect(seen.fromLogger).toBe(seen.fromSpan);

  // The request scope agrees with the span. `requestContextStore` is a SECOND AsyncLocalStorage
  // that re-rooting the OpenTelemetry context does not touch, so a handler reached from a publish
  // inside an HTTP request used to keep reading that finished request's stored context.
  expect(seen.fromStore).toBe(seen.fromSpan);
}

@Controller('/correlate')
class CorrelateController extends BaseController {
  @Get('/http')
  async http(): Promise<{ ok: boolean }> {
    record(httpSeen, 'from-http', this.logger);

    return { ok: true };
  }

  @Subscribe('correlate.queue')
  async onMessage(_message: Message): Promise<void> {
    record(queueSeen, 'from-queue', this.logger);
  }

  @Cron('* * * * * *', { pattern: 'correlate.cron' })
  tick(): { at: number } {
    record(cronSeen, 'from-cron', this.logger);

    return { at: 1 };
  }

  @Interval(200, { pattern: 'correlate.interval' })
  every(): { at: number } {
    record(intervalSeen, 'from-interval', this.logger);

    return { at: 2 };
  }
}

@WebSocketGateway({ path: '/ws' })
class CorrelateGateway extends BaseWebSocketGateway {
  @OnMessage('ping')
  handlePing(): void {
    record(wsSeen, 'from-ws', this.logger);
  }
}

// A gateway is registered as a controller — the framework has one registration list.
@Module({ controllers: [CorrelateController, CorrelateGateway] })
class CorrelateModule {}

async function startApp(tracing?: Record<string, boolean>): Promise<OneBunApplication> {
  const app = new OneBunApplication(CorrelateModule, {
    port: 0,
    metrics: { enabled: false },
    gracefulShutdown: false,
    websocket: {},
    // The real logger, with a transport that keeps what it was given. Not a mock logger: what
    // is under test is the trace context the framework resolves for a log line, and a mock
    // records nothing to inspect.
    loggerLayer: makeLogger({ minLevel: LogLevel.Debug, transport: capturingTransport() }),
    tracing: {
      enabled: true,
      serviceName: 'correlate',
      exportOptions: { endpoint: 'http://127.0.0.1:9/unused' },
      ...tracing,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  await app.start();

  return app;
}

afterEach(() => {
  entries.length = 0;

  // The observed records outlive a single test, so a stale one from the previous case would
  // satisfy the next. Reset every field, not just the entries array.
  for (const seen of [httpSeen, queueSeen, cronSeen, intervalSeen, wsSeen]) {
    Object.assign(seen, observed());
  }

  resetRegistrations();
  otelTrace.disable();
});

describe('a log line names the span it was written from', () => {
  it('inside an HTTP request', async () => {
    const app = await startApp();

    try {
      const response = await fetch(`${app.getHttpUrl()}/correlate/http`);

      // Asserted, because a 404 would otherwise reach the assertions below as "the handler
      // never ran" and read identically to a pass.
      expect(response.status).toBe(HTTP_OK);
    } finally {
      await app.stop();
    }

    // The defect: these were two unrelated ids, so a trace id copied out of the logs found
    // nothing in the backend.
    expectCorrelated(httpSeen);

  });

  it('inside a request that continues a caller trace', async () => {
    // The callee's own span, in the caller's trace, with the caller recorded as the parent.
    // This used to log the INBOUND span id verbatim, so every line from a called service named
    // a span living in the calling one: click it in a backend and you land in the caller.
    const app = await startApp();

    try {
      const response = await fetch(`${app.getHttpUrl()}/correlate/http`, {
        headers: { traceparent: `00-${CALLER_TRACE_ID}-${CALLER_SPAN_ID}-01` },
      });

      expect(response.status).toBe(HTTP_OK);
    } finally {
      await app.stop();
    }

    expect(httpSeen.ran).toBeGreaterThan(0);

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
      await waitForRun(queueSeen, 'the queue handler');
    } finally {
      await app.stop();
    }

    // A queue handler never enters the request scope, and nothing opened a span for it, so
    // before this it logged with no trace id whatever.
    expectCorrelated(queueSeen);
  });

  it('inside a scheduled job', async () => {
    const app = await startApp();

    try {
      await waitForRun(cronSeen, 'the cron job');
    } finally {
      await app.stop();
    }

    expectCorrelated(cronSeen);
  });

  it('inside an interval job', async () => {
    const app = await startApp();

    try {
      await waitForRun(intervalSeen, 'the interval job');
    } finally {
      await app.stop();
    }

    expectCorrelated(intervalSeen);
  });

  it('inside a WebSocket message handler', async () => {
    const app = await startApp();

    try {
      await ping(app);
    } finally {
      await app.stop();
    }

    expectCorrelated(wsSeen);
  });
});

/**
 * Each kind of background work has its own switch, and the switches are independent.
 *
 * One umbrella `traceBackgroundWork` said nothing about what it covered — a busy consumer and a
 * once-a-day cron are different decisions. These cases are what makes the split real rather than
 * a rename: turning one off must leave the others tracing.
 */
describe('each kind of background work has its own switch', () => {
  it('traceQueueMessages: false silences the queue and nothing else', async () => {
    const app = await startApp({ traceQueueMessages: false });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (app as any).queueService.publish('correlate.queue', { n: 1 });
      await waitForRun(queueSeen, 'the queue handler');
      await waitForRun(cronSeen, 'the cron job');
    } finally {
      await app.stop();
    }

    expectUntraced(queueSeen);
    expectCorrelated(cronSeen);
  });

  it('traceScheduledJobs: false silences the scheduler and nothing else', async () => {
    const app = await startApp({ traceScheduledJobs: false });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (app as any).queueService.publish('correlate.queue', { n: 1 });
      await waitForRun(cronSeen, 'the cron job');
      await waitForRun(intervalSeen, 'the interval job');
      await waitForRun(queueSeen, 'the queue handler');
    } finally {
      await app.stop();
    }

    expectUntraced(cronSeen);
    expectUntraced(intervalSeen);
    expectCorrelated(queueSeen);
  });

  it('traceWebSocketEvents: false silences sockets and nothing else', async () => {
    const app = await startApp({ traceWebSocketEvents: false });

    try {
      await ping(app);
      await waitForRun(cronSeen, 'the cron job');
    } finally {
      await app.stop();
    }

    expectUntraced(wsSeen);
    expectCorrelated(cronSeen);
  });
});
