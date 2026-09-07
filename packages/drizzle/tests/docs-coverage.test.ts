/**
 * Documentation coverage tests for `docs/api/drizzle.md`.
 *
 * Every section here had snippets that no `@source`-tagged test named, so a refactor could
 * break the documented recipe with the suite still green. The package already owns a
 * `docs-examples.test.ts`; this file is deliberately a second one, so nothing there had to be
 * rewritten. `scripts/docs-xref.ts` scans both names (`DOCS_TEST_FILENAMES`), so these tags
 * count towards its snippet coverage.
 *
 * @source docs:api/drizzle.md
 */

import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import {
  BaseController,
  BaseService,
  Controller,
  Get,
  getConstructorParamTypes,
  isGlobalModule,
  Module,
  OneBunApplication,
  resetRegistrations,
  Service,
} from '@onebun/core';
import { createTestService } from '@onebun/core/testing';
import {
  and,
  avg,
  count,
  DatabaseType,
  desc,
  DrizzleModule,
  DrizzleService,
  DrizzleStartupError,
  eq,
  inArray,
  isNull,
  like,
  max,
  min,
  or,
  relations,
  sql,
  sum,
} from '@onebun/drizzle';
import {
  integer as pgInteger,
  pgTable,
  text as pgText,
  timestamp,
} from '@onebun/drizzle/pg';
import {
  integer,
  sqliteTable,
  text,
} from '@onebun/drizzle/sqlite';

const APP_OPTIONS = {
  port: 0,
  host: '127.0.0.1',
  metrics: { enabled: false },
  gracefulShutdown: false,
} as const;

/** Nothing listens here, so a connection attempt is refused within milliseconds. */
const DEAD_URL = 'postgresql://app:hunter2@127.0.0.1:5997/orders';

/** The table the fixture migration in `tests/test-migrations` creates. */
const migratedUsers = sqliteTable('test_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

/**
 * The table the query sections talk about. `name`/`email` are the only required columns, so
 * the `insert()` snippets — which supply exactly those two — are runnable verbatim.
 */
const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  active: integer('active', { mode: 'boolean' }),
  age: integer('age'),
  createdAt: text('created_at'),
});

const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  authorId: integer('author_id').notNull(),
});

const orders = sqliteTable('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  amount: integer('amount').notNull(),
});

/**
 * Read the rows of a PROJECTED select — `select({ name: users.name })` and the aggregate
 * forms — under the shape they actually have.
 *
 * The universal builder's return type is keyed on the TABLE, not on the projection, so
 * `select(fields).from(table)` is typed as the whole row whatever `fields` says. The runtime
 * result is the projection alone, which is what every assertion below checks. Reported as a
 * typing gap rather than papered over: this helper is the only place it is acknowledged.
 */
const projected = <TRow extends Record<string, unknown>>(rows: unknown): TRow[] => rows as TRow[];

// ---------------------------------------------------------------------------------------
// DrizzleModule
// ---------------------------------------------------------------------------------------

describe('docs/api/drizzle.md — DrizzleModule', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'onebun-docs-drizzle-'));
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  afterEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * @source docs:api/drizzle.md#sqlite-setup
   */
  it('opens the SQLite file the module names, migrates it, and serves it through the module controllers', async () => {
    const file = join(scratch, 'app.db');

    @Service()
    class UserService extends BaseService {
      constructor(private db: DrizzleService) {
        super();
      }

      async create(name: string, email: string): Promise<void> {
        await this.db.insert(migratedUsers).values({ name, email });
      }

      async findAll(): Promise<Array<typeof migratedUsers.$inferSelect>> {
        return await this.db.select().from(migratedUsers);
      }
    }

    @Controller('/users')
    class UserController extends BaseController {
      constructor(private userService: UserService) {
        super();
      }

      @Get('/')
      async list(): Promise<Array<typeof migratedUsers.$inferSelect>> {
        return await this.userService.findAll();
      }
    }

    // The snippet verbatim: one module owning forRoot(), its controller and its provider.
    @Module({
      imports: [
        DrizzleModule.forRoot({
          connection: {
            type: DatabaseType.SQLITE,
            options: { url: file },
          },
          migrationsFolder: join(__dirname, 'test-migrations'),
        }),
      ],
      controllers: [UserController],
      providers: [UserService],
    })
    class UserModule {}

    const app = new OneBunApplication(UserModule, APP_OPTIONS);

    try {
      await app.start();

      // `options.url` is the database that was opened — not `:memory:`, and not a default.
      expect(existsSync(file)).toBe(true);
      expect(app.getService(DrizzleService).getConnectionOptions()).toEqual({
        type: DatabaseType.SQLITE,
        options: { url: file },
      });

      await app.getService(UserService).create('John', 'john@example.com');

      // The controller the module registered answers over HTTP with rows from that database.
      const response = await fetch(`http://127.0.0.1:${app.getPort()}/users`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        result: [{ id: 1, name: 'John', email: 'john@example.com' }],
      });
    } finally {
      await app.stop();
    }

    // Written to the FILE, so it outlives the process that wrote it — and `test_users` exists
    // only because `migrationsFolder` was applied at startup.
    const reopened = new Database(file, { readonly: true });

    try {
      expect(reopened.query('SELECT name, email FROM test_users').all())
        .toEqual([{ name: 'John', email: 'john@example.com' }]);
    } finally {
      reopened.close();
    }
  });

  /**
   * @source docs:api/drizzle.md#postgresql-setup
   */
  it('hands the configured connectionString to the PostgreSQL driver, with the password redacted', async () => {
    DrizzleModule.forRoot({
      connection: {
        type: DatabaseType.POSTGRESQL,
        options: {
          // In the snippet this is `config.get('database.url')`; what matters is that whatever
          // the configuration yields is the server the service then talks to.
          connectionString: DEAD_URL,
        },
      },
      migrationsFolder: './drizzle',
    });

    const { instance } = createTestService(DrizzleService);
    const failure = await instance.onModuleInit().then(
      () => null,
      (error: unknown) => error as DrizzleStartupError,
    );

    try {
      // The configured URL is the one that was dialled: host, port and database all appear.
      expect(failure?.name).toBe('DrizzleStartupError');
      expect(failure?.stage).toBe('connect');
      expect(failure?.target).toBe('PostgreSQL at postgresql://app:***@127.0.0.1:5997/orders');
      // The password is never printed — not in the error, not in `target`.
      expect(failure?.message).not.toContain('hunter2');
      expect(failure?.message).toContain('postgresql://app:***@127.0.0.1:5997/orders');
      // `type: POSTGRESQL` selected the PostgreSQL driver rather than falling back to SQLite.
      expect(instance.isSQLite()).toBe(false);
    } finally {
      await instance.close();
    }
  });

  /**
   * @source docs:api/drizzle.md#global-module-default-behavior
   */
  it('is global by default: sibling modules that import nothing share the one DrizzleService', async () => {
    @Service()
    class UserService extends BaseService {
      constructor(private db: DrizzleService) {
        super();
      }

      database(): DrizzleService {
        return this.db;
      }

      async findAll(): Promise<Array<typeof users.$inferSelect>> {
        return await this.db.select().from(users);
      }
    }

    @Service()
    class PostService extends BaseService {
      constructor(private db: DrizzleService) {
        super();
      }

      database(): DrizzleService {
        return this.db;
      }

      async seed(): Promise<void> {
        await this.db.insert(users).values({ name: 'John', email: 'john@example.com' });
      }
    }

    // Neither feature module imports DrizzleModule — that is the whole claim.
    @Module({ providers: [UserService], exports: [UserService] })
    class UserModule {}

    @Module({ providers: [PostService], exports: [PostService] })
    class PostModule {}

    @Module({
      imports: [
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.SQLITE, options: { url: join(scratch, 'global.db') } },
          autoMigrate: false,
        }),
        UserModule,
        PostModule,
      ],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, APP_OPTIONS);

    try {
      await app.start();

      expect(isGlobalModule(DrizzleModule)).toBe(true);

      const root = app.getService(DrizzleService);
      const userService = app.getService(UserService);
      const postService = app.getService(PostService);

      // One DrizzleService for the application, reaching both submodules ambiently.
      expect(userService.database()).toBe(root);
      expect(postService.database()).toBe(root);

      root.getSQLiteClient()!.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT,
        active INTEGER,
        age INTEGER,
        created_at TEXT
      )`);

      // A write through one submodule is visible through the other: one connection, not two.
      await postService.seed();

      expect(await userService.findAll()).toEqual([{
        id: 1,
        name: 'John',
        email: 'john@example.com',
        role: null,
        active: null,
        age: null,
        createdAt: null,
      }]);
    } finally {
      await app.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------
// DrizzleService — injection and type inference
// ---------------------------------------------------------------------------------------

describe('docs/api/drizzle.md — DrizzleService injection', () => {
  beforeEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  afterEach(() => {
    resetRegistrations();
    DrizzleModule.clearOptions();
  });

  /**
   * @source docs:api/drizzle.md#injection
   */
  it('resolves the plain constructor parameter — no @Inject, no token', async () => {
    @Service()
    class UserService extends BaseService {
      constructor(private db: DrizzleService) {
        super();
      }

      database(): DrizzleService {
        return this.db;
      }
    }

    // The bare parameter type is what DI reads: `design:paramtypes` must carry DrizzleService.
    expect(getConstructorParamTypes(UserService)).toEqual([DrizzleService]);

    @Module({
      imports: [
        DrizzleModule.forRoot({
          connection: { type: DatabaseType.SQLITE, options: { url: ':memory:' } },
          autoMigrate: false,
        }),
      ],
      providers: [UserService],
    })
    class AppModule {}

    const app = new OneBunApplication(AppModule, APP_OPTIONS);

    try {
      await app.start();

      const injected = app.getService(UserService).database();

      // Not merely present: it is the initialized service, and it answers queries.
      expect(injected).toBe(app.getService(DrizzleService));
      injected.getSQLiteClient()!.run('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, '
        + 'name TEXT NOT NULL, email TEXT NOT NULL, role TEXT, active INTEGER, age INTEGER, created_at TEXT)');
      await injected.insert(users).values({ name: 'John', email: 'john@example.com' });

      expect(projected<{ name: string }>(await injected.select({ name: users.name }).from(users)))
        .toEqual([{ name: 'John' }]);
    } finally {
      await app.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------
// Query methods and query examples, against a real in-memory SQLite database
// ---------------------------------------------------------------------------------------

describe('docs/api/drizzle.md — queries', () => {
  let service: DrizzleService;
  let client: Database;

  const seedUser = (
    name: string,
    email: string,
    role: string | null = null,
    active: number | null = null,
    age: number | null = null,
    createdAt: string | null = null,
  ): void => {
    client.run(
      'INSERT INTO users (name, email, role, active, age, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, role, active, age, createdAt],
    );
  };

  beforeEach(async () => {
    DrizzleModule.clearOptions();

    const { instance } = createTestService(DrizzleService);
    service = instance;
    await service.initialize({ type: DatabaseType.SQLITE, options: { url: ':memory:' } });

    client = service.getSQLiteClient()!;
    client.run(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT,
      active INTEGER,
      age INTEGER,
      created_at TEXT
    )`);
    client.run(`CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author_id INTEGER NOT NULL
    )`);
    client.run('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL)');
  });

  afterEach(async () => {
    await service.close();
    DrizzleModule.clearOptions();
  });

  /**
   * @source docs:api/drizzle.md#type-inference
   */
  it('infers the row shape from the table, with no generic parameter on DrizzleService', async () => {
    seedUser('John', 'john@example.com', 'admin', 1, 30, '2024-01-01');

    // `new DrizzleService()` took no generic argument, and the row type still comes from the
    // table: this assignment is the compile-time half of the claim.
    const rows: Array<typeof users.$inferSelect> = await service.select().from(users);

    // The runtime half: exactly the table's own columns, under their PROPERTY names, so
    // `created_at` is read back as `createdAt` rather than leaking the SQL name.
    expect(Object.keys(rows[0]).sort()).toEqual(['active', 'age', 'createdAt', 'email', 'id', 'name', 'role']);
    expect(rows[0]).toEqual({
      id: 1,
      name: 'John',
      email: 'john@example.com',
      role: 'admin',
      // `{ mode: 'boolean' }` is honoured: the stored 1 comes back as `true`, not as 1.
      active: true,
      age: 30,
      createdAt: '2024-01-01',
    });
  });

  /**
   * @source docs:api/drizzle.md#select
   */
  it('selects all columns, a projection, and a filtered single row', async () => {
    seedUser('John', 'john@example.com');
    seedUser('Jane', 'jane@example.com');

    const allUsers = await service.select().from(users);

    expect(allUsers.map(user => user.name)).toEqual(['John', 'Jane']);

    const names = projected<{ name: string; email: string }>(
      await service.select({ name: users.name, email: users.email }).from(users),
    );

    // A projection returns ONLY the projected columns.
    expect(names).toEqual([
      { name: 'John', email: 'john@example.com' },
      { name: 'Jane', email: 'jane@example.com' },
    ]);

    const user = await service.select()
      .from(users)
      .where(eq(users.id, 2))
      .limit(1);

    expect(user).toHaveLength(1);
    expect(user[0].name).toBe('Jane');
  });

  /**
   * @source docs:api/drizzle.md#insert
   */
  it('inserts one row, returns the inserted row, and inserts many', async () => {
    await service.insert(users).values({ name: 'John', email: 'john@example.com' });

    expect(client.query('SELECT name, email FROM users').all())
      .toEqual([{ name: 'John', email: 'john@example.com' }]);

    const [newUser] = await service.insert(users)
      .values({ name: 'Mary', email: 'mary@example.com' })
      .returning();

    // `.returning()` gives back the stored row, including the generated id.
    expect(newUser).toMatchObject({ id: 2, name: 'Mary', email: 'mary@example.com' });

    await service.insert(users).values([
      { name: 'Ann', email: 'ann@example.com' },
      { name: 'Jane', email: 'jane@example.com' },
    ]);

    expect(client.query('SELECT name FROM users ORDER BY id').all())
      .toEqual([{ name: 'John' }, { name: 'Mary' }, { name: 'Ann' }, { name: 'Jane' }]);
  });

  /**
   * @source docs:api/drizzle.md#update
   */
  it('updates the matched rows only, and returns them', async () => {
    seedUser('John', 'john@example.com');
    seedUser('Bob', 'bob@example.com');

    await service.update(users)
      .set({ name: 'Jane' })
      .where(eq(users.id, 1));

    expect(client.query('SELECT id, name FROM users ORDER BY id').all())
      .toEqual([{ id: 1, name: 'Jane' }, { id: 2, name: 'Bob' }]);

    const [updated] = await service.update(users)
      .set({ name: 'Janet' })
      .where(eq(users.id, 1))
      .returning();

    expect(updated).toMatchObject({ id: 1, name: 'Janet', email: 'john@example.com' });
  });

  /**
   * @source docs:api/drizzle.md#delete
   */
  it('deletes the matched rows only, and returns what it deleted', async () => {
    seedUser('John', 'john@example.com');
    seedUser('Jane', 'jane@example.com');
    seedUser('Bob', 'bob@example.com');

    await service.delete(users).where(eq(users.id, 1));

    expect(client.query('SELECT name FROM users ORDER BY id').all())
      .toEqual([{ name: 'Jane' }, { name: 'Bob' }]);

    const [deleted] = await service.delete(users)
      .where(eq(users.id, 2))
      .returning();

    expect(deleted).toMatchObject({ id: 2, name: 'Jane', email: 'jane@example.com' });
    expect(client.query('SELECT name FROM users ORDER BY id').all()).toEqual([{ name: 'Bob' }]);
  });

  /**
   * @source docs:api/drizzle.md#basic-queries
   */
  it('projects columns, counts, orders with a limit, and pages with an offset', async () => {
    seedUser('John', 'john@example.com', null, null, null, '2024-01-01');
    seedUser('Jane', 'jane@example.com', null, null, null, '2024-02-01');
    seedUser('Bob', 'bob@example.com', null, null, null, '2024-03-01');

    const names = projected<{ name: string; email: string }>(
      await service.select({ name: users.name, email: users.email }).from(users),
    );

    expect(names).toEqual([
      { name: 'John', email: 'john@example.com' },
      { name: 'Jane', email: 'jane@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]);

    const countResult = projected<{ count: number }>(
      await service.select({ count: sql`count(*)` }).from(users),
    );

    expect(countResult[0].count).toBe(3);

    const recentUsers = await service.select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(2);

    // Newest first, and the limit truncates — the oldest row is absent.
    expect(recentUsers.map(user => user.name)).toEqual(['Bob', 'Jane']);

    const page = 2;
    const pageSize = 2;
    const offset = (page - 1) * pageSize;

    const pagedUsers = await service.select()
      .from(users)
      .limit(pageSize)
      .offset(offset);

    // Page 2 of 2 skips the first two rows rather than repeating page 1.
    expect(pagedUsers.map(user => user.name)).toEqual(['Bob']);
  });

  /**
   * @source docs:api/drizzle.md#filtering
   */
  it('filters with eq, and, or, like, inArray and isNull', async () => {
    seedUser('John', 'john@example.com', 'admin', 1, 30);
    seedUser('Jane', 'jane@example.com', 'moderator', 1, null);
    seedUser('Bob', 'bob@example.com', 'user', 0, 25);
    seedUser('Ann', 'ann@example.com', 'admin', 0, 40);

    const user = await service.select().from(users).where(eq(users.id, 1));

    expect(user.map(row => row.name)).toEqual(['John']);

    const admins = await service.select().from(users).where(
      and(
        eq(users.role, 'admin'),
        eq(users.active, true),
      ),
    );

    // AND excludes the INACTIVE admin — a broken `and()` that degraded to its first argument
    // would return Ann as well.
    expect(admins.map(row => row.name)).toEqual(['John']);

    const filtered = await service.select().from(users).where(
      or(
        eq(users.role, 'admin'),
        eq(users.role, 'moderator'),
      ),
    );

    expect(filtered.map(row => row.name)).toEqual(['John', 'Jane', 'Ann']);

    const searchResults = await service.select().from(users).where(
      like(users.name, '%john%'),
    );

    expect(searchResults.map(row => row.name)).toEqual(['John']);

    const specific = await service.select().from(users).where(
      inArray(users.id, [1, 2, 3]),
    );

    expect(specific.map(row => row.name)).toEqual(['John', 'Jane', 'Bob']);

    const noAge = await service.select().from(users).where(
      isNull(users.age),
    );

    expect(noAge.map(row => row.name)).toEqual(['Jane']);
  });

  /**
   * @source docs:api/drizzle.md#joins
   */
  it('joins on both sides: innerJoin drops the unmatched row, leftJoin keeps it as null', async () => {
    seedUser('John', 'john@example.com');
    seedUser('Jane', 'jane@example.com');
    client.run('INSERT INTO posts (title, author_id) VALUES (?, ?)', ['Hello', 1]);

    const postsWithAuthors = await service.select()
      .from(posts)
      .innerJoin(users, eq(posts.authorId, users.id));

    // Each row is keyed by table, and only the post that HAS an author is present.
    expect(postsWithAuthors).toHaveLength(1);
    expect(postsWithAuthors[0].posts.title).toBe('Hello');
    expect(postsWithAuthors[0].users.name).toBe('John');

    const usersWithPosts = await service.select()
      .from(users)
      .leftJoin(posts, eq(users.id, posts.authorId));

    expect(usersWithPosts).toHaveLength(2);
    expect(usersWithPosts[0].users.name).toBe('John');
    expect(usersWithPosts[0].posts?.title).toBe('Hello');
    // Jane has no post, and a LEFT join keeps her with a null right side.
    expect(usersWithPosts[1].users.name).toBe('Jane');
    expect(usersWithPosts[1].posts).toBeNull();
  });

  /**
   * @source docs:api/drizzle.md#aggregations
   */
  it('counts, groups and sums', async () => {
    seedUser('John', 'john@example.com');
    seedUser('Jane', 'jane@example.com');
    client.run('INSERT INTO posts (title, author_id) VALUES (?, ?)', ['First', 1]);
    client.run('INSERT INTO posts (title, author_id) VALUES (?, ?)', ['Second', 1]);
    client.run('INSERT INTO posts (title, author_id) VALUES (?, ?)', ['Third', 2]);
    client.run('INSERT INTO orders (amount) VALUES (100), (200), (300)');

    const total = projected<{ count: number }>(await service.select({ count: count() }).from(users));

    // count() maps to a number, not to the string SQLite hands back.
    expect(total).toEqual([{ count: 2 }]);

    const postsByUser = projected<{ authorId: number; postCount: number }>(
      await service.select({
        authorId: posts.authorId,
        postCount: count(),
      })
        .from(posts)
        .groupBy(posts.authorId),
    );

    expect(postsByUser).toEqual([
      { authorId: 1, postCount: 2 },
      { authorId: 2, postCount: 1 },
    ]);

    const totalSales = projected<{ total: string | null }>(
      await service.select({
        total: sum(orders.amount),
      }).from(orders),
    );

    expect(Number(totalSales[0].total)).toBe(600);

    // The rest of the documented aggregate imports resolve to real SQL functions too.
    const spread = projected<{ smallest: number; largest: number; mean: string }>(
      await service.select({
        smallest: min(orders.amount),
        largest: max(orders.amount),
        mean: avg(orders.amount),
      }).from(orders),
    );

    expect(Number(spread[0].smallest)).toBe(100);
    expect(Number(spread[0].largest)).toBe(300);
    expect(Number(spread[0].mean)).toBe(200);
  });

  /**
   * @source docs:api/drizzle.md#dialect-resolution
   */
  it('resolves a SQLite table to the SQLite builders and refuses the PostgreSQL escape hatch', async () => {
    seedUser('John', 'john@example.com');

    // The universal surface renders SQLite SQL — positional `?` parameters, not `$1`.
    expect(service.select().from(users).where(eq(users.id, 1)).limit(1).toSQL().sql)
      .toContain('limit ?');

    // `getSQLiteDatabase()` is a supported escape hatch, and what it returns actually queries.
    const rows = await service.getSQLiteDatabase().select().from(users).where(eq(users.name, 'John'));

    expect(rows.map(row => row.email)).toEqual(['john@example.com']);

    // "Both throw if the configured database is of the other type."
    expect(() => service.getPostgreSQLDatabase()).toThrow('Database is not PostgreSQL');
  });
});

// ---------------------------------------------------------------------------------------
// PostgreSQL query surface. Bun.SQL is lazy — no socket is opened until a query runs — so the
// SQL these chains RENDER is observable without a server, and a query that is dispatched
// fails with the statement it tried to run.
// ---------------------------------------------------------------------------------------

describe('docs/api/drizzle.md — PostgreSQL query surface', () => {
  const runs = pgTable('runs', {
    id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
    status: pgText('status').notNull(),
  });

  const outbox = pgTable('outbox', {
    id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
    payload: pgText('payload').notNull(),
  });

  let service: DrizzleService;

  beforeEach(async () => {
    DrizzleModule.clearOptions();

    const { instance } = createTestService(DrizzleService);
    service = instance;
    await service.initialize({
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: DEAD_URL },
    });
  });

  afterEach(async () => {
    await service.close();
    DrizzleModule.clearOptions();
  });

  /**
   * @source docs:api/drizzle.md#dialect-resolution
   */
  it('gives a PostgreSQL table the whole PostgreSQL chain: limit, for update, projected returning', () => {
    expect(service.select().from(runs).where(eq(runs.id, 1)).limit(1).toSQL()).toEqual({
      sql: 'select "id", "status" from "runs" where "runs"."id" = $1 limit $2',
      params: [1, 1],
    });

    // `.for('update', { skipLocked: true })` exists only on the PostgreSQL builder: if the
    // table resolved to the SQLite one this would not compile, and would not render.
    expect(service.select({ id: outbox.id }).from(outbox).limit(10).for('update', { skipLocked: true }).toSQL())
      .toEqual({
        sql: 'select "id" from "outbox" limit $1 for update skip locked',
        params: [10],
      });

    expect(service.update(runs).set({ status: 'running' }).where(eq(runs.id, 1)).returning({ id: runs.id }).toSQL())
      .toEqual({
        sql: 'update "runs" set "status" = $1 where "runs"."id" = $2 returning "id"',
        params: ['running', 1],
      });
  });

  /**
   * @source docs:api/drizzle.md#dialect-resolution
   */
  it('returns the underlying PostgreSQL instance from the escape hatch and refuses the SQLite one', () => {
    const pg = service.getPostgreSQLDatabase();

    // On PostgreSQL `getDatabase()` has no wrapper, so the escape hatch is the same instance…
    // (`getDatabase()` is typed as the dialect union, hence the widening for the comparison.)
    expect<unknown>(pg).toBe(service.getDatabase());
    // …and it is a working drizzle instance against the typed schema.
    expect(pg.select().from(runs).toSQL().sql).toBe('select "id", "status" from "runs"');

    expect(() => service.getSQLiteDatabase()).toThrow('Database is not SQLite');
  });
});

// ---------------------------------------------------------------------------------------
// Complete Example
// ---------------------------------------------------------------------------------------

describe('docs/api/drizzle.md — Complete Example', () => {
  // schema/index.ts, verbatim.
  const exampleUsers = pgTable('users', {
    id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
    name: pgText('name').notNull(),
    email: pgText('email').notNull().unique(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  });

  const examplePosts = pgTable('posts', {
    id: pgInteger('id').primaryKey().generatedAlwaysAsIdentity(),
    title: pgText('title').notNull(),
    content: pgText('content'),
    authorId: pgInteger('author_id').notNull().references(() => exampleUsers.id),
    views: pgInteger('views').default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  });

  const usersRelations = relations(exampleUsers, ({ many }) => ({
    posts: many(examplePosts),
  }));

  const postsRelations = relations(examplePosts, ({ one }) => ({
    author: one(exampleUsers, {
      fields: [examplePosts.authorId],
      references: [exampleUsers.id],
    }),
  }));

  type User = typeof exampleUsers.$inferSelect;
  type InsertUser = typeof exampleUsers.$inferInsert;

  // user.repository.ts, verbatim.
  @Service()
  class UserRepository extends BaseService {
    constructor(private db: DrizzleService) {
      super();
    }

    async findAll(): Promise<User[]> {
      // The page writes `return this.db.select()...`; this repository's lint rule wants the
      // await spelled out. Same statement, same dispatch.
      return await this.db.select().from(exampleUsers);
    }

    async findById(id: number): Promise<User | null> {
      const result = await this.db.select()
        .from(exampleUsers)
        .where(eq(exampleUsers.id, id))
        .limit(1);

      return result[0] || null;
    }

    async findByEmail(email: string): Promise<User | null> {
      const result = await this.db.select()
        .from(exampleUsers)
        .where(eq(exampleUsers.email, email))
        .limit(1);

      return result[0] || null;
    }

    async create(data: InsertUser): Promise<User> {
      const result = await this.db.insert(exampleUsers).values(data).returning();

      return result[0];
    }

    async update(id: number, data: Partial<InsertUser>): Promise<User | null> {
      const result = await this.db.update(exampleUsers)
        .set(data)
        .where(eq(exampleUsers.id, id))
        .returning();

      return result[0] || null;
    }

    async delete(id: number): Promise<boolean> {
      const result = await this.db.delete(exampleUsers)
        .where(eq(exampleUsers.id, id))
        .returning();

      return result.length > 0;
    }
  }

  let service: DrizzleService;
  let repository: UserRepository;

  /** The statement a repository method actually sent, taken from the dispatch failure. */
  const dispatched = async (call: () => Promise<unknown>): Promise<string> => {
    const error = await call().then(() => null, (cause: unknown) => cause as Error);

    return (error?.message ?? '').split('\n')[0]!;
  };

  beforeEach(async () => {
    DrizzleModule.clearOptions();

    const { instance } = createTestService(DrizzleService);
    service = instance;
    await service.initialize({
      type: DatabaseType.POSTGRESQL,
      options: { connectionString: DEAD_URL },
    });
    repository = createTestService(UserRepository, { deps: [service] }).instance;
  });

  afterEach(async () => {
    await service.close();
    DrizzleModule.clearOptions();
  });

  /**
   * @source docs:api/drizzle.md#complete-example
   */
  it('declares the schema it describes: a unique email, a real foreign key and both relation sets', () => {
    expect(exampleUsers.email.isUnique).toBe(true);
    expect(exampleUsers.createdAt.notNull).toBe(true);
    expect(examplePosts.content.notNull).toBe(false);
    expect(examplePosts.views.default).toBe(0);

    // `.references(() => users.id)` is a foreign key, not a comment.
    type InlineForeignKey = {
      reference: () => { columns: { name: string }[]; foreignColumns: { name: string }[] };
    };
    const foreignKeys = (examplePosts as unknown as Record<symbol, InlineForeignKey[]>)[
      Symbol.for('drizzle:PgInlineForeignKeys')
    ];

    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]!.reference().columns.map(column => column.name)).toEqual(['author_id']);
    expect(foreignKeys[0]!.reference().foreignColumns.map(column => column.name)).toEqual(['id']);

    // Each relations() set is bound to the table it was declared on.
    expect((usersRelations as unknown as { table: unknown }).table).toBe(exampleUsers);
    expect((postsRelations as unknown as { table: unknown }).table).toBe(examplePosts);
  });

  /**
   * @source docs:api/drizzle.md#complete-example
   */
  it('runs every repository method as the SQL the example promises', async () => {
    // The repository is a plain provider taking DrizzleService — no @Inject, no token.
    expect(getConstructorParamTypes(UserRepository)).toEqual([DrizzleService]);

    expect(await dispatched(() => repository.findAll()))
      .toBe('Failed query: select "id", "name", "email", "created_at" from "users"');

    expect(await dispatched(() => repository.findById(7)))
      .toBe('Failed query: select "id", "name", "email", "created_at" from "users" '
        + 'where "users"."id" = $1 limit $2');

    expect(await dispatched(() => repository.findByEmail('john@example.com')))
      .toBe('Failed query: select "id", "name", "email", "created_at" from "users" '
        + 'where "users"."email" = $1 limit $2');

    // The identity id and the defaulted timestamp are left to the server; `.returning()`
    // is what makes `create()` able to return the stored row.
    expect(await dispatched(() => repository.create({ name: 'John', email: 'john@example.com' })))
      .toBe('Failed query: insert into "users" ("id", "name", "email", "created_at") '
        + 'values (default, $1, $2, default) returning "id", "name", "email", "created_at"');

    // A PARTIAL update writes only the column it was given.
    expect(await dispatched(() => repository.update(7, { name: 'Jane' })))
      .toBe('Failed query: update "users" set "name" = $1 where "users"."id" = $2 '
        + 'returning "id", "name", "email", "created_at"');

    expect(await dispatched(() => repository.delete(7)))
      .toBe('Failed query: delete from "users" where "users"."id" = $1 '
        + 'returning "id", "name", "email", "created_at"');
  });
});

// ---------------------------------------------------------------------------------------
// Testing with environment variables
// ---------------------------------------------------------------------------------------

describe('docs/api/drizzle.md — environment-driven initialization', () => {
  const envKeys = ['DB_URL', 'DB_TYPE', 'DB_AUTO_MIGRATE'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    DrizzleModule.clearOptions();
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    DrizzleModule.clearOptions();
    for (const key of envKeys) {
      const value = saved[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  /**
   * @source docs:api/drizzle.md#testing-environment-variables
   */
  it('auto-initializes from DB_URL / DB_TYPE, and stays unconfigured once they are deleted', async () => {
    process.env.DB_URL = ':memory:';
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_AUTO_MIGRATE = 'false';

    const { instance: fromEnv } = createTestService(DrizzleService);
    await fromEnv.onModuleInit();

    try {
      // The environment IS the configuration: no forRoot() was called at all.
      expect(DrizzleModule.getOptions()).toBeUndefined();
      expect(fromEnv.getConnectionOptions()).toEqual({
        type: DatabaseType.SQLITE,
        options: { url: ':memory:' },
      });
      expect(fromEnv.isSQLite()).toBe(true);

      // And the database is ready when onModuleInit() resolves — no waitForInit() needed.
      fromEnv.getSQLiteClient()!.run('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, '
        + 'name TEXT NOT NULL, email TEXT NOT NULL, role TEXT, active INTEGER, age INTEGER, created_at TEXT)');
      await fromEnv.insert(users).values({ name: 'John', email: 'john@example.com' });

      expect(projected<{ name: string }>(await fromEnv.select({ name: users.name }).from(users)))
        .toEqual([{ name: 'John' }]);
    } finally {
      await fromEnv.close();
    }

    // Deleting the variables is what makes the next service unconfigured — that is why the
    // documented beforeEach clears them. Unset DB_URL is "no database", never ':memory:'.
    for (const key of envKeys) {
      delete process.env[key];
    }

    const { instance: unconfigured } = createTestService(DrizzleService);
    await unconfigured.onModuleInit();

    try {
      expect(unconfigured.getConnectionOptions()).toBeNull();
      expect(() => unconfigured.getDatabase()).toThrow('Database not initialized. Call initialize() first.');
    } finally {
      await unconfigured.close();
    }
  });
});
