/**
 * WebSocket Service Definition
 *
 * Collects metadata from WebSocket gateways for generating typed clients.
 */

import type { WsHandlerType, WsParamMetadata } from './ws.types';

import { getModuleMetadata } from '../decorators/decorators';

import { getGatewayMetadata, isWebSocketGateway } from './ws-decorators';

/**
 * Metadata for a single WebSocket endpoint/event
 */
export interface WsEndpointMetadata {
  /** Gateway class name */
  gateway: string;
  /** Event pattern */
  event: string;
  /** Handler method name */
  handler: string;
  /** Handler type (message, connect, etc.) */
  type: WsHandlerType;
  /** Parameter metadata */
  params?: WsParamMetadata[];
}

/**
 * Definition of a WebSocket gateway with its events
 */
export interface WsGatewayDefinition {
  /** Gateway class name */
  name: string;
  /** WebSocket path */
  path: string;
  /** Namespace (if any) */
  namespace?: string;
  /** Map of event patterns to endpoint metadata */
  events: Map<string, WsEndpointMetadata>;
}

/**
 * Service definition containing all WebSocket gateways and events.
 * Used for generating typed WebSocket clients.
 */
export interface WsServiceDefinition<TModule = unknown> {
  /** Reference to the module class */
  readonly _module: TModule;
  /** Flat list of all endpoints */
  readonly _endpoints: WsEndpointMetadata[];
  /** Gateways grouped by name */
  readonly _gateways: Map<string, WsGatewayDefinition>;
}

/**
 * Module metadata structure
 */
interface ModuleMetadata {
  imports?: Function[];
  controllers?: Function[];
  providers?: unknown[];
  exports?: unknown[];
}

/**
 * Collect WebSocket endpoints recursively from a module and its imports
 */
function collectWsEndpointsRecursively(metadata: ModuleMetadata): WsEndpointMetadata[] {
  const endpoints: WsEndpointMetadata[] = [];

  // Collect from controllers (gateways are in controllers)
  for (const controller of metadata.controllers || []) {
    // Check if it's a WebSocket gateway
    if (!isWebSocketGateway(controller)) {
      continue;
    }

    const gatewayMeta = getGatewayMetadata(controller);
    if (!gatewayMeta) {
      continue;
    }

    // Add each handler as an endpoint
    for (const handler of gatewayMeta.handlers) {
      endpoints.push({
        gateway: controller.name,
        event: handler.pattern || handler.type,
        handler: handler.handler,
        type: handler.type,
        params: handler.params,
      });
    }
  }

  // Recursively collect from imported modules
  for (const importedModule of metadata.imports || []) {
    const importedMeta = getModuleMetadata(importedModule);
    if (importedMeta) {
      endpoints.push(...collectWsEndpointsRecursively(importedMeta));
    }
  }

  return endpoints;
}

/**
 * Group endpoints by gateway
 */
function groupByGateway(
  endpoints: WsEndpointMetadata[],
  moduleClass: Function,
): Map<string, WsGatewayDefinition> {
  const gateways = new Map<string, WsGatewayDefinition>();
  const metadata = getModuleMetadata(moduleClass);

  if (!metadata) {
    return gateways;
  }

  // First, collect gateway metadata
  const gatewayPaths = new Map<string, { path: string; namespace?: string }>();

  for (const controller of metadata.controllers || []) {
    if (isWebSocketGateway(controller)) {
      const gatewayMeta = getGatewayMetadata(controller);
      if (gatewayMeta) {
        gatewayPaths.set(controller.name, {
          path: gatewayMeta.path,
          namespace: gatewayMeta.namespace,
        });
      }
    }
  }

  // Group endpoints by gateway
  for (const endpoint of endpoints) {
    if (!gateways.has(endpoint.gateway)) {
      const pathInfo = gatewayPaths.get(endpoint.gateway) || { path: '/' };
      gateways.set(endpoint.gateway, {
        name: endpoint.gateway,
        path: pathInfo.path,
        namespace: pathInfo.namespace,
        events: new Map(),
      });
    }

    gateways.get(endpoint.gateway)!.events.set(endpoint.event, endpoint);
  }

  return gateways;
}

/**
 * Create a WebSocket service definition from a module class.
 * Collects all endpoint metadata from gateways and imported modules.
 *
 * @param moduleClass - The root module class decorated with @Module
 * @returns Service definition containing all WebSocket endpoints
 *
 * @example
 * ```typescript
 * import { createWsServiceDefinition } from '@onebun/core';
 * import { ChatModule } from './chat.module';
 *
 * export const chatWsDefinition = createWsServiceDefinition(ChatModule);
 *
 * // Use with createWsClient
 * const client = createWsClient(chatWsDefinition, {
 *   url: 'ws://localhost:3000',
 * });
 * ```
 */
export function createWsServiceDefinition<TModule>(
  moduleClass: new (...args: unknown[]) => TModule,
): WsServiceDefinition<TModule> {
  const metadata = getModuleMetadata(moduleClass);
  if (!metadata) {
    throw new Error(`${moduleClass.name} is not decorated with @Module`);
  }

  const endpoints = collectWsEndpointsRecursively(metadata);
  const gateways = groupByGateway(endpoints, moduleClass);

  return {
    _module: moduleClass as unknown as TModule,
    _endpoints: endpoints,
    _gateways: gateways,
  };
}

/**
 * Get gateway names from a service definition
 */
export function getWsGatewayNames<TDef extends WsServiceDefinition>(
  definition: TDef,
): string[] {
  return Array.from(definition._gateways.keys());
}

/**
 * Get event names for a gateway
 */
export function getWsEventNames<TDef extends WsServiceDefinition>(
  definition: TDef,
  gatewayName: string,
): string[] {
  const gateway = definition._gateways.get(gatewayName);

  return gateway ? Array.from(gateway.events.keys()) : [];
}

/**
 * Get endpoint metadata by gateway and event
 */
export function getWsEndpoint<TDef extends WsServiceDefinition>(
  definition: TDef,
  gatewayName: string,
  event: string,
): WsEndpointMetadata | undefined {
  const gateway = definition._gateways.get(gatewayName);

  return gateway?.events.get(event);
}
