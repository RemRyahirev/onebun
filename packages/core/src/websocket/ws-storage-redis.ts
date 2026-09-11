/**
 * Redis WebSocket Storage
 *
 * Redis-based implementation of WsStorageAdapter with pub/sub support
 * for multi-instance deployments.
 */

import type { WsPubSubStorageAdapter, WsStorageEventPayload } from './ws-storage';
import type { WsClientData, WsRoom } from './ws.types';
import type { RedisClient } from '../redis/redis-client';

import { isPatternMatch } from './ws-pattern-matcher';


/**
 * Redis key prefixes for WebSocket data
 */
const KEYS = {
  CLIENTS: 'ws:clients:',
  ROOMS: 'ws:rooms:',
  ROOM_MEMBERS: 'ws:room:members:',
  CLIENT_ROOMS: 'ws:client:rooms:',
  PUBSUB_CHANNEL: 'ws:events',
  /** `ws:instance:alive:<id>` — present only while that instance is running. */
  INSTANCE_ALIVE: 'ws:instance:alive:',
  /** `ws:instance:clients:<id>` — the clients that instance admitted. */
  INSTANCE_CLIENTS: 'ws:instance:clients:',
};

/**
 * How long an instance's liveness key survives without a refresh.
 *
 * Per INSTANCE rather than per client, deliberately. A TTL on the client keys would need a
 * per-connection heartbeat to refresh it, and there is none for native connections —
 * `startPingInterval` runs only for Socket.IO. Measured, a naive per-client TTL evicted a live
 * native client one second into its session and left its room membership behind.
 */
const INSTANCE_TTL_MS = 30_000;

/** Refreshed three times inside the TTL, so one missed tick is not a death sentence. */
const INSTANCE_REFRESH_MS = 10_000;

/**
 * Join and leave, each as ONE indivisible step.
 *
 * Lua, run by Redis. Both used to be several round trips — the join checked whether the room
 * record existed and then added the member; the leave removed the member, counted what was left
 * and then deleted. Every gap between those was a window, and the windows are not symmetrical:
 * a leave that counted zero and deleted took with it a join that landed in between, and a join
 * that had already seen the room record skipped creating it and left a member set with no room.
 * Measured, a join three round trips into a leave lost its membership entirely.
 *
 * Written as one script each, any interleaving leaves the same two outcomes: the room exists and
 * has members, or it is gone completely.
 *
 * KEYS[1] room member set · KEYS[2] the client's room set · KEYS[3] the room record.
 * ARGV[1] client id · ARGV[2] room name · ARGV[3] the room record to create, on join.
 */
/**
 * How many per-item round trips a bulk read has in flight at once.
 *
 * `Promise.all` over every key is one command per room or client with no ceiling: 500 is nothing
 * (and Bun's client pipelines them into four socket reads), 50,000 would queue 100,000 commands
 * in the driver at once.
 */
const BULK_CONCURRENCY = 200;

/** How many keys one `UNLINK` carries. */
const UNLINK_BATCH = 500;

/** Run `work` over `items` with at most `size` in flight. */
async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];

  for (let at = 0; at < items.length; at += size) {
    results.push(...await Promise.all(items.slice(at, at + size).map(work)));
  }

  return results;
}

/** A key with its family prefix removed, e.g. `ws:clients:abc` -> `abc`. */
function withoutFamily(key: string, family: string): string {
  return key.startsWith(family) ? key.slice(family.length) : key;
}

const JOIN_ROOM = `
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[2], ARGV[2])
if redis.call('EXISTS', KEYS[3]) == 0 then
  redis.call('SET', KEYS[3], ARGV[3])
end
return 1
`;

const LEAVE_ROOM = `
redis.call('SREM', KEYS[1], ARGV[1])
redis.call('SREM', KEYS[2], ARGV[2])
if redis.call('SCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[3])
  return 1
end
return 0
`;

/**
 * Redis-based storage for WebSocket clients and rooms
 * with pub/sub support for multi-instance deployments
 */
export class RedisWsStorage implements WsPubSubStorageAdapter {
  private eventHandlers: Array<(payload: WsStorageEventPayload) => void> = [];
  private subscribed = false;
  /** The in-flight or completed channel subscription, so concurrent callers share one. */
  private subscription?: Promise<void>;

  /**
   * This instance's identity in the shared keyspace.
   *
   * A fresh random id per adapter, NOT the hostname. Seeding it from `HOSTNAME`/`POD_NAME` would
   * let two processes that share a hostname — bare-metal multi-process, `hostNetwork: true`,
   * `docker --net=host` — share an ownership index, and one's teardown would then reap the
   * other's live clients. That trades a leak for data loss. The only thing a stable id would buy
   * is a restarting pod recognising its own keys, and the sweep does that job anyway.
   */
  readonly instanceId: string = crypto.randomUUID();

  /** Refreshes the liveness key. Armed on the first client, cleared by `close()`. */
  private refreshTimer?: ReturnType<typeof setInterval>;

  /** The one sweep this instance performs, so concurrent first writes share it. */
  private sweep?: Promise<void>;

  constructor(private redisClient: RedisClient) {}

  /**
   * Say this instance is alive, arm the refresh, and reap whoever is not.
   *
   * Called on the first client rather than from the constructor: an adapter built only to read
   * or to clear never arms a timer, and the liveness key means "this instance has connections"
   * rather than "this object exists".
   */
  private async announce(): Promise<void> {
    if (this.refreshTimer) {
      return;
    }

    await this.redisClient.set(
      KEYS.INSTANCE_ALIVE + this.instanceId,
      String(Date.now()),
      INSTANCE_TTL_MS,
    );

    this.refreshTimer = setInterval(() => {
      void this.redisClient
        .set(KEYS.INSTANCE_ALIVE + this.instanceId, String(Date.now()), INSTANCE_TTL_MS)
        .catch(() => undefined);
    }, INSTANCE_REFRESH_MS);
    this.refreshTimer.unref?.();

    // Once, and awaited: an instance that is about to serve its first connection should not
    // report someone else's dead sockets as present. With no dead instance it is one `SCAN`.
    this.sweep ??= this.reapDeadInstances().catch(() => undefined);
    await this.sweep;
  }

  /**
   * Remove the clients of every instance whose liveness key is gone.
   *
   * Through `removeClient`, which already leaves every room and drops a room that empties — so
   * there is no TTL on room keys to get wrong, and no second cleanup path to keep in step.
   */
  private async reapDeadInstances(): Promise<void> {
    const indexes = await this.redisClient.scan(KEYS.INSTANCE_CLIENTS + '*');

    for (const key of indexes) {
      const instanceId = withoutFamily(key, KEYS.INSTANCE_CLIENTS);
      if (instanceId === this.instanceId) {
        continue;
      }

      if (await this.redisClient.exists(KEYS.INSTANCE_ALIVE + instanceId)) {
        continue;
      }

      for (const clientId of await this.redisClient.smembers(key)) {
        await this.removeClient(clientId);
      }

      await this.redisClient.del(key);
    }
  }

  // ============================================================================
  // Client Operations
  // ============================================================================

  async addClient(client: WsClientData): Promise<void> {
    // Before the client is recorded, so nothing can be in the ownership index while this
    // instance looks dead to a concurrent sweep.
    await this.announce();
    await this.redisClient.sadd(KEYS.INSTANCE_CLIENTS + this.instanceId, client.id);

    // `rooms` is deliberately NOT stored in the blob. Membership lives in the set below, and a
    // second copy here is a mirror that drifts: every update to it was read-modify-write, so
    // three joins in one tick left this array holding one of them.
    const key = KEYS.CLIENTS + client.id;
    await this.redisClient.set(key, JSON.stringify({ ...client, rooms: [] }));

    if (client.rooms.length > 0) {
      await this.redisClient.sadd(KEYS.CLIENT_ROOMS + client.id, ...client.rooms);
    }
  }

  async removeClient(clientId: string): Promise<void> {
    // Remove from all rooms first
    await this.removeClientFromAllRooms(clientId);

    // Remove client data
    await this.redisClient.del(KEYS.CLIENTS + clientId);
    await this.redisClient.srem(KEYS.INSTANCE_CLIENTS + this.instanceId, clientId);
  }

  async getClient(clientId: string): Promise<WsClientData | null> {
    const data = await this.redisClient.get(KEYS.CLIENTS + clientId);
    if (!data) {
      return null;
    }

    let client: WsClientData;
    try {
      client = JSON.parse(data) as WsClientData;
    } catch {
      return null;
    }

    // The extra round trip buys the thing that matters: `client.rooms` is what `WsRoomGuard`
    // reads, and it used to be a mirror of the set rather than the set. `deleteRoom` cleaned the
    // set only, so a deleted room kept granting access through this field.
    client.rooms = await this.redisClient.smembers(KEYS.CLIENT_ROOMS + clientId);

    return client;
  }

  async getAllClients(): Promise<WsClientData[]> {
    // `scan` rather than `keys`, and batched rather than one round trip per client in sequence.
    // See `RedisClient.scan` for why `KEYS` is the wrong command on a shared Redis.
    const keys = await this.redisClient.scan(KEYS.CLIENTS + '*');
    const clients = await inBatches(
      keys,
      BULK_CONCURRENCY,
      async (key) => await this.getClient(withoutFamily(key, KEYS.CLIENTS)),
    );

    return clients.filter((client): client is WsClientData => client !== null);
  }

  async updateClient(clientId: string, data: Partial<WsClientData>): Promise<void> {
    const client = await this.getClient(clientId);
    if (!client) {
      return;
    }

    const updated = { ...client, ...data };
    await this.redisClient.set(KEYS.CLIENTS + clientId, JSON.stringify({ ...updated, rooms: [] }));

    // An update that names `rooms` is asking to REPLACE membership, so it goes to the set the
    // rest of the adapter reads rather than into the blob, where nothing would ever see it.
    if (data.rooms) {
      await this.redisClient.del(KEYS.CLIENT_ROOMS + clientId);
      if (data.rooms.length > 0) {
        await this.redisClient.sadd(KEYS.CLIENT_ROOMS + clientId, ...data.rooms);
      }
    }
  }

  async getClientCount(): Promise<number> {
    return (await this.redisClient.scan(KEYS.CLIENTS + '*')).length;
  }

  // ============================================================================
  // Room Operations
  // ============================================================================

  async createRoom(room: WsRoom): Promise<void> {
    const key = KEYS.ROOMS + room.name;
    await this.redisClient.set(key, JSON.stringify(room));

    // Also store members in a set for efficient queries
    if (room.clientIds.length > 0) {
      await this.redisClient.sadd(KEYS.ROOM_MEMBERS + room.name, ...room.clientIds);
    }
  }

  async deleteRoom(name: string): Promise<void> {
    const room = await this.getRoom(name);
    if (!room) {
      return;
    }

    // Remove room from all clients' room lists
    for (const clientId of room.clientIds) {
      await this.redisClient.srem(KEYS.CLIENT_ROOMS + clientId, name);
    }

    // Delete room data and members set
    await this.redisClient.del(KEYS.ROOMS + name);
    await this.redisClient.del(KEYS.ROOM_MEMBERS + name);
  }

  async getRoom(name: string): Promise<WsRoom | null> {
    const data = await this.redisClient.get(KEYS.ROOMS + name);
    if (!data) {
      return null;
    }

    try {
      const room = JSON.parse(data) as WsRoom;
      // Get current members from set
      room.clientIds = await this.redisClient.smembers(KEYS.ROOM_MEMBERS + name);

      return room;
    } catch {
      return null;
    }
  }

  async getAllRooms(): Promise<WsRoom[]> {
    const keys = await this.redisClient.scan(KEYS.ROOMS + '*');

    return await this.roomsByName(keys.map((key) => withoutFamily(key, KEYS.ROOMS)));
  }

  async getRoomsByPattern(pattern: string): Promise<WsRoom[]> {
    // Filtered by NAME before anything is fetched. Loading every room to discard most of them
    // cost one `GET` and one `SMEMBERS` per room in the database, on a path `emitToRoomPattern`
    // reaches per broadcast.
    const keys = await this.redisClient.scan(KEYS.ROOMS + '*');
    const names = keys
      .map((key) => withoutFamily(key, KEYS.ROOMS))
      .filter((name) => isPatternMatch(pattern, name));

    return await this.roomsByName(names);
  }

  /** Load named rooms, a bounded number of round trips at a time. */
  private async roomsByName(names: string[]): Promise<WsRoom[]> {
    const rooms = await inBatches(names, BULK_CONCURRENCY, async (name) => await this.getRoom(name));

    return rooms.filter((room): room is WsRoom => room !== null);
  }

  async updateRoomMetadata(name: string, metadata: Record<string, unknown>): Promise<void> {
    const room = await this.getRoom(name);
    if (room) {
      room.metadata = { ...room.metadata, ...metadata };
      await this.redisClient.set(KEYS.ROOMS + name, JSON.stringify(room));
    }
  }

  // ============================================================================
  // Room Membership Operations
  // ============================================================================

  async addClientToRoom(clientId: string, roomName: string): Promise<void> {
    // The member set is the only place membership is recorded. It used to be mirrored into the
    // client blob as well, by a read-modify-write that lost concurrent joins.
    await this.redisClient.runScript(
      JOIN_ROOM,
      [KEYS.ROOM_MEMBERS + roomName, KEYS.CLIENT_ROOMS + clientId, KEYS.ROOMS + roomName],
      [clientId, roomName, JSON.stringify({ name: roomName, clientIds: [] })],
    );
  }

  async removeClientFromRoom(clientId: string, roomName: string): Promise<void> {
    // Removal and empty-room teardown together, so nothing can land between the count and the
    // deletes. There is no blob copy of membership to keep in step any more either.
    await this.redisClient.runScript(
      LEAVE_ROOM,
      [KEYS.ROOM_MEMBERS + roomName, KEYS.CLIENT_ROOMS + clientId, KEYS.ROOMS + roomName],
      [clientId, roomName],
    );
  }

  async getClientsInRoom(roomName: string): Promise<string[]> {
    return await this.redisClient.smembers(KEYS.ROOM_MEMBERS + roomName);
  }

  async getRoomsForClient(clientId: string): Promise<string[]> {
    return await this.redisClient.smembers(KEYS.CLIENT_ROOMS + clientId);
  }

  async removeClientFromAllRooms(clientId: string): Promise<void> {
    const rooms = await this.getRoomsForClient(clientId);

    for (const roomName of rooms) {
      await this.removeClientFromRoom(clientId, roomName);
    }
  }

  // ============================================================================
  // Pub/Sub Operations
  // ============================================================================

  async subscribe(handler: (payload: WsStorageEventPayload) => void): Promise<() => void> {
    this.eventHandlers.push(handler);

    // Memoised, not a boolean set after the await. The flag was raised AFTER
    // `redisClient.subscribe` resolved, and gateways subscribe concurrently — every gateway
    // raced past the guard, each installing its own Redis-level listener that then iterated
    // the SHARED handler list. N gateways therefore delivered every message N x N times:
    // measured, 2 gateways gave 4 copies of one broadcast to every client, 3 would give 9.
    this.subscription ??= this.redisClient.subscribe(KEYS.PUBSUB_CHANNEL, (message: string) => {
      try {
        const payload = JSON.parse(message) as WsStorageEventPayload;
        for (const h of this.eventHandlers) {
          try {
            h(payload);
          } catch {
            // Ignore handler errors
          }
        }
      } catch {
        // Ignore invalid messages
      }
    }).then(() => {
      this.subscribed = true;
    });

    await this.subscription;

    // Removes this handler alone. `unsubscribe()` drops them all, and the adapter is shared by
    // every gateway in the application, so using it to detach one silences the rest.
    return (): void => {
      const at = this.eventHandlers.indexOf(handler);
      if (at !== -1) {
        this.eventHandlers.splice(at, 1);
      }
    };
  }

  async publish(payload: WsStorageEventPayload): Promise<void> {
    await this.redisClient.publish(KEYS.PUBSUB_CHANNEL, JSON.stringify(payload));
  }

  async unsubscribe(): Promise<void> {
    this.eventHandlers = [];
    this.subscription = undefined;
    if (this.subscribed) {
      await this.redisClient.unsubscribe(KEYS.PUBSUB_CHANNEL);
      this.subscribed = false;
    }
  }

  // ============================================================================
  // Lifecycle Operations
  // ============================================================================

  async clear(): Promise<void> {
    const families = await Promise.all([
      this.redisClient.scan(KEYS.CLIENTS + '*'),
      this.redisClient.scan(KEYS.ROOMS + '*'),
      this.redisClient.scan(KEYS.ROOM_MEMBERS + '*'),
      this.redisClient.scan(KEYS.CLIENT_ROOMS + '*'),
      this.redisClient.scan(KEYS.INSTANCE_ALIVE + '*'),
      this.redisClient.scan(KEYS.INSTANCE_CLIENTS + '*'),
    ]);

    // Batched, where this was one `DEL` round trip per key: 500 keys took 26.81 ms as a loop and
    // 0.57 ms as one `UNLINK`.
    const keys = families.flat();
    for (let at = 0; at < keys.length; at += UNLINK_BATCH) {
      await this.redisClient.unlink(...keys.slice(at, at + UNLINK_BATCH));
    }

    // `clear()` means everything, this instance's liveness key included — and a running
    // instance that looks dead gets its next connections reaped by a sibling. Put it back.
    if (this.refreshTimer) {
      await this.redisClient.set(
        KEYS.INSTANCE_ALIVE + this.instanceId,
        String(Date.now()),
        INSTANCE_TTL_MS,
      );
    }
  }

  async close(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    await this.unsubscribe();

    // Drop the liveness key; deliberately keep the ownership index. Anything the shutdown path
    // failed to remove has to stay reapable, or a close that ran half-way leaks exactly as a
    // crash used to. An index that empties is deleted by Redis on the last `SREM`.
    await this.redisClient.del(KEYS.INSTANCE_ALIVE + this.instanceId);

    // Note: We don't disconnect the Redis client here
    // because it might be shared with other consumers
  }
}

/**
 * Create Redis WebSocket storage with a Redis client
 */
export function createRedisWsStorage(redisClient: RedisClient): WsPubSubStorageAdapter {
  return new RedisWsStorage(redisClient);
}
