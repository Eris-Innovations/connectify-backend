import { describe, expect, it } from 'vitest';
import {
  buildAndroidCallCancelData,
  buildAndroidChatMessagePayload,
  buildAndroidFriendRequestPayload,
  buildAndroidIncomingCallData,
  buildAndroidIncomingCallMulticastOptions
} from '../src/lib/fcmPayloads';

describe('Android FCM payload builders', () => {
  it('builds data-only incoming call payloads (no notification block)', () => {
    const data = buildAndroidIncomingCallData({
      callId: 'call-1',
      callerId: 'user-a',
      callerName: 'Ada',
      isVideo: true
    });
    expect(data).toEqual({
      type: 'incoming_call',
      callId: 'call-1',
      callerId: 'user-a',
      callerName: 'Ada',
      isVideo: '1'
    });
    expect(
      buildAndroidIncomingCallData({
        callId: 'call-1',
        callerId: 'user-a',
        callerName: 'Ada',
        isVideo: false,
        eventId: 'call:call-1:user-b',
      })
    ).toMatchObject({ eventId: 'call:call-1:user-b', isVideo: '0' });
    expect(data).not.toHaveProperty('notification');
    const android = buildAndroidIncomingCallMulticastOptions();
    expect(android.priority).toBe('high');
    expect(android.ttl).toBe(60_000);
  });

  it('builds call cancel as data-only', () => {
    expect(buildAndroidCallCancelData({ callId: 'call-9' })).toEqual({
      type: 'call_cancel',
      callId: 'call-9'
    });
  });

  it('builds visible chat payloads with stable tag/collapse key and versioned channel', () => {
    const payload = buildAndroidChatMessagePayload({
      senderName: 'Bob',
      preview: 'hello',
      chatId: 'dm:1:2',
      messageId: 'm1'
    });
    expect(payload.notification.title).toBe('Bob');
    expect(payload.data.type).toBe('chat');
    expect(
      buildAndroidChatMessagePayload({
        senderName: 'Bob',
        preview: 'hello',
        chatId: 'dm:1:2',
        messageId: 'm1',
        eventId: 'message:m1:user-2',
      }).data.eventId
    ).toBe('message:m1:user-2');
    expect(payload.android.collapseKey).toBe('chat:dm:1:2');
    expect(payload.android.notification.channelId).toBe('messages_v2');
    expect(payload.android.notification.tag).toBe('chat:dm:1:2');
  });

  it('builds friend-request payloads with stable tags', () => {
    const payload = buildAndroidFriendRequestPayload({
      fromName: 'Eve',
      fromUserId: 'u1',
      connectionId: 'c1'
    });
    expect(payload.data.type).toBe('friend_request');
    expect(payload.android.notification.tag).toBe('friend_request:c1');
  });
});
