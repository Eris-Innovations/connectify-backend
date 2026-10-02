import apn from 'apn';
import { env } from '../config/env';
import { DevicePushTokenModel } from '../modules/users/device-push-token.model';

let provider: apn.Provider | null = null;

function getApnsProvider(): apn.Provider | null {
  if (provider) return provider;
  const key = env.APNS_KEY_P8?.replace(/\\n/g, '\n')?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  if (!key || !keyId || !teamId) return null;
  try {
    provider = new apn.Provider({
      token: {
        key,
        keyId,
        teamId
      },
      production: env.APNS_PRODUCTION !== false
    });
    return provider;
  } catch (error) {
    console.warn('[apnsVoip] provider init failed', error);
    return null;
  }
}

export function isApnsVoipConfigured(): boolean {
  return Boolean(env.APNS_KEY_P8?.trim() && env.APNS_KEY_ID?.trim() && env.APNS_TEAM_ID?.trim());
}

export async function getVoipTokensForUser(userId: string): Promise<string[]> {
  const rows = await DevicePushTokenModel.find({
    userId,
    platform: 'ios',
    enabled: true,
    callEnabled: true,
    voipToken: { $exists: true, $ne: '' }
  })
    .select('voipToken')
    .lean();
  return [...new Set(rows.map((r) => String(r.voipToken || '').trim()).filter(Boolean))];
}

/** Wake iOS via PushKit so CallKit can show the incoming call UI. */
export async function sendVoipIncomingCallPush(
  userId: string,
  payload: { callId: string; callerId: string; callerName: string; isVideo: boolean }
): Promise<number> {
  const tokens = await getVoipTokensForUser(userId);
  if (!tokens.length) return 0;
  const apns = getApnsProvider();
  if (!apns) {
    console.warn('[apnsVoip] not configured — skipping VoIP push');
    return 0;
  }

  const topic = env.APNS_VOIP_TOPIC?.trim() || 'com.connectify.mobileapp.voip';
  let sent = 0;
  for (const token of tokens) {
    const note = new apn.Notification();
    note.topic = topic;
    (note as apn.Notification & { pushType?: string }).pushType = 'voip';
    note.priority = 10;
    note.expiry = Math.floor(Date.now() / 1000) + 60;
    note.payload = {
      callId: payload.callId,
      callerId: payload.callerId,
      callerName: payload.callerName,
      isVideo: payload.isVideo ? 1 : 0,
      type: 'incoming_call'
    };
    try {
      const result = await apns.send(note, token);
      if (result.failed?.length) {
        console.warn(
          '[apnsVoip] send failed',
          result.failed.map((f) => ({ device: f.device, status: f.status, response: f.response }))
        );
      }
      sent += result.sent?.length ?? 0;
    } catch (error) {
      console.warn('[apnsVoip] send error', error);
    }
  }
  return sent;
}
