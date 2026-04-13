import { Hono } from 'hono';

const BENCH_PORT = 3201;

const app = new Hono();

app.get('/', (c) => {
  return c.json({ success: true, result: { message: 'Hello, World!' } });
});

export default {
  port: BENCH_PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
