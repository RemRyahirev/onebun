/**
 * Socket.IO Protocol Implementation
 *
 * Implements Engine.IO and Socket.IO protocols for compatibility with socket.io-client.
 * Based on:
 * - Engine.IO Protocol: https://socket.io/docs/v4/engine-io-protocol/
 * - Socket.IO Protocol: https://socket.io/docs/v4/socket-io-protocol/
 */

// ============================================================================
// Engine.IO Types
// ============================================================================

/**
 * Engine.IO packet types
 */
export enum EngineIOPacketType {
  OPEN = 0,
  CLOSE = 1,
  PING = 2,
  PONG = 3,
  MESSAGE = 4,
  UPGRADE = 5,
  NOOP = 6,
}

/**
 * Engine.IO packet
 */
export interface EngineIOPacket {
  type: EngineIOPacketType;
  data?: string | Buffer;
}

/**
 * Engine.IO handshake data (sent with OPEN packet)
 */
export interface EngineIOHandshake {
  /** Session ID */
  sid: string;
  /** Available upgrades (always ['websocket'] for our implementation) */
  upgrades: string[];
  /** Ping interval in milliseconds */
  pingInterval: number;
  /** Ping timeout in milliseconds */
  pingTimeout: number;
  /** Maximum payload size */
  maxPayload: number;
}

// ============================================================================
// Socket.IO Types
// ============================================================================

/**
 * Socket.IO packet types
 */
export enum SocketIOPacketType {
  CONNECT = 0,
  DISCONNECT = 1,
  EVENT = 2,
  ACK = 3,
  CONNECT_ERROR = 4,
  BINARY_EVENT = 5,
  BINARY_ACK = 6,
}

/**
 * Socket.IO packet
 */
export interface SocketIOPacket {
  type: SocketIOPacketType;
  /** Namespace */
  nsp: string;
  /** Event data (for EVENT and ACK types) */
  data?: unknown[];
  /** Acknowledgement ID */
  id?: number;
}

/**
 * Socket.IO connect error data
 */
export interface SocketIOConnectError {
  message: string;
  data?: unknown;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_PING_INTERVAL = 25000; // 25 seconds
export const DEFAULT_PING_TIMEOUT = 20000; // 20 seconds
export const DEFAULT_MAX_PAYLOAD = 1024 * 1024; // 1 MB

// ============================================================================
// Engine.IO Protocol
// ============================================================================

/**
 * Encode an Engine.IO packet
 */
export function encodeEngineIOPacket(packet: EngineIOPacket): string {
  if (packet.data === undefined) {
    return String(packet.type);
  }
  if (typeof packet.data === 'string') {
    return String(packet.type) + packet.data;
  }

  // Buffer data - convert to base64
  return String(packet.type) + 'b' + packet.data.toString('base64');
}

/**
 * Decode an Engine.IO packet
 */
export function decodeEngineIOPacket(data: string | Buffer): EngineIOPacket {
  const str = typeof data === 'string' ? data : data.toString();
  
  if (str.length === 0) {
    return { type: EngineIOPacketType.NOOP };
  }

  const type = parseInt(str.charAt(0), 10) as EngineIOPacketType;
  
  if (str.length === 1) {
    return { type };
  }

  const packetData = str.substring(1);
  
  // Check for binary data (starts with 'b')
  if (packetData.charAt(0) === 'b') {
    return {
      type,
      data: Buffer.from(packetData.substring(1), 'base64'),
    };
  }

  return { type, data: packetData };
}

/**
 * Create handshake data for new connection
 */
export function createHandshake(
  sid: string,
  options?: Partial<EngineIOHandshake>,
): EngineIOHandshake {
  return {
    sid,
    upgrades: ['websocket'],
    pingInterval: options?.pingInterval ?? DEFAULT_PING_INTERVAL,
    pingTimeout: options?.pingTimeout ?? DEFAULT_PING_TIMEOUT,
    maxPayload: options?.maxPayload ?? DEFAULT_MAX_PAYLOAD,
  };
}

/**
 * Create OPEN packet with handshake data
 */
export function createOpenPacket(handshake: EngineIOHandshake): string {
  return encodeEngineIOPacket({
    type: EngineIOPacketType.OPEN,
    data: JSON.stringify(handshake),
  });
}

/**
 * Create PING packet
 */
export function createPingPacket(data?: string): string {
  return encodeEngineIOPacket({
    type: EngineIOPacketType.PING,
    data,
  });
}

/**
 * Create PONG packet
 */
export function createPongPacket(data?: string): string {
  return encodeEngineIOPacket({
    type: EngineIOPacketType.PONG,
    data,
  });
}

// ============================================================================
// Socket.IO Protocol
// ============================================================================

/**
 * Encode a Socket.IO packet
 */
export function encodeSocketIOPacket(packet: SocketIOPacket): string {
  let str = String(packet.type);

  // Add namespace if not default
  if (packet.nsp && packet.nsp !== '/') {
    str += packet.nsp + ',';
  }

  // Add acknowledgement ID
  if (packet.id !== undefined) {
    str += String(packet.id);
  }

  // Add data
  if (packet.data !== undefined) {
    str += JSON.stringify(packet.data);
  }

  return str;
}

/**
 * Decode a Socket.IO packet
 */
export function decodeSocketIOPacket(data: string): SocketIOPacket {
  let i = 0;

  // Parse type
  const type = parseInt(data.charAt(i++), 10) as SocketIOPacketType;

  // Parse namespace
  let nsp = '/';
  if (data.charAt(i) === '/') {
    const start = i;
    while (i < data.length && data.charAt(i) !== ',') {
      i++;
    }
    nsp = data.substring(start, i);
    i++; // Skip comma
  }

  // Parse acknowledgement ID
  let id: number | undefined;
  if (i < data.length) {
    const start = i;
    while (i < data.length && !isNaN(parseInt(data.charAt(i), 10))) {
      i++;
    }
    if (start !== i) {
      id = parseInt(data.substring(start, i), 10);
    }
  }

  // Parse data
  let packetData: unknown[] | undefined;
  if (i < data.length) {
    try {
      packetData = JSON.parse(data.substring(i));
    } catch {
      // Invalid JSON, ignore data
    }
  }

  return {
    type, nsp, id, data: packetData, 
  };
}

/**
 * Create Socket.IO CONNECT packet
 */
export function createConnectPacket(nsp: string = '/', authData?: unknown): string {
  const packet: SocketIOPacket = {
    type: SocketIOPacketType.CONNECT,
    nsp,
  };
  
  if (authData !== undefined) {
    packet.data = [authData];
  }

  return encodeSocketIOPacket(packet);
}

/**
 * Create Socket.IO DISCONNECT packet
 */
export function createDisconnectPacket(nsp: string = '/'): string {
  return encodeSocketIOPacket({
    type: SocketIOPacketType.DISCONNECT,
    nsp,
  });
}

/**
 * Create Socket.IO EVENT packet
 */
export function createEventPacket(
  event: string,
  data: unknown,
  nsp: string = '/',
  ackId?: number,
): string {
  const packet: SocketIOPacket = {
    type: SocketIOPacketType.EVENT,
    nsp,
    data: [event, data],
    id: ackId,
  };

  return encodeSocketIOPacket(packet);
}

/**
 * Create Socket.IO ACK packet
 */
export function createAckPacket(ackId: number, data: unknown, nsp: string = '/'): string {
  return encodeSocketIOPacket({
    type: SocketIOPacketType.ACK,
    nsp,
    id: ackId,
    data: Array.isArray(data) ? data : [data],
  });
}

/**
 * Create Socket.IO CONNECT_ERROR packet
 */
export function createConnectErrorPacket(
  error: SocketIOConnectError,
  nsp: string = '/',
): string {
  return encodeSocketIOPacket({
    type: SocketIOPacketType.CONNECT_ERROR,
    nsp,
    data: [error],
  });
}

// ============================================================================
// Combined Message Handling
// ============================================================================

/**
 * Wrap Socket.IO packet in Engine.IO MESSAGE packet
 */
export function wrapInEngineIO(socketIOPacket: string): string {
  return encodeEngineIOPacket({
    type: EngineIOPacketType.MESSAGE,
    data: socketIOPacket,
  });
}

/**
 * Extract Socket.IO packet from Engine.IO MESSAGE packet
 */
export function unwrapFromEngineIO(engineIOPacket: string): string | null {
  const decoded = decodeEngineIOPacket(engineIOPacket);
  
  if (decoded.type !== EngineIOPacketType.MESSAGE || typeof decoded.data !== 'string') {
    return null;
  }

  return decoded.data;
}

/**
 * Parse incoming message (Engine.IO wrapped Socket.IO)
 */
export function parseMessage(
  data: string | Buffer,
): { engineIO: EngineIOPacket; socketIO?: SocketIOPacket } {
  const engineIO = decodeEngineIOPacket(data);
  
  if (engineIO.type === EngineIOPacketType.MESSAGE && typeof engineIO.data === 'string') {
    const socketIO = decodeSocketIOPacket(engineIO.data);

    return { engineIO, socketIO };
  }

  return { engineIO };
}

/**
 * Create full message (Engine.IO + Socket.IO) for sending event
 */
export function createFullEventMessage(
  event: string,
  eventData: unknown,
  nsp: string = '/',
  ackId?: number,
): string {
  const socketIOPacket = createEventPacket(event, eventData, nsp, ackId);

  return wrapInEngineIO(socketIOPacket);
}

/**
 * Create full message for acknowledgement
 */
export function createFullAckMessage(
  ackId: number,
  data: unknown,
  nsp: string = '/',
): string {
  const socketIOPacket = createAckPacket(ackId, data, nsp);

  return wrapInEngineIO(socketIOPacket);
}

// ============================================================================
// HTTP Polling Support (for Engine.IO)
// ============================================================================

/**
 * Parse Engine.IO HTTP request query parameters
 */
export function parseEngineIOQuery(url: URL): {
  EIO: string;
  transport: string;
  sid?: string;
  t?: string;
  b64?: boolean;
} {
  return {
    EIO: url.searchParams.get('EIO') || '4',
    transport: url.searchParams.get('transport') || 'polling',
    sid: url.searchParams.get('sid') || undefined,
    t: url.searchParams.get('t') || undefined,
    b64: url.searchParams.get('b64') === '1',
  };
}

/**
 * Check if request is Engine.IO polling request
 */
export function isPollingRequest(url: URL, basePath: string = '/socket.io'): boolean {
  return url.pathname.startsWith(basePath) && 
         url.searchParams.get('transport') === 'polling';
}

/**
 * Check if request is Engine.IO websocket upgrade
 */
export function isWebSocketUpgrade(url: URL, basePath: string = '/socket.io'): boolean {
  return url.pathname.startsWith(basePath) && 
         url.searchParams.get('transport') === 'websocket';
}

/**
 * Create polling response with multiple packets
 */
export function createPollingResponse(packets: string[]): string {
  // Concatenate packets with length prefix
  return packets.map((p) => `${p.length}:${p}`).join('');
}

/**
 * Parse polling request body with multiple packets
 */
export function parsePollingRequest(body: string): string[] {
  const packets: string[] = [];
  let i = 0;

  while (i < body.length) {
    // Find length separator
    const colonIndex = body.indexOf(':', i);
    if (colonIndex === -1) {
      break;
    }

    const length = parseInt(body.substring(i, colonIndex), 10);
    const start = colonIndex + 1;
    const end = start + length;

    packets.push(body.substring(start, end));
    i = end;
  }

  return packets;
}

// ============================================================================
// Native WebSocket Message Handling (non-Socket.IO)
// ============================================================================

/**
 * Simple message format for native WebSocket clients
 */
export interface NativeWsMessage<T = unknown> {
  event: string;
  data: T;
  ack?: number;
}

/**
 * Check if message is in native format
 */
export function isNativeMessage(data: string): boolean {
  try {
    const parsed = JSON.parse(data);

    return typeof parsed === 'object' && 
           parsed !== null && 
           'event' in parsed &&
           typeof parsed.event === 'string';
  } catch {
    return false;
  }
}

/**
 * Parse native WebSocket message
 */
export function parseNativeMessage(data: string): NativeWsMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed === 'object' && 
        parsed !== null && 
        'event' in parsed &&
        typeof parsed.event === 'string') {
      return parsed as NativeWsMessage;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Create native WebSocket message
 */
export function createNativeMessage<T>(event: string, data: T, ack?: number): string {
  const message: NativeWsMessage<T> = { event, data };
  if (ack !== undefined) {
    message.ack = ack;
  }

  return JSON.stringify(message);
}

// ============================================================================
// Protocol Detection
// ============================================================================

/**
 * Detected protocol type
 */
export type ProtocolType = 'socket.io' | 'native';

/**
 * Detect which protocol is being used
 */
export function detectProtocol(data: string | Buffer): ProtocolType {
  const str = typeof data === 'string' ? data : data.toString();

  // Socket.IO messages start with a digit (packet type)
  if (/^\d/.test(str)) {
    return 'socket.io';
  }

  // Try to parse as native JSON
  if (isNativeMessage(str)) {
    return 'native';
  }

  // Default to socket.io
  return 'socket.io';
}
