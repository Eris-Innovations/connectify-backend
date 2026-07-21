import { afterEach, describe, expect, it, vi } from 'vitest';

describe('getCloudflareIceServers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('falls back to STUN when Cloudflare credentials are missing', async () => {
    vi.resetModules();
    vi.doMock('../src/config/env', () => ({
      env: {
        CLOUDFLARE_TURN_KEY_ID: '',
        CLOUDFLARE_TURN_API_TOKEN: ''
      }
    }));
    const { getCloudflareIceServers } = await import('../src/modules/calls/ice-servers.service');
    const result = await getCloudflareIceServers(3600);
    expect(result.provider).toBe('stun-only');
    expect(result.iceServers.length).toBeGreaterThan(0);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('returns Cloudflare ICE servers when the API succeeds', async () => {
    vi.resetModules();
    vi.doMock('../src/config/env', () => ({
      env: {
        CLOUDFLARE_TURN_KEY_ID: 'key',
        CLOUDFLARE_TURN_API_TOKEN: 'token'
      }
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [
          { urls: 'turn:turn.cloudflare.com:3478?transport=udp', username: 'u', credential: 'p' }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getCloudflareIceServers } = await import('../src/modules/calls/ice-servers.service');
    const result = await getCloudflareIceServers(120);
    expect(result.provider).toBe('cloudflare');
    expect(result.iceServers[0]?.urls).toContain('turn:');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
