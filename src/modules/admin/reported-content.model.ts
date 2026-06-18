import { InferSchemaType, Schema, model } from 'mongoose';

const reportedContentSchema = new Schema(
  {
    entityType: {
      type: String,
      enum: ['post', 'message', 'channel', 'user'],
      required: true,
      index: true
    },
    entityId: { type: String, required: true, index: true },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'removed'],
      default: 'pending',
      index: true
    },
    reporterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reviewedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    note: { type: String, default: '' }
  },
  { timestamps: true }
);

reportedContentSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export type ReportedContentDocument = InferSchemaType<typeof reportedContentSchema> & { _id: string };
export const ReportedContentModel = model('ReportedContent', reportedContentSchema);

