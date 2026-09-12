/**
 * In-Memory WebSocket Storage
 *
 * Simple in-memory implementation of WsStorageAdapter.
 * Suitable for single-instance deployments.
 */

import type { WsStorageAdapter } from './ws-storage';
import type { WsClientData, WsRoom } from './ws.types';

import { isPatternMatch } from './ws-pattern-matcher';

/**
 * A client record that shares nothing mutable with the one handed in or handed out.
 *
 * `{...client}` copied the object and kept the caller's `rooms` ARRAY, `metadata` and `auth`. The
 * caller of `addClient` is the WebSocket handler passing `ws.data`, so the alias made
 * `addClientToRoom`'s `push()` land on the live socket — which is how room membership appeared to
 * work in memory mode and did not under Redis, and how a caller could write into storage it had
 * only read from.
 *
 * Optional keys are preserved as ABSENT rather than materialised: `{...undefined}` is `{}`, and a
 * record that grows a `metadata: {}` it never had changes shape for every reader.
 */
function copyClient(client: WsClientData): WsClientData {
  return {
    ...client,
    rooms: [...client.rooms],
    metadata: { ...client.metadata },
    auth: client.auth
      ? {
        ...client.auth,
        ...(client.auth.permissions ? { permissions: [...client.auth.permissions] } : {}),
      }
      : client.auth,
  };
}

/** The same, for a room: `clientIds` was already copied, `metadata` was not. */
function copyRoom(room: WsRoom): WsRoom {
  return {
    ...room,
    clientIds: [...room.clientIds],
    ...(room.metadata ? { metadata: { ...room.metadata } } : {}),
  };
}

/**
 * In-memory storage for WebSocket clients and rooms
 */
export class InMemoryWsStorage implements WsStorageAdapter {
  private clients = new Map<string, WsClientData>();
  private rooms = new Map<string, WsRoom>();

  // ============================================================================
  // Client Operations
  // ============================================================================

  async addClient(client: WsClientData): Promise<void> {
    this.clients.set(client.id, copyClient(client));
  }

  async removeClient(clientId: string): Promise<void> {
    // Remove from all rooms first
    await this.removeClientFromAllRooms(clientId);
    // Then remove the client
    this.clients.delete(clientId);
  }

  async getClient(clientId: string): Promise<WsClientData | null> {
    const client = this.clients.get(clientId);

    return client ? copyClient(client) : null;
  }

  async getAllClients(): Promise<WsClientData[]> {
    return Array.from(this.clients.values()).map((client) => copyClient(client));
  }

  async updateClient(clientId: string, data: Partial<WsClientData>): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.set(clientId, copyClient({ ...client, ...data }));
    }
  }

  async getClientCount(): Promise<number> {
    return this.clients.size;
  }

  // ============================================================================
  // Room Operations
  // ============================================================================

  async createRoom(room: WsRoom): Promise<void> {
    this.rooms.set(room.name, copyRoom(room));
  }

  async deleteRoom(name: string): Promise<void> {
    const room = this.rooms.get(name);
    if (room) {
      // Remove room from all clients' room lists
      for (const clientId of room.clientIds) {
        const client = this.clients.get(clientId);
        if (client) {
          client.rooms = client.rooms.filter((r) => r !== name);
        }
      }
      this.rooms.delete(name);
    }
  }

  async getRoom(name: string): Promise<WsRoom | null> {
    const room = this.rooms.get(name);

    return room ? copyRoom(room) : null;
  }

  async getAllRooms(): Promise<WsRoom[]> {
    return Array.from(this.rooms.values()).map((room) => copyRoom(room));
  }

  async getRoomsByPattern(pattern: string): Promise<WsRoom[]> {
    const matchingRooms: WsRoom[] = [];

    for (const [name, room] of this.rooms) {
      if (isPatternMatch(pattern, name)) {
        matchingRooms.push(copyRoom(room));
      }
    }

    return matchingRooms;
  }

  async updateRoomMetadata(name: string, metadata: Record<string, unknown>): Promise<void> {
    const room = this.rooms.get(name);
    if (room) {
      room.metadata = { ...room.metadata, ...metadata };
    }
  }

  // ============================================================================
  // Room Membership Operations
  // ============================================================================

  async addClientToRoom(clientId: string, roomName: string): Promise<void> {
    // Get or create room
    let room = this.rooms.get(roomName);
    if (!room) {
      room = { name: roomName, clientIds: [] };
      this.rooms.set(roomName, room);
    }

    // Add client to room if not already there
    if (!room.clientIds.includes(clientId)) {
      room.clientIds.push(clientId);
    }

    // Update client's room list
    const client = this.clients.get(clientId);
    if (client && !client.rooms.includes(roomName)) {
      client.rooms.push(roomName);
    }
  }

  async removeClientFromRoom(clientId: string, roomName: string): Promise<void> {
    // Remove from room
    const room = this.rooms.get(roomName);
    if (room) {
      room.clientIds = room.clientIds.filter((id) => id !== clientId);

      // Delete room if empty
      if (room.clientIds.length === 0) {
        this.rooms.delete(roomName);
      }
    }

    // Update client's room list
    const client = this.clients.get(clientId);
    if (client) {
      client.rooms = client.rooms.filter((r) => r !== roomName);
    }
  }

  async getClientsInRoom(roomName: string): Promise<string[]> {
    const room = this.rooms.get(roomName);

    return room ? [...room.clientIds] : [];
  }

  async getRoomsForClient(clientId: string): Promise<string[]> {
    const client = this.clients.get(clientId);

    return client ? [...client.rooms] : [];
  }

  async removeClientFromAllRooms(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    // Remove from all rooms
    for (const roomName of client.rooms) {
      const room = this.rooms.get(roomName);
      if (room) {
        room.clientIds = room.clientIds.filter((id) => id !== clientId);

        // Delete room if empty
        if (room.clientIds.length === 0) {
          this.rooms.delete(roomName);
        }
      }
    }

    // Clear client's room list
    client.rooms = [];
  }

  // ============================================================================
  // Lifecycle Operations
  // ============================================================================

  async clear(): Promise<void> {
    this.clients.clear();
    this.rooms.clear();
  }

  async close(): Promise<void> {
    // No-op for in-memory storage
    await this.clear();
  }

  // ============================================================================
  // Debug/Stats Methods
  // ============================================================================

  /**
   * Get storage statistics (for debugging)
   */
  getStats(): { clientCount: number; roomCount: number } {
    return {
      clientCount: this.clients.size,
      roomCount: this.rooms.size,
    };
  }
}

/**
 * Create a new in-memory WebSocket storage instance
 */
export function createInMemoryWsStorage(): WsStorageAdapter {
  return new InMemoryWsStorage();
}
