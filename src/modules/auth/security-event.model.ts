import { InferSchemaType, Schema, model } from 'mongoose';

const authSecurityEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    event: {
      type: String,
      enum: ['register_attempt', 'register_success', 'login_success', 'login_failed'],
      required: true,
      index: true
    },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    platform: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    createdAt: { type: Date, default: () => new Date(), expires: 90 * 24 * 60 * 60 }
  },
  { versionKey: false }
);

export type AuthSecurityEventDocument = InferSchemaType<typeof authSecurityEventSchema> & { _id: string };
export const AuthSecurityEventModel = model('AuthSecurityEvent', authSecurityEventSchema);
