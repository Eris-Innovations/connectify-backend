import { InferSchemaType, Schema, model } from 'mongoose';

const channelPostSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, maxlength: 4000 },
    mediaUrl: { type: String, default: '' },
    mediaType: {
      type: String,
      enum: ['', 'image', 'video', 'file'],
      default: ''
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

channelPostSchema.index({ channelId: 1, createdAt: -1 });

export type ChannelPostDocument = InferSchemaType<typeof channelPostSchema> & { _id: string };
export const ChannelPostModel = model('ChannelPost', channelPostSchema);
