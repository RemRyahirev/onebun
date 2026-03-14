/**
 * NATS Types Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import type {
  NatsConnectionOptions,
  NatsAdapterOptions,
  JetStreamAdapterOptions,
} from '../src/types';

describe('nats-types', () => {
  describe('NatsConnectionOptions', () => {
    it('should accept minimal options', () => {
      const options: NatsConnectionOptions = {
        servers: 'nats://localhost:4222',
      };

      expect(options.servers).toBe('nats://localhost:4222');
    });

    it('should accept array of servers', () => {
      const options: NatsConnectionOptions = {
        servers: ['nats://host1:4222', 'nats://host2:4222'],
      };

      expect(Array.isArray(options.servers)).toBe(true);
      expect(options.servers.length).toBe(2);
    });

    it('should accept all options', () => {
      const options: NatsConnectionOptions = {
        servers: 'nats://localhost:4222',
        name: 'test-client',
        token: 'secret-token',
        user: 'admin',
        pass: 'password',
        maxReconnectAttempts: 10,
        reconnectTimeWait: 1000,
        timeout: 5000,
        tls: true,
      };

      expect(options.name).toBe('test-client');
      expect(options.token).toBe('secret-token');
      expect(options.user).toBe('admin');
      expect(options.pass).toBe('password');
      expect(options.maxReconnectAttempts).toBe(10);
      expect(options.reconnectTimeWait).toBe(1000);
      expect(options.timeout).toBe(5000);
      expect(options.tls).toBe(true);
    });
  });

  describe('NatsAdapterOptions', () => {
    it('should extend NatsConnectionOptions', () => {
      const options: NatsAdapterOptions = {
        servers: 'nats://localhost:4222',
        name: 'adapter',
      };

      expect(options.servers).toBe('nats://localhost:4222');
      expect(options.name).toBe('adapter');
    });
  });

  describe('JetStreamAdapterOptions', () => {
    it('should accept minimal options', () => {
      const options: JetStreamAdapterOptions = {
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
      };

      expect(options.servers).toBe('nats://localhost:4222');
      expect(options.streams[0].name).toBe('EVENTS');
    });

    it('should accept streams with full configuration', () => {
      const options: JetStreamAdapterOptions = {
        servers: 'nats://localhost:4222',
        streams: [
          {
            name: 'EVENTS',
            subjects: ['events.>'],
            retention: 'limits',
            maxMsgs: 1000000,
            maxBytes: 1073741824,
            maxAge: 86400000000000,
            storage: 'file',
            replicas: 3,
          },
        ],
      };

      const stream = options.streams[0];
      expect(stream.subjects).toEqual(['events.>']);
      expect(stream.retention).toBe('limits');
      expect(stream.maxMsgs).toBe(1000000);
      expect(stream.storage).toBe('file');
      expect(stream.replicas).toBe(3);
    });

    it('should accept consumer configuration', () => {
      const options: JetStreamAdapterOptions = {
        servers: 'nats://localhost:4222',
        streams: [{ name: 'EVENTS', subjects: ['events.>'] }],
        consumerConfig: {
          ackWait: 30000000000,
          maxDeliver: 5,
          maxAckPending: 100,
        },
      };

      expect(options.consumerConfig?.ackWait).toBe(30000000000);
      expect(options.consumerConfig?.maxDeliver).toBe(5);
      expect(options.consumerConfig?.maxAckPending).toBe(100);
    });
  });
});
