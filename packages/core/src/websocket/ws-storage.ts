/**
 * WebSocket Storage Interface
 *
 * Defines the contract for storing WebSocket client and room data.
 * Implementations include in-memory storage and Redis storage.
 */

import type { WsClientData, WsRoom } from './ws.types';

/**
 * Storage adapter interface for WebSocket state management
 */
export interface WsStorageAdapter {
  // ============================================================================
  // Client Operations
  // ============================================================================

  /**
   * Add a new client to storage
   * @param client - Client data to store
   */
  addClient(client: WsClientData): Promise<void>;

  /**
   * Remove a client from storage
   * @param clientId - ID of client to remove
   */
  removeClient(clientId: string): Promise<void>;

  /**
   * Get a client by ID
   * @param clientId - ID of client to retrieve
   * @returns Client data or null if not found
   */
  getClient(clientId: string): Promise<WsClientData | null>;

  /**
   * Get all connected clients
   * @returns Array of all client data
   */
  getAllClients(): Promise<WsClientData[]>;

  /**
   * Update client data
   * @param clientId - ID of client to update
   * @param data - Partial client data to merge
   */
  updateClient(clientId: string, data: Partial<WsClientData>): Promise<void>;

  /**
   * Get number of connected clients
   * @returns Client count
   */
  getClientCount(): Promise<number>;

  // ============================================================================
  // Room Operations
  // ============================================================================

  /**
   * Create a new room
   * @param room - Room data to create
   */
  createRoom(room: WsRoom): Promise<void>;

  /**
   * Delete a room
   * @param name - Name of room to delete
   */
  deleteRoom(name: string): Promise<void>;

  /**
   * Get a room by name
   * @param name - Name of room to retrieve
   * @returns Room data or null if not found
   */
  getRoom(name: string): Promise<WsRoom | null>;

  /**
   * Get all rooms
   * @returns Array of all room data
   */
  getAllRooms(): Promise<WsRoom[]>;

  /**
   * Get rooms matching a pattern
   * @param pattern - Pattern to match room names
   * @returns Array of matching rooms
   */
  getRoomsByPattern(pattern: string): Promise<WsRoom[]>;

  /**
   * Update room metadata
   * @param name - Name of room to update
   * @param metadata - Metadata to merge
   */
  updateRoomMetadata(name: string, metadata: Record<string, unknown>): Promise<void>;

  // ============================================================================
  // Room Membership Operations
  // ============================================================================

  /**
   * Add a client to a room
   * @param clientId - ID of client to add
   * @param roomName - Name of room to join
   */
  addClientToRoom(clientId: string, roomName: string): Promise<void>;

  /**
   * Remove a client from a room
   * @param clientId - ID of client to remove
   * @param roomName - Name of room to leave
   */
  removeClientFromRoom(clientId: string, roomName: string): Promise<void>;

  /**
   * Get all client IDs in a room
   * @param roomName - Name of room
   * @returns Array of client IDs
   */
  getClientsInRoom(roomName: string): Promise<string[]>;

  /**
   * Get all rooms a client has joined
   * @param clientId - ID of client
   * @returns Array of room names
   */
  getRoomsForClient(clientId: string): Promise<string[]>;

  /**
   * Remove a client from all rooms
   * @param clientId - ID of client to remove from all rooms
   */
  removeClientFromAllRooms(clientId: string): Promise<void>;

  // ============================================================================
  // Lifecycle Operations
  // ============================================================================

  /**
   * Clear all data (clients and rooms)
   */
  clear(): Promise<void>;

  /**
   * Close storage connections (if any)
   */
  close(): Promise<void>;
}

/**
 * Event types for storage pub/sub (used with Redis)
 */
export enum WsStorageEvent {
  CLIENT_CONNECTED = 'ws:client:connected',
  CLIENT_DISCONNECTED = 'ws:client:disconnected',
  CLIENT_JOINED_ROOM = 'ws:client:joined',
  CLIENT_LEFT_ROOM = 'ws:client:left',
  BROADCAST = 'ws:broadcast',
  ROOM_BROADCAST = 'ws:room:broadcast',
  CLIENT_MESSAGE = 'ws:client:message',
}

/**
 * Payload for storage events
 */
export interface WsStorageEventPayload {
  /** Event type */
  type: WsStorageEvent;
  /** Source instance ID (for multi-instance setups) */
  sourceInstanceId: string;
  /** Event-specific data */
  data: {
    clientId?: string;
    roomName?: string;
    event?: string;
    message?: unknown;
    excludeClientIds?: string[];
  };
}

/**
 * Extended storage adapter with pub/sub support (for Redis)
 */
export interface WsPubSubStorageAdapter extends WsStorageAdapter {
  /**
   * Subscribe to storage events
   * @param handler - Event handler function
   */
  subscribe(handler: (payload: WsStorageEventPayload) => void): Promise<void>;

  /**
   * Publish an event to all instances
   * @param payload - Event payload
   */
  publish(payload: WsStorageEventPayload): Promise<void>;

  /**
   * Unsubscribe from storage events
   */
  unsubscribe(): Promise<void>;
}

/**
 * Check if storage adapter supports pub/sub
 */
export function isPubSubAdapter(adapter: WsStorageAdapter): adapter is WsPubSubStorageAdapter {
  return 'subscribe' in adapter && 'publish' in adapter && 'unsubscribe' in adapter;
}
