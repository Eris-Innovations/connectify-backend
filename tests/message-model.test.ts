import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ConversationModel } from '../src/modules/messages/conversation.model';
import { MessageModel } from '../src/modules/messages/message.model';

describe('message persistence models', () => {
  it('keeps disappearing messages off by default and accepts supported timers', () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const conversation = new ConversationModel({
      type: 'dm',
      participants: [{ userId: userA }, { userId: userB }],
      createdBy: userA,
    });
    expect(conversation.disappearingMessagesSeconds).toBe(0);
    conversation.disappearingMessagesSeconds = 7200;
    expect(conversation.validateSync()).toBeUndefined();
    conversation.disappearingMessagesSeconds = 123;
    expect(conversation.validateSync()?.errors.disappearingMessagesSeconds).toBeDefined();
  });

  it('stores an immutable reply snapshot and expiry', () => {
    const conversationId = new Types.ObjectId();
    const senderId = new Types.ObjectId();
    const originalId = new Types.ObjectId();
    const expiresAt = new Date(Date.now() + 3600_000);
    const message = new MessageModel({
      conversationId,
      senderId,
      content: { text: 'Reply text', mediaType: 'text' },
      replyTo: { messageId: originalId, senderId, previewText: 'Original text', mediaType: 'text' },
      expiresAt,
    });
    expect(message.validateSync()).toBeUndefined();
    expect(String(message.replyTo?.messageId)).toBe(String(originalId));
    expect(message.replyTo?.previewText).toBe('Original text');
    expect(message.expiresAt).toEqual(expiresAt);
  });

  it('stores per-user deletes and delete-for-everyone tombstones', () => {
    const conversationId = new Types.ObjectId();
    const senderId = new Types.ObjectId();
    const deletedForUserId = new Types.ObjectId();
    const deletedBy = new Types.ObjectId();
    const deletedAt = new Date();
    const message = new MessageModel({
      conversationId,
      senderId,
      content: { text: '', mediaType: 'text' },
      deletedForUserIds: [deletedForUserId],
      deletedForEveryoneAt: deletedAt,
      deletedBy,
      deletedReplacementText: 'This message was deleted',
    });

    expect(message.validateSync()).toBeUndefined();
    expect(String(message.deletedForUserIds?.[0])).toBe(String(deletedForUserId));
    expect(message.deletedForEveryoneAt).toEqual(deletedAt);
    expect(String(message.deletedBy)).toBe(String(deletedBy));
    expect(message.deletedReplacementText).toBe('This message was deleted');
  });
});
