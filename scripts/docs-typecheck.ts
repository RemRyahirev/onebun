#!/usr/bin/env bun
/**
 * OneBun Documentation Snippet Type Checker
 *
 * Extracts every TypeScript fence from `docs/**\/*.md` and compiles it against the real
 * packages. Nothing else in the repo does this: `tsc` only admits `.ts`, and the
 * VitePress build only highlights syntax — so until now a documented example could name
 * a removed export or a misspelled option forever, and every gate stayed green.
 *
 * Snippets are partial by nature (they reference services and variables declared in the
 * prose around them), so a bare compile would drown in noise. Only error codes that
 * indicate genuine drift are reported by default — see DRIFT_CODES. Pass `--all` to see
 * everything the compiler said.
 *
 * A fence is skipped when the line above it is `<!-- typecheck: skip -->` — for
 * deliberate fragments, pseudo-code and non-OneBun illustrations. The marker is an HTML
 * comment, so it does not render.
 *
 * Usage:
 *   bun scripts/docs-typecheck.ts                  # report drift errors
 *   bun scripts/docs-typecheck.ts --all            # report every compiler error
 *   bun scripts/docs-typecheck.ts --check          # exit 1 when a page regresses
 *   bun scripts/docs-typecheck.ts --update-baseline
 *   bun scripts/docs-typecheck.ts --page api/cache.md
 */

import { mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
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
const SKILLS_DIR = join(ROOT_DIR, 'skills');
const BASELINE_PATH = join(import.meta.dir, 'docs-typecheck-baseline.json');
const WORK_DIR = join(tmpdir(), 'onebun-docs-typecheck');

const MODE_CHECK = process.argv.includes('--check');
const MODE_ALL = process.argv.includes('--all');
const MODE_JSON = process.argv.includes('--json');
const MODE_UPDATE_BASELINE = process.argv.includes('--update-baseline');
const PAGE_FILTER = (() => {
  const i = process.argv.indexOf('--page');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

const SKIP_MARKER = /<!--\s*typecheck:\s*skip\s*-->/i;

/**
 * Error codes that mean the documentation contradicts the code, as opposed to the
 * snippet simply being a fragment. These are the classes the 2026-08 drift audit found
 * 42 live instances of.
 */
/**
 * "Cannot find name / module". A doc snippet routinely omits its import block, or continues a class
 * introduced by the prose above it, so these are expected and are never reported as drift.
 */
const UNRESOLVED_CODES = new Set([
  2304, // Cannot find name 'X'
  2552, // Cannot find name 'X'. Did you mean 'Y'?
  2307, // Cannot find module 'X'
  2503, // Cannot find namespace 'X'
]);

/**
 * Diagnostics that are only meaningful once the types in the snippet actually resolved. When the
 * base class is an unresolved name, EVERY `this.something` in the class reports TS2339 — 112 of the
 * first 124 findings were this one cascade, which would have made the gate pure noise.
 */
const TYPE_DEPENDENT_CODES = new Set([2339, 2551, 2345, 2769, 2739, 2741]);

const DRIFT_CODES = new Set([
  2305, // Module '"X"' has no exported member 'Y'
  2724, // '"X"' has no exported member named 'Y'. Did you mean 'Z'?
  2339, // Property 'X' does not exist on type 'Y'
  2551, // Property 'X' does not exist on type 'Y'. Did you mean 'Z'?
  2353, // Object literal may only specify known properties
  2345, // Argument of type 'X' is not assignable to parameter of type 'Y'
  2554, // Expected N arguments, but got M
  2555, // Expected at least N arguments, but got M
  2739, // Type 'X' is missing the following properties from type 'Y'
  2741, // Property 'X' is missing in type 'Y' but required in type 'Z'
  2769, // No overload matches this call
  2820, // Type 'X' is not assignable to type 'Y'. Did you mean 'Z'?
]);

interface Snippet {
  page: string;
  /** 1-indexed line of the opening fence in the .md */
  line: number;
  code: string;
  moduleName: string;
}

interface SnippetError {
  page: string;
  line: number;
  code: number;
  message: string;
  snippetLine: number;
}

interface Baseline {
  failingSnippets: Record<string, number>;
}

async function collectDocPages(dir: string, prefix = ''): Promise<string[]> {
  const pages: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      if (entry.name === 'public' || entry.name === 'dist' || entry.name === 'superpowers') continue;
      pages.push(...await collectDocPages(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.md')) {
      pages.push(`${prefix}${entry.name}`);
    }
  }

  return pages;
}

/**
 * Every Markdown source whose snippets are compiled, as `{ key, path }`. Keys for pages under
 * `docs/` stay relative to it (`api/cache.md`) so existing baselines keep resolving; the agent
 * skill is keyed by its repo-relative path (`skills/onebun-framework/SKILL.md`).
 *
 * The skill is included deliberately. It is the file an assistant reads before writing OneBun
 * code, so a wrong recipe in it reaches new code directly, without passing through the docs —
 * and while it lived outside the repository no gate could see it at all.
 */
async function collectSources(): Promise<Array<{ key: string; path: string }>> {
  const sources: Array<{ key: string; path: string }> = [];

  for (const page of await collectDocPages(DOCS_DIR)) {
    sources.push({ key: page, path: join(DOCS_DIR, page) });
  }

  try {
    for (const page of await collectDocPages(SKILLS_DIR)) {
      sources.push({ key: `skills/${page}`, path: join(SKILLS_DIR, page) });
    }
  } catch { /* no skills directory */ }

  return sources;
}

function extractSnippets(page: string, text: string): Snippet[] {
  const lines = text.split('\n');
  const snippets: Snippet[] = [];

  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*```(\w*)/);
    if (!open) continue;

    // Find the closing fence.
    let end = i + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end++;

    const isTypeScript = /^(ts|typescript)$/.test(open[1]);
    const skipped = i > 0 && SKIP_MARKER.test(lines[i - 1]);

    if (isTypeScript && !skipped) {
      index++;
      snippets.push({
        page,
        line: i + 1,
        code: lines.slice(i + 1, end).join('\n'),
        moduleName: `${page.replace(/[^\w]/g, '_')}__${index}_L${i + 1}`,
      });
    }

    i = end;
  }

  return snippets;
}

async function writeHarness(snippets: Snippet[]): Promise<void> {
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });

  // The snippets compile against the workspace sources, exactly as a user's `@onebun/*`
  // import would resolve after install. Paths are absolute so the generated project can
  // live outside the repo and leave no artefacts behind in it.
  const paths: Record<string, string[]> = {};
  const packagesDir = join(ROOT_DIR, 'packages');
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'create-onebun') continue;
    paths[`@onebun/${entry.name}`] = [join(packagesDir, entry.name, 'src')];
    paths[`@onebun/${entry.name}/*`] = [join(packagesDir, entry.name, 'src/*')];
  }

  const tsconfig = {
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
      moduleDetection: 'force',
      noEmit: true,
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      // A doc snippet legitimately leaves parameters and locals unannotated; that is a
      // style of prose, not a defect, and flagging it would bury the real findings.
      noImplicitAny: false,
      noUnusedLocals: false,
      resolveJsonModule: true,
      types: ['bun-types'],
      lib: ['ESNext', 'DOM'],
      typeRoots: [join(ROOT_DIR, 'node_modules', '@types'), join(ROOT_DIR, 'node_modules')],
      // No `baseUrl`: TypeScript 7 removed it and errors out on the config itself, which
      // yields zero file diagnostics — a checker that silently passes everything. The
      // `paths` values are absolute, so none is needed.
      paths,
    },
    include: ['*.ts'],
  };

  await Bun.write(join(WORK_DIR, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  for (const snippet of snippets) {
    await Bun.write(join(WORK_DIR, `${snippet.moduleName}.ts`), `${snippet.code}\n`);
  }
}

function parseDiagnostics(output: string, byModule: Map<string, Snippet>): SnippetError[] {
  const errors: SnippetError[] = [];

  for (const line of output.split('\n')) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/);
    if (!match) continue;

    const moduleName = match[1].replace(/\.ts$/, '').split('/').pop() ?? '';
    const snippet = byModule.get(moduleName);
    if (!snippet) continue;

    errors.push({
      page: snippet.page,
      line: snippet.line,
      snippetLine: parseInt(match[2], 10),
      code: parseInt(match[4], 10),
      message: match[5],
    });
  }

  return errors;
}

async function loadBaseline(): Promise<Baseline> {
  try {
    return await Bun.file(BASELINE_PATH).json() as Baseline;
  } catch {
    return { failingSnippets: {} };
  }
}

async function main(): Promise<void> {
  log.step('OneBun Documentation Snippet Type Checker');

  let pages = await collectSources();
  if (PAGE_FILTER) pages = pages.filter(p => p.key === PAGE_FILTER);

  const snippets: Snippet[] = [];
  let skipped = 0;

  for (const page of pages) {
    const text = await Bun.file(page.path).text();
    const found = extractSnippets(page.key, text);
    snippets.push(...found);
    skipped += (text.match(new RegExp(SKIP_MARKER.source, 'gi')) ?? []).length;
  }

  log.info(`${snippets.length} TypeScript snippet(s) across ${pages.length} page(s); ${skipped} marked skip`);

  if (snippets.length === 0) {
    log.warn('Nothing to check');
    return;
  }

  log.info('Generating compile harness...');
  await writeHarness(snippets);

  const byModule = new Map(snippets.map(s => [s.moduleName, s]));

  const compile = async (): Promise<{ text: string; exitCode: number }> => {
    const proc = Bun.spawn(['bunx', 'tsc', '--noEmit', '-p', WORK_DIR], {
      cwd: ROOT_DIR,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { text: out + err, exitCode };
  };

  log.info('Compiling...');
  let { text: combined, exitCode } = await compile();

  // tsc reports syntactic errors for the whole program and then skips semantic analysis
  // entirely. A single malformed fragment would therefore blind the check for every other
  // snippet — so drop the unparsable ones and compile again for the real diagnostics.
  const syntaxBroken = new Map<string, Snippet>();
  for (const err of parseDiagnostics(combined, byModule)) {
    if (err.code >= 2000) continue;
    const snippet = snippets.find(s => s.page === err.page && s.line === err.line);
    if (snippet) syntaxBroken.set(snippet.moduleName, snippet);
  }

  if (syntaxBroken.size > 0) {
    log.warn(`${syntaxBroken.size} snippet(s) are not parsable TypeScript; excluding them and recompiling`);
    for (const moduleName of syntaxBroken.keys()) {
      await rm(join(WORK_DIR, `${moduleName}.ts`), { force: true });
    }
    ({ text: combined, exitCode } = await compile());
  }

  const result = { exitCode };

  // A config or harness failure makes tsc emit no per-file diagnostics at all, which
  // would read exactly like "every snippet compiles". Refuse to report success in that
  // case — a gate that cannot fail is worse than no gate.
  const configErrors = combined.match(/error TS5\d{3}:.*/g);
  if (configErrors) {
    log.error('The generated harness config was rejected by tsc:');
    for (const line of configErrors.slice(0, 5)) log.dim(line);
    await rm(WORK_DIR, { recursive: true, force: true });
    process.exit(1);
  }

  const all = parseDiagnostics(combined, byModule);

  if (all.length === 0 && result.exitCode !== 0 && !/error TS/.test(combined)) {
    log.error(`tsc exited ${result.exitCode} without diagnostics — the harness did not run`);
    log.dim(combined.split('\n').slice(0, 5).join('\n'));
    await rm(WORK_DIR, { recursive: true, force: true });
    process.exit(1);
  }
  // Snippets in which at least one name failed to resolve. Their type-dependent diagnostics are
  // downstream of that, not evidence about the framework.
  const unresolvedSnippets = new Set(
    all.filter(e => UNRESOLVED_CODES.has(e.code)).map(e => `${e.page}:${e.line}`),
  );

  const isTrustworthy = (e: SnippetError): boolean => {
    if (!DRIFT_CODES.has(e.code)) return false;
    if (!TYPE_DEPENDENT_CODES.has(e.code)) return true;

    return !unresolvedSnippets.has(`${e.page}:${e.line}`);
  };

  const reported = MODE_ALL ? all : all.filter(isTrustworthy);

  // A snippet is "failing" when it carries at least one reported error.
  const failingByPage = new Map<string, Set<number>>();
  for (const err of reported) {
    if (!failingByPage.has(err.page)) failingByPage.set(err.page, new Set());
    failingByPage.get(err.page)!.add(err.line);
  }

  const failingSnippets: Record<string, number> = {};
  for (const [page, lines] of [...failingByPage].sort()) {
    failingSnippets[page] = lines.size;
  }

  if (MODE_UPDATE_BASELINE) {
    await Bun.write(BASELINE_PATH, `${JSON.stringify({ failingSnippets }, null, 2)}\n`);
    log.success(`Baseline written: ${relative(ROOT_DIR, BASELINE_PATH)}`);
    log.info(`${Object.values(failingSnippets).reduce((a, b) => a + b, 0)} failing snippet(s) across ${Object.keys(failingSnippets).length} page(s)`);
    await rm(WORK_DIR, { recursive: true, force: true });
    return;
  }

  if (MODE_JSON) {
    console.log(JSON.stringify({
      totalSnippets: snippets.length,
      failingSnippets,
      errors: reported,
      unparsable: [...syntaxBroken.values()].map(s => ({ page: s.page, line: s.line })),
    }, null, 2));
    await rm(WORK_DIR, { recursive: true, force: true });
    return;
  }

  // Report, grouped by page, worst first.
  const pagesByCount = Object.entries(failingSnippets).sort((a, b) => b[1] - a[1]);

  if (reported.length > 0) {
    log.step(`${reported.length} error(s) in ${Object.keys(failingSnippets).length} page(s)`);

    for (const [page] of pagesByCount) {
      const pageErrors = reported.filter(e => e.page === page);
      log.error(`${page} — ${failingSnippets[page]} snippet(s), ${pageErrors.length} error(s)`);
      for (const err of pageErrors) {
        log.dim(`${page}:${err.line} (snippet line ${err.snippetLine}) TS${err.code}: ${err.message}`);
      }
    }
  } else {
    log.success('Every documented snippet compiles against the real packages');
  }

  if (syntaxBroken.size > 0) {
    log.step(`${syntaxBroken.size} snippet(s) are not parsable TypeScript`);
    log.dim('Mark deliberate fragments with `<!-- typecheck: skip -->` on the line above the fence.');
    for (const snippet of syntaxBroken.values()) {
      log.warn(`${snippet.page}:${snippet.line}`);
    }
  }

  if (MODE_CHECK) {
    const baseline = await loadBaseline();
    const regressions = Object.entries(failingSnippets)
      .filter(([page, count]) => count > (baseline.failingSnippets[page] ?? 0))
      .map(([page, count]) => ({ page, count, allowed: baseline.failingSnippets[page] ?? 0 }));

    await rm(WORK_DIR, { recursive: true, force: true });

    if (regressions.length > 0) {
      log.step(`${colors.red}Regressions${colors.reset}`);
      for (const reg of regressions) {
        log.error(`${reg.page} — ${reg.count} failing snippet(s), baseline allows ${reg.allowed}`);
      }
      process.exit(1);
    }

    const backlog = Object.values(baseline.failingSnippets).reduce((a, b) => a + b, 0);
    if (backlog > 0) {
      log.warn(`${backlog} failing snippet(s) allowed by the baseline — they may only decrease`);
    }
    log.success('No documentation snippet regressions');
    process.exit(0);
  }

  await rm(WORK_DIR, { recursive: true, force: true });
}

main().catch((err: Error) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
