/**
 * One import-order scenario, in a fresh process: `bun <this file> <step>,<step>,...`.
 *
 * Run it with cwd = the repository root — that is where Bun reads the tsconfig that turns on
 * `experimentalDecorators` / `emitDecoratorMetadata`. It prints one line, `RESULT_MARKER` followed
 * by JSON, and exits 0; an error is reported in the JSON (`error`) with exit code 1.
 *
 * Nothing is imported statically except the emulation, which has no side effects: the whole point
 * is WHEN @onebun/core, the metadata implementations and the decorated classes are evaluated.
 *
 * Steps, run in order:
 * - `core` — import @onebun/core;
 * - `rm02` / `rm021` — load one more copy of the reflect-metadata 0.2.2 / 0.2.1 emulation;
 * - `rm01` — load one copy of the reflect-metadata 0.1.x emulation;
 * - `legacy081` — install what @onebun/core 0.8.1 put on the global (three partial functions),
 *   i.e. an older copy of core loaded first;
 * - `snapshot` — remember the global's nine functions, to check later that nobody replaced them;
 * - `marker` — put an unrelated member on the global `Reflect`, to check it survives;
 * - `early` — decorate the early classes; `token` — write a tsyringe-style token on a class;
 * - `guard` — decorate the guard classes.
 *
 * After the steps the late classes are decorated and every probe that applies is taken.
 */
import { loadReflectMetadata01, loadReflectMetadata02 } from './reflect-metadata-emulation';
import { RESULT_MARKER } from './scenario-protocol';

const API = [
  'metadata',
  'defineMetadata',
  'hasMetadata',
  'hasOwnMetadata',
  'getMetadata',
  'getOwnMetadata',
  'getMetadataKeys',
  'getOwnMetadataKeys',
  'deleteMetadata',
] as const;

type MetadataFunction = (...args: unknown[]) => unknown;
type GlobalReflect = Record<PropertyKey, unknown>;

const reflect = (): GlobalReflect => globalThis.Reflect as unknown as GlobalReflect;
const call = (name: string, ...args: unknown[]): unknown => (reflect()[name] as MetadataFunction)(...args);
const names = (types: (Function | undefined)[] | undefined): string[] | null =>
  types?.map((type) => type?.name ?? 'undefined') ?? null;

/** The three functions @onebun/core 0.8.1 installed: no property key, no prototype walk. */
function installLegacy081(): void {
  const store = new WeakMap<object, Map<unknown, unknown>>();
  const define = (key: unknown, value: unknown, target: object): void => {
    const byKey = store.get(target) ?? new Map<unknown, unknown>();
    store.set(target, byKey);
    byKey.set(key, value);
  };
  Object.assign(reflect(), {
    metadata: (key: unknown, value: unknown) => (target: object) => define(key, value, target),
    getMetadata: (key: unknown, target: object) => store.get(target)?.get(key),
    defineMetadata: define,
  });
}

/** A token holder decorated nowhere; stands in for a tsyringe `@inject` target. */
class TokenHolder {}

async function run(steps: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { steps: steps.join('>') };
  let snapshot: unknown[] | undefined;

  for (const step of steps) {
    switch (step) {
      case 'core': await import('@onebun/core'); break;
      case 'rm02': loadReflectMetadata02(); break;
      case 'rm021': loadReflectMetadata02({ fallbackQuirk021: true }); break;
      case 'rm01': loadReflectMetadata01(); break;
      case 'legacy081': installLegacy081(); break;
      case 'snapshot': snapshot = API.map((name) => reflect()[name]); break;
      case 'marker': reflect().onebunFixtureMarker = () => 'kept'; break;
      case 'early': await import('./early-classes'); break;
      case 'token': call('defineMetadata', 'tok', ['greeting'], TokenHolder); break;
      case 'guard': await import('./guard-classes'); break;
      default: throw new Error(`unknown step ${step}`);
    }
  }

  const core = await import('@onebun/core');
  const early = steps.includes('early') ? await import('./early-classes') : undefined;
  const late = early ? await import('./late-classes') : undefined;

  out.api = API.filter((name) => typeof reflect()[name] === 'function');
  out.registry = Symbol.for('@reflect-metadata:registry') in reflect();
  if (snapshot) {
    out.unchangedSinceSnapshot = API.every((name, index) => reflect()[name] === snapshot[index]);
  }
  if (steps.includes('marker')) {
    out.marker = (reflect().onebunFixtureMarker as () => string)();
  }
  if (steps.includes('token')) {
    out.token = call('getOwnMetadata', 'tok', TokenHolder) ?? null;
  }

  // The tsyringe `@inject` write: read own, merge, write back, read own again.
  class RoundTrip {}
  const own = (call('getOwnMetadata', 'tok', RoundTrip) ?? []) as string[];
  own[0] = 'greeting';
  call('defineMetadata', 'tok', own, RoundTrip);
  out.roundTrip = call('getOwnMetadata', 'tok', RoundTrip) ?? null;

  if (early && late) {
    out.early = names(core.getConstructorParamTypes(early.EarlyConsumer));
    out.late = names(core.getConstructorParamTypes(late.LateConsumer));
    out.parent = names(core.getConstructorParamTypes(early.Parent));
    out.child = names(core.getConstructorParamTypes(early.Child));
    const typeName = (target: object, member: string): string | null =>
      (call('getMetadata', 'design:type', target, member) as Function | undefined)?.name ?? null;
    out.earlyProps = [typeName(early.EarlyProps.prototype, 'first'), typeName(early.EarlyProps.prototype, 'second')];
    out.lateProps = [typeName(late.LateProps.prototype, 'first'), typeName(late.LateProps.prototype, 'second')];

    const testing = await import('../../testing');
    const compiled = await testing.TestingModule.create({
      controllers: [early.EarlyController],
      providers: [early.EarlyDep, early.EarlyConsumer, late.LateConsumer],
    }).compile();
    try {
      out.injected = {
        early: compiled.get(early.EarlyConsumer).dep instanceof early.EarlyDep,
        late: compiled.get(late.LateConsumer).dep instanceof early.EarlyDep,
      };
      const response = await compiled.inject('GET', '/early');
      out.http = response.status;
      out.body = await response.json();
    } finally {
      await compiled.close();
    }
  }

  if (steps.includes('guard')) {
    const guard = await import('./guard-classes');
    const testing = await import('../../testing');
    const compiled = await testing.TestingModule.create({
      controllers: [guard.GuardedController],
      providers: [guard.TokenStore, guard.AuditLog],
    }).captureLogs().compile();
    try {
      out.guardHttp = (await compiled.inject('GET', '/guarded')).status;
      out.guardReceived = guard.AuditingGuard.received;
      out.guardWarnings = compiled.logs
        .filter((record) => record.level === 'warn' && record.message.startsWith('AuditingGuard'))
        .map((record) => record.message);
      out.baseGuardParamTypes = names(core.getConstructorParamTypes(guard.BaseAuthGuard));
      out.guardParamTypes = names(core.getConstructorParamTypes(guard.AuditingGuard));
    } finally {
      await compiled.close();
    }
  }

  return out;
}

const steps = (process.argv[2] ?? '').split(',').filter((step) => step !== '');
let exitCode = 0;
let result: Record<string, unknown>;
try {
  result = await run(steps);
} catch (error) {
  exitCode = 1;
  result = { steps: steps.join('>'), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
}
process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify(result)}\n`);
process.exit(exitCode);
