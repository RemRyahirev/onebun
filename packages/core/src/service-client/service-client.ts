import type { ServiceClientOptions, ControllerClient } from './service-client.types';
import type {
  ControllerDefinition,
  EndpointMetadata,
  ServiceDefinition,
} from './service-definition';

import { HttpClient, type HttpMethod as RequestsHttpMethod } from '@onebun/requests';

import { ParamType } from '../types';

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

/**
 * Build request parameters from endpoint metadata and arguments
 */
function buildRequestParams(
  endpoint: EndpointMetadata,
  args: unknown[],
): { url: string; body?: unknown; query?: Record<string, unknown> } {
  let body: unknown;
  let query: Record<string, unknown> | undefined;
  const pathValues = new Map<string, unknown>();

  const params = endpoint.params || [];

  // Sort params by index to match with args
  const sortedParams = [...params].sort((a, b) => a.index - b.index);

  for (let i = 0; i < sortedParams.length; i++) {
    const param = sortedParams[i];
    const value = args[i];

    switch (param.type) {
      case ParamType.PATH:
        if (param.name && !pathValues.has(param.name)) {
          pathValues.set(param.name, value);
        }
        break;
      case ParamType.BODY:
        body = value;
        break;
      case ParamType.QUERY:
        query = query || {};
        if (param.name) {
          query[param.name] = value;
        }
        break;
      case ParamType.CUSTOM:
        // An extractor is a view over the SERVER's request — there is nothing for a caller to
        // pass, so it consumes no argument here.
        //
        // It does still occupy a slot in this loop, because the loop walks `sortedParams[i]`
        // against `args[i]`. That is pre-existing: HEADER, REQUEST and RESPONSE fall into the
        // same shape below, so a handler that declares one of them before a QUERY already reads
        // the wrong argument. Fixing it needs a counter compacted over client-relevant types
        // only, which is a change to how every generated call is made — see the work item.
        break;

      // HEADER, REQUEST, RESPONSE are not typically used in client calls
      default:
        break;
    }
  }

  // One pass over the template with a function replacer: each token is replaced by exact name,
  // and the returned text is inserted as is (a string replacement would expand `$&` and `$1`).
  // A token with no @Param behind it is left as it was.
  const url = endpoint.path.replace(
    PATH_TOKEN,
    (token: string, name: string) => (pathValues.has(name) ? pathSegmentFor(endpoint, name, pathValues.get(name)) : token),
  );

  return { url, body, query };
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

/**
 * Create a proxy for controller methods
 */
function createControllerProxy(
  controllerDef: ControllerDefinition,
  httpClient: HttpClient,
): ControllerClient {
  return createNameProxy(
    controllerDef.methods,
    (endpoint) => async (...args: unknown[]) => {
      const { url, body, query } = buildRequestParams(endpoint, args);

      return await httpClient.request({
        // Cast to RequestsHttpMethod to handle enum type difference between @onebun/core and @onebun/requests
        method: endpoint.httpMethod as unknown as RequestsHttpMethod,
        url,
        data: body,
        query,
      });
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
 *   `(...args: any[]) => Promise<any>`. Arguments are matched by position to every decorated
 *   parameter of the handler, but only the `@Param`, `@Query` and `@Body` values are sent: an
 *   argument in the position of a `@Header`, `@Req` or any other parameter is dropped, and so are
 *   extra arguments. Path values are sent as encoded text, and a missing one is refused (see below).
 * - The promise resolves the HTTP client's success envelope, whose `result` is the server's own
 *   `{ success, result }` body: the handler's return value is at `response.result.result`. A 4xx
 *   or 5xx response rejects.
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
 * // Calls GET /users/:id on UsersController.getById. `response` is `any`.
 * const response = await usersClient.UsersController.getById('123');
 * ```
 *
 * Each path parameter value is converted to text and percent-encoded with `encodeURIComponent`,
 * so the handler's `@Param` receives exactly the value passed here, `/`, `?`, `#`, `%` and all. Do
 * not encode it yourself: `encodeURIComponent('a/b')` passed here arrives as `'a%2Fb'`. A value no
 * encoding can send as one segment is refused with a `TypeError` before any request is made:
 * `null`, `undefined`, `''`, `.`, `..`, and a string with an unpaired UTF-16 surrogate.
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
