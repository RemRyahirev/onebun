import { SQL } from 'bun';
import {
  describe,
  expect,
  test,
} from 'bun:test';
import { getContainerRuntimeClient } from 'testcontainers';

import type { ContainerRuntimeClient } from 'testcontainers';

import {
  createNatsContainer,
  createPostgresContainer,
  createRedisContainer,
  type ContainerCleanupFailure,
  type TestContainer,
} from './containers';
import { MISSING_DOCKER_HOST, runWithoutRuntime } from './containers-fixtures/no-runtime-protocol';
import { CALLER_LABELS as PRE_10_3_CALLER_LABELS, runAgainstPre103Testcontainers } from './containers-fixtures/pre-10-3-protocol';

describe('createRedisContainer', () => {
  test('starts redis and returns connection details', async () => {
    const redis = await createRedisContainer();
    try {
      expect(redis.url).toMatch(/^redis:\/\/.+:\d+$/);
      expect(redis.host).toBeDefined();
      expect(redis.port).toBeGreaterThan(0);
      expect(redis.container).toBeDefined();
    } finally {
      await redis.stop();
    }
  }, 60000);
});

describe('createNatsContainer', () => {
  test('starts nats and returns connection details', async () => {
    const nats = await createNatsContainer();
    try {
      expect(nats.url).toMatch(/^nats:\/\/.+:\d+$/);
      expect(nats.host).toBeDefined();
      expect(nats.port).toBeGreaterThan(0);
      expect(nats.container).toBeDefined();
    } finally {
      await nats.stop();
    }
  }, 60000);
});

describe('createPostgresContainer', () => {
  test('starts postgres and returns connection details', async () => {
    const postgres = await createPostgresContainer();
    try {
      expect(postgres.url).toMatch(/^postgresql:\/\/.+:\d+\/.+$/);
      expect(postgres.host).toBeDefined();
      expect(postgres.port).toBeGreaterThan(0);
      expect(postgres.container).toBeDefined();
    } finally {
      await postgres.stop();
    }
  }, 60000);

  test('hands back a server that is actually accepting connections', async () => {
    // The reason the wait strategy counts TWO "ready to accept connections" lines: the image
    // starts a temporary server for its init scripts, logs the line for that one, stops it, and
    // only then starts the real server. Waiting for the first line returns a URL that is about
    // to stop working, and the failure lands in whichever test connects first.
    const postgres = await createPostgresContainer();
    try {
      const sql = new SQL(postgres.url);
      try {
        const rows = await sql`SELECT 1 AS ok` as Array<{ ok: number }>;

        expect(rows).toEqual([{ ok: 1 }]);
      } finally {
        await sql.close();
      }
    } finally {
      await postgres.stop();
    }
  }, 60000);
});

// ============================================================================
// A start that fails after `create` (FB-26)
// ============================================================================

/**
 * The label key the helpers stamp. Spelled out rather than imported: it is the documented contract
 * a harness filters on, so a rename must fail here.
 */
const OWNER_LABEL = 'dev.onebun.testing.owner';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTAINER_TEST_TIMEOUT_MS = 120_000;
/* eslint-disable @typescript-eslint/naming-convention -- label keys are reverse-DNS by convention */
const CALLER_LABELS = {
  'dev.onebun.fb26.harness': 'containers-test',
  'dev.onebun.fb26.run': crypto.randomUUID(),
};
/* eslint-enable @typescript-eslint/naming-convention */

type RuntimeContainerClient = ContainerRuntimeClient['container'];
type Dockerode = RuntimeContainerClient['dockerode'];
type CreateOptions = Parameters<RuntimeContainerClient['create']>[0];
type RuntimeContainer = Parameters<RuntimeContainerClient['start']>[0];
type ContainerSummary = Awaited<ReturnType<RuntimeContainerClient['list']>>[number];
type ListOptions = { all?: boolean; filters?: string | Record<string, string[]> };

type Helper = (options?: { labels?: Record<string, string> }) => Promise<TestContainer>;

const HELPERS: Array<[string, Helper]> = [
  ['createRedisContainer', createRedisContainer],
  ['createNatsContainer', createNatsContainer],
  ['createPostgresContainer', createPostgresContainer],
];

/** Swap one member on an instance, and hand back what puts the original back. */
function replace<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): () => void {
  const own = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value: replacement, configurable: true, writable: true });

  return () => {
    if (own === undefined) {
      Reflect.deleteProperty(target, key);
    } else {
      Object.defineProperty(target, key, own);
    }
  };
}

function isOwnedByAHelper(options: CreateOptions): boolean {
  return options.Labels?.[OWNER_LABEL] !== undefined;
}

function filtersOnOwner(options: ListOptions | undefined): boolean {
  const filters = options?.filters;

  return typeof filters === 'object'
    && (filters.label ?? []).some((label) => label.startsWith(`${OWNER_LABEL}=`));
}

/**
 * Records every container a helper creates and can make one step of its start fail. Every change is
 * made on the process's runtime client INSTANCE and undone by `restoreAndSweep()`, and every injected
 * failure applies only to containers a helper created (they carry the owner label) — never to Ryuk
 * or to anything else the process runs.
 */
class StartProbe {
  readonly created: Array<{ id: string; options: CreateOptions }> = [];
  private readonly restorers: Array<() => void> = [];

  private constructor(readonly client: ContainerRuntimeClient) {
    const containers = client.container;
    const realCreate = containers.create.bind(containers);

    this.restorers.push(replace(containers, 'create', async (options: CreateOptions) => {
      const container = await realCreate(options);
      if (isOwnedByAHelper(options)) {
        this.created.push({ id: container.id, options });
      }

      return container;
    }));
  }

  static async install(): Promise<StartProbe> {
    return new StartProbe(await getContainerRuntimeClient());
  }

  get dockerode(): Dockerode {
    return this.client.container.dockerode;
  }

  owners(): string[] {
    return this.created.map(({ options }) => String(options.Labels?.[OWNER_LABEL]));
  }

  private isOwned(container: RuntimeContainer): boolean {
    return this.created.some(({ id }) => id === container.id);
  }

  /** `container.start` throws `error` before the runtime starts anything: the container stays `created`. */
  failStart(error: Error): void {
    const containers = this.client.container;
    const realStart = containers.start.bind(containers);

    this.restorers.push(replace(containers, 'start', async (container: RuntimeContainer) => {
      if (this.isOwned(container)) {
        throw error;
      }
      await realStart(container);
    }));
  }

  /**
   * `container.inspect` throws `error` for an owned container — after the real start, so the
   * container is `running` when the helper sees the failure. `statesSeen` records that.
   */
  failInspect(error: Error, statesSeen: string[]): void {
    const containers = this.client.container;
    const realInspect = containers.inspect.bind(containers);

    this.restorers.push(replace(containers, 'inspect', async (container: RuntimeContainer) => {
      if (this.isOwned(container)) {
        statesSeen.push((await realInspect(container)).State.Status);
        throw error;
      }

      return await realInspect(container);
    }));
  }

  /** `dockerode.listContainers` rejects with `error` whenever it is asked for an owner label. */
  failOwnerListing(error: Error): void {
    const { dockerode } = this;
    const realList = dockerode.listContainers.bind(dockerode) as (options?: ListOptions) => Promise<ContainerSummary[]>;
    const list = async (options?: ListOptions): Promise<ContainerSummary[]> => {
      if (filtersOnOwner(options)) {
        throw error;
      }

      return await realList(options);
    };

    this.restorers.push(replace(dockerode, 'listContainers', list as unknown as Dockerode['listContainers']));
  }

  /** Removing an owned container through `dockerode.getContainer(id).remove()` rejects with `error`. */
  failOwnedRemoval(error: Error): void {
    const { dockerode } = this;
    const realGetContainer = dockerode.getContainer.bind(dockerode);

    this.restorers.push(replace(dockerode, 'getContainer', (id: string) => {
      const container = realGetContainer(id);
      if (this.created.some((created) => created.id === id)) {
        replace(container, 'remove', (async () => {
          throw error;
        }) as unknown as typeof container.remove);
      }

      return container;
    }));
  }

  /** Put every original back, then remove whatever still carries an owner label this probe saw. */
  async restoreAndSweep(): Promise<void> {
    for (const restore of this.restorers.splice(0).reverse()) {
      restore();
    }
    for (const owner of this.owners()) {
      for (const info of await listByOwner(this.dockerode, owner)) {
        await this.dockerode.getContainer(info.Id).remove({ force: true, v: true });
      }
    }
  }
}

async function listByOwner(dockerode: Dockerode, owner: string): Promise<ContainerSummary[]> {
  return await dockerode.listContainers({ all: true, filters: { label: [`${OWNER_LABEL}=${owner}`] } });
}

async function stateOf(dockerode: Dockerode, id: string): Promise<string> {
  try {
    return (await dockerode.getContainer(id).inspect()).State.Status;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return 'gone';
    }
    throw error;
  }
}

/** Settle a helper call. A helper that unexpectedly starts is stopped, so a failing test leaks nothing. */
async function rejectionOf(call: Promise<TestContainer>): Promise<unknown> {
  return await call.then(
    async (started) => {
      await started.stop();

      return 'resolved';
    },
    (error: unknown) => error,
  );
}

function cleanupFailureOf(error: unknown): ContainerCleanupFailure | undefined {
  return (error as { containerCleanupFailure?: ContainerCleanupFailure }).containerCleanupFailure;
}

describe('container helpers — a start that fails after create removes that container (FB-26)', () => {
  // Before this, only a wait-strategy failure was cleaned up (by testcontainers itself). A failure
  // in `container.start` or in the port inspection after it left the container behind — `created`,
  // or `running` — with no handle to stop it and, without Ryuk, nothing that ever would.
  for (const [name, helper] of HELPERS) {
    test(`${name}: start fails after create -> rejects with that very error, the container is gone`, async () => {
      const probe = await StartProbe.install();
      const injected = new Error('injected');
      probe.failStart(injected);

      try {
        const error = await rejectionOf(helper({ labels: CALLER_LABELS }));

        expect(error).toBe(injected);
        expect((error as Error).message).toBe('injected');
        expect(cleanupFailureOf(error)).toBeUndefined();

        expect(probe.created).toHaveLength(1);
        const [owner] = probe.owners();
        expect(owner).toMatch(UUID);
        // The caller's labels were on the container from `create` on, beside the owner label.
        expect(probe.created[0].options.Labels).toMatchObject(CALLER_LABELS);

        expect(await listByOwner(probe.dockerode, owner)).toEqual([]);
        // Not vacuous: the container did exist — create returned its id — and does not any more.
        expect(await stateOf(probe.dockerode, probe.created[0].id)).toBe('gone');
      } finally {
        await probe.restoreAndSweep();
      }
    }, CONTAINER_TEST_TIMEOUT_MS);

    test(`${name}: inspect fails after a real start -> rejects with that error, the running container is gone`, async () => {
      const probe = await StartProbe.install();
      const injected = new Error('injected inspect failure');
      const statesSeen: string[] = [];
      probe.failInspect(injected, statesSeen);

      try {
        const error = await rejectionOf(helper());

        expect(error).toBe(injected);
        expect(statesSeen).toEqual(['running']);
        expect(probe.created).toHaveLength(1);
        expect(await listByOwner(probe.dockerode, probe.owners()[0])).toEqual([]);
        expect(await stateOf(probe.dockerode, probe.created[0].id)).toBe('gone');
      } finally {
        await probe.restoreAndSweep();
      }
    }, CONTAINER_TEST_TIMEOUT_MS);
  }

  test('a container a helper started before a failing call is still running afterwards', async () => {
    const sibling = await createRedisContainer();
    const probe = await StartProbe.install();
    probe.failStart(new Error('injected'));

    try {
      const siblingOwner = sibling.container.getLabels()[OWNER_LABEL];
      expect(siblingOwner).toMatch(UUID);

      for (const [, helper] of HELPERS) {
        expect(await rejectionOf(helper())).toBeInstanceOf(Error);
      }
      expect(probe.created).toHaveLength(HELPERS.length);

      expect(await stateOf(probe.dockerode, sibling.container.getId())).toBe('running');
      // The owner filter is what the cleanup uses, and it does find a live container: the `[]`
      // asserted for the failed calls is not the filter matching nothing at all.
      expect((await listByOwner(probe.dockerode, siblingOwner)).map((info) => info.Id))
        .toEqual([sibling.container.getId()]);
    } finally {
      await probe.restoreAndSweep();
      await sibling.stop();
    }
  }, CONTAINER_TEST_TIMEOUT_MS);

  test('when the cleanup cannot list, the ORIGINAL start error is thrown and carries the owner label', async () => {
    const probe = await StartProbe.install();
    const injected = new Error('injected');
    const listFailure = new Error('injected list failure');
    probe.failStart(injected);
    probe.failOwnerListing(listFailure);

    try {
      const error = await rejectionOf(createRedisContainer());

      expect(error).toBe(injected);
      expect((error as Error).message).toBe('injected');
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AggregateError);

      const [owner] = probe.owners();
      expect(cleanupFailureOf(error)).toEqual({
        ownerLabel: `${OWNER_LABEL}=${owner}`,
        error: listFailure,
      });
      // The report is true: the container WAS left behind.
      expect(await stateOf(probe.dockerode, probe.created[0].id)).toBe('created');
    } finally {
      // Sweeps by that same owner label, which finds it once listing works again.
      await probe.restoreAndSweep();
    }

    expect(await stateOf(probe.dockerode, probe.created[0].id)).toBe('gone');
  }, CONTAINER_TEST_TIMEOUT_MS);

  test('when the cleanup cannot remove, the ORIGINAL start error is thrown and carries the owner label', async () => {
    const probe = await StartProbe.install();
    const injected = new Error('injected');
    const removeFailure = new Error('injected remove failure');
    probe.failStart(injected);
    probe.failOwnedRemoval(removeFailure);

    try {
      const error = await rejectionOf(createPostgresContainer());

      expect(error).toBe(injected);
      expect((error as Error).message).toBe('injected');
      expect(cleanupFailureOf(error)).toEqual({
        ownerLabel: `${OWNER_LABEL}=${probe.owners()[0]}`,
        error: removeFailure,
      });
      expect(await stateOf(probe.dockerode, probe.created[0].id)).toBe('created');
    } finally {
      await probe.restoreAndSweep();
    }

    expect(await stateOf(probe.dockerode, probe.created[0].id)).toBe('gone');
  }, CONTAINER_TEST_TIMEOUT_MS);

  test('the owner label is a fresh UUID per call, and a caller label under its key does not replace it', async () => {
    const probe = await StartProbe.install();
    probe.failStart(new Error('injected'));

    try {
      const labels = { ...CALLER_LABELS, [OWNER_LABEL]: 'caller-tries-to-own-it' };
      await rejectionOf(createRedisContainer({ labels }));
      await rejectionOf(createRedisContainer({ labels }));

      const owners = probe.owners();
      expect(owners).toHaveLength(2);
      expect(owners[0]).toMatch(UUID);
      expect(owners[1]).toMatch(UUID);
      expect(owners[0]).not.toBe(owners[1]);
      // Every other caller label still went in.
      expect(probe.created[0].options.Labels).toMatchObject(CALLER_LABELS);
    } finally {
      await probe.restoreAndSweep();
    }
  }, CONTAINER_TEST_TIMEOUT_MS);

  test(`without a reachable runtime (DOCKER_HOST=${MISSING_DOCKER_HOST}) each helper throws what testcontainers throws`, async () => {
    // A cleanup wrapper that reported its own failure in place of the start error once turned
    // this message into an AggregateError about a failed removal. Nothing was created, so there
    // is nothing to report: the error must be testcontainers' own, class and message.
    const result = await runWithoutRuntime();
    const expected = {
      constructorName: 'Error',
      isPlainError: true,
      message: 'Could not find a working container runtime strategy',
      hasCleanupFailure: false,
    };

    expect(result.testcontainers).toEqual(expected);
    expect(result.helpers).toEqual({
      createRedisContainer: expected,
      createNatsContainer: expected,
      createPostgresContainer: expected,
    });
  }, CONTAINER_TEST_TIMEOUT_MS);
});

describe('container helpers — caller labels (FB-26)', () => {
  for (const [name, helper] of HELPERS) {
    test(`${name}: the started container carries every caller label and its own owner label`, async () => {
      const started = await helper({ labels: { ...CALLER_LABELS, [OWNER_LABEL]: 'caller-tries-to-own-it' } });

      try {
        const labels = started.container.getLabels();

        expect(labels).toMatchObject(CALLER_LABELS);
        expect(labels[OWNER_LABEL]).toMatch(UUID);
      } finally {
        await started.stop();
      }
    }, CONTAINER_TEST_TIMEOUT_MS);
  }
});

describe('testcontainers peer declaration', () => {
  // The `@onebun/core/testing` barrel value-imports `testcontainers`, so the peer is
  // required in fact. It was declared `optional: true`, which made the manifest contradict
  // the code: a consumer following the declaration got a module-resolution failure from a
  // dependency the package told them they could skip. This pins the decision — integration
  // tests are the default, so the peer is required — and it fails if `optional` returns.
  test('declares testcontainers as a required peer, matching the barrel that imports it', () => {

    const pkg = require('../../package.json') as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    expect(pkg.peerDependencies?.testcontainers).toBeDefined();
    expect(pkg.peerDependenciesMeta?.testcontainers?.optional).toBeUndefined();
  });

  test('the peer range is >=10.0.0: the failed-start cleanup is feature-detected, not required', () => {
    // The helpers remove a half-started container through `getContainerRuntimeClient()`, which
    // testcontainers exports from 10.3.0 on. Raising the peer floor to 10.3.0 for it would be a
    // break for a 10.0–10.2 install, so the range stays where 0.8.1 had it: `container-ownership.ts`
    // uses the function when the installed release has it, and below that the helpers start as in
    // 0.8.1 (see the next test, and container-ownership.test.ts for the branch itself).
    const pkg = require('../../package.json') as { peerDependencies?: Record<string, string> };

    expect(pkg.peerDependencies?.testcontainers).toBe('>=10.0.0');
    // The cleanup is live here: the installed dev dependency does export it.
    expect(typeof getContainerRuntimeClient).toBe('function');
  });

  test('on testcontainers 10.0–10.2 the barrel still links and the helpers start as 0.8.1 did', async () => {
    // A named import of `getContainerRuntimeClient` fails to link against those releases —
    // "SyntaxError: Export named 'getContainerRuntimeClient' not found" — and it would take every
    // import from `@onebun/core/testing` down with it, `createTestService` included. So the export
    // is read off the namespace, and without it the helpers start without the cleanup: the start
    // error still comes through unchanged, and there is no cleanup to report a failure of.
    const result = await runAgainstPre103Testcontainers();

    // Not vacuous: the stub has the shape that breaks a named import.
    expect(result.namedImport.links).toBe(false);
    expect(result.namedImport.error).toContain('getContainerRuntimeClient');
    expect(result.containers).toEqual({ links: true, error: '' });

    const schemes: Record<string, string> = {
      createRedisContainer: 'redis://',
      createNatsContainer: 'nats://',
      createPostgresContainer: 'postgresql://',
    };
    expect(Object.keys(result.helpers)).toEqual(Object.keys(schemes));
    for (const [name, outcome] of Object.entries(result.helpers)) {
      expect(outcome.failedStart).toMatchObject({ sameError: true, message: 'injected', hasCleanupFailure: false });
      // Labels still go on before create, the caller's and the owner label.
      expect(outcome.failedStart.labels).toMatchObject(PRE_10_3_CALLER_LABELS);
      expect(outcome.failedStart.labels[OWNER_LABEL]).toMatch(UUID);
      expect(outcome.startedUrl.startsWith(schemes[name])).toBe(true);
      expect(outcome.startedUrl).toContain('stub-host:40000');
    }
  }, CONTAINER_TEST_TIMEOUT_MS);

  test('is absent from dependencies, so a production install never pulls a Docker client', () => {
    // The other way to make it mandatory would put testcontainers — and dockerode with it —
    // into every production install of the framework. The peer keeps the choice of where to
    // declare it with the consumer, and devDependencies is the right place.

    const pkg = require('../../package.json') as { dependencies?: Record<string, string> };

    expect(pkg.dependencies?.testcontainers).toBeUndefined();
  });
});
