import { GenericContainer, Wait } from 'testcontainers';

import type { StartedTestContainer } from 'testcontainers';

import { startOwned } from './container-ownership';

/**
 * A started container and the connection details a test needs.
 *
 * @see docs:testing.md
 */
export interface TestContainer {
  url: string;
  host: string;
  port: number;
  container: StartedTestContainer;
  stop(): Promise<void>;
}

/**
 * @see docs:testing.md
 */
export interface RedisContainerOptions {
  image?: string;
  startupTimeout?: number;
  /**
   * Labels to put on the container, applied before it is created — so a harness can find
   * everything it started, even after a run that was killed half-way through a start.
   */
  labels?: Record<string, string>;
}

/**
 * @see docs:testing.md
 */
export interface NatsContainerOptions {
  image?: string;
  startupTimeout?: number;
  enableJetStream?: boolean;
  /**
   * Labels to put on the container, applied before it is created — so a harness can find
   * everything it started, even after a run that was killed half-way through a start.
   */
  labels?: Record<string, string>;
}

/**
 * @see docs:testing.md
 */
export interface PostgresContainerOptions {
  image?: string;
  startupTimeout?: number;
  database?: string;
  username?: string;
  password?: string;
  /**
   * Labels to put on the container, applied before it is created — so a harness can find
   * everything it started, even after a run that was killed half-way through a start.
   */
  labels?: Record<string, string>;
}

/**
 * What a container helper attaches to its start error, as `containerCleanupFailure`, when it could
 * not remove the container that failed to start. The start error itself is thrown unchanged.
 *
 * @see docs:testing.md
 */
export interface ContainerCleanupFailure {
  /**
   * The helper's per-call owner label as `key=value` (`dev.onebun.testing.owner=<uuid>`) — the
   * filter that finds what was left behind: `docker ps -a --filter "label=<ownerLabel>"`.
   */
  ownerLabel: string;
  /** Why listing or removing the owned container failed. */
  error: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const DEFAULT_STARTUP_TIMEOUT = process.env.CI ? 60_000 : 30_000;
const REDIS_PORT = 6379;
const NATS_PORT = 4222;
const POSTGRES_PORT = 5432;

/**
 * A throwaway Redis for integration tests.
 *
 * @param options - Image, startup timeout and labels to put on the container before it is created.
 * @returns The started container with a `redis://` URL, and a `stop()` to call in `afterAll`.
 *
 * @see docs:testing.md
 */
export async function createRedisContainer(
  options?: RedisContainerOptions,
): Promise<TestContainer> {
  const image = options?.image ?? 'redis:7-alpine';
  const startupTimeout = options?.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT;

  const builder = new GenericContainer(image)
    .withExposedPorts(REDIS_PORT)
    .withWaitStrategy(Wait.forLogMessage(/.*Ready to accept connections.*/))
    .withStartupTimeout(startupTimeout)
    .withLogConsumer(() => {
      // Suppress container logs in tests
    });

  const container = await startOwned(builder, options?.labels);
  const host = container.getHost();
  const port = container.getMappedPort(REDIS_PORT);

  return {
    url: `redis://${host}:${port}`,
    host,
    port,
    container,
    async stop() {
      await container.stop();
    },
  };
}

/**
 * A throwaway NATS server for integration tests.
 *
 * @param options - Image, startup timeout, `enableJetStream` and labels to put on the container
 * before it is created.
 * @returns The started container with a `nats://` URL, and a `stop()` to call in `afterAll`.
 *
 * @see docs:testing.md
 */
export async function createNatsContainer(
  options?: NatsContainerOptions,
): Promise<TestContainer> {
  const image = options?.image ?? 'nats:2.10-alpine';
  const startupTimeout = options?.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT;
  const enableJetStream = options?.enableJetStream ?? false;

  let builder = new GenericContainer(image)
    .withExposedPorts(NATS_PORT)
    .withWaitStrategy(Wait.forLogMessage(/.*Server is ready.*/))
    .withStartupTimeout(startupTimeout)
    .withLogConsumer(() => {
      // Suppress container logs in tests
    });

  if (enableJetStream) {
    builder = builder.withCommand(['--js']);
  }

  const container = await startOwned(builder, options?.labels);
  const host = container.getHost();
  const port = container.getMappedPort(NATS_PORT);

  return {
    url: `nats://${host}:${port}`,
    host,
    port,
    container,
    async stop() {
      await container.stop();
    },
  };
}

/**
 * A throwaway PostgreSQL for integration tests.
 *
 * Unconditional, like the Redis and NATS helpers beside it: Docker is a hard requirement of
 * `bun test` in this repository rather than something a flag opts into. The alternative — gating
 * on an env var such as `TEST_POSTGRES_URL` — makes a test `return` early on every run that does
 * not set it, so the suite stays green while the code the test covers goes unchecked.
 *
 * `Wait.forLogMessage(..., 2)` is not a typo. The postgres image starts a temporary server to run
 * its initialisation scripts and logs "ready to accept connections" for it, then shuts it down and
 * starts the real one. Waiting for the first line hands back a URL that is about to stop working.
 *
 * @param options - Image, startup timeout, the database/user/password to create, and labels to put
 * on the container before it is created.
 * @returns The started container with a `postgresql://` URL, and a `stop()` to call in `afterAll`.
 *
 * @see docs:testing.md
 */
export async function createPostgresContainer(
  options?: PostgresContainerOptions,
): Promise<TestContainer> {
  const image = options?.image ?? 'postgres:16-alpine';
  const startupTimeout = options?.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT;
  const database = options?.database ?? 'onebun_test';
  const username = options?.username ?? 'onebun';
  const password = options?.password ?? 'onebun';

  const builder = new GenericContainer(image)
    .withExposedPorts(POSTGRES_PORT)
    .withEnvironment({
      POSTGRES_DB: database,
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password,
    })
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(startupTimeout)
    .withLogConsumer(() => {
      // Suppress container logs in tests
    });

  const container = await startOwned(builder, options?.labels);
  const host = container.getHost();
  const port = container.getMappedPort(POSTGRES_PORT);

  return {
    url: `postgresql://${username}:${password}@${host}:${port}/${database}`,
    host,
    port,
    container,
    async stop() {
      await container.stop();
    },
  };
}
