import { Elysia } from 'elysia';

const BENCH_PORT = 3202;

new Elysia()
  .get('/', () => ({ success: true, result: { message: 'Hello, World!' } }))
  .listen(BENCH_PORT);
