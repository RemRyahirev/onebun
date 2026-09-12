/**
 * What happens to a frame or a record that does not say which gateway it belongs to.
 *
 * Binding a connection to the gateway that admitted it put a key on every client record and on
 * every pub/sub payload. Both readers were then written to ACCEPT anything unkeyed, so that an
 * instance running an older build — which writes neither — stayed interoperable through a
 * rolling deploy. Accepting is exactly the leak the key was added to close: measured, ONE unkeyed
 * frame arriving at a two-gateway instance was delivered to `/chat` AND `/admin`, and an unkeyed
 * record was visible through every fenced read of every gateway.
 *
 * The escape survives only where it cannot leak: an application that registered exactly ONE
 * gateway has no sibling to leak to, so an unkeyed frame or record is unambiguous there. With
 * more than one it is a guess, and `WsHandler.ownerAtOpen` already refuses to make that guess in
 * the same situation — this is the same rule, applied to the other two readers.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';

import type { WsClientData } from './ws.types';
import type { ServerWebSocket } from 'bun';

import { RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';
import { createMockSyncLogger } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { WebSocketGateway } from './ws-decorators';
import { WsHandler } from './ws-handler';
import { WsStorageEvent, type WsStorageEventPayload } from './ws-storage';
import { InMemoryWsStorage } from './ws-storage-memory';
import { createRedisWsStorage, type RedisWsStorage } from './ws-storage-redis';

const SETTLE_MS = 250;
const CONTAINER_STARTUP_MS = 120_000;
const PUBSUB_CHANNEL = 'ws:events';

@WebSocketGateway({ path: '/chat' })
class ChatGateway extends BaseWebSocketGateway {}

@WebSocketGateway({ path: '/admin', namespace: 'admin' })
class AdminGateway extends BaseWebSocketGateway {}

interface Recorded {
  socket: ServerWebSocket<WsClientData>;
  sent: string[];
}

/** A socket that records what its gateway sent it, standing in for a real connection. */
function recordingSocket(id: string, gatewayKey: string): Recorded {
  const sent: string[] = [];
  const socket = {
    data: {
      id,
      rooms: [],
      connectedAt: Date.now(),
      auth: null,
      metadata: {},
      protocol: 'native' as const,
      gatewayKey,
    },
    send(message: string) {
      sent.push(message);

      return 1;
    },
    close: () => undefined,
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    publish: () => 1,
  } as unknown as ServerWebSocket<WsClientData>;

  return { socket, sent };
}

/** A client record shaped the way a build that predates the gateway key writes one. */
function unkeyedRecord(id: string): WsClientData {
  return {
    id,
    rooms: [],
    connectedAt: Date.now(),
    auth: null,
    metadata: {},
    protocol: 'native',
  };
}

/** What a build that predates the gateway key publishes: everything but the key. */
const legacyFrame: WsStorageEventPayload = {
  type: WsStorageEvent.BROADCAST,
  sourceInstanceId: 'an-older-build',
  data: { event: 'legacy:hello', message: { from: 'the past' } },
};

describe('a frame or record that names no gateway', () => {
  describe('records, read through the gateway fence', () => {
    test('is refused when the application registered more than one gateway', async () => {
      const handler = new WsHandler(createMockSyncLogger());
      const storage = new InMemoryWsStorage();
      handler.setStorage(storage);

      const chat = new ChatGateway();
      const admin = new AdminGateway();
      handler.registerGateway(ChatGateway, chat);
      handler.registerGateway(AdminGateway, admin);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat._initialize(storage, {} as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin._initialize(storage, {} as any);

      await storage.addClient(unkeyedRecord('from-an-older-build'));
      await storage.addClientToRoom('from-an-older-build', 'lobby');

      // Was visible through every one of these, to BOTH gateways — a record with no key was
      // everybody's, which is the opposite of what the key is for.
      expect(await chat.getClient('from-an-older-build')).toBeUndefined();
      expect(await chat.getClientsByRoom('lobby')).toEqual([]);
      expect(await chat.getRoom('lobby')).toBeUndefined();
      expect(await chat.getRoomsByPattern('lob*')).toEqual([]);
      expect(await admin.getClient('from-an-older-build')).toBeUndefined();
    });

    test('is accepted when there is exactly one gateway to be ambiguous between', async () => {
      const handler = new WsHandler(createMockSyncLogger());
      const storage = new InMemoryWsStorage();
      handler.setStorage(storage);

      const chat = new ChatGateway();
      handler.registerGateway(ChatGateway, chat);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat._initialize(storage, {} as any);

      await storage.addClient(unkeyedRecord('from-an-older-build'));
      await storage.addClientToRoom('from-an-older-build', 'lobby');

      // Nothing to leak to: the only gateway in the application is the only one it could
      // belong to. This is the whole of what the escape was for, and it is kept.
      expect((await chat.getClient('from-an-older-build'))?.id).toBe('from-an-older-build');
      expect((await chat.getClientsByRoom('lobby')).map((client) => client.id)).toEqual(['from-an-older-build']);
      expect((await chat.getRoom('lobby'))?.clientIds).toEqual(['from-an-older-build']);
    });
  });

  describe('pub/sub frames', () => {
    let redis: TestContainer;
    const opened: Array<{ storage: RedisWsStorage; client: RedisClient }> = [];

    beforeAll(async () => {
      redis = await createRedisContainer();
    }, CONTAINER_STARTUP_MS);

    afterAll(async () => {
      await redis.stop();
    });

    afterEach(async () => {
      for (const instance of opened.splice(0)) {
        await instance.storage.close().catch(() => undefined);
        await instance.client.disconnect().catch(() => undefined);
      }
    });

    /** One instance of an application, with as many gateways as asked for. */
    async function makeInstance(prefix: string, gateways: 'one' | 'two'): Promise<{
      chatSocket: Recorded;
      adminSocket?: Recorded;
    }> {
      const client = new RedisClient({ url: redis.url, keyPrefix: prefix });
      await client.connect();
      const storage = createRedisWsStorage(client) as RedisWsStorage;
      opened.push({ storage, client });

      const handler = new WsHandler(createMockSyncLogger());
      handler.setStorage(storage);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const server = { publish: () => 1 } as any;

      const chat = new ChatGateway();
      handler.registerGateway(ChatGateway, chat);

      let admin: AdminGateway | undefined;
      if (gateways === 'two') {
        admin = new AdminGateway();
        handler.registerGateway(AdminGateway, admin);
      }

      chat._initialize(storage, server);
      admin?._initialize(storage, server);
      await (chat as unknown as { pubSubReady?: Promise<void> }).pubSubReady;
      await (admin as unknown as { pubSubReady?: Promise<void> } | undefined)?.pubSubReady;

      const chatSocket = recordingSocket('chat-client', '/chat');
      chat._registerSocket(chatSocket.socket.data.id, chatSocket.socket);

      let adminSocket: Recorded | undefined;
      if (admin) {
        adminSocket = recordingSocket('admin-client', '/admin:admin');
        admin._registerSocket(adminSocket.socket.data.id, adminSocket.socket);
      }

      return { chatSocket, adminSocket };
    }

    /** Publish straight onto the channel, the way an older build's instance would. */
    async function publishLegacy(prefix: string): Promise<void> {
      const publisher = new RedisClient({ url: redis.url, keyPrefix: prefix });
      await publisher.connect();
      await publisher.publish(PUBSUB_CHANNEL, JSON.stringify(legacyFrame));
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      await publisher.disconnect();
    }

    test('is refused when the instance has more than one gateway', async () => {
      const instance = await makeInstance('wi373-two:', 'two');

      await publishLegacy('wi373-two:');

      // Was `{ chat: 1, admin: 1 }` — one frame, delivered to both, which is precisely the
      // cross-gateway leak the key exists to close, re-opened for anything that omits it.
      expect(instance.chatSocket.sent.filter((m) => m.includes('legacy:hello'))).toHaveLength(0);
      expect(instance.adminSocket!.sent.filter((m) => m.includes('legacy:hello'))).toHaveLength(0);
    }, 60_000);

    test('is delivered when the instance has exactly one gateway', async () => {
      const instance = await makeInstance('wi373-one:', 'one');

      await publishLegacy('wi373-one:');

      // The legacy case that is genuinely unambiguous, and the common deployment shape. Kept on
      // purpose: tightening here would break an older instance's fan-out for no isolation gain.
      expect(instance.chatSocket.sent.filter((m) => m.includes('legacy:hello'))).toHaveLength(1);
    }, 60_000);
  });
});
