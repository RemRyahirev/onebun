/**
 * OneBun pattern to Redis glob translation.
 *
 * Redis has no subject language: `SCAN … MATCH` takes a glob over key names, where `*` spans any
 * run of characters, separators included. OneBun patterns are token-based — `.` separates tokens,
 * `*` matches exactly one, `{name}` captures one, `#` matches the rest — so a glob can only ever
 * be a SUPERSET of what a pattern means.
 *
 * That is the whole design: the glob narrows the keyspace Redis has to walk, and the in-process
 * matcher built from the original pattern decides what actually matches. `events.*` translates to
 * the glob `events.*`, which Redis also matches against `events.a.b` — and the matcher is what
 * rejects it. Widening here is safe; narrowing would silently drop messages.
 *
 * The sibling helper for NATS is `toNatsSubject` in `@onebun/nats`. The two share the RULE — a `#`
 * is only valid as the final token — but not the translation: NATS emits its own wildcard tokens
 * (`*`, `>`), which mean nothing to Redis.
 */

/** A token carrying a named parameter — `{id}`, `v{id}`, `{a}-{b}`. */
const PARAMETER_TOKEN = /\{[^.}]*\}/;

/**
 * Translates a OneBun queue pattern into a Redis key glob.
 *
 * - a token containing a `{name}` parameter becomes `*`;
 * - a trailing `#` becomes `*`;
 * - `*` and literal tokens pass through unchanged;
 * - a `#` anywhere other than as the final token throws.
 *
 * The throw is not a Redis limitation — a glob like `*.created` would work perfectly well. It is
 * deliberate uniformity: the same pattern must mean the same thing on every adapter, and NATS
 * cannot express a non-trailing `#` at all. Allowing it here would give OneBun a per-adapter
 * pattern dialect, where `@Subscribe('#.created')` works on Redis and throws on NATS.
 *
 * @param pattern - A OneBun queue pattern, e.g. `orders.{id}` or `events.#`.
 * @returns The equivalent Redis glob, e.g. `orders.*` or `events.*`.
 * @throws If the pattern contains a `#` outside the final token.
 *
 * @see docs:api/queue.md
 */
export function toRedisQueueGlob(pattern: string): string {
  const tokens = pattern.split('.');
  const lastIndex = tokens.length - 1;

  return tokens
    .map((token, index) => {
      if (token === '#' && index === lastIndex) {
        return '*';
      }

      if (token.includes('#')) {
        throw new Error(nonFinalWildcardMessage(pattern));
      }

      return PARAMETER_TOKEN.test(token) ? '*' : token;
    })
    .join('.');
}

function nonFinalWildcardMessage(pattern: string): string {
  return `Invalid OneBun queue pattern "${pattern}": the multi-level wildcard "#" is only valid as the final token. `
    + 'OneBun uses one pattern language across every adapter, and NATS accepts its equivalent wildcard only at the '
    + 'end of a subject, so a non-final "#" is rejected here too rather than working on Redis alone. '
    + 'Use "*" to match a single token, or move "#" to the end.';
}
