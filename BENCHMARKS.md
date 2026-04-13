# OneBun Benchmarks

For live benchmark results, visit **[onebun.dev/benchmarks](https://onebun.dev/benchmarks)**.

Raw benchmark data is available in [this GitHub Gist](https://gist.github.com/RemRyahirev/bde6a4c4930c19a963199fa0bea2b265).

## Methodology

### HTTP Throughput
- Tool: [bombardier](https://github.com/codesenberg/bombardier) with 50 concurrent connections, 10s duration
- All frameworks return identical JSON response: `{ success: true, result: { message: "Hello, World!" } }`
- Frameworks tested: Bun.serve (baseline), OneBun, Hono, Elysia, NestJS+Fastify (Bun), NestJS+Fastify (Node.js 24)

### Startup Time
- Measures time from process start to first successful HTTP response
- Polling interval: 5ms via Bun fetch
- 10 runs per framework, reporting mean/min/max

### Environment
- Benchmarks run weekly in GitHub Actions on `ubuntu-latest`
- Bun: latest, Node.js: 24 LTS
- NestJS (Node) runs pre-compiled JavaScript via `tsc`. All Bun entries run TypeScript directly — no build step required.

### Reproducibility
All benchmark scripts are in the [`benchmarks/`](./benchmarks/) directory. To run locally:

```bash
# Install dependencies
cd benchmarks/competitors/hono-bun && bun install
cd ../elysia && bun install  
cd ../nestjs-fastify && bun install && bun run build
cd ../../..

# Run benchmarks (requires bombardier)
./benchmarks/run-http.sh
./benchmarks/startup.sh

# Parse results
bun run benchmarks/parse-results.ts
```
