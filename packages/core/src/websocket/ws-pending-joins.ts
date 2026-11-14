/**
 * Client room joins waiting on their `@OnJoinRoom` guards, and a Socket.IO move's removal of a
 * connection's stored rooms that a join has to wait for.
 *
 * Shared by the two places that change a client's rooms: `WsHandler`, which tracks a join while its
 * guards run and makes the move, and `BaseWebSocketGateway`, whose server-side `leaveRoom()` has to
 * cancel a join of that room still waiting — or the join would land after the leave — and whose
 * server-side `joinRoom()` has to wait for a move's removal. Keyed by the socket, so two
 * applications in one process never see each other's joins.
 *
 * @internal
 */

/** Why a pending join was cancelled: a leave of the same room, or a Socket.IO move to another gateway. */
export type RoomJoinCancellation = 'left' | 'moved';

/** A client join from the moment its guards are asked until its room change is made or dropped. */
export interface PendingRoomJoin {
  readonly room: string;
  /** Set once the join was cancelled. It has been answered then, and must neither join nor answer again. */
  cancelled?: RoomJoinCancellation;
}

interface TrackedRoomJoin extends PendingRoomJoin {
  readonly answer: (reason: RoomJoinCancellation) => void;
}

const pendingBySocket = new WeakMap<object, Set<TrackedRoomJoin>>();

/**
 * Track a join of `room` on `socket` until `untrackRoomJoin`. `answer` replies to the client if the
 * join is cancelled meanwhile — at the moment it is cancelled, not when its guards settle.
 */
export function trackRoomJoin(
  socket: object,
  room: string,
  answer: (reason: RoomJoinCancellation) => void,
): PendingRoomJoin {
  let joins = pendingBySocket.get(socket);
  if (!joins) {
    joins = new Set();
    pendingBySocket.set(socket, joins);
  }

  const join: TrackedRoomJoin = { room, answer };
  joins.add(join);

  return join;
}

/** Stop tracking a join that has made its room change or given up. */
export function untrackRoomJoin(socket: object, join: PendingRoomJoin): void {
  pendingBySocket.get(socket)?.delete(join as TrackedRoomJoin);
}

/**
 * Cancel the socket's pending joins — of `room`, or every one when no room is named. Each is marked,
 * dropped from tracking and answered at once; whatever its guards say later is ignored.
 */
export function cancelRoomJoins(socket: object, reason: RoomJoinCancellation, room?: string): void {
  const joins = pendingBySocket.get(socket);
  if (!joins) {
    return;
  }

  for (const join of [...joins]) {
    if (room === undefined || join.room === room) {
      joins.delete(join);
      join.cancelled = reason;
      join.answer(reason);
    }
  }
}

const clearingBySocket = new WeakMap<object, Promise<void>>();

/**
 * Record that a Socket.IO move is removing `socket`'s stored rooms until `clearing` settles.
 *
 * The removal reads the rooms the storage records at the move and removes them once that read has
 * answered. A join of one of those rooms written in between — by the client or by the server — is
 * removed with them, so every join of a socket waits for {@link roomsClearing} first.
 */
export function trackRoomsClearing(socket: object, clearing: Promise<unknown>): void {
  const settled = clearing.then(() => undefined, () => undefined);
  clearingBySocket.set(socket, settled);
  void settled.then(() => {
    if (clearingBySocket.get(socket) === settled) {
      clearingBySocket.delete(socket);
    }
  });
}

/** The removal a Socket.IO move is still making of `socket`'s stored rooms, if any. Never rejects. */
export function roomsClearing(socket: object): Promise<void> | undefined {
  return clearingBySocket.get(socket);
}
