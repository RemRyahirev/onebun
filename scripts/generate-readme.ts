#!/usr/bin/env bun
/**
 * OneBun README Generator
 *
 * README.md is assembled, not written. Prose comes from regions marked in `docs/`, and the
 * package table is derived from `packages/*\/package.json`, so the two things that used to rot
 * cannot: seven of the ten package READMEs had gone eight months without a content change while
 * the documentation moved under them, and the version column was maintained by hand.
 *
 * Regions are marked in the docs with HTML comments, which the rendered site does not show:
 *
 *   <!-- readme:begin quickstart-example -->
 *   ...markdown...
 *   <!-- readme:end -->
 *
 * Anything genuinely repository-specific — badges, the contributing link — lives in
 * `scripts/readme-template.md` and is substituted by `{{placeholder}}`.
 *
 * Usage:
 *   bun scripts/generate-readme.ts            # write README.md
 *   bun scripts/generate-readme.ts --check    # exit 1 if README.md is out of date (for CI)
 *   bun scripts/generate-readme.ts --stdout   # print, write nothing
 */

import { readdir } from 'node:fs/promises';
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
const DOCS_DIR = join(ROOT_DIR, 'docs');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');
const TEMPLATE_PATH = join(import.meta.dir, 'readme-template.md');
const README_PATH = join(ROOT_DIR, 'README.md');

const MODE_CHECK = process.argv.includes('--check');
const MODE_STDOUT = process.argv.includes('--stdout');

/** Which doc page each region is expected to live on. A region found nowhere is a hard error. */
const REGION_SOURCES: Record<string, string> = {
  install: 'index.md',
  'quickstart-example': 'index.md',
  features: 'features.md',
};

/**
 * Packages listed in the table, in the order a reader should meet them: the core first, then the
 * rest alphabetically. A package absent from here still has to exist; a package present in the
 * workspace but missing from here is reported, so a new one cannot be forgotten silently.
 */
const PACKAGE_ORDER = ['core'];

interface PackageInfo {
  dir: string;
  name: string;
  version: string;
  description: string;
}

function extractRegion(text: string, id: string): string | null {
  const pattern = new RegExp(
    `<!--\\s*readme:begin\\s+${id}\\s*-->\\n([\\s\\S]*?)<!--\\s*readme:end\\s*-->`,
  );
  const match = text.match(pattern);

  return match ? match[1].trim() : null;
}

async function collectRegions(): Promise<Record<string, string>> {
  const regions: Record<string, string> = {};
  const missing: string[] = [];

  for (const [id, page] of Object.entries(REGION_SOURCES)) {
    const text = await Bun.file(join(DOCS_DIR, page)).text();
    const body = extractRegion(text, id);

    if (body === null) {
      missing.push(`${id} (expected in docs/${page})`);
      continue;
    }

    regions[id] = body;
  }

  if (missing.length > 0) {
    log.error('Region marker(s) not found in the documentation:');
    for (const item of missing) log.dim(item);
    log.info('Each region is delimited by <!-- readme:begin <id> --> and <!-- readme:end -->.');
    process.exit(1);
  }

  return regions;
}

async function collectPackages(): Promise<PackageInfo[]> {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const packages: PackageInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(PACKAGES_DIR, entry.name, 'package.json');
    let manifest: { name?: string; version?: string; description?: string; private?: boolean };

    try {
      manifest = await Bun.file(manifestPath).json();
    } catch {
      continue;
    }

    // A private package is not on npm, so a version badge would 404.
    if (manifest.private || !manifest.name || !manifest.version) continue;

    packages.push({
      dir: entry.name,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? '',
    });
  }

  return packages.sort((a, b) => {
    const rankA = PACKAGE_ORDER.indexOf(a.dir);
    const rankB = PACKAGE_ORDER.indexOf(b.dir);
    if (rankA !== rankB) return (rankA < 0 ? Number.MAX_SAFE_INTEGER : rankA) - (rankB < 0 ? Number.MAX_SAFE_INTEGER : rankB);

    return a.name.localeCompare(b.name);
  });
}

/**
 * The description as the table should read it: package.json descriptions are written for npm
 * search and repeat "for OneBun framework" in every one of them, which is noise in a table whose
 * every row is a OneBun package.
 */
function tableDescription(description: string): string {
  return description
    .replace(/\s+for OneBun framework\b/i, '')
    .replace(/^OneBun\s+/i, '')
    .replace(/\s+-\s+/, ' — ')
    .trim();
}

function renderPackageTable(packages: PackageInfo[]): string {
  const rows = packages.map((pkg) => {
    const npm = `[![npm](https://img.shields.io/npm/v/${pkg.name}?color=blue)](https://www.npmjs.com/package/${pkg.name})`;

    return `| [${pkg.name}](packages/${pkg.dir}) | ${npm} | ${tableDescription(pkg.description)} |`;
  });

  return [
    '| Package | Version | Description |',
    '|---------|---------|-------------|',
    ...rows,
  ].join('\n');
}

async function main(): Promise<void> {
  const [template, regions, packages] = await Promise.all([
    Bun.file(TEMPLATE_PATH).text(),
    collectRegions(),
    collectPackages(),
  ]);

  const rootManifest = await Bun.file(join(ROOT_DIR, 'package.json')).json() as { license?: string };

  const substitutions: Record<string, string> = {
    ...regions,
    packages: renderPackageTable(packages),
    license: rootManifest.license ?? 'MPL-2.0',
    packageCount: String(packages.length),
  };

  const unresolved: string[] = [];
  const rendered = template.replace(/\{\{(\w[\w-]*)\}\}/g, (_, key: string) => {
    if (!(key in substitutions)) {
      unresolved.push(key);

      return '';
    }

    return substitutions[key];
  });

  if (unresolved.length > 0) {
    log.error(`Template references unknown placeholder(s): ${[...new Set(unresolved)].join(', ')}`);
    process.exit(1);
  }

  if (MODE_STDOUT) {
    console.log(rendered);

    return;
  }

  const current = await Bun.file(README_PATH).text().catch(() => '');

  if (MODE_CHECK) {
    if (current === rendered) {
      log.success('README.md is up to date');
      log.info(`${Object.keys(regions).length} doc region(s), ${packages.length} package(s)`);
      process.exit(0);
    }

    log.error('README.md is out of date — it is generated, not edited by hand.');
    log.info('Run `bun run readme:generate` and commit the result.');

    // Point at the first difference rather than making the reader diff 120 lines by eye.
    const currentLines = current.split('\n');
    const renderedLines = rendered.split('\n');
    for (let i = 0; i < Math.max(currentLines.length, renderedLines.length); i++) {
      if (currentLines[i] === renderedLines[i]) continue;

      log.step(`First difference at line ${i + 1}`);
      log.dim(`committed:  ${currentLines[i] ?? '(end of file)'}`);
      log.dim(`generated:  ${renderedLines[i] ?? '(end of file)'}`);
      break;
    }

    process.exit(1);
  }

  await Bun.write(README_PATH, rendered);
  log.success(`Wrote ${relative(ROOT_DIR, README_PATH)}`);
  log.info(`${Object.keys(regions).length} doc region(s), ${packages.length} package(s)`);
}

main().catch((err: Error) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
