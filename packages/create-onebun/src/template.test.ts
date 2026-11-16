import { join } from 'node:path';

import {
  describe,
  expect,
  test,
} from 'bun:test';

import { scaffoldFiles } from './template';

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const coreVersion = async (): Promise<string> => {
  const manifest = await Bun.file(join(import.meta.dir, '..', '..', 'core', 'package.json')).json() as Manifest;

  return manifest.version;
};

const scaffoldedManifest = (): Manifest => JSON.parse(scaffoldFiles('my-app')['package.json']) as Manifest;

describe('scaffold template', () => {
  // A caret on 0.x pins the minor: a range left on an older minor installs that minor's last patch
  // into every new project, whatever core has shipped since. Every minor release moves core, so
  // this fails until the template follows.
  test('depends on a caret range of @onebun/core that the workspace core version satisfies', async () => {
    const version = await coreVersion();
    const range = scaffoldedManifest().dependencies?.['@onebun/core'];

    expect(range).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(Bun.semver.satisfies(version, range!)).toBe(true);
    // The range's minor is core's minor, also from 1.0 on, where a caret alone would allow an older one
    const [major, minor] = version.split('.');
    expect(range!.slice(1).split('.').slice(0, 2)).toEqual([major, minor]);
  });

  test('writes package.json and tsconfig.json as valid JSON', () => {
    const files = scaffoldFiles('my-app');

    expect(() => JSON.parse(files['package.json'])).not.toThrow();
    expect(() => JSON.parse(files['tsconfig.json'])).not.toThrow();
  });
});
