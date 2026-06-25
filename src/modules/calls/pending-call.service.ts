import { randomUUID } from 'crypto';
import { redis } from '../../config/redis';

export const PENDING_CALL_TTL_SEC = 90;
const keyFor = (receiverId: string) => `call:pending:${receiverId}`;
const callerKeyFor = (callerId: string) => `call:pending-by-caller:${callerId}`;

export type PendingCallRecord = {
  callId: string;
  callerId: string;
  callerName: string;
  isVideo: boolean;
  offer: unknown;
  createdAt: string;
};

type MemoryEntry = { record: PendingCallRecord; expiresAt: number };

const memoryPendingByReceiver = new Map<string, MemoryEntry>();
const memoryReceiverByCaller = new Map<string, { receiverId: string; expiresAt: number }>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memoryPendingByReceiver) {
    if (entry.expiresAt <= now) memoryPendingByReceiver.delete(key);
  }
  for (const [callerId, entry] of memoryReceiverByCaller) {
    if (entry.expiresAt <= now) memoryReceiverByCaller.delete(callerId);
  }
}

function storeMemory(receiverId: string, record: PendingCallRecord): void {
  pruneMemory();
  const expiresAt = Date.now() + PENDING_CALL_TTL_SEC * 1000;
  memoryPendingByReceiver.set(receiverId, { record, expiresAt });
  memoryReceiverByCaller.set(record.callerId, { receiverId, expiresAt });
}

function clearMemory(receiverId: string): PendingCallRecord | null {
  pruneMemory();
  const entry = memoryPendingByReceiver.get(receiverId);
  memoryPendingByReceiver.delete(receiverId);
  if (entry?.record.callerId) memoryReceiverByCaller.delete(entry.record.callerId);
  return entry?.record ?? null;
}

function clearMemoryByCaller(callerId: string): { record: PendingCallRecord; receiverId: string } | null {
  pruneMemory();
  const link = memoryReceiverByCaller.get(callerId);
  memoryReceiverByCaller.delete(callerId);
  if (!link) return null;
  const entry = memoryPendingByReceiver.get(link.receiverId);
  memoryPendingByReceiver.delete(link.receiverId);
  if (!entry || entry.record.callerId !== callerId) return null;
  return { record: entry.record, receiverId: link.receiverId };
}

export async function storePendingCall(
  receiverId: string,
  input: Omit<PendingCallRecord, 'callId' | 'createdAt'> & { callId?: string }
): Promise<{ record: PendingCallRecord; stored: boolean }> {
  const record: PendingCallRecord = {
    callId: input.callId ?? randomUUID(),
    callerId: input.callerId,
    callerName: input.callerName,
    isVideo: input.isVideo,
    offer: input.offer,
    createdAt: new Date().toISOString(),
  };
  try {
    await redis
      .multi()
      .set(keyFor(receiverId), JSON.stringify(record), 'EX', PENDING_CALL_TTL_SEC)
      .set(callerKeyFor(input.callerId), receiverId, 'EX', PENDING_CALL_TTL_SEC)
      .exec();
    storeMemory(receiverId, record);
    return { record, stored: true };
  } catch {
    storeMemory(receiverId, record);
    console.warn('[pending-call] Redis unavailable; using in-memory store for', receiverId);
    return { record, stored: true };
  }
}

export async function getPendingCall(receiverId: string): Promise<PendingCallRecord | null> {
  try {
    const raw = await redis.get(keyFor(receiverId));
    if (raw) {
      const parsed = JSON.parse(raw) as PendingCallRecord;
      if (parsed?.callId && parsed?.callerId) {
        storeMemory(receiverId, parsed);
        return parsed;
      }
    }
  } catch {
    /* fall through to memory */
  }
  pruneMemory();
  return memoryPendingByReceiver.get(receiverId)?.record ?? null;
}

export async function clearPendingCall(receiverId: string): Promise<PendingCallRecord | null> {
  let parsed: PendingCallRecord | null = null;
  try {
    const raw = await redis.get(keyFor(receiverId));
    await redis.del(keyFor(receiverId));
    if (raw) {
      parsed = JSON.parse(raw) as PendingCallRecord;
      if (parsed?.callerId) await redis.del(callerKeyFor(parsed.callerId));
    }
  } catch {
    /* ignore */
  }
  const mem = clearMemory(receiverId);
  return parsed ?? mem;
}

/** Clears pending call when the caller disconnects or cancels before answer. */
export async function clearPendingCallByCaller(
  callerId: string
): Promise<{ record: PendingCallRecord; receiverId: string } | null> {
  try {
    const receiverId = await redis.get(callerKeyFor(callerId));
    await redis.del(callerKeyFor(callerId));
    if (receiverId) {
      const raw = await redis.get(keyFor(receiverId));
      await redis.del(keyFor(receiverId));
      if (raw) {
        const parsed = JSON.parse(raw) as PendingCallRecord;
        if (parsed?.callerId === callerId) {
          clearMemory(receiverId);
          return { record: parsed, receiverId };
        }
      }
    }
  } catch {
    /* ignore */
  }
  return clearMemoryByCaller(callerId);
}
