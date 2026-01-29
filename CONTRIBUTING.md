# Contributing to OneBun

Thank you for your interest in contributing to OneBun! This document provides guidelines and instructions for contributing.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/RemRyahirev/onebun.git
   cd onebun
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Run tests to verify setup:
   ```bash
   bun test
   ```

## Development Commands

- `bun test` - Run all tests
- `bun lint` - Run ESLint
- `bun run typecheck` - Run TypeScript type checking
- `bun run dev` - Start development server with watch mode

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `master`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes and add tests
4. Ensure all checks pass:
   ```bash
   bun test
   bun lint
   bun run typecheck
   ```
5. Commit your changes using conventional commits
6. Push to your fork and submit a Pull Request

## Code Style

- **TypeScript strict mode** - All code must pass strict type checking
- **Use Effect.pipe** - Prefer `Effect.pipe` over generators for Effect.ts code
- **No `any` types** - Avoid `any`; use `unknown` with proper type guards when needed
- **English only** - All code, comments, and documentation must be in English

## Commit Messages

We use conventional commits. Format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `chore` - Maintenance tasks
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `perf` - Performance improvements

Examples:
- `feat(core): add module lazy loading support`
- `fix(cache): resolve Redis connection timeout`
- `docs(readme): update installation instructions`

## Project Structure

```
onebun/
├── packages/           # Framework packages
│   ├── core/          # Core framework (decorators, DI, modules)
│   ├── cache/         # Caching (in-memory, Redis)
│   ├── docs/          # Documentation generation
│   ├── drizzle/       # Drizzle ORM integration
│   ├── envs/          # Environment variables
│   ├── logger/        # Logging
│   ├── metrics/       # Prometheus metrics
│   ├── requests/      # HTTP client
│   └── trace/         # OpenTelemetry tracing
├── example/           # Example application
├── docs/              # Documentation
└── scripts/           # Build and publish scripts
```

## Adding a New Package

1. Create directory in `packages/`
2. Add `package.json` with proper metadata
3. Export from `src/index.ts`
4. Add tests
5. Update documentation

## Testing

- Write tests for all new functionality
- Place tests alongside source files (`*.test.ts`) or in `tests/` directory
- Use descriptive test names
- Mock external dependencies

## Questions?

If you have questions, feel free to open an issue for discussion.
