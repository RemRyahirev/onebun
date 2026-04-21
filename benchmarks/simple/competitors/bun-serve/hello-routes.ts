/**
 * Bun.serve using routes API (same as OneBun uses internally)
 * vs the fetch-based baseline — to isolate Bun routes API overhead.
 */
const BENCH_PORT = 3205;

const body = JSON.stringify({ success: true, result: { message: 'Hello, World!' } });
const headers = { 'Content-Type': 'application/json' }; // eslint-disable-line @typescript-eslint/naming-convention

Bun.serve({
  port: BENCH_PORT,
  hostname: '0.0.0.0',
  routes: {
    '/': {
      GET: () => new Response(body, { headers }),
    },
  },
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
});
