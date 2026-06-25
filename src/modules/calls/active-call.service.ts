import { redis } from '../../config/redis';

const keyFor = (userId: string) => `call:active:${userId}`;
const ACTIVE_CALL_TTL_SEC = 7200;

export type ActiveCallRecord = {
  callId: string;
  otherUserId: string;
};

type MemoryEntry = { record: ActiveCallRecord; expiresAt: number };

const memoryActiveByUser = new Map<string, MemoryEntry>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [userId, entry] of memoryActiveByUser) {
    if (entry.expiresAt <= now) memoryActiveByUser.delete(userId);
  }
}

function storeMemory(userId: string, record: ActiveCallRecord): void {
  pruneMemory();
  memoryActiveByUser.set(userId, {
    record,
    expiresAt: Date.now() + ACTIVE_CALL_TTL_SEC * 1000,
  });
}

export async function setActiveCall(
  userId: string,
  callId: string,
  otherUserId: string
): Promise<void> {
  const record: ActiveCallRecord = { callId, otherUserId };
  storeMemory(userId, record);
  try {
    await redis.set(keyFor(userId), JSON.stringify(record), 'EX', ACTIVE_CALL_TTL_SEC);
  } catch {
    console.warn('[active-call] Redis unavailable; using in-memory store for', userId);
  }
}

export async function getActiveCall(userId: string): Promise<ActiveCallRecord | null> {
  try {
    const raw = await redis.get(keyFor(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as ActiveCallRecord;
      if (parsed?.callId && parsed?.otherUserId) {
        storeMemory(userId, parsed);
        return parsed;
      }
    }
  } catch {
    /* fall through */
  }
  pruneMemory();
  return memoryActiveByUser.get(userId)?.record ?? null;
}

export async function clearActiveCall(userId: string): Promise<ActiveCallRecord | null> {
  let parsed: ActiveCallRecord | null = null;
  try {
    const raw = await redis.get(keyFor(userId));
    await redis.del(keyFor(userId));
    if (raw) parsed = JSON.parse(raw) as ActiveCallRecord;
  } catch {
    /* ignore */
  }
  pruneMemory();
  const mem = memoryActiveByUser.get(userId)?.record ?? null;
  memoryActiveByUser.delete(userId);
  return parsed ?? mem;
}

export async function clearActiveCallPair(userId: string, otherUserId: string): Promise<void> {
  await clearActiveCall(userId);
  await clearActiveCall(otherUserId);
}
