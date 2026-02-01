/**
 * NATS Client Tests
 * 
 * Note: These tests don't require a running NATS server.
 * They test the client's properties and error handling.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'bun:test';

import { NatsClient, createNatsClient } from '../src/nats-client';

describe('NatsClient', () => {
  let client: NatsClient;

  beforeEach(() => {
    client = new NatsClient({
      servers: 'nats://localhost:4222',
    });
  });

  describe('lifecycle', () => {
    it('should not be connected initially', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return null connection when not connected', () => {
      expect(client.getConnection()).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should throw when publishing without connecting', async () => {
      await expect(client.publish('test', 'data')).rejects.toThrow('Not connected to NATS');
    });

    it('should throw when subscribing without connecting', async () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      await expect(client.subscribe('test', () => {})).rejects.toThrow('Not connected to NATS');
    });

    it('should throw when requesting without connecting', async () => {
      await expect(client.request('test', 'data')).rejects.toThrow('Not connected to NATS');
    });
  });

  describe('createNatsClient', () => {
    it('should create client instance', () => {
      const created = createNatsClient({
        servers: 'nats://localhost:4222',
      });

      expect(created).toBeInstanceOf(NatsClient);
    });

    it('should accept all options', () => {
      const created = createNatsClient({
        servers: ['nats://host1:4222', 'nats://host2:4222'],
        name: 'test-client',
        token: 'secret',
        user: 'admin',
        pass: 'password',
        maxReconnectAttempts: 10,
        reconnectTimeWait: 2000,
        timeout: 5000,
        tls: true,
      });

      expect(created).toBeInstanceOf(NatsClient);
    });
  });
});
