/**
 * Section coverage for docs/api/docs.md.
 *
 * Every test here pins a promise the page makes in prose: the defaults the framework applies
 * when no `docs` option is given, the effect of each `DocsApplicationOptions` field on the
 * served specification, and what `@ApiTags`, `@ApiOperation` and `@ApiResponse` actually put
 * into the generated OpenAPI document.
 *
 * Imports go through the public specifiers (`@onebun/core`, `@onebun/docs`) exactly as the page
 * tells the reader to, so a missing barrel export fails here rather than in a user's project.
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import type { DocsApplicationOptions } from '@onebun/core';
import {
  ApiResponse,
  BaseController,
  Body,
  Controller,
  Get,
  Module,
  OneBunApplication,
  Param,
  Post,
  type,
} from '@onebun/core';
import { makeMockLoggerLayer } from '@onebun/core/testing';
import {
  ApiOperation,
  ApiTags,
  generateOpenApiSpec,
} from '@onebun/docs';

// ---------------------------------------------------------------------------
// Shape of the specification as it comes back over HTTP (JSON, not the generator's type):
// the served document carries `contact`, `license`, `servers` and `externalDocs`, which the
// generator's own `OpenApiSpec` interface does not model.
// ---------------------------------------------------------------------------

interface ServedOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  responses?: Record<string, { description: string }>;
}

interface ServedSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    contact?: { name?: string; email?: string; url?: string };
    license?: { name: string; url?: string };
  };
  servers?: Array<{ url: string; description?: string }>;
  externalDocs?: { description?: string; url: string };
  paths: Record<string, Record<string, ServedOperation>>;
}

interface JsonSchemaObject {
  type?: string;
  format?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
}

// ---------------------------------------------------------------------------
// Fixtures for the running application
// ---------------------------------------------------------------------------

const catalogItemSchema = type({
  id: 'string',
  name: 'string',
});

@ApiTags('Catalog')
@Controller('/catalog')
class CatalogController extends BaseController {
  @ApiOperation({ summary: 'List catalog items' })
  @Get('/items')
  @ApiResponse(200, { schema: catalogItemSchema.array(), description: 'Items listed' })
  listItems() {
    return [{ id: '1', name: 'Widget' }];
  }
}

@Module({ controllers: [CatalogController] })
class CatalogModule {}

let app: OneBunApplication | null = null;

async function startApp(docs?: DocsApplicationOptions, name?: string): Promise<number> {
  app = new OneBunApplication(CatalogModule, {
    port: 0,
    name,
    metrics: { enabled: false },
    gracefulShutdown: false,
    docs,
    loggerLayer: makeMockLoggerLayer(),
  });
  await app.start();

  return app.getPort();
}

afterEach(async () => {
  if (app) {
    await app.stop();
    app = null;
  }
});

describe('docs/api/docs.md — automatic documentation endpoints', () => {
  /**
   * @source docs:api/docs.md#quick-reference-for-ai
   */
  it('serves Swagger UI at /docs and the OpenAPI spec at /openapi.json with no configuration', async () => {
    const port = await startApp();

    const specResponse = await fetch(`http://localhost:${port}/openapi.json`);
    expect(specResponse.status).toBe(200);
    expect(specResponse.headers.get('content-type')).toBe('application/json');

    const spec = await specResponse.json() as ServedSpec;
    expect(spec.openapi).toBe('3.1.0');
    // Defaults documented in DocsApplicationOptions: title 'OneBun API', version '1.0.0'.
    expect(spec.info.title).toBe('OneBun API');
    expect(spec.info.version).toBe('1.0.0');
    // The controller's route reached the spec without any registration call.
    expect(spec.paths['/catalog/items']?.get?.summary).toBe('List catalog items');

    const uiResponse = await fetch(`http://localhost:${port}/docs`);
    expect(uiResponse.status).toBe(200);
    expect(uiResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');

    const html = await uiResponse.text();
    expect(html).toContain('<div id="swagger-ui"></div>');
    // The UI must point at the JSON path the application actually serves.
    expect(html).toContain('url: "/openapi.json"');
  });

  /**
   * @source docs:api/docs.md#quick-reference-for-ai
   */
  it('defaults the spec title to the application name when no docs title is given', async () => {
    const port = await startApp(undefined, 'Billing Service');

    const spec = await (await fetch(`http://localhost:${port}/openapi.json`)).json() as ServedSpec;
    expect(spec.info.title).toBe('Billing Service');
  });

  /**
   * @source docs:api/docs.md#quick-reference-for-ai
   */
  it('moves the endpoints and fills the spec info from DocsApplicationOptions', async () => {
    const port = await startApp({
      path: '/api-docs',
      jsonPath: '/spec.json',
      title: 'My API',
      version: '2.0.0',
      description: 'My awesome OneBun API',
      contact: {
        name: 'API Support',
        email: 'support@example.com',
        url: 'https://example.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      externalDocs: {
        description: 'Handbook',
        url: 'https://example.com/handbook',
      },
      servers: [
        { url: 'https://api.example.com', description: 'Production' },
        { url: 'http://localhost:3000', description: 'Development' },
      ],
    });

    const specResponse = await fetch(`http://localhost:${port}/spec.json`);
    expect(specResponse.status).toBe(200);

    const spec = await specResponse.json() as ServedSpec;
    expect(spec.info.title).toBe('My API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBe('My awesome OneBun API');
    expect(spec.info.contact).toEqual({
      name: 'API Support',
      email: 'support@example.com',
      url: 'https://example.com',
    });
    expect(spec.info.license).toEqual({ name: 'MIT', url: 'https://opensource.org/licenses/MIT' });
    expect(spec.externalDocs).toEqual({ description: 'Handbook', url: 'https://example.com/handbook' });
    expect(spec.servers).toEqual([
      { url: 'https://api.example.com', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Development' },
    ]);

    const uiResponse = await fetch(`http://localhost:${port}/api-docs`);
    expect(uiResponse.status).toBe(200);
    expect(await uiResponse.text()).toContain('url: "/spec.json"');

    // The defaults are vacated, not merely shadowed.
    expect((await fetch(`http://localhost:${port}/openapi.json`)).status).toBe(404);
    expect((await fetch(`http://localhost:${port}/docs`)).status).toBe(404);
  });

  /**
   * @source docs:api/docs.md#quick-reference-for-ai
   */
  it('serves neither endpoint when docs are explicitly disabled, while routes keep working', async () => {
    const port = await startApp({ enabled: false });

    expect((await fetch(`http://localhost:${port}/openapi.json`)).status).toBe(404);
    expect((await fetch(`http://localhost:${port}/docs`)).status).toBe(404);

    const routeResponse = await fetch(`http://localhost:${port}/catalog/items`);
    expect(routeResponse.status).toBe(200);
    expect(await routeResponse.json()).toEqual({
      success: true,
      result: [{ id: '1', name: 'Widget' }],
    });
  });
});

describe('docs/api/docs.md — documentation decorators', () => {
  /**
   * @source docs:api/docs.md#apitags
   */
  it('tags every operation of the controller with the class-level @ApiTags values', () => {
    @ApiTags('Users', 'User Management')
    @Controller('/users')
    class TaggedUserController extends BaseController {
      @Get('/')
      async findAll() {
        return [];
      }

      @Get('/:id')
      async findOne(@Param('id') id: string) {
        return { id };
      }
    }

    const spec = generateOpenApiSpec([TaggedUserController], { title: 'Test API', version: '1.0.0' });

    expect(spec.paths['/users']?.get?.tags).toEqual(['Users', 'User Management']);
    expect(spec.paths['/users/{id}']?.get?.tags).toEqual(['Users', 'User Management']);
  });

  /**
   * @source docs:api/docs.md#apitags
   */
  it('adds a method-level @ApiTags on top of the controller tags for that route only', () => {
    @ApiTags('Users')
    @Controller('/mixed-users')
    class MixedTagsController extends BaseController {
      @Get('/')
      async findAll() {
        return [];
      }

      @ApiTags('Admin')
      @Get('/admins')
      async getAdmins() {
        return [];
      }
    }

    const spec = generateOpenApiSpec([MixedTagsController], { title: 'Test API', version: '1.0.0' });

    expect(spec.paths['/mixed-users/admins']?.get?.tags).toEqual(['Users', 'Admin']);
    // The sibling route must not pick up the method-level tag.
    expect(spec.paths['/mixed-users']?.get?.tags).toEqual(['Users']);
  });

  /**
   * @source docs:api/docs.md#apioperation
   */
  it('writes summary, description and tags of @ApiOperation into the operation', () => {
    @Controller('/described-users')
    class DescribedUserController extends BaseController {
      @ApiOperation({
        summary: 'Get user by ID',
        description: 'Returns a single user by their unique identifier. Returns 404 if not found.',
        tags: ['Users'],
      })
      @Get('/:id')
      async getUser(@Param('id') id: string) {
        return { id, name: 'John' };
      }
    }

    const spec = generateOpenApiSpec([DescribedUserController], { title: 'Test API', version: '1.0.0' });
    const operation = spec.paths['/described-users/{id}']?.get;

    expect(operation?.summary).toBe('Get user by ID');
    expect(operation?.description).toBe(
      'Returns a single user by their unique identifier. Returns 404 if not found.',
    );
    expect(operation?.tags).toEqual(['Users']);
    // The route parameter travels with the operation, in OpenAPI's `{id}` spelling.
    expect(operation?.parameters).toEqual([{ name: 'id', in: 'path', required: true }]);
  });

  /**
   * @source docs:api/docs.md#apiresponse
   */
  it('documents each @ApiResponse status with its description and converted schema', () => {
    const userSchema = type({
      id: 'string',
      name: 'string',
      email: 'string.email',
    });

    @Controller('/responding-users')
    class RespondingUserController extends BaseController {
      @Get('/:id')
      @ApiResponse(200, {
        schema: userSchema,
        description: 'User found successfully',
      })
      @ApiResponse(404, {
        description: 'User not found',
      })
      async getUser(@Param('id') id: string) {
        return { id, name: 'John', email: 'john@example.com' };
      }
    }

    const spec = generateOpenApiSpec([RespondingUserController], { title: 'Test API', version: '1.0.0' });
    const responses = spec.paths['/responding-users/{id}']?.get?.responses;

    expect(responses?.['200']?.description).toBe('User found successfully');
    expect(responses?.['404']?.description).toBe('User not found');
    // A response declared without a schema carries no body definition.
    expect(responses?.['404']?.content).toBeUndefined();

    const schema = responses?.['200']?.content?.['application/json']?.schema as JsonSchemaObject;
    expect(schema.type).toBe('object');
    expect(schema.properties?.id?.type).toBe('string');
    expect(schema.properties?.name?.type).toBe('string');
    // `string.email` survives the ArkType → JSON Schema conversion as a formatted string.
    expect(schema.properties?.email).toMatchObject({ type: 'string', format: 'email' });
    expect(schema.required?.slice().sort()).toEqual(['email', 'id', 'name']);
  });

  /**
   * The page calls @ApiResponse schemas "for documentation and validation" — the second half
   * is live: the declared status code is applied to the response, and a handler result that
   * does not match the schema never reaches the client.
   *
   * @source docs:api/docs.md#apiresponse
   */
  it('validates the handler result against the declared @ApiResponse schema', async () => {
    const createdSchema = type({ name: 'string' });

    @Controller('/documented')
    class DocumentedController extends BaseController {
      @Post('/matching')
      @ApiResponse(201, { schema: createdSchema, description: 'Created' })
      async matching(@Body(createdSchema) body: typeof createdSchema.infer) {
        return { name: body.name };
      }

      @Post('/violating')
      @ApiResponse(201, { schema: createdSchema, description: 'Created' })
      async violating() {
        return { unexpected: 'field' };
      }
    }

    @Module({ controllers: [DocumentedController] })
    class DocumentedModule {}

    app = new OneBunApplication(DocumentedModule, {
      port: 0,
      metrics: { enabled: false },
      gracefulShutdown: false,
      loggerLayer: makeMockLoggerLayer(),
    });
    await app.start();
    const port = app.getPort();

    const post = async (path: string): Promise<Response> => await fetch(`http://localhost:${port}${path}`, {
      method: 'POST',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget' }),
    });

    const okResponse = await post('/documented/matching');
    expect(okResponse.status).toBe(201);
    expect(await okResponse.json()).toEqual({ success: true, result: { name: 'Widget' } });

    const badResponse = await post('/documented/violating');
    expect(badResponse.status).toBe(500);

    const spec = await (await fetch(`http://localhost:${port}/openapi.json`)).json() as ServedSpec;
    expect(spec.paths['/documented/matching']?.post?.responses?.['201']?.description).toBe('Created');
  });
});
