import { InferSchemaType, Schema, Types, model } from 'mongoose';

const userBlockSchema = new Schema(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    blockedId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }
  },
  { timestamps: true }
);

userBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

export type UserBlockDocument = InferSchemaType<typeof userBlockSchema> & { _id: Types.ObjectId };
export const UserBlockModel = model('UserBlock', userBlockSchema);
