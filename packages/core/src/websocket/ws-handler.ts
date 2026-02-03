/**
 * WebSocket Handler
 *
 * Handles WebSocket connections and message routing for gateways.
 */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-magic-numbers */

import type { WsStorageAdapter } from './ws-storage';
import type {
  WsClientData,
  WsHandlerMetadata,
  WebSocketApplicationOptions,
} from './ws.types';
import type { Server, ServerWebSocket } from 'bun';

import type { SyncLogger } from '@onebun/logger';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { getGatewayMetadata, isWebSocketGateway } from './ws-decorators';
import { WsExecutionContextImpl, executeGuards } from './ws-guards';
import { matchPattern } from './ws-pattern-matcher';
import {
  parseMessage,
  createOpenPacket,
  createHandshake,
  createPongPacket,
  createFullAckMessage,
  createFullEventMessage,
  EngineIOPacketType,
  SocketIOPacketType,
  isNativeMessage,
  parseNativeMessage,
  createNativeMessage,
  DEFAULT_PING_INTERVAL,
  DEFAULT_PING_TIMEOUT,
  DEFAULT_MAX_PAYLOAD,
} from './ws-socketio-protocol';
import { InMemoryWsStorage } from './ws-storage-memory';
import {
  WsHandlerType,
  WsParamType,
  isWsHandlerResponse,
} from './ws.types';

// Alias for clarity
const ParamType = WsParamType;
const HandlerType = WsHandlerType;


/**
 * Gateway instance with metadata
 */
interface GatewayInstance {
  instance: BaseWebSocketGateway;
  metadata: ReturnType<typeof getGatewayMetadata>;
  handlers: Map<WsHandlerType, WsHandlerMetadata[]>;
}

/**
 * WebSocket handler for OneBunApplication
 */
export class WsHandler {
  private storage: WsStorageAdapter;
  private gateways: Map<string, GatewayInstance> = new Map();
  private pingIntervalMs: number;
  private pingTimeoutMs: number;
  private maxPayload: number;
  private pingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(
    private logger: SyncLogger,
    private options: WebSocketApplicationOptions = {},
  ) {
    this.storage = new InMemoryWsStorage();
    this.pingIntervalMs = options.pingInterval ?? DEFAULT_PING_INTERVAL;
    this.pingTimeoutMs = options.pingTimeout ?? DEFAULT_PING_TIMEOUT;
    this.maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
  }

  /**
   * Set storage adapter
   */
  setStorage(storage: WsStorageAdapter): void {
    this.storage = storage;
  }

  /**
   * Register a gateway instance
   */
  registerGateway(gatewayClass: Function, instance: BaseWebSocketGateway): void {
    const metadata = getGatewayMetadata(gatewayClass);
    if (!metadata) {
      return;
    }

    // Group handlers by type
    const handlers = new Map<WsHandlerType, WsHandlerMetadata[]>();
    for (const type of Object.values(WsHandlerType)) {
      handlers.set(type as WsHandlerType, []);
    }

    for (const handler of metadata.handlers) {
      const typeHandlers = handlers.get(handler.type) || [];
      typeHandlers.push(handler);
      handlers.set(handler.type, typeHandlers);
    }

    const key = metadata.namespace ? `${metadata.path}:${metadata.namespace}` : metadata.path;
    this.gateways.set(key, { instance, metadata, handlers });

    this.logger.debug(`Registered WebSocket gateway: ${gatewayClass.name} at ${metadata.path}`);
  }

  /**
   * Initialize gateways with server
   */
  initializeGateways(server: Server): void {
    for (const [_, gateway] of this.gateways) {
      gateway.instance._initialize(this.storage, server);
    }
  }

  /**
   * Check if there are any registered gateways
   */
  hasGateways(): boolean {
    return this.gateways.size > 0;
  }

  /**
   * Get gateway for a path
   */
  private getGatewayForPath(path: string, namespace?: string): GatewayInstance | undefined {
    // Try exact match with namespace
    if (namespace) {
      const key = `${path}:${namespace}`;
      if (this.gateways.has(key)) {
        return this.gateways.get(key);
      }
    }

    // Try exact path match
    if (this.gateways.has(path)) {
      return this.gateways.get(path);
    }

    // Try prefix match
    for (const [_, gateway] of this.gateways) {
      if (gateway.metadata && path.startsWith(gateway.metadata.path)) {
        return gateway;
      }
    }

    return undefined;
  }

  /**
   * Create WebSocket handlers for Bun.serve
   */
  createWebSocketHandlers(): {
    open: (ws: ServerWebSocket<WsClientData>) => void;
    message: (ws: ServerWebSocket<WsClientData>, message: string | Buffer) => void;
    close: (ws: ServerWebSocket<WsClientData>, code: number, reason: string) => void;
    drain: (ws: ServerWebSocket<WsClientData>) => void;
  } {
    return {
      open: (ws) => this.handleOpen(ws),
      message: (ws, message) => this.handleMessage(ws, message),
      close: (ws, code, reason) => this.handleClose(ws, code, reason),
      drain: (ws) => this.handleDrain(ws),
    };
  }

  /**
   * Handle WebSocket upgrade request
   */
  async handleUpgrade(
    req: Request,
    server: Server,
  ): Promise<Response | undefined> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Find matching gateway
    const gateway = this.getGatewayForPath(path);
    if (!gateway) {
      return new Response('Not Found', { status: 404 });
    }

    // Extract auth from query or headers
    const token = url.searchParams.get('token') || 
                  req.headers.get('Authorization')?.replace('Bearer ', '');

    // Create client ID
    const clientId = crypto.randomUUID();

    // Create client data
    const clientData: WsClientData = {
      id: clientId,
      rooms: [],
      connectedAt: Date.now(),
      auth: token ? {
        authenticated: false,
        token,
      } : null,
      metadata: {},
    };

    // Try to upgrade
    const success = server.upgrade(req, {
      data: clientData,
    });

    if (success) {
      return undefined; // Bun handles the 101 response
    }

    return new Response('Upgrade failed', { status: 400 });
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleOpen(ws: ServerWebSocket<WsClientData>): Promise<void> {
    const client = ws.data;
    this.logger.debug(`WebSocket client connected: ${client.id}`);

    // Store client
    await this.storage.addClient(client);

    // Register socket in gateway
    for (const [_, gateway] of this.gateways) {
      gateway.instance._registerSocket(client.id, ws);
    }

    // Send Socket.IO handshake
    const handshake = createHandshake(client.id, {
      pingInterval: this.pingIntervalMs,
      pingTimeout: this.pingTimeoutMs,
      maxPayload: this.maxPayload,
    });
    ws.send(createOpenPacket(handshake));

    // Start ping interval
    this.startPingInterval(client.id, ws);

    // Call OnConnect handlers
    for (const [_, gateway] of this.gateways) {
      const handlers = gateway.handlers.get(HandlerType.CONNECT) || [];
      for (const handler of handlers) {
        try {
          const result = await this.executeHandler(gateway, handler, ws, undefined, {});
          if (result && isWsHandlerResponse(result)) {
            ws.send(createNativeMessage(result.event, result.data));
          }
        } catch (error) {
          this.logger.error(`Error in OnConnect handler: ${error}`);
        }
      }
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    ws: ServerWebSocket<WsClientData>,
    message: string | Buffer,
  ): Promise<void> {
    const messageStr = typeof message === 'string' ? message : message.toString();

    // Try native format first
    if (isNativeMessage(messageStr)) {
      const native = parseNativeMessage(messageStr);
      if (native) {
        await this.routeMessage(ws, native.event, native.data, native.ack);

        return;
      }
    }

    // Parse Socket.IO format
    const { engineIO, socketIO } = parseMessage(messageStr);

    // Handle Engine.IO packets
    switch (engineIO.type) {
      case EngineIOPacketType.PING:
        ws.send(createPongPacket(engineIO.data as string | undefined));

        return;

      case EngineIOPacketType.PONG:
        // Client responded to ping - connection is alive
        return;

      case EngineIOPacketType.CLOSE:
        ws.close(1000, 'Client requested close');

        return;

      case EngineIOPacketType.MESSAGE:
        // Socket.IO packet
        if (socketIO) {
          await this.handleSocketIOPacket(ws, socketIO);
        }

        return;
    }
  }

  /**
   * Handle Socket.IO packet
   */
  private async handleSocketIOPacket(
    ws: ServerWebSocket<WsClientData>,
    packet: { type: number; nsp: string; data?: unknown[]; id?: number },
  ): Promise<void> {
    switch (packet.type) {
      case SocketIOPacketType.CONNECT:
        // Client connecting to namespace - send CONNECT acknowledgement
        ws.send(createFullEventMessage('connect', { sid: ws.data.id }, packet.nsp));
        break;

      case SocketIOPacketType.DISCONNECT:
        // Client disconnecting from namespace
        break;

      case SocketIOPacketType.EVENT:
        // Handle event
        if (packet.data && Array.isArray(packet.data) && packet.data.length > 0) {
          const [event, ...args] = packet.data;
          if (typeof event === 'string') {
            await this.routeMessage(ws, event, args[0], packet.id);
          }
        }
        break;

      case SocketIOPacketType.ACK:
        // Acknowledgement - not implemented yet
        break;
    }
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    // Check for room join/leave events
    if (event === 'join' || event.startsWith('join:')) {
      await this.handleRoomJoin(ws, event, data, ackId);

      return;
    }

    if (event === 'leave' || event.startsWith('leave:')) {
      await this.handleRoomLeave(ws, event, data, ackId);

      return;
    }

    // Find matching message handler
    for (const [_, gateway] of this.gateways) {
      const handlers = gateway.handlers.get(HandlerType.MESSAGE) || [];

      for (const handler of handlers) {
        if (!handler.pattern) {
          continue;
        }

        const match = matchPattern(handler.pattern, event);
        if (match.matched) {
          try {
            const result = await this.executeHandler(gateway, handler, ws, data, match.params);
            
            // Send response
            if (result !== undefined) {
              if (ackId !== undefined) {
                ws.send(createFullAckMessage(ackId, result));
              } else if (isWsHandlerResponse(result)) {
                ws.send(createNativeMessage(result.event, result.data));
              }
            }
          } catch (error) {
            this.logger.error(`Error in message handler: ${error}`);
          }
        }
      }
    }
  }

  /**
   * Handle room join
   */
  private async handleRoomJoin(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    const client = ws.data;
    const roomName = typeof data === 'string' ? data : 
      (data as { room?: string })?.room || 
                     event.replace('join:', '');

    // Add to storage
    await this.storage.addClientToRoom(client.id, roomName);

    // Subscribe to Bun pub/sub
    ws.subscribe(roomName);

    // Update client data
    if (!client.rooms.includes(roomName)) {
      client.rooms.push(roomName);
    }

    // Call OnJoinRoom handlers
    for (const [_, gateway] of this.gateways) {
      const handlers = gateway.handlers.get(HandlerType.JOIN_ROOM) || [];

      for (const handler of handlers) {
        const match = handler.pattern ? matchPattern(handler.pattern, roomName) : { matched: true, params: {} };
        
        if (match.matched) {
          try {
            const result = await this.executeHandler(gateway, handler, ws, data, match.params, roomName);
            if (result !== undefined) {
              if (ackId !== undefined) {
                ws.send(createFullAckMessage(ackId, result));
              } else if (isWsHandlerResponse(result)) {
                ws.send(createNativeMessage(result.event, result.data));
              }
            }
          } catch (error) {
            this.logger.error(`Error in OnJoinRoom handler: ${error}`);
          }
        }
      }
    }
  }

  /**
   * Handle room leave
   */
  private async handleRoomLeave(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    const client = ws.data;
    const roomName = typeof data === 'string' ? data :
      (data as { room?: string })?.room ||
                     event.replace('leave:', '');

    // Remove from storage
    await this.storage.removeClientFromRoom(client.id, roomName);

    // Unsubscribe from Bun pub/sub
    ws.unsubscribe(roomName);

    // Update client data
    client.rooms = client.rooms.filter((r) => r !== roomName);

    // Call OnLeaveRoom handlers
    for (const [_, gateway] of this.gateways) {
      const handlers = gateway.handlers.get(HandlerType.LEAVE_ROOM) || [];

      for (const handler of handlers) {
        const match = handler.pattern ? matchPattern(handler.pattern, roomName) : { matched: true, params: {} };
        
        if (match.matched) {
          try {
            const result = await this.executeHandler(gateway, handler, ws, data, match.params, roomName);
            if (result !== undefined) {
              if (ackId !== undefined) {
                ws.send(createFullAckMessage(ackId, result));
              } else if (isWsHandlerResponse(result)) {
                ws.send(createNativeMessage(result.event, result.data));
              }
            }
          } catch (error) {
            this.logger.error(`Error in OnLeaveRoom handler: ${error}`);
          }
        }
      }
    }
  }

  /**
   * Execute a handler with parameter injection
   */
  private async executeHandler(
    gateway: GatewayInstance,
    handler: WsHandlerMetadata,
    ws: ServerWebSocket<WsClientData>,
    data: unknown,
    patternParams: Record<string, string>,
    roomName?: string,
  ): Promise<unknown> {
    const client = ws.data;
    const instance = gateway.instance;

    // Check guards
    if (handler.guards && handler.guards.length > 0) {
      const context = new WsExecutionContextImpl(
        client,
        ws,
        data,
        handler,
        patternParams,
      );

      const canActivate = await executeGuards(handler.guards, context);
      if (!canActivate) {
        this.logger.debug(`Guard rejected request for ${handler.handler}`);

        return undefined;
      }
    }

    // Build arguments
    const params = handler.params || [];
    const sortedParams = [...params].sort((a, b) => a.index - b.index);
    const args: unknown[] = [];

    for (const param of sortedParams) {
      switch (param.type) {
        case ParamType.CLIENT:
          args[param.index] = client;
          break;

        case ParamType.SOCKET:
          args[param.index] = ws;
          break;

        case ParamType.MESSAGE_DATA:
          if (param.property && typeof data === 'object' && data !== null) {
            args[param.index] = (data as Record<string, unknown>)[param.property];
          } else {
            args[param.index] = data;
          }
          break;

        case ParamType.ROOM_NAME:
          args[param.index] = roomName;
          break;

        case ParamType.PATTERN_PARAMS:
          args[param.index] = patternParams;
          break;

        case ParamType.SERVER:
          args[param.index] = gateway.instance.getWsServer();
          break;
      }
    }

    // Call handler
    const method = (instance as unknown as Record<string, Function>)[handler.handler];
    if (typeof method === 'function') {
      return await method.apply(instance, args);
    }

    return undefined;
  }

  /**
   * Handle WebSocket close
   */
  private async handleClose(
    ws: ServerWebSocket<WsClientData>,
    code: number,
    reason: string,
  ): Promise<void> {
    const client = ws.data;
    this.logger.debug(`WebSocket client disconnected: ${client.id} (${code}: ${reason})`);

    // Stop ping interval
    this.stopPingInterval(client.id);

    // Call OnDisconnect handlers
    for (const [_, gateway] of this.gateways) {
      const handlers = gateway.handlers.get(HandlerType.DISCONNECT) || [];
      for (const handler of handlers) {
        try {
          await this.executeHandler(gateway, handler, ws, undefined, {});
        } catch (error) {
          this.logger.error(`Error in OnDisconnect handler: ${error}`);
        }
      }

      // Unregister socket
      gateway.instance._unregisterSocket(client.id);
    }

    // Remove from storage
    await this.storage.removeClient(client.id);
  }

  /**
   * Handle WebSocket drain (backpressure)
   */
  private handleDrain(ws: ServerWebSocket<WsClientData>): void {
    this.logger.debug(`WebSocket drain for client: ${ws.data.id}`);
  }

  /**
   * Start ping interval for client
   */
  private startPingInterval(clientId: string, ws: ServerWebSocket<WsClientData>): void {
    const interval = setInterval(() => {
      try {
        // Send Engine.IO ping
        ws.send(String(EngineIOPacketType.PING));
      } catch {
        this.stopPingInterval(clientId);
      }
    }, this.pingIntervalMs);

    this.pingIntervals.set(clientId, interval);
  }

  /**
   * Stop ping interval for client
   */
  private stopPingInterval(clientId: string): void {
    const interval = this.pingIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.pingIntervals.delete(clientId);
    }
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    // Stop all ping intervals
    for (const [clientId, _] of this.pingIntervals) {
      this.stopPingInterval(clientId);
    }

    // Clear storage
    await this.storage.clear();
  }
}

/**
 * Check if a class is a WebSocket gateway (for use in module)
 */
export { isWebSocketGateway };
