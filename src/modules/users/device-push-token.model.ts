import { InferSchemaType, Schema, model } from 'mongoose';

const devicePushTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true, trim: true },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    expoToken: { type: String, default: '' },
    fcmToken: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    messageEnabled: { type: Boolean, default: true },
    callEnabled: { type: Boolean, default: true },
    appVersion: { type: String, default: '' },
    lastSeenAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true }
);

devicePushTokenSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
devicePushTokenSchema.index({ expoToken: 1 }, { sparse: true });
devicePushTokenSchema.index({ fcmToken: 1 }, { sparse: true });

export type DevicePushTokenDocument = InferSchemaType<typeof devicePushTokenSchema> & { _id: string };
export const DevicePushTokenModel = model('DevicePushToken', devicePushTokenSchema);
