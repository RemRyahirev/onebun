#!/usr/bin/env bun
/**
 * CLI wrapper for drizzle-kit
 *
 * This wrapper ensures that the correct version of drizzle-kit is used
 * (the one installed with \@onebun/drizzle) instead of a potentially
 * different version that bunx might download from npm.
 *
 * Usage:
 *   bunx onebun-drizzle generate
 *   bunx onebun-drizzle push
 *   bunx onebun-drizzle studio
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { spawn } from 'bun';

// Find drizzle-kit binary - resolve the package path without executing it
const drizzleKitModulePath = import.meta.resolve('drizzle-kit');
const drizzleKitDir = dirname(fileURLToPath(drizzleKitModulePath));
const drizzleKitBin = join(drizzleKitDir, 'bin.cjs');

// Pass all arguments to drizzle-kit
const args = Bun.argv.slice(2);

const proc = spawn(['bun', drizzleKitBin, ...args], {
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
});

const exitCode = await proc.exited;
process.exit(exitCode);
