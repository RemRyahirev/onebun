/**
 * The drizzle-kit config these helpers generate: what it contains, where it lands, and that it is
 * gone afterwards.
 *
 * `pushSchema` used to write a LIVE connection string — password included — into a fixed
 * `./drizzle.config.temp.ts` in the process working directory, world-readable, removed only by a
 * `finally` block. Three exposures at once: the credential at rest, the directory it landed in (a
 * repository, a Docker build context), and the window a SIGKILL leaves open.
 */

import {
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnSync } from 'bun';
import {
  describe,
  expect,
  it,
} from 'bun:test';

import {
  buildPushConfigSource,
  generateMigrations,
  pushSchema,
} from '../src/migrations';

/** A password made of the characters that make this kind of leak easy to spot. */
const SECRET = 'hunter2-p@ss/w%x';
const SECRET_URL = `postgresql://app:${SECRET}@db.example.com:5432/orders`;

/** Owner read/write, the mode the production path asks for. */
const OWNER_ONLY = 0o600;
const PERMISSION_BITS = 0o777;

const listCwdConfigs = async (): Promise<string[]> =>
  (await readdir(process.cwd())).filter((entry) => entry.startsWith('drizzle.config.temp'));

/** A failing push carrying a password, which is the run whose cleanup used to matter. */
const failingPush = async (): Promise<Error | null> => await pushSchema({
  schemaPath: './definitely-no-such-schema',
  dialect: 'postgresql',
  connectionString: SECRET_URL,
}).then(() => null, (error: unknown) => error as Error);

describe('the generated push config carries no credential', () => {
  it('should read the URL from the environment instead of naming it', () => {
    const source = buildPushConfigSource(['./src/schema'], 'postgresql');

    expect(source).toContain('process.env.ONEBUN_DRIZZLE_PUSH_URL');
    // The builder takes no connection string at all, so there is no parameter through which one
    // could arrive. This asserts the consequence rather than the shape.
    expect(source).not.toContain('hunter2');
    expect(source).not.toContain('postgresql://');
  });

  it('should write absolute schema paths, so the child process working directory cannot change them', () => {
    const source = buildPushConfigSource(['./src/schema'], 'sqlite');

    expect(source).toContain(join(process.cwd(), 'src/schema'));
    expect(source).not.toContain('"./src/schema"');
  });
});

describe('the config file does not outlive the call', () => {
  it('should leave nothing behind when the push fails', async () => {
    const before = await listCwdConfigs();

    expect(await failingPush()).not.toBeNull();

    expect(await listCwdConfigs()).toEqual(before);
  });

  it('should leave nothing behind when generation fails', async () => {
    const before = await listCwdConfigs();

    await expect(generateMigrations({
      schemaPath: './definitely-no-such-schema',
      migrationsFolder: './definitely-no-such-out',
      dialect: 'sqlite',
    })).rejects.toThrow();

    expect(await listCwdConfigs()).toEqual(before);
  });

  it('should give each call its own name, so two at once cannot delete each other\'s config', async () => {
    const before = await listCwdConfigs();

    // Concurrent, deliberately. Under the old fixed `./drizzle.config.temp.ts` the first to finish
    // deleted the file the second was still running against.
    const failures = await Promise.all([failingPush(), failingPush(), failingPush()]);

    expect(failures.every((failure) => failure !== null)).toBe(true);
    expect(await listCwdConfigs()).toEqual(before);
  });
});

describe('the failure that is reported is the failure that happened', () => {
  it('should not replace the real error with an ENOENT from its own cleanup', async () => {
    // `Bun.file(path).delete()` throws on a missing file, and a throw inside `finally` REPLACES
    // the error being propagated — so a config that was never written used to surface as
    // "ENOENT: unlink './drizzle.config.temp.ts'", naming the cleanup instead of the cause.
    const failure = await failingPush();

    expect(failure?.message).toContain('Failed to push schema');
    expect(failure?.message).not.toContain('unlink');
  });

  it('should not print the password in its own error', async () => {
    const failure = await failingPush();

    expect(failure?.message).not.toContain(SECRET);
  });
});

describe('the command it invokes is one drizzle-kit has', () => {
  /**
   * `pushSchema` called `push:sqlite` / `push:pg`, which drizzle-kit removed. Against the declared
   * dependency range it answered "Unrecognized options for command 'push:pg': --config" and the
   * helper could not work for anyone — invisible to the existing tests, which assert only
   * `.rejects.toThrow()`, a condition a non-existent command satisfies perfectly.
   *
   * Driven against the installed drizzle-kit rather than against a string in our source, so it
   * goes red if the CLI contract moves again.
   */
  const runDrizzleKit = async (command: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'onebun-drizzle-cli-'));
    const configPath = join(dir, 'drizzle.config.ts');

    try {
      await writeFile(configPath, buildPushConfigSource(['./definitely-no-such-schema'], 'sqlite'));

      const result = spawnSync(['bunx', 'drizzle-kit', command, `--config=${configPath}`], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      return `${result.stdout.toString()}${result.stderr.toString()}`;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('should accept `push`, the command the helper now uses', async () => {
    expect(await runDrizzleKit('push')).not.toContain('Unrecognized options');
  });

  it('should reject `push:pg`, the command the helper used to use', async () => {
    expect(await runDrizzleKit('push:pg')).toContain('Unrecognized options');
  });
});

describe('the config is written owner-only', () => {
  it('should produce a 0600 file from the mode the helper passes', async () => {
    // A surrogate: the real config is gone by the time a caller could stat it. What this pins is
    // that `mode` is honoured on this platform, so the argument in the production path is load
    // bearing rather than decorative — `Bun.write`, which it replaced, gives 0644 (measured).
    const dir = await mkdtemp(join(tmpdir(), 'onebun-drizzle-mode-'));
    const file = join(dir, 'drizzle.config.ts');

    try {
      await writeFile(file, 'x', { mode: OWNER_ONLY });

       
      expect((await stat(file)).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
