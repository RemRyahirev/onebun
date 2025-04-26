# OneBun Core Package

This package provides the core functionality for the OneBun framework.

## Features

### Route Decorators

The OneBun framework provides a set of decorators for defining routes in controllers:

```typescript
import { Controller, Get, Post, Put, Delete, Patch, Options, Head, All } from '@onebun/core';

@Controller('/users')
export class UsersController {
  @Get()
  getAllUsers() {
    // Handle GET /users
  }

  @Get('/:id')
  getUserById(@Param('id') id: string) {
    // Handle GET /users/:id
  }

  @Post()
  createUser(@Body() userData: any) {
    // Handle POST /users
  }

  @Put('/:id')
  updateUser(@Param('id') id: string, @Body() userData: any) {
    // Handle PUT /users/:id
  }

  @Delete('/:id')
  deleteUser(@Param('id') id: string) {
    // Handle DELETE /users/:id
  }
}
```

### Parameter Decorators

OneBun provides parameter decorators for extracting data from requests:

- `@Param(name)`: Extract path parameters
- `@Query(name)`: Extract query parameters
- `@Body()`: Extract request body
- `@Header(name)`: Extract request headers
- `@Req()`: Get the request object
- `@Res()`: Get the response object (currently not fully supported)

Example:

```typescript
@Controller('/api')
export class ApiController {
  @Get('/search')
  search(
    @Query('q') query: string,
    @Query('limit', { required: true }) limit: number
  ) {
    // Handle GET /api/search?q=something&limit=10
    return { results: [], query, limit };
  }

  @Post('/users/:id/profile')
  updateProfile(
    @Param('id') userId: string,
    @Body() profileData: any,
    @Header('Authorization') token: string
  ) {
    // Handle POST /api/users/123/profile
    return { success: true, userId };
  }
}
```

### Middleware

You can add middleware to routes using the `@UseMiddleware` decorator:

```typescript
function loggerMiddleware(req: Request, next: () => Promise<Response>): Promise<Response> {
  console.log(`Request: ${req.method} ${new URL(req.url).pathname}`);
  return next();
}

function authMiddleware(req: Request, next: () => Promise<Response>): Promise<Response> {
  const token = req.headers.get('Authorization');
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
  return next();
}

@Controller('/admin')
export class AdminController {
  @Get('/dashboard')
  @UseMiddleware(loggerMiddleware, authMiddleware)
  getDashboard() {
    // This route will be protected by authMiddleware
    // and logged by loggerMiddleware
    return { stats: {} };
  }
}
```

## Path Parameters

OneBun supports path parameters in routes:

```typescript
@Controller('/api')
export class ApiController {
  @Get('/users/:id')
  getUser(@Param('id') id: string) {
    // The :id in the path will be extracted and passed to the handler
    return { id };
  }

  @Get('/organizations/:orgId/members/:memberId')
  getMember(
    @Param('orgId') orgId: string,
    @Param('memberId') memberId: string
  ) {
    // Multiple path parameters are supported
    return { orgId, memberId };
  }
}
```

## Parameter Validation

You can add validation to parameters:

```typescript
@Controller('/api')
export class ApiController {
  @Get('/users/:id')
  getUser(
    @Param('id', { 
      required: true,
      validator: (value) => /^\d+$/.test(value)
    }) id: string
  ) {
    // The id parameter is required and must be numeric
    return { id };
  }
}
```

## Modules

OneBun uses modules to organize controllers and services:

```typescript
import { Module } from '@onebun/core';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService]
})
export class UsersModule {}
```

## Services

OneBun provides a simple way to define services with the `@Service` decorator:

```typescript
import { Service, BaseService } from '@onebun/core';

@Service()
export class UserService extends BaseService {
  private users = [];

  findAll() {
    return this.users;
  }

  findById(id: string) {
    return this.users.find(user => user.id === id);
  }

  create(userData: any) {
    const user = { id: Date.now().toString(), ...userData };
    this.users.push(user);
    return user;
  }
}
```

The `@Service` decorator automatically creates a Context tag for the service and registers it with the module system. The `BaseService` class provides utility methods for working with Effect.js.

## Metadata System

OneBun includes a lightweight metadata system that powers its decorators and dependency injection. Unlike many TypeScript frameworks, OneBun doesn't rely on external dependencies like reflect-metadata, making it more lightweight and easier to use in client applications.

The metadata system provides:

- Storage for controller route definitions
- Parameter type information for request handling
- Middleware registration
- Service registration and dependency tracking

This system is used internally by the framework and generally doesn't need to be accessed directly by application code.

## Dependency Injection

Controllers can access services using dependency injection:

```typescript
import { Controller, Get, Post, BaseController } from '@onebun/core';
import { UserService } from './user.service';

@Controller('/users')
export class UserController extends BaseController {
  @Get()
  getAllUsers() {
    // Get the service using dependency injection
    const userService = this.getService(UserService);

    // Call the service method directly
    const users = userService.findAll();

    // Return a standardized success response
    return this.success({ users });
  }

  @Post()
  createUser(@Body() userData: any) {
    const userService = this.getService(UserService);
    const user = userService.create(userData);
    return this.success({ user });
  }
}
```

## Standardized Responses

OneBun provides standardized response formats:

```typescript
// Success response: { success: true, result: data }
return this.success({ users });

// Error response: { success: false, code: number, message: string }
return this.error('User not found', 404);
```

Errors thrown in controller methods are automatically caught and converted to standardized error responses.

## Application

Create and start an OneBun application:

```typescript
import { OneBunApplication } from '@onebun/core';
import { AppModule } from './app.module';

const app = new OneBunApplication(AppModule, {
  port: 3000,
  host: '0.0.0.0',
  development: true
});

// Start the application (no Effect.js calls needed)
app.start()
  .then(() => console.log('Application started'))
  .catch(error => console.error('Failed to start application:', error));
```

The application automatically creates a logger based on NODE_ENV (development or production) and handles all Effect.js calls internally.
