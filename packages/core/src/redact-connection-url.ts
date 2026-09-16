/**
 * The stand-in for a password that must not be printed.
 */
const REDACTED = '***';

/**
 * Query parameters that carry a secret in the clear, whatever the URL's shape.
 */
const SECRET_QUERY_PARAMS = /([?&](?:password|pwd)=)[^&]*/gi;

/**
 * Index of the `@` that ends the userinfo, or `-1` when the URL carries none.
 *
 * The password may contain characters a well-formed URL would percent-encode — `@`, `/`, even
 * `?` — and those are precisely the passwords this module exists for, so the userinfo cannot be
 * located by scanning forward to the first delimiter. It is located by taking the LAST `@` that
 * can still belong to the authority: `?` and `#` open the query and the fragment, and nothing
 * beyond them is authority, so they bound the search. `/` deliberately does not — a raw slash in
 * a provider-generated password is the single most common way this goes wrong.
 */
function findUserinfoEnd(url: string, authorityStart: number): number {
  const queryStart = url.indexOf('?', authorityStart);
  const fragmentStart = url.indexOf('#', authorityStart);
  const bounds = [queryStart, fragmentStart].filter((index) => index !== -1);
  const limit = bounds.length > 0 ? Math.min(...bounds) : url.length;

  const withinAuthority = url.lastIndexOf('@', limit - 1);
  if (withinAuthority >= authorityStart) {
    return withinAuthority;
  }

  // A raw `?` or `#` inside the password pushed the real `@` past the bound. Fall back to the
  // last `@` anywhere in the string: over-redacting costs a legible host, under-redacting costs
  // the credential, and only one of those is recoverable.
  const anywhere = url.lastIndexOf('@');

  return anywhere >= authorityStart ? anywhere : -1;
}

/**
 * A connection URL as it can safely be printed: the password replaced, everything else intact.
 *
 * A framework's own startup error is a leak channel like any other. The error names its target so
 * an operator can tell WHICH database or cache refused, and a connection URL carries the password
 * inside that target — so the password must not survive into the message, the log line or the
 * exception, not even when the connection failed and the string is "only" a diagnostic.
 *
 * **It does not parse.** Two earlier versions of this did, and both failed OPEN on exactly the
 * passwords that need it most:
 *
 * - `new URL(...)` REJECTS a URL whose password contains a raw `/`, so the `catch` printed the
 *   string as given — credential included.
 * - A single regex classed the password as `[^@/]*`, so a `/` made it match nothing and emit the
 *   credential verbatim, while a raw `@` ended the match at the first one and leaked the rest.
 *
 * Cloud providers emit both characters routinely. Here the authority is found by position and the
 * userinfo is cut at its last `@`, so no character inside a password can end the match early.
 *
 * A string with no `://` is not a connection URL, has no host worth preserving and offers no way
 * to find its userinfo — it is replaced wholesale rather than echoed back.
 *
 * @param url - The connection URL to print
 * @returns The same URL with any password replaced by `***`
 *
 * @see docs:api/core.md
 *
 * @example
 * ```typescript
 * redactConnectionUrl('postgresql://app:hunter2@db:5432/orders?sslmode=require');
 * // 'postgresql://app:***@db:5432/orders?sslmode=require'
 * ```
 */
export function redactConnectionUrl(url: string): string {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd === -1) {
    return '<unparsable connection target>';
  }

  const authorityStart = schemeEnd + '://'.length;
  const userinfoEnd = findUserinfoEnd(url, authorityStart);
  let redacted = url;

  if (userinfoEnd !== -1) {
    const userinfo = url.slice(authorityStart, userinfoEnd);
    const passwordStart = userinfo.indexOf(':');

    // No colon in the userinfo means a username and no password — there is nothing to strip,
    // and inventing a `:***` would claim a credential the URL does not carry.
    if (passwordStart !== -1) {
      redacted = url.slice(0, authorityStart + passwordStart + 1) + REDACTED + url.slice(userinfoEnd);
    }
  }

  return redacted.replace(SECRET_QUERY_PARAMS, `$1${REDACTED}`);
}
