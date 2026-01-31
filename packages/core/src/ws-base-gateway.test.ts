/**
 * Unit tests for ws-base-gateway.ts
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
} from 'bun:test';

import type { WsClientData } from './ws.types';

import { BaseWebSocketGateway, _resetClientSocketsForTesting } from './ws-base-gateway';
import { InMemoryWsStorage } from './ws-storage-memory';

// Mock WebSocket
interface MockWebSocket {
  data: WsClientData;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  subscribe: ReturnType<typeof mock>;
  unsubscribe: ReturnType<typeof mock>;
}

function createMockSocket(clientData: WsClientData): MockWebSocket {
  return {
    data: clientData,
    send: mock(() => undefined),
    close: mock(() => undefined),
    subscribe: mock(() => undefined),
    unsubscribe: mock(() => undefined),
  };
}

function createClientData(id: string, rooms: string[] = []): WsClientData {
  return {
    id,
    rooms,
    connectedAt: Date.now(),
    auth: null,
    metadata: {},
  };
}

// Concrete implementation for testing
class TestGateway extends BaseWebSocketGateway {
  // Expose internal methods for testing
  public exposeRegisterSocket(clientId: string, socket: MockWebSocket): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._registerSocket(clientId, socket);
  }

  public exposeUnregisterSocket(clientId: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._unregisterSocket(clientId);
  }

  public exposeInitialize(storage: InMemoryWsStorage, server: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._initialize(storage, server);
  }

  public exposeGetSocket(clientId: string): MockWebSocket | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).getSocket(clientId);
  }
}

describe('BaseWebSocketGateway', () => {
  let gateway: TestGateway;
  let storage: InMemoryWsStorage;

  beforeEach(() => {
    _resetClientSocketsForTesting();
    gateway = new TestGateway();
    storage = new InMemoryWsStorage();
    gateway.exposeInitialize(storage, {});
  });

  describe('socket registration', () => {
    it('should register a socket', () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);

      expect(gateway.exposeGetSocket('client1')).toBe(socket);
    });

    it('should unregister a socket', () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      gateway.exposeUnregisterSocket('client1');

      expect(gateway.exposeGetSocket('client1')).toBeUndefined();
    });
  });

  describe('clients getter', () => {
    it('should return empty map when no clients', () => {
      expect(gateway.clients.size).toBe(0);
    });

    it('should return map of connected clients', () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');

      gateway.exposeRegisterSocket('client1', createMockSocket(client1));
      gateway.exposeRegisterSocket('client2', createMockSocket(client2));

      expect(gateway.clients.size).toBe(2);
      expect(gateway.clients.get('client1')).toEqual(client1);
      expect(gateway.clients.get('client2')).toEqual(client2);
    });
  });

  describe('getClient', () => {
    it('should return undefined when storage not initialized', async () => {
      const uninitializedGateway = new TestGateway();
      const result = await uninitializedGateway.getClient('client1');
      expect(result).toBeUndefined();
    });

    it('should return client from storage', async () => {
      const clientData = createClientData('client1');
      await storage.addClient(clientData);

      const result = await gateway.getClient('client1');
      expect(result).toEqual(clientData);
    });

    it('should return undefined for non-existent client', async () => {
      const result = await gateway.getClient('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getRoom', () => {
    it('should return undefined when storage not initialized', async () => {
      const uninitializedGateway = new TestGateway();
      const result = await uninitializedGateway.getRoom('room1');
      expect(result).toBeUndefined();
    });

    it('should return room from storage', async () => {
      // Rooms are created automatically when a client joins
      const client = createClientData('client1');
      await storage.addClient(client);
      await storage.addClientToRoom('client1', 'room1');

      const result = await gateway.getRoom('room1');
      expect(result?.name).toBe('room1');
    });

    it('should return undefined for non-existent room', async () => {
      const result = await gateway.getRoom('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('getClientsByRoom', () => {
    it('should return empty array when storage not initialized', async () => {
      const uninitializedGateway = new TestGateway();
      const result = await uninitializedGateway.getClientsByRoom('room1');
      expect(result).toEqual([]);
    });

    it('should return clients in room', async () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');

      await storage.addClient(client1);
      await storage.addClient(client2);
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client2', 'room1');

      const result = await gateway.getClientsByRoom('room1');
      expect(result.length).toBe(2);
      expect(result.map(c => c.id).sort()).toEqual(['client1', 'client2']);
    });
  });

  describe('emit', () => {
    it('should send message to specific client', () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      gateway.emit('client1', 'test:event', { foo: 'bar' });

      expect(socket.send).toHaveBeenCalledTimes(1);
      const sentMessage = JSON.parse(socket.send.mock.calls[0][0]);
      expect(sentMessage).toEqual({ event: 'test:event', data: { foo: 'bar' } });
    });

    it('should not throw for non-existent client', () => {
      expect(() => gateway.emit('nonexistent', 'test:event', {})).not.toThrow();
    });
  });

  describe('broadcast', () => {
    it('should send message to all clients', () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);
      gateway.broadcast('test:event', { message: 'hello' });

      expect(socket1.send).toHaveBeenCalledTimes(1);
      expect(socket2.send).toHaveBeenCalledTimes(1);

      const sent1 = JSON.parse(socket1.send.mock.calls[0][0]);
      const sent2 = JSON.parse(socket2.send.mock.calls[0][0]);
      expect(sent1).toEqual({ event: 'test:event', data: { message: 'hello' } });
      expect(sent2).toEqual({ event: 'test:event', data: { message: 'hello' } });
    });

    it('should exclude specified clients', () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);
      gateway.broadcast('test:event', { message: 'hello' }, ['client1']);

      expect(socket1.send).not.toHaveBeenCalled();
      expect(socket2.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitToRoom', () => {
    it('should send message to clients in room', async () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const client3 = createClientData('client3');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);
      const socket3 = createMockSocket(client3);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);
      gateway.exposeRegisterSocket('client3', socket3);

      await storage.addClient(client1);
      await storage.addClient(client2);
      await storage.addClient(client3);
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client2', 'room1');
      // client3 is not in room1

      gateway.emitToRoom('room1', 'room:message', { text: 'hi' });

      // Need a small delay for async operation
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(socket1.send).toHaveBeenCalled();
      expect(socket2.send).toHaveBeenCalled();
      expect(socket3.send).not.toHaveBeenCalled();
    });

    it('should exclude specified clients in room', async () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);

      await storage.addClient(client1);
      await storage.addClient(client2);
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client2', 'room1');

      gateway.emitToRoom('room1', 'room:message', { text: 'hi' }, ['client1']);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(socket1.send).not.toHaveBeenCalled();
      expect(socket2.send).toHaveBeenCalled();
    });
  });

  describe('emitToRooms', () => {
    it('should send to clients in multiple rooms without duplicates', async () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);

      await storage.addClient(client1);
      await storage.addClient(client2);
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client1', 'room2'); // client1 in both rooms
      await storage.addClientToRoom('client2', 'room2');

      await gateway.emitToRooms(['room1', 'room2'], 'multi:message', { data: 'test' });

      // client1 should receive only once even though in both rooms
      expect(socket1.send).toHaveBeenCalledTimes(1);
      expect(socket2.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnectClient', () => {
    it('should close client socket', () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      gateway.disconnectClient('client1', 'test reason');

      expect(socket.close).toHaveBeenCalledWith(1000, 'test reason');
    });

    it('should use default reason if not provided', () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      gateway.disconnectClient('client1');

      expect(socket.close).toHaveBeenCalledWith(1000, 'Disconnected by server');
    });

    it('should not throw for non-existent client', () => {
      expect(() => gateway.disconnectClient('nonexistent')).not.toThrow();
    });
  });

  describe('disconnectAll', () => {
    it('should close all client sockets', () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);
      gateway.disconnectAll('server shutdown');

      expect(socket1.close).toHaveBeenCalledWith(1000, 'server shutdown');
      expect(socket2.close).toHaveBeenCalledWith(1000, 'server shutdown');
    });
  });

  describe('disconnectRoom', () => {
    it('should disconnect all clients in room', async () => {
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const socket1 = createMockSocket(client1);
      const socket2 = createMockSocket(client2);

      gateway.exposeRegisterSocket('client1', socket1);
      gateway.exposeRegisterSocket('client2', socket2);

      await storage.addClient(client1);
      await storage.addClient(client2);
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client2', 'room1');

      await gateway.disconnectRoom('room1', 'room closed');

      expect(socket1.close).toHaveBeenCalledWith(1000, 'room closed');
      expect(socket2.close).toHaveBeenCalledWith(1000, 'room closed');
    });
  });

  describe('joinRoom', () => {
    it('should add client to room in storage', async () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      await storage.addClient(clientData);

      await gateway.joinRoom('client1', 'room1');

      const room = await storage.getRoom('room1');
      expect(room?.clientIds).toContain('client1');
    });

    it('should subscribe socket to room topic', async () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      await storage.addClient(clientData);

      await gateway.joinRoom('client1', 'room1');

      expect(socket.subscribe).toHaveBeenCalledWith('room1');
    });
  });

  describe('leaveRoom', () => {
    it('should remove client from room in storage', async () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      await storage.addClient(clientData);
      await storage.addClientToRoom('client1', 'room1');

      await gateway.leaveRoom('client1', 'room1');

      const clientsInRoom = await storage.getClientsInRoom('room1');
      expect(clientsInRoom).not.toContain('client1');
    });

    it('should unsubscribe socket from room topic', async () => {
      const clientData = createClientData('client1');
      const socket = createMockSocket(clientData);

      gateway.exposeRegisterSocket('client1', socket);
      await storage.addClient(clientData);
      await storage.addClientToRoom('client1', 'room1');

      await gateway.leaveRoom('client1', 'room1');

      expect(socket.unsubscribe).toHaveBeenCalledWith('room1');
    });
  });

  describe('getRoomsByPattern', () => {
    it('should return empty array when storage not initialized', async () => {
      const uninitializedGateway = new TestGateway();
      const result = await uninitializedGateway.getRoomsByPattern('room:*');
      expect(result).toEqual([]);
    });

    it('should return rooms matching pattern', async () => {
      // Create rooms by adding clients to them
      const client1 = createClientData('client1');
      const client2 = createClientData('client2');
      const client3 = createClientData('client3');
      await storage.addClient(client1);
      await storage.addClient(client2);
      await storage.addClient(client3);
      await storage.addClientToRoom('client1', 'room:general');
      await storage.addClientToRoom('client2', 'room:private');
      await storage.addClientToRoom('client3', 'other:room');

      const result = await gateway.getRoomsByPattern('room:*');
      expect(result.length).toBe(2);
      expect(result.map(r => r.name).sort()).toEqual(['room:general', 'room:private']);
    });
  });

  describe('getWsServer', () => {
    it('should return null when server not initialized', () => {
      const uninitializedGateway = new TestGateway();
      expect(uninitializedGateway.getWsServer()).toBeNull();
    });

    it('should return server wrapper with publish method', () => {
      const mockServer = {
        publish: mock(() => undefined),
      };
      gateway.exposeInitialize(storage, mockServer);

      const wsServer = gateway.getWsServer();
      expect(wsServer).not.toBeNull();
      expect(typeof wsServer?.publish).toBe('function');
    });
  });
});
