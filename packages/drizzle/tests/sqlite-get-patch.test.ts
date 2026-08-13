/**
 * The SQLite `.get()` fast path, and the column collision it used to corrupt.
 *
 * `DrizzleService` patches drizzle's `PreparedQuery.get()` to read one row natively instead of
 * materializing every row — measured 345us vs 1373us on `select().from(t).get()` over 5000
 * rows, which is why the patch exists and why it is not simply deleted.
 *
 * The patch converted that object row with `Object.values()` and handed it to `mapResultRow`,
 * which is POSITIONAL. An object has one key per NAME, so a join between two tables that both
 * select `id` produced an array one element short and every value after the collision shifted
 * one field left — silently, with HTTP 200: an order's `total` came back holding a user id.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  DatabaseType,
  DrizzleService,
  eq,
} from '../src';
import {
  integer,
  sqliteTable,
  text,
} from '../src/sqlite';

const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email'),
});

const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  total: integer('total'),
});

describe('SQLite .get() fast path', () => {
  let scratch: string;
  let service: DrizzleService;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'onebun-get-patch-'));
    service = new DrizzleService();
    await service.initialize({
      type: DatabaseType.SQLITE,
      options: { url: join(scratch, 'get.db') },
    });

    const client = service.getSQLiteClient()!;
    client.run('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT)');
    client.run('CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT, total INTEGER)');

    await service.insert(users).values({ id: 'u1', name: 'Alice', email: 'alice@example.com' });
    await service.insert(orders).values({ id: 'o1', userId: 'u1', total: 4200 });
  });

  afterAll(async () => {
    await service.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  test('a join whose tables share a column name comes back in the right fields', async () => {
    const query = () => service.select()
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const one = await (query() as any).get();
    const [first] = await query();

    // Before the fix this returned
    //   {orders:{id:'u1',userId:4200,total:'u1'},users:{id:'Alice',name:'alice@example.com'}}
    // — the amount field holding a user id, and users.email gone entirely.
    expect(one).toEqual(first);
    expect(one.orders.id).toBe('o1');
    expect(one.orders.userId).toBe('u1');
    expect(one.orders.total).toBe(4200);
    expect(one.users.id).toBe('u1');
    expect(one.users.name).toBe('Alice');
    expect(one.users.email).toBe('alice@example.com');
  });

  test('a raw query selecting two identically named columns keeps both values', async () => {
    const client = service.getSQLiteClient()!;
    const statement = client.prepare(
      'SELECT o.id, u.id FROM orders o JOIN users u ON o.user_id = u.id LIMIT 1',
    );

    // The driver's own object read collapses the two `id` columns into one key — this is the
    // shape the patch used to hand to a positional mapper.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(Object.keys(statement.get() as any)).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((statement as any).values()[0]).toEqual(['o1', 'u1']);
  });

  test('the fast path still answers the ordinary single-row queries', async () => {
    // No duplicate names here, so this must take the native read, not the fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (service.select().from(users).where(eq(users.id, 'u1')).limit(1) as any).get();
    expect(row).toEqual({ id: 'u1', name: 'Alice', email: 'alice@example.com' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const missing = await (service.select().from(users).where(eq(users.id, 'nope')) as any).get();
    expect(missing).toBeUndefined();
  });
});
