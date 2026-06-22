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
    return { record, stored: true };
  } catch {
    return { record, stored: false };
  }
}

export async function getPendingCall(receiverId: string): Promise<PendingCallRecord | null> {
  try {
    const raw = await redis.get(keyFor(receiverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCallRecord;
    if (!parsed?.callId || !parsed?.callerId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingCall(receiverId: string): Promise<PendingCallRecord | null> {
  try {
    const raw = await redis.get(keyFor(receiverId));
    await redis.del(keyFor(receiverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCallRecord;
    if (parsed?.callerId) {
      await redis.del(callerKeyFor(parsed.callerId));
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Clears pending call when the caller disconnects or cancels before answer. */
export async function clearPendingCallByCaller(
  callerId: string
): Promise<{ record: PendingCallRecord; receiverId: string } | null> {
  try {
    const receiverId = await redis.get(callerKeyFor(callerId));
    await redis.del(callerKeyFor(callerId));
    if (!receiverId) return null;
    const raw = await redis.get(keyFor(receiverId));
    await redis.del(keyFor(receiverId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCallRecord;
    if (parsed?.callerId !== callerId) return null;
    return { record: parsed, receiverId };
  } catch {
    return null;
  }
}
