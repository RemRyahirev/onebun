/**
 * Documentation Examples Tests for @onebun/core validation
 *
 * Every test here pins a recipe printed in docs/api/validation.md: what the prose promises
 * the reader will happen, not merely that the symbols exist.
 *
 * @source docs:api/validation.md
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

// Through the public specifier, as the page tells the reader to import them: a *value* that
// falls out of the barrel must break these tests, not silently keep working via a deep path.
// The `ValidationSchema` alias is the exception — `import type` is erased before bun runs the
// file, so renaming or dropping the alias is caught by `bun run typecheck`, never by this suite.
import type { ValidationSchema } from '@onebun/core';
import {
  ApiResponse,
  BaseController,
  Controller,
  Get,
  getJsonSchema,
  HttpException,
  Module,
  OneBunApplication,
  Param,
  toJsonSchema,
  type,
  validate,
} from '@onebun/core';

// `@onebun/core/testing` is the documented specifier, but it does not resolve from inside the
// core package itself (no self-link in node_modules), so core's own tests use the barrel path.
import { makeMockLoggerLayer } from '../testing';

describe('Validation docs examples (docs/api/validation.md)', () => {
  describe('ValidationSchema alias', () => {
    // The fence introducing `ValidationSchema` sits above the first `##` heading, so no
    // `@source` anchor can ever credit it — the promise is still worth pinning.
    it('should validate through a helper whose schema parameter is declared as ValidationSchema', () => {
      // From docs: import { type, type ValidationSchema } from '@onebun/core';
      // Only the accept/reject behaviour below is checked at runtime; that a plain ArkType
      // schema is assignable to the alias is a compile-time claim, gated by `bun run typecheck`.
      const acceptsSchema = (schema: ValidationSchema, input: unknown): boolean =>
        validate(schema, input).success;

      const userSchema = type({ name: 'string' });

      expect(acceptsSchema(userSchema, { name: 'Ada' })).toBe(true);
      expect(acceptsSchema(userSchema, { name: 7 })).toBe(false);
    });
  });

  describe('Schema Types', () => {
    /**
     * @source docs:api/validation.md#unions-and-intersections
     */
    it('should accept either branch of a union and reject anything outside it', () => {
      // From docs: type('string | number'), type('"active" | "inactive"'), ...
      const scalar = type('string | number');
      const status = type('"active" | "inactive"');
      const role = type('"admin" | "user" | "guest"');

      expect(validate(scalar, 'hello')).toEqual({ success: true, data: 'hello' });
      expect(validate(scalar, 42)).toEqual({ success: true, data: 42 });
      expect(validate(scalar, true).success).toBe(false);

      expect(validate(status, 'active').data).toBe('active');
      expect(validate(status, 'archived').success).toBe(false);

      expect(validate(role, 'guest').data).toBe('guest');
      expect(validate(role, 'root').success).toBe(false);
    });

    /**
     * @source docs:api/validation.md#unions-and-intersections
     */
    it('should require both operands after .and() combines two object schemas', () => {
      // From docs: baseSchema.and(extendedSchema) // { id: string; name: string }
      const baseSchema = type({ id: 'string' });
      const extendedSchema = type({ name: 'string' });
      const combined = baseSchema.and(extendedSchema);

      expect(validate(combined, { id: 'u1', name: 'Ada' })).toEqual({
        success: true,
        data: { id: 'u1', name: 'Ada' },
      });

      // The right-hand operand is genuinely part of the type, not documentation.
      const missingName = validate(combined, { id: 'u1' });
      expect(missingName.success).toBe(false);
      expect(missingName.errors?.[0]).toContain('name');

      const missingId = validate(combined, { name: 'Ada' });
      expect(missingId.success).toBe(false);
      expect(missingId.errors?.[0]).toContain('id');
    });

    /**
     * @source docs:api/validation.md#literals
     */
    it('should pin a literal schema to exactly that one value', () => {
      // From docs: type('42'), type('"hello"'), type('true'), type('"red" | "green" | "blue"')
      expect(validate(type('42'), 42).data).toBe(42);
      expect(validate(type('42'), 43).success).toBe(false);

      expect(validate(type('"hello"'), 'hello').data).toBe('hello');
      expect(validate(type('"hello"'), 'Hello').success).toBe(false);

      expect(validate(type('true'), true).data).toBe(true);
      expect(validate(type('true'), false).success).toBe(false);

      const colour = type('"red" | "green" | "blue"');
      expect(validate(colour, 'green').data).toBe('green');
      expect(validate(colour, 'purple').success).toBe(false);
    });

    /**
     * @source docs:api/validation.md#tuples
     */
    it('should validate a tuple positionally and reject the wrong length', () => {
      // From docs: type(['string', 'number']) // [string, number]
      const pair = type(['string', 'number']);
      const triple = type(['string', 'number', 'boolean']);

      expect(validate(pair, ['a', 1])).toEqual({ success: true, data: ['a', 1] });
      expect(validate(pair, [1, 'a']).success).toBe(false);
      expect(validate(pair, ['a', 1, true]).success).toBe(false);
      expect(validate(pair, ['a']).success).toBe(false);

      expect(validate(triple, ['a', 1, true]).data).toEqual(['a', 1, true]);
      expect(validate(triple, ['a', 1]).success).toBe(false);
    });
  });

  describe('Validation Functions', () => {
    /**
     * @source docs:api/validation.md#validate
     */
    it('should return the parsed data on success and name every failed field on failure', () => {
      // From docs: const result = validate(schema, { name: 'John', age: 30 });
      const schema = type({
        name: 'string',
        age: 'number > 0',
      });

      const ok = validate(schema, { name: 'John', age: 30 });
      expect(ok.success).toBe(true);
      expect(ok.data).toEqual({ name: 'John', age: 30 });
      // The documented result type carries data XOR errors — never both.
      expect(ok.errors).toBeUndefined();

      const failed = validate(schema, { name: 'John', age: -1 });
      expect(failed.success).toBe(false);
      expect(failed.data).toBeUndefined();
      // The strings report the field that actually failed — not a generic "invalid input",
      // and not the field that validated cleanly. How they are chunked across the array is
      // an implementation detail, so the whole `string[]` is read as one text.
      expect(failed.errors?.join('\n')).toContain('age');
      expect(failed.errors?.join('\n')).not.toContain('name');

      // Two broken fields are both reported, not just the first one found.
      const bothBroken = validate(schema, { name: 42, age: -1 });
      expect(bothBroken.errors?.join('\n')).toContain('age');
      expect(bothBroken.errors?.join('\n')).toContain('name');
    });
  });

  describe('Common Schema Patterns', () => {
    /**
     * @source docs:api/validation.md#response-validation
     */
    it('should validate the handler result against the @ApiResponse schema before replying', async () => {
      // From docs: @ApiResponse(200, { schema: userResponseSchema, description: 'User found' })
      const userResponseSchema = type({
        id: 'string.uuid',
        name: 'string',
        email: 'string.email',
        createdAt: 'string.date.iso',
      });

      const validUser = {
        id: '2ab3d1f2-9c4a-4c0e-9d3a-5f2f8b1c7e10',
        name: 'Ada',
        email: 'ada@example.com',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      @Controller('/users')
      class UserController extends BaseController {
        @Get('/:id')
        @ApiResponse(200, {
          schema: userResponseSchema,
          description: 'User found',
        })
        @ApiResponse(404, {
          description: 'User not found',
        })
        async findOne(@Param('id') id: string) {
          if (id === 'valid') {
            return validUser;
          }

          if (id === 'broken') {
            // Same shape, but `email` no longer satisfies the declared response schema.
            return { ...validUser, email: 'not-an-email' };
          }

          throw new HttpException(404, 'User not found');
        }
      }

      @Module({ controllers: [UserController] })
      class UserModule {}

      const app = new OneBunApplication(UserModule, {
        port: 0,
        metrics: { enabled: false },
        gracefulShutdown: false,
        loggerLayer: makeMockLoggerLayer(),
      });
      await app.start();

      try {
        const base = `http://localhost:${app.getPort()}/users`;

        const found = await fetch(`${base}/valid`);
        expect(found.status).toBe(200);
        expect(await found.json()).toEqual({ success: true, result: validUser });

        // The schema is enforced, not merely documented: a payload that violates it is
        // rejected instead of being handed to the client as a 200.
        const broken = await fetch(`${base}/broken`);
        expect(broken.status).toBe(500);
        // The violation is a server-side contract bug and its detail quotes the offending
        // response value, so it goes to the log rather than to the client — the default
        // filter answers an unhandled error with a fixed string.
        expect(await broken.json()).toMatchObject({
          success: false,
          error: 'Internal Server Error',
        });

        const missing = await fetch(`${base}/nobody`);
        expect(missing.status).toBe(404);
        expect(await missing.text()).toContain('User not found');
      } finally {
        await app.stop();
      }
    });

    /**
     * @source docs:api/validation.md#complex-nested-schema
     */
    it('should enforce every level of a deeply nested request schema', () => {
      // From docs: apiRequestSchema with auth / meta / payload branches
      /* eslint-disable @typescript-eslint/naming-convention */
      const apiRequestSchema = type({
        auth: {
          token: 'string',
          'refreshToken?': 'string',
        },
        meta: {
          requestId: 'string.uuid',
          timestamp: 'string.date.iso',
          'source?': '"web" | "mobile" | "api"',
        },
        payload: {
          action: '"create" | "update" | "delete"',
          resource: 'string',
          data: {},
        },
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      const request = {
        auth: { token: 't-1' },
        meta: {
          requestId: '2ab3d1f2-9c4a-4c0e-9d3a-5f2f8b1c7e10',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        payload: {
          action: 'create',
          resource: 'orders',
          data: { anything: [1, 2, 3] },
        },
      };

      // Optional branches (`refreshToken`, `source`) may be absent.
      expect(validate(apiRequestSchema, request).success).toBe(true);
      expect(validate(apiRequestSchema, {
        ...request,
        auth: { token: 't-1', refreshToken: 'r-1' },
        meta: { ...request.meta, source: 'mobile' },
      }).success).toBe(true);

      const badRequestId = validate(apiRequestSchema, {
        ...request,
        meta: { ...request.meta, requestId: 'not-a-uuid' },
      });
      expect(badRequestId.success).toBe(false);
      expect(badRequestId.errors?.[0]).toContain('requestId');

      const badSource = validate(apiRequestSchema, {
        ...request,
        meta: { ...request.meta, source: 'fax' },
      });
      expect(badSource.success).toBe(false);
      expect(badSource.errors?.[0]).toContain('source');

      const badAction = validate(apiRequestSchema, {
        ...request,
        payload: { ...request.payload, action: 'purge' },
      });
      expect(badAction.success).toBe(false);
      expect(badAction.errors?.[0]).toContain('action');

      // `data: {}` means "any object" — not "any value".
      expect(validate(apiRequestSchema, {
        ...request,
        payload: { ...request.payload, data: 'a string' },
      }).success).toBe(false);
    });
  });

  describe('JSON Schema Conversion', () => {
    /**
     * @source docs:api/validation.md#json-schema-conversion
     */
    it('should convert an ArkType schema into the JSON Schema the page prints', () => {
      // From docs: toJsonSchema(userSchema) / getJsonSchema(userSchema) with the documented result
      const userSchema = type({
        name: 'string',
        age: 'number > 0',
      });

      const jsonSchema = toJsonSchema(userSchema);

      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toEqual({
        name: { type: 'string' },
        age: { type: 'number', exclusiveMinimum: 0 },
      });
      // Both keys are required. The page prints them as ['name', 'age']; ArkType emits them
      // sorted, so the order in the doc comment is illustrative and is not asserted.
      expect([...(jsonSchema.required as string[])].sort()).toEqual(['age', 'name']);

      // The lenient twin produces the same document when nothing had to be degraded.
      expect(getJsonSchema(userSchema)).toEqual(jsonSchema);
    });
  });

  describe('Best Practices', () => {
    /**
     * @source docs:api/validation.md#1-define-schemas-in-separate-files
     */
    it('should make create-schema fields required and update-schema fields optional', () => {
      // From docs: schemas/user.schema.ts — createUserSchema / updateUserSchema
      const createUserSchema = type({
        name: 'string',
        email: 'string.email',
      });

      /* eslint-disable @typescript-eslint/naming-convention */
      const updateUserSchema = type({
        'name?': 'string',
        'email?': 'string.email',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      expect(validate(createUserSchema, { name: 'Ada', email: 'ada@example.com' }).data)
        .toEqual({ name: 'Ada', email: 'ada@example.com' });

      const incomplete = validate(createUserSchema, { name: 'Ada' });
      expect(incomplete.success).toBe(false);
      expect(incomplete.errors?.[0]).toContain('email');

      expect(validate(updateUserSchema, {})).toEqual({ success: true, data: {} });
      expect(validate(updateUserSchema, { name: 'Ada' }).data).toEqual({ name: 'Ada' });
      // Optional does not mean unvalidated.
      expect(validate(updateUserSchema, { email: 'nope' }).success).toBe(false);
    });

    /**
     * @source docs:api/validation.md#2-reuse-schema-components
     */
    it('should apply the shared address rules identically in every schema that embeds it', () => {
      // From docs: addressSchema reused by userSchema and companySchema
      const addressSchema = type({
        street: 'string',
        city: 'string',
        country: 'string',
      });

      const userSchema = type({
        name: 'string',
        email: 'string.email',
        address: addressSchema,
      });

      const companySchema = type({
        name: 'string',
        address: addressSchema,
      });

      const address = { street: '1 Main St', city: 'Berlin', country: 'DE' };

      expect(validate(userSchema, { name: 'Ada', email: 'ada@example.com', address }).data)
        .toEqual({ name: 'Ada', email: 'ada@example.com', address });
      expect(validate(companySchema, { name: 'ACME', address }).data)
        .toEqual({ name: 'ACME', address });

      const brokenAddress = { street: '1 Main St', city: 42, country: 'DE' };

      const userFailure = validate(userSchema, {
        name: 'Ada',
        email: 'ada@example.com',
        address: brokenAddress,
      });
      const companyFailure = validate(companySchema, { name: 'ACME', address: brokenAddress });

      expect(userFailure.success).toBe(false);
      expect(companyFailure.success).toBe(false);
      expect(userFailure.errors?.[0]).toContain('city');
      expect(companyFailure.errors?.[0]).toContain('city');
    });

    /**
     * @source docs:api/validation.md#3-use-type-inference
     */
    it('should hand back ArkType\'s parsed value, shaped exactly like typeof schema.infer', () => {
      // From docs: type User = typeof schema.infer; function processUser(user: User) {}
      // The inferred type itself is a compile-time claim (`bun run typecheck` is its gate).
      // What IS observable here is the claim underneath it: `validate` returns ArkType's parsed
      // output, not the input it was handed. The undeclared-key policy from the Objects section
      // ('+': 'delete') makes the two differ, so an echo of the input is caught.
      /* eslint-disable @typescript-eslint/naming-convention */
      const schema = type({
        name: 'string',
        age: 'number',
        '+': 'delete',
      });
      /* eslint-enable @typescript-eslint/naming-convention */

      type User = typeof schema.infer;

      const processUser = (user: User): string => `${user.name}:${user.age}`;

      const parsed = validate(schema, { name: 'Ada', age: 36, role: 'admin' });
      // `role` is not part of the inferred type, and it is not part of what came back either.
      expect(parsed.data).toEqual({ name: 'Ada', age: 36 });

      if (parsed.data === undefined) {
        throw new Error(`schema rejected valid input: ${parsed.errors?.join(', ')}`);
      }

      // The page's recipe verbatim: no cast on the way into a function typed by the inferred type.
      // Deliberately not wrapped in `expect()` — once the deep-equal above holds there is no runtime
      // outcome left for it to have. It stands as the compile-time witness `bun run typecheck` gates.
      processUser(parsed.data);
    });
  });
});
