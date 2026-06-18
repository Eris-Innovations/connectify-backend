import { InferSchemaType, Schema, model } from 'mongoose';

const postCommentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 }
  },
  { timestamps: true }
);

postCommentSchema.index({ postId: 1, createdAt: -1 });

export type PostCommentDocument = InferSchemaType<typeof postCommentSchema> & { _id: string };
export const PostCommentModel = model('PostComment', postCommentSchema);

