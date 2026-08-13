import {
  describe,
  expect,
  test,
} from 'bun:test';

import { createNatsContainer, createRedisContainer } from './containers';

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

  test('is absent from dependencies, so a production install never pulls a Docker client', () => {
    // The other way to make it mandatory would put testcontainers — and dockerode with it —
    // into every production install of the framework. The peer keeps the choice of where to
    // declare it with the consumer, and devDependencies is the right place.
     
    const pkg = require('../../package.json') as { dependencies?: Record<string, string> };

    expect(pkg.dependencies?.testcontainers).toBeUndefined();
  });
});
