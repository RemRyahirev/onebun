/**
 * Base WebSocket Gateway
 *
 * Abstract base class for WebSocket gateways.
 * Provides methods for client/room management and message broadcasting.
 */

import type {
  WsStorageAdapter,
  WsPubSubStorageAdapter,
  WsStorageEventPayload,
} from './ws-storage';
import type {
  WsClientData,
  WsRoom,
  WsServer,
} from './ws.types';
import type { IConfig, OneBunAppConfig } from '../module/config.interface';
import type { GlobalScope } from '../module/module';
import type { Server, ServerWebSocket } from 'bun';


import type { SyncLogger } from '@onebun/logger';

import { createFullEventMessage, createNativeMessage } from './ws-socketio-protocol';
import { WsStorageEvent, isPubSubAdapter } from './ws-storage';

/**
 * Clear all client sockets (for testing purposes only)
 *
 * @deprecated A no-op since sockets became per-gateway state: there is no process-wide map left
 * to clear, and a gateway's own map goes away with the gateway. Kept because it is reachable
 * from the package root, so removing it is a breaking export change.
 * @internal
 */
export function _resetClientSocketsForTesting(): void {
  // Intentionally empty — see the deprecation note.
}

/**
 * Base class for WebSocket gateways.
 *
 * Gateways extending this class have `this.config` and `this.logger` available
 * immediately after `super()` in the constructor when created through the framework DI.
 * The framework sets an ambient init context before calling the constructor, and
 * BaseWebSocketGateway reads from it in its constructor.
 *
 * @example
 * ```typescript
 * @WebSocketGateway({ path: '/ws' })
 * export class ChatGateway extends BaseWebSocketGateway {
 *   constructor() {
 *     super();
 *     // this.config and this.logger are available here!
 *   }
 *
 *   @OnMessage('chat:message')
 *   handleMessage(@Client() client: WsClientData, @MessageData() data: any) {
 *     this.broadcast('chat:message', { userId: client.id, ...data });
 *   }
 * }
 * ```
 * @see docs:api/websocket.md
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

  /**
   * The connections THIS gateway admitted.
   *
   * This used to be one module-level `Map` shared by every gateway in the process, so a client
   * of one gateway appeared in another's `clients`, received its `broadcast()`, and — because
   * dispatch looped every gateway too — invoked its message handlers. Measured: a client of a
   * public `/chat` gateway ran an admin gateway's handler and received its broadcast.
   *
   * The gateway is BORN with this map so a hand-constructed gateway (which the tests do) works
   * with no handler in sight. `_attachSockets` replaces the reference with the handler's map for
   * the same key, so the two hold one object and `WsHandler.cleanup()` can empty it.
   * @internal
   */
  private ownSockets = new Map<string, ServerWebSocket<WsClientData>>();

  /**
   * This gateway's registry key — its path, or `path:namespace`.
   *
   * Set when the handler attaches the socket map. `undefined` for a gateway nobody registered,
   * which is what keeps a hand-constructed gateway readable in tests.
   */
  private gatewayKey?: string;

  /** The unkeyed-frame notice is given once per gateway, not once per message. */
  private unkeyedFrameReported = false;

  /** The same, for the publishing side. */
  private unkeyedPublishReported = false;

  /**
   * Resolves once this gateway's pub/sub subscription is established (or has failed).
   * @internal
   */
  pubSubReady?: Promise<void>;

  /**
   * Detaches THIS gateway's pub/sub handler.
   *
   * `unsubscribe()` on the adapter drops every handler, and the adapter is shared by every
   * gateway in the application — using it to detach one would silence the rest.
   * @internal
   */
  private pubSubDispose?: () => void;

  /** Stop receiving remote events, without affecting sibling gateways. @internal */
  _detachPubSub(): void {
    this.pubSubDispose?.();
    this.pubSubDispose = undefined;
  }

  /**
   * Share the handler's socket map for this gateway's key.
   *
   * Called once at registration. Anything already registered directly on the instance is carried
   * over, so the order of registration and connection does not matter.
   * @internal
   */
  _attachSockets(
    key: string,
    sockets: Map<string, ServerWebSocket<WsClientData>>,
    registeredGateways?: () => number,
  ): void {
    this.gatewayKey = key;
    this.registeredGateways = registeredGateways;
    for (const [clientId, socket] of this.ownSockets) {
      sockets.set(clientId, socket);
    }
    this.ownSockets = sockets;
  }

  /**
   * How many gateways this application registered. Read on demand — registration is one at a
   * time, so a count taken at attach would say "one" to whoever went first.
   */
  private registeredGateways?: () => number;

  /**
   * Whether this application has exactly one gateway, so nothing unkeyed can be ambiguous.
   *
   * This is what is left of two compatibility escapes. A client record and a pub/sub payload both
   * carry the key of the gateway they belong to, and both readers used to ACCEPT anything that
   * carried none, so an instance running a build from before the key stayed interoperable. But
   * accepting IS the leak the key was added to close: measured, one unkeyed frame arriving at a
   * two-gateway instance was delivered to `/chat` and `/admin` alike.
   *
   * With one gateway there is nothing to leak to and the answer is not in doubt; with more than
   * one it is a guess. `WsHandler.ownerAtOpen` already refuses to guess on exactly this
   * condition — the same rule, applied to the other two readers.
   */
  private soleGateway(): boolean {
    return this.registeredGateways?.() === 1;
  }

  /**
   * Whether this gateway may see a client record.
   *
   * Storage is shared by every gateway in the application and rooms are keyed by name alone, so
   * a read went straight to another gateway's data: measured, `getClientsByRoom` on a room only
   * `/admin` ever touched returned the full record of an `/admin` client — `auth`, `metadata`
   * and all. The socket fence stopped messages crossing; it never stopped reads.
   *
   * Two deliberate escapes. A gateway with no key of its own (constructed by hand, never
   * registered) filters nothing — it has no identity to compare against. And a record with no key
   * is accepted where it cannot be ambiguous: an application with exactly one gateway. That
   * second escape used to be unconditional, which made a keyless record EVERYBODY's — the
   * opposite of what the key is for, and reachable from user code, since `storage` is protected
   * and any caller can write a record without one.
   */
  protected _owns(client: WsClientData | null | undefined): boolean {
    if (!client) {
      return false;
    }

    return this.gatewayKey === undefined
      || (client.gatewayKey === undefined && this.soleGateway())
      || client.gatewayKey === this.gatewayKey;
  }

  /** Flag to track initialization status */
  private _initialized = false;

  /**
   * Ambient init context set by the framework before gateway construction.
   * This allows the BaseWebSocketGateway constructor to pick up logger and config
   * so they are available immediately after super() in subclass constructors.
   * @internal
   */
  private static _initContext: {
    logger: SyncLogger;
    config: IConfig<OneBunAppConfig>;
    scope?: GlobalScope;
  } | null = null;

  /**
   * Set the ambient init context before constructing a gateway.
   * Called by the framework (OneBunModule) before `new GatewayClass(...)`.
   * @internal
   */
  static setInitContext(
    logger: SyncLogger,
    config: IConfig<OneBunAppConfig>,
    scope?: GlobalScope,
  ): void {
    BaseWebSocketGateway._initContext = { logger, config, scope };
  }

  /**
   * Clear the ambient init context after gateway construction.
   * Called by the framework (OneBunModule) after `new GatewayClass(...)`.
   * @internal
   */
  static clearInitContext(): void {
    BaseWebSocketGateway._initContext = null;
  }

  constructor() {
    // Pick up logger and config from ambient init context if available.
    // This makes this.config and this.logger available immediately after super()
    // in subclass constructors.
    if (BaseWebSocketGateway._initContext) {
      const { logger, config } = BaseWebSocketGateway._initContext;
      const className = this.constructor.name;
      this.logger = logger.child({ className });
      this.config = config;
      this._initialized = true;
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the gateway with logger and config.
   * This is a fallback for gateways not constructed through the DI system
   * (e.g., in tests or when created manually). If the gateway was already
   * initialized via the constructor init context, this is a no-op.
   * Called internally by the framework during DI.
   * @internal
   */
  _initializeBase(logger: SyncLogger, config: IConfig<OneBunAppConfig>): void {
    if (this._initialized) {
      return; // Already initialized (via constructor or previous call)
    }

    const className = this.constructor.name;
    this.logger = logger.child({ className });
    this.config = config;
    this._initialized = true;
  }

  /**
   * Initialize the gateway with storage and server
   * Called internally by the framework
   * @internal
   */
  _initialize(storage: WsStorageAdapter, server: Server<WsClientData>): void {
    this.storage = storage;
    this.server = server;

    // Subscribe to pub/sub events if Redis storage. Kept so a failure is a logged error
    // rather than an unhandled rejection, and so a test has something to await.
    if (isPubSubAdapter(storage)) {
      this.pubSubReady = this._setupPubSub(storage).catch((error: unknown) => {
        this.logger?.error(
          'WebSocket pub/sub subscription failed; this gateway will not receive remote events',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }
  }

  /**
   * Setup pub/sub for multi-instance support
   * @internal
   */
  private async _setupPubSub(storage: WsPubSubStorageAdapter): Promise<void> {
    this.pubSubDispose = await storage.subscribe((payload) => {
      // Ignore events from this instance
      if (payload.sourceInstanceId === this.instanceId) {
        return;
      }

      // Ignore events published by a DIFFERENT gateway. `sourceInstanceId` is minted per
      // gateway, not per process, so without this a publish loops back through Redis and the
      // sibling gateway in the same process replays it to clients that never belonged to the
      // publisher — measured, one /chat broadcast reaching every /admin client on every
      // instance.
      //
      // A frame with no key comes from a build that predates the key. It is accepted only where
      // it cannot be ambiguous — an application with one gateway — and refused otherwise:
      // accepting it unconditionally re-opened the very leak above, measured as one unkeyed
      // frame delivered to both /chat and /admin. Said once either way, so a rolling deploy is
      // neither silent nor noisy.
      if (payload.gatewayKey === undefined) {
        const accepted = this.soleGateway();
        if (!this.unkeyedFrameReported) {
          this.unkeyedFrameReported = true;
          this.logger?.warn(
            accepted
              ? 'Received a WebSocket pub/sub frame with no gateway key. It is being accepted '
                + 'because this application has a single gateway, so there is nothing it could be '
                + 'confused with. This happens while instances running different versions share '
                + 'one Redis; it should stop once the rollout completes.'
              : 'Refused a WebSocket pub/sub frame with no gateway key. This application has more '
                + 'than one gateway, so there is no way to tell which one the frame belongs to, '
                + 'and delivering it would reach clients of a gateway that did not publish it. '
                + 'This happens while instances running different versions share one Redis.',
          );
        }

        if (!accepted) {
          return;
        }
      } else if (payload.gatewayKey !== this.gatewayKey) {
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
    this.ownSockets.set(clientId, socket);
  }

  /**
   * Unregister a client socket
   * @internal
   */
  _unregisterSocket(clientId: string): void {
    this.ownSockets.delete(clientId);
  }

  /**
   * Get socket for a client
   * @internal
   */
  protected getSocket(clientId: string): ServerWebSocket<WsClientData> | undefined {
    return this.ownSockets.get(clientId);
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
    for (const [id, socket] of this.ownSockets) {
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
    // Built from this gateway's own sockets, like `clients` — local to this instance and to
    // this gateway. It used to return an empty Map unconditionally, with a comment pointing at
    // a `getRoomsAsync()` that exists nowhere in the framework.
    const result = new Map<string, WsRoom>();

    for (const [clientId, socket] of this.ownSockets) {
      for (const roomName of socket.data?.rooms ?? []) {
        const room = result.get(roomName) ?? { name: roomName, clientIds: [] };
        room.clientIds.push(clientId);
        result.set(roomName, room);
      }
    }

    return result;
  }

  /**
   * Get a client by ID
   */
  async getClient(clientId: string): Promise<WsClientData | undefined> {
    if (!this.storage) {
      return undefined;
    }
    // A local socket answers without a storage round trip; either way the record has to be
    // one this gateway may see.
    const client = this.ownSockets.get(clientId)?.data ?? await this.storage.getClient(clientId);

    return this._owns(client) ? client ?? undefined : undefined;
  }

  /**
   * Get a room by name
   */
  async getRoom(roomName: string): Promise<WsRoom | undefined> {
    if (!this.storage) {
      return undefined;
    }
    const room = await this.storage.getRoom(roomName);
    if (!room) {
      return undefined;
    }

    const mine = await this._ownedMembers(room.clientIds);

    // A room is visible when at least one member is ours, and it shows only those members.
    // Before, `getRoom` on a room only another gateway ever touched returned its exact
    // membership.
    return mine.length > 0 ? { ...room, clientIds: mine } : undefined;
  }

  /**
   * Get all clients in a room
   */
  async getClientsByRoom(roomName: string): Promise<WsClientData[]> {
    if (!this.storage) {
      return [];
    }
    const clientIds = await this.storage.getClientsInRoom(roomName);
    const resolved = await Promise.all(clientIds.map(async (id) => (
      this.ownSockets.get(id)?.data ?? await this.storage?.getClient(id)
    )));

    return resolved.filter((client): client is WsClientData => !!client && this._owns(client));
  }

  /**
   * Get all rooms matching a pattern
   */
  async getRoomsByPattern(pattern: string): Promise<WsRoom[]> {
    if (!this.storage) {
      return [];
    }

    const rooms = await this.storage.getRoomsByPattern(pattern);
    const visible: WsRoom[] = [];

    for (const room of rooms) {
      const mine = await this._ownedMembers(room.clientIds);
      if (mine.length > 0) {
        visible.push({ ...room, clientIds: mine });
      }
    }

    // `emitToRoomPattern` and `disconnectRoomPattern` enumerate through here, so they inherit
    // the fence rather than each needing their own.
    return visible;
  }

  /**
   * The members of a room this gateway may see.
   *
   * A member with no local socket costs a storage round trip to read its owning gateway off its
   * record; concurrently rather than one after another, because in a fleet most members of a
   * room belong to other instances and the wait was the whole cost.
   */
  private async _ownedMembers(clientIds: string[]): Promise<string[]> {
    const owned = await Promise.all(clientIds.map(async (id) => (
      this._owns(this.ownSockets.get(id)?.data ?? await this.storage?.getClient(id)) ? id : null
    )));

    return owned.filter((id): id is string => id !== null);
  }

  // ============================================================================
  // Emit Methods
  // ============================================================================

  /**
   * Send a message to a specific client
   */
  emit(clientId: string, event: string, data: unknown): void {
    this._localEmit(clientId, event, data);

    this._publishRemote({
      type: WsStorageEvent.CLIENT_MESSAGE,
      data: { clientId, event, message: data },
    });
  }

  /**
   * Publish an event for the other instances of this application.
   *
   * One place for all three publishers, so the warning below cannot be added to two of them and
   * forgotten on the third. A gateway that was never registered has no key to stamp, and a
   * subscriber with more than one gateway now refuses an unkeyed frame — so without this the
   * events would reach nothing, with nothing said.
   */
  private _publishRemote(
    payload: Omit<WsStorageEventPayload, 'sourceInstanceId' | 'gatewayKey'>,
  ): void {
    if (!this.storage || !isPubSubAdapter(this.storage)) {
      return;
    }

    if (this.gatewayKey === undefined && !this.unkeyedPublishReported) {
      this.unkeyedPublishReported = true;
      this.logger?.warn(
        `${this.constructor.name} is publishing WebSocket events with no gateway key, because it `
        + 'was never registered with a WsHandler. An instance running more than one gateway '
        + 'refuses a frame it cannot attribute, so these events reach nothing there.',
      );
    }

    void this.storage.publish({
      ...payload,
      sourceInstanceId: this.instanceId,
      gatewayKey: this.gatewayKey,
    }).catch((error: unknown) => {
      this.logger?.error(
        'Failed to publish a WebSocket event to the other instances',
        error instanceof Error ? error : new Error(String(error)),
      );
    });
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
    const socket = this.ownSockets.get(clientId);
    if (socket) {
      socket.send(this._encodeMessage(socket.data.protocol, event, data));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(event: string, data: unknown, excludeClientIds?: string[]): void {
    this._localBroadcast(event, data, excludeClientIds);

    this._publishRemote({
      type: WsStorageEvent.BROADCAST,
      data: { event, message: data, excludeClientIds },
    });
  }

  /**
   * Broadcast to local clients only
   * @internal
   */
  private _localBroadcast(event: string, data: unknown, excludeClientIds?: string[]): void {
    const excludeSet = new Set(excludeClientIds || []);

    for (const [clientId, socket] of this.ownSockets) {
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

    this._publishRemote({
      type: WsStorageEvent.ROOM_BROADCAST,
      data: {
        roomName, event, message: data, excludeClientIds,
      },
    });
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
        const socket = this.ownSockets.get(clientId);
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
    if (!this.storage) {
      return;
    }

    const memberships = await Promise.all(
      roomNames.map(async (roomName) => await this.storage!.getClientsInRoom(roomName)),
    );

    this._sendToClients(memberships.flat(), event, data, excludeClientIds);
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
    if (!this.storage) {
      return;
    }

    // Straight to storage, not through this gateway's own `getRoomsByPattern`. That one resolves
    // every member's record to decide whether the ROOM is visible here — one round trip per
    // member, and in a fleet most members belong to other instances. The fence on this path is
    // `ownSockets`: every send below goes to a socket this gateway admitted, so resolving a
    // remote member changes nothing except the bill. Measured, 50 rooms of 20 members cost 1151
    // commands, of which 1000 were those lookups and 100 were each member set fetched twice.
    const rooms = await this.storage.getRoomsByPattern(pattern);

    this._sendToClients(rooms.flatMap((room) => room.clientIds), event, data, excludeClientIds);
  }

  /** Send one message to whichever of these clients this gateway holds a socket for. */
  private _sendToClients(
    clientIds: string[],
    event: string,
    data: unknown,
    excludeClientIds?: string[],
  ): void {
    const excluded = new Set(excludeClientIds ?? []);
    const reached = new Set<string>();

    for (const clientId of clientIds) {
      if (excluded.has(clientId) || reached.has(clientId)) {
        continue;
      }

      const socket = this.ownSockets.get(clientId);
      if (socket) {
        reached.add(clientId);
        socket.send(this._encodeMessage(socket.data.protocol, event, data));
      }
    }
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Disconnect a specific client
   */
  disconnectClient(clientId: string, reason?: string): void {
    const socket = this.ownSockets.get(clientId);
    if (socket) {
      socket.close(1000, reason || 'Disconnected by server');
    }
  }

  /**
   * Disconnect all clients
   */
  disconnectAll(reason?: string): void {
    for (const [_, socket] of this.ownSockets) {
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
    if (!this.storage) {
      return;
    }

    // Same reasoning as `emitToRoomPattern`: `disconnectClient` only closes a socket this
    // gateway holds, so the membership the pattern lookup already returned is enough — no need
    // to resolve every member's record, nor to fetch each room's member set a second time.
    const rooms = await this.storage.getRoomsByPattern(pattern);
    for (const clientId of new Set(rooms.flatMap((room) => room.clientIds))) {
      this.disconnectClient(clientId, reason);
    }
  }

  // ============================================================================
  // Room Management
  // ============================================================================

  /**
   * The native pub/sub topic this gateway uses for a room.
   *
   * Bun's topics are a process-wide namespace and the framework subscribes sockets to the raw
   * room name, so two gateways with a colliding room name share a topic. The raw subscription
   * stays — a user's own `getWsServer().publish('lobby', …)` must keep working exactly as it
   * does — and this is the scoped one that {@link publishToRoom} addresses.
   */
  protected roomTopic(roomName: string): string {
    return this.gatewayKey === undefined ? roomName : `${this.gatewayKey}::${roomName}`;
  }

  /**
   * Fan a message out to a room through Bun's native pub/sub, scoped to this gateway.
   *
   * The difference from {@link emitToRoom}: that one walks this gateway's own sockets and sends
   * to each; this hands the fan-out to the runtime in a single call. Both reach only the
   * connections this gateway admitted — unlike `getWsServer().publish(roomName, …)`, which
   * addresses the raw topic shared by the whole process and is documented as unfenced.
   *
   * Local to this instance: it does not publish to Redis for other instances.
   */
  publishToRoom(roomName: string, event: string, data: unknown): void {
    if (!this.server) {
      return;
    }

    // Native fan-out addresses one topic with one payload, so the encoding cannot follow each
    // socket's protocol the way a per-socket send does. Native framing is what a raw
    // `getWsServer().publish()` produces too, so this matches the path it replaces.
    const message = this._encodeMessage('native', event, data);
    this.server.publish(this.roomTopic(roomName), message);
  }

  /**
   * Add a client to a room
   */
  async joinRoom(clientId: string, roomName: string): Promise<void> {
    if (!this.storage) {
      return;
    }
    // Only for a client this gateway admitted. The storage half used to run unconditionally
    // while only the subscribe half was fenced, so one gateway could enrol another's client
    // into a room — a write neither gateway could then see.
    const socket = this.ownSockets.get(clientId);
    if (!socket && !this._owns(await this.storage.getClient(clientId))) {
      return;
    }

    await this.storage.addClientToRoom(clientId, roomName);

    // Both topics: the raw one, because a user's own `getWsServer().publish(roomName, …)`
    // addresses it and must keep working, and the gateway-scoped one that `publishToRoom()`
    // uses so a colliding room name in another gateway cannot be reached by accident.
    if (socket) {
      // `ws.data.rooms` is what `WsRoomGuard` reads and what `rooms` is built from, and this is
      // the only thing that keeps it current. It used to be updated by accident, and only under
      // one adapter: `InMemoryWsStorage` stored a copy that still shared the caller's `rooms`
      // ARRAY, so the push inside `addClientToRoom` landed here. Under Redis nothing shared, so
      // the guard denied a client the storage said was in the room.
      if (!socket.data.rooms.includes(roomName)) {
        socket.data.rooms.push(roomName);
      }

      socket.subscribe(roomName);
      const scoped = this.roomTopic(roomName);
      if (scoped !== roomName) {
        socket.subscribe(scoped);
      }
    }
  }

  /**
   * Remove a client from a room
   */
  async leaveRoom(clientId: string, roomName: string): Promise<void> {
    if (!this.storage) {
      return;
    }
    const socket = this.ownSockets.get(clientId);
    if (!socket && !this._owns(await this.storage.getClient(clientId))) {
      return;
    }

    await this.storage.removeClientFromRoom(clientId, roomName);

    // Also unsubscribe from Bun's native pub/sub topics
    if (socket) {
      // The removal half of the same problem, and the sharper one: the in-memory adapter
      // REASSIGNS `client.rooms` on a leave rather than mutating it, so the room stayed in
      // `ws.data.rooms` and `WsRoomGuard` kept admitting a client the room no longer had.
      socket.data.rooms = socket.data.rooms.filter((room) => room !== roomName);

      socket.unsubscribe(roomName);
      const scoped = this.roomTopic(roomName);
      if (scoped !== roomName) {
        socket.unsubscribe(scoped);
      }
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
