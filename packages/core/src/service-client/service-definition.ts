import { getControllerMetadata, getModuleMetadata } from '../decorators/decorators';
import { type HttpMethod, type ParamMetadata } from '../types';

/**
 * Metadata for a single endpoint
 */
export interface EndpointMetadata {
  /**
   * Controller class name
   */
  controller: string;

  /**
   * Handler method name
   */
  method: string;

  /**
   * HTTP method (GET, POST, etc.)
   */
  httpMethod: HttpMethod;

  /**
   * Full path including controller base path
   */
  path: string;

  /**
   * Parameter metadata for this endpoint
   */
  params?: ParamMetadata[];
}

/**
 * Definition of a controller with its methods
 */
export interface ControllerDefinition {
  /**
   * Controller class name
   */
  name: string;

  /**
   * Base path for this controller
   */
  basePath: string;

  /**
   * Map of method names to endpoint metadata
   */
  methods: Map<string, EndpointMetadata>;
}

/**
 * Service definition containing all endpoints and controllers.
 * Used for generating typed HTTP clients.
 */
export interface ServiceDefinition<TModule = unknown> {
  /**
   * Reference to the module class
   */
  readonly _module: TModule;

  /**
   * Flat list of all endpoints
   */
  readonly _endpoints: EndpointMetadata[];

  /**
   * Controllers grouped by name
   */
  readonly _controllers: Map<string, ControllerDefinition>;
}

/**
 * Module metadata structure from decorators
 */
interface ModuleMetadata {
  imports?: Function[];
  controllers?: Function[];
  providers?: unknown[];
  exports?: unknown[];
}

/**
 * Collect endpoints recursively from a module and its imports
 */
function collectEndpointsRecursively(metadata: ModuleMetadata): EndpointMetadata[] {
  const endpoints: EndpointMetadata[] = [];

  // Collect from controllers
  for (const controller of metadata.controllers || []) {
    const controllerMeta = getControllerMetadata(controller);
    if (!controllerMeta) {
      continue;
    }

    for (const route of controllerMeta.routes) {
      endpoints.push({
        controller: controller.name,
        method: route.handler,
        httpMethod: route.method,
        path: `${controllerMeta.path}${route.path}`,
        params: route.params,
      });
    }
  }

  // Recursively collect from imported modules
  for (const importedModule of metadata.imports || []) {
    const importedMeta = getModuleMetadata(importedModule);
    if (importedMeta) {
      endpoints.push(...collectEndpointsRecursively(importedMeta));
    }
  }

  return endpoints;
}

/**
 * Group endpoints by controller name
 */
function groupByController(endpoints: EndpointMetadata[]): Map<string, ControllerDefinition> {
  const controllers = new Map<string, ControllerDefinition>();

  for (const endpoint of endpoints) {
    if (!controllers.has(endpoint.controller)) {
      controllers.set(endpoint.controller, {
        name: endpoint.controller,
        basePath: '',
        methods: new Map(),
      });
    }
    controllers.get(endpoint.controller)!.methods.set(endpoint.method, endpoint);
  }

  return controllers;
}

/**
 * Create a service definition from a module class.
 * Collects all endpoint metadata from controllers and imported modules.
 *
 * @param moduleClass - The root module class decorated with \@Module
 * @returns Service definition containing all endpoints
 *
 * @example
 * ```typescript
 * import { createServiceDefinition } from '@onebun/core';
 * import { UsersModule } from './users.module';
 *
 * export const usersDefinition = createServiceDefinition(UsersModule);
 * ```
 */
export function createServiceDefinition<TModule>(
  moduleClass: new (...args: unknown[]) => TModule,
): ServiceDefinition<TModule> {
  const metadata = getModuleMetadata(moduleClass);
  if (!metadata) {
    throw new Error(`${moduleClass.name} is not decorated with @Module`);
  }

  const endpoints = collectEndpointsRecursively(metadata);
  const controllers = groupByController(endpoints);

  return {
    _module: moduleClass as unknown as TModule,
    _endpoints: endpoints,
    _controllers: controllers,
  };
}
