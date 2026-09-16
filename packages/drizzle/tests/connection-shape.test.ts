/**
 * The two PostgreSQL connection shapes reach the driver as they were written.
 *
 * The discrete shape used to be interpolated into a URL —
 * `postgresql://${user}:${password}@${host}:${port}/${database}` — with nothing encoded, so a
 * credential field could choose the server. These cases pin the three measured symptoms of that
 * and the one regression the fix introduces.
 *
 * PostgreSQL is lazy: `drizzle({ connection: … })` constructs `new SQL(…)` and opens no socket,
 * and Bun exposes the resolved settings on `client.options`. So nothing here needs a server.
 */

import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { DrizzleService } from '../src/drizzle.service';
import { DatabaseType, type PostgreSQLConnectionOptions } from '../src/types';

/** The subset of Bun's resolved `SQL` options these cases read. */
interface ResolvedClientOptions {
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  tls?: unknown;
}

const services: DrizzleService[] = [];

async function clientOptionsFor(options: PostgreSQLConnectionOptions): Promise<ResolvedClientOptions> {
  const service = new DrizzleService();
  services.push(service);

  await service.initialize({ type: DatabaseType.POSTGRESQL, options });

  const client = service.getPostgreSQLClient();
  expect(client, 'the PostgreSQL branch must have constructed a client').not.toBeNull();

  return (client as unknown as { options: ResolvedClientOptions }).options;
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(async service => await service.close().catch(() => undefined)));
});

describe('the discrete shape is handed over as fields, not assembled into a URL', () => {
  it('should not let a password choose the host or the database', async () => {
    // Measured against the old interpolation: this resolved to hostname `evil.example.com`,
    // database `pwned` and password `pw` — the whole point of the fix.
    const payload = 'pw@evil.example.com/pwned?x=1#';

    const options = await clientOptionsFor({
      host: 'real.example.com',
      port: 5432,
      user: 'app',
      password: payload,
      database: 'app_db',
    });

    expect(options.hostname).toBe('real.example.com');
    expect(options.database).toBe('app_db');
    expect(options.port).toBe(5432);
    expect(options.username).toBe('app');
    expect(options.password).toBe(payload);
  });

  it('should carry a password containing a forward slash, which used to throw Invalid URL', async () => {
    const options = await clientOptionsFor({
      host: 'db.example.com', port: 5432, user: 'app', password: 'pa/ss', database: 'app_db',
    });

    expect(options.password).toBe('pa/ss');
    expect(options.hostname).toBe('db.example.com');
  });

  it('should carry a password of at, slash, percent and colon together, which used to throw URI error', async () => {
    const options = await clientOptionsFor({
      host: 'db.example.com', port: 5432, user: 'app', password: 'p@ss/w%x:y', database: 'app_db',
    });

    expect(options.password).toBe('p@ss/w%x:y');
    expect(options.hostname).toBe('db.example.com');
  });

  it('should send a percent-encoded literal verbatim instead of decoding it', async () => {
    // The one genuine regression, pinned deliberately. `p%40ss` used to be percent-DECODED by
    // the URL parser and authenticate as `p@ss`, which is why pre-encoding was a working
    // workaround. It is now what it says it is. A caller who pre-encoded must stop.
    const options = await clientOptionsFor({
      host: 'db.example.com', port: 5432, user: 'app', password: 'p%40ss', database: 'app_db',
    });

    expect(options.password).toBe('p%40ss');
    expect(options.password).not.toBe('p@ss');
  });
});

describe('the URL shape is handed over as the string it was given', () => {
  it('should keep the query string, so sslmode reaches the driver', async () => {
    const options = await clientOptionsFor({
      connectionString: 'postgresql://app:hunter2@db.example.com:5432/orders?sslmode=require',
    });

    expect(options.hostname).toBe('db.example.com');
    expect(options.database).toBe('orders');
    // `?sslmode=require` resolves to an OBJECT naming the server, not to `true`, and Bun
    // exposes a separate numeric `sslMode` alongside it. Asserted as the object it is.
    expect(options.tls).toEqual({ serverName: 'db.example.com' });
  });

  it('should leave tls unset when the URL asks for none', async () => {
    const options = await clientOptionsFor({
      connectionString: 'postgresql://app:hunter2@db.example.com:5432/orders',
    });

    expect(options.tls).toBeUndefined();
  });

  it('should carry a percent-encoded password through the driver decoding it, as a URL means', async () => {
    // The URL shape keeps URL semantics: `%40` in a connection string IS an `@`. Only the
    // discrete shape stopped going through a parser.
    const options = await clientOptionsFor({
      connectionString: 'postgresql://app:p%40ss@db.example.com:5432/orders',
    });

    expect(options.password).toBe('p@ss');
  });
});
