/**
 * Documentation coverage for `docs/api/envs.md` — the sections `docs-examples.test.ts` leaves
 * unpinned. Each test states the promise its section makes to the reader, and fails if the
 * framework stops keeping it.
 *
 * The page's snippets import from `@onebun/core`, which re-exports this package. `@onebun/envs`
 * sits below core in the dependency graph and cannot resolve `@onebun/core` — it is neither a
 * dependency nor linked into `packages/envs/node_modules` — so the imports below go through this
 * package's own entry point instead (`src/index.ts` is its `main`, `module` and `types`).
 *
 * @source docs:api/envs.md
 */

import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import {
  clearGetConfigCache,
  Env,
  EnvValidationError,
  getConfig,
  type EnvSchema,
  type InferConfigType,
  type SensitiveValue,
} from '../src';

/**
 * Run `body` with `names` removed from `process.env`, then restore exactly what was there.
 *
 * Every loader path merges `process.env` in, so a variable that happens to exist in the shell
 * (`PORT`, `HOST`, `DEBUG`, `NODE_ENV`) would otherwise decide the outcome of a test about
 * declared defaults.
 */
function withoutEnv<T>(names: readonly string[], body: () => T): T {
  const saved = names.map((name) => [name, process.env[name]] as const);

  for (const name of names) {
    delete process.env[name];
  }

  try {
    return body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/**
 * Invariant type equality: `true` only when the two types are mutually identical. A widened
 * `unknown`, an added `| undefined` or a lost nesting level all turn it into `false`, which
 * collapses `ExactConfig` below to `never` and makes the value annotated with it a compile
 * error under `bun run typecheck`. `bun test` cannot observe an inferred type at all.
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

describe('Options Interface (docs/api/envs.md)', () => {
  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * `EnvVariableConfig` is documented field by field. This pins the four that are observable at
   * runtime on one variable each: `env` decides which variable is read, `type` decides how the
   * raw string is parsed, `default` fills in for a variable that is not configured, `sensitive`
   * swaps `get()` for a wrapper and masks `getSafeConfig()`, and `separator` splits an array.
   *
   * @source docs:api/envs.md#options-interface
   */
  it('should honour env, type, default, sensitive and separator on one variable', () => {
    const schema: EnvSchema<{ db: { url: string; timeoutMs: number; tags: string[] } }> = {
      db: {
        url: Env.string({
          env: 'DOCS_OPTS_URL',
          required: true,
          sensitive: true,
          description: 'Primary DSN',
        }),
        timeoutMs: Env.number({ env: 'DOCS_OPTS_TIMEOUT', default: 250 }),
        tags: Env.array({ env: 'DOCS_OPTS_TAGS', separator: ';' }),
      },
    };

    const config = withoutEnv(['DOCS_OPTS_TIMEOUT'], () =>
      getConfig(schema, {
        loadDotEnv: false,
        valueOverrides: {
          DOCS_OPTS_URL: 'postgres://user:hunter2@db:5432/app',
          DOCS_OPTS_TAGS: 'alpha; beta ;gamma',
        },
      }));

    // `type: 'number'` + `default`: the variable is unset, so the declared default stands — and
    // it stays a number rather than becoming the string the environment would have carried.
    expect(config.get('db.timeoutMs')).toBe(250);

    // `separator`: ';' splits, and the items are trimmed.
    expect(config.get('db.tags')).toEqual(['alpha', 'beta', 'gamma']);

    // `sensitive`: get() returns the wrapper, `.value` the real string, getSafeConfig() the mask.
    const url = config.get('db.url') as unknown as SensitiveValue<string>;

    expect(url.toString()).toBe('***');
    expect(url.value).toBe('postgres://user:hunter2@db:5432/app');
    expect(config.getSafeConfig()).toEqual({
      db: { url: '***', timeoutMs: 250, tags: ['alpha', 'beta', 'gamma'] },
    });

    // `description` is documentation only — it is kept on the config object and never parsed.
    expect(schema.db.url).toHaveProperty('description', 'Primary DSN');
  });

  /**
   * The paragraph under the interface: `min`/`max` (numbers) and `minLength`/`maxLength` (arrays)
   * "are helper options that build the `validate` function for you — they are not fields of
   * `EnvVariableConfig`". Both halves are observable: the keys are absent from the object the
   * helper returns, and a value outside the range is rejected by the validator they built.
   *
   * @source docs:api/envs.md#options-interface
   */
  it('should turn min/max and minLength/maxLength into a validator instead of a field', () => {
    const port = Env.number({ default: 3000, min: 1, max: 65535 });
    const tags = Env.array({ minLength: 1, maxLength: 2 });

    expect(port).not.toHaveProperty('min');
    expect(port).not.toHaveProperty('max');
    expect(tags).not.toHaveProperty('minLength');
    expect(tags).not.toHaveProperty('maxLength');

    const numberSchema: EnvSchema<{ server: { port: number } }> = {
      server: { port: Env.number({ env: 'DOCS_OPTS_PORT', default: 3000, max: 65535 }) },
    };
    const arraySchema: EnvSchema<{ app: { tags: string[] } }> = {
      app: { tags: Env.array({ env: 'DOCS_OPTS_LIST', maxLength: 2 }) },
    };

    expect(() =>
      getConfig(numberSchema, {
        loadDotEnv: false,
        valueOverrides: { DOCS_OPTS_PORT: 99999 },
      })).toThrow('Value must be <= 65535');

    expect(() =>
      getConfig(arraySchema, {
        loadDotEnv: false,
        valueOverrides: { DOCS_OPTS_LIST: 'a,b,c' },
      })).toThrow('Array must have at most 2 items');
  });
});

describe('Defining Schema (docs/api/envs.md)', () => {
  type DocsConfig = {
    server: { port: number; host: string };
    database: { url: string; maxConnections: number; ssl: boolean };
    redis: { host: string; port: number; password: string };
    features: { enableCache: boolean; allowedOrigins: string[] };
    app: { name: string; version: string; debug: boolean };
  };

  // A fresh object per call: getConfig caches by schema reference.
  const buildSchema = (): EnvSchema<DocsConfig> => ({
    server: {
      port: Env.number({ default: 3000, env: 'PORT' }),
      host: Env.string({ default: '0.0.0.0', env: 'HOST' }),
    },
    database: {
      url: Env.string({ env: 'DATABASE_URL', required: true, sensitive: true }),
      maxConnections: Env.number({ default: 10, env: 'DB_MAX_CONNECTIONS' }),
      ssl: Env.boolean({ default: true, env: 'DB_SSL' }),
    },
    redis: {
      host: Env.string({ default: 'localhost', env: 'REDIS_HOST' }),
      port: Env.number({ default: 6379, env: 'REDIS_PORT' }),
      password: Env.string({ env: 'REDIS_PASSWORD', sensitive: true, required: false }),
    },
    features: {
      enableCache: Env.boolean({ default: true }),
      allowedOrigins: Env.array({
        default: ['http://localhost:3000'],
        env: 'ALLOWED_ORIGINS',
        separator: ',',
      }),
    },
    app: {
      name: Env.string({ default: 'my-app' }),
      version: Env.string({ default: '1.0.0' }),
      debug: Env.boolean({ default: false, env: 'DEBUG' }),
    },
  });

  const declaredNames = [
    'PORT',
    'HOST',
    'DATABASE_URL',
    'DB_MAX_CONNECTIONS',
    'DB_SSL',
    'REDIS_HOST',
    'REDIS_PORT',
    'REDIS_PASSWORD',
    'FEATURES_ENABLECACHE',
    'ALLOWED_ORIGINS',
    'APP_NAME',
    'APP_VERSION',
    'DEBUG',
  ];

  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * "Nested structure becomes dotted paths": the page's schema is the canonical one, and this
   * pins the whole tree it produces — every declared default, both `env` renames and derived
   * names, the array split, the boolean parse, and both `sensitive` entries masked.
   *
   * @source docs:api/envs.md#defining-schema
   */
  it('should parse the page schema into the documented defaults and masked secrets', () => {
    const config = withoutEnv(declaredNames, () =>
      getConfig(buildSchema(), {
        loadDotEnv: false,
        valueOverrides: {
          DATABASE_URL: 'postgres://app:hunter2@db:5432/app',
          REDIS_PASSWORD: 's3cret',
          ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
          DB_SSL: 'false',
          DEBUG: 'true',
        },
      }));

    expect(config.getSafeConfig()).toEqual({
      server: { port: 3000, host: '0.0.0.0' },
      database: { url: '***', maxConnections: 10, ssl: false },
      redis: { host: 'localhost', port: 6379, password: '***' },
      features: {
        enableCache: true,
        allowedOrigins: ['https://a.example.com', 'https://b.example.com'],
      },
      app: { name: 'my-app', version: '1.0.0', debug: true },
    });

    // The mask is a copy — the code that needs the secret still reaches it through `.value`.
    const url = config.get('database.url') as unknown as SensitiveValue<string>;

    expect(url.value).toBe('postgres://app:hunter2@db:5432/app');
  });

  /**
   * The same schema marks `database.url` as `required: true`. That is the one entry with no
   * default, so a config built without it must not come back half-built.
   *
   * @source docs:api/envs.md#defining-schema
   */
  it('should refuse to build the config when the required DATABASE_URL is missing', () => {
    expect(() =>
      withoutEnv(declaredNames, () => getConfig(buildSchema(), { loadDotEnv: false })))
      .toThrow(
        'Environment variable validation failed for "DATABASE_URL":'
        + ' Required variable is not set. Got: not set',
      );
  });
});

describe('Type Inference and Module Augmentation (docs/api/envs.md)', () => {
  const envSchema = {
    server: {
      port: Env.number({ default: 3000, env: 'DOCS_INFER_PORT' }),
      host: Env.string({ default: '0.0.0.0', env: 'DOCS_INFER_HOST' }),
    },
    database: {
      url: Env.string({ required: true, env: 'DOCS_INFER_URL' }),
    },
  };

  type Config = InferConfigType<typeof envSchema>;

  /**
   * `Config`, but only while it is exactly the type the page prints — `never` otherwise. Every
   * value annotated with it is therefore a compile-time assertion that `InferConfigType` still
   * infers what the section shows, checked by `bun run typecheck` rather than by this run.
   */
  type ExactConfig = Equals<
    Config,
    { server: { port: number; host: string }; database: { url: string } }
  > extends true
    ? Config
    : never;

  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * The page prints the inferred result verbatim: `{ server: { port: number; host: string };
   * database: { url: string } }`. That claim is a statement about a type, so no assertion in this
   * run can carry it: it rides on the `ExactConfig` annotation below, which stops compiling under
   * `bun run typecheck` the moment `InferConfigType` widens, narrows or flattens a leaf.
   *
   * What this run does pin is the tree the loader builds behind that type: every documented path
   * resolves, the declared defaults stand for the two unset variables, and the values arrive
   * already converted — `3000` the number, not `'3000'` the string the environment carries.
   *
   * @source docs:api/envs.md#inferconfigtype
   */
  it('should build the tree the page prints, with the value types it prints', () => {
    const config = withoutEnv(['DOCS_INFER_PORT', 'DOCS_INFER_HOST'], () =>
      getConfig<Config>(envSchema, {
        loadDotEnv: false,
        valueOverrides: { DOCS_INFER_URL: 'postgres://localhost:5432/app' },
      }));

    // The annotations are part of the pin: `get()` must resolve the dotted path to the inferred
    // type, not to `unknown`.
    const port: number = config.get('server.port');
    const host: string = config.get('server.host');
    const url: string = config.get('database.url');

    // toBe is strict, so a leaf left as the raw string fails here rather than passing as equal.
    expect(port).toBe(3000);
    expect(host).toBe('0.0.0.0');
    expect(url).toBe('postgres://localhost:5432/app');

    // Annotated with `ExactConfig`, so the deep-equal below carries the runtime shape while the
    // annotation carries the inferred one — one value, both channels.
    const documented: ExactConfig = {
      server: { port: 3000, host: '0.0.0.0' },
      database: { url: 'postgres://localhost:5432/app' },
    };

    expect(config.values).toEqual(documented);
  });

  /**
   * "After this setup, `this.config.get('server.port')` in any controller or service will return
   * `number` (not `unknown`)." The `declare module '@onebun/core'` half is compile-time only and
   * lives in core; what this package owes the augmentation is the object `this.config` is bound
   * to — a `ConfigProxy<AppConfig>` whose dotted `get()` returns the schema's declared type,
   * carrying the value the environment actually supplied rather than the raw string.
   *
   * @source docs:api/envs.md#module-augmentation
   */
  it('should hand back the schema declared type for a dotted path', () => {
    const appSchema = {
      server: {
        port: Env.number({ default: 3000, env: 'DOCS_AUGMENT_PORT' }),
      },
    };

    type AppConfig = InferConfigType<typeof appSchema>;

    const config = getConfig<AppConfig>(appSchema, {
      loadDotEnv: false,
      valueOverrides: { DOCS_AUGMENT_PORT: 4321 },
    });

    const port: number = config.get('server.port');
    const values: AppConfig = config.values;

    expect(port).toBe(4321);
    expect(values).toEqual({ server: { port: 4321 } });
  });

  /**
   * "If you don't use module augmentation, you can still access config but need type assertions."
   * The cast is a compile-time formality — the value behind it is the same parsed one, already
   * converted to the declared type, so `as number` never turns out to be a lie.
   *
   * @source docs:api/envs.md#without-module-augmentation
   */
  it('should return the same parsed value through an untyped get', () => {
    const schema: EnvSchema<{ server: { port: number } }> = {
      server: { port: Env.number({ default: 3000, env: 'DOCS_NOAUG_PORT' }) },
    };

    // Without the augmentation `this.config` is not narrowed to the app's schema: the path is a
    // plain string and the result has to be asserted at the call site.
    const untypedConfig: { get(path: string): unknown } = getConfig(schema, {
      loadDotEnv: false,
      valueOverrides: { DOCS_NOAUG_PORT: 4000 },
    });

    const port = untypedConfig.get('server.port') as number;

    // toBe is strict: the string '4000' the environment carried would not satisfy it.
    expect(port).toBe(4000);
  });
});

describe('Loading Configuration — In Application (docs/api/envs.md)', () => {
  let envDir: string;
  let envFilePath: string;

  const buildSchema = (): EnvSchema<{ server: { port: number; host: string } }> => ({
    server: {
      port: Env.number({ default: 3000, env: 'DOCS_APP_PORT' }),
      host: Env.string({ default: '0.0.0.0', env: 'DOCS_APP_HOST' }),
    },
  });

  const fileNames = ['DOCS_APP_PORT', 'DOCS_APP_HOST'];

  beforeAll(() => {
    envDir = mkdtempSync(join(tmpdir(), 'onebun-envs-docs-'));
    envFilePath = join(envDir, '.env');
    writeFileSync(envFilePath, 'DOCS_APP_PORT=4100\nDOCS_APP_HOST=127.0.0.1\n');
  });

  afterAll(() => {
    rmSync(envDir, { recursive: true, force: true });
  });

  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * `envOptions.envFilePath` names the file and `envOptions.loadDotEnv` decides whether it is
   * read at all. With the file switched off the declared defaults must come back instead —
   * otherwise `loadDotEnv: false` is decoration.
   *
   * @source docs:api/envs.md#in-application
   */
  it('should read envFilePath only while loadDotEnv is true', () => {
    const loaded = withoutEnv(fileNames, () =>
      getConfig(buildSchema(), { envFilePath, loadDotEnv: true }));

    expect(loaded.values).toEqual({ server: { port: 4100, host: '127.0.0.1' } });

    const ignored = withoutEnv(fileNames, () =>
      getConfig(buildSchema(), { envFilePath, loadDotEnv: false }));

    expect(ignored.values).toEqual({ server: { port: 3000, host: '0.0.0.0' } });
  });

  /**
   * `envOverridesDotEnv` is documented as "Process.env overrides .env file (default: true)".
   * Both directions are pinned, from one file and one process variable that disagree.
   *
   * @source docs:api/envs.md#in-application
   */
  it('should let process.env beat the .env file only while envOverridesDotEnv is true', () => {
    const previous = process.env.DOCS_APP_PORT;
    process.env.DOCS_APP_PORT = '4200';

    try {
      const processWins = getConfig(buildSchema(), { envFilePath, envOverridesDotEnv: true });

      expect(processWins.get('server.port')).toBe(4200);

      const dotEnvWins = getConfig(buildSchema(), { envFilePath, envOverridesDotEnv: false });

      expect(dotEnvWins.get('server.port')).toBe(4100);
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_APP_PORT;
      } else {
        process.env.DOCS_APP_PORT = previous;
      }
    }
  });

  /**
   * The snippet's own warning: "Use actual env variable names, not dot-notation paths".
   * A path-keyed override has to be inert, or the note is describing nothing.
   *
   * @source docs:api/envs.md#in-application
   */
  it('should apply valueOverrides by variable name and ignore dotted paths', () => {
    const previous = process.env.DOCS_APP_PORT;
    process.env.DOCS_APP_PORT = '4200';

    try {
      // Highest priority: beats both process.env and the .env file.
      const byName = getConfig(buildSchema(), {
        envFilePath,
        valueOverrides: { DOCS_APP_PORT: 4000 },
      });

      expect(byName.get('server.port')).toBe(4000);
    } finally {
      if (previous === undefined) {
        delete process.env.DOCS_APP_PORT;
      } else {
        process.env.DOCS_APP_PORT = previous;
      }
    }

    // The mistake the note warns about: a key spelled as the schema path instead of the
    // variable name. Assigned rather than written as a literal so the dotted key survives lint.
    const pathKeyedOverrides: Record<string, number> = {};
    pathKeyedOverrides['server.port'] = 4000;

    const byPath = withoutEnv(fileNames, () =>
      getConfig(buildSchema(), { loadDotEnv: false, valueOverrides: pathKeyedOverrides }));

    // The dotted key names no environment variable, so the declared default stands.
    expect(byPath.get('server.port')).toBe(3000);
  });

  /**
   * `defaultArraySeparator` is read only where the variable itself declares no `separator`
   * (`config.separator || options.defaultArraySeparator || ','`). `Env.array()` always writes
   * `separator: ','` of its own, so the option never reaches an array declared the way the rest
   * of the page declares one — measured, not assumed.
   *
   * @source docs:api/envs.md#in-application
   */
  it('should apply defaultArraySeparator only where the variable declares no separator', () => {
    const rawSchema: EnvSchema<{ tags: string[] }> = {
      tags: { type: 'array', env: 'DOCS_APP_TAGS' },
    };
    const helperSchema: EnvSchema<{ tags: string[] }> = {
      tags: Env.array({ env: 'DOCS_APP_TAGS' }),
    };

    const raw = getConfig(rawSchema, {
      loadDotEnv: false,
      defaultArraySeparator: '|',
      valueOverrides: { DOCS_APP_TAGS: 'a|b|c' },
    });

    expect(raw.get('tags')).toEqual(['a', 'b', 'c']);

    const viaHelper = getConfig(helperSchema, {
      loadDotEnv: false,
      defaultArraySeparator: '|',
      valueOverrides: { DOCS_APP_TAGS: 'a|b|c' },
    });

    // The helper's own ',' wins, so the value stays one unsplit item.
    expect(viaHelper.get('tags')).toEqual(['a|b|c']);
  });
});

describe('Environment Variable Naming (docs/api/envs.md)', () => {
  type NamingConfig = {
    server: { port: number };
    database: { url: string; maxConnections: number };
    redis: { host: string };
  };

  const buildSchema = (): EnvSchema<NamingConfig> => ({
    server: { port: Env.number({ default: 3000 }) },
    database: {
      url: Env.string({ default: 'postgres://localhost:5432/app' }),
      maxConnections: Env.number({ default: 10 }),
    },
    redis: { host: Env.string({ default: 'localhost' }) },
  });

  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * The naming table: `server.port` → `SERVER_PORT`, `database.url` → `DATABASE_URL`,
   * `redis.host` → `REDIS_HOST`. The conversion is uppercase-plus-underscore-for-dots only, so a
   * camelCase key becomes one word — `database.maxConnections` is `DATABASE_MAXCONNECTIONS`, and
   * the underscored spelling an operator would guess names nothing at all.
   *
   * @source docs:api/envs.md#environment-variable-naming
   */
  it('should derive the variable name from the dotted path when env is omitted', () => {
    const config = getConfig(buildSchema(), {
      loadDotEnv: false,
      valueOverrides: {
        SERVER_PORT: 8080,
        DATABASE_URL: 'postgres://db:5432/app',
        DATABASE_MAXCONNECTIONS: 25,
        REDIS_HOST: 'redis.internal',
      },
    });

    expect(config.values).toEqual({
      server: { port: 8080 },
      database: { url: 'postgres://db:5432/app', maxConnections: 25 },
      redis: { host: 'redis.internal' },
    });

    const guessed = withoutEnv(['DATABASE_MAXCONNECTIONS'], () =>
      getConfig(buildSchema(), {
        loadDotEnv: false,
        valueOverrides: { DATABASE_MAX_CONNECTIONS: 25 },
      }));

    expect(guessed.get('database.maxConnections')).toBe(10);
  });

  /**
   * "Override with `env` option": the declared name is read and the derived one stops being
   * consulted, so a stale `SERVER_PORT` in the environment cannot win.
   *
   * @source docs:api/envs.md#environment-variable-naming
   */
  it('should read the name given by env and ignore the derived one', () => {
    const schema: EnvSchema<{ server: { port: number } }> = {
      server: { port: Env.number({ env: 'PORT', default: 3000 }) },
    };

    const config = getConfig(schema, {
      loadDotEnv: false,
      valueOverrides: { PORT: 4000, SERVER_PORT: 9999 },
    });

    expect(config.get('server.port')).toBe(4000);
  });
});

describe('Array Variables (docs/api/envs.md)', () => {
  const buildSchema = (): EnvSchema<{ allowedHosts: string[] }> => ({
    allowedHosts: Env.array({
      default: ['localhost'],
      env: 'ALLOWED_HOSTS',
      separator: ',',
    }),
  });

  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * The section's worked example: `ALLOWED_HOSTS=example.com,api.example.com,localhost` becomes
   * a three-item array. Whitespace around a separator is the shape a hand-edited .env has, so the
   * items come back trimmed rather than padded.
   *
   * @source docs:api/envs.md#array-variables
   */
  it('should split the variable on its separator and trim the items', () => {
    const config = getConfig(buildSchema(), {
      loadDotEnv: false,
      valueOverrides: { ALLOWED_HOSTS: 'example.com, api.example.com ,localhost' },
    });

    expect(config.get('allowedHosts')).toEqual([
      'example.com',
      'api.example.com',
      'localhost',
    ]);

    const custom: EnvSchema<{ allowedHosts: string[] }> = {
      allowedHosts: Env.array({ env: 'ALLOWED_HOSTS_SEMI', separator: ';' }),
    };
    const semicolonSeparated = getConfig(custom, {
      loadDotEnv: false,
      valueOverrides: { ALLOWED_HOSTS_SEMI: 'a.example.com; b.example.com' },
    });

    expect(semicolonSeparated.get('allowedHosts')).toEqual(['a.example.com', 'b.example.com']);
  });

  /**
   * `default: ['localhost']` is an array literal, not a string: an unset variable yields the
   * array itself, not a one-item array holding its serialization.
   *
   * @source docs:api/envs.md#array-variables
   */
  it('should fall back to the declared default when the variable is unset', () => {
    const config = withoutEnv(['ALLOWED_HOSTS'], () =>
      getConfig(buildSchema(), { loadDotEnv: false }));

    expect(config.get('allowedHosts')).toEqual(['localhost']);
  });
});

describe('Catching Startup Errors (docs/api/envs.md)', () => {
  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * The snippet's catch block reads `error.message` and `error.variable`. Both have to be filled
   * in for a failed boot to be diagnosable: the message names the variable and the reason, and
   * `variable` carries the environment variable name on its own so an operator can grep for it.
   *
   * @source docs:api/envs.md#catching-startup-errors
   */
  it('should throw EnvValidationError carrying the variable name', () => {
    const schema: EnvSchema<{ database: { url: string } }> = {
      database: { url: Env.string({ env: 'DOCS_STARTUP_URL', required: true }) },
    };

    let caught: unknown;

    try {
      withoutEnv(['DOCS_STARTUP_URL'], () => getConfig(schema, { loadDotEnv: false }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);

    const error = caught as EnvValidationError;

    expect(error.message).toBe(
      'Environment variable validation failed for "DOCS_STARTUP_URL":'
      + ' Required variable is not set. Got: not set',
    );
    expect(error.variable).toBe('DOCS_STARTUP_URL');
    expect(error.name).toBe('EnvValidationError');
  });

  /**
   * The comment on the snippet's third `console.error`: "A description such as 'a string of
   * length 21' — never the value itself". An operator who copies that catch block into a service
   * must not have it ship the rejected value to the log aggregator.
   *
   * @source docs:api/envs.md#catching-startup-errors
   */
  it('should put a description in error value, never the rejected value', () => {
    const schema: EnvSchema<{ server: { port: number } }> = {
      server: { port: Env.number({ env: 'DOCS_STARTUP_PORT', required: true }) },
    };

    let caught: unknown;

    try {
      getConfig(schema, { loadDotEnv: false, valueOverrides: { DOCS_STARTUP_PORT: 'abc' } });
    } catch (error) {
      caught = error;
    }

    const error = caught as EnvValidationError;

    expect(error.value).toBe('a string of length 3');
    expect(error.message).toBe(
      'Environment variable validation failed for "DOCS_STARTUP_PORT":'
      + ' Value is not a valid number. Got: a string of length 3',
    );
    // Nothing a structured logger could serialize carries the value itself.
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('abc');
  });
});

describe('Complete Example (docs/api/envs.md)', () => {
  type CompleteConfig = {
    server: { port: number; host: string };
    database: { url: string; poolSize: number; ssl: boolean };
    auth: { jwtSecret: string; jwtExpiresIn: string; bcryptRounds: number };
    cache: { enabled: boolean; ttl: number; redis: { host: string; port: number } };
    cors: { origins: string[]; credentials: boolean };
    logging: { level: string; format: string };
  };

  const buildSchema = (): EnvSchema<CompleteConfig> => ({
    server: {
      port: Env.number({ default: 3000, env: 'PORT', validate: Env.port() }),
      host: Env.string({ default: '0.0.0.0' }),
    },
    database: {
      url: Env.string({ env: 'DATABASE_URL', required: true, sensitive: true }),
      poolSize: Env.number({ default: 10 }),
      ssl: Env.boolean({ default: process.env.NODE_ENV === 'production' }),
    },
    auth: {
      jwtSecret: Env.string({ env: 'JWT_SECRET', required: true, sensitive: true }),
      jwtExpiresIn: Env.string({ default: '7d' }),
      bcryptRounds: Env.number({ default: 10 }),
    },
    cache: {
      enabled: Env.boolean({ default: true }),
      ttl: Env.number({ default: 300 }),
      redis: {
        host: Env.string({ default: 'localhost' }),
        port: Env.number({ default: 6379 }),
      },
    },
    cors: {
      origins: Env.array({ default: ['http://localhost:3000'], env: 'CORS_ORIGINS' }),
      credentials: Env.boolean({ default: true }),
    },
    logging: {
      level: Env.string({
        default: 'info',
        validate: Env.oneOf(['trace', 'debug', 'info', 'warn', 'error']),
      }),
      format: Env.string({
        default: 'json',
        validate: Env.oneOf(['json', 'pretty']),
      }),
    },
  });

  const declaredNames = [
    'NODE_ENV',
    'PORT',
    'SERVER_HOST',
    'DATABASE_URL',
    'DATABASE_POOLSIZE',
    'DATABASE_SSL',
    'JWT_SECRET',
    'AUTH_JWTEXPIRESIN',
    'AUTH_BCRYPTROUNDS',
    'CACHE_ENABLED',
    'CACHE_TTL',
    'CACHE_REDIS_HOST',
    'CACHE_REDIS_PORT',
    'CORS_ORIGINS',
    'CORS_CREDENTIALS',
    'LOGGING_LEVEL',
    'LOGGING_FORMAT',
  ];

  const secrets = {
    databaseUrl: 'postgres://app:hunter2@db:5432/app',
    jwtSecret: 'a-very-long-signing-key',
  };

  afterEach(() => {
    clearGetConfigCache();
  });

  /**
   * The page's final `config.ts` in full: three levels of nesting (`cache.redis.port` →
   * `CACHE_REDIS_PORT`), two secrets, an array with a default, and two `Env.oneOf` validators.
   * The whole parsed tree is pinned at once, together with what `config.getSafeConfig()` — the
   * value the snippet's `logger.info` hands to the log aggregator — is allowed to contain.
   *
   * @source docs:api/envs.md#complete-example
   */
  it('should parse the whole page schema into the documented values', () => {
    const config = withoutEnv(declaredNames, () => {
      // The ssl default is `process.env.NODE_ENV === 'production'`, evaluated when the schema
      // module is evaluated — so the environment has to be settled before buildSchema() runs.
      process.env.NODE_ENV = 'test';

      return getConfig(buildSchema(), {
        loadDotEnv: false,
        valueOverrides: {
          DATABASE_URL: secrets.databaseUrl,
          JWT_SECRET: secrets.jwtSecret,
        },
      });
    });

    expect(config.getSafeConfig()).toEqual({
      server: { port: 3000, host: '0.0.0.0' },
      database: { url: '***', poolSize: 10, ssl: false },
      auth: { jwtSecret: '***', jwtExpiresIn: '7d', bcryptRounds: 10 },
      cache: {
        enabled: true,
        ttl: 300,
        redis: { host: 'localhost', port: 6379 },
      },
      cors: { origins: ['http://localhost:3000'], credentials: true },
      logging: { level: 'info', format: 'json' },
    });

    const jwtSecret = config.get('auth.jwtSecret') as unknown as SensitiveValue<string>;

    expect(jwtSecret.value).toBe(secrets.jwtSecret);
    expect(JSON.stringify(config.getSafeConfig())).not.toContain('hunter2');
  });

  /**
   * The same schema's three guards, from a booting process's point of view: a missing secret,
   * a port `Env.port()` rejects, and a log level outside `Env.oneOf`. Each has to stop the
   * config from being built — a schema that validates nothing would still pass the test above.
   *
   * @source docs:api/envs.md#complete-example
   */
  it('should fail on a missing secret, a bad port and an unknown log level', () => {
    expect(() =>
      withoutEnv(declaredNames, () =>
        getConfig(buildSchema(), {
          loadDotEnv: false,
          valueOverrides: { DATABASE_URL: secrets.databaseUrl },
        }))).toThrow(
      'Environment variable validation failed for "JWT_SECRET":'
      + ' Required variable is not set. Got: not set',
    );

    expect(() =>
      withoutEnv(declaredNames, () =>
        getConfig(buildSchema(), {
          loadDotEnv: false,
          valueOverrides: {
            DATABASE_URL: secrets.databaseUrl,
            JWT_SECRET: secrets.jwtSecret,
            PORT: 70000,
          },
        }))).toThrow('Port must be an integer between 1 and 65535');

    expect(() =>
      withoutEnv(declaredNames, () =>
        getConfig(buildSchema(), {
          loadDotEnv: false,
          valueOverrides: {
            DATABASE_URL: secrets.databaseUrl,
            JWT_SECRET: secrets.jwtSecret,
            LOGGING_LEVEL: 'verbose',
          },
        }))).toThrow('Value must be one of: trace, debug, info, warn, error');
  });
});
