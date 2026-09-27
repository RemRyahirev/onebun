import { Effect, pipe } from 'effect';

import { applyAuth, isSigningAuth } from './auth.js';
import { signOneBunRequest } from './onebun-auth.js';
import {
  currentOutgoingTraceContext,
  formatTraceparent,
  type OutgoingTraceContext,
} from './trace-context.js';
import {
  type ApiResponse,
  createErrorResponse,
  createSuccessResponse,
  DEFAULT_REQUESTS_OPTIONS,
  DEFAULT_TIMEOUT_MS,
  type ErrorResponse,
  getTransportFailureKind,
  HttpMethod,
  HttpStatusCode,
  InternalServerError,
  isErrorResponse,
  isRetryableMethod,
  OneBunBaseError,
  type ReqConfig,
  type RequestConfig,
  type RequestMetricsData,
  type RequestsOptions,
  resolveRetryConfig,
  type RetryConfig,
  type SuccessResponse,
  TRANSPORT_FAILURE_CODE,
  type TransportFailureKind,
  wrapToErrorResponse,
} from './types.js';

/** Methods whose body is sent, and therefore signed. */
const BODY_CARRYING_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH'];

/** The statuses the client follows: the five that name a `Location` to repeat the request at. */
const REDIRECT_STATUSES: readonly number[] = [
  HttpStatusCode.MOVED_PERMANENTLY,
  HttpStatusCode.FOUND,
  HttpStatusCode.SEE_OTHER,
  HttpStatusCode.TEMPORARY_REDIRECT,
  HttpStatusCode.PERMANENT_REDIRECT,
];

/**
 * How many redirects one attempt follows. The response that would be the 21st fails with
 * `REDIRECT_ERROR` — the Fetch Standard's limit. Bun's own `fetch` allowed 127 (measured on
 * 1.4.2), and a loop was a network error that `retryOnNetworkError` replayed: 508 requests.
 */
const MAX_REDIRECTS = 20;

/**
 * The only headers a redirect to ANOTHER origin carries, lower-cased. `content-type` joins them
 * while the hop still sends a body (307/308).
 *
 * A safelist rather than a list of what to strip, because what to strip cannot be known: `fetch`
 * drops only `Authorization`, `Cookie` and `Proxy-Authorization` on a cross-origin hop, while an
 * `apikey` header can have any name, `custom` auth adds any headers its config or interceptor
 * likes, and a credential passed through `RequestsOptions.headers` or `config.headers` is
 * indistinguishable from any other header. Measured on 0.8.1, all of those — and
 * `X-OneBun-Signature` — reached the other origin.
 *
 * What stays is what the new origin needs to answer and to join the trace.
 */
const CROSS_ORIGIN_HEADER_SAFELIST: readonly string[] = [
  'user-agent',
  'accept',
  'accept-encoding',
  'traceparent',
  'x-trace-id',
  'x-span-id',
];

/** Headers that describe a request body, lower-cased: they go when a redirect drops the body. */
const REQUEST_BODY_HEADERS: readonly string[] = [
  'content-type',
  'content-encoding',
  'content-language',
  'content-location',
];

/**
 * Fields that mark the second argument of `get`/`delete`/`head`/`options` as a config rather than
 * query data.
 *
 * The overload is ambiguous by construction — both arms take a plain object — so this list is the
 * whole of the decision. It used to name four fields, which left `tracing` on the wrong side:
 * `client.get(url, { tracing: false })` was read as query data and went out as `?tracing=false`,
 * with the header it was meant to suppress still attached. `get` was then given this list while
 * `delete`, `head` and `options` kept their own inline copy of the old four, so the same call on
 * those three still sent `?tracing=false`. {@link resolveQueryOverload} is now the only reader.
 *
 * `retries` and `query` are deliberately NOT here. `query` is documented as producing a literal
 * `?query=[object Object]` — the page warns against wrapping the query in a key and a test pins
 * it — and a `?retries=3` is a plausible query param in a way that `?tracing=` is not. Both still
 * need the three-argument form, as does any caller whose query really contains one of these names.
 *
 * Adding a name moves every query record that uses it to the config side, so a new config key
 * does not join by default. `client.get('/login', { redirect: '/home' })` is query data, and a
 * test pins it.
 */
const REQUEST_CONFIG_MARKERS: readonly string[] = [
  'method',
  'headers',
  'timeout',
  'auth',
  'tracing',
  'metrics',
];

/**
 * Resolve the `(url, queryOrConfig?, config?)` shape shared by `get`, `delete`, `head` and
 * `options` into one request config.
 *
 * - A third argument makes the second one query data, whatever it holds — `undefined` included.
 *   Each method used to take the three-argument arm only when the SECOND argument was truthy, so
 *   `get(url, undefined, { headers })` fell through to a bare request and the config was dropped.
 * - With two arguments, a plain object carrying any of {@link REQUEST_CONFIG_MARKERS} is config
 *   and any other plain object is query data.
 *
 * Shared by `HttpClient` and the `RequestsService` layer, so the rule cannot drift between them
 * or between the four methods again.
 *
 * @internal
 */
export const resolveQueryOverload = (
  method: HttpMethod,
  url: string,
  queryOrConfig: object | undefined,
  config: Partial<RequestConfig> | undefined,
): RequestConfig => {
  if (config !== undefined) {
    return {
      method,
      url,
      ...(queryOrConfig === undefined || queryOrConfig === null
        ? {}
        : { query: queryOrConfig as Record<string, unknown> }),
      ...config,
    };
  }

  if (typeof queryOrConfig !== 'object' || queryOrConfig === null || Array.isArray(queryOrConfig)) {
    return { method, url };
  }

  if (REQUEST_CONFIG_MARKERS.some((field) => field in queryOrConfig)) {
    return { method, url, ...(queryOrConfig as Partial<RequestConfig>) };
  }

  return { method, url, query: queryOrConfig as Record<string, unknown> };
};

/**
 * Whether a response carries no content by definition (RFC 9110 §6.4.1): every answer to HEAD,
 * and every 204 No Content and 304 Not Modified.
 *
 * Their body is not read. It used to be, and the content type decided how: a HEAD to any JSON
 * endpoint (`Response.json` sets the header on HEAD too) and a 204 or 304 that kept its
 * `content-type: application/json` all went to the JSON parser, which rejected the empty text with
 * `RESPONSE_PARSE_ERROR` — so `client.head()` failed against every JSON endpoint there is.
 *
 * Case-insensitive on the method, as `fetch` is: `req('head', url)` reaches the wire as HEAD.
 */
const hasNoContent = (method: string, status: number): boolean =>
  method.toUpperCase() === HttpMethod.HEAD ||
  status === HttpStatusCode.NO_CONTENT ||
  status === HttpStatusCode.NOT_MODIFIED;

/**
 * Whether an upstream status resolves as a success.
 *
 * 304 Not Modified is one. A server sends it only in answer to a conditional request
 * (`If-None-Match`, `If-Modified-Since`), so it is the outcome the caller asked about — "your copy
 * is current" — not a failure to recover from. It used to fall outside the range and reject.
 */
const isSuccessStatus = (status: number): boolean =>
  (status >= HttpStatusCode.OK && status < HttpStatusCode.MOVED_PERMANENTLY) ||
  status === HttpStatusCode.NOT_MODIFIED;

/**
 * A success's headers as a record: names lower-cased, as `Headers` iterates them, and a header
 * sent more than once joined with `, `, as `Headers.get()` joins it.
 *
 * `set-cookie` is joined as well. `Headers.forEach` hands every `set-cookie` over on its own, so
 * assigning them one after another, as {@link collectErrorHeaders} does, keeps only the last
 * cookie. `Object.fromEntries` also keeps a header named `__proto__` as an own property, where an
 * assignment goes to the prototype setter and is lost.
 */
const collectResponseHeaders = (headers: Headers): Record<string, string> =>
  Object.fromEntries([...new Set(headers.keys())].map((name) => [name, headers.get(name) ?? '']));

/**
 * An error answer's headers, for `details.headers`: collected by assignment, so a `set-cookie`
 * sent more than once keeps only its last value there and a header named `__proto__` is lost.
 *
 * Deliberately not {@link collectResponseHeaders}. `details.headers` is enumerable, and the error
 * `req()` throws carries it: a controller that does not catch that error lets the default exception
 * filter serialize it into the body it sends its own caller, the upstream's headers and the request
 * URL included. Joining every `set-cookie` here would forward all of the upstream's cookies on that
 * path instead of one. The exposure belongs to the thrown path and is to be closed there, not
 * widened here first.
 */
const collectErrorHeaders = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });

  return record;
};

/**
 * `response` with the upstream's headers attached as its `headers` property — NOT enumerable.
 *
 * Core serializes whatever a handler returns, on both dispatch arms: the full arm sends an object
 * with a `success` key as it is, the fast arm wraps it into `result`. A controller that returned a
 * client envelope unchanged would therefore send the upstream's `set-cookie`, `server` and every
 * other header to its own caller, in the body. `JSON.stringify` skips a non-enumerable property,
 * so this one place covers both arms, a nested envelope and any other JSON payload, where
 * stripping the headers in core would need every serializer there to know about them.
 */
const withUpstreamHeaders = <S extends SuccessResponse<unknown>>(
  response: S,
  headers: Record<string, string>,
): S => Object.defineProperty(response, 'headers', {
  value: headers,
  enumerable: false,
  writable: true,
  configurable: true,
});

/**
 * `response` with `retryCount` set. Not a bare spread for a success: a spread copies only the
 * enumerable properties, so it would drop the `headers` {@link withUpstreamHeaders} attached.
 */
const withRetryCount = <T, E extends string, R extends string>(
  response: ApiResponse<T, E, R>,
  retryCount: number,
): ApiResponse<T, E, R> => {
  if (!response.success) {
    return { ...response, retryCount };
  }

  const counted: SuccessResponse<T> = { ...response, retryCount };

  return response.headers === undefined ? counted : withUpstreamHeaders(counted, response.headers);
};

/**
 * Build full URL from base URL and request URL
 */
const buildUrl = (
  baseUrl: string | undefined,
  url: string,
  query?: Record<string, unknown>,
): string => {
  let fullUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}` : url;

  if (query && Object.keys(query).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    if (queryString) {
      fullUrl += `${fullUrl.includes('?') ? '&' : '?'}${queryString}`;
    }
  }

  return fullUrl;
};

/**
 * Calculate retry delay based on configuration
 */
export const calculateRetryDelay = (attempt: number, config: RetryConfig): number => {
  const { delay, backoff, factor = 2 } = config;

  switch (backoff) {
    case 'linear':
      return delay * attempt;
    case 'exponential':
      return delay * factor ** (attempt - 1);
    case 'fixed':
    default:
      return delay;
  }
};

/**
 * Merge client options onto the defaults, re-basing the retry config field-wise so that a
 * partial `retries` never silently drops the fields it did not mention.
 */
const mergeRequestsOptions = (options: RequestsOptions): RequestsOptions => ({
  ...DEFAULT_REQUESTS_OPTIONS,
  ...options,
  retries: resolveRetryConfig(options.retries),
});

/** The `error` name each transport failure kind is reported under. */
const TRANSPORT_FAILURE_ERRORS: Record<TransportFailureKind, string> = {
  timeout: 'TIMEOUT_ERROR',
  abort: 'ABORT_ERROR',
  network: 'FETCH_ERROR',
};

/**
 * Which transport failure an error is: `AbortSignal.timeout` rejects with a `TimeoutError`, an
 * explicit abort with an `AbortError`, and everything else (connection refused, DNS, TLS, a reset
 * connection) is a network failure.
 */
const transportFailureKindOf = (error: unknown): TransportFailureKind => {
  const name = error instanceof Error ? error.name : '';

  if (name === 'TimeoutError') {
    return 'timeout';
  }

  return name === 'AbortError' ? 'abort' : 'network';
};

/**
 * Classify a failure that happened before the response was complete.
 *
 * None of them are a server 500, so none of them carry an HTTP status code: `code` is
 * {@link TRANSPORT_FAILURE_CODE} and `getTransportFailureKind` reads the kind back.
 *
 * Once the attempt's signal has fired, its reason decides between a timeout and an abort, not
 * whatever `fetch` or the body reader rejected with — the signal is the one that knows which of
 * the two it was.
 *
 * `receivedStatus` is set when the failure hit while the body was being read: the status line had
 * arrived and is kept in `details.statusCode`, with `details.phase: 'body'`. It used to be the
 * `code` of a `RESPONSE_READ_ERROR`/`RESPONSE_PARSE_ERROR` instead, so a 500 whose body stalled
 * was retried by `retryOn` as a server 500 and `retryOnTimeout: false` never saw it.
 */
const classifyTransportFailure = (
  error: unknown,
  signal: AbortSignal,
  traceId?: string,
  receivedStatus?: number,
): ErrorResponse => {
  const kind = transportFailureKindOf(signal.aborted ? signal.reason : error);

  return createErrorResponse(
    TRANSPORT_FAILURE_ERRORS[kind],
    TRANSPORT_FAILURE_CODE,
    traceId,
    {
      details: error,
      transport: kind,
      ...(receivedStatus === undefined ? {} : { statusCode: receivedStatus, phase: 'body' }),
    },
  );
};

/** The `error` name of a redirect the client could not follow. */
const REDIRECT_ERROR = 'REDIRECT_ERROR';

/** One request of a redirect chain: what is sent, and where. */
interface RedirectHop {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** `new URL(input, base)`, or `undefined` where the constructor throws. */
const parseUrl = (input: string, base?: string): URL | undefined => {
  try {
    return new URL(input, base);
  } catch {
    return undefined;
  }
};

/** The headers whose lower-cased name passes `keep`. */
const filterHeaders = (
  headers: Record<string, string>,
  keep: (lowerCaseName: string) => boolean,
): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => keep(name.toLowerCase())));

/**
 * Whether a redirect turns the request into a body-less GET — the rewrite `fetch` applies
 * (Fetch Standard, HTTP-redirect fetch, step 12): a POST answered 301 or 302, and anything but
 * GET or HEAD answered 303. 307 and 308 exist precisely to keep the method and the body.
 */
const redirectBecomesGet = (status: number, method: string): boolean => {
  const normalized = method.toUpperCase();

  if (status === HttpStatusCode.MOVED_PERMANENTLY || status === HttpStatusCode.FOUND) {
    return normalized === HttpMethod.POST;
  }

  return status === HttpStatusCode.SEE_OTHER &&
    normalized !== HttpMethod.GET &&
    normalized !== HttpMethod.HEAD;
};

/**
 * The request a redirect asks for, or a `REDIRECT_ERROR` when it cannot be followed: no
 * `Location`, a `Location` that is not an http(s) URL, or {@link MAX_REDIRECTS} already followed.
 * `code` is the 3xx that could not be followed.
 *
 * The `Location` is resolved against the URL that answered. A hop to the SAME origin (scheme, host
 * and port) keeps every header; one to another origin keeps only
 * {@link CROSS_ORIGIN_HEADER_SAFELIST}, plus `content-type` while the body goes along. What a hop
 * dropped stays dropped, so a chain that comes back to the first origin does not bring the
 * credentials back with it.
 *
 * An `X-OneBun-Signature` travels on a same-origin hop unchanged, and is not re-signed: it covers
 * the original method, URL and body, so the callee rejects it for any other path — the redirect
 * fails closed, as it did when `fetch` followed it.
 */
const nextRedirectHop = (
  hop: RedirectHop,
  response: Response,
  redirects: number,
  traceId?: string,
): Effect.Effect<RedirectHop, ErrorResponse> => {
  const location = response.headers.get('location');
  const refuse = (reason: 'missing-location' | 'invalid-location' | 'too-many-redirects') =>
    Effect.fail(createErrorResponse(REDIRECT_ERROR, response.status, traceId, {
      reason,
      status: response.status,
      url: hop.url,
      redirects,
      ...(location === null ? {} : { location }),
    }));

  if (location === null) {
    return refuse('missing-location');
  }

  const target = parseUrl(location, hop.url);

  if (target === undefined || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    return refuse('invalid-location');
  }

  if (redirects >= MAX_REDIRECTS) {
    return refuse('too-many-redirects');
  }

  const becomesGet = redirectBecomesGet(response.status, hop.method);
  const body = becomesGet ? undefined : hop.body;
  const withBodyHeaders = becomesGet
    ? filterHeaders(hop.headers, (name) => !REQUEST_BODY_HEADERS.includes(name))
    : hop.headers;
  const sameOrigin = target.origin === parseUrl(hop.url)?.origin;
  const headers = sameOrigin
    ? withBodyHeaders
    : filterHeaders(withBodyHeaders, (name) =>
      CROSS_ORIGIN_HEADER_SAFELIST.includes(name) || (body !== undefined && name === 'content-type'));

  return Effect.succeed({
    url: target.href,
    method: becomesGet ? HttpMethod.GET : hop.method,
    headers,
    body,
  });
};

/**
 * Send a request, following redirects in the client rather than in `fetch`.
 *
 * `fetch` follows a 3xx itself unless told otherwise, and on a hop to another origin it strips only
 * `Authorization`, `Cookie` and `Proxy-Authorization`. Everything else went along: an `apikey`
 * header, `custom` auth headers, `X-OneBun-Signature`, and any credential passed through
 * `RequestsOptions.headers` or `config.headers` — a POST answered 307 re-sent its body to the other
 * origin together with the key. So each hop is fetched with `redirect: 'manual'`, and
 * {@link nextRedirectHop} decides what the next one carries.
 *
 * Every hop runs under the attempt's one `signal`, so the client-side timeout bounds the whole
 * chain rather than each hop, and an interruption aborts whichever hop is in flight. The body of a
 * 3xx that is followed is discarded unread.
 */
const fetchFollowingRedirects = (
  hop: RedirectHop,
  signal: AbortSignal,
  traceId?: string,
  redirects: number = 0,
): Effect.Effect<Response, ErrorResponse> => pipe(
  Effect.tryPromise({
    try: () => fetch(hop.url, {
      method: hop.method,
      headers: hop.headers,
      signal,
      redirect: 'manual',
      ...(hop.body === undefined ? {} : { body: hop.body }),
    }),
    catch: (error) => classifyTransportFailure(error, signal, traceId),
  }),
  Effect.flatMap((response) => {
    if (!REDIRECT_STATUSES.includes(response.status)) {
      return Effect.succeed(response);
    }

    return pipe(
      Effect.sync(() => {
        response.body?.cancel().catch(() => undefined);
      }),
      Effect.flatMap(() => nextRedirectHop(hop, response, redirects, traceId)),
      Effect.flatMap((next) => fetchFollowingRedirects(next, signal, traceId, redirects + 1)),
    );
  }),
);

/**
 * Decide whether a failed attempt may be retried.
 *
 * The method gate comes first: a method outside the allowlist is never retried, whatever the
 * status code. Transport failures are then decided by their own flags, so `retryOn` only ever
 * matches statuses a server actually returned.
 *
 * A `REDIRECT_ERROR` is never retried, whatever `retryOn` lists: its `code` is the 3xx that could
 * not be followed, and asking the same server again gets the same redirect.
 */
const shouldRetryRequest = (
  error: unknown,
  method: string,
  retryConfig: RetryConfig,
): boolean => {
  if (!isErrorResponse(error) || !isRetryableMethod(method, retryConfig)) {
    return false;
  }

  if (error.error === REDIRECT_ERROR) {
    return false;
  }

  const transport = getTransportFailureKind(error);

  if (transport === 'timeout') {
    return retryConfig.retryOnTimeout === true;
  }

  if (transport === 'network') {
    return retryConfig.retryOnNetworkError !== false;
  }

  if (transport === 'abort') {
    return false;
  }

  return Array.isArray(retryConfig.retryOn) && retryConfig.retryOn.includes(error.code);
};

/**
 * Emit a framework-level record of a retry, independent of the user-supplied `onRetry`.
 *
 * Prefers the ambient logger the framework installs (same pattern as the metrics service);
 * falls back to Effect's logger so that a retry is never completely silent.
 */
const logRetryAttempt = (
  method: string,
  url: string,
  attempt: number,
  delay: number,
  error: ErrorResponse,
  retryConfig: RetryConfig,
): Effect.Effect<void, never> => {
  const transport = getTransportFailureKind(error);
  const context: Record<string, unknown> = {
    method,
    url,
    attempt,
    maxAttempts: retryConfig.max,
    delay,
    code: error.code,
    error: error.error,
    ...(transport ? { transport } : {}),
  };
  const reason = transport ? `${error.error} (${transport})` : `${error.error} ${error.code}`;
  const message =
    `HTTP retry ${attempt}/${retryConfig.max}: ${method} ${url} failed with ${reason}, ` +
    `retrying in ${delay}ms`;

  interface OneBunRetryLogger {
    warn(message: string, ...args: unknown[]): void;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  const g = globalThis as unknown as { __onebunLoggerService?: OneBunRetryLogger };
  const logger = g.__onebunLoggerService;

  if (logger && typeof logger.warn === 'function') {
    return Effect.sync(() => {
      try {
        logger.warn(message, context);
      } catch {
        // Logging must never break the request
      }
    });
  }

  return pipe(Effect.logWarning(message), Effect.annotateLogs(context));
};

/**
 * Record request metrics
 */
const recordRequestMetrics = (
  data: RequestMetricsData,
  sink: ((data: RequestMetricsData) => void) | undefined,
): Effect.Effect<void, never> => {
  return Effect.sync(() => {
    if (!sink) {
      return;
    }

    try {
      sink(data);
    } catch (error) {
      // A metrics sink must never fail a request.
      // eslint-disable-next-line no-console
      console.debug('Failed to record request metrics:', error);
    }
  });
};

/**
 * The trace this call belongs to, or `undefined` when it belongs to none.
 *
 * Read through the registered provider (`setTraceContextProvider`), which `OneBunApplication`
 * points at its per-request `AsyncLocalStorage`. It used to read
 * `globalThis.__onebunCurrentTraceContext` — a global nothing in the framework ever assigned, so
 * the answer was permanently `undefined` and every outgoing call left untraced without a word.
 * One global cell would have been wrong anyway: concurrent requests share it, so a call would be
 * attributed to whichever request wrote to it last.
 */
const getTraceContext = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
): OutgoingTraceContext | undefined => {
  if (config.tracing === false || !mergedOptions.tracing) {
    return undefined;
  }

  return currentOutgoingTraceContext();
};

/**
 * The exact bytes this request will send, or `undefined` when it sends none.
 *
 * Extracted so the signer and `fetch` cannot disagree: a signature over a re-serialization of the
 * same object is a signature over bytes nobody sent.
 */
const serializeBody = (config: RequestConfig): string | undefined => {
  if (!config.data || !BODY_CARRYING_METHODS.includes(config.method)) {
    return undefined;
  }

  return typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
};

/**
 * Apply authentication if configured
 */
const applyAuthIfNeeded = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  traceId?: string,
): Effect.Effect<RequestConfig, ErrorResponse> => {
  if (config.auth || mergedOptions.auth) {
    const authConfig = config.auth || mergedOptions.auth!;

    return pipe(
      applyAuth(authConfig, config),
      Effect.catchAll((error) =>
        Effect.fail(
          createErrorResponse(
            'AUTH_ERROR',
            HttpStatusCode.UNAUTHORIZED,
            traceId,
            { details: error },
          ),
        ),
      ),
    );
  }

  return Effect.succeed(config);
};

/**
 * Build request headers
 */
const buildHeaders = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  traceContext?: OutgoingTraceContext,
): Record<string, string> => {
  const headers: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'User-Agent': mergedOptions.userAgent || 'OneBun-Requests/1.0',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Accept: 'application/json',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Content-Type': 'application/json',
    ...mergedOptions.headers,
    ...config.headers,
  };

  if (traceContext && config.tracing !== false && mergedOptions.tracing) {
    // W3C `traceparent` first, because it is the only one a collector, a service mesh or a
    // non-OneBun peer understands.
     
    headers.traceparent = formatTraceparent(traceContext);
    // The pair, not `X-Trace-Id` alone. On its own it joined nothing — even the receiving OneBun
    // service requires trace and span id together, so a lone id fell through and the callee
    // started a fresh trace. Kept alongside `traceparent` for anything already reading them.
     
    headers['X-Trace-Id'] = traceContext.traceId;
     
    headers['X-Span-Id'] = traceContext.spanId;
  }

  return headers;
};

/**
 * Read the body of a response whose status line and headers have arrived.
 *
 * `fetch` resolves at the headers; the body streams in afterwards under the same signal, so the
 * client-side timeout — or an interruption of the attempt — can fire here too. Such a failure is a
 * transport failure like one before the headers, and is classified as one: `TIMEOUT_ERROR`, code
 * `0`, retried only under `retryOnTimeout`. It used to be reported as `readFailure` (a
 * `RESPONSE_READ_ERROR` or `RESPONSE_PARSE_ERROR`) with the status as its code — a stalled 200
 * looked like a malformed body, and a stalled 500 was replayed by `retryOn` as if the server had
 * answered 500 in full.
 *
 * Any other read failure keeps `readFailure` and the status.
 */
const readBodyText = (
  response: Response,
  signal: AbortSignal,
  readFailure: 'RESPONSE_READ_ERROR' | 'RESPONSE_PARSE_ERROR',
  traceId?: string,
): Effect.Effect<string, ErrorResponse> =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (error) =>
      signal.aborted || transportFailureKindOf(error) !== 'network'
        ? classifyTransportFailure(error, signal, traceId, response.status)
        : createErrorResponse(readFailure, response.status, traceId, { details: error }),
  });

/**
 * Parse response data based on content type
 */
const parseResponseData = <T>(
  response: Response,
  signal: AbortSignal,
  traceId?: string,
): Effect.Effect<T, ErrorResponse> => {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return pipe(
      readBodyText(response, signal, 'RESPONSE_PARSE_ERROR', traceId),
      Effect.flatMap((text) => {
        if (!text) {
          return Effect.fail(
            createErrorResponse(
              'RESPONSE_PARSE_ERROR',
              response.status,
              traceId,
              { details: 'Response text is empty' },
            ),
          );
        }

        let parsedData: T;
        try {
          parsedData = JSON.parse(text);
        } catch {
          return Effect.fail(
            createErrorResponse(
              'RESPONSE_PARSE_ERROR',
              response.status,
              traceId,
              { details: text },
            ),
          );
        }

        // Check if response is a standardized error format
        if (isErrorResponse(parsedData)) {
          // Create OneBunApiError to throw
          const apiError = OneBunBaseError.fromErrorResponse(parsedData);

          return Effect.fail(wrapToErrorResponse(apiError));
        }

        return Effect.succeed(parsedData);
      }),
    );
  } else {
    return readBodyText(response, signal, 'RESPONSE_READ_ERROR', traceId) as Effect.Effect<T, ErrorResponse>;
  }
};

/**
 * Add the `X-OneBun-Signature` header when `onebun` auth is configured, otherwise pass through.
 *
 * Returns the headers rather than mutating them, so a retry signs the request afresh instead of
 * inheriting the previous attempt's timestamp and nonce.
 */
const signOneBunIfNeeded = (
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  body: string | undefined,
  traceId?: string,
): Effect.Effect<Record<string, string>, ErrorResponse> => {
  const authConfig = config.auth ?? mergedOptions.auth;

  // Two statements rather than one disjunction: a type predicate negated inside `||` does not
  // narrow reliably, and the narrowing is what gives `authConfig.audience` a type here.
  if (authConfig === undefined) {
    return Effect.succeed(headers);
  }

  if (!isSigningAuth(authConfig)) {
    return Effect.succeed(headers);
  }

  const contentType = Object.entries(headers)
    .find(([name]) => name.toLowerCase() === 'content-type')?.[1];

  return pipe(
    signOneBunRequest(authConfig, {
      method: config.method,
      url: fullUrl,
      contentType,
      body,
      audience: authConfig.audience,
    }),
    Effect.map((signature) => ({
      ...headers,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'X-OneBun-Signature': signature,
    })),
    Effect.catchAll((error) =>
      Effect.fail(
        createErrorResponse('AUTH_ERROR', HttpStatusCode.UNAUTHORIZED, traceId, { details: error }),
      ),
    ),
  );
};

/**
 * Execute single HTTP request attempt.
 *
 * An attempt is the whole redirect chain ({@link fetchFollowingRedirects}): the response it
 * resolves with, and the status the metrics record, are the final hop's.
 *
 * One signal governs the whole attempt, every hop and the body included: `fetch` resolves at the
 * headers and the body is read afterwards under the same signal. It fires on the client-side
 * timeout, and on an interruption of the Effect running the attempt (`Effect.timeout`,
 * `Effect.race`, `Fiber.interrupt`). The interruption used to abandon the `fetch` without aborting
 * it: the connection stayed open, and the server went on holding it until the client's own timeout.
 *
 * The interruption is wired through `Effect.onInterrupt` around the whole attempt rather than
 * through the signal `Effect.tryPromise` hands to `fetch`: that signal is only live while the
 * `fetch` promise is pending, so an interruption during the body read would not reach it.
 *
 * Suspended, so the timeout starts when the attempt runs rather than when it is built.
 */
const executeSingleRequest = <T, E extends string, R extends string>(
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  traceId?: string,
): Effect.Effect<ApiResponse<T, E | string, R | string>, never> => Effect.suspend(() => {
  const requestStartTime = Date.now();
  const interruption = new AbortController();
  const signal = AbortSignal.any([
    AbortSignal.timeout(config.timeout || mergedOptions.timeout || DEFAULT_TIMEOUT_MS),
    interruption.signal,
  ]);

  // One serialization, used both for the body that is sent and for the body that is signed.
  // Serializing twice would let the two diverge, and a signature over different bytes than the
  // ones on the wire is worse than no signature — it reads as protection.
  const body = serializeBody(config);

  return pipe(
    // Signed HERE, inside the attempt, over the assembled request. Two reasons it cannot move
    // out: the signature has to cover the final URL and the exact body bytes, and each retry
    // needs its own timestamp and nonce — reusing one would make attempt 2 a replay of attempt 1
    // and the callee would reject it as such.
    signOneBunIfNeeded(config, mergedOptions, headers, fullUrl, body, traceId),
    Effect.flatMap((signedHeaders) => fetchFollowingRedirects(
      {
        url: fullUrl,
        method: config.method,
        headers: signedHeaders,
        body,
      },
      signal,
      traceId,
    )),
    Effect.flatMap((response) => {
      // `undefined` rather than `''` for a response that has no content: `head()` is typed
      // `ApiResponse<void>`, and an empty string would claim a body that was never there.
      const readBody: Effect.Effect<T, ErrorResponse> = hasNoContent(config.method, response.status)
        ? Effect.succeed(undefined as T)
        : parseResponseData<T>(response, signal, traceId);

      return pipe(
        readBody,
        Effect.map((responseData) => {
          const duration = Date.now() - requestStartTime;

          if (isSuccessStatus(response.status)) {
            return withUpstreamHeaders(
              createSuccessResponse(responseData, traceId, response.status),
              collectResponseHeaders(response.headers),
            );
          }

          return createErrorResponse(
            'HTTP_ERROR',
            response.status,
            traceId,
            {
              headers: collectErrorHeaders(response.headers),
              details: responseData,
              duration,
              url: fullUrl,
              method: config.method,
            },
          );
        }),
      );
    }),
    Effect.onInterrupt(() => Effect.sync(() => interruption.abort())),
    Effect.catchAll((error) => {
      return Effect.succeed(error);
    }),
  );
});

/**
 * Execute request with retry logic
 */
const executeWithRetry = <T, E extends string, R extends string>(
  config: RequestConfig,
  mergedOptions: RequestsOptions,
  headers: Record<string, string>,
  fullUrl: string,
  traceId?: string,
  attemptNumber: number = 1,
): Effect.Effect<SuccessResponse<T>, ErrorResponse<E | string, R | string>> => {
  const requestStartTime = Date.now();

  return pipe(
    executeSingleRequest<T, E, R>(config, mergedOptions, headers, fullUrl, traceId),
    Effect.map((result) => withRetryCount(result, attemptNumber - 1)),
    Effect.flatMap((result) => {
      const duration = Date.now() - requestStartTime;
      // Record metrics if enabled
      const recordMetrics =
        config.metrics !== false && mergedOptions.metrics
          ? recordRequestMetrics({
            method: config.method,
            url: fullUrl,
            // The status the upstream actually returned. It used to be `HttpStatusCode.OK` for
            // every success, so a 201, 202 or 204 was recorded as 200 — a dashboard could not
            // tell them apart and an alert on non-200 responses never fired. `?? OK` covers the
            // one path that has no upstream status: a success synthesized without a response.
            statusCode: result.success ? result.statusCode ?? HttpStatusCode.OK : result.code,
            duration,
            success: result.success,
            retryCount: result.retryCount || 0,
            baseUrl: mergedOptions.baseUrl,
          }, mergedOptions.metricsSink)
          : Effect.succeed(undefined);

      return pipe(
        recordMetrics,
        Effect.flatMap(() => {
          if (isErrorResponse(result)) {
            return Effect.fail(result);
          }

          return Effect.succeed(result);
        }),
      );
    }),
    Effect.catchAll((error) => {
      // Check if we should retry on this error
      const retryConfig: RetryConfig = resolveRetryConfig(mergedOptions.retries, config.retries);
      const shouldRetry = shouldRetryRequest(error, config.method, retryConfig);

      if (shouldRetry && attemptNumber <= retryConfig.max) {
        const callRetryCallback = retryConfig.onRetry
          ? Effect.tryPromise({
            try: () => Promise.resolve(retryConfig.onRetry!(error, attemptNumber)),
            catch: () =>
              createErrorResponse(
                'RETRY_CALLBACK_ERROR',
                HttpStatusCode.INTERNAL_SERVER_ERROR,
                traceId,
                { details: error },
              ),
          })
          : Effect.succeed(undefined);

        const delay = calculateRetryDelay(attemptNumber, retryConfig);

        return pipe(
          logRetryAttempt(config.method, fullUrl, attemptNumber, delay, error, retryConfig),
          Effect.flatMap(() => callRetryCallback),
          Effect.flatMap(() => Effect.sleep(`${delay} millis`)),
          Effect.flatMap(() =>
            executeWithRetry<T, E, R>(
              config,
              mergedOptions,
              headers,
              fullUrl,
              traceId,
              attemptNumber + 1,
            ),
          ),
        );
      }

      return Effect.fail(error);
    }),
  );
};

/**
 * The config with its method filled in: `GET` when the caller left it `undefined`.
 *
 * `RequestConfig.method` is required, but a spread puts an explicit `undefined` back over the
 * default: `client.request({ url, method: undefined })` overrides the `GET` that
 * `HttpClient.requestEffect` sets, and `client.get(url, { method: undefined })` does the same
 * through {@link resolveQueryOverload}. Both type-check while `exactOptionalPropertyTypes` is off.
 * `fetch` sends such a request as GET, but the client's own string operations on the method threw
 * a TypeError: HEAD detection on every answer, the retry allowlist on every failure. Thrown there,
 * it is a defect rather than a failure — it passed every `catchAll`, so the caller got no
 * `ErrorResponse` and no metrics were recorded, after the request had already gone out. With
 * `onebun` auth the signer threw on it first, so a signed request was never sent at all.
 *
 * Done here, once, because {@link executeRequest} is the one path every caller takes — `HttpClient`
 * and the `RequestsService` layer alike.
 */
const withDefaultMethod = (config: RequestConfig): RequestConfig =>
  config.method === undefined ? { ...config, method: HttpMethod.GET } : config;

/**
 * Execute HTTP request with full configuration
 */
export const executeRequest = <
  T = unknown,
  E extends string = string,
  R extends string = string,
>(
  requestConfig: RequestConfig,
  requestOptions: RequestsOptions = {},
): Effect.Effect<SuccessResponse<T>, ErrorResponse<E | string, R | string>> => {
  const config = withDefaultMethod(requestConfig);
  const mergedOptions = mergeRequestsOptions(requestOptions);
  // Resolved once, before the first attempt: a retry belongs to the same trace as the attempt it
  // replaces, and re-reading the ambient context per attempt would let a slow retry pick up
  // whatever scope the process happened to be in by then.
  const traceContext = getTraceContext(config, mergedOptions);
  const traceId = traceContext?.traceId;

  return pipe(
    applyAuthIfNeeded(config, mergedOptions, traceId),
    Effect.map((finalConfig) => {
      // The URL is built AFTER auth, from the config auth produced. It used to be built one line
      // before, so `apikey` with `location: 'query'` added its key to a `config.query` the URL had
      // already been assembled from — the key never reached the wire and nothing said so.
      const fullUrl = buildUrl(mergedOptions.baseUrl, finalConfig.url, finalConfig.query);
      const headers = buildHeaders(finalConfig, mergedOptions, traceContext);

      return { finalConfig, headers, fullUrl };
    }),
    Effect.flatMap(({ finalConfig, headers, fullUrl }) =>
      executeWithRetry<T, E, R>(finalConfig, mergedOptions, headers, fullUrl, traceId),
    ),
  );
};

/**
 * HTTP Client class for making requests with configuration
 *
 * @see docs:api/requests.md
 */
export class HttpClient {
  constructor(private clientOptions: RequestsOptions = {}) {}

  /**
   * Execute a request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestEffect<T = any>(
    config: Partial<RequestConfig>,
  ): Effect.Effect<SuccessResponse<T>, ErrorResponse> {
    const mergedOptions = mergeRequestsOptions(this.clientOptions);
    const fullConfig: RequestConfig = {
      method: HttpMethod.GET,
      url: '',
      ...config,
    };

    return executeRequest<T>(fullConfig, mergedOptions);
  }

  /**
   * Execute a request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async request<T = any>(
    config: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.requestEffect<T>(config));
  }

  /**
   * GET request with Effect interface
   */
  getEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>(resolveQueryOverload(HttpMethod.GET, url, queryOrConfig, config));
  }

  /**
   * GET request with Promise interface (default)
   */
  async get<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.getEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * POST request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postEffect<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.POST,
      url,
      data,
      ...config,
    });
  }

  /**
   * POST request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async post<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.postEffect<T, D>(url, data, config));
  }

  /**
   * PUT request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  putEffect<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.PUT,
      url,
      data,
      ...config,
    });
  }

  /**
   * PUT request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async put<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.putEffect<T, D>(url, data, config));
  }

  /**
   * PATCH request with Effect interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patchEffect<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>({
      method: HttpMethod.PATCH,
      url,
      data,
      ...config,
    });
  }

  /**
   * PATCH request with Promise interface (default)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async patch<T = any, D = any>(
    url: string,
    data?: D,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.patchEffect<T, D>(url, data, config));
  }

  /**
   * DELETE request with Effect interface
   */
  deleteEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>(resolveQueryOverload(HttpMethod.DELETE, url, queryOrConfig, config));
  }

  /**
   * DELETE request with Promise interface (default)
   */
  async delete<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.deleteEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * HEAD request with Effect interface
   */
  headEffect<
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<void>, ErrorResponse> {
    return this.requestEffect<void>(resolveQueryOverload(HttpMethod.HEAD, url, queryOrConfig, config));
  }

  /**
   * HEAD request with Promise interface (default)
   */
  async head<
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<void>> {
    return await Effect.runPromise(this.headEffect<Q>(url, queryOrConfig, config));
  }

  /**
   * OPTIONS request with Effect interface
   */
  optionsEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<ApiResponse<T>, ErrorResponse> {
    return this.requestEffect<T>(resolveQueryOverload(HttpMethod.OPTIONS, url, queryOrConfig, config));
  }

  /**
   * OPTIONS request with Promise interface (default)
   */
  async options<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    url: string,
    queryOrConfig?: Q | Partial<RequestConfig>,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    return await Effect.runPromise(this.optionsEffect<T, Q>(url, queryOrConfig, config));
  }

  /**
   * Generic request method - throws on error, returns data directly
   */
  async req<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: ReqConfig & Partial<RequestConfig>,
  ): Promise<T> {
    try {
      const methodEnum = typeof method === 'string' ? (method as HttpMethod) : method;
      const response = await this.request<T>({
        method: methodEnum,
        url,
        ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE
          ? { query: queryOrData }
          : { data: queryOrData }),
        ...config,
      });

      if (isErrorResponse(response)) {
        // Check if we have custom error configuration
        if (config?.errors) {
          const errorKey = Object.keys(config.errors)[0]; // Use first error config as default
          const errorConfig = config.errors[errorKey];
          const customError = new InternalServerError(
            errorConfig.error,
            { ...errorConfig.details, originalResponse: response },
            response,
          );
          if (errorConfig.message) {
            customError.message = errorConfig.message;
          }
          throw customError;
        }

        throw OneBunBaseError.fromErrorResponse(response);
      }

      return response.result;
    } catch (error: unknown) {
      // If it's already an OneBun error, rethrow
      if (error instanceof OneBunBaseError) {
        throw error;
      }

      // Check if we have custom error configuration for unexpected errors
      if (config?.errors) {
        const errorKey = Object.keys(config.errors)[0];
        const errorConfig = config.errors[errorKey];
        throw new InternalServerError(errorConfig.error, {
          ...errorConfig.details,
          originalError: error,
        });
      }

      // Wrap unexpected errors
      throw new InternalServerError('REQUEST_FAILED', { originalError: error });
    }
  }

  /**
   * Generic request method - returns full API response
   */
  async reqRaw<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: Partial<RequestConfig>,
  ): Promise<ApiResponse<T>> {
    const methodEnum = typeof method === 'string' ? (method as HttpMethod) : method;

    return await this.request<T>({
      method: methodEnum,
      url,
      ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE
        ? { query: queryOrData }
        : { data: queryOrData }),
      ...config,
    });
  }

  /**
   * Generic request method - returns Effect
   */
  reqEffect<
    T = any, // eslint-disable-line @typescript-eslint/no-explicit-any
    Q extends Record<string, any> = Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  >(
    method: HttpMethod | string,
    url: string,
    queryOrData?: Q,
    config?: Partial<RequestConfig>,
  ): Effect.Effect<SuccessResponse<T>, ErrorResponse> {
    const methodEnum = typeof method === 'string' ? (method as HttpMethod) : method;

    return this.requestEffect<T>({
      method: methodEnum,
      url,
      ...(methodEnum === HttpMethod.GET || methodEnum === HttpMethod.DELETE
        ? { query: queryOrData }
        : { data: queryOrData }),
      ...config,
    });
  }
}

/**
 * Create a new HTTP client instance
 *
 * @see docs:api/requests.md
 */
export const createHttpClient = (clientOptions: RequestsOptions = {}): HttpClient => {
  return new HttpClient(clientOptions);
};
