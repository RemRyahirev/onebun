/**
 * WebSocket Handler
 *
 * Handles WebSocket connections and message routing for gateways.
 */

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-magic-numbers */

import {
  SpanKind,
  type Attributes,
  type Tracer,
} from '@opentelemetry/api';

import type { WsStorageAdapter } from './ws-storage';
import type {
  WsClientData,
  WsGuard,
  WsHandlerMetadata,
  WebSocketApplicationOptions,
} from './ws.types';
import type { WsAuthResult, WsHandlerResponse } from './ws.types';
import type { OneBunRequest } from '../types';
import type { Server, ServerWebSocket } from 'bun';

import type { SyncLogger } from '@onebun/logger';

import { awaitBounded } from '../await-bounded';
import { getControllerGuards, getControllerInterceptors } from '../decorators/decorators';
import { getGuardBinding } from '../http-guards/guard-binding';
import { composeInterceptors } from '../interceptors/interceptors';
import { inEntrySpan, inRootTraceScope } from '../trace-scope';

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
/** Answered to an upgrade attempt once shutdown has begun. */
const HTTP_SERVICE_UNAVAILABLE = 503;

/** RFC 6455 "going away": the server is shutting down. What a client should see, not a 1006. */
const WS_GOING_AWAY = 1001;
/** Close code for a connection the framework cannot route: better closed than open and mute. */
const WS_INTERNAL_ERROR_CODE = 1011;

/** How long shutdown waits for the disconnect path of the sockets it just closed. */
const WS_CLOSE_DRAIN_TIMEOUT_MS = 5_000;

const ParamType = WsParamType;
const HandlerType = WsHandlerType;

/**
 * What `executeHandler` returns when a guard denied the invocation.
 *
 * A denial is not `undefined`: `undefined` is also what a handler that returns nothing
 * produces, and the two need different answers to the client. Distinguishing them is what lets
 * `routeMessage` send an error frame back for a denied message and stay silent for a handler
 * that simply had nothing to say.
 */
const GUARD_DENIED = Symbol('onebun:ws:guard-denied');

/**
 * The event name a denied message is reported back on.
 *
 * The socket is NOT closed. One denied message must not tear down a multiplexed connection —
 * the client may hold subscriptions for a dozen other events it is still entitled to — so the
 * denial is reported and the connection carries on.
 */
const GUARD_DENIED_EVENT = 'error';

/**
 * The guards each handler was DECLARED with, before any resolution.
 *
 * `registerGateway` writes resolved instances back into the gateway's handler metadata, and
 * that metadata is a process-wide `Map` keyed by gateway class — so a second registration of
 * the same class (multi-service mode, or a test that boots twice) would read its own previous
 * output back as input: gateway-level guards counted twice, and the second application running
 * guards bound to the FIRST one's DI scope. Recording the declaration once makes registration
 * idempotent and keeps each application's resolution its own.
 */
const declaredHandlerGuards = new WeakMap<WsHandlerMetadata, (Function | WsGuard)[]>();


/**
 * Gateway instance with metadata
 */
interface GatewayInstance {
  instance: BaseWebSocketGateway;
  metadata: ReturnType<typeof getGatewayMetadata>;
  handlers: Map<WsHandlerType, WsHandlerMetadata[]>;
  /** The registry key this gateway is stored under, recorded on every client it admits. */
  key: string;
}

/**
 * The registry key for a gateway's metadata.
 *
 * One function so the key written onto a client at upgrade and the key a gateway is stored
 * under cannot drift apart.
 */
function gatewayKeyFor(metadata: { path: string; namespace?: string } | undefined): string {
  if (!metadata) {
    return '';
  }

  return metadata.namespace ? `${metadata.path}:${metadata.namespace}` : metadata.path;
}

/**
 * WebSocket handler for OneBunApplication
 */
export class WsHandler {
  private storage: WsStorageAdapter;
  private gateways: Map<string, GatewayInstance> = new Map();
  /**
   * One socket map per gateway key, shared by reference with the gateway instance.
   *
   * The handler holds these so `cleanup()` can empty them: a socket whose close callback never
   * arrives — `server.stop(true)` drops it once the close drain times out — would otherwise
   * leave its entry behind with nothing able to reach it.
   */
  private socketsByGateway: Map<string, Map<string, ServerWebSocket<WsClientData>>> = new Map();
  private pingIntervalMs: number;
  private pingTimeoutMs: number;
  private maxPayload: number;
  private pingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private socketioEnabled: boolean;
  private socketioPath: string;

  /**
   * The sockets this handler currently serves.
   *
   * Per handler, deliberately, and not the module-scope map in `ws-base-gateway.ts`: that one is
   * shared by every gateway in the process, so shutting one application down through it would
   * close a sibling application's connections.
   */
  private readonly openSockets = new Set<ServerWebSocket<WsClientData>>();

  /**
   * Set once shutdown has begun, so no new connection is accepted after that point.
   *
   * Not defensive tidiness — required. Clients reconnect by default (`reconnect: true`,
   * `reconnectInterval: 1000`), so the clean close this handler now sends is itself an
   * invitation to reconnect. Without this the socket comes straight back during shutdown and the
   * HTTP drain waits for a connection the server just asked to go away.
   */
  private shuttingDown = false;

  /** Resolved when a socket's close has been fully handled, so shutdown can wait for it. */
  private readonly closeWaiters = new Map<ServerWebSocket<WsClientData>, () => void>();

  constructor(
    private logger: SyncLogger,
    private options: WebSocketApplicationOptions = {},
    /**
     * The owning application's tracer, so a `@Traced` method reached from a socket callback is
     * recorded by THIS application's provider rather than by whichever application happened to
     * register its provider with OpenTelemetry first. Optional: a handler constructed without
     * one behaves exactly as before.
     */
    private ownerTracer?: Tracer,
    /**
     * `tracing.traceWebSocketEvents`. Turns off the per-connection and per-frame span; ownership
     * above is deliberately unaffected, or a `@Traced` method inside a handler would resolve its
     * tracer to whichever application won the process-wide provider slot.
     */
    private traceWebSocketEvents: boolean = true,
  ) {
    this.storage = new InMemoryWsStorage();
    const socketio = options.socketio;
    this.socketioEnabled = socketio?.enabled ?? false;
    this.socketioPath = socketio?.path ?? '/socket.io';
    this.pingIntervalMs = socketio?.pingInterval ?? DEFAULT_PING_INTERVAL;
    this.pingTimeoutMs = socketio?.pingTimeout ?? DEFAULT_PING_TIMEOUT;
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
  registerGateway(
    gatewayClass: Function,
    instance: BaseWebSocketGateway,
    resolveInterceptors?: (classes: (Function | import('../types').Interceptor)[]) => import('../types').ResolvedInterceptor[],
    globalInterceptors: (Function | import('../types').Interceptor)[] = [],
  ): void {
    const metadata = getGatewayMetadata(gatewayClass);
    if (!metadata) {
      return;
    }

    // Group handlers by type
    const handlers = new Map<WsHandlerType, WsHandlerMetadata[]>();
    for (const type of Object.values(WsHandlerType)) {
      handlers.set(type as WsHandlerType, []);
    }

    // Collect gateway-level interceptors
    const gatewayInterceptors = getControllerInterceptors(gatewayClass) as Function[];

    // Gateway-level `@UseGuards`, the guard twin of gatewayInterceptors above.
    const gatewayGuards = getControllerGuards(gatewayClass) as (Function | WsGuard)[];

    // The owner module's DI-aware guard resolver, attached to the instance it built. Absent
    // for a gateway constructed by hand — a unit test — and then guards fall back to
    // zero-argument construction, which is all they ever got before.
    const guardBinding = getGuardBinding(instance);

    for (const handler of metadata.handlers) {
      // Merge guards: gateway-level + handler-level, then resolve through the owner module so
      // a guard with a constructor dependency works here exactly as it does on an HTTP route.
      // Resolution happens HERE, at registration, so an unresolvable dependency fails the
      // application at startup instead of throwing once per delivered message.
      let declared = declaredHandlerGuards.get(handler);
      if (!declared) {
        declared = handler.guards ?? [];
        declaredHandlerGuards.set(handler, declared);
      }

      const mergedGuards = [...new Set([...gatewayGuards, ...declared])];
      handler.guards = mergedGuards.length > 0 && guardBinding
        ? (guardBinding.resolve(mergedGuards) as unknown as (Function | WsGuard)[])
        : mergedGuards;

      // Merge interceptors: application-global + gateway-level + handler-level, outermost
      // first — the same order HTTP routes use. The global list used to be merged at HTTP route
      // registration only, so an application-wide logging or metrics interceptor covered HTTP
      // and silently missed every WebSocket message.
      const handlerInterceptors = handler.interceptors ?? [];
      const mergedClasses = [...globalInterceptors, ...gatewayInterceptors, ...handlerInterceptors];

      // Resolve interceptor classes via DI
      if (mergedClasses.length > 0 && resolveInterceptors) {
        handler.interceptors = resolveInterceptors(mergedClasses);
      } else if (mergedClasses.length > 0) {
        // No resolver available — clear unresolved classes to avoid runtime errors
        handler.interceptors = undefined;
      } else {
        handler.interceptors = undefined;
      }

      const typeHandlers = handlers.get(handler.type) || [];
      typeHandlers.push(handler);
      handlers.set(handler.type, typeHandlers);
    }

    const key = gatewayKeyFor(metadata);
    const existing = this.gateways.get(key);
    if (existing && existing.instance.constructor !== instance.constructor) {
      throw new Error(
        `WebSocket gateway ${gatewayClass.name} and ${existing.instance.constructor.name} both `
        + `resolve to "${key}". The second registration used to replace the first silently, which `
        + 'left one gateway unreachable with nothing said. Give them different paths, or different '
        + 'namespaces on the same path.',
      );
    }

    // The gateway is born with its own map; attaching hands it the handler's map for this key
    // and carries over anything already registered, so gateway and handler share one object.
    const sockets = this.socketsByGateway.get(key) ?? new Map<string, ServerWebSocket<WsClientData>>();
    this.socketsByGateway.set(key, sockets);
    instance._attachSockets(key, sockets);

    this.gateways.set(key, {
      instance, metadata, handlers, key,
    });

    this.logger.debug(`Registered WebSocket gateway: ${gatewayClass.name} at ${metadata.path}`);
  }

  /**
   * Initialize gateways with server
   */
  initializeGateways(server: Server<WsClientData>): void {
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

      // A namespace declared on a gateway whose path this one only prefixes.
      for (const gateway of this.gateways.values()) {
        if (gateway.metadata?.namespace === namespace && path.startsWith(gateway.metadata.path)) {
          return gateway;
        }
      }

      this.logger.warn(
        `WebSocket client asked for namespace "${namespace}" on ${path}, which matches no gateway. `
        + 'Falling back to path resolution.',
      );
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
   * The gateway a Socket.IO client belongs to.
   *
   * Socket.IO clients all arrive on one path, so there is nothing in the URL to tell two
   * gateways apart except an explicit `?namespace=`. With none, a single gateway is unambiguous;
   * more than one is a coin flip, and it is resolved loudly rather than by delivering the client
   * to all of them — which is what used to happen, welcome messages included.
   */
  private resolveSocketioGateway(namespace?: string): GatewayInstance | undefined {
    if (namespace) {
      for (const gateway of this.gateways.values()) {
        if (gateway.metadata?.namespace === namespace) {
          return gateway;
        }
      }
    }

    const all = [...this.gateways.values()];
    if (all.length <= 1) {
      return all[0];
    }

    this.logger.warn(
      `Socket.IO client did not state a namespace and ${all.length} gateways are registered `
      + `(${all.map((gateway) => gateway.key).join(', ')}). Binding it to the first. `
      + 'Connect with ?namespace=<name> to choose.',
    );

    return all[0];
  }

  /**
   * The gateway that admitted this socket, or undefined when it cannot be established.
   *
   * The key on `ws.data` is a hint, not a credential: it is reachable from user code through
   * `@Client()`, so the answer is confirmed against the handler's own socket map, which only
   * this class writes. A forged key resolves to a gateway whose map does not hold this socket,
   * and dispatch is refused.
   *
   * The unkeyed fallback exists for sockets that never went through `handleUpgrade` — test
   * harnesses call the Bun handlers directly. With one gateway registered the answer is not in
   * doubt; with several it is, and guessing is what this whole change removes.
   */
  private ownerAtOpen(ws: ServerWebSocket<WsClientData>): GatewayInstance | undefined {
    const key = ws.data?.gatewayKey;

    if (key !== undefined) {
      return this.gateways.get(key);
    }

    if (this.gateways.size === 1) {
      return this.gateways.values().next().value;
    }

    return undefined;
  }

  /**
   * The owning gateway of an already-open socket, confirmed against the handler's own map.
   *
   * `ownerAtOpen` trusts the key because the socket is not registered yet when `handleOpen`
   * runs. Everything after that verifies, so a handler that assigns `client.gatewayKey` cannot
   * redirect its own frames at another gateway's handlers.
   */
  private ownerOf(ws: ServerWebSocket<WsClientData>): GatewayInstance | undefined {
    const id = ws.data?.id;
    const key = ws.data?.gatewayKey;

    if (id !== undefined && key !== undefined) {
      const gateway = this.gateways.get(key);
      if (gateway && this.socketsByGateway.get(key)?.get(id) === ws) {
        return gateway;
      }
    }

    // The key is a hint; the maps are the record, and only this class writes them. A client
    // whose handler assigned itself another gateway's key lands here and resolves back to the
    // gateway that actually holds the socket.
    if (id !== undefined) {
      for (const gateway of this.gateways.values()) {
        if (this.socketsByGateway.get(gateway.key)?.get(id) === ws) {
          return gateway;
        }
      }
    }

    // Held by nobody: a socket that never went through handleUpgrade, which is how test
    // harnesses drive the Bun callbacks. One registered gateway leaves no room for doubt; more
    // than one does, and guessing is the thing this change removes.
    return this.gateways.size === 1 ? this.gateways.values().next().value : undefined;
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
    // Every socket callback starts its own trace. Bun invokes them from the async context of
    // the upgrade, so without re-rooting a long-lived connection would file every message it
    // ever receives under the one HTTP request that opened it — a trace that keeps growing for
    // as long as the socket is open, attributed to a request that finished long ago.
    return {
      // Bun invokes these from the event loop, not from a continuation of anything this
      // application ran, so neither the parent span nor the owning application is inherited —
      // both have to be stated here.
      //
      // `open` and `close` get a span each — once per connection, so the cost is irrelevant and
      // an `@OnConnect`/`@OnDisconnect` handler's log lines finally land in a trace. `message`
      // and `drain` do NOT: every Engine.IO heartbeat arrives as a message and `handleDrain`
      // only writes a debug line, so a span here would be one exported span per PING. The frames
      // that actually dispatch to user code get theirs in `routeMessage`.
      open: (ws) => inEntrySpan(
        'ws open',
        () => this.handleOpen(ws),
        this.ownerTracer,
        { kind: SpanKind.SERVER, openSpan: this.traceWebSocketEvents },
      ),
      message: (ws, message) => inRootTraceScope(() => this.handleMessage(ws, message), this.ownerTracer),
      close: (ws, code, reason) => inEntrySpan(
        'ws close',
        () => this.handleClose(ws, code, reason),
        this.ownerTracer,
        { kind: SpanKind.SERVER, openSpan: this.traceWebSocketEvents },
      ),
      drain: (ws) => inRootTraceScope(() => this.handleDrain(ws), this.ownerTracer),
    };
  }

  /**
   * Handle WebSocket upgrade request
   */
  async handleUpgrade(
    req: OneBunRequest | Request,
    server: Server<WsClientData>,
  ): Promise<Response | undefined> {
    if (this.shuttingDown) {
      return new Response('Server shutting down', { status: HTTP_SERVICE_UNAVAILABLE });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    let protocol: WsClientData['protocol'] = 'native';
    let gateway: GatewayInstance | undefined;

    // A stated namespace NARROWS the choice; it never refuses a connection. `?namespace=x` that
    // matches nothing still connects, because it does today and because confinement comes from
    // binding the client to one gateway, not from turning working apps away.
    const namespace = url.searchParams.get('namespace') ?? undefined;

    if (this.socketioEnabled && path.startsWith(this.socketioPath)) {
      protocol = 'socketio';
      // Socket.IO clients share one path, so the namespace query is the only declared
      // discriminator; failing that, the sole gateway, failing that the first one with a warning.
      // The packet `nsp` cannot be the signal: a client receives @OnConnect's reply before it
      // ever sends the CONNECT packet.
      gateway = this.resolveSocketioGateway(namespace);
    } else {
      gateway = this.getGatewayForPath(path, namespace);
      if (!gateway) {
        return new Response('Not Found', { status: 404 });
      }
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
      auth: token
        ? {
          authenticated: false,
          token,
        }
        : null,
      metadata: {},
      protocol,
      // Which gateway admitted this client. Dispatch used to loop every registered gateway, so
      // a /chat client ran an /admin gateway's handlers and received its broadcasts.
      gatewayKey: gateway?.key,
    };

    // Run the gateway's authenticate hook, if it has one. Without it nothing in the
    // framework ever sets `authenticated`, so WsAuthGuard — which requires `true` — denies
    // every client, and WsPermissionGuard reads a `permissions` list nobody populates.
    const authenticate = gateway?.metadata?.authenticate;

    if (authenticate) {
      let result: WsAuthResult;
      try {
        result = await authenticate({ token, request: req as Request });
      } catch (error) {
        this.logger.warn(`WebSocket authenticate hook threw, refusing upgrade: ${error}`);

        return new Response('Unauthorized', { status: 401 });
      }

      if (result === false) {
        return new Response('Unauthorized', { status: 401 });
      }

      // `null` means "connect, but anonymous" — the client is admitted and every guard that
      // requires authentication still denies it. A gateway serving both public and private
      // events needs that third outcome; without it the hook can only be all-or-nothing.
      const anonymous = result === null;
      const identity = typeof result === 'object' && result !== null ? result : {};
      if (!anonymous) {
        clientData.auth = {
          ...clientData.auth,
          authenticated: true,
          token,
          userId: identity.userId,
          permissions: identity.permissions,
        };
      }
      if (identity.metadata) {
        clientData.metadata = { ...clientData.metadata, ...identity.metadata };
      }
    }

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
    this.logger.debug(`WebSocket client connected: ${client.id} (${client.protocol})`);

    // Resolve the owner BEFORE the record is stored. The record carries the owning gateway's
    // key, and every gateway reads the same storage — a record written first and owned second
    // is a record other gateways can see in the meantime, and a socket that never went through
    // handleUpgrade (a test harness driving the Bun callbacks) would carry no key at all.
    // It also stops a record being written for a connection that is about to be closed.
    const owner = this.ownerAtOpen(ws);
    if (!owner) {
      this.logger.warn(
        `WebSocket client ${client.id} could not be matched to a gateway (key: `
        + `${ws.data?.gatewayKey ?? 'none'}); closing rather than leaving it open and mute.`,
      );
      ws.close(WS_INTERNAL_ERROR_CODE, 'No gateway owns this connection');

      return;
    }
    client.gatewayKey ??= owner.key;

    // Store client
    await this.storage.addClient(client);

    this.openSockets.add(ws);

    // Register the socket with the gateway that admitted it. This used to register with EVERY
    // gateway, which is why one client appeared in every gateway's `clients` and received every
    // gateway's broadcasts.
    owner.instance._registerSocket(client.id, ws);

    if (client.protocol === 'socketio') {
      // Send Socket.IO handshake
      const handshake = createHandshake(client.id, {
        pingInterval: this.pingIntervalMs,
        pingTimeout: this.pingTimeoutMs,
        maxPayload: this.maxPayload,
      });
      ws.send(createOpenPacket(handshake));
      this.startPingInterval(client.id, ws);
    }

    // Call OnConnect handlers — the owning gateway's only.
    const connectHandlers = owner.handlers.get(HandlerType.CONNECT) || [];
    for (const handler of connectHandlers) {
      try {
        const result = await this.executeHandler(owner, handler, ws, undefined, {});
        if (result && isWsHandlerResponse(result)) {
          ws.send(this.encodeResponse(client.protocol, result));
        }
      } catch (error) {
        this.logger.error(`Error in OnConnect handler: ${error}`);
      }
    }
  }

  /**
   * Encode handler response for the client's protocol
   */
  private encodeResponse(
    protocol: WsClientData['protocol'],
    result: WsHandlerResponse,
    ackId?: number,
  ): string {
    if (protocol === 'socketio') {
      if (ackId !== undefined) {
        return createFullAckMessage(ackId, result);
      }

      return createFullEventMessage(result.event, result.data);
    }

    return createNativeMessage(result.event, result.data, ackId);
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(
    ws: ServerWebSocket<WsClientData>,
    message: string | Buffer,
  ): Promise<void> {
    const messageStr = typeof message === 'string' ? message : message.toString();
    const protocol = ws.data.protocol;

    if (protocol === 'native') {
      const native = parseNativeMessage(messageStr);
      if (native) {
        await this.routeMessage(ws, native.event, native.data, native.ack);
      }

      return;
    }

    // Socket.IO format
    const { engineIO, socketIO } = parseMessage(messageStr);

    switch (engineIO.type) {
      case EngineIOPacketType.PING:
        ws.send(createPongPacket(engineIO.data as string | undefined));

        return;

      case EngineIOPacketType.PONG:
        return;

      case EngineIOPacketType.CLOSE:
        ws.close(1000, 'Client requested close');

        return;

      case EngineIOPacketType.MESSAGE:
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
    // The one dispatch point both protocols reach, and the first place a frame is known to be
    // going to user code rather than to a heartbeat. The event rides as an attribute instead of
    // in the span name: event strings carry ids (`room:123:msg`), and a span name is a
    // cardinality dimension in every backend.
    const attributes: Attributes = {};
    attributes['onebun.ws.event'] = event;

    return await inEntrySpan(
      'ws message',
      async () => await this.dispatchMessage(ws, event, data, ackId),
      this.ownerTracer,
      { kind: SpanKind.SERVER, attributes, openSpan: this.traceWebSocketEvents },
    );
  }

  /**
   * Dispatch a routed message to the handler that claims it.
   */
  private async dispatchMessage(
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

    // Find matching message handler — in the gateway that admitted this client, and only there.
    // Looping every gateway meant a /chat client could invoke an /admin gateway's handler.
    const owner = this.ownerOf(ws);
    for (const gateway of owner ? [owner] : []) {
      const handlers = gateway.handlers.get(HandlerType.MESSAGE) || [];

      for (const handler of handlers) {
        if (!handler.pattern) {
          continue;
        }

        const match = matchPattern(handler.pattern, event);
        if (match.matched) {
          try {
            const result = await this.executeHandler(gateway, handler, ws, data, match.params);

            if (result === GUARD_DENIED) {
              // Answer the client rather than leaving it waiting on a message that will never
              // arrive — an unanswered ack id is indistinguishable from a hung server.
              ws.send(this.encodeResponse(
                ws.data.protocol,
                {
                  event: GUARD_DENIED_EVENT,
                  data: { code: 'FORBIDDEN', event, message: 'Guard denied this message' },
                },
                ackId,
              ));

              continue;
            }

            // Send response
            if (result !== undefined && isWsHandlerResponse(result)) {
              ws.send(this.encodeResponse(ws.data.protocol, result, ackId));
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

    // Call OnJoinRoom handlers — owning gateway only.
    const joinOwner = this.ownerOf(ws);
    for (const gateway of joinOwner ? [joinOwner] : []) {
      const handlers = gateway.handlers.get(HandlerType.JOIN_ROOM) || [];

      for (const handler of handlers) {
        const match = handler.pattern ? matchPattern(handler.pattern, roomName) : { matched: true, params: {} };
        
        if (match.matched) {
          try {
            const result = await this.executeHandler(gateway, handler, ws, data, match.params, roomName);
            if (result !== undefined && isWsHandlerResponse(result)) {
              ws.send(this.encodeResponse(ws.data.protocol, result, ackId));
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

    // Call OnLeaveRoom handlers — owning gateway only.
    const leaveOwner = this.ownerOf(ws);
    for (const gateway of leaveOwner ? [leaveOwner] : []) {
      const handlers = gateway.handlers.get(HandlerType.LEAVE_ROOM) || [];

      for (const handler of handlers) {
        const match = handler.pattern ? matchPattern(handler.pattern, roomName) : { matched: true, params: {} };
        
        if (match.matched) {
          try {
            const result = await this.executeHandler(gateway, handler, ws, data, match.params, roomName);
            if (result !== undefined && isWsHandlerResponse(result)) {
              ws.send(this.encodeResponse(ws.data.protocol, result, ackId));
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

      const canActivate = await executeGuards(handler.guards, context, (name, error) => {
        // The framework's own diagnostic. Before this, a guard that threw denied the message
        // and said nothing anywhere — indistinguishable from a guard that meant to deny.
        this.logger.error(
          `WebSocket guard ${name} threw on ${gateway.metadata?.path ?? '/'} ` +
          `${handler.handler} for client ${client.id}, denying: ${error}`,
        );
      });
      if (!canActivate) {
        this.logger.warn(
          `WebSocket guard denied ${handler.handler} (${handler.pattern ?? handler.type}) ` +
          `for client ${client.id}`,
        );

        return GUARD_DENIED;
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

    // Call handler (with interceptors if any)
    const method = (instance as unknown as Record<string, Function>)[handler.handler];
    if (typeof method !== 'function') {
      return undefined;
    }

    const handlerFn = async (): Promise<unknown> => await method.apply(instance, args);

    if (handler.interceptors && handler.interceptors.length > 0) {
      const ctx = new WsExecutionContextImpl(client, ws, data, handler, patternParams);

      return await composeInterceptors(handler.interceptors, ctx, handlerFn)();
    }

    return await handlerFn();
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

    // Call OnDisconnect handlers — owning gateway only, and unregister from it alone.
    const closeOwner = this.ownerOf(ws);
    for (const gateway of closeOwner ? [closeOwner] : []) {
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

    this.openSockets.delete(ws);
    this.closeWaiters.get(ws)?.();
    this.closeWaiters.delete(ws);
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
  /**
   * Close every open socket and wait for the disconnect path to finish.
   *
   * `app.stop()` used to leave connections established and let `server.stop(true)` drop them at
   * the end, so a client saw no close frame at all — measured, `readyState` still 1 and no close
   * event — and was cut only when the process died, as an abnormal 1006 at an arbitrary moment
   * instead of a clean going-away at a controlled one.
   *
   * Bounded, because a socket whose close callback never arrives must not turn shutdown into a
   * hang. A connection still open when the bound expires is dropped by `server.stop(true)` as
   * before.
   *
   * The code reaches the wire but not necessarily the client's report of it: measured against a
   * bare `Bun.serve`, a server-side `close(1001, 'bye')` arrives at the server's own close
   * callback as 1001 and at Bun's WebSocket client as **1000**, with the reason intact. So the
   * reason is the part a client can rely on today.
   */
  async closeAll(
    code: number = WS_GOING_AWAY,
    reason = 'Server shutting down',
    timeoutMs: number = WS_CLOSE_DRAIN_TIMEOUT_MS,
  ): Promise<void> {
    this.shuttingDown = true;

    const sockets = [...this.openSockets];

    if (sockets.length === 0) {
      return;
    }

    // Waiters registered BEFORE the first close: Bun delivers the close callback asynchronously,
    // so a set snapshotted afterwards can miss a socket that closed in between.
    const waits = sockets.map(async socket => await new Promise<void>((resolve) => {
      this.closeWaiters.set(socket, resolve);
    }));

    for (const socket of sockets) {
      try {
        socket.close(code, reason);
      } catch (error) {
        // Already gone. Its waiter is released by the bound rather than left hanging.
        this.logger.debug(`WebSocket close during shutdown failed: ${error}`);
      }
    }

    await awaitBounded(Promise.all(waits), timeoutMs);

    this.closeWaiters.clear();
  }

  /**
   * Release what is left after {@link closeAll}: the ping timers and the client storage.
   *
   * Storage is wiped HERE and not before the sockets are closed, which is why `closeAll` runs in
   * its own shutdown step ahead of the HTTP drain. A `@OnDisconnect` handler reads the client back
   * out of storage — the chat example reads `client.rooms` — and wiping first would hand every one
   * of them an empty record.
   */
  async cleanup(): Promise<void> {
    // Stop all ping intervals
    for (const [clientId, _] of this.pingIntervals) {
      this.stopPingInterval(clientId);
    }

    // Clear storage
    await this.storage.clear();

    // And the per-gateway socket maps. `closeAll` normally drains them through each socket's
    // close callback, but a socket whose callback never arrives within the drain timeout is
    // dropped by `server.stop(true)` with `handleClose` unrun — and its entry would otherwise
    // stay in a map a live gateway instance still reads.
    for (const sockets of this.socketsByGateway.values()) {
      sockets.clear();
    }
  }
}

/**
 * Check if a class is a WebSocket gateway (for use in module)
 */
export { isWebSocketGateway };
