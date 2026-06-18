import { InferSchemaType, Schema, model } from 'mongoose';

const channelSchema = new Schema(
  {
    name: { type: String, required: true, index: true },
    description: { type: String, default: '' },
    avatar: { type: String, default: '' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isPublic: { type: Boolean, default: true },
    accessType: { type: String, enum: ['free', 'paid'], default: 'free', index: true },
    monthlyPriceUsd: { type: Number, default: 0, min: 0, max: 99 },
    monetisationStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true
    },
    category: { type: String, default: 'general', index: true },
    icon: { type: String, default: '💬' },
    color: { type: String, default: '#3B7EF8' }
  },
  { timestamps: true }
);

channelSchema.index({ name: 'text', description: 'text' });

export type ChannelDocument = InferSchemaType<typeof channelSchema> & { _id: string };
export const ChannelModel = model('Channel', channelSchema);

