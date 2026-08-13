/**
 * OneBun pattern to NATS subject translation.
 *
 * OneBun queue patterns and NATS subjects share the `.` separator and the `*`
 * single-token wildcard, but nothing else: OneBun spells the multi-token wildcard
 * `#` where NATS spells it `>`, and OneBun's named parameters (`orders.{id}`) have
 * no NATS equivalent at all.
 *
 * Translation only ever widens. A named parameter becomes `*`, so the broker
 * delivers a superset of what the subscription asked for; the in-process matcher
 * built from the original pattern then narrows it back and extracts the parameter
 * values. That makes the matcher check load-bearing rather than redundant.
 */

/** A token carrying a named parameter — `{id}`, `v{id}`, `{a}-{b}`. */
const PARAMETER_TOKEN = /\{[^.}]*\}/;

/**
 * Translates a OneBun queue pattern into a NATS subject.
 *
 * - a token containing a `{name}` parameter becomes `*` (one token, widened);
 * - a trailing `#` becomes `>`;
 * - `*` and literal tokens pass through unchanged;
 * - a `#` anywhere other than as the final token throws.
 *
 * The throw is deliberate. NATS accepts `>` only as the last token of a subject,
 * so `#.created` could only translate to `>.created`, which the client does not
 * validate locally — the broker rejects it asynchronously, long after the call
 * that produced it, and `@onebun/nats` has no logger to attribute it with. A
 * synchronous error naming the offending pattern is the only truthful diagnostic.
 *
 * @param pattern - A OneBun queue pattern, e.g. `orders.{id}` or `events.#`.
 * @returns The equivalent NATS subject, e.g. `orders.*` or `events.>`.
 * @throws If the pattern contains a `#` outside the final token.
 *
 * @see docs:api/queue.md
 */
export function toNatsSubject(pattern: string): string {
  const tokens = pattern.split('.');
  const lastIndex = tokens.length - 1;

  return tokens
    .map((token, index) => {
      if (token === '#' && index === lastIndex) {
        return '>';
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
    + 'It translates to the NATS ">" wildcard, which NATS accepts only at the end of a subject, so any other '
    + 'position produces a subject the broker rejects. Use "*" to match a single token, or move "#" to the end.';
}
