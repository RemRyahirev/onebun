/**
 * WebSocket Client Types
 *
 * Type definitions for the WebSocket client. Event names are strings and payloads are `unknown`:
 * none of these types is derived from a gateway's handlers.
 */

import type { WsServiceDefinition, WsGatewayDefinition } from './ws-service-definition';

/**
 * WebSocket protocol to use when connecting
 */
export type WsClientProtocol = 'native' | 'socketio';

/**
 * Options for WebSocket client
 */
export interface WsClientOptions {
  /** WebSocket server URL (for Socket.IO use the server root or socketio path, e.g. ws://host/socket.io) */
  url: string;
  /** Protocol to use (default: 'native') */
  protocol?: WsClientProtocol;
  /** Authentication options */
  auth?: {
    /** Bearer token */
    token?: string;
    /** Custom auth payload getter */
    getAuth?: () => Record<string, unknown>;
  };
  /** Enable automatic reconnection */
  reconnect?: boolean;
  /** Reconnection interval in milliseconds */
  reconnectInterval?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Timeout for requests in milliseconds */
  timeout?: number;
  /** Socket.IO specific: transports to use */
  transports?: ('websocket' | 'polling')[];
  /** Namespace to connect to */
  namespace?: string;
}

/**
 * Connection state
 */
export enum WsConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

/**
 * Event listener type
 */
export type WsEventListener<T = unknown> = (data: T, params?: Record<string, string>) => void;

/**
 * Client event types
 */
export type WsClientEvent =
  | 'connect'
  | 'disconnect'
  | 'error'
  | 'reconnect'
  | 'reconnect_attempt'
  | 'reconnect_failed';

/**
 * Client event listener types
 */
export interface WsClientEventListeners {
  connect: () => void;
  disconnect: (reason: string) => void;
  error: (error: Error) => void;
  reconnect: (attempt: number) => void;
  reconnect_attempt: (attempt: number) => void;
  reconnect_failed: () => void;
}

/**
 * Gateway client interface.
 *
 * The event name is any `string` and the payload is `unknown`. The type argument of `emit<T>()` and
 * `on<T>()` asserts what the payload is; nothing checks it against the gateway.
 *
 * @see docs:api/websocket.md
 */
export interface WsGatewayClient {
  /**
   * Send an event and wait for acknowledgement. Resolves the `data` of the handler's reply over the
   * native protocol, and the whole `{ event, data }` reply over Socket.IO.
   */
  emit<T = unknown>(event: string, data?: unknown): Promise<T>;
  /** Subscribe to events */
  on<T = unknown>(event: string, listener: WsEventListener<T>): void;
  /** Unsubscribe from events */
  off(event: string, listener?: WsEventListener): void;
  /** Send event without waiting for response */
  send(event: string, data?: unknown): void;
}

/**
 * Main WebSocket client interface
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface WsClient<TDef extends WsServiceDefinition = WsServiceDefinition> {
  /** Connect to WebSocket server */
  connect(): Promise<void>;
  /** Disconnect from WebSocket server */
  disconnect(): void;
  /** Check if connected */
  isConnected(): boolean;
  /** Get current connection state */
  getState(): WsConnectionState;
  /** Subscribe to client events */
  on<E extends WsClientEvent>(event: E, listener: WsClientEventListeners[E]): void;
  /** Unsubscribe from client events */
  off<E extends WsClientEvent>(event: E, listener?: WsClientEventListeners[E]): void;
  /** Access gateway by name */
  [gatewayName: string]: WsGatewayClient | unknown;
}

/**
 * Extract gateway names from service definition
 */
export type ExtractGatewayNames<TDef extends WsServiceDefinition> =
  TDef['_gateways'] extends Map<infer K, WsGatewayDefinition> ? K : never;

/**
 * The client `createWsClient` returns: `WsClient` plus one `WsGatewayClient` per gateway name.
 *
 * Despite the name, the gateway names are not known to the type system. `_gateways` is a
 * `Map<string, WsGatewayDefinition>`, so any name compiles, and at run time a name the definition
 * lacks reads as `undefined`.
 *
 * @see docs:api/websocket.md
 */
export type TypedWsClient<TDef extends WsServiceDefinition> = WsClient<TDef> & {
  [K in ExtractGatewayNames<TDef> & string]: WsGatewayClient;
};

/**
 * Pending request for acknowledgement
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Standalone WebSocket client (no service definition).
 * Same message format and API as the `createWsClient` client, but without gateway proxies.
 * Use it where the backend module cannot or should not be imported. It runs in Bun:
 * `@onebun/core` cannot currently be bundled for a browser.
 *
 * @see docs:api/websocket.md
 */
export interface NativeWsClient {
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getState(): WsConnectionState;
  /** Lifecycle events: connect, disconnect, error, reconnect, reconnect_attempt, reconnect_failed */
  on<E extends WsClientEvent>(event: E, listener: WsClientEventListeners[E]): void;
  /** Server events (event names from your gateway) */
  on<T = unknown>(event: string, listener: WsEventListener<T>): void;
  off<E extends WsClientEvent>(event: E, listener?: WsClientEventListeners[E]): void;
  off(event: string, listener?: WsEventListener): void;
  /**
   * Send event and wait for acknowledgement. Resolves the `data` of the handler's reply over the
   * native protocol, and the whole `{ event, data }` reply over Socket.IO.
   */
  emit<T = unknown>(event: string, data?: unknown): Promise<T>;
  /** Send event without waiting for response */
  send(event: string, data?: unknown): void;
}
