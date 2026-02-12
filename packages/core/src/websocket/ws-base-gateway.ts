/**
 * Base WebSocket Gateway
 *
 * Abstract base class for WebSocket gateways.
 * Provides methods for client/room management and message broadcasting.
 */

import type { WsStorageAdapter, WsPubSubStorageAdapter } from './ws-storage';
import type {
  WsClientData,
  WsRoom,
  WsServer,
} from './ws.types';
import type { IConfig, OneBunAppConfig } from '../module/config.interface';
import type { Server, ServerWebSocket } from 'bun';

import type { SyncLogger } from '@onebun/logger';

import { createFullEventMessage, createNativeMessage } from './ws-socketio-protocol';
import { WsStorageEvent, isPubSubAdapter } from './ws-storage';

/**
 * Map of client IDs to their WebSocket connections
 * Stored separately from storage to keep socket references in memory
 */
const clientSockets = new Map<string, ServerWebSocket<WsClientData>>();

/**
 * Clear all client sockets (for testing purposes only)
 * @internal
 */
export function _resetClientSocketsForTesting(): void {
  clientSockets.clear();
}

/**
 * Base class for WebSocket gateways
 *
 * @example
 * ```typescript
 * @WebSocketGateway({ path: '/ws' })
 * export class ChatGateway extends BaseWebSocketGateway {
 *   @OnMessage('chat:message')
 *   handleMessage(@Client() client: WsClientData, @MessageData() data: any) {
 *     this.broadcast('chat:message', { userId: client.id, ...data });
 *   }
 * }
 * ```
 */
export abstract class BaseWebSocketGateway {
  /** Logger instance with gateway class name as context */
  protected logger!: SyncLogger;

  /** Configuration instance for accessing environment variables */
  protected config!: IConfig<OneBunAppConfig>;

  /** Storage adapter for persisting client/room data */
  protected storage: WsStorageAdapter | null = null;

  /** Bun server reference */
  protected server: Server<WsClientData> | null = null;

  /** Unique instance ID (for multi-instance setups) */
  protected instanceId: string = crypto.randomUUID();

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the gateway with logger and config
   * Called internally by the framework during DI
   * @internal
   */
  _initializeBase(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    const className = this.constructor.name;
    this.logger = logger.child({ className });
    this.config = config;
  }

  /**
   * Initialize the gateway with storage and server
   * Called internally by the framework
   * @internal
   */
  _initialize(storage: WsStorageAdapter, server: Server<WsClientData>): void {
    this.storage = storage;
    this.server = server;

    // Subscribe to pub/sub events if Redis storage
    if (isPubSubAdapter(storage)) {
      this._setupPubSub(storage);
    }
  }

  /**
   * Setup pub/sub for multi-instance support
   * @internal
   */
  private async _setupPubSub(storage: WsPubSubStorageAdapter): Promise<void> {
    await storage.subscribe((payload) => {
      // Ignore events from this instance
      if (payload.sourceInstanceId === this.instanceId) {
        return;
      }

      // Handle remote events
      switch (payload.type) {
        case WsStorageEvent.BROADCAST:
          // Broadcast to all local clients
          if (payload.data.event && payload.data.message !== undefined) {
            this._localBroadcast(
              payload.data.event,
              payload.data.message,
              payload.data.excludeClientIds,
            );
          }
          break;

        case WsStorageEvent.ROOM_BROADCAST:
          // Broadcast to room's local clients
          if (payload.data.roomName && payload.data.event && payload.data.message !== undefined) {
            this._localEmitToRoom(
              payload.data.roomName,
              payload.data.event,
              payload.data.message,
              payload.data.excludeClientIds,
            );
          }
          break;

        case WsStorageEvent.CLIENT_MESSAGE:
          // Send to specific client if local
          if (payload.data.clientId && payload.data.event && payload.data.message !== undefined) {
            this._localEmit(payload.data.clientId, payload.data.event, payload.data.message);
          }
          break;
      }
    });
  }

  /**
   * Register a client socket
   * @internal
   */
  _registerSocket(clientId: string, socket: ServerWebSocket<WsClientData>): void {
    clientSockets.set(clientId, socket);
  }

  /**
   * Unregister a client socket
   * @internal
   */
  _unregisterSocket(clientId: string): void {
    clientSockets.delete(clientId);
  }

  /**
   * Get socket for a client
   * @internal
   */
  protected getSocket(clientId: string): ServerWebSocket<WsClientData> | undefined {
    return clientSockets.get(clientId);
  }

  // ============================================================================
  // Client Getters
  // ============================================================================

  /**
   * Get all connected clients
   */
  get clients(): Map<string, WsClientData> {
    // Return a map view from storage - this is async but we need sync access
    // For sync access, maintain a local cache
    const result = new Map<string, WsClientData>();
    // Note: This returns only locally connected clients
    for (const [id, socket] of clientSockets) {
      if (socket.data) {
        result.set(id, socket.data);
      }
    }

    return result;
  }

  /**
   * Get all rooms
   */
  get rooms(): Map<string, WsRoom> {
    // Note: For async storage, use getRoomsAsync()
    return new Map();
  }

  /**
   * Get a client by ID
   */
  async getClient(clientId: string): Promise<WsClientData | undefined> {
    if (!this.storage) {
      return undefined;
    }
    const client = await this.storage.getClient(clientId);

    return client || undefined;
  }

  /**
   * Get a room by name
   */
  async getRoom(roomName: string): Promise<WsRoom | undefined> {
    if (!this.storage) {
      return undefined;
    }
    const room = await this.storage.getRoom(roomName);

    return room || undefined;
  }

  /**
   * Get all clients in a room
   */
  async getClientsByRoom(roomName: string): Promise<WsClientData[]> {
    if (!this.storage) {
      return [];
    }
    const clientIds = await this.storage.getClientsInRoom(roomName);
    const clients: WsClientData[] = [];

    for (const id of clientIds) {
      const client = await this.storage.getClient(id);
      if (client) {
        clients.push(client);
      }
    }

    return clients;
  }

  /**
   * Get all rooms matching a pattern
   */
  async getRoomsByPattern(pattern: string): Promise<WsRoom[]> {
    if (!this.storage) {
      return [];
    }

    return await this.storage.getRoomsByPattern(pattern);
  }

  // ============================================================================
  // Emit Methods
  // ============================================================================

  /**
   * Send a message to a specific client
   */
  emit(clientId: string, event: string, data: unknown): void {
    this._localEmit(clientId, event, data);

    // If using Redis, also publish for other instances
    if (this.storage && isPubSubAdapter(this.storage)) {
      this.storage.publish({
        type: WsStorageEvent.CLIENT_MESSAGE,
        sourceInstanceId: this.instanceId,
        data: { clientId, event, message: data },
      });
    }
  }

  /**
   * Encode message for client's protocol
   * @internal
   */
  private _encodeMessage(protocol: WsClientData['protocol'], event: string, data: unknown): string {
    return protocol === 'socketio'
      ? createFullEventMessage(event, data ?? {})
      : createNativeMessage(event, data);
  }

  /**
   * Send to local client only
   * @internal
   */
  private _localEmit(clientId: string, event: string, data: unknown): void {
    const socket = clientSockets.get(clientId);
    if (socket) {
      socket.send(this._encodeMessage(socket.data.protocol, event, data));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(event: string, data: unknown, excludeClientIds?: string[]): void {
    this._localBroadcast(event, data, excludeClientIds);

    // If using Redis, also publish for other instances
    if (this.storage && isPubSubAdapter(this.storage)) {
      this.storage.publish({
        type: WsStorageEvent.BROADCAST,
        sourceInstanceId: this.instanceId,
        data: { event, message: data, excludeClientIds },
      });
    }
  }

  /**
   * Broadcast to local clients only
   * @internal
   */
  private _localBroadcast(event: string, data: unknown, excludeClientIds?: string[]): void {
    const excludeSet = new Set(excludeClientIds || []);

    for (const [clientId, socket] of clientSockets) {
      if (!excludeSet.has(clientId)) {
        socket.send(this._encodeMessage(socket.data.protocol, event, data));
      }
    }
  }

  /**
   * Send a message to all clients in a room
   */
  emitToRoom(roomName: string, event: string, data: unknown, excludeClientIds?: string[]): void {
    this._localEmitToRoom(roomName, event, data, excludeClientIds);

    // If using Redis, also publish for other instances
    if (this.storage && isPubSubAdapter(this.storage)) {
      this.storage.publish({
        type: WsStorageEvent.ROOM_BROADCAST,
        sourceInstanceId: this.instanceId,
        data: {
          roomName, event, message: data, excludeClientIds, 
        },
      });
    }
  }

  /**
   * Emit to room's local clients only
   * @internal
   */
  private async _localEmitToRoom(
    roomName: string,
    event: string,
    data: unknown,
    excludeClientIds?: string[],
  ): Promise<void> {
    if (!this.storage) {
      return;
    }

    const clientIds = await this.storage.getClientsInRoom(roomName);
    const excludeSet = new Set(excludeClientIds || []);

    for (const clientId of clientIds) {
      if (!excludeSet.has(clientId)) {
        const socket = clientSockets.get(clientId);
        if (socket) {
          socket.send(this._encodeMessage(socket.data.protocol, event, data));
        }
      }
    }
  }

  /**
   * Send a message to all clients in multiple rooms
   */
  async emitToRooms(
    roomNames: string[],
    event: string,
    data: unknown,
    excludeClientIds?: string[],
  ): Promise<void> {
    // Collect unique client IDs from all rooms
    const clientIdsSet = new Set<string>();

    for (const roomName of roomNames) {
      if (this.storage) {
        const ids = await this.storage.getClientsInRoom(roomName);
        ids.forEach((id) => clientIdsSet.add(id));
      }
    }

    const excludeSet = new Set(excludeClientIds || []);

    for (const clientId of clientIdsSet) {
      if (!excludeSet.has(clientId)) {
        const socket = clientSockets.get(clientId);
        if (socket) {
          socket.send(this._encodeMessage(socket.data.protocol, event, data));
        }
      }
    }
  }

  /**
   * Send a message to all clients in rooms matching a pattern
   */
  async emitToRoomPattern(
    pattern: string,
    event: string,
    data: unknown,
    excludeClientIds?: string[],
  ): Promise<void> {
    const rooms = await this.getRoomsByPattern(pattern);
    const roomNames = rooms.map((r) => r.name);
    await this.emitToRooms(roomNames, event, data, excludeClientIds);
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Disconnect a specific client
   */
  disconnectClient(clientId: string, reason?: string): void {
    const socket = clientSockets.get(clientId);
    if (socket) {
      socket.close(1000, reason || 'Disconnected by server');
    }
  }

  /**
   * Disconnect all clients
   */
  disconnectAll(reason?: string): void {
    for (const [_, socket] of clientSockets) {
      socket.close(1000, reason || 'Server shutdown');
    }
  }

  /**
   * Disconnect all clients in a room
   */
  async disconnectRoom(roomName: string, reason?: string): Promise<void> {
    if (!this.storage) {
      return;
    }

    const clientIds = await this.storage.getClientsInRoom(roomName);
    for (const clientId of clientIds) {
      this.disconnectClient(clientId, reason);
    }
  }

  /**
   * Disconnect all clients in rooms matching a pattern
   */
  async disconnectRoomPattern(pattern: string, reason?: string): Promise<void> {
    const rooms = await this.getRoomsByPattern(pattern);
    for (const room of rooms) {
      await this.disconnectRoom(room.name, reason);
    }
  }

  // ============================================================================
  // Room Management
  // ============================================================================

  /**
   * Add a client to a room
   */
  async joinRoom(clientId: string, roomName: string): Promise<void> {
    if (!this.storage) {
      return;
    }
    await this.storage.addClientToRoom(clientId, roomName);

    // Also subscribe to Bun's native pub/sub topic
    const socket = clientSockets.get(clientId);
    if (socket) {
      socket.subscribe(roomName);
    }
  }

  /**
   * Remove a client from a room
   */
  async leaveRoom(clientId: string, roomName: string): Promise<void> {
    if (!this.storage) {
      return;
    }
    await this.storage.removeClientFromRoom(clientId, roomName);

    // Also unsubscribe from Bun's native pub/sub topic
    const socket = clientSockets.get(clientId);
    if (socket) {
      socket.unsubscribe(roomName);
    }
  }

  // ============================================================================
  // Lifecycle Hooks (can be overridden)
  // ============================================================================

  /**
   * Called when a client connects
   * Override in subclass to handle connection events
   */
  protected onClientConnected(_client: WsClientData): void | Promise<void> {
    // Default: no-op
  }

  /**
   * Called when a client disconnects
   * Override in subclass to handle disconnection events
   */
  protected onClientDisconnected(_client: WsClientData): void | Promise<void> {
    // Default: no-op
  }

  // ============================================================================
  // Server Access
  // ============================================================================

  /**
   * Get WebSocket server wrapper
   */
  getWsServer(): WsServer | null {
    if (!this.server) {
      return null;
    }

    const server = this.server;

    return {
      server,
      publish(topic: string, message: string | Buffer) {
        server.publish(topic, message);
      },
      subscriberCount(_topic: string) {
        // Bun doesn't expose this directly, so we count from our storage
        return 0; // TODO: implement proper counting
      },
    };
  }
}
