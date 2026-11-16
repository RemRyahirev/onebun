#!/usr/bin/env bun
/* eslint-disable no-console */

import { scaffoldFiles } from './template';

const projectName = process.argv[2];

if (!projectName) {
  console.log('Usage: bun create @onebun <project-name>');
  console.log('');
  console.log('Example:');
  console.log('  bun create @onebun my-app');
  process.exit(1);
}

const projectDir = `${process.cwd()}/${projectName}`;

// Check if directory already exists
const exists = await Bun.file(projectDir).exists().catch(() => false);

if (exists) {
  console.error(`Error: Directory "${projectName}" already exists.`);
  process.exit(1);
}

console.log(`\nCreating a new OneBun project in ${projectDir}...\n`);

// --- Write files ---

const files = Object.entries(scaffoldFiles(projectName));

await Promise.all(files.map(async ([path, content]) => await Bun.write(`${projectDir}/${path}`, content)));

for (const [path] of files) {
  console.log(`  Created ${path}`);
}

// --- Run bun install ---

console.log('\nInstalling dependencies...\n');

const install = Bun.spawn(['bun', 'install'], {
  cwd: projectDir,
  stdout: 'inherit',
  stderr: 'inherit',
});

const exitCode = await install.exited;

if (exitCode !== 0) {
  console.error('\nFailed to install dependencies. You can try running "bun install" manually.');
}

// --- Success message ---

console.log(`
Done! Your OneBun project is ready.

  cd ${projectName}
  bun run dev

Happy coding!
`);
