/**
 * Client room joins waiting on their `@OnJoinRoom` guards.
 *
 * Shared by the two places that change a client's rooms: `WsHandler`, which tracks a join while its
 * guards run, and `BaseWebSocketGateway`, whose server-side `leaveRoom()` has to cancel a join of
 * that room still waiting — or the join would land after the leave. Keyed by the socket, so two
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
