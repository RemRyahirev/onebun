/**
 * Unit tests for OpenAPI generator — file upload parameter generation (lines 133–172)
 *
 * Covers multipart/form-data schema generation for:
 *   - @UploadedFile (single file)
 *   - @UploadedFiles (multiple files)
 *   - @FormField (plain text field in multipart body)
 *   - Mixed combinations of the above
 *   - Required vs optional parameters
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import {
  BaseController,
  Controller,
  FormField,
  Post,
  UploadedFile,
  UploadedFiles,
} from '@onebun/core';

import { generateOpenApiSpec } from '../src/openapi/generator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the POST operation for the first (and only) path in a spec. */
function getFirstPost(controllers: Function[]) {
  const spec = generateOpenApiSpec(controllers, { title: 'Test', version: '1.0.0' });
  const paths = Object.keys(spec.paths);
  expect(paths.length).toBeGreaterThan(0);
  const op = spec.paths[paths[0]]?.post;
  expect(op).toBeDefined();

  return op!;
}

// ---------------------------------------------------------------------------
// @UploadedFile — single file
// ---------------------------------------------------------------------------

describe('generateOpenApiSpec — file upload parameters', () => {
  describe('@UploadedFile (single file)', () => {
    it('should produce multipart/form-data requestBody with binary string schema', () => {
      @Controller('/upload')
      class SingleFileController extends BaseController {
        @Post('/avatar')
        async uploadAvatar(
          @UploadedFile('avatar') _file: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([SingleFileController]);
      const requestBody = op.requestBody;

      expect(requestBody).toBeDefined();
      expect(requestBody!.content['multipart/form-data']).toBeDefined();

      const schema = requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;
      expect(schema.type).toBe('object');

      const properties = schema.properties as Record<string, Record<string, unknown>>;
      expect(properties).toBeDefined();
      expect(properties['avatar']).toBeDefined();
      expect(properties['avatar'].type).toBe('string');
      expect(properties['avatar'].format).toBe('binary');
    });

    it('should mark single required file in schema required array', () => {
      @Controller('/upload')
      class RequiredFileController extends BaseController {
        @Post('/doc')
        async upload(
          @UploadedFile('document') _file: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([RequiredFileController]);
      const schema = op.requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;

      // UploadedFile is required by default
      expect(schema.required).toBeDefined();
      expect(schema.required as string[]).toContain('document');
      expect(op.requestBody!.required).toBe(true);
    });

    it('should not list optional file in required array', () => {
      @Controller('/upload')
      class OptionalFileController extends BaseController {
        @Post('/avatar')
        async upload(
          @UploadedFile('avatar', { required: false }) _file: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([OptionalFileController]);
      const schema = op.requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;

      // required array should be absent or empty
      const required = schema.required as string[] | undefined;
      expect(required === undefined || !required.includes('avatar')).toBe(true);
      expect(op.requestBody!.required).toBe(false);
    });

    it('should fall back to "file" when no field name is given', () => {
      @Controller('/upload')
      class NoNameFileController extends BaseController {
        @Post('/item')
        async upload(
          @UploadedFile() _file: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([NoNameFileController]);
      const properties = op.requestBody!.content['multipart/form-data']!.schema.properties as Record<string, Record<string, unknown>>;
      expect(properties['file']).toBeDefined();
      expect(properties['file'].type).toBe('string');
      expect(properties['file'].format).toBe('binary');
    });
  });

  // ---------------------------------------------------------------------------
  // @UploadedFiles — multiple files
  // ---------------------------------------------------------------------------

  describe('@UploadedFiles (multiple files)', () => {
    it('should produce array of binary items in schema', () => {
      @Controller('/upload')
      class MultiFileController extends BaseController {
        @Post('/docs')
        async upload(
          @UploadedFiles('documents') _files: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([MultiFileController]);
      const properties = op.requestBody!.content['multipart/form-data']!.schema.properties as Record<string, Record<string, unknown>>;

      expect(properties['documents']).toBeDefined();
      expect(properties['documents'].type).toBe('array');

      const items = properties['documents'].items as Record<string, unknown>;
      expect(items.type).toBe('string');
      expect(items.format).toBe('binary');
    });

    it('should mark required files array in required list', () => {
      @Controller('/upload')
      class RequiredMultiController extends BaseController {
        @Post('/images')
        async upload(
          @UploadedFiles('images') _files: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([RequiredMultiController]);
      const schema = op.requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;

      // UploadedFiles is required by default
      expect((schema.required as string[])).toContain('images');
      expect(op.requestBody!.required).toBe(true);
    });

    it('should fall back to "file" field name when no name given', () => {
      @Controller('/upload')
      class AllFilesController extends BaseController {
        @Post('/batch')
        async upload(
          @UploadedFiles() _files: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([AllFilesController]);
      const properties = op.requestBody!.content['multipart/form-data']!.schema.properties as Record<string, Record<string, unknown>>;

      // No explicit field name → falls back to 'file'
      expect(properties['file']).toBeDefined();
      expect(properties['file'].type).toBe('array');
    });
  });

  // ---------------------------------------------------------------------------
  // @FormField — plain text field
  // ---------------------------------------------------------------------------

  describe('@FormField (text field)', () => {
    it('should produce string schema for form field', () => {
      @Controller('/upload')
      class FormFieldController extends BaseController {
        @Post('/profile')
        async upload(
          @UploadedFile('avatar') _avatar: unknown,
          @FormField('username') _username: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([FormFieldController]);
      const properties = op.requestBody!.content['multipart/form-data']!.schema.properties as Record<string, Record<string, unknown>>;

      expect(properties['username']).toBeDefined();
      expect(properties['username'].type).toBe('string');
      // form fields should not have 'format: binary'
      expect(properties['username'].format).toBeUndefined();
    });

    it('should not include optional FormField in required array', () => {
      @Controller('/upload')
      class OptionalFieldController extends BaseController {
        @Post('/submit')
        async upload(
          @UploadedFile('doc') _doc: unknown,
          @FormField('note') _note: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([OptionalFieldController]);
      const schema = op.requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;
      const required = schema.required as string[] | undefined;

      // 'note' is optional by default for FormField
      expect(required === undefined || !required.includes('note')).toBe(true);
    });

    it('should include required FormField in required array', () => {
      @Controller('/upload')
      class RequiredFieldController extends BaseController {
        @Post('/submit')
        async upload(
          @UploadedFile('doc') _doc: unknown,
          @FormField('title', { required: true }) _title: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([RequiredFieldController]);
      const schema = op.requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;

      expect((schema.required as string[])).toContain('title');
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed: file + files + formField in one endpoint
  // ---------------------------------------------------------------------------

  describe('mixed file upload parameters', () => {
    it('should combine file, files, and formField in single schema', () => {
      @Controller('/upload')
      class MixedController extends BaseController {
        @Post('/submit')
        async upload(
          @UploadedFile('avatar') _avatar: unknown,
          @UploadedFiles('attachments') _attachments: unknown,
          @FormField('description') _desc: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([MixedController]);
      const requestBody = op.requestBody!;
      expect(requestBody.content['multipart/form-data']).toBeDefined();

      const properties = requestBody.content['multipart/form-data']!.schema.properties as Record<string, Record<string, unknown>>;

      // single file
      expect(properties['avatar'].type).toBe('string');
      expect(properties['avatar'].format).toBe('binary');

      // multiple files
      expect(properties['attachments'].type).toBe('array');

      // text field
      expect(properties['description'].type).toBe('string');
      expect(properties['description'].format).toBeUndefined();
    });

    it('should set required=true on requestBody when at least one param is required', () => {
      @Controller('/upload')
      class SomeRequiredController extends BaseController {
        @Post('/submit')
        async upload(
          @UploadedFile('avatar') _avatar: unknown,
          @FormField('note') _note: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([SomeRequiredController]);
      expect(op.requestBody!.required).toBe(true);
    });

    it('should set required=false on requestBody when all params are optional', () => {
      @Controller('/upload')
      class AllOptionalController extends BaseController {
        @Post('/submit')
        async upload(
          @UploadedFile('avatar', { required: false }) _avatar: unknown,
          @FormField('note') _note: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([AllOptionalController]);
      // avatar is optional, note is optional by default → no required fields → requestBody.required = false
      expect(op.requestBody!.required).toBe(false);
    });

    it('should omit schema.required when no params are required', () => {
      @Controller('/upload')
      class NoneRequiredController extends BaseController {
        @Post('/submit')
        async upload(
          @UploadedFile('doc', { required: false }) _doc: unknown,
          @UploadedFiles('images', { required: false }) _images: unknown,
          @FormField('comment') _comment: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([NoneRequiredController]);
      const schema = op.requestBody!.content['multipart/form-data']!.schema as Record<string, unknown>;

      // The generator only adds `required` key when the array is non-empty
      const required = schema.required as string[] | undefined;
      expect(required === undefined || (required as string[]).length === 0).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Ensure file params do NOT add to operation.parameters list
  // ---------------------------------------------------------------------------

  describe('parameters list isolation', () => {
    it('should not add file params to operation.parameters', () => {
      @Controller('/upload')
      class NoExtraParamsController extends BaseController {
        @Post('/avatar')
        async upload(
          @UploadedFile('avatar') _file: unknown,
          @FormField('name') _name: unknown,
        ): Promise<Response> {
          return this.success({});
        }
      }

      const op = getFirstPost([NoExtraParamsController]);
      // file / formField params should appear only in requestBody, not in parameters array
      const params = op.parameters ?? [];
      const paramNames = params.map((p) => p.name);
      expect(paramNames).not.toContain('avatar');
      expect(paramNames).not.toContain('name');
    });
  });
});
