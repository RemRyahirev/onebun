import type { ServiceClientOptions, ControllerClient } from './service-client.types';
import type {
  ControllerDefinition,
  EndpointMetadata,
  ServiceDefinition,
} from './service-definition';

import { HttpClient, type HttpMethod as RequestsHttpMethod } from '@onebun/requests';

import { ParamType } from '../types';

/**
 * Build request parameters from endpoint metadata and arguments
 */
function buildRequestParams(
  endpoint: EndpointMetadata,
  args: unknown[],
): { url: string; body?: unknown; query?: Record<string, unknown> } {
  let url = endpoint.path;
  let body: unknown;
  let query: Record<string, unknown> | undefined;

  const params = endpoint.params || [];

  // Sort params by index to match with args
  const sortedParams = [...params].sort((a, b) => a.index - b.index);

  for (let i = 0; i < sortedParams.length; i++) {
    const param = sortedParams[i];
    const value = args[i];

    switch (param.type) {
      case ParamType.PATH:
        // Replace :paramName with actual value
        url = url.replace(`:${param.name}`, String(value));
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
      // HEADER, REQUEST, RESPONSE are not typically used in client calls
      default:
        break;
    }
  }

  return { url, body, query };
}

/**
 * Create a proxy for controller methods
 */
function createControllerProxy(
  controllerDef: ControllerDefinition,
  httpClient: HttpClient,
): ControllerClient {
  return new Proxy({} as ControllerClient, {
    get(_, methodName: string) {
      const endpoint = controllerDef.methods.get(methodName);
      if (!endpoint) {
        throw new Error(
          `Method "${methodName}" not found in controller "${controllerDef.name}"`,
        );
      }

      return async (...args: unknown[]) => {
        const { url, body, query } = buildRequestParams(endpoint, args);

        return await httpClient.request({
          // Cast to RequestsHttpMethod to handle enum type difference between @onebun/core and @onebun/requests
          method: endpoint.httpMethod as unknown as RequestsHttpMethod,
          url,
          data: body,
          query,
        });
      };
    },
  });
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

  // Create a proxy that provides access to controllers
  return new Proxy({} as Record<string, ControllerClient>, {
    get(_, controllerName: string) {
      const controllerDef = definition._controllers.get(controllerName);
      if (!controllerDef) {
        throw new Error(
          `Controller "${controllerName}" not found in service definition. ` +
          `Available controllers: ${Array.from(definition._controllers.keys()).join(', ')}`,
        );
      }

      return createControllerProxy(controllerDef, httpClient);
    },
  });
}

/**
 * Get the base URL for a service from MultiServiceApplication
 * This is a convenience function for getting service URLs.
 *
 * @param app - MultiServiceApplication instance
 * @param serviceName - Name of the service
 * @returns Service URL
 */
export function getServiceUrl<TServices extends Record<string, unknown>>(
  app: { getServiceUrl: (name: keyof TServices) => string },
  serviceName: keyof TServices,
): string {
  return app.getServiceUrl(serviceName);
}
