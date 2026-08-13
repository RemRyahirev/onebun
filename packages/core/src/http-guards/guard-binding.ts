/**
 * Guard binding — how a non-HTTP registration site reaches the owner module's guard DI.
 *
 * HTTP resolves guards in `application.ts` because it has the owner module in hand there.
 * WebSocket gateways and queue consumers are registered by `WsHandler.registerGateway()` and
 * `QueueService.registerService()`, neither of which knows anything about modules — which is
 * why both used to construct guards with a bare `new guard()` and a guard with a constructor
 * dependency threw on every message, with the message dropped and nothing logged.
 *
 * The module that BUILT the controller attaches its resolver to the instance it just built,
 * and the registration sites — which are already handed that instance — read it back. Kept on
 * the instance rather than in a class-keyed registry on purpose: the same controller class can
 * be mounted by two applications in one process (multi-service mode), and a process-global map
 * keyed by class would hand the second application the first one's DI scope.
 *
 * @see docs:api/guards.md
 */

import type { Guard } from './http-guards';

import type { SyncLogger } from '@onebun/logger';

/**
 * What the owner module lends to a registration site so guards behave the same on every
 * transport: its DI-aware guard resolver, and the logger denials are reported through.
 */
export interface GuardBinding {
  /**
   * Resolve guard classes into instances with dependency injection.
   * Throws `DependencyResolutionError` when a dependency cannot be resolved — at REGISTRATION
   * time, which is application startup, not once per delivered message.
   */
  resolve(guards: (Function | Guard)[]): Guard[];

  /** The owner module's logger, so a denial is reported by the framework itself. */
  readonly logger: SyncLogger;
}

/**
 * `Symbol.for` rather than a module-local symbol: a duplicated `@onebun/core` in the
 * dependency tree must still find the binding the other copy attached, exactly as `@Global()`
 * modules already rely on.
 */
const GUARD_BINDING = Symbol.for('onebun:guard-binding');

/**
 * Attach the owner module's guard binding to a controller/gateway/consumer instance.
 * Non-enumerable so it never shows up in a spread, `JSON.stringify` or a test snapshot.
 */
export function attachGuardBinding(instance: object, binding: GuardBinding): void {
  Object.defineProperty(instance, GUARD_BINDING, {
    value: binding,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * Read back the guard binding attached by the owner module, if there is one.
 *
 * Absent for an instance built outside a module — a hand-constructed gateway in a unit test,
 * for instance. Callers fall back to zero-argument construction, which is what every guard got
 * before this existed.
 */
export function getGuardBinding(instance: unknown): GuardBinding | undefined {
  if (instance === null || (typeof instance !== 'object' && typeof instance !== 'function')) {
    return undefined;
  }

  return (instance as Record<symbol, GuardBinding | undefined>)[GUARD_BINDING];
}

/**
 * A name for a guard that survives DI resolution, for log lines and error messages.
 *
 * `resolveGuards()` returns a per-request façade rather than the guard itself, so
 * `instance.constructor.name` would read `Object` for exactly the guards that have DI. The
 * façade carries the class name explicitly; everything else falls back to its constructor.
 */
export function guardName(guard: Function | Guard): string {
  if (typeof guard === 'function') {
    return guard.name || 'anonymous guard';
  }

  const named = (guard as { guardName?: string }).guardName;
  if (typeof named === 'string' && named.length > 0) {
    return named;
  }

  return guard.constructor?.name || 'anonymous guard';
}
