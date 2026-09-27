import {
  afterEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import * as testcontainers from 'testcontainers';
import { getContainerRuntimeClient } from 'testcontainers';

import type { StartedTestContainer } from 'testcontainers';

import {
  type OwnedContainerRuntime,
  runtimeClientResolver,
  startOwned,
} from './container-ownership';

/**
 * Unit tests of the helpers' start ownership against module shapes injected through
 * `startOwned(builder, labels, namespace)` — the testcontainers namespace is a parameter, so a
 * release without `getContainerRuntimeClient` (10.0–10.2) is an object without that key. Nothing
 * here touches Docker; `containers.test.ts` covers the same paths against a real runtime.
 */

/** Spelled out rather than imported: it is the documented contract a harness filters on. */
const OWNER_LABEL = 'dev.onebun.testing.owner';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/* eslint-disable @typescript-eslint/naming-convention -- label keys are reverse-DNS by convention */
const CALLER_LABELS = { 'dev.onebun.fb26.harness': 'container-ownership-test' };
/* eslint-enable @typescript-eslint/naming-convention */

/** testcontainers 10.0–10.2 as far as `startOwned` can tell: no `getContainerRuntimeClient`. */
const PRE_10_3_SHAPES: Array<[string, object]> = [
  // eslint-disable-next-line @typescript-eslint/naming-convention -- testcontainers' own export names
  ['no such export', { GenericContainer: class {}, Wait: {} }],
  ['an export that is undefined', { getContainerRuntimeClient: undefined }],
  ['an export that is not a function', { getContainerRuntimeClient: 'not a function' }],
];

/** Records what `startOwned()` does to a builder, and in which order. */
class FakeBuilder {
  readonly calls: string[] = [];
  labels: Record<string, string> = {};

  constructor(private readonly outcome: () => Promise<StartedTestContainer>) {}

  withLabels(labels: Record<string, string>): this {
    this.calls.push('withLabels');
    this.labels = { ...this.labels, ...labels };

    return this;
  }

  async start(): Promise<StartedTestContainer> {
    this.calls.push('start');

    return await this.outcome();
  }
}

function failingBuilder(error: unknown): FakeBuilder {
  return new FakeBuilder(async () => {
    throw error;
  });
}

/** A runtime client whose dockerode records every call, listing `owned` for any owner filter. */
function fakeRuntime(owned: string[], remove: (id: string) => Promise<unknown> = async () => undefined): {
  runtime: OwnedContainerRuntime;
  listed: unknown[];
  removed: Array<{ id: string; options: unknown }>;
} {
  const listed: unknown[] = [];
  const removed: Array<{ id: string; options: unknown }> = [];
  const runtime: OwnedContainerRuntime = {
    container: {
      dockerode: {
        async listContainers(options) {
          listed.push(options);

          // eslint-disable-next-line @typescript-eslint/naming-convention -- Docker's own field name
          return owned.map((id) => ({ Id: id }));
        },
        getContainer(id) {
          return {
            async remove(options) {
              removed.push({ id, options });

              return await remove(id);
            },
          };
        },
      },
    },
  };

  return { runtime, listed, removed };
}

async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  return await call.then(() => 'resolved', (error: unknown) => error);
}

describe('runtimeClientResolver', () => {
  for (const [shape, namespace] of PRE_10_3_SHAPES) {
    test(`a namespace with ${shape} has no runtime client`, () => {
      expect(runtimeClientResolver(namespace)).toBeUndefined();
    });
  }

  test('a namespace with the function hands back that very function', () => {
    const resolve = async (): Promise<OwnedContainerRuntime> => fakeRuntime([]).runtime;

    expect(runtimeClientResolver({ getContainerRuntimeClient: resolve })).toBe(resolve);
  });

  test('the installed testcontainers namespace resolves to its getContainerRuntimeClient', () => {
    const installed: unknown = getContainerRuntimeClient;

    expect(runtimeClientResolver(testcontainers)).toBe(installed as () => Promise<OwnedContainerRuntime>);
  });
});

describe('startOwned without getContainerRuntimeClient (testcontainers 10.0–10.2)', () => {
  // Below 10.3.0 there is no runtime client to remove a half-started container with. A failed
  // start must then be exactly what it was on 0.8.1: the start error, untouched, and nothing else —
  // no cleanup, no report on the error, no warning. Only the labels are new, and they still go on.
  const spies: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  for (const [shape, namespace] of PRE_10_3_SHAPES) {
    test(`${shape}: a failed start rethrows the start error unchanged, labels applied before start`, async () => {
      const warn = spyOn(console, 'warn');
      const error = spyOn(console, 'error');
      spies.push(warn, error);

      const injected = new Error('injected');
      const ownKeysBefore = Reflect.ownKeys(injected);
      const builder = failingBuilder(injected);

      const thrown = await rejectionOf(startOwned(builder, CALLER_LABELS, namespace));

      expect(thrown).toBe(injected);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe('injected');
      expect(Reflect.ownKeys(injected)).toEqual(ownKeysBefore);
      expect('containerCleanupFailure' in injected).toBe(false);

      expect(builder.calls).toEqual(['withLabels', 'start']);
      expect(builder.labels).toMatchObject(CALLER_LABELS);
      expect(builder.labels[OWNER_LABEL]).toMatch(UUID);

      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  }

  test('a thrown non-Error value comes through as it is', async () => {
    const thrown = await rejectionOf(startOwned(failingBuilder('a string'), undefined, {}));

    expect(thrown).toBe('a string');
  });

  test('a successful start returns the started container, with the caller and owner labels applied', async () => {
    const started = { getHost: () => 'stub-host' } as unknown as StartedTestContainer;
    const builder = new FakeBuilder(async () => started);

    expect(await startOwned(builder, { ...CALLER_LABELS, [OWNER_LABEL]: 'caller-tries-to-own-it' }, {})).toBe(started);
    expect(builder.labels).toMatchObject(CALLER_LABELS);
    expect(builder.labels[OWNER_LABEL]).toMatch(UUID);
  });
});

describe('startOwned with getContainerRuntimeClient (testcontainers 10.3.0 and later)', () => {
  test('a failed start removes exactly the containers carrying its owner label and rethrows the start error', async () => {
    const { runtime, listed, removed } = fakeRuntime(['left-behind']);
    const injected = new Error('injected');
    const builder = failingBuilder(injected);

    const thrown = await rejectionOf(startOwned(builder, CALLER_LABELS, { getContainerRuntimeClient: async () => runtime }));

    expect(thrown).toBe(injected);
    expect('containerCleanupFailure' in injected).toBe(false);
    const owner = builder.labels[OWNER_LABEL];
    expect(owner).toMatch(UUID);
    expect(listed).toEqual([{ all: true, filters: { label: [`${OWNER_LABEL}=${owner}`] } }]);
    expect(removed).toEqual([{ id: 'left-behind', options: { force: true, v: true } }]);
  });

  test('a container that is already gone (404) is not a cleanup failure', async () => {
    const { runtime } = fakeRuntime(['gone'], async () => {
      throw Object.assign(new Error('no such container'), { statusCode: 404 });
    });
    const injected = new Error('injected');

    expect(await rejectionOf(startOwned(failingBuilder(injected), undefined, { getContainerRuntimeClient: async () => runtime })))
      .toBe(injected);
    expect('containerCleanupFailure' in injected).toBe(false);
  });

  test('a cleanup that fails is reported on the start error, never in its place', async () => {
    const removeFailure = new Error('injected remove failure');
    const { runtime } = fakeRuntime(['stuck'], async () => {
      throw removeFailure;
    });
    const injected = new Error('injected');
    const builder = failingBuilder(injected);

    const thrown = await rejectionOf(startOwned(builder, undefined, { getContainerRuntimeClient: async () => runtime }));

    expect(thrown).toBe(injected);
    expect((thrown as Error).message).toBe('injected');
    expect((thrown as { containerCleanupFailure?: unknown }).containerCleanupFailure).toEqual({
      ownerLabel: `${OWNER_LABEL}=${builder.labels[OWNER_LABEL]}`,
      error: removeFailure,
    });
  });

  test('a runtime client that cannot be resolved is the error, and nothing is labelled or started', async () => {
    const noRuntime = new Error('Could not find a working container runtime strategy');
    const builder = failingBuilder(new Error('never reached'));

    const thrown = await rejectionOf(startOwned(builder, CALLER_LABELS, {
      async getContainerRuntimeClient() {
        throw noRuntime;
      },
    }));

    expect(thrown).toBe(noRuntime);
    expect(builder.calls).toEqual([]);
  });
});
