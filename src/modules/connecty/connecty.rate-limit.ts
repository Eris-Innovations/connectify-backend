import { redis } from '../../config/redis';

/** In-process fallback when Redis is unavailable. */
const localHits = new Map<string, number[]>();

async function redisIncrWindow(key: string, windowMs: number): Promise<number | null> {
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      try {
        await redis.connect();
      } catch {
        return null;
      }
    }
    const now = Date.now();
    const bucket = `connecty:rl:${key}`;
    const multi = redis.multi();
    multi.zremrangebyscore(bucket, 0, now - windowMs);
    multi.zadd(bucket, now, `${now}-${Math.random()}`);
    multi.zcard(bucket);
    multi.pexpire(bucket, windowMs + 1000);
    const results = await multi.exec();
    if (!results) return null;
    const card = results[2]?.[1];
    return typeof card === 'number' ? card : Number(card);
  } catch {
    return null;
  }
}

export async function checkConnectyRateLimit(
  userId: string,
  opts?: { max?: number; windowMs?: number }
): Promise<{ ok: true; count?: number } | { ok: false; retryAfterSec: number }> {
  const max = opts?.max ?? 20;
  const windowMs = opts?.windowMs ?? 60_000;
  const now = Date.now();

  const redisCount = await redisIncrWindow(userId, windowMs);
  if (typeof redisCount === 'number' && Number.isFinite(redisCount)) {
    if (redisCount > max) {
      return { ok: false, retryAfterSec: Math.ceil(windowMs / 1000) };
    }
    return { ok: true, count: redisCount };
  }

  const arr = (localHits.get(userId) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    const oldest = arr[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    localHits.set(userId, arr);
    return { ok: false, retryAfterSec };
  }
  arr.push(now);
  localHits.set(userId, arr);
  return { ok: true, count: arr.length };
}

/** Soft daily cap (default 200 free-tier friend messages / day / user). */
export async function checkConnectyDailyCap(
  userId: string,
  opts?: { max?: number }
): Promise<{ ok: true; remaining: number } | { ok: false; remaining: 0 }> {
  const max = opts?.max ?? 200;
  const day = new Date().toISOString().slice(0, 10);
  const key = `connecty:daily:${userId}:${day}`;
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      try {
        await redis.connect();
      } catch {
        return { ok: true, remaining: max };
      }
    }
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 86_400);
    if (n > max) return { ok: false, remaining: 0 };
    return { ok: true, remaining: Math.max(0, max - n) };
  } catch {
    return { ok: true, remaining: max };
  }
}

export function _resetConnectyRateLimits() {
  localHits.clear();
}
