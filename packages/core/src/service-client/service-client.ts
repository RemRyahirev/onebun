import { Readable } from 'node:stream';

import type { ServiceClientOptions, ControllerClient } from './service-client.types';
import type {
  ControllerDefinition,
  EndpointMetadata,
  ServiceDefinition,
} from './service-definition';

import {
  type ApiResponse,
  HttpClient,
  type HttpMethod as RequestsHttpMethod,
} from '@onebun/requests';

import {
  HttpMethod,
  ParamType,
  type ParamMetadata,
} from '../types';

/**
 * A `:name` token in a route template, in the router's own grammar: the name runs from the colon
 * to the next `/`. Bun names `/:id.json` `id.json`, and the application erases parameter names
 * with the same pattern when it compares route shapes.
 *
 * Matching whole tokens is what keeps `:id` from matching inside `:idx`.
 */
const PATH_TOKEN = /:([^/]+)/g;

/**
 * Values that change the route however they are sent: an empty segment, "this directory" and "the
 * parent directory". `encodeURIComponent` leaves `.` as it is, and spelling a dot as `%2E` does not
 * help either, because a WHATWG URL parser reads `%2e` in any case as a dot when it resolves dot
 * segments.
 */
const ROUTE_CHANGING_SEGMENTS: ReadonlySet<string> = new Set(['', '.', '..']);

/**
 * The methods whose body the HTTP client sends: `POST`, `PUT` and `PATCH`, the same list it keeps
 * itself. With any other method it drops the body unsent.
 */
const BODY_CARRYING_METHODS: ReadonlySet<HttpMethod> = new Set([HttpMethod.POST, HttpMethod.PUT, HttpMethod.PATCH]);

/**
 * The text that replaces one `:name` token: the value percent-encoded with `encodeURIComponent`,
 * or a `TypeError` for a value that cannot be sent as that one segment.
 *
 * Encoding is what keeps the value inside its segment. `/`, `\`, `?`, `#` and `%` in it are sent as
 * `%2F`, `%5C`, `%3F`, `%23` and `%25`, so the router matches the declared route and decodes the
 * segment exactly once: the handler receives the value as it was passed. That includes text that
 * looks encoded already. `'%2e%2e'` is sent as `%252e%252e` and arrives as `'%2e%2e'`, never as
 * `..`, and a value the caller encoded first arrives still encoded.
 *
 * The refusals happen before any request is made:
 * - `null` and `undefined`, which would be sent as the text `null` / `undefined`;
 * - `''`, `.` and `..`, which no encoding can send (see {@link ROUTE_CHANGING_SEGMENTS}). The request
 *   would reach the sibling or the parent route, carrying this client's credentials there;
 * - a string with an unpaired UTF-16 surrogate, which has no UTF-8 encoding. Sent as is, the URL
 *   parser would replace it with U+FFFD, so the handler would receive a different value.
 */
function pathSegmentFor(endpoint: EndpointMetadata, name: string, value: unknown): string {
  const route = `${endpoint.httpMethod} ${endpoint.path}`;
  const refuse = (problem: string): TypeError => new TypeError(
    `${endpoint.controller}.${endpoint.method}: path parameter "${name}" ${problem}. Nothing was sent.`,
  );

  if (value === null || value === undefined) {
    throw refuse(`is ${value}, and every :param of ${route} needs a value`);
  }

  const text = String(value);
  if (ROUTE_CHANGING_SEGMENTS.has(text)) {
    const reading = text === '' ? 'is empty' : `is the dot segment "${text}"`;
    throw refuse(
      `${reading}, which would take the request to a different route than ${route} however it is encoded. ` +
      'Send such a value as a @Query parameter or in the @Body',
    );
  }

  try {
    return encodeURIComponent(text);
  } catch {
    // `encodeURIComponent` throws a URIError only for an unpaired surrogate.
    throw refuse('contains an unpaired UTF-16 surrogate, which has no percent-encoding');
  }
}

/** The parameter types a caller supplies. See {@link clientParams}. */
type ClientParamType = ParamType.PATH | ParamType.QUERY | ParamType.BODY;

type ClientParam = ParamMetadata & { type: ClientParamType };

function isClientParam(param: ParamMetadata): param is ClientParam {
  return param.type === ParamType.PATH || param.type === ParamType.QUERY || param.type === ParamType.BODY;
}

/**
 * The handler parameters a generated call takes arguments for: its `@Param`, `@Query` and `@Body`
 * parameters, in the order the handler declares them. Argument `n` of the call is entry `n`.
 *
 * Every other decorated parameter is a view over the SERVER's request: `@Header`, `@Cookie`,
 * `@Req`, `@Res`, a `createHttpParamDecorator` extractor, a file or a form field. The client sends
 * nothing for them, so they take no argument. An undecorated parameter is not in the metadata at
 * all, and takes none either.
 *
 * Counting only these three types is what makes the call's arguments the list a caller can see,
 * and the list a typed contract would expose: walking every decorated parameter against `args[i]`
 * would let a server-only one declared before a client one take an argument and shift the rest, so
 * `(@Header a, @Query q)` called as `m('hello')` would send no query.
 */
function clientParams(endpoint: EndpointMetadata): ClientParam[] {
  return (endpoint.params ?? []).filter(isClientParam).sort((a, b) => a.index - b.index);
}

/**
 * The query string of a call, `?` included, or `''` when it sends no query value.
 *
 * Built here rather than handed to the HTTP client as a record, because that client appends
 * `String(value)` once per key: `['a', 'b']` would go out as `tags=a%2Cb` and the handler would
 * receive `'a,b'`. An array is sent as one `name[]` key per element instead, which the server's query
 * parser reads back as an array. The `[]` suffix is what keeps a one-element array an array: a
 * repeated key alone gives an array only from the second value on, so `['a']` would arrive as `'a'`.
 *
 * Every other value is sent as the HTTP client sends it, one key with `String(value)`. `null` and
 * `undefined` are not sent, and neither are the `null` and `undefined` elements of an array, so an
 * empty array sends nothing and the handler receives `undefined`. Values are encoded with
 * `URLSearchParams`, as the HTTP client encodes them, so a single value goes out exactly as the HTTP
 * client would send it.
 */
function queryStringFor(query: ReadonlyMap<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [name, value] of query) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (element !== undefined && element !== null) {
          search.append(`${name}[]`, String(element));
        }
      }
    } else if (value !== undefined && value !== null) {
      search.append(name, String(value));
    }
  }

  const text = search.toString();

  return text === '' ? '' : `?${text}`;
}

/**
 * The name of a `@Body` value that is bytes or a stream, which JSON has no form for, or `undefined`
 * for any other value.
 *
 * `JSON.stringify` makes `{"0":1,"1":2}` of a typed array and `{}` of an `ArrayBuffer`, a
 * `SharedArrayBuffer`, a `DataView`, a `Blob` (a `Bun.file()` is one) and a stream — a
 * `ReadableStream`, a Node.js `Readable`, an async generator object. The handler would receive
 * that object instead of what the value holds, so such a body is refused.
 *
 * Bytes are refused whatever else they are, so a Node.js `Buffer` is refused too: it is a
 * `Uint8Array`, and its `toJSON` (`{ type: 'Buffer', data: [...] }`) is not the bytes. Any other
 * value with a `toJSON` method says how it serializes and stays JSON — `URLSearchParams`,
 * `FormData`, and a stream-like object that declares one.
 */
function bytesOrStreamTypeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const bytes = ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    value instanceof SharedArrayBuffer ||
    value instanceof Blob;
  const stream = typeof (value as { toJSON?: unknown }).toJSON !== 'function' && (
    value instanceof ReadableStream ||
    value instanceof Readable ||
    Object.prototype.toString.call(value) === '[object AsyncGenerator]'
  );
  if (!bytes && !stream) {
    return undefined;
  }

  // An async generator's `constructor` is not a function: its tag names it
  const owner: unknown = (value as { constructor?: unknown }).constructor;

  return typeof owner === 'function' && owner.name !== ''
    ? owner.name
    : Object.prototype.toString.call(value).slice('[object '.length, -1);
}

/**
 * The bytes of a call's body: the `@Body` value as JSON, or `undefined` when it sends none.
 *
 * Serialized here, because the HTTP client sends a string as it is and skips a falsy value: it
 * would send `'hello'` as the bare text `hello`, which the server's `req.json()` cannot parse, so
 * the handler would receive `undefined`, and it would send no body at all for `0`, `false`, `''` or
 * `null`. As JSON, every one of them reaches `@Body()` as it was passed. The text is handed on as a string, so the
 * HTTP client sends (and signs) exactly these bytes, under its default
 * `Content-Type: application/json`. A `custom` auth interceptor therefore sees this text as
 * `config.data`, not the value.
 *
 * `undefined` sends no body, and so does any value `JSON.stringify` has no text for (a function, a
 * symbol). Refused with a `TypeError` naming the call, before any request is made:
 * - bytes and streams ({@link bytesOrStreamTypeOf}), which JSON has no form for. The handler's
 *   `@Body` is parsed JSON, so bytes are sent through `HttpClient`, which sends a `Uint8Array`, an
 *   `ArrayBuffer` or a `Blob` as its bytes;
 * - a value `JSON.stringify` throws on, a BigInt or a cyclic object.
 *
 * Called only for a method in {@link BODY_CARRYING_METHODS}, the ones whose body is sent.
 *
 * @param position - The `@Body` parameter's position among the call's arguments, from 0
 */
function jsonBodyFor(endpoint: EndpointMetadata, value: unknown, position: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const bytesOrStream = bytesOrStreamTypeOf(value);
  if (bytesOrStream !== undefined) {
    // A Buffer's toJSON gives { type: 'Buffer', data: [...] }; other bytes and streams have none
    const sentAs = typeof (value as { toJSON?: unknown }).toJSON === 'function'
      ? 'the JSON of its toJSON()'
      : ArrayBuffer.isView(value) && !(value instanceof DataView) ? '{"0":…}' : '{}';

    throw new TypeError(
      `${endpoint.controller}.${endpoint.method}: the @Body argument (argument ${position + 1}) is a ${bytesOrStream}, ` +
      `which has no JSON form: it would be sent as ${sentAs}, and the handler would receive that object. ` +
      'A service-client body is JSON. To send bytes, call ' +
      `${endpoint.httpMethod} ${endpoint.path} through HttpClient (createHttpClient), which sends a Uint8Array, ` +
      'an ArrayBuffer or a Blob as its bytes; read a stream into a Uint8Array first. Nothing was sent.',
    );
  }

  try {
    // Typed `string`, but it is `undefined` for a function or a symbol.
    const json: string | undefined = JSON.stringify(value);

    return json;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new TypeError(
      `${endpoint.controller}.${endpoint.method}: the @Body value cannot be sent as JSON (${reason}). Nothing was sent.`,
      { cause: error },
    );
  }
}

/**
 * The URL and the body of one call: path values encoded into the route template, the query string
 * appended to it, and the body serialized as JSON. Every refusal happens here, before any request.
 */
function buildRequestParams(
  endpoint: EndpointMetadata,
  args: unknown[],
): { url: string; body?: string } {
  let body: unknown;
  let bodyPosition = 0;
  const query = new Map<string, unknown>();
  const pathValues = new Map<string, unknown>();

  // Arguments past the last client parameter are dropped.
  clientParams(endpoint).forEach((param, position) => {
    const value = args[position];

    switch (param.type) {
      case ParamType.PATH:
        if (param.name && !pathValues.has(param.name)) {
          pathValues.set(param.name, value);
        }
        break;
      case ParamType.BODY:
        body = value;
        bodyPosition = position;
        break;
      case ParamType.QUERY:
        if (param.name) {
          query.set(param.name, value);
        }
        break;
    }
  });

  // One pass over the template with a function replacer: each token is replaced by exact name,
  // and the returned text is inserted as is (a string replacement would expand `$&` and `$1`).
  // A token with no @Param behind it is left as it was.
  const path = endpoint.path.replace(
    PATH_TOKEN,
    (token: string, name: string) => (pathValues.has(name) ? pathSegmentFor(endpoint, name, pathValues.get(name)) : token),
  );

  // A GET, DELETE, HEAD, OPTIONS or ALL call sends no body, whatever it is handed, so it is handed
  // none. The value is not serialized: one JSON cannot represent (a BigInt) must not fail a call
  // that never sends it. And a `custom` auth interceptor sees
  // `config.data` as `undefined`, which is what is sent.
  const sent = BODY_CARRYING_METHODS.has(endpoint.httpMethod) ? jsonBodyFor(endpoint, body, bodyPosition) : undefined;

  return { url: `${path}${queryStringFor(query)}`, body: sent };
}

/**
 * Property names that JavaScript itself reads from any object it is handed, not names a caller
 * wrote: `then` when a promise settles with the object (so `await client`, `Promise.resolve(client)`
 * and an `async` factory that returns the client), and `toJSON` when `JSON.stringify` serializes it.
 */
const PROBED_NAMES: ReadonlySet<string> = new Set(['then', 'toJSON']);

/**
 * A proxy that reads like a plain object holding `build(entry)` under each name of `entries`,
 * except that reading any other string name throws `notFound(name)`: a misspelled controller or
 * method fails where it is written, not later as `undefined is not a function`.
 *
 * The throw is kept away from reads the caller never wrote, which a plain object answers without
 * one:
 * - `then`, `toJSON` and every symbol key (`Symbol.toPrimitive`, `Symbol.iterator`, inspection
 *   hooks) read as `undefined`. A `then` that throws would make every promise that settles with
 *   the proxy reject, so an async factory returning the client would fail;
 * - the members every object inherits from `Object.prototype` (`toString`, `valueOf`,
 *   `constructor`, `hasOwnProperty`, ...) read as inherited, which is what `String(client)` needs.
 *
 * A declared name wins over both, as an own property of a plain object would.
 *
 * `in` answers the same way `get` does: true for a declared name or an inherited member, false for
 * anything else, including `then`.
 */
function createNameProxy<TEntry, TValue>(
  entries: ReadonlyMap<string, TEntry>,
  build: (entry: TEntry) => TValue,
  notFound: (name: string) => Error,
): Record<string, TValue> {
  return new Proxy<Record<string, TValue>>({}, {
    get(target, key, receiver) {
      const entry = typeof key === 'string' ? entries.get(key) : undefined;
      if (entry !== undefined) {
        return build(entry);
      }
      if (typeof key === 'symbol' || PROBED_NAMES.has(key)) {
        return undefined;
      }
      if (Reflect.has(target, key)) {
        return Reflect.get(target, key, receiver);
      }

      throw notFound(key);
    },
    has(target, key) {
      return (typeof key === 'string' && entries.has(key)) || Reflect.has(target, key);
    },
  });
}

/** The keys of the success envelope the server builds around a handler's return value. */
const SUCCESS_ENVELOPE_KEYS: ReadonlySet<string> = new Set(['success', 'result', 'traceId']);

/**
 * Whether a body is the server's success envelope: `success: true` and nothing but `result` and
 * `traceId` beside it. `result` is absent when the handler returned `undefined`, because
 * `JSON.stringify` drops an `undefined` property, so `{ "success": true }` is the envelope of a
 * `void` handler.
 */
function isSuccessEnvelope(body: unknown): body is { success: true; result?: unknown } {
  return typeof body === 'object' &&
    body !== null &&
    (body as { success?: unknown }).success === true &&
    Object.keys(body).every((key) => SUCCESS_ENVELOPE_KEYS.has(key));
}

/**
 * The value the handler returned, out of what the HTTP client resolved.
 *
 * `request()` rejects on every failure, so it resolves a success, and its `result` is the body the
 * server sent. The server wraps every value a handler returns into `{ success: true, result }`,
 * on every route, so that `result` is the value. A handler that returned a `Response` of its own
 * sent its body as it is: a success envelope (`this.success(value, 201)`) resolves its `result`,
 * and any other body resolves whole.
 */
function handlerValue(response: ApiResponse<unknown>): unknown {
  const body = response.success ? response.result : undefined;

  return isSuccessEnvelope(body) ? body.result : body;
}

/**
 * Create a proxy for controller methods
 */
function createControllerProxy(
  controllerDef: ControllerDefinition,
  httpClient: HttpClient,
): ControllerClient {
  return createNameProxy(
    controllerDef.methods,
    (endpoint) => async (...args: unknown[]): Promise<unknown> => {
      const { url, body } = buildRequestParams(endpoint, args);

      // The query string is already in `url` and the body is JSON text, so the HTTP client sends
      // both as they are. It only appends a query key of its own (an API key in query mode). A
      // `custom` auth interceptor sees exactly these: the call's query in `config.url`, not in
      // `config.query`, and the text in `config.data`.
      const response = await httpClient.request({
        // Cast to RequestsHttpMethod to handle enum type difference between @onebun/core and @onebun/requests
        method: endpoint.httpMethod as unknown as RequestsHttpMethod,
        url,
        data: body,
      });

      return handlerValue(response);
    },
    (methodName) => new Error(`Method "${methodName}" not found in controller "${controllerDef.name}"`),
  );
}

/**
 * Create an HTTP client for a service from its definition. Endpoints are reached as
 * `client.<ControllerClassName>.<handlerName>(...args)`.
 *
 * What is checked, and where:
 * - Controller and method names, at run time only: reading one the definition does not have
 *   throws. The return type is `Record<string, ControllerClient>`, so any name compiles.
 * - Nothing checks the types of the arguments or the result. Each method is
 *   `(...args: any[]) => Promise<unknown>`. The arguments are the handler's `@Param`, `@Query` and
 *   `@Body` parameters, one each, in the order the handler declares them. A `@Header`, `@Cookie`,
 *   `@Req`, custom-extractor, file or form-field parameter takes no argument, wherever it is
 *   declared. Extra
 *   arguments are dropped. Path values are sent as encoded text, and a missing one is refused;
 *   a query array arrives as an array, and the body as JSON (see below).
 * - The promise resolves with the value the handler returned. A failure rejects with the
 *   `OneBunBaseError` subclass its status names, carrying the callee's `error`, `code` and
 *   `details`: a `ConflictError` the handler threw arrives as a `ConflictError` with its 409.
 *   A status without a class of its own is an `HttpStatusError` with that `code`, and a timeout
 *   or a refused connection a `TransportError` with code `0`.
 *
 * @param definition - Service definition created by createServiceDefinition()
 * @param options - Client options including URL, timeout, retries, etc.
 * @returns The client, keyed by controller class name
 *
 * @example
 * ```typescript
 * import { createServiceClient, createServiceDefinition } from '@onebun/core';
 * import { UsersModule } from './users.module';
 *
 * const usersDefinition = createServiceDefinition(UsersModule);
 *
 * const usersClient = createServiceClient(usersDefinition, {
 *   url: 'http://localhost:3001',
 *   timeout: 5000,
 *   retries: { max: 3, delay: 100, backoff: 'exponential' },
 * });
 *
 * // Calls GET /users/:id on UsersController.getById. `user` is `unknown`: annotate or check it.
 * const user = await usersClient.UsersController.getById('123');
 * ```
 *
 * Each path parameter value is converted to text and percent-encoded with `encodeURIComponent`,
 * so the handler's `@Param` receives exactly the value passed here, `/`, `?`, `#`, `%` and all. Do
 * not encode it yourself: `encodeURIComponent('a/b')` passed here arrives as `'a%2Fb'`. A value no
 * encoding can send as one segment is refused with a `TypeError` before any request is made:
 * `null`, `undefined`, `''`, `.`, `..`, and a string with an unpaired UTF-16 surrogate.
 *
 * A `@Query` array is sent as one `name[]=element` key per element, so the handler receives an
 * array, a one-element one included. An empty array,
 * `null` and `undefined` send no value. On a `POST`, `PUT` or `PATCH` endpoint the `@Body` value is
 * always sent as JSON, so a string, `0`, `false`, `''` and `null` reach the handler as they were
 * passed; `undefined`
 * sends no body, and a value `JSON.stringify` throws on is refused with a `TypeError` before any
 * request is made. So is a value that is bytes or a stream (a typed array, a `Buffer` included, an
 * `ArrayBuffer`, a `Blob`, a `ReadableStream`, ...), which JSON has no form for: send bytes through `HttpClient`,
 * which sends a `Uint8Array`, an `ArrayBuffer` or a `Blob` as its bytes. With any other method no
 * body is sent, and the value is neither serialized nor
 * checked. A `custom` auth interceptor sees what is sent: the query string in `config.url`, and in
 * `config.data` the JSON text of the body, or `undefined`.
 *
 * The client and each `client.<Controller>` behave as plain values: they can be awaited and
 * returned from an `async` factory (`then` reads as `undefined`), serialized, converted to a
 * string, and tested with `in` (`'UsersController' in client`). Reading a controller or method name
 * the definition does not have throws.
 *
 * @see docs:api/requests.md
 */
export function createServiceClient<TDef extends ServiceDefinition>(
  definition: TDef,
  options: ServiceClientOptions,
): Record<string, ControllerClient> {
  const {
    url,
    serviceName: _serviceName,
    interServiceAuth: _interServiceAuth,
    ...httpOptions
  } = options;

  // Create HttpClient with the provided options
  const httpClient = new HttpClient({
    baseUrl: url,
    ...httpOptions,
  });

  return createNameProxy(
    definition._controllers,
    (controllerDef) => createControllerProxy(controllerDef, httpClient),
    (controllerName) => new Error(
      `Controller "${controllerName}" not found in service definition. ` +
      `Available controllers: ${Array.from(definition._controllers.keys()).join(', ')}`,
    ),
  );
}

/**
 * Get the base URL for a service from OneBunApplication in multi-service mode.
 * This is a convenience function for getting service URLs.
 *
 * @param app - OneBunApplication instance (multi-service mode)
 * @param serviceName - Name of the service
 * @returns Service URL
 */
export function getServiceUrl<TServices extends Record<string, unknown>>(
  app: { getServiceUrl: (name: keyof TServices) => string },
  serviceName: keyof TServices,
): string {
  return app.getServiceUrl(serviceName);
}
