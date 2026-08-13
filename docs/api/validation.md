---
description: Schema validation with ArkType. validate(), validateOrThrow(), toJsonSchema(). Built-in schema helpers.
---

# Validation API

Package: `@onebun/core` (uses ArkType)

OneBun uses [ArkType](https://arktype.io/) for runtime type validation and TypeScript type inference.

Для типизации параметров, принимающих схему, используйте тип `ValidationSchema` — это реэкспорт `Type` из ArkType:

```typescript
import { type, type ValidationSchema } from '@onebun/core';
```

## Basic Usage

### Defining Schemas

```typescript
import { type } from '@onebun/core';

// Primitive types
const stringSchema = type('string');
const numberSchema = type('number');
const booleanSchema = type('boolean');

// Object schema
const userSchema = type({
  name: 'string',
  email: 'string.email',
  age: 'number > 0',
});

// Infer TypeScript type from schema
type User = typeof userSchema.infer;
// { name: string; email: string; age: number }
```

### Using in Controllers

Define schemas in a separate file and export named types:

```typescript
// user.schema.ts
import { type } from '@onebun/core';

export const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',  // Optional field
});

export type CreateUserBody = typeof createUserSchema.infer;
// { name: string; email: string; age?: number }
```

```typescript
// user.controller.ts
import { Controller, BaseController, Post, Body } from '@onebun/core';
import { createUserSchema, type CreateUserBody } from './user.schema';

@Controller('/users')
export class UserController extends BaseController {
  @Post('/')
  async create(@Body(createUserSchema) body: CreateUserBody) {
    // body is guaranteed to be valid here
    // body.name: string
    // body.email: string
    // body.age: number | undefined
    return { user: body };
  }
}
```

## Schema Types

### Primitives

```typescript
import { type } from '@onebun/core';

type('string')          // string
type('number')          // number
type('boolean')         // boolean
type('bigint')          // bigint
type('symbol')          // symbol
type('null')            // null
type('undefined')       // undefined
```

### String Constraints

```typescript
// Built-in string formats
type('string.email')        // Valid email
type('string.url')          // Valid URL
type('string.uuid')         // Valid UUID
type('string.date')         // Date string (YYYY-MM-DD)
type('string.date.iso')     // ISO 8601 date or datetime string
type('string.numeric')      // String containing only digits

// Length constraints
type('string > 5')          // Length > 5
type('string >= 5')         // Length >= 5
type('string < 100')        // Length < 100
type('string <= 100')       // Length <= 100
type('5 <= string < 100')   // Length between 5 and 99

// Pattern matching
type('/^[a-z]+$/')          // Regex pattern
type('string.alphanumeric') // Only letters and numbers

// Transformations
type('string.trim')         // Trim whitespace
type('string.lower')        // To lowercase
type('string.upper')        // To uppercase
```

### Number Constraints

```typescript
// Comparisons
type('number > 0')          // Positive numbers
type('number >= 0')         // Non-negative
type('number < 100')        // Less than 100
type('0 < number < 100')    // Range (exclusive)
type('0 <= number <= 100')  // Range (inclusive)

// Integer
type('number.integer')      // Integer only
type('number.integer > 0')  // Positive integer

// Other built-in number keywords
type('number.safe')         // Within Number.MIN_SAFE_INTEGER..MAX_SAFE_INTEGER
type('number.epoch')        // Integer usable as a Date timestamp
type('number.NaN')          // Exactly NaN
type('number.Infinity')     // Exactly Infinity
type('number.NegativeInfinity') // Exactly -Infinity
```

### Arrays

```typescript
// Basic array
type('string[]')            // Array of strings
type('number[]')            // Array of numbers

// Array with constraints
type('string[] > 0')        // Non-empty array
type('string[] <= 10')      // Max 10 items
type('1 <= string[] <= 10') // Between 1 and 10 items

// Complex item types
const userArraySchema = type({
  name: 'string',
  age: 'number',
}).array();
```

### Objects

```typescript
// Required fields
const schema = type({
  name: 'string',
  email: 'string.email',
});

// Optional fields (use '?' suffix)
const schema = type({
  name: 'string',
  'email?': 'string.email',    // Optional
  'age?': 'number > 0',        // Optional
});

// Nested objects
const schema = type({
  user: {
    name: 'string',
    address: {
      street: 'string',
      city: 'string',
    },
  },
});

// Index signatures
const schema = type({
  '[string]': 'string',  // Any string key must map to a string value
});

// Undeclared-key policy: 'reject', 'delete' or 'ignore' (default: 'ignore')
// Keys that are not declared are accepted by default, so '+' only ever tightens an object
const strictSchema = type({
  name: 'string',
  '+': 'reject',  // Error on any key not declared above
});
```

### Unions and Intersections

```typescript
// Union (OR)
type('string | number')              // string or number
type('"active" | "inactive"')        // Literal union
type('"admin" | "user" | "guest"')   // Enum-like

// Intersection (AND)
const baseSchema = type({ id: 'string' });
const extendedSchema = type({ name: 'string' });
const combined = baseSchema.and(extendedSchema);
// { id: string; name: string }
```

### Literals

```typescript
// Literal values
type('42')                  // Exactly 42
type('"hello"')             // Exactly "hello"
type('true')                // Exactly true

// Enum-like
type('"red" | "green" | "blue"')
```

### Tuples

```typescript
// Fixed-length arrays
type(['string', 'number'])           // [string, number]
type(['string', 'number', 'boolean']) // [string, number, boolean]
```

## Validation Functions

### validate()

Validate data against a schema, returning a result object.

```typescript
import { validate, type } from '@onebun/core';

const schema = type({
  name: 'string',
  age: 'number > 0',
});

const result = validate(schema, { name: 'John', age: 30 });

if (result.success) {
  // result.data is typed as { name: string; age: number }
  console.log(result.data.name);
} else {
  // result.errors is string[]
  console.error(result.errors);
}
```

**Return Type:**

```typescript
type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };
```

### validateOrThrow()

Validate data and throw an error if validation fails.

```typescript
import { validateOrThrow, type } from '@onebun/core';

const schema = type({
  name: 'string',
  email: 'string.email',
});

try {
  const data = validateOrThrow(schema, inputData);
  // data is typed as { name: string; email: string }
} catch (error) {
  // error.message: "Validation failed: ..."
  // error.validationErrors: string[]
}
```

## Single ArkType Copy Requirement

**An application must resolve exactly one physical copy of `arktype`.** Two copies are two sets of
classes: a schema built by one copy produces failure objects belonging to that copy, and anything
that identifies them by class identity (`result instanceof type.errors`) silently answers "no
failure". Two copies of the *same version* are enough — version skew is not required.

OneBun no longer fails open on this. `validate()`, `validateOrThrow()` and `@Body` requiredness
identify ArkType failures by ArkType's own brand (the ` arkKind` key `@ark/schema` discriminates
on), which is copy-independent. A duplicate install is still unsupported, though: composing schemas
across copies (`.and`, `.or`, `.array()`) and cross-copy registry references remain broken, so
deduplicate rather than rely on the framework's tolerance.

### Detecting duplicates

`@ark/schema` publishes its registry on `globalThis`: the first copy loaded claims `$ark`, every
further copy claims `$ark2`, `$ark3`, and so on. OneBun uses that as its check, and you can too:

```typescript
import { hasDuplicateArkTypeCopies } from '@onebun/core';

if (hasDuplicateArkTypeCopies()) {
  // more than one physical arktype is loaded in this process
}
```

At the package level, the listing must contain exactly one `arktype` entry:

```bash
bun pm ls --all | grep -E '(^|[^a-z-])arktype@'   # must print exactly one line
```

The pattern is anchored on purpose: a plain `grep arktype` also matches packages whose name merely
ends in `-arktype`. If you use `@onebun/drizzle`, `drizzle-arktype` shows up in the unfiltered
listing — that is expected and is not a second copy of arktype (see
[Why `arktype` is a dependency, not a peer dependency](#why-arktype-is-a-dependency-not-a-peer-dependency)).

### What OneBun does when it finds one

- **One** startup warning, emitted the first time a schema is evaluated at decoration time. It names
  the cause, lists the detected registries, and tells you to deduplicate.
- If validation returns a value that is neither valid data nor a recognisable `ArkErrors` — an
  ArkType internal this version cannot identify — the framework throws `DuplicateArkTypeError`
  instead of handing that object back as the validated payload. Failing closed is deliberate: the
  alternative was HTTP 200 with ArkType error objects as the response body.

```typescript
import { DuplicateArkTypeError, validate } from '@onebun/core';

try {
  validate(schema, input);
} catch (error) {
  if (error instanceof DuplicateArkTypeError) {
    // error.message names the duplicate-arktype cause and the fix
    // error.registries: ['$ark', '$ark2']
  }
}
```

### Fixing a duplicate

Pin a single version at the workspace root and reinstall:

```jsonc
// package.json (bun / yarn)
{
  "resolutions": {
    "arktype": "2.2.0"
  }
}
```

```jsonc
// package.json (npm)
{
  "overrides": {
    "arktype": "2.2.0"
  }
}
```

### Why `arktype` is a dependency, not a peer dependency

`arktype` is a regular `dependencies` entry of `@onebun/core` and stays one. Making it a
`peerDependency` looks like the textbook fix for duplicate copies, but it is the wrong trade here:
`@onebun/drizzle` builds its schemas through `drizzle-arktype`, which already declares `arktype` as
a *peer* and resolves its own. Peer-ifying core would break that path and force every existing
install to add an explicit `arktype` entry, in exchange for a guarantee the package manager still
would not give. The single-copy requirement is enforced by detection and a loud diagnostic instead.

## Common Schema Patterns

### Create/Update DTOs

```typescript
import { type } from '@onebun/core';

// Create DTO - all fields required
const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  password: 'string >= 8',
  role: '"admin" | "user"',
});

// Update DTO - all fields optional
const updateUserSchema = type({
  'name?': 'string',
  'email?': 'string.email',
  'password?': 'string >= 8',
  'role?': '"admin" | "user"',
});

// Export types
export type CreateUserDto = typeof createUserSchema.infer;
export type UpdateUserDto = typeof updateUserSchema.infer;
```

### Pagination

```typescript
const paginationSchema = type({
  'page?': 'number.integer > 0',
  'limit?': 'number.integer > 0',
  'sort?': '"asc" | "desc"',
  'sortBy?': 'string',
});

@Get('/')
async findAll(
  @Query('page') page?: string,
  @Query('limit') limit?: string,
) {
  const pagination = validate(paginationSchema, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });

  if (!pagination.success) {
    throw new HttpException(400, 'Invalid pagination');
  }

  // Use pagination.data
}
```

### API Request Body

```typescript
const createOrderSchema = type({
  customerId: 'string.uuid',
  items: type({
    productId: 'string.uuid',
    quantity: 'number.integer > 0',
    'notes?': 'string',
  }).array().atLeastLength(1),
  'shippingAddress?': {
    street: 'string',
    city: 'string',
    country: 'string',
    'zipCode?': 'string',
  },
  'paymentMethod': '"card" | "paypal" | "bank_transfer"',
});

type CreateOrderBody = typeof createOrderSchema.infer;

@Post('/orders')
async createOrder(@Body(createOrderSchema) body: CreateOrderBody) {
  // body is fully typed and validated
  const order = await this.orderService.create(body);
  return this.success(order, 201);
}
```

### Response Validation

```typescript
import { ApiResponse } from '@onebun/core';

const userResponseSchema = type({
  id: 'string.uuid',
  name: 'string',
  email: 'string.email',
  createdAt: 'string.date.iso',
});

@Controller('/users')
export class UserController extends BaseController {
  @Get('/:id')
  @ApiResponse(200, {
    schema: userResponseSchema,
    description: 'User found',
  })
  @ApiResponse(404, {
    description: 'User not found',
  })
  async findOne(@Param('id') id: string) {
    const user = await this.userService.findById(id);

    if (!user) {
      throw new HttpException(404, 'User not found');
    }

    // Response will be validated against userResponseSchema
    return user;
  }
}
```

### Complex Nested Schema

```typescript
const apiRequestSchema = type({
  // Auth header
  auth: {
    token: 'string',
    'refreshToken?': 'string',
  },

  // Request metadata
  meta: {
    requestId: 'string.uuid',
    timestamp: 'string.date.iso',
    'source?': '"web" | "mobile" | "api"',
  },

  // Actual payload
  payload: {
    action: '"create" | "update" | "delete"',
    resource: 'string',
    data: {},  // Any object
  },
});
```

## Error Messages

ArkType provides detailed error messages:

```typescript
const schema = type({
  name: 'string > 2',
  age: 'number >= 18',
});

const result = schema({ name: 'Jo', age: 16 });

if (result instanceof type.errors) {
  console.log(result.summary);
  // "name must be more than 2 characters (was 2)"
  // "age must be at least 18 (was 16)"
}
```

`instanceof type.errors` compares against the classes of whichever `arktype` copy `type` came from.
It is safe here because both the schema and `type` are imported from `@onebun/core`. If you hold a
schema whose origin you do not control, use `isArkErrors()` instead — it identifies failures by
ArkType's own brand, so it works across copies (see
[Single ArkType Copy Requirement](#single-arktype-copy-requirement)):

```typescript
import { isArkErrors } from '@onebun/core';

if (isArkErrors(result)) {
  // result is an ArkErrors, whichever copy produced it
}
```

## JSON Schema Conversion

Convert ArkType schemas to JSON Schema for OpenAPI/Swagger:

```typescript
import { toJsonSchema, getJsonSchema, type } from '@onebun/core';

const userSchema = type({
  name: 'string',
  age: 'number > 0',
});

// Strict: throws if any part of the type cannot be represented
const jsonSchema = toJsonSchema(userSchema);

// Best-effort: converts as much as possible and marks what it could not
const lenient = getJsonSchema(userSchema);

// Result:
// {
//   type: 'object',
//   properties: {
//     name: { type: 'string' },
//     age: { type: 'number', exclusiveMinimum: 0 },
//   },
//   required: ['name', 'age'],
// }
```

### Types JSON Schema Cannot Express

JSON Schema has no representation for a `Date`, for a `.narrow()` predicate, or for a
`.pipe()` morph — eleven ArkType codes in all. `Date` alone makes this ordinary rather than
exotic.

The two helpers differ only in what they do about it:

| | unrepresentable part |
|---|---|
| `toJsonSchema(schema, options?)` | **throws** ArkType's `ToJsonSchemaError` — you decide |
| `getJsonSchema(schema, options?)` | converts everything else and **marks** the result |

`getJsonSchema` keeps what ArkType did manage to build. A schema of
`{ when: 'Date', name: 'string' }` yields the full object with `name` typed and `when` left
as an empty schema — not a bare `{ type: 'object' }`.

A partial result carries the `x-onebun-partial` key (exported as `JSON_SCHEMA_PARTIAL`)
listing the ArkType codes responsible:

```typescript
import { getJsonSchema, JSON_SCHEMA_PARTIAL, type } from '@onebun/core';

const schema = getJsonSchema(type({ when: 'Date', name: 'string' }));

schema[JSON_SCHEMA_PARTIAL];  // { codes: ['date'] }
```

**Check for that key rather than trusting the shape.** A partial conversion is a
structurally valid JSON Schema, so nothing downstream — an OpenAPI document, a form
generator, a graph validator — can otherwise tell it from a schema for a genuinely
unconstrained value. A schema that converts cleanly carries no marker at all.

Both helpers forward ArkType's own options (`fallback`, `dialect`, `target`). Supplying a
`fallback` gives you the real conversion context, including the partially built schema in
`ctx.base`, and suppresses the marker for the codes you handle:

```typescript
const withDates = getJsonSchema(type({ when: 'Date', name: 'string' }), {
  fallback: { date: () => ({ type: 'string', format: 'date-time' }) },
});
// properties.when is { type: 'string', format: 'date-time' }, and no marker is added
```

<llm-only>

**Technical details for AI agents — JSON Schema conversion:**
- `toJsonSchema` is a pure passthrough to ArkType's `Type.toJsonSchema(options)`; it throws exactly what ArkType throws
- `getJsonSchema` does NOT catch and stub. It passes `fallback: { default: ctx => ctx.base }` INTO the conversion, so ArkType keeps every node it could build and only the unrepresentable one becomes `{}`
- That order is forced, not stylistic: the thrown `ToJsonSchemaError` carries `code` but NOT the partially built schema, so a caught error can only ever produce a stub. The partial schema exists only inside the fallback context
- The fallback context is `{ code, base }`, plus the constraint itself for some codes (e.g. `predicate`)
- A caller's `fallback` takes precedence in both ArkType shapes — an object keyed by code, or a universal function — and the codes it handles are not marked, because the caller has handled them
- The outer `catch` remains reachable only when the per-code mechanism cannot repair the failure, e.g. a caller's fallback that itself throws. It binds the error and reports its `code` in the marker; the previous bare `catch {}` discarded the one value that said what was unrepresentable
- `JSON_SCHEMA_PARTIAL` is `'x-onebun-partial'` — an `x-` prefixed key, so it passes through OpenAPI tooling as a vendor extension rather than being rejected
- `@onebun/docs`'s `arktypeToJsonSchema()` delegates straight to `getJsonSchema`, so the marker reaches the generated OpenAPI document.

</llm-only>

## Best Practices

### 1. Define Schemas in Separate Files

```typescript
// schemas/user.schema.ts
import { type } from '@onebun/core';

export const createUserSchema = type({
  name: 'string',
  email: 'string.email',
});

export const updateUserSchema = type({
  'name?': 'string',
  'email?': 'string.email',
});

export type CreateUserDto = typeof createUserSchema.infer;
export type UpdateUserDto = typeof updateUserSchema.infer;
```

### 2. Reuse Schema Components

```typescript
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
  address: addressSchema,  // Reused
});
```

### 3. Use Type Inference

```typescript
// Let ArkType infer the type
const schema = type({
  name: 'string',
  age: 'number',
});

// Use inferred type everywhere
type User = typeof schema.infer;

function processUser(user: User) {
  // Fully typed
}
```

### 4. Validate Early

```typescript
// Schema validation happens at parameter extraction — use named types from schema files
@Post('/')
async create(@Body(createUserSchema) body: CreateUserDto) {
  // Body is guaranteed valid here
  return this.service.create(body);
}
```
