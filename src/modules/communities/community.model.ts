import { InferSchemaType, Schema, model } from 'mongoose';

const communitySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80, index: true },
    description: { type: String, default: '', maxlength: 500 },
    avatar: { type: String, default: '' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    admins: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    announcementGroupId: {
      type: Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    groupIds: [{ type: Schema.Types.ObjectId, ref: 'Conversation' }],
    isPublic: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

communitySchema.index({ name: 'text', description: 'text' });
communitySchema.index({ memberIds: 1, createdAt: -1 });

export type CommunityDocument = InferSchemaType<typeof communitySchema> & { _id: string };
export const CommunityModel = model('Community', communitySchema);
