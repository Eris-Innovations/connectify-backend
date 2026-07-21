import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  find: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  sendAndroidChatMessagePush: vi.fn(),
  getExpoPushTokensForUser: vi.fn(),
  sendChatMessagePush: vi.fn(),
  sendAndroidIncomingCallPush: vi.fn(),
  sendAndroidCallCancelPush: vi.fn(),
  sendAndroidFriendRequestPush: vi.fn(),
  sendAndroidFriendAcceptedPush: vi.fn(),
  sendIncomingCallPush: vi.fn(),
  sendFriendRequestPush: vi.fn(),
  sendFriendRequestAcceptedPush: vi.fn(),
}));

vi.mock('../src/modules/notifications/notification-outbox.model', () => ({
  NotificationOutboxModel: {
    updateMany: mocks.updateMany,
    find: mocks.find,
    findOneAndUpdate: mocks.findOneAndUpdate,
    updateOne: mocks.updateOne,
  },
}));

vi.mock('../src/lib/expoPush', () => ({
  sendAndroidChatMessagePush: mocks.sendAndroidChatMessagePush,
  getExpoPushTokensForUser: mocks.getExpoPushTokensForUser,
  sendChatMessagePush: mocks.sendChatMessagePush,
  sendAndroidIncomingCallPush: mocks.sendAndroidIncomingCallPush,
  sendAndroidCallCancelPush: mocks.sendAndroidCallCancelPush,
  sendAndroidFriendRequestPush: mocks.sendAndroidFriendRequestPush,
  sendAndroidFriendAcceptedPush: mocks.sendAndroidFriendAcceptedPush,
  sendIncomingCallPush: mocks.sendIncomingCallPush,
  sendFriendRequestPush: mocks.sendFriendRequestPush,
  sendFriendRequestAcceptedPush: mocks.sendFriendRequestAcceptedPush,
}));

import {
  notificationRetryDelayMs,
  processNotificationOutbox,
} from '../src/modules/notifications/notification-outbox.service';

function mockRows(rows: Record<string, unknown>[]) {
  mocks.find.mockReturnValue({
    sort: () => ({
      limit: () => ({
        lean: async () => rows,
      }),
    }),
  });
}

function mockClaim(claimed: Record<string, unknown> | null) {
  mocks.findOneAndUpdate.mockReturnValue({
    lean: async () => claimed,
  });
}

describe('notification outbox worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });
    mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.sendAndroidChatMessagePush.mockResolvedValue({ successCount: 1 });
    mocks.sendAndroidIncomingCallPush.mockResolvedValue({ successCount: 1 });
    mocks.sendAndroidCallCancelPush.mockResolvedValue({ successCount: 1 });
    mocks.sendAndroidFriendRequestPush.mockResolvedValue({ successCount: 1 });
    mocks.sendAndroidFriendAcceptedPush.mockResolvedValue({ successCount: 1 });
    mocks.getExpoPushTokensForUser.mockResolvedValue(['ExponentPushToken[ios]']);
    mocks.sendChatMessagePush.mockResolvedValue(undefined);
  });

  it('atomically claims a message and delivers to Android and iOS devices', async () => {
    const row = {
      _id: 'outbox-1',
      userId: 'user-1',
      kind: 'message',
      payload: {
        senderName: 'Ada',
        preview: 'hello',
        chatId: 'chat-1',
        messageId: 'message-1',
      },
      status: 'pending',
      attempts: 0,
    };
    mockRows([row]);
    mockClaim({ ...row, status: 'processing', attempts: 1 });

    await expect(processNotificationOutbox(10)).resolves.toBe(1);
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'outbox-1', status: { $in: ['pending', 'failed'] } },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { new: true }
    );
    expect(mocks.sendAndroidChatMessagePush).toHaveBeenCalledOnce();
    expect(mocks.getExpoPushTokensForUser).toHaveBeenCalledWith('user-1', {
      category: 'message',
      platform: 'ios',
    });
    expect(mocks.sendChatMessagePush).toHaveBeenCalledOnce();
    expect(mocks.updateOne).toHaveBeenLastCalledWith(
      { _id: 'outbox-1', status: 'processing' },
      { $set: { status: 'delivered', deliveredAt: expect.any(Date), lastError: '' } }
    );
  });

  it('does not deliver a row another worker already claimed', async () => {
    mockRows([{ _id: 'outbox-2', status: 'pending' }]);
    mockClaim(null);

    await expect(processNotificationOutbox()).resolves.toBe(0);
    expect(mocks.sendAndroidChatMessagePush).not.toHaveBeenCalled();
  });

  it('marks failed delivery for retry with bounded exponential backoff', async () => {
    const row = {
      _id: 'outbox-3',
      userId: 'user-3',
      kind: 'message',
      payload: { chatId: 'chat-3', messageId: 'message-3' },
      status: 'pending',
      attempts: 0,
    };
    mockRows([row]);
    mockClaim({ ...row, status: 'processing', attempts: 1 });
    mocks.sendAndroidChatMessagePush.mockRejectedValue(new Error('FCM unavailable'));

    await expect(processNotificationOutbox()).resolves.toBe(0);
    expect(mocks.updateOne).toHaveBeenLastCalledWith(
      { _id: 'outbox-3', status: 'processing' },
      {
        $set: {
          status: 'failed',
          lastError: 'FCM unavailable',
          nextAttemptAt: expect.any(Date),
        },
      }
    );
    expect(notificationRetryDelayMs(1)).toBe(2_000);
    expect(notificationRetryDelayMs(10)).toBe(60_000);
  });

  it('retries when Android FCM reports zero success and no Expo fallback', async () => {
    const row = {
      _id: 'outbox-4',
      userId: 'user-4',
      kind: 'message',
      payload: {
        senderName: 'Ada',
        preview: 'hello',
        chatId: 'chat-4',
        messageId: 'message-4',
      },
      status: 'pending',
      attempts: 0,
    };
    mockRows([row]);
    mockClaim({ ...row, status: 'processing', attempts: 1 });
    mocks.sendAndroidChatMessagePush.mockResolvedValue({
      successCount: 0,
      skipReason: 'no_tokens',
    });
    mocks.getExpoPushTokensForUser.mockResolvedValue([]);

    await expect(processNotificationOutbox()).resolves.toBe(0);
    expect(mocks.updateOne).toHaveBeenLastCalledWith(
      { _id: 'outbox-4', status: 'processing' },
      {
        $set: {
          status: 'failed',
          lastError: 'push_zero_success:message:no_tokens',
          nextAttemptAt: expect.any(Date),
        },
      }
    );
  });

  it('reclaims processing rows whose worker lease expired', async () => {
    mockRows([]);
    await processNotificationOutbox();
    expect(mocks.updateMany).toHaveBeenCalledWith(
      {
        status: 'processing',
        updatedAt: { $lt: expect.any(Date) },
      },
      {
        $set: {
          status: 'failed',
          nextAttemptAt: expect.any(Date),
          lastError: 'Processing lease expired',
        },
      }
    );
  });
});
