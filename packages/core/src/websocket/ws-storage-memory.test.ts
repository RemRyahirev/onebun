/**
 * In-Memory WebSocket Storage Tests
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'bun:test';

import type { WsClientData, WsRoom } from './ws.types';

import { InMemoryWsStorage } from './ws-storage-memory';

describe('InMemoryWsStorage', () => {
  let storage: InMemoryWsStorage;

  beforeEach(async () => {
    storage = new InMemoryWsStorage();
    await storage.clear();
  });

  describe('client operations', () => {
    const createClient = (id: string): WsClientData => ({
      id,
      rooms: [],
      connectedAt: Date.now(),
      auth: null,
      metadata: {},
      protocol: 'native',
    });

    it('should add and retrieve a client', async () => {
      const client = createClient('client1');
      await storage.addClient(client);

      const retrieved = await storage.getClient('client1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('client1');
    });

    it('should return null for non-existent client', async () => {
      const result = await storage.getClient('non-existent');
      expect(result).toBeNull();
    });

    it('should update client data', async () => {
      const client = createClient('client1');
      await storage.addClient(client);

      await storage.updateClient('client1', { metadata: { custom: 'value' } });

      const updated = await storage.getClient('client1');
      expect(updated?.metadata).toEqual({ custom: 'value' });
    });

    it('should remove a client', async () => {
      const client = createClient('client1');
      await storage.addClient(client);

      await storage.removeClient('client1');

      const result = await storage.getClient('client1');
      expect(result).toBeNull();
    });

    it('should get all clients', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClient(createClient('client2'));

      const clients = await storage.getAllClients();
      expect(clients).toHaveLength(2);
    });

    it('should get client count', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClient(createClient('client2'));

      const count = await storage.getClientCount();
      expect(count).toBe(2);
    });
  });

  describe('room operations', () => {
    it('should create and retrieve a room', async () => {
      const room: WsRoom = { name: 'test-room', clientIds: [] };
      await storage.createRoom(room);

      const retrieved = await storage.getRoom('test-room');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('test-room');
    });

    it('should delete a room', async () => {
      const room: WsRoom = { name: 'test-room', clientIds: [] };
      await storage.createRoom(room);

      await storage.deleteRoom('test-room');

      const result = await storage.getRoom('test-room');
      expect(result).toBeNull();
    });

    it('should get all rooms', async () => {
      await storage.createRoom({ name: 'room1', clientIds: [] });
      await storage.createRoom({ name: 'room2', clientIds: [] });

      const rooms = await storage.getAllRooms();
      expect(rooms).toHaveLength(2);
    });

    it('should get rooms by pattern', async () => {
      await storage.createRoom({ name: 'chat:general', clientIds: [] });
      await storage.createRoom({ name: 'chat:private', clientIds: [] });
      await storage.createRoom({ name: 'game:lobby', clientIds: [] });

      const chatRooms = await storage.getRoomsByPattern('chat:*');
      expect(chatRooms).toHaveLength(2);
    });

    it('should update room metadata', async () => {
      await storage.createRoom({ name: 'test-room', clientIds: [] });

      await storage.updateRoomMetadata('test-room', { topic: 'General Discussion' });

      const room = await storage.getRoom('test-room');
      expect(room?.metadata).toEqual({ topic: 'General Discussion' });
    });
  });

  describe('room membership', () => {
    const createClient = (id: string): WsClientData => ({
      id,
      rooms: [],
      connectedAt: Date.now(),
      auth: null,
      metadata: {},
      protocol: 'native',
    });

    it('should add client to room', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'test-room');

      const clientIds = await storage.getClientsInRoom('test-room');
      expect(clientIds).toContain('client1');
    });

    it('should create room automatically when adding client', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'auto-room');

      const room = await storage.getRoom('auto-room');
      expect(room).not.toBeNull();
    });

    it('should update client rooms list', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client1', 'room2');

      const client = await storage.getClient('client1');
      expect(client?.rooms).toContain('room1');
      expect(client?.rooms).toContain('room2');
    });

    it('should remove client from room', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'test-room');

      await storage.removeClientFromRoom('client1', 'test-room');

      const clientIds = await storage.getClientsInRoom('test-room');
      expect(clientIds).not.toContain('client1');
    });

    it('should delete empty room after client leaves', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'temp-room');

      await storage.removeClientFromRoom('client1', 'temp-room');

      const room = await storage.getRoom('temp-room');
      expect(room).toBeNull();
    });

    it('should get rooms for a client', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client1', 'room2');

      const rooms = await storage.getRoomsForClient('client1');
      expect(rooms).toHaveLength(2);
      expect(rooms).toContain('room1');
      expect(rooms).toContain('room2');
    });

    it('should remove client from all rooms', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client1', 'room2');

      await storage.removeClientFromAllRooms('client1');

      const rooms = await storage.getRoomsForClient('client1');
      expect(rooms).toHaveLength(0);
    });

    it('should remove client from all rooms when client is removed', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClient(createClient('client2'));
      await storage.addClientToRoom('client1', 'shared-room');
      await storage.addClientToRoom('client2', 'shared-room');

      await storage.removeClient('client1');

      const clientIds = await storage.getClientsInRoom('shared-room');
      expect(clientIds).not.toContain('client1');
      expect(clientIds).toContain('client2');
    });
  });

  describe('lifecycle', () => {
    it('should clear all data', async () => {
      const client: WsClientData = {
        id: 'client1',
        rooms: [],
        connectedAt: Date.now(),
        auth: null,
        metadata: {},
        protocol: 'native',
      };
      await storage.addClient(client);
      await storage.createRoom({ name: 'test-room', clientIds: [] });

      await storage.clear();

      expect(await storage.getClientCount()).toBe(0);
      expect(await storage.getAllRooms()).toHaveLength(0);
    });

    it('should return stats', () => {
      const stats = storage.getStats();
      expect(stats).toHaveProperty('clientCount');
      expect(stats).toHaveProperty('roomCount');
    });
  });
});
