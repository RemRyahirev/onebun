#!/usr/bin/env bun
/* eslint-disable no-console */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RESULTS_PATH = join(import.meta.dir, 'results', 'benchmark-results.json');

async function main() {
  const gistToken = process.env.GIST_TOKEN;
  const gistId = process.env.BENCHMARK_GIST_ID;

  if (!gistToken || !gistId) {
    console.log('Skipping gist upload — missing environment variables.');
    console.log('');
    console.log('To enable gist upload, set:');
    console.log('  GIST_TOKEN=<your GitHub personal access token with gist scope>');
    console.log('  BENCHMARK_GIST_ID=<your gist ID>');
    console.log('');
    console.log('Create a gist at https://gist.github.com and generate a token at');
    console.log('https://github.com/settings/tokens with the "gist" scope.');
    return;
  }

  let content: string;

  try {
    content = await readFile(RESULTS_PATH, 'utf-8');
  } catch {
    console.error(`Could not read ${RESULTS_PATH}`);
    console.error('Run parse-results.ts first to generate the benchmark results.');
    process.exit(1);
  }

  // Validate JSON
  try {
    JSON.parse(content);
  } catch {
    console.error('benchmark-results.json contains invalid JSON');
    process.exit(1);
  }

  console.log('Uploading benchmark results to GitHub Gist...');

  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `token ${gistToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({
      files: {
        'onebun-benchmark-results.json': {
          content,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`GitHub API error: ${response.status} ${response.statusText}`);
    console.error(errorBody);
    process.exit(1);
  }

  const gist = await response.json() as { html_url: string };
  console.log(`Benchmark results uploaded successfully!`);
  console.log(`Gist URL: ${gist.html_url}`);
}

main().catch((err) => {
  console.error('Upload failed:', err);
  process.exit(1);
});
