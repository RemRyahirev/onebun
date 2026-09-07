#!/usr/bin/env bun
/**
 * OneBun Documentation Cross-Reference Generator
 *
 * Scans @see docs:... tags in source code and @source docs:... tags in
 * docs-examples.test.ts files, then builds a reverse mapping from
 * documentation pages to code symbols and test cases.
 *
 * Usage:
 *   bun scripts/docs-xref.ts              # Colored summary
 *   bun scripts/docs-xref.ts --json       # JSON to stdout
 *   bun scripts/docs-xref.ts --markdown   # Markdown table to stdout
 *   bun scripts/docs-xref.ts --check      # Exit 1 if issues found (for CI)
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// ANSI colors for console output
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

// --- Types ---

interface XRefEntry {
  file: string;
  line: number;
  symbol: string;
  type: 'code' | 'test';
}

interface ForwardEntry {
  line: number;
  symbol: string;
  docPages: string[];
}

interface DeadAnchor {
  file: string;
  line: number;
  page: string;
  anchor: string;
  suggestion?: string;
}

interface SymbolMiss {
  file: string;
  line: number;
  symbol: string;
  page: string;
}

interface PageCoverage {
  page: string;
  snippets: number;
  covered: number;
  uncovered: number;
}

interface XRefOutput {
  generated: string;
  stats: {
    totalCodeRefs: number;
    totalTestRefs: number;
    totalDocPages: number;
    unreferencedDocPages: string[];
    untestedDocPages: string[];
    missingDocPages: string[];
    /** docs: tags whose #anchor names no heading on the target page. */
    deadAnchors: DeadAnchor[];
    /** @see tags whose symbol name never appears in the page they point at. */
    symbolNotOnPage: SymbolMiss[];
    /** Refs the symbol regex could not resolve — they verify nothing. */
    unresolvedSymbolRefs: number;
    totalSnippets: number;
    coveredSnippets: number;
    coverage: PageCoverage[];
  };
  forward: Record<string, ForwardEntry[]>;
  reverse: Record<string, XRefEntry[]>;
}

/**
 * Known violations, so the check fails on NEW drift while the existing backlog is
 * burned down. Regenerate with `bun run docs:xref --update-baseline`; the numbers may
 * only ever go down — `--check` fails when a page's uncovered count grows.
 */
interface Baseline {
  symbolNotOnPage: string[];
  uncoveredSnippets: Record<string, number>;
}

// --- Constants ---

const ROOT_DIR = join(import.meta.dir, '..');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');
const DOCS_DIR = join(ROOT_DIR, 'docs');

const MODE_JSON = process.argv.includes('--json');
const MODE_MARKDOWN = process.argv.includes('--markdown');
const MODE_CHECK = process.argv.includes('--check');
const MODE_UPDATE_BASELINE = process.argv.includes('--update-baseline');

const BASELINE_PATH = join(import.meta.dir, 'docs-xref-baseline.json');

const SYMBOL_REGEX = /export\s+(?:default\s+)?(?:abstract\s+)?(?:function|class|interface|type|const|enum|let|var)\s+(\w+)/;
const DESCRIBE_IT_REGEX = /(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/;

/**
 * Files scanned for `@source docs:` tags. A directory may already hold a `docs-examples.test.ts`,
 * so `docs-coverage.test.ts` is the second name for tests added to pin sections that file does not.
 * Both are ordinary test files; the distinction is only which one a directory already had.
 */
const DOCS_TEST_FILENAMES = new Set([
  'docs-examples.test.ts',
  'docs-coverage.test.ts',
]);

// Doc pages that are legitimately not referenced by code
const EXCLUDED_DOC_PAGES = new Set([
  'index.md',
  'roadmap.md',
  'benchmarks.md',
  'ai-docs.md',
  'features.md',
  'migration-nestjs.md',
]);

// --- File Discovery ---

async function collectSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...await collectSourceFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectTestFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...await collectTestFiles(fullPath));
    } else if (DOCS_TEST_FILENAMES.has(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// --- Tag Extraction ---

interface RawRef {
  docPage: string;
  line: number;
  tag: 'see' | 'source';
}

function extractRefs(content: string): RawRef[] {
  const refs: RawRef[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const regex = /@(see|source)\s+docs:(\S+\.md(?:#\S+)?)/g;
    let match;

    while ((match = regex.exec(line)) !== null) {
      refs.push({
        tag: match[1] as 'see' | 'source',
        docPage: match[2],
        line: i + 1,
      });
    }
  }

  return refs;
}

function findSymbolName(lines: string[], refLine: number): string {
  // Find the end of the JSDoc block containing the ref
  let closingLine = refLine - 1;
  for (let i = refLine - 1; i < lines.length; i++) {
    if (lines[i].includes('*/')) {
      closingLine = i;
      break;
    }
  }

  // Look at lines after */ for the symbol declaration
  for (let i = closingLine + 1; i < Math.min(closingLine + 5, lines.length); i++) {
    const match = lines[i].match(SYMBOL_REGEX);
    if (match) return match[1];
  }

  return '<unknown>';
}

function findTestName(lines: string[], refLine: number): string {
  // For file-level @source (in the top comment block), return "(file-level)"
  const isTopBlock = lines.slice(0, refLine).every(
    l => l.trim() === '' || l.trim().startsWith('*') || l.trim().startsWith('/**') || l.trim().startsWith('//')
      || l.trim().startsWith('import') || l.trim().startsWith('*/'),
  );

  if (isTopBlock) {
    return '(file-level)';
  }

  // Search backwards for the nearest describe/it/test block
  for (let i = refLine - 1; i >= Math.max(0, refLine - 15); i--) {
    const match = lines[i].match(DESCRIBE_IT_REGEX);
    if (match) return match[1];
  }

  // Search forward
  for (let i = refLine; i < Math.min(refLine + 5, lines.length); i++) {
    const match = lines[i].match(DESCRIBE_IT_REGEX);
    if (match) return match[1];
  }

  return '<unknown>';
}

// --- Processing ---

async function processSourceFiles(sourceFiles: string[]): Promise<Map<string, ForwardEntry[]>> {
  const forward = new Map<string, ForwardEntry[]>();

  for (const filePath of sourceFiles) {
    const content = await Bun.file(filePath).text();
    const refs = extractRefs(content).filter(r => r.tag === 'see');
    if (refs.length === 0) continue;

    const lines = content.split('\n');
    const relPath = relative(ROOT_DIR, filePath);

    // Group refs by symbol (refs in the same JSDoc block share a symbol)
    const symbolGroups = new Map<string, { line: number; pages: Set<string> }>();

    for (const ref of refs) {
      const symbol = findSymbolName(lines, ref.line);

      // Try to merge with existing group for the same symbol (within 10 lines)
      let merged = false;
      for (const [, group] of symbolGroups) {
        if (Math.abs(group.line - ref.line) < 10) {
          // Check if it's the same symbol by proximity
          const otherSymbol = findSymbolName(lines, group.line);
          if (otherSymbol === symbol) {
            group.pages.add(ref.docPage);
            merged = true;
            break;
          }
        }
      }

      if (!merged) {
        const key = `${symbol}:${ref.line}`;
        if (symbolGroups.has(key)) {
          symbolGroups.get(key)!.pages.add(ref.docPage);
        } else {
          symbolGroups.set(key, { line: ref.line, pages: new Set([ref.docPage]) });
        }
      }
    }

    const entries: ForwardEntry[] = [];
    for (const [key, { line, pages }] of symbolGroups) {
      const symbol = key.split(':')[0];
      entries.push({ line, symbol, docPages: [...pages] });
    }

    if (entries.length > 0) {
      forward.set(relPath, entries);
    }
  }

  return forward;
}

interface TestRef {
  file: string;
  line: number;
  symbol: string;
  docPage: string;
}

async function processTestFiles(testFiles: string[]): Promise<TestRef[]> {
  const testRefs: TestRef[] = [];

  for (const filePath of testFiles) {
    const content = await Bun.file(filePath).text();
    const refs = extractRefs(content);
    if (refs.length === 0) continue;

    const lines = content.split('\n');
    const relPath = relative(ROOT_DIR, filePath);

    for (const ref of refs) {
      const symbol = findTestName(lines, ref.line);
      testRefs.push({ file: relPath, line: ref.line, symbol, docPage: ref.docPage });
    }
  }

  return testRefs;
}

// --- Raw Ref Collection (with anchors and resolved symbols) ---

interface RawRefLocation {
  file: string;
  line: number;
  page: string;
  anchor?: string;
  tag: 'see' | 'source';
  symbol: string;
}

/**
 * Every docs: tag in the repo, with the anchor kept (the reverse/forward maps strip it)
 * and the symbol or test name it sits on. This is what the content checks work from.
 */
async function collectRawRefs(sourceFiles: string[], testFiles: string[]): Promise<RawRefLocation[]> {
  const refs: RawRefLocation[] = [];

  const scan = async (filePath: string, isTest: boolean): Promise<void> => {
    const content = await Bun.file(filePath).text();
    const found = extractRefs(content);
    if (found.length === 0) return;

    const lines = content.split('\n');
    const relPath = relative(ROOT_DIR, filePath);

    for (const ref of found) {
      const [page, anchor] = ref.docPage.split('#');
      refs.push({
        file: relPath,
        line: ref.line,
        page,
        anchor,
        tag: ref.tag,
        symbol: isTest ? findTestName(lines, ref.line) : findSymbolName(lines, ref.line),
      });
    }
  };

  for (const file of sourceFiles) await scan(file, false);
  for (const file of testFiles) await scan(file, true);

  return refs;
}

async function loadBaseline(): Promise<Baseline> {
  try {
    return await Bun.file(BASELINE_PATH).json() as Baseline;
  } catch {
    return { symbolNotOnPage: [], uncoveredSnippets: {} };
  }
}

const symbolMissKey = (miss: SymbolMiss): string => `${miss.file}:${miss.symbol} -> ${miss.page}`;

// --- Doc Page Discovery ---

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

// --- Doc Page Contents ---

/**
 * Slugify a heading the way VitePress (via @mdit-vue/shared) does, so an `#anchor`
 * in a docs: tag can be compared against the headings that actually exist.
 */
function slugifyHeading(heading: string): string {
  // VitePress lets a heading declare its own id: `### Title {#custom-anchor}`. That id
  // wins outright — deriving a slug from the visible text would invent an anchor the
  // rendered page does not have.
  const explicit = heading.match(/\{#([^}]+)\}\s*$/);
  if (explicit) return explicit[1].trim();

  return heading
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/[ _]+/g, '-');
}

interface Snippet {
  line: number;
  /** Slugs of every heading enclosing this fence, innermost last. */
  headingPath: string[];
}

interface DocPageContent {
  text: string;
  /** Heading slugs in document order, deduplicated the way VitePress suffixes repeats. */
  slugs: string[];
  snippets: Snippet[];
}

/**
 * Parse a page once: its heading slugs and every TypeScript fence with the heading
 * path it sits under. Fenced blocks are skipped while scanning for headings, so a
 * `#` comment inside a snippet cannot masquerade as a section.
 */
function parseDocPage(text: string): DocPageContent {
  const lines = text.split('\n');
  const slugs: string[] = [];
  const snippets: Snippet[] = [];
  const seen = new Map<string, number>();
  const stack: { level: number; slug: string }[] = [];

  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const fenceMatch = lines[i].match(/^\s*```(\w*)/);

    if (fenceMatch) {
      if (inFence) {
        inFence = false;
      } else {
        inFence = true;
        // A fence marked `<!-- typecheck: skip -->` is a deliberate fragment — a bare `@Req()`, a
        // method signature, a list of interface members. It is not a recipe a test can pin, so
        // counting it as uncovered inflates the debt with work nobody should do.
        const isFragment = i > 0 && /<!--\s*typecheck:\s*skip\s*-->/i.test(lines[i - 1]);
        if (/^(ts|typescript)$/.test(fenceMatch[1]) && !isFragment) {
          snippets.push({ line: i + 1, headingPath: stack.map(s => s.slug) });
        }
      }
      continue;
    }

    if (inFence) continue;

    const headingMatch = lines[i].match(/^(#{2,6})\s+(.*)$/);
    if (!headingMatch) continue;

    const level = headingMatch[1].length;
    const base = slugifyHeading(headingMatch[2]);
    const repeat = seen.get(base) ?? 0;
    seen.set(base, repeat + 1);
    const slug = repeat === 0 ? base : `${base}-${repeat}`;

    slugs.push(slug);
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, slug });
  }

  return { text, slugs, snippets };
}

/** Nearest existing slug on the page, for a "did you mean" on a dead anchor. */
function suggestAnchor(anchor: string, slugs: string[]): string | undefined {
  const target = anchor.replace(/-/g, '');
  let best: { slug: string; score: number } | undefined;

  for (const slug of slugs) {
    const candidate = slug.replace(/-/g, '');
    let score = 0;
    if (candidate === target) score = 100;
    else if (candidate.includes(target) || target.includes(candidate)) score = 50;
    else {
      const parts = anchor.split('-').filter(p => p.length > 2);
      score = parts.filter(p => slug.includes(p)).length * 10;
    }
    if (score > 0 && (!best || score > best.score)) best = { slug, score };
  }

  return best?.slug;
}

// --- Output ---

function outputSummary(output: XRefOutput) {
  const { stats } = output;

  log.step('Cross-Reference Summary');
  log.info(`Code references (@see):   ${colors.bold}${stats.totalCodeRefs}${colors.reset}`);
  log.info(`Test references (@source): ${colors.bold}${stats.totalTestRefs}${colors.reset}`);
  log.info(`Total doc pages:           ${colors.bold}${stats.totalDocPages}${colors.reset}`);

  if (stats.missingDocPages.length > 0) {
    log.step(`${colors.red}Missing doc pages (broken links)${colors.reset}`);
    for (const page of stats.missingDocPages) {
      log.error(`docs:${page}`);
    }
  }

  if (stats.unreferencedDocPages.length > 0) {
    log.step(`${colors.yellow}Unreferenced doc pages (no @see or @source)${colors.reset}`);
    for (const page of stats.unreferencedDocPages) {
      log.warn(page);
    }
  }

  if (stats.untestedDocPages.length > 0) {
    log.step(`${colors.yellow}Doc pages with code refs but no test refs${colors.reset}`);
    for (const page of stats.untestedDocPages) {
      log.warn(page);
    }
  }

  if (stats.missingDocPages.length === 0) {
    log.success('All cross-references are valid');
  }

  log.step('Reverse map (doc page → code/tests)');
  const sortedPages = Object.keys(output.reverse).sort();
  for (const page of sortedPages) {
    const entries = output.reverse[page];
    const codeCount = entries.filter(e => e.type === 'code').length;
    const testCount = entries.filter(e => e.type === 'test').length;
    log.dim(`${page}: ${codeCount} code, ${testCount} test refs`);
  }
}

function outputMarkdown(output: XRefOutput) {
  console.log('# Documentation Cross-Reference Map\n');
  console.log(`Generated: ${output.generated}\n`);

  console.log('## Stats\n');
  console.log('| Metric | Value |');
  console.log('|--------|-------|');
  console.log(`| Code refs (@see) | ${output.stats.totalCodeRefs} |`);
  console.log(`| Test refs (@source) | ${output.stats.totalTestRefs} |`);
  console.log(`| Total doc pages | ${output.stats.totalDocPages} |`);
  console.log(`| Unreferenced pages | ${output.stats.unreferencedDocPages.length} |`);
  console.log(`| Untested pages | ${output.stats.untestedDocPages.length} |`);
  console.log(`| Missing pages | ${output.stats.missingDocPages.length} |`);

  console.log('\n## Reverse Map (Doc Page → Code)\n');
  const sortedPages = Object.keys(output.reverse).sort();
  for (const page of sortedPages) {
    console.log(`### ${page}\n`);
    console.log('| Type | File | Line | Symbol |');
    console.log('|------|------|------|--------|');
    const entries = output.reverse[page];
    for (const entry of entries) {
      console.log(`| ${entry.type} | ${entry.file} | ${entry.line} | ${entry.symbol} |`);
    }
    console.log('');
  }

  if (output.stats.unreferencedDocPages.length > 0) {
    console.log('\n## Unreferenced Doc Pages\n');
    for (const page of output.stats.unreferencedDocPages) {
      console.log(`- ${page}`);
    }
  }

  if (output.stats.untestedDocPages.length > 0) {
    console.log('\n## Untested Doc Pages\n');
    for (const page of output.stats.untestedDocPages) {
      console.log(`- ${page}`);
    }
  }
}

async function outputCheck(output: XRefOutput) {
  const { stats } = output;
  const baseline = await loadBaseline();
  let hasErrors = false;

  if (stats.missingDocPages.length > 0) {
    hasErrors = true;
    log.error(`${stats.missingDocPages.length} broken doc link(s):`);
    for (const page of stats.missingDocPages) {
      log.dim(`docs:${page} — file does not exist`);
    }
  }

  // Hard error, no baseline: an anchor either names a heading on the page or it does not,
  // and every one of them is mechanically fixable.
  if (stats.deadAnchors.length > 0) {
    hasErrors = true;
    log.error(`${stats.deadAnchors.length} dead anchor(s) — the section does not exist:`);
    for (const dead of stats.deadAnchors) {
      const hint = dead.suggestion ? ` (did you mean #${dead.suggestion}?)` : '';
      log.dim(`${dead.file}:${dead.line} → docs:${dead.page}#${dead.anchor}${hint}`);
    }
  }

  // Ratcheted: fail on a symbol miss that is not already recorded in the baseline.
  const knownMisses = new Set(baseline.symbolNotOnPage);
  const newMisses = stats.symbolNotOnPage.filter(m => !knownMisses.has(symbolMissKey(m)));
  if (newMisses.length > 0) {
    hasErrors = true;
    log.error(`${newMisses.length} @see tag(s) naming a symbol the target page never mentions:`);
    for (const miss of newMisses) {
      log.dim(`${miss.file}:${miss.line} — ${miss.symbol} is absent from docs:${miss.page}`);
    }
  }

  // Ratcheted: a page may not grow more uncovered snippets than the baseline records.
  const regressions = stats.coverage
    .map(c => ({ ...c, allowed: baseline.uncoveredSnippets[c.page] ?? 0 }))
    .filter(c => c.uncovered > c.allowed);

  if (regressions.length > 0) {
    hasErrors = true;
    log.error(`${regressions.length} page(s) gained undocumented-by-test snippets:`);
    for (const reg of regressions) {
      log.dim(`${reg.page} — ${reg.uncovered} uncovered snippet(s), baseline allows ${reg.allowed}`);
    }
  }

  if (!hasErrors) {
    log.success('All cross-references are valid');
    log.info(`${stats.totalCodeRefs} code refs, ${stats.totalTestRefs} test refs across ${new Set([...Object.keys(output.reverse)]).size} doc pages`);
    log.info(`Snippet coverage: ${stats.coveredSnippets}/${stats.totalSnippets} (${(stats.coveredSnippets / Math.max(stats.totalSnippets, 1) * 100).toFixed(1)}%)`);

    const backlog = Object.values(baseline.uncoveredSnippets).reduce((a, b) => a + b, 0);
    if (backlog > 0) {
      log.warn(`${backlog} uncovered snippet(s) across ${Object.keys(baseline.uncoveredSnippets).length} page(s) are allowed by the baseline — burn them down, they may only decrease`);
    }
    if (baseline.symbolNotOnPage.length > 0) {
      log.warn(`${baseline.symbolNotOnPage.length} @see symbol mismatch(es) allowed by the baseline`);
    }
    if (stats.unresolvedSymbolRefs > 0) {
      log.warn(`${stats.unresolvedSymbolRefs} @see tag(s) sit on something the symbol regex cannot name — they verify nothing`);
    }
    if (stats.unreferencedDocPages.length > 0) {
      log.warn(`${stats.unreferencedDocPages.length} doc page(s) have no references`);
    }
    if (stats.untestedDocPages.length > 0) {
      log.warn(`${stats.untestedDocPages.length} doc page(s) have code refs but no test refs`);
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

// --- Main ---

async function main() {
  log.step('OneBun Documentation Cross-Reference Scanner');

  // 1. Collect files
  log.info('Scanning source files...');
  const packageDirs = await readdir(PACKAGES_DIR, { withFileTypes: true });
  const packageNames = packageDirs.filter(d => d.isDirectory() && d.name !== 'create-onebun').map(d => d.name);

  const sourceFiles: string[] = [];
  const testFiles: string[] = [];

  for (const pkg of packageNames) {
    const pkgSrcDir = join(PACKAGES_DIR, pkg, 'src');
    const pkgTestsDir = join(PACKAGES_DIR, pkg, 'tests');

    try {
      sourceFiles.push(...await collectSourceFiles(pkgSrcDir));
    } catch { /* no src dir */ }

    testFiles.push(...await collectTestFiles(pkgSrcDir));
    testFiles.push(...await collectTestFiles(pkgTestsDir));
  }

  log.dim(`Found ${sourceFiles.length} source files, ${testFiles.length} test files`);

  // 2. Extract refs and build maps
  log.info('Extracting cross-references...');
  const forward = await processSourceFiles(sourceFiles);
  const testRefs = await processTestFiles(testFiles);

  // 3. Build reverse map
  const reverse = new Map<string, XRefEntry[]>();

  for (const [file, entries] of forward) {
    for (const entry of entries) {
      for (const page of entry.docPages) {
        const pageKey = page.replace(/#.*$/, '');
        if (!reverse.has(pageKey)) reverse.set(pageKey, []);
        reverse.get(pageKey)!.push({ file, line: entry.line, symbol: entry.symbol, type: 'code' });
      }
    }
  }

  for (const ref of testRefs) {
    const pageKey = ref.docPage.replace(/#.*$/, '');
    if (!reverse.has(pageKey)) reverse.set(pageKey, []);
    reverse.get(pageKey)!.push({ file: ref.file, line: ref.line, symbol: ref.symbol, type: 'test' });
  }

  // 4. Collect all doc pages and compute stats
  const allDocPages = await collectDocPages(DOCS_DIR);
  const allReferencedPages = new Set<string>();

  for (const entries of forward.values()) {
    for (const entry of entries) {
      for (const page of entry.docPages) {
        allReferencedPages.add(page.replace(/#.*$/, ''));
      }
    }
  }

  for (const ref of testRefs) {
    allReferencedPages.add(ref.docPage.replace(/#.*$/, ''));
  }

  const missingDocPages = [...allReferencedPages].filter(page => !allDocPages.includes(page)).sort();
  const unreferencedDocPages = allDocPages
    .filter(page => !allReferencedPages.has(page) && !EXCLUDED_DOC_PAGES.has(page))
    .sort();

  // Detect untested pages (have @see but no @source)
  const pagesWithCode = new Set<string>();
  const pagesWithTests = new Set<string>();

  for (const entries of forward.values()) {
    for (const entry of entries) {
      for (const page of entry.docPages) {
        pagesWithCode.add(page.replace(/#.*$/, ''));
      }
    }
  }

  for (const ref of testRefs) {
    pagesWithTests.add(ref.docPage.replace(/#.*$/, ''));
  }

  const untestedDocPages = [...pagesWithCode].filter(p => !pagesWithTests.has(p)).sort();

  // Count refs
  let totalCodeRefs = 0;
  for (const entries of forward.values()) {
    for (const entry of entries) {
      totalCodeRefs += entry.docPages.length;
    }
  }

  // 4b. Content checks — these are the ones that see drift, so they read the pages.
  log.info('Reading documentation pages...');
  const pageContents = new Map<string, DocPageContent>();
  for (const page of allDocPages) {
    pageContents.set(page, parseDocPage(await Bun.file(join(DOCS_DIR, page)).text()));
  }

  const rawRefs = await collectRawRefs(sourceFiles, testFiles);

  // Anchors: a tag pointing into a section that does not exist proves nothing, and
  // silently detaches when a heading is renamed.
  const deadAnchors: DeadAnchor[] = [];
  for (const ref of rawRefs) {
    if (!ref.anchor) continue;
    const content = pageContents.get(ref.page);
    if (!content || content.slugs.includes(ref.anchor)) continue;
    deadAnchors.push({
      file: ref.file,
      line: ref.line,
      page: ref.page,
      anchor: ref.anchor,
      suggestion: suggestAnchor(ref.anchor, content.slugs),
    });
  }

  // A @see whose symbol is never named on the target page is a link in name only.
  const symbolNotOnPage: SymbolMiss[] = [];
  let unresolvedSymbolRefs = 0;
  for (const ref of rawRefs) {
    if (ref.tag !== 'see') continue;
    if (ref.symbol === '<unknown>') {
      unresolvedSymbolRefs++;
      continue;
    }
    const content = pageContents.get(ref.page);
    if (!content || content.text.includes(ref.symbol)) continue;
    symbolNotOnPage.push({ file: ref.file, line: ref.line, symbol: ref.symbol, page: ref.page });
  }

  // Coverage is per snippet: a fence counts as covered when an @source anchor names
  // one of the headings it sits under. A page-level tag with no anchor covers nothing —
  // that laundering is what let `untestedDocPages` read empty while 368 fences had no test.
  const anchorsByPage = new Map<string, Set<string>>();
  for (const ref of rawRefs) {
    if (ref.tag !== 'source' || !ref.anchor) continue;
    if (!anchorsByPage.has(ref.page)) anchorsByPage.set(ref.page, new Set());
    anchorsByPage.get(ref.page)!.add(ref.anchor);
  }

  const coverage: PageCoverage[] = [];
  let totalSnippets = 0;
  let coveredSnippets = 0;

  for (const [page, content] of pageContents) {
    if (content.snippets.length === 0) continue;
    const tagged = anchorsByPage.get(page) ?? new Set<string>();
    const covered = content.snippets.filter(s => s.headingPath.some(h => tagged.has(h))).length;

    totalSnippets += content.snippets.length;
    coveredSnippets += covered;
    coverage.push({
      page,
      snippets: content.snippets.length,
      covered,
      uncovered: content.snippets.length - covered,
    });
  }

  coverage.sort((a, b) => b.uncovered - a.uncovered);

  // 5. Build output
  const output: XRefOutput = {
    generated: new Date().toISOString(),
    stats: {
      totalCodeRefs,
      totalTestRefs: testRefs.length,
      totalDocPages: allDocPages.length,
      unreferencedDocPages,
      untestedDocPages,
      missingDocPages,
      deadAnchors,
      symbolNotOnPage,
      unresolvedSymbolRefs,
      totalSnippets,
      coveredSnippets,
      coverage,
    },
    forward: Object.fromEntries(forward),
    reverse: Object.fromEntries(reverse),
  };

  // 6. Output
  if (MODE_UPDATE_BASELINE) {
    const baseline: Baseline = {
      symbolNotOnPage: symbolNotOnPage.map(symbolMissKey).sort(),
      uncoveredSnippets: Object.fromEntries(
        coverage.filter(c => c.uncovered > 0).map(c => [c.page, c.uncovered]).sort(),
      ),
    };
    await Bun.write(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    log.success(`Baseline written: ${relative(ROOT_DIR, BASELINE_PATH)}`);
    log.info(`${baseline.symbolNotOnPage.length} symbol misses, ${Object.keys(baseline.uncoveredSnippets).length} pages with uncovered snippets`);
    return;
  }

  if (MODE_JSON) {
    console.log(JSON.stringify(output, null, 2));
  } else if (MODE_MARKDOWN) {
    outputMarkdown(output);
  } else if (MODE_CHECK) {
    await outputCheck(output);
  } else {
    outputSummary(output);
  }
}

main().catch((err: Error) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
