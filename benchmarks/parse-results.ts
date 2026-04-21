#!/usr/bin/env bun
/* eslint-disable no-console */

/**
 * Parses bombardier output files and startup results into structured JSON.
 *
 * Reads:
 *   benchmarks/results/*.txt              — bombardier HTTP benchmark output
 *   benchmarks/results/realistic-*.txt    — realistic benchmark output
 *   benchmarks/results/startup.json       — startup timing results
 *
 * Writes:
 *   benchmarks/results/benchmark-results.json
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT_DIR = import.meta.dir;
const RESULTS_DIR = join(SCRIPT_DIR, 'results');

interface HttpResult {
  name: string;
  reqPerSec: number;
  avgLatency: string;
  maxLatency: string;
  p99Latency: string;
  p95Latency: string;
  throughput: string;
}

interface StartupResult {
  name: string;
  meanMs: number;
  minMs: number;
  maxMs: number;
}

interface RealisticEndpointResult {
  endpoint: string;
  reqPerSec: number;
  avgLatency: string;
  maxLatency: string;
  p99Latency: string;
  p95Latency: string;
  throughput: string;
}

interface RealisticFrameworkResult {
  name: string;
  endpoints: RealisticEndpointResult[];
}

interface BenchmarkResults {
  date: string;
  machine: {
    cpu: string;
    ram: string;
    os: string;
    bunVersion: string;
    nodeVersion: string;
  };
  settings: string;
  http: HttpResult[];
  startup: StartupResult[];
  realistic: RealisticFrameworkResult[];
  realisticPg: RealisticFrameworkResult[];
}

// Display name mapping for benchmark files
const DISPLAY_NAMES: Record<string, string> = {
  'bun-serve': 'Bun.serve (baseline)',
  'onebun': 'OneBun',
  'hono': 'Hono',
  'elysia': 'Elysia',
  'nestjs-fastify-bun': 'NestJS + Fastify (Bun)',
  'nestjs-fastify-node': 'NestJS + Fastify (Node)',
  'nestjs-typeorm-node': 'NestJS + TypeORM (Node)',
  'onebun-full': 'OneBun (full observability)',
};

// Endpoint slug → display name
const ENDPOINT_NAMES: Record<string, string> = {
  'posts-list': 'GET /api/posts',
  'post-detail': 'GET /api/posts/:id',
  'post-create': 'POST /api/posts',
};

function parseBombardierOutput(content: string): Omit<HttpResult, 'name'> | null {
  // Parse: Reqs/sec     57019.03    5299.24   65335.33
  const reqsMatch = content.match(/Reqs\/sec\s+([\d.]+)/);
  // Parse: Latency        0.88ms   217.55us    23.56ms
  const latencyMatch = content.match(/^\s+Latency\s+([\d.]+(?:us|ms|s))\s+[\d.]+(?:us|ms|s)\s+([\d.]+(?:us|ms|s))/m);
  // Parse: 95%     1.51ms
  const p95Match = content.match(/95%\s+([\d.]+(?:us|ms|s))/);
  // Parse: 99%     1.97ms
  const p99Match = content.match(/99%\s+([\d.]+(?:us|ms|s))/);
  // Parse: Throughput:    13.86MB/s
  const throughputMatch = content.match(/Throughput:\s+([\d.]+\S+)/);

  if (!reqsMatch || !latencyMatch) {
    return null;
  }

  return {
    reqPerSec: parseFloat(reqsMatch[1]),
    avgLatency: latencyMatch[1],
    maxLatency: latencyMatch[2],
    p99Latency: p99Match ? p99Match[1] : 'N/A',
    p95Latency: p95Match ? p95Match[1] : 'N/A',
    throughput: throughputMatch ? throughputMatch[1] : 'N/A',
  };
}

function getSystemInfo() {
  const bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf-8' }).trim();

  let nodeVersion = 'N/A';
  try {
    nodeVersion = execFileSync('node', ['--version'], { encoding: 'utf-8' }).trim();
  } catch {
    try {
      nodeVersion = execFileSync('fnm', ['exec', '--using=24', 'node', '--version'], { encoding: 'utf-8' }).trim();
    } catch {
      // Node.js may not be available
    }
  }

  const cpu = execFileSync('uname', ['-m'], { encoding: 'utf-8' }).trim();
  const osName = execFileSync('uname', ['-s'], { encoding: 'utf-8' }).trim();
  const osRelease = execFileSync('uname', ['-r'], { encoding: 'utf-8' }).trim();

  let ram = 'N/A';
  try {
    const memBytes = parseInt(execFileSync('grep', ['MemTotal', '/proc/meminfo'], { encoding: 'utf-8' }).match(/\d+/)?.[0] || '0', 10);
    ram = `${Math.round(memBytes / 1024 / 1024)} GB`;
  } catch {
    // /proc/meminfo not available on all systems
  }

  return {
    date: new Date().toISOString(),
    machine: {
      cpu,
      ram,
      os: `${osName} ${osRelease}`,
      bunVersion,
      nodeVersion,
    },
    settings: '50 connections, 10s duration',
  };
}

function parseRealisticResults(txtFiles: string[], prefix: string): RealisticFrameworkResult[] {
  // Group files by framework: {prefix}-{framework}-{endpoint}.txt
  const frameworkMap = new Map<string, RealisticEndpointResult[]>();
  const pattern = new RegExp(`^${prefix}-(.+?)-(posts-list|post-detail|post-create)$`);

  for (const file of txtFiles) {
    const slug = basename(file, '.txt');
    const match = slug.match(pattern);
    if (!match) continue;

    const [, framework, endpointSlug] = match;
    const content = readFileSync(join(RESULTS_DIR, file), 'utf-8');
    const parsed = parseBombardierOutput(content);

    if (!parsed) {
      console.warn(`Warning: Could not parse ${file}`);
      continue;
    }

    const endpoints = frameworkMap.get(framework) || [];
    endpoints.push({
      endpoint: ENDPOINT_NAMES[endpointSlug] || endpointSlug,
      ...parsed,
    });
    frameworkMap.set(framework, endpoints);
  }

  const results: RealisticFrameworkResult[] = [];
  for (const [framework, endpoints] of frameworkMap) {
    results.push({
      name: DISPLAY_NAMES[framework] || framework,
      endpoints,
    });
  }

  return results;
}

function main() {
  if (!existsSync(RESULTS_DIR)) {
    console.error(`Results directory not found: ${RESULTS_DIR}`);
    console.error('Run the benchmarks first (run-all.sh).');
    process.exit(1);
  }

  const allFiles = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.txt'));
  const simpleFiles = allFiles.filter((f) => !f.startsWith('realistic-'));
  const realisticFiles = allFiles.filter((f) => f.startsWith('realistic-') && !f.startsWith('realistic-pg-'));
  const realisticPgFiles = allFiles.filter((f) => f.startsWith('realistic-pg-'));

  // Parse simple HTTP benchmark results
  const httpResults: HttpResult[] = [];

  for (const file of simpleFiles) {
    const content = readFileSync(join(RESULTS_DIR, file), 'utf-8');
    const slug = basename(file, '.txt');
    const parsed = parseBombardierOutput(content);

    if (parsed) {
      httpResults.push({
        name: DISPLAY_NAMES[slug] || slug,
        ...parsed,
      });
    } else {
      console.warn(`Warning: Could not parse ${file}`);
    }
  }

  // Sort by req/sec descending
  httpResults.sort((a, b) => b.reqPerSec - a.reqPerSec);

  // Parse realistic benchmark results (SQLite)
  const realisticResults = parseRealisticResults(realisticFiles, 'realistic');

  // Parse realistic PostgreSQL benchmark results
  const realisticPgResults = parseRealisticResults(realisticPgFiles, 'realistic-pg');

  // Parse startup results
  let startupResults: StartupResult[] = [];
  const startupPath = join(RESULTS_DIR, 'startup.json');

  if (existsSync(startupPath)) {
    try {
      startupResults = JSON.parse(readFileSync(startupPath, 'utf-8'));
    } catch (e) {
      console.warn(`Warning: Could not parse startup.json: ${e}`);
    }
  } else {
    console.warn('Warning: startup.json not found, startup results will be empty');
  }

  const sysInfo = getSystemInfo();
  const results: BenchmarkResults = {
    date: sysInfo.date,
    machine: sysInfo.machine,
    settings: sysInfo.settings,
    http: httpResults,
    startup: startupResults,
    realistic: realisticResults,
    realisticPg: realisticPgResults,
  };

  const outputPath = join(RESULTS_DIR, 'benchmark-results.json');
  writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`Benchmark results written to ${outputPath}`);
  console.log(`  HTTP results: ${httpResults.length} frameworks`);
  console.log(`  Realistic (SQLite) results: ${realisticResults.length} frameworks`);
  console.log(`  Realistic (PostgreSQL) results: ${realisticPgResults.length} frameworks`);
  console.log(`  Startup results: ${startupResults.length} frameworks`);
}

main();
