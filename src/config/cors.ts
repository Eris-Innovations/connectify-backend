import { env } from './env';

const allowedOrigins = new Set(
  (env.ALLOWED_CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

function isAllowedDevelopmentOrigin(origin: string): boolean {
  if (env.NODE_ENV !== 'development') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

/**
 * Allow native mobile / server-to-server requests with no Origin header.
 * Browser callers must be explicitly whitelisted in ALLOWED_CORS_ORIGINS.
 */
export function resolveCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (allowedOrigins.has(origin)) {
    callback(null, true);
    return;
  }

  if (isAllowedDevelopmentOrigin(origin)) {
    callback(null, true);
    return;
  }

  console.warn(`[cors] blocked origin: ${origin}`);
  callback(new Error(`CORS blocked for origin: ${origin}`));
}

export function getAllowedCorsOrigins(): string[] {
  return [...allowedOrigins];
}
