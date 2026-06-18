import { InferSchemaType, Schema, model } from 'mongoose';

const payoutRecordSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stripePayoutId: { type: String, default: '', index: true },
    amountUsd: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
      index: true
    },
    paidAt: { type: Date }
  },
  { timestamps: true }
);

export type PayoutRecordDocument = InferSchemaType<typeof payoutRecordSchema> & { _id: string };
export const PayoutRecordModel = model('PayoutRecord', payoutRecordSchema);

