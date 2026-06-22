import { env } from '../config/env';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type ExpoPushMessage = {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  categoryId?: string;
  ttl?: number;
};

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  const tokens = messages.map((m) => m.to).filter(Boolean);
  if (tokens.length === 0) return;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[expoPush] send failed', res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.warn('[expoPush] send error', err);
  }
}

export async function sendIncomingCallPush(
  tokens: string[],
  payload: {
    callId: string;
    callerId: string;
    callerName: string;
    isVideo: boolean;
  }
): Promise<void> {
  const unique = [...new Set(tokens.filter((t) => t.startsWith('ExponentPushToken[')))];
  if (unique.length === 0) return;

  await sendExpoPush(
    unique.map((to) => ({
      to,
      title: 'Incoming call',
      body: `${payload.callerName} is calling you`,
      sound: 'default',
      priority: 'high',
      channelId: 'calls',
      categoryId: 'incoming_call',
      ttl: 90,
      data: {
        type: 'incoming_call',
        callId: payload.callId,
        callerId: payload.callerId,
        callerName: payload.callerName,
        isVideo: payload.isVideo ? '1' : '0',
      },
    }))
  );
}
