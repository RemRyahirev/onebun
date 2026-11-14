/**
 * NATS Client Tests
 * 
 * Note: These tests don't require a running NATS server.
 * They test the client's properties and error handling. The one that runs `connect()` for real
 * does it against `withFakeServer`, an in-process stand-in on a loopback port.
 */

import { errors, headers } from '@nats-io/transport-node';
import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
} from 'bun:test';

import { QueuePublishError } from '@onebun/core';

import {
  NatsClient,
  createNatsClient,
  toDriverOptions,
  toHeaderMap,
} from '../src/nats-client';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>;

function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A stand-in for the driver's connection, modelling what `disconnect()` relies on the way
 * `@nats-io/nats-core` implements it, with the driver's own error classes:
 *
 * - `drain()` rejects at once with `ClosedConnectionError` on a closed connection, and with
 *   `DrainingConnectionError` while a drain is already under way;
 * - a drain that completes ends by closing the connection, so `closed()` resolves before it does;
 * - a drain that fails leaves the connection open — and, with reconnects enabled, reconnecting;
 * - `close()` on a closed connection does nothing;
 * - `closed()` resolves once the connection closes, with the error it closed on, or with nothing
 *   for a deliberate close.
 *
 * `closeOnItsOwn(error)` is the driver giving up after `maxReconnectAttempts`: it closes the
 * connection with that error and leaves a pending drain unsettled, as nats-core does.
 *
 * Installed on the client instance rather than produced by `connect()`: the driver is resolved
 * through a module-level dynamic import, and `mock.module` is banned in this repo.
 */
function makeFakeConnection(behaviour: {
  drain?: () => Promise<void>;
  close?: () => Promise<void>;
} = {}) {
  const state = { closed: false, draining: false };
  let resolveClosed!: (reason: Error | undefined) => void;
  const closedPromise = new Promise<Error | undefined>((resolve) => {
    resolveClosed = resolve;
  });
  const markClosed = (reason?: Error): void => {
    if (!state.closed) {
      state.closed = true;
      resolveClosed(reason);
    }
  };

  const nc = {
    drain: mock(async () => {
      if (state.closed) {
        throw new errors.ClosedConnectionError();
      }
      if (state.draining) {
        throw new errors.DrainingConnectionError();
      }
      state.draining = true;
      await (behaviour.drain?.() ?? Promise.resolve());
      markClosed();
    }),
    close: mock(async () => {
      if (state.closed) {
        return;
      }
      await (behaviour.close?.() ?? Promise.resolve());
      markClosed();
    }),
    isClosed: mock(() => state.closed),
    closed: mock(() => closedPromise),
  };

  return { nc, state, closeOnItsOwn: markClosed };
}

/** A drain whose flush nothing ever answers. */
function neverSettles(): Promise<void> {
  return new Promise<void>(() => undefined);
}

/**
 * Just enough of a NATS server for the driver's `connect()` and `drain()`: it introduces itself
 * and answers every PING. In-process on a loopback port, so `connect()` runs for real without a
 * broker.
 */
async function withFakeServer(run: (servers: string) => Promise<void>): Promise<void> {
  const info = JSON.stringify({
    server_id: 'fake', version: '2.11.0', proto: 1, max_payload: 1_048_576, headers: true,
  });
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.write(`INFO ${info}\r\n`);
      },
      data(socket, data) {
        const pings = data.toString().split('PING').length - 1;
        for (let i = 0; i < pings; i++) {
          socket.write('PONG\r\n');
        }
      },
    },
  });

  try {
    await run(`nats://127.0.0.1:${server.port}`);
  } finally {
    server.stop(true);
  }
}

/** Lets every queued promise reaction run, without a timer. */
function flushReactions(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

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

  describe('disconnect', () => {
    it('drains, then closes, then clears the connection on a healthy connection', async () => {
      const { nc } = makeFakeConnection();
      asAny(client).nc = nc;
      expect(client.isConnected()).toBe(true);

      await expect(client.disconnect()).resolves.toBeUndefined();

      expect(nc.drain).toHaveBeenCalledTimes(1);
      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(nc.drain.mock.invocationCallOrder[0]).toBeLessThan(nc.close.mock.invocationCallOrder[0]);
      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
    });

    it('is a no-op when there is no connection', async () => {
      await expect(client.disconnect()).resolves.toBeUndefined();
      expect(client.getConnection()).toBeNull();
    });

    it('closes the connection and clears it when the drain rejects, then rethrows the drain error', async () => {
      // What the driver does when `disconnect()` lands during an outage: the drain's flush is
      // rejected on the next reconnect attempt, and the connection is left open and reconnecting.
      const drainError = new Error('connection disconnected');
      const { nc, state } = makeFakeConnection({ drain: () => Promise.reject(drainError) });
      asAny(client).nc = nc;

      await expect(client.disconnect()).rejects.toBe(drainError);

      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(state.closed).toBe(true);
      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
    });

    it('clears the connection and rethrows the close error when close rejects after a clean drain', async () => {
      const closeError = new Error('transport close failed');
      const { nc } = makeFakeConnection({ close: () => Promise.reject(closeError) });
      // A drain that resolves without closing, so the close after it really runs and rejects.
      nc.drain = mock(() => Promise.resolve());
      asAny(client).nc = nc;

      await expect(client.disconnect()).rejects.toBe(closeError);

      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
    });

    it('rethrows the drain error, not the close error, when both reject', async () => {
      const drainError = new Error('connection disconnected');
      const closeError = new Error('transport close failed');
      const { nc } = makeFakeConnection({
        drain: () => Promise.reject(drainError),
        close: () => Promise.reject(closeError),
      });
      asAny(client).nc = nc;

      await expect(client.disconnect()).rejects.toBe(drainError);

      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
    });

    it('releases a connection the driver already closed itself, and rethrows the error it closed with', async () => {
      // The driver closes the connection on its own once `maxReconnectAttempts` is spent. That is
      // when buffered publishes are certainly lost, so the call must not resolve as if all were well.
      const gaveUp = new Error('connection refused');
      const { nc, closeOnItsOwn } = makeFakeConnection();
      closeOnItsOwn(gaveUp);
      asAny(client).nc = nc;

      await expect(client.disconnect()).rejects.toBe(gaveUp);

      expect(nc.drain).not.toHaveBeenCalled();
      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
    });

    it('rejects with the driver\'s closed-connection error for a connection closed without an error', async () => {
      const { nc } = makeFakeConnection();
      await nc.close();
      asAny(client).nc = nc;

      await expect(client.disconnect()).rejects.toBeInstanceOf(errors.ClosedConnectionError);

      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
    });

    it('settles when the driver closes the connection itself while the drain is pending', async () => {
      // nats-core gives up after `maxReconnectAttempts` and closes, but never settles the drain's
      // pending flush: only a new reconnect attempt would have rejected it.
      const gaveUp = new Error('connection refused');
      const { nc, closeOnItsOwn } = makeFakeConnection({ drain: neverSettles });
      asAny(client).nc = nc;

      const first = client.disconnect();
      const second = client.disconnect();
      await flushReactions();
      expect(Bun.peek.status(first)).toBe('pending');

      closeOnItsOwn(gaveUp);

      expect(await Promise.allSettled([first, second])).toEqual([
        { status: 'rejected', reason: gaveUp },
        { status: 'rejected', reason: gaveUp },
      ]);
      expect(nc.drain).toHaveBeenCalledTimes(1);
      expect(client.getConnection()).toBeNull();
      expect(client.isConnected()).toBe(false);
      expect(asAny(client).disconnecting).toBeNull();
      await expect(client.disconnect()).resolves.toBeUndefined();
    });

    it('is a no-op after a disconnect whose drain rejected', async () => {
      const { nc } = makeFakeConnection({ drain: () => Promise.reject(new Error('connection disconnected')) });
      asAny(client).nc = nc;
      await client.disconnect().catch(() => undefined);

      await expect(client.disconnect()).resolves.toBeUndefined();

      expect(nc.drain).toHaveBeenCalledTimes(1);
      expect(nc.close).toHaveBeenCalledTimes(1);
    });

    it('lets a concurrent call share the drain in flight and resolve with it on a healthy connection', async () => {
      // A second drain of its own is refused ("connection draining"), and closing on that refusal
      // would pull the socket out from under the first call's flush, which the driver then never
      // settles.
      const gate = makeDeferred();
      const { nc } = makeFakeConnection({ drain: () => gate.promise });
      asAny(client).nc = nc;

      const first = client.disconnect();
      const second = client.disconnect();
      await flushReactions();

      expect(Bun.peek.status(second)).toBe('pending');
      expect(nc.close).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(true);

      gate.resolve();
      expect(await Promise.allSettled([first, second])).toEqual([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);

      expect(nc.drain).toHaveBeenCalledTimes(1);
      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(client.getConnection()).toBeNull();
    });

    it('gives concurrent callers the same drain error', async () => {
      const drainError = new Error('connection disconnected');
      const { nc } = makeFakeConnection({ drain: () => Promise.reject(drainError) });
      asAny(client).nc = nc;

      const outcomes = await Promise.allSettled([client.disconnect(), client.disconnect()]);

      expect(outcomes).toEqual([
        { status: 'rejected', reason: drainError },
        { status: 'rejected', reason: drainError },
      ]);
      expect(nc.close).toHaveBeenCalledTimes(1);
      expect(client.getConnection()).toBeNull();
    });

    it('connects again after a rejected disconnect, and disconnects the new connection', async () => {
      // `connect()` for real, through the driver, against an in-process stand-in. A disconnect
      // left in flight would make `connect()` a no-op, and a stale shared disconnect would hand
      // the second call the first one's rejection without touching the new connection.
      await withFakeServer(async (servers) => {
        const cycled = new NatsClient({ servers });
        await cycled.connect();
        const first = cycled.getConnection();
        const drainError = new Error('connection disconnected');
        first.drain = mock(() => Promise.reject(drainError));

        await expect(cycled.disconnect()).rejects.toBe(drainError);
        expect(first.isClosed()).toBe(true);
        expect(cycled.getConnection()).toBeNull();

        await cycled.connect();
        const second = cycled.getConnection();
        expect(second).not.toBe(first);
        expect(cycled.isConnected()).toBe(true);

        await expect(cycled.disconnect()).resolves.toBeUndefined();
        expect(second.isClosed()).toBe(true);
        expect(cycled.getConnection()).toBeNull();
        expect(cycled.isConnected()).toBe(false);
      });
    });
  });

  describe('error handling', () => {
    it('should throw when publishing without connecting', async () => {
      await expect(client.publish('test', 'data')).rejects.toThrow('Not connected to NATS');
    });

    it('throws a QueuePublishError "unavailable" for a publish without a connection', async () => {
      const thrown = await client.publish('orders.created', 'data').catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(QueuePublishError);
      expect((thrown as QueuePublishError).reason).toBe('unavailable');
      expect((thrown as QueuePublishError).pattern).toBe('orders.created');
    });

    it('throws a QueuePublishError "rejected" with the driver\'s error when the payload exceeds max_payload', async () => {
      await withFakeServer(async (servers) => {
        const real = new NatsClient({ servers });
        await real.connect();

        try {
          // The fake server announces max_payload 1 MiB, as nats-server does by default.
          const thrown = await real.publish('orders.created', 'x'.repeat(1_100_000)).catch((error: unknown) => error);

          expect(thrown).toBeInstanceOf(QueuePublishError);
          const error = thrown as QueuePublishError;
          expect(error.reason).toBe('rejected');
          expect(error.cause).toBeInstanceOf(errors.InvalidArgumentError);
          expect(error.message).toContain('max_payload');
        } finally {
          await real.disconnect();
        }
      });
    });

    it('throws a QueuePublishError "rejected" for a header the driver refuses, and sends nothing', async () => {
      const publish = mock(() => undefined);
      asAny(client).nc = { publish };

      // Header names as an application writes them, which are not identifiers.
      const badName = await client.publish('orders.created', 'data', Object.fromEntries([['bad name', 'x']]))
        .catch((error: unknown) => error);
      const badValue = await client.publish('orders.created', 'data', Object.fromEntries([['X-Ok', 'a\r\nb']]))
        .catch((error: unknown) => error);

      for (const thrown of [badName, badValue]) {
        expect(thrown).toBeInstanceOf(QueuePublishError);
        expect((thrown as QueuePublishError).reason).toBe('rejected');
        expect((thrown as Error).cause).toBeInstanceOf(errors.InvalidArgumentError);
      }
      expect(publish).not.toHaveBeenCalled();
      asAny(client).nc = null;
    });

    it('throws a QueuePublishError "unavailable" with the driver\'s error once the connection is closed', async () => {
      await withFakeServer(async (servers) => {
        const real = new NatsClient({ servers });
        await real.connect();
        // What the driver leaves behind once it gives up reconnecting: a closed connection.
        await real.getConnection().close();

        const thrown = await real.publish('orders.created', 'data').catch((error: unknown) => error);

        expect(thrown).toBeInstanceOf(QueuePublishError);
        const error = thrown as QueuePublishError;
        expect(error.reason).toBe('unavailable');
        expect(error.cause).toBeInstanceOf(errors.ClosedConnectionError);
        await real.disconnect().catch(() => undefined);
      });
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

  /**
   * Driven with the driver's own `headers()` object rather than a stand-in, because the defect
   * this guards against was a method the real object does not have. A plain `Map` passed here
   * would have satisfied `.entries()` and hidden it. The same conversion against messages that
   * crossed a real server is in `nats.adapter.integration.test.ts`.
   */
  describe('toHeaderMap', () => {
    it('keeps every name in the case it was set with', () => {
      const source = headers();
      source.set('X-Probe', 'yes');
      source.set('x-api-key', 'k-1');

      const map = toHeaderMap(source);

      expect([...map.entries()]).toEqual([['X-Probe', ['yes']], ['x-api-key', ['k-1']]]);
      expect(map.has('x-probe')).toBe(false);
      expect(map.has('X-Api-Key')).toBe(false);
    });

    it('keeps every value of a repeated name, in the order it was appended', () => {
      const source = headers();
      source.append('X-Multi', 'a');
      source.append('X-Multi', 'b');

      expect(toHeaderMap(source).get('X-Multi')).toEqual(['a', 'b']);
    });

    it('returns arrays of its own, so changing one does not reach the driver\'s message', () => {
      const source = headers();
      source.append('X-Multi', 'a');

      toHeaderMap(source).get('X-Multi')!.push('added-by-a-callback');

      expect(source.values('X-Multi')).toEqual(['a']);
    });

    it('returns an empty map for headers that carry no names', () => {
      expect(toHeaderMap(headers()).size).toBe(0);
    });
  });
});
