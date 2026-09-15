import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { spawnSync } from 'bun';

/**
 * The environment variable the generated push config reads its connection URL from.
 *
 * The URL travels to drizzle-kit through the child process's environment rather than through the
 * config file, so the file that reaches the disk names no credential at all.
 */
const PUSH_URL_ENV = 'ONEBUN_DRIZZLE_PUSH_URL';

/**
 * Owner read/write only. The old config was written 0644 — world-readable on a shared host, for
 * as long as the drizzle-kit run took.
 */
const CONFIG_FILE_MODE = 0o600;

/**
 * Resolve caller-supplied paths against the working directory.
 *
 * The config no longer sits in the working directory, so a relative path written into it would be
 * resolved from somewhere the caller never named. Absolute paths mean the config's location cannot
 * change which files it points at — and against `process.cwd()` they mean exactly what the
 * relative spelling meant before.
 */
function absolutePaths(paths: string[]): string[] {
  return paths.map((path) => resolve(process.cwd(), path));
}

/**
 * Run a drizzle-kit command against a generated config, and leave nothing behind.
 *
 * **The config must stay in the working directory.** Moving it to an OS temp directory is the
 * obvious tidier answer and it is wrong: drizzle-kit resolves `drizzle-orm` relative to the CONFIG
 * FILE, not to the process, so a config under `/tmp` fails with "please install required packages:
 * 'drizzle-orm'" in a project that has it installed — measured against drizzle-kit 0.31.10. Do not
 * "clean this up" by moving it. What DID change: the name is unique per call, so two concurrent
 * runs no longer clobber each other's config and each other's cleanup; the mode is 0600 rather
 * than the 0644 `Bun.write` gives; and, for `pushSchema`, the file no longer carries a credential
 * at all, so a leftover after a SIGKILL is an inert stub rather than a live password on disk.
 *
 * @param options.configSource - the config file's contents
 * @param options.argv - builds the command from the config's path
 * @param options.env - extra environment for the child process
 * @param options.command - the drizzle-kit command, for the exit-code message
 * @param options.failure - what failed, for the wrapper message
 */
async function runDrizzleKit(options: {
  configSource: string;
  argv: (configPath: string) => string[];
  env?: Record<string, string>;
  command: string;
  failure: string;
}): Promise<void> {
  const configPath = resolve(process.cwd(), `drizzle.config.temp.${process.pid}-${randomUUID()}.ts`);

  try {
    await writeFile(configPath, options.configSource, { mode: CONFIG_FILE_MODE });

    const result = spawnSync(options.argv(configPath), {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: { ...process.env, ...options.env },
    });

    if (result.exitCode !== 0) {
      throw new Error(`drizzle-kit ${options.command} failed with exit code ${result.exitCode}`);
    }
  } catch (error) {
    throw new Error(`${options.failure}: ${error}`);
  } finally {
    // `force`, so a config that was never written cannot turn the real failure into an ENOENT
    // raised by this line. That is not hypothetical: `Bun.file(path).delete()` throws on a
    // missing file, and a throw inside `finally` REPLACES the error being propagated — so a
    // working directory the process could not write to used to be reported as
    // "ENOENT: unlink './drizzle.config.temp.ts'", naming the cleanup instead of the cause.
    await rm(configPath, { force: true });
  }
}

/**
 * The config source `pushSchema` writes.
 *
 * Takes no connection string, and that is the point rather than an oversight: there is no
 * parameter through which a credential could reach the file. The URL is read from the environment
 * at the far end, inside drizzle-kit's own process.
 *
 * @internal Exported for its test; not part of the package's public surface.
 */
export function buildPushConfigSource(schemaPaths: string[], dialect: 'sqlite' | 'postgresql'): string {
  return `import type { Config } from 'drizzle-kit';

export default {
  schema: ${JSON.stringify(absolutePaths(schemaPaths))},
  dialect: ${JSON.stringify(dialect)},
  dbCredentials: {
    url: process.env.${PUSH_URL_ENV} ?? '',
  },
} satisfies Config;
`;
}

/**
 * Generate migrations using drizzle-kit
 * 
 * This function generates migration files based on Drizzle table schemas defined
 * using pgTable() or sqliteTable(). The schemas should be exported from schema files
 * specified in schemaPath.
 * 
 * @param options - Migration generation options:
 *   - schemaPath: Path or paths to schema files containing pgTable/sqliteTable definitions
 *   - migrationsFolder: Output folder for migration files
 *   - dialect: Database dialect (sqlite or postgresql)
 * 
 * @example
 * ```typescript
 * // schema/users.ts
 * import { pgTable, serial, text } from 'drizzle-orm/pg-core';
 * export const users = pgTable('users', { ... });
 * 
 * // Generate migrations
 * await generateMigrations({
 *   schemaPath: './src/schema',
 *   migrationsFolder: './drizzle',
 *   dialect: 'postgresql',
 * });
 * ```
 *
 * @see docs:api/drizzle.md
 */
export async function generateMigrations(options?: {
  schemaPath?: string | string[];
  migrationsFolder?: string;
  dialect?: 'sqlite' | 'postgresql';
}): Promise<void> {
  const schemaPath = options?.schemaPath ?? './src/schema';
  const migrationsFolder = options?.migrationsFolder ?? './drizzle';
  const dialect = options?.dialect ?? 'sqlite';
  
  const schemaPaths = Array.isArray(schemaPath) ? schemaPath : [schemaPath];
  
  const configSource = `import type { Config } from 'drizzle-kit';

export default {
  schema: ${JSON.stringify(absolutePaths(schemaPaths))},
  out: ${JSON.stringify(resolve(process.cwd(), migrationsFolder))},
  dialect: ${JSON.stringify(dialect)},
} satisfies Config;
`;

  await runDrizzleKit({
    configSource,
    argv: (configPath) => ['bunx', 'drizzle-kit', 'generate', `--config=${configPath}`],
    command: 'generate',
    failure: 'Failed to generate migrations',
  });
}

/**
 * Push schema changes to database directly (without migrations)
 * 
 * This function applies schema changes directly to the database without creating
 * migration files. Useful for development, but not recommended for production.
 * 
 * @param options - Schema push options:
 *   - schemaPath: Path(s) to schema files containing pgTable/sqliteTable definitions
 *   - dialect: Database dialect ('sqlite' or 'postgresql')
 *   - connectionString: Database connection string
 * 
 * @example
 * ```typescript
 * await pushSchema({
 *   schemaPath: './src/schema',
 *   dialect: 'postgresql',
 *   connectionString: 'postgresql://user:pass@localhost/db',
 * });
 * ```
 *
 * @see docs:api/drizzle.md
 */
export async function pushSchema(options?: {
  schemaPath?: string | string[];
  dialect?: 'sqlite' | 'postgresql';
  connectionString?: string;
}): Promise<void> {
  const schemaPath = options?.schemaPath ?? './src/schema';
  const dialect = options?.dialect ?? 'sqlite';
  
  const schemaPaths = Array.isArray(schemaPath) ? schemaPath : [schemaPath];
  
  // Resolved here, handed to the child through its ENVIRONMENT, and never interpolated into the
  // config. This used to be written into `./drizzle.config.temp.ts` in the working directory: a
  // live password, in a world-readable file, in whatever repository or build context the process
  // happened to be standing in, removed only by a `finally` that a SIGKILL never reaches.
  const connectionUrl = options?.connectionString ?? process.env.DB_URL ?? ':memory:';
  // `push`, not `push:sqlite` / `push:pg`. Those were removed from drizzle-kit and the installed
  // 0.31.x answers "Unrecognized options for command 'push:pg': --config" — so this helper could
  // not have worked for anyone on the declared dependency range. The existing tests missed it
  // because they assert only `.rejects.toThrow()`, which a non-existent command satisfies.
  const command = 'push';

  await runDrizzleKit({
    configSource: buildPushConfigSource(schemaPaths, dialect),
    argv: (configPath) => ['bunx', 'drizzle-kit', command, `--config=${configPath}`],
    env: { [PUSH_URL_ENV]: connectionUrl },
    command,
    failure: 'Failed to push schema',
  });
}
