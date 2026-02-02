---
description: Schema validation with ArkType. validate(), validateOrThrow(), toJsonSchema(). Built-in schema helpers.
---

# Validation API

Package: `@onebun/core` (uses ArkType)

OneBun uses [ArkType](https://arktype.io/) for runtime type validation and TypeScript type inference.

## Basic Usage

### Defining Schemas

```typescript
import { type } from 'arktype';

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

```typescript
import { Controller, BaseController, Post, Body } from '@onebun/core';
import { type } from 'arktype';

const createUserSchema = type({
  name: 'string',
  email: 'string.email',
  'age?': 'number > 0',  // Optional field
});

@Controller('/users')
export class UserController extends BaseController {
  @Post('/')
  async create(
    // Body is validated and typed
    @Body(createUserSchema) body: typeof createUserSchema.infer,
  ): Promise<Response> {
    // body is guaranteed to be valid here
    // body.name: string
    // body.email: string
    // body.age: number | undefined

    return this.success({ user: body });
  }
}
```

## Schema Types

### Primitives

```typescript
import { type } from 'arktype';

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
type('string.datetime')     // ISO datetime string
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
type('integer > 0')         // Positive integer

// Special values
type('number.positive')     // > 0
type('number.negative')     // < 0
type('number.nonNegative')  // >= 0
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
  '+': 'string',  // Allow additional string properties
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
import { validate } from '@onebun/core';
import { type } from 'arktype';

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
import { validateOrThrow } from '@onebun/core';
import { type } from 'arktype';

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

## Common Schema Patterns

### Create/Update DTOs

```typescript
import { type } from 'arktype';

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
): Promise<Response> {
  const pagination = validate(paginationSchema, {
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 10,
  });

  if (!pagination.success) {
    return this.error('Invalid pagination', 400, 400);
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
  }).array().configure({ minLength: 1 }),
  'shippingAddress?': {
    street: 'string',
    city: 'string',
    country: 'string',
    'zipCode?': 'string',
  },
  'paymentMethod': '"card" | "paypal" | "bank_transfer"',
});

@Post('/orders')
async createOrder(
  @Body(createOrderSchema) body: typeof createOrderSchema.infer,
): Promise<Response> {
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
  createdAt: 'string.datetime',
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
  async findOne(@Param('id') id: string): Promise<Response> {
    const user = await this.userService.findById(id);

    if (!user) {
      return this.error('User not found', 404, 404);
    }

    // Response will be validated against userResponseSchema
    return this.success(user);
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
    timestamp: 'string.datetime',
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

## JSON Schema Conversion

Convert ArkType schemas to JSON Schema for OpenAPI/Swagger:

```typescript
import { toJsonSchema, getJsonSchema } from '@onebun/core';
import { type } from 'arktype';

const userSchema = type({
  name: 'string',
  age: 'number > 0',
});

// Basic conversion
const jsonSchema = toJsonSchema(userSchema);

// With fallback for unsupported types
const jsonSchemaWithFallback = getJsonSchema(userSchema, {
  fallback: (ctx) => ({ ...ctx.base, description: 'Custom fallback' }),
});

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

## Best Practices

### 1. Define Schemas in Separate Files

```typescript
// schemas/user.schema.ts
import { type } from 'arktype';

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
@Post('/')
async create(@Body(createUserSchema) body: typeof createUserSchema.infer) {
  // Validation happens at parameter extraction
  // Body is guaranteed valid here
  return this.success(await this.service.create(body));
}
```
