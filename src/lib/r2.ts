import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

export const hasR2Config =
  Boolean(env.R2_ENDPOINT) &&
  Boolean(env.R2_BUCKET) &&
  Boolean(env.R2_ACCESS_KEY_ID) &&
  Boolean(env.R2_SECRET_ACCESS_KEY);

let r2ClientSingleton: S3Client | null | undefined;

export function getR2Client(): S3Client | null {
  if (r2ClientSingleton === undefined) {
    if (!hasR2Config || !env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
      r2ClientSingleton = null;
    } else {
      r2ClientSingleton = new S3Client({
        region: 'auto',
        endpoint: env.R2_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY
        },
        // Newer AWS SDK defaults break R2 signed GETs unless checksums are opt-in.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED'
      } as ConstructorParameters<typeof S3Client>[0]);
    }
  }
  return r2ClientSingleton;
}

export function buildPublicUrl(key: string): string {
  if (env.R2_PUBLIC_BASE_URL) {
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
  return `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${key}`;
}

/** Derive S3 object key from a URL returned by buildPublicUrl or R2_PUBLIC_BASE_URL. */
export function objectKeyFromStoredUrl(storedUrl: string): string | null {
  const bucket = env.R2_BUCKET;
  if (!bucket || !storedUrl) return null;
  try {
    const u = new URL(storedUrl);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length === 0) return null;
    if (segs[0] === bucket) {
      return segs.slice(1).join('/') || null;
    }
    return segs.join('/') || null;
  } catch {
    return null;
  }
}

function urlLooksLikeOurR2(storedUrl: string): boolean {
  if (!storedUrl) return false;
  try {
    const u = new URL(storedUrl);
    if (env.R2_ENDPOINT) {
      const ep = new URL(env.R2_ENDPOINT);
      if (u.hostname === ep.hostname) return true;
    }
    if (env.R2_PUBLIC_BASE_URL) {
      const pub = new URL(env.R2_PUBLIC_BASE_URL);
      if (u.hostname === pub.hostname) return true;
    }
    if (u.hostname.includes('r2.cloudflarestorage.com')) return true;
    return false;
  } catch {
    return false;
  }
}

/** Presigned GET so private R2 objects load in mobile Image/Video. */
export async function presignGetUrl(storedUrl: string, expiresIn = 3600): Promise<string> {
  if (!storedUrl) return storedUrl;
  if (!urlLooksLikeOurR2(storedUrl)) return storedUrl;
  const client = getR2Client();
  if (!client || !env.R2_BUCKET) return storedUrl;
  const key = objectKeyFromStoredUrl(storedUrl);
  if (!key) return storedUrl;
  try {
    const cmd = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key });
    return await getSignedUrl(client, cmd, { expiresIn });
  } catch (e) {
    console.warn('[R2] presignGetUrl failed, returning original URL', e);
    return storedUrl;
  }
}

/**
 * Accepts either:
 * - full URL (public/protected) OR
 * - raw object key (e.g. uploads/images/...)
 * and returns a usable URL for clients.
 */
export async function resolveStoredMediaUrl(stored: string): Promise<string> {
  if (!stored) return stored;
  const trimmed = stored.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    return presignGetUrl(trimmed);
  }
  // Stored as raw key; first build a bucket URL, then presign if needed.
  return presignGetUrl(buildPublicUrl(trimmed));
}

export async function presignMediaUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map((u) => presignGetUrl(u)));
}
