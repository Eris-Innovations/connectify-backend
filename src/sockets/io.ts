import type { Server } from 'socket.io';

let socketIo: Server | null = null;

/** Last reported foreground state per user (`true` = app active, `false` = background). */
const userAppForeground = new Map<string, boolean>();

export function setSocketIo(io: Server): void {
  socketIo = io;
}

export function getSocketIo(): Server | null {
  return socketIo;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  socketIo?.to(`user:${userId}`).emit(event, payload);
}

export function isUserConnected(userId: string): boolean {
  const room = socketIo?.sockets.adapter.rooms.get(`user:${userId}`);
  return Boolean(room && room.size > 0);
}

export function setUserAppForeground(userId: string, foreground: boolean): void {
  userAppForeground.set(userId, foreground);
}

export function clearUserAppForeground(userId: string): void {
  userAppForeground.delete(userId);
}

/** User has socket open and last reported app state is foreground (default true on connect). */
export function isUserActivelyInApp(userId: string): boolean {
  if (!isUserConnected(userId)) return false;
  return userAppForeground.get(userId) !== false;
}

/** Send OS push when offline, backgrounded, or app killed — not when actively in foreground. */
export function shouldDeliverPushToUser(userId: string): boolean {
  return !isUserActivelyInApp(userId);
}
