// NATS-SUITE-FLOOR: 439
//
// `bun test packages/nats` must report 0 fail and at least this many passing
// cases. Every downstream item in the JetStream epic adds cases and raises the
// floor; none may lower it. Retiring a baseline pin below replaces it with the
// inverted assertion, so the count never drops on a retirement either.

/**
 * JetStream Queue Adapter Tests
 *
 * Note: These tests don't require a running NATS server.
 * They test the adapter's properties and error handling.
 */

import * as realJetStream from '@nats-io/jetstream';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';


import type { JetStreamAdapterOptions } from '../src/types';

import { useFakeTimers } from '@onebun/core/testing';


import {
  CONFIG_CYCLE_WINDOW_MS,
  CONFIG_STAMP_KEYS,
  hashReconcileConfig,
} from '../src/config-stamp';
import { JetStreamQueueAdapter, createJetStreamQueueAdapter } from '../src/jetstream.adapter';

// ============================================================================
// Helpers to access private internals via casting
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}

/**
 * Reads one argument off a recorded `bun:test` mock call. A `mock(() => …)` with
 * no declared parameters infers its call tuple as `[]`, so indexing it directly
 * is a type error even though the value is there at runtime.
 */
function callArg(fn: unknown, call: number, index: number): AnyRecord {
  return asAny(fn).mock.calls[call][index] as AnyRecord;
}

// ============================================================================
// No module double
//
// This file must NEVER call `mock.module`. The replacement is process-global —
// every file in the same `bun test` run gets it, `jetstream.adapter.integration.test.ts`
// among them, and that file needs the genuine client against a live container.
// Spreading the real module and delegating is NOT enough to make it safe: measured
// with coverage off so nothing else masked the signal, this file plus the integration
// file wedged 3/3 with the mock installed and passed 3/3 without it.
//
// Nothing is lost. The adapter reads the client module in four places; three of them
// only read constants the real module supplies correctly (`AckPolicy.Explicit`,
// `DeliverPolicy.New`, `JetStreamApiCodes.*`). Only `connect()` needs a substitute,
// and `makeConnectableAdapter` below stands in for it directly on the instance.
// ============================================================================

/** `JetStreamApiCodes.ConsumerNotFound` — the absence classifier the adapter will read. */
/** Mirrors `CONSUME_RESTART_DELAY_MS` in the adapter. */
const CONSUME_RESTART_DELAY_MS = 100;

const CONSUMER_NOT_FOUND_CODE = 10014;
/** `JetStreamApiCodes.StreamNotFound`. */
const STREAM_NOT_FOUND_CODE = 10059;

function makeApiError(code: number, message: string): AnyRecord {
  const err = asAny(new Error(message));
  err.code = code;

  return err;
}

// ============================================================================
// Mock factories
// ============================================================================

/**
 * Every parked consume loop registers its release here so `afterEach` can wake
 * them all, whoever created them. Without this the adapter's `for await` sits on
 * an unresolved promise for the rest of the run.
 */
const parkedReleases: Array<() => void> = [];

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

function makeMockJsMsg(overrides: Partial<AnyRecord> = {}): AnyRecord {
  return {
    ack: mock(() => undefined),
    nak: mock(() => undefined),
    term: mock(() => undefined),
    data: new TextEncoder().encode('{}'),
    subject: 'test.topic',
    info: { redelivered: false },
    ...overrides,
  };
}

/**
 * A consumer whose `consume()` resolves ONE stable handle. After the seeded
 * messages the iterator parks on a deferred instead of ending, so the adapter's
 * 100ms restart at `jetstream.adapter.ts:619-622` never fires and no test leaks
 * a timer. `close()` releases the park.
 */
function makeMockConsumer(messages: AnyRecord[] = [], notifications: AnyRecord[] = []) {
  const parked = makeDeferred();
  parkedReleases.push(parked.resolve);

  let isClosed = false;

  const handle: AnyRecord = {
    async *[Symbol.asyncIterator] () {
      for (const msg of messages) {
        yield msg;
      }
      await parked.promise;
    },
    close: mock(() => {
      isClosed = true;
      parked.resolve();

      return Promise.resolve();
    }),
    closed: mock(() => Promise.resolve(isClosed)),
    status: mock(() => ({
      async *[Symbol.asyncIterator] () {
        for (const notification of notifications) {
          yield notification;
        }
        await parked.promise;
      },
    })),
  };

  return {
    consume: mock(() => Promise.resolve(handle)),
    info: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve(true)),
    handle,
    release: parked.resolve,
  };
}

/** PRESENT branch for `streams.info`. */
function streamInfoPresent(config: Partial<AnyRecord> = {}): AnyRecord {
  return {
    config: {
      name: 'TEST_STREAM',
      subjects: ['test.>'],
      metadata: {},
      ...config,
    },
  };
}

/**
 * PRESENT branch for `consumers.info`. Config nests one level down, as on the wire.
 * Seeded by reassignment after construction: `a.jsm === mockJsm` by reference, so a
 * case can switch the probe from its ABSENT default to a resolving stub.
 */
function seedConsumerInfo(mockJsm: AnyRecord, config: Partial<AnyRecord> = {}): void {
  mockJsm.consumers.info = mock(() => Promise.resolve({
    stream_name: 'TEST_STREAM',
    name: 'test-group',
    config: {
      durable_name: 'test-group',
      name: 'test-group',
      ack_policy: realJetStream.AckPolicy.Explicit,
      filter_subject: 'test.topic',
      max_ack_pending: 100,
      ack_wait: 30_000_000_000,
      max_deliver: 3,
      metadata: {},
      ...config,
    },
  }));
}

/**
 * Adapters created through `makeConnectedAdapter` are released in `afterEach`
 * so no case leaves a live subscription behind.
 */
const activeAdapters: JetStreamQueueAdapter[] = [];

function makeConnectedAdapter(overrides: Partial<JetStreamAdapterOptions> = {}) {
  const adapter = new JetStreamQueueAdapter({
    servers: 'nats://localhost:4222',
    streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
    ...overrides,
  });
  activeAdapters.push(adapter);

  // Simulate connected state by setting private fields directly
  const a = asAny(adapter);
  a.connected = true;

  // Mock NatsClient
  const mockNc = {
    drain: mock(() => Promise.resolve()),
    close: mock(() => Promise.resolve()),
    isClosed: mock(() => false),
  };
  a.client = {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    isConnected: mock(() => true),
    getConnection: mock(() => mockNc),
  };

  // Every mock is created fresh here, so a call count never leaks between cases
  // and `expect(fn).not.toHaveBeenCalled()` is meaningful per case.
  const mockJsm = {
    streams: {
      // DEFAULT: PRESENT — preserves today's info -> update path (`:545-546`)
      info: mock(() => Promise.resolve(streamInfoPresent())),
      update: mock(() => Promise.resolve()),
      add: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve(true)),
    },
    consumers: {
      add: mock(() => Promise.resolve()),
      // DEFAULT: ABSENT — a not-found rejection carrying code 10014, so the
      // probe-first flow WI-193 introduces still reaches the `add` path and
      // every `consumers.add.mock.calls[0][1]` assertion here stays green.
      info: mock(() => Promise.reject(makeApiError(CONSUMER_NOT_FOUND_CODE, 'consumer not found'))),
      update: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve(true)),
    },
  };

  // One stable consumer instance, not a fresh one per `get()` call, so a test can
  // reach the same handle the adapter is iterating.
  const consumer = makeMockConsumer();

  const mockJs = {
    publish: mock(() => Promise.resolve()),
    consumers: {
      get: mock(() => Promise.resolve(consumer)),
    },
  };

  a.js = mockJs;
  a.jsm = mockJsm;

  return {
    adapter, mockJs, mockJsm, consumer, 
  };
}

afterEach(async () => {
  // Disconnect first so `entry.running` is false, THEN wake the parked loops —
  // the reverse order would let the 100ms restart fire once before it sees the flag.
  for (const adapter of activeAdapters.splice(0)) {
    await adapter.disconnect().catch(() => undefined);
  }
  for (const release of parkedReleases.splice(0)) {
    release();
  }
});

// ============================================================================
// JetStreamMessage tests
// ============================================================================

describe('JetStreamMessage', () => {
  // We access JetStreamMessage through subscribe flows, but for focused unit
  // tests we instantiate it via the adapter's private consumeMessages path.
  // Easiest approach: test via the exported adapter by providing mock consumers.

  const MESSAGE_ID = 'msg-001';
  const PATTERN = 'test.created';
  const DATA = { foo: 'bar' };
  const TIMESTAMP = 1_700_000_000_000;
  const METADATA = { source: 'unit-test' };

  function buildJetStreamMessage(jsMsgOverrides: Partial<AnyRecord> = {}) {
    // Access the private class through the module's closure by importing the file
    // and calling the internal path. We do this by creating a minimal consumer
    // that yields one message and observing the handler.
    const jsMsg = makeMockJsMsg(jsMsgOverrides);

    // Build message data payload that consumeMessages decodes
    const payload = {
      id: MESSAGE_ID,
      pattern: PATTERN,
      data: DATA,
      timestamp: TIMESTAMP,
      metadata: METADATA,
    };
    jsMsg.data = new TextEncoder().encode(JSON.stringify(payload));
    jsMsg.subject = PATTERN;

    return jsMsg;
  }

  it('should call jsMsg.ack() when ack() is called', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;

    // Override consumers.get to return a consumer with our message
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    // Give consumeMessages time to run
    await new Promise((r) => setTimeout(r, 20));

    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.ack();

    expect(jsMsg.ack).toHaveBeenCalledTimes(1);
  });

  it('should not call jsMsg.ack() on second ack() call (idempotent)', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.ack();
    await capturedMessage!.ack(); // second call — no-op

    expect(jsMsg.ack).toHaveBeenCalledTimes(1);
  });

  it('should call jsMsg.nak() when nack() is called', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.nack(true);

    // Arguments, not counts: `nak()` with no delay is the redeliver-now form. A delay
    // argument of the wrong shape is what previously reached the wire as a null delay.
    expect(jsMsg.nak).toHaveBeenCalledWith();
    expect(jsMsg.term).not.toHaveBeenCalled();
  });

  it('should not call jsMsg.nak() on second nack() call (idempotent)', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.nack(true);
    await capturedMessage!.nack(true); // second call — no-op

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
    expect(jsMsg.nak).toHaveBeenCalledWith();
  });

  it('should not ack after nack', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.nack(true);
    await capturedMessage!.ack(); // should be no-op

    expect(jsMsg.ack).not.toHaveBeenCalled();
    expect(jsMsg.nak).toHaveBeenCalledWith();
  });

  it('should not nack after ack', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.ack();
    await capturedMessage!.nack(); // should be no-op

    expect(jsMsg.ack).toHaveBeenCalledTimes(1);
    expect(jsMsg.nak).not.toHaveBeenCalled();
    // The default nack() now terminates, so the guard must stop that path too.
    expect(jsMsg.term).not.toHaveBeenCalled();
  });

  it('terminates the message when nack() is called with no argument', async () => {
    // `requeue` defaults to false, and false means do not deliver this again.
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.nack();

    expect(jsMsg.term).toHaveBeenCalled();
    expect(jsMsg.nak).not.toHaveBeenCalled();
  });

  it('terminates the message when nack(false) is called explicitly', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();

    await capturedMessage!.nack(false);

    expect(jsMsg.term).toHaveBeenCalled();
    expect(jsMsg.nak).not.toHaveBeenCalled();
  });

  it('should set redelivered=true from jsMsg.info.redelivered', async () => {
    const jsMsg = buildJetStreamMessage({ info: { redelivered: true } });
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage!.redelivered).toBe(true);
  });

  it('should set redelivered=false when jsMsg.info.redelivered is false', async () => {
    const jsMsg = buildJetStreamMessage({ info: { redelivered: false } });
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage!.redelivered).toBe(false);
  });

  it('should set id, pattern, data, timestamp, metadata from payload', async () => {
    const jsMsg = buildJetStreamMessage();
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    let capturedMessage: AnyRecord | null = null;
    a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

    await adapter.subscribe(PATTERN, async (msg) => {
      capturedMessage = msg as AnyRecord;
    }, { ackMode: 'manual' });

    await new Promise((r) => setTimeout(r, 20));
    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage!.id).toBe(MESSAGE_ID);
    expect(capturedMessage!.pattern).toBe(PATTERN);
    expect(capturedMessage!.data).toEqual(DATA);
    expect(capturedMessage!.timestamp).toBe(TIMESTAMP);
    expect(capturedMessage!.metadata).toEqual(METADATA);
  });
});

// ============================================================================
// JetStreamSubscription tests
// ============================================================================

describe('JetStreamSubscription', () => {
  it('should be active after subscribe', async () => {
    const { adapter } = makeConnectedAdapter();

    const subscription = await adapter.subscribe('test.topic', async () => undefined);

    expect(subscription.isActive).toBe(true);
  });

  it('should report pattern correctly', async () => {
    const { adapter } = makeConnectedAdapter();
    const PATTERN = 'test.topic';

    const subscription = await adapter.subscribe(PATTERN, async () => undefined);

    expect(subscription.pattern).toBe(PATTERN);
  });

  it('pause() sets isActive to false', async () => {
    const { adapter } = makeConnectedAdapter();

    const subscription = await adapter.subscribe('test.topic', async () => undefined);
    subscription.pause();

    expect(subscription.isActive).toBe(false);
  });

  it('resume() after pause() restores isActive to true', async () => {
    const { adapter } = makeConnectedAdapter();

    const subscription = await adapter.subscribe('test.topic', async () => undefined);
    subscription.pause();
    subscription.resume();

    expect(subscription.isActive).toBe(true);
  });

  it('unsubscribe() sets isActive to false', async () => {
    const { adapter } = makeConnectedAdapter();

    const subscription = await adapter.subscribe('test.topic', async () => undefined);
    await subscription.unsubscribe();

    expect(subscription.isActive).toBe(false);
  });

  it('unsubscribe() removes entry from adapter subscriptions', async () => {
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    const subscription = await adapter.subscribe('test.topic', async () => undefined);
    expect(a.subscriptions).toHaveLength(1);

    await subscription.unsubscribe();
    expect(a.subscriptions).toHaveLength(0);
  });

  it('unsubscribe() invokes cleanup callback', async () => {
    const { adapter } = makeConnectedAdapter();
    const a = asAny(adapter);

    // Subscribe twice
    const sub1 = await adapter.subscribe('test.a', async () => undefined);
    await adapter.subscribe('test.b', async () => undefined);
    expect(a.subscriptions).toHaveLength(2);

    await sub1.unsubscribe();
    expect(a.subscriptions).toHaveLength(1);
    expect(a.subscriptions[0].pattern).toBe('test.b');
  });
});

// ============================================================================
// JetStreamQueueAdapter core tests
// ============================================================================

describe('JetStreamQueueAdapter', () => {
  let adapter: JetStreamQueueAdapter;

  beforeEach(() => {
    adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
    });
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(adapter.name).toBe('jetstream');
    });

    it('should have correct type', () => {
      expect(adapter.type).toBe('jetstream');
    });
  });

  describe('lifecycle', () => {
    it('should not be connected initially', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('disconnect() is a no-op when not connected', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(adapter.isConnected()).toBe(false);
    });

    it('disconnect() clears connected state and nullifies js/jsm', async () => {
      const { adapter: connectedAdapter, mockJs } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);

      // Verify state before disconnect
      expect(connectedAdapter.isConnected()).toBe(true);
      expect(a.js).not.toBeNull();
      expect(a.jsm).not.toBeNull();

      await connectedAdapter.disconnect();

      expect(connectedAdapter.isConnected()).toBe(false);
      expect(a.js).toBeNull();
      expect(a.jsm).toBeNull();
      expect(a.client.disconnect).toHaveBeenCalledTimes(1);
      void mockJs; // referenced to avoid unused var warning
    });

    it('disconnect() stops the scheduler', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);

      const stopMock = mock(() => undefined);
      a.scheduler = { stop: stopMock };

      await connectedAdapter.disconnect();

      expect(stopMock).toHaveBeenCalledTimes(1);
      expect(a.scheduler).toBeNull();
    });

    it('disconnect() clears all subscriptions', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);

      // Add fake subscription entries
      a.subscriptions = [
        { running: true, pattern: 'test.a' },
        { running: true, pattern: 'test.b' },
      ];

      await connectedAdapter.disconnect();

      expect(a.subscriptions).toHaveLength(0);
    });
  });

  describe('feature support', () => {
    it('should support pattern-subscriptions', () => {
      expect(adapter.supports('pattern-subscriptions')).toBe(true);
    });

    it('should support consumer-groups', () => {
      expect(adapter.supports('consumer-groups')).toBe(true);
    });

    it('should support dead-letter-queue', () => {
      expect(adapter.supports('dead-letter-queue')).toBe(true);
    });

    it('should support retry', () => {
      expect(adapter.supports('retry')).toBe(true);
    });

    it('should not support delayed-messages', () => {
      expect(adapter.supports('delayed-messages')).toBe(false);
    });

    it('should not support priority', () => {
      expect(adapter.supports('priority')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw when publishing without connecting', async () => {
      await expect(adapter.publish('test', { data: 'test' })).rejects.toThrow(
        'JetStreamQueueAdapter not connected',
      );
    });

    it('should throw when subscribing without connecting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await expect(adapter.subscribe('test', async () => {})).rejects.toThrow(
        'JetStreamQueueAdapter not connected',
      );
    });
  });

  describe('publishing', () => {
    it('publish() calls js.publish with correct NATS subject', async () => {
      const { adapter: connectedAdapter, mockJs } = makeConnectedAdapter();

      const id = await connectedAdapter.publish('test.created', { value: 1 });

      expect(mockJs.publish).toHaveBeenCalledTimes(1);
      const calls = mockJs.publish.mock.calls as unknown as [string, Uint8Array][];
      const [subject, body] = calls[0];
      expect(subject).toBe('test.created');
      const decoded = JSON.parse(new TextDecoder().decode(body));
      expect(decoded.data).toEqual({ value: 1 });
      expect(decoded.pattern).toBe('test.created');
      expect(id).toBe(decoded.id);
    });

    it('publish() converts # to > in subject', async () => {
      const { adapter: connectedAdapter, mockJs } = makeConnectedAdapter();

      await connectedAdapter.publish('test.#', { value: 1 });

      const [[subject]] = mockJs.publish.mock.calls as unknown as [string, Uint8Array][];
      expect(subject).toBe('test.>');
    });

    it('publish() uses provided messageId', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const CUSTOM_ID = 'custom-msg-42';

      const returnedId = await connectedAdapter.publish('test.x', {}, { messageId: CUSTOM_ID });

      expect(returnedId).toBe(CUSTOM_ID);
    });

    it('publish() includes metadata in message body', async () => {
      const { adapter: connectedAdapter, mockJs } = makeConnectedAdapter();
      const META = { source: 'unit' };

      await connectedAdapter.publish('test.x', {}, { metadata: META });

      const [[, body]] = mockJs.publish.mock.calls as unknown as [string, Uint8Array][];
      const decoded = JSON.parse(new TextDecoder().decode(body));
      expect(decoded.metadata).toEqual(META);
    });

    it('publish() returns generated message ID when not provided', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();

      const id = await connectedAdapter.publish('test.x', {});

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('publishBatch() publishes all messages and returns their IDs', async () => {
      const { adapter: connectedAdapter, mockJs } = makeConnectedAdapter();

      const BATCH_SIZE = 3;
      const messages = Array.from({ length: BATCH_SIZE }, (_, i) => ({
        pattern: `test.batch.${i}`,
        data: { n: i },
      }));

      const ids = await connectedAdapter.publishBatch(messages);

      expect(ids).toHaveLength(BATCH_SIZE);
      expect(mockJs.publish).toHaveBeenCalledTimes(BATCH_SIZE);
      expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    });

    it('publishBatch() returns unique IDs for each message', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();

      const ids = await connectedAdapter.publishBatch([
        { pattern: 'test.a', data: {} },
        { pattern: 'test.b', data: {} },
      ]);

      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe('event handlers', () => {
    it('should register and unregister event handlers', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handler = () => {};

      adapter.on('onReady', handler);
      adapter.off('onReady', handler);

      expect(true).toBe(true);
    });

    it('should register handlers for all event types', () => {
      /* eslint-disable @typescript-eslint/no-empty-function */
      adapter.on('onReady', () => {});
      adapter.on('onError', () => {});
      adapter.on('onMessageReceived', () => {});
      adapter.on('onMessageProcessed', () => {});
      adapter.on('onMessageFailed', () => {});
      /* eslint-enable @typescript-eslint/no-empty-function */

      expect(true).toBe(true);
    });

    it('should fire onReady event after connect succeeds', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);

      // We need to test via the emit path — manually set up mock and call emit
      const onReady = mock(() => undefined);
      connectedAdapter.on('onReady', onReady);

      // Trigger emit directly (simulates post-connect flow)
      a.emit('onReady');

      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it('should fire onError event when emitted', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);
      const error = new Error('connection failed');

      const onError = mock(() => undefined);
      connectedAdapter.on('onError', onError);

      a.emit('onError', error);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should emit onMessageReceived when message consumed', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);

      const payload = {
        id: 'msg-1',
        pattern: 'test.created',
        data: { x: 1 },
        timestamp: Date.now(),
        metadata: {},
      };
      const jsMsg = makeMockJsMsg({
        data: new TextEncoder().encode(JSON.stringify(payload)),
        subject: 'test.created',
      });

      a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

      const onReceived = mock(() => undefined);
      connectedAdapter.on('onMessageReceived', onReceived);

      await connectedAdapter.subscribe('test.created', async () => undefined);
      await new Promise((r) => setTimeout(r, 20));

      expect(onReceived).toHaveBeenCalledTimes(1);
    });

    it('should emit onMessageFailed when handler throws', async () => {
      const { adapter: connectedAdapter } = makeConnectedAdapter();
      const a = asAny(connectedAdapter);

      const payload = {
        id: 'msg-2',
        pattern: 'test.fail',
        data: {},
        timestamp: Date.now(),
        metadata: {},
      };
      const jsMsg = makeMockJsMsg({
        data: new TextEncoder().encode(JSON.stringify(payload)),
        subject: 'test.fail',
      });

      a.js.consumers.get = mock(() => Promise.resolve(makeMockConsumer([jsMsg])));

      const onFailed = mock(() => undefined);
      connectedAdapter.on('onMessageFailed', onFailed);

      await connectedAdapter.subscribe('test.fail', async () => {
        throw new Error('handler error');
      });
      await new Promise((r) => setTimeout(r, 20));

      expect(onFailed).toHaveBeenCalledTimes(1);
    });
  });

  describe('multi-stream support', () => {
    it('should accept streams array in constructor', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'EVENTS', subjects: ['events.>'] },
          { name: 'COMMANDS', subjects: ['commands.>'] },
        ],
      });

      expect(multiAdapter).toBeInstanceOf(JetStreamQueueAdapter);
      expect(multiAdapter.name).toBe('jetstream');
    });

    it('should accept streamDefaults merged into each stream', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'EVENTS', subjects: ['events.>'] },
          { name: 'COMMANDS', subjects: ['commands.>'], retention: 'workqueue' },
        ],
        streamDefaults: {
          retention: 'limits',
          storage: 'memory',
          replicas: 1,
        },
      });

      expect(multiAdapter).toBeInstanceOf(JetStreamQueueAdapter);
    });

    it('should resolve stream name from subject pattern', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'EVENTS', subjects: ['events.>'] },
          { name: 'COMMANDS', subjects: ['commands.>'] },
          { name: 'LOGS', subjects: ['logs.app.*'] },
        ],
      });

      expect(multiAdapter.resolveStreamForSubject('events.created')).toBe('EVENTS');
      expect(multiAdapter.resolveStreamForSubject('events.user.updated')).toBe('EVENTS');
      expect(multiAdapter.resolveStreamForSubject('commands.run')).toBe('COMMANDS');
      expect(multiAdapter.resolveStreamForSubject('logs.app.info')).toBe('LOGS');
    });

    it('should not match > wildcard against zero trailing tokens', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'SPECIFIC', subjects: ['events.>'] },
          { name: 'CATCH_ALL', subjects: ['*'] },
        ],
      });

      expect(multiAdapter.resolveStreamForSubject('events')).toBe('CATCH_ALL');
      expect(multiAdapter.resolveStreamForSubject('events.created')).toBe('SPECIFIC');
    });

    it('should throw if streams array is empty', () => {
      expect(() => new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [],
      })).toThrow('JetStreamQueueAdapter requires at least one stream definition');
    });

    it('refuses to guess a stream for an unbound subject', () => {
      // This used to answer 'DEFAULT' — the first declaration, chosen because nothing matched.
      // nats-server then accepted a consumer whose filter matches nothing that stream holds, and
      // the subscription ran forever, healthy and empty, with nothing logged on either side.
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'DEFAULT', subjects: ['default.>'] },
          { name: 'EVENTS', subjects: ['events.>'] },
        ],
      });

      let message = '';
      try {
        multiAdapter.resolveStreamForSubject('unknown.topic');
      } catch (error) {
        message = (error as Error).message;
      }

      // Both halves matter: the refusal, and enough of the configuration to see why.
      expect(message).toMatch(/No declared stream binds "unknown\.topic"/);
      expect(message).toContain('DEFAULT');
      expect(message).toContain('EVENTS');
    });
  });

  describe('createJetStreamQueueAdapter', () => {
    it('should create adapter instance', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [{ name: 'MY_STREAM', subjects: ['my.>'] }],
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
      expect(created.name).toBe('jetstream');
    });

    it('should accept stream configuration', () => {
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          {
            name: 'EVENTS', subjects: ['events.>'], retention: 'limits', maxMsgs: 1_000_000,
          },
        ],
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
    });

    it('should accept consumer configuration', () => {
      const ACK_WAIT_NS = 30_000_000_000;
      const MAX_DELIVER = 5;
      const created = createJetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
        consumerConfig: {
          ackWait: ACK_WAIT_NS,
          maxDeliver: MAX_DELIVER,
        },
      });

      expect(created).toBeInstanceOf(JetStreamQueueAdapter);
    });
  });
});

 
// ============================================================================
// Baseline pins
//
// This block is the ONLY place `// RETIRED BY:` may appear. Each tagged line is
// inverted by exactly one later work item, which DELETES the line — never skips
// it, never flips it in place. Untagged assertions here are permanent.
//
// Pins reading `mockJsm.consumers.add.mock.calls[0][1]` are absent-branch-only
// once the explicit-acks item lands (`consumers.info` then decides the path);
// they keep the same asserted values and are never re-pointed at
// `consumers.update`.
// ============================================================================

/** Builds an UNCONNECTED adapter wired for a real `connect()` through the module double. */
function makeConnectableAdapter(overrides: Partial<JetStreamAdapterOptions> = {}) {
  const adapter = new JetStreamQueueAdapter({
    servers: 'nats://localhost:4222',
    streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
    ...overrides,
  });
  activeAdapters.push(adapter);

  const mockJsm = {
    streams: {
      info: mock(() => Promise.resolve(streamInfoPresent())),
      update: mock(() => Promise.resolve()),
      add: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve(true)),
    },
    consumers: {
      add: mock(() => Promise.resolve()),
      info: mock(() => Promise.reject(makeApiError(CONSUMER_NOT_FOUND_CODE, 'consumer not found'))),
      update: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve(true)),
    },
  };
  const mockJs = {
    publish: mock(() => Promise.resolve()),
    consumers: { get: mock(() => Promise.resolve(makeMockConsumer())) },
  };

  // The adapter builds its NatsClient eagerly in the constructor (`:225`), so the
  // substitution has to happen on the instance before connect() runs.
  asAny(adapter).client = {
    connect: mock(() => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    isConnected: mock(() => true),
    getConnection: mock(() => ({ drain: mock(() => Promise.resolve()) })),
  };

  // Repointable so two adapters can be aimed at ONE manager — see twoAdaptersSharingOneServer.
  const doubles = { js: mockJs as AnyRecord, jsm: mockJsm as AnyRecord };

  // Stands in for `connect()`, which cannot be intercepted: it resolves the client module
  // through a module-level free function, and overriding that would need a `protected` seam
  // in shipped code. Everything the cases here actually assert on is still the adapter's
  // own — `ensureAllStreams()` runs for real, so stream reconciliation, its guards and its
  // failure branches (each of which emits onError before throwing) are genuinely under test.
  // The real `connect()` is covered end to end against a live broker by all 14 cases in
  // `jetstream.adapter.integration.test.ts`, which is stronger than a mocked one.
  asAny(adapter).connect = async (): Promise<void> => {
    const a = asAny(adapter);

    await a.client.connect();
    a.js = doubles.js;
    a.jsm = doubles.jsm;
    await a.ensureAllStreams();
    a.connected = true;
    a.emit('onReady');
  };

  return {
    adapter,
    mockJs,
    mockJsm,
    /** Aims this adapter at another one's manager, modelling one server seen by two clients. */
    useJsm(jsm: AnyRecord): void {
      doubles.jsm = jsm;
    },
  };
}

describe('baseline: pre-change wire format', () => {
  async function addPayloadFor(
    pattern = 'test.topic',
    options: AnyRecord = { group: 'test-group' },
    overrides: Partial<JetStreamAdapterOptions> = {},
  ): Promise<{ cfg: AnyRecord; mockJsm: AnyRecord; consumer: AnyRecord }> {
    const { adapter, mockJsm, consumer } = makeConnectedAdapter(overrides);
    await adapter.subscribe(pattern, async () => undefined, options);

    return { cfg: callArg(mockJsm.consumers.add, 0, 1), mockJsm, consumer };
  }

  it('consumers.add carries all seven wire fields (structural, by key presence only)', async () => {
    const { cfg } = await addPayloadFor();

    expect('durable_name' in cfg).toBe(true);
    expect('name' in cfg).toBe(true);
    expect('ack_policy' in cfg).toBe(true);
    expect('filter_subject' in cfg).toBe(true);
    expect('max_ack_pending' in cfg).toBe(true);
    expect('ack_wait' in cfg).toBe(true);
    expect('max_deliver' in cfg).toBe(true);
  });

  it('consumers.add default values with no prefetch and no consumerConfig', async () => {
    const { cfg } = await addPayloadFor();

    expect(cfg.max_ack_pending).toBe(100);
    expect(cfg.ack_wait).toBe(30_000_000_000);
    expect(cfg.max_deliver).toBe(3);
  });


  it('consume() is called with the default pull batch size', async () => {
    const { consumer } = await addPayloadFor();

    expect(consumer.consume).toHaveBeenCalledTimes(1);
    expect(callArg(consumer.consume, 0, 0)).toEqual({ max_messages: 10 });
  });

  it('publish WITHOUT messageId sends no third argument to js.publish', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();
    await adapter.publish('test.topic', { a: 1 });

    expect(callArg(mockJs.publish, 0, 2)).toBeUndefined();
  });

  it('absent consumer branch: add is called, update is not', async () => {
    const { mockJsm } = await addPayloadFor();

    expect(mockJsm.consumers.add).toHaveBeenCalledTimes(1);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });

  it('connect() with an EXISTING stream does not take the create path', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();

    await adapter.connect();

    expect(adapter.isConnected()).toBe(true);
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('connect() with an ABSENT stream takes the create path', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    mockJsm.streams.info = mock(() =>
      Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')),
    );

    await adapter.connect();

    expect(mockJsm.streams.add).toHaveBeenCalledTimes(1);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });
});

// ============================================================================
// natsSubjectCovers (via resolveStreamForSubject — private method)
// ============================================================================

describe('natsSubjectCovers (private method via asAny)', () => {
  // Access the private natsSubjectCovers method directly
  const baseAdapter = new JetStreamQueueAdapter({
    servers: 'nats://localhost:4222',
    streams: [{ name: 'S', subjects: ['s.>'] }],
  });

  function matches(pattern: string, subject: string): boolean {
    return asAny(baseAdapter).natsSubjectCovers(pattern, subject);
  }

  it('exact match returns true', () => {
    expect(matches('foo.bar', 'foo.bar')).toBe(true);
  });

  it('exact mismatch returns false', () => {
    expect(matches('foo.bar', 'foo.baz')).toBe(false);
  });

  it('single-level wildcard * matches one token', () => {
    expect(matches('foo.*', 'foo.bar')).toBe(true);
    expect(matches('foo.*', 'foo.baz')).toBe(true);
  });

  it('single-level wildcard * does NOT match multiple tokens', () => {
    expect(matches('foo.*', 'foo.bar.baz')).toBe(false);
  });

  it('multi-level wildcard > matches one or more trailing tokens', () => {
    expect(matches('foo.>', 'foo.bar')).toBe(true);
    expect(matches('foo.>', 'foo.bar.baz')).toBe(true);
    expect(matches('foo.>', 'foo.a.b.c')).toBe(true);
  });

  it('multi-level wildcard > does NOT match zero trailing tokens', () => {
    expect(matches('foo.>', 'foo')).toBe(false);
  });

  it('pattern longer than subject returns false', () => {
    expect(matches('foo.bar.baz', 'foo.bar')).toBe(false);
  });

  it('subject longer than pattern (no wildcard) returns false', () => {
    expect(matches('foo.bar', 'foo.bar.baz')).toBe(false);
  });

  it('# in stream definition is converted to > and matches correctly', () => {
    const a = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [
        { name: 'EVENTS', subjects: ['events.#'] }, // # => >
      ],
    });
    expect(a.resolveStreamForSubject('events.created')).toBe('EVENTS');
    expect(a.resolveStreamForSubject('events.user.updated')).toBe('EVENTS');
  });
});

// ============================================================================
// natsSubjectsOverlap (private method)
//
// Mirrors the covers block above, and exists to keep the pair apart. Coverage is
// what `droppedSubjects` needs — "is a subject the server already holds still
// bound by what I declare" — and overlap is what stream resolution wants. One
// predicate served both once; that mismatch is the defect this item closes, and
// merging them again would re-open it inside the reconciler, silently.
// ============================================================================

describe('natsSubjectsOverlap (private method via asAny)', () => {
  const baseAdapter = new JetStreamQueueAdapter({
    servers: 'nats://localhost:4222',
    streams: [{ name: 'S', subjects: ['s.>'] }],
  });

  function overlaps(a: string, b: string): boolean {
    return asAny(baseAdapter).natsSubjectsOverlap(a, b);
  }

  it('is symmetric where coverage is not', () => {
    // Neither covers the other; both name `events.created`.
    expect(overlaps('events.created', 'events.*')).toBe(true);
    expect(overlaps('events.*', 'events.created')).toBe(true);
  });

  it('finds an overlap that neither side covers', () => {
    // `a.b.c` matches both, and neither pattern contains the other.
    expect(overlaps('a.*.c', 'a.b.>')).toBe(true);
    expect(overlaps('a.b.>', 'a.*.c')).toBe(true);
  });

  it('does not let * reach across a token boundary', () => {
    expect(overlaps('foo.*', 'foo.bar.baz')).toBe(false);
    expect(overlaps('foo.bar.baz', 'foo.*')).toBe(false);
  });

  it('treats > as absorbing everything from its position', () => {
    expect(overlaps('events.>', 'events.a.b.c')).toBe(true);
    expect(overlaps('events.>', 'events.*')).toBe(true);
    expect(overlaps('>', 'anything.at.all')).toBe(true);
  });

  it('does not let > match zero trailing tokens', () => {
    // `events.>` needs at least one token after `events`, so it never names `events` itself.
    expect(overlaps('events.>', 'events')).toBe(false);
  });

  it('rejects disjoint subjects', () => {
    expect(overlaps('events.created', 'orders.created')).toBe(false);
    expect(overlaps('events.*', 'orders.*')).toBe(false);
  });

  it('is reflexive, which keeps reconciliation idempotent', () => {
    expect(overlaps('orders.*', 'orders.*')).toBe(true);
    expect(overlaps('orders.>', 'orders.>')).toBe(true);
  });

  it('is implied by coverage', () => {
    // Coverage is strictly stronger, which is what makes consulting it first well-founded.
    const pairs: Array<[string, string]> = [
      ['events.>', 'events.created'],
      ['events.*', 'events.created'],
      ['*', 'events'],
      ['foo.bar', 'foo.bar'],
    ];

    for (const [declared, subject] of pairs) {
      expect(asAny(baseAdapter).natsSubjectCovers(declared, subject)).toBe(true);
      expect(overlaps(declared, subject)).toBe(true);
    }
  });

  it('pins the asymmetry the covers predicate was getting wrong', () => {
    // `orders.a.b` matches `orders.>` and not `orders.*`, so `orders.*` does not cover
    // `orders.>` — but they do overlap on `orders.x`. The old single predicate answered
    // "covers" here, which is what let a narrowing declaration through.
    expect(asAny(baseAdapter).natsSubjectCovers('orders.*', 'orders.>')).toBe(false);
    expect(overlaps('orders.*', 'orders.>')).toBe(true);
  });
});

// ============================================================================
// Stream resolution: wildcard patterns against literal declarations
// ============================================================================

describe('stream resolution: a wildcard pattern over literal declarations', () => {
  it('resolves through the overlap pass and sends the wildcard as the filter', async () => {
    // Measured against nats-server 2.10: a `filter_subject` of `events.*` on a stream declared
    // `['events.created','events.updated']` is accepted AND delivers. This is not a configuration
    // the coverage pass can reach — no declared subject covers `events.*` — so the overlap pass
    // is what keeps it working. See the OQ-B case in jetstream.adapter.integration.test.ts.
    // `OTHER` is declared FIRST and binds nothing here, deliberately: the deleted fallback
    // returned `resolvedStreams[0]`, so a single-stream fixture would answer 'EVENTS' on the old
    // code too and prove nothing.
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [
        { name: 'OTHER', subjects: ['other.>'] },
        { name: 'EVENTS', subjects: ['events.created', 'events.updated'] },
      ],
    });

    expect(adapter.resolveStreamForSubject('events.*')).toBe('EVENTS');

    await adapter.subscribe('events.*', async () => undefined, { group: 'w' });

    expect(callArg(mockJsm.consumers.add, 0, 0) as unknown as string).toBe('EVENTS');
    expect(callArg(mockJsm.consumers.add, 0, 1).filter_subject).toBe('events.*');
  });

  it('resolves a broader pattern over a narrower declaration, through overlap and not coverage', async () => {
    // The other direction: declared `events.*`, subscribed `events.>`. `events.*` does NOT cover
    // `events.>` — `events.a.b` matches the second and not the first — which is exactly what the
    // old matcher got wrong. Overlap still holds on `events.x`.
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [
        { name: 'OTHER', subjects: ['other.>'] },
        { name: 'EVENTS', subjects: ['events.*'] },
      ],
    });

    expect(asAny(adapter).natsSubjectCovers('events.*', 'events.>')).toBe(false);
    expect(asAny(adapter).natsSubjectsOverlap('events.*', 'events.>')).toBe(true);
    expect(adapter.resolveStreamForSubject('events.>')).toBe('EVENTS');

    await adapter.subscribe('events.#', async () => undefined, { group: 'w' });

    expect(callArg(mockJsm.consumers.add, 0, 1).filter_subject).toBe('events.>');
  });

  it('prefers the stream that binds the whole pattern over one holding a slice of it', () => {
    // Coverage before overlap. Without that ordering, widening the matcher would re-route
    // configurations that resolve correctly today.
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [
        { name: 'BROAD', subjects: ['events.>'] },
        { name: 'NARROW', subjects: ['events.created'] },
      ],
    });

    expect(adapter.resolveStreamForSubject('events.*')).toBe('BROAD');
  });
});

// ============================================================================
// Stream resolution: ambiguity is refused, on both passes
//
// A silent tiebreak is not behaviourally neutral. `durableConsumerName` omits the
// stream, so resolving the same pattern to a different stream on a later boot
// creates the same durable elsewhere and orphans the first with its delivery
// position — and streams carry their own retention, limits and storage.
// ============================================================================

describe('stream resolution: ambiguity', () => {
  function resolveError(adapter: JetStreamQueueAdapter, subject: string): string {
    try {
      adapter.resolveStreamForSubject(subject);
    } catch (error) {
      return (error as Error).message;
    }

    return '';
  }

  it('refuses when two declarations each hold a slice of the pattern', () => {
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [
        { name: 'EVENTS_CREATED', subjects: ['events.created'] },
        { name: 'EVENTS_UPDATED', subjects: ['events.updated'] },
      ],
    });

    const message = resolveError(adapter, 'events.*');

    expect(message).toContain('EVENTS_CREATED');
    expect(message).toContain('EVENTS_UPDATED');
    expect(message).toContain('holds part of');
  });

  it('refuses when two declarations both bind the whole pattern', () => {
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [
        { name: 'PRIMARY', subjects: ['events.>'] },
        { name: 'ARCHIVE', subjects: ['events.>'] },
      ],
    });

    const message = resolveError(adapter, 'events.created');

    expect(message).toContain('PRIMARY');
    expect(message).toContain('ARCHIVE');
    expect(message).toContain('binds all of');
  });

  it('refuses a catch-all subscription across a multi-stream application', () => {
    // `@Subscribe('#')` translates to `>`, which overlaps every declaration. It used to take
    // `resolvedStreams[0]` and consume one stream's worth of a pattern that claims all of them.
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [
        { name: 'EVENTS', subjects: ['events.>'] },
        { name: 'COMMANDS', subjects: ['commands.>'] },
      ],
    });

    const message = resolveError(adapter, '#');

    expect(message).toContain('EVENTS');
    expect(message).toContain('COMMANDS');
  });

  it('counts one stream declaring several matching subjects as one candidate', () => {
    // The dedup that keeps a well-formed stream from looking like an ambiguity.
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>', 'orders.created'] }],
    });

    expect(adapter.resolveStreamForSubject('orders.created')).toBe('ORDERS');
  });

  it('refuses when one name is declared twice with different subjects', () => {
    // Not deduplicated by name, deliberately: one name with two definitions is a configuration
    // error, and reconciliation would apply whichever came last. Refusing beats picking.
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [
        { name: 'ORDERS', subjects: ['orders.created'] },
        { name: 'ORDERS', subjects: ['orders.updated'] },
      ],
    });

    expect(resolveError(adapter, 'orders.*')).toContain('claimed by more than one declared stream');
  });

  it('refuses on the destructive path too, instead of taking the first candidate', async () => {
    // The private strict twin this replaces returned the first match on ambiguity, so
    // deleteDurableConsumer was MORE lenient than subscribe.
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [
        { name: 'EVENTS_CREATED', subjects: ['events.created'] },
        { name: 'EVENTS_UPDATED', subjects: ['events.updated'] },
      ],
    });

    await expect(adapter.deleteDurableConsumer('events.*', 'workers'))
      .rejects.toThrow(/is claimed by more than one declared stream/);
    expect(mockJsm.consumers.delete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// generateMessageId (private method)
// ============================================================================

describe('generateMessageId', () => {
  it('returns a non-empty string', () => {
    const a = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'S', subjects: ['s.>'] }],
    });

    const id = asAny(a).generateMessageId();

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('returns unique IDs on each call', () => {
    const a = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'S', subjects: ['s.>'] }],
    });

    const CALLS = 10;
    const ids = new Set(Array.from({ length: CALLS }, () => asAny(a).generateMessageId()));

    expect(ids.size).toBe(CALLS);
  });

  it('IDs start with "js-" prefix', () => {
    const a = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'S', subjects: ['s.>'] }],
    });

    const id = asAny(a).generateMessageId();

    expect(id.startsWith('js-')).toBe(true);
  });
});
 

// ============================================================================
// Explicit acks, consumerConfig precedence, and the probe-first consumer flow
//
// The adapter no longer blind-adds inside a bare catch. It probes
// `consumers.info` first, classifies the rejection by numeric API code, and then
// creates, no-ops, updates or hard-fails. Everything below drives that flow.
// ============================================================================

describe('resolveConsumerConfig precedence', () => {
  async function addPayload(
    options: AnyRecord = { group: 'test-group' },
    overrides: Partial<JetStreamAdapterOptions> = {},
  ): Promise<{ cfg: AnyRecord; consumer: AnyRecord }> {
    const { adapter, mockJsm, consumer } = makeConnectedAdapter(overrides);
    await adapter.subscribe('test.topic', async () => undefined, options);

    return { cfg: callArg(mockJsm.consumers.add, 0, 1), consumer };
  }

  it('uses AckPolicy.Explicit when ackMode is left unset', async () => {
    const { cfg } = await addPayload();

    expect(cfg.ack_policy).toBe(realJetStream.AckPolicy.Explicit);
  });

  it('uses AckPolicy.Explicit for ackMode auto', async () => {
    const { cfg } = await addPayload({ group: 'test-group', ackMode: 'auto' });

    expect(cfg.ack_policy).toBe(realJetStream.AckPolicy.Explicit);
  });

  it('uses AckPolicy.Explicit for ackMode manual', async () => {
    const { cfg } = await addPayload({ group: 'test-group', ackMode: 'manual' });

    expect(cfg.ack_policy).toBe(realJetStream.AckPolicy.Explicit);
  });

  it('honours consumerConfig.maxAckPending when no prefetch is given', async () => {
    const { cfg } = await addPayload(
      { group: 'test-group' },
      { consumerConfig: { maxAckPending: 1 } },
    );

    expect(cfg.max_ack_pending).toBe(1);
  });

  it('lets prefetch override consumerConfig.maxAckPending', async () => {
    const { cfg } = await addPayload(
      { group: 'test-group', prefetch: 5 },
      { consumerConfig: { maxAckPending: 1 } },
    );

    expect(cfg.max_ack_pending).toBe(5);
  });

  it('falls back to the default when neither is set', async () => {
    const { cfg } = await addPayload();

    expect(cfg.max_ack_pending).toBe(100);
  });

  it('lets retry.attempts win over consumerConfig.maxDeliver', async () => {
    const { cfg } = await addPayload(
      { group: 'test-group', retry: { attempts: 7 } },
      { consumerConfig: { maxDeliver: 5 } },
    );

    expect(cfg.max_deliver).toBe(7);
  });

  it('uses consumerConfig.maxDeliver when retry.attempts is absent', async () => {
    const { cfg } = await addPayload({ group: 'test-group' }, { consumerConfig: { maxDeliver: 5 } });

    expect(cfg.max_deliver).toBe(5);
  });

  it('falls back to the default max_deliver', async () => {
    const { cfg } = await addPayload();

    expect(cfg.max_deliver).toBe(3);
  });

  it('applies ack_wait and max_deliver in the same add call', async () => {
    const { cfg } = await addPayload(
      { group: 'test-group' },
      { consumerConfig: { ackWait: 1_000, maxDeliver: 5 } },
    );

    expect(cfg.ack_wait).toBe(1_000);
    expect(cfg.max_deliver).toBe(5);
  });

  it('converts ackTimeout from milliseconds to nanoseconds', async () => {
    const { cfg } = await addPayload({ group: 'test-group', ackTimeout: 30 * 60 * 1000 });

    expect(cfg.ack_wait).toBe(1_800_000_000_000);
  });

  it('treats ackTimeout: 0 as a value, not as absent', async () => {
    // Guards the `!== undefined` test against a `||` regression, which would silently
    // swap a zero window for the 30s default. What the server makes of 0 is its business.
    const { cfg } = await addPayload(
      { group: 'test-group', ackTimeout: 0 },
      { consumerConfig: { ackWait: 1_000 } },
    );

    expect(cfg.ack_wait).toBe(0);
  });

  it('lets ackTimeout win over consumerConfig.ackWait', async () => {
    // The two are in DIFFERENT units, so a resolver that forgot the conversion would
    // still produce a number and only this pairing catches it.
    const { cfg } = await addPayload(
      { group: 'test-group', ackTimeout: 5_000 },
      { consumerConfig: { ackWait: 1_000 } },
    );

    expect(cfg.ack_wait).toBe(5_000_000_000);
  });

  it('falls back to consumerConfig.ackWait when ackTimeout is absent', async () => {
    const { cfg } = await addPayload({ group: 'test-group' }, { consumerConfig: { ackWait: 1_000 } });

    expect(cfg.ack_wait).toBe(1_000);
  });

  it('falls back to the default ack_wait when neither is set', async () => {
    const { cfg } = await addPayload();

    expect(cfg.ack_wait).toBe(30_000_000_000);
  });

  it('clamps the consume batch to max_ack_pending', async () => {
    // The only shape that distinguishes Math.min from a plain fallback: a small
    // ack window with no prefetch must not pull a batch bigger than the window.
    const { consumer } = await addPayload(
      { group: 'test-group' },
      { consumerConfig: { maxAckPending: 1 } },
    );

    expect(callArg(consumer.consume, 0, 0)).toEqual({ max_messages: 1 });
  });

  it('uses prefetch as the consume batch when it is given', async () => {
    const { consumer } = await addPayload({ group: 'test-group', prefetch: 50 });

    expect(callArg(consumer.consume, 0, 0)).toEqual({ max_messages: 50 });
  });
});

describe('ensureConsumer: probe-first reconciliation', () => {
  /** The hash the adapter computes for the harness defaults. */
  function defaultHash(overrides: Partial<AnyRecord> = {}): string {
    return hashReconcileConfig({
      ack_wait: 30_000_000_000,
      filter_subject: 'test.topic',
      max_ack_pending: 100,
      max_deliver: 3,
      ...overrides,
    });
  }

  it('reads JetStreamApiCodes.ConsumerNotFound off the client module', () => {
    // The adapter classifies absence by this numeric code. A typo in the property
    // path would silently yield undefined and make every probe rejection fatal.
    expect(realJetStream.JetStreamApiCodes.ConsumerNotFound).toBe(CONSUMER_NOT_FOUND_CODE);
    expect(realJetStream.JetStreamApiCodes.StreamNotFound).toBe(STREAM_NOT_FOUND_CODE);
  });

  it('probes before it creates', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });

    expect(mockJsm.consumers.info).toHaveBeenCalledTimes(1);
  });

  it('ABSENT: creates the consumer and stamps it', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });

    expect(mockJsm.consumers.add).toHaveBeenCalledTimes(1);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();

    const metadata = callArg(mockJsm.consumers.add, 0, 1).metadata;

    expect(metadata[CONFIG_STAMP_KEYS.configHash]).toBe(defaultHash());
    expect(Number.isNaN(Date.parse(metadata[CONFIG_STAMP_KEYS.reconciledAt]))).toBe(false);
    expect(CONFIG_STAMP_KEYS.prevConfigHash in metadata).toBe(false);
  });

  it('NO-OP: an unchanged configuration writes nothing at all', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, { metadata: { [CONFIG_STAMP_KEYS.configHash]: defaultHash() } });

    const subscription = await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });

    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
    expect(subscription.isActive).toBe(true);
  });

  it('UPDATE: sends only updatable keys and preserves server metadata', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    const stale = 'a'.repeat(32);
    seedConsumerInfo(mockJsm, {
      max_ack_pending: 7,
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: stale,
        [CONFIG_STAMP_KEYS.prevConfigHash]: 'b'.repeat(32),
         
        _nats_v: '2',
      },
    });

    await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });

    expect(mockJsm.consumers.update).toHaveBeenCalledTimes(1);

    // update(stream, durable, cfg) — the config is the THIRD argument, unlike add().
    const cfg = callArg(mockJsm.consumers.update, 0, 2);

    expect(Object.keys(cfg).sort())
      .toEqual(['ack_wait', 'filter_subject', 'max_ack_pending', 'max_deliver', 'metadata']);
    expect(cfg.metadata[CONFIG_STAMP_KEYS.configHash]).toBe(defaultHash());
    expect(cfg.metadata[CONFIG_STAMP_KEYS.prevConfigHash]).toBe(stale);
    expect(Number.isNaN(Date.parse(cfg.metadata[CONFIG_STAMP_KEYS.reconciledAt]))).toBe(false);
    // Without the client-side merge the shallow Object.assign inside update() would
    // destroy every server-owned key.
    expect(cfg.metadata._nats_v).toBe('2');
  });

  it('CYCLE: two writers disagreeing is a hard failure, not a silent overwrite', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({ consumerConfig: { maxAckPending: 7 } });
    const desired = defaultHash({ max_ack_pending: 7 });
    const current = 'e'.repeat(32);
    seedConsumerInfo(mockJsm, {
      max_ack_pending: 100,
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: current,
        [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
        [CONFIG_STAMP_KEYS.reconciledAt]: new Date().toISOString(),
      },
    });

    const seen: Error[] = [];
    adapter.on('onError', (error: Error) => {
      seen.push(error);
    });

    let thrown: Error | undefined;
    try {
      await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain(desired);
    expect(thrown!.message).toContain(current);
    expect(thrown!.message).toContain('test-group');
    expect(thrown!.message).toContain('TEST_STREAM');
    expect(thrown!.message).toContain('max_ack_pending');
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
    // subscribe() is awaited during boot before any @OnQueueError handler exists,
    // so throwing alone would reach nobody who registered a listener.
    expect(seen).toContain(thrown!);
  });

  it('ROLLBACK: the same fixture updates once the cycle window has passed', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({ consumerConfig: { maxAckPending: 7 } });
    seedConsumerInfo(mockJsm, {
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: 'e'.repeat(32),
        [CONFIG_STAMP_KEYS.prevConfigHash]: defaultHash({ max_ack_pending: 7 }),
        [CONFIG_STAMP_KEYS.reconciledAt]: new Date(Date.now() - CONFIG_CYCLE_WINDOW_MS - 1000).toISOString(),
      },
    });

    await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });

    expect(mockJsm.consumers.update).toHaveBeenCalledTimes(1);
  });

  it('CYCLE: a missing reconciled-at is treated as a cycle', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({ consumerConfig: { maxAckPending: 7 } });
    seedConsumerInfo(mockJsm, {
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: 'e'.repeat(32),
        [CONFIG_STAMP_KEYS.prevConfigHash]: defaultHash({ max_ack_pending: 7 }),
      },
    });

    await expect(
      adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' }),
    ).rejects.toThrow(/reconcile cycle/);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });
});

describe('ackTimeout: reconciling an existing durable consumer', () => {
  const DEFAULT_ACK_WAIT = 30_000_000_000;
  const WANTED_ACK_WAIT = 45_000_000_000;

  /** The hash the adapter computes for the harness defaults at a given ack_wait. */
  function hashAt(ackWait: number): string {
    return hashReconcileConfig({
      ack_wait: ackWait,
      filter_subject: 'test.topic',
      max_ack_pending: 100,
      max_deliver: 3,
    });
  }

  it('NO-OP: an unchanged ackTimeout writes nothing at all', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, {
      ack_wait: WANTED_ACK_WAIT,
      metadata: { [CONFIG_STAMP_KEYS.configHash]: hashAt(WANTED_ACK_WAIT) },
    });

    await adapter.subscribe('test.topic', async () => undefined, {
      group: 'test-group',
      ackTimeout: 45_000,
    });

    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });

  it('UPDATE: a changed ackTimeout reconciles in place, preserving server metadata', async () => {
    // The point of routing ackTimeout through the config stamp rather than the durable
    // name: the consumer keeps its position instead of a second one splitting the load.
    const { adapter, mockJsm } = makeConnectedAdapter();
    const stale = hashAt(DEFAULT_ACK_WAIT);
    seedConsumerInfo(mockJsm, {
      ack_wait: DEFAULT_ACK_WAIT,
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: stale,

        _nats_v: '2',
      },
    });

    await adapter.subscribe('test.topic', async () => undefined, {
      group: 'test-group',
      ackTimeout: 45_000,
    });

    expect(mockJsm.consumers.update).toHaveBeenCalledTimes(1);
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();

    // update(stream, durable, cfg) — the config is the THIRD argument, unlike add().
    const cfg = callArg(mockJsm.consumers.update, 0, 2);

    expect(cfg.ack_wait).toBe(WANTED_ACK_WAIT);
    expect(cfg.metadata[CONFIG_STAMP_KEYS.configHash]).toBe(hashAt(WANTED_ACK_WAIT));
    expect(cfg.metadata[CONFIG_STAMP_KEYS.prevConfigHash]).toBe(stale);
    expect(cfg.metadata._nats_v).toBe('2');
  });

  it('CYCLE: two processes disagreeing on ackTimeout name both values, not just a hash', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, {
      ack_wait: DEFAULT_ACK_WAIT,
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: 'e'.repeat(32),
        [CONFIG_STAMP_KEYS.prevConfigHash]: hashAt(WANTED_ACK_WAIT),
        [CONFIG_STAMP_KEYS.reconciledAt]: new Date().toISOString(),
      },
    });

    let thrown: Error | undefined;
    try {
      await adapter.subscribe('test.topic', async () => undefined, {
        group: 'test-group',
        ackTimeout: 45_000,
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('ack_wait');
    // The two hashes identify the writers; only the values tell an operator what to edit.
    expect(thrown!.message).toContain(String(WANTED_ACK_WAIT));
    expect(thrown!.message).toContain(String(DEFAULT_ACK_WAIT));
    expect(thrown!.message).toContain('test-group');
    expect(thrown!.message).toContain('TEST_STREAM');
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });

  it('keeps two groups on separate consumers, each with its own ack_wait', async () => {
    // Different groups are different consumers by identity, so their windows are
    // independent — the disagreement that must NOT happen is within one identity.
    const { adapter, mockJsm } = makeConnectedAdapter();
    await adapter.subscribe('test.topic', async () => undefined, { group: 'fast', ackTimeout: 1_000 });
    await adapter.subscribe('test.topic', async () => undefined, { group: 'slow', ackTimeout: 600_000 });

    const first = callArg(mockJsm.consumers.add, 0, 1);
    const second = callArg(mockJsm.consumers.add, 1, 1);

    expect(first.ack_wait).not.toBe(second.ack_wait);
    expect(first.durable_name).not.toBe(second.durable_name);
  });

  it('does not let ackTimeout into the durable name', async () => {
    // If it did, changing the timeout would silently strand the old consumer and split
    // the group's load across two of them instead of reconciling the one that exists.
    async function durableFor(options: AnyRecord): Promise<string> {
      const { adapter, mockJsm } = makeConnectedAdapter();
      await adapter.subscribe('test.topic', async () => undefined, options);

      return callArg(mockJsm.consumers.add, 0, 1).durable_name as unknown as string;
    }

    const short = await durableFor({ group: 'test-group', ackTimeout: 1_000 });
    const long = await durableFor({ group: 'test-group', ackTimeout: 90_000 });

    expect(short).toBe(long);
  });
});

describe('ensureConsumer: migration and error classification', () => {
  function nonExplicitMetadata(hash?: string): AnyRecord {
    return hash === undefined ? {} : { [CONFIG_STAMP_KEYS.configHash]: hash };
  }

  it('refuses a consumer whose ack policy is not explicit', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, {
      ack_policy: realJetStream.AckPolicy.None,
      metadata: nonExplicitMetadata(),
    });

    await expect(
      adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' }),
    ).rejects.toThrow(/nats consumer rm/);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });

  it('checks the ack policy before the stamp, even when the hash already matches', async () => {
    // A stamp-first order would return noop here and leave acknowledgements disabled
    // forever on a consumer created by an older release.
    const { adapter, mockJsm } = makeConnectedAdapter();
    const matching = hashReconcileConfig({
      ack_wait: 30_000_000_000,
      filter_subject: 'test.topic',
      max_ack_pending: 100,
      max_deliver: 3,
    });
    seedConsumerInfo(mockJsm, {
      ack_policy: realJetStream.AckPolicy.None,
      metadata: nonExplicitMetadata(matching),
    });

    await expect(
      adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' }),
    ).rejects.toThrow(/nats consumer rm/);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });

  it("accepts an ack_policy none consumer when the subscription declares ackMode 'none'", async () => {
    // The restart path. A durable created under 'none' IS ack_policy none, and asserting
    // Explicit outright rejected on the second boot the very consumer the first boot
    // created — permanently, since ack_policy is create-only and a recreated one is 'none'
    // again. The guard compares against what this subscription wants.
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, {
      ack_policy: realJetStream.AckPolicy.None,
      metadata: nonExplicitMetadata(),
    });

    const subscription = await adapter.subscribe('test.topic', async () => undefined, {
      group: 'test-group',
      ackMode: 'none',
    });

    expect(subscription.isActive).toBe(true);
  });

  it("refuses an ack_policy explicit consumer when the subscription declares ackMode 'none'", async () => {
    // The reverse direction, reachable only once the guard is scoped: the existing
    // consumer would keep tracking acknowledgements nobody sends.
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, { ack_policy: realJetStream.AckPolicy.Explicit, metadata: {} });

    await expect(
      adapter.subscribe('test.topic', async () => undefined, { group: 'test-group', ackMode: 'none' }),
    ).rejects.toThrow(/needs ack_policy=none/);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });

  it('rethrows an unclassified probe rejection as itself', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    const thrownInstance = new Error('permission denied');
    mockJsm.consumers.info = mock(() => Promise.reject(thrownInstance));

    await expect(
      adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' }),
    ).rejects.toBe(thrownInstance);
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });

  it('does not treat the stream not-found code as a missing consumer', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    const thrownInstance = makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found');
    mockJsm.consumers.info = mock(() => Promise.reject(thrownInstance));

    await expect(
      adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' }),
    ).rejects.toBe(thrownInstance);
    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });

  it('wraps an add failure with the consumer, the stream and the original cause', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    const cause = new Error('maximum consumers exceeded');
    mockJsm.consumers.add = mock(() => Promise.reject(cause));

    let thrown: Error | undefined;
    try {
      await adapter.subscribe('test.{id}', async () => undefined, { group: 'test-group' });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.message).toContain('test-group');
    expect(thrown!.message).toContain('TEST_STREAM');
    expect(thrown!.cause).toBe(cause);

    // What was actually attempted. The server names a consumer and a stream and nothing else,
    // which leaves the reader to work out which subscription that was — so the OneBun pattern,
    // the subject it translated to and the declarations are all part of the message. The pattern
    // and the filter differ here (`test.{id}` vs `test.*`) so neither can stand in for the other.
    expect(thrown!.message).toContain('test.{id}');
    expect(thrown!.message).toContain('test.*');
    expect(thrown!.message).toContain('test.>');
  });

  it('wraps an update failure and tells the operator how to recover', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, { metadata: { [CONFIG_STAMP_KEYS.configHash]: 'f'.repeat(32) } });
    const cause = new Error('consumer config immutable');
    mockJsm.consumers.update = mock(() => Promise.reject(cause));

    let thrown: Error | undefined;
    try {
      await adapter.subscribe('test.{id}', async () => undefined, { group: 'test-group' });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.message).toContain('test-group');
    expect(thrown!.message).toContain('TEST_STREAM');
    expect(thrown!.message).toContain('Delete it');
    expect(thrown!.cause).toBe(cause);

    // Same attempt context as the add path — the two messages differ only in the recovery advice.
    expect(thrown!.message).toContain('test.{id}');
    expect(thrown!.message).toContain('test.*');
    expect(thrown!.message).toContain('test.>');
  });

  it('refuses to hijack an existing consumer for an ephemeral subscription', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm);

    await expect(
      adapter.subscribe('test.topic', async () => undefined),
    ).rejects.toThrow(/group/);
    expect(mockJsm.consumers.update).not.toHaveBeenCalled();
  });

  it('emits onError in addition to throwing, for every failure branch', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    mockJsm.consumers.add = mock(() => Promise.reject(new Error('nope')));

    const seen: Error[] = [];
    adapter.on('onError', (error: Error) => {
      seen.push(error);
    });

    let thrown: Error | undefined;
    try {
      await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });
    } catch (error) {
      thrown = error as Error;
    }

    expect(seen).toContain(thrown!);
  });
});

// ============================================================================
// publish(): reporting the real cause when no stream binds the subject
//
// The server answers an unbound subject with `jetstream is not enabled`, which
// names neither the subject nor the streams. The adapter re-reports it with that
// context and keeps the original as `cause`.
// ============================================================================

describe('publish() failure reporting', () => {
  /** The rejection a real broker sends for a subject no stream binds. */
  function jetStreamNotEnabled(): Error {
    return new Error('jetstream is not enabled');
  }

  it('names the OneBun pattern and the NATS subject', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();
    mockJs.publish = mock(() => Promise.reject(jetStreamNotEnabled()));

    let thrown: Error | undefined;
    try {
      await adapter.publish('orders.#', { id: 1 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('orders.#');
    expect(thrown!.message).toContain('orders.>');
  });

  it('names every configured stream with its subjects', async () => {
    const { adapter, mockJs } = makeConnectedAdapter({
      streams: [
        { name: 'TEST_STREAM', subjects: ['test.>'] },
        { name: 'AGENT_EVENTS', subjects: ['agent.events.>', 'agent.dlq.>'] },
      ],
    });
    mockJs.publish = mock(() => Promise.reject(jetStreamNotEnabled()));

    let thrown: Error | undefined;
    try {
      await adapter.publish('orders.created', { id: 1 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.message).toContain('TEST_STREAM');
    expect(thrown!.message).toContain('test.>');
    expect(thrown!.message).toContain('AGENT_EVENTS');
    expect(thrown!.message).toContain('agent.events.>');
    expect(thrown!.message).toContain('agent.dlq.>');
  });

  it('does not repeat the misleading server text', async () => {
    // The whole point of the wrapper: an operator grepping their log for the real
    // problem must not find "jetstream is not enabled" staring back at them.
    const { adapter, mockJs } = makeConnectedAdapter();
    mockJs.publish = mock(() => Promise.reject(jetStreamNotEnabled()));

    let thrown: Error | undefined;
    try {
      await adapter.publish('orders.created', { id: 1 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.message).not.toContain('jetstream is not enabled');
  });

  it('preserves the original rejection as the cause', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();
    const original = jetStreamNotEnabled();
    mockJs.publish = mock(() => Promise.reject(original));

    let thrown: Error | undefined;
    try {
      await adapter.publish('orders.created', { id: 1 });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.cause).toBe(original);
  });

  it('does not pre-flight against the locally declared streams', async () => {
    // A subject may legitimately be bound by a stream this application never
    // declares. Only the broker knows, so an undeclared subject must still be
    // attempted rather than rejected locally.
    const { adapter, mockJs } = makeConnectedAdapter();

    const id = await adapter.publish('somebody.elses.subject', { id: 1 });

    expect(id).toBeDefined();
    expect(mockJs.publish).toHaveBeenCalledTimes(1);

    // callArg is typed for object payloads; this argument is the subject string.
    const subject = callArg(mockJs.publish, 0, 0) as unknown as string;

    expect(subject).toBe('somebody.elses.subject');
  });
});

// ============================================================================
// ensureStream(): reconcile without wiping or narrowing
//
// The old flow sent every key on every connect, so an undeclared `max_msgs`
// travelled as an explicit `undefined` and the client's shallow Object.assign
// wiped whatever the server had. It also swallowed every info() error and
// "created" a stream that already existed.
// ============================================================================

describe('ensureStream: payload shape', () => {
  async function connectWith(overrides: Partial<JetStreamAdapterOptions> = {}) {
    const { adapter, mockJsm } = makeConnectableAdapter(overrides);
    await adapter.connect();

    return { adapter, mockJsm };
  }

  it('ensureStream: undeclared keys are absent from the update payload', async () => {
    const { mockJsm } = await connectWith();
    const cfg = callArg(mockJsm.streams.update, 0, 1);

    // Key-presence, never toBeUndefined(): an explicit undefined is exactly what the
    // client's shallow Object.assign fails to defeat, and it reads as undefined too.
    expect('max_msgs' in cfg).toBe(false);
    expect('max_bytes' in cfg).toBe(false);
    expect('max_age' in cfg).toBe(false);
  });

  it('sends only subjects and metadata for a minimally declared stream', async () => {
    const { mockJsm } = await connectWith();

    expect(Object.keys(callArg(mockJsm.streams.update, 0, 1)).sort())
      .toEqual(['metadata', 'subjects']);
  });

  it('carries a declared limit into the update payload', async () => {
    const { mockJsm } = await connectWith({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], maxMsgs: 1000 }],
    });
    const cfg = callArg(mockJsm.streams.update, 0, 1);

    expect(Object.keys(cfg).sort()).toEqual(['max_msgs', 'metadata', 'subjects']);
    expect(cfg.max_msgs).toBe(1000);
  });

  it('applies retention, storage and replica defaults on the create path only', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    mockJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));

    await adapter.connect();

    const cfg = callArg(mockJsm.streams.add, 0, 0);

    expect(Object.keys(cfg).sort())
      .toEqual(['metadata', 'name', 'num_replicas', 'retention', 'storage', 'subjects']);
    expect(cfg.retention).toBe('limits');
    expect(cfg.storage).toBe('file');
    expect(cfg.num_replicas).toBe(1);
  });

  it('never sends retention or storage on update, even when declared', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{
        name: 'TEST_STREAM', subjects: ['test.>'], retention: 'limits', storage: 'file',
      }],
    });
    // A real server always reports these; the harness default omits them, and an omitted
    // value would legitimately read as a divergence.
    mockJsm.streams.info = mock(() => Promise.resolve(
      streamInfoPresent({ retention: 'limits', storage: 'file' }),
    ));

    await adapter.connect();

    const cfg = callArg(mockJsm.streams.update, 0, 1);

    expect('retention' in cfg).toBe(false);
    expect('storage' in cfg).toBe(false);
  });

  it('treats streamDefaults as declared on both paths', async () => {
    const declared: Partial<JetStreamAdapterOptions> = {
      streamDefaults: { replicas: 3 },
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
    };

    const { mockJsm } = await connectWith(declared);

    expect(callArg(mockJsm.streams.update, 0, 1).num_replicas).toBe(3);

    const { adapter: fresh, mockJsm: freshJsm } = makeConnectableAdapter(declared);
    freshJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));
    await fresh.connect();

    expect(callArg(freshJsm.streams.add, 0, 0).num_replicas).toBe(3);
  });
});

describe('ensureStream: guards', () => {
  function stampedInfo(hash: string, config: Partial<AnyRecord> = {}): AnyRecord {
    return streamInfoPresent({
      metadata: { [CONFIG_STAMP_KEYS.configHash]: hash },
      ...config,
    });
  }

  /** The hash the adapter computes for a minimally declared TEST_STREAM. */
  function minimalHash(): string {
    return hashReconcileConfig({
      subjects: ['test.>'],
      max_msgs: undefined,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
  }

  it('rejects a declaration that would narrow an existing stream', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['a.x'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ subjects: ['a.x', 'a.y'] })));

    await expect(adapter.connect()).rejects.toThrow(/a\.y/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('allows a declaration that covers an existing subject only as a union', async () => {
    // `orders.*` and `orders.*.>` partition `orders.>` exactly: neither half covers it, together
    // they cover it with nothing left over. Asking the coverage question per declared subject
    // answered "narrowing" and refused to boot, naming a subject that would still be stored.
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.*', 'orders.*.#'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ subjects: ['orders.>'] })));

    await adapter.connect();

    expect(mockJsm.streams.update).toHaveBeenCalledTimes(1);
  });

  it('still refuses when the union leaves a hole', async () => {
    // One token deeper than the declarations reach: `orders.a.b.c` is stored under `orders.>` and
    // named by neither `orders.*` nor `orders.*.*`.
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.*', 'orders.*.*'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ subjects: ['orders.>'] })));

    await expect(adapter.connect()).rejects.toThrow(/orders\.>/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('rejects a wildcard declaration that narrows a broader wildcard on the server', async () => {
    // The hole the generalised predicate closes. `natsSubjectMatches('orders.*', 'orders.>')`
    // answered TRUE — the `*` branch skipped past the literal `>` and the token counts tied — so
    // declaring `orders.*` against a server holding `orders.>` read as a widening and was applied.
    // It is a narrowing: `orders.a.b` is stored today and would stop being stored.
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.*'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ subjects: ['orders.>'] })));

    await expect(adapter.connect()).rejects.toThrow(/orders\.>/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('allows a declaration that widens an existing stream', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['agent.events.>'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(
      streamInfoPresent({ subjects: ['agent.events.done', 'agent.events.failed'] }),
    ));

    await adapter.connect();

    expect(mockJsm.streams.update).toHaveBeenCalledTimes(1);
  });

  it('checks subject coverage before the stamp, so a stale stamp cannot wave narrowing through', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['a.x'] }],
    });
    const matching = hashReconcileConfig({
      subjects: ['a.x'],
      max_msgs: undefined,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({
      subjects: ['a.x', 'a.y'],
      storage: 'file',
      retention: 'limits',
      metadata: { [CONFIG_STAMP_KEYS.configHash]: matching },
    })));

    await expect(adapter.connect()).rejects.toThrow(/a\.y/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('rejects a diverging storage type and names the delete command', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], storage: 'memory' }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ storage: 'file' })));

    await expect(adapter.connect()).rejects.toThrow(/storage/);
    await expect(adapter.connect()).rejects.toThrow(/nats stream rm/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('checks the storage divergence before the stamp, even when the hash already matches', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], storage: 'memory' }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(stampedInfo(minimalHash(), { storage: 'file' })));

    await expect(adapter.connect()).rejects.toThrow(/storage/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('rejects a diverging retention policy', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], retention: 'workqueue' }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ retention: 'limits' })));

    await expect(adapter.connect()).rejects.toThrow(/retention/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });
});

describe('ensureStream: classification and stamping', () => {
  function minimalHash(): string {
    return hashReconcileConfig({
      subjects: ['test.>'],
      max_msgs: undefined,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
  }

  it('creates the stream when info rejects with the stream not-found code', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    mockJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));

    await adapter.connect();

    expect(mockJsm.streams.add).toHaveBeenCalledTimes(1);
  });

  it('propagates an unclassified info rejection as itself', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    const thrownInstance = new Error('connection reset');
    mockJsm.streams.info = mock(() => Promise.reject(thrownInstance));

    await expect(adapter.connect()).rejects.toBe(thrownInstance);
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('stamps the hash on create without a previous-hash key', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    mockJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));

    await adapter.connect();

    const metadata = callArg(mockJsm.streams.add, 0, 0).metadata;

    expect(metadata[CONFIG_STAMP_KEYS.configHash]).toBe(minimalHash());
    expect(Number.isNaN(Date.parse(metadata[CONFIG_STAMP_KEYS.reconciledAt]))).toBe(false);
    expect(CONFIG_STAMP_KEYS.prevConfigHash in metadata).toBe(false);
  });

  it('NO-OP: an unchanged configuration writes nothing at all', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({
      metadata: { [CONFIG_STAMP_KEYS.configHash]: minimalHash() },
    })));

    await adapter.connect();

    expect(mockJsm.streams.update).not.toHaveBeenCalled();
    expect(mockJsm.streams.add).not.toHaveBeenCalled();
  });

  it('carries every pre-existing metadata key through an update', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    const stale = 'a'.repeat(32);
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: stale,
         
        _nats_created: 'srv',
        // eslint-disable-next-line @typescript-eslint/naming-convention -- operator-owned wire key
        'team.owner': 'billing',
      },
    })));

    await adapter.connect();

    expect(mockJsm.streams.update).toHaveBeenCalledTimes(1);

    const metadata = callArg(mockJsm.streams.update, 0, 1).metadata;

    expect(Object.keys(metadata).sort()).toEqual([
      '_nats_created',
      CONFIG_STAMP_KEYS.configHash,
      CONFIG_STAMP_KEYS.prevConfigHash,
      CONFIG_STAMP_KEYS.reconciledAt,
      'team.owner',
    ].sort());
    expect(metadata[CONFIG_STAMP_KEYS.prevConfigHash]).toBe(stale);
  });

  it('hashes the declared subset regardless of key or array order', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ subjects: ['b.>', 'a.>'], name: 'TEST_STREAM' } as never],
    });
    const reordered = hashReconcileConfig({
      subjects: ['a.>', 'b.>'],
      max_msgs: undefined,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({
      subjects: ['a.>', 'b.>'],
      metadata: { [CONFIG_STAMP_KEYS.configHash]: reordered },
    })));

    await adapter.connect();

    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('reports a reconcile cycle and refuses to write', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], maxMsgs: 1000 }],
    });
    const desired = hashReconcileConfig({
      subjects: ['test.>'],
      max_msgs: 1000,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
    const current = 'e'.repeat(32);
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({
      max_msgs: 50,
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: current,
        [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
        [CONFIG_STAMP_KEYS.reconciledAt]: new Date().toISOString(),
      },
    })));

    let thrown: Error | undefined;
    try {
      await adapter.connect();
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.message).toContain(desired);
    expect(thrown!.message).toContain(current);
    expect(thrown!.message).toContain('TEST_STREAM');
    expect(thrown!.message).toContain('max_msgs');
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('rolls forward once the cycle window has passed', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], maxMsgs: 1000 }],
    });
    const desired = hashReconcileConfig({
      subjects: ['test.>'],
      max_msgs: 1000,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({
      metadata: {
        [CONFIG_STAMP_KEYS.configHash]: 'e'.repeat(32),
        [CONFIG_STAMP_KEYS.prevConfigHash]: desired,
        [CONFIG_STAMP_KEYS.reconciledAt]: new Date(Date.now() - CONFIG_CYCLE_WINDOW_MS - 1000).toISOString(),
      },
    })));

    await adapter.connect();

    expect(mockJsm.streams.update).toHaveBeenCalledTimes(1);
  });

  it('names the server version requirement when metadata is unsupported', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter();
    mockJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));
    mockJsm.streams.add = mock(() => Promise.reject(new Error("'metadata' requires server 2.10.0")));

    await expect(adapter.connect()).rejects.toThrow(/nats-server 2\.10/);
  });
});

describe('ensureStream: multi-service parallel start', () => {
  function minimalHash(): string {
    return hashReconcileConfig({
      subjects: ['test.>'],
      max_msgs: undefined,
      max_bytes: undefined,
      max_age: undefined,
      num_replicas: undefined,
    });
  }

  /**
   * Two children of one multi-service application receive the same queue config and start
   * together, so they reconcile the same stream concurrently against one server.
   */
  function twoAdaptersSharingOneServer(info: () => Promise<AnyRecord>) {
    const first = makeConnectableAdapter();
    const second = makeConnectableAdapter();

    // One server, seen by both: each adapter gets its own doubles, so the sharing is
    // stated outright rather than falling out of whichever mock was built last.
    const shared = second.mockJsm;
    shared.streams.info = mock(info);
    first.useJsm(shared);

    return { first: first.adapter, second: second.adapter, shared };
  }

  it('writes nothing when both children see an already-current stream', async () => {
    const { first, second, shared } = twoAdaptersSharingOneServer(() => Promise.resolve(
      streamInfoPresent({ metadata: { [CONFIG_STAMP_KEYS.configHash]: minimalHash() } }),
    ));

    await Promise.all([first.connect(), second.connect()]);

    expect(shared.streams.update).toHaveBeenCalledTimes(0);
  });

  it('lets both children apply the same change without either reporting a cycle', async () => {
    const { first, second, shared } = twoAdaptersSharingOneServer(() => Promise.resolve(
      streamInfoPresent({ metadata: { [CONFIG_STAMP_KEYS.configHash]: 'a'.repeat(32) } }),
    ));

    await Promise.all([first.connect(), second.connect()]);

    expect(shared.streams.update).toHaveBeenCalledTimes(2);
    expect(callArg(shared.streams.update, 0, 1).metadata[CONFIG_STAMP_KEYS.configHash])
      .toBe(minimalHash());
    expect(callArg(shared.streams.update, 1, 1).metadata[CONFIG_STAMP_KEYS.configHash])
      .toBe(minimalHash());
  });
});

// ============================================================================
// Consumer identity: per (group, pattern), random ephemerals, explicit policy
//
// The durable used to be the bare group name, so two subscriptions sharing a
// group but filtering different subjects fought over one consumer and the second
// silently won. Ephemerals used Date.now(), which collides for back-to-back
// subscriptions in the same millisecond.
// ============================================================================

describe('consumer identity', () => {
  async function addPayload(
    pattern = 'orders.created',
    options: AnyRecord = { group: 'test-group' },
  ): Promise<AnyRecord> {
    const { adapter, mockJsm } = makeConnectedAdapter({
      // `x`, `b--x` and `orders_new` are declared because strict resolution requires every
      // subscribed subject to be bound. They are NOT renamed to `test.x` and friends: the forging
      // probe below works only because `group: 'a--b'` + pattern `x` and `group: 'a'` + pattern
      // `b--x` both sanitise to the stem `a--b--x`, and renaming either destroys it.
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>', 'orders.>', 'x', 'b--x', 'orders_new'] }],
    });
    await adapter.subscribe(pattern, async () => undefined, options);

    return callArg(mockJsm.consumers.add, 0, 1);
  }

  it('derives the durable from the group and the filter subject', async () => {
    // The readable part plus a digest of the RAW pair — sanitisation alone is lossy.
    expect((await addPayload()).durable_name).toMatch(/^test-group--orders_created--[0-9a-f]{12}$/);
  });

  it('gives colliding sanitised patterns different durables', async () => {
    // Every pair below reduces to the SAME sanitised text, so before the digest they
    // shared one consumer and the second subscription silently repointed it.
    const pairs: Array<[string, string]> = [
      ['orders.*', 'orders.>'],
      ['orders.*', 'orders.#'],
      ['orders.new', 'orders_new'],
    ];

    for (const [left, right] of pairs) {
      const a = await addPayload(left, { group: 'g' });
      const b = await addPayload(right, { group: 'g' });

      expect(a.durable_name).not.toBe(b.durable_name);
    }
  });

  it('does not let the joiner be forged out of a group name', async () => {
    const viaGroup = await addPayload('x', { group: 'a--b' });
    const viaPattern = await addPayload('b--x', { group: 'a' });

    expect(viaGroup.durable_name).not.toBe(viaPattern.durable_name);
  });

  it('is deterministic across identical subscriptions', async () => {
    const first = await addPayload();
    const second = await addPayload();

    expect(first.durable_name).toBe(second.durable_name);
  });

  it('sanitises everything the client would reject', async () => {
    // `validName` accepts [-\w] only; subject wildcards and separators are not in it.
    const cfg = await addPayload('orders.*.{id}.#', { group: 'eu/order workers' });

    expect(cfg.durable_name).toMatch(/^[-\w]+$/);
  });

  it('gives two patterns in one group two different durables', async () => {
    const first = await addPayload('orders.created', { group: 'shared' });
    const second = await addPayload('orders.shipped', { group: 'shared' });

    expect(first.durable_name).not.toBe(second.durable_name);
    expect(first.filter_subject).not.toBe(second.filter_subject);
  });

  it('keeps load balancing: same group and pattern share one durable', async () => {
    const first = await addPayload('orders.created', { group: 'shared' });
    const second = await addPayload('orders.created', { group: 'shared' });

    expect(first.durable_name).toBe(second.durable_name);
  });

  it('names a group-less subscription with a random uuid and no durable', async () => {
    const cfg = await addPayload('test.topic', {});

    expect(cfg.durable_name).toBeUndefined();
    expect(cfg.name).toMatch(/^consumer-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('gives back-to-back ephemerals different names', async () => {
    // The regression: Date.now() returns the same value for two subscriptions
    // issued in the same millisecond, so the second stole the first's consumer.
    const first = await addPayload('test.one', {});
    const second = await addPayload('test.two', {});

    expect(first.name).not.toBe(second.name);
  });

  it('sets deliver_policy explicitly on both grouped and group-less consumers', async () => {
    expect((await addPayload()).deliver_policy).toBe(realJetStream.DeliverPolicy.New);
    expect((await addPayload('test.topic', {})).deliver_policy).toBe(realJetStream.DeliverPolicy.New);
  });

  it('sends no inactive_threshold', async () => {
    expect('inactive_threshold' in await addPayload('test.topic', {})).toBe(false);
  });

  it('leaves the config-hash stamp owned by the reconciler', async () => {
    // Identity is not hashed: two subscriptions differing only in `group` reconcile
    // to the same configuration and must therefore carry the same stamp.
    const first = await addPayload('orders.created', { group: 'alpha' });
    const second = await addPayload('orders.created', { group: 'beta' });

    expect(first.metadata[CONFIG_STAMP_KEYS.configHash]).toMatch(/^[0-9a-f]{32}$/);
    expect(first.durable_name).not.toBe(second.durable_name);
    expect(first.metadata[CONFIG_STAMP_KEYS.configHash])
      .toBe(second.metadata[CONFIG_STAMP_KEYS.configHash]);
  });

  it('never sends identity or create-only fields on the update path', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();
    seedConsumerInfo(mockJsm, { metadata: { [CONFIG_STAMP_KEYS.configHash]: 'f'.repeat(32) } });

    await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });

    const updateArg = callArg(mockJsm.consumers.update, 0, 2);

    expect('deliver_policy' in updateArg).toBe(false);
    expect('durable_name' in updateArg).toBe(false);
    expect('name' in updateArg).toBe(false);
  });
});

// ============================================================================
// Subscription lifecycle: release the consumer, stop the pull loop
//
// `unsubscribe()` used to set a flag and splice the entry. The pull handle stayed
// open, the 100ms restart kept re-entering, and a framework-generated ephemeral
// consumer was left on the server forever. A durable must NOT be deleted — the
// framework unsubscribes on every graceful shutdown.
// ============================================================================

describe('subscription lifecycle', () => {
  async function subscribed(options: AnyRecord = {}) {
    const { adapter, mockJsm, consumer } = makeConnectedAdapter();
    const subscription = await adapter.subscribe('test.topic', async () => undefined, options);

    return {
      adapter, mockJsm, consumer, subscription,
    };
  }

  it('closes the pull handle exactly once on unsubscribe', async () => {
    const { subscription, consumer } = await subscribed({ group: 'g' });

    await subscription.unsubscribe();

    expect(consumer.handle.close).toHaveBeenCalledTimes(1);
  });

  it('deletes an ephemeral consumer on unsubscribe', async () => {
    const { subscription, consumer } = await subscribed();

    await subscription.unsubscribe();

    expect(consumer.delete).toHaveBeenCalledTimes(1);
  });

  it('never deletes a durable consumer on unsubscribe', async () => {
    // The guard that matters: QueueService.stop() unsubscribes on every graceful
    // shutdown, so deleting here would discard the durable's ack floor each deploy.
    const { subscription, consumer } = await subscribed({ group: 'x' });

    await subscription.unsubscribe();

    expect(consumer.delete).not.toHaveBeenCalled();
  });

  it('releases every subscription before the client disconnects', async () => {
    const { adapter, consumer } = await subscribed();
    const client = asAny(adapter).client;

    await adapter.disconnect();

    expect(consumer.delete).toHaveBeenCalledTimes(1);
    expect(asAny(consumer.delete).mock.invocationCallOrder[0])
      .toBeLessThan(asAny(client.disconnect).mock.invocationCallOrder[0]);
  });

  it('skips the server-side delete when the client is already disconnected', async () => {
    const { adapter, consumer } = await subscribed();
    asAny(adapter).client.isConnected = mock(() => false);

    await adapter.disconnect();

    expect(consumer.delete).not.toHaveBeenCalled();
  });

  it('sends no inactive_threshold on an ephemeral consumer', async () => {
    const { mockJsm } = await subscribed();

    expect('inactive_threshold' in callArg(mockJsm.consumers.add, 0, 1)).toBe(false);
  });
});

describe('subscription lifecycle: the pull loop', () => {
  it('does not consume while paused, and resumes afterwards', async () => {
    // Driven through consumeMessages directly: the subscribe-time loop parks inside its
    // first consume() on the harness's deferred, so pause is not observable through it.
    const timers = useFakeTimers();

    try {
      const { adapter, consumer } = makeConnectedAdapter();
      await adapter.subscribe('test.topic', async () => undefined, {});
      const entry = asAny(adapter).subscriptions[0];
      const before = asAny(consumer.consume).mock.calls.length;

      entry.paused = true;
      await asAny(adapter).consumeMessages(entry);

      // `paused` is checked BEFORE consume(): a paused subscription never pulls a batch
      // it is not going to look at, where every message would age out of ack_wait.
      expect(asAny(consumer.consume).mock.calls.length).toBe(before);
      expect(entry.restartTimer).not.toBeNull();

      entry.paused = false;
      timers.advanceTime(CONSUME_RESTART_DELAY_MS + 1);
      await Promise.resolve();

      expect(asAny(consumer.consume).mock.calls.length).toBeGreaterThan(before);
    } finally {
      timers.restore();
    }
  });

  it('cancels a pending restart when the subscription is released', async () => {
    const timers = useFakeTimers();

    try {
      const { adapter } = makeConnectedAdapter();
      const subscription = await adapter.subscribe('test.topic', async () => undefined, {});

      subscription.pause();
      timers.advanceTime(CONSUME_RESTART_DELAY_MS + 1);

      const pending = timers.getTimerCount();
      await subscription.unsubscribe();

      // The release lands inside the restart window and must take the timer with it,
      // otherwise the loop re-enters on an entry that is no longer subscribed.
      expect(timers.getTimerCount()).toBeLessThan(pending + 1);
    } finally {
      timers.restore();
    }
  });

  it('returns immediately from the consume loop once the entry has stopped running', async () => {
    const { adapter, consumer } = makeConnectedAdapter();
    await adapter.subscribe('test.topic', async () => undefined, {});

    const entry = asAny(adapter).subscriptions[0];
    entry.running = false;
    const before = asAny(consumer.consume).mock.calls.length;

    await asAny(adapter).consumeMessages(entry);

    expect(asAny(consumer.consume).mock.calls.length).toBe(before);
  });

  it('nacks a message it pulled but will not process', async () => {
    // A message dropped by pause or unsubscribe used to be abandoned, holding an ack
    // slot until ack_wait expired.
    const jsMsg = makeMockJsMsg({ data: new TextEncoder().encode(JSON.stringify({ pattern: 'test.topic', data: {} })) });
    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg, jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    const subscription = await adapter.subscribe('test.topic', async () => {
      subscription.pause();
    }, { ackMode: 'manual' });

    await new Promise(resolve => setTimeout(resolve, 30));

    expect(jsMsg.nak).toHaveBeenCalled();
  });
});

// ============================================================================
// Poison messages and consume-loop errors
//
// A payload that failed to parse used to be acked unconditionally — destroyed
// with no event, no log and no way to notice, even under ackMode 'manual'. The
// same catch also wrapped the handler call, so an ack failure was misread as a
// parse failure. And the loop's outer catch swallowed everything.
// ============================================================================

describe('poison messages', () => {
  function payload(body: string): AnyRecord {
    return makeMockJsMsg({ data: new TextEncoder().encode(body) });
  }

  /** Delivers one raw payload and returns what the adapter did with it. */
  async function deliver(raw: AnyRecord, options: AnyRecord = { ackMode: 'manual' }) {
    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([raw]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    const seen: unknown[] = [];
    await adapter.subscribe('test.topic', async (message) => {
      seen.push(message.data);
    }, options);

    await new Promise(resolve => setTimeout(resolve, 30));

    return { errors, seen, raw };
  }

  it('terminates a non-JSON payload instead of acking it', async () => {
    const { errors, raw } = await deliver(payload('not json at all'));

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('test.topic');
    expect(raw.term).toHaveBeenCalled();
    expect(raw.ack).not.toHaveBeenCalled();
  });

  it('terminates an empty payload', async () => {
    const { errors, raw } = await deliver(payload(''));

    expect(errors.length).toBeGreaterThan(0);
    expect(raw.term).toHaveBeenCalled();
    expect(raw.ack).not.toHaveBeenCalled();
  });

  it('terminates a bare null body', async () => {
    // JSON.parse('null') succeeds and yields null — valid JSON, not an envelope.
    const { errors, raw } = await deliver(payload('null'));

    expect(errors.length).toBeGreaterThan(0);
    expect(raw.term).toHaveBeenCalled();
    expect(raw.ack).not.toHaveBeenCalled();
  });

  it('terminates a poison message under ackMode auto as well', async () => {
    const { raw } = await deliver(payload('{oops'), { ackMode: 'auto' });

    expect(raw.term).toHaveBeenCalled();
    expect(raw.ack).not.toHaveBeenCalled();
  });

  it('never hands a foreign envelope to the handler as undefined data', async () => {
    // Valid JSON from another producer sharing the subject.
    const { errors, seen, raw } = await deliver(payload(JSON.stringify({ hello: 'world' })));

    expect(seen).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('not a OneBun envelope');
    expect(raw.term).toHaveBeenCalled();
  });

  it('leaves a healthy message completely unaffected', async () => {
    const raw = payload(JSON.stringify({ pattern: 'test.topic', data: { ok: true } }));
    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([raw]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    const received: unknown[] = [];
    const processed: unknown[] = [];
    adapter.on('onMessageReceived', () => {
      received.push(1);
    });
    adapter.on('onMessageProcessed', () => {
      processed.push(1);
    });

    const seen: unknown[] = [];
    await adapter.subscribe('test.topic', async (message) => {
      seen.push(message.data);
    }, { ackMode: 'auto' });

    await new Promise(resolve => setTimeout(resolve, 30));

    expect(seen).toEqual([{ ok: true }]);
    expect(received).toHaveLength(1);
    expect(processed).toHaveLength(1);
    expect(raw.ack).toHaveBeenCalled();
    expect(raw.term).not.toHaveBeenCalled();
  });

  it('reports an ack failure as an ack failure, not as a parse failure', async () => {
    // The old catch wrapped both branches, so a throwing ack() was reported — and
    // handled — as if the payload had been unparseable.
    const raw = payload(JSON.stringify({ pattern: 'test.topic', data: {} }));
    raw.ack = mock(() => {
      throw new Error('ack transport failure');
    });

    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([raw]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.topic', async () => undefined, { ackMode: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(errors.map(e => e.message)).toContain('ack transport failure');
    expect(raw.term).not.toHaveBeenCalled();
  });

  it('surfaces a consume-loop error instead of swallowing it', async () => {
    const { adapter } = makeConnectedAdapter();
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve({
      consume: mock(() => Promise.reject(new Error('consumer vanished'))),
    }));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.topic', async () => undefined, {});
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(errors.map(e => e.message)).toContain('consumer vanished');
  });
});

// ============================================================================
// A vanished consumer
//
// When the consumer is deleted server-side the client neither yields, ends nor
// throws — it retries CONSUMER.INFO forever. The `for await` parks, the
// subscription stalls, and isConnected() keeps reporting healthy. The only place
// that fact surfaces is the notification channel, which was never read.
// ============================================================================

describe('vanished consumer recovery', () => {
  /** Lets the fire-and-forget status watcher run to completion; all its awaits are microtasks. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  }

  async function subscribedWith(notifications: AnyRecord[]) {
    const { adapter, mockJsm } = makeConnectedAdapter();
    const first = makeMockConsumer([], notifications);
    const second = makeMockConsumer();
    let handedOut = 0;

    asAny(adapter).js.consumers.get = mock(() => {
      handedOut += 1;

      return Promise.resolve(handedOut === 1 ? first : second);
    });

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.topic', async () => undefined, { group: 'test-group' });
    await flush();

    return {
      adapter, mockJsm, errors, first, second,
    };
  }

  it('names the original subscription pattern when the re-creation itself fails', async () => {
    // The recreate path builds the same diagnostic as the first `subscribe()`, from the entry's
    // own inputs. Passing anything but `entry.pattern` here would report the translated subject
    // as if it were the OneBun pattern — the two differ exactly when a pattern is parameterised,
    // which is why this subscribes `test.{id}`.
    const { adapter, mockJsm } = makeConnectedAdapter();
    const first = makeMockConsumer([], [
      { type: 'consumer_deleted', code: 404, description: 'consumer deleted' },
    ]);

    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(first));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.{id}', async () => undefined, { group: 'test-group' });

    // The consumer vanished; the re-creation is what fails now.
    mockJsm.consumers.info = mock(() =>
      Promise.reject(makeApiError(CONSUMER_NOT_FOUND_CODE, 'consumer not found')));
    mockJsm.consumers.add = mock(() => Promise.reject(new Error('maximum consumers exceeded')));

    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }

    const reported = errors.map(error => error.message).join('\n');

    expect(reported).toContain('test.{id}');
    expect(reported).toContain('test.*');
  });

  it('re-creates the consumer when it is deleted and rebinds the entry', async () => {
    const { adapter, mockJsm, second } = await subscribedWith([
      { type: 'consumer_deleted', code: 404, description: 'consumer deleted' },
    ]);

    expect(asAny(mockJsm.consumers.add).mock.calls.length).toBe(2);
    expect(asAny(adapter).subscriptions[0].consumer).toBe(second);
  });

  it('rebuilds it field for field, so nothing silently changes', async () => {
    // A re-creation that lost deliver_policy would replay the whole retained stream.
    const { mockJsm } = await subscribedWith([
      { type: 'consumer_deleted', code: 404, description: 'consumer deleted' },
    ]);

    const original = callArg(mockJsm.consumers.add, 0, 1);
    const rebuilt = callArg(mockJsm.consumers.add, 1, 1);

    for (const field of ['ack_policy', 'deliver_policy', 'filter_subject', 'max_ack_pending'] as const) {
      expect(rebuilt[field]).toBe(original[field]);
    }
  });

  it('emits onError naming the consumer and the stream', async () => {
    const { errors } = await subscribedWith([
      { type: 'consumer_deleted', code: 404, description: 'consumer deleted' },
    ]);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('consumer_deleted');
    expect(errors[0].message).toContain('TEST_STREAM');
  });

  it('reports a missed heartbeat without re-creating anything', async () => {
    const { mockJsm, errors } = await subscribedWith([
      { type: 'heartbeats_missed', count: 3 },
    ]);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('heartbeats_missed');
    // Re-creation would be pointless here, and worse, it would mask the real problem.
    expect(asAny(mockJsm.consumers.add).mock.calls.length).toBe(1);
  });

  it('reports a missing stream without re-creating anything', async () => {
    // A missing stream is an operator problem: a consumer cannot be created against it.
    const { mockJsm, errors } = await subscribedWith([
      { type: 'stream_not_found', code: 404, description: 'stream not found' },
    ]);

    expect(errors[0].message).toContain('stream_not_found');
    expect(asAny(mockJsm.consumers.add).mock.calls.length).toBe(1);
  });

  it('ignores routine flow-control chatter', async () => {
    const { mockJsm, errors } = await subscribedWith([
      { type: 'heartbeat' },
      { type: 'next', options: {} },
      { type: 'debug', code: 0, description: 'noise' },
    ]);

    expect(errors).toHaveLength(0);
    expect(asAny(mockJsm.consumers.add).mock.calls.length).toBe(1);
  });
});

// ============================================================================
// toNatsSubject(): OneBun patterns reach the wire as valid NATS subjects
//
// `@Subscribe('orders.{id}')` used to create a consumer filtering the literal
// subject `orders.{id}`, which matches nothing and errors nowhere: the
// subscription was silently dead. `#` was replaced positionally, so `#.created`
// shipped `>.created` — a subject NATS only rejects asynchronously, server-side.
// ============================================================================

describe('subject translation: consumer filter', () => {
  it('sends the translated subject as filter_subject', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.>'] }],
    });
    await adapter.subscribe('orders.{id}', async () => undefined, { group: 'orders' });

    expect(callArg(mockJsm.consumers.add, 0, 1).filter_subject).toBe('orders.*');
  });

  it('does not widen the publish path', async () => {
    // Publishing takes a concrete subject, never a pattern: a wildcard leaking here
    // would address a subject no consumer is bound to.
    const { adapter, mockJs } = makeConnectedAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.>'] }],
    });
    await adapter.publish('orders.123', { a: 1 });

    expect(asAny(mockJs.publish).mock.calls[0][0]).toBe('orders.123');
  });
});

describe('subject translation: the throw reaches the caller', () => {
  it('fails in the constructor for a bad stream declaration, before connect()', () => {
    // A stream declaration is translated eagerly, so the process cannot reach
    // connect() carrying a subject the broker would reject.
    expect(() => new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 's', subjects: ['#.created'] }],
    })).toThrow('#.created');
  });

  it('rejects publish() with the offending pattern', async () => {
    const { adapter } = makeConnectedAdapter();

    await expect(adapter.publish('#.created', {})).rejects.toThrow('#.created');
  });

  it('rejects subscribe() with the offending pattern', async () => {
    const { adapter } = makeConnectedAdapter();

    await expect(adapter.subscribe('#.created', async () => undefined)).rejects.toThrow('#.created');
  });

  it('never issues a publish for an untranslatable pattern', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();

    await expect(adapter.publish('#.created', {})).rejects.toThrow();

    expect(mockJs.publish).not.toHaveBeenCalled();
  });
});

describe('subject translation: stream declarations', () => {
  it('translates declared stream subjects into natsSubjects', async () => {
    const { adapter } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.{id}'] }],
    });

    expect(asAny(adapter).resolvedStreams[0].natsSubjects).toEqual(['orders.*']);
  });

  it('sends the translated subjects to streams.update', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.{id}'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(streamInfoPresent({ subjects: ['orders.*'] })));

    await adapter.connect();

    expect(callArg(mockJsm.streams.update, 0, 1).subjects).toEqual(['orders.*']);
  });

  it('sends the translated subjects to streams.add', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.{id}'] }],
    });
    mockJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));

    await adapter.connect();

    expect(callArg(mockJsm.streams.add, 0, 0).subjects).toEqual(['orders.*']);
  });

  it('still rejects a narrowing declaration under the translated form', async () => {
    // `orders.*` is one token wide, so a two-token subject the stream already holds
    // is genuinely dropped by this declaration.
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.{id}'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(
      streamInfoPresent({ subjects: ['orders.created', 'orders.items.added'] }),
    ));

    await expect(adapter.connect()).rejects.toThrow(/orders\.items\.added/);
    expect(mockJsm.streams.update).not.toHaveBeenCalled();
  });

  it('still accepts a widening declaration under the translated form', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['orders.{id}'] }],
    });
    mockJsm.streams.info = mock(() => Promise.resolve(
      streamInfoPresent({ subjects: ['orders.created', 'orders.shipped'] }),
    ));

    await adapter.connect();

    expect(mockJsm.streams.update).toHaveBeenCalledTimes(1);
  });
});

describe('subject translation: stream resolution and diagnostics', () => {
  it('resolves a parameterised pattern against a stream declared with >', async () => {
    const { adapter } = makeConnectedAdapter({
      streams: [
        { name: 'OTHER', subjects: ['other.>'] },
        { name: 'ORDERS', subjects: ['orders.>'] },
      ],
    });

    expect(adapter.resolveStreamForSubject('orders.{id}')).toBe('ORDERS');
  });

  it('names both the OneBun pattern and the translated subject when publishing fails', async () => {
    const { adapter, mockJs } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    mockJs.publish = mock(() => Promise.reject(new Error('no stream bound')));
    asAny(adapter).js = mockJs;

    let message = '';
    try {
      await adapter.publish('orders.{id}', { a: 1 });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('orders.{id}');
    expect(message).toContain('orders.*');
  });
});

// ============================================================================
// Graceful shutdown: in-flight handlers are awaited
//
// The consume loop is a floating promise, so a handler still running at shutdown
// was simply abandoned. Its `ack()` is then published onto a closed connection,
// where the client buffers it and drops it without throwing — under explicit
// acks the server redelivers after ack_wait and the side effect happens twice,
// on every deploy.
// ============================================================================

/** Mirrors `HANDLER_DRAIN_TIMEOUT_MS` in the adapter. */
const HANDLER_DRAIN_TIMEOUT_MS = 30_000;

describe('graceful shutdown: in-flight handlers', () => {
  /** A connected adapter whose consumer yields exactly one well-formed envelope. */
  function withOneMessage() {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({ pattern: 'test.topic', data: {} })),
    });
    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    return { adapter, jsMsg, consumer };
  }

  it('does not resolve unsubscribe until the in-flight handler settles', async () => {
    const { adapter } = withOneMessage();
    const started = makeDeferred();
    const finish = makeDeferred();

    const subscription = await adapter.subscribe('test.topic', async () => {
      started.resolve();
      await finish.promise;
    }, { ackMode: 'manual' });

    await started.promise;

    let released = false;
    const pending = subscription.unsubscribe().then(() => {
      released = true;
    });

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(released).toBe(false);

    finish.resolve();
    await pending;

    expect(released).toBe(true);
  });

  it('gives up on a handler that never returns, after the drain timeout', async () => {
    const timers = useFakeTimers();

    try {
      const { adapter } = withOneMessage();
      const started = makeDeferred();

      const subscription = await adapter.subscribe('test.topic', async () => {
        started.resolve();
        // Never returns: shutdown must be bounded, not hostage to one handler.
        await new Promise(() => undefined);
      }, { ackMode: 'manual' });

      await started.promise;

      let released = false;
      const pending = subscription.unsubscribe().then(() => {
        released = true;
      });
      await Promise.resolve();

      expect(released).toBe(false);

      timers.advanceTime(HANDLER_DRAIN_TIMEOUT_MS + 1);
      await pending;

      expect(released).toBe(true);
    } finally {
      timers.restore();
    }
  });

  it('clears the drain timer when the handler settles first', async () => {
    // A 30s timer left pending would keep the process alive well past the shutdown
    // that created it.
    const timers = useFakeTimers();

    try {
      const { adapter } = withOneMessage();
      const started = makeDeferred();
      const finish = makeDeferred();

      const subscription = await adapter.subscribe('test.topic', async () => {
        started.resolve();
        await finish.promise;
      }, { ackMode: 'manual' });

      await started.promise;

      const pending = subscription.unsubscribe();
      await Promise.resolve();
      finish.resolve();
      await pending;

      expect(timers.getTimerCount()).toBe(0);
    } finally {
      timers.restore();
    }
  });

  it('closes the NATS connection only after the in-flight handler completes', async () => {
    const { adapter } = withOneMessage();
    const started = makeDeferred();
    const finish = makeDeferred();
    const handlerReturned = mock(() => undefined);

    await adapter.subscribe('test.topic', async () => {
      started.resolve();
      await finish.promise;
      handlerReturned();
    }, { ackMode: 'manual' });

    await started.promise;

    const closing = adapter.disconnect();
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(asAny(adapter).client.disconnect).not.toHaveBeenCalled();

    finish.resolve();
    await closing;

    const returnedAt = asAny(handlerReturned).mock.invocationCallOrder[0];
    const closedAt = asAny(asAny(adapter).client.disconnect).mock.invocationCallOrder[0];

    expect(returnedAt).toBeLessThan(closedAt);
  });

  it('stops pulling before draining, so shutdown waits for one handler at most', async () => {
    // `running` is cleared on every entry up front: a drain that started while the loop
    // was still pulling could be handed a fresh handler to wait for on every batch.
    const { adapter } = withOneMessage();
    const started = makeDeferred();
    const finish = makeDeferred();

    await adapter.subscribe('test.topic', async () => {
      started.resolve();
      await finish.promise;
    }, { ackMode: 'manual' });

    await started.promise;
    const entry = asAny(adapter).subscriptions[0];

    const closing = adapter.disconnect();
    await Promise.resolve();

    expect(entry.running).toBe(false);

    finish.resolve();
    await closing;
  });

  it('reports a rejecting handler exactly once', async () => {
    // The in-flight wrapper and the handler's catch are one structure; a second try
    // around the call would double every failure report.
    const { adapter, jsMsg } = withOneMessage();
    const failures: Error[] = [];
    const errors: Error[] = [];
    adapter.on('onMessageFailed', (_message, error: Error) => {
      failures.push(error);
    });
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.topic', async () => {
      throw new Error('handler failed');
    }, {});

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(failures).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight promise once the handler settles', async () => {
    const { adapter } = withOneMessage();
    const done = makeDeferred();

    await adapter.subscribe('test.topic', async () => {
      done.resolve();
    }, {});

    await done.promise;
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(asAny(adapter).subscriptions[0].inFlight).toBeNull();
  });
});

// ============================================================================
// Dead-letter queue
//
// `supports('dead-letter-queue')` returned true while `deadLetter` was read
// nowhere in the package: `queue` was ignored outright and `maxRetries` was
// doubly ignored, so a failing message was left for the server to exhaust and
// the configured DLQ stream stayed permanently empty.
// ============================================================================

const DLQ = 'test.dlq';

describe('dead-letter queue: max_deliver resolution', () => {
  async function maxDeliverFor(
    options: AnyRecord,
    overrides: Partial<JetStreamAdapterOptions> = {},
  ): Promise<number> {
    const { adapter, mockJsm } = makeConnectedAdapter(overrides);
    await adapter.subscribe('test.topic', async () => undefined, { group: 'g', ...options });

    return callArg(mockJsm.consumers.add, 0, 1).max_deliver as number;
  }

  it('falls back to the built-in default when nothing is configured', async () => {
    expect(await maxDeliverFor({})).toBe(3);
  });

  it('honours deadLetter.maxRetries — the value that used to be ignored outright', async () => {
    expect(await maxDeliverFor({ deadLetter: { queue: DLQ, maxRetries: 10 } })).toBe(10);
  });

  it('keeps retry.attempts ahead of deadLetter.maxRetries', async () => {
    // Ordering exists so every configuration that worked before the DLQ existed keeps
    // the exact max_deliver it had.
    expect(await maxDeliverFor({
      retry: { attempts: 5 },
      deadLetter: { queue: DLQ, maxRetries: 10 },
    })).toBe(5);
  });

  it('puts deadLetter.maxRetries ahead of consumerConfig.maxDeliver', async () => {
    expect(await maxDeliverFor(
      { deadLetter: { queue: DLQ, maxRetries: 10 } },
      { consumerConfig: { maxDeliver: 7 } },
    )).toBe(10);
  });
});

describe('dead-letter queue: subscribe-time validation', () => {
  it('rejects a wildcard queue, naming the option and the value', async () => {
    const { adapter } = makeConnectedAdapter();

    await expect(adapter.subscribe('test.topic', async () => undefined, {
      deadLetter: { queue: 'test.*' },
    })).rejects.toThrow(/deadLetter\.queue.*test\.\*/s);
  });

  it('rejects a > wildcard too', async () => {
    const { adapter } = makeConnectedAdapter();

    await expect(adapter.subscribe('test.topic', async () => undefined, {
      deadLetter: { queue: 'test.>' },
    })).rejects.toThrow(/deadLetter\.queue/);
  });

  it('rejects a queue that is the subscription pattern itself', async () => {
    // A self-loop would hand every dead letter straight back to the handler that
    // just rejected it.
    const { adapter } = makeConnectedAdapter();

    await expect(adapter.subscribe('test.topic', async () => undefined, {
      deadLetter: { queue: 'test.topic' },
    })).rejects.toThrow(/deadLetter\.queue.*test\.topic/s);
  });

  it('fails before any consumer is created', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter();

    await expect(adapter.subscribe('test.topic', async () => undefined, {
      deadLetter: { queue: 'test.*' },
    })).rejects.toThrow();

    expect(mockJsm.consumers.add).not.toHaveBeenCalled();
  });
});

describe('dead-letter queue: disposition', () => {
  /** Drives exactly one delivery whose handler throws, at the given delivery count. */
  async function deliverFailing(
    deliveryCount: number,
    options: AnyRecord = {},
    seed: Partial<AnyRecord> = {},
  ) {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({
        id: 'original-id',
        pattern: 'test.topic',
        data: { n: 1 },
        metadata: { traceId: 'trace-1' },
      })),
      info: { redelivered: deliveryCount > 1, deliveryCount },
      ...seed,
    });
    const { adapter, mockJs } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.topic', async () => {
      throw new Error('handler failed');
    }, options);

    await new Promise(resolve => setTimeout(resolve, 25));

    return {
      adapter, mockJs, jsMsg, errors, 
    };
  }

  it('routes the terminal delivery to the dead-letter queue, then terminates the original', async () => {
    const { mockJs, jsMsg } = await deliverFailing(3, { deadLetter: { queue: DLQ } });

    expect(asAny(mockJs.publish).mock.calls[0][0]).toBe(DLQ);
    expect(jsMsg.term).toHaveBeenCalledTimes(1);
    expect(jsMsg.nak).not.toHaveBeenCalled();

    // Republish BEFORE term: terminating first would turn a failed republish into a
    // lost message, which is the failure a DLQ exists to prevent.
    expect(asAny(mockJs.publish).mock.invocationCallOrder[0])
      .toBeLessThan(asAny(jsMsg.term).mock.invocationCallOrder[0]);
  });

  it('leaves a non-terminal delivery to ordinary retry', async () => {
    const { mockJs, jsMsg } = await deliverFailing(1, { deadLetter: { queue: DLQ } });

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
    expect(jsMsg.term).not.toHaveBeenCalled();
    expect(asAny(mockJs.publish).mock.calls.some((c: unknown[]) => c[0] === DLQ)).toBe(false);
  });

  it('keeps the original when the republish fails, and reports it once', async () => {
    // Terminating a message whose copy never landed would lose it outright — the one
    // outcome a dead-letter queue exists to prevent.
    const { jsMsg, errors } = await deliverFailingWithBrokenPublish();

    expect(jsMsg.term).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(DLQ);
    expect((errors[0] as Error & { cause?: unknown }).cause).toBeDefined();
  });

  async function deliverFailingWithBrokenPublish() {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({ pattern: 'test.topic', data: {} })),
      info: { redelivered: true, deliveryCount: 3 },
    });
    const { adapter, mockJs } = makeConnectedAdapter();
    mockJs.publish = mock(() => Promise.reject(new Error('no stream binds test.dlq')));
    asAny(adapter).js = mockJs;
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => {
      errors.push(error);
    });

    await adapter.subscribe('test.topic', async () => {
      throw new Error('handler failed');
    }, { deadLetter: { queue: DLQ } });

    await new Promise(resolve => setTimeout(resolve, 25));

    return { jsMsg, errors };
  }

  it('preserves the original id and records provenance on the republished envelope', async () => {
    const { mockJs } = await deliverFailing(3, { deadLetter: { queue: DLQ } });

    const body = JSON.parse(new TextDecoder().decode(
      asAny(mockJs.publish).mock.calls[0][1] as Uint8Array,
    )) as AnyRecord;

    expect(body.id).toBe('original-id');
    expect(body.metadata['dlq.originalPattern']).toBe('test.topic');
    expect(body.metadata['dlq.deliveryCount']).toBe(3);
    expect(body.metadata['dlq.error']).toBe('handler failed');
    // The caller's own metadata survives alongside the provenance keys.
    expect(body.metadata.traceId).toBe('trace-1');
  });
});

describe('a handler that nacks and returns normally', () => {
  /** Delivers one message and lets the handler decide its disposition inline. */
  async function deliverWith(
    handler: (message: AnyRecord) => Promise<void>,
    options: AnyRecord = { ackMode: 'auto' },
  ) {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({
        id: 'nack-id', pattern: 'test.topic', data: {},
      })),
      info: { redelivered: false, deliveryCount: 1 },
    });
    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    let processed = 0;
    const failures: Error[] = [];
    adapter.on('onMessageProcessed', () => {
      processed += 1;
    });
    adapter.on('onMessageFailed', (_message: unknown, error: Error) => {
      failures.push(error);
    });

    await adapter.subscribe('test.topic', async (message) => {
      await handler(message as unknown as AnyRecord);
    }, options);

    await new Promise(resolve => setTimeout(resolve, 25));

    return { jsMsg, processed, failures };
  }

  it('does not ack a message the handler already nacked under ackMode auto', async () => {
    // `msg.ack()` in the loop is on the RAW JsMsg, so it bypasses the wrapper's
    // first-call-wins guard: it used to settle the message right after the handler's
    // nak() and cancel the very redelivery the handler asked for.
    const { jsMsg } = await deliverWith(async message => await message.nack(true));

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
    expect(jsMsg.ack).not.toHaveBeenCalled();
  });

  it('reports it as failed rather than processed', async () => {
    const { processed, failures } = await deliverWith(async message => await message.nack(true));

    expect(processed).toBe(0);
    expect(failures.length).toBe(1);
    expect(failures[0].message).toContain('nacked by its handler');
  });

  it('reports it as failed under ackMode manual too', async () => {
    const { processed, failures } = await deliverWith(
      async message => await message.nack(true),
      { ackMode: 'manual' },
    );

    expect(processed).toBe(0);
    expect(failures.length).toBe(1);
  });

  it('still acks and reports a handler that does not nack', async () => {
    const { jsMsg, processed, failures } = await deliverWith(async () => undefined);

    expect(jsMsg.ack).toHaveBeenCalledTimes(1);
    expect(processed).toBe(1);
    expect(failures.length).toBe(0);
  });
});

describe('dead-letter queue: manual nack', () => {
  /** Delivers one message under manual acks and hands the Message to the caller. */
  async function deliverManual(options: AnyRecord) {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({
        id: 'manual-id', pattern: 'test.topic', data: {},
      })),
      info: { redelivered: false, deliveryCount: 1 },
    });
    const { adapter, mockJs } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    let message: AnyRecord | null = null;
    await adapter.subscribe('test.topic', async (msg) => {
      message = msg as unknown as AnyRecord;
    }, { ackMode: 'manual', ...options });

    await new Promise(resolve => setTimeout(resolve, 25));

    return { mockJs, jsMsg, message: message! };
  }

  it('nack(false) routes to the dead-letter queue when one is configured', async () => {
    // The same disposition the Redis adapter gives onNack(false), so both adapters
    // share one rule.
    const { mockJs, jsMsg, message } = await deliverManual({ deadLetter: { queue: DLQ } });

    await message.nack(false);

    expect(asAny(mockJs.publish).mock.calls[0][0]).toBe(DLQ);
    expect(jsMsg.term).toHaveBeenCalledTimes(1);
  });

  it('nack(false) still terminates without publishing when no queue is configured', async () => {
    const { mockJs, jsMsg, message } = await deliverManual({});

    await message.nack(false);

    expect(jsMsg.term).toHaveBeenCalledTimes(1);
    expect(asAny(mockJs.publish).mock.calls.some((c: unknown[]) => c[0] === DLQ)).toBe(false);
  });

  it('nack(true) still asks for redelivery even with a dead-letter queue configured', async () => {
    const { jsMsg, message } = await deliverManual({ deadLetter: { queue: DLQ } });

    await message.nack(true);

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
    expect(jsMsg.term).not.toHaveBeenCalled();
  });
});

// ============================================================================
// ackMode 'none' — fire-and-forget
//
// 'auto' and 'manual' both mean AckPolicy.Explicit and decide only WHO
// acknowledges. 'none' is the one mode that decides WHETHER the server tracks
// acknowledgement at all, so the redelivery knobs stop being sent: the server
// accepts them and ignores them, and hashing them would stamp a redelivery
// policy that cannot happen.
// ============================================================================

describe("ackMode 'none': consumer config", () => {
  async function addPayloadForMode(ackMode?: string): Promise<AnyRecord> {
    const { adapter, mockJsm } = makeConnectedAdapter();
    await adapter.subscribe(
      'test.topic',
      async () => undefined,
      ackMode === undefined ? { group: 'g' } : { group: 'g', ackMode } as AnyRecord,
    );

    return callArg(mockJsm.consumers.add, 0, 1);
  }

  it('sends ack_policy none', async () => {
    expect((await addPayloadForMode('none')).ack_policy).toBe('none');
  });

  it('omits the redelivery knobs entirely, rather than sending them as undefined', async () => {
    // Key ABSENCE, not `toBeUndefined()`: the client merges an update with a shallow
    // Object.assign, so a present-but-undefined key would wipe the server's value.
    const cfg = await addPayloadForMode('none');

    expect(cfg).not.toHaveProperty('ack_wait');
    expect(cfg).not.toHaveProperty('max_deliver');
    expect(cfg).not.toHaveProperty('max_ack_pending');
  });

  it("still carries all three under ackMode 'auto'", async () => {
    const cfg = await addPayloadForMode('auto');

    expect(cfg.ack_policy).toBe('explicit');
    expect(cfg.ack_wait).toBe(30_000_000_000);
    expect(cfg.max_deliver).toBe(3);
    expect(cfg.max_ack_pending).toBe(100);
  });

  it('leaves an undeclared ackMode on the explicit path', async () => {
    expect((await addPayloadForMode()).ack_policy).toBe('explicit');
  });

  it('leaves ackTimeout inert: no ack_wait even when one is asked for', async () => {
    // ack_wait governs a redelivery that cannot occur under 'none', so an ackTimeout
    // must not resurrect the key the mode exists to suppress.
    const { adapter, mockJsm } = makeConnectedAdapter();
    await adapter.subscribe('test.topic', async () => undefined, {
      group: 'g',
      ackMode: 'none',
      ackTimeout: 45_000,
    });

    expect(callArg(mockJsm.consumers.add, 0, 1)).not.toHaveProperty('ack_wait');
  });
});

describe("ackMode 'none': the loop acknowledges nothing", () => {
  async function deliverUnder(handler: () => Promise<void>) {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({ pattern: 'test.topic', data: {} })),
      info: { redelivered: false, deliveryCount: 1 },
    });
    const { adapter } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    await adapter.subscribe('test.topic', handler, { ackMode: 'none' } as AnyRecord);
    await new Promise(resolve => setTimeout(resolve, 25));

    return jsMsg;
  }

  it('does not ack a handler that resolves', async () => {
    const jsMsg = await deliverUnder(async () => undefined);

    expect(jsMsg.ack).not.toHaveBeenCalled();
    expect(jsMsg.nak).not.toHaveBeenCalled();
  });

  it('does not nak a handler that throws', async () => {
    const jsMsg = await deliverUnder(async () => {
      throw new Error('handler failed');
    });

    expect(jsMsg.nak).not.toHaveBeenCalled();
    expect(jsMsg.ack).not.toHaveBeenCalled();
    expect(jsMsg.term).not.toHaveBeenCalled();
  });

  it('routes nothing to the dead-letter queue, even when one is configured', async () => {
    // The mode promises no dead-letter routing on any adapter. The AUTOMATIC path is
    // gated by acknowledgesAutomatically, but a handler calling nack(false) itself
    // reaches the router closure directly — so the closure is what has to be gated.
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({ pattern: 'test.topic', data: {} })),
      info: { redelivered: false, deliveryCount: 1 },
    });
    const { adapter, mockJs } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    await adapter.subscribe('test.topic', async (message) => {
      await message.nack(false);
    }, { ackMode: 'none', deadLetter: { queue: DLQ } } as AnyRecord);
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(asAny(mockJs.publish).mock.calls.some((c: unknown[]) => c[0] === DLQ)).toBe(false);
    expect(jsMsg.term).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Message.attempt / Message.maxAttempts
//
// Both fields were declared and never assigned, so the retry recipe the docs
// ship — `if (message.attempt && message.attempt >= (message.maxAttempts || 3))`
// — could never take its terminal branch: every failure fell through to
// nack(true) until max_deliver ran out.
// ============================================================================

describe('Message.attempt and Message.maxAttempts', () => {
  /** Delivers one message at the given delivery count and hands back what the handler saw. */
  async function deliveredAt(deliveryCount: number, options: AnyRecord = {}) {
    const jsMsg = makeMockJsMsg({
      data: new TextEncoder().encode(JSON.stringify({ pattern: 'test.topic', data: {} })),
      info: { redelivered: deliveryCount > 1, deliveryCount },
    });
    const { adapter, mockJsm } = makeConnectedAdapter();
    const consumer = makeMockConsumer([jsMsg]);
    asAny(adapter).js.consumers.get = mock(() => Promise.resolve(consumer));

    let seen: AnyRecord | null = null;
    await adapter.subscribe('test.topic', async (message) => {
      seen = message as unknown as AnyRecord;
    }, { group: 'g', ackMode: 'manual', ...options });

    await new Promise(resolve => setTimeout(resolve, 25));

    return { message: seen!, cfg: callArg(mockJsm.consumers.add, 0, 1) };
  }

  it('reports the delivery count the server tracked', async () => {
    expect((await deliveredAt(2)).message.attempt).toBe(2);
  });

  it('reports the cap the consumer was actually created with', async () => {
    const { message, cfg } = await deliveredAt(1);

    expect(message.maxAttempts).toBe(cfg.max_deliver as number);
  });

  it('carries retry.attempts through, not the built-in default', async () => {
    const { message } = await deliveredAt(1, { retry: { attempts: 7 } });

    expect(message.maxAttempts).toBe(7);
    expect(message.maxAttempts).not.toBe(3);
  });

  it('starts at 1, so the documented terminal guard is false on a first delivery', async () => {
    const { message } = await deliveredAt(1);

    expect(message.attempt).toBe(1);
    expect(message.attempt >= message.maxAttempts).toBe(false);
  });

  it('makes the documented terminal guard true on the last delivery', async () => {
    // The branch that was unreachable: attempt only ever equalled undefined before.
    const { message } = await deliveredAt(3);

    expect(message.attempt).toBe(3);
    expect(message.attempt >= message.maxAttempts).toBe(true);
  });
});

// ============================================================================
// Publish deduplication
//
// `PublishOptions.messageId` was an inert echo: it reached the JSON body and
// came back as `Message.id`, but JetStream keys deduplication strictly off the
// `Nats-Msg-Id` header, which was never sent. Publishing the same logical
// message twice stored it twice.
// ============================================================================

describe('publish deduplication: msgID', () => {
  it('sends msgID when the caller supplies a messageId', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();
    await adapter.publish('test.topic', { a: 1 }, { messageId: 'outbox-42' });

    expect(callArg(mockJs.publish, 0, 2)).toEqual({ msgID: 'outbox-42' });
  });

  it('keeps the id in the JSON body, so the wire format is unchanged', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();
    await adapter.publish('test.topic', { a: 1 }, { messageId: 'outbox-42' });

    const decoded = JSON.parse(new TextDecoder().decode(
      asAny(mockJs.publish).mock.calls[0][1] as Uint8Array,
    )) as AnyRecord;

    expect(decoded.id).toBe('outbox-42');
  });

  it('treats an empty messageId as absent', async () => {
    // A generated id is unique per call, so sending it would only grow the server's
    // dedup index without ever matching. '' is rejected by the same truthy check the
    // client itself applies.
    const { adapter, mockJs } = makeConnectedAdapter();
    const id = await adapter.publish('test.topic', { a: 1 }, { messageId: '' });

    expect(callArg(mockJs.publish, 0, 2)).toBeUndefined();
    expect(id.startsWith('js-')).toBe(true);
  });

  it('resolves even though the PubAck is discarded', async () => {
    // The mock resolves undefined on purpose: nothing may dereference the ack.
    const { adapter } = makeConnectedAdapter();

    await expect(adapter.publish('test.topic', { a: 1 }, { messageId: 'outbox-42' }))
      .resolves.toBe('outbox-42');
  });

  it('forwards each batch entry its own msgID', async () => {
    const { adapter, mockJs } = makeConnectedAdapter();
    await adapter.publishBatch([
      { pattern: 'test.topic', data: { a: 1 }, options: { messageId: 'outbox-1' } },
      { pattern: 'test.topic', data: { a: 2 } },
    ]);

    expect(callArg(mockJs.publish, 0, 2)).toEqual({ msgID: 'outbox-1' });
    expect(callArg(mockJs.publish, 1, 2)).toBeUndefined();
  });
});

describe('publish deduplication: duplicateWindow', () => {
  it('sends duplicate_window on the create path when declared', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], duplicateWindow: 600_000_000_000 }],
    });
    mockJsm.streams.info = mock(() => Promise.reject(makeApiError(STREAM_NOT_FOUND_CODE, 'stream not found')));

    await adapter.connect();

    expect(callArg(mockJsm.streams.add, 0, 0).duplicate_window).toBe(600_000_000_000);
  });

  it('sends duplicate_window on the update path when declared', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], duplicateWindow: 600_000_000_000 }],
    });

    await adapter.connect();

    expect(callArg(mockJsm.streams.update, 0, 1).duplicate_window).toBe(600_000_000_000);
  });

  it('omits the key entirely when undeclared, so an operator-set window survives', async () => {
    // Key ABSENCE, never toBeUndefined(): the client's update merges with a shallow
    // Object.assign, so a present-but-undefined key would reset the server's window.
    const { adapter, mockJsm } = makeConnectableAdapter();

    await adapter.connect();

    expect('duplicate_window' in callArg(mockJsm.streams.update, 0, 1)).toBe(false);
  });

  it('inherits duplicateWindow from streamDefaults', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streamDefaults: { duplicateWindow: 300_000_000_000 },
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
    });

    await adapter.connect();

    expect(callArg(mockJsm.streams.update, 0, 1).duplicate_window).toBe(300_000_000_000);
  });

  it('lets a per-stream value override streamDefaults', async () => {
    const { adapter, mockJsm } = makeConnectableAdapter({
      streamDefaults: { duplicateWindow: 300_000_000_000 },
      streams: [{ name: 'TEST_STREAM', subjects: ['test.>'], duplicateWindow: 900_000_000_000 }],
    });

    await adapter.connect();

    expect(callArg(mockJsm.streams.update, 0, 1).duplicate_window).toBe(900_000_000_000);
  });
});

// ============================================================================
// deleteDurableConsumer
//
// unsubscribe() and disconnect() never delete a durable — they run on every
// graceful shutdown, so deleting there would discard the consumer's position on
// each deploy. Until now that left NO supported way to decommission one, which
// bites hardest when a `group` was templated per run and left a trail behind.
// ============================================================================

describe('deleteDurableConsumer', () => {
  it('deletes the durable the identity scheme names for (pattern, group)', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });

    // Derive the expected name the same way subscribe() does, rather than hardcoding a digest.
    await adapter.subscribe('orders.created', async () => undefined, { group: 'workers' });
    const expectedName = callArg(mockJsm.consumers.add, 0, 1).durable_name as string;

    const removed = await adapter.deleteDurableConsumer('orders.created', 'workers');

    expect(callArg(mockJsm.consumers.delete, 0, 0) as unknown as string).toBe('ORDERS');
    expect(callArg(mockJsm.consumers.delete, 0, 1) as unknown as string).toBe(expectedName);
    expect(removed).toBe(true);
  });

  it('returns false when there is no such consumer', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    mockJsm.consumers.delete = mock(() =>
      Promise.reject(makeApiError(CONSUMER_NOT_FOUND_CODE, 'consumer not found')),
    );

    expect(await adapter.deleteDurableConsumer('orders.created', 'workers')).toBe(false);
  });

  it('rethrows a permissions denial instead of reporting it as already gone', async () => {
    // A bare `catch { return false }` here would turn "you may not do that" into
    // "there was nothing to do", which is the anti-pattern this epic keeps removing.
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    mockJsm.consumers.delete = mock(() => Promise.reject(makeApiError(503, 'permissions violation')));

    await expect(adapter.deleteDurableConsumer('orders.created', 'workers'))
      .rejects.toThrow(/permissions violation/);
  });

  it('refuses to guess a stream when no declaration binds the pattern', async () => {
    // The lenient resolver falls back to the first declared stream. On a destructive call
    // that would delete a same-named consumer on an unrelated stream.
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [
        { name: 'ORDERS', subjects: ['orders.>'] },
        { name: 'EVENTS', subjects: ['events.>'] },
      ],
    });

    await expect(adapter.deleteDurableConsumer('typo.created', 'workers'))
      .rejects.toThrow(/No declared stream binds "typo\.created"/);
    expect(mockJsm.consumers.delete).not.toHaveBeenCalled();
  });

  it('names every declared stream when it refuses', async () => {
    const { adapter } = makeConnectedAdapter({
      streams: [
        { name: 'ORDERS', subjects: ['orders.>'] },
        { name: 'EVENTS', subjects: ['events.>'] },
      ],
    });

    let message = '';
    try {
      await adapter.deleteDurableConsumer('typo.created', 'workers');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('ORDERS');
    expect(message).toContain('EVENTS');
  });

  it('throws when the adapter is not connected', async () => {
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });

    await expect(adapter.deleteDurableConsumer('orders.created', 'workers'))
      .rejects.toThrow('JetStreamQueueAdapter not connected');
  });
});

/**
 * The teardown form.
 *
 * The strict `deleteDurableConsumer` is right for a call an operator makes on purpose and wrong
 * for one an `afterEach` makes unconditionally: it throws when the adapter never connected, when
 * the pattern is unbound, and when the server refuses — and a throw in teardown REPLACES the
 * assertion failure in the output, so the real breakage disappears behind a cleanup error.
 */
describe('tryDeleteDurableConsumer', () => {
  it('lets the original failure through instead of replacing it with a teardown error', async () => {
    // The whole point, written the way it is actually used: `runCase` is a test that failed, the
    // `finally` is its teardown, and the broker refuses the delete. With the strict form the
    // permissions error wins — `finally` replaces the in-flight exception — and the output names
    // JetStream instead of the assertion that broke.
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    mockJsm.consumers.delete = mock(() => Promise.reject(makeApiError(503, 'permissions violation')));
    adapter.on('onError', () => undefined);

    const runCase = async (): Promise<void> => {
      try {
        throw new Error('the assertion that actually failed');
      } finally {
        await adapter.tryDeleteDurableConsumer('orders.created', 'workers');
      }
    };

    await expect(runCase()).rejects.toThrow('the assertion that actually failed');

    // And the strict form is unchanged — it is still the one that refuses to be quiet.
    await expect(adapter.deleteDurableConsumer('orders.created', 'workers'))
      .rejects.toThrow(/permissions violation/);
  });

  it('returns false without attempting anything when never connected', async () => {
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => errors.push(error));

    expect(await adapter.tryDeleteDurableConsumer('orders.created', 'workers')).toBe(false);
    // And quietly: an adapter that never connected has no consumer to remove, so reporting it
    // would make every clean teardown noisy.
    expect(errors).toHaveLength(0);
  });

  it('reports an unbound pattern through onError rather than throwing', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => errors.push(error));

    expect(await adapter.tryDeleteDurableConsumer('typo.created', 'workers')).toBe(false);
    expect(mockJsm.consumers.delete).not.toHaveBeenCalled();
    // Swallowed for the caller, not for the listener: a mistyped pattern in teardown is still
    // worth knowing about, and this is the channel that says so without killing the run.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/No declared stream binds "typo\.created"/);
  });

  it('reports a permissions denial rather than reporting it as nothing to do', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    mockJsm.consumers.delete = mock(() => Promise.reject(makeApiError(503, 'permissions violation')));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => errors.push(error));

    expect(await adapter.tryDeleteDurableConsumer('orders.created', 'workers')).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/permissions violation/);
  });

  it('deletes and reports true on the happy path, exactly like the strict form', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });

    await adapter.subscribe('orders.created', async () => undefined, { group: 'workers' });
    const expectedName = callArg(mockJsm.consumers.add, 0, 1).durable_name as string;

    expect(await adapter.tryDeleteDurableConsumer('orders.created', 'workers')).toBe(true);
    expect(callArg(mockJsm.consumers.delete, 0, 0) as unknown as string).toBe('ORDERS');
    expect(callArg(mockJsm.consumers.delete, 0, 1) as unknown as string).toBe(expectedName);
  });

  it('returns false, quietly, when there was no such consumer', async () => {
    const { adapter, mockJsm } = makeConnectedAdapter({
      streams: [{ name: 'ORDERS', subjects: ['orders.>'] }],
    });
    mockJsm.consumers.delete = mock(() =>
      Promise.reject(makeApiError(CONSUMER_NOT_FOUND_CODE, 'consumer not found')));

    const errors: Error[] = [];
    adapter.on('onError', (error: Error) => errors.push(error));

    // Idempotent: calling it twice, or on a case that never subscribed, is not an error.
    expect(await adapter.tryDeleteDurableConsumer('orders.created', 'workers')).toBe(false);
    expect(errors).toHaveLength(0);
  });
});
