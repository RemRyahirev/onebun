import type {
  OpenApiSpec,
  Operation,
  Parameter,
  Response,
} from '../types';

import type { HttpMethod, RouteMetadata } from '@onebun/core';
import { getControllerMetadata } from '@onebun/core';

import { getApiOperationMetadata, getApiTagsMetadata } from '../decorators';

import { arktypeToJsonSchema } from './json-schema-converter';

/**
 * Generate OpenAPI 3.1 specification from controller metadata
 */
export function generateOpenApiSpec(
  controllers: Function[],
  options: {
    title?: string;
    version?: string;
    description?: string;
  } = {},
): OpenApiSpec {
  const spec: OpenApiSpec = {
    openapi: '3.1.0',
    info: {
      title: options.title || 'OneBun API',
      version: options.version || '1.0.0',
      description: options.description,
    },
    paths: {},
    components: {
      schemas: {},
    },
  };

  for (const controllerClass of controllers) {
    const metadata = getControllerMetadata(controllerClass);
    if (!metadata) {
      continue;
    }

    for (const route of metadata.routes) {
      const rawPath = `${metadata.path}${route.path}`;
      const path = rawPath.replace(/:([^/]+)/g, '{$1}');
      const method = route.method.toLowerCase() as Lowercase<HttpMethod>;

      if (!spec.paths[path]) {
        spec.paths[path] = {};
      }

      const operation = routeToOperation(
        route,
        controllerClass,
        route.handler,
        metadata.path,
      );
      spec.paths[path][method] = operation;
    }
  }

  return spec;
}

/**
 * Convert route metadata to OpenAPI operation
 */
function routeToOperation(
  route: RouteMetadata,
  controllerClass: Function,
  handlerName: string,
  _basePath: string,
): Operation {
  const operation: Operation = {
    parameters: [],
    responses: {},
  };

  // Get API operation metadata from decorators
  const apiOperation = getApiOperationMetadata(controllerClass.prototype, handlerName);
  if (apiOperation) {
    operation.summary = apiOperation.summary;
    operation.description = apiOperation.description;
    operation.tags = apiOperation.tags;
  }

  // Get API tags from controller class or method
  const controllerTags = getApiTagsMetadata(controllerClass);
  const methodTags = getApiTagsMetadata(controllerClass.prototype, handlerName);
  const allTags = [...(controllerTags || []), ...(methodTags || [])];
  if (allTags.length > 0 && !operation.tags) {
    operation.tags = allTags;
  }

  // Process parameters
  if (route.params) {
    for (const param of route.params) {
      if (param.type === 'path' || param.type === 'query' || param.type === 'header') {
        const parameter: Parameter = {
          name: param.name || '',
          in: param.type === 'path' ? 'path' : param.type === 'query' ? 'query' : 'header',
          required: param.isRequired === true,
        };

        if (param.schema) {
          parameter.schema = arktypeToJsonSchema(param.schema);
        }

        operation.parameters?.push(parameter);
      } else if (param.type === 'body' && param.schema) {
        operation.requestBody = {
          required: param.isRequired === true,
          content: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'application/json': {
              schema: arktypeToJsonSchema(param.schema),
            },
          },
        };
      }
    }
  }

  // Process response schemas
  if (route.responseSchemas) {
    for (const responseSchema of route.responseSchemas) {
      const response: Response = {
        description: responseSchema.description || `HTTP ${responseSchema.statusCode} response`,
      };

      if (responseSchema.schema) {
        response.content = {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'application/json': {
            schema: arktypeToJsonSchema(responseSchema.schema),
          },
        };
      }

      operation.responses![String(responseSchema.statusCode)] = response;
    }
  }

  // Default 200 response if no responses defined
  if (!operation.responses || Object.keys(operation.responses).length === 0) {
    operation.responses = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '200': {
        description: 'Success',
      },
    };
  }

  return operation;
}
