/**
 * How the container helpers own what they start: the per-call owner label, and the cleanup of a
 * container whose start failed. Internal to `containers.ts` — the testing barrel does not re-export
 * this module, so nothing here is public API.
 */
import { randomUUID } from 'node:crypto';

import * as testcontainers from 'testcontainers';

import type { ContainerCleanupFailure } from './containers';
import type { StartedTestContainer } from 'testcontainers';

/** The label every helper call stamps, with a fresh UUID, on the container it creates. */
const OWNER_LABEL = 'dev.onebun.testing.owner';
const CLEANUP_FAILURE_PROPERTY = 'containerCleanupFailure';
const HTTP_NOT_FOUND = 404;

type CleanupOutcome = { removed: true } | { removed: false; error: unknown };

/**
 * The part of testcontainers' runtime client the cleanup uses. Typed here, not imported:
 * `@onebun/core` ships its sources, so this file is type-checked against whichever testcontainers
 * the consumer installed — 10.3.0 declares no dockerode types (`dockerode` is `any` there), and
 * 10.0–10.2 have no runtime client to import a type from.
 */
export interface OwnedContainerRuntime {
  container: {
    dockerode: {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Docker's own field name
      listContainers(options: { all: boolean; filters: { label: string[] } }): Promise<Array<{ Id: string }>>;
      getContainer(id: string): { remove(options: { force: boolean; v: boolean }): Promise<unknown> };
    };
  };
}

/** What `startOwned()` needs of a container builder. testcontainers' `GenericContainer` is one. */
export interface OwnableContainerBuilder {
  withLabels(labels: Record<string, string>): unknown;
  start(): Promise<StartedTestContainer>;
}

/**
 * The `getContainerRuntimeClient` of a testcontainers module namespace, or `undefined` when the
 * namespace has no such function — testcontainers 10.0–10.2, since 10.3.0 is the first release that
 * exports it.
 *
 * Takes the namespace rather than importing the function by name: a named import of an export the
 * installed release lacks fails at link time, and it would take every import from
 * `@onebun/core/testing` down with it — `createTestService` and `TestingModule` included. Reading a
 * missing property off a namespace object is just `undefined`.
 */
export function runtimeClientResolver(namespace: object): (() => Promise<OwnedContainerRuntime>) | undefined {
  const candidate: unknown = (namespace as { getContainerRuntimeClient?: unknown }).getContainerRuntimeClient;

  return typeof candidate === 'function' ? candidate as () => Promise<OwnedContainerRuntime> : undefined;
}

/** A container that is already gone is what the cleanup wanted. */
function isAlreadyGone(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { statusCode?: unknown }).statusCode === HTTP_NOT_FOUND;
}

/**
 * Force-remove every container carrying this call's owner label, whatever its state.
 *
 * `all: true` matters: a container whose start failed is `created`, not running, and the default
 * listing shows running containers only. The filter is the per-call label, never the testcontainers
 * session id — that one is shared by every container of the process, and with a reused Ryuk by
 * other processes too, so removing by it would take siblings down.
 *
 * @returns `{ removed: true }` when nothing owned is left, otherwise why the cleanup failed.
 */
async function removeOwned(client: OwnedContainerRuntime, owner: string): Promise<CleanupOutcome> {
  const { dockerode } = client.container;

  try {
    const owned = await dockerode.listContainers({
      all: true,
      filters: { label: [`${OWNER_LABEL}=${owner}`] },
    });
    const removals = await Promise.allSettled(owned.map(async (info) => {
      await dockerode.getContainer(info.Id).remove({ force: true, v: true });
    }));
    const failures: unknown[] = [];
    for (const removal of removals) {
      if (removal.status === 'rejected' && !isAlreadyGone(removal.reason)) {
        failures.push(removal.reason);
      }
    }

    if (failures.length === 0) {
      return { removed: true };
    }

    return {
      removed: false,
      error: failures.length === 1
        ? failures[0]
        : new AggregateError(failures, `Could not remove ${failures.length} containers labelled ${OWNER_LABEL}=${owner}`),
    };
  } catch (error) {
    return { removed: false, error };
  }
}

/**
 * Put the cleanup failure on the start error without touching its class, message or stack. A thrown
 * value that cannot carry a property (a primitive, a frozen object) is left as it is: the start
 * error always wins over the report about it.
 */
function attachCleanupFailure(startError: unknown, failure: ContainerCleanupFailure): void {
  if ((typeof startError !== 'object' && typeof startError !== 'function') || startError === null) {
    return;
  }
  try {
    Object.defineProperty(startError, CLEANUP_FAILURE_PROPERTY, {
      value: failure,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } catch {
    // Non-extensible error: rethrown unchanged, see above.
  }
}

/**
 * Start the builder as a container this call owns, and remove it again if the start fails.
 *
 * testcontainers cleans up after itself only when the wait strategy fails. A failure in
 * `container.start` (an OCI runtime error), in the port inspection after it, or anywhere else
 * between Docker `create` and a returned handle leaves the container behind — `created`, or
 * `running` when the inspection is what failed — and the caller never gets a handle to stop it.
 * So every call stamps a fresh owner label before create and, when `start()` rejects, removes
 * exactly the containers carrying it.
 *
 * The start error is always what the caller sees, with its class and message intact. A cleanup
 * that fails too is reported on it as `containerCleanupFailure`, never in its place.
 *
 * With testcontainers 10.0–10.2 (no `getContainerRuntimeClient` in `namespace`) there is no runtime
 * client to remove anything with. There no cleanup is attempted and the start error is rethrown as
 * it is. The labels, the caller's and the owner label, are applied all the same.
 *
 * @param namespace - The testcontainers module namespace to read `getContainerRuntimeClient` from.
 * Only tests pass one, to stand in for a release without it.
 */
export async function startOwned(
  builder: OwnableContainerBuilder,
  labels: Record<string, string> | undefined,
  namespace: object = testcontainers,
): Promise<StartedTestContainer> {
  const resolveRuntimeClient = runtimeClientResolver(namespace);
  // Resolved before anything is created, and it is the first thing `start()` resolves too. With
  // no reachable runtime this rejects with testcontainers' own "Could not find a working container
  // runtime strategy" — the error a caller got before this helper owned its cleanup — and there is
  // nothing to remove. Once resolved the client is cached, so `start()` gets the same instance.
  const client = resolveRuntimeClient === undefined ? undefined : await resolveRuntimeClient();
  const owner = randomUUID();

  // The owner key is spread last: a caller label under the same key cannot replace it.
  builder.withLabels({ ...labels, [OWNER_LABEL]: owner });

  try {
    return await builder.start();
  } catch (startError) {
    if (client === undefined) {
      throw startError;
    }
    const cleanup = await removeOwned(client, owner);
    if (!cleanup.removed) {
      attachCleanupFailure(startError, { ownerLabel: `${OWNER_LABEL}=${owner}`, error: cleanup.error });
    }
    throw startError;
  }
}
