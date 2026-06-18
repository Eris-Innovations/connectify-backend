import { InferSchemaType, Schema, model } from 'mongoose';

const erasureRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    legalHoldReason: { type: String, default: '' },
    requestedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

export type ErasureRequestDocument = InferSchemaType<typeof erasureRequestSchema> & { _id: string };
export const ErasureRequestModel = model('ErasureRequest', erasureRequestSchema);

