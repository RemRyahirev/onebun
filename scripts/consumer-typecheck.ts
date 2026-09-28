#!/usr/bin/env bun
/**
 * OneBun Consumer Type Check
 *
 * Every @onebun/* package ships its TypeScript sources (`"types": "src/index.ts"`), so an
 * application's `tsc` compiles them with the APPLICATION's compiler options and type packages.
 * `skipLibCheck` does not help: it skips `.d.ts` files, and these are `.ts`. A source that leans
 * on an ambient global whose typings differ between bun-types, @types/node and lib DOM therefore
 * passes `bun run typecheck` here and fails in the application — 0.8.2's `DecompressionStream` in
 * @onebun/requests did exactly that under @types/node 26 and under lib DOM.
 *
 * This script compiles the packages the way an application does:
 *
 *  1. `npm pack` every package the entries need — the entries' packages and the workspace packages
 *     they depend on — which is the file set `npm publish` ships, and unpack each into a scratch
 *     consumer created in the system temp directory, outside the repo.
 *  2. Install into that consumer only what an application gets: the packages' third-party
 *     `dependencies` and `peerDependencies` (bun and npm install peers), plus the pinned type
 *     packages and compilers below under npm aliases. None of the repo's devDependencies are
 *     visible to it.
 *  3. Compile every entry — a file that imports one entry point — once for every cell of
 *     bun-types × @types/node × lib × TypeScript, each cell a program of its own whose typings are
 *     chosen through `typeRoots`. Every cell must compile without a single diagnostic.
 *
 * An application that declares no @types/node gets the one bun-types depends on (`"*"`), the
 * newest, so the newest @types/node major stands in for it. A lib left unset defaults to the full
 * ESNext lib, which includes DOM — that is the tsconfig `docs/getting-started.md` recommends.
 *
 * The pins go stale without failing anything: an application picks up a new @types/node major or
 * bun-types minor the day it ships, and these cells keep compiling against the old one. So every
 * run asks npm for the latest of both and warns — a `::warning::` annotation under GitHub
 * Actions — when it is newer than the newest pin. To bump: add the new version to the list (it
 * becomes the newest, and so the "no @types/node" case), drop the oldest one if it is no longer
 * worth covering, run this script, and fix every source it names.
 *
 * Each run gets its own temp directory, so concurrent runs from several worktrees do not collide.
 * Installing needs the npm registry; bun's cache makes repeated runs fast.
 *
 * Usage:
 *   bun run typecheck:consumer                 # every cell; exit 1 when any cell fails
 *   bun run typecheck:consumer --only tsc@5.9  # only the cells whose name contains "tsc@5.9"
 *   bun run typecheck:consumer --keep          # keep the scratch consumer and print its path
 */

import { availableParallelism, tmpdir } from 'node:os';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';

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
  error: (msg: string) => console.error(`${colors.red}✗${colors.reset} ${msg}`),
  warn: (msg: string) => console.error(`${colors.yellow}!${colors.reset} ${msg}`),
  step: (msg: string) => console.error(`\n${colors.cyan}▸${colors.reset} ${msg}`),
  dim: (msg: string) => console.error(`${colors.dim}  ${msg}${colors.reset}`),
};

const ROOT_DIR = join(import.meta.dir, '..');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');

const KEEP = process.argv.includes('--keep');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');

  return i >= 0 ? process.argv[i + 1] : undefined;
})();

/**
 * The type environments an application may compile the packages in, oldest first. Bump a pin when
 * a new major of @types/node or a new minor of bun-types ships — the run warns when one has (see
 * the header): the newest @types/node is also what an application that declares none gets.
 *
 * TypeScript 5.9 is the last line whose lib DOM leaves the iterable members (`Headers.keys()`,
 * `entries()`) to a separate DOM.Iterable; from 6.0 on DOM includes them. 7.0 is the native port
 * of 6.0 and reports exactly what 6.0 does on this matrix, so it stands in for 6.0 as well.
 */
const BUN_TYPES = ['1.3.14', '1.4.2'];
const NODE_TYPES = ['22.20.3', '26.6.3'];
const TYPESCRIPT = ['5.9.3', '7.0.2'];
const LIBS: Array<{ name: string; lib: string[] | undefined }> = [
  { name: 'ESNext', lib: ['ESNext'] },
  // Without DOM.Iterable, TypeScript 5.9's Headers has forEach() but no keys() or entries()
  { name: 'ESNext+DOM', lib: ['ESNext', 'DOM'] },
  { name: 'ESNext+DOM+DOM.Iterable', lib: ['ESNext', 'DOM', 'DOM.Iterable'] },
  // Unset: TypeScript's default for target ESNext, which includes DOM
  { name: 'default', lib: undefined },
];

/**
 * One entry per entry point an application imports on its own — a package or a subpath of its
 * `exports` — and each a program of its own. Listing one here is all it takes to cover it: its
 * package's workspace dependencies and peers are packed with it. `sources` is the directory under
 * the package the program must include, which proves the entry resolved to the packed sources.
 */
const ENTRIES: Array<{ specifier: string; pkg: string; sources: string; code: string }> = [
  {
    specifier: '@onebun/requests',
    pkg: '@onebun/requests',
    sources: 'src/',
    code: "import { createHttpClient } from '@onebun/requests';\n\nvoid createHttpClient({ retries: { max: 0 } });\n",
  },
  {
    specifier: '@onebun/core',
    pkg: '@onebun/core',
    sources: 'src/',
    code: "import { OneBunApplication } from '@onebun/core';\n\nvoid OneBunApplication;\n",
  },
  {
    specifier: '@onebun/core/testing',
    pkg: '@onebun/core',
    sources: 'src/testing/',
    code: "import * as testing from '@onebun/core/testing';\n\nvoid testing;\n",
  },
];

/** The entry's file name in the consumer's src/: `@onebun/core/testing` → `core-testing`. */
const entryFile = (specifier: string): string => specifier.replace(/^@onebun\//, '').replaceAll('/', '-');

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface Cell {
  name: string;
  bunTypes: string;
  nodeTypes: string;
  lib: string[] | undefined;
  typescript: string;
  entry: typeof ENTRIES[number];
  tsconfig: string;
}

interface CellResult {
  cell: Cell;
  diagnostics: string[];
  harnessProblems: string[];
}

const alias = {
  bunTypes: (version: string) => `bun-types-${version}`,
  nodeTypes: (version: string) => `types-node-${version}`,
  typescript: (version: string) => `typescript-${version}`,
};

async function run(cmd: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

/** Every package under packages/, by name, with its directory and manifest. */
async function workspacePackages(): Promise<Map<string, { dir: string; pkg: PackageJson }>> {
  const packages = new Map<string, { dir: string; pkg: PackageJson }>();
  for await (const manifest of new Bun.Glob('*/package.json').scan(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, manifest.replace(/\/package\.json$/, ''));
    const pkg = await Bun.file(join(PACKAGES_DIR, manifest)).json() as PackageJson;
    packages.set(pkg.name, { dir, pkg });
  }

  return packages;
}

/**
 * The entries' packages and, transitively, every workspace package they depend on — a peer
 * included: an application that installs @onebun/cache has @onebun/core too.
 */
function closure(roots: string[], packages: Map<string, { dir: string; pkg: PackageJson }>): string[] {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    const found = packages.get(name);
    if (!found) {
      throw new Error(`${name} is not a workspace package`);
    }
    seen.add(name);
    const deps = [...Object.keys(found.pkg.dependencies ?? {}), ...Object.keys(found.pkg.peerDependencies ?? {})];
    for (const dep of deps) {
      if (packages.has(dep)) {
        visit(dep);
      }
    }
  };
  roots.forEach(visit);

  return [...seen].sort();
}

async function buildConsumer(workDir: string): Promise<void> {
  const packages = await workspacePackages();
  const names = closure([...new Set(ENTRIES.map((entry) => entry.pkg))], packages);

  log.step(`Packing ${names.join(', ')}`);
  const packDir = join(workDir, 'packs');
  await mkdir(packDir, { recursive: true });

  const dependencies: Record<string, string> = {};
  const unpacked: Array<{ name: string; tarball: string }> = [];
  for (const name of names) {
    const { dir, pkg } = packages.get(name)!;
    const packed = await run(['npm', 'pack', '--json', '--pack-destination', packDir], dir);
    if (packed.exitCode !== 0) {
      throw new Error(`npm pack failed for ${name}:\n${packed.stderr}`);
    }
    const [{ filename }] = JSON.parse(packed.stdout) as Array<{ filename: string }>;
    unpacked.push({ name, tarball: join(packDir, filename) });

    for (const [dep, range] of Object.entries({ ...pkg.peerDependencies, ...pkg.dependencies })) {
      if (!packages.has(dep)) {
        dependencies[dep] ??= range;
      }
    }
  }

  for (const version of BUN_TYPES) {
    dependencies[alias.bunTypes(version)] = `npm:bun-types@${version}`;
  }
  for (const version of NODE_TYPES) {
    dependencies[alias.nodeTypes(version)] = `npm:@types/node@${version}`;
  }
  for (const version of TYPESCRIPT) {
    dependencies[alias.typescript(version)] = `npm:typescript@${version}`;
  }

  log.step('Installing the consumer\'s dependencies');
  await Bun.write(
    join(workDir, 'package.json'),
    `${JSON.stringify({ name: 'onebun-consumer-typecheck', private: true, dependencies }, null, 2)}\n`,
  );
  const installed = await run([process.execPath, 'install', '--no-progress'], workDir);
  if (installed.exitCode !== 0) {
    throw new Error(`bun install failed:\n${installed.stdout}\n${installed.stderr}`);
  }

  // bun-types depends on @types/node "*", which lands here as the newest release. Every cell
  // picks its own through typeRoots; removing this one makes a cell that resolved it anyway fail
  // instead of silently compiling against the wrong version.
  await rm(join(workDir, 'node_modules', '@types', 'node'), { recursive: true, force: true });

  // Unpacked after the install, so that bun does not prune what it did not install
  for (const { name, tarball } of unpacked) {
    const target = join(workDir, 'node_modules', ...name.split('/'));
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const extracted = await run(['tar', '-xzf', tarball, '-C', target, '--strip-components=1'], workDir);
    if (extracted.exitCode !== 0) {
      throw new Error(`Unpacking ${tarball} failed:\n${extracted.stderr}`);
    }
  }

  // typeRoots name a package by its directory: roots/<alias>/bun-types, roots/<alias>/node
  for (const version of BUN_TYPES) {
    const root = join(workDir, 'roots', alias.bunTypes(version));
    await mkdir(root, { recursive: true });
    await symlink(join(workDir, 'node_modules', alias.bunTypes(version)), join(root, 'bun-types'), 'dir');
  }
  for (const version of NODE_TYPES) {
    const root = join(workDir, 'roots', alias.nodeTypes(version));
    await mkdir(root, { recursive: true });
    await symlink(join(workDir, 'node_modules', alias.nodeTypes(version)), join(root, 'node'), 'dir');
  }

  await mkdir(join(workDir, 'src'), { recursive: true });
  for (const entry of ENTRIES) {
    await Bun.write(join(workDir, 'src', `${entryFile(entry.specifier)}.ts`), entry.code);
  }
}

/**
 * Warn when npm's latest @types/node major or bun-types minor is newer than the newest pin. An
 * application gets it at once — one that declares no @types/node through bun-types' `"*"` — so
 * the cells stop covering what applications compile against. A warning, not a failure: an
 * upstream release must not turn an unrelated change red; the bump is a change of its own.
 */
async function warnOnNewerTypings(): Promise<void> {
  const tracked = [
    { pkg: 'bun-types', pins: BUN_TYPES, level: 'minor', parts: 2 },
    { pkg: '@types/node', pins: NODE_TYPES, level: 'major', parts: 1 },
  ];
  for (const { pkg, pins, level, parts } of tracked) {
    const viewed = await run(['npm', 'view', pkg, 'version'], ROOT_DIR);
    const latest = viewed.stdout.trim();
    if (viewed.exitCode !== 0 || !Bun.semver.satisfies(latest, '*')) {
      log.warn(`Could not read the latest ${pkg} from npm: ${viewed.stderr.trim() || latest}`);
      continue;
    }
    const newest = pins.at(-1)!;
    const line = (version: string) => `${version.split('.').slice(0, parts).join('.')}.0`;
    if (Bun.semver.order(line(latest), line(newest)) <= 0) {
      continue;
    }
    const message = `${pkg} ${latest} is a newer ${level} than the newest pin, ${newest}: `
      + 'applications compile against it and these cells do not. Add it to the pins in '
      + 'scripts/consumer-typecheck.ts and run the check.';
    log.warn(message);
    if (process.env.GITHUB_ACTIONS === 'true') {
      process.stdout.write(`::warning title=Consumer type check pins are stale::${message}\n`);
    }
  }
}

async function writeCells(workDir: string): Promise<Cell[]> {
  const cells: Cell[] = [];
  await mkdir(join(workDir, 'cells'), { recursive: true });

  for (const bunTypes of BUN_TYPES) {
    for (const nodeTypes of NODE_TYPES) {
      for (const { name: libName, lib } of LIBS) {
        for (const typescript of TYPESCRIPT) {
          for (const entry of ENTRIES) {
            const short = entryFile(entry.specifier);
            const name = `bun-types@${bunTypes} @types/node@${nodeTypes} lib=${libName} tsc@${typescript} ${entry.specifier}`;
            if (ONLY !== undefined && !name.includes(ONLY)) {
              continue;
            }
            const file = `bt${bunTypes}-node${nodeTypes}-${libName}-ts${typescript}-${short}.json`;
            const tsconfig = {
              compilerOptions: {
                target: 'ESNext',
                module: 'ESNext',
                moduleResolution: 'bundler',
                ...(lib ? { lib } : {}),
                strict: true,
                skipLibCheck: true,
                noEmit: true,
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                types: ['bun-types'],
                typeRoots: [
                  `../roots/${alias.bunTypes(bunTypes)}`,
                  `../roots/${alias.nodeTypes(nodeTypes)}`,
                ],
              },
              files: [`../src/${short}.ts`],
            };
            await Bun.write(join(workDir, 'cells', file), `${JSON.stringify(tsconfig, null, 2)}\n`);
            cells.push({
              name,
              bunTypes,
              nodeTypes,
              lib,
              typescript,
              entry,
              tsconfig: join('cells', file),
            });
          }
        }
      }
    }
  }

  return cells;
}

/**
 * Compile one cell. `--listFiles` proves the harness checked what it claims to: the entry's own
 * sources and the intended bun-types and @types/node, and no other copy of either.
 */
async function compile(workDir: string, cell: Cell): Promise<CellResult> {
  const tsc = join(workDir, 'node_modules', alias.typescript(cell.typescript), 'bin', 'tsc');
  // Into a file, not a pipe: tsc exits right after writing, and under load a pipe loses the tail
  // of a long --listFiles output (measured: 902 of 958 lines)
  const output = `${cell.tsconfig}.out`;
  const proc = Bun.spawn(
    [process.execPath, tsc, '-p', cell.tsconfig, '--pretty', 'false', '--listFiles'],
    { cwd: workDir, stdout: Bun.file(join(workDir, output)), stderr: 'pipe' },
  );
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  const stdout = await Bun.file(join(workDir, output)).text();
  const lines = `${stdout}${stderr}`.split('\n').filter((line) => line !== '');
  const files = lines.filter((line) => line.startsWith('/'));
  const diagnostics: string[] = [];
  for (const line of lines) {
    if (line.startsWith('/')) {
      continue;
    }
    if (/^\s/.test(line) && diagnostics.length > 0) {
      diagnostics[diagnostics.length - 1] += `\n${line}`;
    } else {
      diagnostics.push(line);
    }
  }

  const harnessProblems: string[] = [];
  const includes = (fragment: string) => files.some((file) => file.includes(fragment));
  const entrySources = `/node_modules/${cell.entry.pkg}/${cell.entry.sources}`;
  if (!includes(entrySources)) {
    harnessProblems.push(`the program holds no file under ${entrySources}`);
  }
  for (const version of BUN_TYPES) {
    const loaded = includes(`/node_modules/${alias.bunTypes(version)}/`);
    if (loaded !== (version === cell.bunTypes)) {
      harnessProblems.push(`bun-types ${version} is ${loaded ? '' : 'not '}in the program`);
    }
  }
  for (const version of NODE_TYPES) {
    const loaded = includes(`/node_modules/${alias.nodeTypes(version)}/`);
    if (loaded !== (version === cell.nodeTypes)) {
      harnessProblems.push(`@types/node ${version} is ${loaded ? '' : 'not '}in the program`);
    }
  }
  // A copy nested under a third-party package (testcontainers brings one under @types/ssh2)
  // would stand in for the pinned one unnoticed
  const stray = files.find((file) => /\/@types\/node\/|\/bun-types\//.test(file));
  if (stray) {
    harnessProblems.push(`a type package outside the pins is in the program: ${stray}`);
  }
  if (exitCode !== 0 && diagnostics.length === 0) {
    harnessProblems.push(`tsc exited ${exitCode} without a diagnostic`);
  }

  return { cell, diagnostics, harnessProblems };
}

async function compileAll(workDir: string, cells: Cell[]): Promise<CellResult[]> {
  const results: CellResult[] = new Array(cells.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < cells.length) {
      const index = next++;
      results[index] = await compile(workDir, cells[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, availableParallelism()) }, worker));

  return results;
}

function report(results: CellResult[]): boolean {
  log.step(`Compiled ${results.length} cells`);
  for (const { cell, diagnostics, harnessProblems } of results) {
    if (diagnostics.length === 0 && harnessProblems.length === 0) {
      log.success(cell.name);
    } else {
      const parts = [
        diagnostics.length > 0 ? `${diagnostics.length} error(s)` : '',
        harnessProblems.length > 0 ? 'harness problem' : '',
      ].filter(Boolean);
      log.error(`${cell.name} — ${parts.join(', ')}`);
    }
  }

  // The same diagnostic tends to fail many cells: print each once, with where it occurs
  const byDiagnostic = new Map<string, string[]>();
  for (const { cell, diagnostics, harnessProblems } of results) {
    for (const text of [...diagnostics, ...harnessProblems.map((problem) => `harness: ${problem}`)]) {
      byDiagnostic.set(text, [...byDiagnostic.get(text) ?? [], cell.name]);
    }
  }
  for (const [text, cellNames] of byDiagnostic) {
    console.error(`\n${colors.red}${text}${colors.reset}`);
    for (const name of cellNames) {
      log.dim(name);
    }
  }

  const failed = results.filter((result) => result.diagnostics.length > 0 || result.harnessProblems.length > 0);
  if (failed.length > 0) {
    log.error(`${failed.length} of ${results.length} cells failed`);

    return false;
  }
  log.success(`All ${results.length} cells compile`);

  return true;
}

async function main(): Promise<void> {
  const workDir = await realpath(await mkdtemp(join(tmpdir(), 'onebun-consumer-typecheck-')));
  log.info(`Scratch consumer: ${workDir}`);

  let ok = false;
  try {
    await warnOnNewerTypings();
    await buildConsumer(workDir);
    const cells = await writeCells(workDir);
    if (cells.length === 0) {
      throw new Error(`No cell matches --only ${ONLY}`);
    }
    log.step(`Compiling ${cells.length} cells`);
    ok = report(await compileAll(workDir, cells));
  } finally {
    if (KEEP) {
      log.info(`Kept ${workDir}`);
    } else {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  process.exit(ok ? 0 : 1);
}

await main();
