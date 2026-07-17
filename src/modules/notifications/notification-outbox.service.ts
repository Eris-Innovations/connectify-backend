import { Types } from 'mongoose';
import { NotificationOutboxModel } from './notification-outbox.model';
import {
  sendAndroidCallCancelPush,
  sendAndroidChatMessagePush,
  sendAndroidFriendAcceptedPush,
  sendAndroidFriendRequestPush,
  sendAndroidIncomingCallPush,
  getExpoPushTokensForUser,
  sendChatMessagePush,
  sendFriendRequestAcceptedPush,
  sendFriendRequestPush,
  sendIncomingCallPush
} from '../../lib/expoPush';

const MAX_ATTEMPTS = 6;
const PROCESSING_LEASE_MS = 2 * 60_000;

export function notificationRetryDelayMs(attempts: number): number {
  return Math.min(60_000, 2 ** Math.max(1, attempts) * 1000);
}

type OutboxKind =
  | 'message'
  | 'call'
  | 'call_cancel'
  | 'friend_request'
  | 'friend_request_accepted';

export async function enqueueNotification(input: {
  eventId: string;
  userId: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  correlationId?: string;
}): Promise<void> {
  try {
    await NotificationOutboxModel.updateOne(
      { eventId: input.eventId },
      {
        $setOnInsert: {
          userId: new Types.ObjectId(input.userId),
          kind: input.kind,
          payload: input.payload,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: new Date(),
          correlationId: input.correlationId ?? input.eventId
        }
      },
      { upsert: true }
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }
  void processNotificationOutbox(25);
}

async function deliver(row: {
  kind: OutboxKind;
  userId: Types.ObjectId;
  eventId: string;
  payload: Record<string, any>;
}): Promise<void> {
  const userId = String(row.userId);
  const eventId = row.eventId;
  switch (row.kind) {
    case 'call': {
      await sendAndroidIncomingCallPush(userId, {
        callId: String(row.payload.callId),
        callerId: String(row.payload.callerId),
        callerName: String(row.payload.callerName ?? 'Unknown'),
        isVideo: Boolean(row.payload.isVideo),
        eventId,
      });
      const iosTokens = await getExpoPushTokensForUser(userId, { category: 'call', platform: 'ios' });
      if (iosTokens.length) {
        await sendIncomingCallPush(iosTokens, {
          callId: String(row.payload.callId),
          callerId: String(row.payload.callerId),
          callerName: String(row.payload.callerName ?? 'Unknown'),
          isVideo: Boolean(row.payload.isVideo),
          eventId,
        });
      }
      return;
    }
    case 'call_cancel': {
      await sendAndroidCallCancelPush(userId, { callId: String(row.payload.callId), eventId });
      return;
    }
    case 'message': {
      await sendAndroidChatMessagePush(userId, {
        senderName: String(row.payload.senderName ?? 'Someone'),
        preview: String(row.payload.preview ?? ''),
        chatId: String(row.payload.chatId),
        messageId: String(row.payload.messageId),
        eventId,
      });
      // A user can own Android and iOS devices simultaneously; deliver to both platforms.
      const iosTokens = await getExpoPushTokensForUser(userId, {
        category: 'message',
        platform: 'ios'
      });
      if (iosTokens.length) {
        await sendChatMessagePush(iosTokens, {
          senderName: String(row.payload.senderName ?? 'Someone'),
          preview: String(row.payload.preview ?? ''),
          chatId: String(row.payload.chatId),
          messageId: String(row.payload.messageId),
          eventId,
        });
      }
      return;
    }
    case 'friend_request': {
      await sendAndroidFriendRequestPush(userId, {
        fromName: String(row.payload.fromName ?? 'Someone'),
        fromUserId: String(row.payload.fromUserId),
        connectionId: String(row.payload.connectionId),
        eventId,
      });
      const iosTokens = await getExpoPushTokensForUser(userId, {
        category: 'general',
        platform: 'ios'
      });
      if (iosTokens.length) {
        await sendFriendRequestPush(iosTokens, {
          fromName: String(row.payload.fromName ?? 'Someone'),
          fromUserId: String(row.payload.fromUserId),
          connectionId: String(row.payload.connectionId),
          eventId,
        });
      }
      return;
    }
    case 'friend_request_accepted': {
      await sendAndroidFriendAcceptedPush(userId, {
        accepterName: String(row.payload.accepterName ?? 'Someone'),
        accepterUserId: String(row.payload.accepterUserId),
        chatId: row.payload.chatId ? String(row.payload.chatId) : undefined,
        eventId,
      });
      const iosTokens = await getExpoPushTokensForUser(userId, {
        category: 'general',
        platform: 'ios'
      });
      if (iosTokens.length) {
        await sendFriendRequestAcceptedPush(iosTokens, {
          accepterName: String(row.payload.accepterName ?? 'Someone'),
          accepterUserId: String(row.payload.accepterUserId),
          chatId: row.payload.chatId ? String(row.payload.chatId) : undefined,
          eventId,
        });
      }
      return;
    }
    default:
      return;
  }
}

export async function processNotificationOutbox(limit = 50): Promise<number> {
  const now = new Date();
  // Reclaim rows left processing after a process crash or timeout.
  await NotificationOutboxModel.updateMany(
    {
      status: 'processing',
      updatedAt: { $lt: new Date(now.getTime() - PROCESSING_LEASE_MS) }
    },
    {
      $set: {
        status: 'failed',
        nextAttemptAt: now,
        lastError: 'Processing lease expired'
      }
    }
  );

  const rows = await NotificationOutboxModel.find({
    status: { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: now },
    attempts: { $lt: MAX_ATTEMPTS }
  })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .lean();

  let processed = 0;
  for (const row of rows) {
    // Atomically claim each row so concurrent API instances cannot deliver it twice.
    const claimed = await NotificationOutboxModel.findOneAndUpdate(
      { _id: row._id, status: { $in: ['pending', 'failed'] } },
      { $set: { status: 'processing' }, $inc: { attempts: 1 } },
      { new: true }
    ).lean();
    if (!claimed) continue;

    try {
      await deliver({
        kind: claimed.kind as OutboxKind,
        userId: claimed.userId as Types.ObjectId,
        eventId: String(claimed.eventId ?? ''),
        payload: (claimed.payload ?? {}) as Record<string, any>
      });
      await NotificationOutboxModel.updateOne(
        { _id: claimed._id, status: 'processing' },
        { $set: { status: 'delivered', deliveredAt: new Date(), lastError: '' } }
      );
      processed += 1;
    } catch (error: any) {
      const attempts = claimed.attempts ?? 1;
      const delayMs = notificationRetryDelayMs(attempts);
      await NotificationOutboxModel.updateOne(
        { _id: claimed._id, status: 'processing' },
        {
          $set: {
            status: attempts >= MAX_ATTEMPTS ? 'dead' : 'failed',
            lastError: String(error?.message ?? error).slice(0, 500),
            nextAttemptAt: new Date(Date.now() + delayMs)
          }
        }
      );
    }
  }
  return processed;
}

let outboxTimer: ReturnType<typeof setInterval> | null = null;

export function startNotificationOutboxWorker(): void {
  if (outboxTimer) return;
  outboxTimer = setInterval(() => {
    void processNotificationOutbox(40);
  }, 5_000);
}

export function stopNotificationOutboxWorker(): void {
  if (!outboxTimer) return;
  clearInterval(outboxTimer);
  outboxTimer = null;
}
