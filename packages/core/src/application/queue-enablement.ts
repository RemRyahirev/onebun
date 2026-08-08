/**
 * Queue Enablement
 *
 * Resolves whether the queue system should be initialized for an application.
 * Shared by the single-service path (`OneBunApplication.initializeQueue`) and the
 * multi-service path (`MultiServiceOrchestrator.startAll`) so both can never reach
 * different answers from the same options object.
 */

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
