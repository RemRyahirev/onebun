# OneBun Example Application

This example demonstrates the use of the OneBun framework with Effect.js for dependency injection.

## Features Demonstrated

### Lightweight Implementation
- No external dependencies like reflect-metadata
- Custom metadata system for decorators and dependency injection
- Simplified setup with fewer dependencies

### Route Decorators
- `@Controller('/api')` - Base path for all routes in the controller
- `@Get('/hello')` - HTTP GET endpoint
- `@Post('/counter/increment')` - HTTP POST endpoint
- `@Get('/counter/:amount')` - Endpoint with path parameter

### Parameter Decorators
- `@Param('amount')` - Extract path parameters
- `@Query('multiply')` - Extract query parameters

### Middleware
- `@UseMiddleware(loggerMiddleware)` - Apply middleware to specific routes
- Logger middleware - Logs request method and path
- Timing middleware - Measures request duration

### Module System
- `@ModuleDecorator` - Define a module with controllers and providers
- Organize controllers and services in modules
- Automatic service registration and dependency injection

### Service System
- `@Service()` - Define a service with automatic Context tag creation
- `BaseService` - Base class for services with utility methods
- Dependency injection in controllers with `getService()`

### Standardized Responses
- `success()` - Return standardized success response: `{ success: true, result: data }`
- `error()` - Return standardized error response: `{ success: false, code: number, message: string }`
- Automatic error handling for thrown exceptions

### Application
- `OneBunApplication` - Create and start an application with a module
- Automatic logger creation based on NODE_ENV
- Simplified application startup without Effect.js calls

## Project Structure

- `counter.service.ts` - Defines the counter service and its interface
- `counter.controller.ts` - Defines the controller with route handlers
- `app.module.ts` - Defines the application module
- `index.ts` - Creates and starts the application

## Endpoints

- `GET /api/hello` - Returns a simple greeting
- `GET /api/counter` - Returns the current counter value
- `POST /api/counter/increment` - Increments the counter and returns the new value
- `GET /api/counter/:amount?multiply=<value>` - Calculates a result based on the counter value, amount, and multiply factor

## Running the Example

```bash
bun run index.ts
```

Then visit http://localhost:3000/api/hello in your browser or use a tool like curl or Postman to make requests to the endpoints.
