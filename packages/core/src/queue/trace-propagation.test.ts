/**
 * A published message carries the trace that caused it.
 *
 * `MessageMetadata.traceId` was declared, documented, and read by `MessageTraceGuard` — and never
 * written. The shipped guard therefore refused 100% of traffic: following the documentation to
 * "require trace context" stopped the entire message stream. The only workaround was to set the
 * field by hand at every publish site.
 *
 * Two halves, and the second is what makes the first worth having. The publish path stamps the
 * ambient trace onto the message; the delivery path uses it as the parent of the delivery's own
 * span. Without the second half every delivery is a separately sampled root that announces itself
 * as a message-consumption entry point and points at nothing.
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
  LogLevel,
  makeLogger,
  type LogTransport,
} from '@onebun/logger';

import {
  BaseController,
  Controller,
  Get,
  Module,
  OneBunApplication,
  QueueService,
  resetRegistrations,
  Subscribe,
  UseMessageGuards,
  type Message,
  type MessageMetadata,
} from '../index';

import { MessageTraceGuard } from './guards';

const HTTP_OK = 200;
const POLL_INTERVAL_MS = 20;
const RUN_DEADLINE_MS = 3000;

/** A trace id a caller stated deliberately, which the framework must never overwrite. */
const EXPLICIT_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

interface Delivered {
  ran: number;
  metadata: MessageMetadata | undefined;
  handlerTraceId: string;
}

const delivered: Delivered = { ran: 0, metadata: undefined, handlerTraceId: '' };
let requestTraceId = '';

@Controller('/publisher')
class PublisherController extends BaseController {
  constructor(private queue: QueueService) {
    super();
  }

  @Get('/fire')
  async fire(): Promise<{ ok: boolean }> {
    requestTraceId = otelTrace.getActiveSpan()?.spanContext().traceId ?? '(no active span)';
    await this.queue.publish('traced.test', { v: 1 });

    return { ok: true };
  }

  @Get('/fire-explicit')
  async fireExplicit(): Promise<{ ok: boolean }> {
    await this.queue.publish('traced.test', { v: 2 }, {
      metadata: { traceId: EXPLICIT_TRACE_ID, spanId: '00f067aa0ba902b7' },
    });

    return { ok: true };
  }

  @Get('/fire-batch')
  async fireBatch(): Promise<{ ok: boolean }> {
    requestTraceId = otelTrace.getActiveSpan()?.spanContext().traceId ?? '(no active span)';
    await this.queue.publishBatch([{ pattern: 'traced.test', data: { v: 3 } }]);

    return { ok: true };
  }

  @Subscribe('traced.test')
  @UseMessageGuards(MessageTraceGuard)
  async onTraced(message: Message): Promise<void> {
    delivered.ran += 1;
    delivered.metadata = message.metadata;
    delivered.handlerTraceId = otelTrace.getActiveSpan()?.spanContext().traceId ?? '(no active span)';
  }
}

@Module({ controllers: [PublisherController] })
class PublisherModule {}

const silentTransport: LogTransport = { log: () => Effect.sync(() => undefined) };

async function startApp(): Promise<OneBunApplication> {
  const app = new OneBunApplication(PublisherModule, {
    port: 0,
    metrics: { enabled: false },
    gracefulShutdown: false,
    loggerLayer: makeLogger({ minLevel: LogLevel.Error, transport: silentTransport }),
    tracing: {
      enabled: true,
      serviceName: 'publisher',
      exportOptions: { endpoint: 'http://127.0.0.1:9/unused' },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  await app.start();

  return app;
}

/** Wait for the delivery, and FAIL if it never comes — a fixed sleep makes a miss look like a pass. */
async function waitForDelivery(): Promise<void> {
  const deadline = Bun.nanoseconds() + RUN_DEADLINE_MS * 1_000_000;

  while (delivered.ran === 0) {
    if (Bun.nanoseconds() > deadline) {
      throw new Error(`no message was delivered within ${RUN_DEADLINE_MS}ms`);
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

/** The queue service the application built, for publishing from outside any traced scope. */
function queueOf(app: OneBunApplication): QueueService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (app as any).queueService as QueueService;
}

afterEach(() => {
  delivered.ran = 0;
  delivered.metadata = undefined;
  delivered.handlerTraceId = '';
  requestTraceId = '';
  resetRegistrations();
  otelTrace.disable();
});

describe('a published message carries the trace that caused it', () => {
  it('a publish inside a request is delivered, and the delivery joins that trace', async () => {
    const app = await startApp();

    try {
      const response = await fetch(`${app.getHttpUrl()}/publisher/fire`);

      expect(response.status).toBe(HTTP_OK);
      await waitForDelivery();
    } finally {
      await app.stop();
    }

    // The guard let it through. It used to refuse every message ever published, because the field
    // it requires had no writer anywhere in the framework.
    expect(delivered.ran).toBe(1);
    expect(delivered.metadata?.traceId).toBe(requestTraceId);
    expect(delivered.metadata?.spanId).toBeDefined();

    // And the delivery is IN that trace rather than a root of its own — the half that makes the
    // stamped id worth carrying.
    expect(delivered.handlerTraceId).toBe(requestTraceId);
  });

  it('never overwrites a trace id the caller stated', async () => {
    const app = await startApp();

    try {
      const response = await fetch(`${app.getHttpUrl()}/publisher/fire-explicit`);

      expect(response.status).toBe(HTTP_OK);
      await waitForDelivery();
    } finally {
      await app.stop();
    }

    // A caller relaying on behalf of something else is stating the causal trace; the request's
    // own is not it.
    expect(delivered.metadata?.traceId).toBe(EXPLICIT_TRACE_ID);
    expect(delivered.handlerTraceId).toBe(EXPLICIT_TRACE_ID);
  });

  it('stamps each message of a batch', async () => {
    const app = await startApp();

    try {
      const response = await fetch(`${app.getHttpUrl()}/publisher/fire-batch`);

      expect(response.status).toBe(HTTP_OK);
      await waitForDelivery();
    } finally {
      await app.stop();
    }

    expect(delivered.metadata?.traceId).toBe(requestTraceId);
  });

  it('leaves the ids off a publish with no trace to join, and the guard says so', async () => {
    const app = await startApp();

    try {
      // Outside any request, span or handler — the shape a publish from `onModuleInit` has.
      await queueOf(app).publish('traced.test', { v: 4 });
      await Bun.sleep(200);
    } finally {
      await app.stop();
    }

    // Deliberate, and the alternative is worse: minting an id here would put a trace id in the
    // message that names no span, which is the defect this framework removed from its own log
    // lines. `MessageTraceGuard` refusing it is the guard doing its stated job — and since it
    // nacks rather than returning quietly, the refusal is reported as a failure, not a success.
    expect(delivered.ran).toBe(0);
  });
});
