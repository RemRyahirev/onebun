/**
 * Consumer and stream configuration stamping.
 *
 * A reconciled JetStream resource carries a short hash of the configuration OneBun
 * asked for. On the next boot that hash decides whether the resource is already
 * correct (noop), needs rewriting (update), or is being fought over by two
 * processes writing different configurations (cycle).
 *
 * Package-internal: deliberately not re-exported from `src/index.ts`.
 */

import { createHash } from 'node:crypto';

/** Length of the hex digest prefix stored in metadata. */
const HASH_LENGTH = 32;

/**
 * Metadata keys OneBun writes onto JetStream streams and consumers.
 *
 * The `onebun.` namespace is deliberate: the server reserves an internal metadata
 * namespace of its own, so a framework-owned prefix is the only safe place to stamp.
 *
 * @see docs:api/queue.md
 */
export const CONFIG_STAMP_KEYS = {
  /** Hash of the configuration currently applied. */
  configHash: 'onebun.config-hash',
  /** Hash that was applied immediately before `configHash`. */
  prevConfigHash: 'onebun.prev-config-hash',
  /** ISO-8601 timestamp of the last write. */
  reconciledAt: 'onebun.reconciled-at',
} as const;

/**
 * How long a previous hash counts as "just applied" when detecting a reconcile
 * cycle. The only threshold in the stamping logic.
 *
 * @see docs:api/queue.md
 */
export const CONFIG_CYCLE_WINDOW_MS = 300_000;

/**
 * A JetStream `metadata` map. Values are strings on the wire.
 *
 * @see docs:api/queue.md
 */
export type StampMetadata = Record<string, string>;

/**
 * What to do with a resource whose stamp has been read.
 *
 * - `noop` — the applied hash already equals the desired one.
 * - `update` — write the desired hash; `prevHash` is the hash being replaced, or
 *   `undefined` when the resource carried no stamp at all.
 * - `cycle` — the desired hash was applied recently and has since been overwritten,
 *   so two writers are disagreeing.
 *
 * @see docs:api/queue.md
 */
export type StampDecision =
  | { action: 'noop' }
  | { action: 'update'; prevHash: string | undefined }
  | { action: 'cycle'; currentHash: string; desiredHash: string };

/** Value shapes that may appear in a hashed configuration subset. */
type HashableValue = string | number | boolean | readonly string[] | readonly number[] | undefined;

/**
 * Hashes the subset of configuration that participates in reconciliation.
 *
 * Object keys are sorted and every array value is sorted through a copy, so the hash
 * is stable across declaration order — reordering a stream's `subjects` in
 * application code must not read as a configuration change. Keys whose value is
 * `undefined` are dropped, so an explicitly-undefined key hashes identically to an
 * omitted one. The argument is never mutated.
 *
 * @param subset - Flat map of configuration values to hash.
 * @returns The first 32 hex characters of the sha256 digest.
 *
 * @see docs:api/queue.md
 */
export function hashReconcileConfig(subset: Readonly<Record<string, HashableValue>>): string {
  const normalized: Array<[string, unknown]> = Object.keys(subset)
    .sort()
    .filter(key => subset[key] !== undefined)
    .map((key): [string, unknown] => {
      const value = subset[key];

      return [key, Array.isArray(value) ? [...value].sort() : value];
    });

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Builds the metadata map to send with a create or an update.
 *
 * The client's update API merges with a shallow `Object.assign`, so the map sent
 * here REPLACES the server's map wholesale — every key not carried forward is
 * destroyed. `existing` is therefore copied in rather than ignored, and is never
 * mutated. When `prevHash` is `undefined` the previous-hash key is removed rather
 * than left stale.
 *
 * @param existing - Metadata read back from the server, if any.
 * @param hash - The hash being applied.
 * @param prevHash - The hash being replaced, if any.
 * @param now - Epoch milliseconds to stamp; defaults to the current time.
 *
 * @see docs:api/queue.md
 */
export function stampMetadata(
  existing: StampMetadata | undefined,
  hash: string,
  prevHash?: string,
  now: number = Date.now(),
): StampMetadata {
  const next: StampMetadata = { ...existing };

  next[CONFIG_STAMP_KEYS.configHash] = hash;
  next[CONFIG_STAMP_KEYS.reconciledAt] = new Date(now).toISOString();

  if (prevHash === undefined) {
    delete next[CONFIG_STAMP_KEYS.prevConfigHash];
  } else {
    next[CONFIG_STAMP_KEYS.prevConfigHash] = prevHash;
  }

  return next;
}

/**
 * Decides what to do with a resource given its stamp and the desired hash.
 *
 * Branch order is significant: an unstamped resource is always an update, an exact
 * match is a noop even when the cycle keys are also set, and only then is a cycle
 * considered. A missing or unparseable `reconciled-at` on the cycle branch counts as
 * a cycle rather than being ignored — an unreadable timestamp is not evidence that
 * the write was old.
 *
 * @param existing - Metadata read from the server, if any.
 * @param desiredHash - The hash OneBun wants applied.
 * @param now - Epoch milliseconds used for the cycle window; defaults to the current time.
 *
 * @see docs:api/queue.md
 */
export function decideStamp(
  existing: StampMetadata | undefined,
  desiredHash: string,
  now: number = Date.now(),
): StampDecision {
  const currentHash: string | undefined = existing?.[CONFIG_STAMP_KEYS.configHash];

  if (currentHash === undefined || currentHash === '') {
    return { action: 'update', prevHash: undefined };
  }

  if (currentHash === desiredHash) {
    return { action: 'noop' };
  }

  const prevHash: string | undefined = existing?.[CONFIG_STAMP_KEYS.prevConfigHash];
  if (prevHash === desiredHash && isWithinCycleWindow(existing?.[CONFIG_STAMP_KEYS.reconciledAt], now)) {
    return { action: 'cycle', currentHash, desiredHash };
  }

  return { action: 'update', prevHash: currentHash };
}

/**
 * Classifies a rejection as "the resource does not exist".
 *
 * The API code is a parameter so this module stays free of client imports and needs
 * no module mock to unit-test. The property is read by plain access rather than
 * `Object.hasOwn`: the client exposes `code` as a prototype getter over a private
 * field, so own-property checks, spreading and JSON round-trips all lose it.
 *
 * @param err - The rejection value.
 * @param code - The numeric API code that means "not found".
 *
 * @see docs:api/queue.md
 */
export function isNotFoundError(err: unknown, code: number): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const candidate = (err as { code?: unknown }).code;

  return typeof candidate === 'number' && candidate === code;
}

/** Whether a stamp timestamp falls inside the cycle window. Unreadable counts as inside. */
function isWithinCycleWindow(reconciledAt: string | undefined, now: number): boolean {
  if (reconciledAt === undefined) {
    return true;
  }

  const parsed = Date.parse(reconciledAt);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return now - parsed <= CONFIG_CYCLE_WINDOW_MS;
}
