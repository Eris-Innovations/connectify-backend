import { InferSchemaType, Schema, model } from 'mongoose';

const channelSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    stripeSubscriptionId: { type: String, default: '', index: true },
    stripeCheckoutSessionId: { type: String, default: '', index: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'grace_period', 'past_due', 'cancelled', 'refunded'],
      default: 'pending',
      index: true
    },
    currentPeriodEnd: { type: Date },
    graceUntil: { type: Date },
    amountUsd: { type: Number, required: true, min: 1, max: 99 }
  },
  { timestamps: true }
);

channelSubscriptionSchema.index({ userId: 1, channelId: 1 }, { unique: true });

export type ChannelSubscriptionDocument = InferSchemaType<typeof channelSubscriptionSchema> & { _id: string };
export const ChannelSubscriptionModel = model('ChannelSubscription', channelSubscriptionSchema);

