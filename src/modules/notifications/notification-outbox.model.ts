import { InferSchemaType, Schema, model } from 'mongoose';

const notificationOutboxSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: {
      type: String,
      enum: ['message', 'call', 'call_cancel', 'friend_request', 'friend_request_accepted'],
      required: true,
      index: true
    },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'delivered', 'failed', 'dead'],
      default: 'pending',
      index: true
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    deliveredAt: { type: Date },
    correlationId: { type: String, default: '' }
  },
  { timestamps: true }
);

notificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

export type NotificationOutboxDocument = InferSchemaType<typeof notificationOutboxSchema> & {
  _id: string;
};
export const NotificationOutboxModel = model('NotificationOutbox', notificationOutboxSchema);
