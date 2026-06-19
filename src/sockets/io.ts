import type { Server } from 'socket.io';

let socketIo: Server | null = null;

export function setSocketIo(io: Server): void {
  socketIo = io;
}

export function getSocketIo(): Server | null {
  return socketIo;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  socketIo?.to(`user:${userId}`).emit(event, payload);
}
