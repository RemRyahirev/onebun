import type { ControllerDefinition, ServiceDefinition } from './service-definition';

import type { RequestsOptions } from '@onebun/requests';


/**
 * Options for creating a service client.
 * Extends RequestsOptions from \@onebun/requests with service-specific fields.
 */
export interface ServiceClientOptions extends Omit<RequestsOptions, 'baseUrl'> {
  /**
   * Service URL (used as baseUrl for HTTP client)
   */
  url: string;

  /**
   * Service name for tracing and logs
   */
  serviceName?: string;

  // Inherited from RequestsOptions:
  // timeout?: number;
  // headers?: Record<string, string>;
  // auth?: AuthConfig;
  // retries?: RetryConfig;
  // tracing?: boolean;
  // metrics?: boolean;
  // userAgent?: string;

  /**
   * Inter-service authentication strategy (for future use)
   */
  interServiceAuth?: {
    type: 'onebun' | 'bearer' | 'none';
  };
}

/**
 * Extract controller names from a service definition
 */
type ExtractControllerNames<TDef extends ServiceDefinition> =
  TDef['_controllers'] extends Map<infer K, ControllerDefinition> ? K : never;

/**
 * A service client keyed by controller name.
 *
 * The names are not known to the type system. `ServiceDefinition['_controllers']` is a
 * `Map<string, ControllerDefinition>`, so this resolves to a string index of `ControllerClient`:
 * any controller name compiles. `createServiceClient` does not return this type; it returns
 * `Record<string, ControllerClient>`, which is the same shape.
 *
 * Controllers are keyed by their class name, and a name the definition lacks throws when it is
 * read (at run time, not at compile time).
 *
 * @example
 * ```typescript
 * const client = createServiceClient(usersDefinition, { url: 'http://localhost:3001' });
 * const response = await client.UsersController.getById('123'); // `any`
 * ```
 *
 * @see docs:api/requests.md
 */
export type ServiceClient<TDef extends ServiceDefinition> = {
  [K in ExtractControllerNames<TDef> & string]: ControllerClient;
};

/**
 * Client interface for a single controller. Methods are accessed by their handler names.
 *
 * Every method is `(...args: any[]) => Promise<any>`. Nothing checks the order or types of the
 * arguments against the handler, and the resolved value is not typed by the handler's return type.
 * At run time only a missing (`undefined`) or `null` path parameter value is refused; extra
 * arguments, and those in the position of a parameter the client does not send, are dropped. The
 * method name itself is checked at run time: reading one the controller does not have throws.
 *
 * @see docs:api/requests.md
 */
export interface ControllerClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [methodName: string]: (...args: any[]) => Promise<any>;
}
