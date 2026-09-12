/**
 * Queue Enablement
 *
 * Resolves whether the queue system should be initialized for an application.
 * Shared by the single-service path (`OneBunApplication.initializeQueue`) and the
 * multi-service path (`MultiServiceOrchestrator.startAll`) so both can never reach
 * different answers from the same options object.
 */

import type { QueueAdapterConstructor, BuiltInAdapterType } from '../queue/types';
import type { QueueApplicationOptions } from '../types';

/**
 * Warning emitted when `queue.enabled: false` suppresses an explicitly configured backend.
 *
 * Exported so tests assert against the constant rather than duplicating its text.
 *
 * @see docs:api/queue.md
 */
export const QUEUE_DISABLED_WITH_ADAPTER_WARNING =
  'Queue is explicitly disabled (queue.enabled: false) but a queue backend is configured '
  + '(queue.adapter / queue.options / queue.redis). The queue stays disabled, the adapter is never '
  + 'constructed, and an injected QueueService will throw. Remove queue.enabled: false to enable it.';

/**
 * Warning emitted when a class registered in `providers` carries queue decorators.
 *
 * Handler discovery walks controllers only, so those decorators are metadata nothing reads and
 * the handler never runs. Naming the class AND the method is the point: before this, the single
 * line such an application printed was "no handlers detected", three lines below a handler the
 * user had just written.
 *
 * A function rather than a constant, because the text has to carry the offending names. Exported
 * so tests assert against it rather than duplicating its wording.
 *
 * @see docs:api/queue.md
 */
export function queueHandlerOnProviderWarning(className: string, handlerNames: string[]): string {
  const handlers = handlerNames.map((name) => `${name}()`).join(', ');

  return `Queue decorators on "${className}" are ignored: ${handlers}. Handler discovery walks `
    + `controllers only, and "${className}" is registered in a module's providers — move it into `
    + 'that module\'s controllers array to run them.';
}

/**
 * Debug line for an application whose only queue decorators sit on providers.
 *
 * Separate from the general "nothing configured" wording, because the two situations need
 * different actions and the general one reads as a denial that the user's handlers exist.
 *
 * @see docs:api/queue.md
 */
export const QUEUE_NOT_ENABLED_PROVIDERS_ONLY_DEBUG =
  'Queue system not enabled: the queue decorators in this application are on providers, which '
  + 'handler discovery does not walk. Move those classes into controllers, or set '
  + 'queue.enabled: true if the queue is meant to run without them.';

/**
 * Outcome of resolving whether the queue system should be initialized.
 *
 * @see docs:api/queue.md
 */
export interface QueueEnablementDecision {
  /** Final answer: run the queue initialization path. */
  readonly enabled: boolean;
  /** An explicit `adapter`, `options` or `redis` key is present in the queue options. */
  readonly hasAdapterConfig: boolean;
  /** `enabled: false` suppressed a configured backend — the caller must log exactly one warning. */
  readonly contradiction: boolean;
}

/**
 * Whether the application explicitly configured a queue backend.
 *
 * Checks the three concrete keys rather than `queue !== undefined`: a bare
 * `queue: { enabled: false }` carries no backend and must not count as one.
 *
 * @see docs:api/queue.md
 */
export function hasExplicitQueueAdapterConfig(
  queueOptions: QueueApplicationOptions | undefined,
): boolean {
  if (queueOptions === undefined) {
    return false;
  }

  return queueOptions.adapter !== undefined
    || queueOptions.options !== undefined
    || queueOptions.redis !== undefined;
}

/**
 * Resolve whether the queue system should be enabled.
 *
 * Enabled when ANY of:
 * 1. a controller carries a queue decorator (`hasQueueHandlers`), or
 * 2. `queue.enabled === true`, or
 * 3. an explicit `queue.adapter`, `queue.options` or `queue.redis` is present.
 *
 * An explicit `queue.enabled === false` overrides all three and keeps the queue disabled.
 * When it does so while a backend is configured, the decision reports `contradiction: true`
 * so the caller logs exactly one warning. This function never throws.
 *
 * @see docs:api/queue.md
 */
export function resolveQueueEnablement(
  queueOptions: QueueApplicationOptions | undefined,
  hasQueueHandlers: boolean,
): QueueEnablementDecision {
  const hasAdapterConfig = hasExplicitQueueAdapterConfig(queueOptions);

  // Evaluated before anything else: an explicit false always wins.
  if (queueOptions?.enabled === false) {
    return { enabled: false, hasAdapterConfig, contradiction: hasAdapterConfig };
  }

  const enabled = queueOptions?.enabled === true || hasQueueHandlers || hasAdapterConfig;

  return { enabled, hasAdapterConfig, contradiction: false };
}

/**
 * Which adapter the application's queue options select.
 *
 * `queue.redis` used to enable the queue without selecting the Redis adapter — the choice was
 * `queue.adapter ?? 'memory'` and never consulted `redis`. So `queue: { redis: { url } }` booted
 * an in-memory queue, logged "in-memory adapter", and discarded every Redis setting silently.
 * Messages stayed in-process; nothing reached the broker and nothing said so. Enablement and
 * selection were two decisions where the configuration reads like one.
 *
 * An explicit `adapter` always wins, including `adapter: 'memory'` alongside a `redis` block —
 * that is a legible choice (Redis settings staged for later, or a local override) and inference
 * must not overrule what the caller wrote.
 *
 * Pure, and exported, so the selection is provable without constructing an adapter or reaching a
 * broker: the reason this stayed broken is that the only way to observe it was to boot Redis.
 *
 * @see docs:api/queue.md
 */
export function resolveQueueAdapterType(
  queueOptions: QueueApplicationOptions | undefined,
): BuiltInAdapterType | QueueAdapterConstructor {
  if (queueOptions?.adapter !== undefined) {
    return queueOptions.adapter as BuiltInAdapterType | QueueAdapterConstructor;
  }

  return queueOptions?.redis !== undefined ? 'redis' : 'memory';
}
