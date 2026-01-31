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
 * In-memory storage for WebSocket clients and rooms
 */
export class InMemoryWsStorage implements WsStorageAdapter {
  private clients = new Map<string, WsClientData>();
  private rooms = new Map<string, WsRoom>();

  // ============================================================================
  // Client Operations
  // ============================================================================

  async addClient(client: WsClientData): Promise<void> {
    this.clients.set(client.id, { ...client });
  }

  async removeClient(clientId: string): Promise<void> {
    // Remove from all rooms first
    await this.removeClientFromAllRooms(clientId);
    // Then remove the client
    this.clients.delete(clientId);
  }

  async getClient(clientId: string): Promise<WsClientData | null> {
    const client = this.clients.get(clientId);

    return client ? { ...client } : null;
  }

  async getAllClients(): Promise<WsClientData[]> {
    return Array.from(this.clients.values()).map((c) => ({ ...c }));
  }

  async updateClient(clientId: string, data: Partial<WsClientData>): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.set(clientId, { ...client, ...data });
    }
  }

  async getClientCount(): Promise<number> {
    return this.clients.size;
  }

  // ============================================================================
  // Room Operations
  // ============================================================================

  async createRoom(room: WsRoom): Promise<void> {
    this.rooms.set(room.name, { ...room, clientIds: [...room.clientIds] });
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

    return room ? { ...room, clientIds: [...room.clientIds] } : null;
  }

  async getAllRooms(): Promise<WsRoom[]> {
    return Array.from(this.rooms.values()).map((r) => ({
      ...r,
      clientIds: [...r.clientIds],
    }));
  }

  async getRoomsByPattern(pattern: string): Promise<WsRoom[]> {
    const matchingRooms: WsRoom[] = [];

    for (const [name, room] of this.rooms) {
      if (isPatternMatch(pattern, name)) {
        matchingRooms.push({ ...room, clientIds: [...room.clientIds] });
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
