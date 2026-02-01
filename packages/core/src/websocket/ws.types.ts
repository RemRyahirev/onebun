/**
 * WebSocket Gateway Types
 *
 * Type definitions for WebSocket Gateway functionality in OneBun framework.
 */

import type { ServerWebSocket, Server } from 'bun';

// ============================================================================
// Client Types
// ============================================================================

/**
 * Authentication data for WebSocket client
 */
export interface WsAuthData {
  /** Whether the client is authenticated */
  authenticated: boolean;
  /** User ID if authenticated */
  userId?: string;
  /** Service ID for inter-service communication */
  serviceId?: string;
  /** List of permissions */
  permissions?: string[];
  /** Authentication token */
  token?: string;
}

/**
 * WebSocket client data (fixed fields)
 */
export interface WsClientData {
  /** Unique client identifier */
  id: string;
  /** List of rooms the client has joined */
  rooms: string[];
  /** Timestamp when client connected */
  connectedAt: number;
  /** Authentication data */
  auth: WsAuthData | null;
  /** Custom metadata */
  metadata: Record<string, unknown>;
}

/**
 * Extended client data with socket reference
 */
export interface WsClientWithSocket extends WsClientData {
  /** Reference to the actual WebSocket connection */
  socket: ServerWebSocket<WsClientData>;
}

// ============================================================================
// Room Types
// ============================================================================

/**
 * WebSocket room
 */
export interface WsRoom {
  /** Room name */
  name: string;
  /** List of client IDs in this room */
  clientIds: string[];
  /** Optional room metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Types of WebSocket event handlers
 */
export enum WsHandlerType {
  /** Handler for client connection */
  CONNECT = 'connect',
  /** Handler for client disconnection */
  DISCONNECT = 'disconnect',
  /** Handler for joining a room */
  JOIN_ROOM = 'joinRoom',
  /** Handler for leaving a room */
  LEAVE_ROOM = 'leaveRoom',
  /** Handler for incoming messages */
  MESSAGE = 'message',
}

/**
 * Types of WebSocket handler parameters
 */
export enum WsParamType {
  /** Client data (WsClientData) */
  CLIENT = 'client',
  /** Raw WebSocket (ServerWebSocket) */
  SOCKET = 'socket',
  /** Message data payload */
  MESSAGE_DATA = 'messageData',
  /** Room name string */
  ROOM_NAME = 'roomName',
  /** Pattern parameters extracted from event/room name */
  PATTERN_PARAMS = 'patternParams',
  /** WebSocket server reference */
  SERVER = 'server',
}

/**
 * Metadata for a handler parameter
 */
export interface WsParamMetadata {
  /** Type of parameter */
  type: WsParamType;
  /** Property path for extracting nested data */
  property?: string;
  /** Parameter index in handler function */
  index: number;
}

/**
 * Metadata for a WebSocket handler method
 */
export interface WsHandlerMetadata {
  /** Type of handler */
  type: WsHandlerType;
  /** Pattern for matching events/rooms (supports wildcards and parameters) */
  pattern?: string;
  /** Handler method name */
  handler: string;
  /** Handler parameters metadata */
  params: WsParamMetadata[];
  /** Guard functions to apply */
  guards?: Function[];
}

/**
 * Metadata for a WebSocket Gateway class
 */
export interface GatewayMetadata {
  /** Path for WebSocket connection */
  path: string;
  /** Namespace for isolating gateways */
  namespace?: string;
  /** List of handlers in this gateway */
  handlers: WsHandlerMetadata[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Options for @WebSocketGateway decorator
 */
export interface WebSocketGatewayOptions {
  /** Path for WebSocket connection (default: '/') */
  path?: string;
  /** Namespace for isolating gateways */
  namespace?: string;
}

/**
 * Storage type for WebSocket state
 */
export type WsStorageType = 'memory' | 'redis';

/**
 * Options for WebSocket storage
 */
export interface WsStorageOptions {
  /** Storage type */
  type: WsStorageType;
  /** Redis-specific options */
  redis?: {
    /** Redis connection URL */
    url: string;
    /** Key prefix for Redis keys */
    prefix?: string;
  };
}

/**
 * WebSocket configuration for OneBunApplication
 */
export interface WebSocketApplicationOptions {
  /** Enable/disable WebSocket (default: auto - enabled if gateways exist) */
  enabled?: boolean;
  /** Storage options */
  storage?: WsStorageOptions;
  /** Ping interval in milliseconds for heartbeat (socket.io) */
  pingInterval?: number;
  /** Ping timeout in milliseconds (socket.io) */
  pingTimeout?: number;
  /** Maximum payload size in bytes */
  maxPayload?: number;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Standard WebSocket message format (socket.io compatible)
 */
export interface WsMessage<T = unknown> {
  /** Event name */
  event: string;
  /** Message data */
  data: T;
  /** Acknowledgement ID (for request-response pattern) */
  ack?: number;
}

/**
 * Response from a handler
 */
export interface WsHandlerResponse<T = unknown> {
  /** Event name to send back */
  event: string;
  /** Response data */
  data: T;
}

// ============================================================================
// Pattern Matching Types
// ============================================================================

/**
 * Result of pattern matching
 */
export interface PatternMatch {
  /** Whether the pattern matched */
  matched: boolean;
  /** Extracted parameters from pattern */
  params: Record<string, string>;
}

// ============================================================================
// Guard Types
// ============================================================================

/**
 * Execution context for WebSocket guards
 */
export interface WsExecutionContext {
  /** Get client data */
  getClient(): WsClientData;
  /** Get raw socket */
  getSocket(): ServerWebSocket<WsClientData>;
  /** Get message data */
  getData<T = unknown>(): T;
  /** Get handler metadata */
  getHandler(): WsHandlerMetadata;
  /** Get pattern match params */
  getPatternParams(): Record<string, string>;
}

/**
 * Interface for WebSocket guards
 */
export interface WsGuard {
  /**
   * Determine if the request should be allowed
   * @param context - Execution context
   * @returns Whether to allow the request
   */
  canActivate(context: WsExecutionContext): boolean | Promise<boolean>;
}

// ============================================================================
// Server Types
// ============================================================================

/**
 * WebSocket server reference
 */
export interface WsServer {
  /** Bun server instance */
  server: Server;
  /** Publish message to a topic */
  publish(topic: string, message: string | Buffer): void;
  /** Get subscriber count for a topic */
  subscriberCount(topic: string): number;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if value is a valid WsMessage
 */
export function isWsMessage(value: unknown): value is WsMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'event' in value &&
    typeof (value as WsMessage).event === 'string'
  );
}

/**
 * Check if value is a valid WsHandlerResponse
 */
export function isWsHandlerResponse(value: unknown): value is WsHandlerResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'event' in value &&
    typeof (value as WsHandlerResponse).event === 'string' &&
    'data' in value
  );
}

/**
 * Check if value is a valid WsClientData
 */
export function isWsClientData(value: unknown): value is WsClientData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as WsClientData).id === 'string' &&
    'rooms' in value &&
    Array.isArray((value as WsClientData).rooms) &&
    'connectedAt' in value &&
    typeof (value as WsClientData).connectedAt === 'number'
  );
}

/**
 * Check if value is a valid WsRoom
 */
export function isWsRoom(value: unknown): value is WsRoom {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as WsRoom).name === 'string' &&
    'clientIds' in value &&
    Array.isArray((value as WsRoom).clientIds)
  );
}
