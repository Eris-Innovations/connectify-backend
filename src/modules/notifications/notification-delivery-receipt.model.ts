import { InferSchemaType, Schema, model } from 'mongoose';

const notificationDeliveryReceiptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['received', 'displayed', 'opened', 'answered', 'declined', 'dismissed', 'cancelled'],
      required: true,
      index: true,
    },
    callId: { type: String, default: '', index: true },
    messageId: { type: String, default: '', index: true },
    eventId: { type: String, default: '', index: true },
  },
  { timestamps: true }
);

notificationDeliveryReceiptSchema.index({ createdAt: -1 });
notificationDeliveryReceiptSchema.index(
  { userId: 1, deviceId: 1, status: 1, callId: 1, messageId: 1, eventId: 1 },
  { unique: true }
);

export type NotificationDeliveryReceiptDocument = InferSchemaType<
  typeof notificationDeliveryReceiptSchema
> & { _id: string };

export const NotificationDeliveryReceiptModel = model(
  'NotificationDeliveryReceipt',
  notificationDeliveryReceiptSchema
);
