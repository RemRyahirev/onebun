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

interface XRefOutput {
  generated: string;
  stats: {
    totalCodeRefs: number;
    totalTestRefs: number;
    totalDocPages: number;
    unreferencedDocPages: string[];
    untestedDocPages: string[];
    missingDocPages: string[];
  };
  forward: Record<string, ForwardEntry[]>;
  reverse: Record<string, XRefEntry[]>;
}

// --- Constants ---

const ROOT_DIR = join(import.meta.dir, '..');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');
const DOCS_DIR = join(ROOT_DIR, 'docs');

const MODE_JSON = process.argv.includes('--json');
const MODE_MARKDOWN = process.argv.includes('--markdown');
const MODE_CHECK = process.argv.includes('--check');

const SYMBOL_REGEX = /export\s+(?:default\s+)?(?:abstract\s+)?(?:function|class|interface|type|const|enum|let|var)\s+(\w+)/;
const DESCRIBE_IT_REGEX = /(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/;

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
    } else if (entry.name === 'docs-examples.test.ts') {
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

function outputCheck(output: XRefOutput) {
  const { stats } = output;
  let hasErrors = false;

  if (stats.missingDocPages.length > 0) {
    hasErrors = true;
    log.error(`${stats.missingDocPages.length} broken doc link(s):`);
    for (const page of stats.missingDocPages) {
      log.dim(`docs:${page} — file does not exist`);
    }
  }

  if (!hasErrors) {
    log.success('All cross-references are valid');
    log.info(`${stats.totalCodeRefs} code refs, ${stats.totalTestRefs} test refs across ${new Set([...Object.keys(output.reverse)]).size} doc pages`);

    if (stats.unreferencedDocPages.length > 0) {
      log.warn(`${stats.unreferencedDocPages.length} doc page(s) have no references (not an error)`);
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
    },
    forward: Object.fromEntries(forward),
    reverse: Object.fromEntries(reverse),
  };

  // 6. Output
  if (MODE_JSON) {
    console.log(JSON.stringify(output, null, 2));
  } else if (MODE_MARKDOWN) {
    outputMarkdown(output);
  } else if (MODE_CHECK) {
    outputCheck(output);
  } else {
    outputSummary(output);
  }
}

main().catch((err: Error) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
