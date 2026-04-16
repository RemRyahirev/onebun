# Examples

Complete example applications built with the OneBun framework. Each example is a standalone project with its own tests.

## Applications

| Example | Description |
|---------|-------------|
| [crud-api](./crud-api) | REST API with CRUD operations, ArkType validation, layered architecture (Controller → Service → Repository), tracing |
| [multi-service](./multi-service) | Multiple microservices from a single process with `MultiServiceApplication`, inter-service HTTP communication, per-service config |
| [websocket-chat](./websocket-chat) | Real-time chat with WebSocket gateway, rooms, authentication guards, message history |

## Running

```bash
# Install dependencies from the repo root
bun install

# Run an example
cd examples/crud-api
bun run src/index.ts

# Run tests
bun test
```
