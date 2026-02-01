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

// ============================================================================
// Execution Context Implementation
// ============================================================================

/**
 * Implementation of MessageExecutionContext
 */
export class MessageExecutionContextImpl implements MessageExecutionContext {
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
 */
export class MessageAuthGuard implements MessageGuard {
  canActivate(context: MessageExecutionContext): boolean {
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
 */
export class MessageServiceGuard implements MessageGuard {
  constructor(private readonly allowedServices: string[]) {}

  canActivate(context: MessageExecutionContext): boolean {
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
 */
export class MessageHeaderGuard implements MessageGuard {
  constructor(
    private readonly headerName: string,
    private readonly expectedValue?: string,
  ) {}

  canActivate(context: MessageExecutionContext): boolean {
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
 */
export class MessageTraceGuard implements MessageGuard {
  canActivate(context: MessageExecutionContext): boolean {
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
 * Execute an array of guards and return whether all passed
 *
 * @param guards - Array of guard instances or constructors
 * @param context - Message execution context
 * @returns Whether all guards passed
 */
export async function executeMessageGuards(
  guards: Array<MessageGuard | MessageGuardConstructor>,
  context: MessageExecutionContext,
): Promise<boolean> {
  for (const guard of guards) {
    const guardInstance = typeof guard === 'function' ? new guard() : guard;
    const result = await guardInstance.canActivate(context);
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
 */
export function createMessageGuard(
  checkFn: (context: MessageExecutionContext) => boolean | Promise<boolean>,
): MessageGuard {
  return {
    canActivate: checkFn,
  };
}
