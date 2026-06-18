import { Schema, model, InferSchemaType } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    isRevoked: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

export type RefreshTokenDocument = InferSchemaType<typeof refreshTokenSchema> & { _id: string };
export const RefreshTokenModel = model('RefreshToken', refreshTokenSchema);

