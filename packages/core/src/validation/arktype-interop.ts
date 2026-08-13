import { type } from 'arktype';

/**
 * Property key ArkType brands its own objects with (`noSuggest('arkKind')` — note the leading space).
 * `@ark/schema` itself discriminates on exactly this key (`hasArkKind`), so reading it is
 * copy-independent: it identifies an `ArkErrors` bag no matter which physical copy of `arktype`
 * produced it.
 */
const ARK_KIND_KEY = ' arkKind';

/**
 * Prefix `@ark/schema` uses for its `globalThis` registry.
 * The first copy loaded claims `$ark`; every further copy claims `$ark2`, `$ark3`, ... — see
 * `@ark/schema/out/shared/registry.js`. The presence of `$ark2` is therefore ArkType's own,
 * exact signal that more than one physical copy is loaded, even when both are the same version.
 */
const ARK_REGISTRY_PREFIX = '$ark';

/**
 * Read ArkType's brand off a value without depending on any particular copy's classes.
 *
 * @see docs:api/validation.md
 */
export function arkKindOf(value: unknown): string | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined;
  }

  const kind = (value as Record<string, unknown>)[ARK_KIND_KEY];

  return typeof kind === 'string' ? kind : undefined;
}

/**
 * Whether a value returned by `schema(data)` is an ArkType failure.
 *
 * `result instanceof type.errors` alone is a fail-open check: it compares against the class of
 * @onebun/core's own `arktype` copy, so an `ArkErrors` produced by a second physical copy is not an
 * instance and slips into the success branch. The brand check below is what makes this correct
 * across copies; the `instanceof` is kept purely as a fast path for the common single-copy install.
 *
 * @see docs:api/validation.md
 */
export function isArkErrors(value: unknown): boolean {
  if (value instanceof type.errors) {
    return true;
  }

  return arkKindOf(value) === 'errors';
}

/**
 * Whether a value carries ArkType's fingerprint but is not a recognisable `ArkErrors`.
 *
 * Such a value must never be handed back as validated data: it is an ArkType internal that leaked
 * into the data slot, which in practice means a duplicate `arktype` install whose failure objects
 * this version cannot identify. Two shapes are covered:
 *
 * - a single branded `ArkError` (from any copy) — `schema(data)` never yields one on success;
 * - an unbranded `ArkErrors` bag — an array carrying the `summary` / `byPath` / `count` trio.
 *
 * A branded `Type` root is deliberately NOT matched: validating a schema object against
 * `type('unknown')` legitimately returns one.
 *
 * @see docs:api/validation.md
 */
export function isUnrecognisedArkResult(value: unknown): boolean {
  if (arkKindOf(value) === 'error') {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  const candidate = value as unknown as { summary?: unknown; byPath?: unknown; count?: unknown };

  return (
    typeof candidate.summary === 'string' &&
    typeof candidate.count === 'number' &&
    typeof candidate.byPath === 'object' &&
    candidate.byPath !== null
  );
}

/**
 * Read the human-readable summary off an `ArkErrors` bag from any copy.
 *
 * @see docs:api/validation.md
 */
export function arkErrorsSummary(errors: unknown): string {
  const summary = (errors as { summary?: unknown }).summary;

  return typeof summary === 'string' ? summary : String(errors);
}

/**
 * Names of every `@ark/schema` registry currently installed on `globalThis`.
 * One entry means a healthy single-copy install; two or more means duplicates.
 *
 * @see docs:api/validation.md
 */
export function detectArkTypeRegistries(): string[] {
  const globals = globalThis as unknown as Record<string, unknown>;
  const names: string[] = [];

  if (ARK_REGISTRY_PREFIX in globals) {
    names.push(ARK_REGISTRY_PREFIX);
  }

  // `@ark/schema` allocates suffixes sequentially from 2, so the first gap ends the run.
  for (let suffix = 2; `${ARK_REGISTRY_PREFIX}${suffix}` in globals; suffix++) {
    names.push(`${ARK_REGISTRY_PREFIX}${suffix}`);
  }

  return names;
}

/**
 * Whether more than one physical copy of `arktype` is loaded in this process.
 *
 * @see docs:api/validation.md
 */
export function hasDuplicateArkTypeCopies(): boolean {
  return `${ARK_REGISTRY_PREFIX}2` in (globalThis as unknown as Record<string, unknown>);
}

/**
 * Operator-facing explanation of the duplicate-copy failure, shared by the startup diagnostic
 * and by {@link DuplicateArkTypeError}.
 *
 * @see docs:api/validation.md
 */
export function duplicateArkTypeMessage(registries: string[] = detectArkTypeRegistries()): string {
  const detected = registries.length > 0 ? registries.join(', ') : 'none';

  return (
    'Duplicate arktype installation detected. More than one physical copy of `arktype` is loaded, ' +
    'so schemas built by the application are validated against a different copy than @onebun/core ' +
    'uses, and their failures are not recognisable as ArkErrors. ' +
    'Deduplicate arktype to a single copy — add a root `resolutions` (bun/yarn) or `overrides` (npm) ' +
    'entry pinning one `arktype` version and reinstall. ' +
    `Detected ArkType registries: ${detected}.`
  );
}

/**
 * Thrown when validation produced a value that is neither valid data nor a recognisable `ArkErrors`.
 * Fails closed: the framework raises this instead of returning ArkType internals to the caller as
 * if they were the validated payload.
 *
 * @see docs:api/validation.md
 */
export class DuplicateArkTypeError extends Error {
  override name = 'DuplicateArkTypeError';

  constructor(public readonly registries: string[] = detectArkTypeRegistries()) {
    super(duplicateArkTypeMessage(registries));
  }
}

/**
 * Sink the startup diagnostic is written to. Swappable so tests can observe it.
 *
 * @see docs:api/validation.md
 */
export type ArkTypeDiagnosticSink = (message: string) => void;

const defaultDiagnosticSink: ArkTypeDiagnosticSink = (message) => {
  // No logger exists yet when schemas are evaluated at decoration time.
  // eslint-disable-next-line no-console
  console.warn(`[OneBun] ${message}`);
};

let duplicateDiagnosticEmitted = false;

/**
 * Emit exactly ONE diagnostic per process when a duplicate `arktype` copy is detected.
 * Called at decoration time (application startup) and on the unrecognised-result path.
 * Returns whether this call was the one that emitted.
 *
 * @see docs:api/validation.md
 */
export function reportDuplicateArkTypeCopies(
  sink: ArkTypeDiagnosticSink = defaultDiagnosticSink,
): boolean {
  if (duplicateDiagnosticEmitted) {
    return false;
  }

  const registries = detectArkTypeRegistries();

  if (registries.length < 2) {
    return false;
  }

  duplicateDiagnosticEmitted = true;
  sink(duplicateArkTypeMessage(registries));

  return true;
}

/**
 * Testing seam: clears the once-per-process latch so a test can observe the diagnostic.
 * Not re-exported from the package entry point.
 *
 * @see docs:api/validation.md
 */
export function resetDuplicateArkTypeDiagnostic(): void {
  duplicateDiagnosticEmitted = false;
}
