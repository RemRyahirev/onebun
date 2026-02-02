#!/usr/bin/env bun
/**
 * OneBun Monorepo Package Publisher
 *
 * This script handles publishing packages to npm with the following features:
 * - Validates bun.lock is up to date
 * - Runs tests before publishing
 * - Detects changed packages since last publish
 * - Compares local vs published versions
 * - Warns if changes exist but version not bumped
 * - Creates git tags after successful publish
 *
 * Usage:
 *   bun scripts/publish.ts              # Publish changed packages
 *   bun scripts/publish.ts --dry-run    # Show what would be published
 */

import { $ } from 'bun';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ANSI colors for console output
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
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  step: (msg: string) => console.log(`\n${colors.cyan}▸${colors.reset} ${msg}`),
  dim: (msg: string) => console.log(`${colors.dim}  ${msg}${colors.reset}`),
};

interface PackageInfo {
  name: string;
  path: string;
  version: string;
  hasChanges: boolean;
  changeDetectionMethod?: 'npm-githead' | 'git-tag' | 'version-compare' | 'unknown';
  changedFiles?: string[];
}

interface PublishResult {
  name: string;
  status: 'published' | 'skipped' | 'warning' | 'error';
  message: string;
}

const ROOT_DIR = join(import.meta.dir, '..');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Compare semantic versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => v.split('.').map(Number);
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1;
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1;
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1;
  return 0;
}

/**
 * Validate that bun.lock is up to date
 */
async function validateLockfile(): Promise<boolean> {
  log.step('Validating bun.lock...');

  try {
    // Run bun install with --frozen-lockfile to check if lockfile is up to date
    const result = await $`bun install --frozen-lockfile`.nothrow();
    const output = result.stdout.toString() + result.stderr.toString();

    // Check for actual lockfile issues (not optional dependency failures)
    // "Failed to install N package" with optional deps is OK
    // "lockfile is out of date" or "lockfile has changed" is NOT OK
    const lockfileOutOfDate = output.includes('lockfile') && 
      (output.includes('out of date') || output.includes('has changed') || output.includes('frozen'));
    
    // If exit code is 0, everything is fine
    if (result.exitCode === 0) {
      log.success('bun.lock is up to date');
      return true;
    }

    // If exit code is non-zero, check if it's just optional dependency failure
    // Optional dep failures show "Failed to install N package" but also have
    // "deleting optional dependency" warnings
    const isOptionalDepFailure = output.includes('optional dependency') || 
      output.includes('Failed to install 1 package');
    
    if (isOptionalDepFailure && !lockfileOutOfDate) {
      log.success('bun.lock is up to date (optional dependency build failed, but lockfile is valid)');
      return true;
    }

    log.error('bun.lock is out of date. Run "bun install" first.');
    return false;
  } catch {
    log.error('bun.lock is out of date. Run "bun install" first.');
    return false;
  }
}

/**
 * Run unit tests (excluding integration tests that require Docker/external services)
 */
async function runTests(): Promise<boolean> {
  log.step('Running unit tests (excluding integration tests)...');

  try {
    // Get all test files excluding integration and redis tests
    const findResult = await $`find packages -name "*.test.ts" ! -name "*integration*" ! -name "*redis*"`.nothrow();
    const testFiles = findResult.stdout.toString().trim().split('\n').filter(Boolean);

    if (testFiles.length === 0) {
      log.warn('No test files found');
      return true;
    }

    // Run tests on the filtered files (join with space for shell command)
    const testFilesArg = testFiles.join(' ');
    const result = await $`bun test ${{ raw: testFilesArg }}`.nothrow();
    const output = result.stderr.toString() + result.stdout.toString();

    // Check if tests passed by looking for "0 fail" in output
    const failMatch = output.match(/(\d+)\s+fail/);
    const passMatch = output.match(/(\d+)\s+pass/);

    if (failMatch && passMatch) {
      const failCount = parseInt(failMatch[1], 10);
      const passCount = parseInt(passMatch[1], 10);

      if (failCount === 0 && passCount > 0) {
        log.success(`All unit tests passed (${passCount} tests)`);
        return true;
      }
      log.error(`Tests failed: ${failCount} failed, ${passCount} passed`);
      return false;
    }

    // Fallback to exit code if we can't parse output
    if (result.exitCode === 0) {
      log.success('All unit tests passed');
      return true;
    }

    log.error('Tests failed');
    console.log(output);
    return false;
  } catch (error) {
    log.error('Failed to run tests');
    console.error(error);
    return false;
  }
}

/**
 * Run TypeScript type checking
 */
async function runTypeCheck(): Promise<boolean> {
  log.step('Running type check...');

  try {
    const result = await $`bunx tsc --noEmit`.nothrow();
    if (result.exitCode === 0) {
      log.success('Type check passed');
      return true;
    }
    log.error('Type check failed');
    console.log(result.stderr.toString() + result.stdout.toString());
    return false;
  } catch (error) {
    log.error('Failed to run type check');
    console.error(error);
    return false;
  }
}

/**
 * Run linter (without --fix, just check)
 */
async function runLint(): Promise<boolean> {
  log.step('Running linter...');

  try {
    // Run eslint without --fix to just check, not modify
    const result = await $`bunx eslint packages/`.nothrow();
    if (result.exitCode === 0) {
      log.success('Linter passed');
      return true;
    }
    log.error('Linter found errors');
    console.log(result.stdout.toString() + result.stderr.toString());
    return false;
  } catch (error) {
    log.error('Failed to run linter');
    console.error(error);
    return false;
  }
}

/**
 * Check for potential secrets in source files (warning only)
 */
async function checkForSecrets(): Promise<void> {
  log.step('Checking for potential secrets...');

  // Patterns that detect hardcoded secrets (not variable names)
  // Looking for: key = 'actual_long_value' or key: "actual_long_value"
  const patterns = [
    // Hardcoded password with actual value (not just variable assignment)
    /password\s*[:=]\s*['"][a-zA-Z0-9_!@#$%^&*]{8,}['"]/gi,
    // Hardcoded API key with actual value
    /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/gi,
    // Private keys
    /-----BEGIN.*PRIVATE KEY-----/,
    // Connection strings with embedded passwords (not template variables)
    /(mongodb|postgres|redis):\/\/[^:]+:[^@${\s]{8,}@/,
  ];

  // Patterns to exclude (test files patterns, example values)
  const excludePatterns = [
    /password\s*[:=]\s*['"]password['"]/i, // password: 'password'
    /password\s*[:=]\s*['"]pass['"]/i, // password: 'pass'
    /password\s*[:=]\s*['"]test/i, // password: 'test...'
    /password\s*[:=]\s*['"]secret['"]/i, // password: 'secret'
    /api[_-]?key\s*[:=]\s*['"]test/i, // api_key: 'test...'
    /example\.com/i, // example URLs
  ];

  const warnings: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'tests'].includes(entry.name)) {
          await scanDir(fullPath);
        }
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const content = await Bun.file(fullPath).text();
        for (const pattern of patterns) {
          const matches = content.match(pattern);
          if (matches) {
            // Check if match is excluded
            const isExcluded = matches.every((match) => excludePatterns.some((ep) => ep.test(match)));
            if (!isExcluded) {
              warnings.push(`Potential secret in ${fullPath.replace(ROOT_DIR, '')}`);
              break;
            }
          }
        }
      }
    }
  }

  await scanDir(PACKAGES_DIR);

  if (warnings.length > 0) {
    log.warn('Potential secrets found (please verify these are not real credentials):');
    warnings.forEach((w) => log.dim(w));
  } else {
    log.success('No potential secrets detected');
  }
}

/**
 * Get gitHead (commit hash) from npm registry for a published package
 */
async function getPublishedGitHead(packageName: string): Promise<string | null> {
  try {
    const result = await $`npm view ${packageName} gitHead 2>/dev/null`.quiet();
    if (result.exitCode === 0) {
      const gitHead = result.stdout.toString().trim();
      // Validate it looks like a git hash (40 hex chars)
      if (gitHead && /^[a-f0-9]{40}$/i.test(gitHead)) {
        return gitHead;
      }
    }
  } catch {
    // gitHead not available
  }
  return null;
}

/**
 * Fetch tags from remote (run once before checking tags)
 */
let tagsFetched = false;
async function ensureTagsFetched(): Promise<void> {
  if (tagsFetched) return;

  try {
    log.dim('Fetching tags from remote...');
    await $`git fetch --tags --quiet`.quiet();
    tagsFetched = true;
  } catch {
    log.warn('Failed to fetch tags from remote');
  }
}

/**
 * Get the last publish tag for a specific package
 * Returns the most recent tag matching the package name pattern (e.g., @onebun/cache@*)
 */
async function getLastPublishTagForPackage(packageName: string): Promise<string | null> {
  await ensureTagsFetched();

  try {
    // Find tags matching this package, sorted by version (newest first)
    const result = await $`git tag --list ${packageName}@* --sort=-v:refname`.quiet();
    if (result.exitCode === 0) {
      const tags = result.stdout.toString().trim().split('\n').filter(Boolean);
      if (tags.length > 0) {
        return tags[0]; // Return most recent tag for this package
      }
    }
  } catch {
    // No tags for this package
  }
  return null;
}

/**
 * Get list of changed files in a package directory since a given git ref
 */
async function getChangedFilesSinceRef(pkg: PackageInfo, ref: string): Promise<string[]> {
  try {
    const pkgDir = pkg.path.replace(ROOT_DIR + '/', '');
    const result = await $`git diff --name-only ${ref}...HEAD -- ${pkgDir}/`.quiet();
    return result.stdout.toString().trim().split('\n').filter(Boolean);
  } catch {
    // If comparison fails, return empty (can't determine)
    return [];
  }
}

interface ChangeDetectionResult {
  hasChanges: boolean;
  method: 'npm-githead' | 'git-tag' | 'version-compare' | 'unknown';
  changedFiles: string[];
}

/**
 * Detect if a package has changes since last publish using multiple strategies:
 * 1. First try gitHead from npm registry (most reliable)
 * 2. If that fails, try git tags (after fetching from remote)
 * 3. If nothing works, compare versions or mark as unknown
 */
async function detectPackageChanges(pkg: PackageInfo, publishedVersion: string | null): Promise<ChangeDetectionResult> {
  // Strategy 1: Try gitHead from npm
  const gitHead = await getPublishedGitHead(pkg.name);
  if (gitHead) {
    const changedFiles = await getChangedFilesSinceRef(pkg, gitHead);
    return { hasChanges: changedFiles.length > 0, method: 'npm-githead', changedFiles };
  }

  // Strategy 2: Try git tags (fetch first)
  const lastTag = await getLastPublishTagForPackage(pkg.name);
  if (lastTag) {
    const changedFiles = await getChangedFilesSinceRef(pkg, lastTag);
    return { hasChanges: changedFiles.length > 0, method: 'git-tag', changedFiles };
  }

  // Strategy 3: Fall back to version comparison
  if (publishedVersion !== null) {
    if (compareVersions(pkg.version, publishedVersion) === 0) {
      // Same version - assume no changes (can't verify)
      return { hasChanges: false, method: 'version-compare', changedFiles: [] };
    }
    // Different version - assume there are changes
    return { hasChanges: true, method: 'version-compare', changedFiles: [] };
  }

  // Can't determine - package is published but we have no way to check changes
  return { hasChanges: true, method: 'unknown', changedFiles: [] };
}

/**
 * Get all packages in the monorepo
 */
async function getAllPackages(): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pkgPath = join(PACKAGES_DIR, entry.name);
      const pkgJsonPath = join(pkgPath, 'package.json');

      try {
        const pkgJson = await Bun.file(pkgJsonPath).json();
        packages.push({
          name: pkgJson.name,
          path: pkgPath,
          version: pkgJson.version,
          hasChanges: false,
        });
      } catch {
        // Skip directories without package.json
      }
    }
  }

  return packages;
}

/**
 * Build a map of package name -> version for all packages in monorepo
 */
async function buildWorkspaceVersionMap(): Promise<Map<string, string>> {
  const packages = await getAllPackages();
  const versionMap = new Map<string, string>();
  for (const pkg of packages) {
    versionMap.set(pkg.name, pkg.version);
  }
  return versionMap;
}

/**
 * Replace workspace:^ and workspace:* dependencies with actual versions
 * Returns the original package.json content for restoration
 */
async function replaceWorkspaceDeps(pkgPath: string, versionMap: Map<string, string>): Promise<string> {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const originalContent = await Bun.file(pkgJsonPath).text();
  const pkgJson = JSON.parse(originalContent);

  const replaceDeps = (deps: Record<string, string> | undefined) => {
    if (!deps) return;
    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith('workspace:')) {
        const realVersion = versionMap.get(name);
        if (realVersion) {
          // workspace:^ -> ^version, workspace:* -> version
          deps[name] = version === 'workspace:*' ? realVersion : `^${realVersion}`;
        } else {
          log.warn(`Could not resolve workspace dependency: ${name}`);
        }
      }
    }
  };

  replaceDeps(pkgJson.dependencies);
  replaceDeps(pkgJson.devDependencies);
  replaceDeps(pkgJson.peerDependencies);
  replaceDeps(pkgJson.optionalDependencies);

  await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
  return originalContent;
}

/**
 * Restore original package.json content after publish
 */
async function restorePackageJson(pkgPath: string, originalContent: string): Promise<void> {
  const pkgJsonPath = join(pkgPath, 'package.json');
  await Bun.write(pkgJsonPath, originalContent);
}

/**
 * Get published version of a package from npm
 */
async function getPublishedVersion(packageName: string): Promise<string | null> {
  try {
    const result = await $`npm view ${packageName} version 2>/dev/null`.quiet();
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch {
    // Package not published yet
  }
  return null;
}

/**
 * Publish a single package
 */
async function publishPackage(pkg: PackageInfo, versionMap: Map<string, string>): Promise<boolean> {
  log.dim(`Publishing ${pkg.name}@${pkg.version}...`);

  // Replace workspace deps with real versions
  let originalContent: string | null = null;
  try {
    originalContent = await replaceWorkspaceDeps(pkg.path, versionMap);
  } catch (error) {
    log.error(`Failed to replace workspace deps for ${pkg.name}`);
    console.error(error);
    return false;
  }

  if (DRY_RUN) {
    log.dim(`[DRY RUN] Would publish ${pkg.name}@${pkg.version}`);
    // Restore original package.json
    if (originalContent) {
      await restorePackageJson(pkg.path, originalContent);
    }
    return true;
  }

  try {
    const result = await $`npm publish --access public`.cwd(pkg.path).quiet();

    // Always restore original package.json after publish attempt
    if (originalContent) {
      await restorePackageJson(pkg.path, originalContent);
    }

    if (result.exitCode === 0) {
      return true;
    }
    log.error(`Failed to publish ${pkg.name}: ${result.stderr.toString()}`);
    return false;
  } catch (error) {
    // Restore original package.json even on error
    if (originalContent) {
      await restorePackageJson(pkg.path, originalContent);
    }
    log.error(`Failed to publish ${pkg.name}`);
    console.error(error);
    return false;
  }
}

/**
 * Create git tag for published package
 */
async function createGitTag(pkg: PackageInfo): Promise<boolean> {
  const tag = `${pkg.name}@${pkg.version}`;

  if (DRY_RUN) {
    log.dim(`[DRY RUN] Would create tag: ${tag}`);
    return true;
  }

  try {
    await $`git tag ${tag}`.quiet();
    log.dim(`Created tag: ${tag}`);
    return true;
  } catch {
    log.warn(`Failed to create tag: ${tag}`);
    return false;
  }
}

/**
 * Main publish workflow
 */
async function main(): Promise<void> {
  console.log('\n📦 OneBun Package Publisher\n');

  if (DRY_RUN) {
    log.warn('DRY RUN MODE - No actual publishing will occur\n');
  }

  // Step 1: Validate lockfile
  if (!await validateLockfile()) {
    process.exit(1);
  }

  // Step 2: Run tests
  if (!await runTests()) {
    process.exit(1);
  }

  // Step 3: Run type check
  if (!await runTypeCheck()) {
    process.exit(1);
  }

  // Step 4: Run linter
  if (!await runLint()) {
    process.exit(1);
  }

  // Step 5: Check for secrets (warning only)
  await checkForSecrets();

  // Step 6: Get packages to process
  log.step('Detecting packages to publish...');

  const allPackages = await getAllPackages();

  // Check which packages need publishing (not yet in npm or have changes since their own last tag)
  const packagesToProcess: PackageInfo[] = [];
  const unknownStatePackages: PackageInfo[] = [];

  for (const pkg of allPackages) {
    const publishedVersion = await getPublishedVersion(pkg.name);

    if (publishedVersion === null) {
      // Not published yet - always include
      pkg.hasChanges = true;
      pkg.changeDetectionMethod = 'version-compare';
      packagesToProcess.push(pkg);
    } else {
      // Detect changes using multiple strategies
      const detection = await detectPackageChanges(pkg, publishedVersion);
      pkg.hasChanges = detection.hasChanges;
      pkg.changeDetectionMethod = detection.method;
      pkg.changedFiles = detection.changedFiles;

      if (detection.method === 'unknown') {
        // Can't reliably determine changes - track for warning
        unknownStatePackages.push(pkg);
      }

      if (pkg.hasChanges) {
        // Has changes since last publish
        packagesToProcess.push(pkg);
      } else if (compareVersions(pkg.version, publishedVersion) > 0) {
        // Version bumped but no git changes detected (edge case)
        pkg.hasChanges = true;
        packagesToProcess.push(pkg);
      }
    }
  }

  // Warn about packages where we couldn't determine change state
  if (unknownStatePackages.length > 0) {
    log.warn(`Could not reliably detect changes for ${unknownStatePackages.length} package(s):`);
    unknownStatePackages.forEach((p) => log.dim(`  - ${p.name}: no gitHead in npm and no git tags found`));
    log.dim('  These packages will be included if version differs from published.');
  }

  if (packagesToProcess.length === 0) {
    log.info('No packages need publishing');
    return;
  }

  log.info(`Found ${packagesToProcess.length} package(s) to process:`);
  packagesToProcess.forEach((p) => {
    const methodHint = p.changeDetectionMethod === 'npm-githead' ? 'via npm gitHead'
      : p.changeDetectionMethod === 'git-tag' ? 'via git tag'
        : p.changeDetectionMethod === 'version-compare' ? 'via version compare'
          : 'detection uncertain';
    log.dim(`  - ${p.name}@${p.version} (${methodHint})`);
  });

  // Step 7: Process each package
  log.step('Processing packages...');

  // Build version map for workspace dependency resolution
  const versionMap = await buildWorkspaceVersionMap();

  const results: PublishResult[] = [];

  for (const pkg of packagesToProcess) {
    const publishedVersion = await getPublishedVersion(pkg.name);

    if (publishedVersion === null) {
      // Package not published yet - publish it
      log.info(`${pkg.name} not published yet, publishing ${pkg.version}...`);
      const success = await publishPackage(pkg, versionMap);
      if (success) {
        await createGitTag(pkg);
        results.push({ name: pkg.name, status: 'published', message: `Published ${pkg.version}` });
      } else {
        results.push({ name: pkg.name, status: 'error', message: 'Failed to publish' });
      }
    } else if (compareVersions(pkg.version, publishedVersion) > 0) {
      // Local version is newer - publish it
      log.info(`${pkg.name}: ${publishedVersion} → ${pkg.version}`);
      const success = await publishPackage(pkg, versionMap);
      if (success) {
        await createGitTag(pkg);
        results.push({ name: pkg.name, status: 'published', message: `Published ${pkg.version}` });
      } else {
        results.push({ name: pkg.name, status: 'error', message: 'Failed to publish' });
      }
    } else {
      // Version not bumped - show changed files info
      const fileCount = pkg.changedFiles?.length ?? 0;
      const fileCountStr = fileCount > 0 ? ` (${fileCount} file${fileCount > 1 ? 's' : ''} changed)` : '';
      log.warn(`${pkg.name} has changes but version (${pkg.version}) not bumped!${fileCountStr}`);

      // Show first 3 changed files
      if (pkg.changedFiles && pkg.changedFiles.length > 0) {
        const filesToShow = pkg.changedFiles.slice(0, 3);
        filesToShow.forEach((file) => log.dim(`    ${file}`));
        if (pkg.changedFiles.length > 3) {
          log.dim(`    ... and ${pkg.changedFiles.length - 3} more`);
        }
      }

      results.push({
        name: pkg.name,
        status: 'warning',
        message: `Changes detected (${fileCount} files) but version ${pkg.version} already published`,
      });
    }
  }

  // Summary
  log.step('Summary:');
  const published = results.filter((r) => r.status === 'published');
  const warnings = results.filter((r) => r.status === 'warning');
  const errors = results.filter((r) => r.status === 'error');

  if (published.length > 0) {
    log.success(`Published: ${published.length} package(s)`);
    published.forEach((r) => log.dim(`  - ${r.name}: ${r.message}`));
  }

  if (warnings.length > 0) {
    log.warn(`Warnings: ${warnings.length} package(s) need version bump`);
    warnings.forEach((r) => log.dim(`  - ${r.name}: ${r.message}`));
  }

  if (errors.length > 0) {
    log.error(`Errors: ${errors.length} package(s) failed to publish`);
    errors.forEach((r) => log.dim(`  - ${r.name}: ${r.message}`));
    process.exit(1);
  }

  // Push tags if not dry run
  if (!DRY_RUN && published.length > 0) {
    log.step('Pushing tags to remote...');
    try {
      await $`git push --tags`.quiet();
      log.success('Tags pushed successfully');
    } catch {
      log.warn('Failed to push tags (you may need to push manually)');
    }
  }

  console.log('\n✨ Done!\n');
}

main().catch((error) => {
  log.error('Unexpected error:');
  console.error(error);
  process.exit(1);
});
