/**
 * Shared Redis Provider Tests
 *
 * Tests using testcontainers for real Redis integration
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import { Effect, pipe } from 'effect';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

import {
  SharedRedisProvider,
  SharedRedisService,
  makeSharedRedisLayer,
  getSharedRedis,
} from './shared-redis';

describe('SharedRedisProvider', () => {
  let redisContainer: StartedTestContainer;
  let redisUrl: string;

  beforeAll(async () => {
    // Start Redis container
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/.*Ready to accept connections.*/))
      .withStartupTimeout(30000)
      .withLogConsumer(() => {
        // Suppress container logs
      })
      .start();

    const host = redisContainer.getHost();
    const port = redisContainer.getMappedPort(6379);
    redisUrl = `redis://${host}:${port}`;
  });

  afterAll(async () => {
    await SharedRedisProvider.reset();
    if (redisContainer) {
      await redisContainer.stop();
    }
  });

  afterEach(async () => {
    await SharedRedisProvider.reset();
  });

  describe('configuration', () => {
    it('should configure the provider', () => {
      expect(SharedRedisProvider.isConfigured()).toBe(false);
      
      SharedRedisProvider.configure({ url: redisUrl });
      
      expect(SharedRedisProvider.isConfigured()).toBe(true);
    });

    it('should throw when getClient called without configuration', async () => {
      await expect(SharedRedisProvider.getClient()).rejects.toThrow(
        'SharedRedisProvider not configured',
      );
    });
  });

  describe('connection', () => {
    it('should connect and return a client', async () => {
      SharedRedisProvider.configure({
        url: redisUrl,
        keyPrefix: 'test:',
      });

      const client = await SharedRedisProvider.getClient();
      
      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(true);
      expect(SharedRedisProvider.isConnected()).toBe(true);
    });

    it('should return the same instance on multiple calls', async () => {
      SharedRedisProvider.configure({ url: redisUrl });

      const client1 = await SharedRedisProvider.getClient();
      const client2 = await SharedRedisProvider.getClient();
      
      expect(client1).toBe(client2);
    });

    it('should handle concurrent getClient calls', async () => {
      SharedRedisProvider.configure({ url: redisUrl });

      // Call getClient multiple times concurrently
      const [client1, client2, client3] = await Promise.all([
        SharedRedisProvider.getClient(),
        SharedRedisProvider.getClient(),
        SharedRedisProvider.getClient(),
      ]);
      
      // All should be the same instance
      expect(client1).toBe(client2);
      expect(client2).toBe(client3);
    });

    it('should disconnect properly', async () => {
      SharedRedisProvider.configure({ url: redisUrl });

      await SharedRedisProvider.getClient();
      expect(SharedRedisProvider.isConnected()).toBe(true);

      await SharedRedisProvider.disconnect();
      
      expect(SharedRedisProvider.isConnected()).toBe(false);
    });

    it('should reconnect after disconnect', async () => {
      SharedRedisProvider.configure({ url: redisUrl });

      const client1 = await SharedRedisProvider.getClient();
      await SharedRedisProvider.disconnect();

      const client2 = await SharedRedisProvider.getClient();
      
      expect(client2).toBeDefined();
      expect(client2.isConnected()).toBe(true);
      // After disconnect and reconnect, we get a new instance
      expect(client1).not.toBe(client2);
    });
  });

  describe('client operations', () => {
    it('should perform basic Redis operations', async () => {
      SharedRedisProvider.configure({
        url: redisUrl,
        keyPrefix: 'test:ops:',
      });

      const client = await SharedRedisProvider.getClient();
      
      // Set and get
      await client.set('testkey', 'testvalue');
      const value = await client.get('testkey');
      expect(value).toBe('testvalue');
      
      // Delete
      await client.del('testkey');
      const deleted = await client.get('testkey');
      expect(deleted).toBeNull();
    });
  });

  describe('createClient', () => {
    it('should create standalone client with custom URL', async () => {
      SharedRedisProvider.configure({ url: redisUrl });

      const standalone = SharedRedisProvider.createClient({
        url: redisUrl,
        keyPrefix: 'standalone:',
      });
      
      await standalone.connect();
      expect(standalone.isConnected()).toBe(true);
      
      // Should be different from shared client
      const shared = await SharedRedisProvider.getClient();
      expect(standalone).not.toBe(shared);
      
      await standalone.disconnect();
    });

    it('should use base options when not specified', async () => {
      SharedRedisProvider.configure({
        url: redisUrl,
        keyPrefix: 'base:',
        reconnect: true,
      });

      const standalone = SharedRedisProvider.createClient({});
      
      await standalone.connect();
      expect(standalone.isConnected()).toBe(true);
      await standalone.disconnect();
    });

    it('should throw when URL is not available', () => {
      // Don't configure provider
      expect(() => SharedRedisProvider.createClient({})).toThrow('Redis URL is required');
    });
  });

  describe('reset', () => {
    it('should reset provider state completely', async () => {
      SharedRedisProvider.configure({ url: redisUrl });
      await SharedRedisProvider.getClient();
      
      expect(SharedRedisProvider.isConnected()).toBe(true);
      expect(SharedRedisProvider.isConfigured()).toBe(true);

      await SharedRedisProvider.reset();
      
      expect(SharedRedisProvider.isConnected()).toBe(false);
      expect(SharedRedisProvider.isConfigured()).toBe(false);
    });
  });

  describe('Effect.js integration', () => {
    it('should work with makeSharedRedisLayer', async () => {
      const layer = makeSharedRedisLayer({
        url: redisUrl,
        keyPrefix: 'effect:',
      });

      const program = pipe(
        SharedRedisService,
        Effect.flatMap((redis) =>
          Effect.promise(async () => {
            await redis.set('effect-test', 'value');

            return await redis.get('effect-test');
          }),
        ),
      );

      const result = await Effect.runPromise(Effect.provide(program, layer));
      
      expect(result).toBe('value');
    });

    it('should fail getSharedRedis when not configured', async () => {
      // Reset to ensure not configured
      await SharedRedisProvider.reset();
      
      const result = await Effect.runPromiseExit(getSharedRedis);
      
      expect(result._tag).toBe('Failure');
    });

    it('should succeed getSharedRedis when configured', async () => {
      SharedRedisProvider.configure({ url: redisUrl });
      
      const result = await Effect.runPromiseExit(getSharedRedis);
      
      expect(result._tag).toBe('Success');
    });
  });
});
