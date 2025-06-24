# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OneBun is a TypeScript framework for Bun.js runtime, inspired by Nest.js and using Effect.ts for side effect management. It's designed as a monorepo with multiple packages that provide a complete, opinionated framework for building high-performance applications.

## Development Commands

### Core Commands
- `bun run dev` - Start development server with watch mode
- `bun run dev:once` - Start server once without watch mode
- `bun test` - Run all tests in the monorepo

### Package Structure
The project is organized as a monorepo with workspaces:
- `packages/core` - Main framework package with decorators, DI, and application structure
- `packages/logger` - Structured logging with Effect.js integration
- `packages/envs` - Environment variable management with validation
- `packages/metrics` - Prometheus-compatible metrics collection
- `packages/trace` - OpenTelemetry-compatible distributed tracing
- `packages/requests` - Unified HTTP client with retries, auth, and tracing
- `example/` - Working example application demonstrating all features

## Architecture

### Framework Philosophy
OneBun follows the principle of "exactly one default way to solve each problem" - trading flexibility for development speed and performance. The framework provides:

1. **Dual API Support**: Both Promise-based and Effect-based APIs for different use cases
2. **Built-in Observability**: Logging, metrics, and tracing are integrated by default
3. **Type Safety**: Strict TypeScript with comprehensive type definitions
4. **Zero Build Time**: Leverages Bun.js for direct TypeScript execution

### Key Patterns

#### Effect.js Integration
The framework heavily uses Effect.js for:
- Dependency injection through Context and Layer
- Composable error handling
- Resource management
- Async operations

**Preferred pipe syntax over generators:**
```typescript
// Preferred approach
pipe(
  ServiceTag,
  Effect.flatMap(service => service.doSomething()),
  Effect.provide(serviceLayer)
);

// Avoid generators where possible
Effect.gen(function* () {
  const service = yield* ServiceTag;
  return yield* service.doSomething();
});
```

#### Decorator-Based Architecture
- `@Controller()` for HTTP route handlers
- `@Get()`, `@Post()`, etc. for HTTP methods
- `@Module()` for organizing controllers and providers
- `@Service()` for services with dependency injection

#### Error Handling
- All errors are typed through Effect.Effect<T, E>
- Chainable error context for tracing
- Automatic error logging with trace context
- Unified error response format

## Environment Setup

### Required Versions
- **Bun**: 1.2.12 (specified in .nvmrc: v20.11.0 for Node.js compatibility)
- **Node**: 24 (engines requirement in package.json)
- **TypeScript**: Latest with strict mode enabled

### Configuration Files
- `tsconfig.json` - TypeScript configuration with decorators enabled
- `.env` - Environment variables (exists in root)
- `bun.lock` - Bun package lock file

## Testing

Tests are run using Bun's built-in test runner:
- Run `bun test` from any package directory or root
- No additional test framework configuration needed
- Effect.js provides Test* modules for testing Effect-based code

## Package Development

### Adding New Packages
1. Create package directory in `packages/`
2. Add to workspace configuration in root `package.json`
3. Use `workspace:*` for internal dependencies
4. Include `bun-types` in devDependencies

### Package Structure
Each package follows the pattern:
- `src/index.ts` - Main entry point
- `package.json` - Package configuration with TypeScript source as main
- `tsconfig.json` - Package-specific TypeScript config

## Key Features

### @onebun/requests Package
Provides unified HTTP client with:
- Multiple auth schemes (Bearer, API Key, Basic, OneBun HMAC)
- Automatic retries with configurable strategies (fixed, linear, exponential)
- Integrated tracing and metrics
- Dual API (Promise and Effect)

### Observability Stack
- **Logging**: Structured JSON logs with trace context
- **Metrics**: Prometheus-compatible metrics with automatic collection
- **Tracing**: OpenTelemetry-compatible distributed tracing
- **Error Tracking**: Typed error chains with full context

### Environment Management
- Type-safe environment variable handling
- Validation and parsing
- .env file support
- Runtime configuration updates

## Development Guidelines

### Code Style
- Use strict TypeScript without `any`
- Prefer Effect.pipe over Effect.gen
- All public APIs must be typed
- Avoid cyclic dependencies between packages

### Error Handling
- Use Effect.js error types
- Provide detailed error context
- Log errors with trace information
- Never swallow errors silently

### API Design
- Provide both Promise and Effect APIs where appropriate
- Effect methods use `Effect` suffix (e.g., `getEffect`)
- Maintain backward compatibility
- Document both API styles in examples

## Bun.js Specific Considerations

### TypeScript Integration
- Direct TypeScript execution without compilation
- Use `.ts` files as entry points in package.json
- Leverage Bun's fast module resolution
- Avoid complex build processes

### Module Resolution
- Use ESM modules by default
- Prefer direct imports over re-exports
- Minimize cyclic dependencies
- Use absolute imports for workspace packages

## Current Status

The framework is in active development with working examples. Key areas of recent improvement:
- Fully functional HTTP client with comprehensive features
- Integrated observability stack
- Working example application with all features demonstrated
- Type-safe environment management

## Known Issues

1. Decorator metadata handling needs refinement for route registration
2. Some Edge cases in DI container resolution
3. Effect.js version compatibility requires careful management

## Example Usage

See the `example/` directory for a complete working application that demonstrates:
- HTTP API with multiple endpoints
- External service integration
- Comprehensive error handling
- Observability features in action
- Environment configuration

The example can be run with `bun run dev:once` and includes endpoints for user management, post creation, and demonstration of various framework features.