import Redis from 'ioredis';
import { env } from './env';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: () => null
});

let hasLoggedRedisError = false;
redis.on('error', () => {
  if (hasLoggedRedisError) return;
  hasLoggedRedisError = true;
  console.warn('Redis unavailable. Continuing without cache/pubsub in dev mode.');
});

