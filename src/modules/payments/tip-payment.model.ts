import { InferSchemaType, Schema, model } from 'mongoose';

const tipPaymentSchema = new Schema(
  {
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', index: true },
    stripeCheckoutSessionId: { type: String, default: '', index: true },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded'],
      default: 'pending',
      index: true
    },
    amountUsd: { type: Number, required: true, min: 1, max: 500 },
    platformFeeUsd: { type: Number, required: true, min: 0 },
    creatorNetUsd: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

export type TipPaymentDocument = InferSchemaType<typeof tipPaymentSchema> & { _id: string };
export const TipPaymentModel = model('TipPayment', tipPaymentSchema);

