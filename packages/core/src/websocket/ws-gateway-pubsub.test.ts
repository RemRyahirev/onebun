/**
 * A remote WebSocket event reaches the gateway that published it, and only that one.
 *
 * The subscriber filtered on `sourceInstanceId` alone — which is minted per GATEWAY, not per
 * process — so a publish looped back through Redis and the SIBLING gateway in the same process
 * replayed it to its own clients. Measured, one `/chat` broadcast:
 *
 *   s-c1-chat  (publisher gateway, local)        x 1
 *   s-c1-admin (SAME instance, other gateway)    x 1
 *   s-c2-chat  (remote instance, same gateway)   x 1
 *   s-c2-admin (remote instance, other gateway)  x 1
 *
 * Redis re-opened the boundary the socket fence had just closed, without needing a second
 * instance at all.
 *
 * And on the framework's own init path the counts were worse: `RedisWsStorage.subscribe` raised
 * its `subscribed` flag AFTER the await, so concurrently-initialising gateways each installed a
 * Redis-level listener that then iterated the SHARED handler list — N gateways delivering every
 * message N x N times. Measured: 2 gateways, 4 copies of one broadcast to every client.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';

import type { WsClientData } from './ws.types';
import type { ServerWebSocket } from 'bun';

import { RedisClient } from '../redis/redis-client';
import { createRedisContainer, type TestContainer } from '../testing/containers';
import { createMockSyncLogger } from '../testing/test-utils';

import { BaseWebSocketGateway } from './ws-base-gateway';
import { WebSocketGateway } from './ws-decorators';
import { WsHandler } from './ws-handler';
import { createRedisWsStorage, type RedisWsStorage } from './ws-storage-redis';

const SETTLE_MS = 250;

@WebSocketGateway({ path: '/chat' })
class ChatGateway extends BaseWebSocketGateway {}

@WebSocketGateway({ path: '/admin', namespace: 'admin' })
class AdminGateway extends BaseWebSocketGateway {}

interface Recorded {
  socket: ServerWebSocket<WsClientData>;
  sent: string[];
}

/** A socket that records what the gateway sent it, standing in for a real connection. */
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

/** One process-local "instance": its own Redis connection, storage and pair of gateways. */
interface Instance {
  storage: RedisWsStorage;
  client: RedisClient;
  chat: ChatGateway;
  admin: AdminGateway;
  chatSocket: Recorded;
  adminSocket: Recorded;
}

describe('remote WebSocket events are fenced to the publishing gateway', () => {
  let redis: TestContainer;
  const instances: Instance[] = [];

  beforeAll(async () => {
    redis = await createRedisContainer();
  });

  afterAll(async () => {
    await redis.stop();
  });

  afterEach(async () => {
    for (const instance of instances.splice(0)) {
      await instance.storage.close().catch(() => undefined);
      await instance.client.disconnect().catch(() => undefined);
    }
  });

  async function makeInstance(name: string): Promise<Instance> {
    // Both instances share ONE key prefix on purpose: that is what makes them two instances of
    // the same application rather than two unrelated ones, and the pub/sub channel name is
    // prefixed too — a per-instance prefix would put them on different channels and the test
    // would measure nothing.
    const client = new RedisClient({ url: redis.url, keyPrefix: 'wi369:' });
    await client.connect();
    const storage = createRedisWsStorage(client) as RedisWsStorage;

    // Registered through a real WsHandler, so the gateways get their keys and their socket maps
    // exactly as they do in production — including the concurrent, un-awaited subscribe that
    // produced the N x N delivery.
    const handler = new WsHandler(createMockSyncLogger());
    const chat = new ChatGateway();
    const admin = new AdminGateway();
    handler.registerGateway(ChatGateway, chat);
    handler.registerGateway(AdminGateway, admin);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const server = { publish: () => 1 } as any;
    chat._initialize(storage, server);
    admin._initialize(storage, server);
    await (chat as unknown as { pubSubReady?: Promise<void> }).pubSubReady;
    await (admin as unknown as { pubSubReady?: Promise<void> }).pubSubReady;

    const chatSocket = recordingSocket(`${name}-chat`, '/chat');
    const adminSocket = recordingSocket(`${name}-admin`, '/admin:admin');
    chat._registerSocket(chatSocket.socket.data.id, chatSocket.socket);
    admin._registerSocket(adminSocket.socket.data.id, adminSocket.socket);

    const instance: Instance = {
      storage, client, chat, admin, chatSocket, adminSocket,
    };
    instances.push(instance);

    return instance;
  }

  const settle = async (): Promise<void> => await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  it('delivers a remote broadcast once, and only to the same gateway', async () => {
    const one = await makeInstance('one');
    const two = await makeInstance('two');

    one.chat.broadcast('chat:hello', { from: 'instance-one' });
    await settle();

    // The publisher's own client, locally — one copy, no Redis involved.
    expect(one.chatSocket.sent.filter((m) => m.includes('chat:hello'))).toHaveLength(1);

    // The same gateway on the other instance: exactly one copy. It used to be four —
    // 2 Redis-level listeners x 2 shared handlers, from the subscribe race.
    expect(two.chatSocket.sent.filter((m) => m.includes('chat:hello'))).toHaveLength(1);

    // And never the sibling gateway, on either instance. `sourceInstanceId` is per gateway, so
    // the publisher's own process delivered to its neighbour through Redis.
    expect(one.adminSocket.sent.filter((m) => m.includes('chat:hello'))).toHaveLength(0);
    expect(two.adminSocket.sent.filter((m) => m.includes('chat:hello'))).toHaveLength(0);
  }, 60_000);

  it('does not deliver a remote client message to another gateway\'s client', async () => {
    const one = await makeInstance('three');
    const two = await makeInstance('four');

    // Addressed at a client id that belongs to the ADMIN gateway on the other instance. The
    // in-memory path already refused this; Redis did not.
    one.chat.emit(two.adminSocket.socket.data.id, 'chat:direct', { secret: true });
    await settle();

    expect(two.adminSocket.sent.filter((m) => m.includes('chat:direct'))).toHaveLength(0);
  }, 60_000);
});
