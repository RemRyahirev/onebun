import { dirname, join } from 'node:path';

import {
  describe,
  expect,
  it,
} from 'bun:test';

const repoRoot = join(dirname(import.meta.dir), '..', '..');
const fixture = join(import.meta.dir, 'broken-pipe-fixture.ts');

describe('ConsoleTransport on a closed output pipe', () => {
  it('drops the lines without an error and lets the process exit normally', async () => {
    const proc = Bun.spawn([process.execPath, '--no-env-file', fixture], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const reader = proc.stdout.getReader();
    await reader.read();
    await reader.cancel();

    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(stderr).not.toContain('EPIPE');
    expect(code).toBe(0);
  }, 20_000);
});
