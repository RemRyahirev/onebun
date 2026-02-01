/**
 * Documentation Examples Tests for \@onebun/docs
 *
 * This file tests code examples from:
 * - packages/docs/README.md
 *
 * The \@onebun/docs package provides:
 * - \@ApiTags - for grouping endpoints
 * - \@ApiOperation - for describing operations
 * - generateOpenApiSpec - for generating OpenAPI specs
 * - generateSwaggerUiHtml - for generating Swagger UI
 * - arktypeToJsonSchema - for converting schemas
 *
 * Note: \@ApiResponse is provided by \@onebun/core for response validation
 */

import { type } from 'arktype';
import {
  describe,
  expect,
  it,
} from 'bun:test';

import {
  ApiResponse,
  BaseController,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@onebun/core';

import {
  ApiOperation,
  ApiTags,
  getApiOperationMetadata,
  getApiTagsMetadata,
} from './decorators';
import { generateOpenApiSpec } from './openapi/generator';
import { arktypeToJsonSchema } from './openapi/json-schema-converter';
import { generateSwaggerUiHtml } from './openapi/swagger-ui';

describe('Docs README Examples', () => {
  describe('Decorators from @onebun/docs', () => {
    it('should have @ApiTags decorator available', () => {
      expect(ApiTags).toBeDefined();
      expect(typeof ApiTags).toBe('function');
    });

    it('should have @ApiOperation decorator available', () => {
      expect(ApiOperation).toBeDefined();
      expect(typeof ApiOperation).toBe('function');
    });

    it('should use @ApiTags on controller class', () => {
      @ApiTags('Users')
      class UserController {}

      const tags = getApiTagsMetadata(UserController);
      expect(tags).toBeDefined();
      expect(tags!.length).toBeGreaterThan(0);
      expect(tags).toContain('Users');
    });

    it('should use @ApiTags with multiple tags', () => {
      @ApiTags('Users', 'User Management')
      class UserController {}

      const tags = getApiTagsMetadata(UserController);
      expect(tags).toBeDefined();
      expect(tags).toContain('Users');
      expect(tags).toContain('User Management');
    });

    it('should use @ApiOperation on method', () => {
      class TestController {
        @ApiOperation({
          summary: 'Get all users',
          description: 'Returns a list of all users',
        })
        async getUsers() {
          return [];
        }
      }

      const metadata = getApiOperationMetadata(
        TestController.prototype,
        'getUsers',
      );
      expect(metadata?.summary).toBe('Get all users');
      expect(metadata?.description).toBe('Returns a list of all users');
    });

    it('should use @ApiOperation with tags', () => {
      class TestController {
        @ApiOperation({
          summary: 'Get user',
          tags: ['Users', 'Admin'],
        })
        async getUser() {
          return {};
        }
      }

      const metadata = getApiOperationMetadata(
        TestController.prototype,
        'getUser',
      );
      expect(metadata?.tags).toContain('Users');
      expect(metadata?.tags).toContain('Admin');
    });
  });

  describe('Basic Usage Example (README)', () => {
    it('should use decorators from both packages', () => {
      const createUserSchema = type({
        name: 'string',
        email: 'string.email',
      });

      // Note: @ApiTags must be ABOVE @Controller because @Controller wraps the class
      // Decorators are applied bottom-to-top, so @ApiTags runs last and gets the wrapped class
      @ApiTags('Users')
      @Controller('/users')
      class UserController extends BaseController {
        // Note: @ApiOperation must be ABOVE @Get for the same reason
        @ApiOperation({
          summary: 'Get all users',
          description: 'Returns a list of all users',
        })
        @ApiResponse(200, { description: 'List of users returned successfully' })
        @Get('/')
        async getUsers(): Promise<Response> {
          return this.success({ users: [] });
        }

        @ApiOperation({
          summary: 'Create user',
          description: 'Creates a new user',
        })
        @ApiResponse(201, {
          schema: createUserSchema,
          description: 'User created successfully',
        })
        @ApiResponse(400, { description: 'Invalid input data' })
        @Post('/')
        async createUser(
          @Body(createUserSchema) userData: typeof createUserSchema.infer,
        ): Promise<Response> {
          return this.success({ id: '1', ...userData });
        }
      }

      expect(UserController).toBeDefined();
      
      // Verify tags are set on controller
      const tags = getApiTagsMetadata(UserController);
      expect(tags).toBeDefined();
      expect(tags!.length).toBeGreaterThan(0);
    });
  });

  describe('Configuration Options (README)', () => {
    it('should define valid DocsOptions interface', () => {
      // This matches the DocsApplicationOptions interface in core
      const docsOptions = {
        enabled: true,
        path: '/docs',
        jsonPath: '/openapi.json',
        title: 'My API',
        version: '1.0.0',
        description: 'API documentation for my service',
        contact: {
          name: 'API Support',
          email: 'support@example.com',
          url: 'https://example.com/support',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
        externalDocs: {
          description: 'More information',
          url: 'https://example.com/docs',
        },
        servers: [
          {
            url: 'https://api.example.com',
            description: 'Production server',
          },
          {
            url: 'https://staging-api.example.com',
            description: 'Staging server',
          },
        ],
      };

      expect(docsOptions.enabled).toBe(true);
      expect(docsOptions.path).toBe('/docs');
      expect(docsOptions.jsonPath).toBe('/openapi.json');
      expect(docsOptions.title).toBe('My API');
      expect(docsOptions.version).toBe('1.0.0');
      expect(docsOptions.servers).toHaveLength(2);
    });
  });
});

describe('OpenAPI Generation', () => {
  describe('generateOpenApiSpec', () => {
    it('should generate spec from controllers', () => {
      // Note: @ApiTags must be ABOVE @Controller
      @ApiTags('Users')
      @Controller('/users')
      class UserController extends BaseController {
        @ApiOperation({ summary: 'Get all users' })
        @Get('/')
        async getUsers(): Promise<Response> {
          return this.success([]);
        }

        @ApiOperation({ summary: 'Get user by ID' })
        @Get('/:id')
        async getUser(@Param('id') id: string): Promise<Response> {
          return this.success({ id });
        }
      }

      const spec = generateOpenApiSpec([UserController], {
        title: 'Test API',
        version: '1.0.0',
        description: 'Test API description',
      });

      expect(spec.openapi).toBe('3.1.0');
      expect(spec.info.title).toBe('Test API');
      expect(spec.info.version).toBe('1.0.0');
      expect(spec.info.description).toBe('Test API description');
      expect(spec.paths).toBeDefined();
      // Controller path + route path = /users + / = /users/
      expect(spec.paths['/users/']).toBeDefined();
      expect(spec.paths['/users/:id']).toBeDefined();
    });

    it('should include tags from @ApiTags', () => {
      @ApiTags('Orders')
      @Controller('/orders')
      class OrderController extends BaseController {
        @ApiOperation({ summary: 'Get orders' })
        @Get('/')
        async getOrders(): Promise<Response> {
          return this.success([]);
        }
      }

      const spec = generateOpenApiSpec([OrderController], {
        title: 'Test API',
        version: '1.0.0',
      });

      // Path is /orders/ (controller path + route path)
      const getOperation = spec.paths['/orders/']?.get;
      expect(getOperation).toBeDefined();
      expect(getOperation?.tags).toBeDefined();
      expect(getOperation?.tags).toContain('Orders');
    });

    it('should include operation metadata from @ApiOperation', () => {
      @Controller('/products')
      class ProductController extends BaseController {
        @ApiOperation({
          summary: 'List products',
          description: 'Returns paginated list of products',
          tags: ['Products', 'Catalog'],
        })
        @Get('/')
        async listProducts(): Promise<Response> {
          return this.success([]);
        }
      }

      const spec = generateOpenApiSpec([ProductController], {
        title: 'Test API',
        version: '1.0.0',
      });

      const getOperation = spec.paths['/products/']?.get;
      expect(getOperation).toBeDefined();
      expect(getOperation?.summary).toBe('List products');
      expect(getOperation?.description).toBe(
        'Returns paginated list of products',
      );
      expect(getOperation?.tags).toContain('Products');
      expect(getOperation?.tags).toContain('Catalog');
    });

    it('should include response schemas from @ApiResponse', () => {
      const productSchema = type({
        id: 'string',
        name: 'string',
        price: 'number',
      });

      @Controller('/products')
      class ProductController extends BaseController {
        // Note: @Get must be ABOVE @ApiResponse because @Get reads response schemas when it runs
        // and decorators apply bottom-to-top
        @Get('/:id')
        @ApiResponse(200, {
          schema: productSchema,
          description: 'Product found',
        })
        @ApiResponse(404, { description: 'Product not found' })
        async getProduct(@Param('id') id: string): Promise<Response> {
          return this.success({ id, name: 'Test', price: 10 });
        }
      }

      const spec = generateOpenApiSpec([ProductController], {
        title: 'Test API',
        version: '1.0.0',
      });

      const responses = spec.paths['/products/:id']?.get?.responses;
      expect(responses?.['200']).toBeDefined();
      expect(responses?.['200']?.description).toBe('Product found');
      expect(responses?.['404']).toBeDefined();
      expect(responses?.['404']?.description).toBe('Product not found');
    });

    it('should use default options when not provided', () => {
      @Controller('/api')
      class ApiController extends BaseController {
        @Get('/health')
        async health(): Promise<Response> {
          return this.success({ status: 'ok' });
        }
      }

      const spec = generateOpenApiSpec([ApiController]);

      expect(spec.info.title).toBe('OneBun API');
      expect(spec.info.version).toBe('1.0.0');
    });
  });

  describe('generateSwaggerUiHtml', () => {
    it('should generate valid HTML', () => {
      const html = generateSwaggerUiHtml('/openapi.json');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('swagger-ui');
      expect(html).toContain('/openapi.json');
    });

    it('should include spec URL in SwaggerUI config', () => {
      const html = generateSwaggerUiHtml('/api/v1/openapi.json');

      expect(html).toContain('url: "/api/v1/openapi.json"');
    });
  });

  describe('arktypeToJsonSchema', () => {
    it('should convert simple object schema', () => {
      const userSchema = type({
        name: 'string',
        age: 'number',
      });

      const jsonSchema = arktypeToJsonSchema(userSchema);

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
    });

    it('should convert schema with string constraints', () => {
      const emailSchema = type('string.email');

      const jsonSchema = arktypeToJsonSchema(emailSchema);

      expect(jsonSchema).toBeDefined();
    });

    it('should convert nested object schema', () => {
      const addressSchema = type({
        street: 'string',
        city: 'string',
      });

      const userSchema = type({
        name: 'string',
        address: addressSchema,
      });

      const jsonSchema = arktypeToJsonSchema(userSchema);

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
    });
  });
});

describe('Best Practices (README)', () => {
  it('should use @ApiOperation for all endpoints', () => {
    @Controller('/resources')
    class ResourceController extends BaseController {
      @ApiOperation({ summary: 'List resources' })
      @ApiResponse(200, { description: 'Resources listed' })
      @Get('/')
      async list(): Promise<Response> {
        return this.success([]);
      }

      @ApiOperation({ summary: 'Get resource by ID' })
      @ApiResponse(200, { description: 'Resource found' })
      @ApiResponse(404, { description: 'Resource not found' })
      @Get('/:id')
      async get(@Param('id') id: string): Promise<Response> {
        return this.success({ id });
      }
    }

    expect(ResourceController).toBeDefined();
  });

  it('should use @ApiTags for grouping', () => {
    // Note: @ApiTags MUST be placed ABOVE @Controller
    // because @Controller wraps the class and decorators apply bottom-to-top
    @ApiTags('Users')
    @Controller('/users')
    class UsersController extends BaseController {
      @Get('/')
      async list(): Promise<Response> {
        return this.success([]);
      }
    }

    @ApiTags('Orders')
    @Controller('/orders')
    class OrdersController extends BaseController {
      @Get('/')
      async list(): Promise<Response> {
        return this.success([]);
      }
    }

    const usersTags = getApiTagsMetadata(UsersController);
    const ordersTags = getApiTagsMetadata(OrdersController);
    
    expect(usersTags).toBeDefined();
    expect(usersTags).toContain('Users');
    expect(ordersTags).toBeDefined();
    expect(ordersTags).toContain('Orders');
  });

  it('should document response types with @ApiResponse from core', () => {
    const userSchema = type({
      id: 'string',
      name: 'string',
      email: 'string.email',
    });

    @Controller('/users')
    class UserController extends BaseController {
      @ApiResponse(200, { schema: userSchema, description: 'User found' })
      @ApiResponse(404, { description: 'User not found' })
      @Get('/:id')
      async getUser(@Param('id') id: string): Promise<Response> {
        return this.success({ id, name: 'Test', email: 'test@test.com' });
      }
    }

    expect(UserController).toBeDefined();
  });
});
