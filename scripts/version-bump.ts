#!/usr/bin/env bun
/**
 * OneBun Version Bump Script
 *
 * Utility to bump package versions in the monorepo.
 *
 * Usage:
 *   bun scripts/version-bump.ts <package> <type>
 *
 * Arguments:
 *   package - Package name (without @onebun/ prefix) or "all" for all packages
 *   type    - Version bump type: major, minor, or patch
 *
 * Examples:
 *   bun scripts/version-bump.ts core minor    # @onebun/core 0.1.0 -> 0.2.0
 *   bun scripts/version-bump.ts all patch     # All packages +0.0.1
 *   bun scripts/version-bump.ts cache major   # @onebun/cache 0.1.0 -> 1.0.0
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
};

type BumpType = 'major' | 'minor' | 'patch';

const ROOT_DIR = join(import.meta.dir, '..');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');

/**
 * Bump a semantic version
 */
function bumpVersion(version: string, type: BumpType): string {
  const [major, minor, patch] = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}`);
  }
}

/**
 * Get all packages in the monorepo
 */
async function getAllPackages(): Promise<Array<{ name: string; dir: string; path: string }>> {
  const packages: Array<{ name: string; dir: string; path: string }> = [];
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pkgJsonPath = join(PACKAGES_DIR, entry.name, 'package.json');
      try {
        const pkgJson = await Bun.file(pkgJsonPath).json();
        packages.push({
          name: pkgJson.name,
          dir: entry.name,
          path: pkgJsonPath,
        });
      } catch {
        // Skip directories without package.json
      }
    }
  }

  return packages;
}

/**
 * Bump version for a single package
 */
async function bumpPackageVersion(pkgPath: string, type: BumpType): Promise<{ name: string; oldVersion: string; newVersion: string }> {
  const pkgJson = await Bun.file(pkgPath).json();
  const oldVersion = pkgJson.version;
  const newVersion = bumpVersion(oldVersion, type);

  pkgJson.version = newVersion;

  await Bun.write(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');

  return {
    name: pkgJson.name,
    oldVersion,
    newVersion,
  };
}

/**
 * Update internal dependencies to use new versions
 */
async function updateInternalDependencies(packages: Array<{ name: string; dir: string; path: string }>): Promise<void> {
  // Build a map of package names to their current versions
  const versionMap: Record<string, string> = {};

  for (const pkg of packages) {
    const pkgJson = await Bun.file(pkg.path).json();
    versionMap[pkgJson.name] = pkgJson.version;
  }

  // Update dependencies in each package
  for (const pkg of packages) {
    const pkgJson = await Bun.file(pkg.path).json();
    let updated = false;

    // Update dependencies
    if (pkgJson.dependencies) {
      for (const dep of Object.keys(pkgJson.dependencies)) {
        if (dep.startsWith('@onebun/') && versionMap[dep]) {
          const currentDep = pkgJson.dependencies[dep];
          // Only update if not using workspace protocol
          if (!currentDep.startsWith('workspace:')) {
            pkgJson.dependencies[dep] = `^${versionMap[dep]}`;
            updated = true;
          }
        }
      }
    }

    // Update devDependencies
    if (pkgJson.devDependencies) {
      for (const dep of Object.keys(pkgJson.devDependencies)) {
        if (dep.startsWith('@onebun/') && versionMap[dep]) {
          const currentDep = pkgJson.devDependencies[dep];
          if (!currentDep.startsWith('workspace:')) {
            pkgJson.devDependencies[dep] = `^${versionMap[dep]}`;
            updated = true;
          }
        }
      }
    }

    if (updated) {
      await Bun.write(pkg.path, JSON.stringify(pkgJson, null, 2) + '\n');
    }
  }
}

function printUsage(): void {
  console.log(`
${colors.cyan}OneBun Version Bump Script${colors.reset}

Usage:
  bun scripts/version-bump.ts <package> <type>

Arguments:
  package - Package name (without @onebun/ prefix) or "all" for all packages
  type    - Version bump type: major, minor, or patch

Examples:
  bun scripts/version-bump.ts core minor    # @onebun/core 0.1.0 -> 0.2.0
  bun scripts/version-bump.ts all patch     # All packages +0.0.1
  bun scripts/version-bump.ts cache major   # @onebun/cache 0.1.0 -> 1.0.0
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const [target, typeArg] = args;
  const type = typeArg as BumpType;

  if (!['major', 'minor', 'patch'].includes(type)) {
    log.error(`Invalid bump type: ${type}. Must be major, minor, or patch.`);
    process.exit(1);
  }

  const allPackages = await getAllPackages();

  if (allPackages.length === 0) {
    log.error('No packages found in packages/ directory');
    process.exit(1);
  }

  console.log(`\n${colors.cyan}📦 OneBun Version Bump${colors.reset}\n`);

  if (target === 'all') {
    // Bump all packages
    log.info(`Bumping all packages (${type})...\n`);

    const results: Array<{ name: string; oldVersion: string; newVersion: string }> = [];

    for (const pkg of allPackages) {
      const result = await bumpPackageVersion(pkg.path, type);
      results.push(result);
      log.success(`${result.name}: ${result.oldVersion} → ${result.newVersion}`);
    }

    // Update internal dependencies
    log.info('\nUpdating internal dependencies...');
    await updateInternalDependencies(allPackages);
    log.success('Internal dependencies updated');

    console.log(`\n✨ Bumped ${results.length} package(s)\n`);
  } else {
    // Bump single package
    const pkg = allPackages.find((p) => p.dir === target || p.name === `@onebun/${target}`);

    if (!pkg) {
      log.error(`Package not found: ${target}`);
      log.info(`Available packages: ${allPackages.map((p) => p.dir).join(', ')}`);
      process.exit(1);
    }

    const result = await bumpPackageVersion(pkg.path, type);
    log.success(`${result.name}: ${result.oldVersion} → ${result.newVersion}`);

    // Update internal dependencies in other packages that depend on this one
    log.info('\nUpdating internal dependencies...');
    await updateInternalDependencies(allPackages);
    log.success('Internal dependencies updated');

    console.log('\n✨ Done!\n');
  }
}

main().catch((error) => {
  log.error('Unexpected error:');
  console.error(error);
  process.exit(1);
});
