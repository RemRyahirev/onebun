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

import { createWsClient, createNativeWsClient } from './ws-client';
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

describe('WsClient', () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  
  beforeEach(() => {
    MockWebSocket.reset();
    originalWebSocket = globalThis.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.WebSocket = MockWebSocket as any;
  });
  
  afterEach(() => {
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

      const ws = MockWebSocket.getLastInstance();
      expect(ws).toBeDefined();
      expect(client.isConnected()).toBe(true);

      client.on('welcome', (data) => expect(data).toBeDefined());
      ws?.receiveMessage(JSON.stringify({ event: 'welcome', data: { msg: 'hi' } }));

      client.send('ping', {});
      expect(ws?.sentMessages.some((m) => m.includes('ping'))).toBe(true);

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
      
      const ws = MockWebSocket.getLastInstance();
      expect(ws?.url).toContain('token=test-token');
    });

    it('should include namespace in URL', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { 
        url: 'ws://localhost:3000',
        namespace: 'chat',
      });
      
      await client.connect();
      
      const ws = MockWebSocket.getLastInstance();
      expect(ws?.url).toContain('namespace=chat');
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
      
      const ws = MockWebSocket.getLastInstance();
      ws?.receiveMessage(JSON.stringify({ event: 'test:event', data: { foo: 'bar' } }));
      
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('should match pattern events', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      const handler = mock(() => undefined);
      
      await client.connect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).TestGateway.on('chat:*', handler);
      
      const ws = MockWebSocket.getLastInstance();
      ws?.receiveMessage(JSON.stringify({ event: 'chat:general', data: { text: 'hello' } }));
      
      expect(handler).toHaveBeenCalled();
    });

    it('should handle Engine.IO PING packet when using Socket.IO protocol', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, {
        url: 'ws://localhost:3000/socket.io',
        protocol: 'socketio',
      });

      await client.connect();

      const ws = MockWebSocket.getLastInstance();
      if (ws) {
        ws.sentMessages.length = 0;

        // Send PING (Engine.IO packet type 2)
        ws.receiveMessage('2');
      }

      // Should respond with PONG (Engine.IO packet type 3)
      expect(ws?.sentMessages).toContain('3');
    });
  });

  describe('send and emit', () => {
    it('should send message without acknowledgement', async () => {
      const definition = createMockDefinition();
      const client = createWsClient(definition, { url: 'ws://localhost:3000' });
      
      await client.connect();
      
      const ws = MockWebSocket.getLastInstance();
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
        
        const ws = MockWebSocket.getLastInstance();
        
        // Start emit (returns promise)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const emitPromise = (client as any).TestGateway.emit('test:event', { foo: 'bar' });
        
        // Advance time to process sent message
        advanceTime(10);
        const sent = JSON.parse(ws!.sentMessages[ws!.sentMessages.length - 1]);
        ws?.receiveMessage(JSON.stringify({ 
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
      const ws = MockWebSocket.getLastInstance();
      ws?.close(1006, 'Connection lost');
      
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
      const ws = MockWebSocket.getLastInstance();
      ws?.close(1006, 'Connection lost');
      
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
      const ws = MockWebSocket.getLastInstance();
      ws?.close(1006, 'Connection lost');
      
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
      
      const ws = MockWebSocket.getLastInstance();
      ws?.triggerError();
      
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});
