import { redis } from '../../config/redis';

const keyFor = (userId: string) => `call:active:${userId}`;
const ACTIVE_CALL_TTL_SEC = 7200;

export type ActiveCallRecord = {
  callId: string;
  otherUserId: string;
};

export async function setActiveCall(
  userId: string,
  callId: string,
  otherUserId: string
): Promise<void> {
  const record: ActiveCallRecord = { callId, otherUserId };
  try {
    await redis.set(keyFor(userId), JSON.stringify(record), 'EX', ACTIVE_CALL_TTL_SEC);
  } catch {
    /* ignore */
  }
}

export async function getActiveCall(userId: string): Promise<ActiveCallRecord | null> {
  try {
    const raw = await redis.get(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveCallRecord;
    if (!parsed?.callId || !parsed?.otherUserId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearActiveCall(userId: string): Promise<ActiveCallRecord | null> {
  try {
    const raw = await redis.get(keyFor(userId));
    await redis.del(keyFor(userId));
    if (!raw) return null;
    return JSON.parse(raw) as ActiveCallRecord;
  } catch {
    return null;
  }
}

export async function clearActiveCallPair(userId: string, otherUserId: string): Promise<void> {
  await clearActiveCall(userId);
  await clearActiveCall(otherUserId);
}
