import { env } from '../../config/env';

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const DEFAULT_STUN: IceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
];

export async function getCloudflareIceServers(ttlSec = 3600): Promise<{
  iceServers: IceServer[];
  expiresAt: string;
  provider: 'cloudflare' | 'stun-only';
}> {
  const ttl = Math.max(60, Math.min(172_800, Math.floor(ttlSec)));
  const keyId = env.CLOUDFLARE_TURN_KEY_ID;
  const token = env.CLOUDFLARE_TURN_API_TOKEN;

  if (!keyId || !token) {
    return {
      iceServers: DEFAULT_STUN,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      provider: 'stun-only'
    };
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(8_000)
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.warn('[ice-servers] Cloudflare TURN failed', response.status, text.slice(0, 200));
    return {
      iceServers: DEFAULT_STUN,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      provider: 'stun-only'
    };
  }

  const body = (await response.json()) as {
    iceServers?: IceServer[];
  };

  const iceServers = Array.isArray(body.iceServers) && body.iceServers.length > 0
    ? body.iceServers
    : DEFAULT_STUN;

  return {
    iceServers,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    provider: 'cloudflare'
  };
}
