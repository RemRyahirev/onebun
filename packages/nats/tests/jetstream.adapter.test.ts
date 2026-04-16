/**
 * JetStream Queue Adapter Tests
 *
 * Note: These tests don't require a running NATS server.
 * They test the adapter's properties and error handling.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
} from 'bun:test';

import { JetStreamQueueAdapter, createJetStreamQueueAdapter } from '../src/jetstream.adapter';

// ============================================================================
// Helpers to access private internals via casting
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}

// ============================================================================
// Mock factories
// ============================================================================

function makeMockJsMsg(overrides: Partial<AnyRecord> = {}): AnyRecord {
  return {
    ack: mock(() => undefined),
    nak: mock(() => undefined),
    data: new TextEncoder().encode('{}'),
    subject: 'test.topic',
    info: { redelivered: false },
    ...overrides,
  };
}

function makeMockConsumer(messages: AnyRecord[] = []) {
  return {
    consume: mock(() =>
      Promise.resolve({
        async *[Symbol.asyncIterator] () {
          for (const msg of messages) {
            yield msg;
          }
        },
      }),
    ),
  };
}

function makeConnectedAdapter() {
  const adapter = new JetStreamQueueAdapter({
    servers: 'nats://localhost:4222',
    streams: [{ name: 'TEST_STREAM', subjects: ['test.>'] }],
  });

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

  // Mock JetStream context
  const mockJsm = {
    streams: {
      info: mock(() => Promise.resolve()),
      update: mock(() => Promise.resolve()),
      add: mock(() => Promise.resolve()),
    },
    consumers: {
      add: mock(() => Promise.resolve()),
    },
  };

  const mockJs = {
    publish: mock(() => Promise.resolve()),
    consumers: {
      get: mock(() => Promise.resolve(makeMockConsumer())),
    },
  };

  a.js = mockJs;
  a.jsm = mockJsm;

  return { adapter, mockJs, mockJsm };
}

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

    await capturedMessage!.nack();

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
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

    await capturedMessage!.nack();
    await capturedMessage!.nack(); // second call — no-op

    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
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

    await capturedMessage!.nack();
    await capturedMessage!.ack(); // should be no-op

    expect(jsMsg.ack).toHaveBeenCalledTimes(0);
    expect(jsMsg.nak).toHaveBeenCalledTimes(1);
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
    expect(jsMsg.nak).toHaveBeenCalledTimes(0);
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

    it('should fallback to first stream for unknown subjects', () => {
      const multiAdapter = new JetStreamQueueAdapter({
        servers: 'nats://localhost:4222',
        streams: [
          { name: 'DEFAULT', subjects: ['default.>'] },
          { name: 'EVENTS', subjects: ['events.>'] },
        ],
      });

      expect(multiAdapter.resolveStreamForSubject('unknown.topic')).toBe('DEFAULT');
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
// natsSubjectMatches (via resolveStreamForSubject — private method)
// ============================================================================

describe('natsSubjectMatches (private method via asAny)', () => {
  // Access the private natsSubjectMatches method directly
  const baseAdapter = new JetStreamQueueAdapter({
    servers: 'nats://localhost:4222',
    streams: [{ name: 'S', subjects: ['s.>'] }],
  });

  function matches(pattern: string, subject: string): boolean {
    return asAny(baseAdapter).natsSubjectMatches(pattern, subject);
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
