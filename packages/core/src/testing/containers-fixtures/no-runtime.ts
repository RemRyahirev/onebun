/**
 * The container helpers with no reachable container runtime, in a fresh process:
 * `DOCKER_HOST=unix:///nonexistent.sock HOME=<empty dir> XDG_RUNTIME_DIR=<empty dir> bun <this file>`.
 *
 * A fresh process because testcontainers caches the runtime client of its first successful probe
 * for the life of the process, and the test process has a working runtime.
 *
 * The environment closes every discovery path it reaches: `DOCKER_HOST` points at a socket that does
 * not exist, and `HOME` / `XDG_RUNTIME_DIR` hide the properties file and the rootless sockets. Two
 * sockets sit at fixed system paths no variable redirects — `/var/run/docker.sock`, which every CI
 * runner has, and `/run/user/<uid>/docker.sock`. A client aimed at one of those fails its first
 * request here the way the `DOCKER_HOST` client really does, so the outcome does not depend on the
 * host. Every other client is untouched.
 *
 * Prints one line, `RESULT_MARKER` followed by JSON, and exits 0. Run it through
 * `runWithoutRuntime()` in `no-runtime-protocol.ts`.
 */
import { createRequire } from 'node:module';

import { getContainerRuntimeClient } from 'testcontainers';

import {
  createNatsContainer,
  createPostgresContainer,
  createRedisContainer,
} from '../containers';

import {
  type NoRuntimeResult,
  type Observed,
  RESULT_MARKER,
} from './no-runtime-protocol';

interface DockerodeModem {
  socketPath?: string;
}

interface DockerodeClass {
  prototype: {
    info(this: { modem?: DockerodeModem }, ...args: unknown[]): Promise<unknown>;
  };
}

const SYSTEM_SOCKETS = /^(\/var)?\/run\/(docker\.sock$|user\/\d+\/docker\.sock$)/;

function closeSystemSockets(): void {
  // The very module testcontainers loads: resolved from its own directory, not from this package.
  const fromTestcontainers = createRequire(Bun.resolveSync('testcontainers', import.meta.dir));
  const dockerode = fromTestcontainers('dockerode') as DockerodeClass;
  const realInfo = dockerode.prototype.info;

  dockerode.prototype.info = async function info(this: { modem?: DockerodeModem }, ...args: unknown[]) {
    const socketPath = this.modem?.socketPath;
    if (socketPath !== undefined && SYSTEM_SOCKETS.test(socketPath)) {
      throw Object.assign(new Error(`connect ENOENT ${socketPath}`), { code: 'ENOENT' });
    }

    return await realInfo.apply(this, args);
  };
}

async function observe(run: () => Promise<unknown>): Promise<Observed> {
  try {
    const started = await run();
    // Never expected; stop it so a broken fixture cannot leak a container.
    await (started as { stop?: () => Promise<void> }).stop?.();

    return 'resolved';
  } catch (error) {
    const value = error as { constructor?: { name?: string }; message?: unknown };

    return {
      constructorName: String(value?.constructor?.name),
      isPlainError: value?.constructor === Error,
      message: String(value?.message),
      hasCleanupFailure: typeof error === 'object' && error !== null && 'containerCleanupFailure' in error,
    };
  }
}

closeSystemSockets();

const result: NoRuntimeResult = {
  testcontainers: await observe(getContainerRuntimeClient),
  helpers: {
    createRedisContainer: await observe(createRedisContainer),
    createNatsContainer: await observe(createNatsContainer),
    createPostgresContainer: await observe(createPostgresContainer),
  },
};

process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
process.exit(0);
