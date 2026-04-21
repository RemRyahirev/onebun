const BENCH_PORT = 3200;

const body = JSON.stringify({ success: true, result: { message: 'Hello, World!' } });
const headers = { 'Content-Type': 'application/json' };

Bun.serve({
  port: BENCH_PORT,
  hostname: '0.0.0.0',
  fetch(): Response {
    return new Response(body, { headers });
  },
});
