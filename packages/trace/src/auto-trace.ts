import { SpanStatusCode as OtelSpanStatusCode, trace as otelTrace } from '@opentelemetry/api';

import { type SpanAttributeEntry, SPAN_ATTRIBUTES } from './middleware.js';

/**
 * Symbols for trace metadata on classes and methods
 */
export const NO_TRACE = Symbol.for('onebun:noTrace');
export const TRACE_ALL = Symbol.for('onebun:traceAll');
export const ALREADY_TRACED = Symbol.for('onebun:traced');

/**
 * Filter options for auto-tracing
 */
export interface TraceFilterOptions {
  asyncOnly?: boolean;
  excludeMethods?: string[];
  includeClasses?: string[];
  excludeClasses?: string[];
}

/**
 * Built-in methods that should never be auto-traced.
 * Includes framework base class methods, lifecycle hooks, and internals.
 */
const EXCLUDED_METHODS = new Set([
  'constructor',
  // BaseService
  'initializeService',
  'runEffect',
  'formatError',
  // BaseController
  'initializeController',
  'isJson',
  'parseJson',
  'success',
  'error',
  'json',
  'text',
  'sse',
  // Lifecycle hooks
  'onModuleInit',
  'onApplicationInit',
  'onModuleDestroy',
  'beforeApplicationDestroy',
  'onApplicationDestroy',
  'onQueueReady',
  // Middleware
  'use',
  'configureMiddleware',
  // WebSocket
  '_initializeBase',
  'afterInit',
  'handleConnection',
  'handleDisconnect',
  // BaseService/Controller span getter
  'span',
]);

/**
 * Simple glob matching: supports `*` as wildcard.
 * `*Service` matches `UserService`, `OrderService`.
 * `User*` matches `UserService`, `UserController`.
 * `*` matches everything.
 */
function matchGlob(pattern: string, name: string): boolean {
  if (pattern === '*') {
    return true;
  }

  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    return name.includes(pattern.slice(1, -1));
  }

  if (pattern.startsWith('*')) {
    return name.endsWith(pattern.slice(1));
  }

  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }

  return name === pattern;
}

/**
 * Check if a class name matches the glob filter.
 */
function matchesClassFilter(
  className: string,
  filter?: TraceFilterOptions,
): boolean {
  if (!filter) {
    return true;
  }

  // If includeClasses is set, class must match at least one pattern
  if (filter.includeClasses && filter.includeClasses.length > 0) {
    if (!filter.includeClasses.some((pattern) => matchGlob(pattern, className))) {
      return false;
    }
  }

  // If excludeClasses is set, class must NOT match any pattern
  if (filter.excludeClasses && filter.excludeClasses.length > 0) {
    if (filter.excludeClasses.some((pattern) => matchGlob(pattern, className))) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a method is async (its constructor is AsyncFunction).
 */
function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === 'function' && fn.constructor.name === 'AsyncFunction';
}

/**
 * Wrap a method with a span. Same pattern as @Traced() but applied at runtime.
 */
function wrapMethodWithSpan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prototype: any,
  methodName: string,
  className: string,
): void {
  const original = prototype[methodName];
  const spanName = `${className}.${methodName}`;

  const wrapped = async function (
    this: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) {
    const tracer = otelTrace.getTracer('@onebun/trace');

    return await tracer.startActiveSpan(spanName, async (activeSpan) => {
      // Apply @SpanAttribute metadata if present
      const meta = prototype[SPAN_ATTRIBUTES]?.[methodName] as
        | SpanAttributeEntry[]
        | undefined;
      if (meta) {
        for (const { paramIndex, attrName } of meta) {
          const value = args[paramIndex];
          if (value !== undefined && value !== null) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              activeSpan.setAttribute(attrName, value);
            } else {
              activeSpan.setAttribute(attrName, JSON.stringify(value));
            }
          }
        }
      }

      try {
        const result = await original.apply(this, args);
        activeSpan.setStatus({ code: OtelSpanStatusCode.OK });

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        activeSpan.setStatus({ code: OtelSpanStatusCode.ERROR, message: err.message });
        activeSpan.recordException(err);
        throw error;
      } finally {
        activeSpan.end();
      }
    });
  };

  // Mark as auto-traced to prevent double-wrapping
  (wrapped as unknown as Record<symbol, boolean>)[ALREADY_TRACED] = true;
  prototype[methodName] = wrapped;
}

/**
 * Apply automatic tracing to all eligible methods on an instance.
 *
 * Walks the prototype chain (stopping at Object.prototype) and wraps
 * methods with OpenTelemetry spans. Respects @NoTrace(), @Traced(),
 * and filter options.
 *
 * @param instance - The service or controller instance
 * @param className - The class name for span naming
 * @param filter - Optional filter options
 */
export function applyAutoTrace(
  instance: unknown,
  className: string,
  filter?: TraceFilterOptions,
): void {
  if (!instance || typeof instance !== 'object') {
    return;
  }

  const asyncOnly = filter?.asyncOnly ?? true;
  const extraExcludedMethods = filter?.excludeMethods
    ? new Set(filter.excludeMethods)
    : null;

  // Walk prototype chain, collecting methods to wrap
  let proto = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    const methodNames = Object.getOwnPropertyNames(proto);

    for (const methodName of methodNames) {
      // Skip built-in excluded methods
      if (EXCLUDED_METHODS.has(methodName)) {
        continue;
      }

      // Skip user-specified excluded methods
      if (extraExcludedMethods?.has(methodName)) {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(proto, methodName);
      if (!descriptor || !descriptor.value || typeof descriptor.value !== 'function') {
        continue;
      }

      // Skip getters/setters
      if (descriptor.get || descriptor.set) {
        continue;
      }

      const method = descriptor.value;

      // Skip already-traced methods (@Traced was applied manually)
      if ((method as unknown as Record<symbol, boolean>)[ALREADY_TRACED]) {
        continue;
      }

      // Skip @NoTrace methods
      if ((method as unknown as Record<symbol, boolean>)[NO_TRACE]) {
        continue;
      }

      // If asyncOnly, skip sync methods
      if (asyncOnly && !isAsyncFunction(method)) {
        continue;
      }

      wrapMethodWithSpan(proto, methodName, className);
    }

    proto = Object.getPrototypeOf(proto);
  }
}

/**
 * @TraceAll() — class decorator.
 * Marks a class for auto-tracing even when traceAll is false in config.
 *
 * @example
 * ```typescript
 * \@Service()
 * \@TraceAll()
 * class UserService extends BaseService {
 *   async findAll() { ... } // auto-traced
 * }
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function TraceAll(): ClassDecorator {
  return (target: Function) => {
    (target as unknown as Record<symbol, boolean>)[TRACE_ALL] = true;
  };
}

/**
 * @NoTrace() — class or method decorator.
 * Excludes a class or method from auto-tracing.
 *
 * On a class: prevents all methods from being auto-traced.
 * On a method: prevents that specific method from being auto-traced.
 * Note: @Traced() on a method takes priority over @NoTrace() on the class.
 *
 * @example
 * ```typescript
 * \@Service()
 * \@NoTrace()
 * class InternalService extends BaseService {
 *   async internalWork() { ... } // NOT auto-traced
 *
 *   \@Traced() // Override: this method IS traced
 *   async importantWork() { ... }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export function NoTrace(): ClassDecorator & MethodDecorator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor && propertyKey) {
      // Method decorator
      (descriptor.value as unknown as Record<symbol, boolean>)[NO_TRACE] = true;
    } else {
      // Class decorator
      (target as unknown as Record<symbol, boolean>)[NO_TRACE] = true;
    }
  };
}

/**
 * Check if a class should be auto-traced based on global config and decorators.
 *
 * @param classConstructor - The class constructor
 * @param className - The class name
 * @param traceAll - Global traceAll setting
 * @param filter - Filter options
 * @returns true if the class should have auto-tracing applied
 */
export function shouldAutoTrace(
  classConstructor: Function,
  className: string,
  traceAll: boolean,
  filter?: TraceFilterOptions,
): boolean {
  const hasTraceAll = (classConstructor as unknown as Record<symbol, boolean>)[TRACE_ALL] === true;
  const hasNoTrace = (classConstructor as unknown as Record<symbol, boolean>)[NO_TRACE] === true;

  // @NoTrace on class → skip (unless method-level @Traced, but that's handled in applyAutoTrace)
  if (hasNoTrace) {
    return false;
  }

  // @TraceAll on class → trace regardless of global setting
  if (hasTraceAll) {
    return matchesClassFilter(className, filter);
  }

  // Global traceAll
  if (traceAll) {
    return matchesClassFilter(className, filter);
  }

  return false;
}
