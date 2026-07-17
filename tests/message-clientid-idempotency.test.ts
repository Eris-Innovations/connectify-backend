import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { MessageModel } from '../src/modules/messages/message.model';

describe('message clientId idempotency', () => {
  it('accepts clientId for sender-scoped unique index', () => {
    const message = new MessageModel({
      conversationId: new Types.ObjectId(),
      senderId: new Types.ObjectId(),
      clientId: 'client-abc-1',
      content: { text: 'hi', mediaType: 'text' }
    });
    expect(message.validateSync()).toBeUndefined();
    expect(message.clientId).toBe('client-abc-1');
  });

  it('allows messages without clientId (system / legacy)', () => {
    const message = new MessageModel({
      conversationId: new Types.ObjectId(),
      senderId: new Types.ObjectId(),
      content: { text: 'system', mediaType: 'text' }
    });
    expect(message.validateSync()).toBeUndefined();
  });
});
