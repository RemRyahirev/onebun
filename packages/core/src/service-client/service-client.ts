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
 * Characters that end a path segment when a WHATWG URL parser reads an `http(s)` URL. The
 * backslash is on the list because special schemes treat it exactly like `/`.
 */
const SEGMENT_TERMINATORS = ['/', '\\', '?', '#'] as const;

/** ASCII tab and newline: a WHATWG URL parser deletes them wherever they occur. */
const URL_STRIPPED_ANYWHERE = /[\t\n\r]/g;

/**
 * The highest code unit a WHATWG URL parser trims from both ends of the URL: U+0020, space. The C0
 * controls (U+0000 to U+001F) are everything below it.
 */
const URL_TRIMMED_MAX_CODE_UNIT = 0x20;

/** Segments a URL parser treats as "this directory" and "the parent directory", or an empty one. */
const ROUTE_CHANGING_SEGMENTS = new Set(['', '.', '..']);

/**
 * `text` without its trailing C0 controls and spaces.
 *
 * A scan from the end rather than an end-anchored regex over the same range: a backtracking engine
 * retries that pattern from every position of a run that does not reach the end, so 100 000 spaces
 * followed by `x` took seconds. `trimEnd()` is no substitute either: it keeps most C0 controls
 * (U+0000, U+0001, ...) and trims Unicode spaces such as U+00A0 that the parser keeps.
 */
function trimUrlEnd(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) <= URL_TRIMMED_MAX_CODE_UNIT) {
    end--;
  }

  return text.slice(0, end);
}

/**
 * The segment a URL parser will actually see for `text`, for the dot-segment check.
 *
 * Before it looks for `.` and `..` the parser deletes every ASCII tab and newline anywhere in the
 * URL, and trims C0 controls and spaces from the end of the URL, which is where this segment sits
 * when the call has no query. So `'.\t.'` and `'.. '` arrive as `..`. It also accepts `%2e` for
 * a dot in any case and in any position, which decoding covers. A value that is not valid
 * percent-encoding is checked as written: it cannot decode to a dot segment.
 *
 * `text` is caller input of any length, so every step here is linear in it.
 */
function effectivePathSegment(text: string): string {
  const parsed = trimUrlEnd(text.replace(URL_STRIPPED_ANYWHERE, ''));

  try {
    return decodeURIComponent(parsed);
  } catch {
    return parsed;
  }
}

/**
 * The text that replaces one `:name` token, or a `TypeError` for a value that would make the
 * request reach a different route than the one the endpoint declares.
 *
 * The value is sent unencoded, as it always was, so a caller who percent-encodes it first keeps
 * working. Refusing is the one change: an unencoded `/`, `?`, `#` or `\` ends the segment, and
 * `..`, `.` or an empty segment moves the path up a level or onto a sibling route. The request
 * would carry this client's credentials to that route. The refusal happens before any request
 * is made.
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
  const terminator = SEGMENT_TERMINATORS.find((character) => text.includes(character));
  if (terminator !== undefined) {
    throw refuse(
      `contains ${JSON.stringify(terminator)}, which ends a path segment, so the request would reach a ` +
      `different route than ${route}. Percent-encode the value (encodeURIComponent) to send it as data`,
    );
  }

  const segment = effectivePathSegment(text);
  if (ROUTE_CHANGING_SEGMENTS.has(segment)) {
    const reading = segment === '' ? 'is empty' : `is read by the URL parser as the dot segment "${segment}"`;
    throw refuse(`${reading}, so the request would reach a different route than ${route}`);
  }

  return text;
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
 *   hooks) read as `undefined`. A `then` that throws makes every promise that settles with the
 *   proxy reject, which is how an async factory returning the client used to fail;
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
 * Create a typed HTTP client for a service based on its definition.
 * The client provides type-safe access to service endpoints through controller.method() pattern.
 *
 * @param definition - Service definition created by createServiceDefinition()
 * @param options - Client options including URL, timeout, retries, etc.
 * @returns Typed service client
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
 * // Type-safe call to users controller's getById method
 * const result = await usersClient.UsersController.getById('123');
 * ```
 *
 * A path parameter value that would change the route is refused with a `TypeError` before any
 * request is made: `null`, `undefined`, a value containing `/`, `?`, `#` or `\`, and a value the
 * URL parser reads as `''`, `.` or `..` (including `%2e` spellings).
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
