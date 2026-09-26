/**
 * The global Reflect Metadata API against reflect-metadata loaded before or after @onebun/core
 * (onebun-FB-33).
 *
 * @onebun/core 0.8.1 installed three partial functions on the global `Reflect`. reflect-metadata
 * 0.2.x, loaded later by a dependency (`@simplewebauthn/server` via tsyringe), adopted that partial
 * global as a legacy provider and crashed on its missing `getOwnMetadataKeys`; 0.1.x filled the gaps
 * with a second store and lost tsyringe tokens. Import order is a property of the PROCESS, so every
 * order is checked in a fresh `bun` process (`reflect-interop-fixtures/run-scenario.ts`) against an
 * in-repo emulation of both generations — the real package is not a dependency and is not imported
 * by any test.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import { Service } from '../module/service';

import { getConstructorParamTypes } from './decorators';
import { runScenario, type ScenarioRun } from './reflect-interop-fixtures/scenario-protocol';

const SCENARIOS = [
  // reflect-metadata 0.2.x after core, before core, twice after core, and 0.2.1's variant
  'core,early,token,rm02',
  'rm02,core,early',
  'core,early,rm02,rm02',
  'core,early,rm021',
  // reflect-metadata 0.1.x after and before core
  'core,early,token,rm01',
  'rm01,core,early',
  // 0.1.x then 0.2.x after classes were decorated — silent loss on 0.8.1
  'core,early,token,rm01,rm02',
  // the guard-shaped subclass, with 0.2.x absent, first and last
  'core,guard',
  'rm02,core,guard',
  'core,guard,rm02',
  // an older copy of core (0.8.1's partial global) loaded first: what the emulation does to it
  'legacy081,core,early,rm02',
  'legacy081,core,early,rm01,rm02',
] as const;

const SCENARIO_TIMEOUT_MS = 120_000;
const runs = new Map<string, ScenarioRun>();

/** The observations of one scenario; every scenario was started, concurrently, in `beforeAll`. */
function scenario(steps: (typeof SCENARIOS)[number]): Record<string, unknown> {
  const run = runs.get(steps)!;

  return { exitCode: run.exitCode, ...run.result };
}

const NINE_FUNCTIONS = [
  'metadata',
  'defineMetadata',
  'hasMetadata',
  'hasOwnMetadata',
  'getMetadata',
  'getOwnMetadata',
  'getMetadataKeys',
  'getOwnMetadataKeys',
  'deleteMetadata',
];

/** What a healthy early/late scenario observes, whatever the import order. */
const HEALTHY = {
  exitCode: 0,
  api: NINE_FUNCTIONS,
  roundTrip: ['greeting'],
  early: ['EarlyDep'],
  late: ['EarlyDep'],
  parent: ['EarlyDep'],
  child: null,
  earlyProps: ['String', 'Number'],
  lateProps: ['String', 'Number'],
  injected: { early: true, late: true },
  http: 200,
  body: { success: true, result: { resolved: true } },
};

beforeAll(async () => {
  const results = await Promise.all(SCENARIOS.map(async (steps) => [steps, await runScenario(steps)] as const));
  for (const [steps, run] of results) {
    runs.set(steps, run);
  }
}, SCENARIO_TIMEOUT_MS);

describe('reflect-metadata loaded after @onebun/core', () => {
  it('0.2.x: classes decorated before and after it keep their paramtypes, and both resolve', () => {
    // The reporter's order. 0.8.1: TypeError "getOwnMetadataKeys is not a function" on the first
    // lookup, every later decorator throwing, and the early class's paramtypes gone.
    expect(scenario('core,early,token,rm02')).toMatchObject({ ...HEALTHY, registry: true, token: ['greeting'] });
  });

  it('0.2.x: a second physical copy joins the same registry and changes nothing', () => {
    expect(scenario('core,early,rm02,rm02')).toMatchObject({ ...HEALTHY, registry: true });
  });

  it('0.2.1: property metadata of targets decorated before it survives', () => {
    // 0.2.1's fallback provider loses every property key of a target but the first it sees. It is
    // only built when there is no registry; core publishes one, so 0.2.1 never builds it.
    expect(scenario('core,early,rm021')).toMatchObject({ ...HEALTHY, earlyProps: ['String', 'Number'] });
  });

  it('0.1.x: a getOwnMetadata/defineMetadata round-trip reads back, and property types stay apart', () => {
    // 0.8.1: 0.1.x added its own getOwnMetadata beside core's defineMetadata — two stores for one
    // target — and the tsyringe `@inject` round-trip read back nothing.
    expect(scenario('core,early,token,rm01')).toMatchObject({ ...HEALTHY, registry: true, token: ['greeting'] });
  });

  it('0.1.x then 0.2.x after decoration: earlier paramtypes survive and the route answers 200', () => {
    // 0.8.1 failed this one silently: undefined paramtypes and a 500, no crash (see the legacy
    // scenario below, which reproduces it).
    expect(scenario('core,early,token,rm01,rm02')).toMatchObject({ ...HEALTHY, token: ['greeting'] });
  });
});

describe('reflect-metadata loaded before @onebun/core', () => {
  it('0.2.x: core keeps it and resolves through it', () => {
    expect(scenario('rm02,core,early')).toMatchObject({ ...HEALTHY, registry: true });
  });

  it('0.1.x: core keeps it and resolves through it', () => {
    // No registry: 0.1.x has none and core adds nothing next to a complete implementation.
    expect(scenario('rm01,core,early')).toMatchObject({ ...HEALTHY, registry: false });
  });
});

describe('constructor types are read OWN, in every order', () => {
  it('a decorated subclass without a constructor gets the same answer with 0.2.x before and after core', () => {
    const before = scenario('rm02,core,early');
    const after = scenario('core,early,token,rm02');

    // A walk would hand Child its parent's [EarlyDep] when reflect-metadata came first and
    // nothing when core did; own-only answers "none" both ways. Inheriting constructor
    // dependencies is a separate change (WI-407).
    expect(before.child).toBeNull();
    expect(after.child).toBeNull();
    expect(before.parent).toEqual(['EarlyDep']);
    expect(after.parent).toEqual(['EarlyDep']);
  });

  it.each(['core,guard', 'rm02,core,guard', 'core,guard,rm02'] as const)(
    'an undecorated guard with its own constructor gets no parent paramtypes, and startup says so (%s)',
    (steps) => {
      // Mirrors onebun-FB-33's review fixture: under a prototype walk the guard's `audit`
      // parameter received the base's TokenStore and the route still answered 200. With
      // reflect-metadata first, 0.8.1 did that walk, so a guard whose parameters MATCH its base's
      // worked there and gets nothing now; the warning is what names it, in every order.
      expect(scenario(steps)).toMatchObject({
        exitCode: 0,
        guardHttp: 200,
        guardReceived: ['undefined'],
        guardParamTypes: null,
        baseGuardParamTypes: ['TokenStore', 'AuditLog'],
        guardWarnings: [expect.stringContaining('Add @Service() to AuditingGuard')],
      });
    },
  );
});

describe('the emulation reproduces what 0.8.1 did (an older copy of core loaded first)', () => {
  // `legacy081` installs 0.8.1's three partial functions before core, so core — seeing an
  // implementation already there — keeps it: the status quo for two copies (WI-274). These pin that
  // the emulation is not vacuous: against the old shape it fails exactly as the report says.
  it('0.2.x after it: the reported crash', () => {
    expect(scenario('legacy081,core,early,rm02')).toMatchObject({
      exitCode: 1,
      error: expect.stringContaining('getOwnMetadataKeys is not a function'),
    });
  });

  it('0.1.x then 0.2.x after it: earlier paramtypes silently lost, and a 500', () => {
    expect(scenario('legacy081,core,early,rm01,rm02')).toMatchObject({
      exitCode: 0,
      early: null,
      earlyProps: [null, null],
      injected: { early: false, late: true },
      http: 500,
    });
  });
});

/** A no-op property/method decorator: it only makes Bun emit `design:*` metadata for the member. */
const tag = (_target: object, _propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => undefined;

type AnyReflectFunction = (...args: unknown[]) => unknown;
const globalReflect = globalThis.Reflect as unknown as Record<string, AnyReflectFunction>;

describe('the global Reflect Metadata API core installs', () => {
  it('has all nine functions', () => {
    expect(NINE_FUNCTIONS.filter((name) => typeof globalReflect[name] === 'function')).toEqual(NINE_FUNCTIONS);
  });

  it('keeps per-property design:type apart on one target', () => {
    class Props {
      @tag first!: string;
      @tag second!: number;
      @tag
      method(_flag: boolean): void {}
    }

    expect(globalReflect.getMetadata('design:type', Props.prototype, 'first')).toBe(String);
    expect(globalReflect.getMetadata('design:type', Props.prototype, 'second')).toBe(Number);
    expect(globalReflect.getMetadata('design:paramtypes', Props.prototype, 'method')).toEqual([Boolean]);
    expect(globalReflect.getMetadata('design:type', Props.prototype)).toBeUndefined();
  });

  it('walks the prototype chain for getMetadata/hasMetadata/getMetadataKeys, not for the Own variants', () => {
    class Base {}
    class Derived extends Base {}
    globalReflect.defineMetadata('shared', 'base', Base);
    globalReflect.defineMetadata('mine', 'derived', Derived);

    expect(globalReflect.getMetadata('shared', Derived)).toBe('base');
    expect(globalReflect.hasMetadata('shared', Derived)).toBe(true);
    expect(globalReflect.getOwnMetadata('shared', Derived)).toBeUndefined();
    expect(globalReflect.hasOwnMetadata('shared', Derived)).toBe(false);
    expect(globalReflect.getMetadataKeys(Derived)).toEqual(['mine', 'shared']);
    expect(globalReflect.getOwnMetadataKeys(Derived)).toEqual(['mine']);
  });

  it('shadows an ancestor value with the nearest own one, and lists a shared key once', () => {
    class Base {}
    class Derived extends Base {}
    globalReflect.defineMetadata('role', 'base', Base);
    globalReflect.defineMetadata('role', 'derived', Derived);

    expect(globalReflect.getMetadata('role', Derived)).toBe('derived');
    expect(globalReflect.getMetadataKeys(Derived)).toEqual(['role']);
  });

  it('deletes own metadata only, and reports whether anything was deleted', () => {
    class Base {}
    class Derived extends Base {}
    globalReflect.defineMetadata('key', 'base', Base);
    globalReflect.defineMetadata('key', 'derived', Derived);

    expect(globalReflect.deleteMetadata('key', Derived)).toBe(true);
    expect(globalReflect.deleteMetadata('key', Derived)).toBe(false);
    expect(globalReflect.getMetadata('key', Derived)).toBe('base');
    expect(globalReflect.getOwnMetadataKeys(Derived)).toEqual([]);
  });

  it('normalises property keys the way property access does, and keeps symbols', () => {
    const target = {};
    const symbolKey = Symbol('member');
    globalReflect.defineMetadata('key', 'by-number', target, 1);
    globalReflect.defineMetadata('key', 'by-symbol', target, symbolKey);

    expect(globalReflect.getOwnMetadata('key', target, '1')).toBe('by-number');
    expect(globalReflect.getOwnMetadata('key', target, symbolKey)).toBe('by-symbol');
    expect(globalReflect.getOwnMetadata('key', target)).toBeUndefined();
  });

  it('accepts any metadata key, compared by identity', () => {
    const target = {};
    const objectKey = {};
    globalReflect.defineMetadata(objectKey, 'object', target);

    expect(globalReflect.getOwnMetadata(objectKey, target)).toBe('object');
    expect(globalReflect.getOwnMetadata({}, target)).toBeUndefined();
  });

  it('works when called detached from Reflect, as reflect-metadata calls an adopted implementation', () => {
    const { defineMetadata, getOwnMetadataKeys } = globalReflect;
    const target = {};
    defineMetadata('key', 'value', target);

    expect(getOwnMetadataKeys(target)).toEqual(['key']);
  });

  it('rejects a target that is not an object, and a decorator property key that is not a string or symbol', () => {
    expect(() => globalReflect.defineMetadata('key', 'value', 'not-an-object')).toThrow(TypeError);
    expect(() => globalReflect.getMetadata('key', undefined)).toThrow(TypeError);
    const decorator = globalReflect.metadata('key', 'value') as AnyReflectFunction;
    expect(() => decorator({}, 1)).toThrow(TypeError);
  });

  it('publishes reflect-metadata\'s provider registry', () => {
    const registry = (globalThis.Reflect as unknown as Record<symbol, Record<string, unknown>>)[
      Symbol.for('@reflect-metadata:registry')
    ];

    expect(typeof registry.registerProvider).toBe('function');
    expect(typeof registry.getProvider).toBe('function');
    expect(typeof registry.setProvider).toBe('function');
  });

  it('leaves DI reading own paramtypes: a decorated subclass without a constructor gets none', () => {
    @Service()
    class Dependency {}

    @Service()
    class ParentService {
      constructor(readonly dependency: Dependency) {}
    }

    @Service()
    class ChildService extends ParentService {}

    expect(getConstructorParamTypes(ParentService)).toEqual([Dependency]);
    expect(globalReflect.getMetadata('design:paramtypes', ChildService)).toEqual([Dependency]);
    expect(getConstructorParamTypes(ChildService)).toBeUndefined();
  });
});

describe('reflect-metadata stays out of the repository', () => {
  const repositoryRoot = resolve(import.meta.dir, '../../../..');
  const forbidden = 'reflect' + '-metadata';

  it('no workspace package lists it in any dependency field', async () => {
    const offenders: string[] = [];
    for await (const path of new Bun.Glob('packages/*/package.json').scan({ cwd: repositoryRoot })) {
      const manifest = JSON.parse(await readFile(resolve(repositoryRoot, path), 'utf8')) as Record<string, unknown>;
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
        if (forbidden in ((manifest[field] ?? {}) as Record<string, string>)) {
          offenders.push(`${path} ${field}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no source or test file under packages/ imports it', async () => {
    const importOf = new RegExp(`(from\\s+|require\\(\\s*|import\\(\\s*)['"]${forbidden}(/[^'"]*)?['"]`);
    const offenders: string[] = [];
    for await (const path of new Bun.Glob('packages/**/*.ts').scan({ cwd: repositoryRoot })) {
      if (!path.includes('node_modules') && importOf.test(await readFile(resolve(repositoryRoot, path), 'utf8'))) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});
