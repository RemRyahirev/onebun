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
