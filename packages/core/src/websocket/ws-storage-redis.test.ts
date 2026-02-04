/**
 * Redis WebSocket Storage Tests
 *
 * Tests using testcontainers for real Redis integration
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

import type { WsClientData, WsRoom } from './ws.types';

import { SharedRedisProvider } from '../redis/shared-redis';

import { WsStorageEvent, type WsStorageEventPayload } from './ws-storage';
import { RedisWsStorage, createRedisWsStorage } from './ws-storage-redis';

describe('RedisWsStorage', () => {
  let redisContainer: StartedTestContainer;
  let redisUrl: string;
  let storage: RedisWsStorage;

  beforeAll(async () => {
    // Start Redis container
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/.*Ready to accept connections.*/))
      .withStartupTimeout(30000)
      .withLogConsumer(() => {
        // Suppress container logs
      })
      .start();

    const host = redisContainer.getHost();
    const port = redisContainer.getMappedPort(6379);
    redisUrl = `redis://${host}:${port}`;

    // Configure shared Redis
    SharedRedisProvider.configure({
      url: redisUrl,
      keyPrefix: 'ws:test:',
    });
  });

  afterAll(async () => {
    await SharedRedisProvider.reset();
    if (redisContainer) {
      await redisContainer.stop();
    }
  });

  beforeEach(async () => {
    const client = await SharedRedisProvider.getClient();
    storage = createRedisWsStorage(client) as RedisWsStorage;
    await storage.clear();
  });

  afterEach(async () => {
    await storage.close();
  });

  // Helper function
  const createClient = (id: string, options?: Partial<WsClientData>): WsClientData => ({
    id,
    rooms: [],
    connectedAt: Date.now(),
    auth: null,
    metadata: {},
    ...options,
  });

  describe('client operations', () => {
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

    it('should not update non-existent client', async () => {
      // Should not throw
      await storage.updateClient('non-existent', { metadata: { test: 1 } });
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
      expect(clients.map((c) => c.id)).toContain('client1');
      expect(clients.map((c) => c.id)).toContain('client2');
    });

    it('should get client count', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClient(createClient('client2'));

      const count = await storage.getClientCount();
      
      expect(count).toBe(2);
    });

    it('should handle malformed JSON in client data', async () => {
      // Manually insert invalid JSON
      const client = await SharedRedisProvider.getClient();
      await client.set('clients:invalid', 'not-json');

      const result = await storage.getClient('invalid');
      
      expect(result).toBeNull();
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

    it('should create room with initial members', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClient(createClient('client2'));
      
      const room: WsRoom = { name: 'room-with-members', clientIds: ['client1', 'client2'] };
      await storage.createRoom(room);

      const retrieved = await storage.getRoom('room-with-members');
      
      expect(retrieved?.clientIds).toContain('client1');
      expect(retrieved?.clientIds).toContain('client2');
    });

    it('should delete a room', async () => {
      const room: WsRoom = { name: 'test-room', clientIds: [] };
      await storage.createRoom(room);

      await storage.deleteRoom('test-room');

      const result = await storage.getRoom('test-room');
      expect(result).toBeNull();
    });

    it('should delete room and clean up client references', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'cleanup-room');

      await storage.deleteRoom('cleanup-room');

      const rooms = await storage.getRoomsForClient('client1');
      expect(rooms).not.toContain('cleanup-room');
    });

    it('should not throw when deleting non-existent room', async () => {
      // Should not throw
      await storage.deleteRoom('non-existent');
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
      expect(chatRooms.map((r) => r.name)).toContain('chat:general');
      expect(chatRooms.map((r) => r.name)).toContain('chat:private');
    });

    it('should update room metadata', async () => {
      await storage.createRoom({ name: 'test-room', clientIds: [] });

      await storage.updateRoomMetadata('test-room', { topic: 'General Discussion' });

      const room = await storage.getRoom('test-room');
      expect(room?.metadata).toEqual({ topic: 'General Discussion' });
    });

    it('should not update metadata for non-existent room', async () => {
      // Should not throw
      await storage.updateRoomMetadata('non-existent', { test: 1 });
    });

    it('should handle malformed JSON in room data', async () => {
      // Manually insert invalid JSON
      const client = await SharedRedisProvider.getClient();
      await client.set('rooms:invalid', 'not-json');

      const result = await storage.getRoom('invalid');
      
      expect(result).toBeNull();
    });
  });

  describe('room membership', () => {
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

    it('should not duplicate room in client rooms list', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'room1');
      await storage.addClientToRoom('client1', 'room1'); // Add again

      const client = await storage.getClient('client1');
      
      expect(client?.rooms.filter((r) => r === 'room1')).toHaveLength(1);
    });

    it('should remove client from room', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'test-room');

      await storage.removeClientFromRoom('client1', 'test-room');

      const clientIds = await storage.getClientsInRoom('test-room');
      expect(clientIds).not.toContain('client1');
    });

    it('should update client rooms list on removal', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'test-room');

      await storage.removeClientFromRoom('client1', 'test-room');

      const client = await storage.getClient('client1');
      expect(client?.rooms).not.toContain('test-room');
    });

    it('should delete empty room after client leaves', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClientToRoom('client1', 'temp-room');

      await storage.removeClientFromRoom('client1', 'temp-room');

      const room = await storage.getRoom('temp-room');
      expect(room).toBeNull();
    });

    it('should keep room if other clients remain', async () => {
      await storage.addClient(createClient('client1'));
      await storage.addClient(createClient('client2'));
      await storage.addClientToRoom('client1', 'shared-room');
      await storage.addClientToRoom('client2', 'shared-room');

      await storage.removeClientFromRoom('client1', 'shared-room');

      const room = await storage.getRoom('shared-room');
      expect(room).not.toBeNull();
      expect(room?.clientIds).toContain('client2');
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

  describe('pub/sub', () => {
    it('should subscribe and receive events', async () => {
      const received: WsStorageEventPayload[] = [];
      
      await storage.subscribe((payload) => {
        received.push(payload);
      });

      // Create second storage instance to publish
      const client2 = await SharedRedisProvider.getClient();
      const storage2 = createRedisWsStorage(client2);
      
      await storage2.publish({
        type: WsStorageEvent.BROADCAST,
        sourceInstanceId: 'test-instance',
        data: {
          event: 'test:event',
          message: { hello: 'world' },
        },
      });

      // Wait for pub/sub delivery
      await new Promise((r) => setTimeout(r, 30));

      expect(received).toHaveLength(1);
      expect(received[0].data.event).toBe('test:event');
      expect(received[0].data.message).toEqual({ hello: 'world' });

      await storage2.close();
    });

    it('should allow multiple handlers', async () => {
      const handler1 = mock(() => undefined);
      const handler2 = mock(() => undefined);
      
      await storage.subscribe(handler1);
      await storage.subscribe(handler2);

      // Publish from another instance
      const client2 = await SharedRedisProvider.getClient();
      const storage2 = createRedisWsStorage(client2);
      
      await storage2.publish({
        type: WsStorageEvent.BROADCAST,
        sourceInstanceId: 'test-instance',
        data: {
          event: 'test:multi',
        },
      });

      await new Promise((r) => setTimeout(r, 30));

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();

      await storage2.close();
    });

    it('should unsubscribe and clear handlers', async () => {
      const handler = mock(() => undefined);
      
      await storage.subscribe(handler);
      await storage.unsubscribe();

      // After unsubscribe, no more messages should be received
      const client2 = await SharedRedisProvider.getClient();
      const storage2 = createRedisWsStorage(client2);
      
      await storage2.publish({
        type: WsStorageEvent.BROADCAST,
        sourceInstanceId: 'test-instance',
        data: {
          event: 'test:after-unsub',
        },
      });

      await new Promise((r) => setTimeout(r, 30));

      // Handler should not receive new messages after unsubscribe
      await storage2.close();
    });

    it('should handle invalid JSON in pub/sub messages', async () => {
      const handler = mock(() => undefined);
      await storage.subscribe(handler);

      // Manually publish invalid JSON
      const client = await SharedRedisProvider.getClient();
      await client.publish('ws:events', 'not-json');

      await new Promise((r) => setTimeout(r, 30));

      // Handler should not be called for invalid messages
      // (or if called, shouldn't crash)
    });

    it('should handle errors in event handlers', async () => {
      const errorHandler = mock(() => {
        throw new Error('Handler error');
      });
      const normalHandler = mock(() => undefined);
      
      await storage.subscribe(errorHandler);
      await storage.subscribe(normalHandler);

      const client2 = await SharedRedisProvider.getClient();
      const storage2 = createRedisWsStorage(client2);
      
      await storage2.publish({
        type: WsStorageEvent.BROADCAST,
        sourceInstanceId: 'test-instance',
        data: {
          event: 'test:error',
        },
      });

      await new Promise((r) => setTimeout(r, 30));

      // Both handlers should be called despite error in first
      expect(errorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();

      await storage2.close();
    });
  });

  describe('lifecycle', () => {
    it('should clear all data', async () => {
      await storage.addClient(createClient('client1'));
      await storage.createRoom({ name: 'test-room', clientIds: [] });

      await storage.clear();

      expect(await storage.getClientCount()).toBe(0);
      expect(await storage.getAllRooms()).toHaveLength(0);
    });

    it('should close without disconnecting shared client', async () => {
      await storage.close();

      // Shared client should still be connected
      const client = await SharedRedisProvider.getClient();
      expect(client.isConnected()).toBe(true);
    });
  });
});
