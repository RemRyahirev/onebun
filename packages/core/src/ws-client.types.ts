/**
 * WebSocket Client Types
 *
 * Type definitions for the typed WebSocket client.
 */

import type { WsServiceDefinition, WsGatewayDefinition } from './ws-service-definition';

/**
 * Options for WebSocket client
 */
export interface WsClientOptions {
  /** WebSocket server URL */
  url: string;
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
 * Gateway client interface
 */
export interface WsGatewayClient {
  /** Send an event and wait for acknowledgement */
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
 * Typed service client
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
