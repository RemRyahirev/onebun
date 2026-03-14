/**
 * Documentation Examples Tests for @onebun/nats
 *
 * This file tests code examples from:
 * - docs/api/queue.md (NATS/JetStream sections)
 *
 * Each test case corresponds to a code block in the documentation.
 * Keep these tests in sync with the documentation!
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import type { NatsAdapterOptions, JetStreamAdapterOptions } from '../src/types';

import {
  NatsQueueAdapter,
  JetStreamQueueAdapter,
  NatsClient,
  createNatsQueueAdapter,
  createJetStreamQueueAdapter,
  createNatsClient,
} from '../src/index';


/**
 * @source docs/api/queue.md#natsqueueadapter
 */
describe('Basic NATS (Pub/Sub) Example (README.md)', () => {
  it('should create NatsQueueAdapter with options', () => {
    // From README.md: Basic NATS (Pub/Sub) section
    const options: NatsAdapterOptions = {
      servers: 'nats://localhost:4222',
    };

    const adapter = new NatsQueueAdapter(options);

    expect(adapter.name).toBe('nats');
    expect(adapter.type).toBe('nats');
  });
});

/**
 * @source docs/api/queue.md#jetstreamqueueadapter
 */
describe('JetStream (Persistent) Example (README.md)', () => {
  it('should create JetStreamQueueAdapter with multi-stream configuration', () => {
    // From README.md: JetStream (Persistent) section
    const options: JetStreamAdapterOptions = {
      servers: 'nats://localhost:4222',
      streamDefaults: { retention: 'limits', storage: 'file' },
      streams: [
        { name: 'EVENTS', subjects: ['events.>'] },
        { name: 'agent_events', subjects: ['agent.events.>'] },
      ],
    };

    const adapter = new JetStreamQueueAdapter(options);

    expect(adapter.name).toBe('jetstream');
    expect(adapter.type).toBe('jetstream');
  });
});

/**
 * @source docs/api/queue.md#feature-support-matrix
 */
describe('Feature Comparison (README.md)', () => {
  it('should report correct NatsQueueAdapter features', () => {
    // From README.md: Feature Comparison table
    const adapter = new NatsQueueAdapter({ servers: 'nats://localhost:4222' });

    // Supported
    expect(adapter.supports('pattern-subscriptions')).toBe(true);
    expect(adapter.supports('consumer-groups')).toBe(true);
    expect(adapter.supports('scheduled-jobs')).toBe(true);

    // Not supported
    expect(adapter.supports('delayed-messages')).toBe(false);
    expect(adapter.supports('priority')).toBe(false);
    expect(adapter.supports('dead-letter-queue')).toBe(false);
    expect(adapter.supports('retry')).toBe(false);
  });

  it('should report correct JetStreamQueueAdapter features', () => {
    // From README.md: Feature Comparison table
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'TEST', subjects: ['test.>'] }],
    });

    // Supported
    expect(adapter.supports('pattern-subscriptions')).toBe(true);
    expect(adapter.supports('consumer-groups')).toBe(true);
    expect(adapter.supports('scheduled-jobs')).toBe(true);
    expect(adapter.supports('dead-letter-queue')).toBe(true);
    expect(adapter.supports('retry')).toBe(true);

    // Not supported
    expect(adapter.supports('delayed-messages')).toBe(false);
    expect(adapter.supports('priority')).toBe(false);
  });
});

/**
 * @source docs/api/queue.md#configuration-options
 */
describe('Configuration Options (README.md)', () => {
  it('should accept NatsConnectionOptions', () => {
    // From README.md: NatsConnectionOptions interface
    const options: NatsAdapterOptions = {
      servers: ['nats://host1:4222', 'nats://host2:4222'], // Multiple servers
      name: 'my-client',
      token: 'secret-token',
      user: 'admin',
      pass: 'password',
      maxReconnectAttempts: 10,
      reconnectTimeWait: 2000,
      timeout: 5000,
      tls: true,
    };

    const adapter = createNatsQueueAdapter(options);
    expect(adapter).toBeInstanceOf(NatsQueueAdapter);
  });

  it('should accept JetStreamAdapterOptions', () => {
    // From README.md: JetStreamAdapterOptions interface
    const options: JetStreamAdapterOptions = {
      servers: 'nats://localhost:4222',
      streamDefaults: {
        retention: 'limits',
        storage: 'file',
        replicas: 1,
        maxMsgs: 1000000,
        maxBytes: 1073741824,
        maxAge: 86400000000000,
      },
      streams: [
        {
          name: 'EVENTS',
          subjects: ['events.>'],
        },
      ],
      consumerConfig: {
        ackWait: 30000000000, // 30s in nanoseconds
        maxDeliver: 5,
        maxAckPending: 100,
      },
    };

    const adapter = createJetStreamQueueAdapter(options);
    expect(adapter).toBeInstanceOf(JetStreamQueueAdapter);
  });
});

/**
 * @source docs/api/queue.md#natsqueueadapter
 */
describe('NatsQueueAdapter (docs/api/queue.md)', () => {
  it('should create adapter for pub/sub', () => {
    // From docs/api/queue.md: NatsQueueAdapter section
    const adapter = new NatsQueueAdapter({
      servers: 'nats://localhost:4222',
    });

    expect(adapter.name).toBe('nats');
    expect(adapter.isConnected()).toBe(false);
  });
});

/**
 * @source docs/api/queue.md#jetstreamqueueadapter
 */
describe('JetStreamQueueAdapter (docs/api/queue.md)', () => {
  it('should create adapter for persistent messaging with multi-stream', () => {
    // From docs/api/queue.md: JetStreamQueueAdapter section
    const adapter = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streamDefaults: {
        retention: 'limits',
        storage: 'file',
        replicas: 1,
      },
      streams: [
        {
          name: 'EVENTS',
          subjects: ['events.>'],
        },
        {
          name: 'agent_events',
          subjects: ['agent.events.>'],
          maxAge: 7 * 24 * 60 * 60 * 1e9,
        },
        {
          name: 'agent_dlq',
          subjects: ['agent.dlq.>'],
          maxAge: 7 * 24 * 60 * 60 * 1e9,
          storage: 'memory',
        },
      ],
    });

    expect(adapter.name).toBe('jetstream');
    expect(adapter.isConnected()).toBe(false);
  });
});

/**
 * @source docs/api/queue.md#natsclient
 */
describe('NatsClient', () => {
  it('should create client instance', () => {
    const client = createNatsClient({
      servers: 'nats://localhost:4222',
      name: 'test-client',
    });

    expect(client).toBeInstanceOf(NatsClient);
    expect(client.isConnected()).toBe(false);
  });
});

/**
 * @source docs/api/queue.md#feature-support-matrix (NATS column)
 */
describe('Feature Support Matrix - NATS (docs/api/queue.md)', () => {
  it('NATS adapter supports correct features', () => {
    // From docs/api/queue.md: Feature Support Matrix table - NATS column
    const nats = new NatsQueueAdapter({ servers: 'nats://localhost:4222' });

    expect(nats.supports('pattern-subscriptions')).toBe(true);
    expect(nats.supports('consumer-groups')).toBe(true);
    expect(nats.supports('scheduled-jobs')).toBe(true);
    expect(nats.supports('delayed-messages')).toBe(false);
    expect(nats.supports('priority')).toBe(false);
    expect(nats.supports('dead-letter-queue')).toBe(false);
    expect(nats.supports('retry')).toBe(false);
  });

  it('JetStream adapter supports correct features', () => {
    // From docs/api/queue.md: Feature Support Matrix table - JetStream column
    const js = new JetStreamQueueAdapter({
      servers: 'nats://localhost:4222',
      streams: [{ name: 'TEST', subjects: ['test.>'] }],
    });

    expect(js.supports('pattern-subscriptions')).toBe(true);
    expect(js.supports('consumer-groups')).toBe(true);
    expect(js.supports('scheduled-jobs')).toBe(true);
    expect(js.supports('dead-letter-queue')).toBe(true);
    expect(js.supports('retry')).toBe(true);
    expect(js.supports('delayed-messages')).toBe(false);
    expect(js.supports('priority')).toBe(false);
  });
});
