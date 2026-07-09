import { Schema, model, InferSchemaType, models } from 'mongoose';

const broadcastAnnouncementSchema = new Schema(
  {
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    body: { type: String, required: true, trim: true, maxlength: 700 },
    targetGroup: {
      type: String,
      enum: ['all', 'verified', 'creators', 'custom'],
      default: 'all'
    },
    targetUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    audienceCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    status: { type: String, enum: ['sending', 'sent', 'failed'], default: 'sending' },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  {
    timestamps: true
  }
);

export type BroadcastAnnouncementDocument = InferSchemaType<typeof broadcastAnnouncementSchema> & { _id: string };
export const BroadcastAnnouncementModel = models.BroadcastAnnouncement || model('BroadcastAnnouncement', broadcastAnnouncementSchema);
