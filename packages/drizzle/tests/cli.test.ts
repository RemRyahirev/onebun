/**
 * CLI tests for onebun-drizzle wrapper
 * Tests CLI commands: generate, push
 * 
 * Note: Tests use schema files from the tests directory to ensure drizzle-orm is resolvable
 */
import {
  mkdtemp,
  rm,
  readdir,
  mkdir,
} from 'fs/promises';
import { join } from 'path';

import { spawn } from 'bun';
import {
  describe,
  expect,
  test,
  afterEach,
  beforeEach,
} from 'bun:test';

// Get the workspace root (where node_modules is located)
const workspaceRoot = join(__dirname, '..', '..', '..');
const testsDir = __dirname;

describe('CLI wrapper (bin/drizzle-kit.ts)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create temporary directory inside the tests folder for output
    const tmpBase = join(testsDir, '.tmp-cli');
    await mkdir(tmpBase, { recursive: true });
    tmpDir = await mkdtemp(join(tmpBase, 'test-'));
  });

  afterEach(async () => {
    // Cleanup temporary directory
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('generate command', () => {
    test('generates migration files from SQLite schema', async () => {
      // Use existing test-schema.ts that has proper imports
      const schemaPath = join(testsDir, 'test-schema.ts');
      const migrationsFolder = join(tmpDir, 'drizzle');
      const configPath = join(tmpDir, 'drizzle.config.ts');

      // Create drizzle config file pointing to the existing test schema
      await Bun.write(configPath, `
import type { Config } from 'drizzle-kit';

export default {
  schema: '${schemaPath}',
  out: '${migrationsFolder}',
  dialect: 'sqlite',
} satisfies Config;
`);

      // Run generate command using CLI wrapper
      const cliPath = join(__dirname, '..', 'bin', 'drizzle-kit.ts');
      const proc = spawn(['bun', cliPath, 'generate', `--config=${configPath}`], {
        cwd: testsDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      // Check that migration files were created
      if (exitCode === 0) {
        const files = await readdir(migrationsFolder);
        expect(files.some(f => f.endsWith('.sql'))).toBe(true);

        // Check that meta folder was created
        const metaFiles = await readdir(join(migrationsFolder, 'meta'));
        expect(metaFiles.some(f => f === '_journal.json')).toBe(true);

        // Read and verify SQL content
        const sqlFile = files.find(f => f.endsWith('.sql'))!;
        const sqlContent = await Bun.file(join(migrationsFolder, sqlFile)).text();
        expect(sqlContent).toContain('CREATE TABLE');
        // The test-schema.ts creates a 'users' table
        expect(sqlContent).toContain('users');
      } else {
        // eslint-disable-next-line no-console
        console.error('CLI generate failed:', stderr);
        expect(exitCode).toBe(0);
      }
    }, 30000); // 30 second timeout for CLI command

    test('returns non-zero exit code when schema file does not exist', async () => {
      const configPath = join(tmpDir, 'drizzle.config.ts');

      // Create drizzle config pointing to non-existent schema
      await Bun.write(configPath, `
import type { Config } from 'drizzle-kit';

export default {
  schema: './non-existent-schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
} satisfies Config;
`);

      const cliPath = join(__dirname, '..', 'bin', 'drizzle-kit.ts');
      const proc = spawn(['bun', cliPath, 'generate', `--config=${configPath}`], {
        cwd: tmpDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;

      // Should fail with non-zero exit code
      expect(exitCode).not.toBe(0);
    }, 30000);
  });

  describe('push command', () => {
    test('pushes SQLite schema to database file', async () => {
      // Use existing test-schema.ts that has proper imports
      const schemaPath = join(testsDir, 'test-schema.ts');
      const configPath = join(tmpDir, 'drizzle.config.ts');
      const dbPath = join(tmpDir, 'test.db');

      // Create drizzle config file with SQLite database
      await Bun.write(configPath, `
import type { Config } from 'drizzle-kit';

export default {
  schema: '${schemaPath}',
  dialect: 'sqlite',
  dbCredentials: {
    url: '${dbPath}',
  },
} satisfies Config;
`);

      // Run push command
      const cliPath = join(__dirname, '..', 'bin', 'drizzle-kit.ts');
      const proc = spawn(['bun', cliPath, 'push', `--config=${configPath}`], {
        cwd: testsDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const output = stdout + stderr;

      // Note: drizzle-kit push requires 'better-sqlite3' or '@libsql/client'
      // which are not bundled with bun's native SQLite support.
      // If these packages are not installed, the command will fail with a specific error.
      if (output.includes('better-sqlite3') || output.includes('@libsql/client')) {
        // This is expected - drizzle-kit CLI needs additional drivers for push
        // The programmatic push via DrizzleService works with bun:sqlite
        // eslint-disable-next-line no-console
        console.warn('CLI push requires better-sqlite3 or @libsql/client - skipping detailed verification');
        expect(exitCode).not.toBe(0); // Expected to fail without drivers

        return;
      }

      if (exitCode === 0) {
        // Verify database file was created
        const dbFile = Bun.file(dbPath);
        expect(await dbFile.exists()).toBe(true);

        // Verify table was created by querying the database
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { Database: SQLiteDatabase } = await import('bun:sqlite');
        const db = new SQLiteDatabase(dbPath);
        const tables = db.query(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='users'
        `).all();
        db.close();

        expect(tables.length).toBe(1);
      } else {
        // eslint-disable-next-line no-console
        console.error('CLI push failed:', stderr);
        expect(exitCode).toBe(0);
      }
    }, 30000);

    test('returns non-zero exit code on invalid database URL', async () => {
      // Use existing test-schema.ts
      const schemaPath = join(testsDir, 'test-schema.ts');
      const configPath = join(tmpDir, 'drizzle.config.ts');

      // Create drizzle config with invalid PostgreSQL URL (will fail to connect)
      await Bun.write(configPath, `
import type { Config } from 'drizzle-kit';

export default {
  schema: '${schemaPath}',
  dialect: 'postgresql',
  dbCredentials: {
    url: 'postgresql://invalid:invalid@localhost:99999/invalid',
  },
} satisfies Config;
`);

      const cliPath = join(__dirname, '..', 'bin', 'drizzle-kit.ts');
      const proc = spawn(['bun', cliPath, 'push', `--config=${configPath}`], {
        cwd: testsDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;

      // Should fail with non-zero exit code (DB connection error)
      expect(exitCode).not.toBe(0);
    }, 30000);
  });

  describe('CLI help and version', () => {
    test('shows help when called with --help', async () => {
      const cliPath = join(__dirname, '..', 'bin', 'drizzle-kit.ts');
      const proc = spawn(['bun', cliPath, '--help'], {
        cwd: workspaceRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();

      // drizzle-kit should show help
      expect(exitCode).toBe(0);
      expect(stdout.length).toBeGreaterThan(0);
    }, 30000);

    test('CLI wrapper uses correct drizzle-kit from @onebun/drizzle', async () => {
      // Verify that the CLI wrapper resolves drizzle-kit from the correct location
      const cliPath = join(__dirname, '..', 'bin', 'drizzle-kit.ts');
      const cliContent = await Bun.file(cliPath).text();

      // Check that CLI uses import.meta.resolve to find drizzle-kit
      expect(cliContent).toContain("import.meta.resolve('drizzle-kit')");
    });
  });
});
