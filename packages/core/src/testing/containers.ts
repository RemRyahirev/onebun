import { GenericContainer, Wait } from 'testcontainers';

import type { StartedTestContainer } from 'testcontainers';

export interface TestContainer {
  url: string;
  host: string;
  port: number;
  container: StartedTestContainer;
  stop(): Promise<void>;
}

export interface RedisContainerOptions {
  image?: string;
  startupTimeout?: number;
}

export interface NatsContainerOptions {
  image?: string;
  startupTimeout?: number;
  enableJetStream?: boolean;
}

const DEFAULT_STARTUP_TIMEOUT = process.env.CI ? 60_000 : 30_000;
const REDIS_PORT = 6379;
const NATS_PORT = 4222;

export async function createRedisContainer(
  options?: RedisContainerOptions,
): Promise<TestContainer> {
  const image = options?.image ?? 'redis:7-alpine';
  const startupTimeout = options?.startupTimeout ?? DEFAULT_STARTUP_TIMEOUT;

  const container = await new GenericContainer(image)
    .withExposedPorts(REDIS_PORT)
    .withWaitStrategy(Wait.forLogMessage(/.*Ready to accept connections.*/))
    .withStartupTimeout(startupTimeout)
    .withLogConsumer(() => {
      // Suppress container logs in tests
    })
    .start();

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

  const container = await builder.start();
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
