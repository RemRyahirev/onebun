import type { Type } from 'arktype';

import type { HttpMethod, RouteMetadata } from '@onebun/core';

/**
 * OpenAPI 3.1 specification types
 */
export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

export interface PathItem {
  [method: string]: Operation;
}

export interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
}

export interface Parameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

export interface RequestBody {
  required?: boolean;
  content: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'application/json': {
      schema: Record<string, unknown>;
    };
  };
}

export interface Response {
  description: string;
  content?: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'application/json': {
      schema: Record<string, unknown>;
    };
  };
}

/**
 * API metadata for documentation
 */
export interface ApiMetadata {
  operation?: {
    summary?: string;
    description?: string;
    tags?: string[];
  };
  responses?: Array<{
    statusCode: number;
    schema?: Type<unknown>;
    description?: string;
  }>;
}

/**
 * Route information for documentation generation
 */
export interface RouteInfo {
  path: string;
  method: HttpMethod;
  handler: string;
  params?: RouteMetadata['params'];
  responseSchemas?: RouteMetadata['responseSchemas'];
  apiMetadata?: ApiMetadata;
}
