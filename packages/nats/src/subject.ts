/**
 * OneBun pattern to NATS subject translation.
 *
 * OneBun queue patterns and NATS subjects share the `.` separator, the `*` single-token
 * wildcard and the trailing `>` multi-token wildcard, which OneBun also spells `#`.
 * OneBun's named parameters (`orders.{id}`) have no NATS equivalent at all.
 *
 * Translation never narrows, and it widens exactly when a parameter covers only part
 * of a token. A named parameter becomes `*`: for a whole-token `{id}` that is the same
 * set of subjects, but `v{id}` or `{a}-{b}` becomes a `*` that also matches `x`, so the
 * broker delivers a superset of what the subscription asked for. The in-process matcher
 * built from the original pattern narrows it back and extracts the parameter values,
 * which makes the matcher check load-bearing rather than redundant.
 */

/** A token carrying a named parameter — `{id}`, `v{id}`, `{a}-{b}`. */
const PARAMETER_TOKEN = /\{[^.}]*\}/;

/** A token that IS one named parameter and nothing else — `{id}`, never `v{id}`. */
const WHOLE_TOKEN_PARAMETER = /^\{[^.}]*\}$/;

/** Every named parameter in a token — what `toNatsSubject` replaces, and so never reaches the wire. */
const PARAMETER_GROUPS = /\{[^.}]*\}/g;

/**
 * The characters a NATS subject cannot carry: the protocol separates the fields of a `SUB`/`PUB` line
 * with a space or tab and ends it with CR LF. Exactly the set the nats.js client refuses as an
 * illegal subject (`whitespaceRegex` in nats-core) — not `\s`: a no-break space, an ideographic space,
 * a vertical tab or a form feed is a valid subject character, and such a subject is delivered.
 */
const SUBJECT_SEPARATOR = /[ \t\n\r]/;

/**
 * Translates a OneBun queue pattern into a NATS subject.
 *
 * - a token containing a `{name}` parameter becomes `*` (one token, widened);
 * - a trailing `#` becomes `>`;
 * - `*`, `>` and literal tokens pass through unchanged;
 * - a `#` anywhere other than as the final token throws.
 *
 * It validates nothing else: a publish may name any literal subject, `orders.v*` included. What a
 * subscription filter must satisfy beyond this is {@link validateNatsSubscriptionPattern}'s.
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

/**
 * Refuses a subscription pattern that can never receive a message on NATS, naming it.
 *
 * Exactly three shapes, each of which no NATS subject can match:
 * - a whole-token `>` before the last token (`orders.>.created`, `>.created`) — NATS accepts the
 *   multi-token wildcard only at the end. JetStream refuses such a consumer, and core NATS accepts
 *   the subscription and then delivers nothing to it, without a word;
 * - an empty token (`orders..created`, `orders.`, `.orders`) — refused and ignored the same way;
 * - a space, tab or line break outside the token's `{name}` parameters (`orders.new order`) — no
 *   subject carries one, and the NATS client refuses such a subject itself. Other whitespace
 *   (a no-break space, a vertical tab) is a valid subject character and passes. Inside a parameter
 *   it is part of the parameter's name and never reaches the wire: `orders.{a b}` filters `orders.*`.
 *
 * Everything else is left to the server as written. A `*` or `>` glued to other characters
 * (`orders.v*`, `orders.new>`) is a valid literal token there, so such a subscription receives
 * that one literal subject. `#` is left to {@link toNatsSubject}, which refuses it everywhere but
 * as the whole last token. Runs once per subscription; nothing on the receive path calls it.
 *
 * @param pattern - A OneBun queue pattern.
 * @throws If the pattern can never receive a message on NATS.
 *
 * @see docs:api/queue.md
 */
export function validateNatsSubscriptionPattern(pattern: string): void {
  const tokens = pattern.split('.');
  const lastIndex = tokens.length - 1;

  tokens.forEach((token, index) => {
    const problem = tokenProblem(token, index === lastIndex);

    if (problem !== undefined) {
      throw new Error(`Invalid subscription pattern "${pattern}" for NATS: ${problem}`);
    }
  });
}

function tokenProblem(token: string, last: boolean): string | undefined {
  if (token === '') {
    return 'it has an empty token — between two dots, or at either end — and no NATS subject has one, '
      + 'so the subscription could never receive a message.';
  }

  // Tested without the parameters, which `toNatsSubject` turns into `*`: a space inside one is
  // part of its name. The emptiness and `>` checks read the raw token — `{}` is not empty.
  if (SUBJECT_SEPARATOR.test(token.replace(PARAMETER_GROUPS, ''))) {
    return `the token ${JSON.stringify(token)} contains a space, tab or line break outside its {name} `
      + 'parameters, and no NATS subject carries one, so the subscription could never receive a message.';
  }

  if (token === '>' && !last) {
    return 'the wildcard ">" matches the rest of the subject, so NATS accepts it only as the last token: '
      + 'JetStream refuses such a filter and core NATS delivers nothing to it. Use "*" to match a single '
      + 'token here, or end the pattern with ">".';
  }

  return undefined;
}

/**
 * Whether `toNatsSubject(pattern)` names subjects the pattern itself does not match.
 *
 * True exactly when some token carries a parameter without being one: `jobs.v{version}`
 * translates to `jobs.*`, which also delivers `jobs.x`, while `jobs.{version}` translates
 * to the same one-token `*` the in-process matcher applies. Wildcards never widen — `*` is
 * shared verbatim, and a trailing `#` or `>` matches in process everything the server's `>` does.
 *
 * It matters wherever a delivered-but-unmatched message is not harmless. The consume loop
 * acknowledges such a message so it cannot wedge the consumer, and on a workqueue stream
 * that acknowledgement deletes it.
 *
 * @param pattern - A OneBun queue pattern.
 * @returns `true` when the translated subject is strictly wider than the pattern.
 *
 * @see docs:api/queue.md
 */
export function widensOnTranslation(pattern: string): boolean {
  return pattern
    .split('.')
    .some(token => PARAMETER_TOKEN.test(token) && !WHOLE_TOKEN_PARAMETER.test(token));
}

function nonFinalWildcardMessage(pattern: string): string {
  return `Invalid OneBun queue pattern "${pattern}": the multi-level wildcard "#" is only valid as the final token. `
    + 'It translates to the NATS ">" wildcard, which NATS accepts only at the end of a subject, so any other '
    + 'position produces a subject the broker rejects. Use "*" to match a single token, or move "#" to the end.';
}
