/**
 * `pool.*` reaches the driver.
 *
 * Every option in a `pool` block used to be read from the configuration and then thrown away:
 * the PostgreSQL branch called `drizzle(url)` with the URL and nothing else. An operator could
 * tune `max` for their load, the framework would accept it, and the driver would never hear
 * about it — the worst shape a defect can take, because nothing anywhere reports it.
 *
 * These cases pin the translation without a server. `drizzle({ connection: { url, … } })`
 * constructs `new SQL({ url, … })` and opens no socket, and Bun exposes the resolved settings
 * on `client.options` — normalised back to milliseconds, whatever unit they went in as.
 *
 * Measured against `postgres:16-alpine` while writing this (see the item's evidence):
 * - `max` is real: four concurrent `pg_sleep(1)` take 4005 ms at `max: 1` and 1003 ms at
 *   `max: 4`, on both the raw client and drizzle's `client.unsafe(...)` path.
 * - `connectionTimeout` is honoured and takes fractional seconds — against a black-holed host,
 *   `2` failed after 2003 ms and `0.25` after 251 ms. That is what makes the millisecond →
 *   second conversion a plain division with nothing to round away.
 * - `min` is accepted and silently ignored by Bun; it has no counterpart to reach.
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { DrizzleService } from '../src/drizzle.service';
import { DatabaseType, type PostgreSQLPoolOptions } from '../src/types';

/**
 * Bun's own default pool size, which an unset `max` must leave alone.
 *
 * The two timeouts have no such visible value: left unset they are **absent** from
 * `client.options` and Bun applies its documented defaults (30 s to connect, no idle timeout)
 * internally. `undefined` there is therefore the assertion for "not forwarded", and it is a
 * sharper one than a number would be — a forwarded zero would read as `0`, not as absent.
 */
const DRIVER_DEFAULT_MAX = 10;

/** The settings Bun resolved, all in milliseconds regardless of the unit they were given in. */
interface ResolvedClientOptions {
  max?: number;
  idleTimeout?: number;
  connectionTimeout?: number;
}

const services: DrizzleService[] = [];

/**
 * Initialize against a URL nothing listens on. PostgreSQL is lazy — `drizzle()` opens no
 * socket — so this reaches the driver construction and stops there.
 */
async function clientOptionsFor(pool?: PostgreSQLPoolOptions): Promise<ResolvedClientOptions> {
  const service = new DrizzleService();
  services.push(service);

  await service.initialize({
    type: DatabaseType.POSTGRESQL,
    options: {
      connectionString: 'postgresql://onebun:onebun@127.0.0.1:5999/onebun_test',
      ...(pool === undefined ? {} : { pool }),
    },
  });

  const client = service.getPostgreSQLClient();
  expect(client, 'the PostgreSQL branch must have constructed a client').not.toBeNull();

  return (client as unknown as { options: ResolvedClientOptions }).options;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(async service => await service.close().catch(() => undefined)));
});

describe('pool options reach the driver', () => {
  it('passes max through as given', async () => {
    const options = await clientOptionsFor({ max: 20 });

    expect(options.max).toBe(20);
  });

  it('converts the millisecond timeouts to the seconds the driver takes', async () => {
    // Bun normalises them back to milliseconds on `options`, so the round trip is visible:
    // what goes in as 30000 ms must come out as 30000 ms, not as 30 or 30000000.
    const options = await clientOptionsFor({ idleTimeout: 30_000, timeout: 2_000 });

    expect(options.idleTimeout).toBe(30_000);
    expect(options.connectionTimeout).toBe(2_000);
  });

  it('keeps a sub-second timeout, which a second-granularity round would have erased', async () => {
    // 250 ms is the value `startup-contract.test.ts` uses. Rounding it to whole seconds would
    // give either 0 — which means "no timeout" to Bun, the opposite of the intent — or 1000 ms,
    // four times what was asked for.
    const options = await clientOptionsFor({ timeout: 250 });

    expect(options.connectionTimeout).toBe(250);
  });

  it('leaves every driver default alone when no pool is configured', async () => {
    const options = await clientOptionsFor();

    expect(options.max).toBe(DRIVER_DEFAULT_MAX);
    expect(options.connectionTimeout).toBeUndefined();
    expect(options.idleTimeout).toBeUndefined();
  });

  it('leaves the defaults alone for an empty pool block, too', async () => {
    const options = await clientOptionsFor({});

    expect(options.max).toBe(DRIVER_DEFAULT_MAX);
    expect(options.connectionTimeout).toBeUndefined();
  });

  it('does not forward a zero timeout, because zero means "no timeout" to the driver', async () => {
    // Forwarding it would turn a misconfiguration into an unbounded connect — strictly worse
    // than the default, and silent.
    const options = await clientOptionsFor({ timeout: 0, idleTimeout: 0, max: 0 });

    expect(options.connectionTimeout).toBeUndefined();
    expect(options.idleTimeout).toBeUndefined();
    expect(options.max).toBe(DRIVER_DEFAULT_MAX);
  });

  it('does not forward a negative or non-finite value', async () => {
    const options = await clientOptionsFor({ timeout: -1, idleTimeout: Number.NaN, max: -5 });

    expect(options.connectionTimeout).toBeUndefined();
    expect(options.idleTimeout).toBeUndefined();
    expect(options.max).toBe(DRIVER_DEFAULT_MAX);
  });

  it('gives pool.timeout one meaning: the same number bounds the driver and the startup probe', async () => {
    // The probe half is driven end-to-end by `startup-contract.test.ts`, which sets
    // `pool: { timeout: 250 }` and asserts the failure names a 250 ms connect timeout. This is
    // the other half: the driver gets that same number, so the option cannot mean two things.
    const options = await clientOptionsFor({ timeout: 250 });

    expect(options.connectionTimeout).toBe(250);
  });

  it('carries the pool through the discrete-field shape as well as the URL shape', async () => {
    const service = new DrizzleService();
    services.push(service);

    await service.initialize({
      type: DatabaseType.POSTGRESQL,
      options: {
        host: '127.0.0.1',
        port: 5999,
        user: 'onebun',
        password: 'onebun',
        database: 'onebun_test',
        pool: { max: 3 },
      },
    });

    const client = service.getPostgreSQLClient();
    const options = (client as unknown as { options: ResolvedClientOptions }).options;

    expect(options.max).toBe(3);
  });
});
