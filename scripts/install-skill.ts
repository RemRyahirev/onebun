#!/usr/bin/env bun
/**
 * OneBun Skill Installer
 *
 * Copies `skills/onebun-framework` from this repository into the agent's skill directory
 * (`~/.claude/skills` by default), so an assistant working on another project loads the
 * same guidance this repo ships.
 *
 * The skill used to live only in `~/.claude/skills`, outside the repository: it never
 * appeared in a diff, no CI step could see it, and it drifted a full day behind the
 * documentation without anything noticing. It is versioned here now; this script is how
 * it reaches the place an agent actually reads.
 *
 * Usage:
 *   bun scripts/install-skill.ts                 # install or update
 *   bun scripts/install-skill.ts --check         # report drift, exit 1 if out of sync
 *   bun scripts/install-skill.ts --target <dir>  # install somewhere else
 *   bun scripts/install-skill.ts --print-target  # show where it would go
 */

import { readdir, mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

const log = {
  info: (msg: string) => console.error(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => console.error(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg: string) => console.error(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg: string) => console.error(`${colors.red}✗${colors.reset} ${msg}`),
  step: (msg: string) => console.error(`\n${colors.cyan}▸${colors.reset} ${msg}`),
  dim: (msg: string) => console.error(`${colors.dim}  ${msg}${colors.reset}`),
};

const ROOT_DIR = join(import.meta.dir, '..');
const SKILL_NAME = 'onebun-framework';
const SOURCE_DIR = join(ROOT_DIR, 'skills', SKILL_NAME);

const MODE_CHECK = process.argv.includes('--check');
const MODE_PRINT_TARGET = process.argv.includes('--print-target');

function resolveTargetRoot(): string {
  const explicit = process.argv.indexOf('--target');
  if (explicit >= 0 && process.argv[explicit + 1]) return process.argv[explicit + 1];

  // Matches how the agent resolves its own skill directory.
  return process.env.CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills');
}

const TARGET_DIR = join(resolveTargetRoot(), SKILL_NAME);

/** Every file under `dir`, as paths relative to it, sorted for stable comparison. */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      out.push(...await listFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else {
      out.push(`${prefix}${entry.name}`);
    }
  }

  return out.sort();
}

interface Diff {
  added: string[];
  removed: string[];
  changed: string[];
}

async function diffTrees(source: string, target: string): Promise<Diff> {
  const [sourceFiles, targetFiles] = await Promise.all([listFiles(source), listFiles(target)]);
  const targetSet = new Set(targetFiles);
  const sourceSet = new Set(sourceFiles);

  const added = sourceFiles.filter(f => !targetSet.has(f));
  const removed = targetFiles.filter(f => !sourceSet.has(f));
  const changed: string[] = [];

  for (const file of sourceFiles) {
    if (!targetSet.has(file)) continue;

    const [a, b] = await Promise.all([
      Bun.file(join(source, file)).text(),
      Bun.file(join(target, file)).text(),
    ]);

    if (a !== b) changed.push(file);
  }

  return { added, removed, changed };
}

async function main(): Promise<void> {
  if (MODE_PRINT_TARGET) {
    console.log(TARGET_DIR);
    return;
  }

  log.step(`OneBun skill: ${relative(ROOT_DIR, SOURCE_DIR)} → ${TARGET_DIR}`);

  const sourceFiles = await listFiles(SOURCE_DIR);
  if (sourceFiles.length === 0) {
    log.error(`No skill files found in ${SOURCE_DIR}`);
    process.exit(1);
  }

  const diff = await diffTrees(SOURCE_DIR, TARGET_DIR);
  const inSync = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;

  if (MODE_CHECK) {
    if (inSync) {
      log.success(`Installed skill matches the repository (${sourceFiles.length} files)`);
      process.exit(0);
    }

    log.warn('Installed skill differs from the repository:');
    for (const file of diff.added) log.dim(`missing in ${TARGET_DIR}: ${file}`);
    for (const file of diff.changed) log.dim(`differs: ${file}`);
    for (const file of diff.removed) log.dim(`stale, not in repo: ${file}`);
    log.info('Run `bun run skill:install` to update it.');
    process.exit(1);
  }

  if (inSync) {
    log.success(`Already up to date (${sourceFiles.length} files)`);
    return;
  }

  // Replace wholesale: a file deleted from the repo must not survive in the installed copy,
  // which is exactly how a removed instruction keeps being followed.
  await rm(TARGET_DIR, { recursive: true, force: true });
  await mkdir(TARGET_DIR, { recursive: true });

  for (const file of sourceFiles) {
    const destination = join(TARGET_DIR, file);
    const slash = file.lastIndexOf('/');
    if (slash > 0) await mkdir(join(TARGET_DIR, file.slice(0, slash)), { recursive: true });

    await Bun.write(destination, Bun.file(join(SOURCE_DIR, file)));
  }

  log.success(`Installed ${sourceFiles.length} file(s) to ${TARGET_DIR}`);
  if (diff.removed.length > 0) {
    log.info(`Removed ${diff.removed.length} stale file(s) that are no longer in the repository`);
  }
}

main().catch((err: Error) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
