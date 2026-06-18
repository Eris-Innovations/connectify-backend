import { InferSchemaType, Schema, model } from 'mongoose';

const creatorApplicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },
    notes: { type: String, default: '' },
    reviewedAt: { type: Date }
  },
  { timestamps: true }
);

export type CreatorApplicationDocument = InferSchemaType<typeof creatorApplicationSchema> & { _id: string };
export const CreatorApplicationModel = model('CreatorApplication', creatorApplicationSchema);

