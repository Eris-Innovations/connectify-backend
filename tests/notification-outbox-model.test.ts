import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { NotificationOutboxModel } from '../src/modules/notifications/notification-outbox.model';

describe('NotificationOutbox model', () => {
  it('requires unique eventId and supports retry fields', () => {
    const row = new NotificationOutboxModel({
      eventId: 'message:abc:user1',
      userId: new Types.ObjectId(),
      kind: 'message',
      payload: { chatId: 'dm:1:2', messageId: 'abc' },
      status: 'pending',
      attempts: 0,
      correlationId: 'abc'
    });
    expect(row.validateSync()).toBeUndefined();
    expect(row.status).toBe('pending');
    expect(row.kind).toBe('message');
  });

  it('rejects unknown kind values', () => {
    const row = new NotificationOutboxModel({
      eventId: 'bad:1',
      userId: new Types.ObjectId(),
      kind: 'sms',
      payload: {}
    });
    expect(row.validateSync()?.errors.kind).toBeDefined();
  });
});
