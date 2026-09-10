/**
 * WebSocket Guards
 *
 * Guards for authorizing WebSocket connections and message handling.
 */

import type {
  WsClientData,
  WsGuard,
  WsExecutionContext,
  WsHandlerMetadata,
} from './ws.types';
import type { ExecutionContext } from '../types';
import type { ServerWebSocket } from 'bun';

import { guardName } from '../http-guards/guard-binding';
import { isWsContext } from '../types';


// ============================================================================
// Execution Context Implementation
// ============================================================================

/**
 * Implementation of WsExecutionContext
 */
export class WsExecutionContextImpl implements WsExecutionContext {
  readonly type = 'ws' as const;

  constructor(
    private client: WsClientData,
    private socket: ServerWebSocket<WsClientData>,
    private data: unknown,
    private handler: WsHandlerMetadata,
    private patternParams: Record<string, string>,
  ) {}

  getClient(): WsClientData {
    return this.client;
  }

  getSocket(): ServerWebSocket<WsClientData> {
    return this.socket;
  }

  getData<T = unknown>(): T {
    return this.data as T;
  }

  getHandler(): WsHandlerMetadata {
    return this.handler;
  }

  getPatternParams(): Record<string, string> {
    return this.patternParams;
  }
}

// ============================================================================
// Built-in Guards
// ============================================================================

/**
 * Guard that requires client to be authenticated
 *
 * @example
 * ```typescript
 * @UseWsGuards(WsAuthGuard)
 * @OnMessage('protected:*')
 * handleProtectedMessage(@Client() client: WsClientData) {
 *   // Only authenticated clients can reach here
 * }
 * ```
 */
export class WsAuthGuard implements WsGuard {
  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and queue consumers too. This guard reads socket
    // state, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isWsContext(context)) {
      return false;
    }

    const client = context.getClient();

    return client.auth?.authenticated === true;
  }
}

/**
 * Guard that requires specific permission(s)
 *
 * @example
 * ```typescript
 * // Single permission
 * @UseWsGuards(new WsPermissionGuard('admin'))
 * @OnMessage('admin:*')
 * handleAdminMessage() { }
 *
 * // Multiple permissions (all required)
 * @UseWsGuards(new WsPermissionGuard(['admin', 'moderator']))
 * @OnMessage('super:*')
 * handleSuperMessage() { }
 * ```
 */
export class WsPermissionGuard implements WsGuard {
  private requiredPermissions: string[];

  constructor(permissions: string | string[]) {
    this.requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
  }

  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and queue consumers too. This guard reads socket
    // state, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isWsContext(context)) {
      return false;
    }

    const client = context.getClient();
    const clientPermissions = client.auth?.permissions || [];

    return this.requiredPermissions.every((p) => clientPermissions.includes(p));
  }
}

/**
 * Guard that requires client to be in a specific room
 *
 * @example
 * ```typescript
 * @UseWsGuards(new WsRoomGuard('vip'))
 * @OnMessage('vip:*')
 * handleVipMessage() { }
 * ```
 */
export class WsRoomGuard implements WsGuard {
  constructor(private roomName: string) {}

  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and queue consumers too. This guard reads socket
    // state, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isWsContext(context)) {
      return false;
    }

    const client = context.getClient();

    return client.rooms.includes(this.roomName);
  }
}

/**
 * Guard that allows any of multiple permissions
 *
 * @example
 * ```typescript
 * @UseWsGuards(new WsAnyPermissionGuard(['admin', 'moderator']))
 * @OnMessage('manage:*')
 * handleManageMessage() { }
 * ```
 */
export class WsAnyPermissionGuard implements WsGuard {
  private permissions: string[];

  constructor(permissions: string[]) {
    this.permissions = permissions;
  }

  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and queue consumers too. This guard reads socket
    // state, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isWsContext(context)) {
      return false;
    }

    const client = context.getClient();
    const clientPermissions = client.auth?.permissions || [];

    return this.permissions.some((p) => clientPermissions.includes(p));
  }
}

/**
 * Guard that requires a specific service ID (for inter-service communication)
 *
 * @example
 * ```typescript
 * @UseWsGuards(new WsServiceGuard('payment-service'))
 * @OnMessage('payment:webhook')
 * handlePaymentWebhook() { }
 * ```
 */
export class WsServiceGuard implements WsGuard {
  private allowedServices: string[];

  constructor(services: string | string[]) {
    this.allowedServices = Array.isArray(services) ? services : [services];
  }

  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and queue consumers too. This guard reads socket
    // state, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isWsContext(context)) {
      return false;
    }

    const client = context.getClient();
    const serviceId = client.auth?.serviceId;

    if (!serviceId) {
      return false;
    }

    return this.allowedServices.includes(serviceId);
  }
}

/**
 * Composite guard that requires all guards to pass
 *
 * @example
 * ```typescript
 * @UseWsGuards(new WsAllGuards([
 *   new WsAuthGuard(),
 *   new WsPermissionGuard('admin')
 * ]))
 * @OnMessage('admin:*')
 * handleAdminMessage() { }
 * ```
 */
export class WsAllGuards implements WsGuard {
  constructor(private guards: WsGuard[]) {}

  async canActivate(context: WsExecutionContext): Promise<boolean> {
    // Narrowed before the children see it, like every leaf guard in this file — a composite used
    // to pass another transport's context straight down, where a hand-written child throws
    // instead of denying.
    if (!isWsContext(context)) {
      return false;
    }

    for (const guard of this.guards) {
      const result = await guard.canActivate(context);
      if (!result) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Composite guard that requires any guard to pass
 *
 * @example
 * ```typescript
 * @UseWsGuards(new WsAnyGuard([
 *   new WsPermissionGuard('admin'),
 *   new WsServiceGuard('internal-service')
 * ]))
 * @OnMessage('internal:*')
 * handleInternalMessage() { }
 * ```
 */
export class WsAnyGuard implements WsGuard {
  constructor(private guards: WsGuard[]) {}

  async canActivate(context: WsExecutionContext): Promise<boolean> {
    // See WsAllGuards: the composite narrows, so its children never see another transport.
    if (!isWsContext(context)) {
      return false;
    }

    for (const guard of this.guards) {
      const result = await guard.canActivate(context);
      if (result) {
        return true;
      }
    }

    return false;
  }
}

// ============================================================================
// Guard Execution Helper
// ============================================================================

/**
 * Execute a list of guards.
 *
 * A guard that THROWS denies. `@UseGuards` reaches WebSocket handlers now, so a guard written
 * against an HTTP request can land here and blow up on `getRequest()`; failing open would make
 * that a silent authorization bypass. HTTP deliberately does the opposite — a throw there
 * travels to the exception filters so `throw new HttpException(401, ...)` keeps its status —
 * but a socket has no filter chain to carry it, so the throw is reported and treated as a deny.
 *
 * @param guards - Array of guard classes or instances
 * @param context - Execution context
 * @param onError - Called with the offending guard's name and the error, for the framework's
 *   own diagnostic. Without it a thrown guard denies silently.
 * @returns Whether all guards passed
 * @see docs:api/guards.md
 */
export async function executeGuards(
  guards: (Function | WsGuard)[],
  context: WsExecutionContext,
  onError?: (guardName: string, error: unknown) => void,
): Promise<boolean> {
  for (const guard of guards) {
    let guardInstance: WsGuard;

    // Check if it's already an instance
    if (typeof guard === 'function') {
      // Create instance from class
      guardInstance = new (guard as new () => WsGuard)();
    } else {
      guardInstance = guard;
    }

    let result: boolean;
    try {
      result = await guardInstance.canActivate(context);
    } catch (error) {
      onError?.(guardName(guard), error);

      return false;
    }

    if (!result) {
      return false;
    }
  }

  return true;
}

/**
 * Create a custom guard from a function
 *
 * @param fn - Guard function
 * @returns Guard class
 *
 * @example
 * ```typescript
 * const CustomGuard = createGuard((ctx) => {
 *   return ctx.getClient().metadata.customCheck === true;
 * });
 *
 * @UseWsGuards(CustomGuard)
 * @OnMessage('custom:*')
 * handleCustomMessage() { }
 * ```
 */
export function createGuard(
  fn: (context: WsExecutionContext) => boolean | Promise<boolean>,
): new () => WsGuard {
  return class implements WsGuard {
    canActivate(context: ExecutionContext): boolean | Promise<boolean> {
      // Same rule as the built-ins: the function was written against a socket, so it denies
      // on any other transport instead of throwing once per message.
      if (!isWsContext(context)) {
        return false;
      }

      return fn(context);
    }
  };
}
