import { env } from '../config/env';
import { UserModel } from '../modules/users/user.model';

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

function filterValidExpoTokens(tokens: string[]): string[] {
  return [...new Set(tokens.filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken[')))];
}

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
      return;
    }
    const body = (await res.json().catch(() => null)) as { data?: { status?: string }[] } | null;
    const errors = Array.isArray(body?.data)
      ? body.data.filter((row) => row?.status === 'error')
      : [];
    if (errors.length > 0) {
      console.warn('[expoPush] delivery errors', JSON.stringify(errors).slice(0, 400));
    } else {
      console.log('[expoPush] sent', tokens.length, 'notification(s)');
    }
  } catch (err) {
    console.warn('[expoPush] send error', err);
  }
}

export async function shouldSendPush(userId: string): Promise<boolean> {
  try {
    const user = await UserModel.findById(userId).select('expoPushTokens settings').lean();
    if (!user) return false;
    if (user.settings?.notificationsEnabled === false) return false;
    const tokens = filterValidExpoTokens(Array.isArray(user.expoPushTokens) ? user.expoPushTokens : []);
    return tokens.length > 0;
  } catch {
    return false;
  }
}

export async function getExpoPushTokensForUser(userId: string): Promise<string[]> {
  try {
    const user = await UserModel.findById(userId).select('expoPushTokens settings').lean();
    if (!user || user.settings?.notificationsEnabled === false) return [];
    return filterValidExpoTokens(Array.isArray(user.expoPushTokens) ? user.expoPushTokens : []);
  } catch {
    return [];
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
  const unique = filterValidExpoTokens(tokens);
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

export async function sendChatMessagePush(
  tokens: string[],
  payload: {
    senderName: string;
    preview: string;
    chatId: string;
    messageId: string;
  }
): Promise<void> {
  const unique = filterValidExpoTokens(tokens);
  if (unique.length === 0) return;

  const preview = payload.preview.trim().slice(0, 120) || 'New message';

  await sendExpoPush(
    unique.map((to) => ({
      to,
      title: payload.senderName,
      body: preview,
      sound: 'default',
      priority: 'high',
      channelId: 'messages',
      data: {
        type: 'chat',
        chatId: payload.chatId,
        messageId: payload.messageId,
      },
    }))
  );
}

export async function sendFriendRequestPush(
  tokens: string[],
  payload: {
    fromName: string;
    fromUserId: string;
    connectionId: string;
  }
): Promise<void> {
  const unique = filterValidExpoTokens(tokens);
  if (unique.length === 0) return;

  await sendExpoPush(
    unique.map((to) => ({
      to,
      title: 'Friend request',
      body: `${payload.fromName} sent you a friend request`,
      sound: 'default',
      priority: 'default',
      channelId: 'default',
      data: {
        type: 'friend_request',
        fromUserId: payload.fromUserId,
        connectionId: payload.connectionId,
      },
    }))
  );
}
