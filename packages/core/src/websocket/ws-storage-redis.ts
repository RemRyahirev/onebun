/**
 * Redis WebSocket Storage
 *
 * Redis-based implementation of WsStorageAdapter with pub/sub support
 * for multi-instance deployments.
 */

import type { WsPubSubStorageAdapter, WsStorageEventPayload } from './ws-storage';
import type { WsClientData, WsRoom } from './ws.types';
import type { RedisClient } from '../redis/redis-client';

import { isPatternMatch } from './ws-pattern-matcher';


/**
 * Redis key prefixes for WebSocket data
 */
const KEYS = {
  CLIENTS: 'ws:clients:',
  ROOMS: 'ws:rooms:',
  ROOM_MEMBERS: 'ws:room:members:',
  CLIENT_ROOMS: 'ws:client:rooms:',
  PUBSUB_CHANNEL: 'ws:events',
};

/**
 * Redis-based storage for WebSocket clients and rooms
 * with pub/sub support for multi-instance deployments
 */
export class RedisWsStorage implements WsPubSubStorageAdapter {
  private eventHandlers: Array<(payload: WsStorageEventPayload) => void> = [];
  private subscribed = false;

  constructor(private redisClient: RedisClient) {}

  // ============================================================================
  // Client Operations
  // ============================================================================

  async addClient(client: WsClientData): Promise<void> {
    const key = KEYS.CLIENTS + client.id;
    await this.redisClient.set(key, JSON.stringify(client));
  }

  async removeClient(clientId: string): Promise<void> {
    // Remove from all rooms first
    await this.removeClientFromAllRooms(clientId);

    // Remove client data
    await this.redisClient.del(KEYS.CLIENTS + clientId);
  }

  async getClient(clientId: string): Promise<WsClientData | null> {
    const data = await this.redisClient.get(KEYS.CLIENTS + clientId);
    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as WsClientData;
    } catch {
      return null;
    }
  }

  async getAllClients(): Promise<WsClientData[]> {
    const keys = await this.redisClient.keys(KEYS.CLIENTS + '*');
    const clients: WsClientData[] = [];

    for (const key of keys) {
      const clientId = key.replace(KEYS.CLIENTS, '');
      const client = await this.getClient(clientId);
      if (client) {
        clients.push(client);
      }
    }

    return clients;
  }

  async updateClient(clientId: string, data: Partial<WsClientData>): Promise<void> {
    const client = await this.getClient(clientId);
    if (client) {
      const updated = { ...client, ...data };
      await this.redisClient.set(KEYS.CLIENTS + clientId, JSON.stringify(updated));
    }
  }

  async getClientCount(): Promise<number> {
    const keys = await this.redisClient.keys(KEYS.CLIENTS + '*');

    return keys.length;
  }

  // ============================================================================
  // Room Operations
  // ============================================================================

  async createRoom(room: WsRoom): Promise<void> {
    const key = KEYS.ROOMS + room.name;
    await this.redisClient.set(key, JSON.stringify(room));

    // Also store members in a set for efficient queries
    if (room.clientIds.length > 0) {
      await this.redisClient.sadd(KEYS.ROOM_MEMBERS + room.name, ...room.clientIds);
    }
  }

  async deleteRoom(name: string): Promise<void> {
    const room = await this.getRoom(name);
    if (!room) {
      return;
    }

    // Remove room from all clients' room lists
    for (const clientId of room.clientIds) {
      await this.redisClient.srem(KEYS.CLIENT_ROOMS + clientId, name);
    }

    // Delete room data and members set
    await this.redisClient.del(KEYS.ROOMS + name);
    await this.redisClient.del(KEYS.ROOM_MEMBERS + name);
  }

  async getRoom(name: string): Promise<WsRoom | null> {
    const data = await this.redisClient.get(KEYS.ROOMS + name);
    if (!data) {
      return null;
    }

    try {
      const room = JSON.parse(data) as WsRoom;
      // Get current members from set
      room.clientIds = await this.redisClient.smembers(KEYS.ROOM_MEMBERS + name);

      return room;
    } catch {
      return null;
    }
  }

  async getAllRooms(): Promise<WsRoom[]> {
    const keys = await this.redisClient.keys(KEYS.ROOMS + '*');
    const rooms: WsRoom[] = [];

    for (const key of keys) {
      const roomName = key.replace(KEYS.ROOMS, '');
      const room = await this.getRoom(roomName);
      if (room) {
        rooms.push(room);
      }
    }

    return rooms;
  }

  async getRoomsByPattern(pattern: string): Promise<WsRoom[]> {
    const allRooms = await this.getAllRooms();

    return allRooms.filter((room) => isPatternMatch(pattern, room.name));
  }

  async updateRoomMetadata(name: string, metadata: Record<string, unknown>): Promise<void> {
    const room = await this.getRoom(name);
    if (room) {
      room.metadata = { ...room.metadata, ...metadata };
      await this.redisClient.set(KEYS.ROOMS + name, JSON.stringify(room));
    }
  }

  // ============================================================================
  // Room Membership Operations
  // ============================================================================

  async addClientToRoom(clientId: string, roomName: string): Promise<void> {
    // Ensure room exists
    let room = await this.getRoom(roomName);
    if (!room) {
      room = { name: roomName, clientIds: [] };
      await this.redisClient.set(KEYS.ROOMS + roomName, JSON.stringify(room));
    }

    // Add to room members set
    await this.redisClient.sadd(KEYS.ROOM_MEMBERS + roomName, clientId);

    // Add to client's rooms set
    await this.redisClient.sadd(KEYS.CLIENT_ROOMS + clientId, roomName);

    // Update client's room list in client data
    const client = await this.getClient(clientId);
    if (client && !client.rooms.includes(roomName)) {
      client.rooms.push(roomName);
      await this.updateClient(clientId, { rooms: client.rooms });
    }
  }

  async removeClientFromRoom(clientId: string, roomName: string): Promise<void> {
    // Remove from room members set
    await this.redisClient.srem(KEYS.ROOM_MEMBERS + roomName, clientId);

    // Remove from client's rooms set
    await this.redisClient.srem(KEYS.CLIENT_ROOMS + clientId, roomName);

    // Update client's room list in client data
    const client = await this.getClient(clientId);
    if (client) {
      client.rooms = client.rooms.filter((r) => r !== roomName);
      await this.updateClient(clientId, { rooms: client.rooms });
    }

    // Delete room if empty
    const memberCount = await this.redisClient.scard(KEYS.ROOM_MEMBERS + roomName);
    if (memberCount === 0) {
      await this.redisClient.del(KEYS.ROOMS + roomName);
      await this.redisClient.del(KEYS.ROOM_MEMBERS + roomName);
    }
  }

  async getClientsInRoom(roomName: string): Promise<string[]> {
    return await this.redisClient.smembers(KEYS.ROOM_MEMBERS + roomName);
  }

  async getRoomsForClient(clientId: string): Promise<string[]> {
    return await this.redisClient.smembers(KEYS.CLIENT_ROOMS + clientId);
  }

  async removeClientFromAllRooms(clientId: string): Promise<void> {
    const rooms = await this.getRoomsForClient(clientId);

    for (const roomName of rooms) {
      await this.removeClientFromRoom(clientId, roomName);
    }
  }

  // ============================================================================
  // Pub/Sub Operations
  // ============================================================================

  async subscribe(handler: (payload: WsStorageEventPayload) => void): Promise<void> {
    this.eventHandlers.push(handler);

    if (!this.subscribed) {
      await this.redisClient.subscribe(KEYS.PUBSUB_CHANNEL, (message: string) => {
        try {
          const payload = JSON.parse(message) as WsStorageEventPayload;
          for (const h of this.eventHandlers) {
            try {
              h(payload);
            } catch {
              // Ignore handler errors
            }
          }
        } catch {
          // Ignore invalid messages
        }
      });
      this.subscribed = true;
    }
  }

  async publish(payload: WsStorageEventPayload): Promise<void> {
    await this.redisClient.publish(KEYS.PUBSUB_CHANNEL, JSON.stringify(payload));
  }

  async unsubscribe(): Promise<void> {
    this.eventHandlers = [];
    if (this.subscribed) {
      await this.redisClient.unsubscribe(KEYS.PUBSUB_CHANNEL);
      this.subscribed = false;
    }
  }

  // ============================================================================
  // Lifecycle Operations
  // ============================================================================

  async clear(): Promise<void> {
    // Get all keys
    const clientKeys = await this.redisClient.keys(KEYS.CLIENTS + '*');
    const roomKeys = await this.redisClient.keys(KEYS.ROOMS + '*');
    const memberKeys = await this.redisClient.keys(KEYS.ROOM_MEMBERS + '*');
    const clientRoomKeys = await this.redisClient.keys(KEYS.CLIENT_ROOMS + '*');

    // Delete all keys
    for (const key of [...clientKeys, ...roomKeys, ...memberKeys, ...clientRoomKeys]) {
      await this.redisClient.del(key);
    }
  }

  async close(): Promise<void> {
    await this.unsubscribe();
    // Note: We don't disconnect the Redis client here
    // because it might be shared with other consumers
  }
}

/**
 * Create Redis WebSocket storage with a Redis client
 */
export function createRedisWsStorage(redisClient: RedisClient): WsPubSubStorageAdapter {
  return new RedisWsStorage(redisClient);
}
