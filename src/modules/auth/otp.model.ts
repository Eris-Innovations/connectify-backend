import { Schema, model, InferSchemaType } from 'mongoose';

const otpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    code: { type: String, required: true },
    type: { type: String, enum: ['signup', 'login', 'reset_password'], default: 'signup' },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    used: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export type OtpDocument = InferSchemaType<typeof otpSchema> & { _id: string };
export const OtpModel = model('Otp', otpSchema);

