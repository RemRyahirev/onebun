/**
 * Bun.serve routes API with async handler — matches OneBun's pattern
 * (OneBun wraps every route in an async function).
 */
const BENCH_PORT = 3206;

const successResponse = { success: true, result: { message: 'Hello, World!' } };
const headers = { 'Content-Type': 'application/json' }; // eslint-disable-line @typescript-eslint/naming-convention

Bun.serve({
  port: BENCH_PORT,
  hostname: '0.0.0.0',
  routes: {
    '/': {
      // eslint-disable-next-line @typescript-eslint/require-await
      GET: async () => new Response(JSON.stringify(successResponse), { headers }),
    },
  },
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
});
