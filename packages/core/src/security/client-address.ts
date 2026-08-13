/**
 * The subset of the Bun server handle needed to resolve a request's transport peer.
 * Narrowed to one method so tests (and future transports) can supply a stand-in
 * without constructing a real server.
 */
export interface PeerAddressSource {
  requestIP(request: Request): { address: string } | null;
}

/**
 * Per-application client-address policy: where the transport peer comes from and
 * whether proxy headers on the request may override it.
 *
 * Created once per application by {@link createClientAddressBinding} and attached to
 * every incoming request by {@link bindClientAddress}.
 *
 * @see docs:api/security.md
 */
export interface ClientAddressBinding {
  readonly source: PeerAddressSource;
  readonly trustProxy: boolean;
}

/**
 * Proxy headers, in the order they are consulted when the application opts into
 * trusting them. `x-forwarded-for` is a comma-separated chain appended to by each
 * hop, so the leftmost entry is the originating client.
 */
const FORWARDED_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'] as const;

/**
 * Binds a request to the policy that resolves its client address.
 *
 * A WeakMap rather than a field on the request: `OneBunRequest` is Bun's `BunRequest`
 * and is not ours to extend, and the entry disappears with the request object.
 */
const bindings = new WeakMap<Request, ClientAddressBinding>();

/**
 * Create the per-application client-address policy.
 *
 * @param source - The Bun server handle (or any `requestIP` provider).
 * @param trustProxy - Whether `x-forwarded-for` / `cf-connecting-ip` / `x-real-ip`
 *   sent by the client may override the transport peer. Comes from
 *   `ApplicationOptions.trustProxy` and is `false` unless the application opts in.
 *
 * @see docs:api/security.md
 */
export function createClientAddressBinding(
  source: PeerAddressSource,
  trustProxy: boolean,
): ClientAddressBinding {
  return { source, trustProxy };
}

/**
 * Attach the application's client-address policy to one request.
 *
 * Called at the outermost request entry points — before middleware, guards or the
 * handler run — so that anything downstream can ask who called without needing the
 * server handle in scope.
 *
 * @see docs:api/security.md
 */
export function bindClientAddress(request: Request, binding: ClientAddressBinding): void {
  bindings.set(request, binding);
}

/**
 * The transport peer address of the request — the address the TCP connection came
 * from. Never derived from a header, so it cannot be spoofed by the caller.
 *
 * Returns `undefined` for a request that never came through a OneBun server (a
 * hand-constructed `Request` in a unit test, for example).
 *
 * @see docs:api/security.md
 */
export function getPeerAddress(request: Request): string | undefined {
  return bindings.get(request)?.source.requestIP(request)?.address ?? undefined;
}

/**
 * The address OneBun attributes the request to.
 *
 * Equal to {@link getPeerAddress} unless the application set
 * `ApplicationOptions.trustProxy: true`, in which case a proxy header on the request
 * takes precedence. Without that opt-in, proxy headers are ignored entirely — an
 * attacker cannot change the answer by setting one.
 *
 * This is the default rate-limit key and the `remoteAddr` reported on HTTP spans, so
 * the framework gives one answer to "who called".
 *
 * @example Rate limiting per API key, falling back to the client address
 * ```typescript
 * RateLimitMiddleware.configure({
 *   keyGenerator: (req) => req.headers.get('x-api-key') ?? getClientAddress(req) ?? 'unknown',
 * })
 * ```
 *
 * @see docs:api/security.md
 */
export function getClientAddress(request: Request): string | undefined {
  const binding = bindings.get(request);

  if (binding?.trustProxy === true) {
    for (const header of FORWARDED_HEADERS) {
      const value = request.headers.get(header);
      if (value !== null) {
        // Only `x-forwarded-for` is a chain; splitting the single-value headers is
        // harmless and keeps the branch out of the loop.
        const first = value.split(',')[0]?.trim();
        if (first !== undefined && first !== '') {
          return first;
        }
      }
    }
  }

  return binding?.source.requestIP(request)?.address ?? undefined;
}
