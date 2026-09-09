---
description: How to use OneBun documentation with AI assistants and coding agents.
---

# AI Documentation

OneBun provides LLM-optimized documentation for use with AI coding assistants.

## Available Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| [llms.txt](/llms.txt) | Navigation index with links | Quick reference, RAG systems |
| [llms-full.txt](/llms-full.txt) | Complete documentation | Full context for AI agents |

## Usage with AI Assistants

### Cursor / Windsurf / Similar IDEs

Add to project rules (`.cursor/rules/` or similar):

```
When working with OneBun framework, fetch documentation from:
https://onebun.dev/llms-full.txt
```

Or reference Context7 with library ID `onebun`.

### ChatGPT / Claude / Other Chat Interfaces

1. Copy content from [llms-full.txt](/llms-full.txt)
2. Paste into conversation as context
3. Ask questions about OneBun framework

### RAG Systems / Custom Agents

```python
import requests

# Fetch documentation index
docs = requests.get("https://onebun.dev/llms.txt").text

# Or full documentation
full_docs = requests.get("https://onebun.dev/llms-full.txt").text
```

### MCP Context7

OneBun documentation is indexed by Context7. Use library ID `onebun` with Context7 MCP server:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

## Agent Skill

The repository ships an agent skill — `skills/onebun-framework` — that teaches an assistant the
idiomatic way to write OneBun code: which decorator to reach for, what the DI container will and will
not resolve, which patterns are anti-patterns and why. It is more opinionated than the reference
documentation, and it is versioned alongside the code, so a change to a public API and the guidance
that describes it land in the same commit.

### Installing it

```bash
bun run skill:install     # copy into the agent's skill directory
bun run skill:check       # report drift between the repo and the installed copy
```

By default the skill is installed into `~/.claude/skills/onebun-framework`. Override the destination
with `CLAUDE_SKILLS_DIR`, or with an explicit path:

```bash
bun scripts/install-skill.ts --target /path/to/skills
bun scripts/install-skill.ts --print-target   # show where it would go
```

The install replaces the destination wholesale rather than merging into it: a file deleted from the
repository must not survive in the installed copy, because a removed instruction that stays on disk
keeps being followed.

### For agents working in another project

The skill is plain Markdown with no build step, so it can also be read directly from a checkout, or
vendored into another repository's own skill directory. `SKILL.md` is the entry point; the files under
`references/` are loaded on demand for a specific area (controllers, drizzle, guards, interceptors,
observability, queues, testing).

If you have no checkout, the same material is reachable over HTTP — but note the difference between the
two endpoints: [llms.txt](/llms.txt) is a link index of a few kilobytes, while
[llms-full.txt](/llms-full.txt) is the complete documentation in one file.

## What's Included

- API reference for all packages (@onebun/core, @onebun/cache, @onebun/drizzle, etc.)
- Code examples and patterns
- Type signatures and interfaces
- Common errors and solutions
- Technical notes in `<llm-only>` blocks (visible only to AI)

### Key Packages

| Package | Description |
|---------|-------------|
| `@onebun/core` | Framework core: Modules & DI, Controllers with decorator routing, Services, WebSocket Gateway (+ Socket.IO + typed client), Queue & Scheduler (in-memory, Redis, NATS, JetStream backends), HTTP Guards (`@UseGuards`, `AuthGuard`, `RolesGuard`, `createHttpGuard`), Exception Filters (`@UseFilters`, `createExceptionFilter`, `defaultExceptionFilter`), TestingModule for isolated controller/service tests (`TestingModule.create(...).overrideProvider(...).compile()`), Security Middleware (`CorsMiddleware`, `RateLimitMiddleware`, `SecurityHeadersMiddleware`), Middleware, OneBunApplication multi-service mode for microservices, Graceful Shutdown, SSE (`@Sse`, `sse()`) |
| `@onebun/docs` | Automatic OpenAPI 3.1 generation from decorators and ArkType schemas, Swagger UI, @ApiTags, @ApiOperation decorators |
| `@onebun/drizzle` | Drizzle ORM integration: PostgreSQL + SQLite (bun:sqlite), schema-first types, CLI & programmatic migrations, auto-migrate on startup, BaseRepository pattern |
| `@onebun/cache` | CacheModule with in-memory (TTL, max size) and Redis backends, shared Redis connection pool, batch operations (mget/mset) |
| `@onebun/envs` | Type-safe environment configuration: schema with Env.string/number/boolean/array, validation, defaults, transforms, sensitive value masking, .env file support |
| `@onebun/logger` | Structured logging: JSON (production) and pretty (development) output, 6 log levels, child loggers with context inheritance, automatic trace context integration |
| `@onebun/metrics` | Prometheus-compatible metrics: automatic HTTP/system/GC collection, @Timed/@Counted/@Gauged decorators, custom Counter/Gauge/Histogram, /metrics endpoint |
| `@onebun/trace` | OpenTelemetry distributed tracing: automatic HTTP tracing, @Span decorator, configurable sampling rate, export to external collectors |
| `@onebun/requests` | HTTP client: Bearer/API Key/Basic/HMAC auth, retry strategies (fixed/linear/exponential), typed ApiResponse, typed service clients via createServiceDefinition for inter-service communication |
| `@onebun/nats` | NATS and JetStream integration for distributed queues and messaging with at-least-once delivery |

### Database Migrations (@onebun/drizzle)

The Drizzle package provides database schema management:

**Schema imports:**
- PostgreSQL: `import { pgTable, text, integer, ... } from '@onebun/drizzle/pg'`
- SQLite: `import { sqliteTable, text, integer, ... } from '@onebun/drizzle/sqlite'`
- Common operators: `import { eq, and, sql, count, defineConfig, ... } from '@onebun/drizzle'`

**CLI (use `onebun-drizzle` wrapper for correct version):**
- `bunx onebun-drizzle generate` - Generate migration files
- `bunx onebun-drizzle push` - Push schema directly (dev only)
- `bunx onebun-drizzle studio` - Open Drizzle Studio

**Programmatic API:**
- `generateMigrations()` - Generate SQL files from schema (build step)
- `pushSchema()` - Apply schema directly (development)
- `DrizzleService.runMigrations()` - Apply migrations at runtime
- Auto-migrate on startup (enabled by default)

See [Database API](/api/drizzle) for full documentation.

## Format Details

Documentation follows [llmstxt.org](https://llmstxt.org/) standard:

- Plain Markdown without HTML
- Self-contained sections for RAG chunking
- Descriptions for each page
- Generated by [vitepress-plugin-llms](https://github.com/okineadev/vitepress-plugin-llms)

## Per-Page Markdown

Each documentation page is also available as `.md` file alongside the HTML version:

- `/api/core` → `/api/core.md`
- `/getting-started` → `/getting-started.md`
- etc.

Use these for individual page context when full documentation is too large.
