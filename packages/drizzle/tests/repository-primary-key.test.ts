/**
 * A repository resolves its primary key from the table itself, so a key whose property name
 * differs from its SQL column name (`userId: text('user_id').primaryKey()`) works for
 * `findById`, `update` and `delete` on both dialects, using real drizzle tables.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { createPostgresContainer, type TestContainer } from '@onebun/core/testing';

import { DrizzleService } from '../src/drizzle.service';
import { pgTable, text as pgText } from '../src/pg';
import { BaseRepository } from '../src/repository';
import { getPrimaryKeyColumn } from '../src/schema-utils';
import { sqliteTable, text as sqliteText } from '../src/sqlite';
import { DatabaseType } from '../src/types';

const pgAccounts = pgTable('pk_accounts', {
  userId: pgText('user_id').primaryKey(),
  displayName: pgText('display_name').notNull(),
});

const sqliteAccounts = sqliteTable('pk_accounts', {
  userId: sqliteText('user_id').primaryKey(),
  displayName: sqliteText('display_name').notNull(),
});

/** Starting and stopping the Postgres container takes far longer than a hook's default 5 s. */
const CONTAINER_BOOT_MS = 120_000;

type AccountRepo = BaseRepository<typeof sqliteAccounts> | BaseRepository<typeof pgAccounts>;

/** The same assertions for both dialects. */
function describeRepositoryContract(getRepo: () => AccountRepo): void {
  it('findById finds a row by its primary key', async () => {
    const repo = getRepo() as BaseRepository<typeof sqliteAccounts>;
    await repo.create({ userId: 'u1', displayName: 'Ann' });

    expect(await repo.findById('u1')).toEqual({ userId: 'u1', displayName: 'Ann' });
    expect(await repo.findById('missing')).toBeNull();
  });

  it('update changes the row addressed by its primary key', async () => {
    const repo = getRepo() as BaseRepository<typeof sqliteAccounts>;
    await repo.create({ userId: 'u1', displayName: 'Ann' });
    await repo.create({ userId: 'u2', displayName: 'Bob' });

    const updated = await repo.update('u1', { displayName: 'Anna' });

    expect(updated).toEqual({ userId: 'u1', displayName: 'Anna' });
    expect((await repo.findById('u2'))?.displayName).toBe('Bob');
    expect(await repo.update('missing', { displayName: 'X' })).toBeNull();
  });

  it('delete removes only the row addressed by its primary key', async () => {
    const repo = getRepo() as BaseRepository<typeof sqliteAccounts>;
    await repo.create({ userId: 'u1', displayName: 'Ann' });
    await repo.create({ userId: 'u2', displayName: 'Bob' });

    expect(await repo.delete('u1')).toBe(true);
    expect(await repo.delete('u1')).toBe(false);
    expect(await repo.findById('u1')).toBeNull();
    expect((await repo.findById('u2'))?.displayName).toBe('Bob');
  });
}

describe('BaseRepository primary key whose property key differs from its column name', () => {
  it('getPrimaryKeyColumn reports the SQL column name', () => {
    expect(getPrimaryKeyColumn(sqliteAccounts)).toBe('user_id');
    expect(getPrimaryKeyColumn(pgAccounts)).toBe('user_id');
  });

  describe('SQLite', () => {
    let service: DrizzleService;
    let repo: BaseRepository<typeof sqliteAccounts>;

    beforeEach(async () => {
      delete process.env.DB_URL;
      delete process.env.DB_TYPE;
      service = new DrizzleService();
      await service.initialize({ type: DatabaseType.SQLITE, options: { url: ':memory:' } });
      await service
        .getSQLiteDatabase()
        .run('CREATE TABLE pk_accounts (user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL)');
      repo = new BaseRepository(service, sqliteAccounts);
    });

    describeRepositoryContract(() => repo);
  });

  describe('PostgreSQL', () => {
    let container: TestContainer;
    let service: DrizzleService;
    let repo: BaseRepository<typeof pgAccounts>;

    beforeAll(async () => {
      container = await createPostgresContainer();
      service = new DrizzleService();
      await service.initialize({
        type: DatabaseType.POSTGRESQL,
        options: { connectionString: container.url },
      });
      await service.getPostgreSQLClient()!`
        CREATE TABLE pk_accounts (user_id text PRIMARY KEY, display_name text NOT NULL)`;
      repo = new BaseRepository(service, pgAccounts);
    }, CONTAINER_BOOT_MS);

    afterAll(async () => {
      await service.close();
      await container.stop();
    }, CONTAINER_BOOT_MS);

    beforeEach(async () => {
      await service.getPostgreSQLClient()!`TRUNCATE pk_accounts`;
    });

    describeRepositoryContract(() => repo);
  });
});
