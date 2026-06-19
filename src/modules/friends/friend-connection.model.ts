import { InferSchemaType, Schema, model } from 'mongoose';

const friendConnectionSchema = new Schema(
  {
    userLow: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userHigh: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'ignored'],
      required: true,
      index: true
    },
    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    respondedAt: { type: Date }
  },
  { timestamps: true }
);

friendConnectionSchema.index({ userLow: 1, userHigh: 1 }, { unique: true });
friendConnectionSchema.index({ status: 1, initiatedBy: 1 });
friendConnectionSchema.index({ status: 1, userLow: 1, userHigh: 1 });

export type FriendConnectionDocument = InferSchemaType<typeof friendConnectionSchema> & { _id: string };
export const FriendConnectionModel = model('FriendConnection', friendConnectionSchema);
