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

import {
  NatsClient,
  createNatsClient,
  toDriverOptions,
} from '../src/nats-client';

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

  /**
   * The allow-list this replaces is where `inboxPrefix` was lost: it sat in
   * `NatsConnectionOptions`, callers set it, and `connect()` handed the driver an object that
   * never carried it. Asserting the client holds the options proves nothing about that — the
   * drop happens one step later — so these cases assert the object the driver actually receives.
   */
  describe('toDriverOptions', () => {
    it('forwards inboxPrefix, which the old allow-list silently dropped', () => {
      const driver = toDriverOptions({
        servers: 'nats://localhost:4222',
        inboxPrefix: '_INBOX_acme_api',
      });

      expect(driver.inboxPrefix).toBe('_INBOX_acme_api');
    });

    it('forwards every option OneBun names, under the driver\'s own key', () => {
      const driver = toDriverOptions({
        servers: ['nats://host1:4222', 'nats://host2:4222'],
        name: 'test-client',
        token: 'secret',
        user: 'admin',
        pass: 'password',
        maxReconnectAttempts: 10,
        reconnectTimeWait: 2000,
        timeout: 5000,
        inboxPrefix: '_INBOX_acme_api',
      });

      expect(driver).toEqual({
        servers: ['nats://host1:4222', 'nats://host2:4222'],
        name: 'test-client',
        token: 'secret',
        user: 'admin',
        pass: 'password',
        maxReconnectAttempts: 10,
        reconnectTimeWait: 2000,
        timeout: 5000,
        inboxPrefix: '_INBOX_acme_api',
      });
    });

    it('omits an option the application did not set, rather than sending it as undefined', () => {
      // Structural, by key presence, because that is exactly what decides the outcome: nats.js
      // merges with `extend(defaultOptions(), opts)`, which copies own keys unconditionally. A
      // present-and-undefined `reconnectTimeWait` therefore overwrites the driver's 2000, and its
      // reconnect-delay handler goes on to schedule every retry at NaN milliseconds.
      const driver = toDriverOptions({ servers: 'nats://localhost:4222' });

      expect(Object.keys(driver)).toEqual(['servers']);
      expect('maxReconnectAttempts' in driver).toBe(false);
      expect('reconnectTimeWait' in driver).toBe(false);
      expect('tls' in driver).toBe(false);
    });

    it('translates tls: true into the driver\'s empty options object', () => {
      expect(toDriverOptions({ servers: 'nats://localhost:4222', tls: true }).tls).toEqual({});
    });

    it('leaves tls undefined when it is false or absent, rather than sending a negotiation', () => {
      expect(toDriverOptions({ servers: 'nats://localhost:4222', tls: false }).tls).toBeUndefined();
      expect(toDriverOptions({ servers: 'nats://localhost:4222' }).tls).toBeUndefined();
    });

    it('carries a driver option OneBun does not name — the allow-list is no longer a ceiling', () => {
      const driver = toDriverOptions({
        servers: 'nats://localhost:4222',
        driverOptions: { noEcho: true, pingInterval: 30_000 },
      });

      expect(driver.noEcho).toBe(true);
      expect(driver.pingInterval).toBe(30_000);
    });

    it('merges driverOptions last, so it wins over a named option', () => {
      const driver = toDriverOptions({
        servers: 'nats://localhost:4222',
        name: 'named',
        tls: true,
        driverOptions: { name: 'from-driver-options', tls: null },
      });

      expect(driver.name).toBe('from-driver-options');
      expect(driver.tls).toBeNull();
    });

    it('does not mutate the options it was given', () => {
      const options = { servers: 'nats://localhost:4222', driverOptions: { noEcho: true } };
      toDriverOptions(options);

      expect(options).toEqual({ servers: 'nats://localhost:4222', driverOptions: { noEcho: true } });
    });
  });
});
