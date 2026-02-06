/**
 * WebSocket Client
 *
 * Typed WebSocket client for connecting to OneBun WebSocket gateways.
 * Supports both native WebSocket and Socket.IO protocols.
 */

/* eslint-disable @typescript-eslint/no-magic-numbers */
/* eslint-disable import/order -- type vs value from same path; keep single mixed import */

import {
  type NativeWsClient,
  type PendingRequest,
  type TypedWsClient,
  type WsClient,
  type WsClientEventListeners,
  type WsClientEvent,
  type WsClientOptions,
  type WsEventListener,
  type WsGatewayClient,
  WsConnectionState,
} from './ws-client.types';
import type { WsServiceDefinition } from './ws-service-definition';

/** Client lifecycle event names (subscriptions go to client, not server events) */
const WS_CLIENT_EVENTS: WsClientEvent[] = [
  'connect',
  'disconnect',
  'error',
  'reconnect',
  'reconnect_attempt',
  'reconnect_failed',
];

function isClientEvent(event: string): event is WsClientEvent {
  return WS_CLIENT_EVENTS.includes(event as WsClientEvent);
}

/** Dummy definition for standalone client (single logical gateway) */
const NATIVE_WS_DUMMY_DEFINITION: WsServiceDefinition = {
  _module: null,
  _endpoints: [],
  _gateways: new Map([['default', { name: 'default', path: '/', events: new Map() }]]),
};
import { matchPattern, isPattern } from './ws-pattern-matcher';
import {
  parseMessage,
  createPongPacket,
  createFullEventMessage,
  EngineIOPacketType,
  SocketIOPacketType,
  parseNativeMessage,
  createNativeMessage,
} from './ws-socketio-protocol';

/**
 * Default client options
 */
const DEFAULT_OPTIONS: Partial<WsClientOptions> = {
  protocol: 'native',
  reconnect: true,
  reconnectInterval: 1000,
  maxReconnectAttempts: 10,
  timeout: 5000,
  transports: ['websocket'],
};

/**
 * WebSocket client implementation
 */
class WsClientImpl<TDef extends WsServiceDefinition> implements WsClient<TDef> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any = null;
  private state: WsConnectionState = WsConnectionState.DISCONNECTED;
  private options: WsClientOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private ackId = 0;
  private eventListeners = new Map<string, Set<WsEventListener>>();
  private clientEventListeners = new Map<WsClientEvent, Set<Function>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sid: string | null = null;
  
  // Gateway clients cache
  private gatewayClients = new Map<string, WsGatewayClient>();

  constructor(
    private definition: TDef,
    options: WsClientOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === WsConnectionState.CONNECTED) {
      return;
    }

    return await new Promise((resolve, reject) => {
      this.state = WsConnectionState.CONNECTING;

      try {
        // Build URL with auth
        let url = this.options.url;
        const params = new URLSearchParams();

        const protocol = this.options.protocol ?? 'native';
        if (protocol === 'socketio') {
          params.set('EIO', '4');
          params.set('transport', 'websocket');
        }

        if (this.options.auth?.token) {
          params.set('token', this.options.auth.token);
        }

        if (this.options.namespace) {
          params.set('namespace', this.options.namespace);
        }

        const separator = url.includes('?') ? '&' : '?';
        url = params.toString() ? `${url}${separator}${params.toString()}` : url;

        // Create WebSocket connection
        // Use globalThis.WebSocket for browser compatibility
        const WS = typeof globalThis !== 'undefined' && globalThis.WebSocket 
          ? globalThis.WebSocket 
          : WebSocket;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws = new WS(url) as any;

        if (this.ws) {
          this.ws.onopen = () => {
            this.state = WsConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            this.emitClientEvent('connect');
            resolve();
          };

          this.ws.onmessage = (event: MessageEvent) => {
            this.handleMessage(event.data);
          };

          this.ws.onclose = (event: CloseEvent) => {
            this.handleClose(event.code, event.reason);
          };

          this.ws.onerror = () => {
            const err = new Error('WebSocket error');
            this.emitClientEvent('error', err);
            
            if (this.state === WsConnectionState.CONNECTING) {
              reject(err);
            }
          };
        }
      } catch (error) {
        this.state = WsConnectionState.DISCONNECTED;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.stopPing();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.state = WsConnectionState.DISCONNECTED;
    this.pendingRequests.clear();
    this.sid = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === WsConnectionState.CONNECTED;
  }

  /**
   * Get current connection state
   */
  getState(): WsConnectionState {
    return this.state;
  }

  /**
   * Subscribe to client events
   */
  on<E extends WsClientEvent>(event: E, listener: WsClientEventListeners[E]): void {
    let listeners = this.clientEventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.clientEventListeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  /**
   * Unsubscribe from client events
   */
  off<E extends WsClientEvent>(event: E, listener?: WsClientEventListeners[E]): void {
    if (listener) {
      const listeners = this.clientEventListeners.get(event);
      if (listeners) {
        listeners.delete(listener);
      }
    } else {
      this.clientEventListeners.delete(event);
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    const protocol = this.options.protocol ?? 'native';

    if (protocol === 'native') {
      const native = parseNativeMessage(data);
      if (native) {
        this.handleEvent(native.event, native.data, native.ack);
      }

      return;
    }

    // Socket.IO format
    const { engineIO, socketIO } = parseMessage(data);

    switch (engineIO.type) {
      case EngineIOPacketType.OPEN:
        if (engineIO.data) {
          try {
            const handshake = JSON.parse(engineIO.data as string);
            this.sid = handshake.sid;
            this.startPing(handshake.pingInterval || 25000);
          } catch {
            // Ignore parse errors
          }
        }

        return;

      case EngineIOPacketType.PING:
        this.ws?.send(createPongPacket(engineIO.data as string | undefined));

        return;

      case EngineIOPacketType.PONG:
        return;

      case EngineIOPacketType.CLOSE:
        this.handleClose(1000, 'Server closed');

        return;

      case EngineIOPacketType.MESSAGE:
        if (socketIO) {
          this.handleSocketIOPacket(socketIO);
        }

        return;
    }
  }

  /**
   * Handle Socket.IO packet
   */
  private handleSocketIOPacket(packet: {
    type: number;
    nsp: string;
    data?: unknown[];
    id?: number;
  }): void {
    switch (packet.type) {
      case SocketIOPacketType.CONNECT:
        // Connected to namespace
        break;

      case SocketIOPacketType.DISCONNECT:
        // Disconnected from namespace
        break;

      case SocketIOPacketType.EVENT:
        if (packet.data && Array.isArray(packet.data) && packet.data.length > 0) {
          const [event, ...args] = packet.data;
          if (typeof event === 'string') {
            this.handleEvent(event, args[0], packet.id);
          }
        }
        break;

      case SocketIOPacketType.ACK:
        // Handle acknowledgement
        if (packet.id !== undefined && packet.data) {
          const pending = this.pendingRequests.get(packet.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pending.resolve(packet.data[0]);
            this.pendingRequests.delete(packet.id);
          }
        }
        break;

      case SocketIOPacketType.CONNECT_ERROR:
        this.emitClientEvent('error', new Error('Connection error'));
        break;
    }
  }

  /**
   * Handle event
   */
  private handleEvent(event: string, data: unknown, ackId?: number): void {
    // Check for acknowledgement (response to our request)
    if (ackId !== undefined) {
      const pending = this.pendingRequests.get(ackId);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(data);
        this.pendingRequests.delete(ackId);

        return;
      }
    }

    // Notify listeners
    this.notifyListeners(event, data);
  }

  /**
   * Notify event listeners
   */
  private notifyListeners(event: string, data: unknown): void {
    // Exact match
    const exactListeners = this.eventListeners.get(event);
    if (exactListeners) {
      for (const listener of exactListeners) {
        try {
          listener(data);
        } catch {
          // Ignore listener errors
        }
      }
    }

    // Pattern match
    for (const [pattern, listeners] of this.eventListeners) {
      if (isPattern(pattern)) {
        const match = matchPattern(pattern, event);
        if (match.matched) {
          for (const listener of listeners) {
            try {
              listener(data, match.params);
            } catch {
              // Ignore listener errors
            }
          }
        }
      }
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(code: number, reason: string): void {
    this.stopPing();
    this.ws = null;
    
    const wasConnected = this.state === WsConnectionState.CONNECTED;
    this.state = WsConnectionState.DISCONNECTED;
    
    // Reject all pending requests
    for (const [_, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    this.emitClientEvent('disconnect', reason);

    // Try to reconnect if enabled
    if (wasConnected && this.options.reconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (
      this.reconnectAttempts >= (this.options.maxReconnectAttempts || 10)
    ) {
      this.emitClientEvent('reconnect_failed');

      return;
    }

    this.state = WsConnectionState.RECONNECTING;
    this.reconnectAttempts++;
    
    this.emitClientEvent('reconnect_attempt', this.reconnectAttempts);

    const delay =
      (this.options.reconnectInterval || 1000) *
      Math.min(this.reconnectAttempts, 5);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.emitClientEvent('reconnect', this.reconnectAttempts);
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Clear reconnect timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start ping interval
   */
  private startPing(interval: number): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.state === WsConnectionState.CONNECTED) {
        this.ws.send(String(EngineIOPacketType.PING));
      }
    }, interval);
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Emit client event
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitClientEvent(event: WsClientEvent, ...args: any[]): void {
    const listeners = this.clientEventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }

  /**
   * Send message to server
   */
  private send(event: string, data: unknown, ackId?: number): void {
    if (!this.ws || this.state !== WsConnectionState.CONNECTED) {
      throw new Error('Not connected');
    }

    const protocol = this.options.protocol ?? 'native';
    const message =
      protocol === 'socketio'
        ? createFullEventMessage(event, data ?? {}, '/', ackId)
        : createNativeMessage(event, data, ackId);
    this.ws.send(message);
  }

  /**
   * Send message and wait for acknowledgement
   */
  private async emit<T = unknown>(event: string, data: unknown): Promise<T> {
    return await new Promise((resolve, reject) => {
      const id = ++this.ackId;

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.options.timeout || 5000);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      try {
        this.send(event, data, id);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Subscribe to events
   */
  private addEventListener<T = unknown>(event: string, listener: WsEventListener<T>): void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(listener as WsEventListener);
  }

  /**
   * Unsubscribe from events
   */
  private removeEventListener(event: string, listener?: WsEventListener): void {
    if (listener) {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.delete(listener);
      }
    } else {
      this.eventListeners.delete(event);
    }
  }

  /**
   * Create gateway client proxy
   */
  private createGatewayClient(gatewayName: string): WsGatewayClient {
    const cached = this.gatewayClients.get(gatewayName);
    if (cached) {
      return cached;
    }

    const client: WsGatewayClient = {
      emit: <T = unknown>(event: string, data?: unknown) => this.emit<T>(event, data),
      on: <T = unknown>(event: string, listener: WsEventListener<T>) =>
        this.addEventListener(event, listener),
      off: (event: string, listener?: WsEventListener) =>
        this.removeEventListener(event, listener),
      send: (event: string, data?: unknown) => this.send(event, data),
    };

    this.gatewayClients.set(gatewayName, client);

    return client;
  }

  /**
   * Get gateway client by name (for proxy)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Create a typed WebSocket client for a service
 *
 * @param definition - Service definition created by createWsServiceDefinition()
 * @param options - Client options
 * @returns Typed WebSocket client
 *
 * @example
 * ```typescript
 * import { createWsClient, createWsServiceDefinition } from '@onebun/core';
 * import { ChatModule } from './chat.module';
 *
 * const definition = createWsServiceDefinition(ChatModule);
 * const client = createWsClient(definition, {
 *   url: 'ws://localhost:3000',
 *   auth: { token: 'xxx' },
 *   reconnect: true,
 * });
 *
 * // Connect
 * await client.connect();
 *
 * // Use typed gateway methods
 * await client.ChatGateway.emit('chat:message', { text: 'Hello' });
 *
 * // Subscribe to events
 * client.ChatGateway.on('chat:message', (message) => {
 *   console.log('Received:', message);
 * });
 *
 * // Disconnect
 * client.disconnect();
 * ```
 */
export function createWsClient<TDef extends WsServiceDefinition>(
  definition: TDef,
  options: WsClientOptions,
): TypedWsClient<TDef> {
  const client = new WsClientImpl(definition, options);

  // Create proxy for gateway access
  return new Proxy(client as unknown as TypedWsClient<TDef>, {
    get(target, prop) {
      // Check if it's a known method
      if (typeof prop === 'string') {
        const knownMethods = [
          'connect',
          'disconnect',
          'isConnected',
          'getState',
          'on',
          'off',
        ];

        if (knownMethods.includes(prop)) {
          return (target as unknown as Record<string, unknown>)[prop];
        }

        // Check if it's a gateway
        if (definition._gateways.has(prop)) {
          return (target as unknown as WsClientImpl<TDef>)['createGatewayClient'](prop);
        }
      }

      // Default property access
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  });
}

/**
 * Create a standalone WebSocket client without a service definition.
 * Uses the same native message format and API (emit, send, on, off) as the typed client.
 * Use in frontend or when you do not want to depend on backend modules.
 *
 * @param options - Client options (url, protocol, auth, reconnect, etc.)
 * @returns Standalone client with connect, disconnect, on, off, emit, send
 *
 * @example
 * ```typescript
 * import { createNativeWsClient } from '@onebun/core';
 *
 * const client = createNativeWsClient({
 *   url: 'ws://localhost:3000/chat',
 *   protocol: 'native',
 *   auth: { token: 'xxx' },
 * });
 *
 * await client.connect();
 * client.on('welcome', (data) => console.log(data));
 * client.on('connect', () => console.log('Connected'));
 *
 * await client.emit('chat:message', { text: 'Hello' });
 * client.send('typing', {});
 * client.disconnect();
 * ```
 */
export function createNativeWsClient(options: WsClientOptions): NativeWsClient {
  const typed = createWsClient(NATIVE_WS_DUMMY_DEFINITION, options);
  const gateway = (typed as unknown as Record<string, WsGatewayClient>).default;

  return {
    connect: () => typed.connect(),
    disconnect: () => typed.disconnect(),
    isConnected: () => typed.isConnected(),
    getState: () => typed.getState(),

    on(event: string, listener: WsEventListener | WsClientEventListeners[WsClientEvent]): void {
      if (isClientEvent(event)) {
        typed.on(event, listener as WsClientEventListeners[typeof event]);
      } else {
        gateway.on(event, listener as WsEventListener);
      }
    },

    off(
      event: string,
      listener?: WsEventListener | WsClientEventListeners[WsClientEvent],
    ): void {
      if (isClientEvent(event)) {
        typed.off(event, listener as WsClientEventListeners[typeof event]);
      } else {
        gateway.off(event, listener as WsEventListener);
      }
    },

    emit: <T = unknown>(event: string, data?: unknown) => gateway.emit<T>(event, data),
    send: (event: string, data?: unknown) => gateway.send(event, data),
  };
}
