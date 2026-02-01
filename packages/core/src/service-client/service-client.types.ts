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
 * Typed service client interface.
 * Provides type-safe access to service endpoints through controller.method() pattern.
 *
 * @example
 * ```typescript
 * const client = createServiceClient(usersDefinition, { url: 'http://localhost:3001' });
 * const result = await client.users.getById('123');
 * ```
 */
export type ServiceClient<TDef extends ServiceDefinition> = {
  [K in ExtractControllerNames<TDef> & string]: ControllerClient;
};

/**
 * Client interface for a single controller.
 * Methods are accessed by their handler names.
 */
export interface ControllerClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [methodName: string]: (...args: any[]) => Promise<any>;
}
