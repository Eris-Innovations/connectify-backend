/**
 * Pure FCM payload builders — unit-tested without Firebase Admin.
 */

export function buildAndroidIncomingCallData(payload: {
  callId: string;
  callerId: string;
  callerName: string;
  isVideo: boolean;
  eventId?: string;
}) {
  return {
    type: 'incoming_call',
    callId: payload.callId,
    callerId: payload.callerId,
    callerName: payload.callerName,
    isVideo: payload.isVideo ? '1' : '0',
    ...(payload.eventId ? { eventId: payload.eventId } : {}),
  } as const;
}

export function buildAndroidIncomingCallMulticastOptions() {
  return {
    priority: 'high' as const,
    ttl: 60_000,
    directBootOk: true
  };
}

export function buildAndroidCallCancelData(payload: { callId: string; eventId?: string }) {
  return {
    type: 'call_cancel',
    callId: payload.callId,
    ...(payload.eventId ? { eventId: payload.eventId } : {}),
  } as const;
}

export function buildAndroidChatMessagePayload(payload: {
  senderName: string;
  preview: string;
  chatId: string;
  messageId: string;
  eventId?: string;
}) {
  return {
    notification: {
      title: payload.senderName,
      body: payload.preview
    },
    data: {
      type: 'chat',
      chatId: payload.chatId,
      messageId: payload.messageId,
      ...(payload.eventId ? { eventId: payload.eventId } : {}),
    },
    android: {
      priority: 'high' as const,
      collapseKey: `chat:${payload.chatId}`,
      notification: {
        channelId: 'messages_v2',
        tag: `chat:${payload.chatId}`,
        sound: 'default'
      }
    }
  };
}

export function buildAndroidFriendRequestPayload(payload: {
  fromName: string;
  fromUserId: string;
  connectionId: string;
  eventId?: string;
}) {
  return {
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
      priority: 'high' as const,
      collapseKey: `friend_request:${payload.connectionId}`,
      notification: {
        channelId: 'default_v2',
        tag: `friend_request:${payload.connectionId}`
      }
    }
  };
}
