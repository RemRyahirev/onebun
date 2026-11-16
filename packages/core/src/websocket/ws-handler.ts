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
import type {
  WsAuthContext,
  WsAuthData,
  WsAuthResult,
  WsHandlerResponse,
} from './ws.types';
import type { OneBunRequest } from '../types';
import type { Server, ServerWebSocket } from 'bun';

import type { SyncLogger } from '@onebun/logger';

import { awaitBounded } from '../await-bounded';
import {
  getControllerGuards,
  getControllerInterceptors,
  getMethodGuards,
} from '../decorators/decorators';
import { getGuardBinding } from '../http-guards/guard-binding';
import { composeInterceptors } from '../interceptors/interceptors';
import { inheritRequestContext, requestContextStore } from '../request-context';
import { inEntrySpan, inRootTraceScope } from '../trace-scope';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { getGatewayMetadata, isWebSocketGateway } from './ws-decorators';
import { WsExecutionContextImpl, executeGuards } from './ws-guards';
import { matchPattern } from './ws-pattern-matcher';
import {
  cancelRoomJoins,
  roomsClearing,
  trackRoomJoin,
  trackRoomsClearing,
  untrackRoomJoin,
  type PendingRoomJoin,
} from './ws-pending-joins';
import {
  parseMessage,
  createOpenPacket,
  createHandshake,
  createPongPacket,
  createConnectErrorPacket,
  createFullAckMessage,
  createFullEventMessage,
  wrapInEngineIO,
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

/** `ServerWebSocket.readyState` of an open connection. */
const WS_OPEN = 1;

/**
 * How long a Socket.IO CONNECT that moves a connection waits for the target gateway's
 * `authenticate` hook. A hook that has not answered by then refuses the move, so one that never
 * settles cannot hold the CONNECT unanswered.
 */
const MOVE_AUTHENTICATE_TIMEOUT_MS = 10_000;

/** What a refused upgrade answers, and the CONNECT_ERROR message of a move the target's hook refused. */
const UNAUTHORIZED = 'Unauthorized';

/** The CONNECT_ERROR message of a move that could not be made once the target's hook allowed it. */
const MOVE_FAILED = 'The connection could not be moved';

/**
 * How many EVENT packets a Socket.IO connection may send while a move holds them. A standard
 * client sends none — it holds its emits until the CONNECT is answered — and the client decides
 * how long the hold lasts, so past this many the move is refused while it is still waiting on the
 * current gateway, and the connection is closed once it no longer can be.
 */
const MAX_HELD_MESSAGES = 100;

/** The CONNECT_ERROR message, and close reason, when a move held more than `MAX_HELD_MESSAGES`. */
const HELD_OVERFLOW = 'Too many messages arrived while the connection was being moved';

/** RFC 6455 "policy violation": what a connection that floods a move is closed with. */
const WS_POLICY_VIOLATION = 1008;

/** The CONNECT_ERROR message of a CONNECT that arrives while another one of the connection is decided. */
const CONNECT_PENDING = 'A previous CONNECT of this connection is still being decided';

/** The CONNECT_ERROR message of a CONNECT that arrives while a hook call for the connection has not settled. */
const AUTHENTICATION_PENDING = 'A previous authentication of this connection has not finished';

/** What a move's `authenticate` call settles to when the bound expires first. */
const HOOK_TIMED_OUT = Symbol('onebun:ws:hook-timed-out');

/**
 * What `executeHandler` returns when a Socket.IO move has taken the connection away from the
 * gateway that started a message by the time its next guard or its handler body would run. The
 * rest of the message is not run. A close is not a move: a closed connection's message runs on.
 */
const MOVED_AWAY = Symbol('onebun:ws:moved-away');

/** What asking a handler's guards decided: allowed, denied, or stopped by a Socket.IO move. */
type GuardVerdict = boolean | typeof MOVED_AWAY;

/** The `message` of the `FORBIDDEN` frame answering a message a Socket.IO move stopped. */
const MESSAGE_CANCELLED_BY_MOVE_MESSAGE = 'Message cancelled: the connection moved to another gateway';

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

/** The `message` of the `FORBIDDEN` frame a guard's denial is answered with. */
const GUARD_DENIED_MESSAGE = 'Guard denied this message';
/** The `message` of the `FORBIDDEN` frame answering a join that a leave of the same room cancelled. */
const JOIN_CANCELLED_BY_LEAVE_MESSAGE = 'Room join cancelled by a leave of the same room';
/** The `message` of the `FORBIDDEN` frame answering a join cancelled by a Socket.IO move. */
const JOIN_CANCELLED_BY_MOVE_MESSAGE = 'Room join cancelled: the connection moved to another gateway';

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
  /**
   * What decides a client join of a room no `@OnJoinRoom` handler matches: the gateway-level
   * guards, resolved at registration, carried by a handler that has no method — see
   * `bareRoomJoin`. Absent when the gateway has no gateway-level guards; such a join asks no guard.
   */
  bareJoin?: WsHandlerMetadata;
}

/**
 * The handler a client join of a room no `@OnJoinRoom` handler matches is decided under, so the
 * gateway-level guards that would have reached it through a matching handler still decide it. It
 * has no method — `handler` is empty, there is no `pattern` and no parameter — and its guards are
 * the gateway-level ones, resolved like a handler's list: the same guards, in the same order.
 */
function bareRoomJoin(guards: (Function | WsGuard)[]): WsHandlerMetadata {
  return {
    type: WsHandlerType.JOIN_ROOM,
    handler: '',
    params: [],
    guards,
  };
}

/** How a log line names a handler: its method, or the join of a room no handler matches. */
function handlerLabel(handler: WsHandlerMetadata): string {
  return handler.handler || 'a room join no @OnJoinRoom handler matches';
}

/**
 * An `@OnJoinRoom` handler whose pattern matched the room being joined, with what it captured — or
 * a gateway's `bareJoin`, which captures nothing, deciding a room no handler matches.
 */
interface MatchedRoomHandler {
  gateway: GatewayInstance;
  handler: WsHandlerMetadata;
  params: Record<string, string>;
}

/**
 * What a Socket.IO connection keeps of its upgrade request, so that a CONNECT moving it to another
 * gateway can give that gateway's `authenticate` hook what the upgrade gave the first one: the URL,
 * query included, and the headers — `Authorization`, `Cookie` and whatever a proxy added. The
 * token is read from those two the way the upgrade reads it.
 */
interface UpgradeRequest {
  readonly url: string;
  readonly headers: Headers;
}

/** Who an `authenticate` hook's answer makes a connection. */
interface HookIdentity {
  auth: WsAuthData | null;
  metadata: Record<string, unknown>;
}

/** A Socket.IO EVENT held while a move is made, to be served once it is decided. */
interface HeldMessage {
  event: string;
  data: unknown;
  ackId?: number;
}

/**
 * A Socket.IO connection that a CONNECT can still move to a gateway with an `authenticate` hook:
 * what that hook will need, and what the move needs to swap the connection's identity only once
 * nothing of the current gateway still runs for it.
 */
interface SocketioMove {
  readonly upgrade: UpgradeRequest;
  /** EVENT packets of this connection being served right now — guards and handler bodies. */
  inFlight: number;
  /** Called when `inFlight` drops to zero while a move waits for it. */
  idle?: () => void;
  /**
   * Present while a move holds the connection's new EVENT packets: from the moment the target's
   * hook allowed the move until it is decided and every held packet has been started. Arrival
   * order, at most `MAX_HELD_MESSAGES`.
   */
  held?: HeldMessage[];
  /** Set while the move still waits on the current gateway: refuses it when the hold overflows. */
  overflow?: () => void;
  /** A hook call for this connection that has not settled — also one past its bound. */
  hookUnsettled: boolean;
}

/** The bearer token of an upgrade request: `?token=`, else the `Authorization` header. */
function upgradeToken(url: URL, headers: Headers): string | undefined {
  return url.searchParams.get('token') || headers.get('Authorization')?.replace('Bearer ', '');
}

/**
 * The identity an `authenticate` hook's answer gives a connection, or `undefined` when the hook
 * refused it. One function for the upgrade and for a Socket.IO move, so the two cannot disagree on
 * what an answer means.
 */
function identityFrom(token: string | undefined, result: WsAuthResult): HookIdentity | undefined {
  if (result === false) {
    return undefined;
  }

  const unauthenticated: WsAuthData | null = token ? { authenticated: false, token } : null;

  // `null` means "connect, but anonymous" — the client is admitted and every guard that
  // requires authentication still denies it. A gateway serving both public and private
  // events needs that third outcome; without it the hook can only be all-or-nothing.
  if (result === null) {
    return { auth: unauthenticated, metadata: {} };
  }

  const identity = typeof result === 'object' ? result : {};

  // Fresh objects, never the hook's own: at a move they replace the live identity, and nothing
  // that held the old one — or the hook's answer — can reach the new one through a shared reference.
  return {
    auth: {
      ...unauthenticated,
      authenticated: true,
      token,
      userId: identity.userId,
      permissions: identity.permissions ? [...identity.permissions] : identity.permissions,
    },
    metadata: identity.metadata ? { ...identity.metadata } : {},
  };
}

/**
 * The room a `join` / `leave` message names: the data when it is a string, else its `room`
 * field, else what follows the `join:` / `leave:` prefix of the event. The one room the change is
 * made to, decided once: the guards read it from their context (`getRoomName()`) and the handlers
 * receive it through `@RoomName()`, so neither has to repeat this rule on the raw message.
 *
 * `undefined` when that is not a string. Such a message names no room — an array or an object
 * would otherwise reach storage as a key and the pub/sub calls as a topic, and throw there — so
 * it is dropped, as any other malformed message is.
 */
function roomNameOf(event: string, data: unknown, prefix: 'join:' | 'leave:'): string | undefined {
  const named: unknown = typeof data === 'string'
    ? data
    : (data as { room?: unknown } | null | undefined)?.room || event.replace(prefix, '');

  return typeof named === 'string' ? named : undefined;
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
 * Whether a request path is the gateway's own path or lives below it.
 *
 * `startsWith` alone is a prefix of the STRING, which is why `/chat` used to claim `/chatterbox`.
 * A path prefix has to end on a segment boundary. `/` is the exception and stays one: it is the
 * declared default, so every application that never named a path relies on it covering whatever
 * URL its clients connect to.
 */
function pathIsUnder(path: string, base: string): boolean {
  if (base === '/' || path === base) {
    return true;
  }

  const boundary = base.endsWith('/') ? base : `${base}/`;

  return path.startsWith(boundary);
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

  /**
   * Socket.IO sockets whose CONNECT packet has been served.
   *
   * A second CONNECT would otherwise run `@OnConnect` again on a connection already bound; a
   * refused one is deliberately NOT recorded, so a client can name a namespace it may reach.
   */
  private readonly socketioConnected = new WeakSet<ServerWebSocket<WsClientData>>();

  /**
   * Socket.IO sockets whose CONNECT packet is being decided — the target gateway's `authenticate`
   * hook, then the move. A CONNECT arriving meanwhile is ignored, so two moves never race.
   */
  private readonly socketioConnecting = new WeakSet<ServerWebSocket<WsClientData>>();

  /**
   * The Socket.IO connections a CONNECT could still move to a gateway with an `authenticate`
   * hook — what each keeps of its upgrade request for that hook, and its in-flight messages —
   * keyed by its client data, the object `server.upgrade` makes `ws.data`. Only such
   * connections have an entry; it is never written to storage, and it is dropped once a CONNECT
   * is served: after that the connection cannot move.
   */
  private readonly socketioMoves = new WeakMap<WsClientData, SocketioMove>();

  /**
   * The gateway a Socket.IO move took each moved connection away from. A connection moves at most
   * once, and only a move — never a close — stops a message that gateway had started.
   */
  private readonly movedAway = new WeakMap<ServerWebSocket<WsClientData>, GatewayInstance>();

  constructor(
    private logger: SyncLogger,
    private options: WebSocketApplicationOptions = {},
    /**
     * The owning application's tracer, so a `@Traced` method reached from a socket callback is
     * recorded by THIS application's provider rather than by whichever application happened to
     * register its provider with OpenTelemetry first. Optional: without one, such a method is
     * recorded by the process-global provider.
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
        // `@UseGuards` method guards are collected up the prototype chain, as queue
        // registration does: a handler that overrides a guarded base method runs the base
        // method's guards first, then its own list (`@UseGuards`, then `@UseWsGuards`).
        declared = [...new Set([
          ...(getMethodGuards(gatewayClass, handler.handler) as (Function | WsGuard)[]),
          ...(handler.guards ?? []),
        ])];
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

    // A client join of a room no `@OnJoinRoom` handler matches has no handler to carry the
    // gateway-level guards, so it gets one of its own: the list every handler's starts with,
    // resolved once, here, the same way.
    const bareJoin = gatewayGuards.length > 0
      ? bareRoomJoin(guardBinding
        ? (guardBinding.resolve(gatewayGuards) as unknown as (Function | WsGuard)[])
        : gatewayGuards)
      : undefined;

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
    // Read on demand, not counted here: gateways register one at a time, so a number taken now
    // would say "one" to whichever registered first and never be corrected.
    instance._attachSockets(key, sockets, () => this.gateways.size);

    this.gateways.set(key, {
      instance, metadata, handlers, key, bareJoin,
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
      const withNamespace = this.longestPrefixMatch(
        path,
        (gateway) => gateway.metadata?.namespace === namespace,
      );
      if (withNamespace) {
        return withNamespace;
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

    return this.longestPrefixMatch(path, () => true);
  }

  /**
   * The gateway whose declared path covers this one most specifically.
   *
   * Two things this replaces. The match was a raw `startsWith`, so `/chat` claimed `/chatterbox`
   * — a prefix of the STRING rather than of the PATH. And the loop returned on the first hit, so
   * with `/chat` and `/chat/admin` both declared, a request below both went to whichever was
   * registered first: declaration order decided routing.
   *
   * `/` still covers everything. It is what `@WebSocketGateway()` defaults to, so an application
   * that declares no path and connects on `/ws` works today; narrowing it would answer 404.
   */
  private longestPrefixMatch(
    path: string,
    accept: (gateway: GatewayInstance) => boolean,
  ): GatewayInstance | undefined {
    let best: GatewayInstance | undefined;
    let bestLength = -1;
    let tied = 0;

    for (const gateway of this.gateways.values()) {
      const base = gateway.metadata?.path;
      if (base === undefined || !accept(gateway) || !pathIsUnder(path, base)) {
        continue;
      }

      if (base.length > bestLength) {
        best = gateway;
        bestLength = base.length;
        tied = 1;
      } else if (base.length === bestLength) {
        tied += 1;
      }
    }

    if (tied > 1 && best) {
      // Same path, different namespaces, and the client named none. Resolved the same way the
      // Socket.IO handshake resolves it: loudly, rather than by picking in silence.
      this.logger.warn(
        `WebSocket upgrade on ${path} matches ${tied} gateways declared at the same path. `
        + `Binding it to ${best.key}. Connect with ?namespace=<name> to choose.`,
      );
    }

    return best;
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
   * Whether a CONNECT could move a Socket.IO connection bound to `bound` onto a gateway whose
   * `authenticate` hook then runs: a gateway a CONNECT can name — one with a namespace — that has
   * a hook and is not `bound`.
   */
  private hookReachableByMove(bound: GatewayInstance | undefined): boolean {
    for (const gateway of this.gateways.values()) {
      if (gateway !== bound && gateway.metadata?.namespace && gateway.metadata.authenticate) {
        return true;
      }
    }

    return false;
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
    const token = upgradeToken(url, req.headers);

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

        return new Response(UNAUTHORIZED, { status: 401 });
      }

      const identity = identityFrom(token, result);
      if (!identity) {
        return new Response(UNAUTHORIZED, { status: 401 });
      }
      clientData.auth = identity.auth;
      clientData.metadata = identity.metadata;
    }

    // A Socket.IO CONNECT may move this connection to a gateway whose hook then runs, and needs
    // what this request gave the hook here. Nothing is kept for a connection that cannot get there.
    const upgradeRequest: UpgradeRequest | undefined = protocol === 'socketio' && this.hookReachableByMove(gateway)
      ? { url: req.url, headers: new Headers(req.headers) }
      : undefined;

    // Try to upgrade
    const success = server.upgrade(req, {
      data: clientData,
    });

    if (success) {
      if (upgradeRequest) {
        this.socketioMoves.set(clientData, { upgrade: upgradeRequest, inFlight: 0, hookUnsettled: false });
      }

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

      // And stop here. A Socket.IO client states its namespace in the CONNECT packet, which
      // cannot arrive before the handshake it answers — so running `@OnConnect` now is what made
      // `nsp` unusable as a routing signal. The binding above is provisional; the client's own
      // CONNECT packet decides it, and `@OnConnect` runs there.
      return;
    }

    await this.runConnectHandlers(owner, ws);
  }

  /**
   * Run the owning gateway's `@OnConnect` handlers and send whatever they answer.
   */
  private async runConnectHandlers(owner: GatewayInstance, ws: ServerWebSocket<WsClientData>): Promise<void> {
    // A request scope, because the two paths that reach here disagree about having one. A plain
    // WebSocket runs this from the `open` callback, already inside `inEntrySpan`; a Socket.IO
    // client runs it from `completeSocketioConnect`, which is reached from the MESSAGE callback
    // and branches off before the per-message `inEntrySpan` — so an `@OnConnect` handler had a
    // context on one protocol and not the other. Entering here makes it unconditional, and the
    // copy keeps every read on the `open` path answering exactly as it did.
    return await requestContextStore.run(inheritRequestContext(), async (): Promise<void> => {
      const connectHandlers = owner.handlers.get(HandlerType.CONNECT) || [];
      for (const handler of connectHandlers) {
        try {
          const result = await this.executeHandler(owner, handler, ws, undefined, {});
          if (result && isWsHandlerResponse(result)) {
            ws.send(this.encodeResponse(ws.data.protocol, result));
          }
        } catch (error) {
          this.logger.error(`Error in OnConnect handler: ${error}`);
        }
      }
    });
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
        // The only point at which a Socket.IO client says which gateway it wants.
        await this.completeSocketioConnect(ws, packet.nsp);
        break;

      case SocketIOPacketType.DISCONNECT:
        // Client disconnecting from namespace
        break;

      case SocketIOPacketType.EVENT:
        // Handle event
        if (packet.data && Array.isArray(packet.data) && packet.data.length > 0) {
          const [event, ...args] = packet.data;
          if (typeof event === 'string') {
            // Only a connection a CONNECT could still move to a gateway with a hook has an entry.
            const move = this.socketioMoves.get(ws.data);
            if (move) {
              await this.routeMovable(ws, move, event, args[0], packet.id);
            } else {
              await this.routeMessage(ws, event, args[0], packet.id);
            }
          }
        }
        break;

      case SocketIOPacketType.ACK:
        // Acknowledgement - not implemented yet
        break;
    }
  }

  /**
   * Route an EVENT of a connection a CONNECT could still move: counted while it is served, so a
   * move can wait for it, and held instead while a move is being made — it belongs to neither
   * gateway until the move is decided.
   */
  private async routeMovable(
    ws: ServerWebSocket<WsClientData>,
    move: SocketioMove,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    if (!move.held) {
      await this.routeCounted(ws, move, event, data, ackId);

      return;
    }

    if (move.held.length < MAX_HELD_MESSAGES) {
      move.held.push({ event, data, ackId });

      return;
    }

    if (move.overflow) {
      // Still waiting on the current gateway: the move is refused, and this packet is served there
      // after the others it held.
      move.held.push({ event, data, ackId });
      move.overflow();

      return;
    }

    this.logger.warn(
      `Socket.IO client ${ws.data.id} sent more than ${MAX_HELD_MESSAGES} messages while it was being moved; `
      + 'closing it.',
    );
    ws.close(WS_POLICY_VIOLATION, HELD_OVERFLOW);
  }

  /** Serve an EVENT of a connection that could still move, counted while it runs. */
  private async routeCounted(
    ws: ServerWebSocket<WsClientData>,
    move: SocketioMove,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    move.inFlight += 1;
    try {
      await this.routeMessage(ws, event, data, ackId);
    } finally {
      move.inFlight -= 1;
      if (move.inFlight === 0) {
        move.idle?.();
      }
    }
  }

  /**
   * Serve the EVENTs a move held, in the order they arrived, on the gateway now serving the
   * connection: the new one after a move, the same one after a refusal — and end the hold. They are
   * started in one synchronous step, so an EVENT arriving later cannot overtake them; the step is
   * short because a hold never exceeds `MAX_HELD_MESSAGES` (plus the one that overflowed it). A
   * closed connection has nobody to answer, so they are dropped then.
   */
  private releaseHeld(
    ws: ServerWebSocket<WsClientData>,
    move: SocketioMove,
    serve: (message: HeldMessage) => Promise<void>,
  ): void {
    const held = move.held ?? [];
    move.held = undefined;

    if (ws.readyState !== WS_OPEN) {
      if (held.length > 0) {
        this.logger.debug(`Dropping ${held.length} message(s) of closed WebSocket client ${ws.data.id} held by a move`);
      }

      return;
    }

    for (const message of held) {
      void serve(message).catch((error: unknown) => {
        this.logger.error(`Error serving a message held by a move for client ${ws.data.id}: ${error}`);
      });
    }
  }

  /**
   * Bind a Socket.IO client to the namespace it just named, and run `@OnConnect` there.
   *
   * Every Socket.IO client arrives on one path, so the URL cannot tell two gateways apart. The
   * protocol's own discriminator is this packet's `nsp`, and it used to be echoed back and
   * otherwise ignored — `io('/admin')` puts nothing in the query, so a client written the normal
   * Socket.IO way was bound to whichever gateway was registered first.
   */
  private async completeSocketioConnect(ws: ServerWebSocket<WsClientData>, nsp: string): Promise<void> {
    if (this.socketioConnected.has(ws)) {
      this.logger.warn(
        `Socket.IO client ${ws.data.id} sent a second CONNECT packet, for "${nsp}"; ignoring it. `
        + 'One OneBun connection serves one gateway.',
      );

      return;
    }

    if (this.socketioConnecting.has(ws)) {
      this.logger.warn(
        `Socket.IO client ${ws.data.id} sent a CONNECT packet for "${nsp}" while another of its CONNECT `
        + 'packets is being decided; refusing it.',
      );
      this.refuseConnect(ws, nsp, CONNECT_PENDING);

      return;
    }

    const provisional = this.ownerOf(ws);
    if (!provisional) {
      this.logger.warn(
        `Socket.IO CONNECT for "${nsp}" from ${ws.data?.id ?? 'an unknown client'} could not be `
        + 'matched to a gateway; closing rather than leaving it open and mute.',
      );
      ws.close(WS_INTERNAL_ERROR_CODE, 'No gateway owns this connection');

      return;
    }

    const target = this.gatewayForPacketNamespace(nsp) ?? provisional;

    if (target !== provisional) {
      this.socketioConnecting.add(ws);
      let moved: boolean;
      try {
        moved = await this.moveSocketio(ws, nsp, provisional, target);
      } finally {
        this.socketioConnecting.delete(ws);
      }
      // A connection that closed while the move cleared its rooms has already run the new
      // gateway's `@OnDisconnect`; its `@OnConnect` must not run after that.
      if (!moved || !this.servedBy(ws, target)) {
        return;
      }
    }

    // Served: the connection cannot move any more, so nothing of it is kept or counted from here.
    // The EVENTs a move held arrived after this CONNECT: they are the new gateway's.
    const move = this.socketioMoves.get(ws.data);
    this.socketioMoves.delete(ws.data);
    this.socketioConnected.add(ws);
    ws.send(createFullEventMessage('connect', { sid: ws.data.id }, nsp));
    const connecting = this.runConnectHandlers(target, ws);
    if (move?.held) {
      this.releaseHeld(ws, move, async ({ event, data, ackId }) => await this.routeMessage(ws, event, data, ackId));
    }
    await connecting;
  }

  /**
   * Move a Socket.IO connection to the gateway its CONNECT named, all or nothing, and say whether it
   * moved.
   *
   * The connection's identity is the target gateway's to decide. A target with an `authenticate`
   * hook runs it, as the upgrade would have, and the connection becomes what it returns; a refusal
   * refuses the CONNECT. A target without one never receives a connection another gateway's hook
   * authenticated, so that move is refused. Between two gateways without a hook the connection
   * moves as it is. Until the move is made the connection stays where it was — rooms, identity and
   * the gateway serving its messages — so a refused CONNECT leaves it exactly as it was, and the
   * transport stays open for a namespace the client may reach.
   *
   * Once a hook has allowed it, the identity is swapped only when nothing of the current gateway
   * still runs for the connection: its new EVENTs are held, and the move waits — within the same
   * bound as the hook — for the ones the current gateway is serving, guards and handler bodies.
   * One that does not settle in time refuses the move. The held EVENTs are then served where the
   * connection ends up.
   */
  private async moveSocketio(
    ws: ServerWebSocket<WsClientData>,
    nsp: string,
    from: GatewayInstance,
    to: GatewayInstance,
  ): Promise<boolean> {
    const authenticate = to.metadata?.authenticate;

    if (!authenticate) {
      if (from.metadata?.authenticate) {
        this.logger.warn(
          `Socket.IO client ${ws.data.id} asked for namespace "${nsp}", whose gateway has no `
          + `authenticate hook, from ${from.key}, whose hook authenticated it; refusing the move.`,
        );
        this.refuseConnect(
          ws,
          nsp,
          `Namespace "${nsp}" has no authenticate hook, and this connection was authenticated by another `
          + `gateway's; connect with ?namespace=${to.metadata?.namespace}`,
        );

        return false;
      }

      // Neither gateway has a hook: no identity to swap, so nothing to wait for. A message of
      // `from` still running stops at its next guard or before its handler body.
      const outcome = await this.rebindSocket(ws, from, to);
      if (outcome !== 'moved') {
        this.failMove(ws, nsp, outcome);

        return false;
      }

      return true;
    }

    const move = this.socketioMoves.get(ws.data);
    if (!move) {
      // Every connection a CONNECT can bring to a gateway with a hook has one, so this is a client
      // data object user code replaced. Without its upgrade request there is nothing to
      // authenticate against.
      this.logger.warn(`Socket.IO client ${ws.data.id} has no upgrade request left to authenticate a move to "${nsp}"`);
      this.refuseConnect(ws, nsp, UNAUTHORIZED);

      return false;
    }
    if (move.hookUnsettled) {
      this.logger.warn(
        `Socket.IO client ${ws.data.id} asked for namespace "${nsp}" while an earlier authenticate call `
        + 'for it has not settled; refusing it without calling the hook again.',
      );
      this.refuseConnect(ws, nsp, AUTHENTICATION_PENDING);

      return false;
    }

    const identity = await this.authenticateMove(ws, nsp, move, authenticate);
    if (!identity) {
      this.refuseConnect(ws, nsp, UNAUTHORIZED);

      return false;
    }

    // The hook may have taken a while; a connection that closed meanwhile goes nowhere.
    if (!this.servedBy(ws, from)) {
      return false;
    }

    const waited = await this.quiesce(move);
    if (waited !== 'quiet') {
      this.logger.warn(
        waited === 'overflow'
          ? `Socket.IO client ${ws.data.id} sent more than ${MAX_HELD_MESSAGES} messages while its move to `
            + `"${nsp}" waited; refusing the move.`
          : `Socket.IO client ${ws.data.id} still had messages running on ${from.key} after `
            + `${MOVE_AUTHENTICATE_TIMEOUT_MS} ms; refusing its move to "${nsp}".`,
      );
    }
    const outcome = waited === 'quiet' && this.servedBy(ws, from)
      ? await this.rebindSocket(ws, from, to, identity)
      : 'refused';
    if (outcome === 'moved') {
      return true;
    }

    this.failMove(ws, nsp, outcome, waited === 'overflow' ? HELD_OVERFLOW : MOVE_FAILED);
    // Refused, the connection is still `from`'s, as before the CONNECT: so are the EVENTs the move
    // held. Broken, it was closed, and they are dropped.
    this.releaseHeld(ws, move, async ({ event, data, ackId }) => await this.routeCounted(ws, move, event, data, ackId));

    return false;
  }

  /**
   * Answer a CONNECT whose move did not happen. Refused before the connection changed hands, it
   * stays where it was. Broken — the connection changed hands and the move could not finish — it is
   * closed: it would otherwise sit on the new gateway with its CONNECT unanswered.
   */
  private failMove(
    ws: ServerWebSocket<WsClientData>,
    nsp: string,
    outcome: 'refused' | 'broken',
    message: string = MOVE_FAILED,
  ): void {
    this.refuseConnect(ws, nsp, message);
    if (outcome === 'broken' && ws.readyState === WS_OPEN) {
      ws.close(WS_INTERNAL_ERROR_CODE, MOVE_FAILED);
    }
  }

  /**
   * Hold the connection's new EVENTs and wait, within the bound, until the ones its current
   * gateway is serving have settled: `quiet` when they did, `busy` when the bound expired first,
   * `overflow` when the client sent more than `MAX_HELD_MESSAGES` meanwhile.
   */
  private async quiesce(move: SocketioMove): Promise<'quiet' | 'busy' | 'overflow'> {
    move.held = [];
    if (move.inFlight === 0) {
      return 'quiet';
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        new Promise<'quiet'>((resolve) => {
          move.idle = () => resolve('quiet');
        }),
        new Promise<'overflow'>((resolve) => {
          move.overflow = () => resolve('overflow');
        }),
        new Promise<'busy'>((resolve) => {
          timer = setTimeout(() => resolve('busy'), MOVE_AUTHENTICATE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      move.idle = undefined;
      move.overflow = undefined;
    }
  }

  /**
   * Run the target gateway's `authenticate` hook for a move, with what the upgrade gave the first
   * gateway's: the same token and a request with the upgrade's URL and headers. The identity it
   * answers, or `undefined` when it refused — by answering `false`, by throwing, or by not
   * answering within the bound. A call past its bound keeps `hookUnsettled` until it settles.
   */
  private async authenticateMove(
    ws: ServerWebSocket<WsClientData>,
    nsp: string,
    move: SocketioMove,
    authenticate: (context: WsAuthContext) => WsAuthResult | Promise<WsAuthResult>,
  ): Promise<HookIdentity | undefined> {
    const { upgrade } = move;
    const token = upgradeToken(new URL(upgrade.url), upgrade.headers);
    const request = new Request(upgrade.url, { headers: upgrade.headers });

    move.hookUnsettled = true;
    const call = (async () => await authenticate({ token, request }))();
    const settled = (): void => {
      move.hookUnsettled = false;
    };
    void call.then(settled, settled);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: WsAuthResult | typeof HOOK_TIMED_OUT;
    try {
      result = await Promise.race([
        call,
        new Promise<typeof HOOK_TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(HOOK_TIMED_OUT), MOVE_AUTHENTICATE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.logger.warn(`WebSocket authenticate hook threw on a move to "${nsp}", refusing it: ${error}`);

      return undefined;
    } finally {
      clearTimeout(timer);
    }

    if (result === HOOK_TIMED_OUT) {
      this.logger.warn(
        `WebSocket authenticate hook did not answer a move to "${nsp}" within `
        + `${MOVE_AUTHENTICATE_TIMEOUT_MS} ms; refusing it.`,
      );

      return undefined;
    }

    return identityFrom(token, result);
  }

  /** Answer a CONNECT with a Socket.IO CONNECT_ERROR, if anyone is still there to read it. */
  private refuseConnect(ws: ServerWebSocket<WsClientData>, nsp: string, message: string): void {
    if (ws.readyState === WS_OPEN) {
      ws.send(wrapInEngineIO(createConnectErrorPacket({ message }, nsp)));
    }
  }

  /**
   * The gateway a CONNECT packet's `nsp` names, if any.
   *
   * `/` is the default namespace and names no gateway, so it leaves the binding the upgrade made
   * — including one `?namespace=` already chose. A namespace that matches nothing is reported and
   * likewise leaves the binding alone: a stated namespace narrows the choice, it never refuses
   * the connection.
   */
  private gatewayForPacketNamespace(nsp: string): GatewayInstance | undefined {
    const name = nsp.startsWith('/') ? nsp.slice(1) : nsp;
    if (name === '') {
      return undefined;
    }

    for (const gateway of this.gateways.values()) {
      if (gateway.metadata?.namespace === name) {
        return gateway;
      }
    }

    this.logger.warn(
      `Socket.IO client asked for namespace "${nsp}", which matches no gateway. `
      + 'Keeping the gateway resolved at upgrade.',
    );

    return undefined;
  }

  /**
   * Move an open socket from one gateway to another, stored record and registry, and say how it
   * went: `moved`; `refused` when the connection closed or its record could not be written, before
   * anything changed hands; `broken` when the connection changed hands and the removal of the rooms
   * it left failed — it can be neither finished nor undone, so the caller closes it.
   *
   * The stored record moves first: from then on a gateway reading it — `from`'s fence in a
   * server-side `joinRoom()`, on this instance or another — no longer finds the client its own.
   * `identity`, when `to`'s hook gave one, is written with it, and becomes the live `auth` and
   * `metadata` in the same synchronous step as the registry move, so `to`'s guards never see the
   * connection with another identity. Without one, `auth` and `metadata` stay as they are.
   *
   * Rooms do not move with it: the socket arrives on `to` in no room. A room joined while it
   * belonged to `from` was joined under `from`'s `@OnJoinRoom` guards, or under none, and `to`'s
   * were never asked; carried over, the membership would receive `to`'s room broadcasts unchecked.
   * The rooms are cleared in that same synchronous step, so there is no moment at which the socket
   * belongs to `to` and still holds `from`'s rooms. Nothing here waits on a join: one still pending
   * on `from`'s guards is cancelled and answered at once.
   */
  private async rebindSocket(
    ws: ServerWebSocket<WsClientData>,
    from: GatewayInstance,
    to: GatewayInstance,
    identity?: HookIdentity,
  ): Promise<'moved' | 'refused' | 'broken'> {
    const client = ws.data;
    const clientId = client.id;

    try {
      await this.storage.updateClient(clientId, identity ? { gatewayKey: to.key, ...identity } : { gatewayKey: to.key });
    } catch (error) {
      this.logger.error(`WebSocket client ${clientId} could not be moved to ${to.key}: ${error}`);
      // The write may have been applied and only its answer lost. The connection stays on `from`
      // as it is, so its record says so again.
      try {
        await this.storage.updateClient(clientId, {
          gatewayKey: from.key,
          auth: client.auth,
          metadata: client.metadata,
        });
      } catch (restoreError) {
        this.logger.error(`WebSocket client ${clientId}'s record could not be restored after a failed move: ${restoreError}`);
      }

      return 'refused';
    }

    if (!this.servedBy(ws, from)) {
      // Closed while the record was written. Its close removed the record, and a write that
      // landed after that removal put it back; nothing would remove it again.
      if (ws.readyState !== WS_OPEN) {
        try {
          await this.storage.removeClient(clientId);
        } catch (error) {
          this.logger.error(`WebSocket client ${clientId}'s record could not be removed after it closed during a move: ${error}`);
        }
      }

      return 'refused';
    }

    if (identity) {
      client.auth = identity.auth;
      client.metadata = identity.metadata;
    }

    // The gateway's own map IS the handler's map for that key — `_attachSockets` shares the one
    // object — so these two calls move the socket in both at once. A join started on `from`
    // checks the owner before and after its storage write, and backs out once it is `to`.
    from.instance._unregisterSocket(clientId);
    client.gatewayKey = to.key;
    to.instance._registerSocket(clientId, ws);
    this.movedAway.set(ws, from);

    // Joins waiting on `from`'s guards.
    cancelRoomJoins(ws, 'moved');

    const rooms = client.rooms;
    client.rooms = [];
    for (const room of rooms) {
      for (const topic of from.instance._roomTopics(room)) {
        ws.unsubscribe(topic);
      }
    }

    // The stored memberships, decided in this same step as well. The removals of the rooms the
    // connection had are issued now — the in-memory adapter completes them before anything else
    // runs — and so is the read of the rooms the storage alone records. On Redis that read is
    // ordered before any write issued after the move, so the sweep removes only rooms the
    // connection had at the move, never one `to` adds once it owns the socket. Every join of this
    // socket meanwhile — the client's or a server-side `joinRoom()` — waits for it.
    const removed = Promise.all(rooms.map(async (room) => await this.storage.removeClientFromRoom(clientId, room)));
    const stored = this.storage.getRoomsForClient(clientId);
    const clearing = this.sweepStoredRooms(ws, rooms, removed, stored);
    trackRoomsClearing(ws, clearing);
    try {
      await clearing;
    } catch (error) {
      this.logger.error(`WebSocket client ${clientId} moved to ${to.key}, but the rooms it left could not be removed: ${error}`);

      return 'broken';
    }

    return 'moved';
  }

  /**
   * Finish a move's storage cleanup: once the removals of the rooms the connection had are done,
   * remove the rooms the storage alone recorded at the move — the read was issued then. A room the
   * new gateway has admitted the client to since is left alone.
   */
  private async sweepStoredRooms(
    ws: ServerWebSocket<WsClientData>,
    had: string[],
    removed: Promise<unknown>,
    stored: Promise<string[]>,
  ): Promise<void> {
    const [, storedAtMove] = await Promise.all([removed, stored]);
    const client = ws.data;

    for (const room of storedAtMove) {
      if (!had.includes(room) && !client.rooms.includes(room)) {
        await this.storage.removeClientFromRoom(client.id, room);
      }
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
      let ran = false;

      for (const handler of handlers) {
        if (!handler.pattern) {
          continue;
        }

        const match = matchPattern(handler.pattern, event);
        if (match.matched) {
          try {
            // A second handler of the same message starts after the first one's wait, and a
            // Socket.IO move may have taken the connection away from this gateway meanwhile.
            const result = ran && this.movedFrom(ws, gateway)
              ? MOVED_AWAY
              : await this.executeHandler(gateway, handler, ws, data, match.params);
            ran = true;

            if (result === MOVED_AWAY) {
              // A Socket.IO move landed while the message was on its way: the rest of it is not run.
              if (ws.readyState === WS_OPEN) {
                this.sendForbidden(ws, event, ackId, MESSAGE_CANCELLED_BY_MOVE_MESSAGE);
              }

              return;
            }

            if (result === GUARD_DENIED) {
              this.sendForbidden(ws, event, ackId);

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
   * Answer a message the framework refused with the `FORBIDDEN` error frame.
   *
   * Answer the client rather than leave it waiting on a reply that will never arrive — an
   * unanswered ack id is indistinguishable from a hung server. One frame for every refusal that
   * answers — a denied message, a denied room join, a join cancelled before it happened — so they
   * all read the same to the client; only `message` says which it was.
   */
  private sendForbidden(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    ackId?: number,
    message: string = GUARD_DENIED_MESSAGE,
  ): void {
    ws.send(this.encodeResponse(
      ws.data.protocol,
      {
        event: GUARD_DENIED_EVENT,
        data: { code: 'FORBIDDEN', event, message },
      },
      ackId,
    ));
  }

  /**
   * Handle room join.
   *
   * A guard on `@OnJoinRoom` decides whether the client joins, so the guards run BEFORE the room
   * changes: those of every handler whose pattern matches the room, in declaration order. One
   * denial keeps the client out — no storage write, no subscription, nothing in `client.rooms` —
   * runs none of the handlers, and is answered with the `FORBIDDEN` frame a denied message gets.
   * The gateway-level guards are part of every handler's list; a room no handler matches is
   * decided by them alone, under a handler without a method (`bareRoomJoin`), and a gateway without
   * them joins it without asking any guard. Once every guard has allowed it, the join and the
   * handlers run as they do without guards: the room change first, then each handler, without
   * asking its guards a second time.
   *
   * A join that asks guards is pending until its room change is made — see `joinAfterGuards`.
   */
  private async handleRoomJoin(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    const roomName = roomNameOf(event, data, 'join:');
    if (roomName === undefined) {
      this.logger.debug(`Ignoring a room join from client ${ws.data.id} that names no room`);

      return;
    }

    // A Socket.IO move is clearing this connection's stored rooms: a join must not land between
    // that clearing's read and its removals, or the removal takes the new membership with it.
    const clearing = roomsClearing(ws);
    if (clearing) {
      await clearing;
    }

    // OnJoinRoom handlers — owning gateway only — matched before the room changes, because their
    // guards decide whether it does.
    const joinOwner = this.ownerOf(ws);
    const matched: MatchedRoomHandler[] = [];
    for (const gateway of joinOwner ? [joinOwner] : []) {
      for (const handler of gateway.handlers.get(HandlerType.JOIN_ROOM) || []) {
        const match = handler.pattern ? matchPattern(handler.pattern, roomName) : { matched: true, params: {} };
        if (match.matched) {
          matched.push({ gateway, handler, params: match.params });
        }
      }
    }

    if (matched.some(({ handler }) => handler.guards && handler.guards.length > 0)) {
      await this.joinAfterGuards(ws, event, data, ackId, roomName, joinOwner, matched);

      return;
    }

    // No matching handler carries guards — with gateway-level guards that means none matches, as
    // every handler's list starts with them. They decide the join on their own.
    if (joinOwner?.bareJoin) {
      const deciding = [{ gateway: joinOwner, handler: joinOwner.bareJoin, params: {} }];
      await this.joinAfterGuards(ws, event, data, ackId, roomName, joinOwner, matched, deciding);

      return;
    }

    if (await this.addToRoom(ws, roomName, joinOwner)) {
      await this.runJoinHandlers(ws, event, data, ackId, roomName, matched);
    }
  }

  /**
   * A join that asks guards: pending from its arrival until its room change is made.
   *
   * While pending it can be cancelled, and is then answered at once instead of joining: by a
   * `leave` of the same room — the client's own or a server-side `leaveRoom()` — which takes effect
   * immediately, and by a Socket.IO move to another gateway, whose guards it never asked. Whatever
   * its guards say afterwards is ignored. A connection that closed is dropped silently — there is
   * nobody to answer — and asks no further guard.
   *
   * @param matched - the `@OnJoinRoom` handlers whose pattern matches the room, run once it is joined
   * @param deciding - whose guards decide the join: the matched handlers, or the gateway's
   *   `bareJoin` when none of them carries guards
   */
  private async joinAfterGuards(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId: number | undefined,
    roomName: string,
    joinOwner: GatewayInstance | undefined,
    matched: MatchedRoomHandler[],
    deciding: MatchedRoomHandler[] = matched,
  ): Promise<void> {
    const join = trackRoomJoin(ws, roomName, (reason) => {
      if (ws.readyState === WS_OPEN) {
        this.sendForbidden(
          ws,
          event,
          ackId,
          reason === 'left' ? JOIN_CANCELLED_BY_LEAVE_MESSAGE : JOIN_CANCELLED_BY_MOVE_MESSAGE,
        );
      }
    });

    let joined = false;
    try {
      joined = await this.admitAfterGuards(ws, event, data, ackId, join, joinOwner, deciding);
    } finally {
      untrackRoomJoin(ws, join);
    }

    if (joined) {
      await this.runJoinHandlers(ws, event, data, ackId, roomName, matched);
    }
  }

  /**
   * Ask the guards of a pending join, then make its room change — each step only while the join
   * is still wanted, so a cancelled or orphaned join asks no further guard and writes nothing.
   * A cancelled join was answered when it was cancelled; nothing is sent for it here.
   */
  private async admitAfterGuards(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId: number | undefined,
    join: PendingRoomJoin,
    joinOwner: GatewayInstance | undefined,
    deciding: MatchedRoomHandler[],
  ): Promise<boolean> {
    for (const { gateway, handler, params } of deciding) {
      if (!handler.guards || handler.guards.length === 0) {
        continue;
      }
      if (!this.joinWanted(ws, joinOwner, join)) {
        return false;
      }
      const verdict = await this.joinGuardsAllow(gateway, handler, ws, data, params, join.room);
      if (verdict !== true) {
        // A join a move stopped was answered when the move cancelled it.
        if (join.cancelled === undefined) {
          this.sendForbidden(
            ws,
            event,
            ackId,
            verdict === MOVED_AWAY ? JOIN_CANCELLED_BY_MOVE_MESSAGE : GUARD_DENIED_MESSAGE,
          );
        }

        return false;
      }
    }

    // The guards may have taken a while. A closed connection must not be written back into a
    // room its close already removed it from — nothing would remove it again — a moved one must
    // not take a membership its new gateway's guards never saw, and a cancelled join stays undone.
    if (!this.joinWanted(ws, joinOwner, join)) {
      return false;
    }

    return await this.addToRoom(ws, join.room, joinOwner, join);
  }

  /** Whether a pending join may still go ahead: not cancelled, connection open and not moved. */
  private joinWanted(
    ws: ServerWebSocket<WsClientData>,
    joinOwner: GatewayInstance | undefined,
    join: PendingRoomJoin,
  ): boolean {
    return join.cancelled === undefined && this.servedBy(ws, joinOwner);
  }

  /**
   * Add the client to a room — storage, subscription, `client.rooms` — and say whether it stays.
   *
   * The storage write is the one wait inside the room change, and a close, a Socket.IO move or a
   * leave cancelling a pending join can land during it. Each of them has already taken the client
   * out of the room, so a write that finishes after one of them is taken back rather than left as
   * a membership nothing will remove.
   */
  private async addToRoom(
    ws: ServerWebSocket<WsClientData>,
    roomName: string,
    joinOwner: GatewayInstance | undefined,
    join?: PendingRoomJoin,
  ): Promise<boolean> {
    const client = ws.data;

    // Add to storage
    await this.storage.addClientToRoom(client.id, roomName);
    if (!this.servedBy(ws, joinOwner) || join?.cancelled !== undefined) {
      await this.storage.removeClientFromRoom(client.id, roomName);

      return false;
    }

    // Subscribe to Bun pub/sub
    ws.subscribe(roomName);

    // Update client data
    if (!client.rooms.includes(roomName)) {
      client.rooms.push(roomName);
    }

    return true;
  }

  /**
   * Run the matched `@OnJoinRoom` handlers once the client is in the room; their guards have run.
   *
   * A body does not run once a Socket.IO move has taken the connection away from the gateway that
   * made the join: the move has taken the client out of the room again, so the rest of the join is
   * not run, and a join no handler answered yet is answered as one the move cancelled.
   */
  private async runJoinHandlers(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId: number | undefined,
    roomName: string,
    matched: MatchedRoomHandler[],
  ): Promise<void> {
    let answered = false;
    for (const { gateway, handler, params } of matched) {
      if (this.movedFrom(ws, gateway)) {
        if (!answered && ws.readyState === WS_OPEN) {
          this.sendForbidden(ws, event, ackId, JOIN_CANCELLED_BY_MOVE_MESSAGE);
        }

        return;
      }
      try {
        const result = await this.executeHandler(gateway, handler, ws, data, params, roomName, true);
        if (result !== undefined && isWsHandlerResponse(result)) {
          ws.send(this.encodeResponse(ws.data.protocol, result, ackId));
          answered = true;
        }
      } catch (error) {
        this.logger.error(`Error in OnJoinRoom handler: ${error}`);
      }
    }
  }

  /**
   * Whether a Socket.IO move took the connection away from `gateway`: the one reason a message
   * `gateway` started stops before its next guard or its handler body. A connection that closed has
   * not moved, and its message runs on as it always did.
   */
  private movedFrom(ws: ServerWebSocket<WsClientData>, gateway: GatewayInstance): boolean {
    return this.movedAway.get(ws) === gateway;
  }

  /** Whether the socket is still open and still bound to the gateway a room change started on. */
  private servedBy(ws: ServerWebSocket<WsClientData>, owner: GatewayInstance | undefined): boolean {
    return ws.readyState === WS_OPEN && this.ownerOf(ws) === owner;
  }

  /**
   * Ask one `@OnJoinRoom` handler's guards — or the gateway's `bareJoin` — whether the join of
   * `roomName`, the room the join will add the client to, may happen.
   *
   * Fails closed: a guard that throws already denies inside `executeGuards`, and anything else
   * that throws while the guards are asked denies too, because the join would otherwise go ahead
   * without them.
   */
  private async joinGuardsAllow(
    gateway: GatewayInstance,
    handler: WsHandlerMetadata,
    ws: ServerWebSocket<WsClientData>,
    data: unknown,
    patternParams: Record<string, string>,
    roomName: string,
  ): Promise<GuardVerdict> {
    try {
      return await this.guardsAllow(gateway, handler, ws, data, patternParams, roomName);
    } catch (error) {
      this.logger.error(
        `WebSocket guards of ${handlerLabel(handler)} threw on a room join for client ${ws.data.id}, denying: ${error}`,
      );

      return false;
    }
  }

  /**
   * Handle room leave.
   *
   * The room change comes first and a guard on `@OnLeaveRoom` cannot undo it: a denial skips the
   * handler and nothing else. A guard that could hold a client in a room would turn "deny" into
   * "keep receiving the room's broadcasts", the opposite of what a denial is for.
   *
   * A leave never waits for a join. It takes effect at once and cancels every join of the same room
   * this connection still has waiting on guards — each answered there and then — so a `join`
   * followed by a `leave` ends with the client out of the room however long the join's guards take,
   * or if they never answer.
   */
  private async handleRoomLeave(
    ws: ServerWebSocket<WsClientData>,
    event: string,
    data: unknown,
    ackId?: number,
  ): Promise<void> {
    const client = ws.data;
    const roomName = roomNameOf(event, data, 'leave:');
    if (roomName === undefined) {
      this.logger.debug(`Ignoring a room leave from client ${client.id} that names no room`);

      return;
    }

    cancelRoomJoins(ws, 'left', roomName);

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
      let ran = false;

      for (const handler of handlers) {
        const match = handler.pattern ? matchPattern(handler.pattern, roomName) : { matched: true, params: {} };

        if (match.matched) {
          // A second handler starts after the first one's wait; a Socket.IO move may have landed.
          if (ran && this.movedFrom(ws, gateway)) {
            return;
          }
          ran = true;
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
   * Run a handler's guards, logging a denial and a guard that threw.
   *
   * One guard at a time, confirming after each that no Socket.IO move has taken the connection
   * away from `gateway`. A guard may wait, and a move landing meanwhile hands the connection — the
   * client object the guards read — to another gateway, with that gateway's identity. A guard of
   * the gateway that started the message never reads it, and neither does its handler body. A
   * close is not a move: the message of a connection that closed runs on.
   *
   * @param roomName - the room a join or leave changes, which the guards read from the context
   */
  private async guardsAllow(
    gateway: GatewayInstance,
    handler: WsHandlerMetadata,
    ws: ServerWebSocket<WsClientData>,
    data: unknown,
    patternParams: Record<string, string>,
    roomName?: string,
  ): Promise<GuardVerdict> {
    const client = ws.data;
    const context = new WsExecutionContextImpl(
      client,
      ws,
      data,
      handler,
      patternParams,
      roomName,
    );
    const onError = (name: string, error: unknown): void => {
      // The framework's own diagnostic. Before this, a guard that threw denied the message
      // and said nothing anywhere — indistinguishable from a guard that meant to deny.
      this.logger.error(
        `WebSocket guard ${name} threw on ${gateway.metadata?.path ?? '/'} ` +
        `${handlerLabel(handler)} for client ${client.id}, denying: ${error}`,
      );
    };

    for (const guard of handler.guards ?? []) {
      if (!(await executeGuards([guard], context, onError))) {
        this.logger.warn(
          `WebSocket guard denied ${handlerLabel(handler)} (${handler.pattern ?? handler.type}) ` +
          `for client ${client.id}`,
        );

        return false;
      }
      if (this.movedFrom(ws, gateway)) {
        return MOVED_AWAY;
      }
    }

    return true;
  }

  /**
   * Execute a handler with parameter injection
   *
   * @param guardsChecked - the caller already ran this handler's guards and they allowed it, as a
   *   room join does before the room changes. Skipping them here keeps each guard to one call.
   */
  private async executeHandler(
    gateway: GatewayInstance,
    handler: WsHandlerMetadata,
    ws: ServerWebSocket<WsClientData>,
    data: unknown,
    patternParams: Record<string, string>,
    roomName?: string,
    guardsChecked = false,
  ): Promise<unknown> {
    const client = ws.data;
    const instance = gateway.instance;

    // Check guards
    let waited = false;
    if (!guardsChecked && handler.guards && handler.guards.length > 0) {
      const verdict = await this.guardsAllow(gateway, handler, ws, data, patternParams, roomName);
      if (verdict !== true) {
        return verdict === false ? GUARD_DENIED : MOVED_AWAY;
      }
      waited = true;
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

    // After a wait — the guards', or an interceptor's before it calls the handler — the body does
    // not run once a Socket.IO move has taken the connection away from `gateway`.
    const intercepted = handler.interceptors !== undefined && handler.interceptors.length > 0;
    let movedAway = false;
    const handlerFn = async (): Promise<unknown> => {
      if ((waited || intercepted) && this.movedFrom(ws, gateway)) {
        movedAway = true;

        return undefined;
      }

      return await method.apply(instance, args);
    };

    let result: unknown;
    if (intercepted) {
      const ctx = new WsExecutionContextImpl(client, ws, data, handler, patternParams, roomName);
      result = await composeInterceptors(handler.interceptors ?? [], ctx, handlerFn)();
    } else {
      result = await handlerFn();
    }

    return movedAway ? MOVED_AWAY : result;
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
   * Left to `server.stop(true)` at the end of `app.stop()`, a client would see no close frame at
   * all — `readyState` still 1 and no close event — and be cut only when the process died, as an
   * abnormal 1006 at an arbitrary moment instead of a clean going-away at a controlled one.
   *
   * Bounded, because a socket whose close callback never arrives must not turn shutdown into a
   * hang. A connection still open when the bound expires is dropped by `server.stop(true)`.
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

    // Remove the clients THIS handler still holds, and only those. It used to call
    // `storage.clear()`, which under the Redis adapter globs the whole prefix — so one pod
    // shutting down cleanly deleted every other pod's live clients and emptied their shared
    // rooms. Measured: a rolling deploy blanked the survivors on every replica it cycled.
    const ours = new Set<string>();
    for (const sockets of this.socketsByGateway.values()) {
      for (const clientId of sockets.keys()) {
        ours.add(clientId);
      }
    }
    for (const socket of this.openSockets) {
      if (socket.data?.id !== undefined) {
        ours.add(socket.data.id);
      }
    }

    await Promise.all([...ours].map(async (clientId) => {
      try {
        await this.storage.removeClient(clientId);
      } catch (error) {
        this.logger.warn(`Failed to remove WebSocket client ${clientId} during shutdown: ${error}`);
      }
    }));

    // And the per-gateway socket maps. `closeAll` normally drains them through each socket's
    // close callback, but a socket whose callback never arrives within the drain timeout is
    // dropped by `server.stop(true)` with `handleClose` unrun — and its entry would otherwise
    // stay in a map a live gateway instance still reads.
    for (const sockets of this.socketsByGateway.values()) {
      sockets.clear();
    }
    this.openSockets.clear();
  }
}

/**
 * Check if a class is a WebSocket gateway (for use in module)
 */
export { isWebSocketGateway };
