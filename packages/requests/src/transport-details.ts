/**
 * The transport details of an error the HTTP client produced, and how they are kept out of a body
 * the application sends its OWN caller.
 *
 * A client error's `details` holds two kinds of thing. Some of it describes the failure: its
 * `transport` kind, `duration`, `method`, a redirect's `reason`. The rest is what the upstream
 * answered with and where the request went: the upstream's response headers (`set-cookie`
 * included), the request URL with its query, a redirect's `Location`, and the upstream's body or
 * the raw error the transport failed with (Bun's connection error names the URL in `path`). None
 * of the second kind was written for this application's caller, and the default exception filter
 * serializes a `OneBunBaseError`'s `toErrorResponse()` into the body it sends that caller.
 */

/**
 * Which keys of a client error's `details` record hold transport details.
 *
 * A registry beside the record rather than a mark on it, so the record reads, compares, copies and
 * prints exactly as an unregistered one does: a property, even a non-enumerable symbol, shows in
 * `Bun.inspect`, `console.log` and a `toMatchSnapshot` snapshot. A `WeakMap` holds no record alive.
 *
 * On `globalThis` behind `Symbol.for`, so that two copies of this package in one process — the
 * application's and the one `@onebun/core` resolved — read each other's entries: the client that
 * makes the error and the filter that serializes it need not come from the same copy.
 */
const transportDetailKeys: WeakMap<object, readonly string[]> = (
  (globalThis as unknown as Record<symbol, WeakMap<object, readonly string[]> | undefined>)[
    Symbol.for('onebun:requests-transport-details')
  ] ??= new WeakMap()
);

/**
 * `details`, registered as holding transport details under `keys`. Returns the same object, unchanged.
 *
 * The registration follows the object, not a copy of it: `{ ...details }` is a record of the caller's
 * own, and serializes whole.
 */
export const markTransportDetails = <D extends Record<string, unknown>>(
  details: D,
  keys: readonly (keyof D & string)[],
): D => {
  transportDetailKeys.set(details, keys);

  return details;
};

/**
 * A `JSON.stringify` replacer that leaves the transport details of an HTTP-client error out:
 * `details.headers` (the upstream's response headers, `set-cookie` included), `details.url` (the
 * request URL and its query), `details.location` (a redirect's `Location`) and `details.details`
 * (the upstream's body, or the raw error the transport failed with). Everything else, including
 * every error the client did not produce, serializes exactly as it does without the replacer.
 *
 * It reaches a client error at any depth — the `originalError` that `client.req()` wraps, an error
 * that carries a client error's `details` as its own — because `JSON.stringify` hands the replacer
 * every value it serializes. The default exception filter uses it for a `OneBunBaseError` unless
 * `exposeErrorDetails` is set; a filter of your own that serializes such an error can do the same:
 *
 * ```typescript
 * JSON.stringify(error.toErrorResponse(), withoutTransportDetails);
 * ```
 *
 * @see docs:api/requests.md
 * @see docs:api/exception-filters.md
 */
export const withoutTransportDetails = (_key: string, value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const withheld = transportDetailKeys.get(value);

  if (withheld === undefined) {
    return value;
  }

  // `Object.fromEntries`, not an assignment loop: a key named `__proto__` stays an own property.
  return Object.fromEntries(Object.entries(value).filter(([key]) => !withheld.includes(key)));
};
