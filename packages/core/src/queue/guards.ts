/**
 * Message Guards
 *
 * Guards for message handlers, similar to WebSocket guards.
 * Guards can be used to authorize message processing.
 */

import type {
  Message,
  MessageMetadata,
  MessageGuard,
  MessageExecutionContext,
  MessageGuardConstructor,
} from './types';
import type { ExecutionContext } from '../types';

import { guardName } from '../http-guards/guard-binding';
import { isQueueContext } from '../types';

// ============================================================================
// Execution Context Implementation
// ============================================================================

/**
 * Implementation of MessageExecutionContext
 */
export class MessageExecutionContextImpl implements MessageExecutionContext {
  readonly type = 'queue' as const;

  constructor(
    private readonly message: Message,
    private readonly pattern: string,
    private readonly handler: (...args: unknown[]) => unknown,
    private readonly targetClass: new (...args: unknown[]) => unknown,
  ) {}

  getMessage<T>(): Message<T> {
    return this.message as Message<T>;
  }

  getMetadata(): MessageMetadata {
    return this.message.metadata;
  }

  getPattern(): string {
    return this.pattern;
  }

  getHandler(): (...args: unknown[]) => unknown {
    return this.handler;
  }

  getClass(): new (...args: unknown[]) => unknown {
    return this.targetClass;
  }
}

// ============================================================================
// Built-in Guards
// ============================================================================

/**
 * Guard that checks for the presence of an authorization token
 *
 * @example
 * ```typescript
 * @UseMessageGuards(MessageAuthGuard)
 * @Subscribe('orders.*')
 * async handleOrder(message: Message<OrderData>) {
 *   // Only messages with authorization token will be processed
 * }
 * ```
 * @see docs:api/queue.md
 */
export class MessageAuthGuard implements MessageGuard {
  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and WebSocket handlers too. This guard reads message
    // metadata, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isQueueContext(context)) {
      return false;
    }

    const metadata = context.getMetadata();

    return !!metadata.authorization;
  }
}

/**
 * Guard that checks if the message comes from an allowed service
 *
 * @example
 * ```typescript
 * const serviceGuard = new MessageServiceGuard(['payment-service', 'order-service']);
 *
 * @UseMessageGuards(serviceGuard)
 * @Subscribe('events.internal.*')
 * async handleInternalEvent(message: Message<EventData>) {
 *   // Only messages from allowed services will be processed
 * }
 * ```
 * @see docs:api/queue.md
 */
export class MessageServiceGuard implements MessageGuard {
  constructor(private readonly allowedServices: string[]) {}

  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and WebSocket handlers too. This guard reads message
    // metadata, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isQueueContext(context)) {
      return false;
    }

    const metadata = context.getMetadata();
    const serviceId = metadata.serviceId;

    if (!serviceId) {
      return false;
    }

    return this.allowedServices.includes(serviceId);
  }
}

/**
 * Guard that requires a specific header to be present
 *
 * @example
 * ```typescript
 * const headerGuard = new MessageHeaderGuard('x-api-key');
 *
 * @UseMessageGuards(headerGuard)
 * @Subscribe('api.*')
 * async handleApiRequest(message: Message<RequestData>) {
 *   // Only messages with x-api-key header will be processed
 * }
 * ```
 * @see docs:api/queue.md
 */
export class MessageHeaderGuard implements MessageGuard {
  constructor(
    private readonly headerName: string,
    private readonly expectedValue?: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and WebSocket handlers too. This guard reads message
    // metadata, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isQueueContext(context)) {
      return false;
    }

    const metadata = context.getMetadata();
    const headers = metadata.headers;

    if (!headers) {
      return false;
    }

    const value = headers[this.headerName];

    if (value === undefined) {
      return false;
    }

    if (this.expectedValue !== undefined) {
      return value === this.expectedValue;
    }

    return true;
  }
}

/**
 * Guard that checks for trace context (for distributed tracing requirements)
 *
 * @example
 * ```typescript
 * @UseMessageGuards(MessageTraceGuard)
 * @Subscribe('traced.*')
 * async handleTracedEvent(message: Message<EventData>) {
 *   // Only messages with trace context will be processed
 * }
 * ```
 * @see docs:api/queue.md
 */
export class MessageTraceGuard implements MessageGuard {
  canActivate(context: ExecutionContext): boolean {
    // `@UseGuards` reaches HTTP routes and WebSocket handlers too. This guard reads message
    // metadata, so anywhere else it denies rather than throwing on an absent accessor.
    if (!isQueueContext(context)) {
      return false;
    }

    const metadata = context.getMetadata();

    return !!metadata.traceId;
  }
}

// ============================================================================
// Composite Guards
// ============================================================================

/**
 * Guard that passes if ALL of the provided guards pass
 *
 * @example
 * ```typescript
 * const allGuards = new MessageAllGuards([
 *   MessageAuthGuard,
 *   new MessageServiceGuard(['payment-service']),
 * ]);
 *
 * @UseMessageGuards(allGuards)
 * @Subscribe('secure.*')
 * async handleSecureEvent(message: Message<EventData>) {
 *   // Requires both auth and service check to pass
 * }
 * ```
 *
 * DELIBERATELY OUTSIDE DI. The children are constructed by THIS constructor, at decoration
 * time, long before any module exists — so a child class with a constructor dependency gets
 * nothing, exactly as before. Giving them DI would mean changing this public constructor, and
 * `new MessageAllGuards([...])` as documented must keep working untouched. Pass an already
 * constructed child, or list the guards directly on `@UseGuards(A, B)` where each one is
 * resolved individually with full DI.
 * @see docs:api/queue.md
 */
export class MessageAllGuards implements MessageGuard {
  private readonly guards: MessageGuard[];

  constructor(guards: Array<MessageGuard | MessageGuardConstructor>) {
    this.guards = guards.map((guard) => {
      if (typeof guard === 'function') {
        return new guard();
      }

      return guard;
    });
  }

  async canActivate(context: MessageExecutionContext): Promise<boolean> {
    // Narrowed before the children see it, like every leaf guard in this file. A composite used
    // to hand whatever context it was given straight down: on the wrong transport its built-in
    // children denied by accident, and a hand-written child threw a TypeError inside
    // canActivate — which on HTTP reaches the exception filter as a 500, a fail-open shape for
    // something whose job is to fail closed.
    if (!isQueueContext(context)) {
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
 * Guard that passes if ANY of the provided guards passes
 *
 * @example
 * ```typescript
 * const anyGuard = new MessageAnyGuard([
 *   new MessageServiceGuard(['internal-service']),
 *   MessageAuthGuard,
 * ]);
 *
 * @UseMessageGuards(anyGuard)
 * @Subscribe('events.*')
 * async handleEvent(message: Message<EventData>) {
 *   // Requires either service check OR auth to pass
 * }
 * ```
 *
 * DELIBERATELY OUTSIDE DI. The children are constructed by THIS constructor, at decoration
 * time, long before any module exists — so a child class with a constructor dependency gets
 * nothing, exactly as before. Giving them DI would mean changing this public constructor, and
 * `new MessageAllGuards([...])` as documented must keep working untouched. Pass an already
 * constructed child, or list the guards directly on `@UseGuards(A, B)` where each one is
 * resolved individually with full DI.
 * @see docs:api/queue.md
 */
export class MessageAnyGuard implements MessageGuard {
  private readonly guards: MessageGuard[];

  constructor(guards: Array<MessageGuard | MessageGuardConstructor>) {
    this.guards = guards.map((guard) => {
      if (typeof guard === 'function') {
        return new guard();
      }

      return guard;
    });
  }

  async canActivate(context: MessageExecutionContext): Promise<boolean> {
    // See MessageAllGuards: the composite narrows, so its children never see another transport.
    if (!isQueueContext(context)) {
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
// Guard Execution
// ============================================================================

/**
 * Execute an array of guards and return whether all passed.
 *
 * A guard that THROWS denies. `@UseGuards` reaches queue consumers now, so a guard written
 * against an HTTP request can land here and blow up on `getRequest()`; failing open would turn
 * that into a silent authorization bypass on every message. HTTP deliberately does the
 * opposite — a throw there travels to the exception filters so `throw new HttpException(401)`
 * keeps its status — but a message has no filter chain to carry it.
 *
 * Guards arrive already resolved when the consumer was built by a module: `registerService`
 * runs them through the owner module's resolver, so `typeof guard === 'function'` here means a
 * class registered outside DI, and zero-argument construction is the correct fallback for it.
 *
 * @param guards - Array of guard instances or constructors
 * @param context - Message execution context
 * @param onError - Called with the offending guard's name and the error, for the framework's
 *   own diagnostic. Without it a thrown guard denies silently.
 * @returns Whether all guards passed
 * @see docs:api/guards.md
 * @see docs:api/queue.md
 */
export async function executeMessageGuards(
  guards: Array<MessageGuard | MessageGuardConstructor>,
  context: MessageExecutionContext,
  onError?: (guardName: string, error: unknown) => void,
): Promise<boolean> {
  for (const guard of guards) {
    const guardInstance = typeof guard === 'function' ? new guard() : guard;

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
 * Create a guard from a simple check function
 *
 * @param checkFn - Function that returns whether the message should be processed
 * @returns MessageGuard instance
 *
 * @example
 * ```typescript
 * const customGuard = createMessageGuard((context) => {
 *   const metadata = context.getMetadata();
 *   return metadata.headers?.['x-custom-header'] === 'expected-value';
 * });
 *
 * @UseMessageGuards(customGuard)
 * @Subscribe('custom.*')
 * async handleCustomEvent(message: Message<EventData>) {
 *   // Custom guard logic
 * }
 * ```
 * @see docs:api/queue.md
 */
export function createMessageGuard(
  checkFn: (context: MessageExecutionContext) => boolean | Promise<boolean>,
): MessageGuard {
  return {
    canActivate(context: ExecutionContext): boolean | Promise<boolean> {
      // Same rule as the built-ins: the function was written against a message, so it denies
      // on any other transport instead of throwing once per request.
      if (!isQueueContext(context)) {
        return false;
      }

      return checkFn(context);
    },
  };
}
