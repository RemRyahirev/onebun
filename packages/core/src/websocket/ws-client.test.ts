/**
 * Unit tests for ws-client.ts
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';

import type { WsServiceDefinition } from './ws-service-definition';

import { useFakeTimers } from '../testing/test-utils';

import { createWsClient as createWsClientRaw, createNativeWsClient as createNativeWsClientRaw } from './ws-client';
import { WsConnectionState } from './ws-client.types';
import { WsHandlerType } from './ws.types';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  
  readyState = 1; // OPEN
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  
  sentMessages: string[] = [];
  
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Simulate async open
    setTimeout(() => {
      this.onopen?.(new Event('open'));
    }, 0);
  }
  
  send(data: string): void {
    this.sentMessages.push(data);
  }
  
  close(code?: number, reason?: string): void {
    // CLOSED. Without this the state never moves off OPEN and `afterEach` cannot tell a
    // socket the test finished with from one it abandoned.
    this.readyState = 3;
    this.onclose?.(new CloseEvent('close', { code: code || 1000, reason: reason || '' }));
  }
  
  // Simulate receiving a message
  receiveMessage(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
  
  // Simulate error
  triggerError(): void {
    this.onerror?.(new Event('error'));
  }
  
  static reset(): void {
    MockWebSocket.instances = [];
  }
  
  static getLastInstance(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// Mock service definition
function createMockDefinition(): WsServiceDefinition {
  return {
    _module: class TestModule {},
    _endpoints: [],
    _gateways: new Map([
      ['TestGateway', {
        name: 'TestGateway',
        path: '/ws',
        namespace: undefined,
        events: new Map([
          ['test:event', { 
            gateway: 'TestGateway',
            event: 'test:event', 
            handler: 'handleTestEvent',
            type: WsHandlerType.MESSAGE,
          }],
          ['chat:*', { 
            gateway: 'TestGateway',
            event: 'chat:*', 
            handler: 'handleChat',
            type: WsHandlerType.MESSAGE,
          }],
        ]),
      }],
    ]),
  };
}

/** Anything this file needs to be able to shut down again. */
interface DisconnectableClient {
  disconnect(): void;
}

/**
 * Every client created by a test, so `afterEach` can shut all of them down.
 *
 * A client left connected is not inert: `WsClient` defaults to `reconnect: true` with a
 * 1000 ms interval, so any close schedules a reconnect that outlives the test. It then
 * constructs a MockWebSocket AFTER the next test's `MockWebSocket.reset()`, and
 * `getLastInstance()` — which every delivery site here uses — hands that stale client's
 * socket to a test asserting on its own. Two different symptoms came out of that: a handler
 * never called, and `sentMessages` empty after a `send()`. Both were seen only in the full
 * suite, where the run is slow enough for a 1000 ms timer to land inside a 2 ms test.
 */
const liveClients: DisconnectableClient[] = [];

/**
 * `createWsClient`, with `reconnect` off unless the test is about reconnection.
 *
 * Shadows the import so the call sites read unchanged. `...options` comes after the default,
 * so a test that asks for `reconnect: true` still gets it.
 */
function createWsClient(
  ...[definition, options]: Parameters<typeof createWsClientRaw>
): ReturnType<typeof createWsClientRaw> {
  const client = createWsClientRaw(definition, { reconnect: false, ...options });
  liveClients.push(client as DisconnectableClient);

  return client;
}

/** `createNativeWsClient`, same treatment. */
function createNativeWsClient(
  ...[options]: Parameters<typeof createNativeWsClientRaw>
): ReturnType<typeof createNativeWsClientRaw> {
  const client = createNativeWsClientRaw({ reconnect: false, ...options });
  liveClients.push(client as DisconnectableClient);

  return client;
}

/**
 * The socket the client under test is using, or a failure that says so.
 *
 * `MockWebSocket.getLastInstance()` can legitimately return `undefined`, and every call site
 * used to write `ws.receiveMessage(...)`. That optional chain turned "the socket is not the
 * one I think it is" into a silent no-op, so the test failed later on a downstream assertion —
 * `expect(handler).toHaveBeenCalled()` receiving 0 calls — which names the handler and says
 * nothing about the socket. Failing here instead names the actual problem.
 */
function lastSocket(): MockWebSocket {
  const socket = MockWebSocket.getLastInstance();
  if (!socket) {
    throw new Error('no MockWebSocket was constructed — the client under test never connected');
  }

  return socket;
}

describe('WsClient', () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  
  beforeEach(() => {
    MockWebSocket.reset();
    originalWebSocket = globalThis.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.WebSocket = MockWebSocket as any;
  });
  
  afterEach(() => {
    // Disconnect BEFORE the global is restored: a client shut down afterwards would build its
    // next socket from the real WebSocket and open a connection from a finished test file.
    for (const client of liveClients.splice(0)) {
      client.disconnect();
    }

    // The invariant, asserted rather than assumed: nothing this test opened is still open.
    // Without it the next forgotten `disconnect()` is caught only by the flake it causes,
    // three months later, in an unrelated file.
    const stillOpen = MockWebSocket.instances.filter(socket => socket.readyState === 1);
    expect(stillOpen).toHaveLength(0);

    globalThis.WebSocket = originalWebSocket;
    MockWebSocket.reset();
  });

  describe('createWsClient', () => {
    it('should create client with default options', () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });

      expect(client).toBeDefined();
      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');
      expect(typeof client.isConnected).toBe('function');
      expect(typeof client.getState).toBe('function');
    });
  });

  describe('createNativeWsClient', () => {
    it('should create standalone client without definition', () => {
      const client = createNativeWsClient({ url: 'ws://localhost:3000/chat' });

      expect(client).toBeDefined();
      expect(typeof client.connect).toBe('function');
      expect(typeof client.disconnect).toBe('function');
      expect(typeof client.isConnected).toBe('function');
      expect(typeof client.getState).toBe('function');
      expect(typeof client.on).toBe('function');
      expect(typeof client.off).toBe('function');
      expect(typeof client.emit).toBe('function');
      expect(typeof client.send).toBe('function');
    });

    it('should connect and use emit/send/on like typed client', async () => {
      const client = createNativeWsClient({ url: 'ws://localhost:3000/chat' });
      await client.connect();

      const ws = lastSocket();
      expect(ws).toBeDefined();
      expect(client.isConnected()).toBe(true);

      client.on('welcome', (data) => expect(data).toBeDefined());
      ws.receiveMessage(JSON.stringify({ event: 'welcome', data: { msg: 'hi' } }));

      client.send('ping', {});
      expect(ws.sentMessages.some((m) => m.includes('ping'))).toBe(true);

      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect to WebSocket server', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      
      expect(client.isConnected()).toBe(true);
      expect(client.getState()).toBe(WsConnectionState.CONNECTED);
    });

    it('should include auth token in URL', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { 
        url: 'ws://localhost:3000',
        auth: { token: 'test-token' },
      });
      
      await client.connect();
      
      const ws = lastSocket();
      expect(ws.url).toContain('token=test-token');
    });

    it('should include namespace in URL', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { 
        url: 'ws://localhost:3000',
        namespace: 'chat',
      });
      
      await client.connect();
      
      const ws = lastSocket();
      expect(ws.url).toContain('namespace=chat');
    });

    it('should return immediately if already connected', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      const instanceCount = MockWebSocket.instances.length;
      
      await client.connect();
      
      // Should not create a new WebSocket
      expect(MockWebSocket.instances.length).toBe(instanceCount);
    });

    it('should emit connect event', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const connectHandler = mock(() => undefined);
      
      client.on('connect', connectHandler);
      await client.connect();
      
      expect(connectHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from server', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      client.disconnect();
      
      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toBe(WsConnectionState.DISCONNECTED);
    });

    it('should emit disconnect event', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const disconnectHandler = mock(() => undefined);
      
      await client.connect();
      client.on('disconnect', disconnectHandler);
      client.disconnect();
      
      expect(disconnectHandler).toHaveBeenCalled();
    });
  });

  describe('event listeners', () => {
    it('should subscribe to client events', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const handler = mock(() => undefined);
      
      client.on('connect', handler);
      await client.connect();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should unsubscribe specific listener', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const handler = mock(() => undefined);
      
      client.on('connect', handler);
      client.off('connect', handler);
      await client.connect();
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe all listeners for event', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const handler1 = mock(() => undefined);
      const handler2 = mock(() => undefined);
      
      client.on('connect', handler1);
      client.on('connect', handler2);
      client.off('connect');
      await client.connect();
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('gateway access', () => {
    it('should access gateway client through proxy', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway = (client as any).TestGateway;
      expect(gateway).toBeDefined();
      expect(gateway.emit).toBeFunction();
      expect(gateway.send).toBeFunction();
      expect(gateway.on).toBeFunction();
      expect(gateway.off).toBeFunction();
    });

    it('should cache gateway client', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway1 = (client as any).TestGateway;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gateway2 = (client as any).TestGateway;
      
      expect(gateway1).toBe(gateway2);
    });
  });

  describe('message handling', () => {
    it('should handle native format messages', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const handler = mock(() => undefined);
      
      await client.connect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('test:event', handler);
      
      const ws = lastSocket();
      ws.receiveMessage(JSON.stringify({ event: 'test:event', data: { foo: 'bar' } }));
      
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('should match pattern events', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const handler = mock(() => undefined);
      
      await client.connect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('chat:*', handler);
      
      const ws = lastSocket();
      ws.receiveMessage(JSON.stringify({ event: 'chat:general', data: { text: 'hello' } }));
      
      expect(handler).toHaveBeenCalled();
    });

    it('should handle Engine.IO PING packet when using Socket.IO protocol', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, {
        url: 'ws://localhost:3000/socket.io',
        protocol: 'socketio',
      });

      await client.connect();

      const ws = lastSocket();
      if (ws) {
        ws.sentMessages.length = 0;

        // Send PING (Engine.IO packet type 2)
        ws.receiveMessage('2');
      }

      // Should respond with PONG (Engine.IO packet type 3)
      expect(ws.sentMessages).toContain('3');
    });
  });

  describe('send and emit', () => {
    it('should send message without acknowledgement', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      
      const ws = lastSocket();
      if (ws) {
        ws.sentMessages.length = 0;
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).TestGateway.send('test:event', { foo: 'bar' });
        
        expect(ws.sentMessages.length).toBe(1);
        const sent = JSON.parse(ws.sentMessages[0]);
        expect(sent.event).toBe('test:event');
        expect(sent.data).toEqual({ foo: 'bar' });
      }
    });

    it('should throw when sending while disconnected', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => (client as any).TestGateway?.send?.('test:event', {})).toThrow();
    });

    it('should emit message and wait for acknowledgement', async () => {
      const { advanceTime, restore } = useFakeTimers();

      try {
        const definition = createMockDefinition();
        const client = createWsClient(definition, { 
          url: 'ws://localhost:3000',
          timeout: 1000,
        });
        
        // Advance time to trigger MockWebSocket's async open
        const connectPromise = client.connect();
        advanceTime(1);
        await connectPromise;
        
        const ws = lastSocket();
        
        // Start emit (returns promise)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emitPromise = (client as any).TestGateway.emit('test:event', { foo: 'bar' });
        
        // Advance time to process sent message
        advanceTime(10);
        const sent = JSON.parse(ws!.sentMessages[ws!.sentMessages.length - 1]);
        ws.receiveMessage(JSON.stringify({ 
          event: 'ack', 
          data: { result: 'ok' }, 
          ack: sent.ack,
        }));
        
        const result = await emitPromise;
        expect(result).toEqual({ result: 'ok' });
      } finally {
        restore();
      }
    });

    it('should timeout emit if no acknowledgement', async () => {
      const { advanceTime, restore } = useFakeTimers();

      try {
        const definition = createMockDefinition();
        const client = createWsClient(definition, { 
          url: 'ws://localhost:3000',
          timeout: 50, // Short timeout for test
        });
        
        // Advance time to trigger MockWebSocket's async open
        const connectPromise = client.connect();
        advanceTime(1);
        await connectPromise;
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emitPromise = (client as any).TestGateway.emit('test:event', { foo: 'bar' });
        
        // Advance time past the timeout
        advanceTime(100);
        
        await expect(emitPromise).rejects.toThrow('Request timeout');
      } finally {
        restore();
      }
    });
  });

  describe('client lifetime', () => {
    let advanceTime: (ms: number) => void;
    let restore: () => void;

    beforeEach(() => {
      const fakeTimers = useFakeTimers();
      advanceTime = fakeTimers.advanceTime;
      restore = fakeTimers.restore;
    });

    afterEach(() => {
      restore();
    });

    it('does not let one client reconnect socket become another test last instance', async () => {
      // The flake, made deterministic. A client whose socket closes schedules a reconnect;
      // when that timer fires it constructs a MockWebSocket, and `getLastInstance()` — which
      // every delivery site in this file uses — then points at THAT socket rather than at the
      // one belonging to the client under test.
      //
      // In the suite this happened across tests, because the reconnect interval is 1000 ms by
      // default and `MockWebSocket.reset()` runs between them. Here both halves are in one
      // test and the clock is driven by hand, so it is a fact rather than a coincidence.
      const abandoned = createWsClient(createMockDefinition(), {
        url: 'ws://localhost:3000',
        reconnect: true,
        reconnectInterval: 10,
        maxReconnectAttempts: 3,
      });

      const abandonedConnect = abandoned.connect();
      advanceTime(1);
      await abandonedConnect;

      // Its socket drops. A reconnect is now pending on the fake clock.
      lastSocket().close(1006, 'Connection lost');

      // What the teardown does at the end of every test in this file. It must actually stop
      // the client: `disconnect()` used to clear the reconnect timer and then close the
      // socket, and the close re-armed the timer it had just cleared — so a client told to
      // stop came back anyway, and no teardown could have prevented what follows.
      abandoned.disconnect();

      // A second client — the one a test would be asserting on — connects and is the last
      // instance, as its test expects.
      MockWebSocket.reset();
      const underTest = createWsClient(createMockDefinition(), {
        url: 'ws://localhost:3000',
        reconnect: false,
      });
      const underTestConnect = underTest.connect();
      advanceTime(1);
      await underTestConnect;

      const ownSocket = lastSocket();
      expect(ownSocket.url).toContain('localhost:3000');

      // Time passes well beyond the abandoned client's reconnect interval. Nothing of its
      // may be constructed: this is what used to steal `getLastInstance()` from the test that
      // came after, and what produced two different symptoms in the full suite — a handler
      // never called, and `sentMessages` empty after a `send()`.
      advanceTime(50);

      expect(MockWebSocket.getLastInstance()).toBe(ownSocket);
    });

    it('leaves nothing connected once a test has finished with its clients', async () => {
      // The other half of the same guarantee, and the one `afterEach` asserts for every test
      // in this file: a client that is disconnected constructs nothing later.
      const client = createWsClient(createMockDefinition(), {
        url: 'ws://localhost:3000',
        reconnect: true,
        reconnectInterval: 10,
      });

      const connecting = client.connect();
      advanceTime(1);
      await connecting;

      client.disconnect();
      const constructedAtDisconnect = MockWebSocket.instances.length;

      advanceTime(1000);

      expect(MockWebSocket.instances).toHaveLength(constructedAtDisconnect);
      expect(MockWebSocket.instances.filter(socket => socket.readyState === 1)).toHaveLength(0);
    });
  });

  describe('reconnection', () => {
    let advanceTime: (ms: number) => void;
    let restore: () => void;

    beforeEach(() => {
      const fakeTimers = useFakeTimers();
      advanceTime = fakeTimers.advanceTime;
      restore = fakeTimers.restore;
    });

    afterEach(() => {
      restore();
    });

    it('should attempt reconnection on disconnect', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { 
        url: 'ws://localhost:3000',
        reconnect: true,
        reconnectInterval: 10,
        maxReconnectAttempts: 3,
      });
      const reconnectAttemptHandler = mock(() => undefined);
      
      // Advance time to trigger MockWebSocket's async open
      const connectPromise = client.connect();
      advanceTime(1);
      await connectPromise;
      
      client.on('reconnect_attempt', reconnectAttemptHandler);
      
      // Simulate server disconnect
      const ws = lastSocket();
      ws.close(1006, 'Connection lost');
      
      // Advance time for reconnect attempt
      advanceTime(50);
      
      expect(reconnectAttemptHandler).toHaveBeenCalled();
    });

    it('should track reconnect attempts', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { 
        url: 'ws://localhost:3000',
        reconnect: true,
        reconnectInterval: 10,
        maxReconnectAttempts: 3,
      });
      let reconnectAttemptCount = 0;
      
      // Advance time to trigger MockWebSocket's async open
      const connectPromise = client.connect();
      advanceTime(1);
      await connectPromise;
      
      client.on('reconnect_attempt', (attempt) => {
        reconnectAttemptCount = attempt;
      });
      
      // Simulate initial disconnect
      const ws = lastSocket();
      ws.close(1006, 'Connection lost');
      
      // Advance time for first reconnect attempt
      advanceTime(50);
      
      expect(reconnectAttemptCount).toBeGreaterThanOrEqual(1);
    });

    it('should not reconnect if reconnect is disabled', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { 
        url: 'ws://localhost:3000',
        reconnect: false,
      });
      const reconnectAttemptHandler = mock(() => undefined);
      
      // Advance time to trigger MockWebSocket's async open
      const connectPromise = client.connect();
      advanceTime(1);
      await connectPromise;
      
      client.on('reconnect_attempt', reconnectAttemptHandler);
      
      // Simulate disconnect
      const ws = lastSocket();
      ws.close(1006, 'Connection lost');
      
      advanceTime(50);
      
      // Main assertion: reconnect handler should not be called when reconnect is disabled
      expect(reconnectAttemptHandler).not.toHaveBeenCalled();
      // Note: We don't check MockWebSocket.instances.length here because it's a static array
      // that can be affected by parallel test runs. The handler check is sufficient.
    });
  });

  describe('connection state', () => {
    it('should track connection state', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      expect(client.getState()).toBe(WsConnectionState.DISCONNECTED);
      
      const connectPromise = client.connect();
      // State changes to CONNECTING synchronously
      
      await connectPromise;
      expect(client.getState()).toBe(WsConnectionState.CONNECTED);
      
      client.disconnect();
      expect(client.getState()).toBe(WsConnectionState.DISCONNECTED);
    });
  });

  describe('error handling', () => {
    it('should emit error event on WebSocket error', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const errorHandler = mock(() => undefined);
      
      await client.connect();
      client.on('error', errorHandler);
      
      const ws = lastSocket();
      ws.triggerError();
      
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});
