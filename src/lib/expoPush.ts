import { env } from '../config/env';
import { UserModel } from '../modules/users/user.model';
import { DevicePushTokenModel } from '../modules/users/device-push-token.model';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
  buildAndroidCallCancelData,
  buildAndroidIncomingCallData,
  buildAndroidIncomingCallMulticastOptions
} from './fcmPayloads';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Result of an Android FCM send — outbox uses this to retry vs intentional skip. */
export type AndroidPushOutcome = {
  successCount: number;
  skipReason?: 'opted_out' | 'no_firebase' | 'no_tokens';
};

function pushOk(successCount: number): AndroidPushOutcome {
  return { successCount };
}

function pushSkip(skipReason: NonNullable<AndroidPushOutcome['skipReason']>): AndroidPushOutcome {
  return { successCount: 0, skipReason };
}

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
  collapseId?: string;
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
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Expo push HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = (await res.json().catch(() => null)) as {
      data?: { status?: string; id?: string; details?: { error?: string } }[];
    } | null;
    const errors = Array.isArray(body?.data)
      ? body.data.filter((row) => row?.status === 'error')
      : [];
    if (errors.length > 0) {
      console.warn('[expoPush] delivery errors', JSON.stringify(errors).slice(0, 400));
    } else {
      console.log('[expoPush] sent', tokens.length, 'notification(s)');
    }
    const invalidTokens = (body?.data ?? [])
      .map((row, index) => row.details?.error === 'DeviceNotRegistered' ? tokens[index] : '')
      .filter(Boolean);
    if (invalidTokens.length > 0) {
      await DevicePushTokenModel.deleteMany({ expoToken: { $in: invalidTokens } });
    }
    const retryableErrors = errors.filter(
      (row) => row.details?.error !== 'DeviceNotRegistered'
    );
    if (retryableErrors.length > 0) {
      throw new Error(
        `Expo push rejected ${retryableErrors.length} notification(s): ${JSON.stringify(retryableErrors).slice(0, 300)}`
      );
    }

    const ticketToToken = new Map<string, string>();
    (body?.data ?? []).forEach((row, index) => {
      if (row.status === 'ok' && row.id) ticketToToken.set(row.id, tokens[index]);
    });
    if (ticketToToken.size > 0) {
      setTimeout(() => {
        void checkExpoReceipts(ticketToToken, headers);
      }, 15_000);
    }
  } catch (err) {
    console.warn('[expoPush] send error', err);
    throw err;
  }
}

async function checkExpoReceipts(ticketToToken: Map<string, string>, headers: Record<string, string>) {
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: [...ticketToToken.keys()] }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) return;
    const body = await res.json() as {
      data?: Record<string, { status?: string; details?: { error?: string } }>;
    };
    const invalidTokens = Object.entries(body.data ?? {})
      .filter(([, receipt]) => receipt.details?.error === 'DeviceNotRegistered')
      .map(([ticketId]) => ticketToToken.get(ticketId) ?? '')
      .filter(Boolean);
    if (invalidTokens.length > 0) {
      await DevicePushTokenModel.deleteMany({ expoToken: { $in: invalidTokens } });
    }
  } catch (error) {
    console.warn('[expoPush] receipt check failed', error);
  }
}

export async function getExpoPushTokensForUser(
  userId: string,
  options: { category?: 'message' | 'call' | 'general'; platform?: 'android' | 'ios' } = {}
): Promise<string[]> {
  try {
    const user = await UserModel.findById(userId).select('settings').lean();
    const categoryEnabled = options.category === 'call'
      ? user?.settings?.callNotificationsEnabled !== false
      : options.category === 'general'
        ? true
        : user?.settings?.messageNotificationsEnabled !== false;
    if (!user || user.settings?.notificationsEnabled === false || !categoryEnabled) {
      return [];
    }
    const deviceQuery: Record<string, unknown> = {
      userId,
      enabled: true,
      expoToken: { $ne: '' }
    };
    if (options.category === 'call') deviceQuery.callEnabled = true;
    if (options.category !== 'call' && options.category !== 'general') deviceQuery.messageEnabled = true;
    // DevicePushToken is the sole source of truth — never fall back to User.expoPushTokens.
    if (options.platform) deviceQuery.platform = options.platform;
    const devices = await DevicePushTokenModel.find(deviceQuery)
      .select('expoToken')
      .lean();
    return filterValidExpoTokens(devices.map((device) => device.expoToken));
  } catch {
    return [];
  }
}

function ensureFirebaseAdmin(): boolean {
  if (getApps().length > 0) return true;
  try {
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      initializeApp({ credential: cert(serviceAccount) });
    } else if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      initializeApp({
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else {
      return false;
    }
    return true;
  } catch (error) {
    console.error('[fcm] invalid FIREBASE_SERVICE_ACCOUNT_JSON', error);
    return false;
  }
}

export async function sendAndroidIncomingCallPush(
  userId: string,
  payload: { callId: string; callerId: string; callerName: string; isVideo: boolean; eventId?: string }
): Promise<AndroidPushOutcome> {
  if (!ensureFirebaseAdmin()) {
    console.warn('[fcm.call] Firebase Admin is not configured');
    return pushSkip('no_firebase');
  }
  const user = await UserModel.findById(userId).select('settings').lean();
  if (!user || user.settings?.notificationsEnabled === false || user.settings?.callNotificationsEnabled === false) {
    return pushSkip('opted_out');
  }
  const devices = await DevicePushTokenModel.find({
    userId,
    platform: 'android',
    enabled: true,
    callEnabled: true,
    fcmToken: { $ne: '' }
  })
    .select('fcmToken')
    .lean();
  const tokens = [...new Set(devices.map((device) => device.fcmToken).filter(Boolean))];
  if (tokens.length === 0) return pushSkip('no_tokens');

  // Data-only so setBackgroundMessageHandler runs in background/terminated and can
  // present a single CallStyle / full-screen notification.
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    data: buildAndroidIncomingCallData(payload),
    android: buildAndroidIncomingCallMulticastOptions()
  });

  const invalidTokens: string[] = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code ?? '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      invalidTokens.push(tokens[index]);
    }
  });
  if (invalidTokens.length > 0) {
    await DevicePushTokenModel.deleteMany({ fcmToken: { $in: invalidTokens } });
  }
  console.log('[fcm.call] delivery', {
    userId,
    callId: payload.callId,
    successCount: response.successCount,
    failureCount: response.failureCount
  });
  return pushOk(response.successCount);
}

export async function sendAndroidCallCancelPush(
  userId: string,
  payload: { callId: string; eventId?: string }
): Promise<AndroidPushOutcome> {
  if (!ensureFirebaseAdmin()) return pushSkip('no_firebase');
  const devices = await DevicePushTokenModel.find({
    userId,
    platform: 'android',
    enabled: true,
    fcmToken: { $ne: '' }
  })
    .select('fcmToken')
    .lean();
  const tokens = [...new Set(devices.map((device) => device.fcmToken).filter(Boolean))];
  if (tokens.length === 0) return pushSkip('no_tokens');
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    data: buildAndroidCallCancelData(payload),
    android: {
      priority: 'high',
      ttl: 30_000
    }
  });
  return pushOk(response.successCount);
}

export async function sendAndroidFriendRequestPush(
  userId: string,
  payload: { fromName: string; fromUserId: string; connectionId: string; eventId?: string }
): Promise<AndroidPushOutcome> {
  if (!ensureFirebaseAdmin()) return pushSkip('no_firebase');
  const user = await UserModel.findById(userId).select('settings').lean();
  if (!user || user.settings?.notificationsEnabled === false) return pushSkip('opted_out');
  const devices = await DevicePushTokenModel.find({
    userId,
    platform: 'android',
    enabled: true,
    fcmToken: { $ne: '' }
  })
    .select('fcmToken')
    .lean();
  const tokens = [...new Set(devices.map((device) => device.fcmToken).filter(Boolean))];
  if (tokens.length === 0) return pushSkip('no_tokens');
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: 'Friend request',
      body: `${payload.fromName} sent you a friend request`
    },
    data: {
      type: 'friend_request',
      fromUserId: payload.fromUserId,
      connectionId: payload.connectionId,
      ...(payload.eventId ? { eventId: payload.eventId } : {}),
    },
    android: {
      priority: 'high',
      ttl: 24 * 60 * 60 * 1000,
      notification: {
        channelId: 'default_v2',
        sound: 'default',
        tag: `friend_request:${payload.connectionId}`
      }
    }
  });
  return pushOk(response.successCount);
}

export async function sendAndroidFriendAcceptedPush(
  userId: string,
  payload: { accepterName: string; accepterUserId: string; chatId?: string; eventId?: string }
): Promise<AndroidPushOutcome> {
  if (!ensureFirebaseAdmin()) return pushSkip('no_firebase');
  const user = await UserModel.findById(userId).select('settings').lean();
  if (!user || user.settings?.notificationsEnabled === false) return pushSkip('opted_out');
  const devices = await DevicePushTokenModel.find({
    userId,
    platform: 'android',
    enabled: true,
    fcmToken: { $ne: '' }
  })
    .select('fcmToken')
    .lean();
  const tokens = [...new Set(devices.map((device) => device.fcmToken).filter(Boolean))];
  if (tokens.length === 0) return pushSkip('no_tokens');
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: 'Friend request accepted',
      body: `${payload.accepterName} accepted your friend request`
    },
    data: {
      type: 'friend_request_accepted',
      fromUserId: payload.accepterUserId,
      ...(payload.chatId ? { chatId: payload.chatId } : {}),
      ...(payload.eventId ? { eventId: payload.eventId } : {}),
    },
    android: {
      priority: 'high',
      ttl: 24 * 60 * 60 * 1000,
      notification: {
        channelId: 'default_v2',
        sound: 'default',
        tag: `friend_accepted:${payload.accepterUserId}`
      }
    }
  });
  return pushOk(response.successCount);
}

export async function sendAndroidChatMessagePush(
  userId: string,
  payload: { senderName: string; preview: string; chatId: string; messageId: string; eventId?: string }
): Promise<AndroidPushOutcome> {
  if (!ensureFirebaseAdmin()) {
    console.warn('[fcm.message] Firebase Admin is not configured');
    return pushSkip('no_firebase');
  }
  const user = await UserModel.findById(userId).select('settings').lean();
  if (!user || user.settings?.notificationsEnabled === false || user.settings?.messageNotificationsEnabled === false) {
    return pushSkip('opted_out');
  }
  const devices = await DevicePushTokenModel.find({
    userId,
    platform: 'android',
    enabled: true,
    messageEnabled: true,
    fcmToken: { $ne: '' }
  })
    .select('fcmToken')
    .lean();
  const tokens = [...new Set(devices.map((device) => device.fcmToken).filter(Boolean))];
  if (tokens.length === 0) return pushSkip('no_tokens');

  const preview = payload.preview.trim().slice(0, 120) || 'New message';
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: payload.senderName,
      body: preview
    },
    data: {
      type: 'chat',
      chatId: payload.chatId,
      messageId: payload.messageId,
      ...(payload.eventId ? { eventId: payload.eventId } : {}),
    },
    android: {
      priority: 'high',
      ttl: 24 * 60 * 60 * 1000,
      collapseKey: `chat:${payload.chatId}`,
      notification: {
        channelId: 'messages_v2',
        sound: 'default',
        priority: 'high',
        visibility: 'private',
        tag: `chat:${payload.chatId}`
      }
    }
  });

  const invalidTokens: string[] = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code ?? '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      invalidTokens.push(tokens[index]);
    }
  });
  if (invalidTokens.length > 0) {
    await DevicePushTokenModel.deleteMany({ fcmToken: { $in: invalidTokens } });
  }
  console.log('[fcm.message] delivery', {
    userId,
    chatId: payload.chatId,
    messageId: payload.messageId,
    successCount: response.successCount,
    failureCount: response.failureCount
  });
  return pushOk(response.successCount);
}

export async function sendIncomingCallPush(
  tokens: string[],
  payload: {
    callId: string;
    callerId: string;
    callerName: string;
    isVideo: boolean;
    eventId?: string;
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
      channelId: 'calls_v2',
      categoryId: 'incoming_call',
      ttl: 90,
      collapseId: `call:${payload.callId}`,
      data: {
        type: 'incoming_call',
        callId: payload.callId,
        callerId: payload.callerId,
        callerName: payload.callerName,
        isVideo: payload.isVideo ? '1' : '0',
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
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
    eventId?: string;
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
      channelId: 'messages_v2',
      data: {
        type: 'chat',
        chatId: payload.chatId,
        messageId: payload.messageId,
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
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
    eventId?: string;
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
      priority: 'high',
      channelId: 'default_v2',
      data: {
        type: 'friend_request',
        fromUserId: payload.fromUserId,
        connectionId: payload.connectionId,
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
      },
    }))
  );
}

export async function sendFriendRequestAcceptedPush(
  tokens: string[],
  payload: {
    accepterName: string;
    accepterUserId: string;
    chatId?: string;
    eventId?: string;
  }
): Promise<void> {
  const unique = filterValidExpoTokens(tokens);
  if (unique.length === 0) return;

  await sendExpoPush(
    unique.map((to) => ({
      to,
      title: 'Friend request accepted',
      body: `${payload.accepterName} accepted your friend request`,
      sound: 'default',
      priority: 'high',
      channelId: 'default_v2',
      data: {
        type: 'friend_request_accepted',
        fromUserId: payload.accepterUserId,
        ...(payload.chatId ? { chatId: payload.chatId } : {}),
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
      },
    }))
  );
}
