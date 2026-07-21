import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { env } from '../../config/env';

export function isLiveKitConfigured(): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

export function liveKitRoomName(callId: string): string {
  return `call:${callId}`;
}

function requireLiveKit() {
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new Error('LiveKit is not configured');
  }
  return {
    url: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  };
}

/** Ensure a 1:1 room exists (max 2 participants). Safe to call repeatedly. */
export async function ensureLiveKitRoom(callId: string): Promise<void> {
  const { url, apiKey, apiSecret } = requireLiveKit();
  const httpUrl = url.replace(/^ws/i, 'http');
  const rooms = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const name = liveKitRoomName(callId);
  try {
    await rooms.createRoom({
      name,
      maxParticipants: 2,
      emptyTimeout: 60,
      departureTimeout: 20,
    });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    // Room already exists is fine.
    if (!/already exists|conflict/i.test(message)) {
      throw error;
    }
  }
}

export async function mintLiveKitToken(input: {
  callId: string;
  identity: string;
  displayName?: string;
  ttlSeconds?: number;
}): Promise<{ url: string; token: string; roomName: string }> {
  const { url, apiKey, apiSecret } = requireLiveKit();
  const roomName = liveKitRoomName(input.callId);
  await ensureLiveKitRoom(input.callId);

  const at = new AccessToken(apiKey, apiSecret, {
    identity: input.identity,
    name: input.displayName || input.identity,
    ttl: `${input.ttlSeconds ?? 600}s`,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return { url, token, roomName };
}
